// History a page at a time, under a line for each day (D-170): the day names, the pages, the page's store of
// what it loaded, and the Overview's first page.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { HistoryItem } from '../src/model/history.ts';
import { newestFirst } from '../src/model/history.ts';
import { area, HISTORY_FILTERS, HISTORY_PAGE, historyCounts, historyKind, historyPage, historyReply, historyUpTo } from '../src/model/history-pages.ts';
import { homeModel } from '../src/model/home.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { LOOK } from '../src/model/shared.ts';
import { clock, dayName, dayNumber } from '../webview/days.ts';
import { afterOf, historyKind as pageKind, keepPlace, newestFirst as pageOrder, scaleOf, startFrom, withNewer, withPage } from '../webview/history-store.ts';
import { hub, root } from './support.ts';
import { tempDir } from '../../packages/core/test/support.ts';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 16, 12);
const iso = (ms: number) => new Date(ms).toISOString();
const look = LOOK('Running', 'sync', 'blue');
/** Entry n, n minutes before T0: a move, but every third a command and every fifth an answer. */
function entry(n: number): HistoryItem {
  const at = iso(T0 - n * MIN);
  const id = String(n).padStart(3, '0');
  if (n % 3 === 1) return { kind: 'run', id: `run:${id}`, at, label: `Command ${n}`, command: 'acc gate run', look, lines: [] };
  if (n % 5 === 2) return { kind: 'answer', id: `answer:${id}`, at, project: 'Acme', who: 'AV-1', session: 's', decision: { id, at: T0, askedAt: T0, sessionId: 's', icon: 'terminal', asked: 'wanted to run a command', code: null, look, detail: null } };
  return { kind: 'move', id: `move:${id}`, at, project: 'Acme', task: `AV-${n}`, title: `Task ${n}`, from: 'todo', to: 'running', by: 'human:jo', look };
}
const entries = (n: number, from = 0): HistoryItem[] => Array.from({ length: n }, (_, i) => entry(from + i));
const ids = (items: HistoryItem[]) => items.map((i) => i.id);
const moves = (n: number): HistoryItem[] => Array.from({ length: n }, (_, i) => ({ kind: 'move', id: `move:${String(i).padStart(3, '0')}`, at: iso(T0 - i * MIN), project: 'Acme', task: `AV-${i}`, title: `Task ${i}`, from: 'todo', to: 'running', by: 'human:jo', look }));

// ---------------------------------------------------------------- day names (AC 1)

const CHICAGO = 'America/Chicago';
/** 14:00 in Chicago on Friday 16 October 2026, which is 19:00 UTC. */
const NOW = Date.UTC(2026, 9, 16, 19);
const daysAgo = (n: number, hourUtc = 17) => Date.UTC(2026, 9, 16 - n, hourUtc);

test('a day is Today, Yesterday, its weekday within the last 7 days, then its date', () => {
  assert.equal(dayName(daysAgo(0), NOW, CHICAGO), 'Today');
  assert.equal(dayName(daysAgo(1), NOW, CHICAGO), 'Yesterday');
  assert.deepEqual([2, 3, 4, 5, 6].map((n) => dayName(daysAgo(n), NOW, CHICAGO)), ['Wednesday', 'Tuesday', 'Monday', 'Sunday', 'Saturday']);
  assert.equal(dayName(daysAgo(7), NOW, CHICAGO), 'Friday, 9 October', 'a week ago has its date, not its weekday again');
  assert.equal(dayName(iso(daysAgo(30)), NOW, CHICAGO), 'Wednesday, 16 September', 'an ISO time reads the same');
});

test('an older date in another year has its year', () => {
  assert.equal(dayName(Date.UTC(2025, 11, 24, 18), NOW, CHICAGO), 'Wednesday, 24 December 2025');
});

test('midnight falls in the person\'s time zone, not in UTC', () => {
  // 23:59 on Thursday in Chicago is 04:59 on Friday in UTC.
  const lateThursday = Date.UTC(2026, 9, 16, 4, 59);
  const earlyFriday = Date.UTC(2026, 9, 16, 5, 1);
  assert.equal(dayName(lateThursday, NOW, CHICAGO), 'Yesterday');
  assert.equal(dayName(earlyFriday, NOW, CHICAGO), 'Today');
  assert.equal(dayName(lateThursday, NOW, 'UTC'), 'Today', 'in UTC both are Friday');
  // Just after midnight in Chicago, two minutes before is yesterday there.
  assert.equal(dayName(lateThursday, earlyFriday, CHICAGO), 'Yesterday');
  assert.notEqual(dayNumber(lateThursday, CHICAGO), dayNumber(earlyFriday, CHICAGO));
  assert.equal(dayNumber(lateThursday, 'UTC'), dayNumber(earlyFriday, 'UTC'));
});

test('a time a clock ahead gives is Today, never a day not yet come', () => {
  assert.equal(dayName(NOW + 5 * MIN, NOW, CHICAGO), 'Today');
});

test('an entry\'s time is on the 24-hour clock, in the time zone', () => {
  assert.equal(clock(Date.UTC(2026, 9, 16, 19, 5), CHICAGO), '14:05');
  assert.equal(clock(iso(Date.UTC(2026, 9, 16, 19, 5)), 'UTC'), '19:05');
  assert.equal(clock(Date.UTC(2026, 9, 16, 5, 7), CHICAGO), '00:07');
});

// ---------------------------------------------------------------- pages (AC 2)

test('the first, next and last page of 100 entries, 40 at a time', () => {
  const all = moves(100);
  const first = historyPage(all, 'all');
  assert.equal(HISTORY_PAGE, 40);
  assert.deepEqual([first.items.length, first.items[0]!.id, first.items.at(-1)!.id, first.more], [40, 'move:000', 'move:039', true]);
  const next = historyPage(all, 'all', { at: first.items.at(-1)!.at, id: first.items.at(-1)!.id });
  assert.deepEqual([next.items.length, next.items[0]!.id, next.more], [40, 'move:040', true]);
  const last = historyPage(all, 'all', { at: next.items.at(-1)!.at, id: next.items.at(-1)!.id });
  assert.deepEqual([last.items.length, last.items[0]!.id, last.items.at(-1)!.id, last.more], [20, 'move:080', 'move:099', false]);
  const beyond = historyPage(all, 'all', { at: last.items.at(-1)!.at, id: last.items.at(-1)!.id });
  assert.deepEqual([beyond.items, beyond.more], [[], false], 'after the last entry there\'s nothing more');
  assert.deepEqual(first.counts, { all: 100, answer: 0, move: 100, run: 0 });
});

test('no entries: an empty page, nothing more, and every count zero', () => {
  const p = historyPage([], 'all');
  assert.deepEqual(p, { filter: 'all', items: [], more: false, counts: { all: 0, answer: 0, move: 0, run: 0 } });
  assert.deepEqual(historyPage([], 'run').items, []);
  assert.equal(historyUpTo([], 'all', 'move:000').found, false);
});

test('exactly 40 entries: one page, with no more to come', () => {
  const p = historyPage(moves(40), 'all');
  assert.deepEqual([p.items.length, p.more], [40, false]);
  assert.deepEqual([historyPage(moves(41), 'all').more], [true], 'one more makes a second page');
});

test('a page after an entry that\'s gone starts where it was, by its time and id', () => {
  const all = moves(100);
  // move:039 is gone since the page was loaded: the next page still starts at move:040.
  const gone = all.filter((i) => i.id !== 'move:039');
  const p = historyPage(gone, 'all', { at: all[39]!.at, id: 'move:039' });
  assert.equal(p.items[0]!.id, 'move:040');
  const up = historyUpTo(gone, 'all', 'move:039');
  assert.deepEqual([up.found, up.items.length, up.items[0]!.id], [false, 40, 'move:000'], 'up to a gone entry: just the next page');
});

test('two entries at the same moment go in their ids\' order, so a page after one starts at the other', () => {
  const at = iso(T0);
  const a: HistoryItem = { ...moves(1)[0]!, id: 'move:a', at };
  const b: HistoryItem = { ...moves(1)[0]!, id: 'move:b', at };
  assert.ok(newestFirst(a, b) < 0 && newestFirst(b, a) > 0);
  assert.deepEqual(ids(historyPage([a, b], 'all', { at, id: 'move:a' }).items), ['move:b']);
  assert.equal(pageOrder(a, b), newestFirst(a, b), 'the page\'s copy orders them the same');
});

test('the page\'s copy of newestFirst agrees with the model\'s for every pair, at other moments and the same one (T-70)', () => {
  const at = iso(T0);
  const all: HistoryItem[] = [...entries(10), { ...moves(1)[0]!, id: 'move:a', at }, { ...moves(1)[0]!, id: 'move:b', at }];
  let pairs = 0;
  for (const x of all) for (const y of all) { assert.equal(Math.sign(pageOrder(x, y)), Math.sign(newestFirst(x, y)), `${x.id} against ${y.id}`); pairs++; }
  assert.equal(pairs, all.length ** 2);
  assert.ok(all.some((x) => x.at !== at), 'some entries are at other moments');
});

test('a filter has its own pages, and its counts come from every entry, not the page', () => {
  const all = entries(300);
  const counts = historyCounts(all);
  assert.deepEqual(counts, { all: 300, answer: all.filter((i) => i.kind === 'answer').length, move: all.filter((i) => i.kind === 'move' || i.kind === 'autopilot').length, run: 100 });
  const runs = historyPage(all, 'run');
  assert.ok(runs.items.every((i) => i.kind === 'run'));
  assert.deepEqual([runs.items.length, runs.items[0]!.id, runs.more, runs.counts], [40, 'run:001', true, counts]);
  const next = historyPage(all, 'run', afterOf(startFrom(runs, 'all')));
  assert.deepEqual([next.items[0]!.id, next.items.length], ['run:121', 40]);
  for (const f of HISTORY_FILTERS) assert.ok(historyPage(all, f).items.length <= HISTORY_PAGE, f);
});

test('the pages up to an entry: every page from the start to the one that holds it', () => {
  const all = moves(100);
  const up = historyUpTo(all, 'all', 'move:045');
  assert.deepEqual([up.found, up.items.length, up.items.at(-1)!.id, up.more], [true, 80, 'move:079', true]);
  const fromLoaded = historyUpTo(all, 'all', 'move:045', { at: all[39]!.at, id: 'move:039' });
  assert.deepEqual([fromLoaded.items.length, fromLoaded.items[0]!.id], [40, 'move:040'], 'after what\'s loaded, only the page that holds it');
  const end = historyUpTo(all, 'all', 'move:099');
  assert.deepEqual([end.items.length, end.more], [100, false]);
  assert.equal(historyUpTo(entries(300), 'run', 'move:000').found, false, 'an entry the filter doesn\'t hold isn\'t found');
});

test('the extension answers a history-more with the page asked for, and says what it was asked', () => {
  const all = moves(100);
  const after = { at: all[39]!.at, id: 'move:039' };
  const next = historyReply(all, { type: 'history-more', filter: 'all', after });
  assert.deepEqual([next.type, next.filter, next.after, next.upTo, next.found, next.page.items[0]!.id], ['history-page', 'all', after, null, false, 'move:040']);
  const up = historyReply(all, { type: 'history-more', filter: 'all', upTo: 'move:090' });
  assert.deepEqual([up.after, up.upTo, up.found, up.page.items.length], [null, 'move:090', true, 100]);
});

test('the page may ask for a filter\'s page, and an invalid ask is ignored', () => {
  assert.ok(area.messages?.['history-more']);
  assert.ok(isFromWebview({ type: 'history-more', filter: 'all' }));
  assert.ok(isFromWebview({ type: 'history-more', filter: 'run', after: { at: iso(T0), id: 'run:001' }, upTo: 'run:121' }));
  assert.ok(!isFromWebview({ type: 'history-more', filter: 'everything' }), 'a filter there isn\'t');
  assert.ok(!isFromWebview({ type: 'history-more', filter: 'all', after: 'run:001' }), 'an after that isn\'t an entry\'s place');
  assert.ok(!isFromWebview({ type: 'history-more', filter: 'all', upTo: '' }), 'an empty entry to go up to');
});

test('the model and the page share one historyKind, and it counts every kind', () => {
  const all = [...entries(10), { kind: 'autopilot', id: 'step:x', at: iso(T0), project: 'Acme', task: 'AV-1', title: '', look, detail: null, url: null } as HistoryItem];
  assert.equal(pageKind, historyKind, 'one function, not two copies');
  assert.equal(historyKind({ ...all.at(-1)!, kind: 'edit' } as HistoryItem), 'move', 'a person\'s edit is a Task too');
  assert.equal(historyKind(all.at(-1)!), 'move', 'autopilot\'s steps are Tasks');
});

// ---------------------------------------------------------------- the Overview's first page (AC 3)

test('the home model sends at most 40 entries, with the count for each filter', () => {
  const h = hub();
  h.history = () => Array.from({ length: 70 }, (_, i) => ({ at: iso(T0 - i * MIN), task: `AV-${i}`, title: `Task ${i}`, from: 'todo', to: 'running', by: 'human:jo' }));
  const m = homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() }, runs: [{ id: 'r1', label: 'Run the checks', command: 'acc gate run', startedAt: T0 - MIN, endedAt: T0, code: 0, ok: true, stopped: false, lines: [] } as never], now: T0 });
  const page = m.overview.history;
  assert.equal(page.items.length, 40);
  assert.deepEqual(page.counts, { all: 71, answer: page.counts.answer, move: 70, run: 1 });
  assert.equal(page.more, true);
  const g = m.overview.landing.find((x) => x.key === 'history')!;
  assert.deepEqual([g.count, g.total], [71, 40], 'the card counts every entry, and lists the page');
  assert.equal(m.overview.cards.find((c) => c.key === 'history')!.count, 71);
});

test('a line on the Overview opens History at its entry by its id, which stays the same across refreshes', () => {
  const h = hub();
  h.history = () => [{ at: iso(T0), task: 'AV-1', title: 'Task AV-1', from: 'todo', to: 'running', by: 'human:jo' }];
  h.answers = [{ id: 'q1', sessionId: 's', cwd: '/r', tool: 'Bash', input: { command: 'ls' }, outcome: 'allowed', askedAt: T0 - MIN, endedAt: T0 - MIN } as never];
  const model = () => homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() }, now: T0 });
  const g = model().overview.landing.find((x) => x.key === 'history')!;
  const answer = g.all.find((r) => r.title.includes('wanted'))!;
  assert.deepEqual(answer.open, { kind: 'detail', detail: { kind: 'history', at: 'answer:q1' } });
  assert.deepEqual(ids(model().overview.history.items), ids(model().overview.history.items));
});

// A mutant: the model built to send every entry at once, which the page-size test must catch.
test('a mutant that sends every entry at once fails the page-size check', async () => {
  const src = join(root, 'src/model/history-pages.ts');
  const text = readFileSync(src, 'utf8');
  const find = 'return { filter, items: shown.slice(from, to), more: to < shown.length, counts: historyCounts(items) };';
  assert.equal(text.split(find).length, 2, 'the mutant\'s change is in history-pages.ts once');
  const dir = tempDir('acc-history-mutant-');
  const rel = (f: string) => pathToFileURL(join(root, 'src/model', f)).href;
  writeFileSync(join(dir, 'history-pages.ts'), text.replace(find, 'return { filter, items: shown.slice(from), more: false, counts: historyCounts(items) };')
    .replace("from './history.ts'", `from '${rel('history.ts')}'`).replace("from './shared.ts'", `from '${rel('shared.ts')}'`));
  const mutant = await import(pathToFileURL(join(dir, 'history-pages.ts')).href) as typeof import('../src/model/history-pages.ts');
  const sendsAPage = (page: typeof historyPage) => page(moves(100), 'all').items.length === HISTORY_PAGE;
  assert.ok(sendsAPage(historyPage), 'the real one sends a page');
  assert.ok(!sendsAPage(mutant.historyPage), 'the mutant sends all 100, and is caught');
});

// ---------------------------------------------------------------- what the page has loaded

test('All starts from the model\'s first page; another filter waits for its own, with nothing loaded yet', () => {
  const first = historyPage(entries(100), 'all');
  assert.deepEqual([startFrom(first, 'all').items.length, startFrom(first, 'all').waiting], [40, false]);
  const runs = startFrom(first, 'run');
  assert.deepEqual([runs.items, runs.waiting, runs.more, runs.counts], [[], true, true, first.counts]);
  assert.equal(afterOf(runs), undefined, 'nothing loaded: the first page is asked for');
});

test('a refresh adds new entries at the top, and keeps every page loaded', () => {
  const old = entries(100, 10);
  let l = startFrom(historyPage(old, 'all'), 'all');
  l = withPage(l, historyReply(old, { type: 'history-more', filter: 'all', after: afterOf(l) }))!;
  assert.equal(l.items.length, 80);
  const now = [...entries(3), ...old];
  const after = withNewer(l, historyPage(now, 'all'));
  assert.deepEqual([after.items.length, ids(after.items.slice(0, 4)), after.more, after.counts.all], [83, ['move:000', 'run:001', 'answer:002', 'run:010'], true, 103]);
  assert.deepEqual(withNewer(after, historyPage(now, 'all')).items.length, 83, 'the same model again adds nothing');
});

test('a refresh adds only the filter\'s own new entries, and while its page isn\'t here yet, only the counts', () => {
  const old = entries(100, 10);
  const runs = withPage(startFrom(historyPage(old, 'all'), 'run'), historyReply(old, { type: 'history-more', filter: 'run' }))!;
  const now = [...entries(3), ...old];
  assert.deepEqual(ids(withNewer(runs, historyPage(now, 'all')).items.slice(0, 2)), ['run:001', 'run:010']);
  const waiting = startFrom(historyPage(old, 'all'), 'run');
  assert.deepEqual(withNewer(waiting, historyPage(now, 'all')), { ...waiting, counts: historyCounts(now) });
});

test('a filter that held nothing takes its first new entry', () => {
  const old = moves(5).map((m) => ({ ...m, at: iso(Date.parse(m.at) - 10 * MIN) }));
  const none = withPage(startFrom(historyPage(old, 'all'), 'run'), historyReply(old, { type: 'history-more', filter: 'run' }))!;
  assert.deepEqual([none.items, none.more, none.waiting], [[], false, false]);
  const now = [entry(1), ...old];
  assert.deepEqual(ids(withNewer(none, historyPage(now, 'all')).items), ['run:001']);
});

test('a refresh whose whole first page is new starts All again, as there may be a gap', () => {
  const l = startFrom(historyPage(moves(50).map((m) => ({ ...m, at: iso(Date.parse(m.at) - 1000 * MIN) })), 'all'), 'all');
  const fresh = historyPage(moves(60), 'all');
  assert.deepEqual(withNewer(l, fresh), startFrom(fresh, 'all'));
});

test('a page that isn\'t for what\'s loaded now is ignored: a stale filter\'s, or one asked after another entry', () => {
  const all = moves(100);
  const l = startFrom(historyPage(all, 'all'), 'all');
  const reply = historyReply(all, { type: 'history-more', filter: 'all', after: afterOf(l) });
  assert.equal(withPage(l, { ...reply, filter: 'run' }), null);
  assert.equal(withPage(l, { ...reply, after: { at: all[10]!.at, id: 'move:010' } }), null);
  const next = withPage({ ...l, waiting: true }, reply)!;
  assert.deepEqual([next.items.length, next.waiting, next.more], [80, false, true]);
  const twice = withPage(next, { ...reply, after: afterOf(next)!, page: { ...reply.page, items: [...reply.page.items.slice(-2), all[80]!] } })!;
  assert.deepEqual([twice.items.length, twice.items.at(-1)!.id], [81, 'move:080'], 'entries already loaded aren\'t added twice');
  const last = withPage(twice, historyReply(all, { type: 'history-more', filter: 'all', after: afterOf(twice) }))!;
  assert.deepEqual([last.items.length, last.more], [100, false]);
});

/**
 * A scrolling box with a row for each id, 60 px each, as the page lays History out, its top at 100 px and
 * 400 px high. `draw` lays out other rows, as a redraw does; `scale` draws it all bigger or smaller than
 * its layout from its top, as the modal does while it grows in.
 */
function scrollBox(ids: string[], scrollTop: number) {
  let rows = ids;
  const box = {
    scrollTop,
    scale: 1,
    offsetHeight: 400,
    getBoundingClientRect: () => ({ top: 100, bottom: 100 + 400 * box.scale, height: 400 * box.scale }),
    querySelectorAll: () => rows.map((id, i) => ({ dataset: { id }, getBoundingClientRect: () => ({ top: 100 + (i * 60 - box.scrollTop) * box.scale, bottom: 100 + (60 + i * 60 - box.scrollTop) * box.scale }) })),
    draw(next: string[]) { rows = next; },
  };
  return box;
}
const topOf = (box: ReturnType<typeof scrollBox>, id: string) => box.querySelectorAll().find((r) => r.dataset.id === id)!.getBoundingClientRect().top;

test('a redraw with new entries above keeps the row in view where it was', () => {
  const box = scrollBox(['c', 'd', 'e', 'f'], 130);
  // e is the first row whose bottom is below the box's top, at 90 px, cut by the box's top edge.
  assert.equal(topOf(box, 'e'), 90);
  const place = keepPlace(box as unknown as HTMLElement);
  box.draw(['a', 'b', 'c', 'd', 'e', 'f']);
  place();
  assert.equal(box.scrollTop, 250, 'scrolled down by the two new rows, 120 px');
  assert.equal(topOf(box, 'e'), 90, 'e is where it was');
});

test('a redraw while the modal still grows in keeps the row where it was in the layout, not where it was drawn', () => {
  const box = scrollBox(['c', 'd', 'e', 'f'], 130);
  box.scale = 0.9;
  const place = keepPlace(box as unknown as HTMLElement);
  box.draw(['a', 'b', 'c', 'd', 'e', 'f']);
  // Open by the time it draws again: what it measured at 0.9 is the same place in the layout.
  box.scale = 1;
  place();
  assert.equal(box.scrollTop, 250, 'scrolled down by the two new rows, 120 px, not by what the scale moved');
  assert.equal(topOf(box, 'e'), 90, 'e is where it was');
});

test('scaleOf: an element drawn at its layout\'s size is 1, one growing in is under 1, and one with no height is 1', () => {
  const box = scrollBox([], 0);
  assert.equal(scaleOf(box as unknown as HTMLElement), 1);
  box.scale = 0.9;
  assert.equal(scaleOf(box as unknown as HTMLElement), 0.9);
  box.offsetHeight = 0;
  assert.equal(scaleOf(box as unknown as HTMLElement), 1, 'no height: it can\'t say, so 1');
});

test('at the top, nothing is kept: the new entries show', () => {
  const box = scrollBox(['c', 'd'], 0);
  const place = keepPlace(box as unknown as HTMLElement);
  box.draw(['a', 'b', 'c', 'd']);
  place();
  assert.equal(box.scrollTop, 0);
});

test('a row in view that\'s gone after the redraw leaves the scroll as it was', () => {
  const box = scrollBox(['c', 'd', 'e'], 130);
  const place = keepPlace(box as unknown as HTMLElement);
  box.draw(['a', 'c', 'e']);
  place();
  assert.equal(box.scrollTop, 130);
});
