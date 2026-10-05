import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig, type Config } from '../src/config.ts';
import { run, type RunOptions } from '../src/exec.ts';
import { runGates, waiveGates } from '../src/gates.ts';
import { land, prBody } from '../src/land.ts';
import { displayState, mutate, readLedger, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { receiptsAt } from '../src/receipts.ts';
import { reviewPath, type Verdict } from '../src/review.ts';
import { ciOf, sync } from '../src/sync.ts';
import { fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, tempDir } from './support.ts';

const now = () => new Date('2026-10-02T12:00:00Z');
const RAW = { ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'jordan-kim' }, gates: { required: ['test'], commands: { test: 'true' } } };

/** A repo whose origin is a local bare repo, with T-1 in review on its own branch. */
function setup(source: { kind: 'github' | 'jira' | 'manual'; key: string | null; url?: string } = { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }) {
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
    'gh issue comment': ok(''),
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
  assert.deepEqual([r.opened, r.pr], [true, { number: 42, url: 'https://github.com/acme/tool/pull/42', state: 'open', conflicts: [] }], 'it merges cleanly into its base');
  assert.equal(gitIn(s.origin, 'rev-parse', 'task/T-1-add-sum').trim(), s.sha, 'the branch is on GitHub at the reviewed commit');
  const create = calls.find((c) => c.args.startsWith('pr create'))!;
  assert.match(create.args, new RegExp(`--base ${s.base} --head task/T-1-add-sum --title ${s.id}: Add a sum function`));
  assert.equal(create.opts?.env?.GH_TOKEN, 'gho_token', 'gh acts as the repo\'s own account');
  assert.ok(!calls.some((c) => /\bmerge\b/.test(c.args)), 'never merges');
  assert.deepEqual(readLedger(s.paths.ledger).tasks[0]!.pr, r.pr);
  assert.equal(readLedger(s.paths.ledger).tasks[0]!.state, 'review', 'it stays in review until the pull request merges');
  assert.deepEqual([r.comment?.kind, r.comment?.key], ['jira', 'ACME-7'], 'a Jira ticket\'s comment goes through the extension');
  assert.match(r.comment!.text, /pull\/42/);
});

test('landing again after rework updates the open pull request, and a GitHub issue gets the comment directly', () => {
  const s = setup({ kind: 'github', key: '#12', url: 'https://github.com/acme/tool/issues/12' });
  waiveGates(s.paths, s.config, { sha: s.sha, env: s.config.environments[0]!, gates: ['test'], reason: 'r', by: 'human:t', now });
  passReview(s.paths, s.id, s.sha, s.base);
  const calls: { args: string; opts?: RunOptions }[] = [];
  const r = land(s.paths, s.config, s.id, { run: gh(calls, JSON.stringify([{ number: 7, url: 'https://github.com/acme/tool/pull/7' }])), now, env: {} });
  assert.deepEqual([r.opened, r.pr.number, r.commented, r.comment], [false, 7, true, null]);
  assert.ok(calls.some((c) => c.args.startsWith('pr edit 7')));
  assert.ok(!calls.some((c) => c.args.startsWith('pr create')));
  assert.match(calls.find((c) => c.args.startsWith('issue comment'))!.args, /^issue comment 12 -R acme\/tool --body .*updated after rework/);
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
  const r = sync(merged.paths, merged.config, { run: view('MERGED'), now, env: {} });
  assert.deepEqual(r.changes.map((c) => [c.task, c.moved]), [[merged.id, { from: 'review', to: 'done' }]]);
  const t = readLedger(merged.paths.ledger).tasks[0]!;
  assert.deepEqual([t.state, t.pr?.state, t.history.at(-1)?.actor], ['done', 'merged', 'sync']);
  assert.deepEqual(sync(merged.paths, merged.config, { run: view('MERGED'), now, env: {} }), { checked: 0, changes: [] }, 'nothing left to follow');

  const closed = withPr(42);
  sync(closed.paths, closed.config, { run: view('CLOSED'), now, env: {} });
  const c = readLedger(closed.paths.ledger).tasks[0]!;
  assert.equal(c.state, 'blocked');
  assert.match(c.blocker!, /closed without merging/);
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
