import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, type Environment, environmentByBranch } from './config.ts';
import { AccError, type RunResult, type Runner } from './exec.ts';
import { type Actor, applyMove, checkMove, mutate, noGateHooks, noteMarkdown, readLedger, type Task } from './ledger.ts';
import { alive } from './lock.ts';
import type { RepoPaths } from './paths.ts';
import { type Receipt, receiptHooks, receiptsAt } from './receipts.ts';
import { agentArgs } from './agents.ts';
import { type AwakeDeps, holdAwake } from './awake.ts';
import { sessionName } from './names.ts';
import { notesSection } from './packet.ts';
import { rulesText } from './rules.ts';
import { testsText } from './test-counts.ts';
import { clip } from './text.ts';

/**
 * The review (D-032): a fresh agent reads the task, the diff, the checks and the project's rules, and
 * gives a verdict on one commit. It can read files and change nothing. Its verdict is kept beside the
 * receipts, and `acc land` needs a passing one on the commit it lands.
 */

export interface Criterion {
  text: string;
  met: boolean;
  evidence: string;
}

export interface Finding {
  message: string;
  /** true: it has to be fixed before the change merges. false: worth a look, but not blocking. */
  must: boolean;
  file?: string;
  line?: number;
  rule?: string;
  /**
   * A short name for the kind of problem, such as "UI change not screenshotted", reused across reviews so
   * the same finding is seen coming back (GH-102). Older verdicts have none.
   */
  kind?: string;
}

export interface Verdict {
  v: 1;
  task: string;
  sha: string;
  env: string;
  verdict: 'pass' | 'changes';
  summary: string;
  /** One plain sentence for the client: what changes for them. Older verdicts have none (D-066). */
  client?: string;
  criteria: Criterion[];
  findings: Finding[];
  /** The reviewer's Claude Code session, so its reasoning can be read afterwards. */
  sessionId: string;
  /** What the reviewer was called (D-087). Older verdicts have none. */
  name?: string;
  at: string;
  durationMs: number;
  /** Claude Code's estimate of the tokens at API prices. On a subscription it's usage, not a charge. */
  costUsd: number | null;
}

/** What the reviewer must answer with: Claude Code checks it against this (`--json-schema`). */
export const VERDICT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'client', 'criteria', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['pass', 'changes'], description: 'changes only when something must be fixed before this merges' },
    summary: { type: 'string', description: 'Two or three plain sentences for the pull request: what the change does and how well' },
    client: { type: 'string', description: 'One plain sentence for the client: what changes for them, with no code, file, tool or agent names' },
    criteria: {
      type: 'array',
      description: 'Each acceptance criterion in the task, in its own words',
      items: { type: 'object', additionalProperties: false, required: ['text', 'met', 'evidence'], properties: { text: { type: 'string' }, met: { type: 'boolean' }, evidence: { type: 'string', description: 'Where it is met (file:line), or what is missing' } } },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['message', 'must'],
        properties: {
          message: { type: 'string', description: 'What is wrong, and what to do instead' },
          must: { type: 'boolean', description: 'true if it has to be fixed before merging' },
          file: { type: 'string' }, line: { type: 'integer' }, rule: { type: 'string', description: 'The project rule it breaks, if any' },
          kind: { type: 'string', description: 'A short name for the kind of problem, a few words: reuse one of the kinds you are given when it fits' },
        },
      },
    },
  },
} as const;

const DIFF_MAX = 150_000;

export const reviewPath = (paths: RepoPaths, task: string, sha: string): string => join(paths.reviews, `${task}-${sha}.json`);
const runningPath = (paths: RepoPaths, task: string): string => join(paths.reviews, `${task}.running.json`);

export function readVerdict(paths: RepoPaths, task: string, sha: string): Verdict | null {
  try {
    return JSON.parse(readFileSync(reviewPath(paths, task, sha), 'utf8')) as Verdict;
  } catch {
    return null;
  }
}

/**
 * The review a merge commit carries (GH-73): the merge queue merged the task's base into a commit whose
 * review passed, cleanly or by keeping both sides' additions to an append-only file, and checked it in
 * full. Its verdict is that commit's, kept as it was: no reviewer read the merge. Null for any other commit.
 */
export function carriedVerdict(paths: RepoPaths, task: Pick<Task, 'id' | 'autopilot'>, sha: string): Verdict | null {
  const c = task.autopilot?.carried;
  if (!c || !sha || c.to !== sha) return null;
  const v = readVerdict(paths, task.id, c.from);
  return v?.verdict === 'pass' ? v : null;
}

/**
 * The passing review that covers a commit: its own, or the one its merge commit carries (GH-73). Land and
 * the merge accept nothing else, so nothing is pushed or merged without one (D-033). Null when neither passed.
 */
export function reviewedAt(paths: RepoPaths, task: Pick<Task, 'id' | 'autopilot'>, sha: string): Verdict | null {
  const own = readVerdict(paths, task.id, sha);
  if (own) return own.verdict === 'pass' ? own : null;
  return carriedVerdict(paths, task, sha);
}

/**
 * Whether a verdict is current on a branch's latest commit: made there, or carried there by the merge
 * queue's merge commit (GH-73), as land and the merge read it. The Command Center asks, so a task in the
 * queue doesn't show its review as out of date once the queue pushed its merge.
 */
export function reviewCurrent(paths: RepoPaths, task: Pick<Task, 'id' | 'autopilot'>, verdict: Pick<Verdict, 'sha'>, head: string): boolean {
  if (!head) return false;
  return verdict.sha === head || carriedVerdict(paths, task, head)?.sha === verdict.sha;
}

/**
 * Every verdict in the clone, or only a task's, oldest first. A review under way (`<task>.running.json`)
 * and a file that can't be read are skipped, wherever the folder is listed (GH-102).
 */
export function readVerdicts(paths: Pick<RepoPaths, 'reviews'>, task?: string): Verdict[] {
  let names: string[];
  try {
    names = readdirSync(paths.reviews);
  } catch {
    return [];
  }
  const all: Verdict[] = [];
  for (const n of names) {
    if (!n.endsWith('.json') || n.endsWith('.running.json') || (task && !n.startsWith(`${task}-`))) continue;
    try {
      const v = JSON.parse(readFileSync(join(paths.reviews, n), 'utf8')) as Verdict;
      if (typeof v?.task !== 'string' || typeof v.sha !== 'string' || typeof v.at !== 'string' || !Array.isArray(v.findings)) continue;
      if (`${v.task}-${v.sha}.json` === n && (!task || v.task === task)) all.push(v);
    } catch {
      // mid-write or unreadable: it's read next time
    }
  }
  return all.sort((a, b) => a.at.localeCompare(b.at) || a.task.localeCompare(b.task) || a.sha.localeCompare(b.sha));
}

/** The task's newest verdict on any commit: what its next run has to fix. */
export function latestVerdict(paths: RepoPaths, task: string): Verdict | null {
  return readVerdicts(paths, task).at(-1) ?? null;
}

/** The most kinds of finding the reviewer is shown to reuse. */
const KINDS_MAX = 30;

/** The kinds of finding earlier reviews named, most used first, for the reviewer to reuse (GH-102). */
export function knownKinds(paths: Pick<RepoPaths, 'reviews'>): string[] {
  const n = new Map<string, number>();
  for (const v of readVerdicts(paths)) for (const f of v.findings) if (typeof f.kind === 'string' && f.kind.trim()) n.set(f.kind.trim(), (n.get(f.kind.trim()) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, KINDS_MAX).map(([k]) => k);
}

export interface Reviewing {
  sessionId: string;
  /** What the reviewer is called (D-087). A review started before names has none. */
  name?: string;
  sha: string;
  startedAt: string;
  pid: number;
}

/** A review under way for the task, so its session can be watched. Null once its process has gone. */
export function reviewing(paths: RepoPaths, task: string): Reviewing | null {
  try {
    const r = JSON.parse(readFileSync(runningPath(paths, task), 'utf8')) as Reviewing;
    return alive(r.pid) ? r : null;
  } catch {
    return null;
  }
}

export interface ReviewInput {
  task: Task;
  config: Config;
  envName: string;
  envBranch: string;
  sha: string;
  /** The builder's instructions, which hold the acceptance criteria. */
  packet: string;
  diff: string;
  stat: string;
  checks: string[];
  /** rulesText's: every project's rules (GH-104), the profile's, then rules copied in, then the repo's own (GH-108). */
  rules: string | null;
  /** The kinds of finding earlier reviews named, to reuse (GH-102). */
  kinds?: string[];
  /** A reviewer in a cloud session (T-86) reads the diff itself, from the base commit to the head: the prompt says how, and carries none. */
  cloud?: { base: string };
}

/**
 * A check as the reviewer reads it: its result, and what its tests ran, with what that was compared with
 * and any newly skipped (GH-100).
 */
export function checkLine(r: Receipt): string {
  const result = r.waived ? `waived (it was ${r.waived.was ?? 'not run'}), because ${r.waived.reason}` : `${r.status}. ${r.summary}`;
  const tests = testsText(r);
  return `- ${r.gate}: ${result}${tests ? ` Tests: ${tests}.` : ''}${r.countsNote ? ` ${r.countsNote}` : ''}`;
}

/**
 * What the reviewer looks for in every profile (GH-104): a new helper that repeats one the code already has.
 * With nobody looking, one helper gathers dozens of local copies. A finding holds one place, so the
 * message names the other.
 */
export const DUPLICATE_HELPER = 'Does it add a helper that does what an existing one already does? Search for one (Grep for its name and for what it does), and name both in the finding\'s message, each as file:line. When the existing one is exported, the finding must be fixed (must: true): use it instead. A near-copy of a local, unexported one is must: false.';

/** The fields a person edited since the task's builder started (T-74): the packet holds the older values. */
export function editedSince(task: Pick<Task, 'edits' | 'run'>): Set<string> {
  const since = task.run?.startedAt ?? '';
  return new Set((task.edits ?? []).filter((e) => e.at >= since).flatMap((e) => e.fields));
}

/**
 * The notes for the builder as a person edited them since its builder started (T-74). Notes from before are
 * in the packet already, so they aren't repeated; notes cleared since say so, as the packet still holds them.
 */
export function notesEditedSection(task: Pick<Task, 'notes' | 'edits' | 'run'>): string[] {
  if (!editedSince(task).has('notes')) return [];
  const notes = notesSection(task);
  return notes.length ? notes : ['## Notes for the builder', '', 'A person removed the notes for the builder after the builder started. Disregard them.', ''];
}

/**
 * A task a person edited since its builder started (T-74): its title and brief as they are now, which the
 * reviewer judges against, since the packet holds them as the builder was given them.
 */
export function editedSection(task: Pick<Task, 'title' | 'brief' | 'edits' | 'run'>): string[] {
  const fields = editedSince(task);
  if (!fields.has('title') && !fields.has('brief')) return [];
  return [
    '## The task as a person edited it since',
    '',
    'A person changed the task after the builder started. Judge the change against this text, and say where the builder followed the older text.',
    '',
    `### ${task.title}`,
    '',
    task.brief.trim() || '_No details beyond the title._',
    '',
  ];
}

/** The reviewer's standing instructions, and what it's given to review. */
export function reviewPrompt(i: ReviewInput): { system: string; prompt: string } {
  const system = [
    `You are the reviewer for ${i.task.id}. A builder agent made this change; you judge it before a person sees the pull request.`,
    'You can read files in this worktree with Read, Grep and Glob. You can\'t change anything, run commands, or ask questions.',
    'Judge it as a careful senior engineer would:',
    '- Does it do what the task asks? Go through each acceptance criterion in the task, and say whether it is met, with the file and line that meets it.',
    '- Does it follow the rules you\'re given, if there are any? Where two disagree, the later one wins: this repo\'s own rules over the others.',
    '- Did it change anything the task didn\'t ask for?',
    '- Do the tests actually exercise the change?',
    '- Did it add a skip, only or todo to a test (it.skip, xit, describe.skip, test.only, fit, it.todo, { skip: true }, t.skip(), t.todo())? Each is a finding with must: true, unless the task asks for it: a skipped test passes having checked nothing.',
    `- ${DUPLICATE_HELPER}`,
    'The builder\'s note is its own account of what landed, which numbers moved and what\'s still open. Check it against the diff rather than trust it, and say where it\'s wrong.',
    'Skip formatting and style: the checks cover those. A check that a person waived is settled; don\'t reopen it.',
    'Give "changes" only for problems that must be fixed before this merges, each as a finding with must: true. Lesser points are findings with must: false, and they don\'t block.',
    'Be specific: the file, the line, what is wrong, and what to do instead.',
    'Give each finding a kind: a few words naming the kind of problem. Reuse one of the kinds you are given when it fits, so a finding that keeps coming back is seen.',
  ].join('\n');
  const prompt = [
    `# Review ${i.task.id}: ${i.task.title}`,
    '',
    `Commit ${i.sha.slice(0, 7)} on the task's branch, against ${i.envName} (\`${i.envBranch}\`).`,
    '',
    '## The task, as the builder was given it',
    '',
    i.packet.trim(),
    '',
    ...editedSection(i.task),
    ...notesEditedSection(i.task),
    '## The checks on this commit',
    '',
    ...(i.checks.length ? i.checks : ['- none recorded']),
    '',
    // What the builder said as it finished or blocked (D-106): its claim, for the reviewer to check.
    '## The builder\'s note',
    '',
    ...(i.task.run?.note
      ? [`What the builder said ${i.task.run.note.ended === 'blocked' ? 'when it blocked' : 'as it finished'}, in its own words. Check it against the diff.`, '', ...noteMarkdown(i.task.run.note)]
      : ['The builder left no note.']),
    '',
    ...(i.rules?.trim() ? ['## Rules', '', i.rules.trim(), ''] : []),
    ...(i.kinds?.length ? ['## Kinds of finding earlier reviews named', '', ...i.kinds.map((k) => `- ${k}`), ''] : []),
    '## What changed',
    '',
    // A cloud reviewer has the branch in its clone and no acc to hand it the diff (T-86): it reads the diff itself.
    ...(i.cloud ? [
      `The base commit is ${i.cloud.base} and the commit under review is ${i.sha}, both in your clone once you have fetched the branch. Read what changed with:`,
      '',
      '```',
      `git diff --stat=120 --find-renames ${i.cloud.base} ${i.sha}`,
      `git diff --no-color --find-renames ${i.cloud.base} ${i.sha}`,
      '```',
    ] : [
      '```',
      i.stat.trim() || '(no files changed)',
      '```',
      '',
      i.diff.length > DIFF_MAX
        ? 'The diff is too long to include here. Read the changed files listed above.'
        : ['```diff', i.diff.trim(), '```'].join('\n'),
    ]),
  ].join('\n');
  return { system, prompt };
}

/** What a reviewer answered, as the verdict keeps it. */
export type Answered = Pick<Verdict, 'verdict' | 'summary' | 'client' | 'criteria' | 'findings'>;

/**
 * The most each part of a verdict may hold (T-86): a cloud reviewer's review.json is anyone's file, and
 * the summary goes whole into the task's history and the rework's reason. Longer text is cut to the
 * limit, with an ellipsis; longer lists keep their first entries.
 */
export const VERDICT_LIMITS = { summary: 2000, client: 2000, message: 2000, file: 400, rule: 200, kind: 80, text: 1000, evidence: 1000, criteria: 50, findings: 100 } as const;

/**
 * A reviewer's answer checked against VERDICT_SCHEMA's shape, as Claude Code checks the local reviewer's
 * and as acc checks a cloud reviewer's review.json (T-86): a verdict of pass or changes and a summary, or
 * it's refused with why; the lists keep what has the right shape, and each text and list is cut to
 * VERDICT_LIMITS. A pass with something that must be fixed isn't a pass.
 */
export function checkVerdict(s: unknown): Answered {
  const a = s as Record<string, any> | null;
  if (!a || typeof a !== 'object' || Array.isArray(a)) throw new AccError('review', 'The verdict isn\'t an object.');
  if (a.verdict !== 'pass' && a.verdict !== 'changes') throw new AccError('review', `The verdict's "verdict" is ${JSON.stringify(a.verdict) ?? 'missing'}, not "pass" or "changes".`);
  if (typeof a.summary !== 'string' || !a.summary.trim()) throw new AccError('review', 'The verdict has no "summary".');
  if (a.criteria !== undefined && !Array.isArray(a.criteria)) throw new AccError('review', 'The verdict\'s "criteria" isn\'t a list.');
  if (a.findings !== undefined && !Array.isArray(a.findings)) throw new AccError('review', 'The verdict\'s "findings" isn\'t a list.');
  const L = VERDICT_LIMITS;
  const criteria = (Array.isArray(a.criteria) ? a.criteria : []).filter((c: any) => typeof c?.text === 'string').slice(0, L.criteria)
    .map((c: any) => ({ text: clip(c.text, L.text), met: c.met === true, evidence: clip(String(c.evidence ?? ''), L.evidence) }));
  const findings = (Array.isArray(a.findings) ? a.findings : []).filter((f: any) => typeof f?.message === 'string').slice(0, L.findings).map((f: any): Finding => ({
    message: clip(f.message, L.message), must: f.must === true,
    ...(typeof f.file === 'string' && f.file ? { file: clip(f.file, L.file) } : {}),
    ...(Number.isInteger(f.line) ? { line: f.line } : {}),
    ...(typeof f.rule === 'string' && f.rule ? { rule: clip(f.rule, L.rule) } : {}),
    ...(typeof f.kind === 'string' && f.kind.trim() ? { kind: clip(f.kind.trim(), L.kind) } : {}),
  }));
  const verdict = a.verdict === 'pass' && findings.some((f: Finding) => f.must) ? 'changes' : a.verdict;
  const client = typeof a.client === 'string' && a.client.trim() ? { client: clip(a.client.trim(), L.client) } : {};
  return { verdict, summary: clip(a.summary, L.summary), ...client, criteria, findings };
}

/** The verdict from Claude Code's JSON result. Anything else is an error that says what came back. */
export function parseReview(stdout: string): { verdict: Answered; sessionId: string | null; costUsd: number | null } {
  let r: Record<string, any>;
  try {
    r = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop() ?? '');
  } catch {
    throw new AccError('review', `The reviewer gave no result Claude Code could read: ${stdout.trim().slice(0, 200) || '(nothing)'}`);
  }
  const s = r.structured_output;
  if (r.is_error || !s || (s.verdict !== 'pass' && s.verdict !== 'changes') || typeof s.summary !== 'string') {
    throw new AccError('review', `The review didn't finish with a verdict (${r.subtype ?? 'no result'}): ${String(r.result ?? '').slice(0, 300)}`);
  }
  return { verdict: checkVerdict(s), sessionId: typeof r.session_id === 'string' ? r.session_id : null, costUsd: typeof r.total_cost_usd === 'number' ? r.total_cost_usd : null };
}

export interface ReviewDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  /** For tests: makes the session id. */
  uuid?: () => string;
  /** Told the session id and the reviewer's name as the review starts, so it can be watched. */
  onStart?: (sessionId: string, sha: string, name: string) => void;
  /** For tests: how the Mac is kept awake while the reviewer runs (D-067). */
  awake?: AwakeDeps;
}

export interface ReviewResult {
  verdict: Verdict;
  /** rework when it asked for changes; null when it passed and the task stays in review. */
  moved: 'rework' | null;
}

const git = (run: Runner, cwd: string, ...args: string[]): RunResult => run('git', args, { cwd });

/** The ref a branch is compared with: the environment branch on GitHub, else the local one. A verification's too (T-84). */
export function baseRef(run: Runner, root: string, branch: string): string {
  return git(run, root, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`).code === 0 ? `origin/${branch}` : branch;
}

/** What a review reads before it starts (T-86): the task, its commit, and the reviewer's prompt, shared by a local review and a cloud one. */
export interface ReviewPrepared {
  task: Task;
  env: Environment;
  branch: string;
  worktree: string;
  sha: string;
  /** The ref the branch is compared with: the environment branch on GitHub, else the local one. */
  base: string;
  packet: string;
  rules: string | null;
  checks: string[];
  kinds: string[];
  name: string;
}

/**
 * Reads what a review needs, refusing what review() always refused: a task not in review, a missing
 * environment, branch or worktree, a branch not in this clone, and checks not settled on its commit.
 */
export function prepareReview(paths: RepoPaths, config: Config, id: string, run: Runner): ReviewPrepared {
  const ledger = readLedger(paths.ledger);
  const task = ledger.tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  if (task.state !== 'review') throw new AccError('refused', `${id} is ${task.state}. A review is for work that's in review: acc done, or a person, moves it there.`);
  const env = environmentByBranch(config, task.environment);
  if (!env) throw new AccError('review', `${id}'s environment "${task.environment}" isn't in the config.`);
  const branch = task.run?.branch;
  const worktree = task.run?.worktree;
  if (!branch) throw new AccError('review', `${id} has no branch to review.`);
  if (!worktree || !existsSync(worktree)) throw new AccError('review', `${id}'s worktree isn't on disk any more, so there's nothing for the reviewer to read.`);
  const sha = git(run, paths.root, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).stdout.trim();
  if (!sha) throw new AccError('review', `The branch ${branch} isn't in this clone.`);
  const missing = receiptHooks(paths, config, run).missingGates(task);
  if (missing.length) throw new AccError('refused', `${id}'s checks aren't settled on ${sha.slice(0, 7)}: ${missing.join(', ')}. Run acc gate run in its worktree, or waive them, then review.`);
  const base = baseRef(run, paths.root, env.branch);
  const receipts = receiptsAt(paths, sha);
  const checks = Object.values(receipts).map(checkLine);
  const packetFile = join(paths.packets, `${id}.md`);
  const packet = existsSync(packetFile) ? readFileSync(packetFile, 'utf8') : [`# ${task.id}: ${task.title}`, '', task.brief, '', ...notesSection(task)].join('\n');
  const rules = rulesText(worktree, config.profile);
  const name = sessionName({ project: config.project, key: id, title: task.title, role: 'review' });
  return { task, env, branch, worktree, sha, base, packet, rules, checks, kinds: knownKinds(paths), name };
}

/**
 * Keeps a verdict beside the receipts and moves the task as the verdict says (T-86 shares this with a
 * cloud review): changes moves it to rework; a pass leaves it in review, ready to land, and clears what
 * autopilot couldn't do before (D-055). A task moved meanwhile is left: the verdict still stands for its
 * commit. A cloud review is over once a verdict is kept for its own commit, or for the task's head (`who.head`,
 * the branch's commit as the caller read it), whichever commit it was fired on: what it gives later is
 * stale, and nothing waits on it. A verdict for an older commit ends nothing (T-88).
 */
export function recordVerdict(paths: RepoPaths, config: Config, verdict: Verdict, now: () => Date, who: { actor: Actor; by: string; head?: string | null }): 'rework' | null {
  const file = reviewPath(paths, verdict.task, verdict.sha);
  mkdirSync(paths.reviews, { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(verdict, null, 2) + '\n');
  renameSync(`${file}.tmp`, file);
  const { actor, by } = who;
  const id = verdict.task;
  return mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === id)!;
    // A verdict for the cloud review's own commit, or for the head, ends the cloud review, even one fired on an
    // older commit (T-86): without this, a cloud session that never answers would keep the task at Needs you,
    // and a review here couldn't clear it. One for an older commit is kept and ends nothing (T-88).
    if (t.cloudReview && (verdict.sha === t.cloudReview.sha || (!!who.head && verdict.sha === who.head))) t.cloudReview = null;
    if (t.state !== 'review') return null; // someone moved it meanwhile; the verdict still stands for its commit
    if (verdict.verdict === 'changes') {
      const req = { to: 'rework' as const, actor, by, reason: `Review asked for changes: ${verdict.summary}` };
      const problems = checkMove(l, config, t, req, noGateHooks);
      if (problems.length) throw new AccError('move-refused', problems.join(' '));
      applyMove(t, req, emit, now);
      return 'rework' as const;
    }
    // Reviewed, by autopilot or by hand: whatever autopilot couldn't do before is behind it (D-055).
    if (t.autopilot?.failed) t.autopilot.failed = null;
    emit({ type: 'task.updated', task: id, actor, by, data: { reviewed: { sha: verdict.sha, verdict: verdict.verdict } } });
    return null;
  });
}

export function review(paths: RepoPaths, config: Config, id: string, deps: ReviewDeps, opts: { actor?: Actor; by?: string } = {}): ReviewResult {
  const { run, now } = deps;
  const r = prepareReview(paths, config, id, run);
  const { task, env, sha, worktree, name } = r;
  const diff = git(run, paths.root, 'diff', '--no-color', '--find-renames', `${r.base}...${sha}`).stdout;
  const stat = git(run, paths.root, 'diff', '--stat=120', '--find-renames', `${r.base}...${sha}`).stdout;
  const { system, prompt } = reviewPrompt({ task, config, envName: env.name, envBranch: env.branch, sha, packet: r.packet, diff, stat, checks: r.checks, rules: r.rules, kinds: r.kinds });

  const sessionId = (deps.uuid ?? randomUUID)();
  mkdirSync(paths.reviews, { recursive: true });
  const marker = runningPath(paths, id);
  const startedAt = now();
  writeFileSync(marker, JSON.stringify({ sessionId, name, sha, startedAt: startedAt.toISOString(), pid: process.pid } satisfies Reviewing));
  deps.onStart?.(sessionId, sha, name);
  // The reviewer is a child of this acc, so the Mac stays awake while acc lives (D-067).
  const awake = holdAwake(process.pid, deps.awake);
  let out: RunResult;
  try {
    // Read-only by construction: only the read tools are allowed, and dontAsk refuses everything else.
    out = run('claude', [
      '-p', '--session-id', sessionId, '--name', name, '--permission-mode', 'dontAsk', ...agentArgs(config.agents.reviewer),
      '--output-format', 'json', '--json-schema', JSON.stringify(VERDICT_SCHEMA), '--append-system-prompt', system,
      '--allowedTools', 'Read', 'Grep', 'Glob',
      '--disallowedTools', 'Bash', 'Edit', 'Write', 'NotebookEdit', 'WebFetch', 'WebSearch',
    ], { cwd: worktree, input: prompt, env: { ...deps.env, ACC_ROLE: 'reviewer', ACC_TASK: id }, timeoutMs: 45 * 60_000 });
  } finally {
    awake?.release();
    rmSync(marker, { force: true });
  }
  if (out.timedOut) throw new AccError('review', `The review didn't finish within 45 minutes, so acc stopped it.`);
  if (out.code === 127 && !out.stdout) throw new AccError('review', `Claude Code didn't start: ${out.stderr.trim().split('\n')[0] ?? 'claude not found'}`);
  const parsed = parseReview(out.stdout);
  const finished = now();
  const verdict: Verdict = {
    v: 1, task: id, sha, env: env.branch, ...parsed.verdict, sessionId: parsed.sessionId ?? sessionId, name,
    at: finished.toISOString(), durationMs: finished.getTime() - startedAt.getTime(), costUsd: parsed.costUsd,
  };
  // The branch's head is read again here, not taken from prepareReview: the branch can move while the reviewer runs,
  // and a cloud review fired on the new head must outlive this verdict for the older commit (T-88).
  const head = git(run, paths.root, 'rev-parse', '--verify', '--quiet', `refs/heads/${r.branch}`).stdout.trim();
  const moved = recordVerdict(paths, config, verdict, now, { actor: opts.actor ?? 'reviewer', by: opts.by ?? `reviewer:${id}`, head });
  return { verdict, moved };
}
