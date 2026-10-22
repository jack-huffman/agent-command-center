// A project's boards kept in its repo's state folder (2026-10-21): a fresh window draws each tracker's last board
// at once, refreshing, or a skeleton when nothing was kept, never another tracker's place first.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Tracker } from '../../packages/core/src/config.ts';
import { tempDir } from '../../packages/core/test/support.ts';
import type { Board } from '../../packages/core/src/trackers/types.ts';
import { boardCacheFile, readBoardCache, trackerKey, writeBoardCache } from '../src/logic/board-cache.ts';
import { trackerBoard } from '../src/model/boards.ts';
import { sampleAzureLoading, sampleAzureRefreshing } from '../scripts/fixtures/tracker-tickets.ts';
import { pageDom, type PageElement } from './page-dom.ts';

const AZURE = { kind: 'azure', organization: 'acme', project: 'CRM' } as unknown as Tracker;
const GITHUB = { kind: 'github', repo: 'acme/tool' } as unknown as Tracker;
const board = (place: string): Board => ({ source: 'azure-board', title: 'CRM Team · Backlog items', url: null, columns: [], cards: [], notice: null, place });
const ME = { id: 'jordan@acme.example', name: 'Jordan Kim' };

function stateDir(_t?: unknown): { stateDir: string } {
  return { stateDir: join(tempDir('acc-boards-'), 'acc') };
}

test('a board that loaded is kept, and read back for its tracker at its place in the list', (t) => {
  const paths = stateDir(t);
  writeBoardCache(paths, [AZURE, GITHUB], [{ board: board('Azure DevOps · CRM'), me: ME }, null], new Date('2026-10-21T20:00:00Z'));
  const read = readBoardCache(paths, [AZURE, GITHUB]);
  assert.equal(read[0]?.board.place, 'Azure DevOps · CRM');
  assert.deepEqual(read[0]?.me, ME);
  assert.equal(read[0]?.at, '2026-10-21T20:00:00.000Z');
  assert.equal(read[1], null, 'GitHub\'s board never loaded: nothing kept for it');
});

test('edge case: a tracker whose board failed keeps its last one, and one the project no longer names leaves the file', (t) => {
  const paths = stateDir(t);
  writeBoardCache(paths, [AZURE, GITHUB], [{ board: board('first'), me: null }, { board: board('github'), me: null }], new Date());
  writeBoardCache(paths, [AZURE], [null], new Date());
  assert.equal(readBoardCache(paths, [AZURE])[0]?.board.place, 'first', 'the failed load kept the last board');
  assert.deepEqual(readBoardCache(paths, [AZURE, GITHUB]).map((c) => c?.board.place ?? null), ['first', null], 'GitHub left the file');
});

test('edge case: a tracker that changed never shows the last place\'s cards, and a missing or broken file is no cache', (t) => {
  const paths = stateDir(t);
  assert.deepEqual(readBoardCache(paths, [AZURE]), [null], 'no file yet');
  writeBoardCache(paths, [AZURE], [{ board: board('CRM'), me: null }], new Date());
  const moved = { ...AZURE, project: 'Billing' } as unknown as Tracker;
  assert.notEqual(trackerKey(moved), trackerKey(AZURE), 'any setting that differs makes another key');
  assert.equal(trackerKey({ ...AZURE } as Tracker), trackerKey(AZURE), 'the same settings, the same key');
  assert.deepEqual(readBoardCache(paths, [moved]), [null], 'another project: not the CRM board');
  writeFileSync(boardCacheFile(paths), '{ not json');
  assert.deepEqual(readBoardCache(paths, [AZURE]), [null], 'a broken file');
  writeFileSync(boardCacheFile(paths), JSON.stringify({ v: 1, boards: [{ tracker: JSON.stringify(AZURE), at: 'x', me: null, board: { place: 'CRM' } }] }));
  assert.deepEqual(readBoardCache(paths, [AZURE]), [null], 'a board this version can\'t draw');
});

async function drawn(input: ReturnType<typeof sampleAzureLoading>[number]): Promise<PageElement> {
  pageDom();
  const { renderTrackerBoard } = await import('../webview/tasks.ts');
  return renderTrackerBoard('/r', trackerBoard(input, [], '/r')) as unknown as PageElement;
}

test('a board on its way with nothing kept draws a skeleton that says it is loading; one drawn from the cache says Refreshing', async () => {
  const loading = await drawn(sampleAzureLoading()[0]!);
  const skel = loading.all('board-skeleton');
  assert.equal(skel.length, 1, 'a skeleton');
  assert.equal(skel[0]!.getAttribute('role'), 'status');
  assert.match(skel[0]!.textContent, /Loading the board/);
  assert.ok(skel[0]!.all('skel-card').length >= 3, 'card shapes');
  assert.match(loading.all('loading')[0]!.textContent, /Loading/);
  // The cached board's columns and cards are drawn at once; the board itself is the behaviour run's and the shots'.
  const { loadingWords } = await import('../webview/tasks.ts');
  const refreshing = trackerBoard(sampleAzureRefreshing()[0]!, [], '/r');
  assert.ok(refreshing.columns.some((c) => c.cards.length), 'its cards are there at once');
  assert.equal(loadingWords(refreshing), 'Refreshing');
  assert.equal(loadingWords(trackerBoard(sampleAzureLoading()[0]!, [], '/r')), 'Loading');
});
