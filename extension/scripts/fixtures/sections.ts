/**
 * ACME-21's page with a plan, drafted acceptance criteria and Verify the developer's work (T-132): the
 * Command Center's sections under its description, open, or collapsed as the tab remembers them.
 */
import type { TicketModel } from '../../src/model/task-page.ts';
import { sampleTicket } from './task-page.ts';
import { ROOT } from './shared.ts';

export function sampleSectionsTicket(now: number): TicketModel {
  const m = sampleTicket(now, 'ACME-21', false, null, 'pass');
  const drafted = sampleTicket(now, 'ACME-19', true, 'drafted').criteria;
  return { ...m, criteria: drafted ? { ...drafted, task: 'ACME-21' } : null };
}

/** The tab's memory with ACME-21's plan, criteria and Verify collapsed, and the side column's Details and Agent panels. */
export const SECTIONS_COLLAPSED = ['plan', 'criteria', 'verify', 'details', 'agent'].map((id) => `section:${id}:${ROOT}#ACME-21`);
