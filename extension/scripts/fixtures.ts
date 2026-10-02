/**
 * Sample data for looking at the tabs (`npm run screenshot`). Generic names only, since this repo carries
 * no client data. It's shaped like the hub, and the real model functions turn it into what each tab
 * receives, so it can't drift from the types.
 */
import type { Environment } from '../../packages/core/src/config.ts';
import { STEPS } from '../../packages/core/src/onboarding/steps.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import { type AdfNode, fromAdf } from '../../packages/core/src/trackers/doc.ts';
import type { Ticket } from '../../packages/core/src/trackers/types.ts';
import type { AgentSession, DoctorItem, TaskRow } from '../src/logic.ts';
import { type BoardInput, type HubLike, type ProjectLike, ticketModel, type TicketModel } from '../src/model.ts';

const MIN = 60_000;

export function sampleHub(now = Date.now()): HubLike {
  const root = '/Users/me/code/acme-service';
  const wt = (id: string) => `${root}/.claude/worktrees/${id}`;
  const environments: Environment[] = [
    { name: 'Production', branch: 'production', type: 'production', org: 'Acme Production', default: false, protected: true, promotesTo: [] },
    { name: 'QA', branch: 'qa', type: 'partial', org: 'Acme QA', default: false, protected: false, promotesTo: ['production'] },
    { name: 'Dev', branch: 'dev', type: 'developer', org: 'Acme Dev', default: true, protected: false, promotesTo: ['qa', 'production'] },
  ];
  const project: ProjectLike = {
    name: 'Acme Service', root, branch: 'dev',
    config: { github: { repo: 'acme/service', account: 'me' }, environments, profile: 'salesforce' },
    worktrees: [
      { path: root, head: 'a1b2c3d', branch: 'dev', main: true, changed: 0, locked: false, prunable: false },
      { path: wt('ACME-12'), head: 'b2c3d4e', branch: 'task/ACME-12-case-escalation-rules', main: false, changed: 4, locked: false, prunable: false },
      { path: wt('ACME-15'), head: 'c3d4e5f', branch: 'task/ACME-15-a-very-long-branch-name-that-has-to-truncate-cleanly', main: false, changed: 0, locked: true, prunable: false },
      { path: wt('ACME-9'), head: 'd4e5f6a', branch: 'task/ACME-9-retired', main: false, changed: 0, locked: false, prunable: true },
    ],
  };
  const source = (n: number) => ({ kind: 'jira', url: `https://acme.atlassian.net/browse/ACME-${n}` });
  const task = (id: string, title: string, state: string, display: TaskRow['display'], extra: Partial<TaskRow> = {}): TaskRow =>
    ({ id, title, state, display, environment: 'dev', deps: [], source: source(Number(id.split('-')[1])), ...extra });
  const tasks: TaskRow[] = [
    task('ACME-14', 'Route web-to-case submissions by product line', 'running', 'needs-you', { run: { bgId: 'bg14', worktree: wt('ACME-14') }, agent: { label: 'Needs you: permission prompt', icon: 'bell-dot', tone: 'orange' } }),
    task('ACME-16', 'Add a field history report for Opportunity stage', 'todo', 'ready'),
    task('ACME-12', 'Case escalation rules for the premium tier', 'running', 'running', { run: { bgId: 'bg12', worktree: wt('ACME-12') }, agent: { label: 'Working', icon: 'sync~spin', tone: 'blue' } }),
    task('ACME-15', 'Rename the Region picklist values', 'review', 'review', { run: { worktree: wt('ACME-15') } }),
    task('ACME-19', 'Fix the flow that double-sends welcome emails', 'rework', 'rework', { run: { worktree: wt('ACME-19') } }),
    task('ACME-18', 'Migrate the legacy territory triggers', 'blocked', 'blocked'),
    task('ACME-17', 'Dashboards for the escalation rules', 'todo', 'todo', { deps: ['ACME-12'] }),
    task('ACME-10', 'Add a CHANGELOG', 'done', 'done', { run: { worktree: wt('ACME-10') } }),
  ];
  const agents: AgentSession[] = [
    { cwd: wt('ACME-14'), kind: 'background', startedAt: now - 27 * MIN, id: 'bg14', name: 'ACME-14', state: 'blocked', waitingFor: 'permission prompt' },
    { cwd: wt('ACME-12'), kind: 'background', startedAt: now - 12 * MIN, id: 'bg12', name: 'ACME-12', state: 'working' },
    { cwd: root, kind: 'interactive', startedAt: now - 120 * MIN, sessionId: '0e02-main', name: 'acme-dev', status: 'busy', pid: 4100 },
    { cwd: '/Users/me/code/side-project', kind: 'interactive', startedAt: now - 30 * 60 * MIN, sessionId: '7c1d-side', name: 'side-project', status: 'idle', pid: 4200 },
    { cwd: '/Users/me/Documents/a folder with a long name/docs-site', kind: 'background', startedAt: now - 7 * 24 * 60 * MIN, id: 'bg3', name: 'docs-site', state: 'done' },
  ];
  return {
    projects: [project], agents, agentsError: null,
    taskRows: () => tasks,
    projectFor: (p: string) => (p === root || p.startsWith(`${root}/`) ? project : undefined),
  };
}

/** Every real setup step, mostly passing, with one of each other status so every style shows. */
export function sampleSetup(): { items: DoctorItem[]; confirmed: Set<string> } {
  const odd: Record<string, Partial<DoctorItem>> = {
    'B2.identity': { status: 'fail', detail: 'Commits here would go out as someone@else.example.', fix: 'git config user.email you@example.com' },
    'B8.tracking': { status: 'unknown', detail: 'Turn on source tracking in Setup, then check again.' },
    'B10.readme': { status: 'skip', detail: 'Only one environment, so there is no map to show.' },
  };
  const items = STEPS.filter((s) => !s.planned).map((s): DoctorItem => ({ id: s.id, part: s.part, title: s.title, status: 'pass', detail: 'Looks right.', ...odd[s.id] }));
  return { items, confirmed: new Set() };
}

const ROOT = '/Users/me/code/acme-service';
const status = (id: string, name: string, category: 'todo' | 'doing' | 'done') => ({ id, name, category });
const TODO = status('1', 'To Do', 'todo');
const DOING = status('3', 'In Progress', 'doing');
const REVIEW = status('4', 'In Review', 'doing');
const QA = status('5', 'QA', 'doing');
const DONE = status('10', 'Done', 'done');

/** A Jira board with its own columns, the cards on it, and acc's tasks for some of them. */
export function sampleBoards(): BoardInput[] {
  const card = (n: number, title: string, s: { id: string; name: string }, type: string, extra: Partial<NonNullable<BoardInput['board']>['cards'][number]> = {}) =>
    ({ key: `ACME-${n}`, title, url: `https://acme.atlassian.net/browse/ACME-${n}`, status: s, type, assignees: [], labels: [], priority: 'Medium', ...extra });
  return [{
    index: 0, kind: 'jira', title: 'Jira · ACME', error: null, connect: null, loading: false,
    board: {
      source: 'jira-board', title: 'ACME Service board', url: 'https://acme.atlassian.net/jira/software/projects/ACME/boards/7', notice: null,
      columns: [
        { id: 'col-0', name: 'To Do', category: 'todo', statusIds: ['1'] }, { id: 'col-1', name: 'In Progress', category: 'doing', statusIds: ['3'] },
        { id: 'col-2', name: 'In Review', category: 'doing', statusIds: ['4'] }, { id: 'col-3', name: 'QA', category: 'doing', statusIds: ['5'] },
        { id: 'col-4', name: 'Done', category: 'done', statusIds: ['10'] },
      ],
      cards: [
        card(16, 'Add a field history report for Opportunity stage', TODO, 'Story', { priority: 'High', labels: [{ name: 'reporting', color: null }] }),
        card(17, 'Dashboards for the escalation rules', TODO, 'Task'),
        card(21, 'Contact roles missing on converted leads', TODO, 'Bug', { priority: 'Highest', assignees: [{ name: 'Pat Lee' }], labels: [{ name: 'sales', color: null }] }),
        card(14, 'Route web-to-case submissions by product line', DOING, 'Story', { assignees: [{ name: 'Jordan Kim' }] }),
        card(12, 'Case escalation rules for the premium tier', DOING, 'Story', { priority: 'High', assignees: [{ name: 'Jordan Kim' }], labels: [{ name: 'service', color: null }, { name: 'sla', color: null }] }),
        card(15, 'Rename the Region picklist values', REVIEW, 'Task', { priority: 'Low', assignees: [{ name: 'Pat Lee' }] }),
        card(19, 'Fix the flow that double-sends welcome emails', QA, 'Bug', { priority: 'High' }),
        card(10, 'Add a CHANGELOG', DONE, 'Task', { priority: 'Lowest' }),
      ],
    },
  }];
}

const p = (text: string, marks?: string[]): AdfNode => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks: marks.map((type) => ({ type })) } : {}) }] });

/** A Jira ticket with everything a description can hold, and the acc task working on it. */
export function sampleTicket(now = Date.now()): TicketModel {
  const hub = sampleHub(now);
  const row = hub.taskRows(ROOT).find((r) => r.id === 'ACME-12')!;
  const description: AdfNode = { type: 'doc', content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Premium-tier cases must escalate to the ' }, { type: 'text', text: 'Tier 2 queue', marks: [{ type: 'strong' }] }, { type: 'text', text: ' when they breach their SLA. Today they sit in the general queue until someone notices.' }] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Acceptance criteria' }] },
    { type: 'taskList', content: [
      { type: 'taskItem', attrs: { state: 'DONE' }, content: [{ type: 'text', text: 'Escalation rule for Priority = High and Tier = Premium' }] },
      { type: 'taskItem', attrs: { state: 'TODO' }, content: [{ type: 'text', text: 'Notify the account owner on escalation' }] },
      { type: 'taskItem', attrs: { state: 'TODO' }, content: [{ type: 'text', text: 'No change for Standard-tier cases' }] },
    ] },
    { type: 'panel', attrs: { panelType: 'warning' }, content: [p('Business hours come from the Premium Support schedule, not the default one.')] },
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Thresholds' }] },
    { type: 'table', content: [
      { type: 'tableRow', content: ['Priority', 'Escalate after'].map((h) => ({ type: 'tableHeader', content: [p(h)] })) },
      { type: 'tableRow', content: ['High', '2 business hours'].map((c) => ({ type: 'tableCell', content: [p(c)] })) },
      { type: 'tableRow', content: ['Medium', '8 business hours'].map((c) => ({ type: 'tableCell', content: [p(c)] })) },
    ] },
    { type: 'codeBlock', attrs: { language: 'apex' }, content: [{ type: 'text', text: "Case c = [SELECT Id FROM Case WHERE Tier__c = 'Premium' LIMIT 1];" }] },
  ] };
  const ticket: Ticket = {
    key: 'ACME-12', kind: 'jira', url: 'https://acme.atlassian.net/browse/ACME-12', title: 'Case escalation rules for the premium tier', type: 'Story',
    status: DOING, assignees: [{ id: 'a1', name: 'Jordan Kim' }], reporter: { id: 'a2', name: 'Pat Lee' },
    labels: [{ name: 'service', color: null }, { name: 'sla', color: null }], priority: 'High',
    created: new Date(now - 6 * 86_400_000).toISOString(), updated: new Date(now - 2 * 3_600_000).toISOString(),
    body: fromAdf(description), markdown: '',
    comments: [
      { id: '1', author: { id: 'a2', name: 'Pat Lee' }, created: new Date(now - 5 * 86_400_000).toISOString(), url: null, body: fromAdf({ type: 'doc', content: [p('Support confirmed the 2-hour threshold for High. Medium is still being decided.')] }) },
      { id: '2', author: { id: 'a1', name: 'Jordan Kim' }, created: new Date(now - 3 * 3_600_000).toISOString(), url: null, body: fromAdf({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Going with 8 hours for Medium, per ' }, { type: 'mention', attrs: { text: '@Pat Lee' } }, { type: 'text', text: '. Handed to an agent.' }] }] }) },
    ],
    related: [{ key: 'ACME-17', title: 'Dashboards for the escalation rules', relation: 'blocks', url: null }, { key: 'ACME-3', title: 'Premium Support', relation: 'parent', url: null }],
  };
  const task = {
    id: 'ACME-12', title: ticket.title, brief: '', source: { kind: 'jira', key: 'ACME-12', url: ticket.url }, environment: 'dev', deps: [], labels: [], state: 'running', blocker: null,
    run: { bgId: 'bg12', worktree: `${ROOT}/.claude/worktrees/ACME-12`, branch: 'task/ACME-12-case-escalation-rules' }, pr: null,
    history: [
      { at: new Date(now - 4 * 86_400_000).toISOString(), from: null, to: 'todo', by: 'human:me' },
      { at: new Date(now - 12 * 60_000).toISOString(), from: 'todo', to: 'running', by: 'human:me' },
    ],
    createdAt: new Date(now - 4 * 86_400_000).toISOString(), updatedAt: new Date(now - 12 * 60_000).toISOString(),
  } as unknown as Task;
  return ticketModel({
    project: ROOT, tracker: 0, trackerTitle: 'Jira · ACME', key: 'ACME-12', ticket, loading: false, error: null, connect: null, row, task,
    checks: [{ gate: 'format', status: 'pass', summary: '3 changed files formatted.' }, { gate: 'static', status: 'pass', summary: 'No violations at severity 2 or worse.' }, { gate: 'validate', status: 'skip', summary: 'Not run on this commit' }],
  });
}
