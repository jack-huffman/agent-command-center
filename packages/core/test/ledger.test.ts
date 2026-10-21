import assert from 'node:assert/strict';
import { appendFileSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import {
  ACTORS, applyMove, builderStopped, DONE_COMMAND, type ClaudeSession, checkMove, closedPr, displayState, emptyLedger, type Emit, findRule, type Hooks, isReady, type Ledger, type LedgerEvent,
  moveTask, mutate, noGateHooks, type NoteInput, noteInput, noteMarkdown, normalizeId, readLedger, readRuns, readyTasks, type RepoAgents, RULES, type SessionTie, sessionsOf, shownNote, type State, STATES, type Task, tieSession, upsertTasks,
} from '../src/ledger.ts';
import { sessionName } from '../src/names.ts';
import { repoPaths } from '../src/paths.ts';
import { makeRepo, SF_CONFIG, tempDir } from './support.ts';

const config = parseConfig(JSON.parse(JSON.stringify(SF_CONFIG))).config!;
const clock = () => new Date('2026-10-01T12:00:00Z');
const sink: Emit = () => {};

function ledgerWith(...specs: Array<Partial<Task> & { id: string }>): Ledger {
  const l = emptyLedger();
  for (const s of specs) {
    upsertTasks(l, config, [{ source: { kind: 'jira', key: s.id }, title: s.title ?? s.id, deps: s.deps }], 'human', 'human:test', sink, clock);
    const t = l.tasks.find((x) => x.id === s.id)!;
    if (s.state) t.state = s.state;
  }
  return l;
}
const task = (l: Ledger, id: string) => l.tasks.find((t) => t.id === id)!;

test('ids: GitHub refs become GH-n, Jira keys are upper-cased, manual tasks count up', () => {
  assert.equal(normalizeId('#12', 'github'), 'GH-12');
  assert.equal(normalizeId('12', 'github'), 'GH-12');
  assert.equal(normalizeId('gh-7', 'jira'), 'GH-7');
  assert.equal(normalizeId('acme-34'), 'ACME-34');
  const l = emptyLedger();
  const r = upsertTasks(l, config, [
    { source: { kind: 'manual' }, title: 'one' },
    { source: { kind: 'manual' }, title: 'two' },
    { source: { kind: 'github', key: '#5', url: 'https://github.com/x/y/issues/5' }, title: 'gh', deps: ['#4'] },
    { source: { kind: 'jira', key: 'ACME-1' }, title: 'jira' },
  ], 'human', 'human:test', sink, clock);
  assert.deepEqual(r.added, ['T-1', 'T-2', 'GH-5', 'ACME-1']);
  assert.deepEqual(task(l, 'GH-5').deps, ['GH-4']);
  assert.equal(task(l, 'GH-5').environment, 'dev');
  assert.equal(task(l, 'T-1').history[0]!.to, 'todo');
});

test('intake is idempotent, refreshes text, and never changes state', () => {
  const l = emptyLedger();
  const events: Omit<LedgerEvent, 'seq' | 'at'>[] = [];
  const emit: Emit = (e) => events.push(e);
  upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-1' }, title: 'Old' }], 'human', 'h', emit, clock);
  task(l, 'ACME-1').state = 'running';
  const again = upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-1' }, title: 'New', brief: 'More detail' }], 'human', 'h', emit, clock);
  assert.deepEqual(again.updated, ['ACME-1']);
  assert.equal(task(l, 'ACME-1').title, 'New');
  assert.equal(task(l, 'ACME-1').state, 'running');
  const same = upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-1' }, title: 'New', brief: 'More detail' }], 'human', 'h', emit, clock);
  assert.deepEqual(same.unchanged, ['ACME-1']);
  assert.deepEqual(events.map((e) => e.type), ['task.added', 'task.updated']);
});

test('intake refuses bad input, unknown environments and protected ones', () => {
  const l = emptyLedger();
  const r = upsertTasks(l, config, [
    { source: { kind: 'jira', key: 'ACME-1' }, title: '' },
    { source: { kind: 'jira' }, title: 'no key' },
    { source: { kind: 'jira', key: 'ACME-2' }, title: 'x', environment: 'qa' },
    { source: { kind: 'jira', key: 'ACME-3' }, title: 'x', environment: 'production' },
    { source: { kind: 'jira', key: 'not a key' }, title: 'x' },
  ], 'human', 'h', sink, clock);
  assert.equal(r.added.length, 0);
  assert.equal(r.errors.length, 5);
  assert.match(r.errors.join(' '), /protected/);
});

test('every state has rules in and out, and every allowed move works for its actors', () => {
  for (const s of STATES) {
    assert.ok(RULES.some((r) => r.to === s || r.from === 'any'), `nothing leads to ${s}`);
  }
  const passAll: Hooks = noGateHooks;
  for (const rule of RULES) {
    const from: State[] = rule.from === 'any' ? STATES.filter((s) => s !== 'blocked' && s !== 'done') : [rule.from];
    for (const f of from) {
      for (const actor of ACTORS) {
        const l = ledgerWith({ id: 'ACME-1', state: f });
        // A builder's finish gives its note (D-106), and ends a run.
        const note = rule.requires.includes('note') ? { landed: ['it'], moved: [], open: [] } : undefined;
        if (note) task(l, 'ACME-1').run = { branch: 'task/ACME-1' };
        const problems = checkMove(l, config, task(l, 'ACME-1'), { to: rule.to, actor, by: actor, reason: 'because', note }, passAll);
        if (rule.actors.includes(actor)) assert.deepEqual(problems, [], `${actor} ${f} → ${rule.to}`);
        else assert.match(problems.join(), /can't move a task/, `${actor} should not ${f} → ${rule.to}`);
      }
    }
  }
});

test('moves without a rule need a person, --force and a reason, and are recorded as overrides', () => {
  const l = ledgerWith({ id: 'ACME-1', state: 'todo' });
  const t = task(l, 'ACME-1');
  assert.equal(findRule('todo', 'review'), undefined);
  assert.match(checkMove(l, config, t, { to: 'review', actor: 'human', by: 'h' }, noGateHooks).join(), /no rule for todo → review/);
  assert.match(checkMove(l, config, t, { to: 'review', actor: 'orchestrator', by: 'o', force: true, reason: 'x' }, noGateHooks).join(), /Only a person/);
  assert.match(checkMove(l, config, t, { to: 'review', actor: 'human', by: 'h', force: true }, noGateHooks).join(), /needs --reason/);
  assert.deepEqual(checkMove(l, config, t, { to: 'review', actor: 'human', by: 'h', force: true, reason: 'reviewed by hand' }, noGateHooks), []);
  const entry = applyMove(t, { to: 'review', actor: 'human', by: 'h', force: true, reason: 'reviewed by hand' }, sink, clock);
  assert.equal(entry.override, true);
  assert.equal(t.state, 'review');
});

test('todo → done is only for sync, when an issue closes before work starts; a person still forces it', () => {
  const l = ledgerWith({ id: 'GH-3', state: 'todo' });
  const t = task(l, 'GH-3');
  assert.deepEqual(findRule('todo', 'done')?.actors, ['sync']);
  assert.match(checkMove(l, config, t, { to: 'done', actor: 'human', by: 'h' }, noGateHooks).join(), /A human can't move a task from todo to done/);
  assert.deepEqual(checkMove(l, config, t, { to: 'done', actor: 'sync', by: 'acc intake' }, noGateHooks), []);
  assert.deepEqual(checkMove(l, config, t, { to: 'done', actor: 'human', by: 'h', force: true, reason: 'done by hand' }, noGateHooks), []);
});

test('blocked and done cannot be re-blocked; blocking records the reason as the blocker', () => {
  assert.equal(findRule('done', 'blocked'), undefined);
  assert.equal(findRule('blocked', 'blocked'), undefined);
  const l = ledgerWith({ id: 'ACME-1', state: 'running' });
  const t = task(l, 'ACME-1');
  assert.match(checkMove(l, config, t, { to: 'blocked', actor: 'builder', by: 'b' }, noGateHooks).join(), /needs a reason/);
  applyMove(t, { to: 'blocked', actor: 'builder', by: 'b', reason: 'org is down' }, sink, clock);
  assert.equal(t.blocker, 'org is down');
  applyMove(t, { to: 'todo', actor: 'human', by: 'h' }, sink, clock);
  assert.equal(t.blocker, null);
});

test('dispatching needs every dependency done', () => {
  const l = ledgerWith({ id: 'ACME-1', state: 'running' }, { id: 'ACME-2', deps: ['ACME-1', 'ACME-9'] });
  const problems = checkMove(l, config, task(l, 'ACME-2'), { to: 'running', actor: 'human', by: 'h' }, noGateHooks).join(' ');
  assert.match(problems, /waiting on ACME-1, which is running/);
  assert.match(problems, /depends on ACME-9, which isn't in the ledger/);
  task(l, 'ACME-1').state = 'done';
  l.tasks.push({ ...task(l, 'ACME-1'), id: 'ACME-9' });
  assert.deepEqual(checkMove(l, config, task(l, 'ACME-2'), { to: 'running', actor: 'human', by: 'h' }, noGateHooks), []);
});

test('the agent cap stops dispatch at agents.max (2 in this config)', () => {
  const l = ledgerWith({ id: 'ACME-1', state: 'running' }, { id: 'ACME-2', state: 'running' }, { id: 'ACME-3' }, { id: 'ACME-4', state: 'rework' });
  assert.match(checkMove(l, config, task(l, 'ACME-3'), { to: 'running', actor: 'orchestrator', by: 'o' }, noGateHooks).join(), /2 builders are running in this project, and its cap is 2 \(agents\.max\)/);
  assert.match(checkMove(l, config, task(l, 'ACME-4'), { to: 'running', actor: 'human', by: 'h' }, noGateHooks).join(), /its cap is 2 \(agents\.max\)/);
  task(l, 'ACME-2').state = 'review';
  assert.deepEqual(checkMove(l, config, task(l, 'ACME-3'), { to: 'running', actor: 'orchestrator', by: 'o' }, noGateHooks), []);
});

test('protected environments never get agent work', () => {
  const l = ledgerWith({ id: 'ACME-1' });
  task(l, 'ACME-1').environment = 'production';
  assert.match(checkMove(l, config, task(l, 'ACME-1'), { to: 'running', actor: 'human', by: 'h' }, noGateHooks).join(), /"Production" is protected/);
});

test('finishing needs passing receipts for every required check', () => {
  const l = ledgerWith({ id: 'ACME-1', state: 'running' });
  const missing: Hooks = { missingGates: () => ['format', 'validate'] };
  assert.match(checkMove(l, config, task(l, 'ACME-1'), { to: 'review', actor: 'builder', by: 'b' }, missing).join(), /haven't passed on the current commit: format, validate/);
  task(l, 'ACME-1').run = { branch: 'task/ACME-1' };
  assert.deepEqual(checkMove(l, config, task(l, 'ACME-1'), { to: 'review', actor: 'builder', by: 'b', note: { landed: ['A'], moved: [], open: [] } }, noGateHooks), []);
});

test('a builder finishes with a note, which stays with its run and its event (D-106)', () => {
  const l = ledgerWith({ id: 'ACME-1', state: 'running' });
  const t = task(l, 'ACME-1');
  t.run = { branch: 'task/ACME-1', startedAt: '2026-10-01T11:00:00Z' };
  const builder = (note?: NoteInput) => checkMove(l, config, t, { to: 'review', actor: 'builder', by: 'builder:ACME-1', ...(note ? { note } : {}) }, noGateHooks);

  // Without one, or with a part left out, it's refused with the exact command to run instead.
  const none = builder();
  assert.equal(none.length, 1);
  assert.ok(none[0]!.includes(DONE_COMMAND), none.join());
  assert.match(none[0]!, /says nothing about --landed, --moved, --open/);
  assert.match(builder({ landed: ['A'] }).join(), /says nothing about --moved, --open/);
  assert.match(builder(noteInput({ landed: ['none'], moved: ['none'], open: ['none'] })).join(), /says nothing about --landed/, 'something landed, or it isn\'t done');
  assert.deepEqual(builder(noteInput({ landed: ['A'], moved: ['none'], open: ['none'] })), [], 'none says there was nothing');
  // A person's move needs none.
  assert.deepEqual(checkMove(l, config, t, { to: 'review', actor: 'human', by: 'human:jo' }, noGateHooks), []);

  // The limits: ten lines a part, three hundred characters a line.
  assert.match(builder({ landed: ['A'], moved: Array.from({ length: 11 }, (_, i) => `line ${i}`), open: [] }).join(), /--moved has 11 lines\. It takes at most 10/);
  assert.match(builder({ landed: ['x'.repeat(301)], moved: [], open: [] }).join(), /A line in the note's --landed is over 300 characters/);
  assert.deepEqual(builder({ landed: ['x'.repeat(300)], moved: Array.from({ length: 10 }, () => 'm'), open: [] }), []);
  // A note ends a run: not a move to rework or to do, nor a task with no run.
  assert.match(checkMove(l, config, t, { to: 'todo', actor: 'human', by: 'h', reason: 'r', note: { open: ['x'] } }, noGateHooks).join(), /A note goes with a run's end/);
  assert.match(checkMove(ledgerWith({ id: 'ACME-2' }), config, task(ledgerWith({ id: 'ACME-2' }), 'ACME-2'), { to: 'blocked', actor: 'human', by: 'h', reason: 'r', note: { open: ['x'] } }, noGateHooks).join(), /has no run/);

  // Its lines as given: one each, whitespace collapsed, blanks and "none" dropped, a part left out undefined.
  assert.deepEqual(noteInput({ landed: ['  The  page\nworks ', ''], open: ['None'] }), { landed: ['The page works'], open: [] });

  const events: Omit<LedgerEvent, 'seq' | 'at'>[] = [];
  applyMove(t, { to: 'review', actor: 'builder', by: 'builder:ACME-1', note: { landed: ['A'], moved: ['3 tests added'], open: ['B', 'C'] } }, (e) => events.push(e), clock);
  const note = { landed: ['A'], moved: ['3 tests added'], open: ['B', 'C'], at: '2026-10-01T12:00:00.000Z', by: 'builder:ACME-1', ended: 'review' };
  assert.deepEqual(t.run.note, note);
  assert.deepEqual(events[0]!.data.note, note, 'the task.moved event carries it');
  assert.deepEqual(shownNote(t), { note, fromLast: false, missing: false });

  // A block may carry one too, and says it ended blocked.
  const b = ledgerWith({ id: 'ACME-3', state: 'running' });
  task(b, 'ACME-3').run = { branch: 'task/ACME-3' };
  applyMove(task(b, 'ACME-3'), { to: 'blocked', actor: 'builder', by: 'builder:ACME-3', reason: 'r', note: { open: ['Z'] } }, sink, clock);
  assert.deepEqual(task(b, 'ACME-3').run!.note, { landed: [], moved: [], open: ['Z'], at: '2026-10-01T12:00:00.000Z', by: 'builder:ACME-3', ended: 'blocked' });
});

test('the note a task shows: its run\'s, the last run\'s while one runs, or that it left none (D-106)', () => {
  const note = { landed: ['A'], moved: [], open: [], at: 'a', by: 'b', ended: 'review' as const };
  assert.deepEqual(shownNote({ state: 'todo', run: null }), { note: null, fromLast: false, missing: false });
  assert.deepEqual(shownNote({ state: 'running', run: {} }), { note: null, fromLast: true, missing: false }, 'a first run');
  assert.deepEqual(shownNote({ state: 'running', run: { before: note } }), { note, fromLast: true, missing: false });
  assert.deepEqual(shownNote({ state: 'running', run: { before: null } }), { note: null, fromLast: true, missing: true });
  assert.deepEqual(shownNote({ state: 'review', run: {} }), { note: null, fromLast: false, missing: true });
  assert.deepEqual(shownNote({ state: 'done', run: {} }), { note: null, fromLast: false, missing: false }, 'merged: not news');
  assert.deepEqual(noteMarkdown({ landed: ['A'], moved: [], open: ['B'] }), ['**What landed**', '', '- A', '', '**Numbers that moved**', '', '- none', '', '**Still open**', '', '- B']);
});

test('ready and needs-you are derived, never stored', () => {
  const l = ledgerWith({ id: 'ACME-1', state: 'done' }, { id: 'ACME-2', deps: ['ACME-1'] }, { id: 'ACME-3', deps: ['ACME-2'] }, { id: 'ACME-4', state: 'running' });
  assert.equal(isReady(l, task(l, 'ACME-2')), true);
  assert.equal(isReady(l, task(l, 'ACME-3')), false);
  assert.deepEqual(readyTasks(l).map((t) => t.id), ['ACME-2']);
  assert.equal(displayState(l, task(l, 'ACME-2')), 'ready');
  assert.equal(displayState(l, task(l, 'ACME-3')), 'todo');
  assert.equal(displayState(l, task(l, 'ACME-4'), { state: 'blocked' }), 'needs-you');
  assert.equal(displayState(l, task(l, 'ACME-4'), { state: 'working', status: 'busy' }), 'running');
});

test('an open pull request that conflicts with its base shows its task in review as needs you, like failing checks', () => {
  const l = ledgerWith({ id: 'ACME-1', state: 'review' });
  const t = task(l, 'ACME-1');
  const pr = { number: 7, url: 'https://github.com/acme/x/pull/7', state: 'open' as const, ci: 'passing' as const };
  t.pr = { ...pr, conflicts: [] };
  assert.equal(displayState(l, t), 'review', 'it merges cleanly');
  t.pr = { ...pr, conflicts: ['docs/DECISIONS.md'] };
  assert.equal(displayState(l, t), 'needs-you');
  t.pr = { ...pr, state: 'merged', conflicts: ['docs/DECISIONS.md'] };
  assert.equal(displayState(l, t), 'review', 'only an open pull request\'s conflicts count');
  t.pr = { ...pr, ci: 'failing' };
  assert.equal(displayState(l, t), 'needs-you');
});

test('a closed pull request shows its task in review as needs you; blocked stays blocked and done stays done (D-063)', () => {
  const l = ledgerWith({ id: 'ACME-1', state: 'review' });
  const t = task(l, 'ACME-1');
  t.pr = { number: 7, url: 'https://github.com/acme/x/pull/7', state: 'closed' };
  assert.deepEqual([closedPr(t), displayState(l, t)], [t.pr, 'needs-you'], 'a person moved it back to review: autopilot won\'t replace it');
  t.state = 'blocked';
  assert.deepEqual([closedPr(t), displayState(l, t)], [null, 'blocked'], 'as acc sync left it');
  t.state = 'done';
  assert.deepEqual([closedPr(t), displayState(l, t)], [null, 'done']);
  t.state = 'review';
  t.pr = { ...t.pr, state: 'open' };
  assert.deepEqual([closedPr(t), displayState(l, t)], [null, 'review'], 'landed again');
});

test('a step autopilot couldn\'t take shows its task as needs you, in the state it failed in, until any move clears it (D-055)', () => {
  const l = ledgerWith({ id: 'ACME-1', state: 'rework' });
  const t = task(l, 'ACME-1');
  const failed = { step: 'dispatch' as const, sha: 'a'.repeat(40), state: 'rework' as const, reason: 'Claude Code doesn\'t trust the repo yet.', at: '2026-10-05T12:00:00.000Z' };
  t.autopilot = { failed };
  assert.equal(displayState(l, t), 'needs-you');
  t.autopilot = { failed: { ...failed, state: 'review' } };
  assert.equal(displayState(l, t), 'rework', 'only in the state it failed in');
  t.autopilot = { failed };
  applyMove(t, { to: 'running', actor: 'human', by: 'human:jordan' }, sink, clock);
  assert.deepEqual([t.autopilot.failed, displayState(l, t)], [null, 'running'], 'a person re-dispatched it by hand');
});

test('a task waiting for another\'s files stays Ready, needs you once its start failed, and any move ends the wait (D-093)', () => {
  const hold = { at: '2026-10-06T10:00:00.000Z', actor: 'human' as const, by: 'human:jordan', waitsFor: [{ task: 'ACME-2', files: ['src/a.ts'] }], first: ['ACME-3'] };
  for (const to of ['running', 'blocked', 'done'] as const) {
    const l = ledgerWith({ id: 'ACME-1' });
    const t = task(l, 'ACME-1');
    t.held = { ...hold };
    assert.equal(displayState(l, t), 'ready', 'it stays in the Ready lane');
    t.held = { ...hold, failed: { reason: 'Claude Code doesn\'t trust the repo yet.', at: hold.at, by: 'human:jordan' } };
    assert.equal(displayState(l, t), 'needs-you');
    applyMove(t, { to, actor: to === 'done' ? 'sync' : 'human', by: 'human:jordan', reason: 'because' }, sink, clock);
    assert.equal(t.held, null, `a move to ${to} ends it`);
  }
});

test('autopilot may send work in review back, with a reason; a builder may not (D-076)', () => {
  const l = ledgerWith({ id: 'ACME-1', state: 'review' });
  const t = task(l, 'ACME-1');
  const back = { to: 'rework' as const, actor: 'orchestrator' as const, by: 'orchestrator:autopilot' };
  assert.deepEqual(checkMove(l, config, t, { ...back, reason: 'Checks failed on GitHub on abc1234: build.' }, noGateHooks), []);
  assert.deepEqual(checkMove(l, config, t, back, noGateHooks), ['Moving to rework needs a reason.']);
  assert.match(checkMove(l, config, t, { ...back, actor: 'builder', by: 'builder:ACME-1', reason: 'x' }, noGateHooks).join(), /A builder can't move a task from review to rework/);
  // What the move was for goes with its event.
  const events: Parameters<Emit>[0][] = [];
  applyMove(t, { ...back, reason: 'Checks failed on GitHub on abc1234: build.' }, (e) => events.push(e), clock, { checks: ['build'], sha: 'abc' });
  assert.deepEqual(events[0]!.data, { from: 'review', to: 'rework', reason: 'Checks failed on GitHub on abc1234: build.', override: false, checks: ['build'], sha: 'abc' });
});

test('failing checks on a commit autopilot already sent back don\'t need you while its fix is reviewed; at autonomy manual they do, as before (D-076)', () => {
  const l = ledgerWith({ id: 'ACME-1', state: 'review' });
  const t = task(l, 'ACME-1');
  const H = 'a'.repeat(40);
  t.pr = { number: 7, url: 'https://github.com/acme/x/pull/7', state: 'open', sha: H, ci: 'failing', failing: ['build'] };
  assert.equal(displayState(l, t), 'needs-you', 'nothing sent back: a person reads them, as at autonomy manual');
  t.autopilot = { failed: null, sentBack: { sha: H, checks: ['build'], at: '2026-10-06T09:00:00.000Z' } };
  assert.equal(displayState(l, t), 'review', 'the pull request is still at the commit sent back: its fix is on the way');
  t.pr = { ...t.pr, sha: 'b'.repeat(40) };
  assert.equal(displayState(l, t), 'needs-you', 'a newer commit\'s checks failing need you again');
  t.pr = { ...t.pr, sha: H, ci: 'failing', changesRequested: true };
  assert.equal(displayState(l, t), 'needs-you', 'a person\'s requested changes still do');
  t.pr = { ...t.pr, changesRequested: false };
  t.autopilot.failed = { step: 'checks', sha: H, state: 'review', reason: 'Checks failed on GitHub again: build.', at: '2026-10-06T10:00:00.000Z' };
  assert.equal(displayState(l, t), 'needs-you', 'failing again there is written down, and needs you');
});

test('mutate writes the snapshot and the event log together, in the shared git directory (D-008)', () => {
  const repo = makeRepo();
  const paths = repoPaths(repo, run);
  assert.match(paths.ledger, /\.git\/acc\/ledger\.json$/);
  mutate(paths, clock, (l, emit) => upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-1' }, title: 'x' }], 'human', 'h', emit, clock));
  moveTask(paths, config, 'ACME-1', { to: 'running', actor: 'human', by: 'h' }, noGateHooks, clock);
  const l = readLedger(paths.ledger);
  assert.equal(l.seq, 2);
  assert.equal(task(l, 'ACME-1').state, 'running');
  const events = readFileSync(paths.events, 'utf8').trim().split('\n').map((x) => JSON.parse(x));
  assert.deepEqual(events.map((e) => [e.seq, e.type]), [[1, 'task.added'], [2, 'task.moved']]);
  assert.throws(() => moveTask(paths, config, 'ACME-1', { to: 'done', actor: 'human', by: 'h' }, noGateHooks, clock), /no rule for running → done/);
  assert.equal(readLedger(paths.ledger).seq, 2, 'a refused move writes nothing');
});

test('every worktree sees the same ledger', () => {
  const repo = makeRepo();
  const wt = `${repo}-wt`;
  run('git', ['worktree', 'add', '-q', '-b', 'task/ACME-1', wt], { cwd: repo });
  assert.equal(repoPaths(wt, run).ledger, repoPaths(repo, run).ledger);
  assert.notEqual(repoPaths(wt, run).root, repoPaths(repo, run).root);
});

test('a running builder counts as stopped when its session ended, went idle, or is gone, and not while it works or waits (D-067)', () => {
  const now = new Date('2026-10-05T22:20:00Z');
  const t = { id: 'GH-41', state: 'running' as State, run: { bgId: '5018b73a', sessionId: '5018b73a-d2ee', worktree: '/wt/GH-41', branch: 'task/GH-41-x', startedAt: '2026-10-05T21:52:13Z' } };
  const bg = (more: Partial<ClaudeSession>): ClaudeSession[] => [{ id: '5018b73a', sessionId: '5018b73a-d2ee', kind: 'background', name: 'GH-41', ...more }];
  const stopped = (sessions: ClaudeSession[] | null, o: Partial<{ resuming: boolean; now: Date }> = {}) => builderStopped(t, sessions, { resuming: false, now, ...o });
  // GH-41 as Claude Code listed it after the Mac slept: blocked, its process gone.
  assert.equal(stopped(bg({ state: 'blocked' })), true, 'blocked with no process: it can\'t be waiting on anyone');
  assert.equal(stopped([]), true, 'gone from claude agents');
  for (const state of ['done', 'failed', 'stopped']) assert.equal(stopped(bg({ state, pid: 9, status: 'idle' })), true, state);
  assert.equal(stopped(bg({ state: 'done', pid: 9 })), true, 'its turn over, its process lingering');
  assert.equal(stopped(bg({ state: 'blocked', pid: 9, status: 'idle' })), true, 'idle at the end of its turn');
  assert.equal(stopped(bg({ state: 'working', pid: 9, status: 'busy' })), false, 'working');
  assert.equal(stopped(bg({ state: 'blocked', pid: 9, status: 'waiting' })), false, 'waiting in its own prompt');
  assert.equal(stopped(bg({ state: 'blocked', pid: 9 })), false, 'blocked, with its process: waiting on a person there');
  // A resumed conversation is listed beside its old background session, as interactive, with the same session id.
  assert.equal(stopped([...bg({ state: 'blocked' }), { sessionId: '5018b73a-d2ee', kind: 'interactive', pid: 77, status: 'busy' }]), false);
  assert.equal(stopped([{ sessionId: '5018b73a-d2ee', kind: 'interactive', pid: 77, status: 'idle' }]), false, 'open in a terminal or a tab: someone carries it on');
  assert.equal(stopped([{ id: 'other', sessionId: 'other', kind: 'background', name: 'GH-9', pid: 5, state: 'working' }]), true, 'another task\'s session isn\'t its');
  // Nothing is judged without an answer from claude agents, while a resume runs, or in the first two minutes.
  assert.equal(stopped(null), false);
  assert.equal(stopped([], { resuming: true }), false);
  assert.equal(stopped([], { now: new Date('2026-10-05T21:53:30Z') }), false, 'just dispatched: not listed yet');
  const resumed = { ...t, run: { ...t.run, resumes: [{ at: '2026-10-05T22:19:00Z', actor: 'human' as const, by: 'human:jack' }] } };
  assert.equal(builderStopped(resumed, [], { resuming: false, now }), false, 'the grace counts from its latest resume');
  assert.equal(builderStopped({ ...t, state: 'review' }, [], { resuming: false, now }), false, 'only a running task');
  // A builder started some other way, before its session was linked, is found by name.
  const unlinked = { ...t, run: { worktree: '/wt/GH-41', startedAt: t.run.startedAt } };
  assert.equal(builderStopped(unlinked, bg({ state: 'working', pid: 9, status: 'busy', startedAt: Date.parse('2026-10-05T21:52:20Z') }), { resuming: false, now }), false);
  assert.equal(builderStopped(unlinked, [], { resuming: false, now }), true);
});

test('a builder is found by its session, else by the name its run recorded, else, from before names, by its task id (D-087)', () => {
  const name = sessionName({ project: 'Acme Service', key: 'GH-44', title: 'Case escalation rules', role: 'builder' });
  const mine: ClaudeSession = { id: 'bg1', sessionId: 'sess-1', kind: 'background', name, pid: 7 };
  const resumed: ClaudeSession = { sessionId: 'sess-1', kind: 'interactive', name, pid: 8 };
  const other: ClaudeSession = { id: 'bg2', sessionId: 'sess-2', kind: 'background', name: 'Acme Service · GH-45 Something else · builder', pid: 9 };
  const legacy: ClaudeSession = { id: 'bg3', sessionId: 'sess-3', kind: 'background', name: 'GH-44', pid: 10, startedAt: Date.parse('2026-10-01T09:00:30Z') };
  const all = [mine, resumed, other, legacy];
  assert.deepEqual(sessionsOf({ id: 'GH-44', run: { bgId: 'bg1' } }, all), [mine], 'by its background id');
  assert.deepEqual(sessionsOf({ id: 'GH-44', run: { sessionId: 'sess-1' } }, all), [mine, resumed], 'by its session id, a resume of it included');
  assert.deepEqual(sessionsOf({ id: 'GH-44', run: { bgId: 'gone', name } }, all), [], 'a recorded id that\'s gone isn\'t replaced by a name');
  // Its ids weren't recorded: the name its run recorded, though the title changed since.
  const t = task(ledgerWith({ id: 'GH-44', state: 'running', title: 'Case escalation rules' }), 'GH-44');
  t.run = { worktree: '/wt/GH-44', name };
  t.title = 'Escalation rules for cases, rewritten';
  assert.deepEqual(sessionsOf(t, all), [mine]);
  const renamed: ClaudeSession = { id: 'bg4', sessionId: 'sess-4', kind: 'background', name: sessionName({ project: 'Acme Service', key: 'GH-44', title: t.title, role: 'builder' }), pid: 11 };
  assert.deepEqual(sessionsOf(t, [renamed, legacy]), [], 'a name worked out from the new title isn\'t taken, nor the old-style one');
  assert.deepEqual(sessionsOf({ id: 'GH-44', run: { name } }, [{ ...mine, kind: 'interactive' }]), [], 'by name, only a background session');
  // A run from before names: a background session named after the task, as before.
  const before = { worktree: '/wt/GH-44', startedAt: '2026-10-01T09:00:00Z' };
  assert.deepEqual(sessionsOf({ id: 'GH-44', run: before }, all), [legacy]);
  assert.deepEqual(sessionsOf({ id: 'GH-44' }, all), [legacy]);
  const at = { resuming: false, now: new Date('2026-10-05T22:00:00Z') };
  const named = { id: 'GH-44', state: 'running' as State, run: { startedAt: '2026-10-05T21:00:00Z', name } };
  assert.equal(builderStopped(named, [{ ...mine, startedAt: Date.parse('2026-10-05T21:00:30Z') }], at), false, 'at work, found by its name');
  assert.equal(builderStopped(named, [legacy], at), true, 'a session named after the task isn\'t it');
});

test('a stopped builder\'s task needs you; a working one is running', () => {
  const l = ledgerWith({ id: 'ACME-1', state: 'running' }, { id: 'ACME-2', state: 'review' });
  assert.equal(displayState(l, task(l, 'ACME-1'), { stopped: true }), 'needs-you');
  assert.equal(displayState(l, task(l, 'ACME-1'), { stopped: false, state: 'working', status: 'busy' }), 'running');
  assert.equal(displayState(l, task(l, 'ACME-2'), { stopped: true }), 'review', 'only a running task stops');
});

test('every run a task\'s builder had is read from the events, from the first byte, then only what was added (D-095)', () => {
  const dir = tempDir();
  const file = join(dir, 'events.jsonl');
  assert.equal(readRuns(file), undefined, 'no events yet');
  const ev = (task: string, data: Record<string, unknown>, type = 'task.updated') => `${JSON.stringify({ seq: 1, at: '2026-10-07T09:00:00Z', type, task, actor: 'human', by: 'human:test', data })}\n`;
  // The first run is at the very start of a long file: an earlier run can be anywhere in it.
  writeFileSync(file, ev('GH-1', { run: { bgId: 'bg1', sessionId: 's1', worktree: '/wt/GH-1', name: 'GH-1 builder', n: 1 } })
    + ev('GH-1', { title: 'Renamed' }).repeat(3000) + ev('GH-2', { from: 'todo', to: 'running' }, 'task.moved') + 'not an event\n'
    // Its builder's SessionStart linked another session to that run.
    + ev('GH-1', { sessionId: 's1b' }));
  assert.ok(statSync(file).size > 256 * 1024, 'longer than a first look at autopilot\'s steps reads');
  const first = readRuns(file)!;
  assert.deepEqual(first.runs, [{ task: 'GH-1', bgId: 'bg1', sessionId: 's1', name: 'GH-1 builder', n: 1 }, { task: 'GH-1', bgId: 'bg1', sessionId: 's1b', name: 'GH-1 builder', n: 1 }]);
  assert.equal(first.offset, statSync(file).size);
  // Only what was added is read: what the last look kept stays as it was. A half-written line waits.
  const half = '{"seq":9,"type":"task.updated","task":"GH-3","data":{"run":{"bgId":"bg3"';
  appendFileSync(file, ev('GH-1', { run: { bgId: 'bg1-2', n: 2 } }) + half);
  const kept = { ...first, runs: [{ task: 'KEPT' }] };
  const next = readRuns(file, kept)!;
  assert.deepEqual(next.runs, [{ task: 'KEPT' }, { task: 'GH-1', bgId: 'bg1-2', n: 2 }]);
  assert.equal(next.offset, statSync(file).size - half.length);
  appendFileSync(file, '}}}\n');
  assert.deepEqual(readRuns(file, next)!.runs.slice(1), [{ task: 'GH-1', bgId: 'bg1-2', n: 2 }, { task: 'GH-3', bgId: 'bg3' }]);
  // A file that shrank, or was replaced, is read again from the start.
  writeFileSync(file, ev('GH-7', { run: { sessionId: 's7' } }));
  assert.deepEqual(readRuns(file, next)!.runs, [{ task: 'GH-7', sessionId: 's7' }], 'shrank');
  const before = readRuns(file)!;
  rmSync(file);
  writeFileSync(join(dir, 'other'), 'x');
  writeFileSync(file, ev('GH-7', { run: { sessionId: 's7' } }) + ev('GH-8', { run: { bgId: 'bg8' } }));
  assert.notEqual(statSync(file).ino, before.ino);
  assert.deepEqual(readRuns(file, { ...before, runs: [{ task: 'OLD' }] })!.runs.map((r) => r.task), ['GH-7', 'GH-8'], 'a new file');
});

test('the runs read are those dispatch records, through the ledger\'s own events', () => {
  const paths = repoPaths(makeRepo(), run);
  mutate(paths, clock, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-1' }, title: 'One' }], 'human', 'human:test', emit, clock);
    const t = task(l, 'ACME-1');
    for (const ids of [{ bgId: 'bg-a', sessionId: 's-a', name: 'ACME-1 builder', n: 1 }, { bgId: 'bg-b', sessionId: 's-b', name: 'ACME-1 builder 2', n: 2 }]) {
      t.run = { worktree: '/wt/ACME-1', startedAt: clock().toISOString(), ...ids };
      emit({ type: 'task.updated', task: t.id, actor: 'human', by: 'human:test', data: { run: t.run } });
    }
  });
  assert.deepEqual(readRuns(paths.events)!.runs, [{ task: 'ACME-1', bgId: 'bg-a', sessionId: 's-a', name: 'ACME-1 builder', n: 1 }, { task: 'ACME-1', bgId: 'bg-b', sessionId: 's-b', name: 'ACME-1 builder 2', n: 2 }]);
});

test('a session is tied to its task by ids: a done task\'s builder, an earlier run\'s, and a recorded review or analysis are finished (D-095)', () => {
  const run = (id: string, n?: number, name?: string) => ({ bgId: `bg-${id}`, sessionId: `s-${id}`, ...(n ? { n } : {}), ...(name ? { name } : {}) });
  const repo: RepoAgents = {
    tasks: [
      { id: 'GH-1', state: 'done', run: run('1') },
      { id: 'GH-2', state: 'running', run: run('2b', 2, 'GH-2 builder 2') },
      { id: 'GH-3', state: 'review', run: run('3') },
      { id: 'GH-4', state: 'rework', run: run('4') },
      { id: 'GH-5', state: 'todo', run: run('5') },
      { id: 'GH-6', state: 'blocked', run: run('6') },
      { id: 'GH-7', state: 'done', run: null },
    ],
    runs: [
      { task: 'GH-1', ...run('1') },
      { task: 'GH-2', ...run('2a', 1, 'GH-2 builder') },
      // An earlier run of GH-2 that recorded no ids: it can't be found.
      { task: 'GH-2', name: 'GH-2 builder 0' },
      { task: 'GH-2', ...run('2b', 2, 'GH-2 builder 2') },
      // A session linked to the current run, since replaced on it: still the current run's.
      { task: 'GH-2', bgId: 'bg-2b', sessionId: 's-2b-old', n: 2 },
      { task: 'GH-9', ...run('9') },
    ],
    verdicts: [{ task: 'GH-3', sessionId: 'review-3' }, { task: 'GH-9', sessionId: 'review-9' }],
    analyses: [{ task: 'GH-5', sessionId: 'analysis-5' }, { task: 'GH-6', sessionId: 'analysis-6' }],
    live: [{ task: 'GH-5', sessionId: 'analysis-5-again', role: 'analysis' }, { task: 'GH-6', sessionId: 'analysis-6', role: 'analysis' }],
  };
  const bg = (id: string, sessionId?: string, name?: string): ClaudeSession => ({ kind: 'background', id, ...(sessionId ? { sessionId } : {}), ...(name ? { name } : {}), state: 'blocked', pid: 1 });
  const resumed = (sessionId: string): ClaudeSession => ({ kind: 'interactive', sessionId, status: 'waiting', pid: 2 });
  const finished = (task: string, role: SessionTie['role'], why: SessionTie['why']): SessionTie => ({ task, role, finished: true, why });
  // A done task's builder, by its background id or its session id.
  assert.deepEqual(tieSession(bg('bg-1'), repo), finished('GH-1', 'builder', 'done'));
  assert.deepEqual(tieSession(resumed('s-1'), repo), finished('GH-1', 'builder', 'done'));
  // An earlier run's builder, by the ids its dispatch recorded, while its task runs again.
  assert.deepEqual(tieSession(bg('bg-2a'), repo), { ...finished('GH-2', 'builder', 'later-run'), n: 1 }, 'with its run\'s count (GH-119)');
  assert.deepEqual(tieSession(resumed('s-2a'), repo), { ...finished('GH-2', 'builder', 'later-run'), n: 1 });
  // The current builder of a task that isn't done is its task's, at work, whatever the task's state.
  for (const id of ['2b', '3', '4', '5', '6']) assert.equal(tieSession(bg(`bg-${id}`), repo)?.finished, false, `bg-${id}: its task's current builder`);
  assert.deepEqual(tieSession(bg('bg-2b'), repo), { task: 'GH-2', role: 'builder', finished: false, why: null, n: 2 });
  assert.equal(tieSession(resumed('s-2b-old'), repo), null, 'a session of the current run is never an earlier run\'s');
  // A recorded verdict or analysis; not an analysis still under way.
  assert.deepEqual(tieSession(resumed('review-3'), repo), finished('GH-3', 'review', 'reviewed'));
  assert.deepEqual(tieSession(resumed('analysis-5'), repo), finished('GH-5', 'analysis', 'analyzed'), 'the analysis on file, while another runs');
  assert.deepEqual(tieSession(resumed('analysis-5-again'), repo), { task: 'GH-5', role: 'analysis', finished: false, why: null });
  assert.deepEqual(tieSession(resumed('analysis-6'), repo), { task: 'GH-6', role: 'analysis', finished: false, why: null }, 'under way, though its analysis is written');
  // Untied: unknown ids, a name alone, and a task no longer in the ledger.
  assert.equal(tieSession(bg('bg-x', 's-x'), repo), null);
  assert.equal(tieSession(bg('bg-x', 's-x', 'GH-2 builder'), repo), null, 'an earlier run\'s name alone');
  assert.equal(tieSession(bg('bg-x', 's-x', 'GH-2 builder 0'), repo), null, 'an earlier run that recorded no ids');
  assert.equal(tieSession(bg('bg-x', 's-x', 'GH-7'), repo), null, 'a task never dispatched has no builder');
  assert.equal(tieSession(bg('bg-9'), repo), null, 'a removed task\'s builder');
  assert.equal(tieSession(resumed('review-9'), repo), null, 'a removed task\'s reviewer');
  // Its task's title goes with it, where the ledger has one, for the Agents page's task lines (GH-119).
  const titled: RepoAgents = { ...repo, tasks: repo.tasks.map((t) => (t.id === 'GH-3' ? { ...t, title: 'Case escalation rules' } : t)) };
  assert.equal(tieSession(resumed('review-3'), titled)?.title, 'Case escalation rules');
  assert.deepEqual(tieSession(bg('bg-3'), titled), { task: 'GH-3', role: 'builder', finished: false, why: null, title: 'Case escalation rules' });
});
