import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { autopilotEvent } from '../src/autopilot-log.ts';
import { autopilotPass } from '../src/autopilot.ts';
import { type Config, parseConfig } from '../src/config.ts';
import { AccError, run, type RunOptions, type RunResult } from '../src/exec.ts';
import { draftChangesField } from '../src/field-drafts.ts';
import { waiveGates } from '../src/gates.ts';
import { displayState, type LedgerEvent, mutate, readLedger, type Task, upsertTasks } from '../src/ledger.ts';
import { mergeMethod, mergePr } from '../src/merge.ts';
import { repoPaths } from '../src/paths.ts';
import { DEPLOY_GATE } from '../src/deploy-commands.ts';
import { ownDeployAt, ownRunBefore, writeReceipt } from '../src/receipts.ts';
import { reviewPath, type Verdict } from '../src/review.ts';
import { listUpdates } from '../src/updates.ts';
import { bad, fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, tempDir } from './support.ts';

const now = () => new Date('2026-10-06T12:00:00Z');
const BRANCH = 'task/T-1-add-sum';
const LONG_AGO = '2026-10-06T11:00:00.000Z';

/**
 * A repo whose origin is a local bare repo, with T-1 in review: its branch on origin, reviewed and its
 * checks settled at its latest commit, and its pull request #42 landed there. Auto-merge is on.
 */
function setup(opts: { raw?: Record<string, unknown>; files?: Record<string, string>; verdict?: 'pass' | 'changes' | null; landedAt?: string } = {}) {
  const RAW = {
    ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'jordan-kim' }, autonomy: 'review',
    environments: [{ name: 'main', default: true }, { name: 'release', protected: true }],
    gates: { required: ['test'], commands: { test: 'true' } }, autopilot: { autoMerge: true },
    // Its tasks add files at the root; stray-files has its own tests (GH-103).
    strayFiles: { required: false }, ...opts.raw,
  };
  const origin = tempDir('origin-');
  run('git', ['init', '-q', '--bare', origin]);
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(RAW) });
  gitIn(dir, 'remote', 'add', 'origin', origin);
  gitIn(dir, 'push', '-q', 'origin', 'main');
  gitIn(dir, 'push', '-q', 'origin', 'main:release');
  const config = parseConfig(RAW).config as Config;
  const paths = repoPaths(dir, run);
  gitIn(dir, 'checkout', '-q', '-b', BRANCH);
  for (const [rel, text] of Object.entries({ 'sum.js': 'export const sum = (a, b) => a + b;\n', ...opts.files })) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'T-1: sum');
  gitIn(dir, 'checkout', '-q', 'main');
  gitIn(dir, 'push', '-q', 'origin', `${BRANCH}:${BRANCH}`);
  const sha = gitIn(dir, 'rev-parse', BRANCH);
  waiveGates(paths, config, { sha, env: config.environments[0]!, gates: ['test'], reason: 'covered by the test suite', by: 'human:test', now });
  if (opts.verdict !== null) {
    const v: Verdict = { v: 1, task: 'T-1', sha, env: 'main', verdict: opts.verdict ?? 'pass', summary: 'Adds sum.', criteria: [], findings: [], sessionId: 's', at: now().toISOString(), durationMs: 1, costUsd: null };
    mkdirSync(paths.reviews, { recursive: true });
    writeFileSync(reviewPath(paths, 'T-1', sha), JSON.stringify(v));
  }
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Add a sum function' }], 'human', 'human:test', emit, now);
    const t = l.tasks[0]!;
    t.state = 'review';
    t.run = { branch: BRANCH, worktree: dir };
    t.pr = { number: 42, url: 'https://github.com/acme/tool/pull/42', state: 'open', sha, landedAt: opts.landedAt ?? LONG_AGO, conflicts: [] };
  });
  return { dir, origin, config, paths, sha };
}

/** A check as `gh pr checks --json` lists it. */
const check = (name: string, bucket: string) => ({ name, bucket, workflow: 'CI', link: `https://github.com/acme/tool/actions/runs/7/job/${name.length}`, state: bucket.toUpperCase() });

type Fixture = RunResult | ((o?: RunOptions) => RunResult);

/** What gh says to `gh pr checks`, with --required or without, on a commit with no checks at all. */
const NO_CHECKS = bad('no checks reported on the \'task/T-1-add-sum\' branch');

/** GitHub as gh reads it: pull request #42 open at `head`, mergeable, its checks passed, every method allowed. */
function github(head: string, over: { pr?: Record<string, unknown>; checks?: unknown[]; more?: Record<string, Fixture> } = {}): Record<string, Fixture> {
  return {
    'gh auth token -u jordan-kim': ok('gho_token\n'),
    'gh pr view': ok(JSON.stringify({ state: 'OPEN', headRefOid: head, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: null, baseRefName: 'main', isDraft: false, ...over.pr })),
    'gh pr checks': ok(JSON.stringify(over.checks ?? [check('test', 'pass')])),
    'gh repo view': ok(JSON.stringify({ mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: true })),
    'gh pr merge': ok(''),
    ...over.more,
  };
}

const QUESTIONS = tempDir('questions-');
const deps = (calls: string[], fixtures: Record<string, Fixture>, env: NodeJS.ProcessEnv = {}) => ({ run: fakeRunner(fixtures, calls), now, env: { ACC_QUESTIONS_DIR: QUESTIONS, ...env } });
const by = { actor: 'orchestrator' as const, by: 'orchestrator:autopilot' };
const first = (paths: ReturnType<typeof repoPaths>): Task => readLedger(paths.ledger).tasks[0]!;
const events = (paths: ReturnType<typeof repoPaths>): LedgerEvent[] => readFileSync(paths.events, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as LedgerEvent);
const merges = (calls: string[]) => calls.filter((c) => c.startsWith('gh pr merge'));

/** What stops a merge: its code and words, and that gh never merged anything. */
function held(s: ReturnType<typeof setup>, fixtures: Record<string, Fixture>, code: 'merge' | 'merge-waits' | 'refused', why: RegExp, config: Config = s.config): void {
  const calls: string[] = [];
  const before = JSON.stringify(first(s.paths));
  assert.throws(() => mergePr(s.paths, config, 'T-1', deps(calls, fixtures), by), (e: AccError) => {
    assert.equal(e.code, code, e.message);
    assert.match(e.message, why);
    return true;
  });
  assert.deepEqual(merges(calls), [], 'nothing merged');
  assert.equal(JSON.stringify(first(s.paths)), before, 'nothing written on the task: autopilot records what fails');
}

// ---------------------------------------------------------------- the merge

test('a reviewed, green pull request merges as the repo\'s account, only at the commit autopilot looked at, and acc sync is left to move it (GH-67)', () => {
  const s = setup();
  const calls: string[] = [];
  const tokens: (string | undefined)[] = [];
  const base = deps(calls, github(s.sha));
  const r = mergePr(s.paths, s.config, 'T-1', { ...base, run: (cmd, args, o) => { if (cmd === 'gh' && args[0] !== 'auth') tokens.push(o?.env?.GH_TOKEN); return base.run(cmd, args, o); } }, by);
  assert.deepEqual([r.sha, r.pr, r.method], [s.sha, { number: 42, url: 'https://github.com/acme/tool/pull/42' }, 'merge']);
  assert.equal(r.reason, `Merged pull request #42 into main at ${s.sha.slice(0, 7)}. acc sync moves T-1 to done.`);
  assert.deepEqual(merges(calls), [`gh pr merge 42 -R acme/tool --merge --match-head-commit ${s.sha}`]);
  assert.ok(tokens.length && tokens.every((t) => t === 'gho_token'), 'every gh call as the repo\'s account');
  assert.ok(!calls.some((c) => /--admin|--auto|--delete-branch|gh pr review|gh api/.test(c)), 'no bypass, no approval, no branch deleted');
  const t = first(s.paths);
  assert.deepEqual(t.autopilot?.merged, { sha: s.sha, pr: { number: 42, url: 'https://github.com/acme/tool/pull/42' }, method: 'merge', at: now().toISOString() });
  assert.deepEqual([t.state, t.pr?.state], ['review', 'open'], 'the ledger waits for acc sync, which moves it to done');
  assert.deepEqual(t.changes, { at: now().toISOString(), paths: ['sum.js'] }, 'the merge queue\'s merge keeps what it changed (T-99)');
  const e = events(s.paths).at(-1)!;
  assert.deepEqual([e.type, e.actor, e.by, Object.keys(e.data)], ['task.updated', 'orchestrator', 'orchestrator:autopilot', ['merged']]);
  assert.deepEqual(autopilotEvent(e), { seq: e.seq, at: now().toISOString(), task: 'T-1', step: 'merge', outcome: 'done', pr: { number: 42, url: 'https://github.com/acme/tool/pull/42', opened: false } });
  // A second try at the same commit only waits: it's merged.
  held(s, github(s.sha), 'merge-waits', /^Autopilot already merged pull request #42: acc sync moves T-1 to done\.$/);
});

test('the repo\'s own merge method: merge, else squash, else rebase; none is a failure (GH-67)', () => {
  const allowed = (m: boolean, sq: boolean, rb: boolean) => fakeRunner({ 'gh repo view acme/tool': ok(JSON.stringify({ mergeCommitAllowed: m, squashMergeAllowed: sq, rebaseMergeAllowed: rb })) });
  assert.equal(mergeMethod(allowed(true, true, true), 'acme/tool', {}), 'merge');
  assert.equal(mergeMethod(allowed(false, true, true), 'acme/tool', {}), 'squash');
  assert.equal(mergeMethod(allowed(false, false, true), 'acme/tool', {}), 'rebase');
  assert.throws(() => mergeMethod(allowed(false, false, false), 'acme/tool', {}), /acme\/tool allows no way to merge a pull request\./);
  assert.throws(() => mergeMethod(fakeRunner({ 'gh repo view': bad('HTTP 404: Not Found') }), 'acme/tool', {}), (e: AccError) => e.code === 'merge' && /gh couldn't read how acme\/tool merges pull requests: HTTP 404/.test(e.message));

  const s = setup();
  const calls: string[] = [];
  mergePr(s.paths, s.config, 'T-1', deps(calls, github(s.sha, { more: { 'gh repo view': ok(JSON.stringify({ mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: false })) } })), by);
  assert.deepEqual(merges(calls), [`gh pr merge 42 -R acme/tool --squash --match-head-commit ${s.sha}`]);
  assert.equal(first(s.paths).autopilot?.merged?.method, 'squash');
});

// ---------------------------------------------------------------- what holds it back

test('its review: missing, or asking for changes, holds the merge (GH-67)', () => {
  held(setup({ verdict: null }), {}, 'merge-waits', /T-1's review hasn't passed on [0-9a-f]{7}\./);
  held(setup({ verdict: 'changes' }), {}, 'merge-waits', /T-1's review hasn't passed/);
});

test('its checks not settled on the commit hold the merge, before GitHub is asked (GH-67)', () => {
  const s = setup();
  const config: Config = { ...s.config, gates: { ...s.config.gates, required: ['test', 'lint'], commands: { test: 'true', lint: 'true' } } };
  held(s, github(s.sha), 'merge', /^Its checks aren't settled on [0-9a-f]{7}: lint\.$/, config);
});

test('GitHub\'s checks: running waits; failed or cancelled needs you; none required counts every check (GH-67)', () => {
  const s = setup();
  held(s, github(s.sha, { checks: [check('test', 'pass'), check('e2e', 'pending')] }), 'merge-waits', /^Checks are still running on GitHub: e2e\.$/);
  held(s, github(s.sha, { checks: [check('test', 'fail')] }), 'merge', /^Checks failed on GitHub: test\.$/);
  held(s, github(s.sha, { checks: [check('test', 'pass'), check('preview', 'cancel')] }), 'merge', /^Checks were cancelled on GitHub: preview\. Run them again, or merge it yourself\.$/);
  // GitHub has moved on from the commit autopilot looked at.
  held(s, github(s.sha, { more: { 'gh pr checks': NO_CHECKS, 'gh pr view 42 -R acme/tool --json headRefOid': ok(JSON.stringify({ headRefOid: 'c'.repeat(40) })) } }), 'merge-waits', /is at ccccccc on GitHub/);
  // A base that requires no checks: every check counts, and they passed.
  const calls: string[] = [];
  mergePr(s.paths, s.config, 'T-1', deps(calls, github(s.sha, { more: { 'gh pr checks 42 -R acme/tool --required': bad('no required checks reported on the \'task/T-1\' branch') } })), by);
  assert.equal(merges(calls).length, 1);
  assert.ok(calls.includes('gh pr checks 42 -R acme/tool --json name,bucket,link,workflow,state'), 'asked again without --required');
});

test('no checks at all count only where the base requires none, 2 minutes after the land (GH-67)', () => {
  // gh's reply to --required on a commit with no checks: it looks for any before it looks for required ones.
  const none = (head: string, pr: Record<string, unknown> = {}) => github(head, { pr, more: { 'gh pr checks': NO_CHECKS } });
  // Landed a minute ago: a slow CI may not have registered yet.
  const young = setup({ landedAt: '2026-10-06T11:59:00.000Z' });
  held(young, none(young.sha), 'merge-waits', /^No checks are reported on GitHub yet: autopilot gives them 2 minutes after a land\.$/);
  const old = setup({ landedAt: '2026-10-06T11:58:00.000Z' });
  // A base whose rules block it with no checks reported: checks it requires haven't registered yet, so it waits, and records nothing.
  held(old, none(old.sha, { mergeStateStatus: 'BLOCKED' }), 'merge-waits', /^GitHub says main's rules block pull request #42, and no checks are reported on it yet: autopilot waits for the checks main requires\.$/);
  // Still none 15 minutes after the land: a rule no check meets, such as an approving review, so it needs you.
  const stale = setup({ landedAt: '2026-10-06T11:45:00.000Z' });
  held(stale, none(stale.sha, { mergeStateStatus: 'BLOCKED' }), 'merge', /^GitHub won't merge pull request #42: main's rules block it, and no checks were reported on it in the 15 minutes after its land\. It may need an approving review: merge it yourself\.$/);
  const fresh = setup({ landedAt: '2026-10-06T11:46:00.000Z' });
  held(fresh, none(fresh.sha, { mergeStateStatus: 'BLOCKED' }), 'merge-waits', /autopilot waits for the checks main requires/);
  const calls: string[] = [];
  mergePr(old.paths, old.config, 'T-1', deps(calls, none(old.sha)), by);
  assert.equal(merges(calls).length, 1, 'this repo has no GitHub checks: its pull requests merge once 2 minutes have passed');
  assert.deepEqual(calls.filter((c) => c.startsWith('gh pr checks')), ['gh pr checks 42 -R acme/tool --required --json name,bucket,link,workflow,state']);
});

test('a check the project names (T-108): pending or missing waits, failed needs you, passed merges; no checks reported at all waits however long since the land', () => {
  const s = setup();
  const config: Config = { ...s.config, github: { ...s.config.github!, checks: ['check'] } };
  const named = (checks: unknown[]) => github(s.sha, { checks });
  held(s, named([check('test', 'pass'), check('check', 'pending')]), 'merge-waits', /^Checks are still running on GitHub: check\.$/, config);
  held(s, named([check('test', 'pass'), check('check', 'fail')]), 'merge', /^Checks failed on GitHub: check\.$/, config);
  held(s, named([check('test', 'pass')]), 'merge-waits', /^GitHub reports nothing yet for the "check" check on pull request #42: autopilot waits for it to pass\.$/, config);
  // Edge case: no checks reported at all, landed an hour ago, past the 2 minutes that count none as passed without a named check.
  held(s, github(s.sha, { more: { 'gh pr checks': NO_CHECKS } }), 'merge-waits', /^GitHub reports nothing yet for the "check" check on pull request #42/, config);
  // Edge case: the base requires another check, and not the named one: it's read from every check on the commit.
  const required = { 'gh pr checks 42 -R acme/tool --required': ok(JSON.stringify([check('test', 'pass')])) };
  held(s, github(s.sha, { checks: [check('test', 'pass'), check('check', 'pending')], more: required }), 'merge-waits', /^Checks are still running on GitHub: check\.$/, config);
  held(s, github(s.sha, { checks: [check('test', 'pass')], more: required }), 'merge-waits', /^GitHub reports nothing yet for the "check" check/, config);
  const calls: string[] = [];
  mergePr(s.paths, config, 'T-1', deps(calls, github(s.sha, { checks: [check('test', 'pass'), check('check', 'pass')], more: required })), by);
  assert.equal(merges(calls).length, 1, 'the named check passed: it merges');
});

test('GitHub\'s own word: conflicting, blocked or a draft needs you; still working it out, or behind, waits (GH-67)', () => {
  const s = setup();
  const pr = (p: Record<string, unknown>) => github(s.sha, { pr: p });
  held(s, pr({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }), 'merge', /^GitHub says pull request #42 conflicts with main\.$/);
  held(s, pr({ mergeStateStatus: 'DIRTY' }), 'merge', /conflicts with main/);
  held(s, pr({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }), 'merge-waits', /^GitHub is still working out whether pull request #42 can merge\.$/);
  held(s, pr({ mergeStateStatus: 'BLOCKED' }), 'merge', /^GitHub won't merge pull request #42: main's rules block it, such as a required approving review\.$/);
  held(s, pr({ mergeStateStatus: 'BEHIND' }), 'merge-waits', /is behind main: autopilot merges it in first/);
  held(s, pr({ isDraft: true }), 'merge', /is a draft on GitHub/);
  held(s, pr({ reviewDecision: 'CHANGES_REQUESTED' }), 'merge-waits', /^A person asked for changes on pull request #42\.$/);
  held(s, pr({ state: 'MERGED' }), 'merge-waits', /already merged on GitHub: acc sync moves T-1 to done/);
  held(s, pr({ state: 'CLOSED' }), 'merge-waits', /is closed on GitHub: acc sync follows it/);
  held(s, pr({ headRefOid: 'c'.repeat(40) }), 'merge-waits', /^Pull request #42 is at ccccccc on GitHub, not [0-9a-f]{7}: a land or a person comes first\.$/);
  // Retargeted on GitHub, at a protected branch: not the merge auto-merge was turned on for.
  held(s, pr({ baseRefName: 'release' }), 'merge', /^Pull request #42 merges into release on GitHub, not main: a person merges it\.$/);
  // Only checks the base doesn't require failing, or hooks to run: it merges.
  for (const state of ['UNSTABLE', 'HAS_HOOKS']) {
    const u = setup();
    const calls: string[] = [];
    mergePr(u.paths, u.config, 'T-1', deps(calls, github(u.sha, { pr: { mergeStateStatus: state } })), by);
    assert.equal(merges(calls).length, 1, state);
  }
});

test('nothing waiting on a person: an agent asking in its worktree holds the merge (GH-67)', () => {
  const s = setup();
  const dir = tempDir('questions-');
  writeFileSync(join(dir, 'q1.json'), JSON.stringify({ v: 1, id: 'q1', pid: process.pid, at: Date.now(), sessionId: 'sess', cwd: join(s.dir, 'src'), transcript: null, tool: 'Bash', input: {}, suggestions: [] }));
  const calls: string[] = [];
  assert.throws(() => mergePr(s.paths, s.config, 'T-1', deps(calls, github(s.sha), { ACC_QUESTIONS_DIR: dir }), by), (e: AccError) => e.code === 'merge-waits' && e.message === 'An agent in T-1\'s worktree is waiting for your answer.');
  assert.deepEqual(merges(calls), []);
});

test('a base that moved on waits for its refresh, and a change to .acc/ waits for a person (GH-67)', () => {
  const s = setup();
  // Someone else's work merged into main on GitHub.
  writeFileSync(join(s.dir, 'other.js'), 'x\n');
  gitIn(s.dir, 'add', '-A');
  gitIn(s.dir, 'commit', '-q', '-m', 'Another task');
  gitIn(s.dir, 'push', '-q', 'origin', 'main');
  held(s, github(s.sha), 'merge-waits', /^main moved on since [0-9a-f]{7}: autopilot merges it in first\.$/);

  const acc = setup({ files: { '.acc/config.json': '{}\n' } });
  held(acc, github(acc.sha), 'merge', /^It changes \.acc\/, which a person merges: \.acc\/config\.json\.$/);
});

test('a protected environment, a Salesforce environment that isn\'t the development one, autonomy manual or auto-merge off never merge (GH-67, T-157)', () => {
  const s = setup();
  // Marked protected after its task was built.
  const guarded: Config = { ...s.config, environments: s.config.environments.map((e) => ({ ...e, protected: true })) };
  held(s, github(s.sha), 'refused', /^"main" is protected: a person merges into it\.$/, guarded);
  // A Salesforce project merges into its development environment alone (T-157): with release the default,
  // main isn't it. The mutant that merges into any unprotected environment is caught here.
  const salesforce: Config = { ...s.config, profile: 'salesforce', environments: s.config.environments.map((e) => ({ ...e, default: e.branch === 'release', protected: false })) };
  held(s, github(s.sha), 'refused', /^"main" isn't the development environment: autopilot merges only into release in a Salesforce project\.$/, salesforce);
  // Marked Production after its task was built: protected first, whatever else is said of it.
  held(s, github(s.sha), 'refused', /^"main" is protected: a person merges into it\.$/, { ...salesforce, environments: salesforce.environments.map((e) => (e.branch === 'main' ? { ...e, type: 'production', protected: true } : e)) });
  held(s, github(s.sha), 'refused', /^Merging on its own is off for this project: a person merges each pull request\.$/, { ...s.config, profile: 'salesforce', autopilot: { appendOnly: [], autoMerge: false } });
  // A Salesforce task on the development environment with no deploy of its own on the reviewed commit: the
  // checks say nothing is missing (the only one is waived), and the merge still refuses. The mutant that merges
  // before the builder's deploy to the development org passed is caught here.
  held(s, github(s.sha), 'merge', /^T-1's own deploy to main hasn't passed on [0-9a-f]{7}, the commit its review read: it merges only on the deploy its builder made there\.$/, { ...s.config, profile: 'salesforce' });
  held(s, github(s.sha), 'refused', /^autonomy is "manual": autopilot merges only under review\.$/, { ...s.config, autonomy: 'manual' });
  held(s, github(s.sha), 'refused', /^Auto-merge is off for this project/, { ...s.config, autopilot: { appendOnly: [] } });
});

/** The task's own deploy to `env`, recorded on the task, with its passing receipt on `sha`. */
function deployed(s: ReturnType<typeof setup>, sha: string, env = 'main'): void {
  writeReceipt(s.paths, { gate: DEPLOY_GATE, sha, env, status: 'pass', startedAt: LONG_AGO, finishedAt: LONG_AGO, durationMs: 1, summary: 'Deployed.', command: null, log: null });
  mutate(s.paths, now, (l, emit) => {
    const t = l.tasks[0]!;
    t.deploys = [...(t.deploys ?? []), { env, org: 'Acme Dev', sha, at: LONG_AGO, jobId: '0Af1', paths: ['force-app/main/default/classes/Sum.cls'], components: ['Apex Class: Sum'], verified: 1, tests: null }];
    emit({ type: 'task.updated', task: 'T-1', actor: 'builder', by: 'builder:T-1', data: { deployed: sha } });
  });
}

test('a Salesforce task whose own deploy to the development org passed on the reviewed head merges into the development environment\'s branch, with no click (T-157)', () => {
  const s = setup();
  const salesforce: Config = { ...s.config, profile: 'salesforce' };
  deployed(s, s.sha);
  assert.ok(ownDeployAt(s.paths, first(s.paths), s.sha), 'the deploy is the task\'s own, on this commit, and passed');
  const calls: string[] = [];
  const r = mergePr(s.paths, salesforce, 'T-1', deps(calls, github(s.sha)), by);
  assert.equal(merges(calls).length, 1, 'merged');
  assert.deepEqual([r.sha, r.pr.number], [s.sha, 42]);
  assert.match(r.reason, /^Merged pull request #42 into main at [0-9a-f]{7}\. acc sync moves T-1 to done\.$/);
  assert.equal(first(s.paths).autopilot?.merged?.sha, s.sha, 'the merge is on the task');
});

test('a Salesforce task deployed on an earlier commit than the one its review read is refused: a deploy on commit A with the head at B never merges, whatever an ancestor says (T-157)', () => {
  const s = setup();
  const salesforce: Config = { ...s.config, profile: 'salesforce' };
  // The deploy on A, the branch's first commit.
  const a = s.sha;
  deployed(s, a);
  // Then B: one more commit on the branch, never deployed, reviewed there, its checks waived there, the pull request landed there.
  gitIn(s.dir, 'checkout', '-q', BRANCH);
  writeFileSync(join(s.dir, 'sum.js'), 'export const sum = (a, b) => a + b + 0;\n');
  gitIn(s.dir, 'add', '-A');
  gitIn(s.dir, 'commit', '-q', '-m', 'T-1: sum, again');
  gitIn(s.dir, 'checkout', '-q', 'main');
  gitIn(s.dir, 'push', '-q', 'origin', `${BRANCH}:${BRANCH}`);
  const b = gitIn(s.dir, 'rev-parse', BRANCH);
  assert.notEqual(a, b);
  waiveGates(s.paths, s.config, { sha: b, env: s.config.environments[0]!, gates: ['test'], reason: 'covered', by: 'human:test', now });
  const v: Verdict = { v: 1, task: 'T-1', sha: b, env: 'main', verdict: 'pass', summary: 'Adds sum.', criteria: [], findings: [], sessionId: 's', at: now().toISOString(), durationMs: 1, costUsd: null };
  writeFileSync(reviewPath(s.paths, 'T-1', b), JSON.stringify(v));
  mutate(s.paths, now, (l, emit) => {
    l.tasks[0]!.pr!.sha = b;
    emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'human:test', data: { landed: b } });
  });
  assert.ok(ownRunBefore(s.paths, run, first(s.paths), b, DEPLOY_GATE), 'an ancestor of B was deployed: land would take it');
  assert.ok(!ownDeployAt(s.paths, first(s.paths), b), 'B itself wasn\'t');
  // The mutant that takes a deploy on any ancestor is caught here: B holds a change the org never held.
  held(s, github(b), 'merge', new RegExp(`^T-1's own deploy to main hasn't passed on ${b.slice(0, 7)}, the commit its review read: it merges only on the deploy its builder made there\\.$`), salesforce);
  // Deployed on B too, it merges.
  deployed(s, b);
  const calls: string[] = [];
  mergePr(s.paths, salesforce, 'T-1', deps(calls, github(b)), by);
  assert.equal(merges(calls).length, 1);
});

test('the merge queue\'s merge commit carries its review from the reviewed commit, and the deploy must be on that commit, not on the merge commit or an older one (T-157)', () => {
  const s = setup();
  const salesforce: Config = { ...s.config, profile: 'salesforce' };
  // Someone else's work on main, and the queue's merge commit on the branch, carrying the review from s.sha.
  writeFileSync(join(s.dir, 'other.js'), 'x\n');
  gitIn(s.dir, 'add', '-A');
  gitIn(s.dir, 'commit', '-q', '-m', 'Another task');
  gitIn(s.dir, 'push', '-q', 'origin', 'main');
  gitIn(s.dir, 'checkout', '-q', BRANCH);
  gitIn(s.dir, 'merge', '-q', '--no-edit', 'main');
  const to = gitIn(s.dir, 'rev-parse', 'HEAD');
  gitIn(s.dir, 'checkout', '-q', 'main');
  gitIn(s.dir, 'push', '-q', 'origin', `${BRANCH}:${BRANCH}`);
  waiveGates(s.paths, s.config, { sha: to, env: s.config.environments[0]!, gates: ['test'], reason: 'covered', by: 'human:test', now });
  mutate(s.paths, now, (l, emit) => {
    const t = l.tasks[0]!;
    t.pr!.sha = to;
    t.autopilot = { failed: null, carried: { from: s.sha, to, base: gitIn(s.dir, 'rev-parse', 'main'), resolved: [], at: LONG_AGO } };
    emit({ type: 'task.updated', task: 'T-1', actor: 'orchestrator', by: 'orchestrator:autopilot', data: { carried: to } });
  });
  held(s, github(to), 'merge', new RegExp(`^T-1's own deploy to main hasn't passed on ${s.sha.slice(0, 7)}, the commit its review read`), salesforce);
  // A deploy skipped elsewhere on the merge commit says nothing; the builder's own on the reviewed commit does.
  writeReceipt(s.paths, { gate: DEPLOY_GATE, sha: to, env: 'main', status: 'skip', elsewhere: 'merge', startedAt: LONG_AGO, finishedAt: LONG_AGO, durationMs: 1, summary: 'Skipped.', command: null, log: null });
  held(s, github(to), 'merge', /the commit its review read/, salesforce);
  deployed(s, s.sha);
  const calls: string[] = [];
  const r = mergePr(s.paths, salesforce, 'T-1', deps(calls, github(to)), by);
  assert.deepEqual([merges(calls).length, r.sha], [1, to], 'merged at the merge commit, on the deploy its reviewed commit made');
});

// ---------------------------------------------------------------- when gh says no

test('a merge gh refuses is a failure, written down by autopilot, and the task needs you; a head that moved only waits (GH-67)', () => {
  const s = setup();
  const refuse = github(s.sha, { more: { 'gh pr merge': bad('GraphQL: Pull request is not mergeable: the base branch policy prohibits the merge. (mergePullRequest)') } });
  const calls: string[] = [];
  const r = autopilotPass(s.paths, s.config, { ...deps(calls, refuse), accBinDir: '/opt/acc/bin' });
  assert.deepEqual([r.steps[0]!.step, r.steps[0]!.outcome], ['merge', 'failed']);
  const reason = 'gh couldn\'t merge pull request #42: GraphQL: Pull request is not mergeable: the base branch policy prohibits the merge. (mergePullRequest)';
  assert.equal(r.steps[0]!.reason, reason);
  const t = first(s.paths);
  assert.deepEqual(t.autopilot?.failed, { step: 'merge', sha: s.sha, state: 'review', reason, at: now().toISOString() });
  assert.equal(displayState(readLedger(s.paths.ledger), t), 'needs-you');
  assert.deepEqual(autopilotEvent(events(s.paths).at(-1)!)?.step, 'merge');
  assert.equal(autopilotEvent(events(s.paths).at(-1)!)?.outcome, 'failed');
  // Not tried again on that commit.
  const before = calls.length;
  const again = autopilotPass(s.paths, s.config, { ...deps(calls, refuse), accBinDir: '/opt/acc/bin' });
  assert.deepEqual([again.steps[0]!.step, again.steps[0]!.outcome], [null, 'waiting']);
  assert.match(again.steps[0]!.reason, /^Autopilot couldn't merge [0-9a-f]{7}: gh couldn't merge pull request #42/);
  assert.deepEqual(merges(calls.slice(before)), []);

  // Someone pushed between autopilot's look and its merge: GitHub refuses, and it looks again next pass.
  const m = setup();
  let views = 0;
  const pushed = github(m.sha, { more: {
    'gh pr merge': bad('GraphQL: Head branch was modified. Review and try the merge again. (mergePullRequest)'),
    'gh pr view 42 -R acme/tool --json state,headRefOid,mergeable,mergeStateStatus,reviewDecision,baseRefName,isDraft': () => ok(JSON.stringify({ state: 'OPEN', headRefOid: ++views === 1 ? m.sha : 'd'.repeat(40), mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', baseRefName: 'main' })),
  } });
  assert.throws(() => mergePr(m.paths, m.config, 'T-1', deps([], pushed), by), (e: AccError) => e.code === 'merge-waits' && /moved on to ddddddd on GitHub while autopilot merged it/.test(e.message));
  assert.equal(first(m.paths).autopilot, undefined, 'nothing recorded');
});

test('a gh that ran out of time after GitHub merged is a merge, as GitHub then says (GH-67, D-051)', () => {
  const s = setup();
  let views = 0;
  const slow = github(s.sha, { more: {
    'gh pr merge': { code: 127, stdout: '', stderr: 'gh didn\'t finish within 2 minutes, so acc stopped it.', timedOut: true },
    'gh pr view 42 -R acme/tool --json state,headRefOid,mergeable,mergeStateStatus,reviewDecision,baseRefName,isDraft': () => ok(JSON.stringify({ state: ++views === 1 ? 'OPEN' : 'MERGED', headRefOid: s.sha, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', baseRefName: 'main' })),
  } });
  const r = mergePr(s.paths, s.config, 'T-1', deps([], slow), by);
  assert.equal(r.sha, s.sha);
  assert.equal(first(s.paths).autopilot?.merged?.sha, s.sha);

  // One GitHub can't answer for afterwards is a failure that says so.
  const u = setup();
  const silent = github(u.sha, { more: {
    'gh pr merge': { code: 127, stdout: '', stderr: 'gh didn\'t finish within 2 minutes, so acc stopped it.', timedOut: true },
    'gh pr view 42 -R acme/tool --json state,headRefOid,mergeable,mergeStateStatus,reviewDecision,baseRefName,isDraft': (() => { let n = 0; return () => (++n === 1 ? ok(JSON.stringify({ state: 'OPEN', headRefOid: u.sha, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', baseRefName: 'main' })) : bad('HTTP 502')); })(),
  } });
  assert.throws(() => mergePr(u.paths, u.config, 'T-1', deps([], silent), by), (e: AccError) => e.code === 'merge' && e.message === 'gh couldn\'t merge pull request #42: gh didn\'t finish within 2 minutes, so acc stopped it. GitHub didn\'t say afterwards whether it merged.');
});

test('a merge drafts the ticket\'s changes field once; sync\'s later draft says the same and makes none, or, where a squash dropped a file, replaces it, so one is open (T-105)', () => {
  const tracker = { kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', changesField: { id: 'customfield_10042', name: 'Deployment Notes', format: 'adf' } };
  const s = setup({ raw: { trackers: [tracker] }, files: { 'extra.js': 'export const extra = 1;\n' } });
  mutate(s.paths, now, (l, emit) => {
    l.tasks[0]!.source = { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' };
    emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'test', data: {} });
  });
  mergePr(s.paths, s.config, 'T-1', deps([], github(s.sha)), by);
  const drafts = () => listUpdates(s.paths).filter((u) => u.event === 'changes');
  const [draft, ...more] = drafts();
  assert.deepEqual([more.length, draft?.by, draft?.field?.id], [0, 'orchestrator:autopilot', 'customfield_10042']);
  assert.match(draft!.text, /sum\.js/);
  assert.match(draft!.text, /extra\.js/);
  mutate(s.paths, now, (l, emit) => {
    l.tasks[0]!.state = 'done';
    emit({ type: 'task.updated', task: 'T-1', actor: 'sync', by: 'acc sync', data: {} });
  });
  assert.equal(draftChangesField(s.paths, run, s.config, 'T-1', 'acc sync', now), null, 'done, with the same paths kept: nothing new to say');
  // A squash that dropped extra.js: sync keeps what the merge commit brought, and its draft replaces the merge's.
  mutate(s.paths, now, (l, emit) => {
    l.tasks[0]!.changes = { at: now().toISOString(), paths: ['sum.js'] };
    emit({ type: 'task.updated', task: 'T-1', actor: 'sync', by: 'acc sync', data: {} });
  });
  const second = draftChangesField(s.paths, run, s.config, 'T-1', 'acc sync', now)!;
  assert.deepEqual(second.replaces, [draft!.id]);
  assert.doesNotMatch(second.text, /extra\.js/);
  assert.deepEqual(drafts().map((u) => u.id), [second.id], 'one draft is open: the merge\'s is replaced');
});
