// Away from the window (D-164): the pure part that decides away from the focus changes and the time, the
// welcome back it says, and the Overview's Since you last looked that holds the span's news.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Away, AWAY_AFTER_MS, SINCE_PART, welcomeBack } from '../src/logic/away.ts';
import { NOTICE_KINDS, noticeCounts, OVERVIEW_COMMAND, type ProjectNotice, type NoticeKind } from '../src/logic/notices.ts';
import { PAGE_COMMANDS } from '../src/model/messages.ts';
import { SINCE_CLEAR, SINCE_LOOK, sinceGroup } from '../src/model/since.ts';
import { pageSource } from './support.ts';

const MIN = 60_000;
const news = (task: string, kind: NoticeKind = 'merged', root = '/a'): ProjectNotice => ({ root, notice: { kind, task, text: `${task} news`, urgent: false } });
const urgent = (task: string, root = '/a'): ProjectNotice => ({ root, notice: { kind: 'blocked', task, text: `${task} is blocked`, urgent: true } });
const tasks = (xs: readonly ProjectNotice[]) => xs.map((p) => p.notice.task);

test('the limit is ten minutes: focus lost for nine is not away, for ten is (edge case: just under and at the limit)', () => {
  assert.equal(AWAY_AFTER_MS, 10 * MIN);
  const a = new Away(true, 0);
  a.focus(false, 0);
  assert.equal(a.away(9 * MIN), false, 'nine minutes');
  assert.equal(a.away(AWAY_AFTER_MS - 1), false, 'a millisecond short');
  assert.equal(a.away(AWAY_AFTER_MS), true, 'ten minutes');
  assert.equal(new Away(true, 0).away(60 * MIN), false, 'with focus, never away');
});

test('a window that starts without focus counts from then, and a second loss of focus does not restart the count (edge case: state before the first change)', () => {
  const a = new Away(false, 0);
  assert.equal(a.away(10 * MIN), true);
  const b = new Away(true, 0);
  b.focus(false, 0);
  b.focus(false, 5 * MIN);
  assert.equal(b.away(10 * MIN), true, 'counted from the first loss');
});

test('while away, news is held and urgent notices show; with focus, every notice shows and none is held', () => {
  const a = new Away(true, 0);
  assert.deepEqual(tasks(a.sort([news('T-1'), urgent('T-2')], 0)), ['T-1', 'T-2'], 'here: all of it shows');
  assert.deepEqual(tasks(a.since()), [], 'and nothing is held');
  a.focus(false, 0);
  assert.deepEqual(tasks(a.sort([news('T-3')], 5 * MIN)), ['T-3'], 'gone five minutes: not away yet, so it shows');
  assert.deepEqual(tasks(a.sort([news('T-4'), urgent('T-5'), news('T-6')], 11 * MIN)), ['T-5'], 'away: only the urgent one shows');
  assert.deepEqual(tasks(a.since()), ['T-4', 'T-6'], 'the news is held, in order');
  assert.deepEqual(tasks(a.sort([], 12 * MIN)), [], 'a reload with nothing new holds nothing more (edge case: empty)');
  assert.deepEqual(tasks(a.since()), ['T-4', 'T-6']);
});

test('focus back ends the span and hands back its news; focus back before ten minutes ends nothing', () => {
  const a = new Away(true, 0);
  a.focus(false, 0);
  assert.equal(a.focus(true, 9 * MIN), null, 'not away: nothing to hand back');
  a.focus(false, 20 * MIN);
  a.sort([news('T-1')], 31 * MIN);
  assert.deepEqual(tasks(a.focus(true, 32 * MIN)!), ['T-1'], 'back: the span\'s news');
  assert.equal(a.away(50 * MIN), false, 'the span ended');
  assert.deepEqual(tasks(a.sort([news('T-2')], 50 * MIN)), ['T-2'], 'news shows again');
  assert.deepEqual(tasks(a.since()), ['T-1'], 'the list stays after the span, for the Overview');
});

test('a span with no news hands back none, and says nothing on return (edge case: no news in the span)', () => {
  const a = new Away(true, 0);
  a.focus(false, 0);
  a.sort([urgent('T-1')], 15 * MIN);
  const back = a.focus(true, 20 * MIN);
  assert.deepEqual(back, [], 'an away span, with nothing held');
  assert.equal(welcomeBack(back!), null, 'so no notification');
  // An away span no reload saw starts too: back after an hour of silence is still a span with no news.
  const quiet = new Away(true, 0);
  quiet.focus(false, 0);
  assert.deepEqual(quiet.focus(true, 60 * MIN), []);
});

test('two spans in a row keep only the newer span\'s news (edge case: state wider than one span)', () => {
  const a = new Away(true, 0);
  a.focus(false, 0);
  a.sort([news('T-1'), news('T-2')], 11 * MIN);
  a.focus(true, 12 * MIN);
  a.focus(false, 13 * MIN);
  a.sort([news('T-3')], 20 * MIN);
  assert.deepEqual(tasks(a.since()), ['T-1', 'T-2'], 'not away yet: the older list stays');
  a.sort([news('T-4')], 24 * MIN);
  assert.deepEqual(tasks(a.since()), ['T-4'], 'the new span starts the list again');
  assert.deepEqual(tasks(a.focus(true, 25 * MIN)!), ['T-4']);
});

test('Clear empties the list, and a later span fills it again (edge case: a choice cleared after it was made)', () => {
  const a = new Away(true, 0);
  a.focus(false, 0);
  a.sort([news('T-1')], 11 * MIN);
  a.focus(true, 12 * MIN);
  a.clear();
  assert.deepEqual(tasks(a.since()), []);
  a.focus(false, 13 * MIN);
  a.sort([news('T-2')], 30 * MIN);
  assert.deepEqual(tasks(a.since()), ['T-2']);
});

test('the welcome back counts the news as a burst words it, and its Show opens the Overview at Since you last looked', () => {
  const held = [news('T-1', 'merged'), news('T-2', 'passed'), news('T-3', 'merged', '/b')];
  assert.equal(noticeCounts(held), '1 review passed, 2 merged', 'by kind, in NOTICE_KINDS order, across projects');
  assert.deepEqual(welcomeBack(held), { text: 'While you were away: 1 review passed, 2 merged.', urgent: false, actions: [['Show', OVERVIEW_COMMAND]], task: null, part: SINCE_PART });
  assert.equal(SINCE_PART, 'overview:since');
});

test('Since you last looked: a line for each notice, its look, task key and text, which opens its task; Clear is a command the page may run', () => {
  assert.equal(sinceGroup([], [{ name: 'a', root: '/a' }]), null, 'nothing held: no group (edge case: empty)');
  const g = sinceGroup([news('T-1', 'merged'), news('T-2', 'review')], [{ name: 'a', root: '/a' }])!;
  assert.equal(g.title, 'Since you last looked');
  assert.equal(g.count, 2);
  assert.equal(g.part, SINCE_PART);
  assert.deepEqual(g.rows.map((r) => [r.look.label, r.look.icon, r.id, r.title, r.facts.length]), [['Merged', 'git-merge', 'T-1', 'T-1 news', 0], ['Ready for review', 'eye', 'T-2', 'T-2 news', 0]]);
  assert.deepEqual(g.rows[0]!.open, { kind: 'task', project: '/a', key: 'T-1' });
  assert.equal(g.clear.command, SINCE_CLEAR);
  assert.ok(PAGE_COMMANDS.includes(SINCE_CLEAR), 'the page may ask for Clear');
  // Two projects: each line names its own, and opens its task there.
  const two = sinceGroup([news('T-1'), news('T-1', 'merged', '/b')], [{ name: 'a', root: '/a' }, { name: 'b', root: '/b' }])!;
  assert.deepEqual(two.rows.map((r) => [r.facts[0]?.text, r.open]), [['a', { kind: 'task', project: '/a', key: 'T-1' }], ['b', { kind: 'task', project: '/b', key: 'T-1' }]]);
  assert.deepEqual(new Set(two.rows.map((r) => r.key)).size, 2, 'one task in two projects is two lines');
});

test('every notice kind has a look on Since you last looked, and the Overview draws the group between Needs you and the cards', () => {
  assert.deepEqual(Object.keys(SINCE_LOOK).sort(), [...NOTICE_KINDS].sort());
  const overview = pageSource('overview.ts');
  assert.ok(overview.includes('landingGroup(needs), ...(o.since ? [sinceSection(o.since)] : []), ...(o.cards.length ? [cards] : [])'), 'between Needs you and the cards');
  assert.ok(pageSource('since.ts').includes('h.dataset.part = g.part;'), 'its heading is where Show opens it');
});

test('a sprint change joins Since you last looked whether or not the person is away, with no task, and its line opens the Tasks tab (T-78)', () => {
  const a = new Away(true, 0);
  const sprint: ProjectNotice = { root: '/a', notice: { kind: 'sprint', task: '', text: 'Sprint 13 started after Sprint 12: 2 tickets carried into it, 1 went back to the backlog.', urgent: false } };
  a.note(sprint, 0);
  assert.deepEqual(a.since(), [sprint], 'held with focus, never shown as a notification');
  assert.equal(a.focus(true, 20 * MIN), null, 'focus that never left says nothing');
  const g = sinceGroup(a.since(), [{ name: 'a', root: '/a' }])!;
  assert.deepEqual([g.rows[0]!.look.label, g.rows[0]!.look.icon, g.rows[0]!.look.tone, g.rows[0]!.id, g.rows[0]!.title], ['Sprint changed', 'milestone', 'blue', null, sprint.notice.text], 'no task key: the line is the board\'s');
  assert.deepEqual(g.rows[0]!.open, { kind: 'go', section: 'tasks' });
  assert.equal(noticeCounts([sprint, { ...sprint }]), '2 sprints changed');
  a.clear();
  assert.deepEqual(a.since(), [], 'Clear takes it off too');
});

test('edge case: a sprint line that arrives after focus is lost but before away() first passes the limit is still shown (T-83)', () => {
  const a = new Away(true, 0);
  const sprint: ProjectNotice = { root: '/a', notice: { kind: 'sprint', task: '', text: 'Sprint 13 started.', urgent: false } };
  a.focus(false, 0);
  a.note(sprint, 12 * MIN);
  assert.equal(a.away(13 * MIN), true, 'the span starts now');
  assert.deepEqual(a.since(), [sprint], 'the first away() does not reset it');
  assert.deepEqual(a.focus(true, 14 * MIN), [sprint], 'and coming back brings it');
});
