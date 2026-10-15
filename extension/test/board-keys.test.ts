// A board's keys (T-54): which card an arrow goes to, which lane a held card's choice goes to, how each step
// shows and what the live line says. The page's side, in a browser, is the behaviour run's (behaviour.ts).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CASES, MUTANTS } from '../scripts/behaviour.ts';
import { CARD_KEYS, LANE_KEYS, MOVE_LOOK, MOVE_WORDS, nextCard, nextLane } from '../webview/board-keys.ts';

/** Three columns, the middle one empty, then a fourth: A-1 and A-2, nothing, B-1 to B-3, C-1. */
const BOARD = [['A-1', 'A-2'], [], ['B-1', 'B-2', 'B-3'], ['C-1']];

test('Down and Up go to the next and previous card in the column; Home and End to its first and last', () => {
  assert.equal(nextCard(BOARD, 'B-1', 'ArrowDown'), 'B-2');
  assert.equal(nextCard(BOARD, 'B-2', 'ArrowUp'), 'B-1');
  assert.equal(nextCard(BOARD, 'B-2', 'Home'), 'B-1');
  assert.equal(nextCard(BOARD, 'B-1', 'End'), 'B-3');
});

test('edge case: at the end of a column, Down, Up, Home and End stay on the card', () => {
  assert.equal(nextCard(BOARD, 'B-3', 'ArrowDown'), 'B-3');
  assert.equal(nextCard(BOARD, 'B-1', 'ArrowUp'), 'B-1');
  assert.equal(nextCard(BOARD, 'B-1', 'Home'), 'B-1');
  assert.equal(nextCard(BOARD, 'B-3', 'End'), 'B-3');
});

test('Right and Left go to the card at the same place in the next column, or its last card when it has fewer', () => {
  assert.equal(nextCard(BOARD, 'B-1', 'ArrowRight'), 'C-1');
  assert.equal(nextCard(BOARD, 'B-3', 'ArrowRight'), 'C-1', 'C has one card: its last');
  assert.equal(nextCard(BOARD, 'B-2', 'ArrowLeft'), 'A-2', 'the same place');
  assert.equal(nextCard(BOARD, 'B-3', 'ArrowLeft'), 'A-2', 'A has two cards: its last');
});

test('edge case: an empty column between two is passed over, both ways', () => {
  assert.equal(nextCard(BOARD, 'A-1', 'ArrowRight'), 'B-1');
  assert.equal(nextCard(BOARD, 'A-2', 'ArrowRight'), 'B-2');
  assert.equal(nextCard(BOARD, 'B-1', 'ArrowLeft'), 'A-1');
});

test('edge case: at the first and last column, Left and Right stay on the card', () => {
  assert.equal(nextCard(BOARD, 'A-2', 'ArrowLeft'), 'A-2');
  assert.equal(nextCard(BOARD, 'C-1', 'ArrowRight'), 'C-1');
  // Empty columns at the edge: nothing past them, so it stays too.
  assert.equal(nextCard([[], ['X'], []], 'X', 'ArrowRight'), 'X');
  assert.equal(nextCard([[], ['X'], []], 'X', 'ArrowLeft'), 'X');
});

test('edge case: one card on the board stays focused on every key it takes', () => {
  const one = [[], ['ONLY'], []];
  for (const key of CARD_KEYS) assert.equal(nextCard(one, 'ONLY', key), 'ONLY', key);
  assert.equal(CARD_KEYS.length, 6);
});

test('edge case: a key the functions do not take, or a card not on the board, gives null', () => {
  for (const key of ['Enter', ' ', 'Escape', 'Tab', 'a', 'PageDown']) {
    assert.equal(nextCard(BOARD, 'B-1', key), null, key);
    assert.equal(nextLane(['a', 'b'], ['b'], 'a', key), null, key);
  }
  assert.equal(nextCard(BOARD, 'GONE-1', 'ArrowDown'), null);
  assert.equal(nextCard([], 'A-1', 'ArrowDown'), null, 'an empty board');
});

const COLUMNS = ['todo', 'ready', 'running', 'review', 'done'];

test('a held card\'s Right and Left go to the nearest lane it may land in, passing the rest', () => {
  // From its own column, Ready, it may go to To do or In review: Right passes Running.
  assert.equal(nextLane(COLUMNS, ['todo', 'review'], 'ready', 'ArrowRight'), 'review');
  assert.equal(nextLane(COLUMNS, ['todo', 'review'], 'ready', 'ArrowLeft'), 'todo');
  assert.equal(nextLane(COLUMNS, ['todo', 'review', 'done'], 'review', 'ArrowRight'), 'done');
  assert.equal(nextLane(COLUMNS, ['todo', 'review', 'done'], 'done', 'ArrowLeft'), 'review');
  // Back past its own column, which isn't a lane, to the one beyond it.
  assert.equal(nextLane(COLUMNS, ['todo', 'review'], 'review', 'ArrowLeft'), 'todo');
  assert.deepEqual([...LANE_KEYS], ['ArrowRight', 'ArrowLeft']);
});

test('edge case: at the last lane either way, the choice stays', () => {
  assert.equal(nextLane(COLUMNS, ['todo', 'review'], 'review', 'ArrowRight'), 'review');
  assert.equal(nextLane(COLUMNS, ['todo', 'review'], 'todo', 'ArrowLeft'), 'todo');
});

test('edge case: a card with no lanes to land in keeps its own column on every key', () => {
  for (const key of LANE_KEYS) assert.equal(nextLane(COLUMNS, [], 'running', key), 'running', key);
});

test('every step of a move shows an icon and a word, orange only for the card that can\'t move', () => {
  assert.deepEqual(Object.keys(MOVE_LOOK), ['moving', 'moved', 'stays', 'cannot']);
  for (const [step, look] of Object.entries(MOVE_LOOK)) assert.ok(look.label && look.icon, step);
  assert.equal(MOVE_LOOK.moving.label, 'Moving');
  assert.deepEqual(Object.entries(MOVE_LOOK).filter(([, l]) => l.tone === 'orange').map(([k]) => k), ['cannot']);
});

test('the live line says what Space, a choice, Enter, Escape and a card that can\'t move did', () => {
  assert.equal(MOVE_WORDS.moving('ACME-16'), 'Moving ACME-16. Left and Right choose a column. Enter drops it. Escape cancels.');
  assert.equal(MOVE_WORDS.choice('ACME-16', 'In Progress'), 'In Progress. Enter drops ACME-16 here.');
  assert.equal(MOVE_WORDS.moved('ACME-16', 'In Progress'), 'Moved ACME-16 to In Progress');
  assert.equal(MOVE_WORDS.stays('ACME-16', 'To Do'), 'Put ACME-16 down. It stays in To Do.');
  assert.equal(MOVE_WORDS.cannot('ACME-12', 'Running'), 'ACME-12 can\'t move from Running. No other column takes it from here.');
});

const webview = join(dirname(fileURLToPath(import.meta.url)), '..', 'webview');

// board-nav.ts reads the VS Code API as it loads, so node can't run it: the behaviour run drives it in a browser.
test('edge case: both boards, the tracker\'s and the agent board, wire their cards to boardKeys under a liveLine, and the behaviour run drives them', () => {
  const tasks = readFileSync(join(webview, 'tasks.ts'), 'utf8');
  assert.equal(tasks.match(/boardKeys\(board, live, \{/g)?.length, 2, 'boardKeys on each board');
  assert.equal(tasks.match(/const live = liveLine\(/g)?.length, 2, 'a liveLine above each');
  // The drop and the held card's Enter call one move each, so they send the same message.
  assert.match(tasks, /moveTask\(id, c\.group\);[\s\S]*move: moveTask,/);
  assert.match(tasks, /moveCard\(key, c\.id\);[\s\S]*move: moveCard,/);
  const cases = CASES.filter((c) => c.name.startsWith('board keys:'));
  assert.equal(cases.length, 5);
  const mutants = MUTANTS.filter((m) => m.file === 'board-nav.ts' || m.file === 'board-keys.ts');
  assert.equal(mutants.length, 6);
  for (const c of cases) assert.ok(mutants.some((m) => m.kills.includes(c.name)), `a mutant catches ${c.name}`);
});
