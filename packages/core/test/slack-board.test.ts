// A Slack board (T-85): the channel's messages marked with a reaction, read with conversations.history,
// against a stand-in Slack that records every method called. Also the two settings that name the reactions.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CONFIG_KEYS, parseConfig } from '../src/config.ts';
import {
  NO_REACTION, SLACK_API, SLACK_APPS, SLACK_BOARD_DAYS, SLACK_BOARD_MAX, SLACK_CARD_MAX, SLACK_REACTION, SlackClient, type SlackOptions,
} from '../src/trackers/slack.ts';
import { reactionOptions, SLACK } from '../src/trackers/connect.ts';
import { SLACK_REACTIONS, slackCanRead } from '../src/trackers/slack.ts';
import { type Exec, TrackerError } from '../src/trackers/types.ts';
import { GENERIC_CONFIG } from './support.ts';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const NOW = Date.UTC(2026, 9, 21, 12, 0, 0);
const AUTH = { ok: true, url: 'https://acme.slack.com/', team: 'Acme', user: 'acc-bot', team_id: 'T01', user_id: 'U0BOT' };
const USERS: Record<string, unknown> = {
  U01: { ok: true, user: { id: 'U01', name: 'jkim', profile: { display_name: 'Jordan', real_name: 'Jordan Kim', email: 'jordan.kim@example.com' } } },
  U02: { ok: true, user: { id: 'U02', name: 'sam', profile: { display_name: '', real_name: 'Sam Lee' } } },
};

interface Call { method: string; params: Record<string, string>; verb: string }

/** A Slack stand-in: each method's answer, or a function of the call, and every call it took. */
function fakeSlack(routes: Record<string, unknown | ((c: Call) => unknown)>) {
  const calls: Call[] = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.ok(url.href.startsWith(`${SLACK_API}/`), url.href);
    const call: Call = { method: url.pathname.replace('/api/', ''), params: Object.fromEntries(url.searchParams), verb: init?.method ?? 'GET' };
    calls.push(call);
    const route = routes[call.method];
    const answer = typeof route === 'function' ? (route as (c: Call) => unknown)(call) : route ?? { ok: false, error: 'unknown_method' };
    return new Response(JSON.stringify(answer), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const msg = (ts: string, text: string, reactions: string[], extra: Record<string, unknown> = {}) => ({ ts, user: 'U01', text, reactions: reactions.map((name) => ({ name, count: 1 })), ...extra });

const routes = (messages: unknown[]) => ({
  'auth.test': AUTH,
  'conversations.history': { ok: true, messages, has_more: false },
  'users.info': (c: Call) => USERS[c.params.user!] ?? { ok: false, error: 'user_not_found' },
  'chat.getPermalink': (c: Call) => ({ ok: true, permalink: `https://acme.slack.com/archives/C0123ABCD/p${c.params.message_ts!.replace('.', '')}` }),
});

const board = (f: typeof fetch, o: Partial<SlackOptions> = {}) =>
  new SlackClient({ workspace: 'acme', channel: 'C0123ABCD', token: 'xoxb-test', fetch: f, reaction: 'ticket', doneReaction: 'white_check_mark', now: () => NOW, ...o });

/** Every method the board may call: it reads, and never writes to Slack. */
const READS = new Set(['auth.test', 'conversations.history', 'users.info', 'chat.getPermalink']);

test('only top-level messages with the reaction become cards, and those with the done reaction too go in Done', async () => {
  const { fetch: f, calls } = fakeSlack(routes([
    msg('1760000300.000300', 'Export drops the last row\nSince Monday.', ['ticket']),
    msg('1760000200.000200', 'Login page is slow', ['ticket::skin-tone-2', 'white_check_mark'], { user: 'U02' }),
    msg('1760000100.000100', 'Just chatting', ['eyes']),
    msg('1760000050.000050', 'A reply sent to the channel too', ['ticket'], { thread_ts: '1760000000.000000', subtype: 'thread_broadcast' }),
    msg('1760000010.000010', 'deleted', ['ticket'], { subtype: 'tombstone' }),
    { ts: '1760000005.000005', bot_id: 'B01', bot_profile: { name: 'Deploy bot' }, text: 'Deploy failed on staging', reactions: [{ name: 'ticket' }] },
  ]));
  const b = await board(f).board();
  assert.equal(b.source, 'slack');
  assert.deepEqual(b.columns.map((c) => [c.id, c.name, c.category, c.statusIds]), [['open', 'Open', 'todo', ['open']], ['done', 'Done', 'done', ['done']]]);
  assert.deepEqual(b.cards.map((c) => [c.key, c.title, c.status.id, c.assignees]), [
    ['SL-1760000300000300', 'Export drops the last row', 'open', [{ id: 'U01', name: 'Jordan' }]],
    ['SL-1760000200000200', 'Login page is slow', 'done', [{ id: 'U02', name: 'Sam Lee' }]],
    ['SL-1760000005000005', 'Deploy failed on staging', 'open', [{ id: 'B01', name: 'Deploy bot' }]],
  ], 'a reaction with a skin tone counts; an unmarked message, a reply sent to the channel and a deleted one do not');
  assert.equal(b.cards[0]!.url, 'https://acme.slack.com/archives/C0123ABCD/p1760000300000300', 'its link is Slack\'s permalink');
  assert.deepEqual([b.notice, b.place, b.url], [null, 'Slack · acme · channel C0123ABCD', 'https://acme.slack.com/archives/C0123ABCD']);
  assert.ok(calls.every((c) => READS.has(c.method) && c.verb === 'GET'), `the board makes no write call: ${calls.map((c) => c.method).join(', ')}`);
  const history = calls.find((c) => c.method === 'conversations.history')!;
  assert.deepEqual([history.params.channel, history.params.oldest], ['C0123ABCD', String(Math.floor(NOW / 1000) - SLACK_BOARD_DAYS * 86_400)], 'it reads the last 30 days');
});

test('without a done reaction, the board has an Open column only, and a done-marked message stays Open', async () => {
  const { fetch: f } = fakeSlack(routes([msg('1760000300.000300', 'Fix it', ['ticket', 'white_check_mark'])]));
  const b = await board(f, { doneReaction: null }).board();
  assert.deepEqual([b.columns.map((c) => c.id), b.cards.map((c) => c.status.id)], [['open'], ['open']]);
});

test('a long first line is cut at 120 characters, with its full text kept', async () => {
  const long = `${'The export drops a row '.repeat(8)}end`;
  const { fetch: f } = fakeSlack(routes([msg('1760000300.000300', `${long}\nsecond line`, ['ticket']), msg('1760000200.000200', 'Short', ['ticket'])]));
  const [cut, short] = (await board(f).board()).cards;
  assert.ok(long.length > SLACK_CARD_MAX);
  assert.ok(cut!.title.length <= SLACK_CARD_MAX, `cut to ${cut!.title.length}`);
  assert.ok(cut!.title.endsWith('…'));
  assert.equal(cut!.fullTitle, long, 'its full first line is kept for its hover title');
  assert.equal(short!.fullTitle, undefined, 'the edge case of a title that fits: nothing more to keep');
});

test('each author is read once a board, and again on the next load', async () => {
  const { fetch: f, calls } = fakeSlack(routes([
    msg('1760000300.000300', 'One', ['ticket']), msg('1760000200.000200', 'Two', ['ticket']), msg('1760000100.000100', 'Three <@U01>', ['ticket'], { user: 'U02' }),
  ]));
  const c = board(f);
  await c.board();
  const users = () => calls.filter((x) => x.method === 'users.info').map((x) => x.params.user).sort();
  assert.deepEqual(users(), ['U01', 'U02'], 'two authors, each read once, and a mention reuses the author\'s read');
  await c.board();
  assert.deepEqual(users(), ['U01', 'U01', 'U02', 'U02'], 'a new board load reads them again, so a renamed person shows their new name');
});

test('paging stops at 1,000 messages, and says the board holds only the newest', async () => {
  let page = 0;
  const { fetch: f, calls } = fakeSlack({
    ...routes([]),
    'conversations.history': () => {
      page++;
      const messages = Array.from({ length: 200 }, (_, i) => msg(`${1760000000 - page * 1000 - i}.000000`, `m${page}-${i}`, i === 0 ? ['ticket'] : []));
      return { ok: true, messages, has_more: true, response_metadata: { next_cursor: `c${page}` } };
    },
  });
  const b = await board(f).board();
  const pages = calls.filter((c) => c.method === 'conversations.history');
  assert.equal(pages.length, SLACK_BOARD_MAX / 200, 'five pages of 200, then it stops though Slack has more');
  assert.deepEqual(pages.map((c) => c.params.cursor ?? null), [null, 'c1', 'c2', 'c3', 'c4']);
  assert.equal(b.cards.length, 5);
  assert.match(b.notice ?? '', /Only the newest 1,000 messages of the last 30 days/);
});

test('paging stops at 30 days: when Slack has no more since then, no notice', async () => {
  const { fetch: f, calls } = fakeSlack({
    ...routes([]),
    'conversations.history': (c: Call) => (c.params.cursor
      ? { ok: true, messages: [msg('1760000100.000100', 'Older', ['ticket'])], has_more: false, response_metadata: { next_cursor: '' } }
      : { ok: true, messages: [msg('1760000300.000300', 'Newer', ['ticket'])], has_more: true, response_metadata: { next_cursor: 'next' } }),
  });
  const b = await board(f).board();
  assert.equal(calls.filter((c) => c.method === 'conversations.history').length, 2);
  assert.ok(calls.filter((c) => c.method === 'conversations.history').every((c) => c.params.oldest === String(Math.floor(NOW / 1000) - 30 * 86_400)), 'every page holds to the 30 days');
  assert.deepEqual([b.cards.map((c) => c.title), b.notice], [['Newer', 'Older'], null]);
});

test('an empty board says no message has the reaction, and how one gets there', async () => {
  const { fetch: f } = fakeSlack(routes([msg('1760000300.000300', 'Nothing marked', ['eyes'])]));
  const b = await board(f).board();
  assert.deepEqual([b.cards, b.columns.length], [[], 2]);
  assert.match(b.notice ?? '', /No message from the last 30 days has the :ticket: reaction/);
});

test('a missing scope names the scope the app needs and where to add it', async () => {
  const { fetch: f } = fakeSlack({ ...routes([]), 'conversations.history': { ok: false, error: 'missing_scope', needed: 'groups:history' } });
  await assert.rejects(board(f).board(), (e: unknown) => e instanceof TrackerError && e.kind === 'scope'
    && /needs the groups:history scope for conversations\.history/.test(e.message) && e.message.includes(`OAuth & Permissions page at ${SLACK_APPS}`));
});

test('no reaction refuses with the reason and the way to turn the board on, and asks Slack nothing', async () => {
  const { fetch: f, calls } = fakeSlack(routes([]));
  for (const reaction of [null, '', '  ']) {
    await assert.rejects(board(f, { reaction }).board(), (e: unknown) => e instanceof TrackerError && e.kind === 'refused' && e.message === NO_REACTION);
  }
  assert.match(NO_REACTION, /names no reaction.*Choose a reaction with Change/);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------- the settings

const slackConfig = (t: Record<string, unknown>) => parseConfig({ ...clone(GENERIC_CONFIG), trackers: [{ kind: 'slack', workspace: 'acme', channel: 'C0123ABCD', ...t }] });

test('a Slack tracker takes a reaction and a done reaction, each a reaction\'s name', () => {
  const ok = slackConfig({ reaction: ' ticket ', doneReaction: 'white_check_mark' });
  assert.deepEqual([ok.errors, ok.warnings], [[], []]);
  assert.deepEqual([ok.config!.trackers[0]!.reaction, ok.config!.trackers[0]!.doneReaction], ['ticket', 'white_check_mark']);
  const none = slackConfig({});
  assert.deepEqual([none.config!.trackers[0]!.reaction, none.config!.trackers[0]!.doneReaction], [null, null], 'the edge case of neither set: the board is off');
  for (const name of ['+1', 'man-raising-hand', "it's"]) assert.ok(SLACK_REACTION.test(name), name);
});

test('the config refuses a reaction with colons, a non-string and two that are the same, and warns about a done reaction alone', () => {
  assert.match(slackConfig({ reaction: ':ticket:' }).errors.join('\n'), /"reaction" must be a Slack reaction's name without colons, such as ticket/);
  assert.match(slackConfig({ reaction: 'ticket', doneReaction: 7 }).errors.join('\n'), /"doneReaction" must be a Slack reaction's name without colons, such as white_check_mark/);
  assert.match(slackConfig({ reaction: 'Ticket' }).errors.join('\n'), /"reaction" must be/, 'Slack names its reactions in lower case');
  assert.match(slackConfig({ reaction: 'ticket', doneReaction: 'ticket' }).errors.join('\n'), /"doneReaction" must be another reaction than "reaction"/);
  const alone = slackConfig({ doneReaction: 'white_check_mark' });
  assert.deepEqual([alone.errors, alone.config!.trackers[0]!.doneReaction], [[], null]);
  assert.match(alone.warnings.join('\n'), /"doneReaction" needs "reaction" too, so it's ignored/);
  const jira = parseConfig({ ...clone(GENERIC_CONFIG), trackers: [{ kind: 'jira', site: 's', project: 'K', reaction: 'ticket' }] });
  assert.match(jira.warnings.join('\n'), /"reaction" applies only to a Slack tracker/);
  assert.equal(jira.config!.trackers[0]!.reaction, null);
});

test('both keys are known settings, and the design doc describes them', () => {
  assert.ok(CONFIG_KEYS.includes('trackers[].reaction') && CONFIG_KEYS.includes('trackers[].doneReaction'));
  const design = readFileSync(new URL('../../../docs/DESIGN.md', import.meta.url), 'utf8');
  assert.match(design, /`reaction`, a reaction's name without colons such as `ticket`/);
  assert.match(design, /`doneReaction`/);
});

// ---------------------------------------------------------------- the Connect page

const noExec: Exec = async () => ({ code: 1, stdout: '', stderr: '' });
const ctx = (f: typeof fetch, values: Record<string, string | null>) => ({ host: 'acme', signIn: { method: 'token', fields: { token: 'xoxb-test' }, header: null, gh: null }, values, fetch: f, exec: noExec });

test('the Connect page asks for a reaction and a done reaction under the channel, each with None first', async () => {
  const [, reaction, done] = SLACK.pickers;
  assert.deepEqual([reaction!.key, reaction!.dependsOn, done!.key, done!.dependsOn], ['reaction', ['channel'], 'doneReaction', ['channel']]);
  assert.match(reaction!.whole!({ host: 'acme', values: {} }), /^None: no board/);
  assert.match(done!.whole!({ host: 'acme', values: {} }), /^None: every marked message stays Open/);
  assert.match(reaction!.hint!, /channels:history scope, or groups:history for a private channel/);
  const { fetch: f, calls } = fakeSlack(routes([]));
  const options = await reaction!.load(ctx(f, { channel: 'C0123ABCD' }));
  assert.deepEqual(options, reactionOptions());
  assert.deepEqual([options[0], options.length, calls.length], [{ value: 'ticket', label: ':ticket:' }, SLACK_REACTIONS.length, 0], 'a fixed list: listing it asks Slack nothing');
  assert.ok(SLACK_REACTIONS.every((r) => SLACK_REACTION.test(r)), 'each one the settings take');
});

test('Save checks the app can read the channel when a reaction is chosen, and names a missing scope', async () => {
  const ok = fakeSlack(routes([]));
  await SLACK.beforeSave!(ctx(ok.fetch, { channel: 'C0123ABCD', reaction: 'ticket', doneReaction: 'white_check_mark' }));
  assert.deepEqual(ok.calls.map((c) => [c.method, c.params.channel, c.params.limit]), [['conversations.history', 'C0123ABCD', '1']]);
  const none = fakeSlack(routes([]));
  await SLACK.beforeSave!(ctx(none.fetch, { channel: 'C0123ABCD', reaction: null, doneReaction: 'white_check_mark' }));
  assert.equal(none.calls.length, 0, 'the edge case of no reaction: no board, so nothing to check');
  const scope = fakeSlack({ ...routes([]), 'conversations.history': { ok: false, error: 'missing_scope', needed: 'channels:history' } });
  await assert.rejects(SLACK.beforeSave!(ctx(scope.fetch, { channel: 'C0123ABCD', reaction: 'ticket', doneReaction: null })),
    (e: unknown) => e instanceof TrackerError && e.kind === 'scope' && /channels:history/.test(e.message) && e.message.includes(SLACK_APPS));
  await assert.rejects(slackCanRead('xoxb-test', 'C0123ABCD', scope.fetch), /channels:history/);
  await assert.rejects(SLACK.beforeSave!(ctx(ok.fetch, { channel: 'C0123ABCD', reaction: 'ticket', doneReaction: 'ticket' })), /another done reaction than the reaction/);
});

test('Save writes both reactions, and a done reaction without a reaction is left out', () => {
  const chosen = (values: Record<string, string | null>) => SLACK.toConfig({ host: 'acme', values: { channel: 'C0123ABCD', ...values }, defaults: [], ownRepo: null });
  assert.deepEqual(chosen({ reaction: 'ticket', doneReaction: 'white_check_mark' }), { kind: 'slack', workspace: 'acme', channel: 'C0123ABCD', reaction: 'ticket', doneReaction: 'white_check_mark' });
  assert.deepEqual(chosen({ reaction: null, doneReaction: 'white_check_mark' }), { kind: 'slack', workspace: 'acme', channel: 'C0123ABCD', reaction: null, doneReaction: null });
});

test('a board and a thread read a person through one helper, and the mention loop is written once (T-87)', () => {
  const src = readFileSync(new URL('../src/trackers/slack.ts', import.meta.url), 'utf8');
  assert.equal(src.split("'users.info'").length - 1, 1, 'one users.info call');
  assert.equal(src.split('<@([A-Z0-9]+)').length - 1, 1, 'one loop over the mentions');
  assert.equal(src.split('this.namesIn(').length - 1, 2, 'the board and the thread both use it');
});
