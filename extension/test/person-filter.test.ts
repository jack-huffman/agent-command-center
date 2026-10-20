// The Tasks boards' person filter (T-79): its choices, which cards each shows, the header's count, who Mine
// is on each board, and who dispatched each task. The page's side, in a browser, is the behaviour run's
// 'person filter:' cases (behaviour.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyLedger, type Task } from '../../packages/core/src/ledger.ts';
import type { Hub } from '../src/hub.ts';
import { trackerBoard, type TrackerCard, whoKey } from '../src/model/boards.ts';
import { dispatcher, dispatcherKey, tasksModel } from '../src/model/tasks.ts';
import { deriveRows } from '../src/task-rows.ts';
import { effective, EVERYONE, headerLine, MINE, NO_ME, noMatch, PERSON, choicesFor, shows, UNASSIGNED, type Person } from '../webview/person-filter.ts';
import { sampleBoards } from '../scripts/fixtures/boards.ts';
import { sampleHub } from '../scripts/fixtures/hub.ts';
import { pageSource } from './support.ts';

const jordan: Person = { key: 'jordan', name: 'Jordan Kim' };
const pat: Person = { key: 'pat', name: 'Pat Lee' };
/** Five cards: two of Jordan's, one of Pat's, one both have, and one nobody has. */
const CARDS = [{ people: [jordan] }, { people: [jordan] }, { people: [pat] }, { people: [jordan, pat] }, { people: [] as Person[] }];

test('each choice shows the cards it names: Everyone all, Mine the signed-in person\'s, Unassigned the ones nobody has, a person theirs', () => {
  const ids = (choice: string, me: string | null = 'jordan') => CARDS.flatMap((c, i) => (shows(choice, c.people, me) ? [i] : []));
  assert.deepEqual(ids(EVERYONE), [0, 1, 2, 3, 4]);
  assert.deepEqual(ids(MINE), [0, 1, 3]);
  assert.deepEqual(ids(UNASSIGNED), [4]);
  assert.deepEqual(ids(PERSON + 'pat'), [2, 3]);
  assert.deepEqual(ids(MINE, 'pat'), [2, 3], 'Mine follows who is signed in');
});

test('the menu lists Everyone, Mine, Unassigned, then each person with a card, by name, each with an icon, a label and a count', () => {
  const choices = choicesFor(CARDS, 'jordan', undefined);
  assert.deepEqual(choices.map((c) => [c.id, c.label, c.count]), [[EVERYONE, 'Everyone', 5], [MINE, 'Mine', 3], [UNASSIGNED, 'Unassigned', 1], [PERSON + 'jordan', 'Jordan Kim', 3], [PERSON + 'pat', 'Pat Lee', 2]]);
  for (const c of choices) assert.ok(c.icon && c.label, `${c.id} has an icon and a label`);
  assert.equal(new Set(choices.map((c) => c.icon)).size, 4, 'Everyone, Mine, Unassigned and a person each draw their own icon');
  assert.deepEqual(choicesFor([{ people: [pat] }, { people: [{ key: 'ana', name: 'Ana Ruiz' }] }], null, undefined).slice(3).map((c) => c.label), ['Ana Ruiz', 'Pat Lee'], 'people by name, not by the order of their cards');
});

test('the header says the choice with its count: "Mine · 7 of 42", and Everyone says the total', () => {
  const many = Array.from({ length: 42 }, (_, i) => ({ people: i < 7 ? [jordan] : [pat] }));
  const choices = choicesFor(many, 'jordan', undefined);
  assert.equal(headerLine(choices, MINE, 'jordan', 42).text, 'Mine · 7 of 42');
  assert.equal(headerLine(choices, undefined, 'jordan', 42).text, 'Everyone · 42');
  assert.equal(headerLine(choices, PERSON + 'pat', 'jordan', 42).text, 'Pat Lee · 35 of 42');
  assert.equal(headerLine(choices, UNASSIGNED, 'jordan', 42).text, 'Unassigned · 0 of 42');
});

test('edge case: Mine with nobody to mean is off with its reason, and a board kept on Mine then shows everyone', () => {
  const choices = choicesFor(CARDS, null, MINE);
  const mine = choices.find((c) => c.id === MINE)!;
  assert.equal(mine.disabled, NO_ME);
  assert.equal(mine.count, 0);
  assert.ok(choices.filter((c) => c.id !== MINE).every((c) => c.disabled === null), 'only Mine is off');
  assert.equal(effective(MINE, null), EVERYONE);
  assert.equal(shows(MINE, [jordan], null), true, 'no hidden board: with nobody to mean, every card shows');
  assert.equal(headerLine(choices, MINE, null, 5).text, 'Everyone · 5');
});

test('edge case: a board where no card matches shows a count of none, and says so in words', () => {
  const choices = choicesFor([{ people: [pat] }, { people: [pat] }], 'jordan', MINE);
  assert.equal(headerLine(choices, MINE, 'jordan', 2).text, 'Mine · 0 of 2');
  assert.equal(noMatch('Mine'), 'No card here is yours.');
  assert.equal(noMatch('Pat Lee'), 'No card here is Pat Lee\'s.');
  assert.equal(noMatch('Unassigned'), 'Every card on this board has someone.');
  // An empty board has nobody on it, and still offers the three fixed choices.
  assert.deepEqual(choicesFor([], 'jordan', undefined).map((c) => c.id), [EVERYONE, MINE, UNASSIGNED]);
});

test('edge case: a person chosen who has no card now, after a refresh, stays in the menu with a count of none, so the choice can be changed', () => {
  const choices = choicesFor([{ people: [pat] }], 'jordan', PERSON + 'ghost');
  assert.deepEqual(choices.find((c) => c.id === PERSON + 'ghost'), { id: PERSON + 'ghost', label: 'ghost', icon: 'person', count: 0, disabled: null });
  assert.equal(headerLine(choices, PERSON + 'ghost', 'jordan', 1).text, 'ghost · 0 of 1');
});

test('a card\'s people are keyed by the tracker\'s id, else the name, and the board knows who Mine is', () => {
  assert.deepEqual(whoKey({ id: 'a1', name: 'Jordan Kim' }), { key: 'a1', name: 'Jordan Kim' });
  assert.deepEqual(whoKey({ name: 'Pat Lee' }), { key: 'Pat Lee', name: 'Pat Lee' });
  const board = trackerBoard(sampleBoards()[0]!, [], '/r');
  assert.equal(board.me, 'jordan');
  const cards: TrackerCard[] = board.columns.flatMap((c) => c.cards);
  const mine = cards.filter((c) => shows(MINE, c.people, board.me));
  assert.deepEqual(mine.map((c) => c.key).sort(), ['ACME-12', 'ACME-14', 'ACME-22', 'ACME-28']);
  assert.deepEqual(choicesFor(cards, board.me, undefined).slice(3).map((c) => [c.label, c.count]), [['Jordan Kim', 4], ['Pat Lee', 6]]);
  assert.equal(cards.filter((c) => shows(UNASSIGNED, c.people, board.me)).length, cards.length - 10);
  // A tracker that can't say who is signed in gives no Mine.
  assert.equal(trackerBoard({ ...sampleBoards()[0]!, me: null }, [], '/r').me, null);
  assert.equal(trackerBoard({ ...sampleBoards()[0]!, me: undefined }, [], '/r').me, null, 'before its board loads');
});

test('the agent board filters by who dispatched each task: a person by their account, autopilot by its word, a task never dispatched by nobody', () => {
  assert.deepEqual(dispatcher('human:jordan'), [{ key: 'human:jordan', name: 'jordan' }]);
  assert.deepEqual(dispatcher('orchestrator:autopilot'), [{ key: 'orchestrator:autopilot', name: 'Autopilot' }]);
  assert.deepEqual(dispatcher(null), []);
  assert.deepEqual(dispatcher(undefined), []);
  assert.equal(dispatcherKey('jordan'), 'human:jordan', 'as acc writes a person\'s moves');
  assert.equal(dispatcherKey(undefined), null, 'no account to mean');
  const project = tasksModel(sampleHub()).projects[0]!;
  assert.equal(project.me, 'human:jordan');
  const cards = project.columns.flatMap((c) => c.cards);
  assert.deepEqual(cards.filter((c) => shows(MINE, c.people, project.me)).map((c) => c.id).sort(), ['ACME-12', 'ACME-14', 'ACME-28']);
  assert.deepEqual(choicesFor(cards, project.me, undefined).slice(3).map((c) => c.label), ['Autopilot', 'jordan', 'pat']);
  assert.equal(tasksModel({ ...sampleHub(), user: '' }).projects[0]!.me, null, 'edge: the hub knows no account, so no Mine');
});

test('deriveRows reads who dispatched a task: the latest move from to do to running; edge cases: never dispatched, a rework\'s own restart', () => {
  const move = (from: string | null, to: string, by: string) => ({ at: '2026-10-01T10:00:00Z', actor: 'human', by, from, to, reason: null });
  const task = (history: unknown[]) => ({
    id: 'AV-9', title: 'Task AV-9', brief: '', source: { kind: 'manual', url: null }, environment: 'devbox', deps: [], labels: [], state: 'running', blocker: null,
    run: null, pr: null, history, createdAt: '', updatedAt: '',
  }) as unknown as Task;
  const read = (history: unknown[]) => deriveRows({ agentsAt: 1, agentsError: null, agents: [], questions: [] } as unknown as Hub, { ...emptyLedger(), tasks: [task(history)] })[0]!.dispatchedBy;
  assert.equal(read([move(null, 'todo', 'human:pat'), move('todo', 'running', 'human:jordan')]), 'human:jordan');
  assert.equal(read([move(null, 'todo', 'human:pat')]), null, 'added, never dispatched');
  assert.equal(read([move('todo', 'running', 'human:jordan'), move('running', 'review', 'builder:AV-9'), move('review', 'rework', 'reviewer:x'), move('rework', 'running', 'orchestrator:autopilot')]), 'human:jordan', 'a rework\'s restart is not the dispatch');
});

test('both boards draw the filter and only the cards it shows, and a board with none says why', () => {
  const tasks = pageSource('tasks.ts');
  assert.equal(tasks.match(/personFilter\(/g)?.length, 2, 'a filter on the tracker board and on the agent board');
  assert.equal(tasks.match(/\.none\(\)/g)?.length, 2, 'each says so when no card shows');
  assert.match(tasks, /c\.cards\.filter\(showing\)/, 'only the cards that show are drawn, so the board\'s keys skip the rest');
  assert.match(pageSource('person-menu.ts'), /remember\(\(m\) => \{[\s\S]*m\.filters = filters;/, 'the choice is kept in the window\'s state, by the board\'s key');
});
