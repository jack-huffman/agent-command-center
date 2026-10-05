import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import {
  ACTORS, applyMove, checkMove, closedPr, displayState, emptyLedger, type Emit, findRule, type Hooks, isReady, type Ledger, type LedgerEvent,
  moveTask, mutate, noGateHooks, normalizeId, readLedger, readyTasks, RULES, type State, STATES, type Task, upsertTasks,
} from '../src/ledger.ts';
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
