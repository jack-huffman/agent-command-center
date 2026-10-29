// acc board and acc ticket (T-141): a session reads the board and tickets the Command Center saved, with when each was
// saved and whether a newer change waits, and is told to open the project in the Command Center when nothing is.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../core/src/config.ts';
import { run } from '../../core/src/exec.ts';
import { repoPaths } from '../../core/src/paths.ts';
import { boardCacheFile, boardTrackers, savedTicketFile, savedTicketOf, trackerKey, writeSavedTicket } from '../../core/src/saved-tickets.ts';
import type { Board } from '../../core/src/trackers/types.ts';
import { GENERIC_CONFIG } from '../../core/test/support.ts';
import { cli, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));
const CONFIG = { ...GENERIC_CONFIG, trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME' }] };
const T1 = '2026-10-28T09:00:00.000+0000';

const card = (key: string, title: string, status: string, updated?: string) => ({
  key, title, url: `https://acme.atlassian.net/browse/${key}`, status: { id: status, name: status, category: 'todo' as const }, type: 'Story', typeKind: 'story' as const, typeColor: null,
  assignees: [{ id: 'a', name: 'Jordan Kim' }], labels: [], priority: 'High', priorityLevel: 2 as const, ...(updated ? { updated } : {}),
});

/** A repo whose Command Center saved its board, with ACME-1 current, ACME-2 changed since it was saved, and ACME-3 not saved yet. */
function savedRepo() {
  const dir = repoWithConfig(CONFIG);
  const paths = repoPaths(dir, run);
  const [tracker] = boardTrackers(loadConfig(paths.config).config);
  const key = trackerKey(tracker!);
  const board: Board = {
    source: 'jira-board', title: 'ACME board', url: null, notice: null, place: 'Jira · ACME',
    columns: [{ id: 'c1', name: 'To Do', category: 'todo', statusIds: ['1'] }, { id: 'c2', name: 'In Progress', category: 'doing', statusIds: ['3'] }],
    cards: [card('ACME-1', 'Escalate premium cases', '1', T1), card('ACME-2', 'Fix welcome email', '3', '2026-10-28T11:00:00.000+0000'), card('ACME-3', 'Renewal reminders', '3')],
  };
  mkdirSync(paths.stateDir, { recursive: true });
  const at = new Date(Date.now() - 12 * 60_000);
  writeFileSync(boardCacheFile(paths), JSON.stringify({ v: 1, boards: [{ tracker: key, board, me: null, at: at.toISOString() }] }));
  const read = (k: string) => ({
    key: k, title: `Ticket ${k}`, url: `https://acme.atlassian.net/browse/${k}`, markdown: `What ${k} asks.`, body: { blocks: [] }, updated: T1,
    comments: [{ id: '1', author: { id: 'a', name: 'Jordan Kim' }, created: T1, body: { blocks: [{ t: 'p' as const, c: [{ t: 'text' as const, text: 'Agreed.' }] }] }, url: null }], related: [],
  });
  writeSavedTicket(paths, savedTicketOf(read('ACME-1'), { name: 'Changes', markdown: 'The Account flow.' }, key, at));
  writeSavedTicket(paths, savedTicketOf(read('ACME-2'), null, key, at));
  return { dir, paths };
}

test('acc board lists the saved board\'s columns and cards, with when each ticket was saved and whether a newer change waits', () => {
  const { dir } = savedRepo();
  const r = acc(dir, ['board']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /ACME board · Jira · ACME/);
  assert.match(r.out, /To Do \(1\)\n {2}ACME-1 {2}Escalate premium cases · Jordan Kim · High {2}\(saved 12 minutes ago\)/);
  assert.match(r.out, /ACME-2 .*\(saved 12 minutes ago; changed since, waiting to be read again\)/);
  assert.match(r.out, /ACME-3 .*\(not saved yet\)/);
  const json = acc(dir, ['board', '--json']).json();
  const cards = json.boards[0].columns.flatMap((c: { cards: unknown[] }) => c.cards);
  assert.deepEqual(cards.map((c: { key: string; waiting: boolean; saved: string | null }) => [c.key, c.waiting, !!c.saved]), [['ACME-1', false, true], ['ACME-2', true, true], ['ACME-3', true, false]]);
});

test('acc ticket shows one saved ticket, when it was saved, and whether the board\'s last load found it changed since', () => {
  const { dir, paths } = savedRepo();
  const r = acc(dir, ['ticket', 'acme-1']);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /ACME-1 {2}Ticket ACME-1/);
  assert.match(r.out, /Saved 12 minutes ago, as it was at 2026-10-28T09:00:00\.000\+0000\./);
  assert.doesNotMatch(r.out, /a newer read waits/);
  assert.match(r.out, /What ACME-1 asks\.[\s\S]*## Changes[\s\S]*The Account flow\.[\s\S]*### Jordan Kim, 2026-10-28[\s\S]*Agreed\./);
  const waiting = acc(dir, ['ticket', 'ACME-2']);
  assert.match(waiting.out, /The board's last load found it changed since: a newer read waits\./);
  const json = acc(dir, ['ticket', 'ACME-2', '--json']).json();
  assert.deepEqual([json.key, json.waiting, json.file, json.changed], ['ACME-2', true, savedTicketFile(paths, 'ACME-2'), T1]);
});

test('edge case: with nothing saved, both commands say to open the project in the Command Center; a ticket not saved says so', () => {
  const empty = repoWithConfig(CONFIG);
  for (const args of [['board'], ['ticket', 'ACME-1'], ['board', '--json']]) {
    const r = acc(empty, args);
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.out + r.err, /Nothing is saved for this project yet\. Open the project in the Command Center/);
  }
  const { dir } = savedRepo();
  const r = acc(dir, ['ticket', 'ACME-3']);
  assert.equal(r.code, 1);
  assert.match(r.out + r.err, /ACME-3 isn't saved: no saved board shows it, or the Command Center hasn't read it yet\. acc board lists what is saved\./);
  assert.equal(acc(dir, ['ticket']).code, 2, 'a key is needed: usage');
  assert.equal(acc(dir, ['board', 'extra']).code, 2);
});
