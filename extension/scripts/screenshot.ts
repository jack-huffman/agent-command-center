/**
 * Renders the editor tabs in headless Chrome with sample data, so a layout change gets looked at before
 * it ships. Tests can't see a broken table; a screenshot can.
 *
 *   npm run screenshot                       every tab, dark and light, at 1000, 620 and 480 px
 *   npm run screenshot -- agents worktrees   just these tabs
 *   npm run screenshot -- --width 800 --theme dark --height 600 --out /tmp/shots
 *
 * It renders the built webview (extension/dist/webview), so run `npm run build` after changing it. The
 * first data row or card is shown hovered. Chrome runs one shot at a time, under nice.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { agentsModel, environmentsModel, type Model, setupModel, tasksModel, VIEW_KINDS, type ViewKind, worktreesModel } from '../src/model.ts';
import { sampleHub, sampleSetup } from './fixtures.ts';

const extensionDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Close to VSCode's Dark Modern and Light Modern themes: every --vscode-* variable styles.css reads. */
export const THEMES = {
  dark: {
    'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-size': '13px', 'editor-font-family': 'Menlo, Monaco, monospace',
    foreground: '#cccccc', descriptionForeground: '#9d9d9d', errorForeground: '#f85149', focusBorder: '#0078d4',
    'editor-background': '#1f1f1f', 'editorWidget-background': '#202020', 'sideBar-background': '#181818',
    'panel-border': '#2b2b2b', 'widget-border': '#313131', 'list-hoverBackground': '#2a2d2e', 'toolbar-hoverBackground': 'rgba(90, 93, 94, 0.31)',
    'button-background': '#0078d4', 'button-foreground': '#ffffff', 'button-hoverBackground': '#026ec1', 'button-border': 'rgba(255, 255, 255, 0.07)',
    'button-secondaryBackground': '#313131', 'button-secondaryForeground': '#cccccc', 'button-secondaryHoverBackground': '#3c3c3c',
    'badge-background': '#616161', 'badge-foreground': '#f8f8f8', 'textLink-foreground': '#4daafc', 'textCodeBlock-background': '#2b2b2b',
    'progressBar-background': '#0078d4', 'charts-orange': '#d18616', 'charts-blue': '#3794ff',
  },
  light: {
    'font-family': '-apple-system, BlinkMacSystemFont, sans-serif', 'font-size': '13px', 'editor-font-family': 'Menlo, Monaco, monospace',
    foreground: '#3b3b3b', descriptionForeground: '#6f6f6f', errorForeground: '#e51400', focusBorder: '#005fb8',
    'editor-background': '#ffffff', 'editorWidget-background': '#f8f8f8', 'sideBar-background': '#f8f8f8',
    'panel-border': '#e5e5e5', 'widget-border': '#e5e5e5', 'list-hoverBackground': '#f2f2f2', 'toolbar-hoverBackground': 'rgba(184, 184, 184, 0.31)',
    'button-background': '#005fb8', 'button-foreground': '#ffffff', 'button-hoverBackground': '#0258a8', 'button-border': 'rgba(0, 0, 0, 0.1)',
    'button-secondaryBackground': '#e5e5e5', 'button-secondaryForeground': '#3b3b3b', 'button-secondaryHoverBackground': '#cccccc',
    'badge-background': '#cccccc', 'badge-foreground': '#3b3b3b', 'textLink-foreground': '#005fb8', 'textCodeBlock-background': '#f2f2f2',
    'progressBar-background': '#005fb8', 'charts-orange': '#d18616', 'charts-blue': '#1a85ff',
  },
} satisfies Record<string, Record<string, string>>;
export type Theme = keyof typeof THEMES;

export function sampleModel(kind: ViewKind, now = Date.now()): Model {
  const hub = sampleHub(now);
  switch (kind) {
    case 'tasks': return tasksModel(hub);
    case 'agents': return agentsModel(hub);
    case 'worktrees': return worktreesModel(hub);
    case 'environments': return environmentsModel(hub);
    case 'setup': {
      const { items, confirmed } = sampleSetup();
      return setupModel(items, confirmed);
    }
  }
}

/**
 * A page that loads the built webview the way VSCode does: a stub API answers `ready` with the model.
 * Screenshots can't hover, so each :hover rule is copied to a class put on the first row or card.
 */
export function pageFor(kind: ViewKind, theme: Theme, model: Model): string {
  const vars = Object.entries(THEMES[theme]).map(([k, v]) => `--vscode-${k}: ${v};`).join(' ');
  // `<` escaped, so no string in the model can close the script tag.
  const json = JSON.stringify(model).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<link rel="stylesheet" href="webview/codicons/codicon.css">
<link rel="stylesheet" href="webview/styles.css">
<style>:root { ${vars} }</style>
<script>
const MODEL = ${json};
function forceHover() {
  for (const sheet of document.styleSheets) {
    let rules; try { rules = [...sheet.cssRules]; } catch { continue; }
    for (const r of rules) if (r.selectorText && r.selectorText.includes(':hover')) sheet.insertRule(r.cssText.replaceAll(':hover', '.acc-hover'), sheet.cssRules.length);
  }
  (document.querySelector('tbody tr:not(.group):not(.none)') ?? document.querySelector('.card'))?.classList.add('acc-hover');
}
window.acquireVsCodeApi = () => ({
  postMessage(m) { if (m.type === 'ready') setTimeout(() => { window.postMessage({ type: 'state', model: MODEL }, '*'); setTimeout(forceHover, 50); }); },
  getState() {}, setState() {},
});
</script>
</head>
<body class="vscode-${theme}" data-view="${kind}"><main id="app"></main><script src="webview/main.js"></script></body></html>
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

function main(argv: string[]): number {
  const { values, positionals } = parseArgs({
    args: argv, allowPositionals: true,
    options: { width: { type: 'string', default: '1000,620,480' }, theme: { type: 'string', default: 'dark,light' }, height: { type: 'string', default: '900' }, out: { type: 'string' } },
  });
  const views = positionals.length ? positionals : [...VIEW_KINDS];
  const bad = views.filter((v) => !(VIEW_KINDS as readonly string[]).includes(v));
  if (bad.length) return fail(`Unknown tab: ${bad.join(', ')}. Tabs: ${VIEW_KINDS.join(', ')}.`);
  const themes = values.theme.split(',');
  if (themes.some((t) => !(t in THEMES))) return fail(`Themes: ${Object.keys(THEMES).join(', ')}.`);
  const widths = values.width.split(',').map(Number);
  const height = Number(values.height);
  if ([...widths, height].some((n) => !Number.isInteger(n) || n < 200)) return fail('Widths and height are whole pixels, 200 or more.');
  const stale = staleBuild();
  if (stale) return fail(`Run \`npm run build\` first: ${stale}.`);
  const chrome = findChrome();
  if (!chrome) return fail('No Chrome, Chromium or Edge found. Set CHROME to its path.');

  const out = resolve(values.out ?? join(extensionDir, '..', 'dist', 'screenshots'));
  mkdirSync(out, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'acc-screenshots-'));
  try {
    cpSync(join(extensionDir, 'dist', 'webview'), join(work, 'webview'), { recursive: true });
    const now = Date.now();
    for (const view of views as ViewKind[]) {
      for (const theme of themes as Theme[]) {
        const page = join(work, `${view}-${theme}.html`);
        writeFileSync(page, pageFor(view, theme, sampleModel(view, now)));
        for (const width of widths) {
          const png = join(out, `${view}-${theme}-${width}.png`);
          rmSync(png, { force: true });
          const args = [
            // No --user-data-dir: headless Chrome already uses a throwaway profile, and a fresh one makes it
            // hang after writing the shot.
            '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
            '--allow-file-access-from-files', '--force-device-scale-factor=2',
            '--virtual-time-budget=3000', `--window-size=${width},${height}`, `--screenshot=${png}`, pathToFileURL(page).href,
          ];
          const [cmd, cmdArgs] = process.platform === 'win32' ? [chrome, args] : ['nice', ['-n', '15', chrome, ...args]];
          const r = spawnSync(cmd, cmdArgs, { stdio: 'ignore', timeout: 30_000 });
          if (r.error) return fail(`Chrome didn't finish ${view} (${theme}, ${width}px) within 30 s: ${r.error.message}`);
          if (!existsSync(png)) return fail(`Chrome didn't write ${png} (exit ${r.status ?? r.signal}).`);
          console.log(png);
        }
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return 0;
}

function fail(message: string): number {
  console.error(message);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
