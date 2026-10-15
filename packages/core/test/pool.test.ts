// The shared test support's pool (T-57): the slow tests start their processes through it, so they run a few at
// once and still read their results in order.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pool, PoolError } from './support.ts';

const later = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A call that records how many calls are in flight, and the most there were. */
function watch() {
  const seen = { now: 0, most: 0, started: 0 };
  const fn = async (n: number) => {
    seen.now++;
    seen.started++;
    seen.most = Math.max(seen.most, seen.now);
    await later(5 + ((n * 7) % 11));
    seen.now--;
    return n * 2;
  };
  return { seen, fn };
}

test('the pool runs at most size calls at once, and as many as size when there are enough items', async () => {
  for (const size of [1, 2, 3, 5]) {
    const { seen, fn } = watch();
    await pool(Array.from({ length: 12 }, (_, i) => i), size, fn);
    assert.equal(seen.most, size, `size ${size}`);
    assert.equal(seen.started, 12, `size ${size} called every item`);
  }
});

test('the pool gives the results in the items\' order, though the calls finish in another order', async () => {
  const items = [30, 1, 20, 2, 10, 3];
  const finished: number[] = [];
  const out = await pool(items, 3, async (ms) => { await later(ms); finished.push(ms); return `r${ms}`; });
  assert.deepEqual(out, ['r30', 'r1', 'r20', 'r2', 'r10', 'r3']);
  assert.notDeepEqual(finished, items, 'they did finish out of order');
});

test('size defaults to 4', async () => {
  const { seen, fn } = watch();
  await pool(Array.from({ length: 12 }, (_, i) => i), undefined, fn);
  assert.equal(seen.most, 4);
});

test('the pool with no items gives no results and calls nothing', async () => {
  let called = 0;
  assert.deepEqual(await pool([], 4, () => { called++; }), []);
  assert.equal(called, 0);
});

test('the pool with one item calls it once, and passes its index', async () => {
  const { seen, fn } = watch();
  assert.deepEqual(await pool([21], 4, fn), [42]);
  assert.equal(seen.most, 1);
  assert.deepEqual(await pool(['a', 'b'], 1, (s, i) => `${s}${i}`), ['a0', 'b1']);
});

test('a call that throws makes the pool reject, naming its item, and no later item starts', async () => {
  const started: number[] = [];
  await assert.rejects(
    pool([1, 2, 3, 4, 5, 6, 7, 8], 2, async (n) => {
      started.push(n);
      await later(5);
      if (n === 3) throw new Error('boom');
      return n;
    }),
    (e: unknown) => e instanceof PoolError && e.index === 2 && e.item === 3 && /item 2 \(3\) failed: boom/.test(e.message),
  );
  assert.ok(started.length < 8, `stopped early after ${started.length} calls`);
});

test('a call that throws without waiting, and a rejection that is not an Error, are named too', async () => {
  await assert.rejects(pool(['x'], 4, () => { throw new Error('sync'); }), /item 0 \("x"\) failed: sync/);
  await assert.rejects(pool([{ id: 7 }], 4, () => Promise.reject('plain')), /item 0 \({"id":7}\) failed: plain/);
});

test('a size that is not a whole number of 1 or more is refused', async () => {
  for (const size of [0, -1, 1.5, NaN]) await assert.rejects(pool([1], size, (n) => n), RangeError, String(size));
});
