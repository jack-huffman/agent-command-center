// The rail's selected tab after a late icon font (T-24): document.fonts.ready resolves before the icon font
// starts to load, so the rail's scrolls missed the widening. Chrome isn't run here: the test draws the page's
// real renderNav (webview/rail.ts) on a stand-in document, whose 500 px strip stands for the rail under 820 px
// (the page's width isn't modelled), and whose selected tab is narrower until the icon font arrives. The font set fires loadingdone, and the frames
// are stepped by the test. Without the watch in renderNav, the first two tests fail.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { HomeModel } from '../src/model/home.ts';

const STRIP = 500;
/** The selected tab's right edge at scrollLeft 0: past the strip's edge once the icon font has widened the tabs. */
const TAB_RIGHT = { fallback: 643, icon: 739 };

class FakeFonts extends EventTarget {
  count = 0;
  ready: Promise<unknown> = new Promise(() => {}); // Never settles: the test steps the font by hand.
  override addEventListener(t: string, fn: () => void): void { this.count++; super.addEventListener(t, fn); }
  override removeEventListener(t: string, fn: () => void): void { this.count--; super.removeEventListener(t, fn); }
}

let iconFont = false;
class FakeNode {
  className = '';
  children: FakeNode[] = [];
  dataset: Record<string, string> = {};
  scrollLeft = 0;
  strip: FakeNode | null = null;
  tag: string;
  constructor(tag: string) { this.tag = tag; }
  append(...c: (FakeNode | string)[]): void { for (const x of c) this.children.push(typeof x === 'string' ? new FakeNode('#text') : x); }
  setAttribute(): void {}
  addEventListener(): void {}
  has(cls: string): boolean { return this.className.split(' ').includes(cls); }
  all(): FakeNode[] { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelector(sel: string): FakeNode | null { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel: string): FakeNode[] { const cls = sel.split('.').slice(1); return this.all().filter((n) => cls.every((c) => n.has(c))); }
  get scrollWidth(): number { return this.has('rail') ? TAB_RIGHT.icon + 24 : 0; }
  get clientWidth(): number { return this.has('rail') ? STRIP : 0; }
  getBoundingClientRect(): { left: number; right: number } {
    if (this.has('rail')) return { left: 0, right: STRIP };
    const right = (iconFont ? TAB_RIGHT.icon : TAB_RIGHT.fallback) - (this.strip?.scrollLeft ?? 0);
    return { left: right - 99, right };
  }
}
const fonts = new FakeFonts();
let frames: (() => void)[] = [];
Object.assign(globalThis, {
  document: { createElement: (t: string) => new FakeNode(t), createTextNode: () => new FakeNode('#text'), getElementById: () => new FakeNode('main'), body: { dataset: {} }, fonts },
  requestAnimationFrame: (cb: () => void) => frames.push(cb),
  acquireVsCodeApi: () => ({ postMessage() {}, getState: () => undefined, setState() {} }),
});
const { renderNav, showOnFontLoad } = await import('../webview/rail.ts');

const model = { nav: [{ section: 'overview', icon: 'home', label: 'Overview', hint: 'h', count: null, attention: false }, { section: 'settings', icon: 'gear', label: 'Settings', hint: 'h', count: null, attention: false }], overview: { projects: [] } } as unknown as HomeModel;

/** Draws the rail with Settings selected and runs its first frame, with the icon font loaded or not. */
function draw(fontFirst: boolean): { rail: FakeNode; inView: () => boolean } {
  iconFont = fontFirst;
  frames = [];
  const rail = renderNav(model, 'settings') as unknown as FakeNode;
  const tab = rail.querySelector('.nav-item.on')!;
  tab.strip = rail;
  for (const cb of frames.splice(0)) cb();
  return { rail, inView: () => tab.getBoundingClientRect().right <= STRIP };
}
const arrive = (): void => { iconFont = true; fonts.dispatchEvent(new Event('loadingdone')); };

test('the selected tab is in the strip\'s view after a late icon font arrives, in a strip under 820 px (T-24)', () => {
  const d = draw(false);
  assert.ok(d.rail.scrollLeft > 0, 'the strip scrolled for the tab at the fallback font\'s widths');
  assert.ok(d.inView());
  iconFont = true;
  assert.equal(d.inView(), false, 'the icon font widens the tabs and pushes it out');
  fonts.dispatchEvent(new Event('loadingdone'));
  assert.ok(d.inView(), 'the rail scrolled it back');
});

test('a font that finishes loading again scrolls the tab back each time (T-24)', () => {
  const d = draw(false);
  arrive();
  d.rail.scrollLeft = 0;
  fonts.dispatchEvent(new Event('loadingdone'));
  assert.ok(d.inView());
});

test('a rail drawn when the font is already loaded still shows its selected tab (T-24)', () => {
  const d = draw(true);
  assert.ok(d.inView());
  arrive();
  assert.ok(d.inView());
});

test('only the newest rail listens for fonts, so a replaced rail is left alone (T-24 edge case: a redraw)', () => {
  const old = draw(false);
  const newest = draw(false);
  assert.equal(fonts.count, 1, 'one listener after two draws');
  const scrolled = old.rail.scrollLeft;
  arrive();
  assert.equal(old.rail.scrollLeft, scrolled, 'the replaced rail did not move');
  assert.ok(newest.inView());
});

test('showOnFontLoad calls show on each loadingdone, and nothing once it is stopped (T-24)', () => {
  const fonts = new FakeFonts();
  let shown = 0;
  const stop = showOnFontLoad(fonts, () => { shown++; });
  fonts.dispatchEvent(new Event('loadingdone'));
  fonts.dispatchEvent(new Event('loadingdone'));
  assert.equal(shown, 2, 'each font that finishes loading shows the tab again');
  assert.equal(fonts.count, 1, 'one listener');
  stop();
  fonts.dispatchEvent(new Event('loadingdone'));
  assert.equal(shown, 2, 'nothing after it is stopped');
  assert.equal(fonts.count, 0, 'its listener is removed');
});
