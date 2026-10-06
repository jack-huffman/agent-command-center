/**
 * Sample data for looking at the tabs (`npm run screenshot`). Generic names only, since this repo carries
 * no client data. It's shaped like the hub, and the real model functions turn it into what each tab
 * receives, so it can't drift from the types.
 */
import type { Analysis } from '../../packages/core/src/analyze.ts';
import type { AutopilotRecord } from '../../packages/core/src/autopilot.ts';
import type { Environment } from '../../packages/core/src/config.ts';
import { STEPS } from '../../packages/core/src/onboarding/steps.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import { type AdfNode, fromAdf } from '../../packages/core/src/trackers/doc.ts';
import type { Ticket } from '../../packages/core/src/trackers/types.ts';
import type { HistoryRecord, Question } from '../../packages/core/src/questions.ts';
import type { Update } from '../../packages/core/src/updates.ts';
import { type AgentSession, askingLabel, type DoctorItem, rowAnalysis, type TaskRow } from '../src/logic.ts';
import { AZURE, GITHUB, JIRA } from '../../packages/core/src/trackers/connect.ts';
import { type AgentModel, agentModel, blankConnect, type BoardInput, type ConnectModel, connectModel, type ConnectState, type HubLike, type IdentityCard, type ProjectLike, type RunInput, ticketModel, type TicketModel } from '../src/model.ts';
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
    agents: {
      builder: { model: 'opus', effort: 'high', fallbackModel: 'sonnet', from: { model: 'project', effort: 'project', fallbackModel: 'project' } },
      reviewer: { model: 'sonnet', effort: null, fallbackModel: null, from: { model: 'clone', effort: 'default', fallbackModel: 'default' } },
    },
    // Autopilot may review, land, re-dispatch a rework once (D-055), resume a stopped builder once (D-067) and
    // merge the base into a conflicting pull request (D-058); it runs while a person has it on (D-064).
    // Its one tracker, the board below: which tracker owns a ticket's key is who its update posts as (D-066).
    config: { github: { repo: 'acme/service', account: 'jordan-kim' }, environments, profile: 'salesforce', autonomy: 'review', trackers: [{ kind: 'jira', project: 'ACME', prefix: null }] },
    worktrees: [
      { path: root, head: 'a1b2c3d', branch: 'dev', main: true, changed: 0, locked: false, prunable: false },
      { path: wt('ACME-12'), head: 'b2c3d4e', branch: 'task/ACME-12-case-escalation-rules', main: false, changed: 4, locked: false, prunable: false },
      { path: wt('ACME-15'), head: 'c3d4e5f', branch: 'task/ACME-15-a-very-long-branch-name-that-has-to-truncate-cleanly', main: false, changed: 0, locked: true, prunable: false },
      { path: wt('ACME-9'), head: 'd4e5f6a', branch: 'task/ACME-9-retired', main: false, changed: 0, locked: false, prunable: true },
    ],
  };
  const source = (n: number) => ({ kind: 'jira', url: `https://acme.atlassian.net/browse/ACME-${n}` });
  // A Salesforce project wants an analysis before each build (D-052).
  const task = (id: string, title: string, state: string, display: TaskRow['display'], extra: Partial<TaskRow> = {}): TaskRow =>
    ({ id, title, state, display, environment: 'dev', deps: [], source: source(Number(id.split('-')[1])), analysisRequired: true, ...extra });
  const analyses = sampleAnalyses(now);
  const analyzed = (id: string) => ({ analysis: rowAnalysis(analyses[id]!) });
  const tasks: TaskRow[] = [
    task('ACME-14', 'Route web-to-case submissions by product line', 'running', 'needs-you', { run: { bgId: 'bg14', sessionId: 's-acme-14', worktree: wt('ACME-14') }, agent: { label: 'Needs you: wants permission', icon: 'bell', tone: 'orange' }, asking: true }),
    // Its analysis has questions for you; another says it's too big for one task (D-052).
    task('ACME-21', 'Contact roles missing on converted leads', 'todo', 'needs-you', analyzed('ACME-21')),
    task('ACME-23', 'Rebuild the partner portal on Experience Cloud', 'todo', 'needs-you', analyzed('ACME-23')),
    task('ACME-16', 'Add a field history report for Opportunity stage', 'todo', 'ready', analyzed('ACME-16')),
    task('ACME-24', 'Sync the renewal date to the billing system', 'todo', 'ready', { analyzing: { sessionId: 'an-acme-24' } }),
    task('ACME-12', 'Case escalation rules for the premium tier', 'running', 'needs-you', { run: { bgId: 'bg12', sessionId: 's-acme-12', worktree: wt('ACME-12') }, agent: { label: 'Needs you: has a question', icon: 'bell', tone: 'orange' }, asking: true, ...analyzed('ACME-12') }),
    // Built beside ACME-15, which touched the same layout: its pull request won't merge into dev.
    task('ACME-22', 'Add a Region field to the Lead page', 'review', 'needs-you', { run: { worktree: wt('ACME-22'), branch: 'task/ACME-22-lead-region' }, review: { verdict: 'pass', summary: 'Adds Region__c and puts it on the Lead layout.', current: true }, pr: { number: 44, url: 'https://github.com/acme/service/pull/44', state: 'open', ci: 'passing', changesRequested: false, conflicts: ['force-app/main/default/layouts/Lead-Lead Layout.layout-meta.xml', 'force-app/main/default/objects/Lead/fields/Region__c.field-meta.xml'] } }),
    // Autopilot reviewed it, then couldn't land it: someone pushed to its branch on GitHub (D-055).
    task('ACME-25', 'Merge duplicate contacts on import', 'review', 'needs-you', { run: { worktree: wt('ACME-25'), branch: 'task/ACME-25-merge-duplicate-contacts' }, review: { verdict: 'pass', summary: 'Merges on email, keeping the older record.', current: true }, autopilot: { step: 'land', reason: 'git push refused task/ACME-25-merge-duplicate-contacts: ! [rejected] (fetch first) error: failed to push some refs' } }),
    // Its base moved on, and autopilot couldn't merge it in: both sides edited the same Apex (D-058).
    task('ACME-26', 'Default the case owner from the product line', 'review', 'needs-you', { run: { worktree: wt('ACME-26'), branch: 'task/ACME-26-default-case-owner' }, review: { verdict: 'pass', summary: 'Sets the owner in the case trigger handler.', current: true }, pr: { number: 46, url: 'https://github.com/acme/service/pull/46', state: 'open', ci: 'passing', changesRequested: false, conflicts: ['force-app/main/default/classes/CaseTriggerHandler.cls'] }, autopilot: { step: 'refresh', reason: 'Conflicts with dev that autopilot can\'t resolve: force-app/main/default/classes/CaseTriggerHandler.cls. The branch is as it was, at 3f9c2ab, and nothing was pushed.' } }),
    // Someone closed its pull request, then moved it back to review: autopilot won't open another (D-063).
    task('ACME-27', 'Recalculate lead scores only when a scoring field changes', 'review', 'needs-you', { run: { worktree: wt('ACME-27'), branch: 'task/ACME-27-lead-score-recalc' }, review: { verdict: 'pass', summary: 'Checks the scoring fields before recalculating.', current: true }, pr: { number: 47, url: 'https://github.com/acme/service/pull/47', state: 'closed', ci: 'passing', changesRequested: false, conflicts: [] } }),
    // The Mac slept mid-response, and its session ended without acc done (D-067): what it last said, and Resume.
    task('ACME-28', 'Send a renewal reminder a month before the renewal date', 'running', 'needs-you', { run: { bgId: 'bg28', sessionId: 's-acme-28', worktree: wt('ACME-28'), branch: 'task/ACME-28-renewal-reminder' }, stopped: { said: SLEPT } }),
    // Another ended its turn asking in its own words, without blocking: a long quote, clipped on its card.
    task('ACME-29', 'Reassign open cases when an owner leaves', 'running', 'needs-you', { run: { bgId: 'bg29', sessionId: 's-acme-29', worktree: wt('ACME-29'), branch: 'task/ACME-29-reassign-open-cases' }, stopped: { said: ASKED } }),
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
    // Stopped builders: their sessions keep their last state once their process has gone.
    { cwd: root, kind: 'background', startedAt: now - 95 * MIN, id: 'bg28', sessionId: 's-acme-28', name: 'ACME-28', state: 'blocked' },
    { cwd: root, kind: 'background', startedAt: now - 70 * MIN, id: 'bg29', sessionId: 's-acme-29', name: 'ACME-29', state: 'blocked' },
    { cwd: wt('ACME-11'), kind: 'background', startedAt: now - 40 * MIN, id: 'bg11', sessionId: 's-acme-11', name: 'ACME-11', state: 'blocked', waitingFor: 'permission prompt', pid: 4011 },
    { cwd: root, kind: 'interactive', startedAt: now - 120 * MIN, sessionId: '0e02-main', name: 'acme-dev', status: 'busy', pid: 4100 },
    { cwd: '/Users/me/code/side-project', kind: 'interactive', startedAt: now - 30 * 60 * MIN, sessionId: '7c1d-side', name: 'side-project', status: 'idle', pid: 4200 },
    { cwd: '/Users/me/Documents/a folder with a long name/docs-site', kind: 'background', startedAt: now - 7 * 24 * 60 * MIN, id: 'bg3', name: 'docs-site', state: 'done' },
  ];
  const questions = sampleQuestions(now, wt);
  const answers = sampleAnswers(now, wt);
  return {
    projects: [project], agents, agentsError: null, questions, answers,
    askingFor: (s) => { const q = questions.find((x) => x.sessionId === s.sessionId); return q ? askingLabel(q.tool) : null; },
    taskRows: () => tasks,
    projectFor: (p: string) => (p === root || p.startsWith(`${root}/`) ? project : undefined),
    autopilotLog: () => sampleAutopilot(now),
    updates: () => sampleUpdates(now),
    history: () => [
      { at: new Date(now - 4 * MIN).toISOString(), task: 'ACME-14', title: 'Route web-to-case submissions by product line', from: 'todo', to: 'running', by: 'human:jordan' },
      { at: new Date(now - 12 * MIN).toISOString(), task: 'ACME-12', title: 'Case escalation rules for the premium tier', from: 'todo', to: 'running', by: 'human:jordan' },
      { at: new Date(now - 95 * MIN).toISOString(), task: 'ACME-15', title: 'Rename the Region picklist values', from: 'running', to: 'review', by: 'builder:ACME-15' },
      { at: new Date(now - 26 * 60 * MIN).toISOString(), task: 'ACME-19', title: 'Fix the flow that double-sends welcome emails', from: 'review', to: 'rework', by: 'reviewer' },
      { at: new Date(now - 3 * 24 * 60 * MIN).toISOString(), task: 'ACME-10', title: 'Add a CHANGELOG', from: 'review', to: 'done', by: 'sync' },
    ],
  };
}

/**
 * Steps autopilot took, as its ledger events tell them (D-064): it reviewed and landed ACME-15, couldn't
 * land ACME-25 or merge dev into ACME-26, and reviewed ACME-20, which it lands next.
 */
export function sampleAutopilot(now = Date.now()): AutopilotRecord[] {
  const at = (ago: number) => new Date(now - ago * MIN).toISOString();
  return [
    { seq: 201, at: at(93), task: 'ACME-15', step: 'review', outcome: 'done', verdict: 'pass' },
    { seq: 203, at: at(92), task: 'ACME-15', step: 'land', outcome: 'done', pr: { number: 42, url: 'https://github.com/acme/service/pull/42', opened: true } },
    { seq: 210, at: at(48), task: 'ACME-25', step: 'land', outcome: 'failed', reason: 'git push refused task/ACME-25-merge-duplicate-contacts: ! [rejected] (fetch first) error: failed to push some refs' },
    { seq: 214, at: at(20), task: 'ACME-26', step: 'refresh', outcome: 'failed', reason: 'Conflicts with dev that autopilot can\'t resolve: force-app/main/default/classes/CaseTriggerHandler.cls. The branch is as it was, at 3f9c2ab, and nothing was pushed.' },
    { seq: 217, at: at(14), task: 'ACME-13', step: 'resume', outcome: 'done', reason: SLEPT },
    { seq: 219, at: at(6), task: 'ACME-20', step: 'review', outcome: 'done', verdict: 'pass' },
  ];
}

/**
 * Updates acc drafted for tickets, for a person to post (D-066): ACME-12's pull request is ready for
 * review, ACME-10 went out to QA and its promotion to Production is open (D-075), and one of ACME-21's
 * questions was drafted for the client. ACME-15's was posted. ACME-12's pull request was updated before anyone posted, so its draft replaced the first,
 * with a newer summary (GH-46).
 */
export function sampleUpdates(now = Date.now()): Update[] {
  const at = (ago: number) => new Date(now - ago * MIN).toISOString();
  const jira = (task: string) => ({ v: 1 as const, task, tracker: 'jira' as const, key: task, url: `https://acme.atlassian.net/browse/${task}` });
  return [
    { ...jira('ACME-15'), id: 'ACME-15.1', event: 'pr-opened', state: 'posted', pr: { number: 42, url: 'https://github.com/acme/service/pull/42' }, text: 'The change is ready for review: https://github.com/acme/service/pull/42\nThe Region picklist shows the new names on both record types.', createdAt: at(92), by: 'orchestrator:autopilot', posted: { at: at(80), by: 'human:jordan', text: 'Ready for review: https://github.com/acme/service/pull/42' } },
    { ...jira('ACME-10'), id: 'ACME-10.2', event: 'deployed', state: 'draft', env: 'QA', text: 'The change is now deployed to QA.', createdAt: at(50), by: 'human:jordan' },
    { ...jira('ACME-10'), id: 'ACME-10.3', event: 'promotion-opened', state: 'draft', env: 'Production', pr: { number: 48, url: 'https://github.com/acme/service/pull/48' }, text: 'The change is ready to go to Production: https://github.com/acme/service/pull/48', createdAt: at(30), by: 'human:jordan' },
    { ...jira('ACME-12'), id: 'ACME-12.2', event: 'pr-opened', state: 'draft', pr: { number: 38, url: 'https://github.com/acme/service/pull/38' }, text: 'The change is ready for review: https://github.com/acme/service/pull/38\nPremium-tier cases now move to the Tier 2 queue when they miss their response time, using the Premium Support business hours, and the account owner and the support lead hear about each one.', createdAt: at(20), by: 'acc land', replaces: ['ACME-12.1'] },
    { ...jira('ACME-21'), id: 'ACME-21.1', event: 'question', state: 'draft', question: 'q1', text: 'Before we start, a question for you:\nShould every converted contact get a role on the new opportunity, or only the lead\'s primary contact?', createdAt: at(8), by: 'human:jordan' },
  ];
}

/**
 * What ACME-12's task page holds (GH-46): an edit typed for its first draft, before the pull request was
 * updated and acc drafted it again, and the text that draft said.
 */
export const SAMPLE_EDIT = {
  id: 'ACME-12.1',
  base: 'The change is ready for review: https://github.com/acme/service/pull/38\nPremium-tier cases now move to the Tier 2 queue when they miss their response time, using the Premium Support business hours, and the account owner hears about each one.',
  text: 'Hi Dana, the escalation change is ready for you to review: https://github.com/acme/service/pull/38\nPremium-tier cases now move to the Tier 2 queue when they miss their response time, and the account owner hears about each one. Could you look before Thursday\'s release meeting?',
};

/** The edit an open task page holds for an update, as the extension tells the Overview (GH-46). */
export const sampleEdited = (_root: string, id: string, replaces: string[]): string | null => ([id, ...replaces].includes(SAMPLE_EDIT.id) ? SAMPLE_EDIT.text : null);

/**
 * Analyses as acc analyze leaves them (D-052): one ready to build from, one with two questions for you
 * (and one answered), one too big for one task, and the one ACME-12 was built from.
 */
export function sampleAnalyses(now = Date.now()): Record<string, Analysis> {
  const at = (ago: number) => new Date(now - ago * MIN).toISOString();
  const make = (task: string, verdict: Analysis['verdict'], ago: number, more: Partial<Analysis>): Analysis => ({
    v: 1, task, env: 'dev', base: 'a1b2c3d', verdict, summary: '', requirements: { goal: '', criteria: [], assumptions: [], outOfScope: [] },
    questions: [], findings: [], approach: { plan: [], files: [], refactors: [], risks: [], tests: [], size: 'M' }, split: [], orgs: ['Acme Dev'],
    sessionId: `an-${task.toLowerCase()}`, at: at(ago), durationMs: 6 * MIN, costUsd: null, ...more,
  });
  return {
    'ACME-21': make('ACME-21', 'questions', 18, {
      summary: 'Converting a lead drops its contact roles: the conversion handler creates the opportunity but never an OpportunityContactRole. The fix belongs in the existing LeadConversionHandler, with a test for each role, and stays bulk-safe at 200 leads.',
      requirements: {
        goal: 'A lead converted with an opportunity keeps its contacts\' roles on that opportunity.',
        criteria: ['A converted lead\'s primary contact has a contact role on the new opportunity', 'Converting 200 leads at once stays within limits', 'Leads converted without an opportunity are unchanged'],
        assumptions: ['Every conversion runs through LeadConversionHandler', 'The role picklist keeps its standard values'],
        outOfScope: ['Changing the lead conversion page layout'],
      },
      questions: [
        { id: 'q1', question: 'Should every converted contact get a role on the new opportunity, or only the lead\'s primary contact?', why: 'Every contact means more role records, and the pipeline report counts them.', suggested: 'Only the primary contact, as Decision Maker.' },
        { id: 'q2', question: 'Fix the leads converted before this change too?', why: 'A one-off backfill touches about 3,400 opportunities in production and needs its own deploy window.', suggested: 'No: only leads converted from now on. A backfill can be its own task.' },
        { id: 'q3', question: 'Which role does a secondary contact get?', why: 'Sets the default for the picklist.', suggested: 'Influencer', answer: { text: 'Influencer', by: 'jordan', at: at(10) } },
      ],
      findings: [
        { area: 'LeadConversionHandler', detail: 'An after-update handler creates the opportunity but no OpportunityContactRole.', source: 'force-app/main/default/classes/LeadConversionHandler.cls' },
        { area: 'Automation on Lead', detail: 'One before-save flow (Lead_Defaults) and this trigger; no validation rule fires on conversion.', source: 'Acme Dev: FlowDefinitionView, ApexTrigger' },
        { area: 'Tests', detail: 'LeadConversionHandlerTest covers conversion without an opportunity only (71% coverage).', source: 'Acme Dev: ApexCodeCoverageAggregate' },
      ],
      approach: {
        plan: ['Collect the converted leads that created an opportunity', 'Insert one OpportunityContactRole each for the primary contact, in bulk', 'Add tests for one lead, 200 leads, and a conversion without an opportunity'],
        files: [
          { path: 'force-app/main/default/classes/LeadConversionHandler.cls', change: 'update', why: 'Insert the roles after conversion' },
          { path: 'force-app/main/default/classes/LeadConversionHandlerTest.cls', change: 'update', why: 'Cover roles, bulk and no-opportunity conversions' },
        ],
        refactors: [{ what: 'Move the SOQL in the conversion loop out of the loop', why: 'At 200 leads it hits the query limit before the new insert runs' }],
        risks: ['A duplicate role if a flow adds one too: none does today', 'Sharing: integration users convert leads without access to every contact'],
        tests: ['LeadConversionHandlerTest: one lead, 200 leads, no opportunity', 'Run the Lead and Opportunity tests in Acme Dev'],
        size: 'M',
      },
    }),
    'ACME-23': make('ACME-23', 'split', 40, {
      summary: 'Rebuilding the partner portal touches the site, its sharing, two record types and the deal registration flow: several weeks of work. Split it so each part is built and reviewed on its own.',
      requirements: { goal: 'Partners use an Experience Cloud site instead of the old portal pages.', criteria: ['Partners sign in to the new site', 'Partners see only their own accounts and deals', 'Deal registration works from the site'], assumptions: ['Partner Community licences are already bought'], outOfScope: ['Single sign-on with partners\' own directories'] },
      findings: [
        { area: 'Old portal', detail: '14 Visualforce pages and 3 controllers, last changed two years ago.', source: 'force-app/main/default/pages' },
        { area: 'Sharing', detail: 'Account and Opportunity are private; no sharing sets exist yet.', source: 'Acme Dev: sf sobject describe Account' },
      ],
      approach: {
        plan: ['Stand up the site', 'Sharing for partner users', 'Deal registration flow', 'Retire the old pages'],
        files: [{ path: 'force-app/main/default/experiences/Partners1', change: 'create', why: 'The new site' }, { path: 'force-app/main/default/pages/PartnerHome.page', change: 'delete', why: 'Replaced by the site' }],
        refactors: [], risks: ['Partners lose access during the switch-over unless both run side by side for a while'], tests: ['Sign in as a partner user in Acme QA and register a deal'], size: 'XL',
      },
      split: ['Set up the Experience Cloud site and its partner profiles', 'Share accounts and opportunities with partner users', 'Move deal registration onto a screen flow', 'Retire the old portal pages once partners have moved'],
    }),
    'ACME-16': make('ACME-16', 'ready', 55, {
      summary: 'Turn on field history for Opportunity Stage, then add a report type and a report on it. Nothing tracks Stage history today, and the history limit has room.',
      requirements: { goal: 'Sales managers see how deals moved between stages.', criteria: ['Stage changes are tracked from the deploy on', 'A report lists each stage change with who made it and when'], assumptions: ['History before the deploy isn\'t needed'], outOfScope: [] },
      findings: [{ area: 'Opportunity history', detail: '12 of 20 tracked fields are used; Stage isn\'t one of them.', source: 'Acme Dev: sf sobject describe Opportunity' }],
      approach: {
        plan: ['Track StageName in field history', 'Add the Opportunity Stage History report', 'Put it in the Sales Managers folder'],
        files: [{ path: 'force-app/main/default/objects/Opportunity/fields/StageName.field-meta.xml', change: 'update', why: 'trackHistory' }, { path: 'force-app/main/default/reports/SalesManagers/Opportunity_Stage_History.report-meta.xml', change: 'create', why: 'The report' }],
        refactors: [], risks: [], tests: ['Change a stage in Acme Dev and run the report'], size: 'S',
      },
    }),
    'ACME-12': make('ACME-12', 'ready', 4 * 24 * 60, {
      summary: 'Add an escalation rule for premium High-priority cases on the Premium Support schedule, and notify the account owner. Standard-tier cases keep today\'s rule.',
      requirements: { goal: 'Premium cases reach Tier 2 before they breach their SLA.', criteria: ['High premium cases escalate after 2 business hours', 'The account owner is notified', 'No change for Standard-tier cases'], assumptions: [], outOfScope: [] },
      questions: [{ id: 'q1', question: 'Which queue gets premium cases?', why: 'Decides the rule\'s assignee.', suggested: 'Tier 2', answer: { text: 'Premium Support', by: 'jordan', at: at(4 * 24 * 60 - 20) } }],
      findings: [{ area: 'Escalation rules', detail: 'One active rule with three entries, none for the premium tier.', source: 'force-app/main/default/escalationRules/Case.escalationRules-meta.xml' }],
      approach: { plan: ['Add the premium rule entry', 'Notify the owner with an email alert'], files: [{ path: 'force-app/main/default/escalationRules/Case.escalationRules-meta.xml', change: 'update', why: 'The premium entry' }], refactors: [], risks: [], tests: ['CaseRoutingTest.premiumEscalates'], size: 'S' },
    }),
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

/** Questions that have ended, one of each kind of outcome, as acc hook permission records them. */
function sampleAnswers(now: number, wt: (id: string) => string): HistoryRecord[] {
  const h = (id: string, sessionId: string, task: string, ago: number, tool: string, input: Record<string, unknown>, outcome: HistoryRecord['outcome'], extra: Partial<HistoryRecord> = {}): HistoryRecord =>
    ({ v: 1, id, sessionId, cwd: wt(task), tool, input, askedAt: now - (ago + 1) * MIN, endedAt: now - ago * MIN, outcome, ...extra });
  return [
    h('h1', 's-acme-14', 'ACME-14', 24, 'Bash', { command: 'npm run lint -- --fix', description: 'Fix the lint warnings' }, 'allowed-for-session'),
    h('h2', 's-acme-14', 'ACME-14', 15, 'Bash', { command: 'sf data query --query "SELECT Id FROM Group WHERE Type = \'Queue\'" --target-org "Acme Dev"', description: 'List the queues' }, 'allowed'),
    h('h3', 's-acme-12', 'ACME-12', 9, 'AskUserQuestion', { questions: [{ question: 'Which queue gets premium cases?', options: [{ label: 'Tier 2' }, { label: 'Premium Support' }] }] }, 'answered', { answers: { 'Which queue gets premium cases?': 'Premium Support' } }),
    h('h4', 's-acme-12', 'ACME-12', 6, 'Bash', { command: 'git push origin HEAD', description: 'Push the branch' }, 'denied', { message: 'Builders never push; acc land does that.' }),
    h('h5', 's-acme-11', 'ACME-11', 35, 'Bash', { command: 'sf org list', description: 'List orgs' }, 'no-window'),
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
    // Autopilot, switched on in the status bar (D-064): it runs as long as the window, and is never shown first.
    { id: 'r-autopilot', label: 'Autopilot · Acme Service', command: 'acc autopilot --every 60', startedAt: now - 2 * 60 * MIN, endedAt: null, code: null, stopped: false, step: null, background: true,
      lines: ['Autopilot pass at 10:41:07', '✓ ACME-20  Review passed: Adds the field to the layout.', '… ACME-25  Waiting: Autopilot couldn\'t land d4e5f6a: git push refused. It waits for a person, or a new commit.', '9 other tasks: nothing to do.'], prompt: null },
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
  return agentModel({ hub: sampleHub(now), key: 's-acme-14', seen: null, entries, readable: true, lastAt: at(3), model: 'claude-opus-5-5' });
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
  if (!items.some((i) => i.id === 'A1.claude-billing')) items.push({ id: 'A1.claude-billing', part: 'machine', title: 'Agents bill your Claude subscription', status: 'pass', detail: 'Agents use your Claude subscription.' });
  return { items, confirmed: new Set() };
}

const ROOT = '/Users/me/code/acme-service';
const status = (id: string, name: string, category: 'todo' | 'doing' | 'done') => ({ id, name, category });
const TODO = status('1', 'To Do', 'todo');
const DOING = status('3', 'In Progress', 'doing');
const REVIEW = status('4', 'In Review', 'doing');
const QA = status('5', 'QA', 'doing');
const DONE = status('10', 'Done', 'done');

/**
 * A Jira board with its own columns, the cards on it, and acc's tasks for some of them. Its tickets come
 * from one epic (D-072), and a task that started moved out of it. Three tickets acc doesn't keep yet show
 * Track (D-074): ready, on its way, and refused because the ticket has since left the epic. One that's done has none.
 */
export function sampleBoards(): BoardInput[] {
  const card = (n: number, title: string, s: { id: string; name: string }, type: string, extra: Partial<NonNullable<BoardInput['board']>['cards'][number]> = {}) =>
    ({ key: `ACME-${n}`, title, url: `https://acme.atlassian.net/browse/ACME-${n}`, status: s, type, assignees: [], labels: [], priority: 'Medium', ...extra });
  return [{
    index: 0, kind: 'jira', title: 'Jira · ACME', error: null, connect: null, loading: false, signedInAs: 'jordan@acme.example',
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
        card(32, 'Hide the legacy SLA fields from the case layout', TODO, 'Task', { assignees: [{ name: 'Pat Lee' }] }),
        card(17, 'Dashboards for the escalation rules', TODO, 'Task'),
        card(21, 'Contact roles missing on converted leads', TODO, 'Bug', { priority: 'Highest', assignees: [{ name: 'Pat Lee' }], labels: [{ name: 'sales', color: null }] }),
        card(23, 'Rebuild the partner portal on Experience Cloud', TODO, 'Epic'),
        card(24, 'Sync the renewal date to the billing system', TODO, 'Story'),
        card(14, 'Route web-to-case submissions by product line', DOING, 'Story', { assignees: [{ name: 'Jordan Kim' }] }),
        card(28, 'Send a renewal reminder a month before the renewal date', DOING, 'Story', { assignees: [{ name: 'Jordan Kim' }] }),
        card(12, 'Case escalation rules for the premium tier', DOING, 'Story', { priority: 'High', assignees: [{ name: 'Jordan Kim' }], labels: [{ name: 'service', color: null }, { name: 'sla', color: null }] }),
        card(22, 'Add a Region field to the Lead page', DOING, 'Story', { assignees: [{ name: 'Jordan Kim' }] }),
        card(15, 'Rename the Region picklist values', REVIEW, 'Task', { priority: 'Low', assignees: [{ name: 'Pat Lee' }] }),
        card(27, 'Recalculate lead scores only when a scoring field changes', REVIEW, 'Story', { assignees: [{ name: 'Pat Lee' }] }),
        card(19, 'Fix the flow that double-sends welcome emails', QA, 'Bug', { priority: 'High' }),
        card(10, 'Add a CHANGELOG', DONE, 'Task', { priority: 'Lowest' }),
        card(8, 'Turn off the old web-to-lead form', DONE, 'Task'),
      ],
    },
  }];
}

/** Which Connect page to draw (GH-51). */
export type ConnectSample = 'start' | 'jira' | 'azure' | 'github' | 'existing';

/**
 * The Connect page at each step: a new Jira tracker before signing in; signed in, its project picked, its
 * epics loading and its boards failing; Azure DevOps whose token was refused; GitHub with labels ticked;
 * and an existing Jira tracker opened to change, its epic done now but kept.
 */
export function sampleConnect(which: ConnectSample): ConnectModel {
  const root = '/Users/me/code/acme-service';
  const base = { root, projectName: 'Acme Service', ownRepo: 'acme/service', ghAccount: 'jordan-kim', from: 'tasks' as const, gitEmail: 'jordan.kim@example.com' };
  const ready = (options: ConnectState['pickers'][string]['options'], selected: string[] = []): ConnectState['pickers'][string] => ({ options, selected, state: 'ready', error: null });
  const ok = (who: string): ConnectState['signIn'] => ({ state: 'ok', who, error: null, again: false });
  const projects = [{ value: 'ACME', label: 'ACME', detail: 'Acme Service Desk' }, { value: 'OPS', label: 'OPS', detail: 'Operations' }];
  const boards = [{ value: '7', label: 'ACME Service board', detail: 'scrum', preferred: true }, { value: '9', label: 'Support kanban', detail: 'kanban' }];
  if (which === 'start') return connectModel(blankConnect(JIRA, { id: 'c-start', ...base }));
  if (which === 'jira') {
    const s = blankConnect(JIRA, { id: 'c-jira', ...base });
    s.host = 'acme.atlassian.net';
    s.signIn = ok('Jordan Kim');
    s.pickers.project = ready(projects, ['ACME']);
    s.pickers.epic = { options: [], selected: [], state: 'loading', error: null };
    s.pickers.board = { options: [], selected: [], state: 'failed', error: 'Jira answered HTTP 503: the service is unavailable.' };
    return connectModel(s);
  }
  if (which === 'azure') {
    const s = blankConnect(AZURE, { id: 'c-azure', ...base });
    s.host = 'acme';
    s.method = 'pat';
    s.fieldErrors = { token: 'Azure DevOps (acme) didn\'t accept this sign-in. Check the token has Work Items: Read & write, and hasn\'t expired.' };
    s.signIn = { state: 'failed', who: null, error: null, again: false };
    return connectModel(s);
  }
  if (which === 'github') {
    const s = blankConnect(GITHUB, { id: 'c-github', ...base });
    s.signIn = ok('jordan-kim');
    s.pickers.labels = ready(['billing', 'bug', 'documentation', 'enhancement', 'good first issue', 'invoices', 'milestone', 'question'].map((l) => ({ value: l, label: l })), ['billing', 'invoices']);
    return connectModel(s);
  }
  const s = blankConnect(JIRA, { id: 'c-existing', ...base, existing: { index: 0, title: 'Jira · ACME', host: 'acme.atlassian.net', values: { project: 'ACME', epic: 'ACME-3', board: '7' } } });
  s.signIn = ok('Jordan Kim');
  s.pickers.project = ready([], ['ACME']);
  s.pickers.epic = ready([{ value: 'ACME-31', label: 'ACME-31', detail: 'Renewals' }, { value: 'ACME-30', label: 'ACME-30', detail: 'Partner portal' }], ['ACME-3']);
  s.pickers.board = ready(boards, ['7']);
  return connectModel(s);
}

const p = (text: string, marks?: string[]): AdfNode => ({ type: 'paragraph', content: [{ type: 'text', text, ...(marks ? { marks: marks.map((type) => ({ type })) } : {}) }] });

/**
 * Which ticket page to draw: ACME-12 being built, a task to do whose analysis has questions or says to
 * split it, one whose builder stopped, or ACME-31, which acc doesn't keep yet, being tracked from its card.
 */
export type TicketSample = 'ACME-12' | 'ACME-21' | 'ACME-23' | 'ACME-29' | 'ACME-31';

/** What GH-41's builder last said when the Mac slept (D-067). */
export const SLEPT = 'API Error: Your computer went to sleep mid-response. The response above may be incomplete.';
/** A builder that ended its turn with a question in its own words, instead of acc block. */
export const ASKED = 'I\'ve added the reassignment flow and its test. Before I finish: when the leaving owner\'s manager is also inactive, should the cases go to the queue named on the account, or to the support team\'s default queue? I\'ve left both paths in until someone decides.';

/** A Jira ticket with everything a description can hold, and the acc task working on it. */
export function sampleTicket(now = Date.now(), which: TicketSample = 'ACME-12'): TicketModel {
  if (which === 'ACME-29') return sampleStoppedTicket(now);
  if (which === 'ACME-31') return sampleUntrackedTicket(now);
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
    run: { bgId: 'bg12', worktree: `${ROOT}/.claude/worktrees/ACME-12`, branch: 'task/ACME-12-case-escalation-rules' }, pr,
    history: [
      { at: new Date(now - 4 * 86_400_000).toISOString(), from: null, to: 'todo', by: 'human:me' },
      { at: new Date(now - 3 * 86_400_000).toISOString(), from: 'todo', to: 'running', by: 'human:me' },
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
      { gate: 'validate', status: 'fail', summary: '4 of 21 tests failed in Acme Dev: CaseRoutingTest.premiumEscalates' },
      { gate: 'lwc-tests', status: 'skip', summary: 'Not run on this commit' },
    ],
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

/** This clone works as another account than the project's, and that account lacks Projects access. */
export function sampleIdentity(): IdentityCard {
  return {
    account: 'jordan-kim', initials: 'JK', from: 'clone', projectAccount: 'acme-bot', signedIn: true, scopes: ['repo', 'read:org', 'workflow'], projects: false,
    problem: null, pushesAs: 'jordan-kim', commit: 'Jordan Kim <jordan@acme.example>', profile: 'https://github.com/jordan-kim', others: 2,
  };
}
