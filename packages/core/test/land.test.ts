import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { awakePath } from '../src/awake.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { run, type Runner, type RunOptions } from '../src/exec.ts';
import { runGates, waiveGates } from '../src/gates.ts';
import { land, prBody } from '../src/land.ts';
import { displayState, mutate, readLedger, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { type Receipt, receiptsAt } from '../src/receipts.ts';
import { reviewPath, type Verdict } from '../src/review.ts';
import { listUpdates, readUpdate } from '../src/updates.ts';
import { ciOf, failingOf, sync } from '../src/sync.ts';
import { NO_COUNTS } from '../src/test-counts.ts';
import { bad, fakeBin, fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, tempDir } from './support.ts';

const now = () => new Date('2026-10-02T12:00:00Z');
// Its tasks add files at the root; stray-files has its own tests (GH-103).
const RAW = { ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'jordan-kim' }, gates: { required: ['test'], commands: { test: 'true' } }, strayFiles: { required: false } };

/** A repo whose origin is a local bare repo, with T-1 in review on its own branch. */
function setup(source: { kind: 'github' | 'jira' | 'azure' | 'manual'; key: string | null; url?: string } = { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }) {
  const origin = tempDir('origin-');
  run('git', ['init', '-q', '--bare', origin]);
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(RAW) });
  const base = gitIn(dir, 'branch', '--show-current').trim();
  gitIn(dir, 'remote', 'add', 'origin', origin);
  gitIn(dir, 'push', '-q', 'origin', base);
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-1-add-sum');
  writeFileSync(join(dir, 'sum.js'), 'export const sum = (a, b) => a + b;\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'T-1: add sum');
  gitIn(dir, 'checkout', '-q', base);
  const config = parseConfig(RAW).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source, title: 'Add a sum function', brief: 'sum(a, b)' }], 'human', 'human:test', emit, now);
    const t = l.tasks[0]!;
    t.state = 'review';
    t.environment = base;
    t.run = { branch: 'task/T-1-add-sum', worktree: dir };
  });
  const id = readLedger(paths.ledger).tasks[0]!.id;
  const sha = gitIn(dir, 'rev-parse', 'task/T-1-add-sum').trim();
  return { dir, origin, config, paths, sha, id, base };
}

/** Someone else's change lands on the base on GitHub: made in another clone, so this one's branches don't move. */
function landOnOrigin(origin: string, base: string, file: string, text: string) {
  const other = tempDir('other-');
  run('git', ['clone', '-q', '-b', base, origin, other]);
  writeFileSync(join(other, file), text);
  gitIn(other, 'add', '-A');
  gitIn(other, '-c', 'user.name=Other', '-c', 'user.email=other@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', `change ${file}`);
  gitIn(other, 'push', '-q', 'origin', base);
}

/** Every local branch and where it points, HEAD, and the working tree: what sync and land must leave alone. */
const localState = (dir: string) => [gitIn(dir, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads'), gitIn(dir, 'symbolic-ref', 'HEAD'), gitIn(dir, 'status', '--porcelain')];

function passReview(paths: ReturnType<typeof repoPaths>, id: string, sha: string, env: string): Verdict {
  const v: Verdict = {
    v: 1, task: id, sha, env, verdict: 'pass', summary: 'Adds sum(a, b) with a test.', sessionId: 's', at: now().toISOString(), durationMs: 1, costUsd: null,
    criteria: [{ text: 'sum returns a + b', met: true, evidence: 'sum.js:1' }], findings: [{ message: 'Consider a JSDoc comment.', must: false, file: 'sum.js', line: 1 }],
  };
  mkdirSync(paths.reviews, { recursive: true });
  writeFileSync(reviewPath(paths, id, sha), JSON.stringify(v));
  return v;
}

/** gh as the repo's account, with an empty list of open pull requests unless one is given. */
function gh(calls: { args: string; opts?: RunOptions }[], open = '[]') {
  const fake = fakeRunner({
    'gh auth token -u jordan-kim': ok('gho_token\n'),
    'gh pr list': ok(open),
    'gh pr create': ok('https://github.com/acme/tool/pull/42\n'),
    'gh pr edit': ok(''),
  });
  return (cmd: string, args: string[], opts?: RunOptions) => {
    if (cmd === 'gh') calls.push({ args: args.join(' '), opts });
    return fake(cmd, args, opts);
  };
}

test('landing needs the task in review, its checks settled, and a passing review on its latest commit', () => {
  const s = setup();
  const deps = { run: gh([]), now, env: {} };
  assert.throws(() => land(s.paths, s.config, s.id, deps), /checks aren't settled .*: test/);
  waiveGates(s.paths, s.config, { sha: s.sha, env: s.config.environments[0]!, gates: ['test'], reason: 'a test', by: 'human:t', now });
  assert.throws(() => land(s.paths, s.config, s.id, deps), /hasn't been reviewed on .* Run acc review/);
  writeFileSync(reviewPath(s.paths, s.id, s.sha), JSON.stringify({ ...passReview(s.paths, s.id, s.sha, s.base), verdict: 'changes', summary: 'no test' }));
  assert.throws(() => land(s.paths, s.config, s.id, deps), /asked for changes: no test/);
  assert.equal(gitIn(s.origin, 'branch', '--list', 'task/*').trim(), '', 'nothing was pushed');
});

test('land pushes the branch, opens the pull request into the environment\'s branch as the repo\'s account, and records it', () => {
  const s = setup();
  runGates(s.paths, s.config, s.config.environments[0]!, [], [], { run, now, slots: { dir: join(s.dir, '.git', 'slots') } });
  // The gates ran on the base checkout; record them for the task's commit too.
  waiveGates(s.paths, s.config, { sha: s.sha, env: s.config.environments[0]!, gates: ['test'], reason: 'covered by the test suite run', by: 'human:jordan', now });
  passReview(s.paths, s.id, s.sha, s.base);
  const calls: { args: string; opts?: RunOptions }[] = [];
  const r = land(s.paths, s.config, s.id, { run: gh(calls), now, env: {} });
  assert.deepEqual([r.opened, r.pr], [true, { number: 42, url: 'https://github.com/acme/tool/pull/42', state: 'open', landedAt: now().toISOString(), sha: s.sha, conflicts: [] }], 'it merges cleanly into its base, and the pull request knows the commit it landed');
  assert.equal(gitIn(s.origin, 'rev-parse', 'task/T-1-add-sum').trim(), s.sha, 'the branch is on GitHub at the reviewed commit');
  const create = calls.find((c) => c.args.startsWith('pr create'))!;
  assert.match(create.args, new RegExp(`--base ${s.base} --head task/T-1-add-sum --title ${s.id}: Add a sum function`));
  assert.equal(create.opts?.env?.GH_TOKEN, 'gho_token', 'gh acts as the repo\'s own account');
  assert.ok(!calls.some((c) => /\bmerge\b/.test(c.args)), 'never merges');
  assert.deepEqual(readLedger(s.paths.ledger).tasks[0]!.pr, r.pr);
  assert.equal(readLedger(s.paths.ledger).tasks[0]!.state, 'review', 'it stays in review until the pull request merges');
  // The ticket gets a draft, for a person to post (D-066).
  assert.deepEqual(r.update, { id: 'ACME-7.1', key: 'ACME-7' });
  const u = readUpdate(s.paths, 'ACME-7.1')!;
  assert.deepEqual([u.task, u.tracker, u.key, u.event, u.state, u.pr, u.by], ['ACME-7', 'jira', 'ACME-7', 'pr-opened', 'draft', { number: 42, url: 'https://github.com/acme/tool/pull/42' }, 'acc land']);
  assert.equal(u.text, 'The change is ready for review: https://github.com/acme/tool/pull/42\nAdd a sum function.', 'the link, and the title when the review has no sentence for the client');
});

test('land posts nothing on any ticket: a GitHub, Jira or Azure DevOps task gets a draft, and landing again drafts an update (D-066)', () => {
  for (const source of [
    { kind: 'github' as const, key: '#12', url: 'https://github.com/acme/tool/issues/12' },
    { kind: 'jira' as const, key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' },
    { kind: 'azure' as const, key: 'AB-3', url: 'https://dev.azure.com/acme/CRM/_workitems/edit/3' },
  ]) {
    const s = setup(source);
    waiveGates(s.paths, s.config, { sha: s.sha, env: s.config.environments[0]!, gates: ['test'], reason: 'r', by: 'human:t', now });
    writeFileSync(reviewPath(s.paths, s.id, s.sha), JSON.stringify({ ...passReview(s.paths, s.id, s.sha, s.base), client: 'Totals now add up on the invoice page.' }));
    const calls: { args: string; opts?: RunOptions }[] = [];
    const r = land(s.paths, s.config, s.id, { run: gh(calls), now, env: {} }, { by: 'human:jordan' });
    assert.ok(!calls.some((c) => c.args.startsWith('issue')), `${source.kind}: no gh issue comment`);
    assert.equal(r.update?.key, source.key);
    const opened = readUpdate(s.paths, r.update!.id)!;
    assert.deepEqual([opened.event, opened.state, opened.tracker, opened.by], ['pr-opened', 'draft', source.kind, 'human:jordan']);
    assert.match(opened.text, /pull\/42\nTotals now add up on the invoice page\.$/, 'the review\'s sentence for the client');

    // Posted, then updated after more work: the next land drafts an update of its own.
    writeFileSync(join(s.paths.updates, `${opened.id}.json`), JSON.stringify({ ...opened, state: 'posted' }));
    const open = JSON.stringify([{ number: 42, url: 'https://github.com/acme/tool/pull/42' }]);
    const again = land(s.paths, s.config, s.id, { run: gh(calls, open), now, env: {} });
    assert.ok(!calls.some((c) => c.args.startsWith('issue')), `${source.kind}: still no comment`);
    const updated = readUpdate(s.paths, again.update!.id)!;
    assert.deepEqual([again.opened, updated.id, updated.event, updated.state], [false, `${s.id}.2`, 'pr-updated', 'draft']);
    assert.match(updated.text, /^The change was updated and is ready for review again: https:\/\/github\.com\/acme\/tool\/pull\/42/);
  }
});

test('a task acc alone keeps has no ticket, so a land drafts nothing', () => {
  const s = setup({ kind: 'manual', key: null });
  waiveGates(s.paths, s.config, { sha: s.sha, env: s.config.environments[0]!, gates: ['test'], reason: 'r', by: 'human:t', now });
  passReview(s.paths, s.id, s.sha, s.base);
  const r = land(s.paths, s.config, s.id, { run: gh([]), now, env: {} });
  assert.deepEqual([r.opened, r.update], [true, null]);
  assert.deepEqual(listUpdates(s.paths), []);
});

test('landing again updates the open pull request rather than opening another', () => {
  const s = setup({ kind: 'github', key: '#12', url: 'https://github.com/acme/tool/issues/12' });
  waiveGates(s.paths, s.config, { sha: s.sha, env: s.config.environments[0]!, gates: ['test'], reason: 'r', by: 'human:t', now });
  passReview(s.paths, s.id, s.sha, s.base);
  mutate(s.paths, now, (l, emit) => {
    l.tasks[0]!.pr = { number: 7, url: 'https://github.com/acme/tool/pull/7', state: 'open', landedAt: '2026-10-01T10:00:00.000Z' };
    emit({ type: 'task.updated', task: s.id, actor: 'human', by: 'test', data: {} });
  });
  const open = JSON.stringify([{ number: 7, url: 'https://github.com/acme/tool/pull/7' }]);
  const calls: { args: string; opts?: RunOptions }[] = [];
  const r = land(s.paths, s.config, s.id, { run: gh(calls, open), now, env: {} });
  assert.deepEqual([r.opened, r.pr.number, r.update], [false, 7, { id: 'GH-12.1', key: '#12' }]);
  assert.ok(calls.some((c) => c.args.startsWith('pr edit 7')));
  assert.ok(!calls.some((c) => c.args.startsWith('pr create')));
  assert.equal(readLedger(s.paths.ledger).tasks[0]!.pr?.landedAt, now().toISOString(), 'it records when it landed');
  assert.equal(readUpdate(s.paths, 'GH-12.1')?.event, 'pr-updated');
});

test('land names the files a pull request it opens conflicts in with its base, and changes no branch', () => {
  const s = setup();
  landOnOrigin(s.origin, s.base, 'sum.js', 'export const sum = (...xs) => xs.reduce((a, b) => a + b, 0);\n');
  waiveGates(s.paths, s.config, { sha: s.sha, env: s.config.environments[0]!, gates: ['test'], reason: 'r', by: 'human:t', now });
  passReview(s.paths, s.id, s.sha, s.base);
  const before = localState(s.dir);
  const r = land(s.paths, s.config, s.id, { run: gh([]), now, env: {} });
  assert.deepEqual(r.pr.conflicts, ['sum.js']);
  assert.deepEqual(readLedger(s.paths.ledger).tasks[0]!.pr?.conflicts, ['sum.js']);
  assert.deepEqual(localState(s.dir), before, 'no local branch moved, and the working tree is as it was');
});

test('as autopilot, land won\'t open a pull request beside one the ledger names that GitHub no longer has open; a person still can (D-063)', () => {
  const s = setup();
  waiveGates(s.paths, s.config, { sha: s.sha, env: s.config.environments[0]!, gates: ['test'], reason: 'r', by: 'human:t', now });
  passReview(s.paths, s.id, s.sha, s.base);
  // The ledger says open; on GitHub it was closed or merged since acc last looked.
  mutate(s.paths, now, (l, emit) => {
    l.tasks[0]!.pr = { number: 41, url: 'https://github.com/acme/tool/pull/41', state: 'open' };
    emit({ type: 'task.updated', task: s.id, actor: 'human', by: 'test', data: {} });
  });
  const calls: { args: string; opts?: RunOptions }[] = [];
  assert.throws(() => land(s.paths, s.config, s.id, { run: gh(calls), now, env: {} }, { actor: 'orchestrator', by: 'orchestrator:autopilot' }), /^AccError: Pull request #41 isn't open on GitHub\. Autopilot won't open another: a person decides\.$/);
  assert.ok(!calls.some((c) => c.args.startsWith('pr create')), 'no new pull request');
  assert.equal(gitIn(s.origin, 'branch', '--list', 'task/*').trim(), '', 'asked before the push: a merged pull request\'s deleted branch isn\'t made again');
  assert.equal(readLedger(s.paths.ledger).tasks[0]!.pr?.number, 41);

  // gh couldn't list them: autopilot can't tell, so it doesn't open one either.
  const failing = fakeRunner({ 'gh auth token -u jordan-kim': ok('gho_token\n'), 'gh pr list': bad('HTTP 502: Bad Gateway') });
  assert.throws(() => land(s.paths, s.config, s.id, { run: failing, now, env: {} }, { actor: 'orchestrator' }), /Pull request #41 may not be open on GitHub: gh couldn't list the branch's pull requests \(HTTP 502: Bad Gateway\)\. Autopilot won't open another/);

  // A person decides to open a new one.
  const r = land(s.paths, s.config, s.id, { run: gh(calls), now, env: {} });
  assert.deepEqual([r.opened, r.pr.number, r.pr.state], [true, 42, 'open']);
  assert.equal(gitIn(s.origin, 'rev-parse', 'task/T-1-add-sum').trim(), s.sha);
});

test('the pull request says what it does, ticks its acceptance criteria, and shows each check, waivers included', () => {
  const s = setup({ kind: 'github', key: '#12', url: 'https://github.com/acme/tool/issues/12' });
  waiveGates(s.paths, s.config, { sha: s.sha, env: s.config.environments[0]!, gates: ['test'], reason: 'a test task | never promoted', by: 'human:jordan', now });
  const task = readLedger(s.paths.ledger).tasks[0]!;
  const body = prBody(task, s.config.environments[0]!, s.sha, passReview(s.paths, s.id, s.sha, s.base), receiptsAt(s.paths, s.sha));
  assert.match(body, /^Adds sum\(a, b\) with a test\./);
  assert.match(body, /Ticket: \[#12\]\(https:\/\/github\.com\/acme\/tool\/issues\/12\) \(refs #12\)/);
  assert.match(body, /- \[x\] sum returns a \+ b \(sum\.js:1\)/);
  assert.match(body, /\| `test` \| Waived by jordan \| a test task \\\| never promoted \|/);
  assert.match(body, /`sum\.js:1`: Consider a JSDoc comment\./);
  assert.ok(!/closes|fixes|resolves/i.test(body), 'a person closes the ticket');
  assert.match(body, /\(main\)\. It merges only when a person merges it\.\n$/);
  // Where auto-merge covers its environment, it says autopilot merges it, and how to hold it (GH-67).
  const auto = prBody(task, s.config.environments[0]!, s.sha, passReview(s.paths, s.id, s.sha, s.base), receiptsAt(s.paths, s.sha), true);
  assert.match(auto, /\(main\)\. With autopilot running, it merges once its checks pass on GitHub and nothing waits on a person: auto-merge is on for this repo\. Ask for changes to hold it\.\n$/);
  // A ratchet shows its numbers, from the environment's floor to this commit's (GH-99).
  const ratchet = (value: number, base: number | null): Receipt => ({
    gate: 'tests', sha: s.sha, env: 'main', status: 'pass', startedAt: '', finishedAt: '', durationMs: 0, summary: 'tests 674, at its floor.', command: 'node scripts/count-tests.mjs', log: null,
    details: { ratchet: { label: 'tests', limit: 'floor', value, floor: value, base, diff: base === null ? null : value - base } },
  });
  const review = passReview(s.paths, s.id, s.sha, s.base);
  assert.match(prBody(task, s.config.environments[0]!, s.sha, review, { tests: ratchet(674, 669) }), /\| `tests` \| Passed \| tests 669 → 674 \(\+5\) \|/);
  assert.match(prBody(task, s.config.environments[0]!, s.sha, review, { tests: ratchet(674, null) }), /\| `tests` \| Passed \| tests 674 \(first floor\) \|/);
  // Its builder's note, as the builder's own account (D-106), or that it left none.
  assert.match(body, /## Builder's note\n\n_Its builder left no note\._\n/);
  const note = { landed: ['sum(a, b)'], moved: ['1 test added'], open: [], at: '2026-10-01T12:00:00Z', by: 'builder:T-1', ended: 'review' as const };
  const noted = prBody({ ...task, run: { ...task.run, note } }, s.config.environments[0]!, s.sha, passReview(s.paths, s.id, s.sha, s.base), receiptsAt(s.paths, s.sha));
  assert.match(noted, /## Review\n[\s\S]*## Builder's note\n\nIn its builder's own words, as it finished\. The review above is what checked the change\.\n\n\*\*What landed\*\*\n\n- sum\(a, b\)\n\n\*\*Numbers that moved\*\*\n\n- 1 test added\n\n\*\*Still open\*\*\n\n- none\n\n---\n/);
});

test('the pull request\'s checks say what each test check ran, "not read" where acc couldn\'t tell, and a hold as needing a person (GH-100)', () => {
  const s = setup();
  const at = { sha: s.sha, env: 'main', startedAt: now().toISOString(), finishedAt: now().toISOString(), durationMs: 1, log: null };
  const receipts: Record<string, Receipt> = {
    check: { ...at, gate: 'check', status: 'pass', summary: 'Passed.', command: 'npm run check', counts: { run: 312, passed: 312, failed: 0, skipped: 2, todo: 0, runner: 'node:test' } },
    near: { ...at, gate: 'near', status: 'hold', summary: 'Ran no tests, so it can\'t vouch for the change.', command: 'npm run near', counts: { run: 0, passed: 0, failed: 0, skipped: 0, todo: 0, runner: 'node:test' } },
    e2e: { ...at, gate: 'e2e', status: 'fail', summary: '1 failing', command: 'npm run e2e', counts: { run: 21, passed: 20, failed: 1, skipped: 0, todo: 3, runner: 'jest' } },
    smoke: { ...at, gate: 'smoke', status: 'pass', summary: 'Passed.', command: 'make smoke', countsNote: NO_COUNTS },
    lint: { ...at, gate: 'lint', status: 'pass', summary: 'Passed.', command: 'eslint .' },
  };
  const task = readLedger(s.paths.ledger).tasks[0]!;
  const body = prBody(task, s.config.environments[0]!, s.sha, passReview(s.paths, s.id, s.sha, s.base), receipts);
  const table = body.split('\n').filter((l) => l.startsWith('|'));
  assert.deepEqual(table, [
    '| Check | Result | Tests | Detail |',
    '|---|---|---|---|',
    '| `check` | Passed | 312 run, 2 skipped | Passed. |',
    '| `near` | Needs a person | 0 run, 0 skipped | Ran no tests, so it can\'t vouch for the change. |',
    '| `e2e` | Failed | 21 run, 1 failed, 0 skipped, 3 todo | 1 failing |',
    '| `smoke` | Passed | not read | Passed. |',
    '| `lint` | Passed |  | Passed. |',
  ]);
  // With no test check, the table is as it was.
  const plain = prBody(task, s.config.environments[0]!, s.sha, passReview(s.paths, s.id, s.sha, s.base), { lint: receipts.lint! });
  assert.deepEqual(plain.split('\n').filter((l) => l.startsWith('|')), ['| Check | Result | Detail |', '|---|---|---|', '| `lint` | Passed | Passed. |']);
});

// ---------------------------------------------------------------- acc sync

function withPr(pr: number) {
  const s = setup();
  mutate(s.paths, now, (l, emit) => {
    l.tasks[0]!.pr = { number: pr, url: `https://github.com/acme/tool/pull/${pr}`, state: 'open' };
    emit({ type: 'task.updated', task: s.id, actor: 'human', by: 'test', data: {} });
  });
  return s;
}
const view = (state: string, extra: Record<string, unknown> = {}) => fakeRunner({
  'gh auth token -u jordan-kim': ok('gho_token\n'),
  'gh pr view': ok(JSON.stringify({ number: 42, state, url: 'https://github.com/acme/tool/pull/42', reviewDecision: null, statusCheckRollup: [], ...extra })),
});

test('sync: a merged pull request makes its task done, and a closed one blocks it with the reason', () => {
  const merged = withPr(42);
  const calls: string[] = [];
  const mergeCommit = { oid: 'c0ffee'.padEnd(40, '0') };
  const fake = fakeRunner({ 'gh auth token -u jordan-kim': ok('gho_token\n'), 'gh pr view': ok(JSON.stringify({ number: 42, state: 'MERGED', url: 'https://github.com/acme/tool/pull/42', mergeCommit, statusCheckRollup: [] })) }, calls);
  const r = sync(merged.paths, merged.config, { run: fake, now, env: {} });
  assert.deepEqual(r.changes.map((c) => [c.task, c.moved, c.update]), [[merged.id, { from: 'review', to: 'done' }, { id: `${merged.id}.1`, key: 'ACME-7' }]]);
  assert.match(calls.find((c) => c.startsWith('gh pr view'))!, /--json \S*mergeCommit/);
  const t = readLedger(merged.paths.ledger).tasks[0]!;
  assert.deepEqual([t.state, t.pr?.state, t.pr?.mergeSha, t.history.at(-1)?.actor], ['done', 'merged', mergeCommit.oid, 'sync'], 'it keeps the commit the merge left on the base');
  // Merged into its environment: a draft for the ticket, which sync, running unattended, never posts (D-066).
  assert.deepEqual(listUpdates(merged.paths).map((u) => [u.event, u.env, u.state, u.by, u.text]), [['merged', merged.config.environments[0]!.name, 'draft', 'acc sync', `The change was approved and merged into ${merged.config.environments[0]!.name}.`]]);
  assert.ok(!calls.some((c) => c.startsWith('gh issue') || c.startsWith('gh api')), 'nothing is posted');
  assert.deepEqual(sync(merged.paths, merged.config, { run: view('MERGED'), now, env: {} }), { checked: 0, changes: [], cloud: [], reviews: [], branches: [] }, 'nothing left to follow');
  assert.equal(listUpdates(merged.paths).length, 1, 'drafted once');

  const open = withPr(42);
  sync(open.paths, open.config, { run: view('OPEN'), now, env: {} });
  assert.deepEqual(listUpdates(open.paths), [], 'a pull request still open drafts nothing');

  const closed = withPr(42);
  sync(closed.paths, closed.config, { run: view('CLOSED'), now, env: {} });
  const c = readLedger(closed.paths.ledger).tasks[0]!;
  assert.equal(c.state, 'blocked');
  assert.match(c.blocker!, /closed without merging/);

  // A rework's builder running when its pull request closes: the task leaves running, and stops keeping the Mac awake (D-067).
  const reworking = withPr(42);
  mutate(reworking.paths, now, (l, emit) => { l.tasks[0]!.state = 'running'; emit({ type: 'task.updated', task: reworking.id, actor: 'human', by: 'test', data: {} }); });
  mkdirSync(join(reworking.paths.stateDir, 'awake'), { recursive: true });
  writeFileSync(awakePath(reworking.paths, reworking.id), JSON.stringify({ pid: 4_000_001, watch: 4_000_002 }));
  const moved = sync(reworking.paths, reworking.config, { run: view('CLOSED'), now, env: {} });
  assert.deepEqual(moved.changes.map((x) => x.moved), [{ from: 'running', to: 'blocked' }]);
  assert.equal(existsSync(awakePath(reworking.paths, reworking.id)), false);
});

test('sync: failing checks or a person\'s requested changes show an open pull request\'s task as needs you, and nothing is written when nothing changed', () => {
  const s = withPr(42);
  const failing = view('OPEN', { statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { status: 'COMPLETED', conclusion: 'FAILURE' }] });
  assert.equal(sync(s.paths, s.config, { run: failing, now, env: {} }).changes[0]!.note, '#42: checks failing');
  let l = readLedger(s.paths.ledger);
  assert.equal(displayState(l, l.tasks[0]!), 'needs-you');
  const seq = l.seq;
  assert.deepEqual(sync(s.paths, s.config, { run: failing, now, env: {} }).changes, []);
  assert.equal(readLedger(s.paths.ledger).seq, seq, 'an unchanged pull request leaves the log alone');
  sync(s.paths, s.config, { run: view('OPEN', { reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] }), now, env: {} });
  l = readLedger(s.paths.ledger);
  assert.deepEqual([l.tasks[0]!.pr?.ci, l.tasks[0]!.pr?.changesRequested, displayState(l, l.tasks[0]!)], ['passing', true, 'needs-you']);
  assert.equal(ciOf([{ status: 'IN_PROGRESS' }]), 'pending');
  assert.equal(ciOf([{ state: 'SUCCESS' }]), 'passing');
  assert.equal(ciOf(null), null);
});

test('sync keeps the names of the checks that failed, a check run\'s or a commit status\'s, and drops them once they pass (D-076)', () => {
  const s = withPr(42);
  const rollup = [
    { __typename: 'CheckRun', name: 'build', workflowName: 'CI', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', name: 'build', workflowName: 'CI', status: 'COMPLETED', conclusion: 'FAILURE' },
    { __typename: 'CheckRun', name: 'lint', workflowName: 'CI', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { __typename: 'StatusContext', context: 'ci/jenkins', state: 'ERROR' },
  ];
  assert.deepEqual(failingOf(rollup), ['build', 'ci/jenkins'], 'once each, as ciOf counts them');
  sync(s.paths, s.config, { run: view('OPEN', { statusCheckRollup: rollup }), now, env: {} });
  let l = readLedger(s.paths.ledger);
  assert.deepEqual([l.tasks[0]!.pr?.ci, l.tasks[0]!.pr?.failing, displayState(l, l.tasks[0]!)], ['failing', ['build', 'ci/jenkins'], 'needs-you']);
  const seq = l.seq;
  assert.deepEqual(sync(s.paths, s.config, { run: view('OPEN', { statusCheckRollup: rollup }), now, env: {} }).changes, [], 'nothing changed, nothing written');
  assert.equal(readLedger(s.paths.ledger).seq, seq);
  sync(s.paths, s.config, { run: view('OPEN', { statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS', name: 'build' }] }), now, env: {} });
  l = readLedger(s.paths.ledger);
  assert.deepEqual([l.tasks[0]!.pr?.ci, 'failing' in l.tasks[0]!.pr!], ['passing', false], 'passing: no names kept');
});

test('sync: an open pull request records the files it conflicts in with its base, from a fetch and git merge-tree, and changes no branch', () => {
  const s = withPr(42);
  gitIn(s.dir, 'push', '-q', 'origin', 'task/T-1-add-sum');
  const open = view('OPEN', { statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] });
  sync(s.paths, s.config, { run: open, now, env: {} });
  let l = readLedger(s.paths.ledger);
  assert.deepEqual([l.tasks[0]!.pr?.conflicts, displayState(l, l.tasks[0]!)], [[], 'review'], 'a clean merge has no conflicts and needs nothing');

  // Another branch changes sum.js on the base first: a real conflict, seen only on GitHub's copy.
  landOnOrigin(s.origin, s.base, 'sum.js', 'export const sum = (...xs) => xs.reduce((a, b) => a + b, 0);\n');
  landOnOrigin(s.origin, s.base, 'README.md', '# still merges\n');
  const before = localState(s.dir);
  const named = view('OPEN', { baseRefName: s.base, headRefName: 'task/T-1-add-sum', statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }] });
  const r = sync(s.paths, s.config, { run: named, now, env: {} });
  assert.equal(r.changes[0]!.note, `#42: conflicts with ${s.base} in sum.js`);
  l = readLedger(s.paths.ledger);
  assert.deepEqual([l.tasks[0]!.pr?.conflicts, displayState(l, l.tasks[0]!)], [['sum.js'], 'needs-you'], 'only the file both changed, and the task needs you');
  assert.deepEqual(localState(s.dir), before, 'no local branch moved, and the working tree is as it was');
  assert.notEqual(gitIn(s.dir, 'rev-parse', s.base), gitIn(s.dir, 'rev-parse', `origin/${s.base}`), 'only the remote-tracking ref saw the new base');

  const seq = l.seq;
  assert.deepEqual(sync(s.paths, s.config, { run: named, now, env: {} }).changes, [], 'the same conflict is written once');
  gitIn(s.dir, 'remote', 'set-url', 'origin', join(s.dir, 'gone'));
  assert.deepEqual(sync(s.paths, s.config, { run: named, now, env: {} }).changes, [], 'offline, what git last said stands');
  assert.equal(readLedger(s.paths.ledger).seq, seq);
  assert.deepEqual(readLedger(s.paths.ledger).tasks[0]!.pr?.conflicts, ['sum.js']);
});
