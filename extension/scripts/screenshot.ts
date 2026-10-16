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
import { HOME_SECTIONS, type HomeSection } from '../src/model/shared.ts';
import { type HomeModel, homeModel, type Model } from '../src/model/home.ts';
import { type GroupKey, landing, overviewCards } from '../src/model/landing.ts';
import { FinishedJobs } from '../src/progress.ts';
import { sampleAgent } from './fixtures/agent-page.ts';
import { sampleBoards, sampleGithubBoards, sampleMondayBoards, sampleSlackBoards } from './fixtures/boards.ts';
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
import { sampleFirstSetup, sampleSetup } from './fixtures/setup.ts';
import { sampleSlack, type SlackSample } from './fixtures/slack.ts';
import { sampleTicket } from './fixtures/task-page.ts';
import { sampleSheet } from './fixtures/dispatch-sheet.ts';
import { SAMPLE_EDIT, sampleEdited } from './fixtures/updates.ts';
import { settingsKey, type ThemeChoice } from '../src/model/settings.ts';
import { SETUP_PARTS } from '../src/logic/first-open.ts';
import { PALETTE_THEMES, type PaletteTheme, palettes, vscodeDefaults } from './styles.ts';
import { loadingScreen } from '../src/logic/loading.ts';
import { CHECKS, COLLECT_GEOMETRY, type ExpectedButton, GEOMETRY_EXCEPTIONS, dumpedGeometry, geometrySummary, judge, type Render, runFailures } from './geometry.ts';
import { drawRetried, drawRetrying, FONTS_FIRST, fontsUnwaited, retriedSummary, SETTLE, shotTimeout } from './steady.ts';
import { behaviourCheck } from './behaviour.ts';
import { axeScript, COLLECT_A11Y } from './a11y.ts';
import { jobsOption, type Ran, runAsync, runJobs } from './jobs.ts';

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
 */
export const PAGES = [...HOME_SECTIONS, 'agents-path', 'ticket', 'ticket-questions', 'ticket-split', 'ticket-stopped', 'ticket-track', 'ticket-checks', 'ticket-waits', 'ticket-note', 'ticket-review', 'agent', 'output', 'connect-start', 'connect-shared', 'connect-jira', 'connect-azure', 'connect-github', 'connect-existing', 'connect-monday', 'connect-slack', 'connect-slack-channel', 'connect-slack-refused', 'connect-epic', 'connect-epic-used', 'connect-epic-azure', 'connect-epic-github', 'slack-none', 'slack-off', 'slack-paused', 'tasks-monday', 'tasks-github', 'tasks-slack', 'tasks-slack-refused', 'agents-billing', 'overview-busy', 'overview-idle', 'queue', 'queue-off', 'queue-held', 'settings-agents', 'settings-trackers', 'settings-limits', 'agents-finished', 'rules', 'rules-accept', 'settings-about', 'settings-about-failed', 'settings-github', 'settings-page', 'setup-first', 'setup-first-machine', 'tasks-modal', 'overview-landing', 'overview-answer', 'overview-drafts', 'overview-history', 'overview-pages', 'overview-needs', 'overview-progress', 'overview-ready', 'overview-moment', 'overview-clear', 'overview-since', 'tasks-agents', 'ticket-cloud', 'ticket-nofields', 'loading', 'palette', 'palette-empty', 'tasks-moving', 'output-passed', 'output-changes', 'output-reviewing', 'output-review-open', 'output-unread', 'dispatch-sheet', 'ticket-dispatch', 'tasks-card-menu', 'dispatch-sheet-anyway', 'output-running', 'output-done', 'output-failed', 'output-details', 'output-steps-running', 'output-steps-failed', 'output-steps-done'] as const;
export type Page = (typeof PAGES)[number];

/**
 * Pages the run draws with no model sent, so what the tab shows before its first model stays (T-16). They
 * have no rail and no controls, which the geometry check otherwise looks for on every page.
 */
export const STILL: readonly Page[] = ['loading'];
const still = (kind: Page): boolean => STILL.includes(kind);

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MIN_WIDTH = 500;
/** The widths every page is shot at unless --width says. */
export const WIDTHS = [1000, 620, 500] as const;

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
  if (kind === 'ticket-split') return sampleTicket(now, 'ACME-23');
  if (kind === 'ticket-stopped') return sampleTicket(now, 'ACME-29');
  // A builder in the cloud, quiet for too long (GH-69).
  if (kind === 'ticket-cloud') return sampleTicket(now, 'ACME-44');
  if (kind === 'ticket-nofields') return sampleTicket(now, 'ACME-50');
  if (kind === 'ticket-track') return sampleTicket(now, 'ACME-31');
  if (kind === 'ticket-checks') return sampleTicket(now, 'ACME-33');
  if (kind === 'ticket-waits') return sampleTicket(now, 'ACME-35');
  if (kind === 'ticket-note') return sampleTicket(now, 'ACME-20');
  // ACME-19 in rework, in its own tab, with Dispatch's sheet over it (D-168).
  if (kind === 'ticket-review' || kind === 'ticket-dispatch') return sampleTicket(now, 'ACME-19');
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
  const connect = kind.startsWith('connect-') ? sampleConnect(kind.slice('connect-'.length) as ConnectSample) : null;
  const slack = sampleSlack(kind.startsWith('slack-') ? kind.slice('slack-'.length) as SlackSample : 'on', now);
  // A project started from an epic opens the Connect page over Setup, where "From a Jira epic…" is (GH-81).
  const section = (kind === 'output' || kind.startsWith('connect-epic') ? 'setup' : connect || kind === 'tasks-monday' || kind === 'tasks-github' || kind.startsWith('tasks-slack') || kind === 'tasks-modal' || kind === 'tasks-agents' || kind === 'tasks-moving' || kind.startsWith('palette') || kind.startsWith('dispatch-sheet') || kind === 'tasks-card-menu' ? 'tasks' : kind.startsWith('slack-') ? 'settings' : kind === 'agents-billing' || kind === 'agents-path' || kind === 'agents-finished' ? 'agents' : kind.startsWith('settings-') ? 'settings' : kind) as HomeSection;
  // Settings' trackers are each project's own (GH-112); every other page shows the sample board for each.
  const boards = kind === 'settings-trackers' ? sampleTrackerBoards : kind === 'tasks-monday' ? sampleMondayBoards : kind === 'tasks-github' ? sampleGithubBoards
    // A Slack channel's box for a thread's link (T-31): empty, or with a link Track refused.
    : kind.startsWith('tasks-slack') ? () => sampleSlackBoards(kind === 'tasks-slack-refused') : sampleBoards;
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
  : kind === 'ticket-split' ? { opened: ['files', 'findings'].map((f) => `an:/Users/me/code/acme-service#ACME-23:${f}`) }
    : kind === 'ticket' ? { drafts: { [`update:/Users/me/code/acme-service#${SAMPLE_EDIT.id}`]: SAMPLE_EDIT.text }, bases: { [`update:/Users/me/code/acme-service#${SAMPLE_EDIT.id}`]: { text: SAMPLE_EDIT.base } } } : undefined);
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
  : kind === 'dispatch-sheet-anyway' ? [{ type: 'dispatch-sheet', sheet: sampleSheet(now, 'anyway') }] : []);
/** The title each kind of tab carries, as htmlFor in panels.ts gives it: a page needs one to be named (T-55). */
export const TAB_TITLES: Record<string, string> = { home: 'Command Center', ticket: 'Ticket', agent: 'Agent' };
export const viewOf = (kind: Page): string => (kind.startsWith('ticket') ? 'ticket' : kind === 'agent' ? kind : 'home');
/** A part the extension asks the page to go to as it opens, as the status bar's Auto-merge does (GH-110). */
export const openAt = (kind: Page): string | null => (kind === 'settings-agents' ? settingsKey('agents') : kind === 'settings-trackers' ? settingsKey('trackers')
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
 * enough for the panel, which takes under half the height, to show the met criteria at the end (T-63).
 */
export const PAGE_HEIGHT: Partial<Record<Page, number>> = { 'overview-busy': 1900, 'overview-idle': 1700, 'overview-landing': 1900, 'overview-answer': 1100, 'overview-drafts': 1100, 'overview-history': 1300, 'overview-pages': 1300, 'overview-needs': 1100, 'overview-progress': 1100, 'overview-ready': 1100, 'overview-moment': 1100, 'overview-clear': 1100, 'overview-since': 1500, queue: 1500, 'queue-off': 1500, 'queue-held': 1500, settings: 3800, 'settings-agents': 3800, 'settings-limits': 3800, 'ticket-note': 1600, 'ticket-review': 1950, agents: 2000, 'agents-path': 2300, 'agents-finished': 2300, 'settings-trackers': 5000, 'slack-none': 5000, 'slack-off': 5000, 'slack-paused': 5000, 'settings-github': 5800, 'settings-page': 5000, environments: 1400, rules: 1300, 'rules-accept': 1500, 'settings-about': 7200, 'settings-about-failed': 7200, 'output-review-open': 2000 };

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

/** A modal's open fades from opacity 0 (T-47), and the geometry check skips what is transparent: a measured page opens its modal at once. */
const NO_MODAL_FADE = '<style>dialog { transition: none !important; }</style>';

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
  getState() { return ${JSON.stringify(startState(kind)) ?? 'undefined'}; }, setState() {},
});
</script>
</head>
<body class="vscode-${under}" data-view="${viewOf(kind)}" data-logo-dark="webview/acc-dark.svg" data-logo-light="webview/acc-light.svg"><main id="app">${opening}</main><script src="webview/main.js"></script></body></html>
`;
}

/** Chrome, Chromium or Edge: $CHROME if set, else the usual install places, else the PATH. */
export function findChrome(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync): string | null {
  if (env.CHROME) return exists(env.CHROME) ? env.CHROME : null;
  const known = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ].find(exists);
  if (known) return known;
  for (const name of ['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
    const r = spawnSync('which', [name], { encoding: 'utf8' });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  }
  return null;
}

/** The built webview is older than its source, so a screenshot would show the last build. */
function staleBuild(): string | null {
  const built = join(extensionDir, 'dist', 'webview', 'main.js');
  if (!existsSync(built)) return 'there is no built webview yet';
  const src = join(extensionDir, 'webview');
  const newest = Math.max(...readdirSync(src).filter((f) => /\.(ts|css)$/.test(f)).map((f) => statSync(join(src, f)).mtimeMs));
  return newest > statSync(built).mtimeMs ? 'the built webview is older than its source' : null;
}

/** Chrome under nice, so the machine stays usable: the program to run and its arguments. */
const niced = (chrome: string, args: string[]): [string, string[]] => (process.platform === 'win32' ? [chrome, args] : ['nice', ['-n', '15', chrome, ...args]]);

/** Runs Chrome under nice for at most shotTimeout() (GH-167), gathering what it prints. */
function chromeRun(chrome: string, args: string[]): ReturnType<typeof spawnSync> {
  const [cmd, cmdArgs] = niced(chrome, args);
  return spawnSync(cmd, cmdArgs, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: shotTimeout() });
}

/** chromeRun without blocking (T-58), so jobs draw at once. */
const chromeAsync = (chrome: string, args: string[]): Promise<Ran> => runAsync(...niced(chrome, args), shotTimeout());

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
function colourCheck(chrome: string, work: string, views: Page[]): number {
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
        const r = drawRetrying(() => chromeRun(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
          '--virtual-time-budget=3000', '--window-size=1000,900', '--dump-dom', pathToFileURL(page).href]), what, retried);
        if (r.error) return fail(`Chrome didn't finish ${what} within ${shotTimeout() / 1000} s: ${r.error.message}`);
        const colours = dumpedColours(String(r.stdout ?? ''));
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
    const models = { tasks: sampleModel('tasks', now, 'dark'), overview: sampleModel('overview-landing', now, 'dark'), since: sampleModel('overview-since', now, 'dark'), ticket: sampleModel('ticket-questions', now, 'dark'), review: sampleModel('ticket-review', now, 'dark'), settings: sampleModel('settings-agents', now, 'dark'), connect: sampleModel('connect-start', now, 'dark'), agent: sampleModel('agent', now, 'dark'), dock: sampleModel('output-changes', now, 'dark'), run: sampleModel('output-failed', now, 'dark'), pages: sampleModel('overview-pages', now, 'dark') };
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

export const sha256Of = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

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
  /** Runs Chrome with these arguments. */
  draw: (args: string[]) => Promise<Ran>;
  log: (line: string) => void;
}

/** What a run drew: each drawing's verdict, the shots noted, the drawings retried, and each that failed, all in the pages' order. */
export interface DrawnPages { renders: Render[]; taken: Record<string, ShotNote>; retried: string[]; failures: string[] }

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
        if (!existsSync(drawnAt)) { one.failure = `Chrome didn't write ${png} (exit ${r.status ?? r.signal}).`; continue; }
        renameSync(drawnAt, png);
        const shot = dumpedGeometry(r.stdout);
        if (!shot) { one.failure = `${what} measured no geometry (exit ${r.status ?? r.signal}).`; continue; }
        // A late font moves the rail's tab, so a page that loaded none first was measured by chance (T-21).
        const unwaited = fontsUnwaited(what, shot.fonts);
        if (unwaited) { one.failure = unwaited; continue; }
        const verdict = judge(shot, viewOf(view) === 'home' && !still(view), GEOMETRY_EXCEPTIONS, !still(view), expectedButtons(model));
        one.render = { page: view, theme, width, verdict };
        if (d.print !== null) one.note = [name, { fingerprint: d.print, sha256: sha256Of(png), takenAt: new Date().toISOString(), findings: verdict.violations.length, drawn: [...new Set(shot.drawn ?? [])].sort() }];
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
    if (!chrome) return fail('No Chrome, Chromium or Edge found. Set CHROME to its path.');
    return behaviourRun(chrome, jobs);
  }
  const views = positionals.length ? positionals : values.colours ? [...COLOUR_PAGES] : [...PAGES];
  const bad = views.filter((v) => !(PAGES as readonly string[]).includes(v));
  if (bad.length) return fail(`Unknown page: ${bad.join(', ')}. Pages: ${PAGES.join(', ')}.`);
  if (values.colours) {
    const stale = staleBuild();
    if (stale) return fail(`Run \`npm run build\` first: ${stale}.`);
    const chrome = findChrome();
    if (!chrome) return fail('No Chrome, Chromium or Edge found. Set CHROME to its path.');
    const work = mkdtempSync(join(tmpdir(), 'acc-colours-'));
    try {
      cpSync(join(extensionDir, 'dist', 'webview'), join(work, 'webview'), { recursive: true });
      return colourCheck(chrome, work, views as Page[]);
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
  if (!chrome) return fail('No Chrome, Chromium or Edge found. Set CHROME to its path.');

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
      print: noting ? fingerprint() : null, taken, draw: (args) => chromeAsync(chrome, args), log: (line) => console.log(line),
    });
  } finally {
    rmSync(work, { recursive: true, force: true });
    // Noted even when Chrome stops partway, so the shots it did take count.
    noteShots(out, taken);
  }
  const { renders, retried } = drawn;
  // A drawing that failed is named; the others were drawn all the same (T-58).
  if (drawn.failures.length) {
    for (const f of drawn.failures) console.error(f);
    return fail(`${drawn.failures.length} drawing${drawn.failures.length === 1 ? '' : 's'} failed: ${drawn.failures.length === 1 ? 'it is' : 'each is'} named above.${retriedSummary(retried)}`);
  }
  // Exceptions and floors are a whole run's: a run of a few pages may not reach them.
  const full = views.length === PAGES.length && themes.length === PALETTE_THEMES.length && values.width === WIDTHS.join(',');
  const failures = runFailures(renders, full);
  console.log(geometrySummary(renders) + retriedSummary(retried));
  // A full run checks the modals' behaviour too (GH-170); a run of a few pages, themes or widths doesn't.
  const behaviour = full ? await behaviourRun(chrome, jobs) : 0;
  if (failures.length) {
    for (const f of failures) console.error(f);
    return fail(`${failures.length} geometry finding${failures.length === 1 ? '' : 's'}. Fix each, or list it in GEOMETRY_EXCEPTIONS (extension/scripts/geometry.ts) with why. The shots are written all the same.`);
  }
  return behaviour;
}

function fail(message: string): number {
  console.error(message);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
