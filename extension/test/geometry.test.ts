// The screenshot run's geometry checks (GH-105), on drawings made up to break one rule each, so a check
// that stopped looking can't pass. The run itself measures the real pages in Chrome: npm run screenshot.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { BOARD_TOP, COLLECT_GEOMETRY, drawnIn, dumpedGeometries, dumpedGeometry, MEASURE_TABS, mergedVerdict, type GeoControl, type GeoSnapshot, type GeoText, GEOMETRY_EXCEPTIONS, judge, judgeActions, judgeButtons, judgeCards, judgeDisabled, judgeSizes, SAME_ROW, SEED_FLOORS, type GeoSized, DISABLED_LOOK, REASON_BESIDE, OVERVIEW_LINES, RAW_OUTPUT, type Render, floorName, FLOORS_PATH, pageFloors, PER_DRAWING, raisedFloors, runFloor, runFailures, SIDEWAYS, storedFloor, FLOOR_MARGIN_PERCENT, ciFloorName, CI_FLOORS_ENV, isCiRun } from '../scripts/geometry.ts';
import { root } from './support.ts';
import { expectedButtons, pageFor, PAGES, sampleModel, STILL, viewOf } from '../scripts/screenshot.ts';

const control = (what: string, x: number, y: number, o: Partial<GeoControl> = {}): GeoControl => ({ what, text: what, box: { x, y, w: 80, h: 24 }, inside: [], layer: null, ...o });
const text = (what: string, o: Partial<GeoText> = {}): GeoText => ({ what, text: `${what}'s words`, over: 0, ellipsis: false, titled: false, folded: false, ...o });
const rail = { what: 'button.nav-item.on', box: { x: 10, y: 60, w: 200, h: 30 }, rail: { x: 0, y: 0, w: 232, h: 900 } };
/** A drawing that passes every check: two controls side by side, a text that fits, the tab on screen, nothing wide. */
const fine = (o: Partial<GeoSnapshot> = {}): GeoSnapshot => ({
  controls: [control('button.a', 0, 0), control('button.b', 100, 0)], texts: [text('span.a')], tab: rail, doc: { scroll: 1000, view: 1000 }, scrollers: [], said: [{ what: 'span.a', text: 'span.a\'s words', work: null }], a11y: { violations: [], examined: 3, incomplete: [] }, ...o,
});
const found = (s: GeoSnapshot, home = true) => judge(s, home, []).violations.map((v) => `${v.check}: ${v.what}: ${v.detail}`);

test('a drawing that breaks no rule passes, and says how much each check examined (GH-105)', () => {
  const v = judge(fine(), true, []);
  assert.deepEqual(v.violations, []);
  assert.deepEqual(v.examined, { overlap: 2, clipped: 1, tab: 1, sideways: 1, overview: 0, buttons: 0, words: 1, covered: 0, raw: 0, a11y: 3, actions: 0, disabled: 0, sizes: 0 });
});

test('the raw check (T-64): an output panel that draws a block of raw output, pre.dock-out as it did or any pre, fails; one drawn as rows passes; edge case: a page with no panel examines none', () => {
  const panel = (raw: string[]) => fine({ panels: [{ what: 'section.dock.open', raw }] });
  assert.deepEqual(found(panel([])), []);
  assert.equal(judge(panel([]), true, []).examined.raw, 1, 'each panel drawn is examined');
  assert.deepEqual(found(panel(['section.dock.open > pre.dock-out'])), ['raw: section.dock.open > pre.dock-out: the output panel shows a block of raw output, not rows']);
  assert.equal(found(panel(['div.dock-body > pre', 'div.dr > pre.tool-pre'])).length, 2, 'each block is a finding');
  assert.equal(judge(fine(), true, []).examined.raw, 0);
  assert.ok(runFailures([{ page: 'agents', theme: 'dark', width: 620, verdict: judge(fine(), true, []) }], true).some((f) => f.includes('for raw')), 'a whole run that drew no panel fails');
  assert.ok(runFloor().raw > 0, 'the floor is set');
  // The page gathers each panel and what in it matches the element the panel used for raw text.
  assert.deepEqual(RAW_OUTPUT.split(', '), ['.dock pre', '.dock .dock-out']);
  assert.ok(COLLECT_GEOMETRY.includes(`querySelectorAll(${JSON.stringify(RAW_OUTPUT)})`) && COLLECT_GEOMETRY.includes('panels'), 'the page reports its panels');
  // And the panel's code makes no such element.
  for (const f of ['dock.ts', 'run-view.ts', 'dock-review.ts']) assert.doesNotMatch(readFileSync(join(root, 'webview', f), 'utf8'), /el\('pre'|'dock-out'/, f);
});

test('the Overview\'s lines are each one line high, three in Needs you at most, with a gap between each (GH-160, T-36)', () => {
  const at = (y: number, h = 36) => ({ x: 0, y, w: 900, h });
  const list = (what: string, rows: { x: number; y: number; w: number; h: number }[]) => fine({ overview: { groups: [{ what, rows }] } });
  // Three lines of 32 px, 5 px apart: as the page draws them.
  const three = [0, 37, 74].map((y) => at(y, 32));
  assert.deepEqual(found(list('needs-you', three)), []);
  assert.equal(judge(list('needs-you', three), true, []).examined.overview, 3, 'each line is examined');
  assert.deepEqual(found(list('needs-you', [...three, at(111, 32)])), ['overview: needs-you: shows 4 lines, more than 3']);
  // A list a detail shows over the page holds every line, each still one line high.
  const five = [0, 42, 84, 126, 168].map((y) => at(y));
  assert.deepEqual(found(list('detail:progress', [...five, at(210)])), [], 'a detail\'s list isn\'t capped');
  assert.deepEqual(found(list('detail:progress', [at(0), at(42, 90)])), [`overview: detail:progress: line 2 is 90 px high, more than one line's ${OVERVIEW_LINES.maxHeight}`]);
  assert.deepEqual(found(list('needs-you', [at(0), at(42, 160)])), [`overview: needs-you: line 2 is 160 px high, more than one line's ${OVERVIEW_LINES.maxHeight}`], 'a question drawn in full is no line');
  assert.deepEqual(found(list('ready', [at(0), at(36), at(72)])), ['overview: ready: lines 1 and 2 are 0 px apart, less than 4', 'overview: ready: lines 2 and 3 are 0 px apart, less than 4'], 'rows that share one bar');
  assert.deepEqual(found(list('ready', [at(72), at(0), at(36)])).length, 2, 'measured in the order they\'re drawn down the page, not the order found');
  assert.deepEqual(found(fine({ overview: { groups: [{ what: 'a', rows: [at(0), at(42)] }, { what: 'b', rows: [at(44)] }] } })), [], 'a gap is between neighbours in one list');
  // The Overview with no lines has stopped being looked at; another page has nothing to measure.
  assert.deepEqual(found(fine({ overview: { groups: [] } })), ['overview: the page: is the Overview, and examined no lines or cards on it']);
  assert.deepEqual(found(fine({ overview: null })), []);
  assert.deepEqual(OVERVIEW_LINES, { maxHeight: 44, minGap: 4, maxRows: 3 }, 'pinned');
});

test('the Overview\'s cards line up in a grid: one out of line, of another width, height or column fails; an empty Needs you with cards is still looked at (T-36)', () => {
  const card = (what: string, x: number, y: number, w = 300, h = 64) => ({ what, box: { x, y, w, h } });
  const grid = [card('a', 0, 0), card('b', 312, 0), card('c', 624, 0), card('d', 0, 76), card('e', 312, 76)];
  const cards = (cs: ReturnType<typeof card>[]) => fine({ overview: { groups: [{ what: 'needs-you', rows: [] }], cards: cs } });
  assert.deepEqual(found(cards(grid)), [], 'three columns, two rows');
  assert.equal(judge(cards(grid), true, []).examined.overview, 5, 'each card is examined, with no lines');
  assert.deepEqual(judgeCards([]), [], 'no cards, nothing to line up');
  assert.deepEqual(judgeCards([card('a', 0, 0)]), [], 'one card lines up with itself');
  assert.deepEqual(judgeCards([...grid.slice(0, 4), card('e', 312, 76, 280)]), ['e is 280 px wide, not 300 as the first card is']);
  assert.deepEqual(judgeCards([...grid.slice(0, 4), card('e', 340, 76)]), ['e starts at 340 px, in none of the first row\'s columns']);
  assert.deepEqual(judgeCards([card('a', 0, 0), card('b', 312, 0, 300, 80)]), ['a is 64 px high, not as high as the cards beside it', 'b is 80 px high, not as high as the cards beside it']);
  assert.deepEqual(judgeCards([card('a', 0, 0), card('b', 312, 20)]), ['a is out of line with the cards beside it', 'b starts at 312 px, in none of the first row\'s columns', 'b is out of line with the cards beside it'], 'a card dropped 20 px below its row');
  // The run judges them: a page with a card out of its column fails the overview check.
  assert.deepEqual(found(cards([...grid.slice(0, 4), card('e', 340, 76)])), ['overview: the cards: e starts at 340 px, in none of the first row\'s columns']);
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
  assert.deepEqual(SIDEWAYS, ['.board', '.table-wrap', '.rail', '.doc pre', '.table-scroll', '.cpreview-cols'], 'the Connect modal\'s board scrolls sideways as the Tasks tab\'s does (T-140)');
});

test('a drawing that examined no controls or no text fails: an empty page can\'t pass (GH-105)', () => {
  assert.deepEqual(found({ controls: [], texts: [], tab: null, doc: { scroll: 0, view: 1000 }, scrollers: [] }, false), ['overlap: the page: examined no controls', 'clipped: the page: examined no text', 'words: the page: gathered no words', 'a11y: the page: axe examined no node, and the page wrote no a11y part']);
});

test('an exception excuses only its own check on what it names, and counts what it excused (GH-105)', () => {
  const exceptions = [{ name: 'the strip', check: 'sideways' as const, what: /^div\.strip$/, reason: 'made up' }];
  const s = fine({ scrollers: [{ what: 'div.strip', scroll: 960, client: 900, allowed: false }, { what: 'div.strip2', scroll: 960, client: 900, allowed: false }], texts: [text('div.strip', { over: 9 })] });
  const v = judge(s, true, exceptions, true, null, []);
  assert.deepEqual(v.violations.map((x) => `${x.check}: ${x.what}`), ['clipped: div.strip', 'sideways: div.strip2']);
  assert.deepEqual(v.excused, { 'the strip': 1 });
  for (const e of GEOMETRY_EXCEPTIONS) assert.ok(e.reason.length > 20, `${e.name} says why`);
});

test('a whole run fails below its floors, and on an exception that excused nothing; a run of a few pages doesn\'t (GH-105)', () => {
  const verdict = judge(fine(), true, []);
  const renders: Render[] = [{ page: 'tasks', theme: 'dark', width: 500, verdict: { ...verdict, violations: [{ check: 'overlap', what: 'button.a', detail: 'overlaps button.b' }] } }];
  const floor = { overlap: 10, clipped: 0, tab: 0, sideways: 0, overview: 0, buttons: 0, words: 0, covered: 0, raw: 0, a11y: 0, actions: 0, disabled: 0, sizes: 0 };
  const unused = [{ name: 'the strip', check: 'sideways' as const, what: /strip/, reason: 'made up' }];
  assert.deepEqual(runFailures(renders, false, unused, floor, [], []), ['tasks dark 500px: overlap: button.a: overlaps button.b']);
  assert.deepEqual(runFailures(renders, true, unused, floor, [], []), [
    'tasks dark 500px: overlap: button.a: overlaps button.b', 'The run examined 2 for overlap, below its floor of 10.', 'The exception for the strip excused nothing: take it off GEOMETRY_EXCEPTIONS.',
  ]);
  assert.deepEqual(runFailures([], false), ['No page was drawn.']);
  const drawings = PAGES.length * 2 * 3;
  const least = runFloor();
  assert.equal(least.overlap, 30 * drawings, 'a full run examines at least 30 controls a drawing');
  assert.equal(least.words, 100 * drawings, 'and reads at least 100 strings a drawing (GH-163)');
  assert.equal(least.tab, PAGES.filter((p) => viewOf(p) === 'home' && !STILL.includes(p)).length * 6, 'and the selected tab on every section, in every drawing, but the loading screen, which has no rail (T-16)');
});

test('the floors that follow the pages are worked out from them: a new page raises them, with no number set by hand (T-102)', () => {
  const one = pageFloors(['tasks']);
  assert.deepEqual(one, { overlap: PER_DRAWING.overlap * 6, words: PER_DRAWING.words * 6, tab: 6 });
  assert.deepEqual(pageFloors(['tasks', 'ticket', 'loading']), { overlap: 30 * 18, words: 100 * 18, tab: 6 }, 'a ticket and the loading screen have no rail to check');
  const more = pageFloors([...PAGES, 'tasks']);
  assert.deepEqual([more.overlap - pageFloors().overlap, more.tab - pageFloors().tab], [180, 6], 'one more page, six more drawings');
  assert.deepEqual(pageFloors([]), { overlap: 0, words: 0, tab: 0 }, 'an edge case: no pages, no floor');
});

test('every other check\'s floor is in the floors file, raised only by a clean whole run, and only up (T-102)', () => {
  const floors: Record<string, { floor: number }> = { tests: { floor: 5 }, ...Object.fromEntries(['clipped', 'sideways', 'overview', 'buttons', 'covered', 'raw', 'a11y', 'actions', 'disabled', 'sizes'].map((c) => [floorName(c as never), { floor: 10 }])) };
  assert.deepEqual(runFloor(floors, ['tasks']), { overlap: 180, clipped: 10, tab: 6, sideways: 10, overview: 10, buttons: 10, words: 600, covered: 10, raw: 10, a11y: 10, actions: 10, disabled: 10, sizes: 10 });
  const { 'screenshots.a11y': _gone, ...without } = floors;
  assert.throws(() => runFloor(without, ['tasks']), /\.acc\/floors\.json has no floor for the screenshot run's a11y check \("screenshots\.a11y"\)/, 'a missing floor is an error, never a floor of nothing');
  const examined = { overlap: 999, clipped: 12, tab: 6, sideways: 10, overview: 9, buttons: 10, words: 999, covered: 10, raw: 10, a11y: 40, actions: 10, disabled: 10, sizes: 10 };
  assert.deepEqual(raisedFloors(floors, examined), { ...floors, 'screenshots.clipped': { floor: 11 }, 'screenshots.a11y': { floor: 39 } }, 'the beaten ones rise, stored 1% below; a lower count leaves its floor; the page checks are never stored');
  assert.equal(raisedFloors(floors, { ...examined, clipped: 11, a11y: 10 }), null, 'an edge case: a count whose margin doesn\'t beat the floor writes nothing');
  // A person relaxed a11y to 8 (acc gate relax screenshots.a11y): the run reads that floor and passes at 9.
  const renders: Render[] = [{ page: 'tasks', theme: 'dark', width: 500, verdict: { ...judge(fine(), true, []), examined: { ...examined, overlap: 180, tab: 6, words: 600, overview: 10, a11y: 9 } } }];
  const relaxed = { ...floors, 'screenshots.a11y': { floor: 8, relaxed: { by: 'human:jordan', reason: 'a page went', at: '2026-10-22T09:00:00.000Z', was: 10 } } };
  assert.deepEqual(runFailures(renders, true, [], runFloor(floors, ['tasks']), [], []), ['The run examined 9 for a11y, below its floor of 10.']);
  assert.deepEqual(runFailures(renders, true, [], runFloor(relaxed, ['tasks']), [], []), [], 'relaxed, the lower count passes');
  const stored = JSON.parse(readFileSync(FLOORS_PATH, 'utf8')) as Record<string, unknown>;
  assert.deepEqual(Object.keys(stored).filter((k) => k.startsWith('screenshots.') && !k.startsWith('screenshots.ci.')).sort(), ['a11y', 'actions', 'buttons', 'clipped', 'covered', 'disabled', 'overview', 'raw', 'sideways', 'sizes'].map((c) => `screenshots.${c}`), 'the repo keeps each, and none for a page check');
});

test('a raised floor is stored about 1% below the clean run\'s count, so a later run 0.2% under that count passes and one 2% under fails; edge case: a count of 0 stores 0 (T-108)', () => {
  assert.equal(FLOOR_MARGIN_PERCENT, 1);
  assert.deepEqual([storedFloor(100000), storedFloor(445830), storedFloor(99), storedFloor(0)], [99000, 441371, 98, 0], 'rounded down');
  const floors: Record<string, { floor: number }> = Object.fromEntries(['clipped', 'sideways', 'overview', 'buttons', 'covered', 'raw', 'a11y', 'actions', 'disabled', 'sizes'].map((c) => [floorName(c as never), { floor: 10 }]));
  const examined = { overlap: 180, clipped: 10, tab: 6, sideways: 10, overview: 10, buttons: 10, words: 600, covered: 10, raw: 10, a11y: 100000, actions: 10, disabled: 10, sizes: 10 };
  const raised = raisedFloors(floors, examined);
  assert.deepEqual(raised?.[floorName('a11y')], { floor: 99000 });
  const floor = runFloor(raised!, ['tasks']);
  const run = (a11y: number): Render[] => [{ page: 'tasks', theme: 'dark', width: 500, verdict: { ...judge(fine(), true, []), examined: { ...examined, a11y } } }];
  // The clean run counted 100000 and stored 99000: a later run 0.2% under that count passes, one 2% under fails.
  assert.deepEqual(runFailures(run(99800), true, [], floor, [], []), [], '0.2% under passes');
  assert.deepEqual(runFailures(run(98000), true, [], floor, [], []), ['The run examined 98000 for a11y, below its floor of 99000.'], '2% under fails');
});

test('a CI run is held to its own floor where it has one, else the Mac\'s, and raises only its own; edge case: a Mac run never reads or raises a CI floor (T-108)', () => {
  const floors: Record<string, { floor: number }> = { ...Object.fromEntries(['clipped', 'sideways', 'overview', 'buttons', 'covered', 'raw', 'a11y', 'actions', 'disabled', 'sizes'].map((c) => [floorName(c as never), { floor: 10 }])), [ciFloorName('clipped')]: { floor: 7 } };
  assert.equal(ciFloorName('a11y'), 'screenshots.ci.a11y');
  assert.deepEqual([runFloor(floors, ['tasks'], true).clipped, runFloor(floors, ['tasks'], true).a11y], [7, 10], 'its own floor for clipped; the Mac\'s for a check with none');
  assert.equal(runFloor(floors, ['tasks'], false).clipped, 10, 'the Mac\'s run reads the Mac\'s floor');
  const examined = { overlap: 999, clipped: 9, tab: 6, sideways: 10, overview: 10, buttons: 10, words: 999, covered: 10, raw: 10, a11y: 40, actions: 10, disabled: 10, sizes: 10 };
  assert.deepEqual(raisedFloors(floors, examined, true), { ...floors, [ciFloorName('clipped')]: { floor: 8 } }, 'its own clipped floor rises; the Mac\'s a11y floor stays, and no CI floor is made for it');
  assert.deepEqual(raisedFloors(floors, { ...examined, clipped: 12 }, false), { ...floors, [floorName('clipped')]: { floor: 11 }, [floorName('a11y')]: { floor: 39 } }, 'a Mac run leaves the CI floor as it is');
  assert.equal(raisedFloors(floors, { ...examined, clipped: 7 }, true), null, 'nothing beaten, nothing written');
  assert.deepEqual([isCiRun({ [CI_FLOORS_ENV]: '1' }), isCiRun({}), isCiRun({ CI: 'true' })], [true, false, false], 'only the workflow\'s own setting makes a CI run');
});

test('a page measures its geometry only when the run asks, and the run reads it from the dumped page (GH-105)', () => {
  const model = sampleModel('agents');
  assert.ok(!pageFor('agents', 'dark', model).includes('collectGeometry'), 'a page drawn for the colour check doesn\'t measure');
  const page = pageFor('agents', 'dark', model, 'light', false, true);
  assert.ok(page.includes(COLLECT_GEOMETRY) && page.includes('document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => settle(selectedTab, requestAnimationFrame, () => collectGeometry(collectA11y, () => measureTabs((panel, then) => collectGeometry(() => collectA11y(panel), then, panel)))))))') && page.includes(MEASURE_TABS), 'measured once its fonts have loaded, two frames have drawn and the selected tab has settled (GH-167), then checked by axe (T-55), then each other tab of a task page (T-134)');
  assert.ok(page.includes('window.requestAnimationFrame = '), 'with frame callbacks run on a timer, as the colour check does');
  assert.doesNotThrow(() => new Function(COLLECT_GEOMETRY), 'the collector is valid script');
  assert.equal(dumpedGeometry('<html><body><main></main></body></html>'), null);
  const s = fine({ texts: [text('span', { text: '</script><b>' })] });
  const json = JSON.stringify(s).replace(/</g, '\\u003c');
  assert.deepEqual(dumpedGeometry(`<body><script type="application/json" id="acc-geometry">${json}</script></body>`), s, 'text from the page can\'t close the element');
});

test('a task page is measured once per tab it shows, and its drawing\'s verdict adds the measures up (T-134)', () => {
  const plain = fine({ texts: [text('span', { text: 'one' })] });
  const plan = { ...fine({ texts: [text('span', { text: 'two' }), text('span', { text: 'three', over: 4 })] }), panel: 'plan' };
  const dump = [plain, plan].map((x, i) => `<script type="application/json" id="acc-geometry${i ? `-${i}` : ''}">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`).join('');
  const shots = dumpedGeometries(`<body>${dump}</body>`);
  assert.deepEqual(shots, [plain, plan], 'every measure, in the order taken');
  assert.deepEqual(dumpedGeometries('<body></body>'), [], 'edge case: a page that never measured has none');
  const v = mergedVerdict(shots.map((x) => ({ panel: x.panel, verdict: judge(x, false) })));
  assert.equal(v.examined.clipped, 3, 'the texts of both panels are examined');
  assert.deepEqual(v.violations.map((x) => [x.check, x.what]), [['clipped', 'the plan tab: span']], 'a finding in another tab names it');
  const alone = judge(plain, false);
  assert.deepEqual(mergedVerdict([{ verdict: alone }]), alone, 'one measure is its own verdict');
  assert.throws(() => mergedVerdict([]), /no measure/, 'edge case: a drawing with no measure is never judged as passing');
});

test('edge case: MEASURE_TABS shows each other tab in turn, measures it, and brings back the tab and scroll on show', () => {
  const shown: string[] = [];
  const tab = (id: string, on: boolean) => ({ id, on, getAttribute: (a: string) => (a === 'aria-controls' ? `task-panel-${id}` : String(on)), click() { for (const t of tabs) t.on = t === this; shown.push(id); } });
  const tabs = [tab('ticket', false), tab('plan', true), tab('changes', false)];
  const root = { scrollTop: 120, scrollLeft: 0 };
  const document = { querySelectorAll: (q: string) => (q === '*' ? [] : tabs), scrollingElement: root, getElementById: (id: string) => ({ id }) };
  const measured: string[] = [];
  const within: string[] = [];
  const measure = (panel: { id: string }, then: () => void) => { measured.push(tabs.find((t) => t.on)!.id); within.push(panel.id); root.scrollTop = 0; then(); };
  new Function('document', 'requestAnimationFrame', 'measure', `${MEASURE_TABS}\nmeasureTabs(measure);`)(document, (f: () => void) => f(), measure);
  assert.deepEqual(measured, ['ticket', 'changes'], 'each tab not on show, measured once');
  assert.deepEqual(within, ['task-panel-ticket', 'task-panel-changes'], 'inside the panel its tab controls');
  assert.deepEqual(shown, ['ticket', 'changes', 'plan'], 'and the tab on show comes back last');
  assert.equal(root.scrollTop, 120, 'with its scroll');
  const none: string[] = [];
  new Function('document', 'requestAnimationFrame', 'measure', `${MEASURE_TABS}\nmeasureTabs(measure);`)({ querySelectorAll: () => [], scrollingElement: null }, (f: () => void) => f(), () => none.push('x'));
  assert.deepEqual(none, [], 'a page with no tabs is measured once, as drawn');
});

/** Runs the page's collector on a fake page, two buttons outside the tabs and one in a tab's panel, and returns the dump it writes. */
async function collectedOn(withinPanel: boolean): Promise<GeoSnapshot> {
  const button = (cls: string) => ({ tagName: 'BUTTON', className: `btn ${cls}`, classList: Object.assign(['btn', cls], { contains: () => false }), parentElement: null, textContent: cls, getAttribute: () => null, checkVisibility: () => true, matches: () => false, getBoundingClientRect: () => ({ left: 0, top: 0, right: 40, bottom: 20, width: 40, height: 20 }) });
  const outside = [button('notice'), button('side')];
  const inside = [button('in-panel')];
  const found = (els: unknown[]) => (q: string) => (q.startsWith('button') || q.startsWith('.btn:disabled') || q === '*' || q === 'body *' ? els : []);
  const written: { textContent?: string }[] = [];
  const panel = { classList: [], querySelectorAll: found(inside) };
  const document = {
    body: { querySelectorAll: () => [], append: (e: { textContent?: string }) => written.push(e) },
    documentElement: { clientWidth: 1000, scrollWidth: 1000 }, querySelectorAll: found([...outside, ...inside]), querySelector: () => null,
    createTreeWalker: () => ({ nextNode: () => null }), createRange: () => ({}), createElement: () => ({}),
  };
  new Function('document', 'window', 'getComputedStyle', 'NodeFilter', 'panel', `${COLLECT_GEOMETRY}\ncollectGeometry(null, undefined, panel);`)(document, { innerHeight: 900 }, () => ({}), { SHOW_TEXT: 4 }, withinPanel ? panel : null);
  for (let i = 0; i < 10 && !written.length; i++) await new Promise((r) => setTimeout(r, 0));
  assert.equal(written.length, 1, 'the dump is written once');
  return JSON.parse(written[0]!.textContent!) as GeoSnapshot;
}

test('edge case: a later measure of a tab\'s panel holds only what is inside it, so what is outside the tabs counts once per drawing (T-134)', async () => {
  const page = await collectedOn(false);
  const tab = await collectedOn(true);
  assert.deepEqual(page.controls.map((c) => c.text), ['notice', 'side', 'in-panel'], 'the page as drawn holds everything');
  assert.deepEqual(tab.controls.map((c) => c.text), ['in-panel'], 'the panel\'s measure holds only its own controls');
  assert.deepEqual(tab.disabled?.map((d) => d.text), ['in-panel'], 'and its own disabled buttons');
  assert.deepEqual([page.scoped, tab.scoped], [false, true]);
  const v = mergedVerdict([page, tab].map((x) => ({ panel: x.panel, verdict: judge(x, false) })));
  assert.equal(v.examined.overlap, 4, 'three as drawn, then the panel\'s one: the notices and side column once');
  assert.equal(v.examined.disabled, 4);
  assert.equal(judge(tab, false).examined.sideways, 0, 'the page itself is not counted again for sideways');
  assert.equal(judge(page, false).examined.sideways, 1);
  assert.deepEqual(judge(tab, true).violations.filter((x) => x.check === 'tab'), [], 'edge case: a task modal\'s panel over a home page needs no rail tab of its own');
  assert.equal(judge(page, true).violations.filter((x) => x.check === 'tab').length, 1, 'but the page as drawn still does');
});

test('the screenshots gate\'s drawn classes come from the first measure only, the one the PNG shows (T-134)', () => {
  const shot = { ...fine({}), drawn: ['task-tabs', 'task-panel-ticket', 'task-tabs'] };
  const hidden = { ...fine({}), drawn: ['task-panel-plan', 'plan-only'], panel: 'plan', scoped: true };
  assert.deepEqual(drawnIn([shot, hidden]), ['task-panel-ticket', 'task-tabs'], 'a tab shown for a moment and hidden again is not in the shot');
  assert.deepEqual(drawnIn([]), [], 'edge case: a drawing with no measure drew nothing');
  assert.deepEqual(drawnIn([fine({})]), [], 'edge case: a measure with no drawn list');
  assert.ok(readFileSync(join(root, 'scripts', 'screenshot.ts'), 'utf8').includes('drawn: drawnIn(shots)'), 'which is what the run records for the gate');
});

test('each Overview row button is named by its label as drawn: a missing or wrong aria-label fails (T-25)', () => {
  const expected = [{ row: 'Fix login', label: 'Open' }, { row: 'Add sum', label: 'Answer' }];
  assert.deepEqual(judgeButtons([{ row: 'Fix login', label: 'Open' }, { row: 'Add sum', label: 'Answer' }], expected), []);
  assert.deepEqual(judgeButtons([{ row: 'Fix login', label: null }], expected), ['the button on "Fix login" has no aria-label']);
  assert.deepEqual(judgeButtons([{ row: 'Fix login', label: '  ' }], expected), ['the button on "Fix login" has no aria-label'], 'an empty name is none');
  assert.deepEqual(judgeButtons([{ row: 'Fix login', label: 'Answer' }], expected), ['the button on "Fix login" is named "Answer", not "Open"']);
  assert.deepEqual(judgeButtons([{ row: 'Gone', label: 'Open' }], expected), ['the button on "Gone" is named "Open", not by any button in the model']);
  const drawn = fine({ overview: { groups: [{ what: 'needs-you', rows: [{ x: 0, y: 0, w: 900, h: 36 }] }] }, buttons: [{ row: 'Fix login', label: null }, { row: 'Add sum', label: 'Open' }] });
  const v = judge(drawn, true, [], true, expected);
  assert.deepEqual(v.violations.map((x) => `${x.check}: ${x.detail}`), ['buttons: the button on "Fix login" has no aria-label', 'buttons: the button on "Add sum" is named "Open", not "Answer"'], 'a drawn button that fails is found by judge');
  assert.equal(v.examined.buttons, 2, 'and each is counted');
});

test('the run fails when the Overview pages give no button to check, and counts the buttons it checked (T-25)', () => {
  const overview = fine({ overview: { groups: [{ what: 'needs-you', rows: [{ x: 0, y: 0, w: 900, h: 36 }] }] } });
  const none: Render[] = [{ page: 'overview', theme: 'dark', width: 1000, verdict: judge(overview, true, []) }];
  assert.deepEqual(runFailures(none, false), ['The Overview pages gave no row button to check.']);
  const some: Render[] = [{ page: 'overview', theme: 'dark', width: 1000, verdict: judge({ ...overview, buttons: [{ row: 'a', label: 'Open' }] }, true, []) }];
  assert.deepEqual(runFailures(some, false), []);
  assert.deepEqual(runFailures([{ page: 'tasks', theme: 'dark', width: 1000, verdict: judge(fine({ boardTop: BOARD_TOP.max }), true, []) }], false), [], 'a page that isn\'t the Overview has no buttons to find');
  assert.ok(runFloor().buttons > 0, 'a full run checks buttons');
});

test('the sample Overview models name a button for the rows that have one (T-25)', () => {
  const expected = expectedButtons(sampleModel('overview-landing'));
  assert.ok(expected && expected.length > 0 && expected.every((e) => e.row.trim() && e.label.trim()), 'a label for each');
  assert.equal(expectedButtons(sampleModel('ticket')), null, 'a page that isn\'t a section has none');
  assert.ok(COLLECT_GEOMETRY.includes('.lp-btn') && COLLECT_GEOMETRY.includes("getAttribute('aria-label')"), 'the page reports each button\'s aria-label');
});

test('the Tasks board\'s first column may start no lower than it does now at 1000 px, and an unmeasured board fails (T-42)', () => {
  const at = (boardTop: number | null, page = 'tasks', width = 1000): Render[] => [{ page, theme: 'light', width, verdict: judge(fine({ boardTop }), true, []) }];
  assert.deepEqual(runFailures(at(BOARD_TOP.max), false), [], 'at the ceiling it passes');
  assert.deepEqual(runFailures(at(BOARD_TOP.max + 1), false), [`tasks light 1000px: board: the first column starts ${BOARD_TOP.max + 1} px down, below ${BOARD_TOP.max}`]);
  assert.deepEqual(runFailures(at(null), false), ['tasks light 1000px: board: no tracker board\'s first column was measured'], 'nothing drawn is no pass');
  assert.deepEqual(runFailures(at(BOARD_TOP.max + 100, 'tasks', 620), false), [], 'only the 1000 px drawing is held to it');
  assert.ok(BOARD_TOP.max < 330, 'lower than the four rows and a warning it replaces');
  assert.ok(COLLECT_GEOMETRY.includes('boardTop'), 'the page measures it');
});

test('a sticky cell that covers another cell\'s text, whole or part, fails; one that doesn\'t, or an empty row, passes (T-46)', () => {
  const cell = (what: string, row: number, x: number, w: number, sticky = false, t = what) => ({ what, text: t, row, sticky, box: { x, y: row * 30, w, h: 24 } });
  const row = (x: number, w: number) => [cell('td.name', 0, 0, 200), cell('td.state', 0, x, w, false, 'Waiting for you'), cell('td.actions', 0, 880, 120, true, '')];
  const judged = (cells: ReturnType<typeof cell>[]) => judge(fine({ cells }), true, []);
  // The actions start at 880. State ends at 860: clear.
  assert.deepEqual(judged(row(700, 160)).violations, []);
  assert.equal(judged(row(700, 160)).examined.covered, 2, 'each cell that isn\'t sticky is examined');
  // The old Agents layout: State and Model did not wrap, so the row ran under the actions.
  assert.deepEqual(found(fine({ cells: row(800, 160) })), ['covered: td.state: "Waiting for you" is covered by the sticky td.actions'], 'part of the text under the cell');
  assert.equal(found(fine({ cells: row(900, 60) })).length, 1, 'all of the text under the cell');
  assert.deepEqual(found(fine({ cells: [cell('td.state', 1, 900, 60), cell('td.actions', 0, 880, 120, true, '')] })), [], 'the actions are in another row');
  assert.deepEqual(found(fine({ cells: [cell('td.state', 0, 900, 60)] })), [], 'no sticky cell in the row');
  assert.equal(judged([]).examined.covered, 0, 'a page without a sticky row examines none');
  assert.ok(runFailures([{ page: 'agents', theme: 'dark', width: 620, verdict: judged([]) }], true).some((f) => f.includes('for covered')), 'a whole run that examined none fails');
  assert.ok(runFloor().covered > 0, 'the floor is set');
  assert.ok(COLLECT_GEOMETRY.includes("position === 'sticky'") && COLLECT_GEOMETRY.includes('cells'), 'the page reports its cells at the first scroll position');
});

test('a task\'s actions are equal in height, the grid\'s equal in width, and the next step spans the grid, with each edge case (D-168)', () => {
  const b = (x: number, y: number, w: number, h = 30) => ({ x, y, w, h });
  const good = { what: 'div.task-actions', next: [b(0, 0, 300)], rest: [b(0, 36, 147), b(153, 36, 147), b(0, 72, 147)] };
  assert.deepEqual(judgeActions([good]), []);
  assert.deepEqual(judgeActions([{ ...good, rest: [b(0, 36, 147), b(153, 36, 147, 44)] }]).map((f) => f.detail), ['button 3 is 44 px high, not 30 as the first is'], 'a label that wrapped');
  assert.deepEqual(judgeActions([{ ...good, rest: [b(0, 36, 147), b(153, 36, 120)] }]).map((f) => f.detail), ['the grid\'s button 2 is 120 px wide, not 147 as the first is', 'the next step spans 0 to 300 px, not the grid\'s 0 to 273'], 'buttons that size to their labels');
  assert.deepEqual(judgeActions([{ ...good, next: [b(100, 0, 100)] }]).map((f) => f.detail), ['the next step spans 100 to 200 px, not the grid\'s 0 to 300'], 'a next step that isn\'t full width');
  assert.deepEqual(judgeActions([{ what: 'x', next: [b(0, 0, 300)], rest: [] }, { what: 'y', next: [], rest: [b(0, 0, 100), b(106, 0, 100)] }]), [], 'only a next step, or none: nothing to compare it to');
  assert.deepEqual(judgeActions([]), [], 'no actions on the page');
  // judge counts the buttons it measured, and a run that measured none on a task's page fails.
  const v = judge({ ...fine(), actionSets: [good] }, true, []);
  assert.equal(v.examined.actions, 4);
  assert.deepEqual(judge({ ...fine(), actionSets: [{ ...good, rest: [b(0, 36, 147), b(153, 36, 147, 40)] }] }, true, []).violations.map((x) => x.check), ['actions']);
  const none = judge(fine(), true, []);
  assert.ok(runFailures([{ page: 'ticket', theme: 'dark', width: 500, verdict: none }], false).includes('The task pages gave no action buttons to check.'));
  assert.ok(!runFailures([{ page: 'ticket', theme: 'dark', width: 500, verdict: v }], false).includes('The task pages gave no action buttons to check.'));
  assert.ok(COLLECT_GEOMETRY.includes('[data-action-set]') && COLLECT_GEOMETRY.includes("p.getAttribute('role') === 'menu'"), 'the page measures each set, and an open menu floats over the page');
});

test('the disabled check (T-121): a disabled button drawn as clear as an enabled one, or with another cursor, fails; the shared rule passes; edge case: a page with none examines none', () => {
  const d = (opacity: number, cursor: string) => ({ what: 'div > button.btn.primary', text: 'Post to GitHub', opacity, cursor, why: true });
  assert.deepEqual(judgeDisabled([d(0.45, DISABLED_LOOK.cursor)]), [], 'dimmed, not-allowed');
  assert.equal(judgeDisabled([d(1, DISABLED_LOOK.cursor)]).length, 1, 'drawn at full opacity');
  assert.equal(judgeDisabled([d(0.45, 'pointer')]).length, 1, 'the pointer cursor of an enabled button');
  assert.equal(judgeDisabled([d(1, 'pointer')]).length, 2, 'both wrong');
  assert.deepEqual(judgeDisabled([]), []);
  assert.equal(judgeDisabled([{ ...d(0.45, DISABLED_LOOK.cursor), why: false }]).length, 1, 'no title or description, and not named as beside its text');
  assert.equal(judgeDisabled([{ ...d(0.45, DISABLED_LOOK.cursor), why: false, text: Object.keys(REASON_BESIDE)[0] ?? 'x' }]).length, Object.keys(REASON_BESIDE).length ? 0 : 1, 'a named button may give its reason in the text beside it');
  assert.equal(judge(fine(), true, []).examined.disabled, 0, 'none drawn, none examined');
  const v = judge(fine({ disabled: [d(1, 'pointer')] }), true, []);
  assert.equal(v.examined.disabled, 1);
  assert.equal(v.violations.filter((x) => x.check === 'disabled').length, 2);
});

test('the shared disabled rule is in styles.css, and no other stylesheet gives .btn a rule of its own (T-121)', () => {
  const dir = join(root, 'webview');
  const css = readFileSync(join(dir, 'styles.css'), 'utf8');
  assert.match(css, /\.btn:disabled, \.btn\.is-disabled \{[^}]*opacity: 0\.45;[^}]*cursor: not-allowed/);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.css') && n !== 'styles.css')) {
    assert.doesNotMatch(readFileSync(join(dir, f), 'utf8'), /\.btn[\w.-]*:disabled|\.btn\.is-disabled/, `${f} has its own disabled button rule`);
  }
});

const sized = (what: string, text: string, x: number, h: number, o: Partial<GeoSized> = {}): GeoSized => ({ what, text, parent: 1, up: 0, box: { x, y: 10, w: 100, h }, font: 13, ...o });

test('the sizes check (T-144): two buttons side by side of one height pass, and a primary beside a small one fails, naming both; edge cases: none beside each other compares none, and a far or stacked pair is no row', () => {
  const same = judgeSizes([sized('button.btn.primary', 'Make a plan', 0, 29), sized('button.btn', 'Open conversation', 108, 29)]);
  assert.deepEqual(same, { found: [], compared: 1 });
  const mixed = judgeSizes([sized('button.btn.primary', 'Make a plan', 0, 29), sized('button.btn.small', 'Open conversation', 108, 19, { font: 10.5 })]);
  assert.equal(mixed.compared, 1);
  assert.equal(mixed.found.length, 1);
  assert.match(mixed.found[0]!.detail, /"Make a plan".*"Open conversation"/, 'it names both');
  assert.equal(judgeSizes([sized('a', 'A', 0, 29), sized('b', 'B', 108, 29 + SAME_ROW.heightDiff)]).found.length, 0, 'within 1 px passes');
  assert.equal(judgeSizes([sized('a', 'A', 0, 29), sized('b', 'B', 108, 29, { font: 11 })]).found.length, 1, 'one height with another type size fails');
  assert.deepEqual(judgeSizes([sized('a', 'A', 0, 29), sized('b', 'B', 100 + SAME_ROW.gap + 40, 19)]), { found: [], compared: 0 }, 'too far apart to be a row');
  assert.deepEqual(judgeSizes([sized('a', 'A', 0, 29), { ...sized('b', 'B', 108, 19), box: { x: 108, y: 60, w: 100, h: 19 } }]), { found: [], compared: 0 }, 'one under the other is not a row');
  assert.deepEqual(judgeSizes([sized('a', 'A', 0, 29), sized('b', 'B', 108, 19, { parent: 7, up: 8 })]), { found: [], compared: 0 }, 'another container, such as a dialog over the page');
  assert.equal(judgeSizes([sized('a', 'A', 0, 29, { parent: 1, up: 2 }), sized('b', 'B', 108, 19, { parent: 3, up: 1 })]).found.length, 1, 'across one wrapper, as the conversation line in the plan actions');
  assert.deepEqual(judgeSizes([]), { found: [], compared: 0 }, 'none drawn, none compared');
});

test('a row of mixed button sizes fails the run, and a whole run that compared no row fails on its floor (T-144)', () => {
  const drawn = (sized_: GeoSized[]) => judge(fine({ sized: sized_ }), true, []);
  const bad = drawn([sized('button.btn.primary', 'Deploy', 0, 29), sized('button.btn.ghost.small', 'Other', 108, 20, { font: 11.4 })]);
  assert.equal(bad.violations.filter((v) => v.check === 'sizes').length, 1);
  assert.equal(bad.examined.sizes, 1);
  assert.deepEqual(runFailures([{ page: 'ticket', theme: 'dark', width: 1000, verdict: bad }], false).filter((f) => f.includes('sizes')).length, 1, 'the run names its page, theme and width');
  assert.match(runFailures([{ page: 'ticket', theme: 'dark', width: 1000, verdict: drawn([]) }], true, [], { overlap: 0, clipped: 0, tab: 0, sideways: 0, overview: 0, buttons: 0, words: 0, covered: 0, raw: 0, a11y: 0, actions: 0, disabled: 0, sizes: SEED_FLOORS.sizes! }, [], []).join('\n'), /The run examined 0 for sizes, below its floor of 1/);
  assert.deepEqual(runFailures([{ page: 'ticket', theme: 'dark', width: 1000, verdict: drawn([sized('a', 'A', 0, 29), sized('b', 'B', 108, 29)]) }], true, [], { overlap: 0, clipped: 0, tab: 0, sideways: 0, overview: 0, buttons: 0, words: 0, covered: 0, raw: 0, a11y: 0, actions: 0, disabled: 0, sizes: SEED_FLOORS.sizes! }, [], []).filter((f) => f.includes('sizes')), []);
  assert.equal(SEED_FLOORS.sizes, 1, 'a floor of one row until the floors file holds its own');
  assert.ok(COLLECT_GEOMETRY.includes('parent: parents.get(b.parentElement), up: parents.get(up)'), 'the page measures each text button with its container');
});

test('the rows the sizes check found are fixed in the styles (T-144): the plan actions\' Open conversation, the deploy row\'s fold and the agent line\'s buttons', () => {
  const css = (f: string) => readFileSync(join(root, 'webview', f), 'utf8');
  assert.match(css('analysis.css'), /\.plan-actions > \.convo-line > \.btn, \.an-actions > \.convo-line > \.btn \{ padding: 3px 9px; font-size: calc\(1em \/ var\(--convo-scale\)\)/);
  assert.match(readFileSync(join(root, 'webview', 'changes.ts'), 'utf8'), /foldButton\('Other next steps', key, 'dp-more', true\)/);
  assert.match(css('agents.css'), /\.line-btn \{ min-height: 22px/);
});
