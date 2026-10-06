import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, environmentByBranch } from './config.ts';
import { AccError, type RunResult, type Runner } from './exec.ts';
import { type Actor, applyMove, checkMove, mutate, noGateHooks, readLedger, type Task } from './ledger.ts';
import { alive } from './lock.ts';
import type { RepoPaths } from './paths.ts';
import { receiptHooks, receiptsAt } from './receipts.ts';
import { agentArgs } from './agents.ts';
import { type AwakeDeps, holdAwake } from './awake.ts';

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

/** The task's newest verdict on any commit: what its next run has to fix. */
export function latestVerdict(paths: RepoPaths, task: string): Verdict | null {
  if (!existsSync(paths.reviews)) return null;
  const mine = readdirSync(paths.reviews).filter((n) => n.startsWith(`${task}-`) && n.endsWith('.json'));
  const all = mine.map((n) => readVerdict(paths, task, n.slice(task.length + 1, -5))).filter((v): v is Verdict => !!v && v.task === task);
  return all.sort((a, b) => b.at.localeCompare(a.at))[0] ?? null;
}

export interface Reviewing {
  sessionId: string;
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

/** Extra things to look for, by profile (D-003): the core stays project-agnostic. */
const FOCUS: Record<string, string[]> = {
  salesforce: [
    'Apex is bulk-safe: no SOQL or DML inside loops, and triggers handle 200 records.',
    'Apex respects sharing and object and field access where the data calls for it.',
    'Apex tests assert outcomes, cover the changed paths, and don\'t depend on org data they don\'t create.',
    'Metadata carries no values that belong to one org: user names, record ids, org URLs.',
  ],
};

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
  rules: string | null;
}

/** The reviewer's standing instructions, and what it's given to review. */
export function reviewPrompt(i: ReviewInput): { system: string; prompt: string } {
  const focus = FOCUS[i.config.profile] ?? [];
  const system = [
    `You are the reviewer for ${i.task.id}. A builder agent made this change; you judge it before a person sees the pull request.`,
    'You can read files in this worktree with Read, Grep and Glob. You can\'t change anything, run commands, or ask questions.',
    'Judge it as a careful senior engineer would:',
    '- Does it do what the task asks? Go through each acceptance criterion in the task, and say whether it is met, with the file and line that meets it.',
    '- Does it follow the project\'s rules, if there are any?',
    '- Did it change anything the task didn\'t ask for?',
    '- Do the tests actually exercise the change?',
    ...(focus.length ? ['- For this kind of project, also check:', ...focus.map((f) => `  - ${f}`)] : []),
    'Skip formatting and style: the checks cover those. A check that a person waived is settled; don\'t reopen it.',
    'Give "changes" only for problems that must be fixed before this merges, each as a finding with must: true. Lesser points are findings with must: false, and they don\'t block.',
    'Be specific: the file, the line, what is wrong, and what to do instead.',
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
    '## The checks on this commit',
    '',
    ...(i.checks.length ? i.checks : ['- none recorded']),
    '',
    ...(i.rules?.trim() ? ['## The project\'s rules', '', i.rules.trim(), ''] : []),
    '## What changed',
    '',
    '```',
    i.stat.trim() || '(no files changed)',
    '```',
    '',
    i.diff.length > DIFF_MAX
      ? 'The diff is too long to include here. Read the changed files listed above.'
      : ['```diff', i.diff.trim(), '```'].join('\n'),
  ].join('\n');
  return { system, prompt };
}

/** The verdict from Claude Code's JSON result. Anything else is an error that says what came back. */
export function parseReview(stdout: string): { verdict: Pick<Verdict, 'verdict' | 'summary' | 'client' | 'criteria' | 'findings'>; sessionId: string | null; costUsd: number | null } {
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
  const criteria = (Array.isArray(s.criteria) ? s.criteria : []).filter((c: any) => typeof c?.text === 'string').map((c: any) => ({ text: c.text, met: c.met === true, evidence: String(c.evidence ?? '') }));
  const findings = (Array.isArray(s.findings) ? s.findings : []).filter((f: any) => typeof f?.message === 'string').map((f: any): Finding => ({
    message: f.message, must: f.must === true,
    ...(typeof f.file === 'string' && f.file ? { file: f.file } : {}),
    ...(Number.isInteger(f.line) ? { line: f.line } : {}),
    ...(typeof f.rule === 'string' && f.rule ? { rule: f.rule } : {}),
  }));
  // A pass with something that must be fixed isn't a pass.
  const verdict = s.verdict === 'pass' && findings.some((f: Finding) => f.must) ? 'changes' : s.verdict;
  const client = typeof s.client === 'string' && s.client.trim() ? { client: s.client.trim() } : {};
  return { verdict: { verdict, summary: s.summary, ...client, criteria, findings }, sessionId: typeof r.session_id === 'string' ? r.session_id : null, costUsd: typeof r.total_cost_usd === 'number' ? r.total_cost_usd : null };
}

export interface ReviewDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  /** For tests: makes the session id. */
  uuid?: () => string;
  /** Told the session id as the review starts, so it can be watched. */
  onStart?: (sessionId: string, sha: string) => void;
  /** For tests: how the Mac is kept awake while the reviewer runs (D-067). */
  awake?: AwakeDeps;
}

export interface ReviewResult {
  verdict: Verdict;
  /** rework when it asked for changes; null when it passed and the task stays in review. */
  moved: 'rework' | null;
}

const git = (run: Runner, cwd: string, ...args: string[]): RunResult => run('git', args, { cwd });

/** The ref a task's branch is compared with: the environment branch on GitHub, else the local one. */
function baseRef(run: Runner, root: string, branch: string): string {
  return git(run, root, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`).code === 0 ? `origin/${branch}` : branch;
}

export function review(paths: RepoPaths, config: Config, id: string, deps: ReviewDeps, opts: { actor?: Actor; by?: string } = {}): ReviewResult {
  const { run, now } = deps;
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
  const diff = git(run, paths.root, 'diff', '--no-color', '--find-renames', `${base}...${sha}`).stdout;
  const stat = git(run, paths.root, 'diff', '--stat=120', '--find-renames', `${base}...${sha}`).stdout;
  const receipts = receiptsAt(paths, sha);
  const checks = Object.values(receipts).map((r) => `- ${r.gate}: ${r.waived ? `waived (it was ${r.waived.was ?? 'not run'}), because ${r.waived.reason}` : `${r.status}. ${r.summary}`}`);
  const packetFile = join(paths.packets, `${id}.md`);
  const packet = existsSync(packetFile) ? readFileSync(packetFile, 'utf8') : `# ${task.id}: ${task.title}\n\n${task.brief}`;
  const rulesFile = join(worktree, '.acc', 'rules.md');
  const rules = existsSync(rulesFile) ? readFileSync(rulesFile, 'utf8') : null;
  const { system, prompt } = reviewPrompt({ task, config, envName: env.name, envBranch: env.branch, sha, packet, diff, stat, checks, rules });

  const sessionId = (deps.uuid ?? randomUUID)();
  mkdirSync(paths.reviews, { recursive: true });
  const marker = runningPath(paths, id);
  const startedAt = now();
  writeFileSync(marker, JSON.stringify({ sessionId, sha, startedAt: startedAt.toISOString(), pid: process.pid } satisfies Reviewing));
  deps.onStart?.(sessionId, sha);
  // The reviewer is a child of this acc, so the Mac stays awake while acc lives (D-067).
  const awake = holdAwake(process.pid, deps.awake);
  let out: RunResult;
  try {
    // Read-only by construction: only the read tools are allowed, and dontAsk refuses everything else.
    out = run('claude', [
      '-p', '--session-id', sessionId, '--permission-mode', 'dontAsk', ...agentArgs(config.agents.reviewer),
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
    v: 1, task: id, sha, env: env.branch, ...parsed.verdict, sessionId: parsed.sessionId ?? sessionId,
    at: finished.toISOString(), durationMs: finished.getTime() - startedAt.getTime(), costUsd: parsed.costUsd,
  };
  const file = reviewPath(paths, id, sha);
  writeFileSync(`${file}.tmp`, JSON.stringify(verdict, null, 2) + '\n');
  renameSync(`${file}.tmp`, file);

  const actor = opts.actor ?? 'reviewer';
  const by = opts.by ?? `reviewer:${id}`;
  const moved = mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === id)!;
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
    emit({ type: 'task.updated', task: id, actor, by, data: { reviewed: { sha, verdict: verdict.verdict } } });
    return null;
  });
  return { verdict, moved };
}
