// The screenshot run's geometry checks (GH-105), on drawings made up to break one rule each, so a check
// that stopped looking can't pass. The run itself measures the real pages in Chrome: npm run screenshot.
import assert from 'node:assert/strict';
import test from 'node:test';
import { COLLECT_GEOMETRY, dumpedGeometry, type GeoControl, type GeoSnapshot, type GeoText, GEOMETRY_EXCEPTIONS, judge, OVERVIEW_LINES, type Render, RUN_FLOOR, runFailures, SIDEWAYS } from '../scripts/geometry.ts';
import { pageFor, PAGES, sampleModel, viewOf } from '../scripts/screenshot.ts';

const control = (what: string, x: number, y: number, o: Partial<GeoControl> = {}): GeoControl => ({ what, text: what, box: { x, y, w: 80, h: 24 }, inside: [], layer: null, ...o });
const text = (what: string, o: Partial<GeoText> = {}): GeoText => ({ what, text: `${what}'s words`, over: 0, ellipsis: false, titled: false, folded: false, ...o });
const rail = { what: 'button.nav-item.on', box: { x: 10, y: 60, w: 200, h: 30 }, rail: { x: 0, y: 0, w: 232, h: 900 } };
/** A drawing that passes every check: two controls side by side, a text that fits, the tab on screen, nothing wide. */
const fine = (o: Partial<GeoSnapshot> = {}): GeoSnapshot => ({
  controls: [control('button.a', 0, 0), control('button.b', 100, 0)], texts: [text('span.a')], tab: rail, doc: { scroll: 1000, view: 1000 }, scrollers: [], ...o,
});
const found = (s: GeoSnapshot, home = true) => judge(s, home, []).violations.map((v) => `${v.check}: ${v.what}: ${v.detail}`);

test('a drawing that breaks no rule passes, and says how much each check examined (GH-105)', () => {
  const v = judge(fine(), true, []);
  assert.deepEqual(v.violations, []);
  assert.deepEqual(v.examined, { overlap: 2, clipped: 1, tab: 1, sideways: 1, overview: 0 });
});

test('the Overview\'s lines are each one line high, five to a list at most, with a gap between each (GH-160)', () => {
  const at = (y: number, h = 36) => ({ x: 0, y, w: 900, h });
  const list = (what: string, rows: { x: number; y: number; w: number; h: number }[]) => fine({ overview: { groups: [{ what, rows }] } });
  // Five lines of 36 px, 6 px apart: as the page draws them.
  const five = [0, 42, 84, 126, 168].map((y) => at(y));
  assert.deepEqual(found(list('needs-you', five)), []);
  assert.equal(judge(list('needs-you', five), true, []).examined.overview, 5, 'each line is examined');
  assert.deepEqual(found(list('history', [...five, at(210)])), ['overview: history: shows 6 lines, more than 5']);
  assert.deepEqual(found(list('needs-you', [at(0), at(42, 160)])), [`overview: needs-you: line 2 is 160 px high, more than one line's ${OVERVIEW_LINES.maxHeight}`], 'a question drawn in full is no line');
  assert.deepEqual(found(list('ready', [at(0), at(36), at(72)])), ['overview: ready: lines 1 and 2 are 0 px apart, less than 4', 'overview: ready: lines 2 and 3 are 0 px apart, less than 4'], 'rows that share one bar');
  assert.deepEqual(found(list('ready', [at(72), at(0), at(36)])).length, 2, 'measured in the order they\'re drawn down the page, not the order found');
  assert.deepEqual(found(fine({ overview: { groups: [{ what: 'a', rows: [at(0), at(42)] }, { what: 'b', rows: [at(44)] }] } })), [], 'a gap is between neighbours in one list');
  // The Overview with no lines has stopped being looked at; another page has nothing to measure.
  assert.deepEqual(found(fine({ overview: { groups: [] } })), ['overview: the page: is the Overview, and examined no lines on it']);
  assert.deepEqual(found(fine({ overview: null })), []);
  assert.deepEqual(OVERVIEW_LINES, { maxHeight: 44, minGap: 4, maxRows: 5 }, 'pinned');
});

test('two controls that overlap fail; one inside the other, or one floating in a sticky layer, doesn\'t (GH-105)', () => {
  assert.deepEqual(found(fine({ controls: [control('button.a', 0, 0), control('button.b', 60, 10)] })), ['overlap: button.a: "button.a" overlaps button.b "button.b"']);
  assert.deepEqual(found(fine({ controls: [control('button.a', 0, 0), control('button.b', 79, 0)] })), [], 'a pixel\'s touch isn\'t an overlap');
  assert.deepEqual(found(fine({ controls: [control('article.card', 0, 0), control('button.more', 10, 0, { inside: [0] })] })), [], 'a button in a card that opens');
  assert.deepEqual(found(fine({ controls: [control('a.row', 0, 0), control('button.menu', 10, 0, { layer: 0 })] })), [], 'a sticky actions cell over a scrolled row');
  assert.equal(found(fine({ controls: [control('button.a', 0, 0, { layer: 1 }), control('button.b', 10, 0, { layer: 1 })] })).length, 1, 'two in the same sticky layer still can\'t overlap');
});

test('a label cut off fails; an ellipsis passes only with its full text in a title or aria-label (GH-105)', () => {
  assert.deepEqual(found(fine({ texts: [text('span.name', { over: 14 })] })), ['clipped: span.name: "span.name\'s words" is cut off by 14 px']);
  assert.deepEqual(found(fine({ texts: [text('span.name', { over: 14, ellipsis: true })] })), ['clipped: span.name: "span.name\'s words" is cut short with an ellipsis, and no title or aria-label holds it whole']);
  assert.deepEqual(found(fine({ texts: [text('span.name', { over: 14, ellipsis: true, titled: true })] })), []);
  assert.deepEqual(found(fine({ texts: [text('span.name', { over: 14, titled: true })] })), ['clipped: span.name: "span.name\'s words" is cut off by 14 px'], 'a hard cut fails even with a title');
  assert.deepEqual(found(fine({ texts: [text('div.reason', { over: 40, folded: true })] })), [], 'a fold of a few lines, with Show all');
  assert.deepEqual(found(fine({ texts: [text('span.name', { over: 1 })] })), [], 'a pixel of a glyph\'s edge');
});

test('the rail\'s selected tab must be on screen, and a section must have one (GH-105)', () => {
  assert.deepEqual(found(fine({ tab: { ...rail, box: { x: 520, y: 8, w: 110, h: 30 }, rail: { x: 0, y: 0, w: 500, h: 46 } } })), ['tab: button.nav-item.on: the selected tab is outside the rail\'s visible part']);
  assert.deepEqual(found(fine({ tab: null })), ['tab: the page: has no selected tab in the rail']);
  assert.deepEqual(found(fine({ tab: null }), false), [], 'a ticket\'s or an agent\'s page has no rail');
});

test('the page never scrolls sideways, and only the elements meant to do (GH-105)', () => {
  assert.deepEqual(found(fine({ doc: { scroll: 1040, view: 1000 } })), ['sideways: the page: scrolls sideways by 40 px']);
  assert.deepEqual(found(fine({ scrollers: [{ what: 'div.board', scroll: 1800, client: 900, allowed: true }] })), []);
  assert.deepEqual(found(fine({ scrollers: [{ what: 'div.notice', scroll: 960, client: 900, allowed: false }, { what: 'div.fits', scroll: 900, client: 900, allowed: false }] })), ['sideways: div.notice: scrolls sideways by 60 px']);
  assert.deepEqual(judge(fine({ scrollers: [{ what: 'div.board', scroll: 1, client: 1, allowed: true }] }), true, []).examined.sideways, 2, 'the page and each scroller');
  assert.deepEqual(SIDEWAYS, ['.board', '.table-wrap', '.rail', '.doc pre', '.table-scroll']);
});

test('a drawing that examined no controls or no text fails: an empty page can\'t pass (GH-105)', () => {
  assert.deepEqual(found({ controls: [], texts: [], tab: null, doc: { scroll: 0, view: 1000 }, scrollers: [] }, false), ['overlap: the page: examined no controls', 'clipped: the page: examined no text']);
});

test('an exception excuses only its own check on what it names, and counts what it excused (GH-105)', () => {
  const exceptions = [{ name: 'the strip', check: 'sideways' as const, what: /^div\.strip$/, reason: 'made up' }];
  const s = fine({ scrollers: [{ what: 'div.strip', scroll: 960, client: 900, allowed: false }, { what: 'div.strip2', scroll: 960, client: 900, allowed: false }], texts: [text('div.strip', { over: 9 })] });
  const v = judge(s, true, exceptions);
  assert.deepEqual(v.violations.map((x) => `${x.check}: ${x.what}`), ['clipped: div.strip', 'sideways: div.strip2']);
  assert.deepEqual(v.excused, { 'the strip': 1 });
  for (const e of GEOMETRY_EXCEPTIONS) assert.ok(e.reason.length > 20, `${e.name} says why`);
});

test('a whole run fails below its floors, and on an exception that excused nothing; a run of a few pages doesn\'t (GH-105)', () => {
  const verdict = judge(fine(), true, []);
  const renders: Render[] = [{ page: 'tasks', theme: 'dark', width: 500, verdict: { ...verdict, violations: [{ check: 'overlap', what: 'button.a', detail: 'overlaps button.b' }] } }];
  const floor = { overlap: 10, clipped: 0, tab: 0, sideways: 0, overview: 0 };
  const unused = [{ name: 'the strip', check: 'sideways' as const, what: /strip/, reason: 'made up' }];
  assert.deepEqual(runFailures(renders, false, unused, floor), ['tasks dark 500px: overlap: button.a: overlaps button.b']);
  assert.deepEqual(runFailures(renders, true, unused, floor), [
    'tasks dark 500px: overlap: button.a: overlaps button.b', 'The run examined 2 for overlap, below its floor of 10.', 'The exception for the strip excused nothing: take it off GEOMETRY_EXCEPTIONS.',
  ]);
  assert.deepEqual(runFailures([], false), ['No page was drawn.']);
  const renders198 = PAGES.length * 2 * 3;
  assert.ok(RUN_FLOOR.overlap >= 30 * renders198, `a full run examines at least 30 controls a drawing (${RUN_FLOOR.overlap})`);
  assert.equal(RUN_FLOOR.tab, PAGES.filter((p) => viewOf(p) === 'home').length * 6, 'and the selected tab on every section, in every drawing');
});

test('a page measures its geometry only when the run asks, and the run reads it from the dumped page (GH-105)', () => {
  const model = sampleModel('agents');
  assert.ok(!pageFor('agents', 'dark', model).includes('collectGeometry'), 'a page drawn for the colour check doesn\'t measure');
  const page = pageFor('agents', 'dark', model, 'light', false, true);
  assert.ok(page.includes(COLLECT_GEOMETRY) && page.includes('document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(collectGeometry)))'), 'measured once its fonts have loaded and two frames have drawn');
  assert.ok(page.includes('window.requestAnimationFrame = '), 'with frame callbacks run on a timer, as the colour check does');
  assert.doesNotThrow(() => new Function(COLLECT_GEOMETRY), 'the collector is valid script');
  assert.equal(dumpedGeometry('<html><body><main></main></body></html>'), null);
  const s = fine({ texts: [text('span', { text: '</script><b>' })] });
  const json = JSON.stringify(s).replace(/</g, '\\u003c');
  assert.deepEqual(dumpedGeometry(`<body><script type="application/json" id="acc-geometry">${json}</script></body>`), s, 'text from the page can\'t close the element');
});
