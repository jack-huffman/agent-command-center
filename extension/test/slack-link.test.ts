// Track a Slack thread by pasting its link on the Tasks tab (T-31): the link read, refused or tracked, against
// a stand-in Slack and a real ledger.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig, type Config } from '../../packages/core/src/config.ts';
import { run } from '../../packages/core/src/exec.ts';
import { mutate, readLedger, upsertTasks } from '../../packages/core/src/ledger.ts';
import { repoPaths } from '../../packages/core/src/paths.ts';
import { SLACK_API, SlackClient } from '../../packages/core/src/trackers/slack.ts';
import type { TaskInput } from '../../packages/core/src/ledger.ts';
import { GENERIC_CONFIG, makeRepo } from '../../packages/core/test/support.ts';
import { type TrackReply, trackTicket } from '../src/logic/connect.ts';
import { exampleLink, NO_PASTE, type PasteState, pasteHint, slackLinkKey, trackLink } from '../src/logic/slack-link.ts';
import { area, type BoardInput, trackerBoard } from '../src/model/boards.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { ticketModel } from '../src/model/task-page.ts';
import { sampleSlackBoards } from '../scripts/fixtures/boards.ts';
import { Pending } from '../webview/pending.ts';

const PLACE = { workspace: 'acme', channel: 'C0123ABCD', prefix: null };
const LINK = 'https://acme.slack.com/archives/C0123ABCD/p1696512345123456';
const KEY = 'SL-1696512345123456';
const now = () => new Date('2026-10-14T12:00:00Z');

// ---------------------------------------------------------------- a stand-in Slack

const USERS: Record<string, unknown> = {
  U01: { ok: true, user: { id: 'U01', name: 'jkim', profile: { display_name: 'Jordan', real_name: 'Jordan Kim' } } },
  U02: { ok: true, user: { id: 'U02', name: 'sam', profile: { display_name: '', real_name: 'Sam Lee' } } },
};

/** Slack's answers for one thread, whose messages the test may change between reads, and every method called. */
function fakeSlack(messages: () => unknown[] | { error: string }) {
  const calls: string[] = [];
  const f = (async (input: string | URL) => {
    const url = new URL(String(input));
    assert.ok(url.href.startsWith(`${SLACK_API}/`), url.href);
    const method = url.pathname.replace('/api/', '');
    calls.push(method);
    const m = messages();
    const answer = method === 'auth.test' ? { ok: true, url: 'https://acme.slack.com/', team: 'Acme', user: 'acc-bot', user_id: 'U0BOT' }
      : method === 'conversations.replies' ? (Array.isArray(m) ? { ok: true, messages: m } : { ok: false, error: m.error })
        : method === 'users.info' ? USERS[url.searchParams.get('user')!] ?? { ok: false, error: 'user_not_found' }
          : method === 'chat.getPermalink' ? { ok: true, permalink: LINK } : { ok: false, error: 'unknown_method' };
    return new Response(JSON.stringify(answer), { status: 200 });
  }) as unknown as typeof fetch;
  return { client: new SlackClient({ workspace: PLACE.workspace, channel: PLACE.channel, token: 'xoxb-test', fetch: f }), calls };
}

const ROOT = { ts: '1696512345.123456', user: 'U01', text: 'The invoice export drops the last row\nIt happens on every export.' };
const REPLY = { ts: '1696512400.000200', user: 'U02', text: 'I see it too, <@U01>.' };

/** A repo whose ledger `acc import` would write, and Track as the extension wires it: Slack read, then the tasks upserted. */
function setup(messages: () => unknown[] | { error: string }) {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  const config = parseConfig(GENERIC_CONFIG).config as Config;
  const paths = repoPaths(dir, run);
  const slack = fakeSlack(messages);
  const imported: TaskInput[][] = [];
  const pending = new Pending<'track'>();
  const track = (key: string): Promise<TrackReply> => trackTicket(`${dir}#${key.toUpperCase()}`, pending, {
    read: () => slack.client.ticket(key.toUpperCase()),
    importTasks: async (input) => {
      imported.push(input);
      mutate(paths, now, (l, emit) => { upsertTasks(l, config, input, 'human', 'human:test', emit, now); });
      return { code: 0, stdout: '{}', stderr: '' };
    },
    reload: async () => {},
  });
  const tasks = () => readLedger(paths.ledger).tasks;
  return { slack, imported, track, tasks, config, paths };
}

// ---------------------------------------------------------------- reading a link

test('a thread\'s link gives its key, whatever its case, and a link to a reply gives the thread it\'s in', () => {
  assert.deepEqual(slackLinkKey(LINK, PLACE), { ok: true, key: KEY });
  assert.deepEqual(slackLinkKey(`  ${LINK.toUpperCase().replace('HTTPS://', 'https://')}  `, PLACE), { ok: true, key: KEY }, 'a link in any case, with spaces round it');
  // The edge case of a link to a reply: its own timestamp is the reply's, and thread_ts names the thread.
  assert.deepEqual(slackLinkKey('https://acme.slack.com/archives/C0123ABCD/p1696512400000200?thread_ts=1696512345.123456&cid=C0123ABCD', PLACE), { ok: true, key: KEY });
  assert.deepEqual(slackLinkKey(LINK, { ...PLACE, prefix: 'ops' }), { ok: true, key: 'OPS-1696512345123456' }, 'a tracker with its own prefix');
});

test('text that isn\'t a thread\'s link is refused with an example, including the edge case of a link with no thread', () => {
  const example = 'https://acme.slack.com/archives/C0123ABCD/p1696512345123456';
  assert.equal(exampleLink(PLACE), example);
  const refusals = [
    'https://acme.slack.com/archives/C0123ABCD', // a channel's link, with no thread
    'https://app.slack.com/client/T01/C0123ABCD', // Slack's web app
    KEY, // a key, not a link
    'https://example.com/archives/C0123ABCD/p1696512345123456',
    'the invoice thread',
    '',
  ];
  for (const text of refusals) {
    const r = slackLinkKey(text, PLACE);
    assert.deepEqual(r, { ok: false, error: `That isn't a link to a Slack thread. One looks like ${example}.` }, text);
  }
});

test('a link from another workspace, or to a thread in another channel, is refused, naming it', () => {
  const other = slackLinkKey('https://globex.slack.com/archives/C0123ABCD/p1696512345123456', PLACE);
  assert.deepEqual(other, { ok: false, error: 'That thread is in the workspace globex, not acme. Paste a link from acme.slack.com.' });
  const elsewhere = slackLinkKey('https://acme.slack.com/archives/C0999WXYZ/p1696512345123456', PLACE);
  assert.deepEqual(elsewhere, { ok: false, error: 'That thread is in channel C0999WXYZ, not C0123ABCD. This tracker takes threads in channel C0123ABCD only.' });
  // A reply's link whose thread_ts is in another channel still names the channel the link is in.
  assert.equal((slackLinkKey('https://acme.slack.com/archives/C0999WXYZ/p1696512400000200?thread_ts=1696512345.123456', PLACE) as { error: string }).error.slice(0, 33), 'That thread is in channel C0999WX');
});

// ---------------------------------------------------------------- Track

test('Track makes one task from a thread, with the title, brief and names Slack gives', async () => {
  const s = setup(() => [ROOT, REPLY]);
  const shown: PasteState[] = [];
  const r = await trackLink(LINK, PLACE, s.track, (x) => shown.push(x));
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(shown, [{ link: LINK, busy: true, error: null, tracked: null }, { link: LINK, busy: false, error: null, tracked: KEY }]);
  const [task, ...rest] = s.tasks();
  assert.equal(rest.length, 0);
  assert.deepEqual([task!.id, task!.title, task!.source.kind, task!.source.url], [KEY, 'The invoice export drops the last row', 'slack', LINK]);
  assert.match(task!.brief, /\*\*Jordan\*\*/, 'its first message\'s writer, by their Slack name');
  assert.match(task!.brief, /\*\*Sam Lee\*\*/, 'and each reply\'s');
  assert.match(task!.brief, /I see it too, @Jordan\./);
});

test('the edge case of a second Track of one thread: the task\'s text changes, and there is still one task', async () => {
  let messages: unknown[] = [ROOT];
  const s = setup(() => messages);
  await trackLink(LINK, PLACE, s.track, () => {});
  assert.doesNotMatch(s.tasks()[0]!.brief, /Sam Lee/);
  messages = [{ ...ROOT, text: 'The invoice export drops the last two rows' }, REPLY];
  // Pasted again as a link to the reply: the same thread.
  const again = await trackLink('https://acme.slack.com/archives/C0123ABCD/p1696512400000200?thread_ts=1696512345.123456', PLACE, s.track, () => {});
  assert.deepEqual(again, { ok: true });
  const tasks = s.tasks();
  assert.equal(tasks.length, 1, 'not a second task');
  assert.deepEqual([tasks[0]!.id, tasks[0]!.title], [KEY, 'The invoice export drops the last two rows']);
  assert.match(tasks[0]!.brief, /Sam Lee/);
  assert.equal(s.imported.length, 2);
});

test('a refused link never reaches Slack or acc, and its reason is shown with the link kept', async () => {
  const s = setup(() => [ROOT]);
  const shown: PasteState[] = [];
  const link = 'https://globex.slack.com/archives/C0123ABCD/p1696512345123456';
  const r = await trackLink(link, PLACE, s.track, (x) => shown.push(x));
  assert.equal(r.ok, false);
  assert.deepEqual(shown, [{ link, busy: false, error: 'That thread is in the workspace globex, not acme. Paste a link from acme.slack.com.', tracked: null }]);
  assert.deepEqual([s.slack.calls, s.imported.length, s.tasks().length], [[], 0, 0]);
});

test('a thread acc can\'t read is refused with Slack\'s reason, and the failed read never removes its task (D-048)', async () => {
  let messages: unknown[] | { error: string } = [ROOT];
  const s = setup(() => messages);
  await trackLink(LINK, PLACE, s.track, () => {});
  assert.equal(s.tasks().length, 1);
  // Slack can't find it now: the app left the channel, or the thread is gone.
  messages = { error: 'thread_not_found' };
  const shown: PasteState[] = [];
  const r = await trackLink(LINK, PLACE, s.track, (x) => shown.push(x));
  assert.deepEqual(r, { ok: false, error: 'Slack: thread_not_found.' });
  assert.deepEqual(shown.at(-1), { link: LINK, busy: false, error: 'Slack: thread_not_found.', tracked: null });
  // The edge case of a thread Slack answers for without its first message, as one too old for the plan.
  messages = [REPLY];
  const old = await trackLink(LINK, PLACE, s.track, () => {});
  assert.match((old as { error: string }).error, /^SL-1696512345123456 isn't a thread the Slack app can read\. It may be too old/);
  assert.equal(s.imported.length, 1, 'neither failed read reached acc');
  assert.deepEqual(s.tasks().map((t) => [t.id, t.title]), [[KEY, 'The invoice export drops the last row']], 'and the task is still there, as it was');
});

test('a second Track while one is on its way starts nothing, and the box doesn\'t say it failed', async () => {
  const s = setup(() => [ROOT]);
  const shown: PasteState[] = [];
  const [a, b] = await Promise.all([trackLink(LINK, PLACE, s.track, () => {}), trackLink(LINK, PLACE, s.track, (x) => shown.push(x))]);
  assert.deepEqual([a, b], [{ ok: true }, { ok: false, already: true }]);
  assert.deepEqual(shown.at(-1), { ...NO_PASTE, link: LINK });
  assert.equal(s.imported.length, 1);
});

// ---------------------------------------------------------------- the Tasks tab and the task page

test('a Slack tracker shows a box for a thread\'s link in place of a board, which names the channel, and no refusal', () => {
  const [input] = sampleSlackBoards();
  const b = trackerBoard(input!, [], '/r');
  assert.deepEqual([b.kind, b.error, b.columns, b.tab], ['slack', null, [], 'Slack thread']);
  assert.deepEqual(b.paste, { hint: pasteHint(PLACE), example: exampleLink(PLACE), link: null, busy: false, error: null, tracked: null });
  assert.match(b.paste!.hint, /^Paste the link to a thread in channel C0123ABCD of acme\.slack\.com\./);
  const refused = trackerBoard(sampleSlackBoards(true)[0]!, [], '/r').paste!;
  assert.deepEqual([refused.link, refused.error], ['https://acme.slack.com/archives/C0999WXYZ/p1696512345123456', 'That thread is in channel C0999WXYZ, not C0123ABCD. This tracker takes threads in channel C0123ABCD only.']);
  // The edge case of a Slack tracker not signed in: its error and Sign in show, and no box that can't work.
  const out: BoardInput = { ...input!, error: 'Sign in to Slack (acme) for this repo to read its channel\'s threads.', connect: { command: 'acc.trackers.signIn', label: 'Sign in to Slack', arg: '{}' } };
  assert.equal(trackerBoard(out, [], '/r').paste, null);
  // Every other tracker has no box.
  assert.equal(trackerBoard({ ...input!, kind: 'jira', paste: undefined }, [], '/r').paste, null);
});

test('the page\'s track-link message is checked: a project, a tracker and a link, of sane length', () => {
  const ok = { type: 'track-link', project: '/r', tracker: 0, link: LINK };
  assert.equal(isFromWebview(ok), true);
  assert.equal(area.messages!['track-link']!(ok), true);
  assert.equal(isFromWebview({ ...ok, link: '' }), false, 'the edge case of an empty link');
  assert.equal(isFromWebview({ ...ok, link: `${LINK}${'x'.repeat(2000)}` }), false);
  assert.equal(isFromWebview({ ...ok, tracker: '0' }), false);
});

test('a Slack task\'s page shows the thread, and Refresh reads it from Slack again', async () => {
  let messages: unknown[] = [ROOT];
  const { client, calls } = fakeSlack(() => messages);
  const page = async () => ticketModel({
    project: '/r', tracker: 0, trackerTitle: client.title, trackerKind: 'slack', key: KEY, loading: false, error: null, connect: null, checks: [], row: null, task: null,
    ticket: await client.ticket(KEY), trackerEdits: true, trackerFields: [],
  });
  const first = await page();
  assert.deepEqual([first.sourceKind, first.sourceLabel, first.title], ['slack', 'Slack · acme', 'The invoice export drops the last row']);
  assert.match(JSON.stringify(first.body), /It happens on every export\./);
  messages = [ROOT, REPLY];
  const again = await page();
  assert.equal(calls.filter((c) => c === 'conversations.replies').length, 2, 'each load reads the thread again: nothing is kept from the last');
  assert.match(JSON.stringify(again.body), /I see it too, @Jordan\./);
});
