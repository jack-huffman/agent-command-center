/**
 * ACME-19's page for the Review tab (T-135): its review as it is (sent work back, so the tab needs the person),
 * with only the worth-a-look findings (counted, nothing waiting), and passed with none.
 */
import { REVIEW_LOOK, type TicketModel } from '../../src/model/task-page.ts';
import { plural } from '../../../packages/core/src/text.ts';
import { sampleTicket } from './task-page.ts';

export type ReviewTabSample = 'needs' | 'findings' | 'passed';

export function sampleReviewTabTicket(now: number, which: ReviewTabSample): TicketModel {
  const m = sampleTicket(now, 'ACME-19');
  const r = m.review;
  if (!r || which === 'needs') return m;
  if (which === 'passed') {
    return { ...m, review: { ...r, look: REVIEW_LOOK.pass, summary: 'Marks each contact when its welcome email is sent, so a second run skips it. The tests cover a contact welcomed before this change.', count: 'No findings', findings: [] } };
  }
  const worth = r.findings.filter((f) => f.look === REVIEW_LOOK.worth);
  return { ...m, review: { ...r, look: REVIEW_LOOK.worth, summary: 'Marks each contact when its welcome email is sent. Two small things to look at; nothing blocks it.', count: `${plural(worth.length, 'finding')}, 0 must fix`, findings: worth } };
}
