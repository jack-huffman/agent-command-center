// The Tasks tab's board switch (T-127): which board is on show, the row of buttons up to three boards, the one
// list past them, grouped by site with a box to find a board past five, a board that can't be read still on it,
// All boards folded, Add a board, and the header following the board on show. The checks for D-205's reading of
// the switch are here: choice-limit.test.ts names this file.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tasksModel } from '../src/model/tasks.ts';
import { boardName, boardsShowing, withBoards } from '../src/model/boards.ts';
import { sampleSeveralBoards } from '../scripts/fixtures/boards.ts';
import { addAnother as extensionAddAnother } from '../src/logic/connect.ts';
import { sampleHub } from '../scripts/fixtures/hub.ts';
import { type PageElement, pageDom } from './page-dom.ts';

const page = pageDom();
let kept: Record<string, unknown> = {};
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { page.sent.push(m); }, getState: () => kept, setState: (s: Record<string, unknown>) => { kept = s; } });
const { addAnother, boardChoice, boardCounts, boardEdits, boardOpen, boardSwitch, FILTER_FROM, SEGMENTED_MOST, switchGroups, tellShown, toggleBoard } = await import('../webview/board-switch.ts');
const { renderTasks } = await import('../webview/tasks.ts');
const { state } = await import('../webview/state.ts');
let draws = 0;
state.draw = () => { draws++; };
// Something drawn before, so a choice draws the page again.
state.last = { kind: 'home' } as unknown as typeof state.last;

const ROOT = '/Users/me/code/acme-service';
const model = (n: 2 | 4 | 10) => {
  const hub = sampleHub(Date.parse('2026-10-27T12:00:00Z'));
  return tasksModel(hub, (root) => (root === ROOT ? sampleSeveralBoards(n) : []), 'jordan');
};
/**
 * The Tasks tab drawn in this small document. Each board's columns are left out, with its counts kept from the model:
 * a board's keys need a browser (the behaviour run's), and the switch, the header and the folds need none.
 */
const drawn = (n: 2 | 4 | 10, change: (m: ReturnType<typeof model>) => void = () => undefined, columns = false): PageElement => {
  const m = model(n);
  change(m);
  if (!columns) for (const p of m.projects) p.boards = p.boards.map((b) => ({ ...b, columns: [] }));
  const out = page.document.createElement('div');
  out.append(...(renderTasks(m) as unknown as PageElement[]));
  return out;
};
const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}` }));

test('the board on show is the one kept while it\'s there, else the first; All boards only in the list form', () => {
  assert.equal(boardChoice(ids(2), undefined), 'board:b0', 'nothing kept: the first board');
  assert.equal(boardChoice(ids(2), 'board:b1'), 'board:b1');
  assert.equal(boardChoice(ids(2), 'board:gone'), 'board:b0', 'edge case: a board taken out falls back to the first');
  assert.equal(boardChoice(ids(2), 'tracker'), 'board:b0', 'edge case: an older tab\'s "tracker" is the first board');
  assert.equal(boardChoice(ids(2), 'agents'), 'agents');
  assert.equal(boardChoice(ids(SEGMENTED_MOST), 'all'), 'board:b0', 'edge case: All boards kept, then boards removed to three: the first board');
  assert.equal(boardChoice(ids(SEGMENTED_MOST + 1), 'all'), 'all');
  assert.equal(boardChoice([], 'board:b0'), 'agents', 'edge case: no board left: My work');
});

test('the list groups boards by site in the order they come, and what\'s typed finds a board by its name or site', () => {
  const boards = [{ name: 'A', group: 'acme', title: 'Jira · ACME' }, { name: 'G', group: 'globex', title: 'Jira · GLX' }, { name: 'Renewals', group: 'acme', title: 'Jira · ACME' }];
  assert.deepEqual(switchGroups(boards, '').map((g) => [g.group, g.boards.map((b) => b.name)]), [['acme', ['A', 'Renewals']], ['globex', ['G']]]);
  assert.deepEqual(switchGroups(boards, ' RENEW ').map((g) => g.boards.map((b) => b.name)), [['Renewals']], 'by name, any case');
  assert.deepEqual(switchGroups(boards, 'glob').map((g) => g.group), ['globex'], 'by site');
  assert.deepEqual(switchGroups(boards, 'nothing'), [], 'edge case: nothing found');
});

test('a board\'s counts on the list: its tickets and how many need you, Reading… before its first read, or why it can\'t be read', () => {
  assert.deepEqual(boardCounts({ tickets: 12, needs: 2, error: null, loading: false, columns: [] }), { text: '12 tickets · 2 need you', failed: false });
  assert.deepEqual(boardCounts({ tickets: 1, needs: 1, error: null, loading: false, columns: [] }), { text: '1 ticket · 1 needs you', failed: false });
  assert.deepEqual(boardCounts({ tickets: 0, needs: 0, error: null, loading: true, columns: [] }), { text: 'Reading…', failed: false }, 'edge case: before its first read');
  assert.deepEqual(boardCounts({ tickets: 0, needs: 0, error: 'Sign in to Jira (initech.atlassian.net).', loading: false, columns: [] }), { text: 'Sign in to Jira (initech.atlassian.net).', failed: true });
});

test('two boards: a row of buttons, each board by its name and My work, with no radio group; a click keeps the choice for the project', () => {
  kept = {};
  const out = drawn(2);
  const seg = out.all('board-switch')[0]!;
  assert.equal(seg.getAttribute('aria-label'), 'Which board');
  assert.deepEqual(seg.all('seg').map((b) => [b.textContent, b.getAttribute('aria-pressed')]), [['epic ACME-3 Premium Support', 'true'], ['Renewals', 'false'], ['My work', 'false']]);
  assert.equal(out.all().filter((e) => e.getAttribute('role') === 'menuitemradio').length, 0, 'no radio group up to SEGMENTED_MOST boards');
  assert.match(out.textContent, /Acme Service: 20 tickets on epic ACME-3 Premium Support\./);
  assert.equal(out.all('tracker').length, 1, 'one board at a time');
  seg.all('seg')[1]!.click();
  assert.equal((kept.modes as Record<string, string>)[ROOT], 'board:b-acme-renewals');
  const again = drawn(2);
  assert.match(again.textContent, /5 tickets on Renewals\./, 'the header counts the board on show');
  assert.equal(again.all('tracker')[0]!.all().find((e) => e.tagName === 'H2')!.textContent, 'Renewals');
  assert.ok(page.sent.some((m) => JSON.stringify(m) === JSON.stringify({ type: 'board-shown', project: ROOT, board: 'b-acme-renewals' })), 'the extension is told, so it reads that board first');
  const told = page.sent.length;
  drawn(2);
  assert.equal(page.sent.filter((m) => (m as { type: string }).type === 'board-shown').length, page.sent.slice(0, told).filter((m) => (m as { type: string }).type === 'board-shown').length, 'edge case: a redraw on the same board tells it nothing again');
});

test('Add a board on the toolbar opens the Connect page to add another board to this project', () => {
  kept = {};
  const add = drawn(2).all('btn').find((b) => b.textContent === 'Add a board')!;
  const before = page.sent.length;
  add.click();
  assert.deepEqual(page.sent.slice(before), [{ type: 'toolbar', command: 'acc.trackers.add', arg: JSON.stringify({ root: ROOT, add: true }) }]);
  // The page's copy (D-121) and the extension's, which a saved board's Add another board sends, give one argument.
  for (const root of [ROOT, '', 'C:\\code\\acme "x"']) assert.equal(addAnother(root), extensionAddAnother(root), `edge case: ${JSON.stringify(root)}`);
});

test('four boards: one button names the board on show and opens a list with My work, All boards and each site\'s boards; no box to find one', () => {
  kept = {};
  const out = drawn(4);
  assert.equal(out.all('segmented').length, 0);
  const btn = out.all('board-switch-btn')[0]!;
  assert.equal(btn.getAttribute('aria-label'), 'Board on show: epic ACME-3 Premium Support. Choose another');
  const menu = out.all('board-menu')[0]!;
  assert.equal(menu.hidden, true, 'closed until clicked');
  btn.click();
  assert.equal(menu.hidden, false);
  assert.equal(out.all('board-find').length, 0, `no box with ${FILTER_FROM} boards or fewer`);
  const items = menu.all('board-item');
  assert.deepEqual(items.map((i) => i.all('board-item-name')[0]!.textContent), ['My work', 'All boards', 'epic ACME-3 Premium Support', 'Renewals', 'Issues · acme/tool', 'epic GLX-2 Partner portal']);
  assert.ok(items.every((i) => i.getAttribute('role') === 'menuitemradio'));
  assert.deepEqual(menu.all('board-group').map((g) => g.getAttribute('aria-label')), ['acme.atlassian.net', 'GitHub', 'globex.atlassian.net']);
  items[1]!.click();
  assert.equal((kept.modes as Record<string, string>)[ROOT], 'all');
});

test('ten boards: the list finds a board by typing, and a board on a site that isn\'t signed in says why in orange, and still switches', () => {
  kept = {};
  const out = drawn(10);
  const find = out.all('board-find')[0]!;
  assert.equal(find.getAttribute('aria-label'), 'Find a board');
  (find as unknown as { value: string }).value = 'initech';
  for (const f of find.listeners.get('input') ?? []) f({});
  const items = out.all('board-menu')[0]!.all('board-item');
  assert.deepEqual(items.map((i) => i.all('board-item-name')[0]!.textContent), ['ERP sync', 'epic INI-7 HR onboarding'], 'My work and All boards step aside while a board is found');
  const note = items[0]!.all('board-item-note')[0]!;
  assert.ok(note.classList.contains('tone-orange'));
  assert.match(note.textContent, /Sign in to Jira \(initech\.atlassian\.net\)/);
  assert.ok(items[0]!.all('codicon-warning').length || items[0]!.children.some((c) => typeof c !== 'string' && /warning/.test(c.className)), 'an orange warning icon, not its kind\'s');
  items[0]!.click();
  const shown = drawn(10);
  assert.match(shown.textContent, /ERP sync can't be read now\./, 'the header says it can\'t be read, not that it holds nothing');
  assert.ok(shown.all('btn').some((b) => b.textContent === 'Sign in to Jira'), 'its Sign in is there to use');
  (find as unknown as { value: string }).value = 'zzz';
  for (const f of find.listeners.get('input') ?? []) f({});
  assert.match(out.all('board-menu')[0]!.textContent, /No board's name has “zzz” in it\./, 'edge case: nothing found says so');
});

test('All boards: each board folded to a button with its name and counts, opened on a click, and the header counts a shared ticket once', () => {
  kept = { modes: { [ROOT]: 'all' }, opened: [] };
  const out = drawn(10);
  const folds = out.all('board-fold');
  assert.equal(folds.length, 10);
  assert.ok(folds.every((f) => f.getAttribute('aria-expanded') === 'false'));
  assert.ok(!/This board has no columns/.test(out.textContent), 'folded, no board draws its body');
  assert.match(out.textContent, /on 10 boards/);
  const before = draws;
  folds[1]!.click();
  assert.equal(draws, before + 1);
  assert.deepEqual(kept.opened, [`board-open:${ROOT}#b-acme-renewals`]);
  const opened = drawn(10);
  assert.equal(opened.all('board-fold')[1]!.getAttribute('aria-expanded'), 'true');
  assert.equal(opened.textContent.match(/This board has no columns/g)?.length, 1, 'only the opened board draws its body');
  // ACME-12 is on both of acme's first two boards: one task, needing you once.
  const m = model(2).projects[0]!;
  const both = boardsShowing(m.boards).get('ACME-12');
  assert.deepEqual(both, ['epic ACME-3 Premium Support', 'Renewals']);
  // The header's number, with the boards' columns in place (folded, none draws its body): each key once.
  const boards = model(10).projects[0]!.boards;
  const sum = boards.reduce((n, b) => n + b.tickets, 0);
  const keys = new Set(boards.flatMap((b) => b.columns.flatMap((c) => c.cards.map((x) => x.key.toUpperCase())))).size;
  assert.ok(keys < sum, 'the sample has a ticket on two boards');
  kept = { modes: { [ROOT]: 'all' }, opened: [] };
  assert.match(drawn(10, () => undefined, true).textContent, new RegExp(`Acme Service: ${keys} tickets on 10 boards`), `${keys}, not ${sum}`);
});

test('edge case: two boards in the very same place, differing only by name, each show by its own id, and the switch picks each', () => {
  // The ids the extension gives such a pair (boardIds): the later one adds its place in the list.
  const twin = (m: ReturnType<typeof model>) => {
    const p = m.projects[0]!;
    p.boards = [p.boards[0]!, { ...p.boards[0]!, id: `${p.boards[0]!.id}-1`, name: 'Support twin' }];
  };
  kept = {};
  const out = drawn(2, twin);
  const segs = out.all('board-switch')[0]!.all('seg');
  assert.deepEqual(segs.map((b) => [b.textContent, b.getAttribute('aria-pressed')]), [['epic ACME-3 Premium Support', 'true'], ['Support twin', 'false'], ['My work', 'false']], 'one on show, never both');
  segs[1]!.click();
  const second = drawn(2, twin);
  assert.deepEqual(second.all('board-switch')[0]!.all('seg').map((b) => b.getAttribute('aria-pressed')), ['false', 'true', 'false']);
  assert.equal(second.all('tracker').length, 1, 'the twin alone, not both');
  assert.match(second.textContent, /on Support twin\./);
  second.all('board-switch')[0]!.all('seg')[0]!.click();
  assert.match(drawn(2, twin).textContent, /on epic ACME-3 Premium Support\./, 'and back to the first');
});

test('a board\'s name: its own, else its narrower place, else its tracker\'s board, else its tracker and project', () => {
  const board = { title: 'ACME board' };
  assert.equal(boardName({ name: ' Mine ', narrowed: true, place: 'Jira · ACME · epic ACME-3 X', title: 'Jira · ACME', board }), 'Mine');
  assert.equal(boardName({ name: null, narrowed: true, place: 'Jira · ACME · epic ACME-3 X', title: 'Jira · ACME', board }), 'epic ACME-3 X');
  assert.equal(boardName({ name: '', narrowed: false, place: 'Jira · ACME', title: 'Jira · ACME', board }), 'ACME board', 'edge case: an empty name is the tracker\'s');
  assert.equal(boardName({ name: null, narrowed: false, place: null, title: 'Jira · ACME', board: null }), 'Jira · ACME', 'edge case: before it\'s read');
});

test('what needs you on the Overview names the board its ticket is on, after its project', () => {
  assert.equal(withBoards('Acme · blocked', 'Acme', ['Renewals']), 'Acme · on Renewals · blocked');
  assert.equal(withBoards('blocked', 'Acme', ['A', 'B']), 'on A or B · blocked', 'edge case: a detail that doesn\'t start with its project');
});

test('boardSwitch draws either form from the boards alone, any kind; tellShown tells once per change; toggleBoard opens and folds a board', () => {
  kept = {};
  const kinds = (k: string) => `kind-${k}`;
  const two = boardSwitch('/p', model(2).projects[0]!.boards, 'agents', kinds) as unknown as PageElement;
  assert.deepEqual(two.all('seg').map((b) => b.getAttribute('aria-pressed')), ['false', 'false', 'true'], 'My work on show');
  // A kind this module has never heard of, as T-128's queue will be: drawn the same, with the icon it's given.
  const odd = model(4).projects[0]!.boards.map((b) => ({ ...b, kind: 'queue' as never }));
  const list = boardSwitch('/p', odd, `board:${odd[2]!.id}`, kinds) as unknown as PageElement;
  assert.equal(list.all('board-switch-btn')[0]!.getAttribute('aria-label'), `Board on show: ${odd[2]!.name}. Choose another`);
  assert.ok(list.all().some((e) => e.className.includes('kind-queue')), 'the kind\'s icon comes from the caller');
  const sent = () => page.sent.filter((m) => (m as { type: string; project: string }).type === 'board-shown' && (m as { project: string }).project === '/q').length;
  tellShown('/q', 'board:x');
  tellShown('/q', 'board:x');
  assert.equal(sent(), 1, 'the same board twice tells once');
  tellShown('/q', 'all');
  assert.equal((page.sent.at(-1) as { board: string | null }).board, null, 'edge case: All boards tells none, so no board jumps the queue');
  assert.equal(boardOpen('/q', 'x'), false);
  toggleBoard('/q', 'x');
  assert.equal(boardOpen('/q', 'x'), true);
  toggleBoard('/q', 'x');
  assert.equal(boardOpen('/q', 'x'), false, 'a second click folds it again');
});

test('the list ends with Change the board on show and Add a board, each opening the Connect modal, and none while a search is typed (T-140)', () => {
  const edits = boardEdits(ROOT, { index: 2, name: 'Renewals' }) as unknown as PageElement[];
  assert.deepEqual(edits.map((b) => b.textContent), ['Change Renewals…', 'Add a board…']);
  page.sent.length = 0;
  for (const b of edits) b.click();
  assert.deepEqual(page.sent, [
    { type: 'toolbar', command: 'acc.trackers.add', arg: JSON.stringify({ root: ROOT, index: 2 }) },
    { type: 'toolbar', command: 'acc.trackers.add', arg: addAnother(ROOT) },
  ]);
  // Edge: with My work or All boards on show there's no board to change, only one to add.
  assert.deepEqual((boardEdits(ROOT, undefined) as unknown as PageElement[]).map((b) => b.textContent), ['Add a board…']);
  const list = drawn(4).all('board-menu')[0]!;
  assert.deepEqual(list.all('board-edit').map((b) => b.textContent), [`Change ${model(4).projects[0]!.boards[0]!.name}…`, 'Add a board…'], 'drawn at the end of the list');
});
