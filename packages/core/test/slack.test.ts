// Slack as a tracker kind (T-27): its settings, its keys, and a client that reads a thread and replies in it,
// against Slack's own answers as fixtures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyPrefix, parseConfig, trackerForKey } from '../src/config.ts';
import { slackEscape } from '../src/text.ts';
import {
  SLACK_API, SLACK_CHANNEL, SLACK_PREFIX, SLACK_TITLE_MAX, SLACK_WORKSPACE, slackApp, slackAuth, slackCall, slackChannels, SlackClient, slackKey, slackName, type SlackOptions, slackText,
  slackThread, type SlackThread,
} from '../src/trackers/slack.ts';
import { placeText, TRACKER_KINDS, TrackerError, trackerName } from '../src/trackers/types.ts';
import { GENERIC_CONFIG } from './support.ts';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

// ---------------------------------------------------------------- Slack's answers

const ROOT_TS = '1696512345.123456';
const KEY = 'SL-1696512345123456';
const AUTH = { ok: true, url: 'https://acme.slack.com/', team: 'Acme', user: 'acc-bot', team_id: 'T01', user_id: 'U0BOT' };
const USERS: Record<string, unknown> = {
  U01: { ok: true, user: { id: 'U01', name: 'jkim', real_name: 'Jordan Kim', profile: { display_name: 'Jordan', real_name: 'Jordan Kim', email: 'jordan.kim@example.com' } } },
  U02: { ok: true, user: { id: 'U02', name: 'sam', real_name: 'Sam Lee', profile: { display_name: '', real_name: 'Sam Lee', email: 'sam.lee@example.com' } } },
};
const ROOT = { ts: ROOT_TS, user: 'U01', text: 'The invoice export drops the last row\nIt happens on every export since Monday. Write to <mailto:billing@example.com|billing@example.com> or ops@example.com.' };
const REPLIES = [
  { ts: '1696512400.000200', user: 'U02', text: 'I see it too, <@U01>. Logs: <https://logs.example/x|the log>' },
  { ts: '1696512399.000100', bot_id: 'B01', bot_profile: { name: 'Deploy bot' }, text: 'deployed &lt;v2&gt; &amp; done' },
];

interface Call { method: string; params: Record<string, string>; body: Record<string, unknown> | null; verb: string }

/** A Slack stand-in: each method's answer, or a function of the call, and every call it took. */
function fakeSlack(routes: Record<string, unknown | ((c: Call) => unknown)>, opts: { status?: Record<string, number>; headers?: Record<string, string> } = {}) {
  const calls: Call[] = [];
  const f = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.ok(url.href.startsWith(`${SLACK_API}/`), url.href);
    const method = url.pathname.replace('/api/', '');
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : null;
    const call: Call = { method, params: Object.fromEntries(url.searchParams), body, verb: init?.method ?? 'GET' };
    calls.push(call);
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer xoxb-test');
    const route = routes[method];
    const answer = typeof route === 'function' ? (route as (c: Call) => unknown)(call) : route ?? { ok: false, error: 'unknown_method' };
    return new Response(JSON.stringify(answer), { status: opts.status?.[method] ?? 200, headers: opts.headers ?? {} });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const threadRoutes = (messages: unknown[]) => ({
  'auth.test': AUTH,
  'conversations.replies': { ok: true, messages, has_more: false },
  'users.info': (c: Call) => USERS[c.params.user!] ?? { ok: false, error: 'user_not_found' },
  'chat.getPermalink': { ok: true, permalink: `https://acme.slack.com/archives/C0123ABCD/p1696512345123456` },
  'chat.postMessage': { ok: true, ts: '1696512500.000300' },
});

const client = (f: typeof fetch, o: Partial<SlackOptions> = {}) => new SlackClient({ workspace: 'acme', channel: 'C0123ABCD', token: 'xoxb-test', fetch: f, ...o });

// ---------------------------------------------------------------- the kind and its settings

test('slack is a tracker kind named Slack, whose place names its workspace and channel', () => {
  assert.ok(TRACKER_KINDS.includes('slack'));
  assert.equal(trackerName('slack'), 'Slack');
  assert.equal(placeText({ kind: 'slack', workspace: 'acme', channel: 'C0123ABCD' }), 'Slack · acme · channel C0123ABCD');
  assert.equal(placeText({ kind: 'slack' }), 'Slack · ? · channel ?', 'the edge case of a place with nothing set');
});

test('the config takes a Slack tracker with a workspace and a channel, and its keys start SL by default', () => {
  const ok = parseConfig({ ...clone(GENERIC_CONFIG), trackers: [{ kind: 'slack', workspace: 'Acme', channel: 'c0123abcd' }] });
  assert.deepEqual([ok.errors, ok.warnings], [[], []]);
  const t = ok.config!.trackers[0]!;
  assert.deepEqual([t.kind, t.workspace, t.channel, t.prefix], ['slack', 'acme', 'C0123ABCD', null]);
  assert.equal(keyPrefix(t), SLACK_PREFIX);
  assert.equal(keyPrefix({ ...t, prefix: 'ops' }), 'OPS');
  assert.equal(trackerForKey(ok.config!.trackers, KEY), 0, 'an SL key finds the Slack tracker');
  const named = parseConfig({ ...clone(GENERIC_CONFIG), trackers: [{ kind: 'slack', workspace: 'acme', channel: 'C0123ABCD', prefix: 'ops' }] });
  assert.equal(keyPrefix(named.config!.trackers[0]!), 'OPS');
});

test('a Slack tracker without its workspace or its channel is refused, and the error names the missing key', () => {
  const errorsOf = (t: Record<string, unknown>) => parseConfig({ ...clone(GENERIC_CONFIG), trackers: [{ kind: 'slack', ...t }] }).errors.join('\n');
  assert.match(errorsOf({ workspace: 'acme' }), /trackers\[0\]: a Slack tracker needs "channel":/);
  assert.doesNotMatch(errorsOf({ workspace: 'acme' }), /needs "workspace"/);
  assert.match(errorsOf({ channel: 'C0123ABCD' }), /trackers\[0\]: a Slack tracker needs "workspace":/);
  assert.match(errorsOf({}), /a Slack tracker needs "workspace" and "channel"/, 'the edge case of neither');
  assert.match(errorsOf({ workspace: ' ', channel: 'C0123ABCD' }), /needs "workspace"/, 'a blank one counts as missing');
  assert.match(errorsOf({ workspace: 'acme.slack.com', channel: 'C0123ABCD' }), /"workspace" must be a Slack workspace's domain/);
  assert.match(errorsOf({ workspace: 'acme', channel: '#general' }), /"channel" must be a Slack channel's id, such as C0123ABCD, not its name/);
  assert.ok(SLACK_WORKSPACE.test('acme-co') && !SLACK_WORKSPACE.test('-acme'));
  assert.ok(SLACK_CHANNEL.test('G01ABCDEF') && !SLACK_CHANNEL.test('general'));
});

test('a workspace or a channel on a tracker of another kind is warned about and ignored', () => {
  const { errors, warnings, config } = parseConfig({ ...clone(GENERIC_CONFIG), trackers: [{ kind: 'jira', site: 's', project: 'K', workspace: 'acme', channel: 'C0123ABCD' }] });
  assert.deepEqual(errors, []);
  assert.match(warnings.join('\n'), /trackers\[0\]: "workspace" applies only to a Slack tracker, so it's ignored/);
  assert.match(warnings.join('\n'), /trackers\[0\]: "channel" applies only to a Slack tracker, so it's ignored/);
  assert.deepEqual([config!.trackers[0]!.workspace, config!.trackers[0]!.channel], [null, null]);
});

// ---------------------------------------------------------------- keys

test('a key is the prefix, a hyphen and the thread\'s timestamp without its dot, and reads back to the timestamp', () => {
  const t: SlackThread = { channel: 'C0123ABCD', ts: ROOT_TS };
  assert.equal(slackKey(t), KEY);
  assert.equal(slackKey(t, 'ops'), 'OPS-1696512345123456');
  assert.deepEqual(slackThread(KEY), { channel: null, ts: ROOT_TS }, 'a key names no channel: it is the tracker\'s own');
  assert.deepEqual(slackThread('sl-1696512345123456'), { channel: null, ts: ROOT_TS });
  assert.deepEqual(slackThread('OPS-1696512345123456', 'OPS'), { channel: null, ts: ROOT_TS });
  assert.deepEqual(slackThread('https://acme.slack.com/archives/C0999ZZZZ/p1696512345123456'), { channel: 'C0999ZZZZ', ts: ROOT_TS });
  assert.deepEqual(slackThread('https://acme.slack.com/archives/C0123ABCD/p1696512400000200?thread_ts=1696512345.123456&cid=C0123ABCD'), { channel: 'C0123ABCD', ts: ROOT_TS }, 'a reply\'s link names its thread');
  for (const bad of ['', 'SL-12', 'MON-1696512345123456', 'https://evil.example/archives/C0123ABCD/p1696512345123456', 'SL-1696512345.123456']) assert.equal(slackThread(bad), null, `the edge case ${JSON.stringify(bad)}`);
});

// ---------------------------------------------------------------- ticket

test('a thread becomes a ticket: the first line is its title, and the body holds every message in time order with its writer\'s Slack name and no email', async () => {
  const { fetch: f, calls } = fakeSlack(threadRoutes([ROOT, ...REPLIES]));
  const t = await client(f).ticket(KEY);
  assert.equal(t.key, KEY);
  assert.equal(t.kind, 'slack');
  assert.equal(t.title, 'The invoice export drops the last row');
  assert.equal(t.url, 'https://acme.slack.com/archives/C0123ABCD/p1696512345123456');
  assert.deepEqual(t.reporter, { id: 'U01', name: 'Jordan' });
  assert.deepEqual([t.status.name, t.assignees, t.labels, t.comments, t.type], ['No status', [], [], [], null]);
  assert.equal(t.created, '2023-10-05T13:25:45.123Z');
  assert.equal(t.updated, '2023-10-05T13:26:40.000Z');
  const md = t.markdown;
  const order = ['**Jordan**', '**Deploy bot**', '**Sam Lee**'].map((w) => md.indexOf(w));
  assert.ok(order.every((i) => i >= 0) && order[0]! < order[1]! && order[1]! < order[2]!, md);
  assert.match(md, /deployed <v2> & done/, 'Slack\'s escapes are undone');
  assert.match(md, /I see it too, @Jordan\. Logs: the log \(https:\/\/logs\.example\/x\)/, 'a mention by name, a link by its label and address');
  assert.doesNotMatch(md, /@example\.com|jordan\.kim|sam\.lee/, 'no email: not a writer\'s, and not one in the text');
  assert.match(md, /\[email hidden\]/);
  const conv = calls.find((c) => c.method === 'conversations.replies')!;
  assert.deepEqual([conv.params.channel, conv.params.ts], ['C0123ABCD', ROOT_TS]);
  assert.equal(calls[0]!.method, 'auth.test', 'the token is checked first');
  assert.equal(calls.filter((c) => c.method === 'auth.test').length, 1);
  assert.equal(calls.filter((c) => c.method === 'users.info' && c.params.user === 'U01').length, 1, 'a name is read once');
});

test('a title is clipped to 150 characters, and a thread with an empty reply list is just its first message', async () => {
  const long = { ts: ROOT_TS, user: 'U01', text: `${'x'.repeat(200)}\nmore` };
  const { fetch: f } = fakeSlack(threadRoutes([long]));
  const t = await client(f).ticket(KEY);
  assert.equal(t.title.length, SLACK_TITLE_MAX);
  assert.ok(t.title.endsWith('…'));
  assert.equal(t.created, t.updated, 'the edge case of no replies: last changed when it was posted');
  assert.equal((t.markdown.match(/\*\*Jordan\*\*/g) ?? []).length, 1);
});

test('a thread whose first message was deleted, or that Slack doesn\'t give back, is not-found, never a ticket', async () => {
  const deleted = fakeSlack(threadRoutes([{ ts: ROOT_TS, subtype: 'tombstone', text: 'This message was deleted.' }, REPLIES[0]]));
  await assert.rejects(client(deleted.fetch).ticket(KEY), (e: unknown) => e instanceof TrackerError && e.kind === 'not-found' && /first message was deleted/.test(e.message));
  const empty = fakeSlack(threadRoutes([]));
  await assert.rejects(client(empty.fetch).ticket(KEY), (e: unknown) => e instanceof TrackerError && e.kind === 'not-found' && /too old for the workspace's plan/.test(e.message));
  const gone = fakeSlack({ ...threadRoutes([]), 'conversations.replies': { ok: false, error: 'thread_not_found' } });
  await assert.rejects(client(gone.fetch).ticket(KEY), (e: unknown) => e instanceof TrackerError && e.kind === 'not-found');
  await assert.rejects(client(gone.fetch).ticket('not a key'), (e: unknown) => e instanceof TrackerError && e.kind === 'not-found' && /isn't a Slack thread key/.test(e.message));
});

test('a thread from another channel is outside the place, and the error names that channel', async () => {
  const { fetch: f, calls } = fakeSlack(threadRoutes([ROOT]));
  await assert.rejects(client(f).ticket('https://acme.slack.com/archives/C0999ZZZZ/p1696512345123456'),
    (e: unknown) => e instanceof TrackerError && e.kind === 'outside' && /channel C0999ZZZZ/.test(e.message) && /Slack · acme · channel C0123ABCD/.test(e.message));
  assert.equal(calls.length, 0, 'it reads nothing from the other channel');
  const own = await client(f).ticket('https://acme.slack.com/archives/C0123ABCD/p1696512345123456');
  assert.equal(own.key, KEY, 'a link into its own channel is the same thread');
});

// ---------------------------------------------------------------- outside

test('outside gives a readable thread in another channel with its channel, and never a key, a failed read, a deleted or a too-old thread', async () => {
  const other = (ch: string) => `https://acme.slack.com/archives/${ch}/p1696512345123456`;
  const { fetch: f, calls } = fakeSlack({
    ...threadRoutes([]),
    'conversations.replies': (c: Call) => ({
      C0999ZZZZ: { ok: true, messages: [ROOT] },
      C0DELETED: { ok: true, messages: [{ ts: ROOT_TS, subtype: 'tombstone' }] },
      C0TOOOLD1: { ok: true, messages: [] },
      C0NOTIN11: { ok: false, error: 'not_in_channel' },
    } as Record<string, unknown>)[c.params.channel!],
  });
  const out = await client(f).outside([KEY, other('C0123ABCD'), other('C0999ZZZZ'), other('C0DELETED'), other('C0TOOOLD1'), other('C0NOTIN11'), 'junk']);
  assert.deepEqual(out, [{ key: other('C0999ZZZZ'), why: 'it\'s in channel C0999ZZZZ' }]);
  assert.equal(calls.filter((c) => c.method === 'conversations.replies').length, 4, 'only the links into other channels are read');
  assert.deepEqual(await client(f).outside([]), [], 'the edge case of no keys');
  const down = (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch;
  assert.deepEqual(await client(down).outside([other('C0999ZZZZ')]), [], 'a network failure is never outside');
});

// ---------------------------------------------------------------- comment

test('a reply posts in the thread as the app, escaped so it mentions no channel and no person', async () => {
  const { fetch: f, calls } = fakeSlack(threadRoutes([]));
  await client(f).comment(KEY, 'Merged. <!channel> & <@U01> see <https://evil.example|this>');
  const post = calls.find((c) => c.method === 'chat.postMessage')!;
  assert.equal(post.verb, 'POST');
  assert.deepEqual(post.body, {
    channel: 'C0123ABCD', thread_ts: ROOT_TS, text: 'Merged. &lt;!channel&gt; &amp; &lt;@U01&gt; see &lt;https://evil.example|this&gt;', unfurl_links: false, unfurl_media: false,
  });
  assert.equal(slackEscape('<!here> & <@U02>'), '&lt;!here&gt; &amp; &lt;@U02&gt;');
  await assert.rejects(client(f).comment(KEY, '  '), (e: unknown) => e instanceof TrackerError && e.kind === 'refused', 'the edge case of an empty reply');
  await assert.rejects(client(f).comment('https://acme.slack.com/archives/C0999ZZZZ/p1696512345123456', 'hi'), (e: unknown) => e instanceof TrackerError && e.kind === 'outside');
  assert.equal(calls.filter((c) => c.method === 'chat.postMessage').length, 1, 'neither refused reply was sent');
});

// ---------------------------------------------------------------- what a thread hasn't got

test('a thread has no statuses, people to assign, labels or board: lists are empty and changes are refused', async () => {
  const { fetch: f, calls } = fakeSlack(threadRoutes([]));
  const c = client(f);
  assert.deepEqual(await c.transitions(), []);
  assert.deepEqual(await c.labels(), []);
  assert.deepEqual(await c.assignable(), []);
  const refused = (re: RegExp) => (e: unknown) => e instanceof TrackerError && e.kind === 'refused' && re.test(e.message);
  await assert.rejects(c.transition(), refused(/no statuses/));
  await assert.rejects(c.assign(), refused(/no people to assign/));
  await assert.rejects(c.setLabels(), refused(/no labels/));
  await assert.rejects(c.board(), refused(/Track a thread by its link/));
  assert.equal(calls.length, 0, 'none of them asks Slack');
  assert.deepEqual(await c.me(), { id: 'U0BOT', name: 'acc-bot' });
  assert.equal(c.title, 'Slack · acme');
  assert.equal(c.place, 'Slack · acme · channel C0123ABCD');
});

// ---------------------------------------------------------------- trouble

test('a 429 says when to try again, from Slack\'s Retry-After', async () => {
  const { fetch: f } = fakeSlack(threadRoutes([ROOT]), { status: { 'auth.test': 429 }, headers: { 'Retry-After': '30' } });
  await assert.rejects(client(f).ticket(KEY), (e: unknown) => e instanceof TrackerError && /rate limit/.test(e.message) && /try again in 30 seconds/.test(e.message));
  const noHeader = fakeSlack(threadRoutes([ROOT]), { status: { 'conversations.replies': 429 } });
  await assert.rejects(client(noHeader.fetch).ticket(KEY), /try again in a minute/, 'the edge case of a 429 with no Retry-After');
});

test('a token from another workspace fails auth.test, naming that workspace, and nothing else is read', async () => {
  const { fetch: f, calls } = fakeSlack({ ...threadRoutes([ROOT]), 'auth.test': { ...AUTH, url: 'https://globex.slack.com/', team: 'Globex' } });
  await assert.rejects(client(f).ticket(KEY), (e: unknown) => e instanceof TrackerError && e.kind === 'auth' && /workspace globex, not acme/.test(e.message));
  await assert.rejects(client(f).comment(KEY, 'hi'), /workspace globex/);
  assert.deepEqual([...new Set(calls.map((c) => c.method))], ['auth.test']);
});

test('slackCall names a refused token, a missing scope and a network failure', async () => {
  const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  await assert.rejects(slackCall('t', 'auth.test', {}, answer({ ok: false, error: 'invalid_auth' })), (e: unknown) => e instanceof TrackerError && e.kind === 'auth');
  await assert.rejects(slackCall('t', 'chat.postMessage', {}, answer({ ok: false, error: 'missing_scope', needed: 'chat:write' })), (e: unknown) => e instanceof TrackerError && e.kind === 'scope' && /chat:write/.test(e.message));
  await assert.rejects(slackCall('t', 'x', {}, answer('nonsense', 500)), (e: unknown) => e instanceof TrackerError && e.kind === 'other');
  await assert.rejects(slackCall('t', 'x', {}, (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch), (e: unknown) => e instanceof TrackerError && e.kind === 'network');
});

test('slackText and slackName give words a person reads, with no email even when a name is one', () => {
  const names = new Map([['U01', 'Jordan']]);
  assert.equal(slackText('<!here> <#C0123ABCD|general> <@U09|old> <@U01>', names), '@here #general @old @Jordan');
  assert.equal(slackText('<https://x.example>', names), 'https://x.example');
  assert.equal(slackText('', names), '', 'the edge case of a message with no text');
  assert.equal(slackName({ id: 'U03', profile: { display_name: 'ana@example.com' } }), '[email hidden]');
  assert.equal(slackName({ id: 'U04', name: 'pat' }), 'pat');
  assert.equal(slackName({ id: 'U05' }), 'Someone');
});

// ---------------------------------------------------------------- connecting a channel (T-29)

test('slackAuth checks the token\'s workspace with auth.test, and one for another workspace fails, naming it', async () => {
  const { fetch: f, calls } = fakeSlack({ 'auth.test': AUTH });
  assert.equal((await slackAuth('Acme', 'xoxb-test', f)).user_id, 'U0BOT');
  assert.deepEqual(calls.map((c) => c.method), ['auth.test']);
  const other = fakeSlack({ 'auth.test': { ...AUTH, url: 'https://globex.slack.com/', team: 'Globex' } });
  await assert.rejects(slackAuth('acme', 'xoxb-test', other.fetch), (e: unknown) => e instanceof TrackerError && e.kind === 'auth' && /workspace globex, not acme/.test(e.message));
  const unnamed = fakeSlack({ 'auth.test': { ...AUTH, url: undefined, team: 'Globex' } });
  await assert.rejects(slackAuth('acme', 'xoxb-test', unnamed.fetch), /workspace Globex, not acme/, 'the edge case of no url: the team names it');
});

test('slackApp is the app\'s name from bots.info, and falls back to the bot user\'s name when bots.info fails or there is no bot', async () => {
  const { fetch: f, calls } = fakeSlack({ 'auth.test': { ...AUTH, bot_id: 'B0APP' }, 'bots.info': (c: Call) => ({ ok: true, bot: { id: c.params.bot, name: 'Acme Command Center' } }) });
  assert.deepEqual(await slackApp('acme', 'xoxb-test', f), { id: 'U0BOT', name: 'Acme Command Center' });
  assert.deepEqual(calls.map((c) => [c.method, c.params.bot ?? null]), [['auth.test', null], ['bots.info', 'B0APP']]);
  const failed = fakeSlack({ 'auth.test': { ...AUTH, bot_id: 'B0APP' }, 'bots.info': { ok: false, error: 'missing_scope', needed: 'users:read' } });
  assert.deepEqual(await slackApp('acme', 'xoxb-test', failed.fetch), { id: 'U0BOT', name: 'acc-bot' }, 'bots.info refused: the bot user\'s name');
  const noBot = fakeSlack({ 'auth.test': AUTH });
  assert.deepEqual([(await slackApp('acme', 'xoxb-test', noBot.fetch)).name, noBot.calls.length], ['acc-bot', 1], 'no bot id: bots.info isn\'t asked');
  const other = fakeSlack({ 'auth.test': { ...AUTH, url: 'https://globex.slack.com/' } });
  await assert.rejects(slackApp('acme', 'xoxb-test', other.fetch), /workspace globex/);
});

test('me is the app\'s name as slackApp gives it, once, and the bot user\'s name when bots.info fails', async () => {
  const routes = { 'auth.test': { ...AUTH, bot_id: 'B0APP' }, 'bots.info': { ok: true, bot: { id: 'B0APP', name: 'Acme Command Center' } } };
  const named = fakeSlack(routes);
  const c = client(named.fetch);
  assert.deepEqual([await c.me(), await c.me()], [await slackApp('acme', 'xoxb-test', fakeSlack(routes).fetch), { id: 'U0BOT', name: 'Acme Command Center' }]);
  assert.equal(named.calls.filter((x) => x.method === 'bots.info').length, 1, 'asked once, not on every draw of a page');
  const failed = fakeSlack({ 'auth.test': { ...AUTH, bot_id: 'B0APP' }, 'bots.info': { ok: false, error: 'missing_scope', needed: 'users:read' } });
  assert.equal((await client(failed.fetch).me()).name, 'acc-bot', 'bots.info refused: the bot user\'s name, as slackApp gives it');
});

test('slackChannels lists the public and private channels the app is in, by name, a page at a time, and an empty workspace is an empty list', async () => {
  const pages: Record<string, unknown> = {
    '': { ok: true, channels: [
      { id: 'C0SUPPORT1', name: 'support', is_member: true },
      { id: 'C0RANDOM01', name: 'random', is_member: false },
    ], response_metadata: { next_cursor: 'next' } },
    next: { ok: true, channels: [
      { id: 'G0BILLING1', name: 'billing', is_private: true, is_member: true },
      { id: 'C0OLD00001', name: 'old', is_member: true, is_archived: true },
    ], response_metadata: { next_cursor: '' } },
  };
  const { fetch: f, calls } = fakeSlack({ 'conversations.list': (c: Call) => pages[c.params.cursor ?? ''] });
  assert.deepEqual(await slackChannels('xoxb-test', f), [{ id: 'G0BILLING1', name: 'billing', private: true }, { id: 'C0SUPPORT1', name: 'support', private: false }], 'not one the app isn\'t in, nor an archived one');
  assert.deepEqual(calls.map((c) => [c.params.types, c.params.exclude_archived, c.params.cursor ?? null]), [['public_channel,private_channel', 'true', null], ['public_channel,private_channel', 'true', 'next']]);
  const empty = fakeSlack({ 'conversations.list': { ok: true, channels: [] } });
  assert.deepEqual(await slackChannels('xoxb-test', empty.fetch), []);
  const endless = fakeSlack({ 'conversations.list': { ok: true, channels: [], response_metadata: { next_cursor: 'again' } } });
  await slackChannels('xoxb-test', endless.fetch);
  assert.equal(endless.calls.length, 25, 'a cursor that never ends stops after 25 pages');
  const scope = fakeSlack({ 'conversations.list': { ok: false, error: 'missing_scope', needed: 'groups:read' } });
  await assert.rejects(slackChannels('xoxb-test', scope.fetch), (e: unknown) => e instanceof TrackerError && e.kind === 'scope' && /groups:read/.test(e.message));
});
