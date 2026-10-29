/**
 * What the sample data for looking at the tabs (`npm run screenshot`) shares. Each area's samples are in
 * the module of its name here (GH-95). Generic names only, since this repo carries no client data. It's
 * shaped like the hub, and the real model functions turn it into what each tab receives, so it can't drift
 * from the types.
 */
import { sessionName } from '../../../packages/core/src/names.ts';

export const MIN = 60_000;
/** The sample project's main checkout. */
export const ROOT = '/Users/me/code/acme-service';
/** A repo elsewhere on the machine, not open in this window, with a ledger of its own (D-095). */
export const CLIENTS = '/Users/me/clients/Acme Service';
/** A task's worktree in the sample project. */
export const wt = (id: string) => `${ROOT}/.claude/worktrees/${id}`;

/** The class ACME-19 changes, whose excerpts the task page's review and the output panel's review show (T-63). */
export const WELCOME_CLS = 'force-app/main/default/classes/WelcomeEmailService.cls';
/** A line of a review's excerpt: its number in the file (none for a deleted line), its mark, and whether a finding points at it. */
export const excerptLine = (n: number | null, mark: 'add' | 'del' | 'same', text: string, at = false) => ({ n, mark, text, at });

/** What GH-41's builder last said when the Mac slept (D-067). */
export const SLEPT = 'API Error: Your computer went to sleep mid-response. The response above may be incomplete.';
/** Why autopilot couldn't review ACME-25, as acc's review refuses it: in acc's words, with its command (GH-163). */
export const ACME_25_REFUSED = 'ACME-25\'s checks aren\'t settled on e7f8a9b: validate. Run acc gate run in its worktree, or waive them, then review.';
/**
 * A blocked note as acc block takes it now (T-146): a headline, a bullet per thing, options as a) b), the one the
 * builder recommends marked, its API names in backticks as acc recorded them. Made up: no client's fields.
 */
export const BLOCKED_NOTE = 'The plan and the ticket disagree, so nothing can land without your choice.\n- Which field holds the territory? a) `Territory__c` on Account (recommended) b) a new `Deal_Territory__c` on Opportunity\n- The record page `Territory_Record_Page` is named twice in the plan, with two layouts; which wins? a) the sales layout b) the service layout\n- The report type `Deals_With_Territories` needs the permission set `Territory_Admin`, which the plan leaves out.';
/** The same kind of note as a builder wrote it before T-146: one paragraph, its things numbered inline, no backticks. */
export const BLOCKED_WALL = 'Plan v2 contradicts itself, so nothing can land without a person\'s choice. (1) The plan keeps the territory on Account, but the criteria name Deal_Territory__c on Opportunity: which is right? a) keep Account.Territory__c (recommended) b) add Deal_Territory__c. (2) The record page Territory_Record_Page.flexipage-meta.xml is named twice with two layouts; which wins? a) the sales layout b) the service layout. (3) The report type Deals_With_Territories needs the permission set Territory_Admin, which the plan leaves out; I recommend b: a) drop the report b) add the permission set under force-app/main/default/permissionsets.';
/** A builder that ended its turn with a question in its own words, instead of acc block. */
export const ASKED = 'I\'ve added the reassignment flow and its test. Before I finish: when the leaving owner\'s manager is also inactive, should the cases go to the queue named on the account, or to the support team\'s default queue? I\'ve left both paths in until someone decides.';

// Builders named as dispatch names them (D-087): ACME-12's is its second, after a rework.
const named = (id: string, title: string, n?: number) => sessionName({ project: 'Acme Service', key: id, title, role: 'builder', n });
export const N14 = named('ACME-14', 'Route web-to-case submissions by product line');
export const N12 = named('ACME-12', 'Case escalation rules for the premium tier', 2);
export const N13 = named('ACME-13', 'Close duplicate leads nightly');
export const N28 = named('ACME-28', 'Send a renewal reminder a month before the renewal date');
export const N29 = named('ACME-29', 'Reassign open cases when an owner leaves');
export const N43 = named('ACME-43', 'Archive closed cases older than two years');
export const N44 = named('ACME-44', 'Round-robin new leads across the inside sales team');
/** Its reviewer in the cloud (T-86), named as acc names a review. */
export const N47 = sessionName({ project: 'Acme Service', key: 'ACME-47', title: 'Send a survey when a case closes', role: 'review' });
export const N10 = named('ACME-10', 'Add a CHANGELOG');
// ACME-12's first builder, before the rework that dispatched its second.
export const N12a = named('ACME-12', 'Case escalation rules for the premium tier');
export const R19 = sessionName({ project: 'Acme Service', key: 'ACME-19', title: 'Fix the flow that double-sends welcome emails', role: 'review' });
export const R20 = sessionName({ project: 'Acme Service', key: 'ACME-20', title: 'Show the renewal date on the Account page', role: 'review' });
export const N38 = named('ACME-38', 'Merge the support queues');
// In ~/clients/Acme Service, open in another window (GH-119): a task in review, its builder and its reviewer.
export const T42 = 'Archive closed cases after a year';
export const N42 = named('ACME-42', T42);
export const R42 = sessionName({ project: 'Acme Service', key: 'ACME-42', title: T42, role: 'review' });
// The analyst reading ACME-24 before it's built, in the main checkout (D-087).
export const A24 = sessionName({ project: 'Acme Service', key: 'ACME-24', title: 'Sync the renewal date to the billing system', role: 'analysis' });
