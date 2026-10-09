/**
 * Renders the editor tabs in headless Chrome with sample data, so a layout change gets looked at before
 * it ships. Tests can't see a broken table; a screenshot can.
 *
 *   npm run screenshot                       every tab, dark and light, at 1000, 620 and 500 px
 *   npm run screenshot -- agents worktrees   just these tabs
 *   npm run screenshot -- --width 800 --theme dark --height 600 --out /tmp/shots
 *   npm run screenshot -- --colours          check no colour leaks from VSCode's theme into Light or Dark
 *
 * It renders the built webview (extension/dist/webview), so run `npm run build` after changing it. The
 * first data row or card is shown hovered. Chrome runs one shot at a time, under nice.
 *
 * Each shot is the page with Light or Dark forced, as Settings forces it, under VSCode's other theme
 * (GH-109): a colour that still came from VSCode's theme would show in it. --colours checks the same
 * thing by number: each page's computed colours with Light or Dark forced are the same whichever theme
 * VSCode has, and Match VSCode under a theme is that theme forced.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { HOME_SECTIONS, type HomeSection } from '../src/model/shared.ts';
import { homeModel, type Model } from '../src/model/home.ts';
import { FinishedJobs } from '../src/progress.ts';
import { sampleAgent } from './fixtures/agent-page.ts';
import { sampleBoards, sampleGithubBoards, sampleMondayBoards } from './fixtures/boards.ts';
import { type ConnectSample, sampleConnect } from './fixtures/connect.ts';
import { sampleIdentities, sampleIdentity } from './fixtures/environments.ts';
import { sampleHub } from './fixtures/hub.ts';
import { sampleLimitsOther } from './fixtures/limits.ts';
import { sampleAbout, sampleAboutBehind, sampleAboutFailed } from './fixtures/about.ts';
import { sampleQueueHub } from './fixtures/overview.ts';
import { sampleAnalyzeRun, sampleBusyHub, sampleIdleHub } from './fixtures/progress.ts';
import { sampleRulesHub } from './fixtures/rules.ts';
import { sampleRuns } from './fixtures/runs.ts';
import { CLIENTS, ROOT } from './fixtures/shared.ts';
import { samplePerTokenSetup, sampleSettingsHub, sampleTrackerBoards } from './fixtures/settings.ts';
import { sampleFirstSetup, sampleSetup } from './fixtures/setup.ts';
import { sampleSlack, type SlackSample } from './fixtures/slack.ts';
import { sampleTicket } from './fixtures/task-page.ts';
import { SAMPLE_EDIT, sampleEdited } from './fixtures/updates.ts';
import { settingsKey, type ThemeChoice } from '../src/model/settings.ts';
import { SETUP_PARTS } from '../src/logic/first-open.ts';
import { PALETTE_THEMES, type PaletteTheme, palettes, vscodeDefaults } from './styles.ts';
import { CHECKS, COLLECT_GEOMETRY, dumpedGeometry, geometrySummary, judge, type Render, runFailures } from './geometry.ts';

/**
 * Every page the screenshot script can draw: each section of the Command Center, a ticket's page (being
 * built, two to do whose analysis has questions or says to split it, one whose builder stopped, one that
 * waits for other tasks' files, one acc doesn't keep yet, being tracked, and one in review with its
 * builder's note), an agent's page, Setup with
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
 * Overview with a suggested rule and a suggested check under Needs you, and with the rule's draft task open
 * after Accept (GH-102).
 * Last, Settings at GitHub accounts, one project pushing as this clone's choice and one whose account gh
 * isn't signed in as, and at the Command Center's own preferences, each set to other than its default (GH-113).
 * Last, Setup as the Command Center first opens on it in a folder that isn't set up: at what kind of project
 * it is, and, on a machine with steps still to do, at the machine's part (GH-138).
 */
export const PAGES = [...HOME_SECTIONS, 'agents-path', 'ticket', 'ticket-questions', 'ticket-split', 'ticket-stopped', 'ticket-track', 'ticket-checks', 'ticket-waits', 'ticket-note', 'agent', 'output', 'connect-start', 'connect-shared', 'connect-jira', 'connect-azure', 'connect-github', 'connect-existing', 'connect-monday', 'connect-epic', 'connect-epic-used', 'connect-epic-azure', 'connect-epic-github', 'slack-none', 'slack-off', 'slack-paused', 'tasks-monday', 'tasks-github', 'agents-billing', 'overview-busy', 'overview-idle', 'queue', 'queue-off', 'queue-held', 'settings-agents', 'settings-trackers', 'settings-limits', 'agents-finished', 'rules', 'rules-accept', 'settings-about', 'settings-about-failed', 'settings-github', 'settings-page', 'setup-first', 'setup-first-machine'] as const;
export type Page = (typeof PAGES)[number];

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

/** A page's sample data. theme is what Settings shows chosen, as the shot forces it (GH-109). */
export function sampleModel(kind: Page, now = Date.now(), theme: ThemeChoice = 'vscode'): Model {
  if (kind === 'ticket') return sampleTicket(now);
  if (kind === 'ticket-questions') return sampleTicket(now, 'ACME-21');
  if (kind === 'ticket-split') return sampleTicket(now, 'ACME-23');
  if (kind === 'ticket-stopped') return sampleTicket(now, 'ACME-29');
  if (kind === 'ticket-track') return sampleTicket(now, 'ACME-31');
  if (kind === 'ticket-checks') return sampleTicket(now, 'ACME-33');
  if (kind === 'ticket-waits') return sampleTicket(now, 'ACME-35');
  if (kind === 'ticket-note') return sampleTicket(now, 'ACME-20');
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
  const section = (kind === 'output' || kind.startsWith('connect-epic') ? 'setup' : connect || kind === 'tasks-monday' || kind === 'tasks-github' ? 'tasks' : kind.startsWith('slack-') ? 'settings' : kind === 'agents-billing' || kind === 'agents-path' || kind === 'agents-finished' ? 'agents' : kind.startsWith('settings-') ? 'settings' : kind) as HomeSection;
  // Settings' trackers are each project's own (GH-112); every other page shows the sample board for each.
  const boards = kind === 'settings-trackers' ? sampleTrackerBoards : kind === 'tasks-monday' ? sampleMondayBoards : kind === 'tasks-github' ? sampleGithubBoards : sampleBoards;
  // The Command Center's own preferences, each set to other than its default (GH-113).
  const prefs = kind === 'settings-page' ? { pace: 'relaxed' as const, opensOn: 'tasks' as const } : {};
  return homeModel({
    hub, section, boards: (root) => boards(root), identity: kind === 'settings-github' ? sampleIdentities : () => sampleIdentity(), setup: perToken ? samplePerTokenSetup() : sampleSetup(),
    runs: sampleRuns(now), edited: sampleEdited, connect, slack, whereView: kind === 'agents-path' || kind === 'settings-page' ? 'path' : 'folder', theme, ...prefs,
    // About (GH-114): up to date, or behind with a newer release and an older plugin, or a look that failed.
    about: kind === 'settings-about' ? sampleAboutBehind(now) : kind === 'settings-about-failed' ? sampleAboutFailed(now) : sampleAbout(now), now,
  });
}

/**
 * What the page remembers when it opens: the output page starts with the panel open, the split ticket
 * with two of its analysis's lists open, to see them laid out, and ACME-12's with the edit typed for the
 * draft a newer one replaced (GH-46).
 */
// ACC_SHOT_STATE, a JSON object, starts every page with that state instead: for checking what a page restores.
const startState = (kind: Page): unknown => (process.env.ACC_SHOT_STATE ? JSON.parse(process.env.ACC_SHOT_STATE) : kind === 'output' ? { dock: { open: true, run: 'r-login' } }
  : kind === 'rules-accept' ? { opened: ['rule:/Users/me/code/acme-service#r-4c0f1e:draft'] }
  : kind === 'agents-finished' ? { opened: [ROOT, CLIENTS].map((r) => `agents-finished:${r}`) }
  : kind === 'ticket-split' ? { opened: ['files', 'findings'].map((f) => `an:/Users/me/code/acme-service#ACME-23:${f}`) }
    : kind === 'ticket' ? { drafts: { [`update:/Users/me/code/acme-service#${SAMPLE_EDIT.id}`]: SAMPLE_EDIT.text }, bases: { [`update:/Users/me/code/acme-service#${SAMPLE_EDIT.id}`]: { text: SAMPLE_EDIT.base } } } : undefined);
export const viewOf = (kind: Page): string => (kind.startsWith('ticket') ? 'ticket' : kind === 'agent' ? kind : 'home');
/** A part the extension asks the page to go to as it opens, as the status bar's Auto-merge does (GH-110). */
export const openAt = (kind: Page): string | null => (kind === 'settings-agents' ? settingsKey('agents') : kind === 'settings-trackers' ? settingsKey('trackers')
  : kind.startsWith('slack-') ? settingsKey('slack') : kind === 'settings-github' ? settingsKey('github') : kind === 'settings-page' ? settingsKey('page') : kind.startsWith('settings-about') ? settingsKey('about')
  : kind === 'setup-first' ? SETUP_PARTS.kind : kind === 'setup-first-machine' ? SETUP_PARTS.machine : null);

/**
 * A page that loads the built webview the way VSCode does: a stub API answers `ready` with the model.
 * Screenshots can't hover, so each :hover rule is copied to a class put on the first row or card.
 */
/** How tall a shot is unless --height says. */
const DEFAULT_HEIGHT = 900;

/**
 * Pages whose part sits below the fold at the default height, shot taller: In progress is below Needs you on
 * the Overview, and taller still at narrow widths, where the Overview's columns stack (D-092). So is the
 * Merge queue panel, below In progress and the tiles (GH-73), and the last of Settings' parts (GH-109).
 * Settings at How agents run is shot tall enough not to scroll (GH-110): under 820 px its jump scrolls the
 * document itself, which headless Chrome draws as a blank band above the tab strip. A builder's note sits
 * below the description, under the side panels where a narrow tab stacks them (D-106). Agents is shot
 * tall enough to show every repo on the busy machine, down to Other folders (GH-119), and so is Settings at
 * Trackers and sign-ins, further down (GH-112). Settings opened at Notices in Slack, GitHub accounts or the
 * Command Center's preferences is shot tall enough not to scroll at 500 px, and Environments tall enough to
 * show This machine's line saying Slack moved (GH-113).
 */
export const PAGE_HEIGHT: Partial<Record<Page, number>> = { 'overview-busy': 3600, 'overview-idle': 3200, queue: 1500, 'queue-off': 1500, 'queue-held': 1500, settings: 3800, 'settings-agents': 3800, 'settings-limits': 3800, 'ticket-note': 1600, agents: 2000, 'agents-path': 2300, 'agents-finished': 2300, 'settings-trackers': 5000, 'slack-none': 5000, 'slack-off': 5000, 'slack-paused': 5000, 'settings-github': 5800, 'settings-page': 5000, environments: 1400, rules: 1500, 'rules-accept': 1900, 'settings-about': 7200, 'settings-about-failed': 7200 };

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
 * A page as VSCode would show it with `under`'s theme (GH-109): VSCode's own webview stylesheet first in
 * the head, that theme's colours inline on <html> and its class on <body>, and the page's theme in
 * data-theme. A shot forces Light or Dark under VSCode's other theme, so a colour that still comes from
 * VSCode's shows in it. With collect, the page also gathers its computed colours for the colour check;
 * with measure, its geometry for the geometry checks (GH-105), once its fonts have loaded and two frames
 * have drawn.
 */
export function pageFor(kind: Page, theme: ThemeChoice, model: Model, under: Theme = theme === 'light' ? 'dark' : 'light', collect = false, measure = false): string {
  const vars = Object.entries({ ...palettes()[under], ...FONTS }).map(([k, v]) => `--vscode-${k}: ${v};`).join(' ');
  // `<` escaped, so no string in the model can close the script tag.
  const json = JSON.stringify(model).replace(/</g, '\\u003c');
  const open = openAt(kind);
  return `<!DOCTYPE html>
<html lang="en" data-theme="${theme}" style="${vars.replace(/"/g, '&quot;')}"><head><meta charset="UTF-8">
<style>${vscodeDefaults()}</style>
<link rel="stylesheet" href="webview/codicons/codicon.css">
<link rel="stylesheet" href="webview/styles.css">
<script>
const MODEL = ${json};
function forceHover() {
  for (const sheet of document.styleSheets) {
    let rules; try { rules = [...sheet.cssRules]; } catch { continue; }
    for (const r of rules) if (r.selectorText && r.selectorText.includes(':hover')) sheet.insertRule(r.cssText.replaceAll(':hover', '.acc-hover'), sheet.cssRules.length);
  }
  (document.querySelector('tbody tr:not(.group):not(.none)') ?? document.querySelector('.card'))?.classList.add('acc-hover');
}${collect || measure ? COLLECT : ''}${collect ? COLLECT_COLOURS : ''}${measure ? COLLECT_GEOMETRY : ''}
window.acquireVsCodeApi = () => ({
  postMessage(m) { if (m.type === 'ready') setTimeout(() => { window.postMessage({ type: 'state', model: MODEL${open ? `, jump: true, open: ${JSON.stringify(open)}` : ''} }, '*'); setTimeout(forceHover, 50);${collect ? ' setTimeout(collectColours, 500);' : ''}${measure ? ' setTimeout(() => document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(collectGeometry))), 300);' : ''} }); },
  getState() { return ${JSON.stringify(startState(kind)) ?? 'undefined'}; }, setState() {},
});
</script>
</head>
<body class="vscode-${under}" data-view="${viewOf(kind)}" data-logo-dark="webview/acc-dark.svg" data-logo-light="webview/acc-light.svg"><main id="app"></main><script src="webview/main.js"></script></body></html>
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

/** Runs Chrome under nice, so the machine stays usable. */
function chromeRun(chrome: string, args: string[], dump = false): ReturnType<typeof spawnSync> {
  const [cmd, cmdArgs] = process.platform === 'win32' ? [chrome, args] : ['nice', ['-n', '15', chrome, ...args]];
  return spawnSync(cmd, cmdArgs, dump ? { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 } : { stdio: 'ignore', timeout: 30_000 });
}

/** The pages the colour check draws (GH-109): the busiest sections, Settings, a task's page and an agent's. */
export const COLOUR_PAGES: Page[] = ['overview', 'tasks', 'settings', 'settings-agents', 'settings-trackers', 'settings-limits', 'settings-about', 'slack-paused', 'settings-github', 'settings-page', 'ticket', 'agent'];

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
  let elements = 0;
  let differences = 0;
  for (const view of views) {
    const drawn = new Map<string, Colours>();
    for (const theme of ['dark', 'light', 'vscode'] as const) {
      for (const under of PALETTE_THEMES) {
        const page = join(work, `${view}-${theme}-under-${under}.html`);
        // One model for every drawing, so only the theme differs between them.
        writeFileSync(page, pageFor(view, theme, sampleModel(view, now), under, true));
        const r = chromeRun(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--allow-file-access-from-files',
          '--virtual-time-budget=3000', '--window-size=1000,900', '--dump-dom', pathToFileURL(page).href], true);
        if (r.error) return fail(`Chrome didn't finish ${view} (${theme} under ${under}) within 30 s: ${r.error.message}`);
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
  if (!elements) return fail('The colour check compared no elements.');
  if (differences) return fail(`${differences} colour difference${differences === 1 ? '' : 's'}: a colour comes from VSCode's theme while Light or Dark is forced.`);
  console.log(`Compared ${elements} elements' colours on ${views.length} page${views.length === 1 ? '' : 's'}: no differences.`);
  return 0;
}

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: { width: { type: 'string', default: '1000,620,500' }, theme: { type: 'string', default: 'dark,light' }, height: { type: 'string' }, out: { type: 'string' }, colours: { type: 'boolean', default: false } },
  });
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
  const renders: Render[] = [];
  try {
    cpSync(join(extensionDir, 'dist', 'webview'), join(work, 'webview'), { recursive: true });
    const now = Date.now();
    for (const view of views as Page[]) {
      for (const theme of themes as Theme[]) {
        // Forced, under VSCode's other theme: a colour still taken from VSCode's would show (GH-109). Each
        // shot also measures its geometry, which Chrome prints with the page (GH-105).
        const page = join(work, `${view}-${theme}.html`);
        writeFileSync(page, pageFor(view, theme, sampleModel(view, now, theme), other(theme), false, true));
        for (const width of widths) {
          const png = join(out, `${view}-${theme}-${width}.png`);
          // A page whose part sits low on it is shot taller unless --height says otherwise (D-092).
          const tall = values.height === undefined ? Math.max(height, PAGE_HEIGHT[view] ?? 0) : height;
          rmSync(png, { force: true });
          const args = [
            // No --user-data-dir: headless Chrome already uses a throwaway profile, and a fresh one makes it
            // hang after writing the shot.
            '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
            '--allow-file-access-from-files', '--force-device-scale-factor=2',
            '--virtual-time-budget=3000', `--window-size=${width},${tall}`, `--screenshot=${png}`, '--dump-dom', pathToFileURL(page).href,
          ];
          const r = chromeRun(chrome, args, true);
          if (r.error) return fail(`Chrome didn't finish ${view} (${theme}, ${width}px) within 30 s: ${r.error.message}`);
          if (!existsSync(png)) return fail(`Chrome didn't write ${png} (exit ${r.status ?? r.signal}).`);
          const shot = dumpedGeometry(String(r.stdout ?? ''));
          if (!shot) return fail(`${view} (${theme}, ${width}px) measured no geometry (exit ${r.status ?? r.signal}).`);
          const verdict = judge(shot, viewOf(view) === 'home');
          renders.push({ page: view, theme, width, verdict });
          console.log(`${png}  ${CHECKS.map((c) => `${c} ${verdict.examined[c]}`).join(', ')}${verdict.violations.length ? `, ${verdict.violations.length} found` : ''}`);
        }
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  // Exceptions and floors are a whole run's: a run of a few pages may not reach them.
  const full = views.length === PAGES.length && themes.length === PALETTE_THEMES.length && values.width === '1000,620,500';
  const failures = runFailures(renders, full);
  console.log(geometrySummary(renders));
  if (failures.length) {
    for (const f of failures) console.error(f);
    return fail(`${failures.length} geometry finding${failures.length === 1 ? '' : 's'}. Fix each, or list it in GEOMETRY_EXCEPTIONS (extension/scripts/geometry.ts) with why. The shots are written all the same.`);
  }
  return 0;
}

function fail(message: string): number {
  console.error(message);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
