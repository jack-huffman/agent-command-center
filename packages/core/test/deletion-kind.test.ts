import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addPromotionSteps, stepsOf } from '../src/change-steps.ts';
import { DELETION_KIND } from '../src/deletion-kind.ts';
import type { Task } from '../src/ledger.ts';
import { OUTSIDE_KINDS } from '../src/outside-kinds.ts';
import { emptyOutside } from '../src/outside-changes.ts';
import { keepDeletions } from '../src/task-deploy.ts';

const AT = '2026-10-28T10:00:00.000Z';
const OLD = { path: 'force-app/main/default/classes/Old.cls', component: 'Apex Class: Old' };

test('a deletion is a registered kind of change outside git, in words and with a step a person makes in the org', () => {
  assert.equal(OUTSIDE_KINDS.deletion, DELETION_KIND);
  assert.equal(DELETION_KIND.words(OLD), 'Delete Apex Class: Old by hand');
  assert.match(DELETION_KIND.script(OLD, 'acme-uat')[0]!, /acme-uat.*Apex Class: Old/);
  assert.deepEqual(DELETION_KIND.problems({ component: ' ', path: 'x' }), ['Name the component it deletes.']);
});

test('a ticket deploy keeps each deletion as a step in the destination, beside its record changes, to mark done or skip', () => {
  const t = { id: 'ACME-1', outside: { ...emptyOutside(), changes: [{ id: 'c1', kind: 'record', detail: { object: 'Account', action: 'update', match: [{ field: 'Name', value: 'Acme' }], fields: [] }, why: 'w', planned: true, actor: 'builder' as const, by: 'builder:ACME-1', at: AT }] } } as unknown as Task;
  keepDeletions(t, [OLD], 'human:jordan', AT);
  addPromotionSteps(t, { branch: 'uat', org: 'acme-uat' }, AT);
  const steps = stepsOf(t, 'uat');
  assert.deepEqual(steps.map((s) => [s.change.kind, s.step.state]), [['record', 'todo'], ['deletion', 'todo']]);
  assert.equal(steps[1]!.words, 'Delete Apex Class: Old by hand');
  assert.equal(steps[1]!.change.id, 'c2', 'it takes the next number on the task');
});

test('edge case: a deploy to the next org keeps the deletion once, and adds its step there too; no deletions changes nothing', () => {
  const t = { id: 'ACME-1' } as unknown as Task;
  keepDeletions(t, [], 'human:jordan', AT);
  assert.equal(t.outside, undefined, 'nothing kept for a ticket that deletes nothing');
  keepDeletions(t, [OLD], 'human:jordan', AT);
  addPromotionSteps(t, { branch: 'uat', org: 'acme-uat' }, AT);
  keepDeletions(t, [OLD], 'human:jordan', AT);
  addPromotionSteps(t, { branch: 'main', org: 'acme-prod' }, AT);
  assert.equal(t.outside!.changes.length, 1);
  assert.deepEqual(stepsOf(t).map((s) => s.step.env), ['uat', 'main']);
});
