// The rail's selected tab after a late icon font (T-24): document.fonts.ready resolves before the icon font
// starts to load, so the rail's scrolls missed the widening. Chrome isn't run here: a stand-in strip with the
// tab's two widths, a font set that fires loadingdone, and frames the test steps.
import assert from 'node:assert/strict';
import test from 'node:test';
import { showOnFontLoad } from '../webview/rail-fonts.ts';

class FakeFonts extends EventTarget {
  count = 0;
  override addEventListener(t: string, fn: () => void): void { this.count++; super.addEventListener(t, fn); }
  override removeEventListener(t: string, fn: () => void): void { this.count--; super.removeEventListener(t, fn); }
}

const RAIL = 500;
/** A strip at 620 px: the selected tab is narrower before the icon font arrives. Returns the tab's right edge in view. */
function draw(opts: { fontFirst: boolean; watch: boolean }): { right: () => number; arrive: () => void; fonts: FakeFonts } {
  const fonts = new FakeFonts();
  let arrived = opts.fontFirst;
  let scroll = 0;
  const right = (): number => (arrived ? 739 : 643) - scroll;
  const show = (): void => { if (right() > RAIL) scroll += right() - RAIL + 12; };
  show(); // the rail's own next frame, at the widths it has
  if (opts.watch) showOnFontLoad(fonts, show);
  return { right, fonts, arrive: () => { arrived = true; fonts.dispatchEvent(new Event('loadingdone')); } };
}

test('the selected tab is in the strip\'s view after a late icon font arrives (T-24)', () => {
  const d = draw({ fontFirst: false, watch: true });
  assert.ok(d.right() <= RAIL, 'in view at the fallback font\'s widths');
  d.arrive();
  assert.ok(d.right() <= RAIL, 'and after the icon font widens the tabs');
});

test('without the font watch, the late icon font leaves the tab past the edge (T-24 mutant)', () => {
  const d = draw({ fontFirst: false, watch: false });
  d.arrive();
  assert.ok(d.right() > RAIL);
});

test('a rail drawn when the font is already loaded still shows its selected tab (T-24)', () => {
  const d = draw({ fontFirst: true, watch: true });
  assert.ok(d.right() <= RAIL);
});

test('the stop function takes the listener off, so a replaced rail no longer scrolls (T-24)', () => {
  const fonts = new FakeFonts();
  let shown = 0;
  const stop = showOnFontLoad(fonts, () => shown++);
  fonts.dispatchEvent(new Event('loadingdone'));
  stop();
  fonts.dispatchEvent(new Event('loadingdone'));
  assert.equal(shown, 1);
  assert.equal(fonts.count, 0);
});
