// The pages the screenshot run draws (T-102): one page a line, in groups by section, so two branches that
// each add a page add a line each. .gitattributes merges this file as a union of both sides' lines, and
// extension/test/screenshot.test.ts fails on a page named twice, or one with no sample.
import { HOME_SECTIONS } from '../src/model/shared.ts';

/**
 * Every page the screenshot script can draw: each section of the Command Center, a ticket's page (being
 * built, two to do whose analysis has questions or says to split it, one whose builder stopped, one that
 * waits for other tasks' files, one acc doesn't keep yet, being tracked, one in review with its
 * builder's note, and one in rework with its review's findings and the lines around them, T-53), an agent's page, Setup with
 * the output panel open on a command that's asking something, the Connect page at each of its steps (D-073)
 * and starting a project from a Jira epic, an Azure DevOps area path or GitHub labels (GH-81),
 * Settings at Notices in Slack with the card at each of its states (GH-58, GH-113): sending on Settings
 * itself, then not set up, off and paused, the Tasks tab with a monday.com board in place of the Jira one (GH-70), Agents
 * with agents that would bill per token (D-089), Agents with its Where column showing full paths (GH-83),
 * and the Overview with In progress busy, and with nothing running (D-092). Then the Overview of a project
 * whose merge queue holds three pull requests, with autopilot on and the head running its full check, with
 * autopilot off, and with the head held on GitHub, in that wait's own words (GH-73). Last, Settings opened
 * at How agents run, as Agents' Settings and the status bar's Auto-merge open it, with two projects and
 * per-token billing (GH-110), and at Trackers and sign-ins, with a tracker in every state its sign-in and
 * board can be in (GH-112); Settings' Limits and checks in their other states: no total across repos,
 * slots set by the environment, and two projects, one building through the merge queue (GH-111); and About
 * behind, with a newer release and an older plugin, and with a look that failed (GH-114). Last, Agents with each repo's finished sessions opened (GH-119). Then the
 * Overview with a suggested rule and a suggested check under When you have a moment, and with the rule's draft task open
 * after Accept (GH-102).
 * Last, Settings at GitHub accounts, one project pushing as this clone's choice and one whose account gh
 * isn't signed in as, and at the Command Center's own preferences, each set to other than its default (GH-113).
 * Last, Setup as the Command Center first opens on it in a folder that isn't set up: at what kind of project
 * it is, and, on a machine with steps still to do, at the machine's part (GH-138).
 * Last, the Tasks board with a task opened over it in the modal, as a card's click opens it (GH-158).
 * Last, the Overview as a landing page when everything is busy at once (GH-160): ten suggested rules, six
 * tasks building with their checks, three questions, two update drafts and twelve things in History; then
 * the same with a question opened over it, its update drafts, and History opened at an answer.
 * Last, the loading screen the Command Center shows while it opens, which no model replaces (T-16).
 * Last, the command palette open over the Tasks board (T-52): with "an" typed and its results across several groups, and with
 * nothing typed, showing what was run last and then the sections.
 * Last, the output panel open over the Tasks board on a review (T-63): one that passed, one that asked for changes, one
 * still running, the one that asked for changes with its summary, a criterion, a finding and the met criteria opened,
 * and one whose verdict file isn't JSON, which shows its lines and why.
 * Last, Dispatch's sheet (D-168): over the Tasks board for a task with an analysis, and over a task's own tab
 * in rework with the cloud off; then the agent board with a card's ⋯ menu open beside its full-width next step;
 * then Dispatch anyway's sheet for ACME-35, with the tasks and files it shares.
 * Then the output panel open over the Tasks board on a run as rows (T-64): a deploy still running, the deploy done with
 * more rows than the panel shows, a lint that failed, and the deploy done with its Details open. The run waiting
 * for an answer is the output page's.
 * Last, ACME-19's tab where its tracker allows edits (T-80): the task sheet with its ticket's text to write
 * and its status, assignee and labels to change, and then the choice when the ticket changed after it opened.
 * Then ACME-19's manifest, checked against its org (T-101): an org copy that differs, an org change to add, and a deletion.
 * Last, a ticket's page from GitHub, Azure DevOps and monday.com, and an Azure DevOps board (T-91), so every
 * tracker's ticket page and board is drawn.
 * Last, ACME-20's Record changes (T-100): planned and recorded ones with a change made by hand; then
 * the task done and promoted to UAT with a step to run, and that with Add a change made by hand half-filled and the step's Skip open.
 * Then ACME-12's Team (T-103): sharing files with two others in flight and two merges behind dev, then up to date and sharing none.
 * Then ACME-21's plan in short, and Review plan over it (T-109): a choice with More about this option open, a question
 * for the ticket's author with own words typed, and the summary with two steps skipped.
 */
export const PAGES = [
  // The Command Center's sections
  ...HOME_SECTIONS,
  // The Overview: busy, idle, as a landing page, and with a detail opened over it
  'overview-busy',
  'overview-idle',
  'overview-landing',
  'overview-answer',
  'overview-drafts',
  'overview-history',
  'overview-pages',
  'overview-needs',
  'overview-progress',
  'overview-ready',
  'overview-moment',
  'overview-clear',
  'overview-since',
  'loading',
  // The merge queue on the Overview (GH-73), and suggested rules (GH-102)
  'queue',
  'queue-off',
  'queue-held',
  'rules',
  'rules-accept',
  // The Tasks tab: each tracker's board, the agent board, the person filter and the first steps
  'tasks-monday',
  'tasks-github',
  'tasks-sprint',
  'tasks-slack',
  'tasks-slack-refused',
  'tasks-slack-board',
  'tasks-slack-empty',
  'tasks-slack-scope',
  'tasks-modal',
  'tasks-agents',
  'palette',
  'palette-empty',
  'tasks-moving',
  'tasks-card-menu',
  'tasks-person-menu',
  'tasks-person',
  'tasks-person-agents',
  'tasks-person-none',
  'tasks-azure',
  'tasks-azure-loading',
  'tasks-azure-refreshing',
  'tasks-first',
  // The output panel over the Tasks board, on a review, a run as rows, and a run as steps
  'output-passed',
  'output-changes',
  'output-reviewing',
  'output-review-open',
  'output-unread',
  'output-running',
  'output-done',
  'output-failed',
  'output-details',
  'output-steps-running',
  'output-steps-failed',
  'output-steps-done',
  // Sheets over the Tasks board: Build it, and the task sheet
  'dispatch-sheet',
  'dispatch-sheet-anyway',
  'task-sheet-new',
  'task-sheet-manual',
  // A ticket's page, in each of its states
  'ticket',
  'ticket-questions',
  'ticket-split',
  'ticket-stopped',
  'ticket-track',
  'ticket-checks',
  'ticket-waits',
  'ticket-note',
  'ticket-review',
  'ticket-cloud',
  'ticket-nofields',
  'ticket-dispatch',
  'ticket-edit',
  'ticket-edit-on',
  'ticket-edit-changed',
  'ticket-edit-unkept',
  'ticket-criteria-sheet',
  'ticket-criteria-update',
  'ticket-verify-pass',
  'ticket-verify-changes',
  'ticket-verify-choice',
  'ticket-github',
  'ticket-azure',
  'ticket-monday',
  'ticket-missing',
  'ticket-planned',
  'ticket-changes',
  'ticket-kept',
  'ticket-records',
  'ticket-records-form',
  'ticket-records-promoted',
  'ticket-manifest',
  'ticket-plan-approved',
  'ticket-plan-changed',
  'ticket-plan-short',
  'ticket-review-choice',
  'ticket-review-question',
  'ticket-review-summary',
  'ticket-talk',
  'ticket-changes-field',
  'ticket-team',
  'ticket-team-alone',
  // Agents, and an agent's own page
  'agents-path',
  'agent',
  'agents-billing',
  'agents-finished',
  // The Connect page at each step, and choosing a board
  'connect-start',
  'connect-shared',
  'connect-jira',
  'connect-azure',
  'connect-github',
  'connect-existing',
  'connect-sprint',
  'connect-monday',
  'connect-slack',
  'connect-slack-channel',
  'connect-slack-refused',
  'connect-epic',
  'connect-epic-used',
  'connect-epic-azure',
  'connect-epic-github',
  'connect-jira-board',
  'connect-azure-board',
  'connect-github-board',
  'connect-github-access',
  'connect-jira-epics',
  // Settings, with Notices in Slack at each state
  'slack-none',
  'slack-off',
  'slack-paused',
  'settings-agents',
  'settings-trackers',
  'settings-limits',
  'settings-about',
  'settings-about-failed',
  'settings-github',
  'settings-page',
  // Setup, and the output panel on a command that asks something
  'output',
  'setup-first',
  'setup-first-machine',
] as const;
export type Page = (typeof PAGES)[number];

/**
 * Pages the run draws with no model sent, so what the tab shows before its first model stays (T-16). They
 * have no rail and no controls, which the geometry check otherwise looks for on every page.
 */
export const STILL: readonly Page[] = ['loading'];

/** The widths every page is shot at unless --width says. */
export const WIDTHS = [1000, 620, 500] as const;

/** The kind of tab a page is drawn in: a ticket's, an agent's, or the Command Center's own. */
export const viewOf = (kind: Page): string => (kind.startsWith('ticket') ? 'ticket' : kind === 'agent' ? kind : 'home');
