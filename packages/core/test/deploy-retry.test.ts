// Retry with an agent (T-174): a Salesforce task whose deploy to the development org failed, or never ran, is handed
// back to its builder. It shows for a failed deploy and for one that never ran, and is off with why while the builder
// runs, with no worktree, and on a generic project. Its message names the failed deploy and its reason on one line,
// says to block with options on a failure outside the builder's work, and to change no code to get round one. A
// blocked task, or one in review, goes back to running as its builder carries on; the project's cap refuses that,
// with nothing started.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig, type Config } from '../src/config.ts';
import type { TaskDeploy } from '../src/deploy-gate.ts';
import type { TaskDeployFailure } from '../src/deploy-record.ts';
import { builderRuns, DEPLOY_RETRY_COMMAND, DEPLOY_RETRY_LABEL, deployRetryCase, deployRetryEnabled, deployRetryMessage, deployRetryShown, failureLine, retryDeploy, retryReason } from '../src/deploy-retry.ts';
import { run, type RunResult } from '../src/exec.ts';
import { type ClaudeSession, type LedgerEvent, mutate, readLedger, type State, type Task, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { type Launcher, resume, RESUME_MOVES_FROM, resumingPath, retryMoveProblems } from '../src/resume.ts';
import { transcriptDir } from '../src/transcript.ts';
import { bad, fakeAwake, fakeRunner, GENERIC_CONFIG, gh41Lines, makeRepo, ok, SF_CONFIG, tempDir } from './support.ts';

const now = () => new Date('2026-11-01T12:00:00Z');
const SID = '7a1c0e52-9b1f-4b4e-9c51-3f2a7c6d0e11';
const PID = 4_000_002;
const sf = parseConfig(SF_CONFIG).config as Config;
const generic = parseConfig(GENERIC_CONFIG).config as Config;
const LOCK = 'The deploy to Acme Dev failed (job 0Af9), 1 problem: unable to obtain exclusive access to this record or 1 records\nSecond line of the stack';
const failure = (at: string, reason = LOCK): TaskDeployFailure => ({ env: 'dev', org: 'Acme Dev', at, reason });
const deploy = (at: string): TaskDeploy => ({ env: 'dev', org: 'Acme Dev', sha: 'abc', at, jobId: '0Af1', paths: [], components: [], verified: 0, tests: null });
const task = (more: Partial<Task> = {}): Task => ({
  id: 'ACME-7', title: 'Discount rule', state: 'blocked', environment: 'dev', pr: null, promotions: [], deploys: [],
  deployFailures: [failure('2026-11-01T10:00:00Z')], run: { branch: 'task/ACME-7', worktree: '/wt/ACME-7', sessionId: SID }, ...more,
} as unknown as Task);
const on = (t: Task | undefined, more: { runs?: boolean; worktree?: boolean; config?: Config } = {}) => deployRetryEnabled({ config: more.config ?? sf, task: t, runs: more.runs ?? false, worktree: more.worktree ?? true });

test('the retry is for a failed deploy to the development org, or one that never ran, on a task with work that hasn\'t merged', () => {
  const c = deployRetryCase(sf, task());
  assert.equal(c?.env.branch, 'dev');
  assert.equal(c?.failure?.reason, LOCK, 'its latest failure');
  // A deploy that never ran: a builder that stopped before it deployed.
  assert.deepEqual(deployRetryCase(sf, task({ state: 'running', deployFailures: [] }))?.failure, null);
  // In review, as after a person waived the deploy gate (D-244): the merge still asks for the deploy.
  assert.ok(deployRetryCase(sf, task({ state: 'review', deployFailures: [] })));
  // A deploy that passed after the failure: nothing to retry. A failure after the deploy: there is.
  assert.equal(deployRetryCase(sf, task({ deploys: [deploy('2026-11-01T11:00:00Z')] })), null);
  assert.ok(deployRetryCase(sf, task({ deploys: [deploy('2026-11-01T09:00:00Z')] })));
});

test('edge cases with nothing to retry: a generic project, no task, no work, a merged pull request, and to do, rework or done', () => {
  assert.equal(deployRetryCase(generic, task()), null);
  assert.equal(deployRetryCase(sf, undefined), null);
  assert.equal(deployRetryCase(sf, task({ run: { worktree: '/wt' } as Task['run'] })), null);
  assert.equal(deployRetryCase(sf, task({ pr: { number: 3, url: 'u', state: 'merged' } as Task['pr'] })), null);
  for (const state of ['todo', 'rework', 'done'] as State[]) assert.equal(deployRetryCase(sf, task({ state })), null, state);
  assert.equal(deployRetryCase(sf, task({ environment: 'gone' })), null, 'an environment not in the settings');
});

test('the action is off with a reason while the builder runs, with no worktree, and on a generic project; on otherwise', () => {
  assert.deepEqual(on(task()), { ok: true });
  assert.deepEqual(on(task(), { runs: true }), { ok: false, why: 'ACME-7\'s builder is still working on it. Wait for it to finish or block.' });
  assert.deepEqual(on(task(), { worktree: false }), { ok: false, why: 'ACME-7\'s worktree isn\'t on disk any more, so its builder has nowhere to carry on. Build it again.' });
  assert.deepEqual(on(task({ run: { branch: 'b', sessionId: SID } as Task['run'] })), { ok: false, why: 'ACME-7\'s worktree isn\'t on disk any more, so its builder has nowhere to carry on. Build it again.' }, 'no worktree recorded');
  assert.deepEqual(on(task(), { config: generic }), { ok: false, why: 'A retry deploys Salesforce components to the development org, and this isn\'t a Salesforce project.' });
  assert.match((on(task({ run: { branch: 'b', worktree: '/wt', where: 'cloud', sessionId: SID } as Task['run'] })) as { why: string }).why, /runs in the cloud/);
  assert.match((on(task({ run: { branch: 'b', worktree: '/wt' } as Task['run'] })) as { why: string }).why, /no conversation to carry on/);
  // Each reason there's nothing to retry, in words.
  assert.deepEqual(on(undefined), { ok: false, why: 'There\'s no such task.' });
  assert.match((on(task({ deploys: [deploy('2026-11-01T11:00:00Z')] })) as { why: string }).why, /^Its deploy to Dev passed: there's nothing to retry\.$/);
  assert.match((on(task({ state: 'rework' })) as { why: string }).why, /sent back for changes/);
  assert.match((on(task({ run: {} as Task['run'] })) as { why: string }).why, /has no work yet/);
  assert.match((on(task({ pr: { number: 3, url: 'u', state: 'merged' } as Task['pr'] })) as { why: string }).why, /has merged into dev already/);
  // It is a command, with an id, its params and an enabled.
  assert.equal(DEPLOY_RETRY_COMMAND.id, 'acc.task.retryDeploy');
  assert.match(DEPLOY_RETRY_COMMAND.params, /task's id/);
  assert.deepEqual(DEPLOY_RETRY_COMMAND.enabled({ config: sf, task: task(), runs: true, worktree: true }).ok, false);
  assert.equal(DEPLOY_RETRY_LABEL, 'Retry with an agent');
});

test('a deploy that never ran shows the action only once its builder isn\'t running; a failed deploy shows it, off, while it runs', () => {
  const never = task({ state: 'running', deployFailures: [] });
  assert.equal(deployRetryShown({ config: sf, task: never, runs: true }), false, 'a builder at work hasn\'t got to its deploy yet');
  assert.equal(deployRetryShown({ config: sf, task: never, runs: false }), true, 'a builder that stopped before it deployed');
  assert.equal(deployRetryShown({ config: sf, task: task({ state: 'running' }), runs: true }), true);
  assert.equal(deployRetryShown({ config: generic, task: task(), runs: false }), false);
});

test('whether the builder runs: a session of its at work, or a resume under way; an idle or finished session is not', () => {
  const t = task();
  const s = (more: Partial<ClaudeSession>): ClaudeSession => ({ sessionId: SID, kind: 'background', cwd: '/wt/ACME-7', pid: 9, ...more } as ClaudeSession);
  assert.equal(builderRuns(t, [s({ state: 'working', status: 'busy' })], false), true);
  assert.equal(builderRuns(t, [s({ state: 'done', status: 'idle' })], false), false);
  assert.equal(builderRuns(t, [], true), true, 'a resume under way');
  assert.equal(builderRuns(t, [], false), false, 'an empty list of sessions');
});

test('the builder\'s message names the failed deploy with its reason on one line, says to block on a failure outside its work, and to change no code to get round it', () => {
  const c = deployRetryCase(sf, task())!;
  const m = deployRetryMessage(task(), c);
  assert.match(m, /^You are the builder for ACME-7: Discount rule\./);
  assert.ok(m.includes('Your deploy to Dev (Acme Dev) failed at 2026-11-01 10:00 UTC: The deploy to Acme Dev failed (job 0Af9), 1 problem: unable to obtain exclusive access to this record or 1 records\n'), 'the deploy and its reason, on one line');
  assert.ok(!m.includes('Second line of the stack'), 'only the reason\'s first line');
  assert.match(m, /run `acc gate run deploy`/);
  assert.match(m, /until the deploy passes and each changed Apex class reaches the coverage floor/);
  assert.match(m, /A failure outside your work\*\* \(an expired login, a lock on the org, an org that is down, a test another person broke\): change no code to get round it\. Say so in a blocked note with options/);
  assert.match(m, /`acc block "[^`]*" --item "[^`]*" --item "<the options: a\) b\) c\)/);
  assert.match(m, /run exactly `acc gate run`, then finish with your note/);
  // A deploy that never ran says so instead.
  const never = deployRetryCase(sf, task({ deployFailures: [] }))!;
  assert.equal(failureLine(never), 'You stopped before you deployed to Dev (Acme Dev).');
  assert.ok(deployRetryMessage(task(), never).includes('You stopped before you deployed to Dev (Acme Dev).'));
  assert.equal(retryReason(c), 'Retry the deploy to Dev with an agent: The deploy to Acme Dev failed (job 0Af9), 1 problem: unable to obtain exclusive access to this record or 1 records');
  assert.equal(retryReason(never), 'Retry the deploy to Dev with an agent: it never deployed');
});

// ---------------------------------------------------------------- the retry, through resume

/** ACME-7 in `state`, its deploy to Dev failed, its builder's background session finished and its transcript saved. */
function setup(o: { state?: State; failed?: boolean; sessions?: ClaudeSession[] | null; others?: number } = {}) {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(SF_CONFIG) });
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, sf, [{ source: { kind: 'manual', key: 'ACME-7' }, title: 'Discount rule' }, ...Array.from({ length: o.others ?? 0 }, (_, i) => ({ source: { kind: 'manual' as const, key: `ACME-${20 + i}` }, title: `Other ${i}` }))], 'human', 'human:test', emit, now);
    const t = l.tasks[0]!;
    t.state = o.state ?? 'blocked';
    t.blocker = 'The deploy to Acme Dev failed';
    t.run = { bgId: '7a1c0e52', sessionId: SID, worktree: dir, branch: 'main', startedAt: '2026-11-01T09:00:00Z' };
    if (o.failed !== false) t.deployFailures = [failure('2026-11-01T10:00:00Z')];
    for (const other of l.tasks.slice(1)) other.state = 'running';
  });
  const projects = tempDir('projects-');
  mkdirSync(transcriptDir(projects, dir), { recursive: true });
  writeFileSync(join(transcriptDir(projects, dir), `${SID}.jsonl`), gh41Lines(SID, dir).join('\n') + '\n');
  const sessions = o.sessions === undefined ? [{ id: '7a1c0e52', sessionId: SID, kind: 'background', cwd: dir, state: 'done', status: 'idle' }] : o.sessions;
  const fixtures: Record<string, RunResult> = { 'claude agents --json': sessions ? ok(JSON.stringify(sessions)) : bad('claude agents timed out') };
  const launched: { args: string[]; cwd: string }[] = [];
  const launch: Launcher = (_cmd, args, l) => { launched.push({ args, cwd: l.cwd }); return PID; };
  const deps = { run: fakeRunner(fixtures), now, env: { PATH: '/usr/bin', HOME: '/home/me' }, accBinDir: '/acc/bin', accCommand: 'acc', launch, projectsDir: projects, awake: fakeAwake().deps };
  return { dir, paths, deps, launched };
}

const by = { actor: 'human' as const, by: 'human:jordan-kim' };
const events = (file: string): LedgerEvent[] => readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('Retry resumes a blocked task\'s builder in its worktree with the retry\'s message, and moves it back to running with why', () => {
  const s = setup();
  const r = retryDeploy(s.paths, sf, 'ACME-7', s.deps, by);
  assert.equal(s.launched.length, 1);
  const l = s.launched[0]!;
  assert.equal(l.cwd, s.dir, 'in its worktree, where its conversation is saved');
  assert.deepEqual(l.args.slice(0, 1), ['-p']);
  assert.equal(l.args[1], deployRetryMessage(readLedger(s.paths.ledger).tasks[0]!, r.case), 'the retry\'s own message, not the cut-off one');
  assert.match(l.args[1]!, /Your deploy to Dev \(Acme Dev\) failed at 2026-11-01 10:00 UTC: The deploy to Acme Dev failed \(job 0Af9\)/);
  assert.deepEqual(l.args.slice(2, 4), ['--resume', SID]);
  const t = readLedger(s.paths.ledger).tasks[0]!;
  assert.equal(t.state, 'running');
  assert.equal(t.blocker, null, 'what blocked it is cleared with the move');
  const h = t.history.at(-1)!;
  assert.deepEqual([h.from, h.to, h.by, h.reason], ['blocked', 'running', 'human:jordan-kim', retryReason(r.case)]);
  assert.deepEqual(t.run?.resumes?.map((x) => x.by), ['human:jordan-kim']);
  const moved = events(s.paths.events).find((e) => e.type === 'task.moved' && e.data?.to === 'running');
  assert.ok(moved, 'the move is an event');
});

test('Retry carries a builder on from review, as after a waived deploy, and from running with a stopped builder that never deployed', () => {
  const review = setup({ state: 'review', failed: false });
  retryDeploy(review.paths, sf, 'ACME-7', review.deps, by);
  assert.equal(readLedger(review.paths.ledger).tasks[0]!.state, 'running');
  assert.match(review.launched[0]!.args[1]!, /You stopped before you deployed to Dev \(Acme Dev\)\./);
  const running = setup({ state: 'running', failed: false });
  retryDeploy(running.paths, sf, 'ACME-7', running.deps, by);
  const t = readLedger(running.paths.ledger).tasks[0]!;
  assert.equal(t.state, 'running');
  assert.ok(!t.history.some((h) => h.from === 'running' && h.to === 'running'), 'no move for a running task');
  assert.equal(running.launched.length, 1);
});

test('Retry is refused, with nothing started and the state as it was, while the builder runs, with no worktree, on a generic project, and over the cap', () => {
  const refuse = (s: ReturnType<typeof setup>, pattern: RegExp, config: Config = sf) => {
    const before = readLedger(s.paths.ledger).tasks[0]!.state;
    assert.throws(() => retryDeploy(s.paths, config, 'ACME-7', s.deps, by), (e: Error & { code?: string }) => { assert.match(e.message, pattern); return true; });
    assert.equal(s.launched.length, 0, 'nothing started');
    assert.equal(readLedger(s.paths.ledger).tasks[0]!.state, before, 'the state as it was');
  };
  refuse(setup({ state: 'running', sessions: [{ id: '7a1c0e52', sessionId: SID, kind: 'background', pid: 9, state: 'working', status: 'busy' }] }), /^Retry with an agent can't run for ACME-7: ACME-7's builder is still working on it\./);
  const gone = setup();
  // The worktree recorded on the run was removed.
  mutate(gone.paths, now, (l, emit) => { l.tasks[0]!.run!.worktree = join(gone.dir, 'not-here'); emit({ type: 'task.updated', task: 'ACME-7', actor: 'human', by: 'human:test', data: {} }); });
  refuse(gone, /worktree isn't on disk any more/);
  refuse(setup(), /this isn't a Salesforce project/, { ...sf, profile: 'generic' });
  refuse(setup({ sessions: null }), /Claude Code's sessions didn't answer/);
  // Two builders already run in a project whose cap is two: going back to running would pass it.
  refuse(setup({ others: 2 }), /can't go back to running: 2 builders are running in this project, and its cap is 2/);
  // A resume under way counts as the builder running.
  const busy = setup();
  mkdirSync(join(busy.paths.stateDir, 'resumes'), { recursive: true });
  writeFileSync(resumingPath(busy.paths, 'ACME-7'), JSON.stringify({ sessionId: SID, pid: process.pid, startedAt: now().toISOString(), by: 'human:x', log: 'x' }));
  refuse(busy, /still working on it/);
});

test('a plain resume still refuses a blocked task: only a retry moves it back to running', () => {
  const s = setup();
  assert.throws(() => resume(s.paths, sf, 'ACME-7', s.deps, by), /ACME-7 is blocked\. Only a running task's builder is resumed\./);
  assert.equal(s.launched.length, 0);
});

test('the move back to running is checked as a rework\'s restart: from blocked or review only; edge cases: running needs none, and a protected environment or the cap refuses', () => {
  assert.deepEqual(RESUME_MOVES_FROM, ['blocked', 'review']);
  const s = setup({ others: 1 });
  const l = readLedger(s.paths.ledger);
  const t = l.tasks[0]!;
  const req = { actor: 'human' as const, by: 'human:jordan-kim', reason: 'Retry' };
  assert.deepEqual(retryMoveProblems(l, sf, t, req), [], 'one builder runs and the cap is two');
  assert.deepEqual(retryMoveProblems(l, sf, { ...t, state: 'running' }, req), [], 'a running task needs no move');
  assert.deepEqual(retryMoveProblems(l, sf, { ...t, state: 'todo' }, req), ['ACME-7 is todo. A retry carries on a builder that is running, blocked or in review.']);
  assert.match(retryMoveProblems(l, { ...sf, agents: { ...sf.agents, max: 1 } }, t, req).join(' '), /1 builder is running in this project, and its cap is 1/);
  const guarded: Config = { ...sf, environments: sf.environments.map((e) => (e.branch === 'dev' ? { ...e, protected: true } : e)) };
  assert.match(retryMoveProblems(l, guarded, t, req).join(' '), /"Dev" is protected\. Agents never work on it directly\./);
});
