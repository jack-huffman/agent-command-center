// A builder that never started, or one acc can't see (T-92): the row says so from the ledger and the hub's
// silence, the card's and the page's Needs you line names why and what to try, and Dispatch again runs
// acc dispatch --again.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyLedger, type Task } from '../../packages/core/src/ledger.ts';
import { NOT_STARTED, UNSEEN_WORDS } from '../../packages/core/src/started.ts';
import type { Hub } from '../src/hub.ts';
import type { TaskRow } from '../src/logic/shared.ts';
import { accLook } from '../src/model/boards.ts';
import { cardActions, unseenLook } from '../src/model/cards.ts';
import type { HomeModel } from '../src/model/home.ts';
import { sampleModel } from '../scripts/screenshot.ts';
import { deriveRows } from '../src/task-rows.ts';
import { row } from './support.ts';

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

/** T-1 as deriveRows reads it, with Claude Code's background sessions silent since `silentMin` minutes ago, or answering. */
function read(task: Partial<Task>, silentMin: number | null): TaskRow {
  const t = { id: 'T-1', title: 'Task T-1', brief: '', source: { kind: 'manual', url: null }, environment: 'devbox', deps: [], labels: [], state: 'running', blocker: null, run: { worktree: '/no/such/worktree-T-92', branch: 'task/T-1', startedAt: ago(30), bgId: 'bg1' }, pr: null, history: [], createdAt: '', updatedAt: '', ...task } as unknown as Task;
  const project = { name: 'Acme', root: '/r', ledgerPath: '/r/.git/acc/ledger.json', config: { github: null, environments: [], profile: 'generic', agents: {} }, worktrees: [] };
  const fake = {
    agentsAt: silentMin === null ? Date.now() : 0, agentsError: silentMin === null ? null : 'connect ENOENT /tmp/cc-daemon-502/x/control.sock', agentsSilentSince: silentMin === null ? null : Date.now() - silentMin * 60_000,
    agents: [{ id: 'bg1', name: 'x', kind: 'background', cwd: '/r', startedAt: Date.now(), pid: 5, state: 'working', status: 'busy' }], questions: [], askingFor: () => null, tieFor: () => null, lastSaid: () => null, lastModel: () => null, changed: new Map(), limits: null,
  } as unknown as Hub;
  return deriveRows(fake, { ...emptyLedger(), tasks: [t] }, project as never)[0]!;
}

test('claude agents not answering past the grace shows the Needs you line; answering again clears it; within the grace it waits (T-92)', () => {
  const blind = read({}, 10);
  assert.equal(blind.unseen, 'unanswered');
  assert.equal(blind.display, 'needs-you');
  assert.deepEqual(blind.agent, { label: UNSEEN_WORDS.unanswered.label, icon: 'eye-closed', tone: 'orange' });
  assert.deepEqual(accLook(blind), { label: `Needs you: ${UNSEEN_WORDS.unanswered.line}. ${UNSEEN_WORDS.unanswered.wayOn}`, icon: 'eye-closed', tone: 'orange' });
  assert.match(accLook(blind).label, /Open a terminal and check that Claude Code lists its background agents, or restart Claude Code\./, 'it names what to try');
  const back = read({}, null);
  assert.equal(back.unseen, null);
  assert.equal(back.display, 'running', 'its session answers and works');
  assert.equal(read({}, 1).unseen, null, 'within the grace: a slow answer isn\'t yet a state');
});

test('a running task whose conversation is old, or never written, and no answer shows as Needs you with Dispatch again leading (T-92)', () => {
  const quiet = read({ run: { worktree: '/no/such/worktree-T-92', branch: 'task/T-1', startedAt: ago(200), bgId: 'bg1' } as Task['run'] }, 10);
  assert.equal(quiet.unseen, 'quiet');
  assert.equal(quiet.display, 'needs-you');
  const acts = cardActions(quiet, { project: '/r', task: 'T-1' });
  assert.deepEqual(acts.filter((a) => a.primary).map((a) => [a.command, a.label]), [['acc.task.dispatchAgain', 'Build it again']]);
  // Where Claude Code only doesn't answer, the builder may still be at work: Dispatch again is behind ⋯, and Watch doesn't lead.
  const blind = cardActions(read({}, 10), { project: '/r', task: 'T-1' });
  assert.ok(blind.some((a) => a.command === 'acc.task.dispatchAgain' && !a.primary));
  assert.ok(!blind.some((a) => a.primary && (a.command === 'acc.task.watch' || a.command === 'acc.task.openInClaude')));
});

test('a task whose builder didn\'t start reads from the ledger as Needs you, its reason on the card, and Dispatch again leads; a cloud builder is never unseen (T-92)', () => {
  const t = read({ state: 'todo', run: null, notStarted: { at: ago(2), by: 'human:me', reason: NOT_STARTED, where: 'local' } }, null);
  assert.deepEqual(t.notStarted, { reason: NOT_STARTED, at: t.notStarted!.at });
  assert.equal(t.display, 'needs-you');
  assert.deepEqual(accLook(t), { label: `Needs you: ${NOT_STARTED}. Build it again starts a new builder with the same model, effort and place.`, icon: 'plug', tone: 'orange' });
  const acts = cardActions({ ...t, deps: [] }, { project: '/r', task: 'T-1' });
  assert.equal(acts[0]!.command, 'acc.task.dispatchAgain');
  assert.equal(acts.filter((a) => a.primary).length, 1, 'one next step');
  const cloud = read({ run: { worktree: '/w', branch: 'b', startedAt: ago(30), where: 'cloud', cloud: { sessionId: 's', url: 'https://claude.ai/code/s', firedAt: ago(30), head: 'abc', lastPushAt: ago(1) } } as Task['run'] }, 10);
  assert.equal(cloud.unseen, null, 'its branch says whether it\'s quiet (D-140)');
});

test('unseenLook: nothing for a row with neither, and a moved task\'s old marker is not shown (T-92 edge cases)', () => {
  assert.equal(unseenLook({ state: 'running' }), null);
  assert.equal(unseenLook({ state: 'review', notStarted: { reason: 'x', at: '' } }), null);
  assert.equal(unseenLook({ state: 'todo', unseen: 'quiet' }), null);
  assert.equal(unseenLook({ ...row('T-1', 'running', 'needs-you'), unseen: 'quiet' })!.icon, 'eye-closed');
});

test('the Overview\'s Needs you lists each, with why and Dispatch again where it leads (T-92)', () => {
  const m = sampleModel('overview-landing', Date.now()) as HomeModel;
  const lines = m.overview.attention;
  const blind = lines.find((a) => a.title.startsWith('ACME-48'))!;
  const quiet = lines.find((a) => a.title.startsWith('ACME-50'))!;
  const never = lines.find((a) => a.title.startsWith('ACME-49'))!;
  assert.deepEqual([blind.look.label, blind.look.icon, blind.look.tone], [UNSEEN_WORDS.unanswered.label, 'eye-closed', 'orange']);
  assert.match(blind.detail, /aren't answering, so the Command Center can't see this builder\. Open a terminal and check that Claude Code lists its background agents, or restart Claude Code\./);
  assert.ok(!blind.actions.some((a) => a.primary), 'nothing leads where the builder may still be at work');
  assert.deepEqual(quiet.actions.filter((a) => a.primary).map((a) => a.command), ['acc.task.dispatchAgain']);
  assert.deepEqual([never.look.label, never.actions[0]!.command, !!never.actions[0]!.primary], ['Needs you: its builder didn\'t start', 'acc.task.dispatchAgain', true]);
});

test('a running local task with no claude on PATH reads as missing at once, in its own words, and a cloud one never does (T-93)', () => {
  const hubOf = (extra: object) => ({ agentsAt: 0, agentsError: 'The Claude Code CLI (claude) isn\'t on PATH.', agentsSilentSince: null, claudeMissing: true, agents: [], questions: [], askingFor: () => null, tieFor: () => null, lastSaid: () => null, lastModel: () => null, changed: new Map(), limits: null, ...extra }) as unknown as Hub;
  const t = { id: 'T-1', title: 'Task T-1', brief: '', source: { kind: 'manual', url: null }, environment: 'devbox', deps: [], labels: [], state: 'running', blocker: null, run: { worktree: '/no/such/worktree-T-93', branch: 'task/T-1', startedAt: ago(30), bgId: 'bg1' }, pr: null, history: [], createdAt: '', updatedAt: '' } as unknown as Task;
  const project = { name: 'Acme', root: '/r', ledgerPath: '/r/.git/acc/ledger.json', config: { github: null, environments: [], profile: 'generic', agents: {} }, worktrees: [] };
  const r = deriveRows(hubOf({}), { ...emptyLedger(), tasks: [t] }, project as never)[0]!;
  assert.equal(r.unseen, 'missing');
  assert.equal(r.display, 'needs-you');
  assert.deepEqual(r.agent, { label: UNSEEN_WORDS.missing.label, icon: 'eye-closed', tone: 'orange' });
  assert.doesNotMatch(accLook(r).label, /aren't answering/, 'it isn\'t called silence');
  const cloud = deriveRows(hubOf({}), { ...emptyLedger(), tasks: [{ ...t, run: { ...t.run, where: 'cloud' } } as Task] }, project as never)[0]!;
  assert.equal(cloud.unseen, null);
});
