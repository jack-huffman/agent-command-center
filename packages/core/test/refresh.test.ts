import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { type AutopilotDeps, autopilotPass, type AutopilotStep } from '../src/autopilot.ts';
import { type Config, parseConfig } from '../src/config.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { displayState, mutate, type PullRequest, readLedger, type Task, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { readReceipt } from '../src/receipts.ts';
import { appendOnlyMerge, refresh } from '../src/refresh.ts';
import { reviewPath, type Verdict } from '../src/review.ts';
import { bad, fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, tempDir } from './support.ts';

const now = () => new Date('2026-10-05T12:00:00Z');
const BRANCH = 'task/T-1-add-sum';
const DECISIONS = '# Decisions\n\n## D-001 Sums (2026-10-01)\n\nsum adds.\n';
const SUM = 'export const sum = (a, b) => a + b;\n';
const MAIN_ENTRY = '\n## D-002 Main moved on (2026-10-04)\n\nFrom main.\n';
const BRANCH_ENTRY = '\n## D-??? The branch\'s own (2026-10-05)\n\nFrom the branch.\n';

// ---------------------------------------------------------------- the rule, on its own

test('append-only: the base\'s additions, then the branch\'s, when both only added to the end', () => {
  assert.equal(appendOnlyMerge('a\n', 'a\nours\n', 'a\ntheirs\n'), 'a\ntheirs\nours\n');
  assert.equal(appendOnlyMerge(DECISIONS, DECISIONS + BRANCH_ENTRY, DECISIONS + MAIN_ENTRY), DECISIONS + MAIN_ENTRY + BRANCH_ENTRY, 'entries keep their blank line between them');
  assert.equal(appendOnlyMerge('', 'ours\n', 'theirs\n'), 'theirs\nours\n', 'an empty file both added to');
  assert.equal(appendOnlyMerge('a\n', 'a\n', 'a\ntheirs\n'), 'a\ntheirs\n', 'one side added nothing');
  assert.equal(appendOnlyMerge('a\n', 'a\nours\n', 'a\n'), 'a\nours\n');
  assert.equal(appendOnlyMerge('a\n', 'a\nsame\n', 'a\nsame\n'), 'a\nsame\n', 'the same addition on both sides is kept once, as git keeps it');
});

test('append-only: entries stay on lines of their own when a side leaves its last line unended', () => {
  assert.equal(appendOnlyMerge('a\n', 'a\nours\n', 'a\ntheirs'), 'a\ntheirs\nours\n', 'the base branch\'s addition has no newline');
  assert.equal(appendOnlyMerge('a', 'a\nours', 'a\ntheirs'), 'a\ntheirs\nours', 'nor does the merge base\'s last line');
  assert.equal(appendOnlyMerge('a', 'a\nours\n', 'a\ntheirs\n'), 'a\ntheirs\nours\n');
  assert.equal(appendOnlyMerge('# D', '# D\n\n## B\n', '# D\n\n## M\n'), '# D\n\n## M\n\n## B\n', 'no extra blank line');
  assert.equal(appendOnlyMerge('a', 'aours\n', 'a\ntheirs\n'), null, 'a side that changed the unended last line itself');
});

test('append-only: an edit anywhere but the end isn\'t an addition', () => {
  assert.equal(appendOnlyMerge('a\nb\n', 'A\nb\nours\n', 'a\nb\ntheirs\n'), null, 'the branch edited the start');
  assert.equal(appendOnlyMerge('a\nb\n', 'a\nb\nours\n', 'a\nB\ntheirs\n'), null, 'the base branch edited its last line');
  assert.equal(appendOnlyMerge('a\nb\n', 'a\n', 'a\nb\ntheirs\n'), null, 'the branch deleted a line');
});

// ---------------------------------------------------------------- a real repo, origin and worktree

/**
 * A repo whose origin is a local bare repo, with T-1's branch in a worktree of its own, landed at its
 * latest commit and reviewed there. Its pull request is open. Nothing conflicts until a test says so.
 */
function setup(opts: { appendOnly?: string[] } = {}) {
  const RAW = {
    ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'jordan-kim' }, autonomy: 'review',
    gates: { required: ['test'], commands: { test: 'npm test' } },
    autopilot: { appendOnly: opts.appendOnly ?? ['docs/DECISIONS.md'] },
  };
  const origin = tempDir('origin-');
  run('git', ['init', '-q', '--bare', origin]);
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(RAW), 'docs/DECISIONS.md': DECISIONS, 'sum.js': SUM });
  gitIn(dir, 'remote', 'add', 'origin', origin);
  gitIn(dir, 'push', '-q', 'origin', 'main');
  const wt = join(tempDir('worktrees-'), 'T-1');
  gitIn(dir, 'worktree', 'add', '-q', '-b', BRANCH, wt, 'main');
  const config = parseConfig(RAW).config as Config;
  const paths = repoPaths(dir, run);
  const write = (root: string, files: Record<string, string>, message: string): string => {
    for (const [rel, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), text);
    }
    gitIn(root, 'add', '-A');
    gitIn(root, 'commit', '-q', '-m', message);
    return gitIn(root, 'rev-parse', 'HEAD');
  };
  /** The builder's commit, landed: on origin, its pull request at it, and reviewed. */
  const onBranch = (files: Record<string, string>): string => {
    const sha = write(wt, files, 'T-1: the change');
    gitIn(dir, 'push', '-q', 'origin', `${BRANCH}:${BRANCH}`);
    const v: Verdict = { v: 1, task: 'T-1', sha, env: 'main', verdict: 'pass', summary: 'Adds sum.', criteria: [], findings: [], sessionId: 's', at: now().toISOString(), durationMs: 1, costUsd: null };
    mkdirSync(paths.reviews, { recursive: true });
    writeFileSync(reviewPath(paths, 'T-1', sha), JSON.stringify(v));
    return sha;
  };
  /** Someone else's work merged into main on GitHub. */
  const onMain = (files: Record<string, string>): string => {
    const sha = write(dir, files, 'Another task');
    gitIn(dir, 'push', '-q', 'origin', 'main');
    return sha;
  };
  /** The pull request as acc last saw it: open, at the branch's commit, conflicting in these files. */
  const opened = (sha: string, conflicts: string[]) => mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Add a sum function', brief: 'sum(a, b)' }], 'human', 'human:test', emit, now);
    const t = l.tasks[0]!;
    t.state = 'review';
    t.run = { branch: BRANCH, worktree: wt };
    t.pr = { number: 42, url: 'https://github.com/acme/tool/pull/42', state: 'open', landedAt: '2026-10-05T10:00:00.000Z', sha, conflicts };
  });
  return { dir, origin, wt, config, paths, onBranch, onMain, opened };
}

/** Stand-ins for gh, claude and the check, recording every call. Git really runs. */
function deps(calls: string[], check: RunResult | ((o?: RunOptions) => RunResult) = ok('1 passing')): AutopilotDeps {
  return {
    run: fakeRunner({
      'nice -n 15 sh -c': check,
      'gh auth token -u jordan-kim': ok('gho_token\n'),
      'gh pr list': ok(JSON.stringify([{ number: 42, url: 'https://github.com/acme/tool/pull/42' }])),
      'gh pr edit': ok(''),
      'claude -p': { code: 0, stderr: '', stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'sess-review', total_cost_usd: 0.1, structured_output: { verdict: 'pass', summary: 'Adds sum, with main merged in.', criteria: [], findings: [] } }) },
    }, calls),
    now, env: {}, accBinDir: '/opt/acc/bin', slots: { dir: join(tempDir('slots-'), 'heavy') },
  };
}

const first = (paths: ReturnType<typeof repoPaths>): Task => readLedger(paths.ledger).tasks[0]!;
const brief = (s: AutopilotStep) => [s.task, s.step, s.outcome];
const head = (root: string) => gitIn(root, 'rev-parse', BRANCH);
const merging = (wt: string) => run('git', ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], { cwd: wt }).code === 0;
const pushes = (calls: string[]) => calls.filter((c) => c.startsWith('git push') || c.startsWith('gh pr edit') || c.startsWith('gh pr create'));

test('both sides added a decision: autopilot merges main in, keeps both, checks it, then reviews and lands it on later passes', () => {
  const s = setup();
  const before = s.onBranch({ 'docs/DECISIONS.md': DECISIONS + BRANCH_ENTRY, 'sum.test.js': 'test("sum", () => {});\n' });
  const base = s.onMain({ 'docs/DECISIONS.md': DECISIONS + MAIN_ENTRY });
  s.opened(before, ['docs/DECISIONS.md']);
  const calls: string[] = [];
  const cwds: (string | undefined)[] = [];
  const d = deps(calls, (o) => { cwds.push(o?.cwd); return ok('1 passing'); });

  const r = autopilotPass(s.paths, s.config, d);
  assert.deepEqual(brief(r.steps[0]!), ['T-1', 'refresh', 'done']);
  const merge = head(s.dir);
  assert.match(r.steps[0]!.reason, new RegExp(`^Merged main into ${before.slice(0, 7)} as ${merge.slice(0, 7)}, keeping both sides' additions to docs/DECISIONS\\.md\\. Its checks passed\\. It's reviewed next pass, then landed\\.$`));
  assert.deepEqual(gitIn(s.dir, 'rev-list', '--parents', '-n', '1', merge).split(' ').slice(1), [before, base], 'a merge commit: the branch, then main');
  assert.equal(readFileSync(join(s.wt, 'docs/DECISIONS.md'), 'utf8'), DECISIONS + MAIN_ENTRY + BRANCH_ENTRY, 'main\'s entry first, then the branch\'s');
  assert.equal(gitIn(s.wt, 'show', `${merge}:docs/DECISIONS.md`) + '\n', DECISIONS + MAIN_ENTRY + BRANCH_ENTRY, 'as committed');
  assert.match(gitIn(s.wt, 'log', '-1', '--format=%B', merge), /^Merge main into task\/T-1-add-sum\n\nAutopilot kept both sides' additions to docs\/DECISIONS\.md\.$/);
  assert.equal(gitIn(s.wt, 'status', '--porcelain'), '');
  assert.equal(readReceipt(s.paths, merge, 'test')?.status, 'pass', 'its checks ran on the merge commit');
  assert.deepEqual(cwds.map((c) => realpathSync(c!)), [realpathSync(s.wt)], 'in the task\'s worktree');
  assert.deepEqual(pushes(calls), [], 'nothing pushed yet: it hasn\'t been reviewed');
  assert.equal(gitIn(s.dir, 'rev-parse', `refs/remotes/origin/${BRANCH}`), before);
  assert.deepEqual([gitIn(s.dir, 'branch', '--show-current'), gitIn(s.dir, 'status', '--porcelain'), gitIn(s.dir, 'rev-parse', 'main')], ['main', '', base], 'the main checkout is as it was');
  const e = readFileSync(s.paths.events, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).at(-1);
  assert.deepEqual([e.actor, e.by, e.data], ['orchestrator', 'orchestrator:autopilot', { refreshed: { base: 'main', from: before, to: merge, resolved: ['docs/DECISIONS.md'] } }]);

  const reviewed = autopilotPass(s.paths, s.config, d);
  assert.deepEqual(brief(reviewed.steps[0]!), ['T-1', 'review', 'done'], 'a fresh review of the merge');
  assert.deepEqual(pushes(calls), []);

  const landed = autopilotPass(s.paths, s.config, d);
  assert.deepEqual(brief(landed.steps[0]!), ['T-1', 'land', 'done']);
  assert.equal(landed.steps[0]!.reason, 'Updated pull request #42.');
  assert.equal(pushes(calls).length, 2, 'one push, one edit of the same pull request');
  assert.equal(run('git', ['--git-dir', s.origin, 'rev-parse', BRANCH]).stdout.trim(), merge, 'origin has the merge');
  const t = first(s.paths);
  assert.deepEqual([t.pr?.number, t.pr?.sha, t.pr?.conflicts], [42, merge, []], 'it merges cleanly now');
  assert.equal(displayState(readLedger(s.paths.ledger), t), 'review');

  const idle = autopilotPass(s.paths, s.config, d);
  assert.deepEqual(brief(idle.steps[0]!), ['T-1', null, 'skipped']);
});

test('a real conflict is left alone: the merge is undone, nothing is pushed, and the task needs you, naming the file', () => {
  const s = setup();
  const before = s.onBranch({ 'sum.js': 'export const sum = (a, b) => b + a;\n', 'docs/DECISIONS.md': DECISIONS + BRANCH_ENTRY });
  s.onMain({ 'sum.js': 'export const sum = (...xs) => xs.reduce((a, b) => a + b, 0);\n', 'docs/DECISIONS.md': DECISIONS + MAIN_ENTRY });
  s.opened(before, ['docs/DECISIONS.md', 'sum.js']);
  const calls: string[] = [];

  const r = autopilotPass(s.paths, s.config, deps(calls));
  assert.deepEqual(brief(r.steps[0]!), ['T-1', 'refresh', 'failed']);
  const reason = `Conflicts with main that autopilot can't resolve: sum.js. The branch is as it was, at ${before.slice(0, 7)}, and nothing was pushed.`;
  assert.equal(r.steps[0]!.reason, reason, 'it names what it couldn\'t resolve, not the decision log it could');
  assert.equal(head(s.dir), before);
  assert.deepEqual([gitIn(s.wt, 'status', '--porcelain'), merging(s.wt)], ['', false], 'no merge left half done');
  assert.equal(readFileSync(join(s.wt, 'docs/DECISIONS.md'), 'utf8'), DECISIONS + BRANCH_ENTRY, 'the resolved file is undone too');
  const t = first(s.paths);
  assert.deepEqual(t.autopilot?.failed, { step: 'refresh', sha: before, state: 'review', reason, at: now().toISOString() });
  assert.equal(displayState(readLedger(s.paths.ledger), t), 'needs-you');
  assert.deepEqual(pushes(calls), []);
  assert.ok(!calls.some((c) => c.startsWith('claude') || c.startsWith('nice')), 'no review, and no checks');

  const held = autopilotPass(s.paths, s.config, deps(calls));
  assert.deepEqual(brief(held.steps[0]!), ['T-1', null, 'waiting']);
  assert.match(held.steps[0]!.reason, new RegExp(`^Autopilot couldn't update ${before.slice(0, 7)} from its base: Conflicts with main`));
});

test('an append-only file edited before its end, or added on both sides, is a real conflict', () => {
  const edited = setup();
  const before = edited.onBranch({ 'docs/DECISIONS.md': DECISIONS.replace('# Decisions', '# Decisions, kept in order') + BRANCH_ENTRY });
  edited.onMain({ 'docs/DECISIONS.md': DECISIONS + MAIN_ENTRY });
  edited.opened(before, ['docs/DECISIONS.md']);
  assert.throws(() => refresh(edited.paths, edited.config, 'T-1', deps([]), { actor: 'orchestrator', by: 'test' }), /can't resolve: docs\/DECISIONS\.md\. The branch is as it was/);
  assert.deepEqual([head(edited.dir), gitIn(edited.wt, 'status', '--porcelain'), merging(edited.wt)], [before, '', false]);

  // A folder listed as append-only: both sides added the same new file in it, so there's no merge base to add to.
  const added = setup({ appendOnly: ['docs'] });
  const sha = added.onBranch({ 'docs/NOTES.md': 'from the branch\n' });
  added.onMain({ 'docs/NOTES.md': 'from main\n' });
  added.opened(sha, ['docs/NOTES.md']);
  assert.throws(() => refresh(added.paths, added.config, 'T-1', deps([]), { actor: 'orchestrator', by: 'test' }), /can't resolve: docs\/NOTES\.md\./);
  assert.deepEqual([head(added.dir), merging(added.wt)], [sha, false]);
});

test('a check that fails on the merge: the branch goes back to its commit, nothing is pushed, and the task needs you, naming the check', () => {
  const s = setup();
  const before = s.onBranch({ 'docs/DECISIONS.md': DECISIONS + BRANCH_ENTRY });
  s.onMain({ 'docs/DECISIONS.md': DECISIONS + MAIN_ENTRY });
  s.opened(before, ['docs/DECISIONS.md']);
  const calls: string[] = [];

  // The check leaves output behind that nothing ignores, as a build can.
  const failing = (o?: RunOptions) => {
    writeFileSync(join(o!.cwd!, 'coverage.txt'), '41%\n');
    return bad('1 failing: sum adds strings');
  };
  const r = autopilotPass(s.paths, s.config, deps(calls, failing));
  assert.deepEqual(brief(r.steps[0]!), ['T-1', 'refresh', 'failed']);
  const reason = r.steps[0]!.reason;
  assert.match(reason, /^Merged main in, but its checks failed on [0-9a-f]{7}: test failed: 1 failing: sum adds strings \(log .+test\.log\)\. The branch is as it was, at [0-9a-f]{7}, and nothing was pushed\.$/);
  assert.ok(existsSync(/\(log (.+?)\)/.exec(reason)![1]!), 'the log it names is there');
  assert.equal(head(s.dir), before, 'rolled back to the commit before the merge');
  assert.deepEqual([gitIn(s.wt, 'status', '--porcelain'), merging(s.wt)], ['?? coverage.txt', false], 'only what the check wrote is left');
  assert.equal(readFileSync(join(s.wt, 'docs/DECISIONS.md'), 'utf8'), DECISIONS + BRANCH_ENTRY);
  assert.deepEqual(pushes(calls), [], 'nothing pushed');
  assert.equal(run('git', ['--git-dir', s.origin, 'rev-parse', BRANCH]).stdout.trim(), before, 'origin\'s branch is as it was');
  const t = first(s.paths);
  assert.deepEqual([t.autopilot?.failed?.step, t.autopilot?.failed?.sha], ['refresh', before], 'recorded on the commit it went back to');
  assert.equal(displayState(readLedger(s.paths.ledger), t), 'needs-you');
  assert.deepEqual(brief(autopilotPass(s.paths, s.config, deps(calls)).steps[0]!), ['T-1', null, 'waiting'], 'not tried again on the same commit');
});

test('a heavy-check slot that stays taken undoes the merge and waits for the next pass, without recording a failure', () => {
  const s = setup();
  const before = s.onBranch({ 'docs/DECISIONS.md': DECISIONS + BRANCH_ENTRY });
  s.onMain({ 'docs/DECISIONS.md': DECISIONS + MAIN_ENTRY });
  s.opened(before, ['docs/DECISIONS.md']);
  // A builder's heavy check holds the only slot, and this process is alive, so it isn't reclaimed.
  const dir = join(tempDir('slots-'), 'heavy');
  mkdirSync(join(dir, 'slot-0'), { recursive: true });
  writeFileSync(join(dir, 'slot-0', 'owner'), JSON.stringify({ pid: process.pid, at: Date.now() }));
  const calls: string[] = [];
  const r = autopilotPass(s.paths, s.config, { ...deps(calls), slots: { dir, slots: 1, timeoutMs: 0, pollMs: 10 } });
  assert.deepEqual([...brief(r.steps[0]!), r.steps[0]!.reason], ['T-1', 'refresh', 'waiting', 'The heavy-check slot stayed taken, so the merge was undone. Autopilot tries again next pass.']);
  assert.deepEqual([head(s.dir), gitIn(s.wt, 'status', '--porcelain'), merging(s.wt)], [before, '', false]);
  assert.equal(first(s.paths).autopilot, undefined);
  assert.ok(!calls.some((c) => c.startsWith('nice')), 'the check never ran');
  assert.deepEqual(brief(autopilotPass(s.paths, s.config, deps(calls)).steps[0]!), ['T-1', 'refresh', 'done'], 'the slot free, it goes ahead');
});

test('it won\'t merge into a worktree with changes, one that\'s gone, or a branch GitHub has commits for', () => {
  const s = setup();
  const before = s.onBranch({ 'docs/DECISIONS.md': DECISIONS + BRANCH_ENTRY });
  s.onMain({ 'docs/DECISIONS.md': DECISIONS + MAIN_ENTRY });
  s.opened(before, ['docs/DECISIONS.md']);
  const attempt = () => refresh(s.paths, s.config, 'T-1', deps([]), { actor: 'orchestrator', by: 'test' });

  writeFileSync(join(s.wt, 'scratch.txt'), 'half done\n');
  assert.throws(attempt, /T-1's worktree has changes nobody committed, so autopilot leaves it alone\./);
  assert.equal(readFileSync(join(s.wt, 'scratch.txt'), 'utf8'), 'half done\n');
  gitIn(s.wt, 'clean', '-fq');

  // Someone pressed "Update branch" on GitHub.
  const tree = gitIn(s.dir, 'rev-parse', `${before}^{tree}`);
  const theirs = gitIn(s.dir, 'commit-tree', tree, '-p', before, '-m', 'Updated on GitHub');
  gitIn(s.dir, 'push', '-q', 'origin', `${theirs}:refs/heads/${BRANCH}`);
  assert.throws(attempt, /origin's task\/T-1-add-sum has commits this clone's branch doesn't, perhaps from GitHub\. Bring them in by hand\./);
  gitIn(s.dir, 'push', '-q', '--force', 'origin', `${before}:refs/heads/${BRANCH}`);

  const at = (worktree: string) => mutate(s.paths, now, (l, emit) => {
    l.tasks[0]!.run = { branch: BRANCH, worktree };
    emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'human:test', data: {} });
  });
  at(join(s.wt, '..', 'gone'));
  assert.throws(attempt, /T-1's worktree isn't on disk any more, so there's nowhere to merge main in\./);
  at(s.dir);
  assert.throws(attempt, /T-1's worktree is the main checkout\. Autopilot merges only in a task's own worktree\./);
  at(s.wt);
  assert.deepEqual([head(s.dir), merging(s.wt), gitIn(s.dir, 'rev-parse', 'HEAD')], [before, false, gitIn(s.dir, 'rev-parse', 'main')], 'nothing was merged anywhere');
  assert.equal(attempt().sha?.length, 40, 'and with all that put right, it merges');
});

test('a conflict acc saw earlier that\'s gone now: nothing is merged, and the pull request is marked clean', () => {
  const s = setup();
  const before = s.onBranch({ 'docs/DECISIONS.md': DECISIONS + BRANCH_ENTRY });
  s.onMain({ 'README.md': '# test, updated\n' });
  s.opened(before, ['docs/DECISIONS.md']);
  const calls: string[] = [];
  const r = autopilotPass(s.paths, s.config, deps(calls));
  assert.deepEqual([...brief(r.steps[0]!), r.steps[0]!.reason], ['T-1', 'refresh', 'done', 'Pull request #42 no longer conflicts with main, so nothing was merged.']);
  assert.equal(head(s.dir), before);
  assert.deepEqual(first(s.paths).pr?.conflicts, []);
  assert.ok(!calls.some((c) => c.startsWith('git merge ') || c.includes(' merge --no-ff') || c.startsWith('nice')), 'no merge, no checks');
  assert.deepEqual(brief(autopilotPass(s.paths, s.config, deps(calls)).steps[0]!), ['T-1', null, 'skipped'], 'up to date');
});

test('the merge commit is made as the repo\'s commit identity, and a pull request no longer open isn\'t touched', () => {
  const s = setup();
  const before = s.onBranch({ 'docs/DECISIONS.md': DECISIONS + BRANCH_ENTRY });
  s.onMain({ 'docs/DECISIONS.md': DECISIONS + MAIN_ENTRY });
  s.opened(before, ['docs/DECISIONS.md']);
  const config: Config = { ...s.config, commitIdentity: { name: 'Jordan Kim', email: 'jordan@example.com' } };
  const r = refresh(s.paths, config, 'T-1', deps([]), { actor: 'orchestrator', by: 'test' });
  assert.equal(gitIn(s.wt, 'log', '-1', '--format=%an <%ae> | %cn <%ce>', r.sha!), 'Jordan Kim <jordan@example.com> | Jordan Kim <jordan@example.com>');

  mutate(s.paths, now, (l, emit) => {
    l.tasks[0]!.pr = { ...(l.tasks[0]!.pr as PullRequest), state: 'merged' };
    emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'human:test', data: {} });
  });
  assert.throws(() => refresh(s.paths, config, 'T-1', deps([]), { actor: 'orchestrator', by: 'test' }), /T-1 is review with pull request #42 merged\. Autopilot updates the open pull request of a task in review\./);
});
