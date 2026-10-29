/**
 * A Slack channel as a tracker (T-27): each thread in it is a ticket, read and answered through a Slack app's
 * bot token over the Web API. A thread has no statuses, people to assign or labels, so those are empty, and
 * a change to them is refused. A reply posts as the app, with Slack's control characters escaped, so it can't
 * mention a channel or a person. A writer is named by their Slack name, never their email.
 */
import { type Block, type Doc, type Inline, toMarkdown } from './doc.ts';
import { clip, slackEscape } from '../text.ts';
import {
  type Board, type BoardCard, type BoardColumn, inBatches, type Label, type Outside, outsideError, type Person, placeText, type Status, type Ticket, type TrackerClient, TrackerError,
  textRefused, type Transition,
} from './types.ts';

export const SLACK_API = 'https://slack.com/api';
/** What a Slack tracker's keys start with when its config names no prefix: SL-1696512345123456. */
export const SLACK_PREFIX = 'SL';
/** A workspace's domain, the part before .slack.com. */
export const SLACK_WORKSPACE = /^[a-z0-9][a-z0-9-]*$/i;
/** A channel's id: a public (C), private (G) or direct (D) one, then letters and digits, with a digit, so a name like general isn't one. */
export const SLACK_CHANNEL = /^[CGD](?=[A-Z0-9]*\d)[A-Z0-9]{6,}$/i;
/** The most characters a thread's title holds: the first line of its first message. */
export const SLACK_TITLE_MAX = 150;
/** A reaction's name, as Slack writes it without colons: ticket, white_check_mark, +1, man-raising-hand. */
export const SLACK_REACTION = /^[a-z0-9_+'-]{1,100}$/;
/** The most characters a board card's title holds (T-85): the first line of its message. Its full text is the card's hover title. */
export const SLACK_CARD_MAX = 120;
/** How far back the board reads the channel, in days, and the most messages it reads (T-85). */
export const SLACK_BOARD_DAYS = 30;
export const SLACK_BOARD_MAX = 1000;
/** The reactions the Connect page offers for the board (T-85). The settings take any reaction's name, a team's own emoji too. */
export const SLACK_REACTIONS = ['ticket', 'eyes', 'bug', 'pushpin', 'raising_hand', 'sos', 'hammer_and_wrench', 'white_check_mark', 'heavy_check_mark', 'ballot_box_with_check'] as const;
/** Where a Slack app is made, and its bot token and scopes are set (its OAuth & Permissions page). */
export const SLACK_APPS = 'https://api.slack.com/apps';

export interface SlackOptions {
  /** The workspace, as in acme.slack.com. */
  workspace: string;
  /** The channel whose threads are the tracker's tickets, by its id. */
  channel: string;
  /** The key prefix for threads, SL by default. */
  prefix?: string;
  /** The Slack app's bot token. */
  token: string;
  /** The reaction that marks a message for the board (T-85). Without one, the board is off. */
  reaction?: string | null;
  /** The reaction that puts a marked message in the board's Done column. */
  doneReaction?: string | null;
  fetch?: typeof fetch;
  /** The time now, in ms: the board reads the last SLACK_BOARD_DAYS days before it. */
  now?: () => number;
}

/** A thread: the channel it's in, and its first message's timestamp. A key names no channel, so it reads as null: the tracker's own. */
export interface SlackThread {
  channel: string | null;
  ts: string;
}

interface SlackMessage {
  ts: string;
  text?: string;
  user?: string;
  bot_id?: string;
  username?: string;
  bot_profile?: { name?: string } | null;
  subtype?: string;
  /** A reply's thread, which conversations.history gives for a reply sent to the channel too. */
  thread_ts?: string;
  /** A thread's newest reply, which conversations.history gives on its first message (T-141). */
  latest_reply?: string;
  reactions?: { name: string; count?: number }[];
}
interface SlackUser { id: string; name?: string; real_name?: string; deleted?: boolean; profile?: { display_name?: string; real_name?: string } }

/** Slack's lists (a thread's replies, the channels) read a page at a time; the most a thread's body holds. */
const PAGE = 200;
const MAX_MESSAGES = 1000;
/** Threads checked at once, so checking many never floods Slack. */
const BATCH = 5;
const NO_STATUS: Status = { id: 'none', name: 'No status', category: 'todo' };
const NO_STATUSES = 'A Slack thread has no statuses to move between.';
const NO_PEOPLE = 'A Slack thread has no people to assign.';
const NO_LABELS = 'A Slack thread has no labels.';
/** Why a Slack tracker has no board until it names a reaction (T-85), and how to turn it on. */
export const NO_REACTION = 'The Slack board is off: this tracker names no reaction. Choose a reaction with Change, such as ticket, and the channel\'s messages with it are the board\'s cards. Until then, track a thread by its link.';
/** The Slack board's columns (T-85): a marked message is Open, and one with the done reaction too is Done. */
const OPEN: Status = { id: 'open', name: 'Open', category: 'todo' };
const DONE: Status = { id: 'done', name: 'Done', category: 'done' };

/** Slack's answers whose meaning is that the token is wrong, not the request. */
const AUTH_ERRORS = new Set(['invalid_auth', 'not_authed', 'account_inactive', 'token_revoked', 'token_expired', 'no_permission']);
/** Slack's answers that say the thing asked for isn't there, or isn't visible to the app. */
const GONE_ERRORS = new Set(['channel_not_found', 'thread_not_found', 'message_not_found', 'user_not_found', 'not_in_channel']);

/** A thread's key: the prefix, a hyphen, and its first message's timestamp without the dot. */
export function slackKey(thread: SlackThread, prefix = SLACK_PREFIX): string {
  return `${prefix.toUpperCase()}-${thread.ts.replace('.', '')}`;
}

/**
 * The thread a key or a thread's link names, or null when it's neither. A key's thread is in the tracker's
 * channel (null here); a link, https://acme.slack.com/archives/C0123ABCD/p1696512345123456, names its own.
 * A link to a reply (?thread_ts=…) names the thread the reply is in.
 */
export function slackThread(ref: string, prefix = SLACK_PREFIX): SlackThread | null {
  const s = ref.trim();
  // The config takes a prefix of letters and digits only, so it's safe in a pattern as it is.
  const key = new RegExp(`^${prefix}-(\\d{7,})$`, 'i').exec(s);
  if (key) return { channel: null, ts: tsOf(key[1]!) };
  const link = /^https:\/\/[a-z0-9-]+\.slack\.com\/archives\/([A-Z0-9]+)\/p(\d{7,})(?:\?(.*))?$/i.exec(s);
  if (!link) return null;
  const parent = new URLSearchParams(link[3] ?? '').get('thread_ts');
  return { channel: link[1]!.toUpperCase(), ts: parent && /^\d+\.\d{6}$/.test(parent) ? parent : tsOf(link[2]!) };
}

/** Slack's timestamps carry six digits after the dot. */
const tsOf = (digits: string): string => `${digits.slice(0, -6)}.${digits.slice(-6)}`;
const isoOf = (ts: string): string => new Date(Math.floor(Number(ts) * 1000)).toISOString();

/** An email address in text, which a thread's body never carries. */
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const noEmail = (s: string): string => s.replace(EMAIL, '[email hidden]');

/**
 * Slack's message text as plain words: a mention as @name, a channel as #name, a link as its label and
 * address, a mailto link as hidden, and Slack's three escapes undone. Mentions of people need their names,
 * which `names` gives.
 */
export function slackText(text: string, names: Map<string, string>): string {
  const plain = text.replace(/<([^<>]*)>/g, (_m, inner: string) => {
    const [target = '', label] = inner.split('|');
    if (target.startsWith('@')) return `@${names.get(target.slice(1)) ?? label ?? 'someone'}`;
    if (target.startsWith('#')) return `#${label ?? target.slice(1)}`;
    if (target.startsWith('!')) return `@${(label ?? target.slice(1)).replace(/^@/, '').split('^')[0]}`;
    if (/^mailto:/i.test(target)) return '[email hidden]';
    return label && label !== target ? `${label} (${target})` : target;
  });
  return noEmail(plain.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
}

/** A person's Slack name: their display name, else their full name, else their handle. Never their email. */
export const slackName = (u: SlackUser): string =>
  noEmail(u.profile?.display_name?.trim() || u.profile?.real_name?.trim() || u.real_name?.trim() || u.name?.trim() || 'Someone');

/**
 * One Web API call. A refused token is 'auth', a missing scope 'scope', and something gone or out of the app's
 * sight 'not-found'. A rate limit says when Slack takes requests again (its Retry-After), and isn't tried
 * again here.
 */
export async function slackCall<T>(token: string, method: string, params: Record<string, string | number | boolean>, f: typeof fetch = fetch, post = false): Promise<T> {
  let res: Response;
  try {
    const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    res = post
      ? await f(`${SLACK_API}/${method}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(params) })
      : await f(`${SLACK_API}/${method}?${query}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    throw new TrackerError('network', `Couldn't reach Slack: ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: ({ ok?: boolean; error?: string; needed?: string } & Record<string, unknown>) | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (res.status === 429 || json?.error === 'ratelimited') {
    const wait = Number(res.headers.get('retry-after') ?? NaN);
    throw new TrackerError('other', `Slack's rate limit for this app was reached${Number.isFinite(wait) && wait > 0 ? `: try again in ${Math.ceil(wait)} seconds` : ': try again in a minute'}.`);
  }
  if (res.status === 401 || (json?.error && AUTH_ERRORS.has(json.error))) throw new TrackerError('auth', `Slack didn't accept this repo's app token (${json?.error ?? `HTTP ${res.status}`}). Connect the Slack app again.`);
  if (json?.error === 'missing_scope') throw new TrackerError('scope', `The Slack app needs the ${json.needed ?? 'missing'} scope for ${method}. Add it on the app's OAuth & Permissions page at ${SLACK_APPS}, then install the app again.`);
  if (json?.error && GONE_ERRORS.has(json.error)) throw new TrackerError('not-found', `Slack: ${json.error}.`);
  if (json && json.ok === false) throw new TrackerError('other', `Slack: ${json.error ?? 'an unknown error'}.`);
  if (!res.ok || !json) throw new TrackerError('other', `Slack answered HTTP ${res.status}.`);
  return json as T;
}

/** What auth.test says of a bot token: its bot user, and the app's bot. */
export interface SlackAuth { user_id: string; user: string; bot_id?: string }

/**
 * auth.test, which says which workspace a token is for. One from another workspace fails, naming that
 * workspace, so the token never reads another client's channels.
 */
export async function slackAuth(workspace: string, token: string, f: typeof fetch = fetch): Promise<SlackAuth> {
  const want = workspace.trim().toLowerCase();
  const d = await slackCall<SlackAuth & { url?: string; team?: string }>(token, 'auth.test', {}, f);
  const domain = /^https:\/\/([^./]+)\.slack\.com/i.exec(d.url ?? '')?.[1]?.toLowerCase() ?? null;
  if (domain !== want) {
    throw new TrackerError('auth', `This Slack app's token is for the workspace ${domain ?? d.team ?? 'that Slack didn\'t name'}, not ${want}. Connect the app installed in ${want}.`);
  }
  return d;
}

/**
 * The app a bot token posts as, by the name Slack shows on its replies (bots.info), once auth.test has checked
 * the workspace. When bots.info can't be read, the bot user's name from auth.test.
 */
export async function slackApp(workspace: string, token: string, f: typeof fetch = fetch): Promise<Person> {
  return appOf(token, await slackAuth(workspace, token, f), f);
}

/** The app's name for a token auth.test has already checked: bots.info, else the bot user's name. */
async function appOf(token: string, d: SlackAuth, f: typeof fetch): Promise<Person> {
  const name = d.bot_id
    ? await slackCall<{ bot?: { name?: string } }>(token, 'bots.info', { bot: d.bot_id }, f).then((b) => b.bot?.name?.trim() || null).catch(() => null)
    : null;
  return { id: d.user_id, name: noEmail(name ?? d.user) };
}

/**
 * Whether the app can read the channel's messages, as the board does (T-85): one message of conversations.history.
 * A missing channels:history or groups:history scope fails with a 'scope' error that names it and where to add it.
 */
export async function slackCanRead(token: string, channel: string, f: typeof fetch = fetch): Promise<void> {
  await slackCall(token, 'conversations.history', { channel, limit: 1 }, f);
}

/** The most pages of channels read, so a large workspace never floods Slack. */
const CHANNEL_PAGES = 25;

/** A channel the app can read: its id, its name, and whether it's private. */
export interface SlackChannel { id: string; name: string; private: boolean }

/**
 * The public and private channels the app can read (conversations.list), by name. The app reads only a
 * channel it's in, so a channel it isn't in, and an archived one, are left out.
 */
export async function slackChannels(token: string, f: typeof fetch = fetch): Promise<SlackChannel[]> {
  type Listed = { id: string; name?: string; is_private?: boolean; is_member?: boolean; is_archived?: boolean };
  const out: SlackChannel[] = [];
  let cursor = '';
  let pages = 0;
  do {
    const d = await slackCall<{ channels?: Listed[]; response_metadata?: { next_cursor?: string } }>(token, 'conversations.list', {
      types: 'public_channel,private_channel', exclude_archived: true, limit: PAGE, ...(cursor ? { cursor } : {}),
    }, f);
    for (const c of d.channels ?? []) if (c.is_member && !c.is_archived) out.push({ id: c.id, name: c.name ?? c.id, private: !!c.is_private });
    cursor = d.response_metadata?.next_cursor ?? '';
  } while (cursor && ++pages < CHANNEL_PAGES);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export class SlackClient implements TrackerClient {
  readonly kind = 'slack' as const;
  /** A thread has no status, no people to assign and no labels (D-145), so the task page hides those controls. */
  readonly fields = [] as const;
  readonly title: string;
  readonly place: string;
  readonly prefix: string;
  private readonly o: SlackOptions;
  private readonly workspace: string;
  private readonly channel: string;
  /** The token's check against the workspace, made once. */
  private authCache: Promise<SlackAuth> | null = null;
  /** The app's name, looked up once: the task page and update cards ask on every draw. */
  private meCache: Promise<Person> | null = null;
  private readonly users = new Map<string, Promise<string>>();

  constructor(o: SlackOptions) {
    this.o = o;
    this.prefix = (o.prefix ?? SLACK_PREFIX).toUpperCase();
    this.workspace = o.workspace.trim().toLowerCase();
    this.channel = o.channel.trim().toUpperCase();
    this.title = `Slack · ${this.workspace}`;
    this.place = placeText({ kind: 'slack', workspace: this.workspace, channel: this.channel });
  }

  private raw<T>(method: string, params: Record<string, string | number | boolean>, post = false): Promise<T> {
    return slackCall<T>(this.o.token, method, params, this.o.fetch ?? fetch, post);
  }

  /** Every call but auth.test's own waits for it: a token from another workspace reads nothing. */
  private async call<T>(method: string, params: Record<string, string | number | boolean>, post = false): Promise<T> {
    await this.authed();
    return this.raw<T>(method, params, post);
  }

  /** slackAuth, made once: a token from another workspace fails, naming it. */
  private authed(): Promise<SlackAuth> {
    if (!this.authCache) {
      const p = slackAuth(this.workspace, this.o.token, this.o.fetch ?? fetch);
      this.authCache = p;
      p.catch(() => { if (this.authCache === p) this.authCache = null; });
    }
    return this.authCache;
  }

  /** The thread a key or link names. One that's neither is 'not-found'. */
  private threadOf(key: string): { channel: string; ts: string } {
    const t = slackThread(key, this.prefix);
    if (!t) throw new TrackerError('not-found', `${key} isn't a Slack thread key (${this.prefix}-<timestamp>) or a thread's link.`);
    return { channel: t.channel ?? this.channel, ts: t.ts };
  }

  /** The thread in this tracker's channel, or the 'outside' error that names the channel it's in. */
  private ownThread(key: string): { channel: string; ts: string } {
    const t = this.threadOf(key);
    if (t.channel !== this.channel) throw outsideError({ key, why: `it's in channel ${t.channel}` }, this.place);
    return t;
  }

  /** A person's Slack name by their id, read once into `cache` (the tracker's own, unless a board passes its). One that can't be read is Someone. */
  private name(id: string, cache: Map<string, Promise<string>> = this.users): Promise<string> {
    let p = cache.get(id);
    if (!p) {
      p = this.call<{ user: SlackUser }>('users.info', { user: id }).then((d) => slackName(d.user)).catch(() => 'Someone');
      cache.set(id, p);
    }
    return p;
  }

  /** The names of every writer and every person mentioned in the messages, each read once into `cache`. */
  private async namesIn(messages: SlackMessage[], cache?: Map<string, Promise<string>>): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const m of messages) {
      if (m.user) ids.add(m.user);
      for (const [, id] of (m.text ?? '').matchAll(/<@([A-Z0-9]+)(?:\|[^>]*)?>/gi)) ids.add(id!);
    }
    return new Map<string, string>(await Promise.all([...ids].map(async (id) => [id, await this.name(id, cache)] as [string, string])));
  }

  private async writer(m: SlackMessage): Promise<string> {
    if (m.user) return this.name(m.user);
    return noEmail(m.bot_profile?.name ?? m.username ?? 'A Slack app');
  }

  /** The thread's messages, oldest first: its first message, then every reply, a page at a time. */
  private async messages(channel: string, ts: string): Promise<SlackMessage[]> {
    const out: SlackMessage[] = [];
    let cursor = '';
    do {
      const d = await this.call<{ messages?: SlackMessage[]; response_metadata?: { next_cursor?: string } }>('conversations.replies', {
        channel, ts, limit: PAGE, ...(cursor ? { cursor } : {}),
      });
      out.push(...(d.messages ?? []));
      cursor = d.response_metadata?.next_cursor ?? '';
    } while (cursor && out.length < MAX_MESSAGES);
    return out.slice(0, MAX_MESSAGES).sort((a, b) => Number(a.ts) - Number(b.ts));
  }

  /**
   * The channel's messages marked with the tracker's reaction (T-85), from conversations.history: the last
   * SLACK_BOARD_DAYS days, a page at a time, and at most SLACK_BOARD_MAX messages. Only a top-level message
   * counts, not a reply sent to the channel too. One with the done reaction as well is Done, the rest Open.
   * A card's person is the message's writer, read once a board; its link is Slack's permalink. Nothing is
   * written to Slack. With no reaction, it refuses, saying how to turn the board on.
   */
  async board(): Promise<Board> {
    const reaction = this.o.reaction?.trim();
    if (!reaction) throw new TrackerError('refused', NO_REACTION);
    const done = this.o.doneReaction?.trim() || null;
    const oldest = Math.floor(((this.o.now ?? Date.now)() - SLACK_BOARD_DAYS * 86_400_000) / 1000);
    const read: SlackMessage[] = [];
    let cursor = '';
    do {
      const d = await this.call<{ messages?: SlackMessage[]; has_more?: boolean; response_metadata?: { next_cursor?: string } }>('conversations.history', {
        channel: this.channel, oldest, limit: PAGE, ...(cursor ? { cursor } : {}),
      });
      read.push(...(d.messages ?? []));
      cursor = d.response_metadata?.next_cursor ?? '';
    } while (cursor && read.length < SLACK_BOARD_MAX);
    const full = read.length >= SLACK_BOARD_MAX && !!cursor;
    // A reaction with a skin tone is named ticket::skin-tone-2, and is the same reaction.
    const has = (m: SlackMessage, name: string) => (m.reactions ?? []).some((r) => r.name === name || r.name.startsWith(`${name}::`));
    const marked = read.slice(0, SLACK_BOARD_MAX)
      .filter((m) => (!m.thread_ts || m.thread_ts === m.ts) && m.subtype !== 'tombstone' && has(m, reaction))
      .sort((a, b) => Number(b.ts) - Number(a.ts));
    // Each writer read once a board, so a renamed person shows their new name on the next load.
    const names = await this.namesIn(marked, new Map());
    const cards = await inBatches(marked, BATCH, async (m): Promise<BoardCard> => {
      const thread = { channel: this.channel, ts: m.ts };
      const first = slackText(m.text ?? '', names).split('\n').map((l) => l.trim()).find(Boolean) ?? 'A message with no text';
      const link = await this.call<{ permalink?: string }>('chat.getPermalink', { channel: this.channel, message_ts: m.ts }).then((d) => d.permalink ?? null).catch(() => null);
      const author: Person = m.user ? { id: m.user, name: names.get(m.user) ?? 'Someone' } : { id: m.bot_id ?? '', name: await this.writer(m) };
      return {
        key: slackKey(thread, this.prefix), title: clip(first, SLACK_CARD_MAX), ...(first.length > SLACK_CARD_MAX ? { fullTitle: first } : {}),
        url: link ?? `https://${this.workspace}.slack.com/archives/${this.channel}/p${m.ts.replace('.', '')}`,
        status: done && has(m, done) ? DONE : OPEN, type: null, typeKind: null, typeColor: null, assignees: [author], labels: [], priority: null, priorityLevel: null,
        // A thread changes when a reply comes in: its newest message, as the thread's own read says it.
        updated: isoOf(m.latest_reply ?? m.ts),
      };
    });
    const columns: BoardColumn[] = [
      { id: OPEN.id, name: OPEN.name, category: OPEN.category, statusIds: [OPEN.id] },
      ...(done ? [{ id: DONE.id, name: DONE.name, category: DONE.category, statusIds: [DONE.id] }] : []),
    ];
    const notice = full ? `Only the newest ${SLACK_BOARD_MAX.toLocaleString('en-US')} messages of the last ${SLACK_BOARD_DAYS} days were read, so an older marked message isn't on the board.`
      : !cards.length ? `No message from the last ${SLACK_BOARD_DAYS} days has the :${reaction}: reaction. Add it to a message in Slack, and it's on the board after a refresh.` : null;
    return {
      source: 'slack', title: `Messages marked :${reaction}:`, url: `https://${this.workspace}.slack.com/archives/${this.channel}`,
      columns, cards, notice, place: this.place,
    };
  }

  /** The thread: its first message's first line is the title, and the body holds every message with its writer. */
  async ticket(key: string): Promise<Ticket> {
    const { channel, ts } = this.ownThread(key);
    const k = slackKey({ channel, ts }, this.prefix);
    const all = await this.messages(channel, ts);
    const root = all.find((m) => m.ts === ts);
    if (!root) throw new TrackerError('not-found', `${k} isn't a thread the Slack app can read. It may be too old for the workspace's plan, or in a channel the app isn't in.`);
    if (root.subtype === 'tombstone') throw new TrackerError('not-found', `${k}'s first message was deleted in Slack, so the thread has no title.`);
    const names = await this.namesIn(all);
    const blocks: Block[] = [];
    for (const m of all.filter((x) => x.subtype !== 'tombstone')) {
      const said = slackText(m.text ?? '', names);
      const who: Inline[] = [{ t: 'text', text: await this.writer(m), marks: ['strong'] }, { t: 'text', text: ` · ${isoOf(m.ts)}` }];
      blocks.push({ t: 'p', c: who }, ...said.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p): Block => ({
        t: 'p', c: p.split('\n').flatMap((line, i): Inline[] => (i ? [{ t: 'br' }, { t: 'text', text: line }] : [{ t: 'text', text: line }])),
      })));
    }
    const body: Doc = { blocks };
    const first = slackText(root.text ?? '', names).split('\n').map((l) => l.trim()).find(Boolean) ?? 'A message with no text';
    const permalink = await this.call<{ permalink?: string }>('chat.getPermalink', { channel, message_ts: ts }).then((d) => d.permalink ?? null).catch(() => null);
    const last = all.at(-1)!;
    return {
      key: k, kind: 'slack', url: permalink ?? `https://${this.workspace}.slack.com/archives/${channel}/p${ts.replace('.', '')}`,
      title: clip(first, SLACK_TITLE_MAX), type: null, typeKind: null, typeColor: null, status: NO_STATUS, assignees: [],
      reporter: root.user ? { id: root.user, name: names.get(root.user) ?? 'Someone' } : { id: root.bot_id ?? '', name: await this.writer(root) },
      labels: [], priority: null, priorityLevel: null, created: isoOf(root.ts), updated: isoOf(last.ts), body, markdown: toMarkdown(body), comments: [], related: [],
    };
  }

  /**
   * The threads outside this tracker's channel, each naming the channel it's in. A key is always in the
   * tracker's channel; only a thread's link can name another. A thread that can't be read (an error, a
   * deleted first message, or one too old for the workspace's plan) is never outside (D-048).
   */
  async outside(keys: string[]): Promise<Outside[]> {
    const elsewhere = keys.flatMap((key) => {
      const t = slackThread(key, this.prefix);
      return t?.channel && t.channel !== this.channel ? [{ key, channel: t.channel, ts: t.ts }] : [];
    });
    const seen = await inBatches(elsewhere, BATCH, async (t): Promise<Outside | null> => {
      try {
        const d = await this.call<{ messages?: SlackMessage[] }>('conversations.replies', { channel: t.channel, ts: t.ts, limit: 1 });
        const root = d.messages?.find((m) => m.ts === t.ts);
        return root && root.subtype !== 'tombstone' ? { key: t.key, why: `it's in channel ${t.channel}` } : null;
      } catch {
        return null; // it couldn't be read, which never counts as outside (D-048)
      }
    });
    return seen.filter((o): o is Outside => o !== null);
  }

  async transitions(): Promise<Transition[]> {
    return [];
  }

  async transition(): Promise<void> {
    throw new TrackerError('refused', NO_STATUSES);
  }

  /** acc doesn't write its ticket text yet (T-80): it refuses, with why. */
  async setText(): Promise<void> {
    throw textRefused(this.kind);
  }

  /** A reply in the thread, posted as the app, with Slack's control characters escaped so it mentions no one. */
  async comment(key: string, text: string): Promise<void> {
    if (!text.trim()) throw new TrackerError('refused', 'The reply is empty.');
    const { channel, ts } = this.ownThread(key);
    await this.call('chat.postMessage', { channel, thread_ts: ts, text: slackEscape(text), unfurl_links: false, unfurl_media: false }, true);
  }

  /** The app a reply posts as, named as slackApp names it: by bots.info, else by the bot user. */
  me(): Promise<Person> {
    if (!this.meCache) {
      const p = this.authed().then((d) => appOf(this.o.token, d, this.o.fetch ?? fetch));
      this.meCache = p;
      p.catch(() => { if (this.meCache === p) this.meCache = null; });
    }
    return this.meCache;
  }

  async assignable(): Promise<Person[]> {
    return [];
  }

  async assign(): Promise<void> {
    throw new TrackerError('refused', NO_PEOPLE);
  }

  async labels(): Promise<Label[]> {
    return [];
  }

  async setLabels(): Promise<void> {
    throw new TrackerError('refused', NO_LABELS);
  }
}
