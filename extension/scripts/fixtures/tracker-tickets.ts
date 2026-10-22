/**
 * A ticket's page from each tracker past Jira and Slack (T-91), and an Azure DevOps board, so the screenshot run
 * draws every tracker: a GitHub issue with its labels' own colours and sub-issues, one closed as not planned; an
 * Azure DevOps Product Backlog Item with tags, priority 3, two child items in different states, an HTML
 * description with a list, and two comments; and a monday.com item, which has no type, priority or labels.
 * Each carries the colours its tracker gives (T-95): GitHub's issue type, Azure DevOps' types and tags.
 * Acme names and .example addresses only.
 */
import { AZURE_PRIORITY } from '../../../packages/core/src/trackers/azure.ts';
import { GITHUB_TYPE_COLOUR } from '../../../packages/core/src/trackers/github.ts';
import { fromHtml, fromMarkdown } from '../../../packages/core/src/trackers/doc.ts';
import { typeKindOf } from '../../../packages/core/src/trackers/normal.ts';
import type { Person, Ticket } from '../../../packages/core/src/trackers/types.ts';
import type { BoardInput } from '../../src/model/boards.ts';
import { ticketModel, type TicketModel } from '../../src/model/task-page.ts';
import { GITHUB_LABELS, sampleBoards } from './boards.ts';
import { MIN, ROOT } from './shared.ts';

const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (now: number, ms: number): string => new Date(now - ms).toISOString();

/** The people on Azure DevOps, with the email its uniqueName gives (T-90). */
const JORDAN: Person = { id: 'b1f0c2d4-0001', name: 'Jordan Kim', email: 'jordan.kim@acme.example' };
const PAT: Person = { id: 'b1f0c2d4-0002', name: 'Pat Lee', email: 'pat.lee@acme.example' };
const SAM: Person = { id: 'b1f0c2d4-0003', name: 'Sam Rivera', email: 'sam.rivera@acme.example' };

/** Azure DevOps' Scrum states, each with its category, and Removed as not planned (T-90). */
const AZ = {
  NEW: { id: 'New', name: 'New', category: 'todo' as const },
  APPROVED: { id: 'Approved', name: 'Approved', category: 'todo' as const },
  COMMITTED: { id: 'Committed', name: 'Committed', category: 'doing' as const },
  DONE: { id: 'Done', name: 'Done', category: 'done' as const, reason: 'completed' as const },
  REMOVED: { id: 'Removed', name: 'Removed', category: 'done' as const, reason: 'not-planned' as const },
};

/** Azure DevOps' Scrum work item types' own colours (T-95), as its work item types API gives them. */
export const AZURE_TYPE_COLOURS: Record<string, string> = { 'Product Backlog Item': '009CCC', Bug: 'CC293D', Task: 'F2CB1D', Feature: '773B93', 'Test Case': '004B50' };
/** The CRM board's tag colours from its card rules (T-95). history, contacts, testing and reporting have no rule. */
export const AZURE_TAG_COLOURS: Record<string, string> = { premium: 'fbd144', service: '00a1f1', audit: 'ec001d', 'account page': '60af49' };
const azTag = (name: string) => ({ name, color: AZURE_TAG_COLOURS[name] ?? null });
const azType = (type: string): string | null => AZURE_TYPE_COLOURS[type] ?? null;

const ghLabel = (name: string) => ({ name, color: GITHUB_LABELS[name] ?? null });

/** Which tracker's ticket page to draw (T-91). */
export type TrackerTicketSample = 'github' | 'azure' | 'monday';

export function sampleTrackerTicket(now: number, which: TrackerTicketSample): TicketModel {
  if (which === 'github') return githubTicket(now);
  if (which === 'monday') return mondayTicket(now);
  return azureTicket(now);
}

/** A GitHub issue acc doesn't keep yet, with its labels' colours, two sub-issues (one closed as not planned) and a parent. */
function githubTicket(now: number): TicketModel {
  const ticket: Ticket = {
    key: 'GH-42', kind: 'github', url: 'https://github.com/acme/tool/issues/42', title: 'The sync retries forever when the API is down', type: 'Bug', typeKind: 'bug', typeColor: GITHUB_TYPE_COLOUR.RED!,
    status: { id: 'OPEN', name: 'Open', category: 'todo' }, assignees: [{ id: 'jordan-kim', name: 'Jordan Kim' }, { id: 'sam-rivera', name: 'Sam Rivera' }], reporter: { id: 'pat-lee', name: 'Pat Lee' },
    labels: ['bug', 'good first issue', 'reporting'].map(ghLabel), priority: null, priorityLevel: null,
    created: ago(now, 3 * DAY), updated: ago(now, 2 * HOUR),
    body: fromMarkdown('When the API returns 503, the sync tries again at once, and keeps trying.\n\n- Back off: 1, 2, 4 and 8 seconds\n- Stop after five tries, and say so in the log\n\nSeen on **acme-tool 2.3** against the staging API.'),
    markdown: '',
    comments: [
      { id: 'c1', author: { id: 'sam-rivera', name: 'Sam Rivera' }, created: ago(now, 2 * DAY), url: 'https://github.com/acme/tool/issues/42#issuecomment-1', body: fromMarkdown('Reproduced it with the API stopped. The log grows by a line every few milliseconds.') },
      { id: 'c2', author: { id: 'jordan-kim', name: 'Jordan Kim' }, created: ago(now, 2 * HOUR), url: 'https://github.com/acme/tool/issues/42#issuecomment-2', body: fromMarkdown('I split it into two sub-issues. The retry cap comes first.') },
    ],
    related: [
      { key: 'GH-40', title: 'Make the sync survive an outage', relation: 'parent', url: 'https://github.com/acme/tool/issues/40', status: { id: 'OPEN', name: 'Open', category: 'todo' }, typeKind: 'epic' , typeColor: null },
      { key: 'GH-44', title: 'Cap the sync at five tries', relation: 'sub-issue', url: 'https://github.com/acme/tool/issues/44', status: { id: 'CLOSED', name: 'Closed', category: 'done', reason: 'completed' }, typeKind: 'task' , typeColor: null },
      { key: 'GH-45', title: 'Retry from a queue instead of a loop', relation: 'sub-issue', url: 'https://github.com/acme/tool/issues/45', status: { id: 'CLOSED', name: 'Closed as not planned', category: 'done', reason: 'not-planned' }, typeKind: 'task' , typeColor: null },
    ],
  };
  return ticketModel({
    project: ROOT, tracker: 0, trackerTitle: 'GitHub · acme/tool', trackerKind: 'github', key: 'GH-42', ticket, loading: false, error: null, connect: null, row: null, task: null, checks: [],
    signedInAs: 'jordan-kim', trackerEdits: true, boards: sampleBoards(), github: 'jordan-kim', now,
  });
}

/** An Azure DevOps Product Backlog Item: tags, priority 3, two child items in different states, an HTML description with a list, and two comments. */
function azureTicket(now: number): TicketModel {
  const type = 'Product Backlog Item';
  const description = '<div>Support agents need to see a premium customer\'s open cases from the account page, without a report.</div>'
    + '<ul><li>Show the five newest open cases, newest first</li><li>Link each case to its record</li><li><b>Hide</b> the list for standard accounts</li></ul>'
    + '<div>The account page is <i>Account_Premium</i> in the Lightning App Builder.</div>';
  const ticket: Ticket = {
    key: 'AB-1204', kind: 'azure', url: 'https://dev.azure.com/acme/CRM/_workitems/edit/1204', title: 'Show a premium account\'s open cases on its page', type, typeKind: typeKindOf(type), typeColor: azType(type),
    status: AZ.COMMITTED, assignees: [JORDAN], reporter: PAT,
    labels: ['premium', 'service', 'account page'].map(azTag), priority: AZURE_PRIORITY[3]!.name, priorityLevel: AZURE_PRIORITY[3]!.level,
    created: ago(now, 9 * DAY), updated: ago(now, 5 * HOUR),
    body: fromHtml(description), markdown: '',
    comments: [
      { id: '1', author: PAT, created: ago(now, 4 * DAY), url: null, body: fromHtml('<div>Support asked for the case <b>priority</b> beside each one, if it fits.</div>') },
      { id: '2', author: JORDAN, created: ago(now, 5 * HOUR), url: null, body: fromHtml('<div>Priority fits. The list query is done; the component is next.</div>') },
    ],
    related: [
      { key: 'AB-1190', title: 'Premium support for key accounts', relation: 'parent', url: 'https://dev.azure.com/acme/CRM/_workitems/edit/1190', status: AZ.COMMITTED, typeKind: 'feature', typeColor: azType('Feature') },
      { key: 'AB-1205', title: 'Query the five newest open cases for an account', relation: 'child', url: 'https://dev.azure.com/acme/CRM/_workitems/edit/1205', status: AZ.DONE, typeKind: 'task', typeColor: azType('Task') },
      { key: 'AB-1206', title: 'Build the open cases component for the account page', relation: 'child', url: 'https://dev.azure.com/acme/CRM/_workitems/edit/1206', status: { id: 'In Progress', name: 'In Progress', category: 'doing' }, typeKind: 'task', typeColor: azType('Task') },
    ],
  };
  return ticketModel({
    project: ROOT, tracker: 0, trackerTitle: 'Azure DevOps · CRM', trackerKind: 'azure', key: 'AB-1204', ticket, loading: false, error: null, connect: null, row: null, task: null, checks: [],
    signedInAs: 'Jordan Kim', trackerEdits: false, boards: sampleBoards(), github: 'jordan-kim', now,
  });
}

/** A monday.com item: a status and the people on it, but no type, priority, labels or links, so the page leaves those out. */
function mondayTicket(now: number): TicketModel {
  const ticket: Ticket = {
    key: 'MON-9081726372', kind: 'monday', url: 'https://acme.monday.com/boards/1234567890/pulses/9081726372', title: 'Review the support hours with the client', type: null, typeKind: null, typeColor: null,
    status: { id: '0', name: 'Working on it', category: 'doing' }, assignees: [{ id: '501', name: 'Jordan Kim' }, { id: '502', name: 'Pat Lee' }], reporter: null,
    labels: [], priority: null, priorityLevel: null,
    created: ago(now, 6 * DAY), updated: ago(now, 30 * MIN),
    body: fromMarkdown('Walk through the current support hours with the client and note any change for the premium tier.'),
    markdown: '',
    comments: [{ id: 'u1', author: { id: '502', name: 'Pat Lee' }, created: ago(now, DAY), url: null, body: fromMarkdown('The client wants weekend cover for premium accounts. I booked a call for Thursday.') }],
    related: [],
  };
  return ticketModel({
    project: ROOT, tracker: 0, trackerTitle: 'monday.com · acme', trackerKind: 'monday', key: 'MON-9081726372', ticket, loading: false, error: null, connect: null, row: null, task: null, checks: [],
    signedInAs: 'a personal API token', trackerEdits: false, boards: sampleBoards(), github: 'jordan-kim', now,
  });
}

/**
 * An Azure DevOps board (T-91): its Scrum columns, cards with each kind and priority level, tags (one card with
 * five, so it shows three and "+2"), and people with emails. acc keeps none of its items, so each card not done
 * shows Track.
 */
export function sampleAzureBoards(): BoardInput[] {
  const card = (n: number, title: string, s: { id: string; name: string }, type: string, priority: number | null, assignees: Person[] = [], tags: string[] = []) => ({
    key: `AB-${n}`, title, url: `https://dev.azure.com/acme/CRM/_workitems/edit/${n}`, status: s, type, typeKind: typeKindOf(type), typeColor: azType(type),
    assignees, labels: tags.map(azTag),
    priority: priority ? AZURE_PRIORITY[priority]!.name : null, priorityLevel: priority ? AZURE_PRIORITY[priority]!.level : null,
  });
  return [{
    index: 0, kind: 'azure', title: 'Azure DevOps · CRM', error: null, connect: null, loading: false, signedInAs: 'jordan.kim@acme.example', me: { id: JORDAN.id, name: JORDAN.name },
    signInScope: { shared: false, host: 'acme' }, place: 'Azure DevOps · CRM · CRM Team · area CRM\\Service', left: [],
    board: {
      source: 'azure-board', title: 'CRM Team · Backlog items', url: 'https://dev.azure.com/acme/CRM/_boards/board/t/CRM%20Team/Backlog%20items', notice: null,
      columns: [
        { id: 'New', name: 'New', category: 'todo', statusIds: ['New'] }, { id: 'Approved', name: 'Approved', category: 'todo', statusIds: ['Approved'] },
        { id: 'Committed', name: 'Committed', category: 'doing', statusIds: ['Committed'] }, { id: 'Done', name: 'Done', category: 'done', statusIds: ['Done', 'Removed'] },
      ],
      cards: [
        card(1211, 'Let agents merge duplicate contacts from the account page', AZ.NEW, 'Product Backlog Item', 2, [], ['service', 'contacts']),
        card(1213, 'Case owner changes are not written to the history', AZ.NEW, 'Bug', 1, [SAM], ['service', 'history', 'premium', 'audit', 'reporting']),
        card(1208, 'Premium support for key accounts', AZ.APPROVED, 'Feature', 2, [PAT]),
        card(1204, 'Show a premium account\'s open cases on its page', AZ.COMMITTED, 'Product Backlog Item', 3, [JORDAN], ['premium', 'service', 'account page']),
        card(1206, 'Build the open cases component for the account page', AZ.COMMITTED, 'Task', 3, [JORDAN, PAT, SAM]),
        card(1209, 'Check the case list against the sharing rules', AZ.COMMITTED, 'Test Case', 4, [SAM], ['testing']),
        card(1205, 'Query the five newest open cases for an account', AZ.DONE, 'Task', 3, [JORDAN], ['premium']),
        card(1199, 'Export premium accounts as a spreadsheet', AZ.REMOVED, 'Product Backlog Item', null, [], ['reporting']),
      ],
    },
  }];
}

/** An Azure DevOps board loading for the first time in a window, with nothing kept from before: its skeleton (2026-10-21). */
export const sampleAzureLoading = (): BoardInput[] => sampleAzureBoards().map((b) => ({ ...b, board: null, loading: true }));

/** An Azure DevOps board drawn from the repo's cache while it refreshes (2026-10-21). */
export const sampleAzureRefreshing = (): BoardInput[] => sampleAzureBoards().map((b) => ({ ...b, loading: true }));
