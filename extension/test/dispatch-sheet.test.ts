// Dispatch's sheet (D-168): what it offers for a task, in rework, on a model that takes no effort and with
// the cloud off; and acc dispatch's arguments for what a person chose in it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUILDER_PLACE_LOOK } from '../../packages/core/src/cloud.ts';
import { effortDroppedWords } from '../../packages/core/src/efforts.ts';
import { dispatchModelItems } from '../src/logic/agents.ts';
import { dispatchEffortItems } from '../src/logic/efforts.ts';
import type { TaskRow } from '../src/logic/shared.ts';
import { sizeLine } from '../src/logic/tasks.ts';
import { cloudDisabled } from '../src/model/cards.ts';
import { area, defaultPlace, dispatchChoiceArgs, dispatchSheet, effortSegments, SHEET_COMMANDS, type SheetInput } from '../src/model/dispatch-sheet.ts';
import { pageDom } from './page-dom.ts';
import { pageSource, row } from './support.ts';

const CLOUD = { routine: 'trig_01ABCDEFGHJKLMNOPQRSTUVW', default: 'local' as const, quietMinutes: 120, max: 3 };
const ON = { github: { repo: 'o/r' }, agents: { cloud: CLOUD } };
const OFF = { github: { repo: 'o/r' }, agents: { cloud: null } };
const builder = (model = 'claude-opus-5-5', effort: string | null = null) => ({ model, effort, from: { model: 'project', effort: effort ? 'clone' : 'default' } });
const analysis = { verdict: 'ready' as const, at: '2026-10-16T09:00:00Z', open: [], split: [], size: 'M' as const };
const input = (r: Partial<TaskRow> = {}, more: Partial<SheetInput> = {}): SheetInput => ({
  project: '/r', row: { ...row('AV-9', 'todo', 'ready'), deps: [], ...r } as TaskRow, builder: builder(), config: ON, ...more,
});

test('the sheet for a task to do: its title, the builder\'s model chosen first with its source, its efforts lowest first, This Mac, and the size', () => {
  const i = input({ analysis });
  const s = dispatchSheet(i);
  assert.equal(s.title, 'Dispatch AV-9');
  assert.equal(s.go, 'Dispatch');
  assert.deepEqual(s.models.map((m) => m.value), dispatchModelItems(i.row, i.builder).map((m) => m.value), 'the models Dispatch with… offered, in its order');
  assert.deepEqual([s.models[0]!.label, s.models[0]!.about], ['claude-opus-5-5', 'project default'], 'the one the builder uses, and where it is set');
  const first = s.models[0]!;
  assert.deepEqual(first.efforts.map((e) => e.label), ['low', 'medium', 'high', 'xhigh', 'max'], 'lowest first, as a segmented control reads');
  assert.equal(first.efforts[first.effort]!.label, 'medium', 'the level it runs with anyway is chosen: Opus 5.5\'s default');
  assert.equal(first.efforts[first.effort]!.value, null, 'none named, so Claude Code\'s default applies');
  assert.equal(first.none, null);
  assert.deepEqual(s.places.map((p) => [p.value, p.label, p.icon, p.disabled]), [['local', BUILDER_PLACE_LOOK.local.label, 'device-desktop', undefined], ['cloud', BUILDER_PLACE_LOOK.cloud.label, 'cloud', undefined]]);
  assert.equal(s.place, 'local', 'the project\'s default');
  assert.equal(s.size, sizeLine(i.row));
  assert.equal(dispatchSheet(input()).size, null, 'no analysis: no size line');
  assert.equal(s.anyway, false);
  assert.equal(s.shares, null);
});

test('the sheet for a task in rework: Re-dispatch, and the model and effort picked for it before chosen first', () => {
  const s = dispatchSheet(input({ state: 'rework', display: 'rework', run: { model: 'claude-sonnet-5-5', modelPicked: true, effort: 'max', effortPicked: true } }, { builder: builder('claude-opus-5-5', 'low') }));
  assert.equal(s.title, 'Re-dispatch AV-9');
  assert.equal(s.go, 'Re-dispatch');
  assert.deepEqual([s.models[0]!.value, s.models[0]!.about], ['claude-sonnet-5-5', 'picked for this task']);
  const e = s.models[0]!.efforts;
  assert.deepEqual([e[s.models[0]!.effort]!.label, e[s.models[0]!.effort]!.value], ['max', 'max'], 'the pick is kept');
  const low = e.find((x) => x.label === 'low')!;
  assert.deepEqual([low.value, low.about], ['default', 'this clone. Drops max, picked for this task'], 'the builder\'s own drops the pick, and says so');
});

test('a model that takes no effort hides the levels, and says so, with the pick it drops', () => {
  const s = dispatchSheet(input({ run: { effort: 'xhigh', effortPicked: true } }, { builder: builder('claude-haiku-4-5-20251001') }));
  const haiku = s.models[0]!;
  assert.deepEqual(haiku.efforts, []);
  assert.equal(haiku.effort, -1);
  assert.equal(haiku.none, `claude-haiku-4-5-20251001 takes no effort level. ${effortDroppedWords('xhigh', 'claude-haiku-4-5-20251001')}`);
  assert.equal(dispatchSheet(input({}, { builder: builder('claude-haiku-4-5-20251001') })).models[0]!.none, 'claude-haiku-4-5-20251001 takes no effort level.', 'nothing picked: nothing dropped');
  assert.ok(s.models.slice(1).every((m) => m.efforts.length && m.none === null), 'the other models take levels');
  const another = s.models.at(-1)!;
  assert.equal(another.value, null, 'Another model… asks for a name');
  assert.deepEqual(another.efforts.map((e) => e.label), ['Default', 'low', 'medium', 'high', 'xhigh', 'max'], 'a model acc doesn\'t know takes every level, after Claude Code\'s default');
  assert.equal(another.efforts[another.effort]!.label, 'xhigh', 'the level picked for the task, which it takes');
});

test('the cloud is off with its reason where cloudDisabled gives one, and This Mac is chosen though the project\'s default is the cloud', () => {
  for (const config of [OFF, { github: null, agents: { cloud: CLOUD } }, { github: { repo: 'o/r' }, agents: { cloud: { ...CLOUD, routine: null } } }, null]) {
    const s = dispatchSheet(input({}, { config }));
    assert.equal(s.places[1]!.disabled, cloudDisabled(config), JSON.stringify(config));
    assert.ok(s.places[1]!.disabled, 'off, with a reason');
    assert.equal(s.places[0]!.disabled, undefined, 'This Mac is always on');
  }
  const cloudFirst = { github: { repo: 'o/r' }, agents: { cloud: { ...CLOUD, default: 'cloud' as const } } };
  assert.equal(dispatchSheet(input({}, { config: cloudFirst })).place, 'cloud', 'the project\'s default');
  assert.equal(dispatchSheet(input({}, { config: { ...cloudFirst, github: null } })).place, 'local', 'the default is the cloud, but it is off');
  assert.equal(dispatchSheet(input({}, { where: 'cloud' })).place, 'cloud', 'Dispatch to the cloud asks for it');
  assert.equal(dispatchSheet(input({}, { where: 'cloud', config: OFF })).place, 'local', 'asked for, but off');
});

test('Dispatch anyway opens the sheet with Dispatch anyway as its button, and the tasks and files it shares (D-093)', () => {
  const files = { known: true, shares: [{ task: 'AV-3', files: ['src/a.ts', 'src/b.ts'] }], first: [], held: { at: '2026-10-16T09:00:00Z', failed: null, byAutopilot: false } };
  const s = dispatchSheet(input({ files } as Partial<TaskRow>, { anyway: true }));
  assert.equal(s.go, 'Dispatch anyway');
  assert.deepEqual(s.shares, { message: 'Dispatch AV-9 anyway?', lines: [{ task: 'AV-3', files: 'src/a.ts, src/b.ts' }] });
  assert.equal(dispatchSheet(input({ files: { ...files, shares: [] } } as Partial<TaskRow>, { anyway: true })).shares, null, 'it shares nothing now: no list');
});

test('effort segments: lowest first, each label once with the task\'s pick winning, a non-level first, and none for no items', () => {
  const s = effortSegments([
    { label: 'max', description: 'picked for this task', value: 'max' },
    { label: 'max', description: 'this clone', detail: 'Drops max, picked for this task', value: 'default' },
    { label: 'low', description: 'Quickest', value: 'low' },
  ]);
  assert.deepEqual(s.efforts.map((e) => [e.label, e.value]), [['low', 'low'], ['max', 'max']]);
  assert.equal(s.chosen, 1);
  const d = effortSegments([{ label: 'Default', description: 'Claude Code\'s default', value: null }, { label: 'high', description: 'Thinks it through', value: 'high' }]);
  assert.deepEqual(d.efforts.map((e) => e.label), ['Default', 'high']);
  assert.equal(d.chosen, 0);
  assert.deepEqual(effortSegments([]), { efforts: [], chosen: -1 });
});

test('the defaults send no arguments; another model, effort and place each send theirs', () => {
  const i = input();
  const s = dispatchSheet(i);
  const first = s.models[0]!;
  const defaults = { model: first.value!, effort: first.efforts[first.effort]!.value, where: s.place };
  assert.deepEqual(dispatchChoiceArgs(i, defaults), { args: [], dropped: null });
  assert.deepEqual(dispatchChoiceArgs(i, { ...defaults, model: 'claude-sonnet-5-5', effort: null }).args, ['--model', 'claude-sonnet-5-5']);
  assert.deepEqual(dispatchChoiceArgs(i, { ...defaults, effort: 'high' }).args, ['--effort', 'high']);
  assert.deepEqual(dispatchChoiceArgs(i, { ...defaults, where: 'cloud' }).args, ['--cloud']);
  assert.deepEqual(dispatchChoiceArgs(i, { model: 'claude-fable-5-1', effort: 'max', where: 'cloud' }).args, ['--model', 'claude-fable-5-1', '--effort', 'max', '--cloud'], 'all three');
});

test('the arguments in rework, with the cloud as the project\'s default, and for a model that takes no effort', () => {
  // In rework with picks: the same picks again send nothing, as acc keeps them; dropping one says default.
  const rework = input({ state: 'rework', display: 'rework', run: { model: 'claude-sonnet-5-5', modelPicked: true, effort: 'max', effortPicked: true } }, { builder: builder('claude-opus-5-5', 'low') });
  assert.deepEqual(dispatchChoiceArgs(rework, { model: 'claude-sonnet-5-5', effort: 'max', where: 'local' }).args, []);
  assert.deepEqual(dispatchChoiceArgs(rework, { model: 'claude-sonnet-5-5', effort: 'default', where: 'local' }).args, ['--model', 'claude-sonnet-5-5', '--effort', 'default']);
  // The cloud first: This Mac is the place that sends an argument.
  const cloudFirst = input({}, { config: { github: { repo: 'o/r' }, agents: { cloud: { ...CLOUD, default: 'cloud' } } } });
  assert.equal(defaultPlace(cloudFirst.config), 'cloud');
  assert.deepEqual(dispatchChoiceArgs(cloudFirst, { model: 'claude-opus-5-5', effort: null, where: 'cloud' }).args, []);
  assert.deepEqual(dispatchChoiceArgs(cloudFirst, { model: 'claude-opus-5-5', effort: null, where: 'local' }).args, ['--local']);
  assert.equal(defaultPlace(null), 'local', 'no config: This Mac');
  // A model that takes no level drops the level picked for the task, and says which.
  const picked = input({ run: { effort: 'xhigh', effortPicked: true } });
  assert.deepEqual(dispatchChoiceArgs(picked, { model: 'claude-haiku-4-5-20251001', where: 'local' }), { args: ['--model', 'claude-haiku-4-5-20251001', '--effort', 'default'], dropped: effortDroppedWords('xhigh', 'claude-haiku-4-5-20251001') });
  // Another model, typed: its levels are acc's to check, every one offered.
  assert.deepEqual(dispatchChoiceArgs(input(), { model: 'opus', effort: 'low', where: 'local' }).args, ['--model', 'opus', '--effort', 'low']);
  assert.ok(dispatchEffortItems({}, builder(), 'opus').length > 0);
});

test('the page\'s go message is checked: a task key, a model, an effort the sheet offers and a place', () => {
  const ok = area.messages!['dispatch-sheet-go']!;
  const m = { project: '/r', task: 'AV-9', model: 'claude-opus-5-5', where: 'local' };
  assert.ok(ok(m), 'no effort: a model that takes none');
  assert.ok(ok({ ...m, effort: null }));
  assert.ok(ok({ ...m, effort: 'default', anyway: true }));
  assert.ok(!ok({ ...m, effort: 'turbo' }), 'not a level');
  assert.ok(!ok({ ...m, where: 'moon' }), 'not a place');
  assert.ok(!ok({ ...m, task: 'not a key' }));
  assert.ok(!ok({ ...m, model: '' }), 'an empty model');
  assert.ok(!ok({ ...m, anyway: 'yes' }));
  assert.deepEqual([...SHEET_COMMANDS], ['acc.task.dispatch', 'acc.task.dispatchWith', 'acc.task.dispatchCloud', 'acc.task.dispatchAnyway']);
});

test('focusedElement, run in a document: edge case: with only the body focused it gives null, and with a button focused it gives the button (T-71)', async () => {
  const page = pageDom();
  const { focusedElement } = await import('../webview/dom.ts');
  assert.equal(page.document.activeElement, page.document.body, 'the page starts with only its body focused');
  assert.equal(focusedElement(), null);
  const b = page.document.createElement('button');
  b.focus();
  assert.equal(focusedElement(), b);
  page.document.body.focus();
  assert.equal(focusedElement(), null, 'focus back on the body gives null again');
});

test('the sheet and the palette remember what opened them with the one focusedElement (T-70)', () => {
  for (const page of ['dispatch-sheet.ts', 'palette.ts']) {
    const src = pageSource(page);
    assert.match(src, /opener = focusedElement\(\);/, page);
    assert.ok(!src.includes('document.body ? a : null'), `${page} keeps no copy of its own`);
  }
});
