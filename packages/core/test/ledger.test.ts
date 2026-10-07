import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import {
  ACTORS, applyMove, builderStopped, type ClaudeSession, checkMove, closedPr, displayState, emptyLedger, type Emit, findRule, type Hooks, isReady, type Ledger, type LedgerEvent,
  moveTask, mutate, noGateHooks, normalizeId, readLedger, readyTasks, RULES, sessionsOf, type State, STATES, type Task, upsertTasks,
} from '../src/ledger.ts';
import { sessionName } from '../src/names.ts';
import { repoPaths } from '../src/paths.ts';
import { makeRepo, SF_CONFIG } from './support.ts';

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
        const problems = checkMove(l, config, task(l, 'ACME-1'), { to: rule.to, actor, by: actor, reason: 'because' }, passAll);
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
  assert.match(checkMove(l, config, task(l, 'ACME-3'), { to: 'running', actor: 'orchestrator', by: 'o' }, noGateHooks).join(), /2 tasks are already running. The limit is 2/);
  assert.match(checkMove(l, config, task(l, 'ACME-4'), { to: 'running', actor: 'human', by: 'h' }, noGateHooks).join(), /limit is 2/);
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
  assert.deepEqual(checkMove(l, config, task(l, 'ACME-1'), { to: 'review', actor: 'builder', by: 'b' }, noGateHooks), []);
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
  assert.equal(builderStopped(unlinked, bg({ state: 'working', pid: 9, status: 'busy' }), { resuming: false, now }), false);
  assert.equal(builderStopped(unlinked, [], { resuming: false, now }), true);
});

test('a builder is found by its session, else by the name its run recorded, else, from before names, by its task id (D-087)', () => {
  const name = sessionName({ project: 'Acme Service', key: 'GH-44', title: 'Case escalation rules', role: 'builder' });
  const mine: ClaudeSession = { id: 'bg1', sessionId: 'sess-1', kind: 'background', name, pid: 7 };
  const resumed: ClaudeSession = { sessionId: 'sess-1', kind: 'interactive', name, pid: 8 };
  const other: ClaudeSession = { id: 'bg2', sessionId: 'sess-2', kind: 'background', name: 'Acme Service · GH-45 Something else · builder', pid: 9 };
  const legacy: ClaudeSession = { id: 'bg3', sessionId: 'sess-3', kind: 'background', name: 'GH-44', pid: 10 };
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
  assert.equal(builderStopped(named, [mine], at), false, 'at work, found by its name');
  assert.equal(builderStopped(named, [legacy], at), true, 'a session named after the task isn\'t it');
});

test('a stopped builder\'s task needs you; a working one is running', () => {
  const l = ledgerWith({ id: 'ACME-1', state: 'running' }, { id: 'ACME-2', state: 'review' });
  assert.equal(displayState(l, task(l, 'ACME-1'), { stopped: true }), 'needs-you');
  assert.equal(displayState(l, task(l, 'ACME-1'), { stopped: false, state: 'working', status: 'busy' }), 'running');
  assert.equal(displayState(l, task(l, 'ACME-2'), { stopped: true }), 'review', 'only a running task stops');
});
