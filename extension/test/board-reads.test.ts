// A project's several boards (T-127): each board's id, the order and pace they're read in, which boards read one
// source, and a ticket that left the repo's place only when it left every board of its source.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Tracker } from '../../packages/core/src/config.ts';
import { BOARD_READS, boardId, outsideEvery, readInTurn, sourceGroups } from '../src/logic/board-reads.ts';

const tracker = (t: Partial<Tracker> & Pick<Tracker, 'kind'>): Tracker => ({ name: null, site: null, project: null, repo: null, organization: null, account: null, workspace: null, channel: null, reaction: null, doneReaction: null, team: null, board: null, statusColumn: null, prefix: null, skipLabels: [], epics: [], sprint: null, labels: [], areaPath: null, group: null, edits: false, statusFor: null, changesField: null, ...t });
const ACME = tracker({ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', epics: ['ACME-3'] });

test('a board\'s id keeps through a rename, and another place is another board', () => {
  assert.match(boardId(ACME), /^[0-9a-f]{12}$/);
  assert.equal(boardId({ ...ACME, name: 'Premium' }), boardId(ACME), 'renamed, the Tasks tab still shows it');
  assert.notEqual(boardId({ ...ACME, epics: ['ACME-7'] }), boardId(ACME));
  assert.notEqual(boardId({ ...ACME, site: 'globex.atlassian.net' }), boardId(ACME), 'the same project key on another site');
});

test('boards are read BOARD_READS at a time, the one on show first, and one switched to while others are read goes next', async () => {
  assert.equal(BOARD_READS, 3);
  const ids = Array.from({ length: 10 }, (_, i) => `b${i}`);
  const order: string[] = [];
  let now = 0;
  let most = 0;
  let shown = 'b7';
  const release: (() => void)[] = [];
  const reading = readInTurn(ids, () => shown, (id) => new Promise<void>((done) => {
    order.push(id);
    most = Math.max(most, ++now);
    release.push(() => { now--; done(); });
  }));
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(order, ['b7', 'b0', 'b1'], 'the board on show first, then two behind it');
  shown = 'b9';
  release.shift()!();
  await new Promise((r) => setImmediate(r));
  assert.equal(order[3], 'b9', 'edge case: the person switched while others were read: that one is next');
  while (order.length < 10 || release.length) { release.shift()?.(); await new Promise((r) => setImmediate(r)); }
  await reading;
  assert.equal(most, BOARD_READS, 'never more at once');
  assert.deepEqual([...order].sort(), [...ids].sort(), 'each board read once: no site asked more than once a board');
});

test('one board\'s failed read never stops the others, and none or one board reads alike', async () => {
  const read: string[] = [];
  await readInTurn(['a', 'b', 'c', 'd'], () => null, async (id) => { read.push(id); if (id === 'a') throw new Error('site down'); });
  assert.deepEqual(read.sort(), ['a', 'b', 'c', 'd']);
  await readInTurn([], () => 'x', async () => { throw new Error('never'); });
  const one: string[] = [];
  await readInTurn(['solo'], () => 'gone', async (id) => { one.push(id); });
  assert.deepEqual(one, ['solo'], 'edge case: a board on show that\'s gone reads the rest in order');
});

test('boards of one project on one site read one source; another site, project or kind is its own', () => {
  const list = [ACME, tracker({ kind: 'github', repo: 'acme/tool' }), { ...ACME, epics: ['ACME-7'] }, { ...ACME, site: 'globex.atlassian.net' }, tracker({ kind: 'github', repo: 'acme/tool', labels: ['x'] })];
  assert.deepEqual(sourceGroups(list), [[0, 2], [1, 4], [3]]);
  assert.deepEqual(sourceGroups([]), []);
});

test('a ticket has left the repo\'s place only when every board of its source says so; a failed read keeps it', async () => {
  const says = (keys: string[]) => async (asked: string[]) => asked.filter((k) => keys.includes(k)).map((key) => ({ key, why: 'left' }));
  assert.deepEqual((await outsideEvery(['A-1', 'A-2', 'A-3'], [says(['A-1', 'A-2']), says(['A-2', 'A-3'])])).map((o) => o.key), ['A-2'], 'A-1 is on the second board, so it stays');
  assert.deepEqual(await outsideEvery(['A-1'], [says(['A-1']), async () => { throw new Error('down'); }]), [], 'edge case: one board\'s read fails: nothing is taken off');
  assert.deepEqual((await outsideEvery(['A-1'], [says(['A-1'])])).map((o) => o.key), ['A-1'], 'one board alone, as before');
  assert.deepEqual(await outsideEvery([], [says(['A-1'])]), [], 'edge case: nothing asked');
  assert.deepEqual(await outsideEvery(['A-1'], []), [], 'edge case: no board to ask');
});
