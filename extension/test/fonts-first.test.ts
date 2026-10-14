// The screenshot run on a busy machine (T-21): the icon font came late, after the rail had scrolled its
// selected tab into view at the fallback font's widths, so the tab measured past the strip's edge on some
// runs and not others. The measuring page now loads its fonts before it's sent its model. Chrome isn't run
// here: the page's own fontsFirst and settle run on frames the test steps, against a stand-in rail and a
// font that comes after as many frames as the test says, which is the delay a busy machine adds.
import assert from 'node:assert/strict';
import test from 'node:test';
import { type Box, type GeoSnapshot, judge } from '../scripts/geometry.ts';
import { pageFor, sampleModel } from '../scripts/screenshot.ts';
import { FONTS_FIRST, fontsUnwaited, SETTLE } from '../scripts/steady.ts';

interface Face { load: () => Promise<unknown> }
type FontsFirst = (fonts: Iterable<Face>, then: () => void) => void;
type Settle = (read: () => string, frame: (cb: () => void) => void, done: () => void) => void;
const page = (): { window: { accFontsFirst?: number; accFontsFailed?: string }; fontsFirst: FontsFirst; settle: Settle } => {
  const window: { accFontsFirst?: number; accFontsFailed?: string } = {};
  const [fontsFirst, settle] = new Function('window', `${FONTS_FIRST}${SETTLE}; return [fontsFirst, settle];`)(window) as [FontsFirst, Settle];
  return { window, fontsFirst, settle };
};
const flush = async (): Promise<void> => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

const rail: Box = { x: 0, y: 0, w: 500, h: 46 };
const snapshot = (box: Box): GeoSnapshot => ({ controls: [{ what: 'button.a', text: 'a', box: { x: 0, y: 0, w: 80, h: 24 }, inside: [], layer: null }], texts: [{ what: 'span', text: 'words', over: 0, ellipsis: false, titled: false, folded: false }], tab: { what: 'button.nav-item.on', box, rail }, doc: { scroll: 500, view: 500 }, scrollers: [], said: [{ what: 'span', text: 'words', work: null }] });
const tabFound = (box: Box): string[] => judge(snapshot(box), true, []).violations.filter((v) => v.check === 'tab').map((v) => v.detail);

/**
 * One drawing of a page with a strip rail, as Chrome draws Settings at 620 px: the selected tab is narrower
 * at the fallback font's widths than with the icon font, which arrives fontAt frames after it's first asked
 * for. The rail scrolls its tab into view on its next frame and once document.fonts.ready resolves, which
 * is at once when no font is loading yet, as in rail.ts. first: the page loads its fonts before its model
 * (T-21); without it, the model is sent at once, as before. scrolls: the rail scrolls its tab into view at all.
 */
async function draw(fontAt: number, first: boolean, scrolls = true): Promise<{ box: Box; fonts: number | undefined; frame: number }> {
  const p = page();
  const frames: (() => void)[] = [];
  const raf = (cb: () => void): void => { frames.push(cb); };
  let asked = -1;
  let arrived = false;
  let arrive = (): void => {};
  const font = new Promise<void>((r) => { arrive = r; });
  const face: Face = { load: () => { if (asked < 0) asked = frame; return font; } };
  const ready = (): Promise<unknown> => (asked >= 0 && !arrived ? font : Promise.resolve());
  let frame = 0;
  let scroll = 0;
  // The tab's box in the strip at scrollLeft 0, then less the strip's scroll.
  const at = (): Box => (arrived ? { x: 640, y: 8, w: 99, h: 33 } : { x: 560, y: 8, w: 83, h: 33 });
  const box = (): Box => ({ ...at(), x: at().x - scroll });
  const showSelected = (): void => { const b = box(); if (scrolls && b.x + b.w > rail.w) scroll += b.x + b.w - rail.w + 12; };
  let measured: { box: Box; fonts: number | undefined; frame: number } | null = null;
  const render = (): void => {
    scroll = 0;
    raf(showSelected);
    void ready().then(showSelected);
    face.load(); // Laying out the tabs' icons asks for the font.
    void ready().then(() => raf(() => raf(() => p.settle(() => JSON.stringify(box()), raf, () => { measured = { box: box(), fonts: p.window.accFontsFirst, frame }; }))));
  };
  if (first) p.fontsFirst([face], render);
  else render();
  for (; frame < 200 && !measured; frame++) {
    if (asked >= 0 && !arrived && frame >= asked + fontAt) { arrived = true; arrive(); }
    await flush();
    for (const cb of frames.splice(0)) cb();
    await flush();
  }
  assert.ok(measured, 'the page measured');
  return measured;
}

const DELAYS = [0, 1, 2, 3, 5, 8, 13, 30];

test('a font that comes late doesn\'t change what the page measures, however late, once fonts load first (T-21)', async () => {
  const seen = new Set<string>();
  for (const d of DELAYS) {
    const m = await draw(d, true);
    seen.add(JSON.stringify(m.box));
    assert.deepEqual(tabFound(m.box), [], `the font ${d} frames late`);
    assert.equal(m.fonts, 1);
  }
  assert.equal(seen.size, 1, 'one box, whatever the delay');
});

test('without fonts first, a late font leaves the tab past the strip\'s edge, as on the busy machine (T-21 mutant)', async () => {
  const found = await Promise.all(DELAYS.map(async (d) => ({ d, found: tabFound((await draw(d, false)).box) })));
  assert.deepEqual(found.find((f) => f.d === 0)!.found, [], 'with the font at once, the old order passed');
  const late = found.filter((f) => f.found.length).map((f) => f.d);
  assert.ok(late.length > 0, 'the old order fails for some delay');
  assert.ok(late.length < DELAYS.length, 'and passes for others: the result hung on the machine\'s speed');
  assert.equal((await draw(5, false)).fonts, undefined, 'and nothing says the fonts loaded first');
});

test('a tab really outside the strip still fails, with fonts first and the font at once or late (T-21)', async () => {
  for (const d of [0, 5, 30]) assert.deepEqual(tabFound((await draw(d, true, false)).box), ['the selected tab is outside the rail\'s visible part'], `the font ${d} frames late`);
});

test('fontsFirst waits for every font, a page with none goes on at once with none counted, and a failed font never goes on (T-21)', async () => {
  const p = page();
  let called = 0;
  const later: (() => void)[] = [];
  const slow = (): Face => ({ load: () => new Promise<void>((r) => later.push(r)) });
  p.fontsFirst([slow(), slow()], () => called++);
  await flush();
  assert.equal(called, 0, 'nothing before the fonts');
  later[0]!();
  await flush();
  assert.equal(called, 0, 'nor with one of two');
  later[1]!();
  await flush();
  assert.equal(called, 1);
  assert.equal(p.window.accFontsFirst, 2);

  const none = page();
  let went = false;
  none.fontsFirst([], () => { went = true; });
  await flush();
  assert.ok(went);
  assert.equal(none.window.accFontsFirst, 0);

  const failed = page();
  let failedWent = false;
  failed.fontsFirst([{ load: () => Promise.reject(new Error('no font')) }], () => { failedWent = true; });
  await flush();
  assert.equal(failedWent, false, 'the page measures nothing, and the run fails on that');
  assert.equal(failed.window.accFontsFirst, undefined);
  assert.equal(failed.window.accFontsFailed, 'Error: no font');
});

test('the run refuses a drawing that loaded no fonts first, or doesn\'t say, and takes one that loaded some (T-21)', () => {
  assert.equal(fontsUnwaited('settings-about (light, 620px)', 1), null);
  assert.match(fontsUnwaited('settings-about (light, 620px)', 0)!, /^settings-about \(light, 620px\) loaded no fonts before its model/);
  assert.match(fontsUnwaited('setup-first (dark, 500px)', undefined)!, /loaded no fonts/);
});

test('every page the run draws loads its fonts before it\'s sent its model, the loading screen with no model too (T-21)', () => {
  let checked = 0;
  for (const kind of ['settings-about', 'setup-first', 'loading'] as const) {
    const html = pageFor(kind, 'light', sampleModel(kind, 0, 'light'), 'dark', false, true);
    const handler = /if \(m\.type === 'ready'\) (.*)$/m.exec(html)?.[1] ?? '';
    assert.match(handler, /^fontsFirst\(document\.fonts, \(\) => /, `${kind} waits on its fonts first`);
    assert.ok(html.includes('function fontsFirst('), `${kind} holds fontsFirst`);
    if (kind !== 'loading') assert.ok(handler.indexOf('fontsFirst') < handler.indexOf("type: 'state'"), `${kind} sends its model after`);
    checked++;
  }
  assert.equal(checked, 3);
});
