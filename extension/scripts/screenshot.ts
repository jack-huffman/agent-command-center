/**
 * Renders the editor tabs in headless Chrome with sample data, so a layout change gets looked at before
 * it ships. Tests can't see a broken table; a screenshot can.
 *
 *   npm run screenshot                       every tab, dark and light, at 1000, 620 and 500 px
 *   npm run screenshot -- agents worktrees   just these tabs
 *   npm run screenshot -- --width 800 --theme dark --height 600 --out /tmp/shots
 *   npm run screenshot -- --colours          check no colour leaks from VSCode's theme into Light or Dark
 *   ACC_SHOT_TIMEOUT=90 npm run screenshot   allow each drawing 90 s, not 60 (GH-167)
 *   npm run screenshot -- --behaviour        the modals' behaviour cases and their mutants (GH-170)
 *   npm run screenshot -- --jobs 1           draw one page at a time, not DEFAULT_JOBS at once (T-58)
 *
 * A full run (every tab, theme and width) also runs the behaviour cases and their mutants (behaviour.ts)
 * after the shots.
 *
 * It renders the built webview (extension/dist/webview), so run `npm run build` after changing it. The
 * first data row or card is shown hovered. Chrome runs under nice, in DEFAULT_JOBS jobs at once (T-58): each
 * job draws its share of the pages one after another, in its own Chrome with its own profile and output
 * folders, and the behaviour cases and mutants run in a pool of as many. What each drawing found is printed
 * and noted in the pages' order, so a run's log and record are the same whatever --jobs is.
 *
 * Each shot is the page with Light or Dark forced, as Settings forces it, under VSCode's other theme
 * (GH-109): a colour that still came from VSCode's theme would show in it. --colours checks the same
 * thing by number: each page's computed colours with Light or Dark forced are the same whichever theme
 * VSCode has, and Match VSCode under a theme is that theme forced.
 *
 * Each shot it takes at the usual heights is noted in the folder's shots.json (SHOTS_FILE, T-5): the PNG's
 * hash, the fingerprint of the code and sample data it drew, its geometry findings, and the classes drawn
 * on screen in it. The screenshots gate (looked.ts) reads it to tell whether a branch's pages were looked
 * at as they are now.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { type HomeSection } from '../src/model/shared.ts';
import { conversationTitle } from '../src/model/conversation.ts';
import { type HomeModel, homeModel, type Model } from '../src/model/home.ts';
import { type GroupKey, landing, overviewCards } from '../src/model/landing.ts';
import { REPORT_TITLE } from '../src/model/report.ts';
import { FinishedJobs } from '../src/progress.ts';
import { sampleAgent } from './fixtures/agent-page.ts';
import { sampleBoards, sampleGithubBoards, sampleMondayBoards, type SlackBoardSample, sampleSlackBoards, sampleSprintBoards } from './fixtures/boards.ts';
import { sampleAzureBoards, sampleAzureLoading, sampleAzureRefreshing, sampleTrackerTicket, type TrackerTicketSample } from './fixtures/tracker-tickets.ts';
import { type ConnectSample, sampleConnect } from './fixtures/connect.ts';
import { sampleIdentities, sampleIdentity } from './fixtures/environments.ts';
import { sampleHub } from './fixtures/hub.ts';
import { sampleLimitsOther } from './fixtures/limits.ts';
import { sampleAbout, sampleAboutBehind, sampleAboutFailed } from './fixtures/about.ts';
import { sampleLandingHub, sampleLandingRuns, sampleLongHub, sampleSince } from './fixtures/landing.ts';
import { sampleQueueHub } from './fixtures/overview.ts';
import { sampleAnalyzeRun, sampleBusyHub, sampleIdleHub } from './fixtures/progress.ts';
import { sampleRulesHub } from './fixtures/rules.ts';
import { sampleRuns } from './fixtures/runs.ts';
import { REVIEW_RUN, type ReviewSample, sampleReviewRun } from './fixtures/dock-review.ts';
import { RUN_SAMPLE_ID, type RunSample, sampleRunView } from './fixtures/run-view.ts';
import { sampleStepRun, STEP_SAMPLE_ID, STEP_SAMPLE_OPEN, type StepSample } from './fixtures/run-steps.ts';
import { CLIENTS, ROOT } from './fixtures/shared.ts';
import { samplePerTokenSetup, sampleSettingsHub, sampleTrackerBoards } from './fixtures/settings.ts';
import { sampleQueueBoards, sampleQueueConnect } from './fixtures/queues.ts';
import { sampleFirstSetup, sampleSetup } from './fixtures/setup.ts';
import { sampleSetupWithoutProduction } from './fixtures/no-production.ts';
import { sampleSlack, type SlackSample } from './fixtures/slack.ts';
import { sampleTicket } from './fixtures/task-page.ts';
import { sampleTalkTicket, TALK_STATE } from './fixtures/talk.ts';
import { REPORT_TYPED, sampleReport } from './fixtures/report.ts';
import { LONG_STATE, QUESTIONS_STATE, sampleConversation, sampleConversationLong, sampleConversationQuestions, sampleConversationStart, sampleConversationTalk, sampleConversationTicket } from './fixtures/conversation.ts';
import { type ChangesSample, sampleChangesTicket } from './fixtures/changes.ts';
import { RECORDS_FORM_STATE, sampleRecordsTicket } from './fixtures/record-changes.ts';
import { sampleFieldTicket } from './fixtures/changes-field.ts';
import { sampleTeamTicket } from './fixtures/team.ts';
import { sampleManifest } from './fixtures/manifest.ts';
import { ticketManifest } from '../src/model/manifest.ts';
import { sampleSheet } from './fixtures/dispatch-sheet.ts';
import { SAMPLE_THEIRS, sampleTaskSheet } from './fixtures/task-sheet.ts';
import { SAMPLE_EDIT, sampleEdited } from './fixtures/updates.ts';
import { settingsKey, type ThemeChoice } from '../src/model/settings.ts';
import { SETUP_PARTS } from '../src/logic/first-open.ts';
import { PALETTE_THEMES, type PaletteTheme, palettes, vscodeDefaults } from './styles.ts';
import { loadingScreen } from '../src/logic/loading.ts';
import { CHECKS, COLLECT_GEOMETRY, examinedIn, type ExpectedButton, FLOORS_PATH, GEOMETRY_EXCEPTIONS, dumpedGeometry, geometrySummary, ciFloorName, isCiRun, judge, raisedFloors, type Render, runFailures, runFloor } from './geometry.ts';
import { FLOORS_FILE, readFloors, writeFloors } from '../../packages/core/src/ratchets.ts';
import { drawRetried, FONTS_FIRST, fontsUnwaited, retriedSummary, SETTLE, shotTimeout } from './steady.ts';
import { behaviourCheck } from './behaviour.ts';
import { axeScript, COLLECT_A11Y } from './a11y.ts';
import { jobsOption, type Ran, runAsync, runJobs } from './jobs.ts';
import { type Browser, browserOf, PIN, pinnedShell, sha256Of } from './browser.ts';
import { stopOnExit } from './stops.ts';
import { PAGES, type Page, STILL, viewOf, WIDTHS } from './pages.ts';

// The pages live in pages.ts, a line each (T-102); the run's other modules and tests read them from here too.
export { PAGES, type Page, STILL, viewOf, WIDTHS };

const still = (kind: Page): boolean => STILL.includes(kind);

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MIN_WIDTH = 500;

/**
 * The fonts VSCode would set, the same in either theme: the page's colours are theme.css's palettes (GH-109),
 * and these are the only --vscode-* variables the page or VSCode's own webview stylesheet reads that aren't
 * colours, since Light and Dark keep VSCode's fonts.
 */
export const FONTS: Record<string, string> = {
  'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-size': '13px', 'font-weight': 'normal', 'editor-font-family': 'Menlo, Monaco, monospace',
};
/** A shot's theme: Light or Dark, forced, as Settings would force it. */
export type Theme = PaletteTheme;
const other = (t: PaletteTheme): PaletteTheme => (t === 'dark' ? 'light' : 'dark');

/** The label of each Overview row's button in the page's model, by its row's title with its spaces collapsed as the drawn one's are (T-25); null for a page that isn't a section. */
export function expectedButtons(model: Model): ExpectedButton[] | null {
  if (model.kind !== 'home') return null;
  return model.overview.landing.flatMap((g) => g.all).flatMap((r) => (r.action ? [{ row: r.title.replace(/\s+/g, ' ').trim(), label: r.action.label }] : []));
}

/** The busy Overview with a list open over it in full (T-36): Needs you's Show all, or a card's list. */
export const OVERVIEW_LISTS: Partial<Record<Page, GroupKey>> = { 'overview-needs': 'needs-you', 'overview-progress': 'progress', 'overview-ready': 'ready', 'overview-moment': 'moment' };

/** The output panel's review pages (T-63), by the review each shows. */
export const OUTPUT_REVIEWS: Partial<Record<Page, ReviewSample>> = { 'output-passed': 'passed', 'output-changes': 'changes', 'output-reviewing': 'reviewing', 'output-review-open': 'changes', 'output-unread': 'unread' };

/** The output panel's pages of a run as rows (T-64), by the run each shows. */
export const OUTPUT_RUNS: Partial<Record<Page, RunSample>> = { 'output-running': 'running', 'output-done': 'done', 'output-failed': 'failed', 'output-details': 'done' };

/** The output panel's pages of a run of acc as a list of steps (T-65), by the run each shows. */
export const OUTPUT_STEPS: Partial<Record<Page, StepSample>> = { 'output-steps-running': 'steps-running', 'output-steps-failed': 'steps-failed', 'output-steps-done': 'steps-done' };

/** A page's sample data. theme is what Settings shows chosen, as the shot forces it (GH-109). */
export function sampleModel(kind: Page, now = Date.now(), theme: ThemeChoice = 'vscode'): Model {
  // The loading screen is drawn with the Overview's model held back (STILL): it never arrives.
  if (kind === 'loading') return sampleModel('overview', now, theme);
  // The busy Overview with nothing that needs you (T-36): its one calm line, then the cards.
  if (kind === 'overview-clear') {
    const m = sampleModel('overview-landing', now, theme) as HomeModel;
    const o = { ...m.overview, questions: [], attention: [] };
    const lists = landing(o, now);
    return { ...m, nav: m.nav.map((n) => (n.section === 'overview' ? { ...n, count: 0 } : n)), overview: { ...o, landing: lists, cards: overviewCards(lists) } };
  }
  // History with more than two pages (D-170): 100 entries over six or seven days, a page of them drawn.
  if (kind === 'overview-pages') {
    const long = sampleLongHub(now);
    return homeModel({ hub: long.hub, section: 'overview', boards: () => sampleBoards(), identity: () => sampleIdentity(), setup: sampleSetup(), runs: long.runs, edited: sampleEdited, slack: sampleSlack('on', now), autopilot: () => 'on', theme, now });
  }
  // The output panel on a review (T-63), over the Tasks board, with the other runs behind it in the picker.
  if (OUTPUT_REVIEWS[kind]) {
    return homeModel({ hub: sampleHub(now), section: 'tasks', boards: () => sampleBoards(), identity: () => sampleIdentity(), setup: sampleSetup(), runs: [sampleReviewRun(now, OUTPUT_REVIEWS[kind]!), ...sampleRuns(now)], edited: sampleEdited, slack: sampleSlack('on', now), theme, now });
  }
  // A run in the output panel as rows (T-64), over the Tasks board, with the other runs behind it in the picker.
  if (OUTPUT_RUNS[kind]) {
    return homeModel({ hub: sampleHub(now), section: 'tasks', boards: () => sampleBoards(), identity: () => sampleIdentity(), setup: sampleSetup(), runs: [sampleRunView(now, OUTPUT_RUNS[kind]!), ...sampleRuns(now)], edited: sampleEdited, slack: sampleSlack('on', now), theme, now });
  }
  // A run of acc in the output panel as a list of steps (T-65), over the Tasks board.
  if (OUTPUT_STEPS[kind]) {
    return homeModel({ hub: sampleHub(now), section: 'tasks', boards: () => sampleBoards(), identity: () => sampleIdentity(), setup: sampleSetup(), runs: [sampleStepRun(now, OUTPUT_STEPS[kind]!), ...sampleRuns(now)], edited: sampleEdited, slack: sampleSlack('on', now), theme, now });
  }
  if (kind === 'ticket') return sampleTicket(now);
  if (kind === 'ticket-questions') return sampleTicket(now, 'ACME-21');
  // ACME-21's plan approved, and changed since (T-97): each with its earlier versions.
  if (kind === 'ticket-plan-approved') return sampleTicket(now, 'ACME-21', false, null, null, 'approved');
  if (kind === 'ticket-plan-shapes') return sampleTicket(now, 'ACME-21', false, null, null, 'shapes');
  // ACME-21's plan with two comments on its ticket since it was made (T-110).
  if (kind === 'ticket-plan-behind') return sampleTicket(now, 'ACME-21', false, null, null, 'behind');
  if (kind === 'ticket-plan-changed') return sampleTicket(now, 'ACME-21', false, null, null, 'changed');
  // ACME-21's plan in short, and Review plan open over it at a choice, a question and the summary (T-109).
  if (kind === 'ticket-review-summary') return sampleTicket(now, 'ACME-21', false, null, null, 'approved');
  if (kind === 'ticket-plan-short' || kind.startsWith('ticket-review-')) return sampleTicket(now, 'ACME-21');
  if (kind === 'ticket-split') return sampleTicket(now, 'ACME-23');
  if (kind === 'ticket-stopped') return sampleTicket(now, 'ACME-29');
  // A builder in the cloud, quiet for too long (GH-69).
  if (kind === 'ticket-cloud') return sampleTicket(now, 'ACME-44');
  if (kind === 'ticket-nofields') return sampleTicket(now, 'ACME-50');
  // Claude Code isn't found on this Mac's path (T-94): acc can't see the builder, and Dispatch again is off, with why.
  if (kind === 'ticket-missing') return sampleTicket(now, 'ACME-48');
  if (kind === 'ticket-track') return sampleTicket(now, 'ACME-31');
  if (kind === 'ticket-checks') return sampleTicket(now, 'ACME-33');
  if (kind === 'ticket-waits') return sampleTicket(now, 'ACME-35');
  if (kind === 'ticket-note') return sampleTicket(now, 'ACME-20');
  // ACME-19 in rework, in its own tab, with Dispatch's sheet over it (D-168), or the task sheet (T-74).
  if (kind === 'ticket-review' || kind === 'ticket-dispatch' || kind === 'ticket-edit') return sampleTicket(now, 'ACME-19');
  // ACME-19 where its tracker allows edits (T-80): its description has Edit, and the sheet over it writes to its ticket.
  if (kind === 'ticket-edit-on' || kind === 'ticket-edit-changed' || kind === 'ticket-edit-unkept') return sampleTicket(now, 'ACME-19', true);
  // ACME-19 with its drafted acceptance criteria (T-81): the sheet over it with the draft in its description, and the draft opened as an update.
  if (kind === 'ticket-criteria-sheet') return sampleTicket(now, 'ACME-19', true, 'drafted');
  if (kind === 'ticket-criteria-update') return sampleTicket(now, 'ACME-19', true, 'update');
  // ACME-21, which a developer built (T-84): its pull request verified and passed, verified and needing changes, or two to choose from.
  if (kind === 'ticket-verify-pass') return sampleTicket(now, 'ACME-21', false, null, 'pass');
  if (kind === 'ticket-verify-changes') return sampleTicket(now, 'ACME-21', false, null, 'changes');
  if (kind === 'ticket-verify-choice') return sampleTicket(now, 'ACME-21', false, null, 'choice');
  // A ticket's Planned changes, then Changes (T-99): ACME-35's plan, ACME-12's work with a change outside its plan, and ACME-20's kept after its merge.
  if (kind === 'ticket-planned' || kind === 'ticket-changes' || kind === 'ticket-kept') return sampleChangesTicket(now, kind.slice('ticket-'.length) as ChangesSample);
  // ACME-20's record changes (T-100): planned and recorded, the form for a change made by hand, and promoted to UAT with a step to run.
  if (kind === 'ticket-records') return sampleRecordsTicket(now, 'kept');
  if (kind === 'ticket-records-form') return sampleRecordsTicket(now, 'form');
  if (kind === 'ticket-records-promoted') return sampleRecordsTicket(now, 'promoted');
  // ACME-12's Jira "Deployment Notes" field (T-105): what a developer wrote there by hand, how it differs, and the draft.
  if (kind === 'ticket-changes-field') return sampleFieldTicket(now);
  // ACME-12's Team (T-103): sharing files with two others and two merges behind dev, then up to date and sharing none.
  if (kind === 'ticket-team' || kind === 'ticket-team-alone') return sampleTeamTicket(now, kind === 'ticket-team' ? 'shared' : 'alone');
  // ACME-19's manifest, checked against Acme Dev (T-101): an org copy that differs, an org change to add, and a deletion.
  if (kind === 'ticket-manifest') {
    const t = sampleTicket(now, 'ACME-19');
    return { ...t, manifest: ticketManifest({ task: { id: 'ACME-19', run: { branch: 'task/ACME-19-welcome-email-once' }, state: 'rework', source: { kind: 'jira', key: 'ACME-19', url: null } }, profile: 'salesforce', org: 'Acme Dev', manifest: sampleManifest(now), running: null }) };
  }
  // ACME-21's page once v2 is made from its conversation (T-98): the plan section's one line of it (T-111), never the turns.
  if (kind === 'ticket-talk') return sampleTalkTicket(now, true);
  // A plan's conversation (T-111): ACME-21's page before its plan, with the line; then the panel at the start of a
  // plan, mid-conversation with a reply on its way, and Talk it through once v2 is made.
  if (kind === 'ticket-conversation') return sampleConversationTicket(now);
  if (kind === 'conversation-start') return sampleConversationStart(now);
  if (kind === 'conversation') return sampleConversation(now);
  if (kind === 'conversation-talk') return sampleConversationTalk(now);
  // The agent's questions one at a time, part-way through, and a long Talk it through folded (T-113).
  if (kind === 'conversation-questions') return sampleConversationQuestions(now);
  if (kind === 'conversation-long') return sampleConversationLong(now);
  // Report a problem (T-118): as it opens, filled in, not posted for want of access, and posted.
  if (kind === 'report' || kind === 'report-filled' || kind === 'report-no-access' || kind === 'report-posted') return sampleReport(kind);
  // A ticket's page from each tracker past Jira and Slack (T-91): a GitHub issue, an Azure DevOps backlog item and a monday.com item.
  if (kind === 'ticket-github' || kind === 'ticket-azure' || kind === 'ticket-monday') return sampleTrackerTicket(now, kind.slice('ticket-'.length) as TrackerTicketSample);
  if (kind === 'agent') return sampleAgent(now);
  if (kind === 'queue' || kind === 'queue-off' || kind === 'queue-held') {
    // Held, the head says why in the wait's own words, which can be long.
    const hub = kind === 'queue-held' ? sampleQueueHub(now, 'held', 'GitHub is still working out whether pull request #141 can merge.') : sampleQueueHub(now);
    return homeModel({ hub, section: 'overview', boards: () => [], identity: () => sampleIdentity(), setup: { items: [], confirmed: new Set() }, runs: [], autopilot: () => (kind === 'queue-off' ? null : 'on'), now });
  }
  // Rules suggested by review findings that keep coming back, on the quiet Overview (GH-102).
  if (kind === 'rules' || kind === 'rules-accept') {
    return homeModel({ hub: sampleRulesHub(now), section: 'overview', boards: () => sampleBoards(), identity: () => sampleIdentity(), setup: sampleSetup(), runs: [], edited: sampleEdited, slack: sampleSlack('on', now), now });
  }
  if (kind === 'overview-busy' || kind === 'overview-idle') {
    const base = { section: 'overview' as const, boards: () => sampleBoards(), identity: () => sampleIdentity(), setup: sampleSetup(), edited: sampleEdited, slack: sampleSlack('on', now) };
    if (kind === 'overview-idle') return homeModel({ ...base, hub: sampleIdleHub(now), runs: sampleRuns(now), now });
    // Two looks, 20 seconds apart: autopilot's review of ACME-20 ended between them, so it's a done line.
    const finished = new FinishedJobs();
    const runs = [...sampleRuns(now), sampleAnalyzeRun(now)];
    homeModel({ ...base, hub: sampleBusyHub(now, true), runs, finished, autopilot: () => 'on', now: now - 20_000 });
    return homeModel({ ...base, hub: sampleBusyHub(now), runs, finished, autopilot: () => 'on', now });
  }
  // The Overview when everything is busy at once, and with a detail opened over it (GH-160).
  // With what changed while the person was away above the cards (D-164).
  if (kind === 'overview-landing' || kind === 'overview-answer' || kind === 'overview-drafts' || kind === 'overview-history' || kind === 'overview-since' || OVERVIEW_LISTS[kind]) {
    return homeModel({ hub: sampleLandingHub(now), section: 'overview', boards: () => sampleBoards(), identity: () => sampleIdentity(), setup: sampleSetup(), runs: sampleLandingRuns(), edited: sampleEdited, slack: sampleSlack('on', now), autopilot: () => 'on', now, ...(kind === 'overview-since' ? { since: sampleSince() } : {}) });
  }
  // Environments where the last Setup check found this machine isn't logged in to Production (D-208).
  if (kind === 'environments-away') {
    return homeModel({ hub: sampleHub(now), section: 'environments', boards: () => sampleBoards(), identity: () => sampleIdentity(), setup: sampleSetupWithoutProduction(), runs: [], theme, now });
  }
  // Setup as it's first shown in a folder that isn't set up, which no project is loaded from (GH-138).
  if (kind === 'setup-first' || kind === 'setup-first-machine') {
    return homeModel({ hub: { ...sampleHub(now), projects: [], agents: [], questions: [] }, section: 'setup', boards: () => [], identity: () => null, setup: sampleFirstSetup(kind === 'setup-first'), runs: [], theme, now });
  }
  // Settings at How agents run, and Agents, with two projects and agents that would bill per token (GH-110).
  const perToken = kind === 'settings-agents' || kind === 'agents-billing';
  // Agents, on a busy machine: this window's two projects, one with no agents, and repos elsewhere (GH-119).
  const agents = kind === 'agents' || kind === 'agents-path' || kind === 'agents-finished';
  // Settings' Limits and checks in their other states (GH-111): no total, slots from the environment, two projects.
  const hub = kind === 'settings-limits' ? { ...sampleHub(now), limits: () => sampleLimitsOther() } : perToken || agents || kind === 'settings-trackers' || kind === 'settings-github' ? sampleSettingsHub(now) : sampleHub(now);
  // A service desk's queues as cards (T-128), ticked or refused to a sign-in that isn't an agent's.
  const connect = kind === 'connect-jira-queues' || kind === 'connect-jira-queues-refused' ? sampleQueueConnect(kind.endsWith('refused')) : kind.startsWith('connect-') ? sampleConnect(kind.slice('connect-'.length) as ConnectSample) : null;
  const slack = sampleSlack(kind.startsWith('slack-') ? kind.slice('slack-'.length) as SlackSample : 'on', now);
  // A project started from an epic opens the Connect page over Setup, where "From a Jira epic…" is (GH-81).
  const section = (kind === 'output' || kind.startsWith('connect-epic') ? 'setup' : connect || kind === 'tasks-monday' || kind === 'tasks-github' || kind.startsWith('tasks-azure') || kind === 'tasks-sprint' || kind === 'tasks-queues' || kind.startsWith('tasks-slack') || kind === 'tasks-modal' || kind === 'tasks-agents' || kind === 'tasks-first' || kind === 'tasks-moving' || kind.startsWith('palette') || kind.startsWith('dispatch-sheet') || kind.startsWith('task-sheet') || kind === 'tasks-card-menu' || kind.startsWith('tasks-person') ? 'tasks' : kind.startsWith('slack-') ? 'settings' : kind === 'agents-billing' || kind === 'agents-path' || kind === 'agents-finished' ? 'agents' : kind.startsWith('settings-') ? 'settings' : kind) as HomeSection;
  // Settings' trackers are each project's own (GH-112); every other page shows the sample board for each.
  const boards = kind === 'settings-trackers' ? sampleTrackerBoards : kind === 'tasks-monday' ? sampleMondayBoards : kind === 'tasks-github' ? sampleGithubBoards : kind === 'tasks-azure' ? sampleAzureBoards : kind === 'tasks-azure-loading' ? sampleAzureLoading : kind === 'tasks-azure-refreshing' ? sampleAzureRefreshing : kind === 'tasks-sprint' ? sampleSprintBoards
    // Two Jira Service Management queue boards on one project (T-128), on the Tasks tab and in Settings.
    : kind === 'tasks-queues' || kind === 'settings-queues' ? sampleQueueBoards
    // A Slack channel (T-31, T-85): its board off beside the box for a thread's link, with a link Track refused,
    // its board of marked messages Open and Done, an empty board, and an app without the scope to read the channel.
    : kind.startsWith('tasks-slack') ? () => sampleSlackBoards(kind === 'tasks-slack' ? 'off' : kind.slice('tasks-slack-'.length) as SlackBoardSample) : sampleBoards;
  // The Command Center's own preferences, each set to other than its default (GH-113).
  const prefs = kind === 'settings-page' ? { pace: 'relaxed' as const, opensOn: 'tasks' as const } : {};
  return homeModel({
    hub, section, boards: (root) => boards(root), identity: kind === 'settings-github' ? sampleIdentities : () => sampleIdentity(), setup: perToken ? samplePerTokenSetup() : sampleSetup(),
    runs: sampleRuns(now), edited: sampleEdited, connect, slack, whereView: kind === 'agents-path' || kind === 'settings-page' ? 'path' : 'folder', theme, ...prefs,
    // About (GH-114): up to date, or behind with a newer release and an older plugin, or a look that failed.
    about: kind === 'settings-about' ? sampleAboutBehind(now) : kind === 'settings-about-failed' ? sampleAboutFailed(now) : sampleAbout(now), now,
  });
}

/** A run of acc's steps open in the panel (T-65), with the step its sample opens. */
function stepsState(k: StepSample): unknown {
  const id = STEP_SAMPLE_ID[k];
  const step = STEP_SAMPLE_OPEN[k];
  return { dock: { open: true, run: id }, ...(step ? { opened: [`run-step:${id}:${step}`] } : {}) };
}

/** ACME-21's The whole plan, open (T-109), and the start of the keys its Review plan remembers. */
const WHOLE_PLAN = 'an:/Users/me/code/acme-service#ACME-21:whole';
const REVIEW = 'review:/Users/me/code/acme-service#ACME-21';

/**
 * What the page remembers when it opens: the output page starts with the panel open, the split ticket
 * with two of its analysis's lists open, to see them laid out, and ACME-12's with the edit typed for the
 * draft a newer one replaced (GH-46).
 */
// ACC_SHOT_STATE, a JSON object, starts every page with that state instead: for checking what a page restores.
export const startState = (kind: Page): unknown => (process.env.ACC_SHOT_STATE ? JSON.parse(process.env.ACC_SHOT_STATE) : kind === 'output' ? { dock: { open: true, run: 'r-login' } }
  // A review in the output panel (T-63); opened, with its summary, its criterion not met, its must-fix finding and the met criteria open.
  : kind === 'output-review-open' ? { dock: { open: true, run: REVIEW_RUN }, opened: ['summary', 'c1', 'f0', 'met'].map((p) => `dock-review:${REVIEW_RUN}:${p}`) }
  : OUTPUT_REVIEWS[kind] ? { dock: { open: true, run: REVIEW_RUN } }
  // A run as rows (T-64); the done deploy also with its Details open.
  : kind === 'output-details' ? { dock: { open: true, run: RUN_SAMPLE_ID.done }, opened: [`dock-details:${RUN_SAMPLE_ID.done}`] }
  : OUTPUT_RUNS[kind] ? { dock: { open: true, run: RUN_SAMPLE_ID[OUTPUT_RUNS[kind]!] } }
  // A run of acc's steps (T-65); the failed promotion with its failed check open to its rows.
  : OUTPUT_STEPS[kind] ? stepsState(OUTPUT_STEPS[kind]!)
  : kind === 'rules' ? { detail: { kind: 'rules' } }
  : kind === 'rules-accept' ? { opened: ['rule:/Users/me/code/acme-service#r-4c0f1e:draft'], detail: { kind: 'rules' } }
  : kind === 'overview-answer' ? { detail: { kind: 'question', id: 'm1-aaaa0002' } }
  : kind === 'overview-drafts' ? { detail: { kind: 'updates' } }
  : kind === 'overview-history' ? { detail: { kind: 'history', at: 'answer:h3' } }
  : kind === 'overview-pages' ? { detail: { kind: 'history' } }
  : OVERVIEW_LISTS[kind] ? { detail: { kind: 'list', group: OVERVIEW_LISTS[kind] } }
  : kind === 'agents-finished' ? { opened: [ROOT, CLIENTS].map((r) => `agents-finished:${r}`) }
  // The agent board, with two builders in the cloud (GH-69): the Tasks tab remembers which board shows.
  : kind === 'tasks-agents' ? { modes: { [ROOT]: 'agents' } }
  // A card's actions on the agent board (D-168): its next step full width, and the rest in its ⋯ menu, opened.
  : kind === 'tasks-card-menu' ? { modes: { [ROOT]: 'agents' }, openMenu: `card:${ROOT}#ACME-16` }
  // The palette with nothing typed (T-52) shows what was run last, newest first: a task, a part of Settings, an action and a section.
  : kind === 'palette-empty' ? { palette: [`task:${ROOT}#ACME-12`, 'setting:agents', 'action:add-task', 'section:agents'] }
  // A card held up by Space on the Jira board (T-54), with In Progress chosen: Space then Right.
  : kind === 'tasks-moving' ? { holding: { card: 'ACME-16', at: 'col-1' } }
  // The Jira board's person filter open (T-79), the board filtered to one person, and the agent board filtered to Mine.
  : kind === 'tasks-person-menu' ? { openFilter: `tracker:${ROOT}#0` }
  : kind === 'tasks-person' ? { filters: { [`tracker:${ROOT}#0`]: 'person:pat' } }
  // A person with no card on the Jira board, as a refresh leaves one whose cards all moved: the board says so, with Show everyone.
  : kind === 'tasks-person-none' ? { filters: { [`tracker:${ROOT}#0`]: 'person:nobody' } }
  : kind === 'tasks-person-agents' ? { modes: { [ROOT]: 'agents' }, filters: { [`agents:${ROOT}`]: 'mine' } }
  // Add a change made by hand (T-100), opened and half-filled, and a step's Skip open, as the tab's memory keeps them.
  : kind === 'ticket-records-form' ? RECORDS_FORM_STATE
  // ACME-21's plan (T-97): its second choice's own option open, and the later plans with their earlier versions open.
  // Approved, a change to its second choice asks first, as Choose this on Backfill too leaves it.
  // Each with The whole plan open (T-109), where the choices are in full.
  : kind === 'ticket-questions' ? { opened: ['plan:/Users/me/code/acme-service#ACME-21:d2:own', WHOLE_PLAN], drafts: { 'plan:/Users/me/code/acme-service#ACME-21:d2': 'Backfill only the opportunities still open' } }
  : kind === 'ticket-plan-approved' ? { opened: ['plan:/Users/me/code/acme-service#ACME-21:earlier', 'plan:/Users/me/code/acme-service#ACME-21:d2:confirm:b', WHOLE_PLAN] }
  : kind === 'ticket-plan-shapes' ? { opened: ['plan:/Users/me/code/acme-service#ACME-21:earlier', WHOLE_PLAN] }
  // What it found open, so the finding that names the comment it rests on shows (T-110).
  : kind === 'ticket-plan-behind' ? { opened: ['an:/Users/me/code/acme-service#ACME-21:findings', WHOLE_PLAN] }
  : kind === 'ticket-plan-changed' ? { opened: ['plan:/Users/me/code/acme-service#ACME-21:earlier', WHOLE_PLAN] }
  // Review plan over ACME-21 (T-109): at its first choice, its current choice picked and marked so, with More
  // about the other option open; at the question for the ticket's author with an answer typed in its own words;
  // at a question already answered; and, on the approved plan, at the summary with the author's question skipped.
  : kind === 'ticket-review-choice' ? { opened: [`${REVIEW}:open`, `${REVIEW}:more:d1.b`], drafts: { [`${REVIEW}:at`]: 'd1' } }
  : kind === 'ticket-review-question' ? { opened: [`${REVIEW}:open`], drafts: { [`${REVIEW}:at`]: 'q2', [`${REVIEW}:pick:q2`]: 'mine', 'analysis:/Users/me/code/acme-service#ACME-21:q2': 'Decision Maker, as the pipeline report does today' } }
  : kind === 'ticket-review-answered' ? { opened: [`${REVIEW}:open`], drafts: { [`${REVIEW}:at`]: 'q3' } }
  : kind === 'ticket-review-summary' ? { opened: [`${REVIEW}:open`, `${REVIEW}:skip:q2`], drafts: { [`${REVIEW}:at`]: 'summary' } }
  // ACME-21's page with The whole plan open, where Discuss is on each step and risk (T-98).
  : kind === 'ticket-talk' ? { opened: [...['plan', 'risks'].map((f) => `an:/Users/me/code/acme-service#ACME-21:${f}`), WHOLE_PLAN] }
  // The next message to ACME-21's planning agent (T-98), in its panel (T-111), about an option, quoted, half-written.
  // Its earlier turns open (T-113), so every turn, proposal and what changed is drawn; conversation-long draws the fold.
  : kind === 'conversation-talk' ? { ...TALK_STATE, opened: [`talk:${ROOT}#ACME-21:earlier`] }
  // The card part-way through the agent's three questions (T-113): the first answered, the second picked.
  : kind === 'conversation-questions' ? QUESTIONS_STATE
  // The long conversation's question put aside, as one line with Answer the questions (T-113).
  : kind === 'conversation-long' ? LONG_STATE(sampleConversationLong(Date.now()).talk!.questions!.turn)
  // What's typed in Report a problem's draft (T-118), the same after Post.
  : kind === 'report-filled' || kind === 'report-no-access' || kind === 'report-posted' ? { drafts: REPORT_TYPED }
  : kind === 'ticket-split' ? { opened: ['files', 'findings'].map((f) => `an:/Users/me/code/acme-service#ACME-23:${f}`) }
    : kind === 'ticket' ? { drafts: { [`update:/Users/me/code/acme-service#${SAMPLE_EDIT.id}`]: SAMPLE_EDIT.text }, bases: { [`update:/Users/me/code/acme-service#${SAMPLE_EDIT.id}`]: { text: SAMPLE_EDIT.base } } } : undefined);
/**
 * The page's memory as a shot starts (T-96): startState's, with the Tasks tab's first steps already dismissed,
 * as a person who has used it before sees it, but on tasks-first, which shows them as someone new does.
 */
export const shotState = (kind: Page): Record<string, unknown> => ({ ...(startState(kind) as Record<string, unknown> | undefined), ...(kind === 'tasks-first' ? {} : { firstStepsSeen: true }) });

/**
 * What the extension sends after the page's model: the task a card's click opened in the modal over the
 * Tasks board, and what its Open as tab sends (GH-158); and the command palette's open, with what's typed (T-52).
 */
export const afterModel = (kind: Page, now = Date.now()): Record<string, unknown>[] => (kind === 'tasks-modal'
  ? [{ type: 'task-modal', model: sampleTicket(now), tab: { type: 'ticket', project: ROOT, tracker: 0, key: 'ACME-12' } }]
  // The command palette (T-52), as acc.palette opens it; the screenshot run types "an" into one, which matches actions, sections and tasks alike.
  : kind === 'palette' ? [{ type: 'palette', query: 'an' }] : kind === 'palette-empty' ? [{ type: 'palette' }]
  // Dispatch's sheet (D-168): over the Tasks board for an analysed task, and over a task's tab in rework with the cloud off.
  : kind === 'dispatch-sheet' ? [{ type: 'dispatch-sheet', sheet: sampleSheet(now, 'analysed') }] : kind === 'ticket-dispatch' ? [{ type: 'dispatch-sheet', sheet: sampleSheet(now, 'rework') }]
  // Dispatch anyway's sheet, with the tasks and files ACME-35 shares above the choices (D-093).
  : kind === 'dispatch-sheet-anyway' ? [{ type: 'dispatch-sheet', sheet: sampleSheet(now, 'anyway') }]
  // The task sheet (T-74): a new task and a manual task's edit over the Tasks board, and ACME-19's edit, a Jira task in rework, over its tab.
  : kind === 'task-sheet-new' ? [{ type: 'task-sheet', sheet: sampleTaskSheet(now, 'new') }] : kind === 'task-sheet-manual' ? [{ type: 'task-sheet', sheet: sampleTaskSheet(now, 'manual') }]
  : kind === 'ticket-edit' ? [{ type: 'task-sheet', sheet: sampleTaskSheet(now, 'tracker') }]
  // With edits on (T-80): ACME-19's sheet with its ticket's text to edit, and the choice when a colleague changed the ticket after it opened.
  : kind === 'ticket-edit-on' ? [{ type: 'task-sheet', sheet: sampleTaskSheet(now, 'edits') }]
  : kind === 'ticket-edit-unkept' ? [{ type: 'task-sheet', sheet: sampleTaskSheet(now, 'unkept') }]
  : kind === 'ticket-criteria-sheet' ? [{ type: 'task-sheet', sheet: sampleTaskSheet(now, 'criteria') }]
  : kind === 'ticket-edit-changed' ? [{ type: 'task-sheet', sheet: sampleTaskSheet(now, 'edits') }, { type: 'task-sheet-done', project: ROOT, task: 'ACME-19', ok: false, conflict: SAMPLE_THEIRS }] : []);
/**
 * The title each kind of tab carries, as htmlFor in panels.ts gives it: a page needs one to be named (T-55).
 * A plan's conversation is titled for its ticket, ACME-21 in the run (T-111), and Report a problem as its panel is (T-118).
 */
export const TAB_TITLES: Record<string, string> = { home: 'Command Center', ticket: 'Ticket', agent: 'Agent', conversation: conversationTitle('ACME-21'), report: REPORT_TITLE };
/** A part the extension asks the page to go to as it opens, as the status bar's Auto-merge does (GH-110). */
export const openAt = (kind: Page): string | null => (kind === 'settings-agents' ? settingsKey('agents') : kind === 'settings-trackers' || kind === 'settings-queues' ? settingsKey('trackers')
  : kind.startsWith('slack-') ? settingsKey('slack') : kind === 'settings-github' ? settingsKey('github') : kind === 'settings-page' ? settingsKey('page') : kind.startsWith('settings-about') ? settingsKey('about')
  : kind === 'setup-first' ? SETUP_PARTS.kind : kind === 'setup-first-machine' ? SETUP_PARTS.machine : null);

/** How tall a shot is unless --height says. */
export const DEFAULT_HEIGHT = 900;

/**
 * Pages whose part sits below the fold at the default height, shot taller: the Overview, a landing page of
 * short lists (GH-160), is shot tall enough to show its last, History, and with a detail open over it, tall
 * enough for the modal to hold all of it, since the panel's height sets the modal's. So is the
 * Merge queue panel, below In progress and the tiles (GH-73), and the last of Settings' parts (GH-109).
 * Settings at How agents run is shot tall enough not to scroll (GH-110): under 820 px its jump scrolls the
 * document itself, which headless Chrome draws as a blank band above the tab strip. A builder's note sits
 * below the description, under the side panels where a narrow tab stacks them (D-106). Agents is shot
 * tall enough to show every repo on the busy machine, down to Other folders (GH-119), and so is Settings at
 * Trackers and sign-ins, further down (GH-112). Settings opened at Notices in Slack, GitHub accounts or the
 * Command Center's preferences is shot tall enough not to scroll at 500 px, and Environments tall enough to
 * show This machine's line saying Slack moved (GH-113). The output panel on a review with its rows opened is shot tall
 * enough for the panel, which takes under half the height, to show the met criteria at the end (T-63). A
 * developer's pull request verified is shot tall enough to show its QA comment's draft in the Activity (T-84).
 * The Connect page with two Jira epics ticked, and GitHub's Project cards, are shot tall enough to show the
 * ticked cards and the access card at 500 px (T-107).
 */
export const PAGE_HEIGHT: Partial<Record<Page, number>> = { 'overview-busy': 1900, 'overview-idle': 1700, 'overview-landing': 1900, 'overview-answer': 1100, 'overview-drafts': 1100, 'overview-history': 1300, 'overview-pages': 1300, 'overview-needs': 1100, 'overview-progress': 1100, 'overview-ready': 1100, 'overview-moment': 1100, 'overview-clear': 1100, 'overview-since': 1500, queue: 1500, 'queue-off': 1500, 'queue-held': 1500, settings: 3800, 'settings-agents': 3800, 'settings-limits': 3800, 'ticket-note': 1600, 'ticket-review': 1950, agents: 2000, 'agents-path': 2300, 'agents-finished': 2300, 'settings-trackers': 5000, 'settings-queues': 5000, 'slack-none': 5000, 'slack-off': 5000, 'slack-paused': 5000, 'settings-github': 5800, 'settings-page': 5000, environments: 1400, 'environments-away': 1400, rules: 1300, 'rules-accept': 1500, 'settings-about': 7200, 'settings-about-failed': 7200, 'output-review-open': 2000, 'ticket-verify-pass': 2200, 'ticket-verify-changes': 2400, 'ticket-verify-choice': 1300, 'ticket-planned': 2100, 'ticket-changes': 3000, 'ticket-kept': 2000, 'ticket-records': 2400, 'ticket-records-form': 2800, 'ticket-records-promoted': 2800, 'ticket-manifest': 2600, 'ticket-questions': 3300, 'ticket-plan-approved': 3000, 'ticket-plan-changed': 3300, 'ticket-plan-shapes': 3300, 'ticket-plan-behind': 3300, 'connect-jira-epics': 2000, 'connect-github-board': 1900, 'connect-github-access': 1700, 'ticket-talk': 3600, 'conversation-talk': 3400, 'conversation': 1400, 'ticket-changes-field': 3600, 'connect-existing': 2600, 'ticket-team': 2700, 'ticket-team-alone': 2500, report: 2800, 'report-filled': 2800, 'report-no-access': 3000, 'report-posted': 3000 };

/** The colour properties the colour check compares, on every element and its ::before and ::after. */
export const COLOUR_PROPERTIES = [
  'color', 'background-color', 'background-image', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'outline-color', 'text-decoration-color', 'text-emphasis-color', 'column-rule-color', 'caret-color', 'accent-color', 'scrollbar-color',
  'box-shadow', 'text-shadow', 'fill', 'stroke', '-webkit-text-fill-color', '-webkit-text-stroke-color',
] as const;

/**
 * Collects every element's computed colours, a moment after the page is drawn and hovered, into a JSON
 * script element that Chrome's --dump-dom prints: [what it is, its colours] per element and pseudo-element.
 * Headless Chrome draws frames only now and then while it dumps the page, so a frame callback, such as a
 * short fold's Show all taking itself away, ran in some drawings and not others. While collecting, frame
 * callbacks run on a timer instead, so every drawing has run them before its colours are gathered.
 */
const COLLECT = `
window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);`;
const COLLECT_COLOURS = `
function collectColours() {
  const props = ${JSON.stringify(COLOUR_PROPERTIES)};
  const rows = [];
  for (const e of document.querySelectorAll('body *')) {
    if (e.id === 'acc-colours') continue;
    for (const pseudo of [null, '::before', '::after']) {
      const s = getComputedStyle(e, pseudo);
      if (pseudo && (s.content === 'none' || s.content === 'normal')) continue;
      const what = e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\\s+/).join('.') : '') + (pseudo ?? '');
      rows.push([what, props.map((p) => s.getPropertyValue(p))]);
    }
  }
  const out = document.createElement('script');
  out.type = 'application/json';
  out.id = 'acc-colours';
  out.textContent = JSON.stringify(rows);
  document.body.append(out);
}`;

/**
 * A modal's open fades from opacity 0 (T-47), and so does each step of Review plan (T-109); the geometry check
 * skips what is transparent, and axe reads a colour half-faded: a measured page opens its modal and step at once.
 */
const NO_MODAL_FADE = '<style>dialog { transition: none !important; } dialog .rp-step { animation: none !important; }</style>';

/**
 * A page that loads the built webview the way VSCode does: a stub API answers `ready` with the model.
 * Screenshots can't hover, so each :hover rule is copied to a class put on the first row or card.
 * A page as VSCode would show it with `under`'s theme (GH-109): VSCode's own webview stylesheet first in
 * the head, that theme's colours inline on <html> and its class on <body>, and the page's theme in
 * data-theme. A shot forces Light or Dark under VSCode's other theme, so a colour that still comes from
 * VSCode's shows in it. With collect, the page also gathers its computed colours for the colour check;
 * with measure, its geometry for the geometry checks (GH-105), once its fonts have loaded, two frames
 * have drawn and the rail's selected tab has stopped moving (GH-167), and then what axe-core finds, which
 * it loads inline before the harness's own scripts (T-55, a11y.ts). Every page loads its fonts before
 * it's sent its model, so a font that comes late on a busy machine can't move the rail's tab (T-21).
 */
export function pageFor(kind: Page, theme: ThemeChoice, model: Model, under: Theme = theme === 'light' ? 'dark' : 'light', collect = false, measure = false, after: Record<string, unknown>[] = afterModel(kind)): string {
  const vars = Object.entries({ ...palettes()[under], ...FONTS }).map(([k, v]) => `--vscode-${k}: ${v};`).join(' ');
  // `<` escaped, so no string in the model can close the script tag.
  const json = JSON.stringify(model).replace(/</g, '\\u003c');
  const then = JSON.stringify(after).replace(/</g, '\\u003c');
  const open = openAt(kind);
  // A still page sends no model, but is hovered, collected and measured all the same.
  const send = still(kind) ? '' : `window.postMessage({ type: 'state', model: MODEL${open ? `, jump: true, open: ${JSON.stringify(open)}` : ''} }, '*'); for (const m of AFTER) window.postMessage(m, '*'); `;
  // The loading screen fades in (T-16), and a fade at opacity 0 reads as unseen. Headless Chrome's virtual time
  // doesn't move animations, so a still page ends its fades itself before it's measured, as they'd have ended.
  const faded = still(kind) ? 'document.getAnimations().filter((a) => a.effect.getTiming().iterations !== Infinity).forEach((a) => a.finish()); ' : '';
  const opening = still(kind) ? loadingScreen('home', { dark: 'webview/acc-dark.svg', light: 'webview/acc-light.svg' }) : '';
  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}" style="${vars.replace(/"/g, '&quot;')}"><head><meta charset="UTF-8">
<title>${TAB_TITLES[viewOf(kind)]}</title>
<style>${vscodeDefaults()}</style>
<link rel="stylesheet" href="webview/codicons/codicon.css">
<link rel="stylesheet" href="webview/styles.css">
${measure ? NO_MODAL_FADE : ''}
${measure ? `<script>${axeScript()}</script>\n` : ''}<script>
const MODEL = ${json};
const AFTER = ${then};
function forceHover() {
  for (const sheet of document.styleSheets) {
    let rules; try { rules = [...sheet.cssRules]; } catch { continue; }
    for (const r of rules) if (r.selectorText && r.selectorText.includes(':hover')) sheet.insertRule(r.cssText.replaceAll(':hover', '.acc-hover'), sheet.cssRules.length);
  }
  (document.querySelector('tbody tr:not(.group):not(.none)') ?? document.querySelector('.card'))?.classList.add('acc-hover');
}${FONTS_FIRST}${collect || measure ? COLLECT : ''}${collect ? COLLECT_COLOURS : ''}${measure ? COLLECT_GEOMETRY + COLLECT_A11Y + SETTLE : ''}
window.acquireVsCodeApi = () => ({
  postMessage(m) { if (m.type === 'ready') fontsFirst(document.fonts, () => setTimeout(() => { ${send}setTimeout(forceHover, 50);${collect ? ' setTimeout(collectColours, 500);' : ''}${measure ? ` setTimeout(() => { ${faded}document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => settle(selectedTab, requestAnimationFrame, () => collectGeometry(collectA11y))))); }, 300);` : ''} })); },
  getState() { return ${JSON.stringify(shotState(kind))}; }, setState() {},
});
</script>
</head>
<body class="vscode-${under}" data-view="${viewOf(kind)}" data-logo-dark="webview/acc-dark.svg" data-logo-light="webview/acc-light.svg"><main id="app">${opening}</main><script src="webview/main.js"></script></body></html>
`;
}

/** What findChrome says when it falls back to the Chrome app: the run may take it over, and how to get the shell. */
export const APP_WARNING = 'The pinned headless shell isn\'t here, so this run draws with the Chrome app and may take it over while it runs. Run npm run browser to get the shell.';

/**
 * The browser to draw with (T-68): $CHROME if set, else the pinned headless shell in the cache, else Chrome,
 * Chromium or Edge in the usual install places or on the PATH. Each says in one line what it draws with; the
 * Chrome app's line says the run may take it over, and names npm run browser.
 */
export function findChrome(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync, say: (line: string) => void = console.log, shell: () => string | null = () => pinnedShell(exists), path: () => string | undefined = onPath): string | null {
  if (env.CHROME) {
    if (!exists(env.CHROME)) return null;
    say(`Drawing with CHROME: ${env.CHROME}.`);
    return env.CHROME;
  }
  const pinned = shell();
  if (pinned) { say(`Drawing with the pinned headless shell, ${PIN.name} ${PIN.version}.`); return pinned; }
  const known = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].find(exists) ?? path();
  if (known) say(APP_WARNING);
  return known ?? null;
}

/** Chrome, Chromium or Edge on the PATH, or undefined. */
function onPath(): string | undefined {
  for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    const r = spawnSync('which', [name], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return undefined;
}

/** What the run says when it finds no browser at all. */
export const NO_BROWSER = 'No browser to draw with. Run npm run browser to get the pinned headless shell, or set CHROME to a browser\'s path.';

/** Why the run has no browser. A CHROME that names no file gets its own message, since nothing is tried past it. */
export const noBrowser = (env: NodeJS.ProcessEnv = process.env): string =>
  (env.CHROME ? `CHROME is set to ${env.CHROME}, but there is no browser there. Fix the path, or unset CHROME to draw with the pinned headless shell.` : NO_BROWSER);

/** The built webview is older than its source, so a screenshot would show the last build. */
function staleBuild(): string | null {
  const built = join(extensionDir, 'dist', 'webview', 'main.js');
  if (!existsSync(built)) return 'there is no built webview yet';
  const src = join(extensionDir, 'webview');
  const newest = Math.max(...readdirSync(src).filter((f) => /\.(ts|css)$/.test(f)).map((f) => statSync(join(src, f)).mtimeMs));
  return newest > statSync(built).mtimeMs ? 'the built webview is older than its source' : null;
}

/** Runs Chrome at lowered priority for at most shotTimeout() (GH-167), gathering what it prints, without blocking (T-58), so jobs draw at once. */
const chromeAsync = (chrome: string, args: string[]): Promise<Ran> => runAsync(chrome, args, shotTimeout(), true);

/** A job's own Chrome profile, under the run's work folder: a Chrome running at once in another job never shares it (T-58). */
export const profileArg = (work: string, slot: number): string => `--user-data-dir=${join(work, `profile-${slot}`)}`;

/** The pages the colour check draws (GH-109): the busiest sections, Settings, a task's page and an agent's, a task in the modal over the board (GH-158), and the busy Overview with its update drafts open over it (GH-160), the loading screen (T-16), and the command palette open with results (T-52). */
export const COLOUR_PAGES: Page[] = ['overview', 'tasks', 'settings', 'settings-agents', 'settings-trackers', 'settings-limits', 'settings-about', 'slack-paused', 'settings-github', 'settings-page', 'ticket', 'agent', 'tasks-modal', 'overview-landing', 'overview-drafts', 'tasks-agents', 'ticket-cloud', 'loading', 'palette'];

/** A page's computed colours, as its collector gathered them: what each element is, and its colours in COLOUR_PROPERTIES' order. */
export type Colours = [string, string[]][];

/** The colours a --dump-dom of a collecting page holds, or null when it never gathered them. */
export function dumpedColours(dom: string): Colours | null {
  const m = /<script[^>]*\bid="acc-colours"[^>]*>([\s\S]*?)<\/script>/.exec(dom);
  return m ? (JSON.parse(m[1]!) as Colours) : null;
}

export interface ColourDiff { what: string; property: string; a: string; b: string }

/** Where two drawings of one page differ in colour. Drawings of different elements differ as a whole, from the first that differs. */
export function colourDiffs(a: Colours, b: Colours): ColourDiff[] {
  const first = a.findIndex(([what], i) => what !== b[i]?.[0]);
  if (first >= 0 || a.length !== b.length) {
    const at = first >= 0 ? first : Math.min(a.length, b.length);
    return [{ what: `the page, from element ${at}`, property: 'its elements', a: `${a.length} elements, ${a[at]?.[0] ?? 'none'} there`, b: `${b.length} elements, ${b[at]?.[0] ?? 'none'} there` }];
  }
  return a.flatMap(([what, values], i) => values.flatMap((v, j) => (v === b[i]![1][j] ? [] : [{ what, property: COLOUR_PROPERTIES[j] ?? `#${j}`, a: v, b: b[i]![1][j] ?? '' }])));
}

/**
 * The colour check (GH-109). Each page is drawn with Dark, Light and Match VSCode under each of VSCode's
 * themes, and its computed colours compared: Dark forced under VSCode's light theme is Dark forced under
 * its dark one, Light the same, and Match VSCode under a theme is that theme forced. Any difference fails,
 * and so does a page that compared no elements.
 */
async function colourCheck(chrome: string, work: string, views: Page[]): Promise<number> {
  const now = Date.now();
  const retried: string[] = [];
  let elements = 0;
  let differences = 0;
  for (const view of views) {
    const drawn = new Map<string, Colours>();
    for (const theme of ['dark', 'light', 'vscode'] as const) {
      for (const under of PALETTE_THEMES) {
        const page = join(work, `${view}-${theme}-under-${under}.html`);
        // One model for every drawing, so only the theme differs between them.
        writeFileSync(page, pageFor(view, theme, sampleModel(view, now), under, true, false, afterModel(view, now)));
        const what = `${view} (${theme} under ${under})`;
        // A drawing that timed out is drawn once more, and the run says so (GH-167).
        const r = await drawRetried(() => chromeAsync(chrome, [profileArg(work, 0), '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
          '--virtual-time-budget=3000', '--window-size=1000,900', '--dump-dom', pathToFileURL(page).href]), what, retried);
        if (r.error) return fail(`Chrome didn't finish ${what} within ${shotTimeout() / 1000} s: ${r.error.message}`);
        const colours = dumpedColours(r.stdout);
        if (!colours?.length) return fail(`${view} (${theme} under VSCode's ${under}) gathered no colours (exit ${r.status ?? r.signal}).`);
        drawn.set(`${theme}/${under}`, colours);
      }
    }
    const pairs = [['dark/light', 'dark/dark'], ['light/dark', 'light/light'], ['vscode/dark', 'dark/dark'], ['vscode/light', 'light/light']] as const;
    const words = (k: string) => { const [t, u] = k.split('/'); return t === 'vscode' ? `Match VSCode under its ${u} theme` : `${t === 'dark' ? 'Dark' : 'Light'} under VSCode's ${u} theme`; };
    let found = 0;
    for (const [a, b] of pairs) {
      const diffs = colourDiffs(drawn.get(a)!, drawn.get(b)!);
      found += diffs.length;
      for (const d of diffs.slice(0, 10)) console.error(`${view}: ${d.what} ${d.property} is ${d.a} with ${words(a)}, ${d.b} with ${words(b)}`);
      if (diffs.length > 10) console.error(`${view}: and ${diffs.length - 10} more between ${words(a)} and ${words(b)}`);
    }
    const n = drawn.get('dark/dark')!.length;
    console.log(`${view}: ${n} elements, ${COLOUR_PROPERTIES.length} colours each, ${pairs.length} comparisons, ${found} difference${found === 1 ? '' : 's'}`);
    elements += n;
    differences += found;
  }
  console.log(retriedSummary(retried).trim());
  if (!elements) return fail('The colour check compared no elements.');
  if (differences) return fail(`${differences} colour difference${differences === 1 ? '' : 's'}: a colour comes from VSCode's theme while Light or Dark is forced.`);
  console.log(`Compared ${elements} elements' colours on ${views.length} page${views.length === 1 ? '' : 's'}: no differences.`);
  return 0;
}

/**
 * The modals' behaviour (GH-170): each case in behaviour.ts on the built page, then each mutant's cases on
 * the page built with its one change, which must fail them.
 */
async function behaviourRun(chrome: string, jobs: number): Promise<number> {
  const work = mkdtempSync(join(tmpdir(), 'acc-behaviour-'));
  try {
    cpSync(join(extensionDir, 'dist', 'webview'), join(work, 'webview'), { recursive: true });
    const now = Date.now();
    const models = { tasks: sampleModel('tasks', now, 'dark'), overview: sampleModel('overview-landing', now, 'dark'), since: sampleModel('overview-since', now, 'dark'), ticket: sampleModel('ticket-questions', now, 'dark'), review: sampleModel('ticket-review', now, 'dark'), settings: sampleModel('settings-agents', now, 'dark'), connect: sampleModel('connect-start', now, 'dark'), agent: sampleModel('agent', now, 'dark'), dock: sampleModel('output-changes', now, 'dark'), run: sampleModel('output-failed', now, 'dark'), pages: sampleModel('overview-pages', now, 'dark'), conversation: sampleModel('conversation-start', now, 'dark'), beforePlan: sampleModel('ticket-conversation', now, 'dark'), talked: sampleModel('ticket-talk', now, 'dark'), report: sampleModel('report', now, 'dark') };
    const failures = await behaviourCheck({ chrome, work, models, now, fonts: FONTS, jobs, run: (c, args, slot) => chromeAsync(c, [profileArg(work, slot), ...args]), log: (line) => console.log(line) });
    for (const f of failures) console.error(f);
    return failures.length ? fail(`${failures.length} behaviour finding${failures.length === 1 ? '' : 's'}: a modal doesn't do what its case checks, or a case doesn't catch its mutant (extension/scripts/behaviour.ts).`) : 0;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The file in a screenshots folder that notes each shot taken there (T-5). */
export const SHOTS_FILE = 'shots.json';

/** What the run noted of one shot: what it drew, what it found, and the classes on screen in it. */
export interface ShotNote {
  /** fingerprint() when it was taken: the code and sample data it drew. */
  fingerprint: string;
  /** The PNG's sha256, so a shot taken again or changed since isn't taken for this one. */
  sha256: string;
  takenAt: string;
  /** How many geometry findings it had. */
  findings: number;
  /** Every class on an element drawn inside the shot's window, sorted. */
  drawn: string[];
  /** The browser that drew it (T-68): the screenshots gate passes only the pinned headless shell. Older notes have none. */
  browser?: Browser;
}
export interface ShotsRecord { schema: 1; shots: Record<string, ShotNote> }

/** The usual shots of every page: each theme at each of WIDTHS, by file name. */
export const expectedShots = (): string[] => PAGES.flatMap((p) => PALETTE_THEMES.flatMap((t) => WIDTHS.map((w) => `${p}-${t}-${w}.png`)));

/** The clock fingerprint() draws the sample data at, so the same code always gives the same fingerprint. */
export const FINGERPRINT_NOW = Date.UTC(2026, 0, 1);

/**
 * The fingerprint of what the screenshots draw: every file of the webview's source, the pages, widths and
 * heights, and each page as it's handed to Chrome in each theme, its sample model, starting state and
 * geometry collector included, at a still clock. A change to the page, its model, its fixtures or the
 * run's checks changes it; a change the pages don't draw from leaves it alone.
 */
export function fingerprint(webview: [string, Buffer | string][] = webviewSource()): string {
  const h = createHash('sha256');
  for (const [name, body] of webview) h.update(`file ${name} ${body.length}\n`).update(body);
  h.update(JSON.stringify({ PAGES, WIDTHS, DEFAULT_HEIGHT, PAGE_HEIGHT }));
  for (const view of PAGES) {
    for (const theme of PALETTE_THEMES) h.update(pageFor(view, theme, sampleModel(view, FINGERPRINT_NOW, theme), other(theme), false, true, afterModel(view, FINGERPRINT_NOW)));
  }
  return h.digest('hex');
}

/** The webview's source files, by name, sorted. */
export function webviewSource(dir = join(extensionDir, 'webview')): [string, Buffer][] {
  return readdirSync(dir).sort().filter((f) => statSync(join(dir, f)).isFile()).map((f) => [f, readFileSync(join(dir, f))]);
}

/** The shots noted in a folder: none when it has no note yet, or one that can't be read. */
export function readShots(dir: string): ShotsRecord {
  try {
    const r = JSON.parse(readFileSync(join(dir, SHOTS_FILE), 'utf8')) as ShotsRecord;
    if (r.schema === 1 && r.shots && typeof r.shots === 'object') return r;
  } catch { /* none yet, or unreadable: start again */ }
  return { schema: 1, shots: {} };
}

/** Notes these shots in the folder's record, over any earlier note of the same file, written whole. */
export function noteShots(dir: string, taken: Record<string, ShotNote>): void {
  if (!Object.keys(taken).length) return;
  const shots = Object.fromEntries(Object.entries({ ...readShots(dir).shots, ...taken }).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const file = join(dir, SHOTS_FILE);
  writeFileSync(`${file}.tmp`, `${JSON.stringify({ schema: 1, shots } satisfies ShotsRecord)}\n`);
  renameSync(`${file}.tmp`, file);
}

export { sha256Of };

/** What drawPages needs: the themes and widths, Chrome, and where to write. */
export interface DrawPagesDeps {
  /** Where each shot's note goes as it's taken; the caller notes it even when a drawing throws. */
  taken?: Record<string, ShotNote>;
  themes: Theme[];
  widths: number[];
  /** --height, or undefined for the usual heights, PAGE_HEIGHT's included. */
  height: number | undefined;
  /** How many jobs draw at once. */
  jobs: number;
  /** A folder holding the built webview at webview/: the pages, and each job's profile, are written here. */
  work: string;
  /** Where the PNGs end up. Each job writes its own into out/.job-<slot>/ first. */
  out: string;
  now: number;
  /** fingerprint() to note each shot under, or null when the shots aren't noted. */
  print: string | null;
  /** The browser that draws, noted with each shot. */
  browser: Browser;
  /** Runs Chrome with these arguments. */
  draw: (args: string[]) => Promise<Ran>;
  log: (line: string) => void;
}

/**
 * What a run drew: each drawing's verdict, the shots noted, the drawings retried, and each that failed, all in
 * the pages' order; cantStart when Chrome wrote no drawing at all, saying why in one line (T-108).
 */
export interface DrawnPages { renders: Render[]; taken: Record<string, ShotNote>; retried: string[]; failures: string[]; cantStart?: string }

/** The line of Chrome's stderr that says why it stopped: its first FATAL or ERROR line, else its last line. */
export function chromeSaid(stderr: string | undefined): string {
  const lines = (stderr ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const why = lines.find((l) => /FATAL|ERROR/.test(l)) ?? lines.at(-1);
  return why ? why.slice(0, 300) : 'Chrome printed nothing on stderr';
}

/** One drawing's outcome, held until those before it are printed. */
interface Drawing { lines: string[]; retried: string[]; render?: Render; note?: [string, ShotNote]; failure?: string }

/** How tall a page is shot: --height, else DEFAULT_HEIGHT or PAGE_HEIGHT's, whichever is taller (D-092). */
export const shotHeight = (view: Page, height: number | undefined): number => height ?? Math.max(DEFAULT_HEIGHT, PAGE_HEIGHT[view] ?? 0);

/**
 * Draws each page in each theme at each width, d.jobs pages at once (T-58): splitJobs shares the pages out
 * by how tall they're shot, since a taller shot takes Chrome longer, and each job draws its own one after
 * another with its own Chrome profile and output folder. A drawing that timed out is drawn again in its
 * job; a Chrome that dies, or gives no geometry, fails that drawing only, named in failures, and the rest
 * are drawn. What each drawing found is logged in the pages' order.
 */
export async function drawPages(views: Page[], d: DrawPagesDeps): Promise<DrawnPages> {
  const result: DrawnPages = { renders: [], taken: d.taken ?? {}, retried: [], failures: [] };
  // Set once any drawing is written; until then a drawing Chrome didn't write stops the whole run (T-108).
  let wrote = false;
  const drawView = async (view: Page, slot: number): Promise<Drawing[]> => {
    const own = join(d.out, `.job-${slot}`);
    mkdirSync(own, { recursive: true });
    const drawings: Drawing[] = [];
    for (const theme of d.themes) {
      // Forced, under VSCode's other theme: a colour still taken from VSCode's would show (GH-109). Each
      // shot also measures its geometry, which Chrome prints with the page (GH-105).
      const page = join(d.work, `${view}-${theme}.html`);
      const model = sampleModel(view, d.now, theme);
      writeFileSync(page, pageFor(view, theme, model, other(theme), false, true, afterModel(view, d.now)));
      for (const width of d.widths) {
        // Chrome can't start, as a sandbox it isn't let make can't: no drawing after would start either.
        if (result.cantStart) return drawings;
        const name = `${view}-${theme}-${width}.png`;
        const png = join(d.out, name);
        const drawnAt = join(own, name);
        rmSync(png, { force: true });
        const args = [
          // The job's own profile, kept for its drawings (T-58): two Chromes at once never share one.
          profileArg(d.work, slot),
          '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
          '--allow-file-access-from-files', '--force-device-scale-factor=2',
          '--virtual-time-budget=3000', `--window-size=${width},${shotHeight(view, d.height)}`, `--screenshot=${drawnAt}`, '--dump-dom', pathToFileURL(page).href,
        ];
        const what = `${view} (${theme}, ${width}px)`;
        const one: Drawing = { lines: [], retried: [] };
        drawings.push(one);
        // A drawing that timed out is drawn once more, in this job, and the run says so (GH-167).
        const r = await drawRetried(() => d.draw(args), what, one.retried, (line) => one.lines.push(line));
        if (r.error) { one.failure = `Chrome didn't finish ${what} within ${shotTimeout() / 1000} s: ${r.error.message}`; continue; }
        if (!existsSync(drawnAt)) {
          one.failure = `Chrome didn't write ${png} (exit ${r.status ?? r.signal}).`;
          if (!wrote) result.cantStart ??= `Chrome couldn't start: ${what} exited ${r.status ?? r.signal} before any drawing was written, so the run stops. Chrome said: ${chromeSaid(r.stderr)}`;
          continue;
        }
        wrote = true;
        renameSync(drawnAt, png);
        const shot = dumpedGeometry(r.stdout);
        if (!shot) { one.failure = `${what} measured no geometry (exit ${r.status ?? r.signal}).`; continue; }
        // A late font moves the rail's tab, so a page that loaded none first was measured by chance (T-21).
        const unwaited = fontsUnwaited(what, shot.fonts);
        if (unwaited) { one.failure = unwaited; continue; }
        const verdict = judge(shot, viewOf(view) === 'home' && !still(view), GEOMETRY_EXCEPTIONS, !still(view), expectedButtons(model));
        one.render = { page: view, theme, width, verdict };
        if (d.print !== null) one.note = [name, { fingerprint: d.print, sha256: sha256Of(png), takenAt: new Date().toISOString(), findings: verdict.violations.length, drawn: [...new Set(shot.drawn ?? [])].sort(), browser: d.browser }];
        one.lines.push(`${png}  ${CHECKS.map((c) => `${c} ${verdict.examined[c]}`).join(', ')}${verdict.violations.length ? `, ${verdict.violations.length} found` : ''}`);
      }
    }
    return drawings;
  };
  try {
    await runJobs(views, d.jobs, drawView, (drawings) => {
      for (const one of drawings) {
        for (const line of one.lines) d.log(line);
        result.retried.push(...one.retried);
        if (one.render) result.renders.push(one.render);
        if (one.note) result.taken[one.note[0]] = one.note[1];
        if (one.failure) result.failures.push(one.failure);
      }
    }, (view) => shotHeight(view, d.height));
  } finally {
    for (let slot = 0; slot < d.jobs; slot++) rmSync(join(d.out, `.job-${slot}`), { recursive: true, force: true });
  }
  return result;
}

async function main(argv: string[]): Promise<number> {
  // Every browser the run starts is stopped when it ends, however it ends (T-68).
  stopOnExit();
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: { width: { type: 'string', default: WIDTHS.join(',') }, theme: { type: 'string', default: 'dark,light' }, height: { type: 'string' }, out: { type: 'string' }, colours: { type: 'boolean', default: false }, behaviour: { type: 'boolean', default: false }, jobs: { type: 'string' } },
  });
  const jobs = jobsOption(values.jobs);
  if (jobs === null) return fail('--jobs is how many pages to draw at once: a whole number, 1 or more.');
  if (values.behaviour) {
    const stale = staleBuild();
    if (stale) return fail(`Run \`npm run build\` first: ${stale}.`);
    const chrome = findChrome();
    if (!chrome) return fail(noBrowser());
    return behaviourRun(chrome, jobs);
  }
  const views = positionals.length ? positionals : values.colours ? [...COLOUR_PAGES] : [...PAGES];
  const bad = views.filter((v) => !(PAGES as readonly string[]).includes(v));
  if (bad.length) return fail(`Unknown page: ${bad.join(', ')}. Pages: ${PAGES.join(', ')}.`);
  if (values.colours) {
    const stale = staleBuild();
    if (stale) return fail(`Run \`npm run build\` first: ${stale}.`);
    const chrome = findChrome();
    if (!chrome) return fail(noBrowser());
    const work = mkdtempSync(join(tmpdir(), 'acc-colours-'));
    try {
      cpSync(join(extensionDir, 'dist', 'webview'), join(work, 'webview'), { recursive: true });
      return await colourCheck(chrome, work, views as Page[]);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  const themes = values.theme.split(',');
  if (themes.some((t) => !(PALETTE_THEMES as readonly string[]).includes(t))) return fail(`Themes: ${PALETTE_THEMES.join(', ')}.`);
  const widths = values.width.split(',').map(Number);
  const height = Number(values.height ?? DEFAULT_HEIGHT);
  if ([...widths, height].some((n) => !Number.isInteger(n) || n < 200)) return fail('Widths and height are whole pixels, 200 or more.');
  // Chrome won't make a window narrower than 500 px: it lays the page out at 500 and crops the shot,
  // which looks like the page overflowing when it doesn't.
  if (widths.some((n) => n < MIN_WIDTH)) return fail(`Chrome lays out no narrower than ${MIN_WIDTH} px, so a narrower shot would be cropped, not narrow. Use ${MIN_WIDTH} or more.`);
  const stale = staleBuild();
  if (stale) return fail(`Run \`npm run build\` first: ${stale}.`);
  const chrome = findChrome();
  if (!chrome) return fail(noBrowser());

  const out = resolve(values.out ?? join(extensionDir, '..', 'dist', 'screenshots'));
  mkdirSync(out, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'acc-screenshots-'));
  // The screenshots gate counts shots at the usual heights only, and not ones started in a given state.
  const noting = values.height === undefined && !process.env.ACC_SHOT_STATE;
  // Shared with drawPages, so a throw partway still notes the shots already taken.
  const taken: Record<string, ShotNote> = {};
  let drawn: DrawnPages = { renders: [], taken, retried: [], failures: [] };
  try {
    cpSync(join(extensionDir, 'dist', 'webview'), join(work, 'webview'), { recursive: true });
    drawn = await drawPages(views as Page[], {
      themes: themes as Theme[], widths, height: values.height === undefined ? undefined : height, jobs, work, out, now: Date.now(),
      print: noting ? fingerprint() : null, browser: browserOf(chrome), taken, draw: (args) => chromeAsync(chrome, args), log: (line) => console.log(line),
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
    // Noted even when Chrome stops partway, so the shots it did take count.
    noteShots(out, taken);
  }
  if (drawn.cantStart) return fail(drawn.cantStart);
  const { renders, retried } = drawn;
  // A drawing that failed is named; the others were drawn all the same (T-58).
  if (drawn.failures.length) {
    for (const f of drawn.failures) console.error(f);
    return fail(`${drawn.failures.length} drawing${drawn.failures.length === 1 ? '' : 's'} failed: ${drawn.failures.length === 1 ? 'it is' : 'each is'} named above.${retriedSummary(retried)}`);
  }
  // Exceptions and floors are a whole run's: a run of a few pages may not reach them.
  const full = views.length === PAGES.length && themes.length === PALETTE_THEMES.length && values.width === WIDTHS.join(',');
  // Read once: the floors held, the CI's own named and the ones raised all come from this read (T-108).
  const before = readFloors(FLOORS_PATH);
  const failures = runFailures(renders, full, undefined, runFloor(before));
  console.log(geometrySummary(renders) + retriedSummary(retried));
  // A CI run says which floors it was held to, so none is changed without it showing (T-108).
  if (isCiRun() && full) {
    const own = CHECKS.filter((c) => before[ciFloorName(c)]);
    console.log(`A CI run: held to its own floors for ${own.length ? own.join(', ') : 'no check'}, and to the Mac's for the rest.`);
  }
  // A full run checks the modals' behaviour too (GH-170); a run of a few pages, themes or widths doesn't.
  const behaviour = full ? await behaviourRun(chrome, jobs) : 0;
  if (failures.length) {
    for (const f of failures) console.error(f);
    return fail(`${failures.length} geometry finding${failures.length === 1 ? '' : 's'}. Fix each, or list it in GEOMETRY_EXCEPTIONS (extension/scripts/geometry.ts) with why. The shots are written all the same.`);
  }
  // A clean whole run raises the floors it beat, for the change to commit (T-102).
  const raised = full ? raisedFloors(before, examinedIn(renders)) : null;
  if (raised) {
    writeFloors(FLOORS_PATH, raised);
    // The CI run never pushes (T-108): the CI floors it raised are named, for a person to commit.
    const rose = Object.entries(raised).filter(([k, v]) => v.floor !== before[k]?.floor).map(([k, v]) => `${k} ${v.floor}`);
    if (isCiRun()) console.log(`Raised the CI's own screenshot floors to 1% below what this run examined: ${rose.join(', ')}. CI commits nothing: set them in ${FLOORS_FILE} to keep them.`);
    else console.log(`Raised the screenshot floors in ${FLOORS_FILE} to 1% below what this run examined: commit it with the change.`);
  }
  return behaviour;
}

function fail(message: string): number {
  console.error(message);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
