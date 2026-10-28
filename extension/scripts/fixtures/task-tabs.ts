/**
 * Task pages for the tabs (T-134): ACME-21 with all four tabs, Ticket, Plan, Changes and Verify; and ACME-21
 * whose plan waits for the person's approval again, which opens on Plan.
 */
import type { TicketModel } from '../../src/model/task-page.ts';
import { sampleChangesTicket } from './changes.ts';
import { sampleSectionsTicket } from './sections.ts';
import { sampleTicket } from './task-page.ts';

/** ACME-21's plan, criteria and Verify (T-132), with Planned changes and Changes too: every tab shows. */
export function sampleTabsTicket(now: number): TicketModel {
  const m = sampleSectionsTicket(now);
  const changes = sampleChangesTicket(now, 'changes').changes;
  return { ...m, changes: changes ? { ...changes, task: 'ACME-21' } : null };
}

/** ACME-21's plan v3, new since v2 was approved, with a choice to make: it needs the person's approval again. */
export const samplePlanNeedsYouTicket = (now: number): TicketModel => sampleTicket(now, 'ACME-21', false, null, null, 'changed');
