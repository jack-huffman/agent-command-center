// A task page's tabs (T-134, T-135): Ticket, Plan & build (T-168), Changes, Testing (T-161), Review and Verify, each shown only with something in it, with a
// count where it helps and, where something in it needs the person, the words that say so. Which tab a page
// opens on is decided here too, apart from the drawing (task-tabs.ts). The page imports only types from outside
// its folder (D-121), so these rules live here; what a link may name is the model's (src/model/task-tabs.ts).

import type { Look } from '../src/model/shared.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { plural } from './dom.ts';

export type TabId = 'ticket' | 'plan' | 'changes' | 'testing' | 'review' | 'verify';

/** The tabs in the order the page draws them. */
export const TAB_ORDER: readonly TabId[] = ['ticket', 'plan', 'changes', 'testing', 'review', 'verify'];

/**
 * Each tab's name (T-168): words only, with no icon, so the row reads at a glance. Plan is "Plan & build", where
 * the person makes the plan and starts the build; its id stays `plan`, so links that name the part still open it.
 */
export const TAB_LOOK: Record<TabId, { name: string }> = {
  ticket: { name: 'Ticket' },
  plan: { name: 'Plan & build' },
  changes: { name: 'Changes' },
  testing: { name: 'Testing' },
  review: { name: 'Review' },
  verify: { name: 'Verify' },
};

/** What a tab that needs the person shows after its name: an orange icon and these words, never colour alone. */
export const NEEDS_YOU = 'needs you';

export interface TaskTab {
  id: TabId;
  name: string;
  /** How many things it holds, in words ("12 comments", "4"), or null where a count doesn't help. */
  count: string | null;
  /** What in it needs the person, in the words of the state that says so; null when nothing does. */
  needs: string | null;
}

/** A state shown in orange is one that waits on the person: its label says what. */
const orange = (look: Look | null | undefined): string | null => (look?.tone === 'orange' ? look.label : null);

/**
 * What on the Changes tab waits on the person (T-138): a check that passed and isn't confirmed yet, else the
 * steps left to do by hand. Never the manifest's or the field's state: those wait under More.
 */
export const changesNeeds = (m: TicketModel): string | null => m.deploy?.needs ?? null;

/**
 * The tabs a ticket's page shows, in order. Ticket always: it holds the description. Plan & build, Changes, Review and
 * Verify only with something in them, so a tab is never shown empty. Testing for every Salesforce task whose
 * environment the settings name: before its builder's deploy, it says what it will hold (T-161).
 */
export function taskTabs(m: TicketModel): TaskTab[] {
  const tab = (id: TabId, count: string | null, needs: string | null): TaskTab => ({ id, ...TAB_LOOK[id], count, needs });
  const out: TaskTab[] = [];
  // Updates acc drafted for the ticket wait in its activity for the person to post (D-066).
  out.push(tab('ticket', m.comments.length ? plural(m.comments.length, 'comment') : null, m.updates.length ? `${plural(m.updates.length, 'update')} to post` : null));
  const talk = !m.analysis && m.talk ? m.talk : null;
  const builderNote = !!(m.acc?.note || m.acc?.noteMissing);
  if (m.analysis || talk || m.criteria || m.acc?.notes || builderNote) {
    out.push(tab('plan', null, orange(m.analysis?.look) ?? orange(m.analysis?.planState?.look) ?? orange(talk?.look)));
  }
  if (m.changes || m.team || m.field || m.records || m.manifest || m.deploy) {
    // Its count is the one list's (T-138): what changed once there's work, else what's planned.
    const n = m.changes?.list.count ?? 0;
    out.push(tab('changes', n ? String(n) : null, changesNeeds(m)));
  }
  // Testing (T-161): a Salesforce task's, before its builder's deploy too, when it says what it will hold. It never
  // needs the person: testing is their choice. Its count is its steps, once there are any.
  if (m.testing) out.push(tab('testing', m.testing.ready?.steps.length ? String(m.testing.ready.steps.length) : null, null));
  // Its review (T-135): the findings counted where there are any, and orange where the review's state waits on the person.
  if (m.review) out.push(tab('review', m.review.findings.length ? String(m.review.findings.length) : null, orange(m.review.look)));
  if (m.verify) out.push(tab('verify', null, orange(m.verify.look)));
  return out;
}

/** A tab's title on hover: "Ticket, 12 comments", or "Plan & build: needs you". Its accessible name is its visible words ("Plan & build needs you"), as label-in-name asks. */
export const tabName = (t: TaskTab): string => `${t.name}${t.count ? `, ${t.count}` : ''}${t.needs ? `: ${NEEDS_YOU}` : ''}`;

/**
 * The tab a part a link names opens (T-134): the plan, a verification, the changes, the review (T-135) or the ticket; a comment,
 * `comment:<id>`, opens Ticket. Null for a part no tab holds.
 */
export function partTab(part: string | null | undefined): TabId | null {
  if (!part) return null;
  if (part.startsWith('comment:')) return 'ticket';
  return (TAB_ORDER as readonly string[]).includes(part) ? (part as TabId) : null;
}

/**
 * Which tab that needs the person a page opens on, first to last: a plan holds up the build, a review that
 * sent work back holds up its rework (T-135: it comes before the developer's verification, which comes after
 * it), a verification the developer's work, the changes the release; an update to post waits on no one else. Testing never needs the person (T-161): it comes last.
 */
export const NEEDS_FIRST: readonly TabId[] = ['plan', 'review', 'verify', 'changes', 'ticket', 'testing'];

/**
 * The tab a page opens on: the one a link asked for, where it's shown; else one that needs the person, in
 * NEEDS_FIRST's order; else the one last on show for this ticket, where it's still shown; else Ticket.
 */
export function openingTab(tabs: readonly TaskTab[], asked: TabId | null, remembered: string | null | undefined): TabId {
  const shown = (id: string | null | undefined): id is TabId => !!id && tabs.some((t) => t.id === id);
  if (shown(asked)) return asked;
  const needs = NEEDS_FIRST.find((id) => tabs.some((t) => t.id === id && t.needs));
  if (needs) return needs;
  if (shown(remembered)) return remembered;
  return 'ticket';
}
