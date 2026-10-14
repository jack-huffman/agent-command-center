// The loading screen a tab shows while it opens (T-16): one pure function makes it, the tab's HTML holds it
// for each kind of tab, and the page's styles keep it still for a person who asks for reduced motion.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { OPENING_WORDS_ID, loadingScreen, OPENING, type TabKind } from '../src/logic/loading.ts';
import { pageFor, PAGES, sampleModel, STILL } from '../scripts/screenshot.ts';
import { cssRules, pageStyles } from '../scripts/styles.ts';
import { cssClasses } from '../scripts/looked.ts';
import { judge } from '../scripts/geometry.ts';

/** panels.ts imports vscode, which only VSCode has: this test hands it a stand-in with the one call htmlFor makes. */
const STUB = `data:text/javascript,${encodeURIComponent('export const Uri = { joinPath: (u, ...p) => ({ toString: () => [u.toString(), ...p].join("/") }) }; export default {};')}`;
registerHooks({ resolve: (spec, ctx, next) => (spec === 'vscode' ? { url: STUB, format: 'module', shortCircuit: true } : next(spec, ctx)) });
const { htmlFor } = await import('../src/panels.ts');
const webview = { cspSource: 'vscode-resource:', asWebviewUri: (u: unknown) => u as never };
const base = { toString: () => 'file:///ext/dist/webview' } as never;
const KINDS = Object.keys(OPENING) as TabKind[];

test('a tab of each kind opens on the loading screen, with that kind\'s line as its name', () => {
  assert.deepEqual(KINDS, ['home', 'ticket', 'agent']);
  for (const kind of KINDS) {
    const html = htmlFor(webview, base, kind, 'n0nce');
    const app = /<main id="app">([\s\S]*?)<\/main>/.exec(html)?.[1] ?? '';
    assert.match(app, /^<div class="opening" role="status" aria-live="polite" aria-labelledby="opening-words">/, kind);
    assert.ok(app.includes(`<p class="opening-words" id="${OPENING_WORDS_ID}">${OPENING[kind]}</p>`), kind);
    assert.ok(app.includes('src="file:///ext/dist/webview/acc-dark.svg"') && app.includes('src="file:///ext/dist/webview/acc-light.svg"'), `${kind}: both marks, from the webview's folder`);
    assert.ok(!app.includes('Loading…'), `${kind}: the old corner text is gone`);
    assert.ok(!/\sstyle=/.test(html), `${kind}: no inline style, which the page's CSP forbids`);
  }
  assert.deepEqual(KINDS.map((k) => OPENING[k]), ['Opening the Command Center', 'Opening the task', 'Opening the agent']);
});

test('the loading screen draws both marks, the dark one first, and escapes a mark\'s URL that holds a quote (edge case)', () => {
  const html = loadingScreen('agent', { dark: 'a"b&c.svg', light: 'l.svg' });
  assert.ok(html.includes('<img class="opening-mark logo-dark" src="a&quot;b&amp;c.svg" alt="">'));
  assert.ok(html.indexOf('logo-dark') < html.indexOf('logo-light'));
  assert.equal((html.match(/alt=""/g) ?? []).length, 2, 'the marks are decoration: the line names the screen');
  assert.ok(html.endsWith('<p class="opening-words" id="opening-words">Opening the agent</p></div>'));
});

test('the page\'s styles centre the screen, turn the ring, fade it in late, and hold still under reduced motion', () => {
  const css = pageStyles();
  const rule = (sel: string) => cssRules(css).find((r) => r.selector === sel)?.declarations ?? [];
  const value = (sel: string, name: string) => rule(sel).find((d) => d.name === name)?.value;
  assert.deepEqual([value('.opening', 'position'), value('.opening', 'inset'), value('.opening', 'align-items'), value('.opening', 'justify-content')], ['fixed', '0', 'center', 'center']);
  assert.match(value('.opening', 'animation') ?? '', /^opening-in \d+ms ease-out 150ms both$/, 'it fades in after 150 ms');
  assert.deepEqual([value('.opening-ring', 'width'), value('.opening-ring', 'height'), value('.opening-mark', 'width')], ['76px', '76px', '48px']);
  assert.match(value('.opening-ring', 'border') ?? '', /var\(--line\)/);
  assert.match(value('.opening-ring::after', 'border-top-color') ?? '', /var\(--accent\)/);
  assert.match(value('.opening-ring::after', 'animation') ?? '', /^opening-turn 1\.1s cubic-bezier\([^)]*\) infinite$/, 'one turn in 1.1 s, eased');
  const reduced = /@media \(prefers-reduced-motion: reduce\) \{\s*([^{}]*)\{([^{}]*)\}/.exec(css);
  assert.ok(reduced, 'a reduced-motion rule');
  assert.deepEqual(reduced[1]!.split(',').map((s) => s.trim()), ['.opening', '.opening-ring::after']);
  assert.match(reduced[2]!, /animation: none/);
});

test('the screenshot run draws the loading page with no model sent, so the screen stays', () => {
  assert.ok(PAGES.includes('loading') && STILL.includes('loading'));
  const page = pageFor('loading', 'dark', sampleModel('loading'), 'light', false, true);
  assert.ok(page.includes(`<main id="app">${loadingScreen('home', { dark: 'webview/acc-dark.svg', light: 'webview/acc-light.svg' })}</main>`));
  assert.ok(!page.includes("type: 'state'"), 'no model is posted');
  assert.ok(page.includes('collectGeometry'), 'it is measured all the same');
  const drawn = pageFor('overview', 'dark', sampleModel('overview'), 'light', false, true);
  assert.ok(drawn.includes("type: 'state'") && drawn.includes('<main id="app"></main>'), 'every other page still gets its model, on an empty page');
});

test('a still page with no controls passes the geometry check, while any other page with none fails (edge case)', () => {
  const s = { controls: [], texts: [{ what: 'p.opening-words', text: 'Opening the Command Center', over: 0, ellipsis: false, titled: false, folded: false }], scrollers: [], doc: { scroll: 500, view: 500 }, said: [{ what: 'p.opening-words', text: 'Opening the Command Center', work: null }] } as never;
  assert.deepEqual(judge(s, false, [], false).violations, []);
  assert.deepEqual(judge(s, false, []).violations.map((v) => v.detail), ['examined no controls']);
});

test('each class the loading screen adds is one the page\'s styles hold', () => {
  const classes = cssClasses(pageStyles());
  const used = [...loadingScreen('home', { dark: 'd', light: 'l' }).matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(' '));
  assert.deepEqual([...new Set(used)].filter((c) => !classes.has(c)), []);
  assert.ok(used.length >= 5);
});

test('the loading page is measured with its fade ended, since a screen still at opacity 0 reads as unseen (edge case)', () => {
  const page = pageFor('loading', 'light', sampleModel('loading'), 'dark', false, true);
  const script = /<script>\n([\s\S]*?)<\/script>/.exec(page)![1]!;
  assert.doesNotThrow(() => new Function(script), 'the page\'s script is valid');
  assert.ok(page.includes('setTimeout(() => { document.getAnimations().filter((a) => a.effect.getTiming().iterations !== Infinity).forEach((a) => a.finish()); document.fonts.ready.then('), 'the fade ends, and the turning ring keeps turning');
  assert.ok(!pageFor('overview', 'light', sampleModel('overview'), 'dark', false, true).includes('getAnimations'), 'other pages are measured as before');
});
