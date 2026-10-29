// The saved tickets kept up to date (T-141): after a board load has drawn, only the tickets that changed, or have no
// saved copy, are read, one at a time and spaced, in the background; the person goes first; a stopped queue goes on
// from where it was; a failed read keeps the last good copy; and the saved tickets follow the boards and the sign-in.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Tracker } from '../../packages/core/src/config.ts';
import { readSavedTicket, readSavedTickets, savedTicketOf, trackerKey, type TicketRead, writeSavedTicket } from '../../packages/core/src/saved-tickets.ts';
import { TrackerError } from '../../packages/core/src/trackers/types.ts';
import { tempDir } from '../../packages/core/test/support.ts';
import { type FollowedBoard, SAVE_SPACING_MS, TicketSaver, type TicketSaverHost } from '../src/logic/ticket-saver.ts';

const ROOT = '/work/acme';
const TOKEN = 'tok-STANDIN-9f8e7d6c5b4a';
const JIRA = { kind: 'jira', site: 'acme.atlassian.net', project: 'ACME' } as unknown as Tracker;
const NOW = new Date('2026-10-28T12:00:00Z');
const T1 = '2026-10-28T09:00:00.000+0000';
const T2 = '2026-10-28T11:00:00.000+0000';

/** A stand-in tracker behind the saver: each ticket's last-changed time, every read it took, and a token it signs in with. */
function fakeHost(times: Record<string, string>, opts: { fail?: Record<string, unknown>; manual?: boolean } = {}) {
  const reads: string[] = [];
  const waits: number[] = [];
  const steps: (() => void)[] = [];
  const host: TicketSaverHost & { auth: string } = {
    auth: `Bearer ${TOKEN}`,
    async read(_root, _index, key) {
      reads.push(key);
      assert.equal(host.auth, `Bearer ${TOKEN}`, 'reads sign in with the token');
      if (opts.fail?.[key]) throw opts.fail[key];
      return {
        key, title: `Ticket ${key}`, url: `https://acme.atlassian.net/browse/${key}`, markdown: `About ${key}`, body: { blocks: [] }, updated: times[key]!,
        comments: [{ id: '1', author: { id: 'a', name: 'Jordan Kim' }, created: T1, body: { blocks: [] }, url: null }], related: [],
      } satisfies TicketRead;
    },
    changes: async () => ({ name: 'Changes', markdown: 'The Account flow.' }),
    // Immediately, or step by step when `manual`: each read waits for the test to let it go.
    wait: (ms) => { waits.push(ms); return opts.manual ? new Promise<void>((r) => steps.push(r)) : new Promise<void>((r) => setImmediate(r)); },
    now: () => NOW,
    warn: () => {},
  };
  /** Lets the next waiting read go, and waits for it to land. */
  const step = async () => {
    for (let i = 0; i < 20 && !steps.length; i++) await new Promise((r) => setImmediate(r));
    steps.shift()?.();
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  };
  return { host, reads, waits, step };
}

const cardsOf = (times: Record<string, string>) => Object.entries(times).map(([key, updated]) => ({ key, updated }));
const board = (times: Record<string, string>, tracker: Tracker = JIRA, index = 0): FollowedBoard => ({ index, tracker: trackerKey(tracker), cards: cardsOf(times) });
const paths = () => ({ stateDir: join(tempDir('acc-saver-'), 'acc') });

test('a first load saves one file per card, each with its read and last-changed times, spaced one at a time', async () => {
  const p = paths();
  const times = { 'ACME-1': T1, 'ACME-2': T1, 'ACME-3': T1 };
  const { host, reads, waits } = fakeHost(times);
  const saver = new TicketSaver(host);
  assert.deepEqual(saver.follow(ROOT, p, [board(times)]).queued, ['ACME-1', 'ACME-2', 'ACME-3']);
  await saver.idle(ROOT);
  assert.deepEqual(reads, ['ACME-1', 'ACME-2', 'ACME-3']);
  assert.deepEqual(readdirSync(join(p.stateDir, 'tickets')).sort(), ['ACME-1.json', 'ACME-2.json', 'ACME-3.json']);
  const t = readSavedTicket(p, 'ACME-2')!;
  assert.deepEqual([t.saved, t.changed, t.changes?.name], [NOW.toISOString(), T1, 'Changes']);
  assert.ok(waits.length >= 3 && waits.every((w) => w === SAVE_SPACING_MS), 'every read waits its turn');
});

test('a second load with nothing changed reads no ticket; one with two changed reads exactly those two', async () => {
  const p = paths();
  const times: Record<string, string> = { 'ACME-1': T1, 'ACME-2': T1, 'ACME-3': T1, 'ACME-4': T1 };
  const first = fakeHost(times);
  const saver = new TicketSaver(first.host);
  saver.follow(ROOT, p, [board(times)]);
  await saver.idle(ROOT);
  assert.equal(first.reads.length, 4);

  const again = fakeHost(times);
  const second = new TicketSaver(again.host);
  assert.deepEqual(second.follow(ROOT, p, [board(times)]).queued, [], 'nothing changed');
  await second.idle(ROOT);
  assert.equal(again.reads.length, 0, 'no ticket read');

  const moved = { ...times, 'ACME-2': T2, 'ACME-4': T2 };
  const third = fakeHost(moved);
  const saver3 = new TicketSaver(third.host);
  saver3.follow(ROOT, p, [board(moved)]);
  await saver3.idle(ROOT);
  assert.deepEqual(third.reads, ['ACME-2', 'ACME-4'], 'exactly the two that changed');
  assert.equal(readSavedTicket(p, 'ACME-4')!.changed, T2);
});

test('edge case: the full reads start only after the board has drawn, and wait while the person\'s board load runs', async () => {
  const p = paths();
  const times = { 'ACME-1': T1, 'ACME-2': T1 };
  const { host, reads } = fakeHost(times);
  const saver = new TicketSaver(host);
  const drawn: string[] = [];
  // As Trackers.loadBoards does: the load holds the queue, draws, then follows.
  await saver.person(async () => {
    drawn.push('board');
    saver.follow(ROOT, p, [board(times)]);
    assert.equal(reads.length, 0, 'follow reads nothing itself');
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    assert.equal(reads.length, 0, 'nothing is read while the load still runs');
  });
  await saver.idle(ROOT);
  assert.deepEqual([drawn, reads], [['board'], ['ACME-1', 'ACME-2']], 'read after the board drew');
});

test('a ticket the person opens jumps the queue: read then and there, saved, and never read again by the queue', async () => {
  const p = paths();
  const times = { 'ACME-1': T1, 'ACME-2': T1, 'ACME-3': T1 };
  const { host, reads, step } = fakeHost(times, { manual: true });
  const saver = new TicketSaver(host);
  saver.follow(ROOT, p, [board(times)]);
  await step();
  assert.deepEqual(reads, ['ACME-1']);
  const opened = await saver.open(ROOT, p, 0, trackerKey(JIRA), () => host.read(ROOT, 0, 'ACME-3'));
  assert.equal(opened.key, 'ACME-3', 'the person gets the read');
  assert.deepEqual(reads, ['ACME-1', 'ACME-3'], 'read ahead of ACME-2');
  assert.ok(readSavedTicket(p, 'ACME-3'), 'and saved');
  assert.deepEqual(saver.waiting(ROOT), ['ACME-2'], 'it left the queue');
  await step();
  await step();
  await saver.idle(ROOT);
  assert.deepEqual(reads, ['ACME-1', 'ACME-3', 'ACME-2'], 'ACME-3 was read once');
});

test('edge case: an opened ticket whose saved copy is current, or that no board shows, is not saved again', async () => {
  const p = paths();
  const times = { 'ACME-1': T1 };
  const { host } = fakeHost(times);
  const saver = new TicketSaver(host);
  saver.follow(ROOT, p, [board(times)]);
  await saver.idle(ROOT);
  const before = statSync(join(p.stateDir, 'tickets', 'ACME-1.json')).mtimeMs;
  let changesRead = 0;
  host.changes = async () => { changesRead++; return null; };
  await saver.open(ROOT, p, 0, trackerKey(JIRA), () => host.read(ROOT, 0, 'ACME-1'));
  assert.equal(changesRead, 0, 'current: no write, no changes-field read');
  assert.equal(statSync(join(p.stateDir, 'tickets', 'ACME-1.json')).mtimeMs, before);
  await saver.open(ROOT, p, 0, trackerKey(JIRA), () => host.read(ROOT, 0, 'OPS-7'));
  assert.equal(readSavedTicket(p, 'OPS-7'), null, 'a ticket no board shows is not kept');
});

test('edge case: a board the person switched to is read first, and the board on show leads a load', async () => {
  const p = paths();
  const other = { ...JIRA, project: 'BILL' } as unknown as Tracker;
  const a = { 'ACME-1': T1, 'ACME-2': T1 };
  const b = { 'BILL-1': T1 };
  const { host, reads, step } = fakeHost({ ...a, ...b }, { manual: true });
  const saver = new TicketSaver(host);
  assert.deepEqual(saver.follow(ROOT, p, [board(a), board(b, other, 1)], 1).queued, ['BILL-1', 'ACME-1', 'ACME-2'], 'the board on show first');
  saver.first(ROOT, 0);
  assert.deepEqual(saver.waiting(ROOT), ['ACME-1', 'ACME-2', 'BILL-1'], 'switched: its tickets go first');
  await step();
  assert.deepEqual(reads, ['ACME-1']);
  saver.stop(ROOT);
});

test('edge case: a queue stopped part-way goes on at the next load without reading again what it saved', async () => {
  const p = paths();
  const times = { 'ACME-1': T1, 'ACME-2': T1, 'ACME-3': T1, 'ACME-4': T1 };
  const first = fakeHost(times, { manual: true });
  const saver = new TicketSaver(first.host);
  saver.follow(ROOT, p, [board(times)]);
  await first.step();
  await first.step();
  saver.keepOnly([]); // the project closed
  await first.step();
  await saver.idle(ROOT);
  assert.deepEqual(first.reads, ['ACME-1', 'ACME-2'], 'stopped after two');
  assert.deepEqual(readSavedTickets(p).map((t) => t.key), ['ACME-1', 'ACME-2'], 'each saved as soon as it was read');

  const next = fakeHost(times);
  const window2 = new TicketSaver(next.host);
  window2.follow(ROOT, p, [board(times)]);
  await window2.idle(ROOT);
  assert.deepEqual(next.reads, ['ACME-3', 'ACME-4'], 'only the two it hadn\'t saved');

  const closing = fakeHost(times, { manual: true });
  const window3 = new TicketSaver(closing.host);
  window3.follow(ROOT, p, [board({ ...times, 'ACME-1': T2 })]);
  window3.stopAll(); // the window closed
  await closing.step();
  await window3.idle(ROOT);
  assert.deepEqual(closing.reads, [], 'a closed window reads nothing more');
});

test('edge case: a failed read keeps the last good copy, says why, and the rest go on; one outside the place is removed', async () => {
  const p = paths();
  const times = { 'ACME-1': T1, 'ACME-2': T1, 'ACME-3': T1 };
  const ok = fakeHost(times);
  const saver = new TicketSaver(ok.host);
  saver.follow(ROOT, p, [board(times)]);
  await saver.idle(ROOT);

  const moved = { 'ACME-1': T2, 'ACME-2': T2, 'ACME-3': T2 };
  const warned: string[] = [];
  const bad = fakeHost(moved, { fail: { 'ACME-1': new Error('Jira didn\'t answer'), 'ACME-2': new TrackerError('outside', 'ACME-2 isn\'t one of this repo\'s tickets') } });
  bad.host.warn = (l) => warned.push(l);
  const saver2 = new TicketSaver(bad.host);
  saver2.follow(ROOT, p, [board(moved)]);
  await saver2.idle(ROOT);
  assert.deepEqual(bad.reads, ['ACME-1', 'ACME-2', 'ACME-3'], 'the rest went on');
  const kept = readSavedTicket(p, 'ACME-1')!;
  assert.equal(kept.changed, T1, 'the last good copy');
  assert.deepEqual(kept.failed, { why: 'The ticket couldn\'t be read from its tracker: Jira didn\'t answer.', at: NOW.toISOString() });
  assert.equal(readSavedTicket(p, 'ACME-2'), null, 'outside the place: not kept (D-072)');
  assert.equal(readSavedTicket(p, 'ACME-3')!.changed, T2);
  assert.match(warned.join('\n'), /ACME-1/);

  const fixed = fakeHost(moved);
  const saver3 = new TicketSaver(fixed.host);
  saver3.follow(ROOT, p, [board({ 'ACME-1': T2, 'ACME-3': T2 })]);
  await saver3.idle(ROOT);
  assert.deepEqual(fixed.reads, ['ACME-1'], 'the failed one is read again next load');
  assert.equal(readSavedTicket(p, 'ACME-1')!.failed, undefined, 'and its mark goes');
});

test('edge case: a ticket that leaves the board, a tracker whose settings changed, and a sign-out each remove the saved tickets', async () => {
  const p = paths();
  const times = { 'ACME-1': T1, 'ACME-2': T1 };
  const { host, reads } = fakeHost(times);
  const saver = new TicketSaver(host);
  saver.follow(ROOT, p, [board(times)]);
  await saver.idle(ROOT);

  assert.deepEqual(saver.follow(ROOT, p, [board({ 'ACME-1': T1 })]).removed, ['ACME-2'], 'left the board');
  const moved = { ...JIRA, project: 'BILL' } as unknown as Tracker;
  assert.deepEqual(saver.follow(ROOT, p, [{ index: 0, tracker: trackerKey(moved), cards: [] }]).removed, ['ACME-1'], 'the tracker changed: the old one\'s tickets go');
  assert.deepEqual(readSavedTickets(p), []);

  saver.follow(ROOT, p, [board(times)]);
  await saver.idle(ROOT);
  assert.equal(readSavedTickets(p).length, 2);
  assert.deepEqual(saver.forget(ROOT, p, trackerKey(JIRA)), ['ACME-1', 'ACME-2'], 'signed out');
  assert.deepEqual(readSavedTickets(p), []);
  assert.equal(reads.length, 4);
  assert.deepEqual(saver.follow(ROOT, p, [{ index: 0, tracker: trackerKey(JIRA), cards: null }]).queued, [], 'a board that didn\'t load queues nothing');
});

test('edge case: a sign-out during a read writes nothing after it', async () => {
  const p = paths();
  const times = { 'ACME-1': T1 };
  const { host, reads } = fakeHost(times);
  let release!: () => void;
  const read = host.read.bind(host);
  host.read = async (...a) => { await new Promise<void>((r) => { release = r; }); return read(...a); };
  const saver = new TicketSaver(host);
  saver.follow(ROOT, p, [board(times)]);
  for (let i = 0; i < 10 && !release; i++) await new Promise((r) => setImmediate(r));
  saver.forget(ROOT, p, trackerKey(JIRA));
  release();
  await saver.idle(ROOT);
  assert.deepEqual(reads, ['ACME-1']);
  assert.equal(readSavedTicket(p, 'ACME-1'), null, 'not saved after the sign-out');
});

test('no saved file holds a sign-in: the host\'s stand-in token appears in no written byte', async () => {
  const p = paths();
  const times = { 'ACME-1': T1, 'ACME-2': T1 };
  const { host } = fakeHost(times, { fail: {} });
  const saver = new TicketSaver(host);
  saver.follow(ROOT, p, [board(times)]);
  await saver.idle(ROOT);
  writeSavedTicket(p, savedTicketOf(await host.read(ROOT, 0, 'ACME-1'), null, trackerKey(JIRA), NOW));
  const files = readdirSync(join(p.stateDir, 'tickets')).map((n) => join(p.stateDir, 'tickets', n));
  assert.equal(files.length, 2);
  for (const f of files) {
    const bytes = readFileSync(f);
    assert.equal(bytes.indexOf(TOKEN), -1, `${f} holds no token`);
    assert.equal(bytes.indexOf(Buffer.from(TOKEN).toString('base64')), -1, `${f} holds no encoded token`);
  }
});
