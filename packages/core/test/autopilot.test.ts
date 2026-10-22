import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AUTOPILOT_BY, type AutopilotDeps, autopilotMode, autopilotPass, type AutopilotStep, holdAutopilot, reworkCause } from '../src/autopilot.ts';
import { autopilotEvent, type AutopilotLog, readAutopilotLog } from '../src/autopilot-log.ts';
import { failedChecks, nextStep, reworkedByAutopilot, taskFacts, type TaskFacts } from '../src/autopilot-rules.ts';
import { checksPath } from '../src/checks.ts';
import { type Config, parseConfig } from '../src/config.ts';
import { AccError, run, type RunOptions, type RunResult } from '../src/exec.ts';
import { waiveGates } from '../src/gates.ts';
import { type Job, jobsUnderWay } from '../src/jobs.ts';
import { land } from '../src/land.ts';
import { displayState, emptyLedger, type Ledger, type LedgerEvent, mutate, readLedger, type State, type Task, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { readVerdict, reviewPath, type Verdict } from '../src/review.ts';
import { withSlot } from '../src/semaphore.ts';
import { listUpdates } from '../src/updates.ts';
import { sync } from '../src/sync.ts';
import { transcriptDir } from '../src/transcript.ts';
import { bad, fakeAwake, fakeRunner, GENERIC_CONFIG, gh41Lines, gitIn, launchedSessions, makeRepo, ok, SLEPT, tempDir, writePlan } from './support.ts';

const now = () => new Date('2026-10-05T12:00:00Z');
const BRANCH = 'task/T-1-add-sum';
type Source = { kind: 'manual' | 'jira'; key: string; url?: string };

/**
 * A repo whose origin is a local bare repo, with its first task on its own branch (in review unless
 * asked), its checks settled, and two tasks to do: T-2 ready, T-3 waiting on it.
 */
function setup(opts: { state?: State; source?: Source; max?: number; raw?: Record<string, unknown> } = {}) {
  const RAW = {
    ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'jordan-kim' }, gates: { required: ['test'], commands: { test: 'true' } },
    // Its tasks add files at the root; stray-files has its own tests (GH-103).
    strayFiles: { required: false },
    autonomy: 'review', agents: { max: opts.max ?? 3 }, worktrees: { root: tempDir('worktrees-') }, ...opts.raw,
  };
  const origin = tempDir('origin-');
  run('git', ['init', '-q', '--bare', origin]);
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(RAW) });
  const base = gitIn(dir, 'branch', '--show-current');
  gitIn(dir, 'remote', 'add', 'origin', origin);
  gitIn(dir, 'push', '-q', 'origin', base);
  const config = parseConfig(RAW).config as Config;
  const paths = repoPaths(dir, run);
  /** A new commit on the task's branch, its checks settled, as acc done needs. */
  const commit = (file: string, text: string): string => {
    const exists = run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${BRANCH}`], { cwd: dir }).code === 0;
    gitIn(dir, 'checkout', '-q', ...(exists ? [BRANCH] : ['-b', BRANCH]));
    writeFileSync(join(dir, file), text);
    gitIn(dir, 'add', '-A');
    gitIn(dir, 'commit', '-q', '-m', `T-1: ${file}`);
    gitIn(dir, 'checkout', '-q', base);
    const sha = gitIn(dir, 'rev-parse', BRANCH);
    waiveGates(paths, config, { sha, env: config.environments[0]!, gates: ['test'], reason: 'covered by the test suite', by: 'human:test', now });
    return sha;
  };
  const sha = commit('sum.js', 'export const sum = (a, b) => a + b;\n');
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [
      { source: opts.source ?? { kind: 'manual', key: 'T-1' }, title: 'Add a sum function', brief: 'sum(a, b)' },
      { source: { kind: 'manual', key: 'T-2' }, title: 'Ready to start' },
      { source: { kind: 'manual', key: 'T-3' }, title: 'Waits on T-2', deps: ['T-2'] },
    ], 'human', 'human:test', emit, now);
    const t = l.tasks[0]!;
    t.state = opts.state ?? 'review';
    t.run = { branch: BRANCH, worktree: dir };
    t.history.push({ at: now().toISOString(), actor: 'builder', by: 'builder:T-1', from: 'running', to: 'review', reason: null });
  });
  return { dir, origin, config, paths, sha, base, commit, id: readLedger(paths.ledger).tasks[0]!.id };
}

const verdictOut = (verdict: 'pass' | 'changes'): RunResult => ({
  code: 0, stderr: '', stdout: JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, session_id: 'sess-review', total_cost_usd: 0.1,
    structured_output: { verdict, summary: verdict === 'pass' ? 'Adds sum with a test.' : 'sum has no test.', criteria: [], findings: verdict === 'pass' ? [] : [{ message: 'Add a test for sum.', must: true }] },
  }),
});

function passReview(paths: ReturnType<typeof repoPaths>, id: string, sha: string): void {
  const v: Verdict = { v: 1, task: id, sha, env: 'main', verdict: 'pass', summary: 'Adds sum.', criteria: [], findings: [], sessionId: 's', at: now().toISOString(), durationMs: 1, costUsd: null };
  mkdirSync(paths.reviews, { recursive: true });
  writeFileSync(reviewPath(paths, id, sha), JSON.stringify(v));
}

/** Stand-ins for gh and claude, recording every call, git included. Git really runs. */
function deps(calls: string[], over: Record<string, RunResult | ((o?: RunOptions) => RunResult)> = {}): AutopilotDeps {
  return {
    run: fakeRunner({
      'gh auth token -u jordan-kim': ok('gho_token\n'),
      'gh pr list': ok('[]'),
      'gh pr create': ok('https://github.com/acme/tool/pull/42\n'),
      'gh pr edit': ok(''),
      'claude -p': verdictOut('pass'),
      'claude --bg': ok('bg1\n'),
      // Each builder it starts is listed with a process, so it started (T-92).
      'claude agents --json': launchedSessions(calls),
      ...over,
    }, calls),
    now, env: {}, accBinDir: '/opt/acc/bin',
  };
}

/** A check as `gh pr checks --json` lists it: an Actions job unless it says otherwise. */
const check = (name: string, bucket: string, more: Record<string, unknown> = {}) => ({ name, bucket, workflow: 'CI', link: `https://github.com/acme/tool/actions/runs/7/job/${name.length}`, state: bucket.toUpperCase(), ...more });

/** GitHub as gh reads it for a pull request: its head commit and its checks (D-076). */
const github = (head: string, checks: unknown[], more: Record<string, RunResult> = {}): Record<string, RunResult> => ({
  'gh pr view': ok(JSON.stringify({ headRefOid: head })),
  'gh pr checks': ok(JSON.stringify(checks)),
  ...more,
});

/** A person's edit to the ledger, by hand. mutate writes only when something is emitted. */
const edit = (paths: ReturnType<typeof repoPaths>, fn: (l: Ledger) => void): void =>
  mutate(paths, now, (l, emit) => {
    fn(l);
    emit({ type: 'task.updated', task: l.tasks[0]!.id, actor: 'human', by: 'human:test', data: {} });
  });
const events = (paths: ReturnType<typeof repoPaths>): LedgerEvent[] => readFileSync(paths.events, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as LedgerEvent);
const brief = (steps: AutopilotStep[]) => steps.map((s) => [s.task, s.step, s.outcome]);
const first = (paths: ReturnType<typeof repoPaths>): Task => readLedger(paths.ledger).tasks[0]!;

// ---------------------------------------------------------------- what autonomy means

test('autonomy: manual does nothing, review is autopilot, dispatch isn\'t built yet, and full is read as dispatch', () => {
  assert.deepEqual(autopilotMode({ autonomy: 'manual' }), { autonomy: 'manual', on: false, warnings: [], refusal: null });
  assert.deepEqual(autopilotMode({ autonomy: 'review' }), { autonomy: 'review', on: true, warnings: [], refusal: null });
  const dispatch = autopilotMode({ autonomy: 'dispatch' });
  assert.deepEqual([dispatch.on, dispatch.warnings], [false, []]);
  assert.match(dispatch.refusal!, /not built yet/);
  const full = autopilotMode({ autonomy: 'full' });
  assert.deepEqual([full.on, full.warnings, full.refusal], [false, ['autonomy "full" is read as "dispatch".'], dispatch.refusal]);
});

// ---------------------------------------------------------------- the rules, one at a time

const RULES_CONFIG = parseConfig({ ...GENERIC_CONFIG, agents: { max: 2 } }).config as Config;
const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);
const facts = (f: Partial<TaskFacts> = {}): TaskFacts => ({ head: HEAD, verdict: null, reviewing: null, landed: null, ...f });

function ledgerOf(...specs: Array<Partial<Task> & { id: string }>): Ledger {
  const l = emptyLedger();
  for (const s of specs) {
    upsertTasks(l, RULES_CONFIG, [{ source: { kind: 'manual', key: s.id }, title: s.id, deps: s.deps }], 'human', 'human:test', () => {}, now);
    Object.assign(l.tasks.find((t) => t.id === s.id)!, s);
  }
  return l;
}
const decide = (l: Ledger, id: string, f: TaskFacts) => {
  const d = nextStep(l, RULES_CONFIG, l.tasks.find((t) => t.id === id)!, f);
  return [d.step, d.outcome];
};
const pr = (extra: Record<string, unknown> = {}) => ({ number: 7, url: 'https://github.com/acme/tool/pull/7', state: 'open' as const, ...extra });

test('in review: review a commit nothing has reviewed, unless a review is running', () => {
  const l = ledgerOf({ id: 'T-1', state: 'review' });
  assert.deepEqual(decide(l, 'T-1', facts()), ['review', null]);
  assert.deepEqual(decide(l, 'T-1', facts({ reviewing: 'sess-r' })), [null, 'waiting']);
  assert.match(nextStep(l, RULES_CONFIG, l.tasks[0]!, facts({ reviewing: 'sess-r' })).reason, /A review is running \(session sess-r\)/);
  assert.deepEqual(decide(l, 'T-1', facts({ verdict: 'changes' })), [null, 'waiting'], 'a person moved it back to review after changes were asked for: theirs to decide');
});

test('in review and passed: land when there\'s no pull request, or it\'s behind the commit; nothing when it\'s up to date', () => {
  const l = ledgerOf({ id: 'T-1', state: 'review' });
  assert.deepEqual(decide(l, 'T-1', facts({ verdict: 'pass' })), ['land', null]);
  l.tasks[0]!.pr = pr({ sha: OLDER });
  assert.deepEqual(decide(l, 'T-1', facts({ verdict: 'pass', landed: OLDER })), ['land', null]);
  l.tasks[0]!.pr = pr({ sha: HEAD });
  assert.deepEqual(decide(l, 'T-1', facts({ verdict: 'pass', landed: HEAD })), [null, 'skipped']);
  l.tasks[0]!.pr = pr({ state: 'merged' });
  assert.deepEqual(decide(l, 'T-1', facts({ verdict: 'pass' })), [null, 'skipped']);
});

test('in review, with a closed pull request: once its review passed it waits for a person, and a new commit is still reviewed (D-063)', () => {
  const l = ledgerOf({ id: 'T-1', state: 'review', pr: pr({ state: 'closed' }) });
  assert.deepEqual(decide(l, 'T-1', facts({ verdict: 'pass' })), [null, 'waiting'], 'never landed as a new one');
  assert.match(nextStep(l, RULES_CONFIG, l.tasks[0]!, facts({ verdict: 'pass' })).reason, /^Pull request #7 was closed without merging\. Autopilot won't replace it: reopen it on GitHub and land to update it, or land to open a new one\.$/);
  assert.deepEqual(decide(l, 'T-1', facts()), ['review', null], 'a review is local: it doesn\'t touch GitHub');
  assert.deepEqual(decide(l, 'T-1', facts({ verdict: 'changes' })), [null, 'waiting']);
});

test('in review, passed and landed: an open pull request that conflicts with its base is refreshed, once a commit (D-058)', () => {
  const l = ledgerOf({ id: 'T-1', state: 'review' });
  l.tasks[0]!.pr = pr({ sha: HEAD, conflicts: ['docs/DECISIONS.md'] });
  assert.deepEqual(decide(l, 'T-1', facts({ verdict: 'pass', landed: HEAD })), ['refresh', null]);
  assert.equal(nextStep(l, RULES_CONFIG, l.tasks[0]!, facts({ verdict: 'pass', landed: HEAD })).reason, 'Pull request #7 conflicts with main in docs/DECISIONS.md.');
  assert.deepEqual(decide(l, 'T-1', facts({ verdict: 'pass', landed: OLDER })), ['land', null], 'behind its branch: the land comes first, and finds out again');
  assert.deepEqual(decide(l, 'T-1', facts()), ['review', null], 'a new commit nothing has reviewed');
  assert.deepEqual(decide(l, 'T-1', facts({ verdict: 'changes', landed: HEAD })), [null, 'waiting']);

  l.tasks[0]!.autopilot = { failed: { step: 'refresh', sha: HEAD, state: 'review', reason: 'Conflicts with main that autopilot can\'t resolve: sum.js', at: now().toISOString() } };
  assert.deepEqual(decide(l, 'T-1', facts({ verdict: 'pass', landed: HEAD })), [null, 'waiting']);
  assert.match(nextStep(l, RULES_CONFIG, l.tasks[0]!, facts({ verdict: 'pass', landed: HEAD })).reason, /^Autopilot couldn't update aaaaaaa from its base: Conflicts with main that autopilot can't resolve: sum\.js\. It waits for a person, or a new commit\.$/);
  // The base moving again doesn't count: only a new commit on the branch lets it try again.
  assert.deepEqual(decide(l, 'T-1', facts({ head: OLDER, verdict: 'pass', landed: OLDER })), ['refresh', null], 'a new commit');

  l.tasks[0]!.pr = pr({ sha: HEAD, conflicts: [] });
  l.tasks[0]!.autopilot = undefined;
  assert.deepEqual(decide(l, 'T-1', facts({ verdict: 'pass', landed: HEAD })), [null, 'skipped'], 'merges cleanly: up to date');
});

test('in rework: re-dispatch once as autopilot; a second rework waits for a person, as does a full agent cap', () => {
  const l = ledgerOf({ id: 'T-1', state: 'rework' }, { id: 'T-2', state: 'running' });
  assert.deepEqual(decide(l, 'T-1', facts()), ['dispatch', null]);
  // A person re-dispatching doesn't use autopilot's one.
  l.tasks[0]!.history.push({ at: now().toISOString(), actor: 'human', by: 'human:jordan', from: 'rework', to: 'running', reason: null });
  assert.deepEqual(decide(l, 'T-1', facts()), ['dispatch', null]);
  l.tasks[0]!.history.push({ at: now().toISOString(), actor: 'orchestrator', by: AUTOPILOT_BY, from: 'rework', to: 'running', reason: null });
  assert.deepEqual(decide(l, 'T-1', facts()), [null, 'waiting']);
  assert.match(nextStep(l, RULES_CONFIG, l.tasks[0]!, facts()).reason, /A second rework waits for a person/);

  const full = ledgerOf({ id: 'T-1', state: 'rework' }, { id: 'T-2', state: 'running' }, { id: 'T-3', state: 'running' });
  assert.deepEqual(decide(full, 'T-1', facts()), [null, 'waiting']);
  assert.match(nextStep(full, RULES_CONFIG, full.tasks[0]!, facts()).reason, /2 builders are running in this project, and its cap is 2 \(agents\.max\)\./);
});

test('a task to do, ready or not, is never started; nor is one running or blocked touched', () => {
  const l = ledgerOf({ id: 'T-1' }, { id: 'T-2', deps: ['T-1'] }, { id: 'T-3', state: 'running' }, { id: 'T-4', state: 'blocked' });
  assert.equal(displayState(l, l.tasks[0]!), 'ready');
  for (const id of ['T-1', 'T-2', 'T-3', 'T-4']) assert.deepEqual(decide(l, id, facts()), [null, 'skipped'], id);
  assert.match(nextStep(l, RULES_CONFIG, l.tasks[0]!, facts()).reason, /only once a person has dispatched it/);
});

test('a task a person dispatched that waits for another\'s files: it waits while another can go first, then starts (D-093)', () => {
  const hold = { at: now().toISOString(), actor: 'human' as const, by: 'human:test', waitsFor: [{ task: 'T-2', files: ['src/a.ts'] }], first: ['T-3'] };
  const l = ledgerOf({ id: 'T-1', held: hold }, { id: 'T-2', state: 'running' }, { id: 'T-3' });
  const shares = [{ task: 'T-2', files: ['src/a.ts'] }];
  const look = (f: Partial<NonNullable<TaskFacts['start']>> = {}) => facts({ head: '', start: { shares, first: ['T-3'], problems: [], ...f } });
  assert.deepEqual(decide(l, 'T-1', look()), [null, 'waiting']);
  assert.equal(nextStep(l, RULES_CONFIG, l.tasks[0]!, look()).reason, 'Waits for T-2\'s files: src/a.ts, while T-3 is ready to start.');
  // Nothing else is ready: it starts, sharing files.
  assert.deepEqual(decide(l, 'T-1', look({ first: [] })), ['start', null]);
  assert.match(nextStep(l, RULES_CONFIG, l.tasks[0]!, look({ first: [] })).reason, /Nothing else is ready to start, so it starts sharing files with T-2/);
  // Its files are free.
  assert.deepEqual(decide(l, 'T-1', look({ shares: [], first: [] })), ['start', null]);
  assert.equal(nextStep(l, RULES_CONFIG, l.tasks[0]!, look({ shares: [], first: [] })).reason, 'T-2\'s files are free.');
  // What stops a dispatch stops this start: the cap, a dependency.
  assert.deepEqual(nextStep(l, RULES_CONFIG, l.tasks[0]!, look({ shares: [], problems: ['2 builders are running in this project, and its cap is 2 (agents.max).'] })), { step: null, outcome: 'waiting', reason: '2 builders are running in this project, and its cap is 2 (agents.max).' });
  // A start that failed waits for a person.
  l.tasks[0]!.held = { ...hold, failed: { reason: 'Claude Code needs you to log in', at: now().toISOString(), by: AUTOPILOT_BY } };
  assert.deepEqual(decide(l, 'T-1', look({ shares: [] })), [null, 'waiting']);
  assert.match(nextStep(l, RULES_CONFIG, l.tasks[0]!, look({ shares: [] })).reason, /Its start failed: Claude Code needs you to log in\. It waits for a person\./);
});

test('a pass starts a held task once nothing else is ready, as the orchestrator, and reads back as a start (D-093)', () => {
  const s = setup();
  // T-1, in review, changed sum.js; T-2 plans it too, and a person dispatched it. T-3 waits on T-2, so nothing else is ready.
  writePlan(s.paths.analyses, 'T-2', ['sum.js']);
  edit(s.paths, (l) => {
    l.tasks[1]!.held = { at: now().toISOString(), actor: 'human', by: 'human:test', waitsFor: [{ task: 'T-1', files: ['sum.js'] }], first: ['T-9'] };
  });
  const calls: string[] = [];
  const r = autopilotPass(s.paths, s.config, deps(calls));
  assert.deepEqual(brief(r.steps), [['T-1', 'review', 'done'], ['T-2', 'start', 'done'], ['T-3', null, 'skipped']]);
  assert.match(r.steps[1]!.reason, /^Started it: nothing else was ready, so it shares files with T-1/);
  const t = readLedger(s.paths.ledger).tasks[1]!;
  assert.deepEqual([t.state, t.held, t.run?.shares], ['running', null, [{ task: 'T-1', files: ['sum.js'] }]]);
  assert.deepEqual([t.history.at(-1)!.actor, t.history.at(-1)!.by], ['orchestrator', AUTOPILOT_BY]);
  const moved = events(s.paths).filter((e) => e.type === 'task.moved').at(-1)!;
  assert.deepEqual(autopilotEvent(moved), { seq: moved.seq, at: moved.at, task: 'T-2', step: 'start', outcome: 'done', waitedFor: ['T-1'], shares: [{ task: 'T-1', files: ['sum.js'] }] });
  assert.equal(calls.filter((c) => c.startsWith('claude --bg')).length, 1);
});

test('autopilot\'s starts and failed starts read back as its steps; a person\'s don\'t (D-093)', () => {
  const at = now().toISOString();
  const e = (by: string, type: LedgerEvent['type'], data: Record<string, unknown>) => autopilotEvent({ seq: 1, at, type, task: 'T-2', by, data });
  assert.deepEqual(e(AUTOPILOT_BY, 'task.moved', { from: 'todo', to: 'running', held: { waitedFor: ['T-1'] } }), { seq: 1, at, task: 'T-2', step: 'start', outcome: 'done', waitedFor: ['T-1'] });
  assert.deepEqual(e(AUTOPILOT_BY, 'task.updated', { held: { at, failed: { reason: 'No trust', at, by: AUTOPILOT_BY } } }), { seq: 1, at, task: 'T-2', step: 'start', outcome: 'failed', reason: 'No trust' });
  assert.equal(e(AUTOPILOT_BY, 'task.updated', { held: { at, starting: { at, by: AUTOPILOT_BY } } }), null, 'its claim is no step');
  assert.equal(e('human:test', 'task.moved', { from: 'todo', to: 'running' }), null, 'a person\'s dispatch');
  assert.equal(e('human:test', 'task.updated', { held: { at, failed: { reason: 'x', at, by: 'human:test' } } }), null, 'the Command Center\'s start, as the person');
});

test('a step that failed isn\'t tried again on the same commit, but is on a new one', () => {
  const l = ledgerOf({ id: 'T-1', state: 'review' });
  l.tasks[0]!.autopilot = { failed: { step: 'land', sha: HEAD, state: 'review', reason: 'git push refused task/T-1', at: now().toISOString() } };
  assert.deepEqual(decide(l, 'T-1', facts({ verdict: 'pass' })), [null, 'waiting']);
  assert.match(nextStep(l, RULES_CONFIG, l.tasks[0]!, facts({ verdict: 'pass' })).reason, /couldn't land aaaaaaa: git push refused task\/T-1\. It waits for a person, or a new commit\./);
  assert.deepEqual(decide(l, 'T-1', facts({ verdict: 'pass', head: OLDER })), ['land', null], 'a new commit');
  assert.deepEqual(decide(l, 'T-1', facts()), ['review', null], 'a different step');
});

// ---------------------------------------------------------------- passes, with the real steps

test('a pass reviews what a builder finished, the next lands it as the orchestrator, and then there\'s nothing to do', () => {
  const s = setup({ source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' } });
  const calls: string[] = [];
  const reviewed = autopilotPass(s.paths, s.config, deps(calls));
  assert.deepEqual(brief(reviewed.steps), [['ACME-7', 'review', 'done'], ['T-2', null, 'skipped'], ['T-3', null, 'skipped']]);
  assert.equal(readVerdict(s.paths, s.id, s.sha)?.verdict, 'pass');
  const r = events(s.paths).at(-1)!;
  assert.deepEqual([r.actor, r.by, r.data], ['reviewer', 'reviewer:ACME-7 for orchestrator:autopilot', { reviewed: { sha: s.sha, verdict: 'pass' } }], 'the reviewer\'s move, made for autopilot');
  assert.ok(!calls.some((c) => c.startsWith('gh ')), 'a task reviewed in this pass lands in the next');

  const landed = autopilotPass(s.paths, s.config, deps(calls));
  assert.deepEqual(landed.steps[0], { task: 'ACME-7', state: 'review', step: 'land', sha: s.sha, outcome: 'done', reason: 'Opened pull request #42.', pr: { number: 42, url: 'https://github.com/acme/tool/pull/42', opened: true }, update: { id: 'ACME-7.1', key: 'ACME-7' } });
  // It drafts the ticket's update and posts nothing: a person reviews it first (D-066).
  assert.deepEqual(landed.updates, [{ task: 'ACME-7', id: 'ACME-7.1', key: 'ACME-7' }]);
  assert.deepEqual(listUpdates(s.paths).map((u) => [u.id, u.event, u.state, u.by]), [['ACME-7.1', 'pr-opened', 'draft', AUTOPILOT_BY]]);
  assert.ok(!calls.some((c) => c.startsWith('gh issue') || c.startsWith('curl')), 'nothing is posted');
  const t = first(s.paths);
  assert.deepEqual([t.state, t.pr?.number, t.pr?.sha], ['review', 42, s.sha], 'it stays in review, its pull request at the reviewed commit');
  const e = events(s.paths).at(-1)!;
  assert.deepEqual([e.type, e.actor, e.by], ['task.updated', 'orchestrator', AUTOPILOT_BY]);

  // Its checks passed on GitHub (D-076).
  const before = calls.length;
  const idle = autopilotPass(s.paths, s.config, deps(calls, github(s.sha, [check('test', 'pass')])));
  assert.deepEqual([idle.steps[0]!.outcome, idle.steps[0]!.reason], ['skipped', `Pull request #42 is up to date with ${s.sha.slice(0, 7)}.`]);
  assert.ok(calls.slice(before).every((c) => c.startsWith('git rev-parse') || /^gh (auth token|pr view|pr checks) /.test(c)), 'it only looked');

  // Everything autopilot ran besides git: a review, a land's gh calls, and a read of the checks. No merge,
  // waiver, deploy, promotion or acc command, and no builder for the tasks to do.
  const others = [...new Set(calls.filter((c) => !c.startsWith('git ')).map((c) => c.split(' ').slice(0, 3).join(' ')))].sort();
  assert.deepEqual(others, ['claude -p --session-id', 'gh auth token', 'gh pr checks', 'gh pr create', 'gh pr list', 'gh pr view']);
  const git = [...new Set(calls.filter((c) => c.startsWith('git ')).map((c) => c.split(' ')[1]))].sort();
  assert.deepEqual(git, ['diff', 'fetch', 'ls-tree', 'merge-base', 'merge-tree', 'push', 'rev-parse'], 'merge-base: the land reads what its pull request changes, to keep it (T-99); ls-tree: whether it adds decisions to number (T-102)');
});

test('the step autopilot is taking is marked under way on its task while it runs, and only then (D-092)', () => {
  const s = setup();
  let during: Job[] = [];
  const r = autopilotPass(s.paths, s.config, { ...deps([]), steps: { review: () => { during = jobsUnderWay(s.paths); return { reason: 'reviewed' }; } } });
  assert.deepEqual(brief(r.steps)[0], ['T-1', 'review', 'done']);
  assert.deepEqual(during.map((j) => [j.kind, j.task, j.step, j.by, j.pid]), [['autopilot', 'T-1', 'review', AUTOPILOT_BY, process.pid]]);
  assert.deepEqual(jobsUnderWay(s.paths), [], 'gone once the step ends');
  const failed = autopilotPass(s.paths, s.config, { ...deps([]), steps: { review: () => { throw new Error('the reviewer crashed'); } } });
  assert.deepEqual(brief(failed.steps)[0], ['T-1', 'review', 'failed']);
  assert.deepEqual(jobsUnderWay(s.paths), [], 'and when it fails');
});

test('a review that asks for changes sends it to rework; autopilot re-dispatches it once, and a second rework waits for a person', () => {
  const s = setup();
  const calls: string[] = [];
  const asked = autopilotPass(s.paths, s.config, deps(calls, { 'claude -p': verdictOut('changes') }));
  assert.deepEqual(brief(asked.steps)[0], ['T-1', 'review', 'done']);
  assert.match(asked.steps[0]!.reason, /asked for changes, so it went to rework: sum has no test/);
  assert.deepEqual(first(s.paths).history.at(-1), { at: now().toISOString(), actor: 'reviewer', by: 'reviewer:T-1 for orchestrator:autopilot', from: 'review', to: 'rework', reason: 'Review asked for changes: sum has no test.' });

  const again = autopilotPass(s.paths, s.config, deps(calls));
  assert.deepEqual(brief(again.steps), [['T-1', 'dispatch', 'done'], ['T-2', null, 'skipped'], ['T-3', null, 'skipped']]);
  const t = first(s.paths);
  assert.equal(t.state, 'running');
  assert.deepEqual([t.history.at(-1)!.from, t.history.at(-1)!.actor, t.history.at(-1)!.by], ['rework', 'orchestrator', AUTOPILOT_BY]);
  const launches = calls.filter((c) => c.startsWith('claude --bg'));
  assert.equal(launches.length, 1);
  // Its second builder (D-087): the run it was set up with was its first.
  assert.ok(launches[0]!.includes('--name Tool · T-1 Add a sum function · builder 2 '), 'the rework, never a task to do');
  assert.equal(t.run?.name, 'Tool · T-1 Add a sum function · builder 2');
  assert.equal(t.run?.bgId, 'bg1', 'its new session is found by that name');
  assert.match(launches[0]!, /What the review asked for/, 'its builder is told what to fix');

  // The builder finishes, and the reviewer asks for changes again.
  edit(s.paths, (l) => {
    const x = l.tasks[0]!;
    x.history.push({ at: now().toISOString(), actor: 'builder', by: 'builder:T-1', from: 'running', to: 'review', reason: null });
    x.history.push({ at: now().toISOString(), actor: 'reviewer', by: 'reviewer:T-1', from: 'review', to: 'rework', reason: 'Still no test.' });
    x.state = 'rework';
  });
  const second = autopilotPass(s.paths, s.config, deps(calls));
  assert.deepEqual(brief(second.steps)[0], ['T-1', null, 'waiting']);
  assert.match(second.steps[0]!.reason, /A second rework waits for a person/);
  assert.equal(calls.filter((c) => c.startsWith('claude --bg')).length, 1, 'no second builder');
  assert.equal(first(s.paths).state, 'rework');
});

test('a step that fails is recorded on the task, which needs you, and isn\'t tried again until a new commit', () => {
  const s = setup();
  passReview(s.paths, s.id, s.sha);
  const calls: string[] = [];
  const failing = deps(calls, { 'gh pr create': bad('GraphQL: Resource not accessible by integration (createPullRequest)') });
  const r = autopilotPass(s.paths, s.config, failing);
  assert.deepEqual(brief(r.steps)[0], ['T-1', 'land', 'failed']);
  const reason = 'gh couldn\'t open the pull request: GraphQL: Resource not accessible by integration (createPullRequest)';
  assert.equal(r.steps[0]!.reason, reason);
  const t = first(s.paths);
  assert.deepEqual(t.autopilot, { failed: { step: 'land', sha: s.sha, state: 'review', reason, at: now().toISOString() } });
  assert.equal(displayState(readLedger(s.paths.ledger), t), 'needs-you');
  const e = events(s.paths).at(-1)!;
  assert.deepEqual([e.actor, e.by, Object.keys(e.data)], ['orchestrator', AUTOPILOT_BY, ['autopilot']], 'the history says autopilot did it');

  const before = calls.length;
  const held = autopilotPass(s.paths, s.config, failing);
  assert.deepEqual(brief(held.steps)[0], ['T-1', null, 'waiting']);
  assert.match(held.steps[0]!.reason, /Autopilot couldn't land [0-9a-f]{7}: gh couldn't open the pull request/);
  assert.ok(!calls.slice(before).some((c) => c.startsWith('gh ') || c.startsWith('git push')), 'nothing was tried on the same commit');

  const sha2 = s.commit('sum.test.js', 'test("sum", () => {});\n');
  passReview(s.paths, s.id, sha2);
  const retried = autopilotPass(s.paths, s.config, deps(calls));
  assert.deepEqual(brief(retried.steps)[0], ['T-1', 'land', 'done']);
  const after = first(s.paths);
  assert.deepEqual([after.autopilot?.failed, after.pr?.sha, displayState(readLedger(s.paths.ledger), after)], [null, sha2, 'review'], 'landing clears it');
});

test('what waits isn\'t a failure: a full agent cap, a cap that fills meanwhile, a busy ledger', () => {
  const s = setup({ state: 'rework', max: 1 });
  edit(s.paths, (l) => { l.tasks.find((t) => t.id === 'T-2')!.state = 'running'; });
  const calls: string[] = [];
  const r = autopilotPass(s.paths, s.config, deps(calls));
  assert.deepEqual([r.steps[0]!.outcome, r.steps[0]!.reason], ['waiting', '1 builder is running in this project, and its cap is 1 (agents.max).']);
  // Nothing was dispatched. A task is running, so the pass looked at Claude Code's sessions once (D-067).
  assert.deepEqual(calls.filter((c) => c.startsWith('claude')), ['claude agents --json']);

  const s2 = setup({ state: 'rework', max: 1 });
  const fills = autopilotPass(s2.paths, s2.config, { ...deps([]), steps: { dispatch: () => {
    edit(s2.paths, (l) => { l.tasks.find((t) => t.id === 'T-2')!.state = 'running'; });
    throw new AccError('move-refused', 'Can\'t dispatch T-1:\n- 1 builder is running in this project, and its cap is 1 (agents.max).');
  } } });
  assert.deepEqual([fills.steps[0]!.outcome, fills.steps[0]!.reason], ['waiting', '1 builder is running in this project, and its cap is 1 (agents.max).']);
  const busy = autopilotPass(s2.paths, { ...s2.config, agents: { ...s2.config.agents, max: 3 } }, { ...deps([]), steps: { dispatch: () => { throw new AccError('lock-timeout', 'Another acc process is holding the ledger.'); } } });
  assert.deepEqual([busy.steps[0]!.outcome, busy.steps[0]!.reason], ['waiting', 'The ledger was busy. Autopilot tries again next pass.']);
  assert.equal(first(s2.paths).autopilot, undefined, 'nothing recorded');
  assert.equal(displayState(readLedger(s2.paths.ledger), first(s2.paths)), 'rework');
});

test('a pull request landed before acc recorded its commit is compared with what GitHub has, so it isn\'t landed every pass', () => {
  const s = setup();
  passReview(s.paths, s.id, s.sha);
  gitIn(s.dir, 'push', '-q', 'origin', `${BRANCH}:${BRANCH}`);
  edit(s.paths, (l) => { l.tasks[0]!.pr = { number: 7, url: 'https://github.com/acme/tool/pull/7', state: 'open', landedAt: '2026-10-01T10:00:00.000Z' }; });
  const f = taskFacts(s.paths, first(s.paths), run);
  assert.deepEqual([f.head, f.verdict, f.landed], [s.sha, 'pass', s.sha]);
  const calls: string[] = [];
  assert.deepEqual(brief(autopilotPass(s.paths, s.config, deps(calls)).steps)[0], ['T-1', null, 'skipped']);
  assert.ok(!calls.some((c) => c.startsWith('gh ')));
  const sha2 = s.commit('sum.test.js', 'test("sum", () => {});\n');
  passReview(s.paths, s.id, sha2);
  const open = ok(JSON.stringify([{ number: 7, url: 'https://github.com/acme/tool/pull/7' }]));
  assert.deepEqual(brief(autopilotPass(s.paths, s.config, deps(calls, { 'gh pr list': open })).steps)[0], ['T-1', 'land', 'done'], 'behind the branch: it lands');
  assert.equal(first(s.paths).pr?.number, 7, 'and updates the one GitHub has open');
});

test('a closed pull request a person moved back to review isn\'t replaced: the task needs you until a person lands it (D-063)', () => {
  const s = setup();
  passReview(s.paths, s.id, s.sha);
  // acc sync saw it closed and blocked the task; a person moved it back to review.
  edit(s.paths, (l) => { l.tasks[0]!.pr = { number: 41, url: 'https://github.com/acme/tool/pull/41', state: 'closed' }; });
  const calls: string[] = [];
  const r = autopilotPass(s.paths, s.config, deps(calls));
  assert.deepEqual(brief(r.steps), [['T-1', null, 'waiting'], ['T-2', null, 'skipped'], ['T-3', null, 'skipped']]);
  assert.match(r.steps[0]!.reason, /^Pull request #41 was closed without merging\./);
  assert.ok(!calls.some((c) => c.startsWith('git push') || c.startsWith('gh ')), 'nothing pushed, opened or edited');
  const t = first(s.paths);
  assert.deepEqual([t.pr?.number, t.pr?.state, t.autopilot], [41, 'closed', undefined], 'the ledger still names the closed one, and nothing failed');
  assert.equal(displayState(readLedger(s.paths.ledger), t), 'needs-you');

  // A person lands it. GitHub has nothing open for the branch, so acc opens a new pull request.
  const landed = land(s.paths, s.config, s.id, { run: deps(calls).run, now, env: {} }, { actor: 'human' });
  assert.deepEqual([landed.opened, landed.pr.number, landed.pr.state], [true, 42, 'open']);
  assert.equal(displayState(readLedger(s.paths.ledger), first(s.paths)), 'review');
});

test('a ledger that still says open, for a pull request GitHub no longer has open, can\'t make autopilot open another (D-063)', () => {
  const s = setup();
  passReview(s.paths, s.id, s.sha);
  edit(s.paths, (l) => { l.tasks[0]!.pr = { number: 41, url: 'https://github.com/acme/tool/pull/41', state: 'open', sha: s.sha }; });
  // Closed or merged on GitHub since acc last looked, and the branch moved on.
  const sha2 = s.commit('sum.test.js', 'test("sum", () => {});\n');
  passReview(s.paths, s.id, sha2);
  const calls: string[] = [];
  const r = autopilotPass(s.paths, s.config, deps(calls));
  assert.deepEqual(brief(r.steps)[0], ['T-1', 'land', 'failed']);
  assert.equal(r.steps[0]!.reason, 'Pull request #41 isn\'t open on GitHub. Autopilot won\'t open another: a person decides.');
  assert.ok(!calls.some((c) => c.startsWith('git push') || c.startsWith('gh pr create') || c.startsWith('gh pr edit')), 'asked before the push: nothing pushed or opened');
  const t = first(s.paths);
  assert.deepEqual([t.pr?.number, t.pr?.state, t.autopilot?.failed?.step], [41, 'open', 'land']);
  assert.equal(displayState(readLedger(s.paths.ledger), t), 'needs-you', 'it names #41 as needing you');
});

// ---------------------------------------------------------------- one at a time

test('autopilot runs on a repo where no task was ever added: it makes the state folder its lock lives in', () => {
  const paths = repoPaths(makeRepo(), run);
  assert.ok(!existsSync(paths.stateDir), 'nothing has made it yet');
  assert.equal(holdAutopilot(paths, () => 'ran'), 'ran');
  assert.ok(existsSync(paths.stateDir));
  assert.ok(!existsSync(paths.autopilotLock), 'let go when it ends');
  assert.deepEqual(autopilotPass(paths, parseConfig({ ...GENERIC_CONFIG, autonomy: 'review' }).config as Config, deps([])), { steps: [], updates: [] }, 'and has nothing to do');
});

test('only one autopilot runs against a repo: a second is refused at once, and a dead one\'s lock is broken', () => {
  const s = setup();
  assert.equal(s.paths.autopilotLock, join(s.paths.stateDir, 'autopilot.lock'));
  const started = Date.now();
  const inner = holdAutopilot(s.paths, () => {
    assert.ok(existsSync(join(s.paths.autopilotLock, 'owner')));
    let refused: Error | null = null;
    try {
      holdAutopilot(s.paths, () => assert.fail('a second autopilot ran'));
    } catch (e) {
      refused = e as Error;
    }
    // The heavy-check slot is apart: a builder's heavy check still runs while autopilot holds its lock.
    const heavy = withSlot(() => 'ran', { dir: join(tempDir(), 'slots'), slots: 1 });
    return { refused, heavy };
  });
  assert.equal((inner.refused as AccError).code, 'autopilot-running');
  assert.match(inner.refused!.message, new RegExp(`Autopilot is already running here \\(pid ${process.pid}\\)`));
  assert.ok(Date.now() - started < 5_000, 'refused at once');
  assert.equal(inner.heavy, 'ran');
  assert.ok(!existsSync(s.paths.autopilotLock), 'let go when it ends');

  // An autopilot stopped with Ctrl-C leaves its lock; its pid is gone, so the next one breaks it.
  const dead = spawnSync(process.execPath, ['-e', '']).pid!;
  mkdirSync(s.paths.autopilotLock);
  writeFileSync(join(s.paths.autopilotLock, 'owner'), JSON.stringify({ pid: dead, at: Date.now() }));
  assert.equal(holdAutopilot(s.paths, () => 'ran'), 'ran');

  // The ledger's own lock timing out inside a pass isn't another autopilot.
  assert.throws(() => holdAutopilot(s.paths, () => { throw new AccError('lock-timeout', 'ledger busy'); }), /ledger busy/);
});

// ---------------------------------------------------------------- what it did, read back (D-064)

const steps = (log: AutopilotLog | undefined) => (log?.records ?? []).map((r) => [r.task, r.step, r.outcome, r.verdict ?? r.pr?.number ?? r.reason ?? null]);

test('every step autopilot takes is read back from the ledger\'s events: review, land, re-dispatch and failure (D-064)', () => {
  const s = setup();
  const calls: string[] = [];
  autopilotPass(s.paths, s.config, deps(calls));
  autopilotPass(s.paths, s.config, deps(calls));
  const log = readAutopilotLog(s.paths.events);
  assert.deepEqual(steps(log), [['T-1', 'review', 'done', 'pass'], ['T-1', 'land', 'done', 42]]);
  assert.deepEqual(log!.records[1]!.pr, { number: 42, url: 'https://github.com/acme/tool/pull/42', opened: true });
  assert.ok(log!.records.every((r) => r.seq > 0 && r.at === now().toISOString()));

  // Changes asked for, then the re-dispatch: its move is the step, and its run record isn't another.
  const r = setup();
  autopilotPass(r.paths, r.config, deps(calls, { 'claude -p': verdictOut('changes') }));
  autopilotPass(r.paths, r.config, deps(calls));
  assert.deepEqual(steps(readAutopilotLog(r.paths.events)), [['T-1', 'review', 'done', 'changes'], ['T-1', 'dispatch', 'done', null]]);
  assert.equal(readAutopilotLog(r.paths.events)!.records[0]!.reason, 'sum has no test.', 'what the review asked for');

  const f = setup();
  passReview(f.paths, f.id, f.sha);
  autopilotPass(f.paths, f.config, deps(calls, { 'gh pr create': bad('GraphQL: Resource not accessible by integration (createPullRequest)') }));
  assert.deepEqual(steps(readAutopilotLog(f.paths.events)), [['T-1', 'land', 'failed', 'gh couldn\'t open the pull request: GraphQL: Resource not accessible by integration (createPullRequest)']]);
});

test('a person\'s review, land and dispatch aren\'t autopilot\'s, nor is a re-dispatch\'s run record (D-064)', () => {
  const at = now().toISOString();
  const e = (by: string, type: LedgerEvent['type'], data: Record<string, unknown>) => autopilotEvent({ seq: 1, at, type, task: 'T-1', by, data });
  assert.equal(e('reviewer:T-1', 'task.updated', { reviewed: { sha: 'abc', verdict: 'pass' } }), null);
  assert.equal(e('reviewer:T-1', 'task.moved', { from: 'review', to: 'rework', reason: 'Review asked for changes: no test.' }), null);
  assert.equal(e('acc land', 'task.updated', { pr: { number: 7, url: 'u' }, sha: 'abc', opened: true }), null);
  assert.equal(e('human:jordan', 'task.moved', { from: 'rework', to: 'running' }), null);
  assert.equal(e(AUTOPILOT_BY, 'task.updated', { run: { branch: 'b' } }), null);
  assert.equal(e(AUTOPILOT_BY, 'task.moved', { from: 'review', to: 'done' }), null);
  assert.equal(e(`someone for ${AUTOPILOT_BY}x`, 'task.updated', { reviewed: { sha: 'abc', verdict: 'pass' } }), null);
  // Updated rather than opened, and a refresh: merged in, or the conflict had gone.
  assert.deepEqual(e(AUTOPILOT_BY, 'task.updated', { pr: { number: 7, url: 'u' }, sha: 'abc', opened: false })?.pr, { number: 7, url: 'u', opened: false });
  assert.deepEqual(e(AUTOPILOT_BY, 'task.updated', { refreshed: { base: 'main', from: 'a', to: 'b', resolved: [] } }), { seq: 1, at, task: 'T-1', step: 'refresh', outcome: 'done', base: 'main' });
  assert.deepEqual(e(AUTOPILOT_BY, 'task.updated', { pr: { number: 7, url: 'u', conflicts: [] } }), { seq: 1, at, task: 'T-1', step: 'refresh', outcome: 'done', base: null, pr: { number: 7, url: 'u', opened: false } });
  assert.equal(e(AUTOPILOT_BY, 'task.updated', { autopilot: { failed: { step: 'deploy', reason: 'x' } } }), null, 'not a step it takes');
});

test('the events are read from their tail first, then only what was added, a whole line at a time (D-064)', () => {
  const dir = tempDir('events-');
  const file = join(dir, 'events.jsonl');
  assert.equal(readAutopilotLog(file), undefined, 'none yet');
  const line = (seq: number, by = AUTOPILOT_BY) => JSON.stringify({ seq, at: now().toISOString(), type: 'task.updated', task: `T-${seq}`, actor: 'orchestrator', by, data: { pr: { number: seq, url: 'u' }, sha: 'a', opened: true } });
  // A long history: only its last 256 KB is read, starting at a whole line.
  const old = Array.from({ length: 4000 }, (_, i) => line(i + 1)).join('\n') + '\n';
  writeFileSync(file, old);
  let log = readAutopilotLog(file)!;
  assert.ok(log.records.length === 300, 'the newest 300 kept');
  assert.equal(log.records.at(-1)!.seq, 4000);
  assert.equal(log.offset, Buffer.byteLength(old));

  appendFileSync(file, `${line(4001, 'human:jordan')}\n${line(4002)}\n${line(4003).slice(0, 20)}`);
  log = readAutopilotLog(file, log)!;
  assert.deepEqual(log.records.slice(-1).map((r) => r.seq), [4002], 'a person\'s land isn\'t a step, and a half-written line waits');
  appendFileSync(file, `${line(4003).slice(20)}\n`);
  log = readAutopilotLog(file, log)!;
  assert.deepEqual(log.records.slice(-2).map((r) => r.seq), [4002, 4003]);
  assert.equal(log.records.length, 300);

  // A file made again is read again from its start.
  writeFileSync(file, `${line(1)}\n`);
  assert.deepEqual(readAutopilotLog(file, log)!.records.map((r) => r.seq), [1]);
});

// ---------------------------------------------------------------- a builder that stopped (D-067)

/** T-1 running as GH-41 was after the Mac slept: its session gone from claude agents, its transcript ending in the API error. */
function stoppedSetup() {
  const s = setup({ state: 'running' });
  edit(s.paths, (l) => { l.tasks[0]!.run = { ...l.tasks[0]!.run, bgId: 'bg9', sessionId: 'sess-9', startedAt: '2026-10-05T11:00:00.000Z' }; });
  const projects = tempDir('projects-');
  mkdirSync(transcriptDir(projects, s.dir), { recursive: true });
  writeFileSync(join(transcriptDir(projects, s.dir), 'sess-9.jsonl'), gh41Lines('sess-9', s.dir).join('\n') + '\n');
  const clock = { at: now().getTime() };
  const launched: string[][] = [];
  const pass = (calls: string[] = [], over: Partial<AutopilotDeps> = {}) => autopilotPass(s.paths, s.config, {
    ...deps(calls, { 'claude agents --json': ok('[]') }), now: () => new Date(clock.at),
    resume: { projectsDir: projects, awake: fakeAwake().deps, launch: (_c, args) => { launched.push(args); return 4_000_001; } },
    ...over,
  });
  return { ...s, clock, launched, pass, later: (min: number) => { clock.at += min * 60_000; } };
}

test('autopilot resumes a stopped builder once a run, as the orchestrator, and says what it last said', () => {
  const s = stoppedSetup();
  const calls: string[] = [];
  const r = s.pass(calls);
  assert.deepEqual(brief(r.steps)[0], ['T-1', 'resume', 'done']);
  assert.equal(r.steps[0]!.sha, s.sha, 'on its branch\'s latest commit');
  assert.equal(r.steps[0]!.reason, `Resumed its builder, which last said: ${SLEPT}`);
  assert.equal(calls.filter((c) => c === 'claude agents --json').length, 2, 'one look for the pass, and the resume\'s own just before it starts');
  assert.equal(s.launched.length, 1);
  assert.deepEqual(s.launched[0]!.slice(2, 4), ['--resume', 'sess-9']);
  assert.match(s.launched[0]![1]!, /Your last turn ended before you ran acc done or acc block/);
  const t = first(s.paths);
  assert.deepEqual(t.run?.resumes?.map((x) => [x.actor, x.by]), [['orchestrator', AUTOPILOT_BY]]);
  assert.equal(t.state, 'running');
  // Its event is autopilot's step, for History and the notice (D-064).
  assert.deepEqual(autopilotEvent(events(s.paths).at(-1)!), { seq: events(s.paths).at(-1)!.seq, at: new Date(s.clock.at).toISOString(), task: 'T-1', step: 'resume', outcome: 'done', reason: SLEPT });
});

test('a look at the sessions older than the grace is taken again before the next running task is judged, so a builder dispatched meanwhile isn\'t seen as stopped', () => {
  const s = stoppedSetup();
  edit(s.paths, (l) => {
    const t = l.tasks.find((x) => x.id === 'T-2')!;
    t.state = 'running';
    t.run = { bgId: 'bg8', sessionId: 'sess-8', worktree: s.dir, branch: 'b', startedAt: '2026-10-05T11:00:00.000Z' };
  });
  const quick: string[] = [];
  s.pass(quick, { steps: { resume: () => ({ reason: 'resumed' }) } });
  assert.equal(quick.filter((c) => c === 'claude agents --json').length, 1, 'one look serves the pass while it\'s fresh');
  const slow: string[] = [];
  s.pass(slow, { steps: { resume: () => { s.later(3); return { reason: 'resumed' }; } } });
  assert.equal(slow.filter((c) => c === 'claude agents --json').length, 2, 'a step that outlasts the grace means a fresh look for T-2');
});

test('a second stop waits for a person, even after a person resumed it; a new dispatch is a new run', () => {
  const s = stoppedSetup();
  assert.deepEqual(brief(s.pass().steps)[0], ['T-1', 'resume', 'done']);
  assert.deepEqual(brief(s.pass().steps)[0], ['T-1', null, 'skipped'], 'just resumed: not listed yet, so not judged');
  s.later(3);
  const again = s.pass();
  assert.deepEqual(brief(again.steps)[0], ['T-1', null, 'waiting']);
  assert.equal(again.steps[0]!.reason, 'Its agent stopped again. Autopilot resumed it once already: a person resumes it.');
  // A person's resume doesn't give autopilot another go.
  edit(s.paths, (l) => { l.tasks[0]!.run!.resumes!.push({ at: new Date(s.clock.at).toISOString(), actor: 'human', by: 'human:jack' }); });
  s.later(3);
  assert.deepEqual(brief(s.pass().steps)[0], ['T-1', null, 'waiting']);
  assert.equal(s.launched.length, 1, 'resumed once');
  // A new dispatch starts a new run, with its own one resume.
  edit(s.paths, (l) => { l.tasks[0]!.run = { ...l.tasks[0]!.run, startedAt: new Date(s.clock.at - 10 * 60_000).toISOString(), resumes: undefined }; });
  assert.deepEqual(brief(s.pass().steps)[0], ['T-1', 'resume', 'done']);
  assert.equal(s.launched.length, 2);
});

test('a builder at work, or one autopilot can\'t see, is left alone', () => {
  const s = stoppedSetup();
  const working = s.pass([], { run: deps([], { 'claude agents --json': ok(JSON.stringify([{ id: 'bg9', sessionId: 'sess-9', kind: 'background', name: 'T-1', pid: 9, state: 'working', status: 'busy' }])) }).run });
  assert.deepEqual([brief(working.steps)[0], working.steps[0]!.reason], [['T-1', null, 'skipped'], 'Its builder is working.']);
  const blind = s.pass([], { run: deps([], { 'claude agents --json': bad('timed out') }).run });
  assert.deepEqual(brief(blind.steps)[0], ['T-1', null, 'skipped'], 'claude agents didn\'t answer: nothing is judged stopped');
  assert.equal(s.launched.length, 0);
});

test('a resume that fails is kept on the task, which needs you; one whose agent came back meanwhile just waits', () => {
  const s = stoppedSetup();
  const back = s.pass([], { steps: { resume: () => { throw new AccError('agent-active', 'T-1\'s agent is still working.'); } } });
  assert.deepEqual([brief(back.steps)[0], back.steps[0]!.reason], [['T-1', 'resume', 'waiting'], 'T-1\'s agent is still working. Autopilot looks again next pass.']);
  assert.equal(first(s.paths).autopilot, undefined, 'nothing recorded');
  const failed = s.pass([], { steps: { resume: () => { throw new AccError('resume', 'Claude Code didn\'t start.'); } } });
  assert.deepEqual(brief(failed.steps)[0], ['T-1', 'resume', 'failed']);
  const t = first(s.paths);
  assert.deepEqual(t.autopilot?.failed, { step: 'resume', sha: s.sha, state: 'running', reason: 'Claude Code didn\'t start.', at: new Date(s.clock.at).toISOString() });
  assert.equal(displayState(readLedger(s.paths.ledger), t), 'needs-you');
  assert.deepEqual(autopilotEvent(events(s.paths).at(-1)!)?.step, 'resume');
  const waits = s.pass();
  assert.deepEqual(brief(waits.steps)[0], ['T-1', null, 'waiting']);
  assert.match(waits.steps[0]!.reason, /^Autopilot couldn't resume [0-9a-f]{7}: Claude Code didn't start\. It waits for a person, or a new commit\.$/);
  assert.equal(s.launched.length, 0);
});

test('the next step for a running task: working, stopped, or stopped again', () => {
  const s = stoppedSetup();
  const t = first(s.paths);
  const l = readLedger(s.paths.ledger);
  const facts = (stopped: boolean): TaskFacts => ({ head: s.sha, verdict: null, reviewing: null, landed: null, stopped });
  assert.deepEqual(nextStep(l, s.config, t, facts(false)), { step: null, outcome: 'skipped', reason: 'Its builder is working.' });
  assert.deepEqual(nextStep(l, s.config, t, facts(true)), { step: 'resume', outcome: null, reason: 'Its agent stopped before acc done or acc block.' });
  const resumed = { ...t, run: { ...t.run, resumes: [{ at: now().toISOString(), actor: 'orchestrator' as const, by: AUTOPILOT_BY }] } };
  assert.equal(nextStep(l, s.config, resumed, facts(true)).outcome, 'waiting');
  // What taskFacts finds, from the sessions listed.
  assert.equal(taskFacts(s.paths, t, run, [], now()).stopped, true);
  assert.equal(taskFacts(s.paths, t, run, null, now()).stopped, false);
  assert.equal(taskFacts(s.paths, t, run, [], now()).head, s.sha);
});

// ---------------------------------------------------------------- checks that failed on GitHub (D-076)

const failing = (sha = HEAD, ...names: string[]): NonNullable<TaskFacts['checks']> => ({
  sha, required: true, pending: [], cancelled: [], count: names.length || 1,
  failed: (names.length ? names : ['build']).map((n) => ({ name: n, workflow: 'CI', link: `https://github.com/acme/tool/actions/runs/1/job/${n.length}`, job: { repo: 'acme/tool', id: String(n.length) } })),
});
const landedAt = (extra: Record<string, unknown> = {}) => ledgerOf({ id: 'T-1', state: 'review', pr: pr({ sha: HEAD, ...extra }) });
const passed = (f: Partial<TaskFacts> = {}) => facts({ verdict: 'pass', landed: HEAD, ...f });

test('in review, passed and landed: checks that failed on GitHub send it back; ones still running wait, and record nothing (D-076)', () => {
  const l = landedAt();
  const t = l.tasks[0]!;
  assert.deepEqual(decide(l, 'T-1', passed({ checks: failing(HEAD, 'build', 'lint') })), ['checks', null]);
  assert.equal(nextStep(l, RULES_CONFIG, t, passed({ checks: failing(HEAD, 'build', 'lint') })).reason, 'Checks failed on GitHub on aaaaaaa: build, lint.');
  assert.deepEqual(nextStep(l, RULES_CONFIG, t, passed({ checks: { ...failing(), failed: [], pending: ['e2e'] } })), { step: null, outcome: 'waiting', reason: 'Checks are still running on GitHub: e2e.' });
  assert.deepEqual(decide(l, 'T-1', passed({ checks: { ...failing(), pending: ['e2e'] } })), [null, 'waiting'], 'failed and still running: it waits for all of them');
  assert.deepEqual(decide(l, 'T-1', passed({ checks: { ...failing(), failed: [] } })), [null, 'skipped'], 'all passed');
  assert.deepEqual(decide(l, 'T-1', passed({ checks: failing(OLDER) })), [null, 'waiting'], 'GitHub has another commit: a land or a person first');
  assert.deepEqual(decide(l, 'T-1', passed({ landed: OLDER, checks: failing() })), ['land', null], 'behind its branch: the land comes first');
  assert.deepEqual(decide(landedAt({ conflicts: ['sum.js'] }), 'T-1', passed({ checks: failing() })), ['refresh', null], 'a conflict comes first');
  assert.deepEqual(decide(l, 'T-1', facts({ verdict: 'changes', landed: HEAD, checks: failing() })), [null, 'waiting'], 'its review asked for changes: a person decides');

  // A check that isn't an Actions job keeps no log on GitHub: alone, it needs a person, as before (D-033).
  const status = { ...failing(), failed: [{ name: 'ci/jenkins', workflow: '', link: 'https://jenkins.acme.example/job/77', job: null }] };
  const d = nextStep(l, RULES_CONFIG, t, passed({ checks: status }));
  assert.deepEqual([d.step, d.outcome, d.record], [null, 'waiting', undefined]);
  assert.equal(d.reason, 'Checks failed on GitHub: ci/jenkins. GitHub keeps no log for it, so autopilot doesn\'t send it back: a person decides.');
  assert.deepEqual(decide(l, 'T-1', passed({ checks: { ...failing(), failed: [...failing().failed, ...status.failed] } })), ['checks', null], 'beside an Actions job, it goes back too');
  assert.equal(nextStep(l, RULES_CONFIG, t, passed({ checksError: 'gh couldn\'t read pull request #7\'s checks: unknown flag: --json' })).reason,
    'Autopilot couldn\'t read pull request #7\'s checks on GitHub: gh couldn\'t read pull request #7\'s checks: unknown flag: --json. It tries again next pass.');
});

test('once a commit: failing again on a commit autopilot sent back is written down for a person; a new commit gets another go; 3 a task (D-076)', () => {
  const l = landedAt();
  const t = l.tasks[0]!;
  t.autopilot = { failed: null, sentBack: { sha: HEAD, checks: ['build'], at: now().toISOString() } };
  const d = nextStep(l, RULES_CONFIG, t, passed({ checks: failing() }));
  assert.deepEqual([d.step, d.outcome, d.record], [null, 'waiting', { step: 'checks', reason: 'Checks failed on GitHub again: build. Autopilot already sent aaaaaaa back once: a person decides.' }]);
  // Written down, it waits on later passes, as any failed step does.
  t.autopilot.failed = { step: 'checks', sha: HEAD, state: 'review', reason: d.record!.reason, at: now().toISOString() };
  const held = nextStep(l, RULES_CONFIG, t, passed());
  assert.deepEqual([held.step, held.outcome, held.record], [null, 'waiting', undefined]);
  assert.equal(held.reason, 'Autopilot couldn\'t send aaaaaaa back for its failing checks: Checks failed on GitHub again: build. Autopilot already sent aaaaaaa back once: a person decides. It waits for a person, or a new commit.');
  assert.equal(displayState(l, t), 'needs-you');
  // A new commit, landed, failing: back again.
  t.pr = pr({ sha: OLDER });
  const newer = passed({ head: OLDER, landed: OLDER, checks: failing(OLDER) });
  assert.deepEqual(decide(l, 'T-1', newer), ['checks', null]);
  // A task's fourth send-back waits for a person.
  const sent = { at: now().toISOString(), actor: 'orchestrator' as const, by: AUTOPILOT_BY, from: 'review' as const, to: 'rework' as const, reason: 'Checks failed on GitHub.' };
  t.history.push(sent, sent);
  assert.deepEqual(decide(l, 'T-1', newer), ['checks', null], 'two so far');
  t.history.push(sent);
  assert.deepEqual(nextStep(l, RULES_CONFIG, t, newer).record, { step: 'checks', reason: 'Checks failed on GitHub: build. Autopilot sent T-1 back for failing checks 3 times already: a person decides.' });
});

test('in rework: autopilot\'s send-back for failing checks is re-dispatched, apart from a review\'s one re-dispatch (D-076)', () => {
  let n = 0;
  const move = (actor: 'orchestrator' | 'reviewer' | 'builder' | 'human', by: string, from: State, to: State) => ({ at: new Date(Date.parse('2026-10-05T10:00:00Z') + ++n * 60_000).toISOString(), actor, by, from, to, reason: 'x' });
  const back = () => move('orchestrator', AUTOPILOT_BY, 'review', 'rework');
  const review = () => move('reviewer', `reviewer:T-1 for ${AUTOPILOT_BY}`, 'review', 'rework');
  const redispatch = () => move('orchestrator', AUTOPILOT_BY, 'rework', 'running');
  const built = () => move('builder', 'builder:T-1', 'running', 'review');

  // A review's rework, re-dispatched once already: then its checks fail, and that send-back still goes.
  const l = ledgerOf({ id: 'T-1', state: 'rework' });
  const t = l.tasks[0]!;
  t.autopilot = { failed: null, sentBack: { sha: HEAD, checks: ['build', 'lint'], at: now().toISOString() } };
  t.history.push(review(), redispatch(), built(), back());
  assert.equal(reworkCause(t), 'checks');
  assert.deepEqual(nextStep(l, RULES_CONFIG, t, facts()), { step: 'dispatch', outcome: null, reason: 'Checks failed on GitHub: build, lint.' });
  assert.deepEqual(failedChecks(t), ['build', 'lint']);

  // Re-dispatched for its checks, then a review asks for changes: that review's rework has its own one.
  const m = ledgerOf({ id: 'T-1', state: 'rework' });
  const u = m.tasks[0]!;
  u.history.push(back(), redispatch(), built(), review());
  assert.equal(reworkCause(u), 'review');
  assert.equal(reworkedByAutopilot(u), false, 'the checks re-dispatch isn\'t the review\'s');
  assert.deepEqual(nextStep(m, RULES_CONFIG, u, facts()), { step: 'dispatch', outcome: null, reason: 'The reviewer asked for changes.' });
  assert.equal(failedChecks(u), null, 'a review\'s rework names no checks');
  const second = redispatch();
  u.history.push(second, built(), review());
  assert.equal(reworkedByAutopilot(u), true);
  assert.equal(reworkedByAutopilot(u, second.at), false, 'not before its own re-dispatch');
  assert.deepEqual(decide(m, 'T-1', facts()), [null, 'waiting'], 'a second review rework waits for a person');
  // A person's move to rework is a review's, not autopilot's send-back.
  assert.equal(reworkCause({ history: [move('human', 'human:jordan', 'review', 'rework')] }), 'review');
});

test('autopilot asks GitHub about checks only for a task it could send back, and not once acc sync saw them pass (D-076)', () => {
  const s = setup();
  passReview(s.paths, s.id, s.sha);
  edit(s.paths, (l) => { l.tasks[0]!.pr = { number: 42, url: 'https://github.com/acme/tool/pull/42', state: 'open', sha: s.sha, ci: 'passing' }; });
  const calls: string[] = [];
  const gh = { repo: 'acme/tool', env: () => ({ GH_TOKEN: 'gho_token' }) };
  const r = deps(calls, github(s.sha, [check('build', 'fail')])).run;
  assert.equal(taskFacts(s.paths, first(s.paths), r, null, now(), gh).checks, undefined);
  assert.ok(!calls.some((c) => c.startsWith('gh ')), 'acc sync saw them pass: no gh call');
  edit(s.paths, (l) => { delete l.tasks[0]!.pr!.ci; });
  const f = taskFacts(s.paths, first(s.paths), r, null, now(), gh);
  assert.deepEqual([f.checks?.sha, f.checks?.failed.map((c) => c.name)], [s.sha, ['build']]);
  // A failure it can send back is read again each pass; checks that passed, or failed with no log, are
  // read once a commit, even without acc sync: a quiet board makes no calls.
  const quiet = deps(calls, github(s.sha, [check('build', 'pass'), check('vercel', 'fail', { workflow: '', link: 'https://vercel.com/acme/tool/preview' })])).run;
  taskFacts(s.paths, first(s.paths), quiet, null, now(), gh);
  const asked = calls.filter((c) => c.startsWith('gh pr checks')).length;
  const again = taskFacts(s.paths, first(s.paths), quiet, null, now(), gh);
  assert.deepEqual(again.checks?.failed.map((c) => c.name), ['vercel'], 'what it read before');
  assert.equal(calls.filter((c) => c.startsWith('gh pr checks')).length, asked, 'no second read of a settled commit');
  assert.equal(taskFacts(s.paths, first(s.paths), r).checks, undefined, 'without GitHub, nothing is asked');
  // A new commit, not landed or reviewed yet: nothing asked.
  s.commit('more.js', 'x\n');
  const before = calls.length;
  assert.equal(taskFacts(s.paths, first(s.paths), r, null, now(), gh).checks, undefined);
  assert.ok(!calls.slice(before).some((c) => c.startsWith('gh ')));
});

test('a pull request whose checks failed goes back to its builder with what they said, and the next pass re-dispatches it (D-076)', () => {
  const s = setup();
  passReview(s.paths, s.id, s.sha);
  edit(s.paths, (l) => { l.tasks[0]!.pr = { number: 42, url: 'https://github.com/acme/tool/pull/42', state: 'open', sha: s.sha, landedAt: now().toISOString(), ci: 'failing', failing: ['build'] }; });
  const sha7 = s.sha.slice(0, 7);
  assert.equal(displayState(readLedger(s.paths.ledger), first(s.paths)), 'needs-you', 'acc sync saw them fail');
  const log = 'build\tRun npm test\t2026-10-05T11:59:00.0000000Z \x1b[31mnot ok 1 - sum adds\x1b[0m\nbuild\tRun npm test\t2026-10-05T11:59:01.0000000Z # fail 1\n';
  const calls: string[] = [];
  const reads: [string, string | undefined][] = [];
  const base = deps(calls, github(s.sha, [check('build', 'fail'), check('lint', 'pass'), check('docs', 'skipping'), check('preview', 'cancel')], { 'gh run view --job 5 --log-failed': ok(log) }));
  const watched: AutopilotDeps = { ...base, run: (cmd, args, opts) => { if (cmd === 'gh') reads.push([args.slice(0, 2).join(' '), opts?.env?.GH_TOKEN]); return base.run(cmd, args, opts); } };
  const sent = autopilotPass(s.paths, s.config, watched);
  assert.deepEqual(brief(sent.steps)[0], ['T-1', 'checks', 'done']);
  assert.equal(sent.steps[0]!.reason, `Sent it back to its builder: checks failed on GitHub on ${sha7}: build.`);
  const t = first(s.paths);
  assert.equal(t.state, 'rework');
  assert.deepEqual(t.history.at(-1), { at: now().toISOString(), actor: 'orchestrator', by: AUTOPILOT_BY, from: 'review', to: 'rework', reason: `Checks failed on GitHub on ${sha7}: build.` });
  assert.deepEqual(t.autopilot, { failed: null, sentBack: { sha: s.sha, checks: ['build'], at: now().toISOString() } });
  const report = JSON.parse(readFileSync(checksPath(s.paths, 'T-1', s.sha), 'utf8'));
  assert.deepEqual([report.sha, report.pr, report.required], [s.sha, { number: 42, url: 'https://github.com/acme/tool/pull/42' }, true]);
  assert.deepEqual(report.checks, [{ name: 'build', workflow: 'CI', link: 'https://github.com/acme/tool/actions/runs/7/job/5', log: 'not ok 1 - sum adds\n# fail 1', noLog: null }], 'cancelled and skipped checks aren\'t failures');
  // It only read GitHub, as the repo's account: no edit, comment, re-run or write.
  assert.deepEqual([...new Set(reads.map(([c]) => c))].sort(), ['auth token', 'pr checks', 'pr view', 'run view']);
  assert.ok(reads.filter(([c]) => c !== 'auth token').every(([, token]) => token === 'gho_token'), 'every read as the repo\'s account');
  assert.ok(!calls.some((c) => /^gh (pr (edit|comment|create|merge|close|review|ready)|run (rerun|cancel)|api|issue)/.test(c)), 'nothing changed on GitHub');
  assert.ok(!calls.some((c) => c.startsWith('git push')), 'nothing pushed');
  // Its move is autopilot's send-back, for History and notices; the rework names the checks.
  const moved = events(s.paths).find((e) => e.type === 'task.moved' && e.data.to === 'rework')!;
  assert.deepEqual(autopilotEvent(moved), { seq: moved.seq, at: now().toISOString(), task: 'T-1', step: 'checks', outcome: 'done', checks: ['build'], reason: `Checks failed on GitHub on ${sha7}: build.` });
  assert.equal(displayState(readLedger(s.paths.ledger), t), 'rework');
  assert.deepEqual(failedChecks(t), ['build']);

  // The next pass re-dispatches it, with what GitHub's checks said in its packet.
  const again = autopilotPass(s.paths, s.config, deps(calls));
  assert.deepEqual(brief(again.steps)[0], ['T-1', 'dispatch', 'done']);
  assert.match(again.steps[0]!.reason, /^Re-dispatched for its failing checks in /);
  const packet = readFileSync(join(s.paths.packets, 'T-1.md'), 'utf8');
  for (const must of ['## What GitHub\'s checks said', `failed on GitHub on ${sha7}: build`, 'https://github.com/acme/tool/actions/runs/7/job/5', 'not ok 1 - sum adds', 'run `acc block "<what you found>"` and stop']) assert.ok(packet.includes(must), must);
  assert.ok(!packet.includes('What the review asked for'), 'its review passed');
  assert.match(calls.filter((c) => c.startsWith('claude --bg')).at(-1)!, /What GitHub's checks said/, 'its builder is told');
  const redispatched = events(s.paths).filter((e) => e.type === 'task.moved').at(-1)!;
  assert.deepEqual([redispatched.data.from, redispatched.data.cause], ['rework', 'checks']);
  assert.equal(autopilotEvent(redispatched)?.cause, 'checks');

  // A person's rework at that same commit has its own reasons: the checks report isn't in its packet.
  edit(s.paths, (l) => {
    const x = l.tasks[0]!;
    x.state = 'rework';
    x.history.push({ at: now().toISOString(), actor: 'human', by: 'human:jordan', from: 'review', to: 'rework', reason: 'Rename the helper.' });
  });
  assert.deepEqual(brief(autopilotPass(s.paths, s.config, deps(calls)).steps)[0], ['T-1', 'dispatch', 'done']);
  assert.ok(!readFileSync(join(s.paths.packets, 'T-1.md'), 'utf8').includes('What GitHub\'s checks said'), 'not autopilot\'s send-back, so not its report');
});

test('checks failing again on the commit autopilot sent back wait for a person, and a new commit is sent back again (D-076)', () => {
  const s = setup();
  passReview(s.paths, s.id, s.sha);
  const sha7 = s.sha.slice(0, 7);
  const at = now().toISOString();
  // Sent back once and re-dispatched; its builder finished without a new commit.
  edit(s.paths, (l) => {
    const t = l.tasks[0]!;
    t.pr = { number: 42, url: 'https://github.com/acme/tool/pull/42', state: 'open', sha: s.sha, ci: 'failing', failing: ['build'] };
    t.autopilot = { failed: null, sentBack: { sha: s.sha, checks: ['build'], at } };
    t.history.push(
      { at, actor: 'orchestrator', by: AUTOPILOT_BY, from: 'review', to: 'rework', reason: 'Checks failed on GitHub.' },
      { at, actor: 'orchestrator', by: AUTOPILOT_BY, from: 'rework', to: 'running', reason: null },
      { at, actor: 'builder', by: 'builder:T-1', from: 'running', to: 'review', reason: null },
    );
  });
  // While its fix is in review, acc sync's failing checks on the commit already sent back don't need you.
  assert.equal(displayState(readLedger(s.paths.ledger), first(s.paths)), 'review');
  const calls: string[] = [];
  const gh = github(s.sha, [check('build', 'fail')], { 'gh run view': ok('build\tRun\t2026-10-05T11:00:00Z still failing\n') });
  const r = autopilotPass(s.paths, s.config, deps(calls, gh));
  assert.deepEqual(brief(r.steps)[0], ['T-1', 'checks', 'failed']);
  assert.equal(r.steps[0]!.reason, `Checks failed on GitHub again: build. Autopilot already sent ${sha7} back once: a person decides.`);
  const t = first(s.paths);
  assert.deepEqual([t.state, t.autopilot?.failed?.step, t.autopilot?.failed?.sha, t.autopilot?.sentBack?.sha], ['review', 'checks', s.sha, s.sha], 'what it sent back is kept beside the failure');
  assert.equal(displayState(readLedger(s.paths.ledger), t), 'needs-you');
  assert.ok(!calls.some((c) => c.startsWith('gh run view')), 'nothing to send, so no log read');
  assert.deepEqual(autopilotEvent(events(s.paths).at(-1)!)?.step, 'checks');

  const before = calls.length;
  const held = autopilotPass(s.paths, s.config, deps(calls, gh));
  assert.deepEqual(brief(held.steps)[0], ['T-1', null, 'waiting']);
  assert.match(held.steps[0]!.reason, /^Autopilot couldn't send [0-9a-f]{7} back for its failing checks: Checks failed on GitHub again/);
  assert.ok(!calls.slice(before).some((c) => c.startsWith('gh ')), 'GitHub isn\'t asked again about that commit');

  // A new commit, reviewed and landed, whose checks fail too: back again.
  const sha2 = s.commit('sum.test.js', 'test("sum", () => {});\n');
  passReview(s.paths, s.id, sha2);
  edit(s.paths, (l) => { l.tasks[0]!.pr = { ...l.tasks[0]!.pr!, sha: sha2 }; });
  const next = autopilotPass(s.paths, s.config, deps(calls, github(sha2, [check('build', 'fail')], { 'gh run view': ok('build\tRun\t2026-10-05T11:00:00Z still failing\n') })));
  assert.deepEqual(brief(next.steps)[0], ['T-1', 'checks', 'done']);
  assert.deepEqual([first(s.paths).state, first(s.paths).autopilot?.sentBack?.sha], ['rework', sha2]);
});

test('what moved on between autopilot\'s look and its send-back only waits: a push, or checks running again (D-076)', () => {
  const s = setup();
  passReview(s.paths, s.id, s.sha);
  edit(s.paths, (l) => { l.tasks[0]!.pr = { number: 42, url: 'https://github.com/acme/tool/pull/42', state: 'open', sha: s.sha }; });
  let views = 0;
  // Someone pushes to the pull request on GitHub while the logs are read.
  const pushed = deps([], { ...github(s.sha, [check('build', 'fail')], { 'gh run view': ok('x\n') }), 'gh pr view': () => ok(JSON.stringify({ headRefOid: ++views < 3 ? s.sha : 'c'.repeat(40) })) });
  const r = autopilotPass(s.paths, s.config, pushed);
  assert.deepEqual([brief(r.steps)[0], r.steps[0]!.reason], [['T-1', 'checks', 'waiting'], `Pull request #42 is at ccccccc on GitHub, not ${s.sha.slice(0, 7)}. Autopilot looks again next pass.`]);
  const t = first(s.paths);
  assert.deepEqual([t.state, t.autopilot], ['review', undefined], 'nothing recorded, nothing moved');
  // Re-run, they're running again by the time it reads them a second time.
  let lists = 0;
  const rerun = deps([], { ...github(s.sha, []), 'gh pr checks': () => ok(JSON.stringify([check('build', ++lists === 1 ? 'fail' : 'pending')])) });
  const w = autopilotPass(s.paths, s.config, rerun);
  assert.deepEqual([brief(w.steps)[0], w.steps[0]!.reason], [['T-1', 'checks', 'waiting'], 'Checks are still running on GitHub: build. Autopilot looks again next pass.']);
  assert.equal(first(s.paths).state, 'review');
});

test('autopilot\'s send-back and its re-dispatch read back as what they were for, not as a review (D-076)', () => {
  const at = now().toISOString();
  const moved = (by: string, data: Record<string, unknown>) => autopilotEvent({ seq: 1, at, type: 'task.moved', task: 'T-1', by, data });
  const reason = 'Checks failed on GitHub on abc1234: build, lint.';
  assert.deepEqual(moved(AUTOPILOT_BY, { from: 'review', to: 'rework', reason, checks: ['build', 'lint'], sha: 'abc' }), { seq: 1, at, task: 'T-1', step: 'checks', outcome: 'done', checks: ['build', 'lint'], reason });
  assert.deepEqual(moved(`reviewer:T-1 for ${AUTOPILOT_BY}`, { from: 'review', to: 'rework', reason: 'Review asked for changes: no test.' }), { seq: 1, at, task: 'T-1', step: 'review', outcome: 'done', verdict: 'changes', reason: 'no test.' });
  assert.equal(moved('human:jordan', { from: 'review', to: 'rework', reason: 'x' }), null);
  assert.equal(moved(AUTOPILOT_BY, { from: 'rework', to: 'running', cause: 'checks' })?.cause, 'checks');
  assert.deepEqual(moved(AUTOPILOT_BY, { from: 'rework', to: 'running' }), { seq: 1, at, task: 'T-1', step: 'dispatch', outcome: 'done' }, 'one from before says nothing of its cause');
  const updated = (data: Record<string, unknown>) => autopilotEvent({ seq: 2, at, type: 'task.updated', task: 'T-1', by: AUTOPILOT_BY, data });
  assert.deepEqual(updated({ autopilot: { failed: { step: 'checks', reason: 'Checks failed on GitHub again: build.' } } }), { seq: 2, at, task: 'T-1', step: 'checks', outcome: 'failed', reason: 'Checks failed on GitHub again: build.' });
  assert.equal(updated({ autopilot: { sentBack: { sha: 'abc', checks: ['build'], at } } }), null, 'its send-back is told by its move');
});

// ---------------------------------------------------------------- auto-merge (GH-67)

const MERGE_CONFIG = parseConfig({
  ...GENERIC_CONFIG, autonomy: 'review', agents: { max: 2 }, autopilot: { autoMerge: true },
  environments: [{ name: 'main', default: true }, { name: 'release', protected: true }],
}).config as Config;
const green = (sha = HEAD, more: Partial<NonNullable<TaskFacts['checks']>> = {}): NonNullable<TaskFacts['checks']> => ({ sha, required: true, pending: [], failed: [], cancelled: [], count: 1, ...more });
const mergeable = (f: Partial<TaskFacts> = {}) => passed({ checks: green(), ...f });
const decideMerge = (l: Ledger, f: TaskFacts, config = MERGE_CONFIG) => nextStep(l, config, l.tasks[0]!, f);

test('auto-merge on: a pull request reviewed, landed and green at its latest commit joins the merge queue; off, or protected, it\'s up to date and nothing more (GH-67, GH-73)', () => {
  const l = landedAt();
  assert.deepEqual(decideMerge(l, mergeable()), { step: null, outcome: 'waiting', reason: 'Pull request #7 passed its review and its checks on aaaaaaa: it joins the merge queue.', queue: 'in' });
  assert.deepEqual(decide(l, 'T-1', mergeable()), [null, 'skipped'], 'off: as before');
  assert.equal(decideMerge(l, mergeable(), { ...MERGE_CONFIG, autonomy: 'manual' }).queue, undefined, 'only under review');
  // A task whose environment was marked protected after it was built.
  const guarded = ledgerOf({ id: 'T-1', state: 'review', environment: 'release', pr: pr({ sha: HEAD }) });
  assert.deepEqual([decideMerge(guarded, mergeable()).step, decideMerge(guarded, mergeable()).outcome, decideMerge(guarded, mergeable()).queue], [null, 'skipped', undefined]);
  // Before that: its review, its land and failing checks come first, as before.
  assert.equal(decideMerge(l, facts({ checks: green() })).step, 'review');
  assert.equal(decideMerge(l, mergeable({ verdict: 'changes' })).outcome, 'waiting');
  assert.equal(decideMerge(l, mergeable({ landed: OLDER })).step, 'land');
  assert.equal(decideMerge(l, mergeable({ checks: failing() })).step, 'checks');
  // A conflict isn't refreshed at once, as with auto-merge off (D-058): it waits its turn in the queue.
  assert.deepEqual([decideMerge(landedAt({ conflicts: ['sum.js'] }), mergeable()).step, decideMerge(landedAt({ conflicts: ['sum.js'] }), mergeable()).queue], [null, 'in']);
  // Already in the queue at this commit, or at the queue's own merge on it: it keeps its place.
  l.tasks[0]!.autopilot = { failed: null, queued: { at: now().toISOString(), sha: HEAD, phase: 'waiting' } };
  assert.deepEqual(decideMerge(l, mergeable()), { step: null, outcome: 'waiting', reason: 'In the merge queue.', queue: 'in' });
});

test('auto-merge: what keeps a pull request out of the merge queue, what holds its place, and what makes it leave (GH-67, GH-73)', () => {
  const l = landedAt();
  const t = l.tasks[0]!;
  const why = (f: TaskFacts) => {
    const d = decideMerge(l, f);
    assert.notEqual(d.queue, 'in', d.reason);
    return [d.step, d.outcome, d.reason, d.queue ?? null];
  };
  // Waits that settle by themselves hold its place: GitHub's checks running, gh not answering, or none
  // reported yet. Those on GitHub's checks say so, for the head of the queue to show.
  assert.deepEqual(why(mergeable({ checks: green(HEAD, { pending: ['e2e'] }) })), [null, 'waiting', 'Checks are still running on GitHub: e2e.', 'hold']);
  assert.deepEqual(why(mergeable({ checks: undefined })), [null, 'waiting', 'Autopilot hasn\'t read pull request #7\'s checks on GitHub yet.', 'hold']);
  assert.deepEqual(why(mergeable({ checksError: 'HTTP 502' })), [null, 'waiting', 'Autopilot couldn\'t read pull request #7\'s checks on GitHub: HTTP 502. It tries again next pass.', 'hold']);
  assert.deepEqual(why(mergeable({ checks: green(HEAD, { count: 0, required: false }), noChecksYet: true })), [null, 'waiting', 'GitHub reports no checks on pull request #7 yet. Autopilot gives them 2 minutes after a land.', 'hold']);
  assert.deepEqual([mergeable({ checks: green(HEAD, { pending: ['e2e'] }) }), mergeable({ checks: green(HEAD, { count: 0, required: false }), noChecksYet: true }), mergeable({ checksError: 'HTTP 502' }), mergeable({ checks: undefined })].map((f) => decideMerge(l, f).checks ?? null), [true, true, null, null]);
  // GitHub has another commit, such as one Update branch made: its checks say nothing of this one, and it
  // never settles by itself. It's in: its turn fetches the branch, and a commit this clone lacks needs you.
  assert.deepEqual(decideMerge(l, mergeable({ checks: green(OLDER, { cancelled: ['preview'], count: 0 }) })), { step: null, outcome: 'waiting', reason: 'Pull request #7 is at bbbbbbb on GitHub, not aaaaaaa, the commit acc landed: at its turn the merge queue fetches it, and a commit this clone lacks needs a person.', queue: 'in' });
  assert.equal(why(mergeable({ checks: green(HEAD, { count: 0, required: true }) }))[3], 'hold');
  assert.equal(decideMerge(l, mergeable({ checks: green(HEAD, { count: 0, required: false }) })).queue, 'in', 'after the grace');
  // One that conflicts gets no checks from GitHub until its base is merged in, which its turn does: it
  // joins at once, with none to wait for.
  const conflicting = landedAt({ conflicts: ['sum.js'] });
  assert.deepEqual(decideMerge(conflicting, mergeable({ checks: green(HEAD, { count: 0, required: false }), noChecksYet: true })), { step: null, outcome: 'waiting', reason: 'Pull request #7 passed its review and its checks on aaaaaaa: it joins the merge queue.', queue: 'in' });
  assert.equal(decideMerge(conflicting, mergeable({ checks: green(HEAD, { count: 0, required: true }) })).queue, 'in');
  assert.equal(decideMerge(conflicting, mergeable({ checks: green(HEAD, { pending: ['e2e'] }) })).queue, 'hold', 'checks GitHub did start still settle first');
  // Anything waiting on a person makes it leave.
  const logless = green(HEAD, { failed: [{ name: 'ci/jenkins', workflow: '', link: 'https://jenkins.acme.example/job/1', job: null }] });
  const noLog = why(mergeable({ checks: logless }));
  assert.deepEqual([noLog[0], noLog[1], noLog[3]], [null, 'waiting', null], 'a failure with no log: a person decides');
  // A cancelled check isn't a pass: written down, and the task needs you.
  const cancelled = decideMerge(l, mergeable({ checks: green(HEAD, { cancelled: ['preview'] }) }));
  assert.deepEqual(cancelled.record, { step: 'merge', reason: 'Checks were cancelled on GitHub: preview. Run them again, or merge it yourself.' });
  // A person asked for changes on GitHub.
  t.pr = pr({ sha: HEAD, changesRequested: true });
  assert.deepEqual(why(mergeable()), [null, 'waiting', 'A person asked for changes on pull request #7, so autopilot doesn\'t merge it.', null]);
  t.pr = pr({ sha: HEAD });
  // An agent in its worktree asks a person something: it never joins, and in the queue, it leaves.
  assert.deepEqual(why(mergeable({ asking: true })), [null, 'waiting', 'An agent in T-1\'s worktree is waiting for your answer: it joins the merge queue once you\'ve answered.', null]);
  t.autopilot = { failed: null, queued: { at: now().toISOString(), sha: HEAD, phase: 'waiting' } };
  assert.equal(decideMerge(l, mergeable({ asking: true })).queue, undefined);
  t.autopilot = undefined;
  // Something autopilot couldn't do waits on a person first.
  t.autopilot = { failed: { step: 'land', sha: OLDER, state: 'review', reason: 'git push refused', at: now().toISOString() } };
  assert.deepEqual(why(mergeable()), [null, 'waiting', 'Autopilot couldn\'t land bbbbbbb: a person decides before it merges.', null]);
  // A merge, or a turn in the queue, that failed isn't tried again on that commit.
  t.autopilot = { failed: { step: 'merge', sha: HEAD, state: 'review', reason: 'GitHub won\'t merge pull request #7: main\'s rules block it.', at: now().toISOString() } };
  assert.deepEqual(why(mergeable()), [null, 'waiting', 'Autopilot couldn\'t merge aaaaaaa: GitHub won\'t merge pull request #7: main\'s rules block it. It waits for a person, or a new commit.', null]);
  t.autopilot = { failed: { step: 'queue', sha: HEAD, state: 'review', reason: 'Its worktree has changes nobody committed.', at: now().toISOString() } };
  assert.deepEqual(why(mergeable()), [null, 'waiting', 'Autopilot couldn\'t take aaaaaaa through the merge queue: Its worktree has changes nobody committed. It waits for a person, or a new commit.', null]);
  // Merged: it waits for acc sync, and isn't merged again.
  t.autopilot = { failed: null, merged: { sha: HEAD, pr: { number: 7, url: 'u' }, method: 'merge', at: now().toISOString() } };
  assert.deepEqual(why(mergeable()), [null, 'skipped', 'Autopilot merged pull request #7. acc sync moves it to done.', null]);
  // A change to .acc/ is a person's to merge: asked only as it would join.
  t.autopilot = undefined;
  let asked = 0;
  const acc = () => { asked++; return ['.acc/config.json']; };
  assert.deepEqual(decideMerge(l, mergeable({ accChanges: acc })).record, { step: 'merge', reason: 'It changes .acc/, which a person merges: .acc/config.json.' });
  decideMerge(l, mergeable({ checks: green(HEAD, { pending: ['e2e'] }), accChanges: acc }));
  t.autopilot = { failed: null, queued: { at: now().toISOString(), sha: HEAD, phase: 'github' } };
  assert.equal(decideMerge(l, mergeable({ accChanges: acc })).queue, 'in', 'in the queue already: the merge asks again');
  assert.equal(asked, 1);
});

/** GitHub as gh reads it when autopilot merges: the pull request open at `head` and mergeable, its checks passed, merge commits allowed. */
const merging = (head: string, checks: unknown[] = [check('test', 'pass')]): Record<string, RunResult | ((o?: RunOptions) => RunResult)> => ({
  'gh pr view': ok(JSON.stringify({ state: 'OPEN', headRefOid: head, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: null, baseRefName: 'main', isDraft: false })),
  'gh pr checks': ok(JSON.stringify(checks)),
  'gh repo view': ok(JSON.stringify({ mergeCommitAllowed: true, squashMergeAllowed: false, rebaseMergeAllowed: false })),
  'gh pr merge': ok(''),
});
const QUESTIONS = tempDir('questions-');

test('auto-merge off: a landed pull request whose checks passed is left for a person, and nothing more is asked of GitHub (GH-67)', () => {
  const s = setup();
  passReview(s.paths, s.id, s.sha);
  gitIn(s.dir, 'push', '-q', 'origin', `${BRANCH}:${BRANCH}`);
  edit(s.paths, (l) => { l.tasks[0]!.pr = { number: 42, url: 'https://github.com/acme/tool/pull/42', state: 'open', sha: s.sha, landedAt: '2026-10-05T10:00:00.000Z' }; });
  const calls: string[] = [];
  const r = autopilotPass(s.paths, s.config, { ...deps(calls, merging(s.sha)), env: { ACC_QUESTIONS_DIR: QUESTIONS } });
  assert.deepEqual([brief(r.steps)[0], r.steps[0]!.reason], [['T-1', null, 'skipped'], `Pull request #42 is up to date with ${s.sha.slice(0, 7)}.`]);
  assert.ok(!calls.some((c) => c.startsWith('gh pr merge') || c.startsWith('gh repo view') || c.startsWith('git fetch')), 'no merge, no method, no fetch');
  // acc sync saw them pass: GitHub isn't asked at all, as before (D-076).
  edit(s.paths, (l) => { l.tasks[0]!.pr!.ci = 'passing'; });
  const quiet: string[] = [];
  autopilotPass(s.paths, s.config, { ...deps(quiet, merging(s.sha)), env: { ACC_QUESTIONS_DIR: QUESTIONS } });
  assert.ok(!quiet.some((c) => c.startsWith('gh ') || c.startsWith('git fetch')));
});

test('auto-merge on: a green pull request joins the merge queue and, at the head and up to date, merges; later passes leave it, and acc sync moves it to done with its update (GH-67, GH-73)', () => {
  const s = setup({ source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, raw: { autopilot: { autoMerge: true } } });
  passReview(s.paths, s.id, s.sha);
  gitIn(s.dir, 'push', '-q', 'origin', `${BRANCH}:${BRANCH}`);
  // acc sync last saw its checks pass: with auto-merge on, autopilot reads them all the same.
  edit(s.paths, (l) => { l.tasks[0]!.pr = { number: 42, url: 'https://github.com/acme/tool/pull/42', state: 'open', sha: s.sha, landedAt: '2026-10-05T10:00:00.000Z', ci: 'passing' }; });
  const calls: string[] = [];
  const told: string[] = [];
  const r = autopilotPass(s.paths, s.config, { ...deps(calls, merging(s.sha)), env: { ACC_QUESTIONS_DIR: QUESTIONS }, onStep: (task, step) => told.push(`${task} ${step}`) });
  assert.deepEqual(brief(r.steps)[0], ['ACME-7', 'merge', 'done']);
  assert.deepEqual(r.steps[0]!.pr, { number: 42, url: 'https://github.com/acme/tool/pull/42', opened: false });
  assert.deepEqual(told, ['ACME-7 queue'], 'the merge queue\'s turn, which merged it');
  assert.equal(first(s.paths).autopilot?.queued, null, 'merged, it left the queue');
  assert.deepEqual(calls.filter((c) => c.startsWith('gh pr merge')), [`gh pr merge 42 -R acme/tool --merge --match-head-commit ${s.sha}`]);
  const merged = events(s.paths).at(-1)!;
  assert.deepEqual(autopilotEvent(merged), { seq: merged.seq, at: now().toISOString(), task: 'ACME-7', step: 'merge', outcome: 'done', pr: { number: 42, url: 'https://github.com/acme/tool/pull/42', opened: false } });
  assert.deepEqual(steps(readAutopilotLog(s.paths.events)).at(-1), ['ACME-7', 'merge', 'done', 42]);

  // Until acc sync sees it, later passes leave it, and ask GitHub nothing.
  const later: string[] = [];
  const again = autopilotPass(s.paths, s.config, { ...deps(later, merging(s.sha)), env: { ACC_QUESTIONS_DIR: QUESTIONS } });
  assert.deepEqual([brief(again.steps)[0], again.steps[0]!.reason], [['ACME-7', null, 'skipped'], 'Autopilot merged pull request #42. acc sync moves it to done.']);
  assert.ok(!later.some((c) => c.startsWith('gh ') || c.startsWith('git fetch')));

  // acc sync: merged on GitHub, so done, with the merged update drafted for a person to post (D-066).
  const view = ok(JSON.stringify({ number: 42, state: 'MERGED', url: 'https://github.com/acme/tool/pull/42', mergeCommit: { oid: 'e'.repeat(40) }, statusCheckRollup: [] }));
  const synced = sync(s.paths, s.config, { run: fakeRunner({ 'gh auth token': ok('gho_token\n'), 'gh pr view': view }), now, env: {} });
  assert.deepEqual(synced.changes[0]!.moved, { from: 'review', to: 'done' });
  const t = first(s.paths);
  assert.deepEqual([t.state, t.pr?.state, t.pr?.mergeSha, t.history.at(-1)!.actor], ['done', 'merged', 'e'.repeat(40), 'sync']);
  assert.deepEqual(listUpdates(s.paths).filter((u) => u.event === 'merged').map((u) => [u.key, u.state]), [['ACME-7', 'draft']]);
});

test('auto-merge on: one merge a pass, the head\'s; the next waits behind it (GH-67, GH-73)', () => {
  const s = setup({ raw: { autopilot: { autoMerge: true } } });
  gitIn(s.dir, 'push', '-q', 'origin', `${BRANCH}:${BRANCH}`);
  // T-1 and T-2 are both reviewed, landed and green: T-2 on the same branch, for the test's sake.
  edit(s.paths, (l) => {
    for (const [i, t] of l.tasks.slice(0, 2).entries()) {
      t.state = 'review';
      t.run = { branch: BRANCH, worktree: s.dir };
      t.pr = { number: 42 + i, url: `https://github.com/acme/tool/pull/${42 + i}`, state: 'open', sha: s.sha, landedAt: '2026-10-05T10:00:00.000Z' };
    }
  });
  passReview(s.paths, 'T-1', s.sha);
  passReview(s.paths, 'T-2', s.sha);
  const merged: string[] = [];
  const r = autopilotPass(s.paths, s.config, { ...deps([], merging(s.sha)), env: { ACC_QUESTIONS_DIR: QUESTIONS }, steps: { queue: (id) => { merged.push(id); return { step: 'merge', reason: 'Merged.' }; } } });
  assert.deepEqual(brief(r.steps).slice(0, 2), [['T-1', 'merge', 'done'], ['T-2', null, 'waiting']]);
  assert.equal(r.steps[1]!.reason, 'In the merge queue, 2nd: behind T-1.');
  assert.deepEqual(merged, ['T-1']);
});

test('auto-merge on: a pull request with no checks on GitHub waits 2 minutes after its land, then merges (GH-67)', () => {
  const s = setup({ raw: { autopilot: { autoMerge: true } } });
  passReview(s.paths, s.id, s.sha);
  gitIn(s.dir, 'push', '-q', 'origin', `${BRANCH}:${BRANCH}`);
  edit(s.paths, (l) => { l.tasks[0]!.pr = { number: 42, url: 'https://github.com/acme/tool/pull/42', state: 'open', sha: s.sha, landedAt: '2026-10-05T11:59:00.000Z' }; });
  // gh's reply on a commit with no checks, --required or not: it looks for any before it looks for required ones.
  const none = { ...merging(s.sha), 'gh pr checks': bad(`no checks reported on the '${BRANCH}' branch`) };
  const calls: string[] = [];
  const young = autopilotPass(s.paths, s.config, { ...deps(calls, none), env: { ACC_QUESTIONS_DIR: QUESTIONS } });
  assert.deepEqual([brief(young.steps)[0], young.steps[0]!.reason], [['T-1', null, 'waiting'], 'GitHub reports no checks on pull request #42 yet. Autopilot gives them 2 minutes after a land.']);
  assert.ok(!calls.some((c) => c.startsWith('gh pr merge')));
  // Two and a half minutes after the land, still none: this repo's own pull requests merge like this.
  const later: string[] = [];
  const old = autopilotPass(s.paths, s.config, { ...deps(later, none), now: () => new Date('2026-10-05T12:01:30Z'), env: { ACC_QUESTIONS_DIR: QUESTIONS } });
  assert.deepEqual(brief(old.steps)[0], ['T-1', 'merge', 'done']);
  assert.deepEqual(later.filter((c) => c.startsWith('gh pr merge')), [`gh pr merge 42 -R acme/tool --merge --match-head-commit ${s.sha}`]);
  assert.equal(first(s.paths).autopilot?.merged?.sha, s.sha);
});

test('a merge reads back as a merge, not as a refresh; a refresh still reads as one (GH-67)', () => {
  const at = now().toISOString();
  const e = (data: Record<string, unknown>) => autopilotEvent({ seq: 3, at, type: 'task.updated', task: 'T-1', by: AUTOPILOT_BY, data });
  const merged = { sha: 'abc', pr: { number: 7, url: 'https://github.com/acme/tool/pull/7' }, method: 'merge', at };
  assert.deepEqual(e({ merged }), { seq: 3, at, task: 'T-1', step: 'merge', outcome: 'done', pr: { number: 7, url: 'https://github.com/acme/tool/pull/7', opened: false } });
  assert.deepEqual(e({ autopilot: { failed: { step: 'merge', sha: 'abc', reason: 'It changes .acc/, which a person merges: .acc/config.json.' } } }), { seq: 3, at, task: 'T-1', step: 'merge', outcome: 'failed', reason: 'It changes .acc/, which a person merges: .acc/config.json.' });
  assert.equal(e({ pr: { number: 7, url: 'u', conflicts: [] } })?.step, 'refresh');
  assert.equal(e({ refreshed: { base: 'main', from: 'a', to: 'b', resolved: [], behind: true } })?.base, 'main');
  assert.equal(autopilotEvent({ seq: 3, at, type: 'task.updated', task: 'T-1', by: 'human:jordan', data: { merged } }), null, 'only autopilot\'s');
});
