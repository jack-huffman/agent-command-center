/**
 * A task's team on its page (T-103): while it's in flight, whether its branch took in the latest merges into
 * its environment's branch ("Up to date with dev", or "2 merges behind dev"), and the other tasks in flight it
 * shares files with now, each with those files. Plain data: no vscode import, so it's testable.
 */

import { IN_FLIGHT_STATES, taskList } from '../../../packages/core/src/overlap.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import { behindWords, MATE_STATE, type Team } from '../../../packages/core/src/team.ts';
import type { Look } from './shared.ts';

/** Up to date in blue, behind in orange, and a task that shares files in orange: each with its icon and words. */
export const TEAM_LOOK: Record<'current' | 'behind' | 'shares', Look> = {
  current: { label: 'Up to date', icon: 'pass', tone: 'blue' },
  behind: { label: 'Behind', icon: 'git-merge', tone: 'orange' },
  shares: { label: 'Shares files', icon: 'files', tone: 'orange' },
};

/** Another task in flight that shares files with this one. */
export interface TeamShare {
  id: string;
  title: string;
  /** Its state in a teammate's words: being built, in review, sent back, blocked. */
  state: string;
  files: string[];
}

/** A merge its branch doesn't hold yet: its task, or the commit's subject for a change acc can't match. */
export interface TeamMerge {
  name: string;
  sha: string;
}

export interface TicketTeam {
  task: string;
  /** "Up to date with dev" or "2 merges behind dev", with its look. */
  behind: Look;
  merges: TeamMerge[];
  shares: TeamShare[];
  /** How many other tasks are in flight, sharing or not. */
  others: number;
  /** "Shares files with T-97 and T-98" with its look, or a muted line that it shares none. */
  sharing: { label: string; look: Look | null };
}

/** The section for a task in flight, or null: a task not in flight, or a team git couldn't read. */
export function ticketTeam(task: Pick<Task, 'state'>, team: Team | null): TicketTeam | null {
  if (!team || !IN_FLIGHT_STATES.includes(task.state)) return null;
  const behind = { ...TEAM_LOOK[team.landed.length ? 'behind' : 'current'], label: behindWords(team) };
  const shares = team.mates.filter((m) => m.shares.length).map((m) => ({ id: m.id, title: m.title, state: MATE_STATE[m.state] ?? m.state, files: m.shares }));
  const label = sharesLine({ shares, others: team.mates.length });
  return {
    task: team.task, behind,
    merges: team.landed.map((l) => ({ name: l.task ? `${l.task}${l.title ? `: ${l.title}` : ''}` : l.subject, sha: l.sha.slice(0, 7) })),
    shares, others: team.mates.length,
    sharing: { label, look: shares.length ? { ...TEAM_LOOK.shares, label } : null },
  };
}

/** "Shares files with T-97 and T-98", or that it shares none, with how many others are in flight. */
export function sharesLine(t: Pick<TicketTeam, 'shares' | 'others'>): string {
  if (t.shares.length) return `Shares files with ${taskList(t.shares.map((s) => s.id))}`;
  if (!t.others) return 'No other task is in flight';
  return `Shares no files with the ${t.others === 1 ? 'other task' : `${t.others} other tasks`} in flight`;
}
