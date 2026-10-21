// Cloud reviewers (T-86): where a review runs, the fire's text, a review fired for a cloud-built task and for
// a local one, acc reading the verdict branch on the fake GitHub (a bare origin) from a clone that stands in
// for the reviewer's session, and what it does with a good verdict, a stale one, a bad one, a missing branch
// and a verdict already kept here; a quiet review needs you; a cloud review counts against the cloud cap.
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cloudGuard, DONE_TRAILER, followCloud } from '../src/cloud.ts';
import { RECORD_LINE, ROLE_LINE, VERDICT_LINE } from '../src/cloud-guard.ts';
import { cloudReviewQuiet, cloudReviewText, cloudReviewWait, followCloudReviews, reviewInCloud, reviewPlace, VERDICT_FILE, verdictBranch, verdictHeads } from '../src/cloud-review.ts';
import { parseConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { FETCH_TIMEOUT_MS, fetchBranches } from '../src/fetch.ts';
import { checkMove, cloudReviews, mutate, noGateHooks, readLedger, upsertTasks } from '../src/ledger.ts';
import { checkVerdict, prepareReview, readVerdict, recordVerdict, reviewPath, VERDICT_SCHEMA } from '../src/review.ts';
import { sync } from '../src/sync.ts';
import { bad, fakeRunner, gitIn, ok, tempDir } from './support.ts';
import { cfg, CLOUD, CLOUD_FIXTURES, cloudClone, commitAndPush, fired, now, RAW, repoWithOrigin, task } from './cloud-support.ts';

/** A cloud-built T-1, collected into review: the cloud session's clone pushed its finish, and acc took it. */
function reviewed(raw: Record<string, unknown> = RAW) {
  const repo = fired(raw);
  commitAndPush(repo.clone, repo.branch, 'a.txt', `T-1: the thing\n\n${DONE_TRAILER}: T-1\nAcc-Landed: a.txt\nAcc-Moved: none\nAcc-Open: none\n`);
  const followed = followCloud(repo.paths, repo.config, repo.follow);
  assert.equal(followed[0]?.outcome, 'collected', followed[0]?.note ?? 'nothing followed');
  assert.equal(task(repo.paths).state, 'review');
  return repo;
}

/** The reviewer's clone pushes its verdict as the cloud reviewer does: review.json alone, on its own branch. */
function pushVerdict(clone: string, branch: string, verdict: unknown, to: string): string {
  gitIn(clone, 'fetch', '-q', 'origin', branch);
  gitIn(clone, 'checkout', '-q', branch);
  writeFileSync(join(clone, VERDICT_FILE), typeof verdict === 'string' ? verdict : JSON.stringify(verdict, null, 2) + '\n');
  gitIn(clone, 'add', VERDICT_FILE);
  gitIn(clone, 'commit', '-q', '-m', 'Review T-1');
  gitIn(clone, 'push', '-q', 'origin', `HEAD:${to}`);
  return gitIn(clone, 'rev-parse', 'HEAD');
}

const PASS = { verdict: 'pass', summary: 'Does the thing in a.txt.', client: 'The thing is done.', criteria: [{ text: 'Do it.', met: true, evidence: 'a.txt:1' }], findings: [] };
const CHANGES = { verdict: 'changes', summary: 'Needs a test.', client: 'Not yet.', criteria: [], findings: [{ message: 'Add a test for a.txt', must: true, file: 'a.txt', line: 1, kind: 'untested change' }] };

test('where a review runs: local unless agents.cloud.review says cloud, and a flag wins either way; the setting parses, refuses a bad value, round-trips, and defaults to local', () => {
  assert.equal(reviewPlace(cfg()), 'local');
  assert.equal(reviewPlace(cfg({ ...RAW, agents: { cloud: { ...CLOUD, review: 'cloud' } } })), 'cloud');
  assert.equal(reviewPlace(cfg({ ...RAW, agents: { cloud: { ...CLOUD, review: 'cloud' } } }), 'local'), 'local');
  assert.equal(reviewPlace(cfg(), 'cloud'), 'cloud');
  assert.equal(reviewPlace({ agents: { cloud: null } }), 'local', 'not opted in: local');
  assert.equal(cfg({ ...RAW, agents: { cloud: {} } }).agents.cloud?.review, 'local');
  assert.match(parseConfig({ ...RAW, agents: { cloud: { review: 'mars' } } }).errors.join(' '), /"agents\.cloud\.review" must be one of local, cloud/);
});

test('the fire\'s text for a reviewer: the three records first, the reviewer\'s standing instructions and prompt as review() builds them, the base and head shas in place of the diff, the packet, the rules, and the schema review.json must fit', () => {
  const { paths, config } = reviewed();
  const r = prepareReview(paths, config, 'T-1', run);
  assert.equal(r.sha, gitIn(paths.root, 'rev-parse', r.branch));
  assert.equal(r.base, 'origin/main', 'compared with the environment branch on GitHub');
  const baseSha = gitIn(paths.root, 'rev-parse', 'main');
  const text = cloudReviewText({ task: r.task, config, envName: r.env.name, envBranch: r.env.branch, branch: r.branch, sha: r.sha, baseSha, packet: r.packet, rules: 'Keep it small.', checks: r.checks, kinds: ['untested change'] });
  const verdict = verdictBranch('T-1', r.sha);
  assert.deepEqual(text.split('\n').slice(0, 3), [`${RECORD_LINE}: ${r.branch}`, `${ROLE_LINE}: reviewer`, `${VERDICT_LINE}: ${verdict}`], 'the guard\'s records come first, a line each');
  for (const must of [
    '# Cloud reviewer for T-1: A thing', 'You are the reviewer, not a builder', `git fetch origin ${r.branch} main && git checkout ${r.branch}`, `Never edit the code, and never push \`${r.branch}\``,
    `git add ${VERDICT_FILE}`, `git commit -m "Review T-1 at ${r.sha.slice(0, 7)}"`, `git push origin HEAD:${verdict}`,
    'You are the reviewer for T-1.', 'Go through each acceptance criterion', `The base commit is ${baseSha} and the commit under review is ${r.sha}`, `git diff --no-color --find-renames ${baseSha} ${r.sha}`,
    '# Task T-1: A thing', 'Do it.', '## Rules', 'Keep it small.', '## Kinds of finding earlier reviews named', '- untested change', JSON.stringify(VERDICT_SCHEMA, null, 2), 'git config user.name "Acme Bot"',
  ]) assert.ok(text.includes(must), must);
  assert.ok(!text.includes('```diff'), 'no diff in the text: the reviewer reads it');
  assert.ok(!text.includes('/Users/'), 'no Mac path');
});

test('acc review --cloud on a cloud-built task fires the routine with the reviewer\'s text, records the cloud review on the task, counts it against the cloud cap, and refuses a second fire; the task stays in review', () => {
  const { paths, config, branch } = reviewed();
  const calls: string[] = [];
  const r = fakeRunner(CLOUD_FIXTURES, calls);
  const deps = { run: r, now, env: { ...process.env, PATH: '/usr/bin' } as NodeJS.ProcessEnv };
  const out = reviewInCloud(paths, config, 'T-1', deps, { actor: 'human', by: 'h' });
  assert.equal(out.sessionId, 'session_01TEST');
  assert.equal(out.url, 'https://claude.ai/code/session_01TEST');
  assert.equal(out.branch, verdictBranch('T-1', out.sha));
  assert.match(out.reason, /Reviewing [0-9a-f]{7} in the cloud: https:\/\/claude\.ai\/code\/session_01TEST\. acc sync reads its verdict from acc\/review\/T-1-/);
  // The branch was on origin already: nothing was pushed before the fire.
  assert.ok(!calls.some((c) => c.startsWith('git push')), 'no push: the cloud builder\'s branch is on origin');
  const fire = calls.find((c) => c.startsWith('curl'))!;
  assert.ok(fire, 'the routine was fired');
  const t = task(paths);
  assert.equal(t.state, 'review');
  assert.deepEqual(t.cloudReview, { sessionId: 'session_01TEST', url: 'https://claude.ai/code/session_01TEST', firedAt: now().toISOString(), sha: out.sha, branch: out.branch, failed: null });
  assert.equal(t.history.at(-1)?.to, 'review', 'no move: the review is under way');
  // A cloud review counts against the cloud cap as a builder does (T-86).
  assert.equal(cloudReviews(readLedger(paths.ledger), ''), 1);
  mutate(paths, now, (l, emit) => upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-2' }, title: 'Another' }], 'human', 'h', emit, now));
  const one = { ...config, agents: { ...config.agents, cloud: { ...config.agents.cloud!, max: 1 } } };
  assert.deepEqual(checkMove(readLedger(paths.ledger), one, task(paths, 'T-2'), { to: 'running', actor: 'human', by: 'h', where: 'cloud' }, noGateHooks), ['1 cloud session is running for this project (0 builders, 1 review), and its cap is 1 (agents.cloud.max).']);
  assert.deepEqual(checkMove(readLedger(paths.ledger), one, task(paths, 'T-2'), { to: 'running', actor: 'human', by: 'h' }, noGateHooks), [], 'the local cap doesn\'t count it');
  // A second fire for the same task is refused: its review is under way.
  assert.throws(() => reviewInCloud(paths, config, 'T-1', deps, { actor: 'human', by: 'h' }), /T-1 is being reviewed in the cloud already/);
  assert.equal(calls.filter((c) => c.startsWith('curl')).length, 1, 'fired once');
  assert.equal(branch, t.run?.branch);
});

test('acc review --cloud is refused, firing nothing, where the project hasn\'t opted in, a need is unmet, the cloud cap is full, the guard isn\'t committed, or the task isn\'t in review', () => {
  const { paths, config } = reviewed();
  const calls: string[] = [];
  const env = { ...process.env, PATH: '/usr/bin' } as NodeJS.ProcessEnv;
  const fires = () => calls.filter((c) => c.startsWith('curl')).length;
  const off = cfg({ ...RAW, agents: { max: 2 } });
  assert.throws(() => reviewInCloud(paths, off, 'T-1', { run: fakeRunner(CLOUD_FIXTURES, calls), now, env }, {}), /Can't review T-1 in the cloud:\n- The project has opted in: Cloud builders are off/);
  assert.throws(() => reviewInCloud(paths, config, 'T-1', { run: fakeRunner({ ...CLOUD_FIXTURES, 'security find-generic-password': bad() }, calls), now, env }, {}), /The routine's token is in this Mac's keychain/);
  // The cap: a cloud builder running on another task fills a cap of 1.
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-2' }, title: 'Another' }], 'human', 'h', emit, now);
    const t2 = l.tasks.find((t) => t.id === 'T-2')!;
    t2.state = 'running';
    t2.run = { worktree: '/w', branch: 'task/T-2', where: 'cloud', cloud: { sessionId: 's', url: 'u', firedAt: now().toISOString(), head: 'x', lastPushAt: now().toISOString() } };
    emit({ type: 'task.updated', task: 'T-2', actor: 'human', by: 'h', data: {} });
  });
  const one = { ...config, agents: { ...config.agents, cloud: { ...config.agents.cloud!, max: 1 } } };
  assert.throws(() => reviewInCloud(paths, one, 'T-1', { run: fakeRunner(CLOUD_FIXTURES, calls), now, env }, {}), /1 cloud session is running for this project, and its cap is 1/);
  assert.equal(fires(), 0, 'nothing fired');
  // The guard not committed on the task branch: refused, naming the fix.
  const unguarded = cloudGuard(fakeRunner({ 'git show': bad('no such path') }), paths.root, 'main', 'task/T-1-a-thing', env);
  assert.match(unguarded.why ?? '', /doesn't carry \.claude\/hooks\/acc-push-guard\.mjs: run acc cloud enable/);
  assert.equal(unguarded.base, 'main');
  assert.throws(() => reviewInCloud(paths, config, 'T-1', { run: fakeRunner({ ...CLOUD_FIXTURES, 'git show': bad('no such path') }, calls), now, env }, {}), /the push guard isn't committed where the cloud session would load it/);
  // Not in review: the review's own refusal, before the cloud is asked anything.
  mutate(paths, now, (l, emit) => { const t = l.tasks[0]!; t.state = 'running'; emit({ type: 'task.updated', task: t.id, actor: 'human', by: 'h', data: {} }); });
  assert.throws(() => reviewInCloud(paths, config, 'T-1', { run: fakeRunner(CLOUD_FIXTURES, calls), now, env }, {}), /T-1 is running\. A review is for work that's in review/);
  assert.equal(fires(), 0);
});

test('a local builder\'s branch is pushed to origin before the fire, and only it (T-86 edge case: the commit under review wasn\'t on GitHub)', () => {
  const { paths, config, origin } = repoWithOrigin();
  // A local build: the branch and its worktree here, the task in review, origin never told.
  const branch = 'task/T-1-a-thing';
  const wt = join(paths.root, '.claude', 'worktrees', 'T-1');
  gitIn(paths.root, 'worktree', 'add', '-q', '-b', branch, wt, 'main');
  writeFileSync(join(wt, 'local.txt'), 'built here\n');
  gitIn(wt, 'add', '-A');
  gitIn(wt, 'commit', '-q', '-m', 'T-1: built here');
  mutate(paths, now, (l, emit) => { const t = l.tasks[0]!; t.state = 'review'; t.run = { worktree: wt, branch }; emit({ type: 'task.updated', task: t.id, actor: 'human', by: 'h', data: {} }); });
  assert.equal(run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: origin }).code, 1, 'origin has no task branch yet');
  const calls: string[] = [];
  const out = reviewInCloud(paths, config, 'T-1', { run: fakeRunner(CLOUD_FIXTURES, calls), now, env: { ...process.env, PATH: '/usr/bin' } as NodeJS.ProcessEnv }, {});
  assert.equal(gitIn(origin, 'rev-parse', branch), out.sha, 'the commit under review is on origin now');
  const push = calls.findIndex((c) => c.startsWith('git push'));
  const fire = calls.findIndex((c) => c.startsWith('curl'));
  assert.ok(push >= 0 && fire > push, `push (${push}) before the fire (${fire})`);
  assert.ok(calls[push]!.endsWith(`origin ${branch}:${branch}`), 'only the task branch');
  assert.equal(gitIn(origin, 'rev-parse', 'main'), gitIn(paths.root, 'rev-parse', 'main'), 'main didn\'t move');
});

test('acc sync takes a cloud review\'s verdict from its branch: a pass is kept and the task stays in review, ready to land; changes moves it to rework with the findings; the branch is deleted on origin after it is read; nothing is read while no branch is there', () => {
  const { paths, config, origin, branch, follow } = reviewed();
  const r = fakeRunner(CLOUD_FIXTURES);
  const deps = { run: r, now, env: follow.env };
  const start = reviewInCloud(paths, config, 'T-1', deps, {});
  // Nothing on origin yet: the review waits, and sync says nothing of it.
  assert.deepEqual(followCloudReviews(paths, config, deps).map((c) => [c.outcome, c.note]), [['waiting', `no verdict on ${start.branch} yet`]]);
  assert.deepEqual(verdictHeads(r, paths.root, follow.env), new Map());
  assert.equal(verdictHeads(fakeRunner({ 'git ls-remote': bad('could not read from remote') }), paths.root, follow.env), null, 'origin didn\'t answer: null, not an empty map');
  assert.equal(task(paths).cloudReview?.sha, start.sha, 'still under way');
  // The reviewer's session pushes its verdict: a pass.
  const reviewer = cloudClone(origin, branch);
  const head = pushVerdict(reviewer, branch, PASS, start.branch);
  assert.deepEqual([...verdictHeads(r, paths.root, follow.env)!], [[start.branch, head]]);
  const later = () => new Date('2026-10-09T12:20:00Z');
  const taken = followCloudReviews(paths, config, { ...deps, now: later });
  assert.deepEqual(taken.map((c) => [c.task, c.outcome, c.moved]), [['T-1', 'taken', null]]);
  assert.match(taken[0]!.note, /its cloud review passed on [0-9a-f]{7}: Does the thing in a\.txt\./);
  const t = task(paths);
  assert.equal(t.state, 'review');
  assert.equal(t.cloudReview, null, 'the cloud review is over');
  const v = readVerdict(paths, 'T-1', start.sha)!;
  assert.ok(v, 'the verdict is kept beside the receipts, for the commit it reviewed');
  assert.deepEqual([v.verdict, v.summary, v.client, v.sessionId, v.env, v.costUsd, v.at, v.durationMs], ['pass', 'Does the thing in a.txt.', 'The thing is done.', 'session_01TEST', 'main', null, later().toISOString(), 20 * 60_000]);
  assert.deepEqual(v.criteria, [{ text: 'Do it.', met: true, evidence: 'a.txt:1' }]);
  assert.equal(v.name, 'Tool · T-1 A thing · review', 'named as a review on this Mac is (D-087)');
  assert.equal(run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${start.branch}`], { cwd: origin }).code, 1, 'the verdict branch is gone from origin');
  assert.equal(gitIn(origin, 'rev-parse', branch), start.sha, 'the task branch on origin is as it was: the reviewer never pushed it');
  assert.deepEqual(followCloudReviews(paths, config, deps), [], 'nothing left to follow');
  // Through acc sync, as the Command Center runs it: the review's outcome comes back in its own list.
  const second = reviewInCloud(paths, config, 'T-1', deps, {});
  assert.equal(second.sha, start.sha, 'the same commit, reviewed again');
  pushVerdict(cloudClone(origin, branch), branch, CHANGES, second.branch);
  // The pass kept here for the commit stands: the new verdict would overwrite a verdict already on this Mac, so it doesn't.
  const synced = sync(paths, config, deps);
  assert.deepEqual(synced.reviews.map((c) => [c.outcome, c.moved]), [['taken', null]]);
  assert.match(synced.reviews[0]!.note, /a verdict for [0-9a-f]{7} was already on this Mac, and it stands/);
  assert.equal(readVerdict(paths, 'T-1', start.sha)!.verdict, 'pass');
  assert.equal(task(paths).state, 'review');
  // Changes, on a fresh commit: the task goes to rework, with the findings for its next builder.
  const wt = task(paths).run!.worktree!;
  writeFileSync(join(wt, 'b.txt'), 'more\n');
  gitIn(wt, 'add', '-A');
  gitIn(wt, 'commit', '-q', '-m', 'T-1: more');
  const third = reviewInCloud(paths, config, 'T-1', deps, {});
  assert.notEqual(third.sha, start.sha);
  assert.equal(gitIn(origin, 'rev-parse', branch), third.sha, 'the new commit was pushed for the reviewer');
  pushVerdict(cloudClone(origin, branch), branch, CHANGES, third.branch);
  const changes = followCloudReviews(paths, config, deps);
  assert.deepEqual(changes.map((c) => [c.outcome, c.moved]), [['taken', 'rework']]);
  assert.match(changes[0]!.note, /asked for changes on [0-9a-f]{7}, so it went to rework: Needs a test\./);
  assert.equal(task(paths).state, 'rework');
  assert.match(task(paths).history.at(-1)!.reason!, /Review asked for changes: Needs a test\./);
  assert.equal(task(paths).history.at(-1)!.by, 'reviewer:T-1 (cloud)');
  assert.deepEqual(readVerdict(paths, 'T-1', third.sha)!.findings, [{ message: 'Add a test for a.txt', must: true, file: 'a.txt', line: 1, kind: 'untested change' }]);
});

test('a verdict for a commit that is no longer the branch\'s head is kept but moves nothing, as a stale local review is treated; a verdict acc can\'t read fails the review, which then needs a person, and the branch goes either way', () => {
  const { paths, config, origin, branch, follow } = reviewed();
  const deps = { run: fakeRunner(CLOUD_FIXTURES), now, env: follow.env };
  const start = reviewInCloud(paths, config, 'T-1', deps, {});
  // The branch moves on here while the reviewer reads the older commit.
  const wt = task(paths).run!.worktree!;
  writeFileSync(join(wt, 'c.txt'), 'later\n');
  gitIn(wt, 'add', '-A');
  gitIn(wt, 'commit', '-q', '-m', 'T-1: later');
  const newer = gitIn(wt, 'rev-parse', 'HEAD');
  pushVerdict(cloudClone(origin, branch), branch, CHANGES, start.branch);
  const stale = followCloudReviews(paths, config, deps);
  assert.deepEqual(stale.map((c) => [c.outcome, c.moved]), [['stale', null]]);
  assert.match(stale[0]!.note, new RegExp(`asked for changes on ${start.sha.slice(0, 7)}, but the branch is at ${newer.slice(0, 7)} now: the verdict is kept, and the task stays in review`));
  assert.equal(task(paths).state, 'review', 'moved nothing');
  assert.equal(task(paths).cloudReview, null, 'the cloud review is over');
  assert.equal(readVerdict(paths, 'T-1', start.sha)!.verdict, 'changes', 'kept for its commit');
  assert.equal(readVerdict(paths, 'T-1', newer), null, 'and not for the newer one');
  assert.equal(run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${start.branch}`], { cwd: origin }).code, 1, 'the branch is deleted on origin');
  // A bad verdict: not JSON, off the schema, and no review.json at all. Each fails the review with why, and the person reviews here.
  for (const [what, body, why] of [
    ['not JSON', '{ not json', /isn't a verdict acc can read \(not JSON\): review it on this Mac/],
    ['no verdict field', { summary: 'x' }, /"verdict" is missing, not "pass" or "changes"/],
    ['a list', [1, 2], /isn't an object/],
    ['no summary', { verdict: 'pass' }, /has no "summary"/],
  ] as const) {
    const again = reviewInCloud(paths, config, 'T-1', deps, {});
    pushVerdict(cloudClone(origin, branch), branch, body, again.branch);
    const r = followCloudReviews(paths, config, deps);
    assert.deepEqual(r.map((c) => [c.outcome, c.moved]), [['bad', null]], what);
    assert.match(r[0]!.note, why, what);
    const t = task(paths);
    assert.equal(t.state, 'review', what);
    assert.match(t.cloudReview?.failed?.reason ?? '', why, `${what}: written on the task`);
    assert.equal(cloudReviewWait(t, config, now()), t.cloudReview!.failed!.reason, `${what}: it needs you, with why`);
    assert.equal(cloudReviewQuiet(t, config, new Date('2026-10-10T12:00:00Z')), false, `${what}: a failed review isn't quiet, it has failed`);
    assert.equal(run('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${again.branch}`], { cwd: origin }).code, 1, `${what}: the branch is deleted on origin`);
    assert.equal(readVerdict(paths, 'T-1', again.sha), null, `${what}: nothing kept`);
    assert.deepEqual(followCloudReviews(paths, config, deps), [], `${what}: a failed review isn't followed on`);
  }
  // A branch without review.json on it.
  const bare = reviewInCloud(paths, config, 'T-1', deps, {});
  const c = cloudClone(origin, branch);
  gitIn(c, 'fetch', '-q', 'origin', branch);
  gitIn(c, 'checkout', '-q', branch);
  writeFileSync(join(c, 'other.txt'), 'x\n');
  gitIn(c, 'add', '-A');
  gitIn(c, 'commit', '-q', '-m', 'not a verdict');
  gitIn(c, 'push', '-q', 'origin', `HEAD:${bare.branch}`);
  assert.match(followCloudReviews(paths, config, deps)[0]!.note, /pushed acc\/review\/T-1-[0-9a-f]+ without review\.json: review it on this Mac/);
  // A review on this Mac after a failed cloud review is the way on: its verdict clears the failure.
  const kept = { v: 1 as const, task: 'T-1', sha: newer, env: 'main', ...checkVerdict(PASS), sessionId: 'local', at: now().toISOString(), durationMs: 1, costUsd: null };
  assert.equal(recordVerdict(paths, config, kept, now, { actor: 'reviewer', by: 'reviewer:T-1' }), null);
  assert.equal(task(paths).cloudReview, null, 'a verdict kept here for the commit ends the cloud review');
  assert.ok(existsSync(reviewPath(paths, 'T-1', newer)));
});

test('the fetch the follows share (T-86 edge case): a branch on origin comes into its remote-tracking ref, a branch gone says false, and the timeout is a bound', () => {
  const { paths, origin, branch, clone, follow } = fired();
  const head = commitAndPush(clone, branch, 'f.txt', 'T-1: fetched');
  assert.equal(fetchBranches(run, paths.root, [branch], follow.env), true);
  assert.equal(gitIn(paths.root, 'rev-parse', `refs/remotes/origin/${branch}`), head);
  assert.equal(fetchBranches(run, paths.root, ['task/T-9-nowhere'], follow.env), false, 'origin has no such branch');
  assert.ok(FETCH_TIMEOUT_MS >= 60_000 && FETCH_TIMEOUT_MS <= 10 * 60_000, `${FETCH_TIMEOUT_MS}`);
  assert.equal(gitIn(origin, 'rev-parse', branch), head);
});

test('a cloud review with no verdict after agents.cloud.quietMinutes needs you, with the reason and a review on this Mac as the way on; one that has answered, or a task not in review, waits on nobody', () => {
  const { paths, config, follow } = reviewed();
  const deps = { run: fakeRunner(CLOUD_FIXTURES), now, env: follow.env };
  reviewInCloud(paths, config, 'T-1', deps, {});
  const t = task(paths);
  assert.equal(cloudReviewQuiet(t, config, new Date('2026-10-09T13:00:00Z')), false, 'an hour in: not yet');
  assert.equal(cloudReviewWait(t, config, new Date('2026-10-09T13:00:00Z')), null);
  const late = new Date('2026-10-09T14:30:00Z');
  assert.equal(cloudReviewQuiet(t, config, late), true);
  assert.equal(cloudReviewWait(t, config, late), 'no verdict from its cloud reviewer for 150 minutes: review it on this Mac');
  assert.equal(cloudReviewQuiet(t, { agents: { ...config.agents, cloud: { ...config.agents.cloud!, quietMinutes: 10 } } }, new Date('2026-10-09T12:15:00Z')), true, 'the project\'s own quiet time');
  assert.equal(cloudReviewQuiet({ ...t, state: 'rework' }, config, late), false, 'moved on: waits on nobody');
  assert.equal(cloudReviewWait({ ...t, cloudReview: null }, config, late), null, 'edge case: no cloud review at all');
  assert.equal(cloudReviewWait({ state: 'review', cloudReview: undefined }, config, late), null, 'edge case: an older task with no field');
});

test('the verdict check reads what the reviewer answered as Claude Code checks it: a pass with a must-fix finding is changes, the lists keep what has the right shape, and junk is refused with why', () => {
  assert.equal(checkVerdict({ verdict: 'pass', summary: 'ok', findings: [{ message: 'fix', must: true }] }).verdict, 'changes');
  const v = checkVerdict({ verdict: 'pass', summary: 'ok', client: '  done  ', criteria: [{ text: 'a', met: 'yes', evidence: 7 }, { nope: true }], findings: [{ message: 'm', must: false, file: '', line: 1.5, rule: 'r', kind: '  k  ' }, { no: 'message' }] });
  assert.deepEqual(v, { verdict: 'pass', summary: 'ok', client: 'done', criteria: [{ text: 'a', met: false, evidence: '7' }], findings: [{ message: 'm', must: false, rule: 'r', kind: 'k' }] });
  for (const [bad, why] of [[null, /isn't an object/], ['x', /isn't an object/], [{ verdict: 'maybe', summary: 'x' }, /"verdict" is "maybe"/], [{ verdict: 'pass', summary: '  ' }, /no "summary"/], [{ verdict: 'pass', summary: 'x', criteria: 'none' }, /"criteria" isn't a list/], [{ verdict: 'pass', summary: 'x', findings: {} }, /"findings" isn't a list/]] as const) {
    assert.throws(() => checkVerdict(bad), why);
  }
});
