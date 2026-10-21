// Whole labels on a narrow card (T-94): as many labels as fit whole, at least one, and the rest in +N. The
// browser's half, measuring a drawn card, is the behaviour run's case "narrow card: …".
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fitLabels, foldedLabels, labelsThatFit } from '../webview/fit-labels.ts';
import { pageDom } from './page-dom.ts';

/** Five labels' widths at 13px, as the Azure sample's card draws them: service, history, premium, audit, reporting. */
const FIVE = [62, 60, 66, 50, 70];
const GAP = 4;
const PLUS = 26;

test('a card of five labels shows as many as fit whole at each width, and +N holds the rest', (t) => {
  // Room for all five, then each width one label fewer leaves room for, down to a 500 px page's card.
  const cases: [number, number][] = [[340, 5], [300, 4], [250, 3], [180, 2], [140, 1]];
  for (const [room, shown] of cases) {
    const fit = labelsThatFit(FIVE, room, GAP, PLUS);
    assert.equal(fit, shown, `${room}px`);
    const used = FIVE.slice(0, fit).reduce((a, w) => a + w, 0) + GAP * (fit - 1) + (fit < FIVE.length ? GAP + PLUS : 0);
    assert.ok(used <= room, `at ${room}px the ${fit} shown and +N take ${used}px`);
  }
  t.diagnostic(`checked ${cases.length} widths`);
});

test('edge case: a card too narrow for even one label still shows the first, and one with none shows none', () => {
  assert.equal(labelsThatFit(FIVE, 40, GAP, PLUS), 1);
  assert.equal(labelsThatFit(FIVE, 0, GAP, PLUS), 1);
  assert.equal(labelsThatFit([], 300, GAP, PLUS), 0);
  assert.equal(labelsThatFit([80], 60, GAP, PLUS), 1, 'one label alone, cut short');
});

test('edge case: the last label needs no room for +N, so it fits where +N would not', () => {
  // All five take 308 + 16 of gap: 324px fits them whole, though four and +N would need 280.
  assert.equal(labelsThatFit(FIVE, 324, GAP, PLUS), 5);
  assert.equal(labelsThatFit(FIVE, 323, GAP, PLUS), 4);
});

test('edge case: with no layout to measure, fitLabels shows the first labels it may and folds the rest, or hides the +N', () => {
  const { document } = pageDom();
  const make = (n: number) => ({ row: document.createElement('span'), chips: Array.from({ length: n }, () => document.createElement('span')), more: document.createElement('span') });
  const names = ['service', 'history', 'premium', 'audit', 'reporting'];
  const five = make(5);
  fitLabels(five.row as never, five.chips as never, five.more as never, names, 3);
  assert.deepEqual(five.chips.map((c) => c.hidden), [false, false, false, true, true]);
  assert.deepEqual([five.more.hidden, five.more.textContent, five.more.title], [false, '+2', 'audit, reporting']);
  const two = make(2);
  fitLabels(two.row as never, two.chips as never, two.more as never, names.slice(0, 2), 3);
  assert.deepEqual([two.chips.map((c) => c.hidden), two.more.hidden, two.more.title], [[false, false], true, ''], 'fewer than it may show: no +N');
});

test('the +N names each label it holds, in order, and is none when every label shows', () => {
  const names = ['service', 'history', 'premium', 'audit', 'reporting'];
  assert.deepEqual(foldedLabels(names, 1), { text: '+4', title: 'history, premium, audit, reporting' });
  assert.deepEqual(foldedLabels(names, 3), { text: '+2', title: 'audit, reporting' });
  assert.equal(foldedLabels(names, 5), null);
  assert.equal(foldedLabels([], 0), null, 'edge case: no labels');
});
