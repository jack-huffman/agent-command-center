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
import type { Question } from '../../packages/core/src/questions.ts';
import { type AgentSession, askingLabel, type DoctorItem, type TaskRow } from '../src/logic.ts';
import { type AgentModel, agentModel, type BoardInput, type HubLike, type IdentityCard, type ProjectLike, type RunInput, ticketModel, type TicketModel } from '../src/model.ts';
import type { Entry } from '../src/transcript.ts';

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
    config: { github: { repo: 'acme/service', account: 'jordan-kim' }, environments, profile: 'salesforce' },
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
    task('ACME-14', 'Route web-to-case submissions by product line', 'running', 'needs-you', { run: { bgId: 'bg14', sessionId: 's-acme-14', worktree: wt('ACME-14') }, agent: { label: 'Needs you: wants permission', icon: 'bell', tone: 'orange' }, asking: true }),
    task('ACME-16', 'Add a field history report for Opportunity stage', 'todo', 'ready'),
    task('ACME-12', 'Case escalation rules for the premium tier', 'running', 'needs-you', { run: { bgId: 'bg12', sessionId: 's-acme-12', worktree: wt('ACME-12') }, agent: { label: 'Needs you: has a question', icon: 'bell', tone: 'orange' }, asking: true }),
    task('ACME-13', 'Close duplicate leads nightly', 'running', 'running', { run: { bgId: 'bg13', sessionId: 's-acme-13', worktree: wt('ACME-13') }, agent: { label: 'Working', icon: 'sync~spin', tone: 'blue' } }),
    task('ACME-15', 'Rename the Region picklist values', 'review', 'review', { run: { worktree: wt('ACME-15'), branch: 'task/ACME-15-a-very-long-branch-name-that-has-to-truncate-cleanly' }, review: { verdict: 'pass', summary: 'Renames the values and updates both record types.', current: true }, pr: { number: 42, url: 'https://github.com/acme/service/pull/42', state: 'open', ci: 'pending' } }),
    task('ACME-20', 'Show the renewal date on the Account page', 'review', 'review', { run: { worktree: wt('ACME-20'), branch: 'task/ACME-20-renewal-date' }, review: { verdict: 'pass', summary: 'Adds the field to the layout.', current: true } }),
    task('ACME-19', 'Fix the flow that double-sends welcome emails', 'rework', 'rework', { run: { worktree: wt('ACME-19') } }),
    task('ACME-18', 'Migrate the legacy territory triggers', 'blocked', 'blocked'),
    task('ACME-17', 'Dashboards for the escalation rules', 'todo', 'todo', { deps: ['ACME-12'] }),
    task('ACME-10', 'Add a CHANGELOG', 'done', 'done', { run: { worktree: wt('ACME-10') } }),
  ];
  const agents: AgentSession[] = [
    { cwd: wt('ACME-14'), kind: 'background', startedAt: now - 27 * MIN, id: 'bg14', sessionId: 's-acme-14', name: 'ACME-14', state: 'working', pid: 4010 },
    { cwd: wt('ACME-12'), kind: 'background', startedAt: now - 12 * MIN, id: 'bg12', sessionId: 's-acme-12', name: 'ACME-12', state: 'working', pid: 4012 },
    { cwd: wt('ACME-13'), kind: 'background', startedAt: now - 9 * MIN, id: 'bg13', sessionId: 's-acme-13', name: 'ACME-13', state: 'working', pid: 4013 },
    { cwd: wt('ACME-11'), kind: 'background', startedAt: now - 40 * MIN, id: 'bg11', sessionId: 's-acme-11', name: 'ACME-11', state: 'blocked', waitingFor: 'permission prompt', pid: 4011 },
    { cwd: root, kind: 'interactive', startedAt: now - 120 * MIN, sessionId: '0e02-main', name: 'acme-dev', status: 'busy', pid: 4100 },
    { cwd: '/Users/me/code/side-project', kind: 'interactive', startedAt: now - 30 * 60 * MIN, sessionId: '7c1d-side', name: 'side-project', status: 'idle', pid: 4200 },
    { cwd: '/Users/me/Documents/a folder with a long name/docs-site', kind: 'background', startedAt: now - 7 * 24 * 60 * MIN, id: 'bg3', name: 'docs-site', state: 'done' },
  ];
  const questions = sampleQuestions(now, wt);
  return {
    projects: [project], agents, agentsError: null, questions,
    askingFor: (s) => { const q = questions.find((x) => x.sessionId === s.sessionId); return q ? askingLabel(q.tool) : null; },
    taskRows: () => tasks,
    projectFor: (p: string) => (p === root || p.startsWith(`${root}/`) ? project : undefined),
    history: () => [
      { at: new Date(now - 4 * MIN).toISOString(), task: 'ACME-14', title: 'Route web-to-case submissions by product line', from: 'todo', to: 'running', by: 'human:jordan' },
      { at: new Date(now - 12 * MIN).toISOString(), task: 'ACME-12', title: 'Case escalation rules for the premium tier', from: 'todo', to: 'running', by: 'human:jordan' },
      { at: new Date(now - 95 * MIN).toISOString(), task: 'ACME-15', title: 'Rename the Region picklist values', from: 'running', to: 'review', by: 'builder:ACME-15' },
      { at: new Date(now - 26 * 60 * MIN).toISOString(), task: 'ACME-19', title: 'Fix the flow that double-sends welcome emails', from: 'review', to: 'rework', by: 'reviewer' },
      { at: new Date(now - 3 * 24 * 60 * MIN).toISOString(), task: 'ACME-10', title: 'Add a CHANGELOG', from: 'review', to: 'done', by: 'sync' },
    ],
  };
}

/** A permission prompt and a question with options, as `acc hook permission` leaves them. */
function sampleQuestions(now: number, wt: (id: string) => string): Question[] {
  const q = (id: string, sessionId: string, cwd: string, ago: number, tool: string, input: Record<string, unknown>, suggestions: unknown[] = []): Question =>
    ({ v: 1, id, pid: 1, at: now - ago * MIN, sessionId, cwd, transcript: null, tool, input, suggestions });
  return [
    q('m1-aaaa0001', 's-acme-14', wt('ACME-14'), 3, 'Bash', { command: 'sf apex run test --class-names CaseRoutingTest --target-org "Acme Dev" --wait 20', description: 'Run the routing tests in the Dev org' },
      [{ type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'sf apex run test:*' }], behavior: 'allow', destination: 'localSettings' }]),
    q('m1-aaaa0002', 's-acme-12', wt('ACME-12'), 1, 'AskUserQuestion', { questions: [{
      question: 'Premium cases escalate after how long without a reply?', header: 'Escalation', multiSelect: false,
      options: [{ label: '2 hours', description: 'Matches the premium SLA in the contract.' }, { label: '4 hours', description: 'What the standard tier uses today.' }, { label: 'Business hours only', description: 'Pause the clock outside the support hours.' }],
    }] }),
  ];
}

/** Commands acc ran from Setup: one asking a question, one that failed, one that worked. */
export function sampleRuns(now = Date.now()): RunInput[] {
  return [
    { id: 'r-login', label: 'Each branch points at the right org', command: 'sf org login web --alias "Acme Dev" --instance-url https://acme--dev.sandbox.my.salesforce.com', startedAt: now - 40_000, endedAt: null, code: null, stopped: false, step: 'B6.org-match',
      lines: ['Opening the browser to log in…', 'Waiting for you to sign in. Press Ctrl+C to cancel.', '', 'An org with the alias "Acme Dev" already exists.', 'Replace it? (y/n) '], prompt: { kind: 'yesno', text: 'Replace it? (y/n)' } },
    { id: 'r-npm', label: 'The required checks can run', command: 'npm install', startedAt: now - 5 * MIN, endedAt: now - 4 * MIN, code: 1, stopped: false, step: 'B13.gate-tools',
      lines: ['npm ERR! code ERESOLVE', 'npm ERR! ERESOLVE unable to resolve dependency tree', 'npm ERR! Found: eslint@9.12.0', 'npm ERR! Could not resolve dependency: peer eslint@"^8" from @salesforce/eslint-config-lwc@3.6.0'], prompt: null },
    { id: 'r-open', label: 'Open Dev', command: 'sf org open -o "Acme Dev"', startedAt: now - 9 * MIN, endedAt: now - 9 * MIN + 4000, code: 0, stopped: false, step: null, lines: ['Opening org Acme Dev as jordan@acme.example.dev…'], prompt: null },
  ];
}

/** ACME-14's activity: its instructions, what it said, the tools it used, and the prompt it's waiting on. */
export function sampleAgent(now = Date.now()): AgentModel {
  const at = (ago: number) => new Date(now - ago * MIN).toISOString();
  const cwd = '/Users/me/code/acme-service/.claude/worktrees/ACME-14';
  const tool = (id: string, ago: number, toolName: string, icon: string, title: string, code: string | null, status: 'running' | 'done' | 'error', result: string | null = null, more = 0): Entry =>
    ({ k: 'tool', id, at: at(ago), tool: toolName, icon, title, code, status, result, more });
  const entries: Entry[] = [
    { k: 'prompt', id: 'p1', at: at(27), instructions: true, text: `# ACME-14: Route web-to-case submissions by product line\n\nYou are a builder. Work in \`${cwd}\` on branch \`task/ACME-14-route-web-to-case\`.\n\n## Done when\n\n- Web-to-case submissions get the product line's queue.\n- The routing tests pass in the Dev org.\n\n${'Keep commits small. '.repeat(30)}` },
    { k: 'say', id: 's1', at: at(26), text: 'I\'ll start with the current assignment rules and the **web-to-case** form fields, then add a routing step keyed on `Product_Line__c`.' },
    tool('t1', 26, 'Bash', 'terminal', 'Check the branch and recent commits', 'git status && git log --oneline -3', 'done', 'On branch task/ACME-14-route-web-to-case\nnothing to commit, working tree clean\n9f1c2ab Case: add Product_Line__c\n41d0e77 Queues for each product line\n0b6a1f3 Initial'),
    tool('t2', 25, 'Read', 'file', 'Read force-app/main/default/classes/CaseRouting.cls', null, 'done'),
    tool('t3', 24, 'Grep', 'search', 'Searched for Product_Line__c in force-app', null, 'done', 'force-app/main/default/objects/Case/fields/Product_Line__c.field-meta.xml\nforce-app/main/default/classes/CaseRouting.cls'),
    tool('t4', 20, 'Edit', 'edit', 'Edited force-app/main/default/classes/CaseRouting.cls', null, 'done'),
    tool('t5', 18, 'Write', 'new-file', 'Wrote force-app/main/default/classes/CaseRoutingTest.cls', null, 'done'),
    tool('t6', 12, 'Bash', 'terminal', 'Format the changed Apex', 'npx prettier --write force-app/main/default/classes/CaseRouting.cls force-app/main/default/classes/CaseRoutingTest.cls', 'done', 'force-app/main/default/classes/CaseRouting.cls 182ms\nforce-app/main/default/classes/CaseRoutingTest.cls 64ms'),
    tool('t7', 9, 'Bash', 'terminal', 'Run the static checks', 'acc gate run static', 'error', '✗ static: 2 violations at severity 2 or worse\n  CaseRouting.cls:41  ApexCRUDViolation  Validate CRUD permission before SOQL/DML operation\n  CaseRouting.cls:57  ApexCRUDViolation  Validate CRUD permission before SOQL/DML operation'),
    { k: 'say', id: 's2', at: at(8), text: 'Two CRUD warnings, both on the queue lookup. I\'ll query `WITH USER_MODE` instead of checking by hand.' },
    tool('t8', 6, 'Edit', 'edit', 'Edited force-app/main/default/classes/CaseRouting.cls', null, 'done'),
    tool('t9', 5, 'Bash', 'terminal', 'Run the static checks', 'acc gate run static', 'done', '✓ static: no violations at severity 2 or worse'),
    { k: 'say', id: 's3', at: at(4), text: 'The static checks pass. Next, the routing tests in the Dev org.' },
    tool('t10', 3, 'Bash', 'terminal', 'Run the routing tests in the Dev org', 'sf apex run test --class-names CaseRoutingTest --target-org "Acme Dev" --wait 20', 'running'),
  ];
  return agentModel({ hub: sampleHub(now), key: 's-acme-14', seen: null, entries, readable: true, lastAt: at(3) });
}

/** Every real setup step, mostly passing, with one of each other status so every style shows. */
export function sampleSetup(): { items: DoctorItem[]; confirmed: Set<string> } {
  const odd: Record<string, Partial<DoctorItem>> = {
    'B2.identity': { status: 'fail', detail: 'Commits here would go out as someone@else.example.', fix: 'git config user.email you@example.com' },
    'B8.tracking': { status: 'unknown', detail: 'Turn on source tracking in Setup, then check again.' },
    'B10.readme': { status: 'skip', detail: 'Only one environment, so there is no map to show.' },
    'B6.org-match': { status: 'fail', detail: '"Acme Dev" is logged in to a different org than the dev branch names.' },
    'B13.gate-tools': { status: 'fail', detail: 'The format and lint checks need npm install first.', fix: 'npm install' },
    'B14.tickets': { status: 'fail', detail: 'Tickets come from Azure DevOps CRM in acme. This repo isn\'t signed in to Azure DevOps · CRM yet.', fix: 'acc.trackers.signIn' },
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
    index: 0, kind: 'jira', title: 'Jira · ACME', error: null, connect: null, loading: false, signedInAs: 'jordan@acme.example',
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
    project: ROOT, tracker: 0, trackerTitle: 'Jira · ACME', trackerKind: 'jira', key: 'ACME-12', ticket, loading: false, error: null, connect: null, row, task, signedInAs: 'jordan@acme.example',
    checks: [
      { gate: 'format', status: 'pass', summary: '3 changed files formatted.' },
      { gate: 'static', status: 'skip', summary: 'Waived by jordan: the 2 violations predate this change', waived: true },
      { gate: 'validate', status: 'fail', summary: '4 of 21 tests failed in Acme Dev: CaseRoutingTest.premiumEscalates' },
      { gate: 'lwc-tests', status: 'skip', summary: 'Not run on this commit' },
    ],
  });
}

/** This clone works as another account than the project's, and that account lacks Projects access. */
export function sampleIdentity(): IdentityCard {
  return {
    account: 'jordan-kim', initials: 'JK', from: 'clone', projectAccount: 'acme-bot', signedIn: true, scopes: ['repo', 'read:org', 'workflow'], projects: false,
    problem: null, pushesAs: 'jordan-kim', commit: 'Jordan Kim <jordan@acme.example>', profile: 'https://github.com/jordan-kim', others: 2,
  };
}
