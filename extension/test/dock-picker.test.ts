// The output panel's run picker: "1 of 4" closed, the names in its list, the full name in its title (T-44).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickerName, pickerOf } from '../webview/looks.ts';
import { pageSource } from './support.ts';

const runs = [{ id: 'a', label: 'Run the checks', running: false }, { id: 'b', label: 'Start a background agent on a very long task name that goes on', running: true }, { id: 'c', label: 'Refresh', running: false }];

test('the picker reads "2 of 3" closed, so the run\'s name shows once, and its title gives the full name', () => {
  const closed = pickerOf(runs, 'b', false);
  assert.deepEqual(closed.options.map((o) => o.text), ['1 of 3', '2 of 3', '3 of 3']);
  assert.deepEqual(closed.options.filter((o) => o.selected).map((o) => o.id), ['b']);
  assert.equal(closed.title, runs[1]!.label, 'the title is not cut');
});

test('the picker\'s list names every run, cuts a long name, and marks a running one', () => {
  const open = pickerOf(runs, 'a', true);
  assert.deepEqual(open.options.map((o) => o.text), ['Run the checks', `● ${runs[1]!.label.slice(0, 36)}…`, 'Refresh']);
  assert.equal(pickerName('x'.repeat(36), false), 'x'.repeat(36), 'a name of 36 stays whole');
});

test('a selection that is not in the list falls back to the first run, and an empty list gives an empty picker (edge case)', () => {
  assert.equal(pickerOf(runs, 'gone', false).options[0]!.selected, true);
  assert.deepEqual(pickerOf([], 'a', false), { options: [], title: '' });
});

test('the panel draws the picker from the model, and no longer a separate count beside it', () => {
  const src = pageSource('dock.ts');
  assert.ok(src.includes('pickerOf(list, run.id, listing)'));
  assert.ok(src.includes("pick.addEventListener('mousedown', () => fill(true))"));
  assert.ok(!src.includes('dock-count'));
});
