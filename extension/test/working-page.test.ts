// T-147 on the page: a pressed action's button shows it's working from the click until the extension answers,
// one state for a card's next step, its ⋯ menu and a task page's buttons; a cancel puts it back, a refusal says why
// on the card, and a task Clean up removed leaves Done for its closed Cleaned up fold on the answer alone.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Action } from '../src/model/shared.ts';
import type { RanMessage } from '../src/logic/ran.ts';
import { tasksModel } from '../src/model/tasks.ts';
import { sampleHub } from '../scripts/fixtures/hub.ts';
import { type PageElement, pageDom } from './page-dom.ts';

const page = pageDom();
let kept: Record<string, unknown> = {};
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => kept, setState: (s: Record<string, unknown>) => { kept = s; } });
const { cleaned, cleanedKey, dress, dressMenu, heard, press, refusal, runKey, underWay, working, area } = await import('../webview/working.ts');
const isWorking = (a: Action): boolean => !!working.what(runKey(a.command, a.ref));
const { actionTile, taskActions } = await import('../webview/task-actions.ts');
const { moreMenu } = await import('../webview/boards.ts');
const { cleanedFold, cleanedLabel, doneFoldKey, withCleaned } = await import('../webview/done-fold.ts');
const { rememberedFold } = await import('../webview/dom.ts');
const { state } = await import('../webview/state.ts');
let draws = 0;
state.draw = () => { draws++; };
state.last = { kind: 'home' } as unknown as typeof state.last;

const ROOT = '/Users/me/code/acme-service';
const cleanUp: Action = { command: 'acc.task.cleanup', label: 'Clean up', icon: 'trash', ref: { project: ROOT, task: 'ACME-10' }, primary: true };
const answer = (phase: RanMessage['phase'], more: Partial<RanMessage> = {}): RanMessage => ({ type: 'ran', command: cleanUp.command, ref: cleanUp.ref, phase, ...more });
const click = (b: PageElement): void => { for (const f of b.listeners.get('click') ?? []) f({ stopPropagation() {} }); };
const label = (b: PageElement): string => b.textContent;
const spinning = (b: PageElement): boolean => (b.children[0] as PageElement).className.includes('codicon-sync') && (b.children[0] as PageElement).className.includes('codicon-modifier-spin');

/** How a button looks: its words, busy, not to be pressed, spinning, and its title. */
const looks = (b: PageElement) => [label(b), b.getAttribute('aria-busy'), b.getAttribute('aria-disabled'), spinning(b), b.title];

test('a pressed action shows it\'s working at once, where it is, until the extension answers: spinning, its action under way, busy and not to be pressed again', () => {
  page.sent.length = 0;
  const before = draws;
  const b = actionTile(cleanUp, true) as unknown as PageElement;
  page.document.body.append(b);
  const idle = looks(b);
  assert.deepEqual(idle.slice(0, 4), ['Clean up', null, null, false], 'as built: nothing on its way');
  click(b);
  assert.deepEqual(page.sent, [{ type: 'run', command: 'acc.task.cleanup', ref: cleanUp.ref }], 'it sent the action');
  assert.deepEqual(looks(b), ['Cleaning up…', 'true', 'true', true, 'Cleaning up…'], 'the same button, at once');
  assert.equal(b.disabled, false, 'it keeps focus: a disabled button would drop it');
  assert.equal(draws, before, 'nothing else on the page is drawn again');
  // A redraw while it waits draws it working too.
  assert.deepEqual(looks(actionTile(cleanUp, true) as unknown as PageElement), looks(b));
  assert.equal(isWorking(cleanUp), true);
  // A second press, or click, while it's on its way sends nothing.
  press(cleanUp);
  click(b);
  assert.equal(page.sent.length, 1);
  // The confirmation opened: the extension's first word puts the button back, as it was built.
  heard(answer('asked'));
  assert.deepEqual([looks(b), isWorking(cleanUp)], [idle, false]);
  // A yes: working again until the result.
  heard(answer('running'));
  assert.equal(label(b), 'Cleaning up…');
  heard(answer('done', { ok: true, cleaned: true }));
  assert.equal(isWorking(cleanUp), false);
  assert.ok(cleaned.has(cleanedKey(ROOT, 'ACME-10')), 'acc removed it: the board moves it on this answer');
  assert.equal(draws, before + 1, 'a card that moves draws the page again');
  cleaned.clear();
  page.document.body.replaceChildren();
});

test('edge cases: a cancel puts the button back with no error; a refusal says why on the card until it\'s tried again; an answer to nothing pressed changes nothing', () => {
  press(cleanUp);
  heard(answer('asked'));
  heard(answer('done', { ok: true }));
  assert.deepEqual([isWorking(cleanUp), refusal([cleanUp])], [false, null], 'cancelled: back as it was');
  press(cleanUp);
  heard(answer('asked'));
  heard(answer('running'));
  heard(answer('done', { ok: false, error: 'Kept the worktree: The worktree has 2 uncommitted change(s).' }));
  const why = refusal([cleanUp]) as unknown as PageElement;
  assert.equal(why.textContent, 'Kept the worktree: The worktree has 2 uncommitted change(s).');
  assert.ok(why.classList.contains('conflict'), 'in orange, with its icon');
  assert.ok(!cleaned.has(cleanedKey(ROOT, 'ACME-10')), 'a refused cleanup leaves the card in Done');
  press(cleanUp);
  assert.equal(refusal([cleanUp]), null, 'tried again: the old reason goes');
  heard(answer('done', { ok: false }));
  assert.match((refusal([cleanUp]) as unknown as PageElement).textContent, /didn't say why/);
  // An answer for an action no button sent: nothing changes, nothing is drawn.
  const before = draws;
  heard({ type: 'ran', command: 'acc.task.block', ref: { project: ROOT, task: 'ACME-9' }, phase: 'done', ok: false, error: 'no' });
  assert.deepEqual([draws, refusal([{ command: 'acc.task.block', ref: { project: ROOT, task: 'ACME-9' } }])], [before, null]);
  working.settle(runKey(cleanUp.command, cleanUp.ref), null);
});

test('one state for every place: the ⋯ menu\'s item and its button, a task page\'s set, and the words each action shows', () => {
  const block: Action = { command: 'acc.task.block', label: 'Block', icon: 'circle-slash', ref: { project: ROOT, task: 'ACME-17' } };
  const menu = moreMenu('card:x', 'ACME-17', [block]) as unknown as PageElement;
  const item = menu.querySelector('.more-item')!;
  click(item);
  assert.deepEqual(page.sent.at(-1), { type: 'run', command: 'acc.task.block', ref: block.ref }, 'a pick from ⋯ sends the action');
  const again = moreMenu('card:x', 'ACME-17', [block]) as unknown as PageElement;
  const btn = again.querySelector('.more-btn')!;
  assert.deepEqual([btn.getAttribute('aria-busy'), btn.title, spinning(btn), btn.disabled, btn.getAttribute('aria-label')], ['true', 'Blocking…', true, false, 'Blocking… More actions for ACME-17'], '⋯ says what is under way and still opens');
  assert.deepEqual([again.querySelector('.more-item')!.getAttribute('aria-disabled'), again.querySelector('.more-item')!.textContent], ['true', 'Blocking…']);
  // A menu with its own handling, as the output panel's, is left alone.
  const own = moreMenu('dock:x', 'a run', [block], () => {}) as unknown as PageElement;
  assert.equal(own.querySelector('.more-btn')!.getAttribute('aria-busy'), null);
  // The task page's set: its buttons work the same way, and its refusal sits under them.
  const set = taskActions([{ ...block, primary: true }]) as unknown as PageElement;
  assert.equal(set.querySelector('.ta-btn')!.textContent, 'Blocking…');
  heard({ type: 'ran', command: block.command, ref: block.ref, phase: 'done', ok: false, error: 'It is running.' });
  assert.equal((taskActions([block]) as unknown as PageElement).querySelector('.run-refused')!.textContent, 'It is running.');
  assert.deepEqual([underWay('acc.task.cleanup'), underWay('acc.task.show')], ['Cleaning up…', 'Working…']);
  assert.equal(runKey(cleanUp.command, cleanUp.ref), JSON.stringify(['acc.task.cleanup', ROOT, 'ACME-10', '', '', '', '', '']), 'the key the screenshot run starts ACME-10 working by');
  assert.notEqual(runKey('acc.task.show', { project: ROOT, task: 'ACME-1' }), runKey('acc.task.show', { project: ROOT, task: 'ACME-1', part: 'plan' }), 'Answer and Details are two actions');
  // dress on a button with no icon first, and nothing on its way: its words are left as they are.
  const plain = page.document.createElement('button');
  plain.append('Go');
  assert.equal(dress(plain as never, { command: 'acc.task.show', ref: {} }), plain as never);
  assert.deepEqual([plain.textContent, plain.getAttribute('aria-busy')], ['Go', null]);
  // A ⋯ whose actions are all idle says nothing more than its name.
  const idle = dressMenu(page.document.createElement('button') as never, [{ command: 'acc.task.show', ref: { task: 'ACME-2' } }], 'ACME-2') as unknown as PageElement;
  assert.deepEqual([idle.getAttribute('aria-label'), idle.getAttribute('aria-busy')], ['More actions for ACME-2', null]);
  working.start(runKey('acc.task.watch', {}), 'waiting');
  assert.equal(area.receive!.ran, heard as never, 'the page hears the extension\'s answers here');
});

test('Done shows the tasks still to clean up, and the cleaned-up ones under a closed Cleaned up fold; one Clean up removed moves there on the answer alone', () => {
  const hub = sampleHub(Date.parse('2026-10-27T12:00:00Z'));
  const m = tasksModel(hub, () => [], 'jordan');
  const p = m.projects[0]!;
  const done = p.columns.find((c) => c.group === 'done')!;
  assert.ok(done.cards.length >= 1 && (done.cleaned?.length ?? 0) >= 2, `the sample has both: ${done.cards.length} in the lane, ${done.cleaned?.length} cleaned up`);
  const still = done.cards[0]!.id;
  // As the model sends it: the lane as it is, and nothing moved.
  assert.deepEqual(withCleaned(done, p.root, cleaned), { cards: done.cards, cleaned: done.cleaned });
  const fold = cleanedFold(p.root, done.cleaned!.map(() => page.document.createElement('article') as never)) as unknown as PageElement & { open: boolean };
  assert.equal(fold.open, false, 'closed until opened');
  assert.equal(fold.querySelector('summary')!.textContent, cleanedLabel(done.cleaned!.length));
  assert.equal(fold.querySelector('.done-fold-cards')!.children.length, done.cleaned!.length);
  // The extension says Clean up removed its worktree: before any new model, it moves into the fold, first.
  cleaned.add(cleanedKey(p.root, still));
  const moved = withCleaned(done, p.root, cleaned);
  assert.deepEqual([moved.cards.length, moved.cleaned.length, moved.cleaned[0]!.id], [done.cards.length - 1, done.cleaned!.length + 1, still]);
  // The model catches up: it holds the card in the fold itself, and the page forgets its own note.
  const caught = withCleaned({ cards: [], cleaned: [done.cards[0]!] }, p.root, cleaned);
  assert.deepEqual([caught.cards, caught.cleaned.map((c) => c.id), cleaned.size], [[], [still], 0]);
});

test('edge cases: a fold with nothing in it isn\'t drawn, it opens as the tab remembers, and a lane with no fold yet moves nothing', () => {
  assert.equal(cleanedFold(ROOT, []), null);
  kept = { opened: [doneFoldKey(ROOT)] };
  const d = cleanedFold(ROOT, [page.document.createElement('article') as never]) as unknown as { open: boolean };
  assert.equal(d.open, true, 'opened before: open now');
  kept = {};
  const f = rememberedFold('done-fold', 'k', ['x']) as unknown as PageElement & { open: boolean };
  assert.equal(f.open, false);
  (f as unknown as { open: boolean }).open = true;
  for (const g of f.listeners.get('toggle') ?? []) g({});
  assert.deepEqual((kept as { opened: string[] }).opened, ['k'], 'opening it is remembered');
  assert.deepEqual(withCleaned({ cards: [], cleaned: undefined }, ROOT, new Set()), { cards: [], cleaned: [] }, 'a lane with no fold yet');
});
