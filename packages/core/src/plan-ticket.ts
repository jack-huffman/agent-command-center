/**
 * The whole ticket a plan reads (T-110): its description, every comment oldest first with its author and date,
 * its related tickets with their state, its attachments' names, and its changes field (T-105) where the
 * tracker names one. The Command Center holds the tracker's sign-in, so it reads the ticket and hands it to
 * `acc analyze --ticket <file>`, as drafted acceptance criteria does (T-81). A task with no tracker, or a read
 * that failed, gives the plan the description only, and the plan says why. The plan keeps what it read
 * (`PlanRead`), so the ticket page can say when the ticket has comments the plan never saw.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileId } from './analyze.ts';
import { writeAtomic } from './atomic.ts';
import { clipText, CRITERIA_TEXT_MAX } from './criteria.ts';
import { AccError } from './exec.ts';
import type { Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { isObj, plural } from './text.ts';
import { type Doc, toMarkdown } from './trackers/doc.ts';
import type { Ticket } from './trackers/types.ts';
import { ticketOf } from './updates.ts';

export interface PlanComment {
  author: string;
  created: string;
  markdown: string;
}

/** The ticket as the planning agent reads it. */
export interface PlanTicket {
  key: string;
  title: string;
  url: string | null;
  markdown: string;
  /** Oldest first, each whole. Where they are too long together, the newest are kept (`fitComments`). */
  comments: PlanComment[];
  related: { key: string; title: string; relation: string; state: string | null }[];
  /** The names of the files on the ticket and its comments. Their contents are not read. */
  attachments: string[];
  /** The ticket's changes field (T-105), with its name, where the tracker names one. */
  changes: { name: string; markdown: string } | null;
  /** The oldest comments left out to fit. */
  omitted: number;
  /** false: the description only. `why` says why the comments weren't read. */
  full: boolean;
  why: string | null;
}

/** What a plan read of its ticket (T-110), kept with the plan, so its page can say what it read and what's new since. */
export interface PlanRead {
  full: boolean;
  why: string | null;
  comments: number;
  omitted: number;
  /** The newest comment it read. Null when it read none. */
  newest: { author: string; created: string } | null;
  related: number;
  attachments: number;
  /** The changes field's name, where it read one. */
  changes: string | null;
}

/** The most characters of comments a plan reads, each comment whole: the newest win. */
export const PLAN_COMMENTS_MAX = 60_000;

/** Why a plan read only the description, in plain words. */
export const NO_TRACKER = 'This task isn\'t from a tracker, so it has no comments.';
export const NOT_HANDED = 'The ticket wasn\'t read from its tracker for this plan.';

const time = (s: string): number => {
  const n = Date.parse(s);
  return Number.isNaN(n) ? 0 : n;
};

/**
 * Comments oldest first, each kept whole while they fit in `max` characters together, counted from the newest.
 * The newest is always kept: cut to `max` when it alone is longer. The rest that don't fit are left out.
 */
export function fitComments(all: PlanComment[], max = PLAN_COMMENTS_MAX): { comments: PlanComment[]; omitted: number } {
  const sorted = all.map((c, i) => ({ c, i })).sort((a, b) => time(a.c.created) - time(b.c.created) || a.i - b.i).map((x) => x.c);
  const kept: PlanComment[] = [];
  let used = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const c = sorted[i]!;
    if (!kept.length && c.markdown.length > max) {
      kept.push({ ...c, markdown: clipText(c.markdown, max) });
      used = max;
      continue;
    }
    if (used + c.markdown.length > max) break;
    kept.push(c);
    used += c.markdown.length;
  }
  return { comments: kept.reverse(), omitted: sorted.length - kept.length };
}

/** The names of the attachments in a document, in the order met. */
export function attachmentNames(docs: Doc[]): string[] {
  const names: string[] = [];
  const walk = (blocks: Doc['blocks']): void => {
    for (const b of blocks) {
      if (b.t === 'media') names.push(b.label);
      else if (b.t === 'quote') walk(b.c);
      else if (b.t === 'list') for (const item of b.items) walk(item.c);
    }
  };
  for (const d of docs) walk(d.blocks);
  return [...new Set(names)];
}

type TicketRead = Pick<Ticket, 'key' | 'title' | 'url' | 'markdown' | 'body' | 'comments' | 'related'>;

/** A tracker's ticket as the plan reads it, with its changes field where one is named. */
export function planTicket(t: TicketRead, changes: { name: string; markdown: string } | null = null): PlanTicket {
  const fit = fitComments(t.comments.map((c) => ({ author: c.author.name, created: c.created, markdown: toMarkdown(c.body) })));
  return {
    key: t.key, title: t.title, url: t.url, markdown: clipText(t.markdown, CRITERIA_TEXT_MAX), ...fit,
    related: t.related.map((r) => ({ key: r.key, title: r.title, relation: r.relation, state: r.status?.name ?? null })),
    attachments: attachmentNames([t.body, ...t.comments.map((c) => c.body)]),
    changes: changes && changes.markdown.trim() ? { name: changes.name, markdown: clipText(changes.markdown, CRITERIA_TEXT_MAX) } : null,
    full: true, why: null,
  };
}

/** The ticket as acc keeps it for the task, when its comments weren't read: its description only, and why. */
export function descriptionOnly(task: Pick<Task, 'id' | 'title' | 'brief' | 'source'>, why: string): PlanTicket {
  return {
    key: task.source.key ?? task.id, title: task.title, url: task.source.url, markdown: clipText(task.brief, CRITERIA_TEXT_MAX),
    comments: [], related: [], attachments: [], changes: null, omitted: 0, full: false, why,
  };
}

/**
 * A ticket from a file (`--ticket`), as the Command Center writes it: the whole ticket, or `{ "key", "unread" }`
 * when it couldn't read it, with why. Anything else says what is wrong.
 */
export function parsePlanTicket(text: string, task: Pick<Task, 'id' | 'title' | 'brief' | 'source'>): PlanTicket {
  let x: unknown;
  try {
    x = JSON.parse(text);
  } catch {
    throw new AccError('usage', 'The ticket file isn\'t JSON.');
  }
  const str = (v: unknown): v is string => typeof v === 'string';
  if (!isObj(x) || !str(x.key)) throw new AccError('usage', 'The ticket file needs a key.');
  if (x.key.toUpperCase() !== (task.source.key ?? task.id).toUpperCase()) throw new AccError('usage', `The ticket file is for ${x.key}, not ${task.source.key ?? task.id}.`);
  if (str(x.unread)) return descriptionOnly(task, x.unread.trim() || NOT_HANDED);
  if (!str(x.title) || !str(x.markdown) || !Array.isArray(x.comments) || !Array.isArray(x.related)) {
    throw new AccError('usage', 'The ticket file needs a key, a title, a markdown description, comments and related tickets, or why it wasn\'t read.');
  }
  const comments: PlanComment[] = x.comments.filter((c) => isObj(c) && str(c.markdown)).map((c: any) => ({ author: str(c.author) ? c.author : 'Someone', created: str(c.created) ? c.created : '', markdown: c.markdown }));
  const fit = fitComments(comments);
  const changes = isObj(x.changes) && str(x.changes.name) && str(x.changes.markdown) && x.changes.markdown.trim() ? { name: x.changes.name, markdown: clipText(x.changes.markdown, CRITERIA_TEXT_MAX) } : null;
  return {
    key: x.key, title: x.title, url: str(x.url) ? x.url : null, markdown: clipText(x.markdown, CRITERIA_TEXT_MAX),
    comments: fit.comments, omitted: fit.omitted + (typeof x.omitted === 'number' && x.omitted > 0 ? Math.floor(x.omitted) : 0),
    related: x.related.filter((r) => isObj(r) && str(r.key)).map((r: any) => ({ key: r.key, title: str(r.title) ? r.title : '', relation: str(r.relation) ? r.relation : 'related', state: str(r.state) ? r.state : null })),
    attachments: Array.isArray(x.attachments) ? x.attachments.filter(str) : [],
    changes, full: true, why: null,
  };
}

/** What the plan read when the file gives no ticket: the description, and why. */
export function ticketWithout(task: Pick<Task, 'id' | 'title' | 'brief' | 'source'>): PlanTicket {
  return descriptionOnly(task, ticketOf(task) ? NOT_HANDED : NO_TRACKER);
}

/** What a plan keeps of what it read. */
export function planRead(t: PlanTicket): PlanRead {
  const newest = t.comments.at(-1);
  return {
    full: t.full, why: t.why, comments: t.comments.length, omitted: t.omitted, newest: newest ? { author: newest.author, created: newest.created } : null,
    related: t.related.length, attachments: t.attachments.length, changes: t.changes?.name ?? null,
  };
}

/** A comment's date as the prompt and the page give it: its day, or what the tracker said when that isn't a date. */
export const commentDay = (created: string): string => (/^\d{4}-\d{2}-\d{2}/.test(created) ? created.slice(0, 10) : created);

/** How the planning agent reads a ticket and its comments: as a consultant would. */
export const PLAN_TICKET_PROMPT = [
  '- Read the description, then each comment, oldest first, and each related ticket. A later decision in a comment overrides the description.',
  '- Where a finding or a choice rests on a comment, name the comment by its author and date, such as "Kelsey, 2026-10-20".',
  '- Where two comments disagree, or a comment changes what the description asks, do not choose. Ask a question of the person who runs the build, or of the ticket\'s author where only the author knows (askOf: author).',
].join('\n');

/** The ticket's parts for the prompt: its description, its comments oldest first, its related tickets, attachments and changes field. */
export function ticketLines(t: PlanTicket): string[] {
  return [
    '## The ticket',
    '',
    t.markdown.trim() || '_Only the title was given._',
    '',
    '## The ticket\'s comments, oldest first',
    '',
    ...(!t.full ? [`_The comments were not read: ${t.why ?? NOT_HANDED} Make the plan from the description, and say so in the summary._`, '']
      : [
        ...(t.omitted ? [`_The ${plural(t.omitted, 'oldest comment')} ${t.omitted === 1 ? 'was' : 'were'} left out to fit. Say so where it matters._`, ''] : []),
        ...(t.comments.length ? t.comments.flatMap((c) => [`### ${c.author}${c.created ? `, ${commentDay(c.created)}` : ''}`, '', c.markdown.trim() || '_empty_', '']) : ['_No comments._', '']),
      ]),
    '## Related tickets',
    '',
    ...(!t.full ? ['_The related tickets were not read._'] : t.related.length ? t.related.map((r) => `- ${r.relation}: ${r.key}${r.title ? ` ${r.title}` : ''}${r.state ? ` (${r.state})` : ''}`) : ['_None._']),
    '',
    ...(t.attachments.length ? ['## Attachments', '', 'Their names only. Their contents were not read.', '', ...t.attachments.map((a) => `- ${a}`), ''] : []),
    ...(t.changes ? [`## The ticket's ${t.changes.name}`, '', 'The field the team keeps for what this ticket changes.', '', t.changes.markdown.trim(), ''] : []),
  ];
}

/** What a plan read, in a sentence a person reads: the comments it read, the newest, and what it left out. */
export function readWords(r: PlanRead | undefined): string | null {
  if (!r) return null;
  if (!r.full) return `This plan read the description only: ${r.why ?? NOT_HANDED}`;
  const parts = [r.comments ? `its ${plural(r.comments, 'comment')}` : 'no comments (it had none)', ...(r.related ? [plural(r.related, 'related ticket')] : []), ...(r.changes ? [`its ${r.changes}`] : [])];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return [
    `This plan read the ticket, ${list}.`,
    r.newest ? `The newest comment it read is ${r.newest.author}'s, ${commentDay(r.newest.created)}.` : '',
    r.omitted ? `It left out the ${plural(r.omitted, 'oldest comment')} to fit.` : '',
  ].filter(Boolean).join(' ');
}

/**
 * The ticket's comments a plan didn't read (T-110): those newer than the newest it read, or all of them where it
 * read none. Zero for a plan made before plans kept what they read.
 */
export function unreadComments(r: PlanRead | undefined, comments: { created: string }[]): number {
  if (!r) return 0;
  if (!r.newest) return comments.length;
  const newest = time(r.newest.created);
  return comments.filter((c) => time(c.created) > newest).length;
}

export const planTicketPath = (paths: Pick<RepoPaths, 'analyses'>, task: string): string => join(paths.analyses, `${fileId(task)}.ticket.json`);

/** Keeps the ticket beside the plan, so a talk about the plan in Claude Code reads the same comments (D-195). */
export function writePlanTicket(paths: Pick<RepoPaths, 'analyses'>, task: string, t: PlanTicket): void {
  mkdirSync(paths.analyses, { recursive: true });
  writeAtomic(planTicketPath(paths, task), JSON.stringify(t, null, 2) + '\n');
}

/** The ticket the task's plan read, or null when it kept none. */
export function readPlanTicket(paths: Pick<RepoPaths, 'analyses'>, task: string): PlanTicket | null {
  try {
    const t = JSON.parse(readFileSync(planTicketPath(paths, task), 'utf8')) as PlanTicket;
    return typeof t.key === 'string' && Array.isArray(t.comments) ? t : null;
  } catch {
    return null;
  }
}
