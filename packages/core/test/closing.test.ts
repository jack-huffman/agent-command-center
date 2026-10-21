import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closesIssues, closeText, issueToClose, settleCloses } from '../src/closing.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { mutate, readLedger, type SourceKind, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { sync } from '../src/sync.ts';
import { draftUpdate, listUpdates } from '../src/updates.ts';
import { bad, fakeRunner, GENERIC_CONFIG, makeRepo, ok } from './support.ts';

const now = () => new Date('2026-10-06T12:00:00Z');
const AT = now().toISOString();
const GITHUB = { repo: 'acme/tool', account: 'jordan-kim' };
const EDITS = [{ kind: 'github', edits: true }];
const ISSUE_9 = { kind: 'github' as SourceKind, key: '#9', url: 'https://github.com/acme/tool/issues/9' };

/** A repo under these trackers with one task in review, its pull request #42 open. */
function inReview(trackers: unknown[] = EDITS, source: { kind: SourceKind; key: string; url: string } = ISSUE_9) {
  const raw = { ...GENERIC_CONFIG, github: GITHUB, trackers };
  const config = parseConfig(raw).config as Config;
  const paths = repoPaths(makeRepo({ '.acc/config.json': JSON.stringify(raw) }), run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source, title: 'Fix login' }], 'human', 'human:test', emit, now);
    const t = l.tasks[0]!;
    t.state = 'review';
    t.pr = { number: 42, url: 'https://github.com/acme/tool/pull/42', state: 'open' };
  });
  return { config, paths, id: readLedger(paths.ledger).tasks[0]!.id };
}

/** GitHub as gh sees it: the pull request merged, and the issue as given. Records each call, and the token each close went with. */
function github(issue: RunResult, close: RunResult = ok('')) {
  const calls: string[] = [];
  const tokens: (string | undefined)[] = [];
  const fake = fakeRunner({
    'gh auth token -u jordan-kim': ok('gho_token\n'),
    'gh pr view': ok(JSON.stringify({ number: 42, state: 'MERGED', url: 'https://github.com/acme/tool/pull/42', mergeCommit: { oid: 'c0ffee'.padEnd(40, '0') }, statusCheckRollup: [] })),
    'gh issue view': issue,
    'gh issue close': (o?: RunOptions) => { tokens.push(o?.env?.GH_TOKEN); return close; },
  }, calls);
  return { fake, calls, tokens, issueCalls: () => calls.filter((c) => c.startsWith('gh issue') || c.startsWith('curl')) };
}
const issue = (state: string, extra: Record<string, unknown> = {}) => ok(JSON.stringify({ state, stateReason: null, url: 'https://github.com/acme/tool/issues/9', ...extra }));
const task = (s: { paths: ReturnType<typeof repoPaths> }, id = 'GH-9') => readLedger(s.paths.ledger).tasks.find((t) => t.id === id)!;

test('a task merged to done has its issue closed as the repo\'s account, with a comment naming the pull request, where the GitHub tracker says "edits" (D-082)', () => {
  const s = inReview();
  // Drafts from before the merge: the pull request's goes, since the close's comment says more; a question for the client stays.
  draftUpdate(s.paths, task(s), { event: 'pr-opened', pr: { number: 42, url: 'https://github.com/acme/tool/pull/42' } }, 'acc land', now);
  draftUpdate(s.paths, task(s), { event: 'blocked', text: 'Which browsers must it support?' }, 'builder:GH-9', now);
  const gh = github(issue('OPEN'));
  const r = sync(s.paths, s.config, { run: gh.fake, now, env: {} });
  assert.deepEqual(r.changes.map((c) => [c.task, c.moved, c.issue, c.update]), [['GH-9', { from: 'review', to: 'done' }, { key: '#9', outcome: 'closed' }, undefined]]);
  assert.equal(r.changes[0]!.note, '#42 merged; closed issue #9; discarded its unposted update GH-9.1');
  assert.deepEqual(gh.issueCalls(), [
    'gh issue view 9 -R acme/tool --json state,stateReason,url',
    'gh issue close 9 -R acme/tool --reason completed --comment Done: pull request #42 merged into main.',
  ], 'it looks first, then closes as completed with the comment, in one call');
  assert.deepEqual(gh.tokens, ['gho_token'], 'as the repo\'s account');
  const t = task(s);
  assert.deepEqual([t.state, t.pr?.state, t.pr?.issue], ['done', 'merged', { state: 'closed', at: AT }]);
  assert.deepEqual(listUpdates(s.paths).map((u) => [u.id, u.event, u.state, u.discarded?.by]), [
    ['GH-9.1', 'pr-opened', 'discarded', 'acc sync'],
    ['GH-9.2', 'blocked', 'draft', undefined],
  ], 'no merged draft: the comment says it merged');

  // Once only: a later sync never asks about it again, even when a person reopened it.
  const later = github(issue('OPEN', { stateReason: 'REOPENED' }));
  assert.deepEqual(sync(s.paths, s.config, { run: later.fake, now, env: {} }), { checked: 0, changes: [], cloud: [], reviews: [], branches: [] });
  assert.deepEqual(later.issueCalls(), [], 'a reopened issue isn\'t closed again by the same merge');
});

test('a tracker without "edits", or no GitHub tracker, leaves the issue alone: the task is done and gets its merged draft, as before', () => {
  for (const trackers of [[{ kind: 'github' }], [{ kind: 'github', edits: false }], [{ kind: 'github', repo: 'client/app' }], []]) {
    const s = inReview(trackers);
    const gh = github(issue('OPEN'));
    const r = sync(s.paths, s.config, { run: gh.fake, now, env: {} });
    const what = JSON.stringify(trackers);
    assert.deepEqual(r.changes.map((c) => [c.moved?.to, c.issue, c.update?.key]), [['done', undefined, '#9']], what);
    assert.deepEqual(gh.issueCalls(), [], `${what}: no gh issue call`);
    assert.equal(task(s).pr?.issue, undefined, what);
    assert.deepEqual(listUpdates(s.paths).map((u) => [u.event, u.state]), [['merged', 'draft']], what);
  }
  assert.equal(closesIssues(parseConfig({ ...GENERIC_CONFIG, trackers: EDITS }).config!), false, 'no repo account to close as');
  const config = parseConfig({ ...GENERIC_CONFIG, github: GITHUB, trackers: EDITS }).config!;
  assert.equal(issueToClose(config, { id: 'T-1', source: { kind: 'manual', key: 'T-1', url: null } }), null, 'a task acc alone keeps has no issue');
});

test('Jira and Azure DevOps tickets are never changed, even where their tracker says "edits": their status is the client\'s workflow', () => {
  const jira = inReview([{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', edits: true }, ...EDITS], { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' });
  const azure = inReview([{ kind: 'azure', organization: 'acme', project: 'Tool', edits: true }, ...EDITS], { kind: 'azure', key: 'AB-7', url: 'https://dev.azure.com/acme/Tool/_workitems/edit/7' });
  for (const [s, key] of [[jira, 'ACME-7'], [azure, 'AB-7']] as const) {
    const gh = github(issue('OPEN'));
    const r = sync(s.paths, s.config, { run: gh.fake, now, env: {} });
    assert.deepEqual(r.changes.map((c) => [c.task, c.moved?.to, c.issue, c.update?.key]), [[key, 'done', undefined, key]]);
    assert.deepEqual(gh.issueCalls(), [], `${key}: no gh issue, no curl`);
    assert.equal(task(s, key).pr?.issue, undefined);
    assert.equal(issueToClose(s.config, task(s, key)), null);
  }
});

test('an issue already closed is left as it is, and the drafts its close would stand in for go', () => {
  const s = inReview();
  draftUpdate(s.paths, task(s), { event: 'pr-updated', pr: { number: 42, url: 'https://github.com/acme/tool/pull/42' } }, 'acc land', now);
  const gh = github(issue('CLOSED', { stateReason: 'COMPLETED' }));
  const r = sync(s.paths, s.config, { run: gh.fake, now, env: {} });
  assert.equal(r.changes[0]!.note, '#42 merged; left issue #9 as it is: it was already closed; discarded its unposted update GH-9.1');
  assert.deepEqual(r.changes[0]!.issue, { key: '#9', outcome: 'left', reason: 'it was already closed' });
  assert.ok(!gh.calls.some((c) => c.startsWith('gh issue close')), 'nothing to close');
  assert.deepEqual(task(s).pr?.issue, { state: 'left', at: AT, reason: 'it was already closed' });
  assert.deepEqual(listUpdates(s.paths).map((u) => u.state), ['discarded']);
});

test('a close that fails is named, stays pending, and the next sync tries again with no pull request open, once a failure', () => {
  const s = inReview();
  const failing = github(issue('OPEN'), bad('HTTP 502: Bad Gateway (https://api.github.com/graphql)'));
  const r = sync(s.paths, s.config, { run: failing.fake, now, env: {} });
  assert.equal(r.changes[0]!.note, '#42 merged; couldn\'t close issue #9 (HTTP 502: Bad Gateway (https://api.github.com/graphql)): the next sync tries again');
  assert.deepEqual(r.changes[0]!.issue, { key: '#9', outcome: 'failed', reason: 'HTTP 502: Bad Gateway (https://api.github.com/graphql)' });
  let t = task(s);
  assert.deepEqual([t.state, t.pr?.issue], ['done', { state: 'pending', at: AT, reason: 'HTTP 502: Bad Gateway (https://api.github.com/graphql)' }], 'the task is done all the same');
  assert.deepEqual(listUpdates(s.paths), [], 'still no merged draft: acc closes it');

  // Failing the same way again: named again, and the log is left alone.
  const seq = readLedger(s.paths.ledger).seq;
  const again = sync(s.paths, s.config, { run: failing.fake, now, env: {} });
  assert.deepEqual(again.changes.map((c) => [c.task, c.pr, c.moved, c.issue?.outcome]), [['GH-9', 42, null, 'failed']]);
  assert.equal(readLedger(s.paths.ledger).seq, seq);

  const fixed = github(issue('OPEN'));
  const done = sync(s.paths, s.config, { run: fixed.fake, now, env: {} });
  assert.deepEqual([done.checked, done.changes.map((c) => [c.task, c.pr, c.moved, c.note, c.issue])], [0, [['GH-9', 42, null, 'closed issue #9', { key: '#9', outcome: 'closed' }]]], 'no pull request left to read: only the retry');
  assert.equal(fixed.calls.filter((c) => c.startsWith('gh issue close')).length, 1);
  t = task(s);
  assert.deepEqual(t.pr?.issue, { state: 'closed', at: AT });
  assert.deepEqual(sync(s.paths, s.config, { run: fixed.fake, now, env: {} }), { checked: 0, changes: [], cloud: [], reviews: [], branches: [] }, 'settled: nothing left to follow');
});

test('a pending close waits while its task is back in rework: the issue stays open (D-082)', () => {
  const s = inReview();
  sync(s.paths, s.config, { run: github(issue('OPEN'), bad('HTTP 502: Bad Gateway')).fake, now, env: {} });
  assert.equal(task(s).pr?.issue?.state, 'pending');
  mutate(s.paths, now, (l, emit) => { l.tasks.find((t) => t.id === 'GH-9')!.state = 'rework'; emit({ type: 'task.updated', task: 'GH-9', actor: 'human', by: 'human:test', data: {} }); });
  const fixed = github(issue('OPEN'));
  sync(s.paths, s.config, { run: fixed.fake, now, env: {} });
  assert.equal(fixed.calls.filter((c) => c.startsWith('gh issue close')).length, 0, 'not closed while it\'s reworked');
  assert.equal(task(s).pr?.issue?.state, 'pending');
});

test('after a failed try, an issue a person reopened is left as it is, and so is one closed meanwhile: a timeout may have closed it', () => {
  const reopened = inReview();
  const slow = github(issue('OPEN'), { code: 124, stdout: '', stderr: 'context deadline exceeded', timedOut: true });
  assert.match(sync(reopened.paths, reopened.config, { run: slow.fake, now, env: {} }).changes[0]!.note, /couldn't close issue #9 \(gh stopped at its timeout, and may have closed it: context deadline exceeded\)/);
  const looked = github(issue('OPEN', { stateReason: 'REOPENED' }));
  assert.equal(sync(reopened.paths, reopened.config, { run: looked.fake, now, env: {} }).changes[0]!.note, 'left issue #9 as it is: it was reopened');
  assert.ok(!looked.calls.some((c) => c.startsWith('gh issue close')));
  assert.deepEqual(task(reopened).pr?.issue, { state: 'left', at: AT, reason: 'it was reopened' });

  const meanwhile = inReview();
  sync(meanwhile.paths, meanwhile.config, { run: slow.fake, now, env: {} });
  assert.equal(sync(meanwhile.paths, meanwhile.config, { run: github(issue('CLOSED')).fake, now, env: {} }).changes[0]!.note, 'left issue #9 as it is: it was already closed');
});

test('an issue that moved to another repo, or that GitHub can\'t find, is left as it is and never tried again', () => {
  const cases: [RunResult, string][] = [
    [issue('OPEN', { url: 'https://github.com/acme/elsewhere/issues/3' }), 'it moved to acme/elsewhere'],
    [bad('GraphQL: Could not resolve to an issue or pull request with the number of 9. (repository.issue)'), 'GitHub can\'t find it'],
  ];
  for (const [view, reason] of cases) {
    const s = inReview();
    const gh = github(view);
    assert.deepEqual(sync(s.paths, s.config, { run: gh.fake, now, env: {} }).changes[0]!.issue, { key: '#9', outcome: 'left', reason });
    assert.ok(!gh.calls.some((c) => c.startsWith('gh issue close')), reason);
    assert.deepEqual(task(s).pr?.issue, { state: 'left', at: AT, reason });
    const later = github(issue('OPEN'));
    assert.deepEqual(sync(s.paths, s.config, { run: later.fake, now, env: {} }), { checked: 0, changes: [], cloud: [], reviews: [], branches: [] }, reason);
    assert.deepEqual(later.issueCalls(), []);
  }
});

test('the issues live where the GitHub tracker says, and the comment names the pull request\'s repo when it\'s another', () => {
  const s = inReview([{ kind: 'github', repo: 'acme/issues', edits: true }], { kind: 'github', key: '#9', url: 'https://github.com/acme/issues/issues/9' });
  const gh = github(ok(JSON.stringify({ state: 'OPEN', stateReason: null, url: 'https://github.com/acme/issues/issues/9' })));
  sync(s.paths, s.config, { run: gh.fake, now, env: {} });
  assert.deepEqual(gh.issueCalls(), [
    'gh issue view 9 -R acme/issues --json state,stateReason,url',
    'gh issue close 9 -R acme/issues --reason completed --comment Done: pull request acme/tool#42 merged into main.',
  ]);
  assert.equal(closeText(s.config, { environment: 'main', pr: { number: 7 } }, 'acme/tool'), 'Done: pull request #7 merged into main.');
});

test('a pending close under a tracker that no longer says "edits" is left, not tried', () => {
  const s = inReview();
  sync(s.paths, s.config, { run: github(issue('OPEN'), bad('HTTP 502')).fake, now, env: {} });
  const off = parseConfig({ ...GENERIC_CONFIG, github: GITHUB, trackers: [{ kind: 'github' }] }).config!;
  const gh = github(issue('OPEN'));
  assert.equal(sync(s.paths, off, { run: gh.fake, now, env: {} }).changes[0]!.note, 'left issue #9 as it is: its tracker doesn\'t say "edits": true now');
  assert.deepEqual(gh.issueCalls(), []);
});

/** A repo whose tasks were done before acc closed issues: one open, one closed, one reopened, one with no pull request, a Jira one, and one acc closed. */
function doneBefore() {
  const raw = { ...GENERIC_CONFIG, github: GITHUB, trackers: [...EDITS, { kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', edits: true }] };
  const config = parseConfig(raw).config as Config;
  const paths = repoPaths(makeRepo({ '.acc/config.json': JSON.stringify(raw) }), run);
  const gh = (n: number) => ({ source: { kind: 'github' as SourceKind, key: `#${n}`, url: `https://github.com/acme/tool/issues/${n}` }, title: `Issue ${n}` });
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [gh(9), gh(12), gh(41), gh(18), { source: { kind: 'jira', key: 'ACME-7', url: null }, title: 'Jira' }, gh(50)], 'human', 'human:test', emit, now);
    for (const t of l.tasks) {
      t.state = 'done';
      const n = Number(/\d+$/.exec(t.id)![0]);
      if (t.id !== 'GH-18') t.pr = { number: n + 1, url: `https://github.com/acme/tool/pull/${n + 1}`, state: 'merged' };
    }
    l.tasks.find((t) => t.id === 'GH-50')!.pr!.issue = { state: 'closed', at: '2026-10-05T00:00:00Z' };
  });
  for (const id of ['GH-9', 'GH-12', 'GH-41']) draftUpdate(paths, readLedger(paths.ledger).tasks.find((t) => t.id === id)!, { event: 'merged', env: 'main' }, 'acc sync', now);
  const calls: string[] = [];
  const fake = fakeRunner({
    'gh issue view 9': issue('OPEN'),
    'gh issue view 12': issue('CLOSED', { url: 'https://github.com/acme/tool/issues/12' }),
    'gh issue view 41': issue('OPEN', { stateReason: 'REOPENED', url: 'https://github.com/acme/tool/issues/41' }),
    'gh issue close 9': ok(''),
  }, calls);
  return { config, paths, fake, calls };
}

test('acc sync --close-done closes the issues of tasks done before this, once, and --plan only looks', () => {
  const s = doneBefore();
  const deps = { run: s.fake, now, env: { GH_TOKEN: 'gho_token' } };
  const seq = readLedger(s.paths.ledger).seq;
  const planned = settleCloses(s.paths, s.config, deps, { tidy: true, plan: true });
  assert.deepEqual(planned.map((r) => [r.task, r.key, r.pr, r.outcome, r.reason]), [
    ['GH-9', '#9', 10, 'to close', undefined],
    ['GH-12', '#12', 13, 'left', 'it was already closed'],
    ['GH-41', '#41', 42, 'left', 'it was reopened'],
  ], 'no pull request, a Jira ticket, or a close already recorded: not listed');
  assert.ok(!s.calls.some((c) => c.startsWith('gh issue close')), '--plan closes nothing');
  assert.equal(readLedger(s.paths.ledger).seq, seq, '--plan writes nothing');
  assert.deepEqual(listUpdates(s.paths).map((u) => u.state), ['draft', 'draft', 'draft']);

  const closed = settleCloses(s.paths, s.config, deps, { tidy: true, actor: 'human', by: 'human:jordan' });
  assert.deepEqual(closed.map((r) => [r.task, r.outcome, r.reason, r.discarded]), [
    ['GH-9', 'closed', undefined, ['GH-9.1']],
    ['GH-12', 'left', 'it was already closed', ['GH-12.1']],
    ['GH-41', 'left', 'it was reopened', undefined],
  ]);
  assert.deepEqual(s.calls.filter((c) => c.startsWith('gh issue close')), ['gh issue close 9 -R acme/tool --reason completed --comment Done: pull request #10 merged into main.']);
  const l = readLedger(s.paths.ledger);
  assert.deepEqual(l.tasks.map((t) => [t.id, t.pr?.issue?.state ?? null]), [['GH-9', 'closed'], ['GH-12', 'left'], ['GH-41', 'left'], ['GH-18', null], ['ACME-7', null], ['GH-50', 'closed']]);
  assert.deepEqual(listUpdates(s.paths).map((u) => [u.task, u.state]), [['GH-9', 'discarded'], ['GH-12', 'discarded'], ['GH-41', 'draft']], 'a reopened issue\'s merged draft stays for a person');

  const before = s.calls.length;
  assert.deepEqual(settleCloses(s.paths, s.config, deps, { tidy: true, actor: 'human', by: 'human:jordan' }), [], 'a second run does nothing');
  assert.deepEqual(s.calls.slice(before), []);
});
