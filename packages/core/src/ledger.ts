import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { releaseAwake } from './awake.ts';
import { autoMergeFor, type Config, defaultEnvironment, environmentByBranch, type Effort, type GateScope } from './config.ts';
import { AccError } from './exec.ts';
import { withLock } from './lock.ts';
import type { RepoPaths } from './paths.ts';
import { TRACKER_KINDS } from './trackers/types.ts';

export const STATES = ['todo', 'running', 'review', 'rework', 'blocked', 'done'] as const;
export type State = (typeof STATES)[number];

export const ACTORS = ['human', 'orchestrator', 'builder', 'reviewer', 'sync'] as const;
export type Actor = (typeof ACTORS)[number];

export const SOURCE_KINDS = [...TRACKER_KINDS, 'manual'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface Source {
  kind: SourceKind;
  key: string | null;
  url: string | null;
}

export interface HistoryEntry {
  at: string;
  actor: Actor;
  by: string;
  from: State | null;
  to: State;
  reason: string | null;
  override?: true;
}

/** A stopped builder carried on in its session, by a person or by autopilot (D-067). */
export interface Resume {
  at: string;
  actor: Actor;
  by: string;
}

export interface Run {
  bgId?: string;
  sessionId?: string;
  worktree?: string;
  branch?: string;
  startedAt?: string;
  /** Each time its session was resumed. A dispatch starts a new run, so a new list. */
  resumes?: Resume[];
  /** The model its builder was started with, or last resumed with (D-086). */
  model?: string;
  /**
   * A person picked that model for this task (D-086): a re-dispatch and a resume keep it, until another is
   * picked. Without it, the next dispatch follows the clone's, the project's or acc's default.
   */
  modelPicked?: true;
  /** The effort its builder was started with, or last resumed with (D-???), when one was named: none is Claude Code's default. */
  effort?: Effort;
  /** A person picked that effort for this task (D-???): kept as modelPicked is, until another is picked. */
  effortPicked?: true;
  /** What its builder is called (D-087): its session is found by this when no id was recorded. Older runs have none. */
  name?: string;
  /** Which of the task's dispatches this is: the second is "builder 2". Older runs count as 1. */
  n?: number;
  /** The tasks in flight whose files it shared when it started, with those files (D-093). */
  shares?: FileShare[];
  /** What its builder said as it finished (D-106): given with acc done, and maybe with acc block. */
  note?: RunNote;
  /**
   * The note the task's run before this one left, kept when this one was dispatched, or null when it left
   * none: a crash, an abandon, a person's move or a block without one. A first run has neither.
   */
  before?: RunNote | null;
}

/**
 * A builder's handoff note (D-106): what landed, which numbers moved (tests, checks, ratchets) and what's
 * still open, a line each. It's the builder's own account: acc works out none of it. An empty part says
 * there was nothing.
 */
export interface RunNote {
  landed: string[];
  moved: string[];
  open: string[];
  at: string;
  by: string;
  /** Where the run ended: in review, by acc done, or blocked. */
  ended: 'review' | 'blocked';
}

/** A note as given: a part left out is undefined, where "none" is an empty list. */
export type NoteInput = Partial<Pick<RunNote, 'landed' | 'moved' | 'open'>>;

/** Another task, and the files two tasks share (D-093). */
export interface FileShare {
  task: string;
  files: string[];
}

/**
 * A person dispatched a task to do, and it waits for another task's files (D-093): who asked and when,
 * and what it waited for then, and the tasks that went first. While it's being started, who claimed it;
 * once a start on its own failed, why, and nothing tries again until a person acts.
 */
export interface Hold {
  at: string;
  actor: Actor;
  by: string;
  waitsFor: FileShare[];
  first: string[];
  starting?: { at: string; by: string } | null;
  failed?: { reason: string; at: string; by: string } | null;
  /** The model a person picked for its builder when they dispatched it (D-086), which its start launches with. */
  model?: string;
  /** The effort a person picked for its builder when they dispatched it (D-???), which its start launches with. */
  effort?: Effort;
}

export interface PullRequest {
  number: number;
  url: string;
  state: 'open' | 'merged' | 'closed';
  /** What GitHub's checks say, kept by acc sync. failing shows the task as needs you. */
  ci?: 'passing' | 'failing' | 'pending' | null;
  /** The names of the checks that failed, kept by acc sync beside ci, so the task can name them (D-076). */
  failing?: string[];
  /** A person on GitHub asked for changes, which also shows it as needs you. */
  changesRequested?: boolean;
  /** The files it conflicts in with its base, kept by acc sync and acc land. Empty when it merges cleanly. */
  conflicts?: string[];
  syncedAt?: string;
  /** When acc land last opened or updated it, so the next land can tell whether rework came between. */
  landedAt?: string;
  /** The commit acc land last pushed to it, so autopilot can tell whether it's behind its branch (D-055). */
  sha?: string;
  /** The commit its merge left on its base, kept by acc sync, so a deploy knows which tasks it carried (D-066). */
  mergeSha?: string;
  /**
   * acc closing the task's GitHub issue now that this pull request merged, where its tracker says
   * "edits": true (D-082). pending until it's settled, with why the last try failed, and each acc sync
   * tries again; then closed, or left as it was, with why. Once settled, acc never touches the issue again.
   */
  issue?: { state: 'pending' | 'closed' | 'left'; at: string; reason?: string };
}

/**
 * A promotion that takes a task's change on to another environment (D-075): recorded by acc promote on
 * each task it carries, and followed by acc sync. Its merge commit is where the change reached `to`.
 */
export interface Promotion {
  /** The environments' branches. */
  from: string;
  to: string;
  pr: { number: number; url: string };
  state: 'open' | 'merged' | 'closed';
  /** The commit its merge left on `to`, kept by acc sync, so a deploy of `to` knows it carried the task. */
  mergeSha?: string;
  /** When GitHub merged it, so of two that took a task there, the first to merge is where it arrived. */
  mergedAt?: string;
  at: string;
}

/**
 * start: a held task started once it may go (D-093). queue: the merge queue's turn for the task at its head,
 * which merges the base in, checks and pushes (GH-73).
 */
export const AUTOPILOT_STEPS = ['review', 'land', 'dispatch', 'refresh', 'resume', 'checks', 'merge', 'start', 'queue'] as const;
export type AutopilotStepName = (typeof AUTOPILOT_STEPS)[number];

/**
 * Where the head of a merge queue is in its turn (GH-73). waiting: in line. refreshing: merging its base
 * in. slot: waiting for a heavy-check slot. checking: running the full check. github: waiting for GitHub's
 * checks. held: waiting on something else, which its `why` says, such as GitHub working out whether it can
 * merge. merging: asking GitHub to merge it.
 */
export const QUEUE_PHASES = ['waiting', 'refreshing', 'slot', 'checking', 'github', 'held', 'merging'] as const;
export type QueuePhase = (typeof QUEUE_PHASES)[number];

/** A task's place in its repo's merge queue (GH-73): when it was ready, at which commit, and its phase. */
export interface Queued {
  /** When autopilot first saw it ready: the queue goes in this order. */
  at: string;
  /** The branch's latest commit when it joined. */
  sha: string;
  phase: QueuePhase;
  /** What the head waits on, in words, while it's held. */
  why?: string;
}

/**
 * The review a merge commit carries (GH-73): the merge queue merged the base into a reviewed commit cleanly,
 * or by keeping both sides' additions to an append-only file, and checked it in full. It's no new verdict.
 */
export interface CarriedReview {
  /** The reviewed commit, and the merge made on it. */
  from: string;
  to: string;
  base: string;
  /** Files autopilot resolved: append-only ones, keeping both sides' additions, and the floors file, keeping the better floors (GH-99). */
  resolved: string[];
  at: string;
}

/** How GitHub merges a pull request: the repo allows one or more of these. */
export type MergeMethod = 'merge' | 'squash' | 'rebase';

/** A pull request autopilot merged (GH-67), kept until acc sync sees it merged and moves the task to done. */
export interface AutopilotMerge {
  /** The commit it merged: the branch's latest, landed. */
  sha: string;
  pr: { number: number; url: string };
  method: MergeMethod;
  at: string;
}

/**
 * The commit autopilot last sent back to its builder, and why: its checks failed on GitHub, and which
 * (D-076), or the merge queue found it conflicts with its base or fails the full check (GH-73). One
 * without a kind is from before the queue: checks.
 */
export interface SentBack {
  sha: string;
  /** The checks that failed: GitHub's, or the queue's full check's gates. */
  checks: string[];
  at: string;
  kind?: 'checks' | 'queue';
  /** The files the queue couldn't merge its base into. */
  conflicts?: string[];
}

/** A step autopilot took that failed: it isn't tried again on that commit, and the task needs you (D-055). */
export interface AutopilotFailure {
  step: AutopilotStepName;
  /** The branch's latest commit when it failed. A new commit lets autopilot try again. */
  sha: string;
  /** The task's state when it failed. Any move clears the failure. */
  state: State;
  reason: string;
  at: string;
}

/**
 * acc's last move of the task's card on its GitHub Project (GH-146): the state it moved the card for, the
 * column, and when, or why the move failed. A failure is shown on the task while it stays in that state.
 */
export interface CardMove {
  state: State;
  column: string | null;
  at: string;
  failed?: string;
}

export interface Task {
  id: string;
  title: string;
  brief: string;
  source: Source;
  /** Branch of the environment this task builds from and lands on. */
  environment: string;
  deps: string[];
  labels: string[];
  state: State;
  blocker: string | null;
  run: Run | null;
  pr: PullRequest | null;
  /** The promotions that took its change on from its environment, oldest first. */
  promotions?: Promotion[];
  /**
   * What autopilot couldn't do for it, if anything (D-055), the commit it last sent back (D-076), the pull
   * request it merged (GH-67), its place in the merge queue, and the review its merge commit carries (GH-73).
   */
  autopilot?: { failed: AutopilotFailure | null; sentBack?: SentBack | null; merged?: AutopilotMerge | null; queued?: Queued | null; carried?: CarriedReview | null };
  /** It waits for another task's files, since a person dispatched it (D-093). Any move ends it. */
  held?: Hold | null;
  /** Where acc last moved its card on the GitHub Project, or why it couldn't (GH-146). */
  card?: CardMove | null;
  history: HistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface Ledger {
  schema: 1;
  seq: number;
  tasks: Task[];
}

export interface LedgerEvent {
  seq: number;
  at: string;
  type: 'task.added' | 'task.updated' | 'task.moved' | 'task.removed';
  task: string;
  actor: Actor;
  by: string;
  data: Record<string, unknown>;
}

export type Emit = (e: Omit<LedgerEvent, 'seq' | 'at'>) => void;

// ---------------------------------------------------------------- storage

export const emptyLedger = (): Ledger => ({ schema: 1, seq: 0, tasks: [] });

export function readLedger(file: string): Ledger {
  if (!existsSync(file)) return emptyLedger();
  const l = JSON.parse(readFileSync(file, 'utf8')) as Ledger;
  if (l.schema !== 1 || !Array.isArray(l.tasks)) throw new AccError('bad-ledger', `${file} isn't a ledger this version understands.`);
  return l;
}

/** Writes a file whole: a temp file beside it, then a rename, so a reader never sees it half-written. */
export function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/**
 * The only way to change the ledger (D-012). Holds the lock, appends every emitted event to
 * events.jsonl, then replaces the snapshot atomically. Readers never see a half-written file.
 */
export function mutate<T>(paths: RepoPaths, now: () => Date, fn: (ledger: Ledger, emit: Emit) => T): T {
  mkdirSync(paths.stateDir, { recursive: true });
  return withLock(paths.lock, () => {
    const ledger = readLedger(paths.ledger);
    const events: LedgerEvent[] = [];
    const emit: Emit = (e) => events.push({ ...e, seq: ++ledger.seq, at: now().toISOString() });
    const result = fn(ledger, emit);
    if (events.length) {
      mkdirSync(dirname(paths.events), { recursive: true });
      appendFileSync(paths.events, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
      writeAtomic(paths.ledger, JSON.stringify(ledger, null, 2) + '\n');
    }
    return result;
  });
}

// ---------------------------------------------------------------- ids

const JIRA_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;

/** "#12", "12" and "GH-12" become GH-12. Jira keys stay as they are, upper-cased. */
export function normalizeId(ref: string, defaultKind: SourceKind = 'jira'): string {
  const r = ref.trim();
  const gh = /^(?:#|GH-)?(\d+)$/i.exec(r);
  if (gh && (defaultKind === 'github' || /^(#|GH-)/i.test(r))) return `GH-${gh[1]}`;
  return r.toUpperCase();
}

export function isValidId(id: string): boolean {
  return JIRA_KEY.test(id);
}

function nextManualId(ledger: Ledger): string {
  const n = ledger.tasks.map((t) => /^T-(\d+)$/.exec(t.id)?.[1]).filter(Boolean).map(Number);
  return `T-${(n.length ? Math.max(...n) : 0) + 1}`;
}

// ---------------------------------------------------------------- intake

export interface TaskInput {
  source: { kind: SourceKind; key?: string | null; url?: string | null };
  title: string;
  brief?: string;
  deps?: string[];
  environment?: string;
  labels?: string[];
}

export interface UpsertResult {
  added: string[];
  updated: string[];
  unchanged: string[];
  errors: string[];
}

/** Adds new tasks and refreshes the text of known ones. Never changes a task's state. */
export function upsertTasks(
  ledger: Ledger, config: Config, inputs: TaskInput[], actor: Actor, by: string, emit: Emit, now: () => Date,
): UpsertResult {
  const res: UpsertResult = { added: [], updated: [], unchanged: [], errors: [] };
  const defaultEnv = defaultEnvironment(config).branch;
  inputs.forEach((input, i) => {
    const at = `item ${i + 1}`;
    if (!input || typeof input.title !== 'string' || !input.title.trim()) { res.errors.push(`${at}: needs a title.`); return; }
    const kind = input.source?.kind;
    if (!SOURCE_KINDS.includes(kind)) { res.errors.push(`${at}: source kind must be ${SOURCE_KINDS.join(', ')}.`); return; }
    let id: string;
    if (kind === 'manual') id = input.source.key ? normalizeId(input.source.key) : nextManualId(ledger);
    else {
      if (!input.source.key) { res.errors.push(`${at}: a ${kind} task needs its tracker key.`); return; }
      id = normalizeId(input.source.key, kind);
    }
    if (!isValidId(id)) { res.errors.push(`${at}: "${id}" isn't a valid task id.`); return; }
    const env = input.environment ?? defaultEnv;
    const envDef = environmentByBranch(config, env);
    if (!envDef) { res.errors.push(`${id}: environment "${env}" isn't in the config.`); return; }
    if (envDef.protected) { res.errors.push(`${id}: "${env}" is protected, so no task can build on it directly.`); return; }
    const deps = (input.deps ?? []).map((d) => normalizeId(d, kind));
    const fields = {
      title: input.title.trim(),
      brief: (input.brief ?? '').trim(),
      deps,
      labels: input.labels ?? [],
      url: input.source.url ?? null,
    };
    const existing = ledger.tasks.find((t) => t.id === id);
    const stamp = now().toISOString();
    if (!existing) {
      const task: Task = {
        id,
        title: fields.title,
        brief: fields.brief,
        source: { kind, key: kind === 'manual' ? null : (input.source.key ?? null), url: fields.url },
        environment: env,
        deps,
        labels: fields.labels,
        state: 'todo',
        blocker: null,
        run: null,
        pr: null,
        history: [{ at: stamp, actor, by, from: null, to: 'todo', reason: null }],
        createdAt: stamp,
        updatedAt: stamp,
      };
      ledger.tasks.push(task);
      emit({ type: 'task.added', task: id, actor, by, data: { title: task.title, source: task.source } });
      res.added.push(id);
      return;
    }
    const changed: Record<string, unknown> = {};
    if (existing.title !== fields.title) changed.title = existing.title = fields.title;
    if (existing.brief !== fields.brief) changed.brief = existing.brief = fields.brief;
    if (existing.source.url !== fields.url) changed.url = existing.source.url = fields.url;
    if (JSON.stringify(existing.deps) !== JSON.stringify(deps)) changed.deps = existing.deps = deps;
    if (JSON.stringify(existing.labels) !== JSON.stringify(fields.labels)) changed.labels = existing.labels = fields.labels;
    if (Object.keys(changed).length) {
      existing.updatedAt = stamp;
      emit({ type: 'task.updated', task: id, actor, by, data: changed });
      res.updated.push(id);
    } else res.unchanged.push(id);
  });
  return res;
}

// ---------------------------------------------------------------- transitions

/** note: a builder's move gives a handoff note (D-106). A person's needs none. */
export type Requirement = 'depsDone' | 'underCap' | 'envNotProtected' | 'reason' | 'gatesPassed' | 'note';

/**
 * How a builder finishes (D-106), word for word everywhere it's told: the packet, its short version, the
 * Stop hook, a resume, and acc done's refusal. Each flag can be given again for another line.
 */
export const DONE_COMMAND = 'acc done --landed "<what landed>" --moved "<tests, checks, ratchets that moved>" --open "<what\'s still open, or none>"';

/** The most a note's part holds, and the longest a line may be. */
export const NOTE_LIMITS = { lines: 10, chars: 300 } as const;

const NOTE_PARTS = ['landed', 'moved', 'open'] as const;

/** A note's lines as given, one line each, whitespace collapsed and blanks dropped; "none" says there's nothing. */
export function noteInput(parts: { landed?: string[]; moved?: string[]; open?: string[] }): NoteInput {
  const out: NoteInput = {};
  for (const k of NOTE_PARTS) {
    const given = parts[k];
    if (given === undefined) continue;
    out[k] = given.map((l) => l.replace(/\s+/g, ' ').trim()).filter((l) => l && l.toLowerCase() !== 'none');
  }
  return out;
}

/** What each part of a note is called, wherever it's shown. */
export const NOTE_LABELS = { landed: 'What landed', moved: 'Numbers that moved', open: 'Still open' } as const;

/** A note as markdown: each part's label, then its lines, or "none" for a part with nothing. */
export function noteMarkdown(n: Pick<RunNote, 'landed' | 'moved' | 'open'>): string[] {
  return NOTE_PARTS.flatMap((k, i) => [...(i ? [''] : []), `**${NOTE_LABELS[k]}**`, '', ...(n[k].length ? n[k].map((l) => `- ${l}`) : ['- none'])]);
}

/**
 * The note to show for a task (D-106): its run's, or the last run's while a new one is under way. missing:
 * the run that ended, or while one runs the run before it, left none. A done task's missing note isn't news.
 */
export function shownNote(task: Pick<Task, 'state' | 'run'>): { note: RunNote | null; fromLast: boolean; missing: boolean } {
  const r = task.run;
  if (!r) return { note: null, fromLast: false, missing: false };
  if (r.note) return { note: r.note, fromLast: false, missing: false };
  if (task.state === 'running') return { note: r.before ?? null, fromLast: true, missing: r.before === null };
  return { note: null, fromLast: false, missing: task.state !== 'done' };
}

/** Whether a note says anything at all. */
export const noteGiven = (n: NoteInput | null | undefined): n is NoteInput => !!n && NOTE_PARTS.some((k) => n[k] !== undefined);

/** What's wrong with a note: a part over the limits, or, where one is required, a part left out. */
export function noteProblems(n: NoteInput | null | undefined, required: boolean): string[] {
  const p: string[] = [];
  for (const k of NOTE_PARTS) {
    const lines = n?.[k] ?? [];
    if (lines.length > NOTE_LIMITS.lines) p.push(`The note's --${k} has ${lines.length} lines. It takes at most ${NOTE_LIMITS.lines}.`);
    const long = lines.filter((l) => l.length > NOTE_LIMITS.chars).length;
    if (long) p.push(`${long === 1 ? 'A line' : `${long} lines`} in the note's --${k} ${long === 1 ? 'is' : 'are'} over ${NOTE_LIMITS.chars} characters. Say it shorter.`);
  }
  if (required) {
    const missing = NOTE_PARTS.filter((k) => n?.[k] === undefined || (k === 'landed' && !n[k]!.length));
    if (missing.length) {
      p.push(`A builder finishes with a note for whoever comes next: what landed, which numbers moved, and what's still open (it says nothing about ${missing.map((k) => `--${k}`).join(', ')}). Run: ${DONE_COMMAND}. Give a flag again for each further line. --moved none and --open none say there was nothing.`);
    }
  }
  return p;
}

export interface Rule {
  from: State | 'any';
  to: State;
  actors: Actor[];
  requires: Requirement[];
}

/** DESIGN.md section 5. Anything not listed needs --force and a reason, and is recorded as an override. */
export const RULES: Rule[] = [
  { from: 'todo', to: 'running', actors: ['human', 'orchestrator'], requires: ['depsDone', 'underCap', 'envNotProtected'] },
  { from: 'running', to: 'review', actors: ['builder', 'human'], requires: ['gatesPassed', 'note'] },
  // The orchestrator is autopilot sending back a pull request whose checks failed on GitHub (D-076).
  { from: 'review', to: 'rework', actors: ['reviewer', 'human', 'orchestrator'], requires: ['reason'] },
  { from: 'rework', to: 'running', actors: ['human', 'orchestrator'], requires: ['underCap', 'envNotProtected'] },
  { from: 'review', to: 'done', actors: ['sync', 'human'], requires: [] },
  // Its issue was closed on GitHub before anyone started it: acc intake moves it.
  { from: 'todo', to: 'done', actors: ['sync'], requires: [] },
  { from: 'running', to: 'todo', actors: ['human'], requires: ['reason'] },
  { from: 'done', to: 'rework', actors: ['human', 'sync'], requires: ['reason'] },
  { from: 'blocked', to: 'todo', actors: ['human'], requires: [] },
  // A person settled what blocked finished work, such as by waiving a check (D-031).
  { from: 'blocked', to: 'review', actors: ['human'], requires: ['gatesPassed'] },
  { from: 'any', to: 'blocked', actors: [...ACTORS], requires: ['reason'] },
];

export interface MoveRequest {
  to: State;
  actor: Actor;
  by: string;
  reason?: string | null;
  force?: boolean;
  /** The builder's handoff note (D-106), kept on the run it ends: with acc done, or acc block. */
  note?: NoteInput | null;
}

export interface Hooks {
  /** Required checks that have no passing receipt on the task's current commit: a builder's, unless it says the merge's (GH-73). */
  missingGates(task: Task, scope?: GateScope): string[];
}

export const noGateHooks: Hooks = { missingGates: () => [] };

export function findRule(from: State, to: State): Rule | undefined {
  return RULES.find((r) => r.from === from && r.to === to)
    ?? RULES.find((r) => r.from === 'any' && r.to === to && from !== 'blocked' && from !== 'done');
}

/** The builders running in a repo, but `except`'s: its tasks in Running, whose builder may have stopped (D-067). */
export const builders = (ledger: Pick<Ledger, 'tasks'>, except: string): number => ledger.tasks.filter((t) => t.state === 'running' && t.id !== except).length;

/** A start that would pass the project's cap, in words that name it, beside this machine's total (GH-111). */
export const projectCapWords = (n: number, max: number): string => `${n} ${n === 1 ? 'builder is' : 'builders are'} running in this project, and its cap is ${max} (agents.max).`;

/** Everything that stops this move. Empty means it's allowed. */
export function checkMove(ledger: Ledger, config: Config, task: Task, req: MoveRequest, hooks: Hooks): string[] {
  if (!STATES.includes(req.to)) return [`"${req.to}" isn't a state. States: ${STATES.join(', ')}.`];
  if (!ACTORS.includes(req.actor)) return [`"${req.actor}" isn't an actor.`];
  if (task.state === req.to) return [`${task.id} is already ${req.to}.`];
  const reason = req.reason?.trim() ?? '';
  // A note ends a run (D-106): it goes with done or a block, on a task that has one, and keeps to its limits.
  if (noteGiven(req.note)) {
    if (!task.run || (req.to !== 'review' && req.to !== 'blocked')) return [`A note goes with a run's end: acc done, or acc block. ${task.id} ${task.run ? `is moving to ${req.to}` : 'has no run'}.`];
    const over = noteProblems(req.note, false);
    if (over.length) return over;
  }
  if (req.force) {
    const p: string[] = [];
    if (req.actor !== 'human') p.push('Only a person can force a move.');
    if (!reason) p.push('A forced move needs --reason.');
    return p;
  }
  const rule = findRule(task.state, req.to);
  if (!rule) return [`There's no rule for ${task.state} → ${req.to}. A person can force it with --force --reason.`];
  if (!rule.actors.includes(req.actor)) {
    return [`A ${req.actor} can't move a task from ${task.state} to ${req.to}. Allowed: ${rule.actors.join(', ')}.`];
  }
  const problems: string[] = [];
  for (const r of rule.requires) {
    if (r === 'reason' && !reason) problems.push(`Moving to ${req.to} needs a reason.`);
    if (r === 'depsDone') {
      for (const d of task.deps) {
        const dep = ledger.tasks.find((t) => t.id === d);
        if (!dep) problems.push(`It depends on ${d}, which isn't in the ledger.`);
        else if (dep.state !== 'done') problems.push(`It's waiting on ${d}, which is ${dep.state}.`);
      }
    }
    if (r === 'underCap') {
      const running = builders(ledger, task.id);
      if (running >= config.agents.max) problems.push(projectCapWords(running, config.agents.max));
    }
    if (r === 'envNotProtected') {
      const env = environmentByBranch(config, task.environment);
      if (!env) problems.push(`Its environment "${task.environment}" isn't in the config.`);
      else if (env.protected) problems.push(`"${env.name}" is protected. Agents never work on it directly.`);
    }
    if (r === 'gatesPassed') {
      const missing = hooks.missingGates(task);
      if (missing.length) problems.push(`These required checks haven't passed on the current commit: ${missing.join(', ')}. Commit everything, then run: acc gate run`);
    }
    if (r === 'note' && req.actor === 'builder') problems.push(...noteProblems(req.note, true));
  }
  return problems;
}

/** Applies a move that checkMove allowed. `data` adds to its event, such as why autopilot made it. */
export function applyMove(task: Task, req: MoveRequest, emit: Emit, now: () => Date, data: Record<string, unknown> = {}): HistoryEntry {
  const at = now().toISOString();
  const entry: HistoryEntry = { at, actor: req.actor, by: req.by, from: task.state, to: req.to, reason: req.reason?.trim() || null };
  if (req.force) entry.override = true;
  task.blocker = req.to === 'blocked' ? (entry.reason ?? null) : null;
  // Whatever autopilot couldn't do was about the state the task has left. Moved, it leaves the merge queue,
  // and its next commits are reviewed afresh (GH-73).
  if (task.autopilot?.failed) task.autopilot.failed = null;
  if (task.autopilot?.queued) task.autopilot.queued = null;
  if (task.autopilot?.carried) task.autopilot.carried = null;
  // So was a wait for another task's files (D-093): a dispatch, a block or done ends it.
  if (task.held) task.held = null;
  // The builder's note stays with the run it ended (D-106), and its event carries it too.
  const note: RunNote | null = noteGiven(req.note) && task.run && (req.to === 'review' || req.to === 'blocked')
    ? { landed: req.note.landed ?? [], moved: req.note.moved ?? [], open: req.note.open ?? [], at, by: req.by, ended: req.to }
    : null;
  if (note) task.run!.note = note;
  task.state = req.to;
  task.updatedAt = at;
  task.history.push(entry);
  emit({ type: 'task.moved', task: task.id, actor: req.actor, by: req.by, data: { from: entry.from, to: entry.to, reason: entry.reason, override: req.force ?? false, ...(note ? { note } : {}), ...data } });
  return entry;
}

export function moveTask(
  paths: RepoPaths, config: Config, id: string, req: MoveRequest, hooks: Hooks, now: () => Date,
): { task: Task; entry: HistoryEntry } {
  const moved = mutate(paths, now, (ledger, emit) => {
    const task = ledger.tasks.find((t) => t.id === id);
    if (!task) throw new AccError('no-task', `No task ${id}.`);
    const problems = checkMove(ledger, config, task, req, hooks);
    if (problems.length) throw new AccError('move-refused', `Can't move ${id} to ${req.to}:\n- ${problems.join('\n- ')}`);
    const entry = applyMove(task, req, emit, now);
    return { task, entry };
  });
  // Done, blocked, set aside or abandoned: nothing keeps the Mac awake for it any more (D-067).
  if (moved.entry.from === 'running') releaseAwake(paths, id);
  return moved;
}

export interface AllowedMove {
  to: State;
  needsReason: boolean;
  /** Why the move would be refused right now, apart from a missing reason. Empty means it would go through. */
  problems: string[];
}

/** The moves a given actor may make from a task's current state, with what would stop each one. */
export function allowedMoves(ledger: Ledger, config: Config, task: Task, actor: Actor, hooks: Hooks): AllowedMove[] {
  const moves: AllowedMove[] = [];
  for (const to of STATES) {
    if (to === task.state) continue;
    const rule = findRule(task.state, to);
    if (!rule || !rule.actors.includes(actor)) continue;
    const needsReason = rule.requires.includes('reason');
    const problems = checkMove(ledger, config, task, { to, actor, by: actor, reason: needsReason ? 'reason given' : null }, hooks);
    moves.push({ to, needsReason, problems });
  }
  return moves;
}

// ---------------------------------------------------------------- derived states

export function isReady(ledger: Ledger, task: Task): boolean {
  return task.state === 'todo' && task.deps.every((d) => ledger.tasks.find((t) => t.id === d)?.state === 'done');
}

export const readyTasks = (ledger: Ledger): Task[] => ledger.tasks.filter((t) => isReady(ledger, t));

export type DisplayState = State | 'ready' | 'needs-you';

/** What autopilot couldn't do in the task's current state, or null (D-055). */
export const autopilotFailure = (task: Task): AutopilotFailure | null =>
  (task.autopilot?.failed && task.autopilot.failed.state === task.state ? task.autopilot.failed : null);

export interface SessionInfo {
  state?: string;
  status?: string;
  /** Its builder's session ended or went idle without acc done or acc block (builderStopped). */
  stopped?: boolean;
}

/** A Claude Code session, as `claude agents --json` lists it. Background sessions have an id and a state. */
export interface ClaudeSession {
  id?: string;
  sessionId?: string;
  pid?: number;
  kind?: string;
  name?: string;
  cwd?: string;
  /** Background sessions: working, blocked, done, failed or stopped. */
  state?: string;
  /** busy, waiting or idle, while it has a process. */
  status?: string;
}

/**
 * The sessions that are a task's builder: its background session, and any carrying on its conversation,
 * found by the ids recorded on its run. A builder whose ids weren't recorded is found by the name its run
 * recorded (D-087), and a run from before names were recorded by a background session named after the
 * task. Never by a name worked out from the task, whose title can change.
 */
export function sessionsOf<S extends ClaudeSession>(task: { id: string; run?: Run | null }, sessions: S[]): S[] {
  const run = task.run;
  if (run?.bgId || run?.sessionId) return sessions.filter((s) => (!!run.bgId && s.id === run.bgId) || (!!run.sessionId && s.sessionId === run.sessionId));
  const name = run?.name ?? task.id;
  return sessions.filter((s) => s.kind === 'background' && s.name === name);
}

/** A run a task's builder had, as its dispatch recorded it in events.jsonl: the task keeps only its current one. */
export interface RunRecord {
  task: string;
  bgId?: string;
  sessionId?: string;
  name?: string;
  n?: number;
}

/** What has been read of a repo's events for its runs: every one, from the file's first byte. */
export interface RunsLog {
  /** The byte after the last whole line read. */
  offset: number;
  ino: number;
  runs: RunRecord[];
}

/**
 * Every run each task's builder had, from the repo's events (events.jsonl, never trimmed): each dispatch's
 * run, and a session its builder's SessionStart linked to the run afterwards. An earlier run can be
 * anywhere in the file, so the first look reads all of it, and each look after reads only what was added.
 * A file that shrank or was replaced is read again from the start. Only whole lines: one being written is
 * read next time. Undefined when there's no file yet.
 */
export function readRuns(file: string, prev?: RunsLog): RunsLog | undefined {
  let st;
  try {
    st = statSync(file);
  } catch {
    return undefined;
  }
  const s: RunsLog = !prev || prev.ino !== st.ino || st.size < prev.offset ? { offset: 0, ino: st.ino, runs: [] } : { ...prev, runs: [...prev.runs] };
  if (st.size === s.offset) return s;
  const buf = Buffer.alloc(st.size - s.offset);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buf, 0, buf.length, s.offset);
  } finally {
    closeSync(fd);
  }
  const end = buf.lastIndexOf(10);
  if (end < 0) return s;
  const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  for (const line of buf.subarray(0, end).toString('utf8').split('\n')) {
    let e: { type?: unknown; task?: unknown; data?: Record<string, unknown> };
    try {
      e = JSON.parse(line);
    } catch {
      continue; // a line that isn't an event
    }
    if (e?.type !== 'task.updated' || typeof e.task !== 'string' || !e.data || typeof e.data !== 'object') continue;
    const task = e.task;
    const run = e.data.run as Record<string, unknown> | null | undefined;
    if (run && typeof run === 'object') {
      const r: RunRecord = { task };
      for (const k of ['bgId', 'sessionId', 'name'] as const) if (text(run[k])) r[k] = text(run[k]);
      if (typeof run.n === 'number') r.n = run.n;
      s.runs.push(r);
    } else if (text(e.data.sessionId)) {
      // A session linked to the task's run after its dispatch: one more id for that run.
      s.runs.push({ ...(s.runs.findLast((r) => r.task === task) ?? { task }), sessionId: text(e.data.sessionId)! });
    }
  }
  return { ...s, offset: s.offset + end + 1 };
}

/**
 * What a repo says about the sessions that work for its tasks: its tasks, every run their builders had,
 * the reviewers and analysts whose verdicts and analyses are recorded, and the reviews and analyses under
 * way. Read from the repo's ledger and what sits beside it.
 */
export interface RepoAgents {
  /** Its tasks, with their titles where it has them: the Agents page heads each task's agents with it (GH-119). */
  tasks: (Pick<Task, 'id' | 'state' | 'run'> & Partial<Pick<Task, 'title'>>)[];
  runs: RunRecord[];
  verdicts: { task: string; sessionId: string }[];
  /** Each task's current analysis: one a task, replaced when it's analyzed again. */
  analyses: { task: string; sessionId: string }[];
  live: { task: string; sessionId: string; role: 'review' | 'analysis' }[];
}

/** Who a session works for, and whether its work is over. */
export interface SessionTie {
  task: string;
  role: 'builder' | 'review' | 'analysis';
  /** Nobody waits on it: Claude Code may still list it waiting at its prompt. */
  finished: boolean;
  /** Why it's finished: its task is done, its task has a later run, or its verdict or analysis is recorded. */
  why: 'done' | 'later-run' | 'reviewed' | 'analyzed' | null;
  /** Its task's title, when the ledger has it: the Agents page names a task elsewhere by it (GH-119). */
  title?: string;
  /** A builder's run's count, when its dispatch recorded one: the second is "builder 2" (D-087). */
  n?: number;
}

/** Whether a recorded run is the task's current one, by its count or its ids. */
const currentRun = (r: RunRecord, run: Run | null | undefined): boolean =>
  !!run && ((r.n !== undefined && r.n === run.n) || (!!r.bgId && r.bgId === run.bgId) || (!!r.sessionId && r.sessionId === run.sessionId));

/**
 * The task a session works for, as far as its repo can tell, and whether its work is over (D-095). In
 * order: a review or analysis under way is its task's, at work. A task's current builder, found as
 * sessionsOf finds it, is finished once the task is done. A reviewer whose verdict, or an analyst whose
 * analysis, is recorded is finished. A builder of an earlier run is finished: acc never carries an earlier
 * run on, so a re-dispatch starts a new session. Earlier runs are found by the ids their dispatch recorded,
 * never by a name (D-087). Anything else, and anything for a task no longer in the ledger, is null: untied.
 */
export function tieSession(s: ClaudeSession, repo: RepoAgents): SessionTie | null {
  const tasks = new Map(repo.tasks.map((t) => [t.id, t]));
  // Its task's title and its run's count go with it, where the ledger has them (GH-119).
  const tie = (task: string, role: SessionTie['role'], why: SessionTie['why'], n?: number): SessionTie => {
    const title = tasks.get(task)?.title;
    return { task, role, finished: why !== null, why, ...(title ? { title } : {}), ...(n !== undefined ? { n } : {}) };
  };
  const sid = s.sessionId;
  const live = sid ? repo.live.find((l) => l.sessionId === sid && tasks.has(l.task)) : undefined;
  if (live) return tie(live.task, live.role, null);
  const built = repo.tasks.find((t) => !!t.run && sessionsOf(t, [s]).length > 0);
  if (built) return tie(built.id, 'builder', built.state === 'done' ? 'done' : null, built.run?.n);
  if (sid) {
    const v = repo.verdicts.find((x) => x.sessionId === sid && tasks.has(x.task));
    if (v) return tie(v.task, 'review', 'reviewed');
    const a = repo.analyses.find((x) => x.sessionId === sid && tasks.has(x.task));
    if (a) return tie(a.task, 'analysis', 'analyzed');
  }
  const earlier = repo.runs.find((r) => tasks.has(r.task) && ((!!r.bgId && s.id === r.bgId) || (!!r.sessionId && sid === r.sessionId)) && !currentRun(r, tasks.get(r.task)!.run));
  return earlier ? tie(earlier.task, 'builder', 'later-run', earlier.n) : null;
}

/**
 * Whether a session is still the builder at work: it has a process, and isn't idle at the end of its
 * turn. A background session keeps its last state once its process has gone, such as "blocked" after
 * an API error (GH-41), so the process is what counts. A conversation open in a terminal or a Claude
 * Code tab, or resumed with claude -p, is someone carrying it on.
 */
export function sessionActive(s: ClaudeSession): boolean {
  if (!s.pid) return false;
  if (s.kind !== 'background') return true;
  if (s.state === 'done' || s.state === 'failed' || s.state === 'stopped') return false;
  return s.status !== 'idle';
}

/** How long after a dispatch or a resume a builder can't yet count as stopped: its session may not be listed. */
export const STOPPED_GRACE_MS = 2 * 60_000;

/** When the task's builder last started: its dispatch, or its latest resume. */
export function runStartedAt(task: Pick<Task, 'run'>): string | null {
  const times = [task.run?.startedAt, ...(task.run?.resumes ?? []).map((r) => r.at)].filter((t): t is string => !!t);
  return times.sort().at(-1) ?? null;
}

/**
 * Whether a running task's builder stopped without acc done or acc block (D-067): its session ended, went
 * idle, or is gone from `claude agents`, two minutes or more after it started. Never when `claude agents`
 * didn't answer (null), or while a resume of it runs. Pure, so the Command Center, autopilot and acc show
 * agree, as closedPr is shared.
 */
export function builderStopped(task: Pick<Task, 'id' | 'state' | 'run'>, sessions: ClaudeSession[] | null, o: { resuming: boolean; now: Date; graceMs?: number }): boolean {
  if (task.state !== 'running' || !sessions || o.resuming) return false;
  const started = runStartedAt(task);
  if (!started || o.now.getTime() - Date.parse(started) < (o.graceMs ?? STOPPED_GRACE_MS)) return false;
  return !sessionsOf(task, sessions).some(sessionActive);
}

/** The pull request of a task in review that someone closed without merging: it waits for a person, who lands it again or not (D-063). */
export const closedPr = (task: Task): PullRequest | null => (task.state === 'review' && task.pr?.state === 'closed' ? task.pr : null);

/** Who autopilot is, in the ledger's history and events. */
export const AUTOPILOT_BY = 'orchestrator:autopilot';

/**
 * Autopilot's own move to rework: a pull request whose checks failed on GitHub (D-076), or one the merge
 * queue sent back (GH-73). A review's, even one made for autopilot, isn't.
 */
export const sentBackByAutopilot = (h: Pick<HistoryEntry, 'by'> & { from: string | null; to: string }): boolean => h.from === 'review' && h.to === 'rework' && h.by === AUTOPILOT_BY;

/** What sent a task to rework: autopilot for its failing checks or from the merge queue, or a review or a person. */
export type ReworkCause = 'checks' | 'queue' | 'review';

/**
 * Why the task is in rework now, from the move that put it there, or null when it never was. Autopilot's
 * own send-back says which it was in what it kept of it; one from before the queue is for checks.
 */
export function reworkCause(task: { history: (Pick<HistoryEntry, 'by'> & { from: string | null; to: string })[]; autopilot?: { sentBack?: Pick<SentBack, 'kind'> | null } | null }): ReworkCause | null {
  const h = task.history.findLast((x) => x.to === 'rework');
  if (!h) return null;
  return sentBackByAutopilot(h) ? task.autopilot?.sentBack?.kind ?? 'checks' : 'review';
}

/**
 * How many times autopilot may send a task back to its builder over its life, for its checks on GitHub
 * (D-076) and from the merge queue together (GH-73), apart from D-055's one re-dispatch of a review's rework.
 */
export const SEND_BACKS = 3;

/** How many times autopilot sent the task back to its builder, for either. */
export const sendBacks = (task: { history: (Pick<HistoryEntry, 'by'> & { from: string | null; to: string })[] }): number => task.history.filter(sentBackByAutopilot).length;

/** Whether autopilot already sent this commit back to its builder, for its checks on GitHub or from the merge queue (D-076, GH-73). */
export const sentBackAt = (task: Pick<Task, 'autopilot'>, sha: string | null | undefined): boolean => !!sha && task.autopilot?.sentBack?.sha === sha;

/** What reading the merge queue needs of the config: whether auto-merge still covers a task (GH-73). */
export type QueueCover = Pick<Config, 'profile' | 'autonomy' | 'environments' | 'autopilot'>;

/**
 * A task in review in its repo's merge queue (GH-73). Moved, merged or written down as needing you, it has
 * left. Where auto-merge no longer covers it, switched off or under another autonomy, it's out whatever
 * autopilot last wrote: no autopilot may run to clear it.
 */
export const inQueue = (task: Pick<Task, 'state' | 'autopilot' | 'environment'>, config: QueueCover): boolean =>
  task.state === 'review' && !!task.autopilot?.queued && autoMergeFor(config, task.environment);

/**
 * What the UI shows: stored states plus "ready" and "needs you", which are derived (DESIGN.md section 5).
 * With the repo's config, a pull request in the merge queue that conflicts doesn't need you (GH-73).
 */
export function displayState(ledger: Ledger, task: Task, session?: SessionInfo, config?: QueueCover): DisplayState {
  // A held task whose start on its own failed waits on you (D-093).
  if (task.state === 'todo' && task.held?.failed) return 'needs-you';
  if (task.state === 'todo' && isReady(ledger, task)) return 'ready';
  // A step autopilot couldn't take waits on you, or on a new commit (D-055).
  if (autopilotFailure(task)) return 'needs-you';
  // Its builder stopped before acc done or acc block (D-067), or waits in its own prompt.
  if (task.state === 'running' && (session?.stopped || session?.state === 'blocked' || session?.status === 'waiting')) return 'needs-you';
  // An open pull request whose checks fail, that a person asked to change, or that conflicts with its
  // base, waits on you (D-033, D-049). Checks that fail on a commit autopilot already sent back don't:
  // its fix is on the way, and a second failure there is recorded as autopilot's (D-076). Nor does a
  // conflict in the merge queue, which merges its base in at its turn, while auto-merge covers it (GH-73).
  if (task.state === 'review' && task.pr?.state === 'open' && ((task.pr.ci === 'failing' && !sentBackAt(task, task.pr.sha)) || task.pr.changesRequested || (!!task.pr.conflicts?.length && !(config && inQueue(task, config))))) return 'needs-you';
  // So does a closed one a person moved back to review: autopilot won't replace it (D-063).
  if (closedPr(task)) return 'needs-you';
  return task.state;
}

export const DISPLAY: Record<DisplayState, { label: string; icon: string; glyph: string; tone: 'neutral' | 'blue' | 'orange' }> = {
  todo: { label: 'To do', icon: 'circle-outline', glyph: '○', tone: 'neutral' },
  ready: { label: 'Ready', icon: 'play-circle', glyph: '▷', tone: 'blue' },
  running: { label: 'Running', icon: 'sync', glyph: '↻', tone: 'blue' },
  'needs-you': { label: 'Needs you', icon: 'bell', glyph: '!', tone: 'orange' },
  review: { label: 'In review', icon: 'eye', glyph: '◎', tone: 'blue' },
  rework: { label: 'Rework', icon: 'debug-restart', glyph: '↺', tone: 'orange' },
  blocked: { label: 'Blocked', icon: 'circle-slash', glyph: '⊘', tone: 'orange' },
  done: { label: 'Done', icon: 'check', glyph: '✓', tone: 'neutral' },
};
