/**
 * Jira Service Management queues as boards (T-128): a project with two queue boards, as the Tasks tab and
 * Settings' Trackers and sign-ins show them, and the Connect page with a service desk's queues as cards.
 */
import { JIRA } from '../../../packages/core/src/trackers/connect.ts';
import { JIRA_PRIORITY } from '../../../packages/core/src/trackers/jira.ts';
import { noAgentWords, statusColumns } from '../../../packages/core/src/trackers/jira-queue.ts';
import { placeKey } from '../../../packages/core/src/trackers/preview.ts';
import { type Board, placeText, type Status } from '../../../packages/core/src/trackers/types.ts';
import type { BoardInput } from '../../src/model/boards.ts';
import { blankConnect, connectModel, type ConnectModel, type ConnectState, connectValues } from '../../src/model/connect.ts';
import { ROOT } from './shared.ts';

const OPEN: Status = { id: '1', name: 'Open', category: 'todo' };
const WAITING_CUSTOMER: Status = { id: '3', name: 'Waiting for customer', category: 'doing' };
const IN_PROGRESS: Status = { id: '4', name: 'In progress', category: 'doing' };
const RESOLVED: Status = { id: '5', name: 'Resolved', category: 'done' };
const DESK = 'Acme Support';

/** The service desk's queues, as Get queues gives them: Unassigned issues and Waiting for support. */
export const SAMPLE_QUEUES = [
  { id: 12, name: 'Unassigned issues', count: 4 },
  { id: 14, name: 'Waiting for support', count: 3 },
  { id: 15, name: 'Resolved in the last week', count: 9 },
];

/** A queue's board as JiraClient gives it: its tickets, and their statuses as its columns. */
function queueBoard(queue: { id: number; name: string }, tickets: [number, string, Status, string, string | null][]): Board {
  const cards = tickets.map(([n, title, status, priority, who]) => ({
    key: `ACME-${n}`, title, url: `https://acme.atlassian.net/browse/ACME-${n}`, status, type: 'Service request', typeKind: 'task' as const, typeColor: null,
    assignees: who ? [{ id: who.toLowerCase().replace(' ', '-'), name: who }] : [], labels: [], priority, priorityLevel: JIRA_PRIORITY[priority.toLowerCase()] ?? null,
  }));
  return {
    source: 'jira-queue', title: queue.name, url: `https://acme.atlassian.net/jira/servicedesk/projects/ACME/queues/custom/${queue.id}`,
    columns: statusColumns(cards.map((c) => c.status)), cards, notice: null,
    place: placeText({ kind: 'jira', project: 'ACME', queue: queue.id, queueName: queue.name, deskName: DESK }),
  };
}

/** Two queue boards on one project (T-128), each its own tracker, signed in with the site's sign-in (D-091). */
export function sampleQueueBoards(): BoardInput[] {
  const [unassigned, waiting] = SAMPLE_QUEUES;
  const boards = [
    queueBoard(unassigned!, [
      [61, 'Password reset email never arrives', OPEN, 'High', null],
      [62, 'Invoice PDF shows the wrong VAT number', OPEN, 'Medium', null],
      [63, 'Cannot add a second admin to the account', OPEN, 'Medium', null],
      [64, 'Export to CSV times out on large reports', IN_PROGRESS, 'Low', null],
    ]),
    queueBoard(waiting!, [
      [55, 'Renewal quote is missing the discount', WAITING_CUSTOMER, 'High', 'Jordan Kim'],
      [57, 'Single sign-on loops back to the login page', IN_PROGRESS, 'Highest', 'Avery Park'],
      [58, 'Refund for a duplicate charge', RESOLVED, 'Medium', 'Jordan Kim'],
    ]),
  ];
  return boards.map((board, index) => ({
    index, kind: 'jira', title: 'Jira · ACME', board, place: board.place, error: null, connect: null, loading: false,
    signedInAs: 'jordan@acme.example', me: { id: 'jordan-kim', name: 'Jordan Kim' }, signInScope: { shared: true, host: 'acme.atlassian.net' }, tracking: {},
  }));
}

/**
 * The Connect page's Jira steps for a service desk (T-128): signed in, ACME picked, its queues as cards with
 * their ticket counts, two ticked, so the epics, board and sprint step aside, and the first queue's board in
 * the preview. `refused`: the sign-in isn't one of the service desk's agents, which is said in plain words,
 * and its epics are offered as before.
 */
export function sampleQueueConnect(refused = false): ConnectModel {
  const s = blankConnect(JIRA, { id: refused ? 'c-queues-refused' : 'c-queues', root: ROOT, projectName: 'Acme Service', ownRepo: 'acme/service', ghAccount: 'jordan-kim', from: 'tasks', gitEmail: 'jordan.kim@example.com' });
  const ready = (options: ConnectState['pickers'][string]['options'], selected: string[] = []): ConnectState['pickers'][string] => ({ options, selected, state: 'ready', error: null });
  s.host = 'acme.atlassian.net';
  s.signIn = { state: 'ok', who: 'Jordan Kim', error: null, again: false, shared: true };
  s.pickers.project = ready([{ value: 'ACME', label: 'ACME', detail: 'Acme Service Desk' }, { value: 'OPS', label: 'OPS', detail: 'Operations' }], ['ACME']);
  s.pickers.epics = ready([{ value: 'ACME-31', label: 'ACME-31', detail: 'Renewals' }, { value: 'ACME-30', label: 'ACME-30', detail: 'Partner portal' }]);
  s.pickers.board = ready([{ value: '7', label: 'ACME Service board', detail: 'Scrum', preferred: true }], ['7']);
  s.pickers.sprint = ready([]);
  if (refused) {
    s.pickers.queues = { options: [], selected: [], state: 'failed', error: noAgentWords('ACME') };
  } else {
    s.pickers.queues = ready(SAMPLE_QUEUES.map((q) => ({ value: String(q.id), label: q.name, detail: `${q.count} tickets` })), ['12', '14']);
  }
  const [unassigned] = sampleQueueBoards();
  s.boards[placeKey(connectValues(s, JIRA))] = { state: 'ready', board: refused ? { ...unassigned!.board!, source: 'jira-board', title: 'ACME Service board', place: 'Jira · ACME' } as Board : unassigned!.board as Board, none: null, error: null };
  return connectModel(s);
}
