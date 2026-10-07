// History: autopilot's steps, a held task's start, and a merged pull request.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { homeModel } from '../src/model/home.ts';
import { pageSource, hub } from './support.ts';

test('History tells each step autopilot took once, under Tasks, with its icon and words, in place of its moves (D-064)', () => {
  const h = hub();
  const at = (min: number) => new Date(Date.UTC(2026, 9, 5, 12, min)).toISOString();
  const later = (min: number, ms: number) => new Date(Date.parse(at(min)) + ms).toISOString();
  h.history = () => [
    { at: at(0), task: 'AV-1', title: 'Task AV-1', from: 'running', to: 'review', by: 'builder:AV-1' },
    // Autopilot's review asked for changes, and it re-dispatched: moves its steps tell.
    { at: later(1, 3), task: 'AV-1', title: 'Task AV-1', from: 'review', to: 'rework', by: 'reviewer:AV-1 for orchestrator:autopilot' },
    { at: later(2, 2), task: 'AV-1', title: 'Task AV-1', from: 'rework', to: 'running', by: 'orchestrator:autopilot' },
  ];
  h.autopilotLog = () => [
    { seq: 5, at: at(1), task: 'AV-1', step: 'review', outcome: 'done', verdict: 'changes', reason: 'No test for the login.' },
    { seq: 8, at: at(2), task: 'AV-1', step: 'dispatch', outcome: 'done' },
    { seq: 9, at: at(3), task: 'AV-3', step: 'land', outcome: 'done', pr: { number: 40, url: 'https://github.com/o/r/pull/40', opened: true } },
    { seq: 11, at: at(4), task: 'AV-3', step: 'land', outcome: 'failed', reason: 'The push was refused.' },
  ];
  // Two folders of one repo share its steps: each is told once.
  h.projects = [h.projects[0]!, { ...h.projects[0]!, root: '/r.worktrees/AV-2' }];
  const items = homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } }).overview.history;
  const steps = items.filter((i) => i.kind === 'autopilot');
  assert.deepEqual(steps.map((i) => i.kind === 'autopilot' && [i.task, i.look.icon, i.look.label, i.look.tone, i.detail, i.url]), [
    ['AV-3', 'warning', 'Autopilot couldn\'t land', 'orange', 'The push was refused.', null],
    ['AV-3', 'git-pull-request', 'Autopilot landed it: pull request #40', 'blue', null, 'https://github.com/o/r/pull/40'],
    ['AV-1', 'debug-restart', 'Autopilot re-dispatched it for the review\'s changes', 'blue', null, null],
    ['AV-1', 'request-changes', 'Autopilot\'s review asked for changes', 'neutral', 'No test for the login.', null],
  ], 'newest first, with its task\'s title');
  assert.equal(steps[0]!.kind === 'autopilot' && steps[0]!.title, 'Task AV-3');
  const moves = items.filter((i) => i.kind === 'move');
  assert.deepEqual(moves.map((i) => i.kind === 'move' && `${i.from}→${i.to}`), ['running→review', 'running→review'], 'autopilot\'s moves aren\'t listed twice; a builder\'s still are');
  // Tasks is the filter they count under: the page has four filters, not five.
  assert.match(pageSource(), /const historyKind = \(i: HistoryItem\): string => \(i\.kind === 'autopilot' \? 'move' : i\.kind\);/);
});

test('History tells autopilot\'s start of a held task, and one it couldn\'t make (D-093)', async () => {
  const { autopilotStepLook } = await import('../src/model/history.ts');
  const at = '2026-10-06T12:00:00.000Z';
  const look = (r: Record<string, unknown>) => { const l = autopilotStepLook({ seq: 1, at, task: 'AV-5', step: 'start', outcome: 'done', ...r } as never); return [l.look.label, l.look.icon, l.look.tone, l.detail]; };
  assert.deepEqual(look({ waitedFor: ['AV-1'] }), ['Autopilot started it: AV-1\'s files are free', 'rocket', 'blue', null]);
  assert.deepEqual(look({ shares: [{ task: 'AV-1', files: ['src/a.ts'] }] }), ['Autopilot started it: nothing else was ready, so it shares files with AV-1', 'rocket', 'blue', 'AV-1: src/a.ts']);
  assert.deepEqual(look({ outcome: 'failed', reason: 'No trust' }), ['Autopilot couldn\'t start it', 'warning', 'orange', 'No trust']);
});

test('History tells a pull request autopilot merged, with its link (GH-67)', () => {
  const h = hub();
  h.autopilotLog = () => [{ seq: 12, at: new Date(Date.UTC(2026, 9, 6, 12)).toISOString(), task: 'AV-3', step: 'merge', outcome: 'done', pr: { number: 40, url: 'https://github.com/o/r/pull/40', opened: false } }];
  const items = homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } }).overview.history;
  const merged = items.filter((i) => i.kind === 'autopilot').map((i) => i.kind === 'autopilot' && [i.task, i.look.icon, i.look.label, i.look.tone, i.detail, i.url]);
  assert.deepEqual(merged, [['AV-3', 'git-merge', 'Autopilot merged pull request #40', 'blue', 'acc sync moves it to done.', 'https://github.com/o/r/pull/40']]);
});
