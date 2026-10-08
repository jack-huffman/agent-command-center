/**
 * In progress, on the Overview (D-092): every job under way, grouped by the task it's for, with a line
 * about the machine on top. A builder, an analysis, a review, a check holding or waiting for a heavy-check
 * slot, a resume, autopilot's step, and a land, refresh, promotion or deploy. Built from what the hub
 * read, as plain data. No vscode import, so it's testable.
 */
import { type Job, jobsUnderWay } from '../../packages/core/src/jobs.ts';
import type { AutopilotStepName, Ledger } from '../../packages/core/src/ledger.ts';
import type { HeavyState, SlotHolder, SlotWaiter } from '../../packages/core/src/semaphore.ts';
import { isUnder, type TaskRow, type Tone } from './logic/shared.ts';
import { sessionFor } from './logic/agents.ts';
import { displayLook, type HubLike, type Look, type ProjectLike, type Ref } from './model/shared.ts';
import type { RunInput } from './model/runs.ts';
import type { ExtensionArea } from './area.ts';
import { runFile } from './run.ts';
import { endResume, resuming } from '../../packages/core/src/resume.ts';
import { dirname, join } from 'node:path';
import type { Hub, Project } from './hub.ts';
import { existsSync, readdirSync } from 'node:fs';
import type { RepoPaths } from '../../packages/core/src/paths.ts';
import { arrivedAt } from '../../packages/core/src/carried.ts';
import { reviewing } from '../../packages/core/src/review.ts';
import { analyzing } from '../../packages/core/src/analyze.ts';
import { claudeProjectsDir, type LastStep, lastStepIn, transcriptFile } from './transcript.ts';

/** A repo's jobs under way, as the hub read them: projects of one repo share them. */
export interface RepoJobs {
  /** The repo, by its ledger. */
  repo: string;
  /** How many builders it runs at once (agents.max). */
  max: number;
  /** Land, refresh, promote, deploy and autopilot's step. A promotion says what it takes on, as far as the ledger knows. */
  jobs: (Job & { carries?: string[] })[];
  reviews: { task: string; sessionId: string; sha: string; startedAt: string; pid: number }[];
  analyses: { task: string; sessionId: string; startedAt: string; pid: number }[];
  resumes: { task: string; sessionId: string; startedAt: string; by: string; pid: number }[];
}

export type JobKind = 'builder' | 'analysis' | 'review' | 'check' | 'resume' | 'autopilot' | 'land' | 'refresh' | 'promote' | 'deploy' | 'message';

/** A row's button: a command on a ref, a command with one argument, or a question on this page to go to. */
export interface ProgressAction {
  label: string;
  icon: string;
  /** What it does, on hover. */
  tip: string;
  command?: string;
  ref?: Ref;
  arg?: string;
  /** The question's id: Answer scrolls to its card in Needs you. */
  question?: string;
}

export interface JobRow {
  key: string;
  kind: JobKind;
  /** Its state, in words, with an icon: orange waits on you, blue is working, neutral is idle or in line. */
  look: Look;
  label: string;
  detail: string;
  /** A builder's model and its branch so far: a line of its own under the detail, so neither is cut off. */
  meta?: string;
  /** How long it has run, in words. */
  since: string;
  actions: ProgressAction[];
}

/** A job that ended in the last minute: one line, fading. */
export interface DoneRow {
  key: string;
  look: Look;
  text: string;
  /** Seconds since it ended, by the extension's clock: the page's fade starts that far in, so a redraw never restarts it. */
  age: number;
}

export interface ProgressGroup {
  key: string;
  /** A task's id, or an environment's job: "Deploy dev", "Promote dev → qa". */
  id: string;
  title: string;
  look: Look;
  /** How long it has had something under way. */
  since: string;
  /** Its project, when the page shows more than one. */
  project: string | null;
  /** Its task's page. */
  ref: Ref | null;
  /** A promotion's tasks, as far as the ledger says. */
  note: string | null;
  jobs: JobRow[];
  done: DoneRow[];
}

/** One part of the machine line: heavy-check slots, builders in a repo, or the load. */
export interface MachineChip {
  key: string;
  look: Look;
  /** More than the words say, on hover: who holds each slot and who waits. */
  tip: string;
}

export interface ProgressModel {
  /** Groups with something under way: the heading's number. */
  count: number;
  machine: MachineChip[];
  groups: ProgressGroup[];
  /** One line when nothing runs anywhere; nothing else shows then. */
  empty: string | null;
}

export interface ProgressInput {
  hub: HubLike;
  /** Commands this window runs (D-030): their Stop is this window's to give. */
  runs?: RunInput[];
  finished?: FinishedJobs;
  /** Whether autopilot runs for a project's repo in this window, somewhere else, or not at all (D-064). */
  autopilot?: (root: string) => 'on' | 'elsewhere' | null;
  now?: number;
}

const LOOK = (label: string, icon: string, tone: Tone): Look => ({ label, icon, tone });
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const who = (by: string): string => (by === 'orchestrator:autopilot' || by.endsWith(' for orchestrator:autopilot') ? 'autopilot' : by.replace(/^human:/, ''));

/** How long, in words: "under a minute", "12 min", "1 h 5 min", "3 days". */
export function elapsed(ms: number): string {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.floor(h / 24)} days`;
}

export const ordinal = (n: number): string => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;

/**
 * The machine's load in words, from the last minute's load average per core: below 0.7 calm, below 1.5
 * busy, more very busy. Null where the load reads 0, as on Windows, rather than a calm it can't know.
 */
export function loadWord(m: { load: number; cpus: number } | null | undefined): Look | null {
  if (!m || !(m.load > 0)) return null;
  const per = m.load / Math.max(1, m.cpus);
  return per < 0.7 ? LOOK('Calm', 'pulse', 'neutral') : per < 1.5 ? LOOK('Busy', 'pulse', 'blue') : LOOK('Very busy', 'flame', 'blue');
}

/** What autopilot's step is doing, in words. */
export const STEP_DOING: Record<AutopilotStepName, string> = {
  review: 'Reviewing it', land: 'Landing it', dispatch: 'Re-dispatching it', refresh: 'Merging its base in', resume: 'Resuming its builder',
  checks: 'Sending it back for its failing checks', merge: 'Merging its pull request', start: 'Starting it', queue: 'Taking its turn in the merge queue',
};
const STEP_DONE: Record<AutopilotStepName, string> = { review: 'reviewed it', land: 'landed it', dispatch: 're-dispatched it', refresh: 'merged its base in', resume: 'resumed its builder', checks: 'sent it back for its failing checks', merge: 'merged its pull request', start: 'started it', queue: 'took its turn in the merge queue' };
const STEP_VERB: Record<AutopilotStepName, string> = { review: 'review it', land: 'land it', dispatch: 're-dispatch it', refresh: 'merge its base in', resume: 'resume its builder', checks: 'send it back', merge: 'merge its pull request', start: 'start it', queue: 'take its turn in the merge queue' };

/** A task's state at the head of its group, as everywhere: core's DISPLAY (GH-105). */
export const taskLook = (r: Pick<TaskRow, 'display'>): Look => displayLook(r.display);

/** What a heavy check is for, in words: "check for GH-76", "Deploy dev", or an older acc's. */
function slotWhat(h: Partial<SlotHolder & SlotWaiter>): string {
  if (!h.what) return 'a check from an older acc';
  return h.task ? `${h.what} for ${h.task}` : h.what;
}

const stop = (arg: Record<string, string>, tip: string, label = 'Stop', icon = 'debug-stop'): ProgressAction => ({ label, icon, tip: `${tip} Asks first.`, command: 'acc.job.stop', arg: JSON.stringify(arg) });

/** This window's run of a command for a task or an environment, while it runs (D-030). */
interface WindowRun { id: string; kind: 'review' | 'analysis' | 'promote' | 'deploy' | 'message'; task?: string; env?: string; from?: string; startedAt: number; cwd?: string; label: string }

function windowRuns(runs: RunInput[]): WindowRun[] {
  const out: WindowRun[] = [];
  for (const r of runs) {
    if (r.endedAt !== null || r.background) continue;
    const base = { id: r.id, startedAt: r.startedAt, label: r.label, ...(r.cwd ? { cwd: r.cwd } : {}) };
    const task = /\b(review|analyze) ([A-Za-z][A-Za-z0-9_]*-\d+)\b/.exec(r.command);
    const promote = /\bpromote (\S+) --to (\S+)/.exec(r.command);
    const deploy = /\bdeploy (\S+)/.exec(r.command);
    const message = /^Message to ([A-Z][A-Z0-9_]*-\d+)$/.exec(r.label);
    if (task) out.push({ ...base, kind: task[1] === 'review' ? 'review' : 'analysis', task: task[2]!.toUpperCase() });
    else if (promote) out.push({ ...base, kind: 'promote', from: promote[1]!, env: promote[2]! });
    else if (deploy) out.push({ ...base, kind: 'deploy', env: deploy[1]! });
    else if (message) out.push({ ...base, kind: 'message', task: message[1]! });
  }
  return out;
}

/** A job that was under way at the last look, kept so its end can be told. */
export interface Seen {
  group: { key: string; id: string; title: string; project: string | null; ref: Ref | null; root: string; task: string | null };
  kind: JobKind;
  label: string;
  /** Autopilot's step, so its end can say what it did. */
  step?: AutopilotStepName;
}

export interface Gone extends Seen {
  key: string;
  endedAt: number;
}

/**
 * Which jobs ended, kept a minute: each look is compared with the one before. A job seen for the first
 * time says nothing, and nothing ends on the first look, so opening VSCode doesn't list old work as done.
 */
export class FinishedJobs {
  private last = new Map<string, Seen>();
  private gone: Gone[] = [];
  private primed = false;
  readonly keepMs: number;

  constructor(keepMs = 60_000) {
    this.keepMs = keepMs;
  }

  update(live: Map<string, Seen>, now: number): Gone[] {
    if (this.primed) for (const [key, s] of this.last) if (!live.has(key) && !this.gone.some((g) => g.key === key)) this.gone.push({ ...s, key, endedAt: now });
    this.primed = true;
    this.last = live;
    // A job back again was a blip in what was read, not an end.
    this.gone = this.gone.filter((g) => now - g.endedAt < this.keepMs && !live.has(g.key));
    return this.gone;
  }
}

/** What a job that ended did, in words, from what the hub says now. */
function doneLine(g: Gone, row: TaskRow | undefined, hub: HubLike): { look: Look; text: string } {
  const ok = (text: string, icon = 'pass') => ({ look: LOOK('Done', icon, 'neutral'), text });
  const you = (text: string, icon: string) => ({ look: LOOK('Needs you', icon, 'orange'), text });
  switch (g.kind) {
    case 'builder':
      if (row?.state === 'review') return ok('Builder finished: waiting for review');
      if (row?.state === 'blocked') return you('Builder blocked: it needs you', 'circle-slash');
      if (row?.state === 'todo') return ok('Builder stopped: the task is back in To do', 'debug-stop');
      return ok('Builder finished');
    case 'review':
      if (row?.review?.current) return row.review.verdict === 'pass' ? ok('Review finished: passed') : ok('Review finished: asked for changes', 'request-changes');
      return ok('Review finished');
    case 'analysis': {
      const a = row?.analysis;
      if (a?.verdict === 'split') return you('Analysis finished: too big for one task', 'list-tree');
      if (a?.open.length) return you(`Analysis finished: ${plural(a.open.length, 'question')} for you`, 'comment-discussion');
      return ok(a ? 'Analysis finished: ready to build' : 'Analysis finished');
    }
    case 'autopilot': {
      const rec = g.step ? (hub.autopilotLog?.(g.group.root) ?? []).filter((x) => x.task === g.group.task && x.step === g.step).at(-1) : undefined;
      if (rec?.outcome === 'failed') return you(`Autopilot couldn't ${STEP_VERB[rec.step]}`, 'warning');
      return ok(g.step ? `Autopilot ${STEP_DONE[g.step]}` : 'Autopilot\'s step finished');
    }
    case 'land': return ok(row?.pr ? `Landed: pull request #${row.pr.number}` : 'Land finished', 'git-pull-request');
    case 'check': return ok(`${g.label} finished`);
    case 'resume': return ok('Resume ended');
    case 'refresh': return ok('Merging its base in finished');
    case 'promote': return ok('Promotion finished');
    case 'deploy': return ok('Deploy finished');
    case 'message': return ok('Its builder answered your message', 'comment');
  }
}

interface Building {
  group: ProgressGroup;
  root: string;
  task: string | null;
  /** When its first job started, for its age and its place. */
  at: number;
}

/** In progress on the Overview (D-092): jobs under way, grouped by task, busiest first, with the machine line. */
export function inProgress(i: ProgressInput): ProgressModel {
  const { hub } = i;
  const now = i.now ?? Date.now();
  const many = hub.projects.length > 1;
  const ago = (at: number | null) => (at ? elapsed(now - at) : '');
  const time = (iso: string | null | undefined) => (iso ? Date.parse(iso) || null : null);
  const groups = new Map<string, Building>();
  const seen = new Map<string, Seen>();
  const repos: { p: ProjectLike; jobs: RepoJobs; rows: TaskRow[] }[] = [];
  const repoSeen = new Set<string>();
  for (const p of hub.projects) {
    const jobs = hub.jobsOf?.(p.root) ?? { repo: p.root, max: 0, jobs: [], reviews: [], analyses: [], resumes: [] };
    if (repoSeen.has(jobs.repo)) continue;
    repoSeen.add(jobs.repo);
    repos.push({ p, jobs, rows: hub.taskRows(p.root) });
  }

  const taskGroup = (p: ProjectLike, r: TaskRow): Building => {
    const key = `t:${p.root}:${r.id}`;
    let g = groups.get(key);
    if (!g) {
      const since = r.state === 'running' ? time(r.since) : null;
      g = { root: p.root, task: r.id, at: since ?? now, group: { key, id: r.id, title: r.title, look: taskLook(r), since: '', project: many ? p.name : null, ref: { project: p.root, task: r.id }, note: null, jobs: [], done: [] } };
      groups.set(key, g);
    }
    return g;
  };
  const envGroup = (p: ProjectLike, key: string, id: string, title: string, look: Look): Building => {
    let g = groups.get(key);
    if (!g) {
      g = { root: p.root, task: null, at: now, group: { key, id, title, look, since: '', project: many ? p.name : null, ref: null, note: null, jobs: [], done: [] } };
      groups.set(key, g);
    }
    return g;
  };
  const add = (b: Building, row: JobRow, at: number | null, extra: Partial<Seen> = {}) => {
    b.group.jobs.push(row);
    if (at && at < b.at) b.at = at;
    const { key, id, title, project, ref } = b.group;
    seen.set(`${key}|${row.key}`, { group: { key, id, title, project, ref, root: b.root, task: b.task }, kind: row.kind, label: row.label, ...extra });
  };
  const envName = (p: ProjectLike, branch: string) => p.config.environments.find((e) => e.branch === branch)?.name ?? branch;
  const runs = windowRuns(i.runs ?? []);
  const runFor = (p: ProjectLike, match: (r: WindowRun) => boolean) => runs.find((r) => match(r) && (!r.cwd || hub.projectFor(r.cwd)?.root === p.root || isUnder(r.cwd, p.root)));
  const used = new Set<string>();

  for (const { p, jobs, rows } of repos) {
    const byId = new Map(rows.map((r) => [r.id, r]));
    const ref = (id: string): Ref => ({ project: p.root, task: id });
    const pilot = i.autopilot?.(p.root) ?? null;
    // Autopilot's step on a task stands for the land, refresh or review it runs: one row, not two.
    const steps = jobs.jobs.filter((j) => j.kind === 'autopilot' && j.task);
    const inStep = (task: string, pid: number) => steps.some((s) => s.task === task && s.pid === pid);

    for (const r of rows) {
      if (r.state !== 'running') continue;
      // The builder (D-067): its session's state, its latest step, its model and its branch so far.
      const session = sessionFor(r, hub.agents);
      const step = r.run?.sessionId ? hub.stepOf?.(r.run.sessionId) ?? null : null;
      const question = r.asking ? hub.questions?.find((q) => q.sessionId && (q.sessionId === r.run?.sessionId || q.sessionId === session?.sessionId)) : undefined;
      const look = r.stopped ? LOOK('Stopped', 'debug-disconnect', 'orange')
        : r.asking ? LOOK('Waiting on you', 'bell', 'orange')
          : r.agent?.tone === 'orange' ? (r.agent.label === 'Failed' ? LOOK('Failed', 'warning', 'orange') : LOOK('Waiting on you', 'bell', 'orange'))
            : r.agent?.label === 'Working' || r.agent?.label === 'Resumed: working' ? LOOK('Working', 'sync~spin', 'blue')
              : r.agent?.label === 'Stopped' ? LOOK('Stopped', 'debug-stop', 'neutral')
                : r.agent ? LOOK('Idle', 'circle-outline', 'neutral') : LOOK('Starting', 'loading~spin', 'blue');
      const setting = p.agents?.builder.model;
      const model = step?.model ?? (setting ? `${setting} (its setting)` : null);
      const b = r.branchStats;
      const branch = b ? `${plural(b.commits, 'commit')}, ${plural(b.files, 'file')} changed${b.uncommitted ? `, ${b.uncommitted} not committed` : ''}` : null;
      const doing = r.stopped ? (r.stopped.said ? `its turn ended: ${clip(r.stopped.said.replace(/\s+/g, ' '), 90)}` : 'its turn ended before acc done or acc block')
        : !r.asking && r.agent?.tone === 'orange' && r.agent.label !== 'Failed' ? 'waiting in its own terminal'
          : step?.step ? clip(step.step.title, 90) : null;
      const live = session?.kind === 'background' && !!session.id && !!session.pid && !['done', 'stopped', 'failed'].includes(session.state ?? '');
      const actions: ProgressAction[] = [
        ...(question ? [{ label: 'Answer', icon: 'bell', tip: 'Go to its question in Needs you, above, and answer it there', question: question.id }] : []),
        { label: 'Watch', icon: 'pulse', tip: 'Follow what it does, step by step, on its page', command: 'acc.task.watch', ref: ref(r.id) },
        ...(r.run?.sessionId ? [{ label: 'Open in Claude Code', icon: 'comment-discussion', tip: 'Take its conversation over in a Claude Code tab: it stops in the background, and you carry on there', command: 'acc.task.openInClaude', ref: ref(r.id) }] : []),
        ...(live && !r.stopped ? [stop({ kind: 'builder', project: p.root, task: r.id }, 'Pause its builder with claude stop. The task stays Running, and Resume carries it on.')] : []),
      ];
      const meta = [model, branch].filter(Boolean).join(' · ');
      add(taskGroup(p, r), { key: 'builder', kind: 'builder', look, label: 'Builder', detail: doing ?? '', ...(meta ? { meta } : {}), since: ago(time(r.since)), actions }, time(r.since));
    }

    for (const a of jobs.analyses) {
      const r = byId.get(a.task);
      if (!r) continue;
      const run = runFor(p, (x) => x.kind === 'analysis' && x.task === a.task);
      if (run) used.add(run.id);
      add(taskGroup(p, r), {
        key: 'analysis', kind: 'analysis', look: LOOK('Analyzing', 'search', 'blue'), label: 'Analysis', detail: 'reading the ticket and the code, before the build', since: ago(time(a.startedAt)),
        actions: [
          ...(r.analyzing ? [{ label: 'Watch', icon: 'pulse', tip: 'Follow the analyst as it reads, on its page', command: 'acc.task.watchAnalysis', ref: ref(r.id) }] : []),
          ...(run ? [stop({ kind: 'run', run: run.id, label: run.label }, 'End the analysis this window started. It writes no analysis; run it again later.')] : []),
        ],
      }, time(a.startedAt));
    }

    for (const v of jobs.reviews) {
      const r = byId.get(v.task);
      if (!r || inStep(v.task, v.pid)) continue;
      const run = runFor(p, (x) => x.kind === 'review' && x.task === v.task);
      if (run) used.add(run.id);
      add(taskGroup(p, r), {
        key: 'review', kind: 'review', look: LOOK('Reviewing', 'eye', 'blue'), label: 'Review', detail: `reading ${v.sha.slice(0, 7)}`, since: ago(time(v.startedAt)),
        actions: [
          ...(r.reviewing ? [{ label: 'Watch', icon: 'pulse', tip: 'Follow the reviewer as it reads, on its page', command: 'acc.task.watchReview', ref: ref(r.id) }] : []),
          ...(run ? [stop({ kind: 'run', run: run.id, label: run.label }, 'End the review this window started. It gives no verdict; review again later.')] : []),
        ],
      }, time(v.startedAt));
    }

    for (const s of jobs.resumes) {
      const r = byId.get(s.task);
      if (!r) continue;
      add(taskGroup(p, r), {
        key: 'resume', kind: 'resume', look: LOOK('Resumed', 'debug-continue', 'blue'), label: 'Resume', detail: `its builder carries on in its own session, resumed by ${who(s.by)}`, since: ago(time(s.startedAt)),
        actions: [
          { label: 'Watch', icon: 'pulse', tip: 'Follow what it does, step by step, on its page', command: 'acc.task.watch', ref: ref(r.id) },
          stop({ kind: 'resume', project: p.root, task: r.id }, 'End the resumed conversation where it is. The task stays Running, with Resume.'),
        ],
      }, time(s.startedAt));
    }

    for (const j of jobs.jobs) {
      const at = time(j.startedAt);
      const by = who(j.by);
      if (j.kind === 'autopilot' && j.task && j.step) {
        const r = byId.get(j.task);
        if (!r) continue;
        const actions: ProgressAction[] = [
          ...(j.step === 'review' && r.reviewing ? [{ label: 'Watch', icon: 'pulse', tip: 'Follow the reviewer as it reads, on its page', command: 'acc.task.watchReview', ref: ref(r.id) }] : []),
          ...(pilot === 'on' ? [
            { label: 'Output', icon: 'output', tip: 'Show what autopilot prints, in the output panel', command: 'acc.autopilot.output', arg: p.root },
            stop({ kind: 'autopilot', project: p.root, task: r.id }, 'Turn autopilot off in this window: the step it\'s taking ends now, and the next pass starts it again.', 'Turn autopilot off', 'debug-pause'),
          ] : []),
        ];
        const where = pilot === 'on' ? 'autopilot, on in this window' : 'autopilot, on in another window or a terminal';
        add(taskGroup(p, r), { key: `autopilot:${j.key}`, kind: 'autopilot', look: LOOK(STEP_DOING[j.step], 'rocket', 'blue'), label: 'Autopilot', detail: where, since: ago(at), actions }, at, { step: j.step });
      } else if ((j.kind === 'land' || j.kind === 'refresh') && j.task) {
        const r = byId.get(j.task);
        if (!r || inStep(j.task, j.pid)) continue;
        const row: JobRow = j.kind === 'land'
          ? { key: `land:${j.key}`, kind: 'land', look: LOOK('Landing', 'git-pull-request', 'blue'), label: 'Land', detail: `pushing it and opening its pull request, for ${by}`, since: ago(at), actions: [] }
          : { key: `refresh:${j.key}`, kind: 'refresh', look: LOOK('Merging its base in', 'git-merge', 'blue'), label: 'Refresh', detail: `merging ${r.environment} into its branch, then its checks, for ${by}`, since: ago(at), actions: [] };
        add(taskGroup(p, r), row, at);
      } else if (j.kind === 'promote' && j.from && j.env) {
        const run = runFor(p, (x) => x.kind === 'promote' && x.from === j.from && x.env === j.env);
        if (run) used.add(run.id);
        const g = envGroup(p, `e:${p.root}:promote:${j.from}:${j.env}`, `Promote ${j.from} → ${j.env}`, `${envName(p, j.from)} to ${envName(p, j.env)}`, LOOK('Promoting', 'git-pull-request-create', 'blue'));
        if (j.carries?.length) g.group.note = `Tasks in ${envName(p, j.from)} not yet in ${envName(p, j.env)}: ${j.carries.slice(0, 6).join(', ')}${j.carries.length > 6 ? ` and ${j.carries.length - 6} more` : ''}`;
        add(g, { key: `promote:${j.key}`, kind: 'promote', look: LOOK('Promoting', 'git-pull-request-create', 'blue'), label: 'Promotion', detail: `a branch from ${j.env} with ${j.from}'s changes, then its pull request, for ${by}`, since: ago(at), actions: run ? [stop({ kind: 'run', run: run.id, label: run.label }, 'End the promotion this window started. A pull request it already opened stays open.')] : [] }, at);
      } else if (j.kind === 'deploy' && j.env) {
        const run = runFor(p, (x) => x.kind === 'deploy' && x.env === j.env);
        if (run) used.add(run.id);
        const g = envGroup(p, `e:${p.root}:deploy:${j.env}`, `Deploy ${j.env}`, envName(p, j.env), LOOK('Deploying', 'cloud-upload', 'blue'));
        add(g, { key: `deploy:${j.key}`, kind: 'deploy', look: LOOK('Deploying', 'cloud-upload', 'blue'), label: 'Deploy', detail: `${j.env} to its org, for ${by}`, since: ago(at), actions: run ? [stop({ kind: 'run', run: run.id, label: run.label }, `End the deploy this window started. What the org already took stays; sf may finish it anyway.`)] : [] }, at);
      }
    }

    // This window's commands whose marker isn't there yet, or never will be: a message to a builder (D-060).
    for (const run of runs) {
      if (used.has(run.id) || !runFor(p, (x) => x.id === run.id)) continue;
      const r = run.task ? byId.get(run.task) : undefined;
      if (run.kind === 'message' && r) {
        add(taskGroup(p, r), { key: `message:${run.id}`, kind: 'message', look: LOOK('Answering', 'comment', 'blue'), label: 'Your message', detail: 'its builder answers in its own session', since: ago(run.startedAt), actions: [stop({ kind: 'run', run: run.id, label: run.label }, 'End its answer where it is.')] }, run.startedAt);
        used.add(run.id);
      } else if ((run.kind === 'review' || run.kind === 'analysis') && r) {
        const row = run.kind === 'review' ? { look: LOOK('Starting', 'loading~spin', 'blue'), label: 'Review', detail: 'starting the reviewer' } : { look: LOOK('Starting', 'loading~spin', 'blue'), label: 'Analysis', detail: 'starting the analyst' };
        add(taskGroup(p, r), { key: run.kind, kind: run.kind, ...row, since: ago(run.startedAt), actions: [stop({ kind: 'run', run: run.id, label: run.label }, 'End the command this window started.')] }, run.startedAt);
        used.add(run.id);
      }
    }
  }

  // The machine's heavy-check slots (D-024, D-080): each holder or waiter on the task or environment it's for.
  const heavy: HeavyState | null = hub.heavy ?? null;
  const placed = (h: Partial<SlotHolder & SlotWaiter>): Building | null => {
    for (const { p, rows } of repos) {
      if (h.project && h.project !== p.name && repos.length > 1) continue;
      if (h.task) {
        const r = rows.find((x) => x.id === h.task);
        if (r && (!h.project || h.project === p.name)) return taskGroup(p, r);
      } else if (h.env && (!h.project || h.project === p.name)) {
        const promote = [...groups.values()].find((g) => g.root === p.root && g.group.key.startsWith(`e:${p.root}:promote:`) && g.group.key.endsWith(`:${h.env}`));
        if (h.what?.startsWith('Validate') && promote) return promote;
        if (h.what?.startsWith('Deploy')) return envGroup(p, `e:${p.root}:deploy:${h.env}`, `Deploy ${h.env}`, envName(p, h.env), LOOK('Deploying', 'cloud-upload', 'blue'));
        return envGroup(p, `e:${p.root}:other:${h.what ?? h.env}`, h.what ?? h.env, envName(p, h.env), LOOK('Running', 'server-process', 'blue'));
      } else if (h.cwd) {
        const r = rows.find((x) => x.run?.worktree && isUnder(h.cwd!, x.run.worktree));
        if (r) return taskGroup(p, r);
      }
    }
    return null;
  };
  const slotTip: string[] = [];
  for (const h of heavy?.held ?? []) {
    const g = placed(h);
    const at = h.at || null;
    slotTip.push(`Slot ${h.slot}: ${slotWhat(h)}${at ? `, ${elapsed(now - at)}` : ''}`);
    if (!g) continue;
    add(g, { key: `check:${h.pid}:${h.what ?? ''}`, kind: 'check', look: LOOK('Running', 'sync~spin', 'blue'), label: `Check: ${h.what ?? 'heavy check'}`, detail: `in heavy-check slot ${h.slot} of ${heavy!.slots}`, since: ago(at), actions: [] }, at);
  }
  for (const w of heavy?.waiting ?? []) {
    const g = placed(w);
    slotTip.push(`${ordinal(w.place)} in line: ${slotWhat(w)}, ${elapsed(now - w.at)}`);
    if (!g) continue;
    // Keyed as its row in a slot is: one that takes a slot moves up, it doesn't end.
    add(g, { key: `check:${w.pid}:${w.what ?? ''}`, kind: 'check', look: LOOK(`${ordinal(w.place)} in line`, 'watch', 'neutral'), label: `Check: ${w.what ?? 'heavy check'}`, detail: 'waiting for a heavy-check slot', since: ago(w.at), actions: [] }, w.at);
  }

  // What ended since the last look, kept a minute as a line in its group.
  const gone = i.finished?.update(seen, now) ?? [];
  for (const g of gone) {
    let b = groups.get(g.group.key);
    if (!b) {
      const p = hub.projects.find((x) => x.root === g.group.root);
      const r = p && g.group.task ? hub.taskRows(p.root).find((x) => x.id === g.group.task) : undefined;
      b = { root: g.group.root, task: g.group.task, at: g.endedAt, group: { key: g.group.key, id: g.group.id, title: r?.title ?? g.group.title, look: r ? taskLook(r) : displayLook('done'), since: '', project: g.group.project, ref: g.group.ref, note: null, jobs: [], done: [] } };
      groups.set(g.group.key, b);
    }
    const p = hub.projects.find((x) => x.root === g.group.root);
    const r = p && g.group.task ? hub.taskRows(p.root).find((x) => x.id === g.group.task) : undefined;
    b.group.done.push({ key: g.key, ...doneLine(g, r, hub), age: Math.max(0, Math.round((now - g.endedAt) / 1000)) });
  }

  const list = [...groups.values()];
  for (const b of list) b.group.since = b.group.jobs.length ? elapsed(now - b.at) : '';
  // Busiest first, then the longest running.
  list.sort((a, b) => b.group.jobs.length - a.group.jobs.length || a.at - b.at || a.group.key.localeCompare(b.group.key));

  const machine: MachineChip[] = [];
  if (heavy) {
    const used = heavy.held.length;
    const free = Math.max(0, heavy.slots - used);
    const waiting = heavy.waiting.length;
    machine.push({
      key: 'slots', look: LOOK(`Heavy checks: ${used} of ${heavy.slots} in use, ${free ? `${free} free` : 'none free'}${waiting ? `, ${waiting} waiting` : ''}`, 'server-process', used ? 'blue' : 'neutral'),
      tip: slotTip.length ? slotTip.join('\n') : `No heavy check is running. This machine runs ${plural(heavy.slots, 'heavy check')} at once (acc machine heavy-slots).`,
    });
  }
  let builders = 0;
  for (const { p, jobs, rows } of repos) {
    const running = rows.filter((r) => r.state === 'running').length;
    builders += running;
    if (!jobs.max) continue;
    machine.push({ key: `builders:${jobs.repo}`, look: LOOK(`Builders: ${running} of ${jobs.max}${repos.length > 1 ? ` in ${p.name}` : ''}`, 'hubot', running ? 'blue' : 'neutral'), tip: `${plural(running, 'task')} running, of the ${jobs.max} ${p.name} runs at once (agents.max).` });
  }
  const load = loadWord(hub.machine);
  if (load && hub.machine) machine.push({ key: 'load', look: { ...load, label: `Load: ${load.label.toLowerCase()}` }, tip: `Load over the last minute: ${hub.machine.load.toFixed(1)} on ${plural(hub.machine.cpus, 'core')}.` });

  const count = list.filter((b) => b.group.jobs.length).length;
  const idle = !list.length && !heavy?.held.length && !heavy?.waiting.length && !builders;
  return { count, machine: idle ? [] : machine, groups: list.map((b) => b.group), empty: idle ? 'Nothing is running.' : null };
}

// ---------------------------------------------------------------- reading what runs

export function readRepoJobs(p: Pick<Project, 'ledgerPath' | 'config'>, ledger: Ledger | undefined): RepoJobs {
  const stateDir = dirname(p.ledgerPath);
  const list = (dir: string, suffix: string): string[] => {
    try {
      return readdirSync(join(stateDir, dir)).filter((n) => n.endsWith(suffix)).map((n) => n.slice(0, -suffix.length));
    } catch {
      return [];
    }
  };
  const store = { stateDir, reviews: join(stateDir, 'reviews'), analyses: join(stateDir, 'analyses') } as RepoPaths;
  // What a promotion takes on, as far as the ledger says: tasks that reached its source and not its destination.
  const carries = (from: string, to: string) => (ledger?.tasks ?? []).filter((t) => arrivedAt(t, from) && !arrivedAt(t, to)).map((t) => t.id);
  let jobs: RepoJobs['jobs'] = [];
  try {
    jobs = jobsUnderWay({ stateDir }).map((j) => (j.kind === 'promote' && j.from && j.env ? { ...j, carries: carries(j.from, j.env) } : j));
  } catch {
    jobs = [];
  }
  return {
    repo: p.ledgerPath,
    max: p.config.agents.max,
    jobs,
    reviews: list('reviews', '.running.json').flatMap((task) => { const r = reviewing(store, task); return r ? [{ task, ...r }] : []; }),
    analyses: list('analyses', '.running.json').flatMap((task) => { const r = analyzing(store, task); return r ? [{ task, ...r }] : []; }),
    resumes: list('resumes', '.json').flatMap((task) => { const r = resuming(store, task); return r ? [{ task, sessionId: r.sessionId, startedAt: r.startedAt, by: r.by, pid: r.pid }] : []; }),
  };
}

/** Each running builder's latest step, from its transcript's tail, read again only when the file changed. */
export function readSteps(hub: Pick<Hub, 'projects' | 'taskRows'>, builderSteps: Map<string, { file: string; stamp: string; step: LastStep | null }>, stampOf: (file: string) => string | null): void {
  const live = new Set<string>();
  for (const p of hub.projects) {
    for (const t of hub.taskRows(p.root)) {
      const id = t.state === 'running' ? t.run?.sessionId : undefined;
      if (!id || live.has(id)) continue;
      live.add(id);
      let cached = builderSteps.get(id);
      const file = cached && existsSync(cached.file) ? cached.file : transcriptFile(claudeProjectsDir(process.env), id, [t.run?.worktree, p.root]);
      const stamp = file ? stampOf(file) : null;
      if (!file || !stamp) continue;
      if (cached?.file !== file || cached.stamp !== stamp) {
        cached = { file, stamp, step: lastStepIn(file) };
        builderSteps.set(id, cached);
      }
    }
  }
  for (const k of [...builderSteps.keys()]) if (!live.has(k)) builderSteps.delete(k);
}

export const area: ExtensionArea = {
  register({ vscode, reg, hub, runs, autopilot }) {
    // In progress's Stop (D-092): each kind of job stops its own way, after a person says so. A builder is
    // paused, not abandoned: its task stays Running and shows its agent stopped, with Resume (D-067).
    reg('acc.job.stop', async (raw?: unknown) => {
      let a: { kind?: unknown; project?: unknown; task?: unknown; run?: unknown } = {};
      try { a = JSON.parse(String(raw)) as typeof a; } catch { return; }
      const p = typeof a.project === 'string' ? hub.project(a.project) : undefined;
      const task = typeof a.task === 'string' ? a.task : '';
      const ask = async (title: string, detail: string, button: string) => (await vscode.window.showWarningMessage(title, { modal: true, detail }, button)) === button;
      if (a.kind === 'builder' && p && task) {
        const row = hub.taskRows(p.root).find((t) => t.id === task);
        const s = row ? sessionFor(row, hub.agents) : undefined;
        if (!s?.id || !s.pid) return void vscode.window.showInformationMessage(`${task}'s builder isn't running in the background any more, so there's nothing to stop.`);
        if (!(await ask(`Stop ${task}'s builder?`, 'It stops where it is, with claude stop. The task stays Running and shows that its agent stopped, with Resume to carry it on. Its worktree and commits are kept. To set the task aside instead, use Abandon.', 'Stop'))) return;
        const r = await runFile('claude', ['stop', s.id], s.cwd, process.env, undefined, 30_000);
        if (r.code !== 0) void vscode.window.showWarningMessage(`Couldn't stop ${task}'s builder: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
        await hub.loadAgents();
      } else if (a.kind === 'resume' && p && task) {
        if (!(await ask(`Stop ${task}'s resumed builder?`, 'The resumed conversation ends where it is. The task stays Running, with Resume to carry it on again.', 'Stop'))) return;
        endResume({ stateDir: dirname(p.ledgerPath) }, task);
        await Promise.all([hub.loadJobs(true), hub.loadAgents()]);
      } else if (a.kind === 'run' && typeof a.run === 'string') {
        const run = runs.views().find((r) => r.id === a.run && r.endedAt === null);
        if (!run) return;
        if (!(await ask(`Stop ${run.label}?`, 'It\'s this window\'s command, and it ends now. What it finished stays done; what it was in the middle of is left, and you can start it again.', 'Stop'))) return;
        runs.control(run.id, 'stop');
      } else if (a.kind === 'autopilot' && p) {
        if (autopilot.stateFor(p.root) !== 'on') return void vscode.window.showInformationMessage(`Autopilot for ${p.name} runs in another window or a terminal: turn it off there.`);
        if (!(await ask(`Turn autopilot off for ${p.name}?`, `The step it's taking${task ? ` on ${task}` : ''} ends now (D-064): a review's work is lost, and the next pass starts it again. Turn it on again from the status bar.`, 'Turn autopilot off'))) return;
        await autopilot.toggle(p.root);
      }
    });
  },
};
