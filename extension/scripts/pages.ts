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
 * it is, and, on a machine with steps still to do, at the machine's part (GH-138). Setup itself is its
 * walkthrough's start screen (T-153); then a step's screen, one with Show how open, one whose Do it opens a modal,
 * the end screen, and the start screen with a walk under way and every chapter open.
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
 * for the ticket's author with own words typed, a question already answered, and the approved plan's summary.
 * Then ACME-21 with its plan, criteria and Verify under its description (T-132), open, and collapsed to their header lines.
 * Then a plan's conversation in its own panel (T-111): ACME-21's page before its plan with the conversation's one
 * line, the panel as Make a plan opens it, mid-conversation with a reply on its way, and Talk it through once v2 is made.
 * Then the agent's questions one at a time, part-way through (T-113), and a long Talk it through, folded.
 * Then the planning agent's progress (T-131): the panel after Draft the plan with its steps, the same once it hasn't moved
 * for six minutes, and ACME-21's page with the progress in its plan section.
 * Then Environments on a machine that isn't logged in to Production, its Open org and Deploy… off (T-125).
 * Then a project's several boards on the Tasks tab (T-127): two, on the first and switched to the second; four, with
 * the list of boards open and switched to the third; and ten across three Jira sites, the list open and filtered by
 * site, All boards with each folded but one, and switched to a board whose site's sign-in has run out.
 * Then ACME-12's Changes tab with its deploy (T-158): a row for each environment in each state, before work, in review,
 * in QA with UAT's row open on what differs, in UAT with steps left; Deploy… open on where, and off; a deploy under way.
 * Then a project with two Jira Service Management queue boards (T-128), on the Tasks tab and in Settings' Trackers and
 * sign-ins, and the Connect page with a service desk's queues as cards: two ticked, and a sign-in that isn't an agent's.
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
  'overview-needs-wall',
  'overview-blocked',
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
  // Environments on a machine that isn't logged in to Production (D-208): its Open org and Deploy… off, with why
  'environments-away',
  'rules-accept',
  // The Tasks tab: each tracker's board, the agent board, the person filter and the first steps
  'tasks-monday',
  'tasks-github',
  'tasks-sprint',
  'tasks-queues',
  'tasks-slack',
  'tasks-slack-refused',
  'tasks-slack-board',
  'tasks-slack-empty',
  'tasks-slack-scope',
  'tasks-modal',
  // A task's modal as it opens at the click (T-162): loading, and a load that failed, with Try again
  'tasks-modal-loading',
  'tasks-modal-failed',
  'tasks-agents',
  'palette',
  'palette-empty',
  'tasks-moving',
  'tasks-card-menu',
  'tasks-person-menu',
  'tasks-person',
  'tasks-person-agents',
  'tasks-person-none',
  'tasks-person-mine',
  'tasks-person-signed-out',
  'tasks-person-mine-none',
  'tasks-azure',
  'tasks-azure-loading',
  'tasks-azure-refreshing',
  'tasks-first',
  // My work's Done lane (T-147): a card cleaning up, a refused cleanup, and the Cleaned up fold opened
  'tasks-done-working',
  'tasks-done-refused',
  'tasks-done-fold',
  // A project's several boards (T-127): two, four and ten across three Jira sites, each switched, the list open and filtered, and All boards folded
  'tasks-boards-two',
  'tasks-boards-two-switched',
  'tasks-boards-four',
  'tasks-boards-four-switched',
  'tasks-boards-ten',
  'tasks-boards-ten-all',
  'tasks-boards-ten-signin',
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
  // Build it on Windows (T-150): this machine is This PC
  'dispatch-sheet-windows',
  'task-sheet-new',
  'task-sheet-manual',
  // The task sheet's wording check (T-148): a fix and a piece of advice beside the acceptance criteria
  'task-sheet-wording',
  // A ticket's page, in each of its states
  'ticket',
  'ticket-questions',
  'ticket-split',
  'ticket-stopped',
  'ticket-track',
  'ticket-checks',
  // The Agent panel (T-142): blocked, blocked while its builder still works, Details open, and More actions open
  'ticket-agent-blocked',
  'ticket-agent-disagree',
  'ticket-agent-failed',
  'ticket-agent-details',
  'ticket-agent-more',
  'ticket-agent-open',
  // An agent's blocked note (T-146): in shape, and a paragraph recorded before it, split as it's drawn
  'ticket-blocked-note',
  'ticket-blocked-wall',
  'ticket-waits',
  'ticket-note',
  'ticket-review',
  'ticket-cloud',
  // A task's page drawn from its record first, its checks, branch and team still coming (T-162)
  'ticket-filling',
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
  // The Command Center's sections under the description (T-132): the plan, criteria and Verify open, then collapsed
  'ticket-sections',
  'ticket-sections-collapsed',
  // A task page's tabs (T-134): ACME-21 on each of its four tabs, and a plan needing approval, which opens on Plan
  'ticket-tab-ticket',
  'ticket-tab-plan',
  'ticket-tab-changes',
  'ticket-tab-verify',
  // The Review tab (T-135): a review that sent work back, one with findings that block nothing, and one that passed
  'ticket-tab-review',
  'ticket-tab-review-findings',
  'ticket-tab-review-passed',
  'ticket-plan-needs-you',
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
  // The Changes tab with its deploy (T-158): a row for each environment before work, with work, in QA with UAT's row
  // open on what differs, Hotfix's open on what's missing, every row can't tell with why, in UAT with steps left;
  // Deploy… open on where, open with a choice off, and off; QA's Check again under way; and an agent deploying to UAT
  'ticket-deploy-before',
  'ticket-deploy-work',
  'ticket-deploy-deployed',
  'ticket-deploy-not',
  'ticket-deploy-unknown',
  'ticket-deploy-steps',
  'ticket-deploy-pick',
  'ticket-deploy-pick-off',
  'ticket-deploy-off',
  'ticket-deploy-checking',
  'ticket-deploy-busy',
  // Its build done and in Dev (T-161): Open Dev, How to test it and each component; then Open off, with no steps
  'ticket-deploy-built',
  'ticket-deploy-built-off',
  'ticket-plan-approved',
  'ticket-plan-changed',
  'ticket-plan-short',
  'ticket-plan-choices',
  'ticket-review-choice',
  'ticket-review-question',
  'ticket-review-answered',
  'ticket-review-summary',
  'ticket-plan-shapes',
  'ticket-plan-behind',
  'ticket-talk',
  'ticket-conversation',
  // A plan's conversation in its own panel (T-111): at the start, mid-conversation, and Talk it through
  'conversation-start',
  'conversation',
  'conversation-talk',
  // The agent's questions one at a time, part-way through, and a long conversation folded (T-113); the review before they go (T-130)
  'conversation-questions',
  'conversation-questions-review',
  'conversation-long',
  // Messaging an agent as a chat (T-160): the plan conversation and an agent's page, each scrolled to its newest message, the person's last one pinned on top
  'conversation-scrolled',
  // The planning agent's progress (T-131): the panel mid-plan with its steps, stalled, and the task page's plan section
  'conversation-progress',
  'conversation-stalled',
  'ticket-progress',
  // Report a problem (T-118): the draft as it opens, filled in, where GitHub's account can't reach the repo, and posted
  'report',
  'report-filled',
  'report-no-access',
  'report-posted',
  'ticket-changes-field',
  'ticket-team',
  'ticket-team-alone',
  // Agents, and an agent's own page
  'agents-path',
  'agent',
  'agent-chat',
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
  'connect-jira-queues',
  'connect-jira-queues-refused',
  // The Connect modal's steps (T-140): Azure DevOps chosen, Save for a new Jira and Azure DevOps board, the board read, and a list open
  'connect-azure-tracker',
  'connect-jira-save',
  'connect-azure-save',
  'connect-loading',
  'connect-dropdown',
  // Settings, with Notices in Slack at each state
  'slack-none',
  'slack-off',
  'slack-paused',
  'settings-agents',
  'settings-trackers',
  'settings-queues',
  'settings-limits',
  'settings-about',
  'settings-about-failed',
  'settings-github',
  'settings-page',
  // Setup, and the output panel on a command that asks something
  'output',
  'setup-first',
  'setup-first-machine',
  // A project being started, with this machine checked first: one tool missing, one not on PATH (T-133)
  'setup-machine-first',
  // Setup's walkthrough (T-153): a step with two skipped before it, the plugin's step with Show how open, the tracker's step, whose Do it opens a modal, the end with every step skipped, and the start screen with every chapter open
  'setup-walk-step',
  'setup-walk-how',
  'setup-walk-modal',
  'setup-walk-end',
  'setup-walk-chapters',
  // Set up cloud builders (T-145): every step, on a Mac and on Windows, not done and done, and two with the detail opened
  'cloud-setup-on-mac-todo',
  'cloud-setup-on-mac-done',
  'cloud-setup-on-win-todo',
  'cloud-setup-on-win-done',
  'cloud-setup-github-mac-todo',
  'cloud-setup-github-mac-done',
  'cloud-setup-github-win-todo',
  'cloud-setup-github-win-done',
  'cloud-setup-task-mac-todo',
  'cloud-setup-task-mac-done',
  'cloud-setup-task-win-todo',
  'cloud-setup-task-win-done',
  'cloud-setup-token-mac-todo',
  'cloud-setup-token-mac-done',
  'cloud-setup-token-win-todo',
  'cloud-setup-token-win-done',
  'cloud-setup-signin-mac-todo',
  'cloud-setup-signin-mac-done',
  'cloud-setup-signin-win-todo',
  'cloud-setup-signin-win-done',
  'cloud-setup-guard-mac-todo',
  'cloud-setup-guard-mac-done',
  'cloud-setup-guard-win-todo',
  'cloud-setup-guard-win-done',
  'cloud-setup-ready-mac-todo',
  'cloud-setup-ready-mac-done',
  'cloud-setup-ready-win-todo',
  'cloud-setup-ready-win-done',
  'cloud-setup-task-mac-open',
  'cloud-setup-token-win-open',
] as const;
export type Page = (typeof PAGES)[number];

/**
 * Pages the run draws with no model sent, so what the tab shows before its first model stays (T-16). They
 * have no rail and no controls, which the geometry check otherwise looks for on every page.
 */
export const STILL: readonly Page[] = ['loading'];

/** The widths every page is shot at unless --width says. */
export const WIDTHS = [1000, 620, 500] as const;

/** The kind of tab a page is drawn in: a ticket's, a plan's conversation (T-111), a report's (T-118), an agent's, or the Command Center's own. */
export const viewOf = (kind: Page): string => (kind.startsWith('ticket') ? 'ticket' : kind.startsWith('conversation') ? 'conversation' : kind.startsWith('report') ? 'report' : kind === 'agent' || kind === 'agent-chat' ? 'agent' : 'home');
