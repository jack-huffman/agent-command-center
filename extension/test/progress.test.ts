import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import type { HeavyState } from '../../packages/core/src/semaphore.ts';
import { tempDir } from '../../packages/core/test/support.ts';
import { POLL_INTERVALS } from '../src/logic/polls.ts';
import type { AgentSession, TaskRow } from '../src/logic/shared.ts';
import { homeModel } from '../src/model/home.ts';
import type { HubLike, ProjectLike } from '../src/model/shared.ts';
import { needsYouCount } from '../src/model/overview.ts';
import type { RunInput } from '../src/model/runs.ts';
import { ordinal } from '../../packages/core/src/queue.ts';
import { elapsed, FinishedJobs, inProgress, type JobRow, loadWord, type ProgressGroup, readSteps, type RepoJobs } from '../src/progress.ts';
import { type LastStep, lastStepIn } from '../src/transcript.ts';
import { transcriptDir } from '../../packages/core/src/transcript.ts';
import { manifest, root } from './support.ts';
import { thisMachine } from '../../packages/core/src/this-machine.ts';

/** This machine as acc names it on the system the tests run on (T-150): the Windows CI job reads This PC. */
const HERE = thisMachine();

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 6, 12, 0);
const at = (min: number) => new Date(NOW - min * MIN).toISOString();

const project = (name = 'Acme', path = '/r'): ProjectLike => ({
  name, root: path, branch: 'dev',
  agents: { builder: { model: 'opus', effort: null, fallbackModel: null, from: { model: 'project', effort: 'default', fallbackModel: 'default' } }, planner: { model: 'claude-opus-5-5', effort: 'medium', fallbackModel: null, from: { model: 'acc', effort: 'acc', fallbackModel: 'default' } }, reviewer: { model: null, effort: null, fallbackModel: null, from: { model: 'default', effort: 'default', fallbackModel: 'default' } } },
  config: {
    github: { repo: 'o/r', account: 'me' }, profile: 'salesforce',
    environments: [
      { name: 'Dev', branch: 'dev', type: 'developer', org: 'D', default: true, protected: false, promotesTo: ['qa'] },
      { name: 'QA', branch: 'qa', type: 'partial', org: 'Q', default: false, protected: false, promotesTo: [] },
    ],
  },
  worktrees: [],
});

const row = (id: string, state: string, display: TaskRow['display'], extra: Partial<TaskRow> = {}): TaskRow =>
  ({ id, title: `Task ${id}`, state, display, environment: 'dev', deps: [], source: { kind: 'jira', url: null }, ...extra });
const wt = (id: string) => `/r/.claude/worktrees/${id}`;
const noJobs = (repo = '/r/.git/acc/ledger.json', max = 5): RepoJobs => ({ repo, max, jobs: [], reviews: [], analyses: [], resumes: [] });

interface Sample { rows?: TaskRow[]; agents?: AgentSession[]; jobs?: Partial<RepoJobs>; heavy?: HeavyState | null; machine?: { load: number; cpus: number } | null; asked?: boolean }

function hub(s: Sample = {}): HubLike {
  const p = project();
  const jobs = { ...noJobs(), ...s.jobs };
  return {
    projects: [p], agents: s.agents ?? [], agentsError: null,
    taskRows: () => s.rows ?? [],
    projectFor: (x) => (x === '/r' || x.startsWith('/r/') ? p : undefined),
    // Only what In progress reads of a question: which session it's from.
    questions: s.asked ? [{ id: 'q-7', sessionId: 's-1' } as never] : [],
    heavy: s.heavy === undefined ? { dir: '/h', slots: 2, held: [], waiting: [] } : s.heavy,
    machine: s.machine === undefined ? { load: 2, cpus: 8 } : s.machine,
    jobsOf: () => jobs,
    stepOf: (id) => (id === 's-1' ? { step: { icon: 'edit', title: 'Edited src/escalation.ts', at: at(1) }, model: 'claude-opus-5-5' } : null),
  };
}

const group = (m: { groups: ProgressGroup[] }, key: string) => m.groups.find((g) => g.id === key);
const brief = (rows: JobRow[]) => rows.map((j) => [j.kind, j.look.label, j.label]);

test('a task\'s group lists each job under way for it: builder, analysis, review, resume, autopilot\'s step, a land, and its checks (D-092)', () => {
  const h = hub({
    rows: [
      row('T-1', 'running', 'running', { run: { bgId: 'bg1', sessionId: 's-1', worktree: wt('T-1') }, agent: { label: 'Working', icon: 'sync~spin', tone: 'blue' }, since: at(14), branchStats: { commits: 3, files: 7, uncommitted: 2 } }),
      row('T-2', 'todo', 'ready', { analyzing: { sessionId: 'an-2' } }),
      row('T-3', 'review', 'review', { reviewing: { sessionId: 'rv-3' }, run: { worktree: wt('T-3') } }),
      row('T-4', 'running', 'running', { run: { sessionId: 's-4', worktree: wt('T-4') }, agent: { label: 'Resumed: working', icon: 'sync~spin', tone: 'blue' }, resuming: true, since: at(5) }),
      row('T-5', 'review', 'review'),
      row('T-6', 'review', 'review'),
      row('T-7', 'todo', 'ready'),
      // A review in the cloud (T-86): no marker on this Mac; the row says so.
      row('T-8', 'review', 'review', { reviewing: { sessionId: 'session_01R', name: 'acme · T-8 · review', where: 'cloud', url: 'https://claude.ai/code/session_01R' }, cloudReview: { url: 'https://claude.ai/code/session_01R', firedAt: at(7), wait: null, failed: false } }),
    ],
    agents: [{ cwd: wt('T-1'), kind: 'background', startedAt: 1, id: 'bg1', sessionId: 's-1', state: 'working', pid: 41 }],
    jobs: {
      analyses: [{ task: 'T-2', sessionId: 'an-2', startedAt: at(3), pid: 50 }],
      reviews: [{ task: 'T-3', sessionId: 'rv-3', sha: 'abcdef123', startedAt: at(2), pid: 51 }, { task: 'T-5', sessionId: 'rv-5', sha: 'bbbbbbb', startedAt: at(9), pid: 77 }],
      resumes: [{ task: 'T-4', sessionId: 's-4', startedAt: at(5), by: 'orchestrator:autopilot', pid: 52 }],
      jobs: [
        // Autopilot reviewing T-5: its own review marker (same process) is the same job, so one row.
        { key: 'autopilot-T-5-77-1', kind: 'autopilot', task: 'T-5', step: 'review', by: 'orchestrator:autopilot', pid: 77, startedAt: at(9) },
        { key: 'land-T-6-90-1', kind: 'land', task: 'T-6', by: 'human:jordan', pid: 90, startedAt: at(1) },
      ],
    },
    heavy: { dir: '/h', slots: 2, held: [{ slot: 1, pid: 60, at: NOW - 4 * MIN, what: 'validate', task: 'T-1', project: 'Acme' }], waiting: [{ pid: 61, at: NOW - MIN, place: 1, what: 'validate', cwd: `${wt('T-4')}/sub` }] },
  });
  const runs: RunInput[] = [{ id: 'r1', label: 'Review T-3', command: '/opt/acc review T-3', cwd: '/r', startedAt: NOW - 2 * MIN, endedAt: null, code: null, stopped: false, lines: [], prompt: null, step: null }];
  const m = inProgress({ hub: h, runs, autopilot: () => 'on', now: NOW });

  const t1 = group(m, 'T-1')!;
  assert.deepEqual(brief(t1.jobs), [['builder', 'Working', 'Builder'], ['check', 'Running', 'Check: validate']]);
  assert.equal(t1.jobs[0]!.detail, 'Edited src/escalation.ts', 'its latest step');
  assert.equal(t1.jobs[0]!.meta, 'claude-opus-5-5 · 3 commits, 7 files changed, 2 not committed', 'its model and its branch so far, on a line of their own');
  assert.equal(t1.jobs[0]!.since, '14 min');
  assert.equal(t1.jobs[1]!.detail, 'in heavy-check slot 1 of 2');
  assert.deepEqual([t1.look.label, t1.since, t1.title, t1.ref], ['Running', '14 min', 'Task T-1', { project: '/r', task: 'T-1' }]);
  assert.deepEqual(brief(group(m, 'T-2')!.jobs), [['analysis', 'Making a plan', 'Plan']]);
  assert.deepEqual(brief(group(m, 'T-3')!.jobs), [['review', 'Reviewing', 'Review']]);
  assert.equal(group(m, 'T-3')!.jobs[0]!.detail, 'reading abcdef1');
  // The cloud review (T-86): its own look, how long, and Watch on claude.ai.
  const t8 = group(m, 'T-8')!;
  assert.deepEqual(brief(t8.jobs), [['review', 'Cloud review', 'Review']]);
  assert.deepEqual([t8.jobs[0]!.look.icon, t8.jobs[0]!.since, t8.jobs[0]!.detail], ['cloud', '7 min', 'reading the branch on GitHub; its verdict comes back by a push, which the next sync takes']);
  assert.deepEqual(t8.jobs[0]!.actions.map((a) => [a.label, a.command]), [['Watch', 'acc.task.watchReview']]);
  // A resumed builder, its resume, and a check found by its folder: the builder's worktree.
  assert.deepEqual(brief(group(m, 'T-4')!.jobs), [['builder', 'Working', 'Builder'], ['resume', 'Resumed', 'Resume'], ['check', '1st in line', 'Check: validate']]);
  assert.equal(group(m, 'T-4')!.jobs[0]!.detail, '');
  assert.equal(group(m, 'T-4')!.jobs[0]!.meta, 'opus (its setting)', 'no answer yet: the model it was set to run, said so');
  assert.deepEqual(brief(group(m, 'T-5')!.jobs), [['autopilot', 'Reviewing it', 'Autopilot']], 'autopilot\'s review is one row, not two');
  assert.deepEqual(brief(group(m, 'T-6')!.jobs), [['land', 'Opening pull request', 'Open pull request']]);
  assert.match(group(m, 'T-6')!.jobs[0]!.detail, /for jordan$/);
  assert.equal(group(m, 'T-7'), undefined, 'a task with nothing under way isn\'t listed');
  // Every state has words and an icon; only what waits on a person is orange.
  for (const g of m.groups) for (const j of g.jobs) assert.ok(j.look.label && j.look.icon && j.look.tone !== 'orange', `${g.id} ${j.kind}`);
});

test('a cloud review quiet for too long, or one whose verdict acc couldn\'t read, waits on you on In progress, with why and Review on this Mac; one that failed with its reason gone, or a task with none, has no row (T-86 edge cases)', () => {
  const quiet = row('T-9', 'review', 'needs-you', { reviewing: { sessionId: 'session_01Q', where: 'cloud', url: 'https://claude.ai/code/session_01Q' }, cloudReview: { url: 'https://claude.ai/code/session_01Q', firedAt: at(150), wait: `no verdict from its cloud reviewer for 150 minutes: review it on ${HERE}`, failed: false } });
  const failed = row('T-10', 'review', 'needs-you', { cloudReview: { url: 'https://claude.ai/code/session_01F', firedAt: at(20), wait: `its cloud reviewer pushed acc/review/T-10-abc without review.json: review it on ${HERE}`, failed: true } });
  const gone = row('T-11', 'review', 'review', { cloudReview: { url: 'https://claude.ai/code/session_01G', firedAt: at(20), wait: null, failed: true } });
  const m = inProgress({ hub: hub({ rows: [quiet, failed, gone, row('T-12', 'review', 'review')] }), runs: [], autopilot: () => null, now: NOW });
  const t9 = group(m, 'T-9')!;
  assert.deepEqual(brief(t9.jobs), [['review', 'Waiting on you', 'Review']]);
  assert.deepEqual([t9.jobs[0]!.look.icon, t9.jobs[0]!.look.tone, t9.jobs[0]!.since], ['bell', 'orange', '2 h 30 min']);
  assert.equal(t9.jobs[0]!.detail, `no verdict from its cloud reviewer for 150 minutes: review it on ${HERE}`);
  assert.deepEqual(t9.jobs[0]!.actions.map((a) => [a.label, a.command]), [['Watch', 'acc.task.watchReview'], [`Review on ${HERE}`, 'acc.task.reviewLocal']]);
  const t10 = group(m, 'T-10')!;
  assert.deepEqual(brief(t10.jobs), [['review', 'Waiting on you', 'Review']]);
  assert.deepEqual(t10.jobs[0]!.actions.map((a) => a.label), [`Review on ${HERE}`], 'nothing to watch: it gave what it gave');
  assert.equal(group(m, 'T-11'), undefined, 'a failed review with no reason to show isn\'t a job');
  assert.equal(group(m, 'T-12'), undefined);
});

test('each row offers what applies to it, each saying what it does; Stop goes through acc.job.stop, which asks first (D-092)', () => {
  const h = hub({
    rows: [
      row('T-1', 'running', 'needs-you', { run: { bgId: 'bg1', sessionId: 's-1', worktree: wt('T-1') }, agent: { label: 'Needs you: has a question', icon: 'bell', tone: 'orange' }, asking: true, since: at(3) }),
      row('T-2', 'running', 'needs-you', { run: { bgId: 'bg2', sessionId: 's-2' }, stopped: { said: 'API Error: Your computer went to sleep mid-response.' }, since: at(90) }),
      row('T-3', 'running', 'running', { run: { sessionId: 's-3' }, resuming: true, agent: { label: 'Resumed: working', icon: 'sync~spin', tone: 'blue' }, since: at(2) }),
      row('T-4', 'review', 'review'),
    ],
    agents: [{ cwd: wt('T-1'), kind: 'background', startedAt: 1, id: 'bg1', sessionId: 's-1', state: 'working', pid: 41 }],
    asked: true,
    jobs: {
      resumes: [{ task: 'T-3', sessionId: 's-3', startedAt: at(2), by: 'human:jordan', pid: 52 }],
      jobs: [{ key: 'autopilot-T-4-77-1', kind: 'autopilot', task: 'T-4', step: 'land', by: 'orchestrator:autopilot', pid: 77, startedAt: at(1) }],
    },
  });
  const m = inProgress({ hub: h, autopilot: () => 'on', now: NOW });
  const actions = (id: string, kind: string) => group(m, id)!.jobs.find((j) => j.kind === kind)!.actions;
  const asking = actions('T-1', 'builder');
  assert.deepEqual(asking.map((a) => a.label), ['Answer', 'Watch', 'Open in Claude Code', 'Stop']);
  assert.equal(asking[0]!.question, 'q-7', 'Answer goes to its question on this page');
  assert.deepEqual(JSON.parse(asking[3]!.arg!), { kind: 'builder', project: '/r', task: 'T-1' });
  assert.equal(asking[3]!.command, 'acc.job.stop');
  assert.equal(group(m, 'T-1')!.jobs[0]!.look.label, 'Waiting on you');
  assert.equal(group(m, 'T-1')!.jobs[0]!.look.tone, 'orange');
  const stopped = group(m, 'T-2')!.jobs[0]!;
  assert.deepEqual([stopped.look.label, stopped.look.tone], ['Stopped', 'orange']);
  assert.match(stopped.detail, /^its turn ended: API Error/);
  assert.deepEqual(stopped.actions.map((a) => a.label), ['Watch', 'Open in Claude Code'], 'nothing to stop: Resume is in Needs you');
  assert.deepEqual(actions('T-3', 'builder').map((a) => a.label), ['Watch', 'Open in Claude Code'], 'a resumed builder is stopped by its resume');
  assert.deepEqual(actions('T-3', 'resume').map((a) => [a.label, a.arg && JSON.parse(a.arg)]), [['Watch', undefined], ['Stop', { kind: 'resume', project: '/r', task: 'T-3' }]]);
  assert.deepEqual(actions('T-4', 'autopilot').map((a) => a.label), ['Output', 'Turn autopilot off'], 'autopilot on in this window');
  assert.deepEqual(inProgress({ hub: h, autopilot: () => 'elsewhere', now: NOW }).groups.find((g) => g.id === 'T-4')!.jobs[0]!.actions, [], 'on elsewhere: nothing to stop from here');
  for (const g of m.groups) for (const j of g.jobs) for (const a of j.actions) assert.ok(a.tip.length > 20, `${a.label} says what it does`);
  for (const a of m.groups.flatMap((g) => g.jobs.flatMap((j) => j.actions)).filter((x) => x.command === 'acc.job.stop')) assert.match(a.tip, /Asks first\.$/);
});

test('a heavy-check slot\'s owner names its task, or its environment; one an older acc took names nothing, and only the machine line has it (D-092)', () => {
  const h = hub({
    rows: [row('T-1', 'review', 'review'), row('T-2', 'running', 'running', { run: { worktree: wt('T-2') }, since: at(5) })],
    jobs: { jobs: [{ key: 'promote-qa-70-1', kind: 'promote', from: 'dev', env: 'qa', by: 'human:jordan', pid: 70, startedAt: at(6), carries: ['T-9'] }] },
    heavy: {
      dir: '/h', slots: 3,
      held: [
        { slot: 1, pid: 60, at: NOW - 4 * MIN, what: 'check', task: 'T-1', project: 'Acme' },
        { slot: 2, pid: 70, at: NOW - 2 * MIN, what: 'Validate dev → qa', env: 'qa', project: 'Acme' },
        { slot: 3, pid: 80, at: 0 },
      ],
      waiting: [
        { pid: 81, at: NOW - MIN, place: 1, what: 'Deploy dev', env: 'dev', project: 'Acme' },
        { pid: 82, at: NOW - MIN / 2, place: 2, what: 'check', cwd: wt('T-2') },
      ],
    },
  });
  const m = inProgress({ hub: h, now: NOW });
  assert.deepEqual(brief(group(m, 'T-1')!.jobs), [['check', 'Running', 'Check: check']], 'by its task');
  assert.deepEqual(brief(group(m, 'T-2')!.jobs).at(-1), ['check', '2nd in line', 'Check: check'], 'by its folder');
  const promote = group(m, 'Promote dev → qa')!;
  assert.deepEqual([promote.title, promote.note, promote.ref], ['Dev to QA', 'Tasks in Dev not yet in QA: T-9', null]);
  assert.deepEqual(brief(promote.jobs), [['promote', 'Promoting', 'Promotion'], ['check', 'Running', 'Check: Validate dev → qa']], 'its validation is in its group');
  assert.deepEqual(brief(group(m, 'Deploy dev')!.jobs), [['check', '1st in line', 'Check: Deploy dev']], 'a deploy waiting for a slot has a group of its own');
  const slots = m.machine.find((c) => c.key === 'slots')!;
  assert.equal(slots.look.label, 'Heavy checks: 3 of 3 in use, none free, 2 waiting');
  assert.deepEqual(slots.tip.split('\n'), ['Slot 1: check for T-1, 4 min', 'Slot 2: Validate dev → qa, 2 min', 'Slot 3: a check from an older Command Center', '1st in line: Deploy dev, 1 min', '2nd in line: check, under a minute']);
});

test('the machine line: heavy checks in use and free, builders of agents.max for each repo, and the load in words (D-092)', () => {
  const running = (id: string) => row(id, 'running', 'running', { since: at(1) });
  const h = hub({ rows: [running('T-1'), running('T-2'), running('T-3'), running('T-4')], heavy: { dir: '/h', slots: 2, held: [{ slot: 1, pid: 60, at: NOW, what: 'check', task: 'T-1' }], waiting: [] }, machine: { load: 4, cpus: 8 } });
  assert.deepEqual(inProgress({ hub: h, now: NOW }).machine.map((c) => [c.look.label, c.look.icon, c.look.tone]), [
    ['Heavy checks: 1 of 2 in use, 1 free', 'server-process', 'blue'],
    ['Builders: 4 of 5', 'hubot', 'blue'],
    ['Load: calm', 'pulse', 'neutral'],
  ]);
  // Two projects of one repo share its ledger: one repo, counted once. Another repo has its own.
  const a = project('Acme', '/r');
  const b = project('Acme main', '/r-main');
  const c = project('Tools', '/t');
  const rows: Record<string, TaskRow[]> = { '/r': [running('T-1'), running('T-2')], '/r-main': [running('T-1'), running('T-2')], '/t': [running('X-1')] };
  const two: HubLike = {
    projects: [a, b, c], agents: [], agentsError: null, taskRows: (r) => rows[r] ?? [], projectFor: () => undefined,
    jobsOf: (r) => (r === '/t' ? noJobs('/t/.git/acc/ledger.json', 3) : noJobs()),
  };
  assert.deepEqual(inProgress({ hub: two, now: NOW }).machine.map((x) => x.look.label), ['Builders: 2 of 5 in Acme', 'Builders: 1 of 3 in Tools']);
  assert.deepEqual([0.5, 1.0, 2.0].map((per) => loadWord({ load: per * 10, cpus: 10 })?.label), ['Calm', 'Busy', 'Very busy']);
  assert.equal(loadWord({ load: 0, cpus: 8 }), null, 'Windows reads 0: no word rather than a calm it can\'t know');
  assert.deepEqual([ordinal(1), ordinal(2), ordinal(3), ordinal(4), ordinal(11), ordinal(22)], ['1st', '2nd', '3rd', '4th', '11th', '22nd']);
  assert.deepEqual([elapsed(30_000), elapsed(12 * MIN), elapsed(65 * MIN), elapsed(120 * MIN), elapsed(3 * 24 * 60 * MIN)], ['under a minute', '12 min', '1 h 5 min', '2 h', '3 days']);
});

test('a finished job leaves its group as a done line for a minute; then a task with nothing running leaves the page (D-092)', () => {
  const reviewing = hub({ rows: [row('T-1', 'review', 'review', { reviewing: { sessionId: 'rv' } })], jobs: { reviews: [{ task: 'T-1', sessionId: 'rv', sha: 'abc1234', startedAt: at(4), pid: 51 }] } });
  const reviewed = hub({ rows: [row('T-1', 'review', 'review', { review: { verdict: 'pass', summary: 'ok', current: true } })] });
  const finished = new FinishedJobs();
  const first = inProgress({ hub: reviewed, finished, now: NOW - 60 * MIN });
  assert.equal(first.groups.length, 0, 'nothing ends on the first look');
  inProgress({ hub: reviewing, finished, now: NOW });
  // It ended between the two looks: the look that finds it gone is when it ended.
  const ended = inProgress({ hub: reviewed, finished, now: NOW + 10_000 });
  const g = group(ended, 'T-1')!;
  assert.deepEqual([g.jobs, g.done.map((d) => [d.text, d.look.label, d.look.tone, d.age])], [[], [['Review finished: passed', 'Done', 'neutral', 0]]]);
  assert.equal(ended.count, 0, 'a done line isn\'t something running');
  assert.equal(inProgress({ hub: reviewed, finished, now: NOW + 40_000 }).groups[0]!.done[0]!.age, 30, 'its age goes on from when it ended, so the fade isn\'t restarted');
  assert.equal(inProgress({ hub: reviewed, finished, now: NOW + 69_000 }).groups.length, 1, 'still there just before its minute is up');
  const later = inProgress({ hub: reviewed, finished, now: NOW + 70_000 });
  assert.deepEqual([later.groups, later.empty], [[], 'Nothing is running.']);

  // A builder that finishes: its task went to review. One that blocks needs you.
  const building = hub({ rows: [row('T-2', 'running', 'running', { since: at(3) })] });
  const f2 = new FinishedJobs();
  inProgress({ hub: building, finished: f2, now: NOW });
  const blocked = inProgress({ hub: hub({ rows: [row('T-2', 'blocked', 'blocked')] }), finished: f2, now: NOW + 1000 });
  assert.deepEqual(group(blocked, 'T-2')!.done.map((d) => [d.text, d.look.tone]), [['Builder blocked: it needs you', 'orange']]);
});

test('groups go busiest first, then longest running; the heading counts groups with something under way; nothing at all is one line (D-092)', () => {
  const h = hub({
    rows: [row('T-1', 'running', 'running', { since: at(30) }), row('T-2', 'running', 'running', { since: at(5) }), row('T-3', 'running', 'running', { since: at(50) })],
    heavy: { dir: '/h', slots: 2, held: [{ slot: 1, pid: 60, at: NOW, what: 'check', task: 'T-2' }], waiting: [] },
  });
  const m = inProgress({ hub: h, now: NOW });
  assert.deepEqual(m.groups.map((g) => [g.id, g.jobs.length]), [['T-2', 2], ['T-3', 1], ['T-1', 1]]);
  assert.equal(m.count, 3);
  const idle = inProgress({ hub: hub({ rows: [row('T-1', 'todo', 'ready')] }), now: NOW });
  assert.deepEqual([idle.count, idle.groups, idle.machine, idle.empty], [0, [], [], 'Nothing is running.'], 'one line, and nothing else');
});

test('In progress sits on the Overview and never changes the badge, which counts only what needs you (D-092)', () => {
  const base = { section: 'overview' as const, boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set<string>() }, now: NOW };
  const quiet = homeModel({ ...base, hub: hub({ rows: [row('T-1', 'review', 'review')] }) });
  const busy = homeModel({ ...base, hub: hub({ rows: [row('T-1', 'review', 'review'), row('T-2', 'running', 'running', { since: at(2) })], jobs: { reviews: [{ task: 'T-1', sessionId: 'rv', sha: 'abc', startedAt: at(1), pid: 9 }] } }) });
  assert.equal(busy.overview.inProgress.count, 2);
  assert.equal(quiet.overview.inProgress.count, 0);
  assert.equal(needsYouCount(busy.overview), needsYouCount(quiet.overview));
  const overview = (m: typeof busy) => m.nav.find((n) => n.section === 'overview')!;
  assert.deepEqual([overview(busy).count, overview(busy).attention], [overview(quiet).count, overview(quiet).attention], 'the rail\'s Overview badge');
  assert.ok(!busy.nav.some((n) => (n.section as string) === 'in-progress'), 'no page of its own');
  // On the page: a card under what needs you (T-36), which opens a line per task with the machine's line on top.
  assert.deepEqual(busy.overview.cards.find((c) => c.key === 'progress')?.count, 2);
  assert.ok(!quiet.overview.cards.some((c) => c.key === 'progress'), 'nothing under way, no card');
  const page = ['overview.ts', 'progress.ts', 'landing.ts', 'detail.ts'].map((f) => readFileSync(join(root, 'webview', f), 'utf8')).join('\n');
  assert.match(page, /\.\.\.o\.cards\.map\(landingCard\)/);
  assert.match(page, /const top = d\.group === 'progress' \? machineLine\(o\.inProgress\) : null;/);
  assert.match(page, /row\.style\.animationDelay = `-\$\{r\.fading\}s`/, 'the fade starts as far in as the line is old');
});

test('acc.job.stop may be asked for from the page, is declared, hidden from the palette, and asks before it stops anything (D-092)', () => {
  assert.ok(manifest.contributes.commands.some((c: { command: string }) => c.command === 'acc.job.stop'));
  assert.ok(manifest.contributes.menus.commandPalette.some((c: { command: string; when: string }) => c.command === 'acc.job.stop' && c.when === 'false'));
  assert.match(readFileSync(join(root, 'src', 'model', 'overview.ts'), 'utf8'), /'acc\.job\.stop', 'acc\.autopilot\.output'/);
  const ext = ['extension.ts', 'progress.ts'].map((f) => readFileSync(join(root, 'src', f), 'utf8')).join('\n');
  const body = ext.slice(ext.indexOf("reg('acc.job.stop'"), ext.indexOf('});', ext.indexOf("reg('acc.job.stop'")));
  // Every kind asks first: a modal before claude stop, endResume, a run's stop or autopilot's switch.
  for (const what of ["runFile('claude', ['stop'", 'endResume(', "runs.control(run.id, 'stop')", 'autopilot.toggle(']) {
    const i = body.indexOf(what);
    assert.ok(i > 0, what);
    assert.ok(body.lastIndexOf('await ask(', i) > body.lastIndexOf('} else if', i), `${what} comes after its question`);
  }
  // How often is logic/polls.ts's (GH-109), and the same as tasks'.
  assert.deepEqual([POLL_INTERVALS.jobs.everyMs, POLL_INTERVALS.jobs.hiddenMs], [POLL_INTERVALS.tasks.everyMs, POLL_INTERVALS.tasks.hiddenMs], 'polled as tasks are (D-044)');
  assert.match(ext, /jobs: \(\) => hub\.loadJobs\(pageVisible\),/);
});

test('a builder\'s latest step and model come from its transcript\'s tail, skipping a helper agent\'s turns', () => {
  const file = join(tempDir('acc-step-'), 's.jsonl');
  const rec = (r: Record<string, unknown>) => JSON.stringify({ sessionId: 's', cwd: '/wt', timestamp: '2026-10-06T11:59:00Z', ...r });
  writeFileSync(file, [
    rec({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/wt/src/a.ts' } }] } }),
    rec({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }),
    rec({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Now the tests.' }, { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test', description: 'Run the tests' } }] } }),
    JSON.stringify({ type: 'assistant', isSidechain: true, message: { model: 'claude-haiku', content: [{ type: 'tool_use', id: 'x', name: 'Read', input: { file_path: '/wt/b.ts' } }] } }),
    rec({ type: 'assistant', message: { model: '<synthetic>', content: [{ type: 'text', text: 'API Error' }] } }),
    '{ torn',
  ].join('\n'));
  // Its latest calls, newest first, for what it's doing (T-164): a helper's Read isn't one of them.
  assert.deepEqual(lastStepIn(file), {
    step: { icon: 'terminal', title: 'Run the tests', at: '2026-10-06T11:59:00Z' }, model: 'claude-opus-5-5',
    recent: [{ tool: 'Bash', command: 'npm test', path: null }, { tool: 'Edit', command: null, path: 'src/a.ts' }],
  });
  assert.equal(lastStepIn(join(dirname(file), 'none.jsonl')), null);
});

test('readSteps reads a busy session with no task, and not an idle one, and forgets a session no longer at work (T-164)', () => {
  const config = tempDir('acc-steps-');
  const cwd = '/w/acme';
  const dir = transcriptDir(join(config, 'projects'), cwd);
  mkdirSync(dir, { recursive: true });
  const line = JSON.stringify({ type: 'assistant', cwd, timestamp: '2026-10-06T11:59:00Z', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'npm test' } }] } });
  for (const id of ['busy', 'working', 'idle', 'gone']) writeFileSync(join(dir, `${id}.jsonl`), line);
  const agents: AgentSession[] = [
    { cwd, kind: 'interactive', startedAt: 1, sessionId: 'busy', status: 'busy' },
    { cwd, kind: 'background', startedAt: 1, sessionId: 'working', state: 'working', id: 'b' },
    { cwd, kind: 'interactive', startedAt: 1, sessionId: 'idle', status: 'idle' },
    { cwd, kind: 'background', startedAt: 1, sessionId: 'done', state: 'done', id: 'c' },
  ];
  const steps = new Map<string, { file: string; stamp: string; step: LastStep | null }>([['gone', { file: join(dir, 'gone.jsonl'), stamp: '1', step: null }]]);
  const was = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  try {
    readSteps({ projects: [], taskRows: () => [], agents }, steps, () => '1');
  } finally {
    if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = was;
  }
  assert.deepEqual([...steps.keys()].sort(), ['busy', 'working'], 'the busy ones, with no task; not the idle or finished one; and the old one forgotten');
  assert.deepEqual(steps.get('busy')!.step!.recent, [{ tool: 'Bash', command: 'npm test', path: null }]);
});
