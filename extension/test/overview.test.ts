// The Overview: what needs a person, an analysis's questions, and the merge queue.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskRow } from '../src/logic/shared.ts';
import { tasksModel } from '../src/model/tasks.ts';
import { homeModel } from '../src/model/home.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { needsYouCount } from '../src/model/overview.ts';
import { row, hub, asks, tooBig, analysed } from './support.ts';

test('the Overview gathers what needs a person, counts it once, and groups review apart', () => {
  const steps = [
    { id: 'B0.repo', part: 'project' as const, title: 'Repo', status: 'pass' as const, detail: 'ok' },
    { id: 'B2.identity', part: 'project' as const, title: 'Commit identity', status: 'fail' as const, detail: 'wrong' },
  ];
  const h = hub();
  const m = homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: steps, confirmed: new Set() } });
  assert.equal(m.kind, 'home');
  const titles = m.overview.attention.map((a) => [a.look.tone, a.title]);
  assert.deepEqual(titles.map(([tone]) => tone), [...titles.map(([tone]) => tone)].sort((x, y) => (x === 'orange' ? 0 : 1) - (y === 'orange' ? 0 : 1)), 'orange first');
  assert.ok(m.overview.attention.some((a) => a.title === 'AV-3 Task AV-3' && a.look.label === 'Blocked'));
  assert.ok(m.overview.attention.some((a) => a.title === 'av-2' && a.actions[0]!.command === 'acc.agent.attach'), 'an agent waiting on a prompt, with Attach');
  assert.ok(m.overview.attention.some((a) => a.key === 'setup' && a.go?.section === 'setup'));
  const people = m.overview.attention.filter((a) => a.look.tone === 'orange').length;
  const nav = Object.fromEntries(m.nav.map((n) => [n.section, n]));
  assert.deepEqual([nav.overview!.count, nav.overview!.attention], [people, true], 'the rail and the inbox agree');
  assert.deepEqual([nav.setup!.count, nav.setup!.attention], [1, true]);
  assert.deepEqual(m.nav.map((n) => n.section), ['overview', 'tasks', 'agents', 'worktrees', 'environments', 'setup', 'settings']);
  // An agent already shown through its task isn't listed twice.
  const linked = { ...h, taskRows: () => [{ ...h.taskRows('/r')[1]!, display: 'needs-you' as const, run: { bgId: 'bg1' }, agent: { label: 'Needs you: permission prompt', icon: 'bell', tone: 'orange' as const } }] };
  const once = homeModel({ hub: linked, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  assert.deepEqual(once.overview.attention.map((a) => a.title), ['AV-2 Task AV-2']);
  assert.ok(isFromWebview({ type: 'nav', section: 'agents' }) && !isFromWebview({ type: 'nav', section: 'secrets' }));
});

test('the Overview asks an analysis\'s questions in place, counts each task once, and lists what to analyze as ready (D-052)', () => {
  const rows: TaskRow[] = [
    { ...row('AV-5', 'todo', 'needs-you'), analysisRequired: true, analysis: asks },
    { ...row('AV-6', 'todo', 'needs-you'), analysisRequired: true, analysis: tooBig },
    { ...row('AV-7', 'todo', 'ready'), analysisRequired: true },
    { ...row('AV-8', 'todo', 'ready'), analysisRequired: true, analyzing: { sessionId: 's' } },
    { ...row('AV-9', 'todo', 'ready'), analysisRequired: true, analysis: analysed },
  ];
  const m = homeModel({ hub: { ...hub(), agents: [], taskRows: () => rows }, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const item = m.overview.attention.find((a) => a.title === 'AV-5 Task AV-5')!;
  assert.deepEqual([item.look.label, item.look.icon, item.look.tone], ['Needs you: 2 questions from its analysis', 'question', 'orange']);
  assert.deepEqual(item.analysis, { project: '/r', task: 'AV-5', questions: asks.open, canAsk: true }, 'its questions, to answer right there, or send to the client');
  assert.ok(!item.detail.includes('terminal'), 'not an agent waiting in its terminal');
  const split = m.overview.attention.find((a) => a.title === 'AV-6 Task AV-6')!;
  assert.deepEqual([split.look.label, split.analysis, split.detail], ['Needs you: too big for one task', undefined, 'Acme · its analysis suggests 3 smaller tasks, on its page']);
  assert.equal(m.overview.attention.length, 2, 'each task once');
  assert.equal(needsYouCount(m.overview), 2);
  assert.deepEqual([m.nav[0]!.count, m.nav[0]!.attention], [2, true], 'the rail, the badge and the status bar count the same');
  assert.deepEqual(m.overview.ready.map((r) => [r.id, r.action.label]), [['AV-7', 'Analyze'], ['AV-8', 'Watch the analysis'], ['AV-9', 'Dispatch']], 'a task held for its analysis stays in sight');
  const cards = tasksModel({ ...hub(), taskRows: () => rows }).projects[0]!.columns.find((c) => c.group === 'needs-you')!.cards;
  assert.deepEqual(cards.map((c) => [c.id, c.analysis?.label, c.actions[0]!.label]), [['AV-5', 'Needs you: 2 questions from its analysis', 'Answer'], ['AV-6', 'Needs you: too big for one task', 'See the split']]);
});

test('the Overview shows each repo\'s merge queue where auto-merge is on: each pull request\'s place, task, link and what it waits on, in blue with an icon; and says when autopilot is off (GH-73)', () => {
  const tools = {
    name: 'Tools', root: '/t', branch: 'main', worktrees: [],
    config: { github: { repo: 'o/t', account: 'me' }, environments: [{ name: 'main', branch: 'main', type: 'none' as const, org: null, default: true, protected: false, promotesTo: [] }], profile: 'generic', autonomy: 'review', autopilot: { autoMerge: true } },
  };
  const pr = (n: number) => ({ number: n, url: `https://github.com/o/t/pull/${n}`, state: 'open' });
  const queued = (id: string, place: number, ahead: string | null, phase: NonNullable<TaskRow['queue']>['phase'] = 'waiting', why: string | null = null): TaskRow => ({ ...row(id, 'review', 'review'), environment: 'main', pr: pr(place + 40), queue: { place, of: 3, ahead, phase, why } });
  const rows = (phase: NonNullable<TaskRow['queue']>['phase'], why: string | null = null) => [queued('GH-3', 3, 'GH-2'), queued('GH-1', 1, null, phase, why), queued('GH-2', 2, 'GH-1'), row('GH-4', 'review', 'review')];
  const model = (phase: NonNullable<TaskRow['queue']>['phase'], on = true, why: string | null = null) => homeModel({ hub: { ...hub(), projects: [tools], agents: [], taskRows: () => rows(phase, why) }, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() }, autopilot: () => (on ? 'on' : null) }).overview;

  const o = model('checking');
  assert.equal(o.queue.length, 1);
  const q = o.queue[0]!;
  assert.deepEqual([q.project, q.root, q.off], ['Tools', '/t', false]);
  assert.deepEqual(q.rows.map((r) => [r.place, r.id, r.pr?.number, r.look.label]), [[1, 'GH-1', 41, 'Running the full check'], [2, 'GH-2', 42, 'Behind GH-1'], [3, 'GH-3', 43, 'Behind GH-2']], 'head first; GH-4 isn\'t in it');
  assert.deepEqual(q.rows[0]!.ref, { project: '/t', task: 'GH-1' });
  // Each phase of the head's turn: its words and its icon, in blue. Orange is only for what needs you, and nothing in the queue does.
  const looks = (['waiting', 'refreshing', 'slot', 'checking', 'github', 'merging'] as const).map((p) => model(p).queue[0]!.rows[0]!.look);
  assert.deepEqual(looks.map((l) => [l.label, l.icon]), [
    ['Next to merge', 'arrow-circle-right'], ['Merging main in', 'repo-pull'], ['Waiting for a heavy-check slot', 'watch'],
    ['Running the full check', 'sync~spin'], ['Waiting for GitHub\'s checks', 'github-action'], ['Merging', 'git-merge'],
  ]);
  assert.ok([...looks, ...q.rows.map((r) => r.look)].every((l) => l.tone === 'blue'));
  // Held on anything else, the head says what, in that wait's own words, all of them on hover: not GitHub's checks for every wait.
  const why = 'GitHub is still working out whether pull request #41 can merge.';
  const held = model('held', true, why).queue[0]!.rows;
  assert.deepEqual([held[0]!.look, held[0]!.tip, held[1]!.tip], [{ label: 'GitHub is still working out whether pull request #41 can merge', icon: 'clock', tone: 'blue' }, why, undefined]);
  assert.equal(q.rows[0]!.tip, undefined, 'a phase\'s own words need no tip');
  assert.equal(model('held', false, why).queue[0]!.rows[0]!.look.label, 'Autopilot is off');
  // Autopilot off: the queue doesn't move, and its head says so.
  const off = model('waiting', false).queue[0]!;
  assert.deepEqual([off.off, off.rows[0]!.look.label, off.rows[0]!.look.tone, off.rows[1]!.look.label], [true, 'Autopilot is off', 'blue', 'Behind GH-1']);
  // Nothing in the queue waits on you: it's in the panel, not in Waiting on you. A task in review outside it still is.
  assert.deepEqual(o.attention.map((a) => a.title), ['GH-4 Task GH-4']);
  // No panel where auto-merge is off, or nothing is in the queue.
  assert.deepEqual(homeModel({ hub: { ...hub(), projects: [{ ...tools, config: { ...tools.config, autopilot: {} } }], agents: [], taskRows: () => rows('waiting') }, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } }).overview.queue, []);
  assert.deepEqual(homeModel({ hub: { ...hub(), projects: [tools], agents: [], taskRows: () => [row('GH-4', 'review', 'review')] }, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } }).overview.queue, []);
});
