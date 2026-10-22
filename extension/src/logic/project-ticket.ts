/**
 * A project's ticket, read through its tracker's own sign-in: what drafting acceptance criteria (T-81) and Make
 * a plan (T-110) both read. A key that none of the project's trackers holds is refused in words.
 * Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */
import type { Hub, Project } from '../hub.ts';
import type { Trackers } from '../trackers.ts';

/** What reading a ticket needs of the hub and the trackers. */
export type TicketReaders = { hub: Pick<Hub, 'project'>; trackers: Pick<Trackers, 'trackerFor'> };

/** The project at `root` and the index of the tracker that holds `key`; throws for a key none of them holds. */
export function projectTracker({ hub, trackers }: TicketReaders, root: string, key: string): { p: Project; index: number } {
  const p = hub.project(root);
  const index = p ? trackers.trackerFor(p, key) : null;
  if (!p || index === null) throw new Error(`${key} isn't one of the project's tickets.`);
  return { p, index };
}

/** The ticket `key` from the project's tracker, with its comments and related tickets. */
export async function readProjectTicket(hub: Pick<Hub, 'project'>, trackers: Pick<Trackers, 'trackerFor' | 'ticket'>, root: string, key: string): ReturnType<Trackers['ticket']> {
  const { p, index } = projectTracker({ hub, trackers }, root, key);
  return trackers.ticket(p, index, key);
}
