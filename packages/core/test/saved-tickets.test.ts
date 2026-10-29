// The tickets the Command Center saves for a session (T-141): their shape, which acc analyze --ticket and acc draft
// criteria --ticket take as it is, whether a saved copy is current, and how they follow the boards.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Tracker } from '../src/config.ts';
import { parseCriteriaTicket } from '../src/criteria.ts';
import { parsePlanTicket } from '../src/plan-ticket.ts';
import {
  boardCacheFile, boardTrackers, changedSince, markSavedFailed, needsRead, NOTHING_SAVED, pruneSavedTickets, readCachedBoards, readSavedTicket, readSavedTickets,
  removeSavedTicket, removeTrackerTickets, savedBoards, savedTicketFile, savedTicketOf, savedWords, type TicketRead, ticketsDir, ticketWaiting, trackerKey,
  UNTIMED_MAX_MS, writeSavedTicket,
} from '../src/saved-tickets.ts';
import type { Board } from '../src/trackers/types.ts';
import { tempDir } from './support.ts';

const NOW = new Date('2026-10-28T12:00:00Z');
const JIRA = { kind: 'jira', site: 'acme.atlassian.net', project: 'ACME' } as unknown as Tracker;
const GITHUB = { kind: 'github', repo: null } as unknown as Tracker;
const doc = (text: string) => ({ blocks: [{ t: 'p' as const, c: [{ t: 'text' as const, text }] }] });

const read = (key: string, updated = '2026-10-28T09:00:00.000+0000', extra: Partial<TicketRead> = {}): TicketRead => ({
  key, title: `Ticket ${key}`, url: `https://acme.atlassian.net/browse/${key}`, markdown: 'As a user, I want…', body: doc('As a user, I want…'), updated,
  comments: [{ id: '1', author: { id: 'a1', name: 'Jordan Kim' }, created: '2026-10-27T10:00:00.000+0000', body: doc('Agreed.'), url: null }],
  related: [{ key: 'ACME-1', title: 'Epic', relation: 'parent', url: null, status: { id: '1', name: 'In Progress', category: 'doing' }, typeKind: 'epic', typeColor: null }],
  ...extra,
});

const paths = () => ({ stateDir: join(tempDir('acc-saved-'), 'acc') });

test('a saved ticket is the ticket a plan reads, with when it was read and the tracker\'s last-changed time', () => {
  const t = savedTicketOf(read('ACME-12'), { name: 'Changes', markdown: 'The Account flow.' }, trackerKey(JIRA), NOW);
  assert.equal(t.saved, NOW.toISOString());
  assert.equal(t.changed, '2026-10-28T09:00:00.000+0000');
  assert.equal(t.tracker, trackerKey(JIRA));
  assert.deepEqual(t.comments, [{ author: 'Jordan Kim', created: '2026-10-27T10:00:00.000+0000', markdown: 'Agreed.' }]);
  assert.deepEqual(t.related, [{ key: 'ACME-1', title: 'Epic', relation: 'parent', state: 'In Progress' }]);
  assert.deepEqual(t.changes, { name: 'Changes', markdown: 'The Account flow.' });
});

test('the saved file is what acc analyze --ticket and acc draft criteria --ticket read, as it is', () => {
  const p = paths();
  writeSavedTicket(p, savedTicketOf(read('ACME-12'), { name: 'Changes', markdown: 'The Account flow.' }, trackerKey(JIRA), NOW));
  const text = readFileSync(savedTicketFile(p, 'ACME-12'), 'utf8');
  const task = { id: 'ACME-12', title: 'Ticket ACME-12', brief: '', source: { kind: 'jira' as const, key: 'ACME-12', url: null } };
  const plan = parsePlanTicket(text, task);
  assert.equal(plan.full, true, 'read as the whole ticket, not as one that couldn\'t be read');
  assert.deepEqual([plan.key, plan.title, plan.url, plan.markdown], ['ACME-12', 'Ticket ACME-12', 'https://acme.atlassian.net/browse/ACME-12', 'As a user, I want…']);
  assert.deepEqual(plan.comments.map((c) => c.author), ['Jordan Kim']);
  assert.deepEqual(plan.changes, { name: 'Changes', markdown: 'The Account flow.' });
  const criteria = parseCriteriaTicket(text);
  assert.deepEqual([criteria.key, criteria.comments.length, criteria.related.length, criteria.full], ['ACME-12', 1, 1, true]);
});

test('edge case: a field the tracker can\'t give is left out, never saved as an empty string', () => {
  const t = savedTicketOf(read('GH-4', '', { url: '' as unknown as string }), null, trackerKey(GITHUB), NOW);
  for (const k of ['url', 'changes', 'changed', 'failed', 'full', 'why']) assert.ok(!(k in t), `${k} is left out`);
  const blank = savedTicketOf(read('GH-5'), { name: 'Changes', markdown: '  ' }, trackerKey(GITHUB), NOW);
  assert.ok(!('changes' in blank), 'a changes field with no text is left out');
  const p = paths();
  writeSavedTicket(p, t);
  assert.doesNotMatch(readFileSync(savedTicketFile(p, 'GH-4'), 'utf8'), /: ""/, 'no empty string in the file');
});

test('edge case: a key that could leave the folder is refused, and a missing, broken or older file is no saved copy', () => {
  const p = paths();
  assert.throws(() => savedTicketFile(p, '../../x'), /isn't a task id/);
  assert.equal(readSavedTicket(p, '../../x'), null);
  assert.equal(readSavedTicket(p, 'ACME-1'), null, 'none saved');
  assert.deepEqual(readSavedTickets(p), [], 'no folder yet');
  writeSavedTicket(p, savedTicketOf(read('ACME-1'), null, trackerKey(JIRA), NOW));
  writeFileSync(savedTicketFile(p, 'ACME-1'), '{ not json');
  assert.equal(readSavedTicket(p, 'ACME-1'), null);
  writeFileSync(savedTicketFile(p, 'ACME-1'), JSON.stringify({ key: 'ACME-1' }));
  assert.equal(readSavedTicket(p, 'ACME-1'), null, 'a file without its version and times');
  assert.ok(ticketsDir(p).endsWith(join('acc', 'tickets')));
});

test('a failed read keeps the last good copy, marked with why; with no copy, nothing is saved', () => {
  const p = paths();
  assert.equal(markSavedFailed(p, 'ACME-2', 'The ticket couldn\'t be read from its tracker: offline.', NOW), false);
  assert.equal(readSavedTicket(p, 'ACME-2'), null);
  writeSavedTicket(p, savedTicketOf(read('ACME-2'), null, trackerKey(JIRA), NOW));
  assert.equal(markSavedFailed(p, 'ACME-2', 'The ticket couldn\'t be read from its tracker: offline.', NOW), true);
  const t = readSavedTicket(p, 'ACME-2')!;
  assert.deepEqual(t.failed, { why: 'The ticket couldn\'t be read from its tracker: offline.', at: NOW.toISOString() });
  assert.equal(t.title, 'Ticket ACME-2', 'the last good copy');
  removeSavedTicket(p, 'ACME-2');
  assert.equal(readSavedTicket(p, 'ACME-2'), null);
});

test('only a ticket that changed, or has no copy, is read again; a card with no time is read again once its copy is a day old', () => {
  const saved = savedTicketOf(read('ACME-3', '2026-10-28T09:00:00.000+0000'), null, trackerKey(JIRA), NOW);
  assert.equal(needsRead({ updated: '2026-10-28T09:00:00.000+0000' }, saved, NOW), false, 'unchanged');
  assert.equal(needsRead({ updated: '2026-10-28T10:00:00.000+0000' }, saved, NOW), true, 'changed since');
  assert.equal(needsRead({ updated: '2026-10-28T08:00:00.000Z' }, saved, NOW), false, 'the same moment, written another way, isn\'t a change');
  assert.equal(needsRead({ updated: '2026-10-28T09:00:00.000+0000' }, null, NOW), true, 'no saved copy');
  assert.equal(needsRead({}, saved, NOW), false, 'no time, a fresh copy');
  assert.equal(needsRead({}, saved, new Date(NOW.getTime() + UNTIMED_MAX_MS + 1)), true, 'no time, a copy older than a day');
  assert.equal(changedSince('2026-10-28T09:00:00Z', undefined), true, 'a copy read without a time');
  assert.equal(changedSince('rev 7', 'rev 6'), true, 'not times: any difference');
  assert.equal(changedSince('rev 7', 'rev 7'), false);
});

test('edge case: the saved tickets follow the boards: one that left a board, and a tracker that changed, are removed; a board that failed keeps its own', () => {
  const p = paths();
  const moved = { ...JIRA, project: 'BILL' } as unknown as Tracker;
  for (const k of ['ACME-1', 'ACME-2']) writeSavedTicket(p, savedTicketOf(read(k), null, trackerKey(JIRA), NOW));
  writeSavedTicket(p, savedTicketOf(read('GH-1'), null, trackerKey(GITHUB), NOW));
  assert.deepEqual(pruneSavedTickets(p, [{ tracker: trackerKey(JIRA), keys: ['ACME-1'] }, { tracker: trackerKey(GITHUB), keys: null }]), ['ACME-2'], 'ACME-2 left the board');
  assert.deepEqual(readSavedTickets(p).map((t) => t.key), ['ACME-1', 'GH-1'], 'GitHub\'s board didn\'t load: it keeps its tickets');
  assert.deepEqual(pruneSavedTickets(p, [{ tracker: trackerKey(moved), keys: ['ACME-1'] }, { tracker: trackerKey(GITHUB), keys: ['GH-1'] }]), ['ACME-1'], 'the Jira tracker\'s settings changed');
  assert.deepEqual(removeTrackerTickets(p, trackerKey(GITHUB)), ['GH-1'], 'signing out');
  assert.deepEqual(readSavedTickets(p), []);
});

test('edge case: a ticket two trackers\' boards show is kept while either shows it, and moves to the one that still does', () => {
  const p = paths();
  const epic = { ...JIRA, epic: 'ACME-100' } as unknown as Tracker;
  writeSavedTicket(p, savedTicketOf(read('ACME-1'), null, trackerKey(JIRA), NOW));
  const saved = readSavedTickets(p);
  assert.deepEqual(pruneSavedTickets(p, [{ tracker: trackerKey(JIRA), keys: [] }, { tracker: trackerKey(epic), keys: ['ACME-1'] }], saved), [], 'the other board still shows it');
  assert.equal(readSavedTicket(p, 'ACME-1')!.tracker, trackerKey(epic), 'saved under the board that shows it now');
  assert.deepEqual(removeTrackerTickets(p, trackerKey(JIRA)), [], 'so signing out of the first tracker leaves it');
  assert.deepEqual(pruneSavedTickets(p, [{ tracker: trackerKey(JIRA), keys: ['ACME-1'] }, { tracker: trackerKey(epic), keys: [] }]), [], 'back on the first board only: kept');
  assert.deepEqual(pruneSavedTickets(p, [{ tracker: trackerKey(JIRA), keys: [] }, { tracker: trackerKey(epic), keys: [] }]), ['ACME-1'], 'on neither: removed');
});

test('a session\'s view of the saved board: columns and cards, each with when its ticket was saved and whether a newer change waits', () => {
  const p = paths();
  const board: Board = {
    source: 'jira-board', title: 'ACME board', url: null, notice: null, place: 'Jira · ACME',
    columns: [{ id: 'c1', name: 'To Do', category: 'todo', statusIds: ['1'] }, { id: 'c2', name: 'Done', category: 'done', statusIds: ['9'] }],
    cards: [
      { key: 'ACME-1', title: 'Saved and current', url: '', status: { id: '1', name: 'To Do', category: 'todo' }, type: 'Story', typeKind: 'story', typeColor: null, assignees: [{ id: 'a', name: 'Jordan Kim' }], labels: [], priority: 'High', priorityLevel: 2, updated: '2026-10-28T09:00:00.000+0000' },
      { key: 'ACME-2', title: 'Changed since', url: '', status: { id: '1', name: 'To Do', category: 'todo' }, type: null, typeKind: null, typeColor: null, assignees: [], labels: [], priority: null, priorityLevel: null, updated: '2026-10-28T11:00:00.000+0000' },
      { key: 'ACME-3', title: 'Not saved yet', url: '', status: { id: '9', name: 'Done', category: 'done' }, type: null, typeKind: null, typeColor: null, assignees: [], labels: [], priority: null, priorityLevel: null },
    ],
  };
  assert.deepEqual(readCachedBoards(p), [], 'no file is no board');
  writeSavedTicket(p, savedTicketOf(read('ACME-1'), null, trackerKey(JIRA), new Date('2026-10-28T11:48:00Z')));
  writeFileSync(boardCacheFile(p), '');
  assert.deepEqual(readCachedBoards(p), [], 'a broken file is no board');
  writeSavedTicket(p, savedTicketOf(read('ACME-2'), null, trackerKey(JIRA), new Date('2026-10-28T10:00:00Z')));
  writeFileSync(boardCacheFile(p), JSON.stringify({ v: 1, boards: [{ tracker: trackerKey(JIRA), board, me: null, at: '2026-10-28T11:50:00.000Z' }] }));
  assert.deepEqual(savedBoards(p, [GITHUB], NOW), [], 'a board of a tracker the project no longer names is not given');
  const [view] = savedBoards(p, [JIRA], NOW);
  assert.deepEqual(view!.columns.map((c) => [c.name, c.cards.map((x) => x.key)]), [['To Do', ['ACME-1', 'ACME-2']], ['Done', ['ACME-3']]]);
  const cards = view!.columns.flatMap((c) => c.cards);
  assert.deepEqual(cards.map((c) => [c.key, c.saved, c.waiting]), [
    ['ACME-1', '2026-10-28T11:48:00.000Z', false], ['ACME-2', '2026-10-28T10:00:00.000Z', true], ['ACME-3', null, true],
  ]);
  assert.deepEqual([cards[0]!.assignees, cards[0]!.priority, cards[0]!.type], [['Jordan Kim'], 'High', 'Story']);
  assert.equal(ticketWaiting(p, readSavedTicket(p, 'ACME-2')!, NOW), true);
  assert.equal(ticketWaiting(p, readSavedTicket(p, 'ACME-1')!, NOW), false);
  writeSavedTicket(p, savedTicketOf(read('ACME-9'), null, trackerKey(JIRA), NOW));
  assert.equal(ticketWaiting(p, readSavedTicket(p, 'ACME-9')!, NOW), false, 'no board shows it: nothing waits');
});

test('edge case: when it was saved, in words, from just now to days; and a GitHub tracker with no repo is the project\'s own', () => {
  const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  assert.deepEqual([at(10_000), at(60_000), at(12 * 60_000), at(3 * 3_600_000), at(50 * 3_600_000), 'not a time'].map((s) => savedWords(s, NOW)),
    ['saved just now', 'saved 1 minute ago', 'saved 12 minutes ago', 'saved 3 hours ago', 'saved 2 days ago', 'saved just now']);
  assert.match(NOTHING_SAVED, /Open the project in the Command Center/);
  assert.deepEqual(boardTrackers({ trackers: [GITHUB, JIRA], github: { repo: 'acme/tool' } as never }).map((t) => t.repo ?? null), ['acme/tool', null]);
  assert.deepEqual(boardTrackers({ trackers: [GITHUB], github: null as never }), [GITHUB]);
});
