/**
 * acc's notices in Slack (GH-58): a person's incoming webhook, for this machine, kept in VSCode's secret
 * storage and nowhere else. Each message is a fixed template (the repo, the task's id and title, a fixed
 * phrase for what happened, and one link), never the toast's text, which can carry a review's summary,
 * an agent's words, a question or a command. Each moment is sent once from this machine, whichever window
 * sees it first: a window claims its key in ~/.acc/slack/sent before it sends, and a key is built from
 * ledger data, so every window builds the same one. No vscode import, so it's tested with stand-ins.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AutopilotRecord } from '../../packages/core/src/autopilot.ts';
import { runStartedAt, type Task } from '../../packages/core/src/ledger.ts';
import { isTrackerKind } from '../../packages/core/src/trackers/types.ts';
import { EVENT_WORDS, type Update } from '../../packages/core/src/updates.ts';
import type { NoticeKind, TaskNotice, TaskRow, Tone } from './logic.ts';

export const SLACK_KINDS = ['needs-you', 'review', 'pr', 'draft'] as const;
export type SlackKind = (typeof SLACK_KINDS)[number];

/** Each kind as the card's checkbox and the message's first line say it. */
export const SLACK_KIND_WORDS: Record<SlackKind, { label: string; icon: string; emoji: string }> = {
  'needs-you': { label: 'Needs you', icon: 'bell', emoji: ':bell:' },
  review: { label: 'Review finished', icon: 'checklist', emoji: ':mag:' },
  pr: { label: 'Pull request opened', icon: 'git-pull-request', emoji: ':arrow_heading_up:' },
  draft: { label: 'Draft update waiting', icon: 'note', emoji: ':memo:' },
};

/** Where the webhook is kept, in VSCode's secret storage for this extension on this machine. */
export const SLACK_SECRET = 'acc.slack.webhook';
/** Where the switch, the kinds and the last result are kept, in globalState: per machine, not synced. */
export const SLACK_STATE = 'acc.slack';

export const SLACK_TIMEOUT_MS = 10_000;
export const SLACK_SPACING_MS = 1_000;
/** A burst longer than this is cut short, with one message saying how many more there were. */
export const SLACK_QUEUE_MAX = 20;
/** Claims older than this are forgotten when VSCode starts. */
export const SLACK_CLAIM_DAYS = 30;

/** Only Slack's own incoming webhooks: a notice never goes to any other address. */
export const isSlackWebhook = (url: string): boolean => url.length <= 300 && /^https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url);

/** Slack's three control characters, so a title like <!channel> is text, not a mention. */
export const slackEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A title on one line, and short. */
const oneLine = (s: string, max = 150): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
};

/** A link Slack's <url|label> can hold as it is: https, with nothing it would read as markup. */
const linkable = (url: string | null | undefined): url is string => !!url && url.length <= 500 && /^https:\/\/[^\s<>|&]+$/.test(url);

export interface SlackLink {
  url: string;
  label: string;
}

/** One moment, as Slack is told it. Everything in it is fixed words or the task's id, title and link. */
export interface SlackEvent {
  /** The same in every window: built from ledger data, never from when a window noticed. */
  key: string;
  kind: SlackKind;
  project: string;
  task: string;
  title: string;
  what: string;
  link: SlackLink | null;
  /** When it happened, in ms: anything from before Slack was turned on isn't sent. */
  at: number;
}

export interface SlackPayload {
  text: string;
  unfurl_links: false;
  unfurl_media: false;
}

const payload = (lines: (string | null)[]): SlackPayload => ({ text: lines.filter((l) => l !== null).join('\n'), unfurl_links: false, unfurl_media: false });

/** The message for one moment: what kind, the repo, the task, what happened, and one link. */
export function slackMessage(ev: Pick<SlackEvent, 'kind' | 'project' | 'task' | 'title' | 'what' | 'link'>): SlackPayload {
  const k = SLACK_KIND_WORDS[ev.kind];
  return payload([
    `${k.emoji} *${k.label}* · ${slackEscape(oneLine(ev.project, 80))}`,
    `*${slackEscape(oneLine(ev.task, 40))}* ${slackEscape(oneLine(ev.title))}`.trimEnd(),
    slackEscape(ev.what),
    ev.link && linkable(ev.link.url) ? `<${ev.link.url}|${slackEscape(ev.link.label)}>` : null,
  ]);
}

export const SLACK_TEST_TEXT = 'acc can post here. Notices from the Command Center on this machine will come to this channel.';

const testMessage = (): SlackPayload => payload([`:white_check_mark: *Agent Command Center* · ${SLACK_TEST_TEXT}`]);

const moreMessage = (n: number): SlackPayload =>
  payload([`:bell: *Agent Command Center* · ${n} more notice${n === 1 ? ' wasn\'t' : 's weren\'t'} sent, so Slack isn't flooded. The Command Center shows them all.`]);

// ---------------------------------------------------------------- each moment, in fixed words

/** The task's pull request, else its ticket, else no link. */
export function taskLink(row: Pick<TaskRow, 'pr' | 'source'> | undefined): SlackLink | null {
  const pr = row?.pr;
  if (pr && linkable(pr.url)) return { url: pr.url, label: `Pull request #${pr.number}` };
  const ticket = row?.source.url;
  return linkable(ticket) ? { url: ticket, label: 'The ticket' } : null;
}

/** Which kind each of the Command Center's task notices is (D-044). Kinds left out aren't sent. */
const TASK_KIND: Partial<Record<NoticeKind, SlackKind>> = {
  waiting: 'needs-you', stopped: 'needs-you', blocked: 'needs-you', 'ci-failed': 'needs-you', changes: 'needs-you', conflicts: 'needs-you',
  'analysis-questions': 'needs-you', 'analysis-split': 'needs-you',
  // A review's result is Review finished, even one that waits for you.
  passed: 'review', rework: 'review',
};

/** A repo's tasks as one reload of it saw them: the rows, and the ledger they came from. */
export interface SlackProject {
  name: string;
  ledgerPath: string;
  rows: TaskRow[];
  tasks: Pick<Task, 'id' | 'title' | 'history' | 'run' | 'source'>[];
}

const ms = (iso: string | null | undefined, or: number): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : or;
};

/**
 * A task notice (D-044), as Slack is told it, or null for one that isn't sent. Its key comes from the
 * ledger: the move's time for blocked and a review's result, the review's own time for a pass, the run's
 * start for a stopped or waiting builder (once a run), the pull request and the run for its checks, a
 * reviewer and a conflict, and the analysis's time for an analysis.
 */
export function taskEvent(p: SlackProject, n: TaskNotice, now: number): SlackEvent | null {
  const kind = TASK_KIND[n.kind];
  const row = p.rows.find((r) => r.id === n.task);
  if (!kind || !row) return null;
  const task = p.tasks.find((t) => t.id === n.task);
  const moved = task?.history.filter((h) => h.to === row.state).at(-1)?.at ?? null;
  const run = (task ? runStartedAt(task) : null) ?? '';
  const pr = row.pr?.number ?? 0;
  const at = (iso: string | null) => ms(iso, now);
  // A line about the agent names it (D-087): the name acc gave its builder, escaped with the rest.
  const agent = row.run?.name;
  const by: Record<string, { d: string; what: string; at: number }> = {
    waiting: { d: run, what: `${agent ?? 'Its agent'} is waiting for you in its own prompt.`, at: now },
    stopped: { d: run, what: `${agent ?? 'Its builder'} stopped before acc done or acc block. It can be resumed from the Command Center.`, at: now },
    blocked: { d: moved ?? '', what: 'It\'s blocked.', at: at(moved) },
    'ci-failed': { d: `${pr}:${run}`, what: `Checks failed on pull request #${pr}.`, at: now },
    changes: { d: `${pr}:${run}`, what: `A reviewer asked for changes on pull request #${pr}.`, at: now },
    conflicts: { d: `${pr}:${run}`, what: `Pull request #${pr} conflicts with its base.`, at: now },
    'analysis-questions': { d: row.analysis?.at ?? '', what: 'Its analysis has questions for you.', at: at(row.analysis?.at ?? null) },
    'analysis-split': { d: row.analysis?.at ?? '', what: 'Its analysis says it\'s too big for one task.', at: at(row.analysis?.at ?? null) },
    passed: { d: row.review?.at ?? moved ?? '', what: 'The review passed. It\'s ready to land.', at: at(row.review?.at ?? moved) },
    rework: { d: moved ?? '', what: 'The review asked for changes. It waits for you to re-dispatch it.', at: at(moved) },
  };
  const e = by[n.kind]!;
  return { key: `t:${p.ledgerPath}:${n.task}:${n.kind}:${e.d}`, kind, project: p.name, task: n.task, title: row.title, what: e.what, link: taskLink(row), at: e.at };
}

/** What a step autopilot couldn't take is called. */
const COULDNT = { review: 'review it', land: 'land it', dispatch: 're-dispatch it', refresh: 'merge its base into it', resume: 'resume its builder', checks: 'send it back for its failing checks', merge: 'merge its pull request', queue: 'take it through the merge queue' } as const;

/** Whether a task's ticket takes updates: one from a tracker, with a key (D-066). */
const ticketed = (t: Pick<Task, 'source'> | undefined): boolean => !!t?.source.key && isTrackerKind(t.source.kind);

/**
 * A step autopilot took (D-064), as Slack is told it, or null for one that isn't sent: what it couldn't
 * do, a review's result, and a pull request it opened. A pull request it merged isn't sent, as no merge
 * is (D-078, GH-67). `urgent` is the notice's: a second rework waits for you. Keyed by the step's place
 * in the repo's events.
 */
export function autopilotEvent(p: SlackProject, r: AutopilotRecord, urgent: boolean): SlackEvent | null {
  const row = p.rows.find((x) => x.id === r.task);
  const task = p.tasks.find((t) => t.id === r.task);
  let kind: SlackKind;
  let what: string;
  let link = taskLink(row);
  if (r.outcome === 'failed') {
    kind = 'needs-you';
    what = `Autopilot couldn't ${COULDNT[r.step]}. It waits for you.`;
  } else if (r.step === 'review') {
    kind = 'review';
    what = r.verdict === 'pass' ? 'Autopilot\'s review passed it. Autopilot lands it next.'
      : urgent ? 'Autopilot\'s review asked for changes again. A second rework waits for you.'
        : 'Autopilot\'s review asked for changes. Autopilot re-dispatches it next.';
  } else if (r.step === 'land' && r.pr?.opened) {
    kind = 'pr';
    what = `Autopilot opened pull request #${r.pr.number}.${ticketed(task) ? ' Its update for the ticket waits for you to review and post.' : ''}`;
    if (linkable(r.pr.url)) link = { url: r.pr.url, label: `Pull request #${r.pr.number}` };
  } else return null;
  return { key: `a:${p.ledgerPath}:${r.seq}`, kind, project: p.name, task: r.task, title: row?.title ?? task?.title ?? '', what, link, at: ms(r.at, 0) };
}

/** The key a draft update is told by, so a draft that replaces it can tell it was. */
export const draftKey = (ledgerPath: string, id: string): string => `u:${ledgerPath}:${id}`;

/**
 * New draft updates (D-066), as Slack is told them. A draft that replaces one already told isn't told
 * again (D-071), and the draft of a pull request autopilot opened is told by that pull request's message.
 */
export function draftEvents(p: SlackProject, drafts: Update[], log: AutopilotRecord[], told: (key: string) => boolean): SlackEvent[] {
  const out: SlackEvent[] = [];
  for (const u of drafts) {
    if (u.state !== 'draft') continue;
    if ((u.replaces ?? []).some((id) => told(draftKey(p.ledgerPath, id)))) continue;
    if (u.event === 'pr-opened' && u.pr && log.some((r) => r.task === u.task && r.step === 'land' && r.outcome === 'done' && r.pr?.opened && r.pr.number === u.pr!.number)) continue;
    const row = p.rows.find((x) => x.id === u.task);
    const pr = u.pr;
    const link = pr && linkable(pr.url) ? { url: pr.url, label: `Pull request #${pr.number}` } : linkable(u.url) ? { url: u.url, label: 'The ticket' } : taskLink(row);
    out.push({
      key: draftKey(p.ledgerPath, u.id), kind: 'draft', project: p.name, task: u.task, title: row?.title ?? p.tasks.find((t) => t.id === u.task)?.title ?? '',
      what: `An update for its ticket waits for you to post: ${EVENT_WORDS[u.event] ?? 'news'}.`, link, at: ms(u.createdAt, 0),
    });
  }
  return out;
}

/** What an agent's question asks for, in fixed words after its name: never the question or the command. */
const ASKS: Record<string, string> = { AskUserQuestion: 'has a question for you.', ExitPlanMode: 'has a plan for you to approve.' };

/**
 * A task's agent asks something (D-030), named as acc named its builder (D-087). A question no task asks
 * isn't sent: the message names a task.
 */
export function questionEvent(q: { id: string; tool: string; at: number }, p: { name: string; rows: TaskRow[] }, task: string | null): SlackEvent | null {
  const row = task ? p.rows.find((r) => r.id === task) : undefined;
  if (!row) return null;
  const what = `${row.run?.name ?? 'Its agent'} ${ASKS[q.tool] ?? 'asks for your permission.'}`;
  return { key: `q:${q.id}`, kind: 'needs-you', project: p.name, task: row.id, title: row.title, what, link: taskLink(row), at: q.at };
}

// ---------------------------------------------------------------- the sender

export interface SlackState {
  on: boolean;
  /** When it was turned on, in ms: nothing from before is sent. */
  since: number;
  kinds: SlackKind[];
  /** Slack refused a message (a 4xx other than 429): nothing is sent until a test goes through. */
  paused: string | null;
  last: { at: number; ok: boolean; text: string } | null;
  /** The webhook's last four characters, to tell one from another. The webhook itself is a secret. */
  tail: string | null;
}

export const blankSlack = (): SlackState => ({ on: false, since: 0, kinds: [...SLACK_KINDS], paused: null, last: null, tail: null });

/** globalState as read: anything that isn't a state is the blank one, with what parts of it are sound. */
export function slackState(v: unknown): SlackState {
  const x = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const last = x.last as Record<string, unknown> | null | undefined;
  return {
    on: x.on === true,
    since: typeof x.since === 'number' ? x.since : 0,
    kinds: Array.isArray(x.kinds) ? SLACK_KINDS.filter((k) => (x.kinds as unknown[]).includes(k)) : [...SLACK_KINDS],
    paused: typeof x.paused === 'string' ? x.paused : null,
    last: last && typeof last.at === 'number' && typeof last.ok === 'boolean' && typeof last.text === 'string' ? { at: last.at, ok: last.ok, text: last.text } : null,
    tail: typeof x.tail === 'string' ? x.tail.slice(-4) : null,
  };
}

/** Somewhere to offer a moment to, and to ask whether one was told. Notices and Questions see only this. */
export interface SlackSink {
  offer(ev: SlackEvent | null): void;
  told(key: string): boolean;
}

export interface SlackDeps {
  secrets: { get(key: string): Thenable<string | undefined>; store(key: string, value: string): Thenable<void>; delete(key: string): Thenable<void> };
  state: { get(): unknown; set(s: SlackState): Thenable<void> | void };
  log(line: string, warn?: boolean): void;
  /** Slack refused a message, so sending is paused: say so once. */
  paused?(reason: string): void;
  /** The card has something new to show. */
  changed?(): void;
  fetch?: typeof fetch;
  /** Where claims are kept: ~/.acc/slack/sent, or ACC_SLACK_DIR. */
  dir?: string;
  now?(): number;
  sleep?(ms: number): Promise<void>;
}

type Thenable<T> = PromiseLike<T>;

export const slackDir = (env: NodeJS.ProcessEnv = process.env): string => env.ACC_SLACK_DIR || join(homedir(), '.acc', 'slack', 'sent');

const hash = (key: string): string => createHash('sha256').update(key).digest('hex');

/** An error's words without the webhook in them, whatever fetch put there. */
const scrub = (s: string): string => s.replace(/https?:\/\/hooks\.slack\.com[A-Za-z0-9_\-/.]*/gi, 'the webhook').replace(/\s+/g, ' ').trim().slice(0, 200);

export type SlackResult = { ok: true } | { ok: false; error: string };

export class Slack implements SlackSink {
  private readonly deps: SlackDeps;
  private readonly dir: string;
  private readonly queue: SlackEvent[] = [];
  private more = 0;
  private running: Promise<void> | null = null;
  private lastSent = -Infinity;
  /** A test or a connect is under way: the card says so. */
  busy = false;

  constructor(deps: SlackDeps) {
    this.deps = deps;
    this.dir = deps.dir ?? slackDir();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  state(): SlackState {
    return slackState(this.deps.state.get());
  }

  private async save(change: Partial<SlackState>): Promise<void> {
    await this.deps.state.set({ ...this.state(), ...change });
    this.deps.changed?.();
  }

  /** Whether a moment was told from this machine, by any window, since VSCode last forgot it. */
  told(key: string): boolean {
    try {
      statSync(join(this.dir, hash(key)));
      return true;
    } catch {
      return false;
    }
  }

  /** Takes a moment for this window to send. False when another window, or an earlier start, already has. */
  private claim(key: string): boolean {
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      writeFileSync(join(this.dir, hash(key)), String(this.now()), { flag: 'wx', mode: 0o600 });
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') this.deps.log(`Slack: can't keep track of what was sent in ${this.dir}: ${(e as Error).message}`, true);
      return false;
    }
  }

  /**
   * A moment, for Slack if it's on, its kind is chosen, sending isn't paused, and it happened since Slack
   * was turned on. It's claimed first, so of every window that offers it, one sends it, once.
   */
  offer(ev: SlackEvent | null): void {
    if (!ev) return;
    const s = this.state();
    if (!s.on || s.paused || !s.kinds.includes(ev.kind) || ev.at < s.since) return;
    if (!this.claim(ev.key)) return;
    if (this.queue.length >= SLACK_QUEUE_MAX) this.more++;
    else this.queue.push(ev);
    this.pump();
  }

  /** Resolves once everything offered so far has been sent, or dropped. */
  async settled(): Promise<void> {
    while (this.running) await this.running;
  }

  /** Sends what's queued, one at a time, a second apart. Off or paused, the rest is dropped. */
  private pump(): void {
    if (this.running) return;
    const run = async () => {
      while (this.queue.length || this.more) {
        const s = this.state();
        if (!s.on || s.paused) {
          this.queue.length = 0;
          this.more = 0;
          return;
        }
        const ev = this.queue.shift();
        const n = this.more;
        if (!ev) this.more = 0;
        const r = await this.post(ev ? slackMessage(ev) : moreMessage(n), ev ? `${ev.task}'s ${SLACK_KIND_WORDS[ev.kind].label.toLowerCase()} notice` : `the ${n} more`);
        const paused = this.state().paused;
        if (!r.ok && paused) this.deps.paused?.(paused);
      }
    };
    // finally runs after this assignment, so a run that ends at once still clears it. Something offered
    // between the loop's end and finally would wait for the next offer: look again, and send it now.
    // After an error it waits for the next offer, so a fault can't spin it.
    this.running = run().then(() => true, (e: unknown) => { this.deps.log(`Slack: ${scrub((e as Error).message)}`, true); return false; }).then((ok) => {
      this.running = null;
      if (ok && (this.queue.length || this.more)) this.pump();
    });
  }

  /** Waits until a second has passed since the last message this window sent. */
  private async space(): Promise<void> {
    const wait = this.lastSent + SLACK_SPACING_MS - this.now();
    if (wait > 0) await (this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))))(wait);
  }

  /**
   * One POST, never retried. A 4xx other than 429 pauses sending with Slack's reason. A 429, a 5xx, a
   * timeout or a network error loses that one message and says why. The webhook is never logged.
   */
  private async post(body: SlackPayload, what: string): Promise<SlackResult> {
    await this.space();
    const url = await this.deps.secrets.get(SLACK_SECRET);
    if (!url || !isSlackWebhook(url)) return this.failed('no Slack webhook is kept on this machine', what, false);
    this.lastSent = this.now();
    let res: Response;
    try {
      // Never followed: a redirect would take the message somewhere other than Slack's own webhook (D-078).
      res = await (this.deps.fetch ?? fetch)(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(SLACK_TIMEOUT_MS), redirect: 'error' });
    } catch (e) {
      const err = e as Error;
      const why = err.name === 'TimeoutError' || err.name === 'AbortError' ? `Slack didn't answer within ${SLACK_TIMEOUT_MS / 1000} s` : `couldn't reach Slack: ${scrub(err.message) || err.name}`;
      return this.failed(why, what, false);
    }
    const said = (await res.text().catch(() => '')).trim();
    // Slack answers a refusal with one word, such as channel_is_archived: only such a word is shown.
    const word = /^[a-z_]{1,60}$/.test(said) ? said : `HTTP ${res.status}`;
    if (res.ok) {
      await this.save({ last: { at: this.now(), ok: true, text: 'Sent' }, ...(this.state().paused ? { paused: null } : {}) });
      this.deps.log(`Slack: sent ${what}.`);
      return { ok: true };
    }
    if (res.status === 429) return this.failed('Slack is rate-limiting this webhook (429)', what, false);
    if (res.status >= 400 && res.status < 500) return this.failed(`Slack refused it: ${word}`, what, true);
    return this.failed(`Slack had an error (${word})`, what, false);
  }

  private async failed(why: string, what: string, pause: boolean): Promise<SlackResult> {
    await this.save({ last: { at: this.now(), ok: false, text: why }, ...(pause && this.state().on ? { paused: why } : {}) });
    this.deps.log(`Slack: couldn't send ${what}: ${why}.${pause ? ' Sending is paused until a test goes through, or the webhook is replaced.' : ''}`, true);
    return { ok: false, error: why };
  }

  /** Sends a test message. One that goes through starts sending again after a pause. */
  async test(): Promise<SlackResult> {
    if (this.busy) return { ok: false, error: 'A test is already on its way.' };
    this.busy = true;
    this.deps.changed?.();
    try {
      return await this.post(testMessage(), 'a test message');
    } finally {
      this.busy = false;
      this.deps.changed?.();
    }
  }

  /**
   * Keeps a webhook for this machine, turns sending on from now, and sends a test to show it works. The
   * kinds chosen before stay chosen; the first time, every kind is.
   */
  async connect(url: string): Promise<SlackResult> {
    const u = url.trim();
    if (!isSlackWebhook(u)) return { ok: false, error: 'That isn\'t a Slack incoming webhook. It starts https://hooks.slack.com/services/.' };
    await this.deps.secrets.store(SLACK_SECRET, u);
    await this.save({ on: true, since: this.now(), paused: null, last: null, tail: u.slice(-4) });
    this.deps.log('Slack: a webhook is kept for this machine, and notices go to it from now on.');
    return this.test();
  }

  /** Sends again, from now: nothing from while it was off. */
  async on(): Promise<void> {
    if (!this.state().tail) return;
    await this.save({ on: true, since: this.now() });
  }

  async off(): Promise<void> {
    this.queue.length = 0;
    this.more = 0;
    await this.save({ on: false });
  }

  async setKinds(kinds: SlackKind[]): Promise<void> {
    await this.save({ kinds: SLACK_KINDS.filter((k) => kinds.includes(k)) });
  }

  /** Forgets the webhook: the secret is deleted, and sending stops. */
  async remove(): Promise<void> {
    this.queue.length = 0;
    this.more = 0;
    await this.deps.secrets.delete(SLACK_SECRET);
    await this.save({ on: false, paused: null, last: null, tail: null });
    this.deps.log('Slack: the webhook is removed from this machine.');
  }

  /** Forgets claims older than 30 days, so the folder doesn't grow. */
  prune(): void {
    let names: string[];
    try {
      names = readdirSync(this.dir);
    } catch {
      return;
    }
    const old = this.now() - SLACK_CLAIM_DAYS * 24 * 60 * 60_000;
    for (const n of names) {
      if (!/^[0-9a-f]{64}$/.test(n)) continue;
      try {
        if (statSync(join(this.dir, n)).mtimeMs < old) rmSync(join(this.dir, n), { force: true });
      } catch {
        // gone already
      }
    }
  }
}

// ---------------------------------------------------------------- the card in Environments

export interface SlackCard {
  /** none: no webhook. off: a webhook kept, sending off. on: sending. paused: on, but Slack refused a message. */
  state: 'none' | 'off' | 'on' | 'paused';
  look: { label: string; icon: string; tone: Tone };
  /** When the state's line happened: the refusal that paused it. */
  lookAt: string | null;
  tail: string | null;
  kinds: { key: SlackKind; label: string; icon: string; on: boolean }[];
  /** The last message's result, with when. */
  last: { at: string; look: { label: string; icon: string; tone: Tone } } | null;
  /** A test or a connect is on its way. */
  busy: boolean;
}

/** The card from the state: each state with an icon and words, blue when it's fine, orange when it isn't. */
export function slackCard(s: SlackState, busy = false): SlackCard {
  // Turned off says off, even while paused: turning it back on stays paused until a test goes through.
  const state: SlackCard['state'] = !s.tail ? 'none' : !s.on ? 'off' : s.paused ? 'paused' : 'on';
  const look = {
    none: { label: 'Off: no webhook yet', icon: 'circle-slash', tone: 'neutral' as Tone },
    off: { label: 'Off: turned off on this machine', icon: 'debug-pause', tone: 'neutral' as Tone },
    on: { label: 'On: notices go to Slack', icon: 'pass', tone: 'blue' as Tone },
    paused: { label: `Paused: ${s.paused}`, icon: 'warning', tone: 'orange' as Tone },
  }[state];
  // The refusal that paused it is said once, on the state's own line.
  const refusal = state === 'paused' && s.last && !s.last.ok && s.last.text === s.paused ? new Date(s.last.at).toISOString() : null;
  const last = s.last && s.tail && !refusal
    ? { at: new Date(s.last.at).toISOString(), look: s.last.ok ? { label: 'Last message sent', icon: 'check', tone: 'blue' as Tone } : { label: `Last message didn't go: ${s.last.text}`, icon: 'warning', tone: 'orange' as Tone } }
    : null;
  return { state, look, lookAt: refusal, tail: s.tail, kinds: SLACK_KINDS.map((k) => ({ key: k, label: SLACK_KIND_WORDS[k].label, icon: SLACK_KIND_WORDS[k].icon, on: s.kinds.includes(k) })), last, busy };
}
