/**
 * The screenshots gate (T-5). CLAUDE.md asks that UI changes be looked at before they ship: build, take
 * the screenshots, read the PNGs. Reviews kept finding it skipped: shots on disk older than the change,
 * shots cut off above the new part, a new line that no shot draws (13 findings across 11 tasks). Nothing
 * can tell whether a person read a PNG, but this can tell whether the shots there are to read show the
 * branch as it is.
 *
 * When a branch changes a file the pages draw from (UI_PATHS), every usual shot (each page, theme and
 * width) must be noted in dist/screenshots/shots.json by the screenshot run, with this commit's
 * fingerprint, no geometry findings, and the PNG on disk still the one it noted. And every CSS class the
 * branch adds to the webview's stylesheets must be drawn inside the window of at least one of them, or be
 * named in UNDRAWN with why. It counts the shots and classes it checked and fails on none. Every shot
 * must have been drawn by the pinned headless shell (T-68), never the person's own browser: a shot drawn
 * by anything else, or whose note names no browser, fails.
 *
 * It runs as a builder's check, through acc gate run, which says what the branch changed in ACC_CHANGED.
 * The merge queue's checkout has no screenshots, so the full check doesn't run it.
 *
 *   node --no-warnings extension/scripts/looked.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPinnedShell, type Pin, PIN } from './browser.ts';
import { expectedShots, fingerprint, readShots, sha256Of, type ShotsRecord } from './screenshot.ts';
import { pageStyles, styleNames } from './styles.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The folders whose files the pages draw from: the page itself, the model and code it's built by, and the sample data and checks of the screenshot run. */
export const UI_PATHS = ['extension/webview/', 'extension/src/', 'extension/scripts/'] as const;

/** The changed files the pages draw from. */
export const uiChanges = (changed: string[]): string[] => changed.filter((p) => UI_PATHS.some((d) => p.startsWith(d)));

/**
 * Classes a branch may add without a shot that draws them, each with why. A class here that the
 * stylesheets no longer hold fails the gate's test, so the list only holds what's still true.
 */
export const UNDRAWN: readonly { name: string; reason: string }[] = [
  { name: 'dock-fold-rows', reason: 'A folded row\'s own rows show only after a person opens it, which a shot can\'t do; run-rows.test.ts checks what folds, and the done shots draw the folded row.' },
  { name: 'ds-name', reason: 'Dispatch\'s sheet shows the model name box only after a person picks Another model…, which a shot can\'t do; the behaviour case "dispatch sheet: Another model…" opens it and types in it (D-168).' },
];

/** The class names a stylesheet's selectors use. Declarations, comments and strings are left out, so `url(a.svg)` isn't a class. */
export function cssClasses(css: string): Set<string> {
  const out = new Set<string>();
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '""');
  for (const m of bare.matchAll(/([^{}]*)\{/g)) {
    // A nested rule follows its parent's declarations: only what's after the last of them is its selector.
    const selector = (m[1] ?? '').split(';').pop() ?? '';
    for (const c of selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(c[1]!);
  }
  return out;
}

/** The classes the stylesheets hold now and didn't before, sorted. */
export function addedClasses(now: string[], before: string[]): string[] {
  const had = new Set(before.flatMap((css) => [...cssClasses(css)]));
  return [...new Set(now.flatMap((css) => [...cssClasses(css)]))].filter((c) => !had.has(c)).sort();
}

export interface Judged { passed: boolean; lines: string[] }

/**
 * The gate's verdict. changed: the files the branch changed. print: this commit's fingerprint. hash: a
 * PNG's sha256 on disk, or null when it's gone. added: the classes the branch adds. pin: the headless
 * shell every shot must be drawn by.
 */
export function judgeShots(input: { changed: string[]; record: ShotsRecord; print: string; expected: string[]; hash: (file: string) => string | null; added: string[]; undrawn?: readonly { name: string }[]; pin?: Pin }): Judged {
  const { changed, record, print, expected, hash, added, undrawn = UNDRAWN, pin = PIN } = input;
  if (!changed.length) return { passed: false, lines: ['The branch changed no files, so there was nothing to check.'] };
  const ui = uiChanges(changed);
  if (!ui.length) return { passed: true, lines: [`Checked ${changed.length} changed file${changed.length === 1 ? '' : 's'}: none is one the pages draw from (${UI_PATHS.join(', ')}), so no screenshots are needed.`] };
  const take = 'Run npm run build, then npm run screenshot, and read the PNGs in dist/screenshots/.';
  if (!expected.length) return { passed: false, lines: ['There are no usual shots to check: the screenshot run lists no pages.'] };
  const failures: string[] = [];
  let checked = 0;
  const notes = expected.map((f) => [f, record.shots[f]] as const);
  const missing = notes.filter(([, n]) => !n).map(([f]) => f);
  const stale = notes.filter(([, n]) => n && n.fingerprint !== print).map(([f]) => f);
  const found = notes.filter(([, n]) => n && n.fingerprint === print && n.findings > 0).map(([f, n]) => `${f} (${n!.findings})`);
  const changedSince = notes.filter(([f, n]) => n && n.fingerprint === print && hash(f) !== n.sha256).map(([f]) => f);
  // Drawn by another browser, or by one the note doesn't name (T-68): either way not the pinned shell.
  const nameless = notes.filter(([, n]) => n && n.fingerprint === print && !n.browser).map(([f]) => f);
  const otherBrowser = notes.filter(([, n]) => n && n.fingerprint === print && n.browser && !isPinnedShell(n.browser, pin)).map(([f, n]) => `${f} (${n!.browser!.name} ${n!.browser!.version || 'of no version'})`);
  for (const [f, n] of notes) if (n && n.fingerprint === print && !n.findings && hash(f) === n.sha256 && isPinnedShell(n.browser, pin)) checked++;
  const some = (list: string[]): string => `${list.slice(0, 5).join(', ')}${list.length > 5 ? `, and ${list.length - 5} more` : ''}`;
  if (missing.length === expected.length) failures.push(`No screenshots of this branch's pages were taken here, and it changed ${ui.length} file${ui.length === 1 ? '' : 's'} they draw from, such as ${ui[0]}. ${take}`);
  else if (missing.length) failures.push(`${missing.length} of the ${expected.length} usual shots weren't taken: ${some(missing)}. ${take}`);
  if (stale.length) failures.push(`${stale.length} shot${stale.length === 1 ? ' was' : 's were'} taken of other code than this commit's: ${some(stale)}. Take them again: ${take}`);
  if (found.length) failures.push(`${found.length} shot${found.length === 1 ? '' : 's'} had geometry findings: ${some(found)}. Fix them and take the shots again.`);
  const shell = `Run npm run browser to get the pinned headless shell, ${pin.name} ${pin.version}, then npm run screenshot again.`;
  if (otherBrowser.length) failures.push(`${otherBrowser.length} shot${otherBrowser.length === 1 ? ' was' : 's were'} drawn by another browser than the pinned headless shell: ${some(otherBrowser)}. ${shell}`);
  if (nameless.length) failures.push(`${nameless.length} shot${nameless.length === 1 ? '\'s note names' : 's\' notes name'} no browser, so nothing says how ${nameless.length === 1 ? 'it was' : 'they were'} drawn: ${some(nameless)}. ${shell}`);
  if (changedSince.length) failures.push(`${changedSince.length} PNG${changedSince.length === 1 ? ' is' : 's are'} gone or changed since the screenshot run took ${changedSince.length === 1 ? 'it' : 'them'}: ${some(changedSince)}. Take the shots again.`);
  // A class the branch adds is new UI: some shot must draw it on screen (GH-32, GH-52, GH-76's findings).
  const drawn = new Set(notes.flatMap(([, n]) => (n && n.fingerprint === print ? n.drawn : [])));
  const excused = new Set(undrawn.map((u) => u.name));
  const undrawnNew = added.filter((c) => !drawn.has(c) && !excused.has(c));
  if (undrawnNew.length) failures.push(`${undrawnNew.length} class${undrawnNew.length === 1 ? '' : 'es'} new on this branch ${undrawnNew.length === 1 ? 'isn\'t' : 'aren\'t'} drawn on screen in any shot: ${some(undrawnNew.map((c) => `.${c}`))}. Give a sample page the state that shows ${undrawnNew.length === 1 ? 'it' : 'them'}, or a taller shot in PAGE_HEIGHT, or name ${undrawnNew.length === 1 ? 'it' : 'each'} in UNDRAWN (extension/scripts/looked.ts) with why.`);
  if (!checked && !failures.length) failures.push('Checked no shots.');
  if (failures.length) return { passed: false, lines: failures };
  return { passed: true, lines: [`Checked ${checked} shots of this commit's pages, each drawn by ${pin.name} ${pin.version} with no geometry findings, and ${added.length} class${added.length === 1 ? '' : 'es'} new on this branch, each drawn${added.some((c) => excused.has(c)) ? ' or named in UNDRAWN' : ''}. ${ui.length} changed file${ui.length === 1 ? '' : 's'} the pages draw from.`] };
}

const git = (args: string[]): string => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

/** Where the branch left main: the remote copy if there is one, else the local branch. */
function base(): string {
  for (const ref of ['origin/main', 'main']) {
    try {
      return git(['merge-base', 'HEAD', ref]).trim();
    } catch { /* not here: try the next */ }
  }
  throw new Error('There\'s no main or origin/main branch here to compare with.');
}

/**
 * The page's stylesheets where the branch began, by the list styleFiles() gives now: files is what the
 * webview's folder held then, by name, and show reads one. A .css no module is named for was never part
 * of the page, so its classes don't count as there before.
 */
export function stylesBefore(files: string[], show: (name: string) => string): string[] {
  return styleNames(files).styles.filter((f) => files.includes(f)).map(show);
}

/** The webview's stylesheets: now, as the build joins them, and where the branch began. */
function stylesheets(at: string): { now: string[]; before: string[] } {
  const now = [pageStyles()];
  const files = git(['ls-tree', '--name-only', at, 'extension/webview/']).split('\n').filter(Boolean).map((f) => basename(f));
  const before = stylesBefore(files, (f) => git(['show', `${at}:extension/webview/${f}`]));
  return { now, before };
}

function main(): number {
  if (process.env.ACC_CHANGED === undefined) {
    console.error('ACC_CHANGED isn\'t set. Run this through acc gate run, which sets it.');
    return 1;
  }
  const changed = process.env.ACC_CHANGED.split('\n').map((l) => l.trim()).filter(Boolean);
  const shots = join(ROOT, 'dist', 'screenshots');
  const ui = uiChanges(changed).length > 0;
  const css = ui ? stylesheets(base()) : { now: [], before: [] };
  const judged = judgeShots({
    changed, record: readShots(shots), print: ui ? fingerprint() : '', expected: expectedShots(),
    hash: (f) => (existsSync(join(shots, f)) ? sha256Of(join(shots, f)) : null), added: addedClasses(css.now, css.before),
  });
  for (const l of judged.lines) (judged.passed ? console.log : console.error)(l);
  return judged.passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
