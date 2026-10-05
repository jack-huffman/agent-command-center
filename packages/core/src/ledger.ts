import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type Config, defaultEnvironment, environmentByBranch } from './config.ts';
import { AccError } from './exec.ts';
import { withLock } from './lock.ts';
import type { RepoPaths } from './paths.ts';

export const STATES = ['todo', 'running', 'review', 'rework', 'blocked', 'done'] as const;
export type State = (typeof STATES)[number];

export const ACTORS = ['human', 'orchestrator', 'builder', 'reviewer', 'sync'] as const;
export type Actor = (typeof ACTORS)[number];

export const SOURCE_KINDS = ['github', 'jira', 'azure', 'manual'] as const;
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

export interface Run {
  bgId?: string;
  sessionId?: string;
  worktree?: string;
  branch?: string;
  startedAt?: string;
}

export interface PullRequest {
  number: number;
  url: string;
  state: 'open' | 'merged' | 'closed';
  /** What GitHub's checks say, kept by acc sync. failing shows the task as needs you. */
  ci?: 'passing' | 'failing' | 'pending' | null;
  /** A person on GitHub asked for changes, which also shows it as needs you. */
  changesRequested?: boolean;
  /** The files it conflicts in with its base, kept by acc sync and acc land. Empty when it merges cleanly. */
  conflicts?: string[];
  syncedAt?: string;
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

function writeAtomic(file: string, text: string): void {
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

export type Requirement = 'depsDone' | 'underCap' | 'envNotProtected' | 'reason' | 'gatesPassed';

export interface Rule {
  from: State | 'any';
  to: State;
  actors: Actor[];
  requires: Requirement[];
}

/** DESIGN.md section 5. Anything not listed needs --force and a reason, and is recorded as an override. */
export const RULES: Rule[] = [
  { from: 'todo', to: 'running', actors: ['human', 'orchestrator'], requires: ['depsDone', 'underCap', 'envNotProtected'] },
  { from: 'running', to: 'review', actors: ['builder', 'human'], requires: ['gatesPassed'] },
  { from: 'review', to: 'rework', actors: ['reviewer', 'human'], requires: ['reason'] },
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
}

export interface Hooks {
  /** Required checks that have no passing receipt on the task's current commit. */
  missingGates(task: Task): string[];
}

export const noGateHooks: Hooks = { missingGates: () => [] };

export function findRule(from: State, to: State): Rule | undefined {
  return RULES.find((r) => r.from === from && r.to === to)
    ?? RULES.find((r) => r.from === 'any' && r.to === to && from !== 'blocked' && from !== 'done');
}

/** Everything that stops this move. Empty means it's allowed. */
export function checkMove(ledger: Ledger, config: Config, task: Task, req: MoveRequest, hooks: Hooks): string[] {
  if (!STATES.includes(req.to)) return [`"${req.to}" isn't a state. States: ${STATES.join(', ')}.`];
  if (!ACTORS.includes(req.actor)) return [`"${req.actor}" isn't an actor.`];
  if (task.state === req.to) return [`${task.id} is already ${req.to}.`];
  const reason = req.reason?.trim() ?? '';
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
      const running = ledger.tasks.filter((t) => t.state === 'running' && t.id !== task.id).length;
      if (running >= config.agents.max) problems.push(`${running} tasks are already running. The limit is ${config.agents.max}.`);
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
  }
  return problems;
}

/** Applies a move that checkMove allowed. */
export function applyMove(task: Task, req: MoveRequest, emit: Emit, now: () => Date): HistoryEntry {
  const at = now().toISOString();
  const entry: HistoryEntry = { at, actor: req.actor, by: req.by, from: task.state, to: req.to, reason: req.reason?.trim() || null };
  if (req.force) entry.override = true;
  task.blocker = req.to === 'blocked' ? (entry.reason ?? null) : null;
  task.state = req.to;
  task.updatedAt = at;
  task.history.push(entry);
  emit({ type: 'task.moved', task: task.id, actor: req.actor, by: req.by, data: { from: entry.from, to: entry.to, reason: entry.reason, override: req.force ?? false } });
  return entry;
}

export function moveTask(
  paths: RepoPaths, config: Config, id: string, req: MoveRequest, hooks: Hooks, now: () => Date,
): { task: Task; entry: HistoryEntry } {
  return mutate(paths, now, (ledger, emit) => {
    const task = ledger.tasks.find((t) => t.id === id);
    if (!task) throw new AccError('no-task', `No task ${id}.`);
    const problems = checkMove(ledger, config, task, req, hooks);
    if (problems.length) throw new AccError('move-refused', `Can't move ${id} to ${req.to}:\n- ${problems.join('\n- ')}`);
    const entry = applyMove(task, req, emit, now);
    return { task, entry };
  });
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

export interface SessionInfo {
  state?: string;
  status?: string;
}

/** What the UI shows: stored states plus "ready" and "needs you", which are derived (DESIGN.md section 5). */
export function displayState(ledger: Ledger, task: Task, session?: SessionInfo): DisplayState {
  if (task.state === 'todo' && isReady(ledger, task)) return 'ready';
  if (task.state === 'running' && (session?.state === 'blocked' || session?.status === 'waiting')) return 'needs-you';
  // An open pull request whose checks fail, that a person asked to change, or that conflicts with its
  // base, waits on you (D-033, D-???).
  if (task.state === 'review' && task.pr?.state === 'open' && (task.pr.ci === 'failing' || task.pr.changesRequested || !!task.pr.conflicts?.length)) return 'needs-you';
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
