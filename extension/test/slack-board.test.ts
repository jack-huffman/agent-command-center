// A Slack board on the Tasks tab (T-85): the channel's messages marked with a reaction, Open and Done, with
// Track on an open card, the person filter by each message's writer, and why the board is off.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NO_REACTION } from '../../packages/core/src/trackers/slack.ts';
import { BOARD_WORD, type BoardInput, trackerBoard } from '../src/model/boards.ts';
import { sampleSlackBoards } from '../scripts/fixtures/boards.ts';
import { choicesFor, EVERYONE, MINE, NO_ME, PERSON, shows, UNASSIGNED } from '../webview/person-filter.ts';
import { row } from './support.ts';

const slack = (sample: Parameters<typeof sampleSlackBoards>[0]): BoardInput => sampleSlackBoards(sample)[0]!;

test('a Slack board shows its marked messages Open and Done, beside the box for a thread\'s link, and its cards stay put', () => {
  const b = trackerBoard(slack('board'), [], '/r');
  assert.deepEqual([b.tab, BOARD_WORD.slack, b.source, b.title, b.off, b.error, b.moves], ['Slack board', 'Slack board', 'slack', 'Messages marked :ticket:', null, null, false]);
  assert.deepEqual(b.columns.map((c) => [c.name, c.icon, c.tone, c.done, c.cards.length]), [['Open', 'circle-outline', 'neutral', false, 3], ['Done', 'check', 'neutral', true, 2]]);
  assert.ok(b.paste, 'a thread\'s link can still be pasted');
  assert.equal(b.place, 'Slack · acme · channel C0123ABCD');
  // Every other tracker's cards move.
  assert.equal(trackerBoard({ ...slack('board'), kind: 'jira', board: { ...slack('board').board!, source: 'jira-board' } }, [], '/r').moves, true);
});

test('a long first line keeps its full text for the card\'s hover title; a short one has none', () => {
  const [long, short] = trackerBoard(slack('board'), [], '/r').columns[0]!.cards;
  assert.ok(long!.title.endsWith('…') && long!.title.length <= 120);
  assert.match(long!.fullTitle ?? '', /no longer match the dashboard$/);
  assert.equal(short!.fullTitle, null);
});

test('Track is on each open card acc doesn\'t keep, on its way for one, gone in Done, and a tracked message shows its task', () => {
  const tracked = row('SL-1760000220000220', 'todo', 'ready');
  const b = trackerBoard(slack('board'), [tracked], '/r');
  const [open, done] = b.columns;
  assert.deepEqual(open!.cards.map((c) => [c.key, c.track, !!c.acc]), [
    ['SL-1760000300000300', { busy: false, error: null }, false],
    ['SL-1760000250000250', { busy: true, error: null }, false],
    ['SL-1760000220000220', null, true],
  ]);
  assert.deepEqual(done!.cards.map((c) => c.track), [null, null], 'nothing left to build in Done (D-074)');
});

test('the person filter goes by each message\'s writer, and Mine is off: the board reads as the app, not a person', () => {
  const b = trackerBoard(slack('board'), [], '/r');
  const cards = b.columns.flatMap((c) => c.cards);
  assert.deepEqual(cards.map((c) => c.people.map((p) => p.name)), [['Jordan Kim'], ['Sam Lee'], ['Jordan Kim'], ['Sam Lee'], ['Jordan Kim']]);
  assert.equal(b.me, null);
  const choices = choicesFor(cards, b.me, undefined);
  assert.deepEqual(choices.map((c) => [c.label, c.count, c.disabled]), [['Everyone', 5, null], ['Mine', 0, NO_ME], ['Unassigned', 0, null], ['Jordan Kim', 3, null], ['Sam Lee', 2, null]]);
  assert.deepEqual(cards.filter((c) => shows(`${PERSON}U02`, c.people, b.me)).map((c) => c.key), ['SL-1760000250000250', 'SL-1760000200000200']);
  assert.equal(cards.filter((c) => shows(UNASSIGNED, c.people, b.me)).length, 0, 'every message has a writer');
  assert.equal(cards.filter((c) => shows(EVERYONE, c.people, b.me)).length, 5);
  assert.equal(cards.filter((c) => shows(MINE, c.people, b.me)).length, 5, 'Mine with nobody to mean shows everyone');
});

test('with no reaction the board is off, saying why and how to turn it on; an error hides that, as it hides the box', () => {
  const off = trackerBoard(slack('off'), [], '/r');
  assert.deepEqual([off.off, off.columns, off.error, !!off.paste], [NO_REACTION, [], null, true]);
  assert.match(off.off!, /Choose a reaction with Change/);
  const scope = trackerBoard({ ...slack('off'), error: 'The Slack app needs the channels:history scope for conversations.history.' }, [], '/r');
  assert.deepEqual([scope.off, scope.paste], [null, null], 'the edge case of an error: it says what to fix, alone');
});

test('a missing scope names the scope on the board, and an empty board says how a message gets on it', () => {
  const scope = trackerBoard(slack('scope'), [], '/r');
  assert.match(scope.error ?? '', /needs the channels:history scope.*OAuth & Permissions page at https:\/\/api\.slack\.com\/apps/);
  assert.deepEqual([scope.columns, scope.paste], [[], null]);
  const empty = trackerBoard(slack('empty'), [], '/r');
  assert.deepEqual(empty.columns.map((c) => c.cards.length), [0, 0]);
  assert.match(empty.notice ?? '', /No message from the last 30 days has the :ticket: reaction/);
});
