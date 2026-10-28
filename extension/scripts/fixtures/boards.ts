/** Tracker boards (D-026): a Jira board and a monday.com board, with acc's tasks for some of their cards, and a Slack channel's box. */
import { NO_PASTE, slackLinkKey } from '../../src/logic/slack-link.ts';
import { NO_REACTION, SLACK_APPS, SLACK_CARD_MAX } from '../../../packages/core/src/trackers/slack.ts';
import { clip } from '../../../packages/core/src/text.ts';
import { placeText } from '../../../packages/core/src/trackers/types.ts';
import { JIRA_PRIORITY } from '../../../packages/core/src/trackers/jira.ts';
import { typeKindOf } from '../../../packages/core/src/trackers/normal.ts';
import { GITHUB_TYPE_COLOUR } from '../../../packages/core/src/trackers/github.ts';
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
  // Each card's kind and priority level as Jira's client gives them (T-90).
  const card = (n: number, title: string, s: { id: string; name: string }, type: string, extra: Partial<NonNullable<BoardInput['board']>['cards'][number]> = {}) => {
    const c = { key: `ACME-${n}`, title, url: `https://acme.atlassian.net/browse/ACME-${n}`, status: s, type, assignees: [], labels: [], priority: 'Medium', ...extra };
    return { ...c, typeKind: typeKindOf(c.type), priorityLevel: c.priority ? JIRA_PRIORITY[c.priority.toLowerCase()] ?? null : null };
  };
  return [{
    index: 0, id: 'b-acme-premium', host: 'acme.atlassian.net', narrowed: true, kind: 'jira', title: 'Jira · ACME', error: null, connect: null, loading: false, signedInAs: 'jordan@acme.example', me: { id: 'jordan', name: 'Jordan Kim' },
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
/** GitHub's own label colours, as its API gives them (T-91): a label chip takes the tracker's colour over the palette. */
export const GITHUB_LABELS: Record<string, string> = { bug: 'd73a4a', enhancement: 'a2eeef', documentation: '0075ca', 'good first issue': '7057ff', reporting: 'fbca04' };

export function sampleGithubBoards(): BoardInput[] {
  const OPEN = { id: 'OPEN', name: 'Open' };
  const CLOSED = { id: 'CLOSED', name: 'Closed' };
  // Two issues have an issue type, each in the colour GitHub names for it (T-95); the others have none.
  const card = (n: number, title: string, s: { id: string; name: string }, labels: string[] = [], type: [string, string] | null = null) =>
    ({ key: `GH-${n}`, title, url: `https://github.com/acme/tool/issues/${n}`, status: s, type: type?.[0] ?? null, typeKind: typeKindOf(type?.[0]), typeColor: type ? GITHUB_TYPE_COLOUR[type[1]]! : null,
      assignees: [], labels: labels.map((name) => ({ name, color: GITHUB_LABELS[name] ?? null })), priority: null });
  return [{
    index: 0, id: 'b-acme-tool', host: '', narrowed: false, kind: 'github', title: 'GitHub · acme/tool', error: null, connect: null, loading: false, signedInAs: 'jordan-kim', place: 'GitHub · acme/tool', left: [],
    board: {
      source: 'github-state', title: 'Issues · acme/tool', url: 'https://github.com/acme/tool/issues',
      notice: 'To use your GitHub Project\'s columns, give jordan-kim access to Projects. gh refreshes only its active account, so run gh auth switch -u jordan-kim, then gh auth refresh -h github.com -s project and sign in as jordan-kim, then switch back to the account you use.',
      columns: [{ id: 'OPEN', name: 'Open', category: 'todo', statusIds: ['OPEN'] }, { id: 'CLOSED', name: 'Closed', category: 'done', statusIds: ['CLOSED'] }],
      cards: [
        card(41, 'Export the case history as CSV', OPEN, ['enhancement'], ['Feature', 'BLUE']), card(42, 'The sync retries forever when the API is down', OPEN, ['bug'], ['Bug', 'RED']),
        card(43, 'Document the release steps', OPEN), card(38, 'Add a dark theme to the report', CLOSED),
      ],
    },
  }];
}

/** The ways a Slack tracker's Tasks tab is drawn (T-31, T-85). */
export type SlackBoardSample = 'off' | 'refused' | 'board' | 'empty' | 'scope';

/**
 * A Slack channel (T-31, T-85). `off`: it names no reaction, so its board is off, saying why, over the box for
 * a thread's link. `refused`: the same, with a link Track refused. `board`: the messages marked :ticket:,
 * Open and Done, one with a long first line, one on its way to acc. `empty`: a board no message is on yet.
 * `scope`: the app lacks the scope to read the channel's history, which the board names.
 */
export function sampleSlackBoards(sample: SlackBoardSample = 'off'): BoardInput[] {
  const place = { workspace: 'acme', channel: 'C0123ABCD', prefix: null };
  const link = 'https://acme.slack.com/archives/C0999WXYZ/p1696512345123456';
  const read = slackLinkKey(link, place);
  const open = { id: 'open', name: 'Open', category: 'todo' as const };
  const done = { id: 'done', name: 'Done', category: 'done' as const };
  const card = (ts: string, title: string, s: typeof open | typeof done, who: { id: string; name: string }, fullTitle?: string) => ({
    key: `SL-${ts}`, title, url: `https://acme.slack.com/archives/C0123ABCD/p${ts}`, status: s, type: null, assignees: [who], labels: [], priority: null, ...(fullTitle ? { fullTitle } : {}),
  });
  const jordan = { id: 'U01', name: 'Jordan Kim' };
  const sam = { id: 'U02', name: 'Sam Lee' };
  const long = 'The invoice export drops the last row of every report since the Monday release, and the totals at the bottom no longer match the dashboard';
  const columns = [{ id: 'open', name: 'Open', category: 'todo' as const, statusIds: ['open'] }, { id: 'done', name: 'Done', category: 'done' as const, statusIds: ['done'] }];
  const board = sample === 'board' || sample === 'empty' ? {
    source: 'slack', title: 'Messages marked :ticket:', url: 'https://acme.slack.com/archives/C0123ABCD', columns,
    notice: sample === 'empty' ? 'No message from the last 30 days has the :ticket: reaction. Add it to a message in Slack, and it\'s on the board after a refresh.' : null,
    cards: sample === 'empty' ? [] : [
      card('1760000300000300', clip(long, SLACK_CARD_MAX), open, jordan, long),
      card('1760000250000250', 'Login page takes ten seconds on the first visit', open, sam),
      card('1760000220000220', 'Password reset email has the wrong logo', open, jordan),
      card('1760000200000200', 'Export button missing for read-only users', done, sam),
      card('1760000100000100', 'Typo on the pricing page', done, jordan),
    ],
  } : null;
  return [{
    index: 0, id: 'b-acme-slack', host: 'acme', narrowed: true, kind: 'slack', title: 'Slack · acme',
    error: sample === 'scope' ? `The Slack app needs the channels:history scope for conversations.history. Add it on the app's OAuth & Permissions page at ${SLACK_APPS}, then install the app again.` : null,
    connect: null, loading: false, signedInAs: 'Acme Command Center',
    signInScope: { shared: false, host: 'acme' }, place: 'Slack · acme · channel C0123ABCD', left: [], board,
    off: sample === 'off' || sample === 'refused' ? NO_REACTION : null,
    tracking: sample === 'board' ? { 'SL-1760000250000250': { busy: true, error: null } } : {},
    paste: { ...place, ...(sample === 'refused' ? { link, busy: false, error: read.ok ? null : read.error, tracked: null } : NO_PASTE) },
  }];
}

/**
 * The Jira board following the active sprint (T-78): its place names the sprint and its dates, it shows only
 * the sprint's tickets, and a task that started went back to the backlog when the last sprint closed.
 */
export function sampleSprintBoards(): BoardInput[] {
  const [jira] = sampleBoards();
  const sprints = [{ id: 13, name: 'ACME Sprint 13', state: 'active' as const, start: '2026-10-20T09:00:00.000Z', end: '2026-11-02T17:00:00.000Z' }];
  const inSprint = ['ACME-16', 'ACME-21', 'ACME-24', 'ACME-30', 'ACME-14', 'ACME-12', 'ACME-15', 'ACME-19', 'ACME-10'];
  return [{
    ...jira!, place: placeText({ kind: 'jira', project: 'ACME', sprint: 'active', sprints }), tracking: {},
    left: ['ACME-18 left this repo\'s place: it isn\'t in the active sprint; ACME-18 is still blocked'],
    board: { ...jira!.board!, cards: jira!.board!.cards.filter((c) => inSprint.includes(c.key)) },
  }];
}

/** How many boards a project holds in the Tasks tab's several-board samples (T-127). */
export type SeveralBoards = 2 | 4 | 10;

/**
 * A project with several boards (T-127). Two: the Jira epic's board, and a second board of the same project, its
 * Renewals epic, which shares a ticket with the first (one task, on both). Four: those, a GitHub repo's issues and a
 * board on a second Jira site. Ten: boards on three Jira sites, acme, globex and initech, and a GitHub repo; initech's
 * sign-in has run out, so its boards say why, in orange, and still switch.
 */
export function sampleSeveralBoards(n: SeveralBoards): BoardInput[] {
  const [jira] = sampleBoards();
  const cards = jira!.board!.cards;
  const pickCards = (keys: number[]) => cards.filter((c) => keys.includes(Number(c.key.slice('ACME-'.length))));
  const board = (i: number, o: { id: string; host: string; name?: string; epic: string; keys: number[]; title?: string; error?: boolean }): BoardInput => ({
    ...jira!, index: i, id: o.id, host: o.host, name: o.name ?? null, narrowed: true, title: `Jira · ${o.title ?? 'ACME'}`,
    place: `Jira · ${o.title ?? 'ACME'} · epic ${o.epic}`, left: [], tracking: {},
    signInScope: { shared: true, host: o.host },
    ...(o.error ? {
      board: null, signedInAs: null, me: null,
      error: `Sign in to Jira (${o.host}) for this repo to see its board and tickets.`,
      connect: { command: 'acc.trackers.signIn', label: 'Sign in to Jira', arg: JSON.stringify({ root: '/Users/me/code/acme-service', index: i }) },
    } : { board: { ...jira!.board!, title: `${o.title ?? 'ACME'} board`, cards: pickCards(o.keys) } }),
  });
  const [github] = sampleGithubBoards();
  const two: BoardInput[] = [
    jira!,
    // Its own name, and ACME-12, which the first board shows too: one task, on both.
    board(1, { id: 'b-acme-renewals', host: 'acme.atlassian.net', name: 'Renewals', epic: 'ACME-5 Renewals', keys: [12, 24, 28, 33, 8] }),
  ];
  if (n === 2) return two;
  const four = [...two, { ...github!, index: 2 }, board(3, { id: 'b-globex-portal', host: 'globex.atlassian.net', epic: 'GLX-2 Partner portal', title: 'GLX', keys: [23, 25, 27, 10] })];
  if (n === 4) return four;
  return [
    ...four,
    board(4, { id: 'b-globex-billing', host: 'globex.atlassian.net', name: 'Billing fixes', epic: 'GLX-9 Billing', title: 'GLX', keys: [21, 19, 15] }),
    board(5, { id: 'b-globex-support', host: 'globex.atlassian.net', epic: 'GLX-11 Support queue', title: 'GLX', keys: [30, 31, 34, 14] }),
    board(6, { id: 'b-acme-leads', host: 'acme.atlassian.net', name: 'Lead scoring', epic: 'ACME-8 Leads', keys: [22, 27, 33] }),
    board(7, { id: 'b-acme-cases', host: 'acme.atlassian.net', epic: 'ACME-9 Case management', keys: [16, 17, 32, 34] }),
    board(8, { id: 'b-initech-erp', host: 'initech.atlassian.net', name: 'ERP sync', epic: 'INI-4 ERP', title: 'INI', keys: [], error: true }),
    board(9, { id: 'b-initech-hr', host: 'initech.atlassian.net', epic: 'INI-7 HR onboarding', title: 'INI', keys: [], error: true }),
  ];
}
