import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AUTOPILOT_BY, type AutopilotDeps, autopilotEvent, type AutopilotLog, autopilotMode, autopilotPass, type AutopilotStep, holdAutopilot, nextStep, readAutopilotLog, taskFacts, type TaskFacts } from '../src/autopilot.ts';
import { type Config, parseConfig } from '../src/config.ts';
import { AccError, run, type RunResult } from '../src/exec.ts';
import { waiveGates } from '../src/gates.ts';
import { land } from '../src/land.ts';
import { displayState, emptyLedger, type Ledger, type LedgerEvent, mutate, readLedger, type State, type Task, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { readVerdict, reviewPath, type Verdict } from '../src/review.ts';
import { withSlot } from '../src/semaphore.ts';
import { listUpdates } from '../src/updates.ts';
import { bad, fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, tempDir } from './support.ts';

const now = () => new Date('2026-10-05T12:00:00Z');
const BRANCH = 'task/T-1-add-sum';
type Source = { kind: 'manual' | 'jira'; key: string; url?: string };

/**
 * A repo whose origin is a local bare repo, with its first task on its own branch (in review unless
 * asked), its checks settled, and two tasks to do: T-2 ready, T-3 waiting on it.
 */
function setup(opts: { state?: State; source?: Source; max?: number } = {}) {
  const RAW = {
    ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'jordan-kim' }, gates: { required: ['test'], commands: { test: 'true' } },
    autonomy: 'review', agents: { max: opts.max ?? 3 }, worktrees: { root: tempDir('worktrees-') },
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
function deps(calls: string[], over: Record<string, RunResult> = {}): AutopilotDeps {
  return {
    run: fakeRunner({
      'gh auth token -u jordan-kim': ok('gho_token\n'),
      'gh pr list': ok('[]'),
      'gh pr create': ok('https://github.com/acme/tool/pull/42\n'),
      'gh pr edit': ok(''),
      'claude -p': verdictOut('pass'),
      'claude --bg': ok('bg1\n'),
      'claude agents --json': ok(JSON.stringify([{ id: 'bg1', sessionId: 'sess-1', name: 'T-1', kind: 'background', startedAt: 1 }])),
      ...over,
    }, calls),
    now, env: {}, accBinDir: '/opt/acc/bin',
  };
}

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
  assert.match(nextStep(full, RULES_CONFIG, full.tasks[0]!, facts()).reason, /2 tasks are running\. The limit is 2\./);
});

test('a task to do, ready or not, is never started; nor is one running or blocked touched', () => {
  const l = ledgerOf({ id: 'T-1' }, { id: 'T-2', deps: ['T-1'] }, { id: 'T-3', state: 'running' }, { id: 'T-4', state: 'blocked' });
  assert.equal(displayState(l, l.tasks[0]!), 'ready');
  for (const id of ['T-1', 'T-2', 'T-3', 'T-4']) assert.deepEqual(decide(l, id, facts()), [null, 'skipped'], id);
  assert.match(nextStep(l, RULES_CONFIG, l.tasks[0]!, facts()).reason, /never starts a task that's to do/);
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

  const before = calls.length;
  const idle = autopilotPass(s.paths, s.config, deps(calls));
  assert.deepEqual([idle.steps[0]!.outcome, idle.steps[0]!.reason], ['skipped', `Pull request #42 is up to date with ${s.sha.slice(0, 7)}.`]);
  assert.ok(calls.slice(before).every((c) => c.startsWith('git rev-parse')), 'it only looked');

  // Everything autopilot ran besides git: a review, and a land's gh calls. No merge, waiver, deploy,
  // promotion or acc command, and no builder for the tasks to do.
  const others = [...new Set(calls.filter((c) => !c.startsWith('git ')).map((c) => c.split(' ').slice(0, 3).join(' ')))].sort();
  assert.deepEqual(others, ['claude -p --session-id', 'gh auth token', 'gh pr create', 'gh pr list']);
  const git = [...new Set(calls.filter((c) => c.startsWith('git ')).map((c) => c.split(' ')[1]))].sort();
  assert.deepEqual(git, ['diff', 'fetch', 'merge-tree', 'push', 'rev-parse']);
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
  assert.match(launches[0]!, /--name T-1 /, 'the rework, never a task to do');
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
  assert.deepEqual([r.steps[0]!.outcome, r.steps[0]!.reason], ['waiting', '1 tasks are running. The limit is 1.']);
  assert.ok(!calls.some((c) => c.startsWith('claude')));

  const s2 = setup({ state: 'rework', max: 1 });
  const fills = autopilotPass(s2.paths, s2.config, { ...deps([]), steps: { dispatch: () => {
    edit(s2.paths, (l) => { l.tasks.find((t) => t.id === 'T-2')!.state = 'running'; });
    throw new AccError('move-refused', 'Can\'t dispatch T-1:\n- 1 tasks are already running. The limit is 1.');
  } } });
  assert.deepEqual([fills.steps[0]!.outcome, fills.steps[0]!.reason], ['waiting', '1 tasks are running. The limit is 1.']);
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
  assert.equal(e(AUTOPILOT_BY, 'task.updated', { autopilot: { failed: { step: 'merge', reason: 'x' } } }), null, 'not a step it takes');
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
