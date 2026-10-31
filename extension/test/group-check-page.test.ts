// In review's Check together and a task's group steps, drawn (T-165): the button on or off with why, the
// group's step while one runs, and every step under the task page's Details.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Look } from '../src/model/shared.ts';
import type { Together } from '../src/model/group-check.ts';
import { pageDom, type PageElement } from './page-dom.ts';

const page = pageDom();
const { groupRows, togetherBar } = await import('../webview/group-check.ts');

const on: Together = { env: 'dev', action: { command: 'acc.task.checkTogether', label: 'Check together (3)', icon: 'checklist', ref: { project: '/r', env: 'dev' } }, progress: null };
const step: Look = { label: 'Checking ACME-15 and ACME-20 together for Dev: running the full check', icon: 'sync~spin', tone: 'blue' };

test('Check together runs the command for its environment, and draws no step before a group runs', () => {
  const bar = togetherBar(on) as unknown as PageElement;
  const button = bar.all('btn')[0]! as PageElement & { click(): void; disabled: boolean };
  assert.match(button.textContent, /Check together \(3\)/);
  assert.equal(button.disabled, false);
  assert.equal(bar.all('together-step').length, 0);
  page.sent.length = 0;
  for (const f of button.listeners.get('click') ?? []) f({ stopPropagation() {} });
  assert.deepEqual(page.sent, [{ type: 'run', command: 'acc.task.checkTogether', ref: { project: '/r', env: 'dev' } }]);
});

test('off, it says why and sends nothing when clicked; a group under way shows its step', () => {
  const bar = togetherBar({ ...on, action: { ...on.action, disabled: 'A group check for Dev is under way. Wait for it to end.' }, progress: step }) as unknown as PageElement;
  const button = bar.all('btn')[0]! as PageElement & { disabled: boolean; title: string };
  assert.equal(button.disabled, true);
  assert.match(button.title, /under way/);
  page.sent.length = 0;
  for (const f of button.listeners.get('click') ?? []) f({ stopPropagation() {} });
  assert.deepEqual(page.sent, []);
  assert.match(bar.all('together-step')[0]!.textContent, /running the full check/);
});

test('a task never in a group check has no Checked together list; one that was lists every step', () => {
  assert.equal(groupRows([]), null);
  const rows = groupRows([step, { label: 'Checked with ACME-21: passed', icon: 'pass', tone: 'blue' }]) as unknown as PageElement;
  assert.equal(rows.all('group-row').length, 2);
  assert.match(rows.textContent, /Checked together/);
});
