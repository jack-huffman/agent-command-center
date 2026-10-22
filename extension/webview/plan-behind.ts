// What a plan read of its ticket (T-110), in the plan section: "2 new comments since this plan" with Make a new
// plan when the ticket has moved on, and the plan's own words for the comments it read. The plan section's short
// summary (T-109) draws it under the plan's version and approval.
import type { TicketAnalysis } from '../src/model/task-page.ts';
import { actionButton, el, icon, status } from './dom.ts';

/** The plan's line on its ticket, or null for a plan that kept nothing of what it read. */
export function planTicketLine(a: TicketAnalysis): HTMLElement | null {
  const r = a.ticketRead;
  if (!r || (!r.read && !r.behind)) return null;
  return el('div', 'plan-ticket',
    r.behind ? el('div', 'plan-behind', status(r.behind.look), actionButton(r.behind.action)) : null,
    r.read ? el('p', 'muted small plan-read', icon('comment'), el('span', '', r.read)) : null);
}
