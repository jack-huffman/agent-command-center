// Setup as a guided walkthrough (T-153): each step as its screen shows it (its instruction, why, its one action, why
// Next is off), the chapters, the place the folder keeps, and where each of the walk's buttons goes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { STEPS } from '../../packages/core/src/onboarding/steps.ts';
import type { DoctorItem } from '../src/logic/setup.ts';
import { setupModel, type SetupRow, setupStart } from '../src/model/setup.ts';
import { type Chapter, chapterLook, isWalkPlace, KIND_STEP, kindStep, mainAction, nextWhy, plainWhy, setupChapters, WALK_MODALS, WALK_STATE, WALK_TITLES, walkStep, type WalkPlace } from '../src/model/setup-walk.ts';
import { isFromWebview, MESSAGE_TYPES } from '../src/model/messages.ts';
import { after, back, before, begin, dotState, goTo, next, PASS_PAUSE_MS, placed, resume, skip, startButton, WALK_END, WALK_START, walkList, walkScreen } from '../webview/walk.ts';
import { SETUP_WALK_PAGES, sampleFirstSetup, sampleSetup, sampleStartingSetup, setupWalkState } from '../scripts/fixtures/setup.ts';
import { PAGES } from '../scripts/pages.ts';
import { root } from './support.ts';

const sample = () => { const s = sampleSetup(); return setupModel(s.items, s.confirmed); };
const ids = (xs: { step: { id: string } }[]) => xs.map((x) => x.step.id);
const row = (o: Partial<SetupRow>): SetupRow => ({ id: 'A1.gh', title: 'GitHub CLI', look: { label: 'To do', icon: 'warning', tone: 'orange' }, done: false, detail: 'gh isn\'t installed.', why: '', fix: null, does: null, actions: [], ...o });
const act = (command: string, label: string, primary = false) => ({ command, label, icon: 'x', ref: { step: 'A1.gh' }, ...(primary ? { primary } : {}) });

/** Three chapters of two steps: a done, b to do; c to do, d done; e and f to do. */
function chapters(done: string[] = ['a', 'd']): Chapter[] {
  const step = (id: string) => ({ ...walkStep(row({ id, title: id, done: done.includes(id) })), title: `Do ${id}` });
  return [['x', ['a', 'b']], ['y', ['c', 'd']], ['z', ['e', 'f']]].map(([key, steps]) => ({ key: `machine:${key}`, part: 'machine' as const, title: key as string, look: chapterLook(0), steps: (steps as string[]).map(step) }));
}

test('every step has an instruction for its screen, and none names a step that isn\'t there', () => {
  const missing = STEPS.filter((s) => !WALK_TITLES[s.id]).map((s) => s.id);
  assert.deepEqual(missing, [], 'a step with no instruction');
  assert.deepEqual(Object.keys(WALK_TITLES).filter((id) => !STEPS.some((s) => s.id === id)), []);
  assert.equal(Object.keys(WALK_TITLES).length, STEPS.length);
  assert.equal(walkStep(row({ id: 'X9.new', title: 'A step this build doesn\'t know' })).title, 'A step this build doesn\'t know', 'an unknown step keeps its name');
});

test('why is a sentence or two, without its citations or backticks, and an empty why stays empty', () => {
  assert.equal(plainWhy('Builders run as `claude --bg` sessions (D-009). The extension ships its own copy. A third sentence.'), 'Builders run as claude --bg sessions. The extension ships its own copy.');
  assert.equal(plainWhy('A Jira project, a monday.com board or GitHub Issues. If not, mark this done.'), 'A Jira project, a monday.com board or GitHub Issues. If not, mark this done.', 'a dot inside a word ends no sentence');
  assert.equal(plainWhy('Uses gh (GH-69, D-140).'), 'Uses gh.');
  assert.equal(plainWhy(''), '');
});

test('Next is off with why until the check passes, and on once it has', () => {
  assert.equal(nextWhy(row({ done: true })), null);
  assert.equal(nextWhy(row({})), 'Its check hasn\'t passed yet: do it, or skip it for now');
  assert.equal(nextWhy(row({ actions: [act('acc.step.confirm', 'I\'ve done this')] })), 'Its check can\'t see this: say you\'ve done it, or skip it for now');
  // Over the sample: every step still to do has a reason, and none that's done has one.
  const steps = sample().chapters.flatMap((c) => c.steps);
  assert.ok(steps.length > 40, `${steps.length} steps`);
  for (const s of steps) assert.equal(s.next === null, s.done, s.id);
});

test('each screen has one action: Do it, else I\'ve done this, else its own choice, never Guide or Report, and none once done', () => {
  const check = act('acc.step.check', 'Check');
  const guide = act('acc.openGuide', 'Guide');
  const report = act('acc.report', 'Report a problem');
  assert.equal(mainAction(row({ actions: [check, act('acc.step.fix', 'Do it', true), act('acc.step.confirm', 'I\'ve done this'), guide] }))?.label, 'Do it');
  assert.equal(mainAction(row({ actions: [check, act('acc.step.confirm', 'I\'ve done this'), guide] }))?.label, 'I\'ve done this');
  const open = mainAction(row({ actions: [check, act('acc.step.openSetup', 'Open in Salesforce'), guide, report] }));
  assert.deepEqual([open?.label, open?.primary], ['Open in Salesforce', true], 'the step\'s own choice, as the one primary');
  assert.equal(mainAction(row({ actions: [check, guide, report] })), null, 'only a check is left');
  assert.equal(mainAction(row({ done: true, actions: [check, act('acc.importRules', 'Import rules…')] })), null, 'a done step needs Next alone');
  const s = walkStep(row({ actions: [check, act('acc.step.fix', 'Do it', true), guide, report] }));
  assert.deepEqual([s.main?.label, s.check?.label, s.more.map((a) => [a.label, !!a.primary])], ['Do it', 'Check', [['Guide', false], ['Report a problem', false]]], 'the rest fold under Show how, none primary');
  // In the sample, each step to do has at most one primary action on its screen.
  for (const x of sample().chapters.flatMap((c) => c.steps)) assert.ok([x.main, ...x.more].filter((a) => a?.primary).length <= 1, x.id);
});

test('a step whose Do it opens a modal says so, and comes back to the walk; one without a modal says nothing', () => {
  const steps = sample().chapters.flatMap((c) => c.steps);
  assert.equal(steps.find((s) => s.id === 'B14.tickets')?.opens, 'Connect a tracker');
  assert.equal(steps.find((s) => s.id === 'A4.plugin')?.opens, null);
  assert.deepEqual(Object.values(WALK_MODALS), ['Set up cloud builders', 'Connect a tracker']);
  const cloud = walkStep(row({ id: 'B15.cloud-routine', actions: [act('acc.step.fix', 'Do it', true)] }));
  assert.equal(cloud.opens, 'Set up cloud builders');
  // The page draws it and keeps the walk where it is: nothing in the walk moves when the modal opens or closes.
  const page = readFileSync(join(root, 'webview', 'setup.ts'), 'utf8');
  assert.match(page, /Opens \$\{s\.opens\}, then comes back here\./);
});

test('the command line and the detail are kept for the closed fold, and the page draws them nowhere else', () => {
  const plugin = sample().chapters.flatMap((c) => c.steps).find((s) => s.id === 'A4.plugin')!;
  assert.match(plugin.fix ?? '', /^claude plugin marketplace add/);
  assert.match(plugin.detail, /isn't installed/);
  const page = readFileSync(join(root, 'webview', 'setup.ts'), 'utf8');
  // s.fix and s.detail as text appear only in howFold, which starts closed unless the tab remembers it opened.
  const fold = page.slice(page.indexOf('function howFold'), page.indexOf('function endScreen'));
  assert.equal((page.match(/el\('pre', 'fix', s\.fix\)/g) ?? []).length, 1);
  assert.ok(fold.includes("el('pre', 'fix', s.fix)") && fold.includes("el('p', 'detail', s.detail)"));
  assert.match(fold, /d\.open = memory\(\)\.opened\.includes\(key\);/);
});

test('the chapters are Setup\'s sections in order, each with its state, and a folder that isn\'t set up asks its kind first in The repo', () => {
  const m = sample();
  assert.deepEqual(m.chapters.filter((c) => c.part === 'machine').map((c) => c.title), ['Tools', 'Accounts', 'The Claude Code plugin']);
  const project = m.chapters.filter((c) => c.part === 'project').map((c) => c.title);
  for (const t of ['The repo', 'GitHub account', 'Client data and secrets', 'Environment branches', 'Safe defaults', 'Cloud builders']) assert.ok(project.includes(t), t);
  assert.deepEqual(project.slice(0, 3), ['The repo', 'Orgs', 'GitHub account']);
  assert.deepEqual(m.chapters.find((c) => c.title === 'Tools')?.look, { label: '1 to do', icon: 'warning', tone: 'orange' });
  assert.deepEqual(m.chapters.find((c) => c.title === 'Accounts')?.look, { label: 'Done', icon: 'pass', tone: 'blue' });
  assert.deepEqual(chapterLook(2), { label: '2 to do', icon: 'warning', tone: 'orange' });
  // Not set up: The repo, of the question alone, before the project's other chapters.
  const first = sampleFirstSetup(true);
  const fresh = setupModel(first.items, first.confirmed, first.setUp);
  const repo = fresh.chapters.find((c) => c.key === 'project:B0')!;
  assert.deepEqual([repo.steps.map((s) => [s.id, s.title, s.main?.label]), repo.look.label], [[[KIND_STEP, 'What kind of project is this?', 'Choose…']], '1 to do']);
  assert.equal(kindStep(setupStart()).next, 'Choose what kind of project this is first, or skip it for now');
  // A project being started (T-133) asks nothing more: its kind is chosen already.
  const starting = sampleStartingSetup();
  assert.equal(setupModel(starting.items, starting.confirmed, starting.setUp, starting.starting).chapters.some((c) => c.steps.some((s) => s.id === KIND_STEP)), false);
  // With nothing checked yet there are no chapters (the edge before the first result).
  assert.deepEqual(setupModel([], new Set()).chapters, []);
  assert.deepEqual(setupChapters({ parts: [], start: null, machineFirst: null }), []);
});

test('the walk shows one step at a time, in order, and never a step that is done', () => {
  const cs = chapters();
  const p = begin(cs);
  assert.deepEqual(p, { at: 'b', walk: ['b', 'c', 'e', 'f'], skipped: [] });
  const sc = walkScreen(cs, p);
  assert.equal(sc.kind === 'step' && sc.step.id, 'b');
  assert.equal(sc.kind === 'step' && `${sc.index + 1} of ${sc.list.length}`, '1 of 4');
  // Remembered at a step that has passed since: it moves on, and shows the next one still to do.
  const later = chapters(['a', 'b', 'd']);
  const moved = walkScreen(later, p);
  assert.equal(moved.kind === 'step' && moved.step.id, 'c');
  assert.equal(moved.kind === 'step' && moved.step.done, false);
  for (const at of ['a', 'b', 'c', 'd', 'e', 'f']) {
    const shown = walkScreen(later, { ...p, at });
    assert.ok(shown.kind !== 'step' || !shown.step.done, `at ${at}: ${shown.kind === 'step' ? shown.step.id : shown.kind}`);
  }
  // Every step done: the end, with nothing left.
  const all = chapters(['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(walkScreen(all, p), { kind: 'end', left: [] });
  // A step this build doesn't know: the first still to do.
  const unknown = walkScreen(cs, { ...p, at: 'gone' });
  assert.equal(unknown.kind === 'step' && unknown.step.id, 'b');
  // No place, or the start: the start screen.
  assert.deepEqual([walkScreen(cs, null).kind, walkScreen(cs, { ...p, at: WALK_START }).kind], ['start', 'start']);
});

test('a step that passes while on show stays a moment with its Done, then the walk moves on', () => {
  const p = begin(chapters());
  const passed = chapters(['a', 'b', 'd']);
  const held = walkScreen(passed, p, 'b');
  assert.deepEqual(held.kind === 'step' && [held.step.id, held.step.done, held.step.next], ['b', true, null], 'shown, done, Next on');
  assert.equal(held.kind === 'step' && `${held.index + 1} of ${held.list.length}`, '1 of 4');
  assert.equal(walkScreen(passed, p, 'c').kind === 'step' && (walkScreen(passed, p, 'c') as { step: { id: string } }).step.id, 'c', 'holding another step holds nothing here');
  assert.equal(PASS_PAUSE_MS, 1200);
  assert.deepEqual(next(passed, p, 'b'), { ...p, at: 'c' });
});

test('Next, Back and Skip for now go to the steps still to do, and Skip keeps the step for the end', () => {
  const cs = chapters();
  const p = begin(cs);
  assert.deepEqual([after(cs, 'b'), after(cs, 'c'), after(cs, 'f')], ['c', 'e', WALK_END]);
  assert.deepEqual([before(cs, 'c'), before(cs, 'b'), before(cs, WALK_END)], ['b', WALK_START, 'f']);
  assert.equal(back(cs, { ...p, at: 'c' }, 'c').at, 'b');
  const skipped = skip(cs, p, 'b');
  assert.deepEqual(skipped, { ...p, at: 'c', skipped: ['b'] });
  assert.deepEqual(skip(cs, skipped, 'b').skipped, ['b'], 'skipped twice, kept once');
  const end = skip(cs, skip(cs, skip(cs, skipped, 'c'), 'e'), 'f');
  const sc = walkScreen(cs, end);
  assert.deepEqual([sc.kind, sc.kind === 'end' && ids(sc.left), end.skipped], ['end', ['b', 'c', 'e', 'f'], ['b', 'c', 'e', 'f']]);
  // The dots: here, done, skipped, still to come.
  const list = walkList(chapters(['a', 'd', 'c']), { ...end, at: 'e' });
  assert.deepEqual(list.map((x) => dotState(x, end, 'e')), ['skipped', 'done', 'current', 'skipped']);
});

test('the start screen offers Start, then Continue where the person stopped, and Check again with nothing left', () => {
  const cs = chapters();
  assert.deepEqual(startButton(cs, null), { left: 4, button: 'start' });
  const p = { ...begin(cs), at: 'e' };
  assert.deepEqual(startButton(cs, p), { left: 4, button: 'continue' });
  assert.deepEqual(resume(cs, p), p, 'Continue goes back to where it was left');
  assert.equal(resume(chapters(['a', 'd', 'e']), p).at, 'f', 'that step passed since: the next one');
  assert.equal(resume(chapters(['a', 'd', 'e', 'f']), p).at, 'b', 'none after it: the first still to do, skipped or not');
  assert.equal(resume(cs, { ...p, at: WALK_END }).at, 'b', 'from the end screen: the first still to do');
  assert.deepEqual(resume(cs, null), begin(cs), 'no walk yet: Continue starts one');
  assert.deepEqual(startButton(chapters(['a', 'b', 'c', 'd', 'e', 'f']), p), { left: 0, button: 'check' });
  assert.deepEqual(startButton([], null), { left: 0, button: 'check' }, 'before the first check: nothing left to walk');
});

test('a chapter\'s step opens its screen, in the walk under way or a new one', () => {
  const cs = chapters();
  assert.deepEqual(goTo(cs, null, 'e'), { at: 'e', walk: ['b', 'c', 'e', 'f'], skipped: [] });
  const p = { at: 'b', walk: ['b'], skipped: ['b'] };
  assert.deepEqual(goTo(cs, p, 'f'), { at: 'f', walk: ['b', 'f'], skipped: ['b'] });
  assert.deepEqual(goTo(cs, p, 'b'), { ...p, at: 'b' });
  assert.deepEqual(ids(placed(cs)), ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('the folder keeps a place that fits, and refuses one that doesn\'t, as the page sends it', () => {
  const place: WalkPlace = { at: 'A1.gh', walk: ['A1.gh'], skipped: [] };
  assert.equal(isWalkPlace(place), true);
  for (const bad of [null, {}, { ...place, at: '' }, { ...place, walk: 'A1.gh' }, { ...place, skipped: [1] }, { ...place, walk: Array(201).fill('x') }]) assert.equal(isWalkPlace(bad), false, JSON.stringify(bad)?.slice(0, 60));
  assert.equal(isFromWebview({ type: 'setup-walk', place }), true);
  assert.equal(isFromWebview({ type: 'setup-walk', place: { at: 'x' } }), false);
  assert.ok(MESSAGE_TYPES.includes('setup-walk'));
  assert.equal(WALK_STATE, 'acc.setup.walk');
  assert.equal(sample().walk, null, 'none until one starts');
  assert.deepEqual(setupModel([], new Set(), true, null, place).walk, place);
});

test('the screenshot run draws the start screen, a step, a step with its fold open, a step that opens a modal, and the end', () => {
  assert.ok(PAGES.includes('setup'));
  for (const kind of SETUP_WALK_PAGES) assert.ok((PAGES as readonly string[]).includes(kind), kind);
  assert.deepEqual(SETUP_WALK_PAGES.map((k) => setupWalkState(k)?.setupWalk.at), ['B6.org-match', 'A4.plugin', 'B14.tickets', 'end']);
  assert.deepEqual(setupWalkState('setup-walk-how')?.opened, ['setup-how:A4.plugin']);
  assert.equal(setupWalkState('setup'), null);
});

test('the output panel\'s Open the step goes to the step\'s screen in the walk', () => {
  const view = readFileSync(join(root, 'webview', 'run-view.ts'), 'utf8');
  assert.match(view, /showSetupStep\(n\.step\)/);
  const page = readFileSync(join(root, 'webview', 'setup.ts'), 'utf8');
  assert.match(page, /export function showSetupStep\(id: string\): void \{\n {2}if \(drawn\) keep\(goTo\(drawn\.chapters, placeOf\(drawn\), id\)\);/);
});

test('the head keeps Refresh alone: the walkthroughs and Check this machine are in the command palette', () => {
  const page = readFileSync(join(root, 'webview', 'setup.ts'), 'utf8');
  assert.match(page, /header\('Setup', summary\)/);
  for (const c of ['acc.openMachineWalkthrough', 'acc.openProjectWalkthrough', 'acc.checkMachine']) assert.ok(!page.includes(c), c);
  const items: DoctorItem[] = [{ id: 'A1.gh', part: 'machine', title: 'GitHub CLI', status: 'fail', detail: '' }];
  assert.equal(setupModel(items, new Set()).chapters[0]?.steps[0]?.title, 'Install the GitHub CLI');
});
