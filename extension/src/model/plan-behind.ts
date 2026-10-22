/**
 * What a plan read of its ticket, on the task's page (T-110): the plan's own words for the comments it read, and,
 * when the ticket has comments the plan never saw, "2 new comments since this plan" with Make a new plan. Its
 * own module, so the plan section's short summary (T-109) can show the line wherever it sits.
 */
import type { Analysis } from '../../../packages/core/src/analyze.ts';
import { readWords, unreadComments } from '../../../packages/core/src/plan-ticket.ts';
import { plural } from '../../../packages/core/src/text.ts';
import type { TaskRow } from '../logic/shared.ts';
import type { Action, Look, Ref } from './shared.ts';

/** A plan behind its ticket: how many comments it didn't read, in words, and Make a new plan. */
export interface PlanBehind {
  look: Look;
  action: Action;
}

/** What the plan section shows of the ticket it read. */
export interface PlanTicketRead {
  /** The plan's own words for what it read: its comments, the newest, what it left out. Null for an older plan. */
  read: string | null;
  /** Null when the plan has read every comment, the ticket isn't read yet, or a new plan can't be made now. */
  behind: PlanBehind | null;
}

/**
 * Whether a task's plan is behind its ticket (T-110): comments newer than the newest it read, or, where its read
 * failed, every comment. Only where Make a new plan can run: before the build, and not while a plan is being made.
 */
export function planBehind(row: Pick<TaskRow, 'state' | 'analyzing'>, a: Analysis | null, comments: { created: string }[] | null, ref: Ref): PlanBehind | null {
  if (!a?.ticket || !comments || row.analyzing || row.state === 'running' || row.state === 'done') return null;
  const n = unreadComments(a.ticket, comments);
  if (!n) return null;
  const label = a.ticket.full ? `${plural(n, 'new comment')} since this plan` : `${plural(n, 'comment')} this plan didn't read`;
  return { look: { label, icon: 'comment-discussion', tone: 'orange' }, action: { command: 'acc.task.analyze', label: 'Make a new plan', icon: 'refresh', ref, primary: true } };
}

/** The plan section's line on the ticket it read: its words, and whether it's behind. */
export function planTicketRead(row: Pick<TaskRow, 'state' | 'analyzing'>, a: Analysis | null, comments: { created: string }[] | null, ref: Ref): PlanTicketRead {
  return { read: readWords(a?.ticket), behind: planBehind(row, a, comments, ref) };
}

/** The plan section with what it read: where the plan is behind, its Make a new plan moves onto that line. */
export function withTicketRead<T extends { actions: Action[] }>(an: T | null, r: PlanTicketRead): (T & { ticketRead: PlanTicketRead }) | null {
  if (!an) return null;
  return { ...an, ticketRead: r, actions: r.behind ? an.actions.filter((x) => x.command !== r.behind!.action.command) : an.actions };
}
