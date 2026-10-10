// The screenshot run under load (GH-167): a drawing that times out is drawn once more and counted, and a
// page measures the rail's selected tab only once it has stopped moving. Chrome isn't run here: the
// drawing is a stand-in that times out on cue, and the page's settle runs on frames the test steps.
import assert from 'node:assert/strict';
import test from 'node:test';
import { type Box, type GeoSnapshot, judge } from '../scripts/geometry.ts';
import { DEFAULT_SHOT_TIMEOUT, drawRetrying, retriedSummary, SETTLE, SETTLE_FRAMES, SETTLE_LIMIT, shotTimeout } from '../scripts/steady.ts';

const timeout = (): { error: Error } => ({ error: Object.assign(new Error('spawnSync nice ETIMEDOUT'), { code: 'ETIMEDOUT' }) });
/** A drawing that times out on the calls listed, and draws otherwise; how often it was called. */
function drawing(timesOutOn: number[]) {
  let calls = 0;
  return { draw: () => (timesOutOn.includes(++calls) ? timeout() : { error: undefined, stdout: 'drawn' }), calls: () => calls };
}

test('a drawing that times out once is drawn again, passes, and the retry is counted and said (GH-167)', () => {
  const d = drawing([1]);
  const retried: string[] = [];
  const said: string[] = [];
  const r = drawRetrying(d.draw, 'settings-about (dark, 620px)', retried, (l) => said.push(l));
  assert.equal(r.error, undefined);
  assert.equal(d.calls(), 2);
  assert.deepEqual(retried, ['settings-about (dark, 620px)']);
  assert.equal(said.length, 1, 'never silently');
  assert.match(said[0]!, /settings-about \(dark, 620px\).*drawn once more/);
  assert.equal(retriedSummary(retried), ' Retried 1 drawing that timed out: settings-about (dark, 620px).');
});

test('a drawing that times out twice fails as before, still counted as retried (GH-167)', () => {
  const d = drawing([1, 2]);
  const retried: string[] = [];
  const r = drawRetrying(d.draw, 'agents (light, 500px)', retried, () => {});
  assert.match(r.error!.message, /ETIMEDOUT/);
  assert.equal(d.calls(), 2, 'once more, no further');
  assert.deepEqual(retried, ['agents (light, 500px)']);
});

test('a drawing that passes, or fails for a reason other than time, is never drawn again (GH-167)', () => {
  const fine = drawing([]);
  const retried: string[] = [];
  assert.equal(drawRetrying(fine.draw, 'a', retried, () => {}).error, undefined);
  assert.equal(fine.calls(), 1);
  let calls = 0;
  const missing = () => { calls++; return { error: Object.assign(new Error('spawnSync nice ENOENT'), { code: 'ENOENT' }) }; };
  assert.match(drawRetrying(missing, 'b', retried, () => {}).error!.message, /ENOENT/);
  assert.equal(calls, 1);
  assert.deepEqual(retried, []);
  assert.equal(retriedSummary(retried), ' Retried no drawings.');
  assert.equal(retriedSummary(['a', 'b']), ' Retried 2 drawings that timed out: a; b.');
});

test('a drawing\'s time allowed is ACC_SHOT_TIMEOUT\'s seconds, else the default when it\'s unset or invalid (GH-167)', () => {
  assert.equal(shotTimeout({}), DEFAULT_SHOT_TIMEOUT * 1000);
  assert.equal(shotTimeout({ ACC_SHOT_TIMEOUT: '90' }), 90_000);
  assert.equal(shotTimeout({ ACC_SHOT_TIMEOUT: '0' }), DEFAULT_SHOT_TIMEOUT * 1000);
  assert.equal(shotTimeout({ ACC_SHOT_TIMEOUT: 'soon' }), DEFAULT_SHOT_TIMEOUT * 1000);
  assert.ok(DEFAULT_SHOT_TIMEOUT > 30, 'more than the 30 s that timed out under load');
});

type Settle = (read: () => string, frame: (cb: () => void) => void, done: () => void) => void;
const settle = new Function(`${SETTLE}; return settle;`)() as Settle;

/** Steps the page's settle over a tab at each box in turn, the last held; the box it was measured at and the frames it took. */
function measureTab(path: (Box | null)[]): { box: Box | null; frames: number } {
  let at = 0;
  let frames = 0;
  const out: { measured?: { box: Box | null; frames: number } } = {};
  const queue: (() => void)[] = [];
  const now = () => path[Math.min(at, path.length - 1)]!;
  settle(() => JSON.stringify(now() ?? ''), (cb) => queue.push(cb), () => { out.measured = { box: now(), frames }; });
  while (queue.length) { at++; frames++; queue.shift()!(); }
  assert.ok(out.measured, 'the page measured');
  return out.measured;
}

const rail: Box = { x: 0, y: 0, w: 500, h: 46 };
const snapshot = (box: Box): GeoSnapshot => ({ controls: [{ what: 'button.a', text: 'a', box: { x: 0, y: 0, w: 80, h: 24 }, inside: [], layer: null }], texts: [{ what: 'span', text: 'words', over: 0, ellipsis: false, titled: false, folded: false }], tab: { what: 'button.nav-item.on', box, rail }, doc: { scroll: 500, view: 500 }, scrollers: [], said: [{ what: 'span', text: 'words', work: null }] });
const tabFound = (box: Box) => judge(snapshot(box), true, []).violations.filter((v) => v.check === 'tab');

test('a tab still scrolling into view isn\'t judged until it has settled, and then passes (GH-167)', () => {
  // Past the strip's edge, then scrolled back over three frames, as the rail's showSelected does.
  const path = [{ x: 560, y: 8, w: 110, h: 30 }, { x: 520, y: 8, w: 110, h: 30 }, { x: 450, y: 8, w: 110, h: 30 }, { x: 378, y: 8, w: 110, h: 30 }];
  assert.equal(tabFound(path[0]!).length, 1, 'measured at once, it would fail');
  const m = measureTab(path);
  assert.deepEqual(m.box, path.at(-1));
  assert.equal(m.frames, path.length - 1 + SETTLE_FRAMES, 'measured once it held still for SETTLE_FRAMES frames');
  assert.deepEqual(tabFound(m.box!), []);
});

test('a tab genuinely outside the rail still fails once settled, and one that never settles is measured where it is (GH-167)', () => {
  const outside = { x: 560, y: 8, w: 110, h: 30 };
  const m = measureTab([outside]);
  assert.equal(m.frames, SETTLE_FRAMES);
  assert.deepEqual(tabFound(m.box!).map((v) => v.detail), ['the selected tab is outside the rail\'s visible part']);
  const jitter = Array.from({ length: SETTLE_LIMIT * 2 }, (_, i) => ({ x: 560 + (i % 2), y: 8, w: 110, h: 30 }));
  const never = measureTab(jitter);
  assert.equal(never.frames, SETTLE_LIMIT, 'gives up waiting, and measures');
  assert.equal(tabFound(never.box!).length, 1);
});

test('a page with no selected tab doesn\'t wait past its first frames (GH-167)', () => {
  const m = measureTab([null]);
  assert.equal(m.box, null);
  assert.equal(m.frames, SETTLE_FRAMES);
});
