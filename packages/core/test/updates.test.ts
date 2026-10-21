import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Task } from '../src/ledger.ts';
import {
  claimUpdate, discardUpdate, draftUpdate, githubIssue, listUpdates, markPosted, readUpdate, releaseUpdate, REPLACES_MAX, stalePosting, UPDATE_EVENTS, type Update, updateText,
} from '../src/updates.ts';
import { tempDir } from './support.ts';

let clock = new Date('2026-10-05T12:00:00Z');
const now = () => clock;
const store = () => ({ updates: join(tempDir(), 'acc', 'updates') });
const jira = (id = 'ACME-12'): Pick<Task, 'id' | 'source'> => ({ id, source: { kind: 'jira', key: id, url: `https://acme.atlassian.net/browse/${id}` } });
const pr = { number: 38, url: 'https://github.com/acme/service/pull/38' };

test('a draft is one file in updates/, with the task, its ticket, the event, the text and its state', () => {
  const paths = store();
  const u = draftUpdate(paths, jira(), { event: 'pr-opened', pr, context: { summary: 'Premium cases now escalate after two hours' } }, 'acc land', now)!;
  assert.deepEqual(readdirSync(paths.updates), ['ACME-12.1.json']);
  assert.deepEqual(JSON.parse(readFileSync(join(paths.updates, 'ACME-12.1.json'), 'utf8')), {
    v: 1, id: 'ACME-12.1', task: 'ACME-12', tracker: 'jira', key: 'ACME-12', url: 'https://acme.atlassian.net/browse/ACME-12', event: 'pr-opened',
    text: 'The change is ready for review: https://github.com/acme/service/pull/38\nPremium cases now escalate after two hours.', state: 'draft',
    pr, createdAt: '2026-10-05T12:00:00.000Z', by: 'acc land',
  });
  assert.deepEqual(readUpdate(paths, 'ACME-12.1'), u);
  assert.equal(readUpdate(paths, '../ACME-12.1'), null, 'only an update\'s own id is read');
  assert.equal(draftUpdate(paths, { id: 'T-1', source: { kind: 'manual', key: null, url: null } }, { event: 'merged', env: 'Dev' }, 'acc sync', now), null, 'a task acc alone keeps has no ticket');
  assert.ok(!existsSync(`${paths.updates}.lock`), 'the lock is let go');
});

test('the same news drafted again before anyone posts it replaces the draft; other news is its own (D-066)', () => {
  const paths = store();
  draftUpdate(paths, jira(), { event: 'pr-opened', pr }, 'acc land', now);
  // The pull request is updated three times: one draft, still saying it's ready for review, with the latest link.
  for (const n of [1, 2, 3]) draftUpdate(paths, jira(), { event: 'pr-updated', pr: { number: 38, url: `${pr.url}?v=${n}` } }, 'acc land', now);
  let all = listUpdates(paths);
  assert.deepEqual(all.map((u) => [u.id, u.event, u.state]), [['ACME-12.4', 'pr-opened', 'draft']]);
  assert.match(all[0]!.text, /^The change is ready for review: .*\?v=3$/);
  assert.deepEqual(all[0]!.replaces, ['ACME-12.3', 'ACME-12.2', 'ACME-12.1'], 'it names the drafts it stands in for, newest first');

  // Posted: the next update is a draft of its own.
  claimUpdate(paths, 'ACME-12.4', 'human:jordan', now);
  markPosted(paths, 'ACME-12.4', { by: 'human:jordan', text: all[0]!.text }, now);
  draftUpdate(paths, jira(), { event: 'pr-updated', pr }, 'acc land', now);
  draftUpdate(paths, jira(), { event: 'pr-updated', pr }, 'acc land', now);
  draftUpdate(paths, jira(), { event: 'merged', env: 'Dev' }, 'acc sync', now);
  draftUpdate(paths, jira(), { event: 'deployed', env: 'QA' }, 'human:jordan', now);
  draftUpdate(paths, jira(), { event: 'deployed', env: 'Production' }, 'human:jordan', now);
  draftUpdate(paths, jira(), { event: 'question', question: 'q1', text: 'One?' }, 'human:jordan', now);
  draftUpdate(paths, jira(), { event: 'question', question: 'q2', text: 'Two?' }, 'human:jordan', now);
  draftUpdate(paths, jira('ACME-13'), { event: 'merged', env: 'Dev' }, 'acc sync', now);
  all = listUpdates(paths);
  assert.deepEqual(all.map((u) => [u.id, u.event, u.state, u.env ?? u.question ?? '']), [
    ['ACME-12.4', 'pr-opened', 'posted', ''], ['ACME-12.7', 'merged', 'draft', 'Dev'],
    ['ACME-12.8', 'deployed', 'draft', 'QA'], ['ACME-12.9', 'deployed', 'draft', 'Production'], ['ACME-12.10', 'question', 'draft', 'q1'], ['ACME-12.11', 'question', 'draft', 'q2'],
    ['ACME-13.1', 'merged', 'draft', 'Dev'],
  ]);
  assert.deepEqual(all.map((u) => [u.id, u.replaces]), [
    ['ACME-12.4', ['ACME-12.3', 'ACME-12.2', 'ACME-12.1']], ['ACME-12.7', ['ACME-12.6', 'ACME-12.5']], ['ACME-12.8', undefined],
    ['ACME-12.9', undefined], ['ACME-12.10', undefined], ['ACME-12.11', undefined], ['ACME-13.1', undefined],
  ], 'a posted draft is replaced by nothing: the news after it starts afresh');
});

test('later news replaces an unposted draft it overtakes: merged for ready for review, deployed for merged into the same place (D-071)', () => {
  const paths = store();
  draftUpdate(paths, jira(), { event: 'pr-opened', pr }, 'acc land', now);
  draftUpdate(paths, jira(), { event: 'question', question: 'q1', text: 'One?' }, 'human:jordan', now);
  draftUpdate(paths, jira(), { event: 'merged', env: 'Dev' }, 'acc sync', now);
  let all = listUpdates(paths);
  assert.deepEqual(all.map((u) => [u.id, u.event, u.replaces]), [['ACME-12.2', 'question', undefined], ['ACME-12.3', 'merged', ['ACME-12.1']]], 'merged stands in for ready for review; a question is other news');
  draftUpdate(paths, jira(), { event: 'deployed', env: 'QA' }, 'human:jordan', now);
  draftUpdate(paths, jira(), { event: 'deployed', env: 'Dev' }, 'human:jordan', now);
  all = listUpdates(paths);
  assert.deepEqual(all.map((u) => [u.id, u.event, u.env ?? '', u.replaces]), [
    ['ACME-12.2', 'question', '', undefined], ['ACME-12.4', 'deployed', 'QA', undefined], ['ACME-12.5', 'deployed', 'Dev', ['ACME-12.3', 'ACME-12.1']],
  ], 'a deploy to QA leaves the merge into Dev; the deploy to Dev takes its place, and the edit chain with it');

  // Posted news is never taken back, and a later stage never undoes a draft that's being posted.
  const posted = store();
  draftUpdate(posted, jira(), { event: 'pr-opened', pr }, 'acc land', now);
  claimUpdate(posted, 'ACME-12.1', 'human:jordan', now);
  draftUpdate(posted, jira(), { event: 'merged', env: 'Dev' }, 'acc sync', now);
  assert.deepEqual(listUpdates(posted).map((u) => [u.id, u.state]), [['ACME-12.1', 'posting'], ['ACME-12.2', 'draft']]);
});

test('a promotion\'s news overtakes in turn: ready to go to UAT, then in UAT, then deployed there; a merge into Dev is other news (D-075)', () => {
  const paths = store();
  const promotion = (n: number) => ({ number: n, url: `https://github.com/acme/service/pull/${n}` });
  draftUpdate(paths, jira(), { event: 'pr-opened', pr }, 'acc land', now);
  draftUpdate(paths, jira(), { event: 'promotion-opened', env: 'UAT', pr: promotion(9) }, 'human:jordan', now);
  let all = listUpdates(paths);
  assert.deepEqual(all.map((u) => [u.id, u.event, u.env, u.pr?.number, u.replaces]), [['ACME-12.2', 'promotion-opened', 'UAT', 9, ['ACME-12.1']]], 'a promotion stands in for ready for review');
  assert.equal(all[0]!.text, 'The change is ready to go to UAT: https://github.com/acme/service/pull/9');
  // Promoted again before anyone posted: one draft, with the latest link.
  draftUpdate(paths, jira(), { event: 'promotion-opened', env: 'UAT', pr: promotion(10) }, 'human:jordan', now);
  draftUpdate(paths, jira(), { event: 'promoted', env: 'UAT' }, 'acc sync', now);
  all = listUpdates(paths);
  assert.deepEqual(all.map((u) => [u.id, u.event, u.text, u.replaces]), [['ACME-12.4', 'promoted', 'The change is now in UAT.', ['ACME-12.3', 'ACME-12.2', 'ACME-12.1']]]);
  draftUpdate(paths, jira(), { event: 'deployed', env: 'UAT' }, 'human:jordan', now);
  assert.deepEqual(listUpdates(paths).map((u) => [u.id, u.event, u.replaces]), [['ACME-12.5', 'deployed', ['ACME-12.4', 'ACME-12.3', 'ACME-12.2', 'ACME-12.1']]]);

  // A merge into Dev waits beside the news about UAT, and a deploy to Dev doesn't take UAT's place.
  const beside = store();
  draftUpdate(beside, jira(), { event: 'merged', env: 'Dev' }, 'acc sync', now);
  draftUpdate(beside, jira(), { event: 'promotion-opened', env: 'UAT', pr: promotion(9) }, 'human:jordan', now);
  draftUpdate(beside, jira(), { event: 'promoted', env: 'UAT' }, 'acc sync', now);
  draftUpdate(beside, jira(), { event: 'merged', env: 'Dev' }, 'acc sync', now);
  draftUpdate(beside, jira(), { event: 'promotion-opened', env: 'Production', pr: promotion(11) }, 'human:jordan', now);
  draftUpdate(beside, jira(), { event: 'deployed', env: 'Dev' }, 'human:jordan', now);
  assert.deepEqual(listUpdates(beside).map((u) => [u.id, u.event, u.env, u.replaces]), [
    ['ACME-12.3', 'promoted', 'UAT', ['ACME-12.2']], ['ACME-12.5', 'promotion-opened', 'Production', undefined], ['ACME-12.6', 'deployed', 'Dev', ['ACME-12.4', 'ACME-12.1']],
  ]);

  // A promotion's draft being posted, or posted, is never taken back.
  const posted = store();
  draftUpdate(posted, jira(), { event: 'promotion-opened', env: 'UAT', pr: promotion(9) }, 'human:jordan', now);
  claimUpdate(posted, 'ACME-12.1', 'human:jordan', now);
  draftUpdate(posted, jira(), { event: 'promoted', env: 'UAT' }, 'acc sync', now);
  assert.deepEqual(listUpdates(posted).map((u) => [u.id, u.state, u.replaces]), [['ACME-12.1', 'posting', undefined], ['ACME-12.2', 'draft', undefined]]);
});

test('a draft remembers the last twenty drafts it replaced', () => {
  const paths = store();
  for (let n = 1; n <= 25; n++) draftUpdate(paths, jira(), { event: 'merged', env: 'Dev' }, 'acc sync', now);
  const [u] = listUpdates(paths);
  assert.equal(u!.id, 'ACME-12.25');
  assert.equal(u!.replaces!.length, REPLACES_MAX);
  assert.deepEqual([u!.replaces![0], u!.replaces!.at(-1)], ['ACME-12.24', 'ACME-12.5']);
});

test('posting is claimed first, so it can\'t go twice; posted keeps the text that went, who sent it and when', () => {
  const paths = store();
  draftUpdate(paths, jira(), { event: 'merged', env: 'Dev' }, 'acc sync', now);
  assert.throws(() => markPosted(paths, 'ACME-12.1', { by: 'human:jordan', text: 'x' }, now), /wasn't claimed for posting/);
  const claimed = claimUpdate(paths, 'ACME-12.1', 'human:jordan', now);
  assert.deepEqual([claimed.state, claimed.posting], ['posting', { at: '2026-10-05T12:00:00.000Z', by: 'human:jordan' }]);
  assert.throws(() => claimUpdate(paths, 'ACME-12.1', 'human:pat', now), /^AccError: ACME-12\.1 is being posted\.$/, 'a second Post is refused');
  assert.throws(() => discardUpdate(paths, 'ACME-12.1', 'human:pat', now), /is being posted/);

  // It failed: a draft again, saying why.
  const released = releaseUpdate(paths, 'ACME-12.1', 'Jira said 401', now);
  assert.deepEqual([released.state, released.posting, released.failed?.reason], ['draft', undefined, 'Jira said 401']);
  claimUpdate(paths, 'ACME-12.1', 'human:jordan', now);
  clock = new Date('2026-10-05T12:01:00Z');
  const posted = markPosted(paths, 'ACME-12.1', { by: 'human:jordan', text: 'Merged into Dev, ready for you to try.', url: 'https://acme.atlassian.net/browse/ACME-12?focusedCommentId=9' }, now);
  assert.deepEqual([posted.state, posted.posted, posted.failed], ['posted', { at: '2026-10-05T12:01:00.000Z', by: 'human:jordan', text: 'Merged into Dev, ready for you to try.', url: 'https://acme.atlassian.net/browse/ACME-12?focusedCommentId=9' }, undefined]);
  assert.equal(posted.text, 'The change was approved and merged into Dev.', 'what acc drafted is kept beside it');
  assert.throws(() => claimUpdate(paths, 'ACME-12.1', 'human:jordan', now), /was posted by jordan/);
  assert.throws(() => discardUpdate(paths, 'ACME-12.1', 'human:jordan', now), /was posted/);
  assert.throws(() => claimUpdate(paths, 'ACME-99.1', 'human:jordan', now), /No update ACME-99\.1/);
});

test('a claim unconfirmed for five minutes may have posted: it says so, and only --again or a discard moves it (D-051)', () => {
  const paths = store();
  clock = new Date('2026-10-05T12:00:00Z');
  draftUpdate(paths, jira(), { event: 'merged', env: 'Dev' }, 'acc sync', now);
  const claimed = claimUpdate(paths, 'ACME-12.1', 'human:jordan', now);
  assert.equal(stalePosting(claimed, new Date('2026-10-05T12:04:00Z')), false);
  clock = new Date('2026-10-05T12:06:00Z');
  assert.equal(stalePosting(claimed, now()), true);
  assert.throws(() => claimUpdate(paths, 'ACME-12.1', 'human:jordan', now), /may have posted already.*Look at ACME-12 first.*--again/);
  assert.equal(claimUpdate(paths, 'ACME-12.1', 'human:jordan', now, { again: true }).posting?.at, '2026-10-05T12:06:00.000Z');
  clock = new Date('2026-10-05T12:20:00Z');
  const gone = discardUpdate(paths, 'ACME-12.1', 'human:jordan', now);
  assert.deepEqual([gone.state, gone.posting, gone.discarded], ['discarded', undefined, { at: '2026-10-05T12:20:00.000Z', by: 'human:jordan' }]);
});

test('discarding keeps the draft, marked, and it never posts', () => {
  const paths = store();
  draftUpdate(paths, jira(), { event: 'blocked', context: { question: 'Which queue should Gold cases go to' } }, 'builder:ACME-12', now);
  const u = discardUpdate(paths, 'ACME-12.1', 'human:jordan', now);
  assert.equal(u.state, 'discarded');
  assert.equal(readUpdate(paths, 'ACME-12.1')?.state, 'discarded');
  assert.throws(() => claimUpdate(paths, 'ACME-12.1', 'human:jordan', now), /was discarded/);
  assert.throws(() => discardUpdate(paths, 'ACME-12.1', 'human:jordan', now), /was discarded/);
});

test('every draft reads plainly for a client: no word of agents, worktrees, acc, builders, reviewers or rework', () => {
  const context = { pr, summary: 'Premium cases now escalate after two hours', env: 'QA', question: 'Should Gold customers count as Premium' };
  const jargon = /\b(agents?|worktrees?|acc|builders?|reviewers?|rework(ed)?)\b/i;
  for (const event of UPDATE_EVENTS) {
    const text = updateText(event, context);
    assert.ok(!jargon.test(text), `${event}: ${text}`);
    assert.ok(text.length < 300, `${event} is concise`);
  }
  assert.equal(updateText('pr-opened', context), 'The change is ready for review: https://github.com/acme/service/pull/38\nPremium cases now escalate after two hours.');
  assert.equal(updateText('pr-updated', context), 'The change was updated and is ready for review again: https://github.com/acme/service/pull/38\nPremium cases now escalate after two hours.');
  assert.equal(updateText('merged', context), 'The change was approved and merged into QA.');
  assert.equal(updateText('promotion-opened', context), 'The change is ready to go to QA: https://github.com/acme/service/pull/38');
  assert.equal(updateText('promoted', context), 'The change is now in QA.');
  assert.equal(updateText('deployed', context), 'The change is now deployed to QA.');
  assert.equal(updateText('blocked', context), 'We need your input before we can go on:\nShould Gold customers count as Premium.');
  assert.equal(updateText('question', { question: 'Which queue?' }), 'Before we start, a question for you:\nWhich queue?');
  assert.equal(updateText('criteria', {}), 'Proposed acceptance criteria, test steps and edge cases, for you to check:');
});

test('a GitHub issue is found from its link, or the project\'s repo and its number', () => {
  const u = (key: string, url: string | null): Pick<Update, 'key' | 'url'> => ({ key, url });
  assert.deepEqual(githubIssue(u('#41', 'https://github.com/jack-huffman/agent-command-center/issues/41'), 'acme/tool'), { repo: 'jack-huffman/agent-command-center', number: '41' });
  assert.deepEqual(githubIssue(u('#7', null), 'acme/tool'), { repo: 'acme/tool', number: '7' });
  assert.equal(githubIssue(u('#7', null), null), null);
});

test('a file being written, or one this version can\'t read, isn\'t listed', () => {
  const paths = store();
  draftUpdate(paths, jira(), { event: 'merged', env: 'Dev' }, 'acc sync', now);
  writeFileSync(join(paths.updates, 'ACME-12.2.json.tmp'), '{');
  writeFileSync(join(paths.updates, 'ACME-12.3.json'), JSON.stringify({ v: 2, id: 'ACME-12.3' }));
  writeFileSync(join(paths.updates, 'ACME-12.4.json'), '{ not json');
  assert.deepEqual(listUpdates(paths).map((u) => u.id), ['ACME-12.1']);
  assert.deepEqual(listUpdates({ updates: join(tempDir(), 'none') }), []);
});
