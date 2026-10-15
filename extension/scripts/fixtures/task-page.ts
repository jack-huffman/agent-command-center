/** A ticket's page: being built, to do with its analysis, stopped, sent back, being tracked, and waiting. */
import type { Task } from '../../../packages/core/src/ledger.ts';
import { type AdfNode, fromAdf } from '../../../packages/core/src/trackers/doc.ts';
import type { Ticket } from '../../../packages/core/src/trackers/types.ts';
import { ticketModel, type TicketModel } from '../../src/model/task-page.ts';
import { sampleAnalyses } from './analysis.ts';
import { DOING, DONE, REVIEW, sampleBoards, TODO } from './boards.ts';
import { sampleHub } from './hub.ts';
import { MIN, ROOT, wt } from './shared.ts';
import { sampleUpdates } from './updates.ts';

const p = (text: string, marks?: string[]): AdfNode => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks: marks.map((type) => ({ type })) } : {}) }] });

/**
 * Which ticket page to draw: ACME-12 being built, a task to do whose analysis has questions or says to
 * split it, one whose builder stopped, ACME-31, which acc doesn't keep yet, being tracked from its card,
 * ACME-35, which a person dispatched and which waits for other tasks' files (D-093), or ACME-20, in review
 * with its builder's note (D-106).
 */
export type TicketSample = 'ACME-12' | 'ACME-20' | 'ACME-21' | 'ACME-23' | 'ACME-29' | 'ACME-31' | 'ACME-33' | 'ACME-35' | 'ACME-44' | 'ACME-50';

/** A Jira ticket with everything a description can hold, and the acc task working on it. */
export function sampleTicket(now = Date.now(), which: TicketSample = 'ACME-12'): TicketModel {
  if (which === 'ACME-29') return sampleStoppedTicket(now);
  if (which === 'ACME-44') return sampleCloudTicket(now);
  if (which === 'ACME-50') return sampleNoFieldsTicket(now);
  if (which === 'ACME-31') return sampleUntrackedTicket(now);
  if (which === 'ACME-33') return sampleChecksTicket(now);
  if (which === 'ACME-35') return sampleWaitingTicket(now);
  if (which === 'ACME-20') return sampleNoteTicket(now);
  if (which !== 'ACME-12') return sampleTodoTicket(now, which);
  const hub = sampleHub(now);
  // Back with its builder after its pull request stopped merging into dev.
  const pr = { number: 38, url: 'https://github.com/acme/service/pull/38', state: 'open', ci: 'passing', changesRequested: false, conflicts: ['force-app/main/default/escalationRules/Case.escalationRules-meta.xml'] };
  const row = { ...hub.taskRows(ROOT).find((r) => r.id === 'ACME-12')!, pr };
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
    run: { bgId: 'bg12', worktree: wt('ACME-12'), branch: 'task/ACME-12-case-escalation-rules' }, pr,
    history: [
      { at: new Date(now - 4 * 86_400_000).toISOString(), from: null, to: 'todo', by: 'human:me' },
      { at: new Date(now - 3 * 86_400_000).toISOString(), from: 'todo', to: 'running', by: 'human:me' },
      // Its builder blocked in its own words, naming acc's commands; the page says them as processes (GH-163).
      { at: new Date(now - 2.5 * 86_400_000).toISOString(), from: 'running', to: 'blocked', by: 'builder:ACME-12', reason: 'acc gate run errors on validate: the Acme Dev login has expired. Log in to Acme Dev again, then I can run acc gate run.' },
      { at: new Date(now - 2.4 * 86_400_000).toISOString(), from: 'blocked', to: 'running', by: 'human:me' },
      { at: new Date(now - 2 * 86_400_000).toISOString(), from: 'running', to: 'review', by: 'builder:ACME-12' },
      { at: new Date(now - 30 * 60_000).toISOString(), from: 'review', to: 'rework', by: 'human:me', reason: 'Pull request #38 conflicts with dev in the Case escalation rules. The rule entries for High and Medium both changed on dev since this branch started: dev added a Low entry and reordered the criteria, so the merge needs a person. Checks on 4f2a9c1: format passed; static found the 2 known sev-2 violations in CaseRouting.cls; validate ran CaseRoutingTest and EscalationRulesTest in Acme Dev, 19 of 21 passing, with the 2 known failures in premiumEscalates.' },
      { at: new Date(now - 12 * 60_000).toISOString(), from: 'rework', to: 'running', by: 'human:me' },
    ],
    createdAt: new Date(now - 4 * 86_400_000).toISOString(), updatedAt: new Date(now - 12 * 60_000).toISOString(),
  } as unknown as Task;
  return ticketModel({
    project: ROOT, tracker: 0, trackerTitle: 'Jira · ACME', trackerKind: 'jira', key: 'ACME-12', ticket, loading: false, error: null, connect: null, row, task, signedInAs: 'jordan@acme.example',
    analysis: sampleAnalyses(now)['ACME-12'],
    // A client's Jira: its fields are read-only here, and its update waits for you to post it (D-066).
    trackerEdits: false, updates: sampleUpdates(now), boards: sampleBoards(), github: 'jordan-kim', now,
    checks: [
      { gate: 'format', status: 'pass', summary: '3 changed files formatted.' },
      { gate: 'static', status: 'skip', summary: 'Waived by jordan: the 2 violations predate this change', waived: true },
      { gate: 'validate', status: 'fail', summary: '4 of 21 tests failed in Acme Dev: CaseRoutingTest.premiumEscalates', counts: '21 run, 4 failed, 0 skipped' },
      // Ratchets (GH-99): one that got better, and one that got worse, which has no Waive….
      { gate: 'apex-coverage', status: 'pass', summary: 'Apex coverage 81, at its floor.', ratchet: { label: 'Apex coverage', limit: 'floor', from: 78, to: 81, diff: 3, numbers: '78 → 81 (+3)', line: 'Apex coverage 78 → 81 (+3)' } },
      { gate: 'violations', status: 'fail', summary: 'violations 6 is above its ceiling 4, by 2. Make it 4 or better. If this change has to make it worse, block and say why: only a person relaxes a ceiling.', ratchet: { label: 'violations', limit: 'ceiling', from: 4, to: 6, diff: 2, numbers: '4 → 6 (+2)', line: 'violations 4 → 6 (+2)' } },
      // A test check that skipped more than dev's last count: a person decides (GH-100).
      { gate: 'flow-tests', status: 'hold', summary: '2 skipped, up from 0 on 4f2a9c1: OrderFlowTest.discount, OrderFlowTest.tax newly skipped.', counts: '38 run, 2 skipped' },
      { gate: 'lwc-tests', status: 'skip', summary: 'Not run on this commit' },
      { gate: 'stray-files', status: 'fail', summary: 'This change adds 2 files that shouldn\'t be committed: fb-test.log (a log, temp file or merge leftover), exports/accounts.csv (a data export). Take each out of the commit with git rm --cached fb-test.log exports/accounts.csv and add it to .gitignore, or, if it belongs in the repo, list it under "strayFiles.allow" in .acc/config.json, or a data file\'s folder under "strayFiles.data".' },
    ],
  });
}

/**
 * A Slack thread (T-28, T-29): Slack has no status, assignee or labels, so the page names it where each
 * control would be, with Slack's name and icon. Its replies post as the app.
 */
function sampleNoFieldsTicket(now: number): TicketModel {
  const ticket: Ticket = {
    key: 'SL-1696512345123456', kind: 'slack', url: 'https://acme.slack.com/archives/C0SUPPORT1/p1696512345123456', title: 'Customer asks why a premium case was not escalated', type: null,
    status: TODO, assignees: [], reporter: { id: 'a2', name: 'Pat Lee' }, labels: [], priority: null,
    created: new Date(now - 3 * 3_600_000).toISOString(), updated: new Date(now - 20 * MIN).toISOString(),
    body: fromAdf({ type: 'doc', content: [p('A customer wrote that their premium case sat for two hours with no reply. Find out why the escalation rule did not run.')] }),
    markdown: '', comments: [], related: [],
  };
  return ticketModel({
    project: ROOT, tracker: 0, trackerTitle: 'Slack · acme', trackerKind: 'slack', key: 'SL-1696512345123456', ticket, loading: false, error: null, connect: null, row: null, task: null, checks: [],
    signedInAs: 'Acme Command Center', trackerEdits: true, trackerFields: [], boards: sampleBoards(), github: 'jordan-kim', now,
  });
}

/** A builder in the cloud, quiet for too long (GH-69): where it runs, its session's page, and the cloud's own actions. */
function sampleCloudTicket(now: number): TicketModel {
  const row = sampleHub(now).taskRows(ROOT).find((r) => r.id === 'ACME-44')!;
  const ticket: Ticket = {
    key: 'ACME-44', kind: 'jira', url: 'https://acme.atlassian.net/browse/ACME-44', title: row.title, type: 'Story',
    status: DOING, assignees: [{ id: 'a1', name: 'Jordan Kim' }], reporter: { id: 'a2', name: 'Pat Lee' }, labels: [{ name: 'sales', color: null }], priority: 'Medium',
    created: new Date(now - 4 * 86_400_000).toISOString(), updated: new Date(now - 150 * MIN).toISOString(),
    body: fromAdf({ type: 'doc', content: [p('New leads all land on one rep. Share them round the inside sales team in turn, skipping anyone out of office.')] }),
    markdown: '', comments: [], related: [],
  };
  const task = {
    id: 'ACME-44', title: row.title, brief: '', source: { kind: 'jira', key: 'ACME-44', url: ticket.url }, environment: 'dev', deps: [], labels: [], state: 'running', blocker: null, run: row.run, pr: null,
    history: [
      { at: new Date(now - 4 * 86_400_000).toISOString(), from: null, to: 'todo', by: 'human:jordan' },
      { at: new Date(now - 200 * MIN).toISOString(), from: 'todo', to: 'running', by: 'human:jordan' },
    ],
    createdAt: new Date(now - 4 * 86_400_000).toISOString(), updatedAt: new Date(now - 150 * MIN).toISOString(),
  } as unknown as Task;
  return ticketModel({
    project: ROOT, tracker: 0, trackerTitle: 'Jira · ACME', trackerKind: 'jira', key: 'ACME-44', ticket, loading: false, error: null, connect: null, row, task, signedInAs: 'jordan@acme.example',
    trackerEdits: false, updates: [], boards: sampleBoards(), github: 'jordan-kim', now,
    checks: ['format', 'static', 'validate'].map((gate) => ({ gate, status: 'skip' as const, summary: 'Not run on this commit' })),
  });
}

/** A running task whose builder stopped before acc done (D-067): its page quotes it in full, and offers Resume. */
function sampleStoppedTicket(now: number): TicketModel {
  const row = sampleHub(now).taskRows(ROOT).find((r) => r.id === 'ACME-29')!;
  const ticket: Ticket = {
    key: 'ACME-29', kind: 'jira', url: 'https://acme.atlassian.net/browse/ACME-29', title: row.title, type: 'Story',
    status: DOING, assignees: [{ id: 'a1', name: 'Jordan Kim' }], reporter: { id: 'a2', name: 'Pat Lee' }, labels: [{ name: 'service', color: null }], priority: 'Medium',
    created: new Date(now - 3 * 86_400_000).toISOString(), updated: new Date(now - 70 * MIN).toISOString(),
    body: fromAdf({ type: 'doc', content: [p('When a case owner leaves, their open cases sit unassigned until someone notices. Reassign them to the owner\'s manager.')] }),
    markdown: '', comments: [], related: [],
  };
  const task = {
    id: 'ACME-29', title: row.title, brief: '', source: { kind: 'jira', key: 'ACME-29', url: ticket.url }, environment: 'dev', deps: [], labels: [], state: 'running', blocker: null, run: row.run, pr: null,
    history: [
      { at: new Date(now - 3 * 86_400_000).toISOString(), from: null, to: 'todo', by: 'human:jordan' },
      { at: new Date(now - 70 * MIN).toISOString(), from: 'todo', to: 'running', by: 'human:jordan' },
    ],
    createdAt: new Date(now - 3 * 86_400_000).toISOString(), updatedAt: new Date(now - 70 * MIN).toISOString(),
  } as unknown as Task;
  return ticketModel({
    project: ROOT, tracker: 0, trackerTitle: 'Jira · ACME', trackerKind: 'jira', key: 'ACME-29', ticket, loading: false, error: null, connect: null, row, task, signedInAs: 'jordan@acme.example',
    trackerEdits: false, updates: [], boards: sampleBoards(), github: 'jordan-kim', now,
    checks: ['format', 'static', 'validate'].map((gate) => ({ gate, status: 'skip' as const, summary: 'Not run on this commit' })),
  });
}

/** A task autopilot sent back to its builder because its pull request's checks failed on GitHub (D-076). */
function sampleChecksTicket(now: number): TicketModel {
  const row = sampleHub(now).taskRows(ROOT).find((r) => r.id === 'ACME-33')!;
  const ticket: Ticket = {
    key: 'ACME-33', kind: 'jira', url: 'https://acme.atlassian.net/browse/ACME-33', title: row.title, type: 'Story',
    status: REVIEW, assignees: [], reporter: { id: 'a2', name: 'Pat Lee' }, labels: [{ name: 'sales', color: null }], priority: 'Medium',
    created: new Date(now - 2 * 86_400_000).toISOString(), updated: new Date(now - 3 * MIN).toISOString(),
    body: fromAdf({ type: 'doc', content: [p('Leads from bigger companies should score higher. Add the employee count to the lead score, capped at 20 points.')] }),
    markdown: '', comments: [], related: [],
  };
  const task = {
    id: 'ACME-33', title: row.title, brief: '', source: { kind: 'jira', key: 'ACME-33', url: ticket.url }, environment: 'dev', deps: [], labels: [], state: 'rework', blocker: null,
    // Its card couldn't follow it to In Progress (D-126).
    card: { state: 'rework', column: 'In Progress', at: new Date(now - 300_000).toISOString(), failed: 'gh couldn\'t read the Project: give jordan-kim access to Projects with gh auth refresh -h github.com -s project.' },
    run: row.run, pr: row.pr,
    history: [
      { at: new Date(now - 2 * 86_400_000).toISOString(), from: null, to: 'todo', by: 'human:jordan' },
      { at: new Date(now - 26 * 60 * MIN).toISOString(), from: 'todo', to: 'running', by: 'human:jordan' },
      { at: new Date(now - 25 * 60 * MIN).toISOString(), from: 'running', to: 'review', by: 'builder:ACME-33' },
      { at: new Date(now - 3 * MIN).toISOString(), from: 'review', to: 'rework', by: 'orchestrator:autopilot', reason: 'Checks failed on GitHub on 9a8b7c6: validate, Apex tests.' },
    ],
    createdAt: new Date(now - 2 * 86_400_000).toISOString(), updatedAt: new Date(now - 3 * MIN).toISOString(),
  } as unknown as Task;
  return ticketModel({
    project: ROOT, tracker: 0, trackerTitle: 'Jira · ACME', trackerKind: 'jira', key: 'ACME-33', ticket, loading: false, error: null, connect: null, row, task, signedInAs: 'jordan@acme.example',
    trackerEdits: false, updates: [], boards: sampleBoards(), github: 'jordan-kim', now,
    checks: [
      { gate: 'format', status: 'pass', summary: '2 changed files formatted.' },
      { gate: 'validate', status: 'pass', summary: 'Validated in Acme Dev: LeadScoringTest, 12 of 12 passing.', counts: '12 run, 0 skipped' },
    ],
  });
}

/**
 * A task in review whose builder finished with a note (D-106): what landed, which numbers moved, and
 * what's still open, with a Make a task on each still-open line. One line runs long, to wrap.
 */
function sampleNoteTicket(now: number): TicketModel {
  const row = sampleHub(now).taskRows(ROOT).find((r) => r.id === 'ACME-20')!;
  const ticket: Ticket = {
    key: 'ACME-20', kind: 'jira', url: 'https://acme.atlassian.net/browse/ACME-20', title: row.title, type: 'Story',
    status: REVIEW, assignees: [{ id: 'a1', name: 'Jordan Kim' }], reporter: { id: 'a2', name: 'Pat Lee' }, labels: [{ name: 'sales', color: null }], priority: 'Medium',
    created: new Date(now - 3 * 86_400_000).toISOString(), updated: new Date(now - 40 * MIN).toISOString(),
    body: fromAdf({ type: 'doc', content: [p('Account managers miss renewals because the renewal date sits on the contract. Show it on the Account page, beside the contract end date.')] }),
    markdown: '', comments: [], related: [],
  };
  const finished = new Date(now - 42 * MIN).toISOString();
  const task = {
    id: 'ACME-20', title: row.title, brief: '', source: { kind: 'jira', key: 'ACME-20', url: ticket.url }, environment: 'dev', deps: [], labels: [], state: 'review', blocker: null,
    run: {
      ...row.run, n: 1, name: 'Acme Service · ACME-20 Show the renewal date on the Account page · builder',
      note: {
        landed: ['The Account page shows the renewal date beside the contract end date', '`Renewal_Date__c` is read-only for everyone but Sales Ops'],
        moved: ['Apex tests: 41 of 41 passing, 2 added', 'validate passes in Acme Dev'],
        open: [
          'The renewal date isn\'t on the Account list views yet',
          'Sales Ops asked for an email to the account owner 60 days before each renewal, which needs its own flow and a decision on who else is copied',
        ],
        at: finished, by: 'builder:ACME-20', ended: 'review',
      },
    },
    pr: null,
    history: [
      { at: new Date(now - 3 * 86_400_000).toISOString(), from: null, to: 'todo', by: 'human:jordan' },
      { at: new Date(now - 3 * 3_600_000).toISOString(), from: 'todo', to: 'running', by: 'human:jordan' },
      { at: finished, from: 'running', to: 'review', by: 'builder:ACME-20' },
    ],
    createdAt: new Date(now - 3 * 86_400_000).toISOString(), updatedAt: finished,
  } as unknown as Task;
  return ticketModel({
    project: ROOT, tracker: 0, trackerTitle: 'Jira · ACME', trackerKind: 'jira', key: 'ACME-20', ticket, loading: false, error: null, connect: null, row, task, signedInAs: 'jordan@acme.example',
    trackerEdits: false, updates: [], boards: sampleBoards(), github: 'jordan-kim', now,
    checks: [
      { gate: 'format', status: 'pass', summary: '3 changed files formatted.' },
      { gate: 'validate', status: 'pass', summary: 'Validated in Acme Dev: AccountRenewalTest, 41 of 41 passing.' },
    ],
  });
}

/** A ticket acc doesn't keep yet, while its card's Track is on its way: its page says Tracking… too (D-074). */
function sampleUntrackedTicket(now: number): TicketModel {
  const ticket: Ticket = {
    key: 'ACME-31', kind: 'jira', url: 'https://acme.atlassian.net/browse/ACME-31', title: 'Email the account owner when a premium case is opened', type: 'Task',
    status: TODO, assignees: [], reporter: { id: 'a2', name: 'Pat Lee' }, labels: [], priority: 'High',
    created: new Date(now - 86_400_000).toISOString(), updated: new Date(now - 40 * MIN).toISOString(),
    body: fromAdf({ type: 'doc', content: [p('Account owners hear about a new premium case only when it escalates. Email them as soon as one is opened, with its subject and priority.')] }),
    markdown: '', comments: [], related: [{ key: 'ACME-3', title: 'Premium Support', relation: 'parent', url: null }],
  };
  return ticketModel({
    project: ROOT, tracker: 0, trackerTitle: 'Jira · ACME', trackerKind: 'jira', key: 'ACME-31', ticket, loading: false, error: null, connect: null, row: null, task: null, checks: [],
    signedInAs: 'jordan@acme.example', trackerEdits: false, boards: sampleBoards(), github: 'jordan-kim', tracking: true, now,
  });
}

/** A task a person dispatched that waits for other tasks' files, each named in full on its page (D-093). */
function sampleWaitingTicket(now: number): TicketModel {
  const row = sampleHub(now).taskRows(ROOT).find((r) => r.id === 'ACME-35')!;
  const ticket: Ticket = {
    key: 'ACME-35', kind: 'jira', url: 'https://acme.atlassian.net/browse/ACME-35', title: row.title, type: 'Story',
    status: TODO, assignees: [{ id: 'a1', name: 'Jordan Kim' }], reporter: { id: 'a2', name: 'Pat Lee' }, labels: [{ name: 'sla', color: null }], priority: 'High',
    created: new Date(now - 86_400_000).toISOString(), updated: new Date(now - 6 * MIN).toISOString(),
    body: fromAdf({ type: 'doc', content: [p('A premium case with no reply for an hour goes to the Tier 2 queue, on the Premium Support schedule.')] }),
    markdown: '', comments: [], related: [],
  };
  const task = {
    id: 'ACME-35', title: row.title, brief: '', source: { kind: 'jira', key: 'ACME-35', url: ticket.url }, environment: 'dev', deps: [], labels: [], state: 'todo', blocker: null, run: null, pr: null,
    history: [{ at: new Date(now - 86_400_000).toISOString(), from: null, to: 'todo', by: 'human:jordan' }],
    createdAt: new Date(now - 86_400_000).toISOString(), updatedAt: new Date(now - 6 * MIN).toISOString(),
  } as unknown as Task;
  return ticketModel({
    project: ROOT, tracker: 0, trackerTitle: 'Jira · ACME', trackerKind: 'jira', key: 'ACME-35', ticket, loading: false, error: null, connect: null, row, task, signedInAs: 'jordan@acme.example',
    analysis: { ...sampleAnalyses(now)['ACME-16']!, task: 'ACME-35' }, trackerEdits: false, updates: [], boards: sampleBoards(), github: 'jordan-kim', now, checks: ['format', 'static', 'validate'].map((gate) => ({ gate, status: 'skip' as const, summary: 'Not run yet' })),
  });
}

/** A task to do, tracked from Jira, with its analysis on its page (D-052): questions to answer, or a split. */
function sampleTodoTicket(now: number, key: 'ACME-21' | 'ACME-23'): TicketModel {
  const row = sampleHub(now).taskRows(ROOT).find((r) => r.id === key)!;
  const bug = key === 'ACME-21';
  const ticket: Ticket = {
    key, kind: 'jira', url: `https://acme.atlassian.net/browse/${key}`, title: row.title, type: bug ? 'Bug' : 'Epic',
    status: TODO, assignees: bug ? [{ id: 'a2', name: 'Pat Lee' }] : [], reporter: { id: 'a1', name: 'Jordan Kim' },
    labels: bug ? [{ name: 'sales', color: null }] : [{ name: 'partners', color: null }], priority: bug ? 'Highest' : 'Medium',
    created: new Date(now - 2 * 86_400_000).toISOString(), updated: new Date(now - 18 * MIN).toISOString(),
    body: fromAdf({ type: 'doc', content: bug
      ? [p('When a sales rep converts a lead and creates an opportunity, the opportunity has no contact roles. Reps add them by hand, and often forget.'), p('Seen in production since the spring release.')]
      : [p('The partner portal is a set of Visualforce pages that nobody wants to touch. Move partners onto an Experience Cloud site, with deal registration.')] }),
    markdown: '', comments: [], related: [],
  };
  const task = {
    id: key, title: row.title, brief: '', source: { kind: 'jira', key, url: ticket.url }, environment: 'dev', deps: [], labels: [], state: 'todo', blocker: null, run: null, pr: null,
    history: [{ at: new Date(now - 2 * 86_400_000).toISOString(), from: null, to: 'todo', by: 'human:jordan' }],
    createdAt: new Date(now - 2 * 86_400_000).toISOString(), updatedAt: new Date(now - 18 * MIN).toISOString(),
  } as unknown as Task;
  return ticketModel({
    project: ROOT, tracker: 0, trackerTitle: 'Jira · ACME', trackerKind: 'jira', key, ticket, loading: false, error: null, connect: null, row, task, signedInAs: 'jordan@acme.example',
    analysis: sampleAnalyses(now)[key], trackerEdits: false, updates: sampleUpdates(now), boards: sampleBoards(), github: 'jordan-kim', now, checks: ['format', 'static', 'validate'].map((gate) => ({ gate, status: 'skip' as const, summary: 'Not run yet' })),
  });
}
