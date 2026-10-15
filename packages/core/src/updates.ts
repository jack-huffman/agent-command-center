import { sentence } from './text.ts';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { AccError } from './exec.ts';
import { type Task, writeAtomic } from './ledger.ts';
import { withLock } from './lock.ts';
import type { RepoPaths } from './paths.ts';
import { isTrackerKind, type TrackerKind } from './trackers/types.ts';

/**
 * Ticket updates (D-066): acc never posts on a ticket by itself. When something a client cares about
 * happens (a pull request is ready for review, a change is merged, promoted or deployed, a builder needs
 * the client's answer, or a person chooses to send one of the analysis's questions), acc writes a draft
 * here, one file each. A person reads it, edits it, and posts it as themselves, or discards it.
 */

export const UPDATE_EVENTS = ['pr-opened', 'pr-updated', 'merged', 'promotion-opened', 'promoted', 'deployed', 'blocked', 'question'] as const;
export type UpdateEvent = (typeof UPDATE_EVENTS)[number];

/**
 * The events a Slack task's ticket gets a draft for (D-145): a thread takes fewer, so only the news that a
 * change is merged or deployed, and the client's questions. The other trackers get all of UPDATE_EVENTS.
 */
export const SLACK_UPDATE_EVENTS: readonly UpdateEvent[] = ['merged', 'deployed', 'blocked', 'question'];

export const UPDATE_STATES = ['draft', 'posting', 'posted', 'discarded'] as const;
export type UpdateState = (typeof UPDATE_STATES)[number];

export type UpdateTracker = TrackerKind;

export interface Update {
  v: 1;
  /** The task's id and a number: ACME-12.3. */
  id: string;
  task: string;
  tracker: UpdateTracker;
  /** The ticket as its tracker knows it: #41, ACME-12, AB-7, MON-123. */
  key: string;
  /** The ticket's own page, which names the repo a GitHub issue lives in. */
  url: string | null;
  event: UpdateEvent;
  /** What acc drafted. The text that went out is under posted. */
  text: string;
  state: UpdateState;
  /** The environment's name, for merged, a promotion and deployed. */
  env?: string;
  /** The pull request: the task's own, or the promotion's that takes it on. */
  pr?: { number: number; url: string };
  /** The analysis's question it asks, for question: q1. */
  question?: string;
  createdAt: string;
  /** Who it was drafted by: acc land, acc sync, a builder, a person. */
  by: string;
  /** Claimed for posting, so a second Post can't send it again. */
  posting?: { at: string; by: string };
  posted?: { at: string; by: string; text: string; url?: string };
  discarded?: { at: string; by: string };
  /** Why the last try to post it didn't, kept until it posts. */
  failed?: { at: string; reason: string };
  /** The unposted drafts of the same news it stands in for, newest first, so an edit typed for one carries over. */
  replaces?: string[];
}

/** A post that hasn't been confirmed in this long may have gone out: look at the ticket first (D-051). */
export const STALE_POSTING_MS = 5 * 60_000;

/** The longest text a post takes. */
export const UPDATE_TEXT_MAX = 65_536;

export const UPDATE_ID = /^[A-Z][A-Z0-9_]*-\d+\.\d{1,6}$/;

/** How many replaced drafts a draft remembers. */
export const REPLACES_MAX = 20;

type UpdatePaths = Pick<RepoPaths, 'updates'>;

const updateFile = (paths: UpdatePaths, id: string): string => join(paths.updates, `${id}.json`);

/** What each event is, in a few words, for a list or a heading. */
export const EVENT_WORDS: Record<UpdateEvent, string> = {
  'pr-opened': 'ready for review',
  'pr-updated': 'updated for review',
  merged: 'merged',
  'promotion-opened': 'promotion opened',
  promoted: 'promoted',
  deployed: 'deployed',
  blocked: 'a question for the client',
  question: 'a question from its analysis',
};

/** Whether a task's ticket can take updates: one from a tracker, with a key. A task acc alone keeps can't. */
export function ticketOf(task: Pick<Task, 'source'>): { tracker: UpdateTracker; key: string; url: string | null } | null {
  const { kind, key, url } = task.source;
  if (!isTrackerKind(kind) || !key) return null;
  return { tracker: kind, key, url };
}

/** A GitHub issue's repo and number: from its link when it has one, otherwise the project's repo. */
export function githubIssue(u: Pick<Update, 'key' | 'url'>, repo: string | null): { repo: string; number: string } | null {
  const m = u.url ? /github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)/.exec(u.url) : null;
  if (m) return { repo: m[1]!, number: m[2]! };
  const n = /(\d+)$/.exec(u.key)?.[1];
  return n && repo ? { repo, number: n } : null;
}


export interface UpdateContext {
  /** The pull request, for pr-opened, pr-updated and promotion-opened. */
  pr?: { url: string };
  /** One plain sentence for the client: the review's client sentence, or the task's title. */
  summary?: string;
  /** The environment's name, for merged, a promotion and deployed. */
  env?: string;
  /** What the client is asked, for blocked and question. */
  question?: string;
}

/**
 * What each update says, for the client: short, plain, and with no word of how acc builds it (no agent,
 * worktree, acc, builder, reviewer or rework). The person posting it can change every word.
 */
export function updateText(event: UpdateEvent, c: UpdateContext): string {
  const summary = c.summary?.trim() ? `\n${sentence(c.summary)}` : '';
  switch (event) {
    case 'pr-opened': return `The change is ready for review: ${c.pr?.url ?? ''}${summary}`;
    case 'pr-updated': return `The change was updated and is ready for review again: ${c.pr?.url ?? ''}${summary}`;
    case 'merged': return `The change was approved and merged into ${c.env ?? 'its environment'}.`;
    case 'promotion-opened': return `The change is ready to go to ${c.env ?? 'its next environment'}: ${c.pr?.url ?? ''}`;
    case 'promoted': return `The change is now in ${c.env ?? 'its next environment'}.`;
    case 'deployed': return `The change is now deployed to ${c.env ?? 'its environment'}.`;
    case 'blocked': return `We need your input before we can go on:\n${sentence(c.question ?? '')}`;
    case 'question': return `Before we start, a question for you:\n${sentence(c.question ?? '')}`;
  }
}

// ---------------------------------------------------------------- reading

export function readUpdate(paths: UpdatePaths, id: string): Update | null {
  if (!UPDATE_ID.test(id)) return null;
  try {
    const u = JSON.parse(readFileSync(updateFile(paths, id), 'utf8')) as Update;
    return u.v === 1 && u.id === id ? u : null;
  } catch {
    return null;
  }
}

/** Every update kept, oldest first. A file being written, or one this version can't read, is left out. */
export function listUpdates(paths: UpdatePaths): Update[] {
  let names: string[];
  try {
    names = readdirSync(paths.updates);
  } catch {
    return [];
  }
  const out = names.filter((n) => n.endsWith('.json')).map((n) => readUpdate(paths, n.slice(0, -5))).filter((u): u is Update => !!u);
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/** Still waiting on a person: a draft, or one claimed for posting that hasn't been confirmed. */
export const isOpenUpdate = (u: Pick<Update, 'state'>): boolean => u.state === 'draft' || u.state === 'posting';

/** A claim to post that's been unconfirmed so long it may have posted, or failed without saying (D-051). */
export const stalePosting = (u: Pick<Update, 'state' | 'posting'>, now: Date): boolean =>
  u.state === 'posting' && !!u.posting && now.getTime() - Date.parse(u.posting.at) > STALE_POSTING_MS;

// ---------------------------------------------------------------- writing

function writeUpdate(paths: UpdatePaths, u: Update): void {
  const file = updateFile(paths, u.id);
  writeAtomic(file, JSON.stringify(u, null, 2) + '\n');
}

/** Every change holds the store's lock, beside the folder, so two windows or a CLI never race. */
function locked<T>(paths: UpdatePaths, fn: () => T): T {
  mkdirSync(paths.updates, { recursive: true });
  return withLock(`${paths.updates}.lock`, fn);
}

/** What makes two drafts the same news: the task, the event (a pull request's two are one), and its environment or question. */
const sameNews = (a: Pick<Update, 'task' | 'event' | 'env' | 'question'>, b: Pick<Update, 'task' | 'event' | 'env' | 'question'>): boolean => {
  const family = (e: UpdateEvent) => (e === 'pr-opened' || e === 'pr-updated' ? 'pr' : e);
  return a.task === b.task && family(a.event) === family(b.event) && (a.env ?? '') === (b.env ?? '') && (a.question ?? '') === (b.question ?? '');
};

/**
 * How far a change has gone (D-071): its pull request, then its merge into its environment or a
 * promotion opened to take it on, then that promotion's merge, then its deploy (D-075).
 */
const STAGE: Partial<Record<UpdateEvent, number>> = { 'pr-opened': 0, 'pr-updated': 0, merged: 1, 'promotion-opened': 1, promoted: 2, deployed: 3 };

/**
 * Whether news overtakes an older draft of the task's, so the client isn't told a change is ready for
 * review once it's merged (D-071). A merge or a promotion overtakes the pull request's draft; a promotion's
 * merge overtakes its opening; a deploy overtakes those and the merge into the same environment. A deploy
 * to QA doesn't overtake a merge into Dev, nor a promotion into UAT a merge into Dev.
 */
const overtakes = (next: Pick<Update, 'task' | 'event' | 'env'>, old: Pick<Update, 'task' | 'event' | 'env'>): boolean => {
  const n = STAGE[next.event];
  const o = STAGE[old.event];
  if (next.task !== old.task || n === undefined || o === undefined || n <= o) return false;
  return o === 0 || (old.env ?? '') === (next.env ?? '');
};

export interface DraftInput {
  event: UpdateEvent;
  env?: string;
  pr?: { number: number; url: string };
  question?: string;
  /** What it says. Without it, the event's own wording from what's given. */
  text?: string;
  context?: UpdateContext;
}

/**
 * Drafts an update for a task's ticket. It only writes a file: nothing is posted. A task with no tracker
 * key gets none (null), and a Slack task gets one only for SLACK_UPDATE_EVENTS. The same news drafted again before anyone posted it replaces the draft: a pull
 * request updated three times is one draft, with the latest link. A pull request whose opened draft
 * still waits keeps saying it's ready for review, rather than updated. Later news replaces an unposted
 * draft it overtakes (D-071): merged stands in for ready for review. The new draft names the ones it
 * replaced (`replaces`), so an edit typed for an old one isn't lost.
 */
export function draftUpdate(paths: UpdatePaths, task: Pick<Task, 'id' | 'source'>, input: DraftInput, by: string, now: () => Date): Update | null {
  const ticket = ticketOf(task);
  if (!ticket) return null;
  if (ticket.tracker === 'slack' && !SLACK_UPDATE_EVENTS.includes(input.event)) return null;
  return locked(paths, () => {
    const all = listUpdates(paths);
    const mine = all.filter((u) => u.task === task.id);
    const replaced = mine.find((u) => u.state === 'draft' && sameNews(u, { task: task.id, ...input }));
    const overtaken = mine.filter((u) => u.state === 'draft' && u !== replaced && overtakes({ task: task.id, ...input }, u));
    const gone = [...(replaced ? [replaced] : []), ...overtaken];
    const event: UpdateEvent = input.event === 'pr-updated' && replaced?.event === 'pr-opened' ? 'pr-opened' : input.event;
    const text = event === input.event && input.text !== undefined ? input.text : updateText(event, { ...input.context, ...(input.pr ? { pr: input.pr } : {}), ...(input.env ? { env: input.env } : {}) });
    const n = Math.max(0, ...mine.map((u) => Number(u.id.slice(task.id.length + 1)) || 0)) + 1;
    const u: Update = {
      v: 1, id: `${task.id}.${n}`, task: task.id, tracker: ticket.tracker, key: ticket.key, url: ticket.url, event, text, state: 'draft',
      ...(input.env ? { env: input.env } : {}), ...(input.pr ? { pr: { number: input.pr.number, url: input.pr.url } } : {}), ...(input.question ? { question: input.question } : {}),
      createdAt: now().toISOString(), by,
      ...(gone.length ? { replaces: gone.flatMap((r) => [r.id, ...(r.replaces ?? [])]).slice(0, REPLACES_MAX) } : {}),
    };
    writeUpdate(paths, u);
    // The new draft stands in their place; they were never posted, so nothing is lost.
    for (const r of gone) rmSync(updateFile(paths, r.id), { force: true });
    return u;
  });
}

/** Changes one update under the lock, after `check` says it may. */
function change(paths: UpdatePaths, id: string, check: (u: Update) => string | null, apply: (u: Update) => Update): Update {
  return locked(paths, () => {
    const u = readUpdate(paths, id);
    if (!u) throw new AccError('no-update', `No update ${id}. acc updates lists them.`);
    const why = check(u);
    if (why) throw new AccError('refused', why);
    const next = apply(u);
    writeUpdate(paths, next);
    return next;
  });
}

const stateWords = (u: Update): string => (u.state === 'posted' ? `was posted${u.posted ? ` by ${u.posted.by.replace(/^human:/, '')}` : ''}` : u.state === 'discarded' ? 'was discarded' : 'is being posted');

/**
 * Claims a draft for posting, so a second window's Post, or a crash between the post and its record,
 * can't send it twice. With `again`, a claim that has gone unconfirmed for five minutes is taken over:
 * a person looked at the ticket and says it didn't post.
 */
export function claimUpdate(paths: UpdatePaths, id: string, by: string, now: () => Date, opts: { again?: boolean } = {}): Update {
  return change(paths, id, (u) => {
    if (u.state === 'draft') return null;
    if (u.state === 'posting' && opts.again && stalePosting(u, now())) return null;
    if (u.state === 'posting' && stalePosting(u, now())) return `${id} may have posted already: it was being posted at ${u.posting!.at} and never confirmed. Look at ${u.key} first. If it isn't there, post it again with --again.`;
    return `${id} ${stateWords(u)}.`;
  }, (u) => ({ ...u, state: 'posting', posting: { at: now().toISOString(), by } }));
}

/** Records a claimed update as posted, with the text that went out, who sent it, and when. */
export function markPosted(paths: UpdatePaths, id: string, posted: { by: string; text: string; url?: string }, now: () => Date): Update {
  return change(paths, id, (u) => (u.state === 'posting' ? null : `${id} ${u.state === 'draft' ? 'wasn\'t claimed for posting' : stateWords(u)}.`), (u) => {
    const { failed: _failed, ...rest } = u;
    return { ...rest, state: 'posted', posted: { at: now().toISOString(), by: posted.by, text: posted.text, ...(posted.url ? { url: posted.url } : {}) } };
  });
}

/** Puts a claimed update back to draft, when its post failed, keeping why. */
export function releaseUpdate(paths: UpdatePaths, id: string, reason: string, now: () => Date): Update {
  return change(paths, id, (u) => (u.state === 'posting' ? null : `${id} ${u.state === 'draft' ? 'is a draft already' : stateWords(u)}.`), (u) => {
    const { posting: _posting, ...rest } = u;
    return { ...rest, state: 'draft', failed: { at: now().toISOString(), reason: reason.trim() || 'it didn\'t say why' } };
  });
}

/** Sets a draft aside: it's kept, marked discarded, and never posted. One stuck posting can be too. */
export function discardUpdate(paths: UpdatePaths, id: string, by: string, now: () => Date): Update {
  return change(paths, id, (u) => (u.state === 'draft' || stalePosting(u, now()) ? null : `${id} ${stateWords(u)}.`), (u) => {
    const { posting: _posting, ...rest } = u;
    return { ...rest, state: 'discarded', discarded: { at: now().toISOString(), by } };
  });
}
