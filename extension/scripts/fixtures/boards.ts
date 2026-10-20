/** Tracker boards (D-026): a Jira board and a monday.com board, with acc's tasks for some of their cards, and a Slack channel's box. */
import { NO_PASTE, slackLinkKey } from '../../src/logic/slack-link.ts';
import type { BoardInput } from '../../src/model/boards.ts';

const status = (id: string, name: string, category: 'todo' | 'doing' | 'done') => ({ id, name, category });
export const TODO = status('1', 'To Do', 'todo');
export const DOING = status('3', 'In Progress', 'doing');
export const REVIEW = status('4', 'In Review', 'doing');
const QA = status('5', 'QA', 'doing');
export const DONE = status('10', 'Done', 'done');

/**
 * A Jira board with its own columns, the cards on it, and acc's tasks for some of them. Its tickets come
 * from one epic (D-072), and a task that started moved out of it. Three tickets acc doesn't keep yet show
 * Track (D-074): ready, on its way, and refused because the ticket has since left the epic. One that's done has none.
 */
export function sampleBoards(): BoardInput[] {
  const card = (n: number, title: string, s: { id: string; name: string }, type: string, extra: Partial<NonNullable<BoardInput['board']>['cards'][number]> = {}) =>
    ({ key: `ACME-${n}`, title, url: `https://acme.atlassian.net/browse/ACME-${n}`, status: s, type, assignees: [], labels: [], priority: 'Medium', ...extra });
  return [{
    index: 0, kind: 'jira', title: 'Jira · ACME', error: null, connect: null, loading: false, signedInAs: 'jordan@acme.example', me: { id: 'jordan', name: 'Jordan Kim' },
    // A sign-in for every project on the site (GH-79), said under the place.
    signInScope: { shared: true, host: 'acme.atlassian.net' },
    place: 'Jira · ACME · epic ACME-3 Premium Support',
    left: ['ACME-18 left this repo\'s place: it isn\'t in epic ACME-3; ACME-18 is still blocked'],
    tracking: {
      'ACME-31': { busy: true, error: null },
      'ACME-32': { busy: false, error: 'ACME-32 isn\'t one of this repo\'s tickets, which come from Jira · ACME · epic ACME-3 Premium Support: it isn\'t in epic ACME-3.' },
    },
    board: {
      source: 'jira-board', title: 'ACME Service board', url: 'https://acme.atlassian.net/jira/software/projects/ACME/boards/7', notice: null,
      columns: [
        { id: 'col-0', name: 'To Do', category: 'todo', statusIds: ['1'] }, { id: 'col-1', name: 'In Progress', category: 'doing', statusIds: ['3'] },
        { id: 'col-2', name: 'In Review', category: 'doing', statusIds: ['4'] }, { id: 'col-3', name: 'QA', category: 'doing', statusIds: ['5'] },
        { id: 'col-4', name: 'Done', category: 'done', statusIds: ['10'] },
      ],
      cards: [
        card(16, 'Add a field history report for Opportunity stage', TODO, 'Story', { priority: 'High', labels: [{ name: 'reporting', color: null }] }),
        // Near the top, so the default screenshots show Track's three looks (D-074).
        card(30, 'Archive closed cases older than seven years', TODO, 'Story', { labels: [{ name: 'service', color: null }] }),
        card(31, 'Email the account owner when a premium case is opened', TODO, 'Task', { priority: 'High' }),
        card(32, 'Hide the legacy SLA fields from the case layout', TODO, 'Task', { assignees: [{ id: 'pat', name: 'Pat Lee' }] }),
        card(17, 'Dashboards for the escalation rules', TODO, 'Task'),
        card(21, 'Contact roles missing on converted leads', TODO, 'Bug', { priority: 'Highest', assignees: [{ id: 'pat', name: 'Pat Lee' }], labels: [{ name: 'sales', color: null }] }),
        card(23, 'Rebuild the partner portal on Experience Cloud', TODO, 'Epic'),
        card(24, 'Sync the renewal date to the billing system', TODO, 'Story'),
        card(14, 'Route web-to-case submissions by product line', DOING, 'Story', { assignees: [{ id: 'jordan', name: 'Jordan Kim' }] }),
        card(28, 'Send a renewal reminder a month before the renewal date', DOING, 'Story', { assignees: [{ id: 'jordan', name: 'Jordan Kim' }] }),
        card(12, 'Case escalation rules for the premium tier', DOING, 'Story', { priority: 'High', assignees: [{ id: 'jordan', name: 'Jordan Kim' }], labels: [{ name: 'service', color: null }, { name: 'sla', color: null }] }),
        card(22, 'Add a Region field to the Lead page', DOING, 'Story', { assignees: [{ id: 'jordan', name: 'Jordan Kim' }] }),
        card(15, 'Rename the Region picklist values', REVIEW, 'Task', { priority: 'Low', assignees: [{ id: 'pat', name: 'Pat Lee' }] }),
        card(27, 'Recalculate lead scores only when a scoring field changes', REVIEW, 'Story', { assignees: [{ id: 'pat', name: 'Pat Lee' }] }),
        card(34, 'Close stale cases after 30 days without a reply', REVIEW, 'Story', { assignees: [{ id: 'pat', name: 'Pat Lee' }] }),
        card(25, 'Merge duplicate contacts on import', REVIEW, 'Story', { assignees: [{ id: 'pat', name: 'Pat Lee' }] }),
        card(33, 'Score new leads by the size of their company', REVIEW, 'Story', { labels: [{ name: 'sales', color: null }] }),
        card(19, 'Fix the flow that double-sends welcome emails', QA, 'Bug', { priority: 'High' }),
        card(10, 'Add a CHANGELOG', DONE, 'Task', { priority: 'Lowest' }),
        card(8, 'Turn off the old web-to-lead form', DONE, 'Task'),
      ],
    },
  }];
}

/**
 * A monday.com board (GH-70): its Status column's labels as its columns, in monday's order, with No status
 * first because an item has none, and a group as its place. Item ids are long. acc keeps none of its
 * items yet, so every card not done shows Track: ready, on its way, or refused because the item moved to
 * another group. A task whose item left the group after it started is named above the board.
 */
export function sampleMondayBoards(): BoardInput[] {
  const card = (id: number, title: string, s: { id: string; name: string }, assignees: string[] = []) =>
    ({ key: `MON-${id}`, title, url: `https://acme.monday.com/boards/1234567890/pulses/${id}`, status: s, type: null, assignees: assignees.map((name) => ({ name })), labels: [], priority: null });
  const NONE = { id: 'none', name: 'No status' };
  const NOT_STARTED = { id: '3', name: 'Not started' };
  const WORKING = { id: '0', name: 'Working on it' };
  const STUCK = { id: '2', name: 'Stuck' };
  const FINISHED = { id: '1', name: 'Done' };
  const place = 'monday.com · acme · Client work · group This sprint';
  return [{
    index: 0, kind: 'monday', title: 'monday.com · acme', error: null, connect: null, loading: false, signedInAs: 'a personal API token', place,
    // This project's own sign-in (GH-79).
    signInScope: { shared: false, host: 'acme' },
    left: ['MON-9081726354 left this repo\'s place: it\'s in group Backlog; MON-9081726354 is still running'],
    tracking: {
      'MON-9081726361': { busy: true, error: null },
      'MON-9081726368': { busy: false, error: `MON-9081726368 isn't one of this repo's tickets, which come from ${place}: it's in group Backlog.` },
    },
    board: {
      source: 'monday-board', title: 'Client work · This sprint', url: 'https://acme.monday.com/boards/1234567890', notice: null,
      columns: [
        { id: 'none', name: 'No status', category: 'todo', statusIds: ['none'] }, { id: '3', name: 'Not started', category: 'doing', statusIds: ['3'] },
        { id: '0', name: 'Working on it', category: 'doing', statusIds: ['0'] }, { id: '2', name: 'Stuck', category: 'doing', statusIds: ['2'] },
        { id: '1', name: 'Done', category: 'done', statusIds: ['1'] },
      ],
      cards: [
        card(9081726399, 'Collect the partner logos for the portal', NONE),
        card(9081726347, 'Move the renewal calendar to the shared drive', NOT_STARTED, ['Pat Lee']),
        card(9081726361, 'Send the onboarding checklist to new accounts', NOT_STARTED),
        card(9081726368, 'Draft the escalation runbook for tier 2', NOT_STARTED, ['Jordan Kim']),
        card(9081726372, 'Review the support hours with the client', WORKING, ['Jordan Kim', 'Pat Lee']),
        card(9081726380, 'Tidy the case reasons picklist', WORKING, ['Pat Lee']),
        card(9081726385, 'Get sign-off on the new SLA wording', STUCK),
        card(9081726311, 'Kick-off call with the support team', FINISHED, ['Jordan Kim']),
      ],
    },
  }];
}

/**
 * A GitHub repo's issues with no Project (the Tasks header's cleanup): its columns are Open and Closed, its
 * place is the whole repo, which its title already names, and its account can't read Projects yet.
 */
export function sampleGithubBoards(): BoardInput[] {
  const OPEN = { id: 'OPEN', name: 'Open' };
  const CLOSED = { id: 'CLOSED', name: 'Closed' };
  const card = (n: number, title: string, s: { id: string; name: string }, labels: string[] = []) =>
    ({ key: `GH-${n}`, title, url: `https://github.com/acme/tool/issues/${n}`, status: s, type: null, assignees: [], labels: labels.map((name) => ({ name, color: null })), priority: null });
  return [{
    index: 0, kind: 'github', title: 'GitHub · acme/tool', error: null, connect: null, loading: false, signedInAs: 'jordan-kim', place: 'GitHub · acme/tool', left: [],
    board: {
      source: 'github-state', title: 'Issues · acme/tool', url: 'https://github.com/acme/tool/issues',
      notice: 'To use your GitHub Project\'s columns, give jordan-kim access to Projects. gh refreshes only its active account, so run gh auth switch -u jordan-kim, then gh auth refresh -h github.com -s project and sign in as jordan-kim, then switch back to the account you use.',
      columns: [{ id: 'OPEN', name: 'Open', category: 'todo', statusIds: ['OPEN'] }, { id: 'CLOSED', name: 'Closed', category: 'done', statusIds: ['CLOSED'] }],
      cards: [
        card(41, 'Export the case history as CSV', OPEN, ['enhancement']), card(42, 'The sync retries forever when the API is down', OPEN, ['bug']),
        card(43, 'Document the release steps', OPEN), card(38, 'Add a dark theme to the report', CLOSED),
      ],
    },
  }];
}

/**
 * A Slack channel (T-31): no board, so a box takes a thread's link in its place, and says which channel
 * the thread must be in. Empty, or with a link to a thread in another channel, which Track refused.
 */
export function sampleSlackBoards(refused = false): BoardInput[] {
  const place = { workspace: 'acme', channel: 'C0123ABCD', prefix: null };
  const link = 'https://acme.slack.com/archives/C0999WXYZ/p1696512345123456';
  const read = slackLinkKey(link, place);
  return [{
    index: 0, kind: 'slack', title: 'Slack · acme', error: null, connect: null, loading: false, signedInAs: 'Acme Command Center',
    signInScope: { shared: false, host: 'acme' }, place: 'Slack · acme · channel C0123ABCD', left: [], board: null,
    paste: { ...place, ...(refused ? { link, busy: false, error: read.ok ? null : read.error, tracked: null } : NO_PASTE) },
  }];
}
