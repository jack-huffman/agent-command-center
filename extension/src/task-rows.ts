import type { Hub, Project } from './hub.ts';
import { autopilotFailure, builderStopped, displayState, type FileShare, isReady, type Ledger, runStartedAt, type SessionInfo, type Task } from '../../packages/core/src/ledger.ts';
import type { RowFiles, TaskRow } from './logic/shared.ts';
import { dirname, join } from 'node:path';
import type { RepoPaths } from '../../packages/core/src/paths.ts';
import { existsSync, readdirSync } from 'node:fs';
import { type Analysis, analysisRequired, analyzing } from '../../packages/core/src/analyze.ts';
import { queuePlaces } from '../../packages/core/src/queue.ts';
import { latestVerdict, reviewCurrent, reviewing } from '../../packages/core/src/review.ts';
import { resuming } from '../../packages/core/src/resume.ts';
import { agentLook, rowSession } from './logic/agents.ts';
import { effortShown } from './logic/efforts.ts';
import { byAutopilot } from '../../packages/core/src/autopilot-log.ts';
import { failedChecks } from '../../packages/core/src/autopilot-rules.ts';
import { envOpen, IN_FLIGHT_STATES, inFlight, nulPaths, plannedFiles, sharedFiles, type StartCandidate, startOrder } from '../../packages/core/src/overlap.ts';
import { runFile } from './run.ts';
import { analysisWait, rowAnalysis } from './logic/tasks.ts';
import { cloudWait } from '../../packages/core/src/cloud.ts';
import { cloudReviewWait } from '../../packages/core/src/cloud-review.ts';
import { sessionName } from '../../packages/core/src/names.ts';
import { rowInWords } from './logic/relayed.ts';
import { UNSEEN_WORDS } from '../../packages/core/src/started.ts';
import { unseenFrom } from '../../packages/core/src/unseen.ts';
// The Tasks area's rows as the hub reads them (D-099): each task's agent, analysis, review, pull request, place
// in the merge queue, and files beside other tasks'.

/** Where a project's analyses are kept: beside the ledger, as acc keeps them (D-052). */
export const analysesOf = (p: Pick<Project, 'ledgerPath'>): RepoPaths => ({ analyses: join(dirname(p.ledgerPath), 'analyses') }) as RepoPaths;

/**
 * Task rows with each running task's agent state, so a waiting agent shows as Needs you, and each task's
 * analysis, so one with questions for a person does too (D-052). A running task whose builder stopped
 * before acc done or acc block needs you too, with the last thing it said (D-067): judged only once
 * `claude agents` has answered, and not while it fails. While it fails past the grace, a running local task
 * needs you because acc can't see its builder (T-92); so does one whose builder didn't start.
 */
export function deriveRows(hub: Hub, ledger: Ledger, p?: Project): TaskRow[] {
  // Reviews sit beside the ledger (D-032). A branch's latest commit is its worktree's HEAD.
  const reviews = p ? ({ reviews: join(dirname(p.ledgerPath), 'reviews') } as RepoPaths) : null;
  // So do analyses: one listing a reload, and a task with none costs nothing more.
  const store = p ? analysesOf(p) : null;
  let files = new Set<string>();
  try {
    if (store) files = new Set(readdirSync(store.analyses));
  } catch {
    // none yet
  }
  const required = p ? analysisRequired(p.config) : false;
  const sessions = hub.agentsAt && !hub.agentsError ? hub.agents : null;
  const stateDir = p ? dirname(p.ledgerPath) : null;
  const now = new Date();
  // The repo's merge queue, where auto-merge is on (GH-73): each task's place, and what it waits on.
  const places = p ? queuePlaces(ledger, p.config) : [];
  const analyses = new Map(ledger.tasks.map((t) => [t.id, store && t.state !== 'done' && files.has(`${t.id}.json`) ? hub.analysisFrom(store, t.id) : null]));
  const filesOf = rowFiles(hub, ledger, p, analyses, required);
  return ledger.tasks.map((t) => {
    const a = analyses.get(t.id) ?? null;
    const running = store && t.state !== 'done' && files.has(`${t.id}.running.json`) ? analyzing(store, t.id) : null;
    const analysis = a ? rowAnalysis(a) : null;
    const waits = analysisWait({ state: t.state, analysis, analyzing: running, analysisRequired: required });
    const verdict = reviews && (t.state === 'review' || t.state === 'rework') ? latestVerdict(reviews, t.id) : null;
    const head = p?.worktrees.find((w) => w.branch === t.run?.branch)?.head;
    const tree = t.state === 'running' && t.run?.worktree ? p?.worktrees.find((w) => w.path === t.run!.worktree) : undefined;
    const live = reviews && t.state === 'review' ? reviewing(reviews, t.id) : null;
    const session = rowSession(t, hub.agents);
    const asking = session ? hub.askingFor(session) : null;
    const resumed = stateDir && t.state === 'running' ? resuming({ stateDir }, t.id) : null;
    const stopped = builderStopped(t, sessions, { resuming: !!resumed, now });
    // Its conversation is read only while acc can't see it, to tell a quiet builder from one Claude Code hides.
    const silent = t.state === 'running' && t.run?.where !== 'cloud' ? hub.agentsSilentSince : null;
    const missing = hub.claudeMissing && t.state === 'running' && t.run?.where !== 'cloud' && !resumed ? 'missing' as const : null;
    const unseen = missing ?? unseenFrom(t, p?.config, { silentSince: silent, now, resuming: !!resumed });
    // A resume just started isn't listed yet, and its old background session may still say blocked.
    const carrying = !!resumed && !session?.pid;
    const look = carrying ? { label: 'Resumed: working', icon: 'sync~spin', tone: 'blue' as const } : session ? agentLook(session, asking, hub.tieFor(session)) : null;
    const info: SessionInfo | undefined = unseen ? { unseen: true } : stopped ? { stopped: true } : carrying ? { status: 'busy' } : session ? (asking ? { state: 'blocked', status: 'waiting' } : { state: session.state, status: session.status }) : undefined;
    const said = stopped && t.run?.sessionId ? hub.lastSaid(t.run.sessionId, [t.run.worktree, session?.cwd, p?.root]) : null;
    // The model its agent runs with (D-086): what it last answered with, else what acc started it with.
    const model = look && t.run ? (t.run.sessionId ? hub.lastModel(t.run.sessionId, [t.run.worktree, session?.cwd, p?.root]) : null) ?? t.run.model ?? null : null;
    const failed = autopilotFailure(t);
    const queued = places.find((x) => x.id === t.id);
    // A cloud builder (GH-69): no local session to read; its branch on GitHub says whether it's quiet.
    const cloud = t.run?.where === 'cloud' && t.run.cloud ? { url: t.run.cloud.url, wait: p ? cloudWait(t, p.config, now) : null, finished: !!t.run.cloud.finished } : null;
    const cloudInfo: SessionInfo | undefined = cloud ? { quiet: !!cloud.wait } : undefined;
    // A review in the cloud (T-86): no local reviewer to watch; it needs you when it's quiet or its verdict couldn't be read.
    const cr = t.state === 'review' && t.cloudReview ? t.cloudReview : null;
    const cloudReview = cr ? { url: cr.url, firedAt: cr.firedAt, wait: p ? cloudReviewWait(t, p.config, now) : null, failed: !!cr.failed } : null;
    // What acc and its agents wrote in it reaches a person in process words (GH-163).
    return rowInWords({
      id: t.id,
      title: t.title,
      state: t.state,
      // A question waiting in the Command Center makes the agent wait on you, though it reads as busy.
      // So does an analysis with questions for a person, or one that says it's too big for one task.
      display: waits || cloudReview?.wait ? 'needs-you' : displayState(ledger, t, cloudInfo ?? info, p?.config) as TaskRow['display'],
      environment: t.environment,
      deps: t.deps.filter((d) => ledger.tasks.find((x) => x.id === d)?.state !== 'done'),
      source: { kind: t.source.kind, url: t.source.url },
      run: t.run,
      cloud,
      // A cloud builder's state is its branch's (GH-69): working while it pushes, needs you when it's quiet.
      agent: unseen ? { label: UNSEEN_WORDS[unseen].label, icon: 'eye-closed', tone: 'orange' } : cloud ? (cloud.finished ? { label: 'Finished: collecting', icon: 'cloud-download', tone: 'blue' } : cloud.wait ? { label: `Needs you: ${cloud.wait}`, icon: 'bell', tone: 'orange' } : { label: 'Working in the cloud', icon: 'cloud', tone: 'blue' }) : look ? { label: look.label, icon: look.icon, tone: look.tone } : null,
      model,
      effort: model ? effortShown(model, t.run?.effort) : null,
      asking: !!asking,
      question: asking && session?.sessionId ? hub.questions.find((q) => q.sessionId === session.sessionId)?.id ?? null : null,
      // Current on its latest commit, or carried there by the merge queue's merge commit (GH-73).
      review: verdict ? { verdict: verdict.verdict, summary: verdict.summary, current: !!head && !!reviews && reviewCurrent(reviews, t, verdict, head), at: verdict.at } : null,
      // Each agent under way with the name acc gave it (D-087); the builder's is on its run.
      reviewing: live ? { sessionId: live.sessionId, name: live.name } : cr && !cr.failed ? { sessionId: cr.sessionId, name: sessionName({ project: p?.name ?? '', key: t.id, title: t.title, role: 'review' }), where: 'cloud', url: cr.url } : null,
      cloudReview,
      pr: t.pr ? { number: t.pr.number, url: t.pr.url, state: t.pr.state, ci: t.pr.ci ?? null, changesRequested: t.pr.changesRequested ?? false, conflicts: t.pr.conflicts ?? [] } : null,
      promoting: (t.promotions ?? []).some((x) => x.state === 'open'),
      closing: t.pr?.issue?.state === 'pending',
      analysis,
      analyzing: running ? { sessionId: running.sessionId, name: running.name } : null,
      analysisRequired: required,
      autopilot: failed ? { step: failed.step, reason: failed.reason } : null,
      checks: failedChecks(t),
      stopped: stopped ? { said } : null,
      unseen,
      notStarted: t.notStarted && (t.state === 'todo' || t.state === 'rework') ? { reason: t.notStarted.reason, at: t.notStarted.at } : null,
      resuming: !!resumed,
      queue: queued ? { place: queued.place, of: queued.of, ahead: queued.ahead, phase: queued.phase, why: queued.why } : null,
      dispatchedBy: t.history.findLast((h) => h.from === 'todo' && h.to === 'running')?.by ?? null,
      since: t.state === 'running' ? runStartedAt(t) : null,
      branchStats: tree?.branchStats ? { ...tree.branchStats, uncommitted: Math.max(0, tree.changed) } : null,
      files: filesOf(t),
    });
  });
}

/**
 * Each task's files beside other tasks' (D-093), as acc weighs them at dispatch: a task to do's planned
 * files against each in-flight task's, planned and changed on its branch (as the worktree poll last
 * read them), without the files every task shares. acc's own answer at dispatch is final.
 */
export function rowFiles(hub: Pick<Hub, 'changed' | 'limits'>, ledger: Ledger, p: Project | undefined, analyses: Map<string, Analysis | null>, required: boolean): (t: Task) => RowFiles | null {
  if (!p) return () => null;
  const plan = (id: string) => plannedFiles(analyses.get(id) ?? null, p.root);
  const changed = hub.changed.get(p.root);
  const flying: FileShare[] = inFlight(ledger).filter((t) => t.pr?.state !== 'merged')
    .map((t) => ({ task: t.id, files: [...new Set([...(plan(t.id) ?? []), ...(changed?.get(t.id) ?? [])])].sort() }));
  const live = new Set(flying.map((f) => f.task));
  const shared = sharedFiles(p.config);
  // What could start now, as acc's analysisProblems and checkMove see it.
  const candidates: StartCandidate[] = ledger.tasks.filter((t) => t.state === 'todo').map((t) => {
    const a = analyses.get(t.id) ?? null;
    const analyzed = !required || (!!a && a.verdict !== 'split' && a.questions.every((q) => !!q.answer));
    return { id: t.id, files: plan(t.id), startable: isReady(ledger, t) && envOpen(p.config, t) && !t.held?.failed && analyzed };
  });
  // A cap a held task waits for: the project's, else this machine's total across every repo (GH-111), read
  // only while a task is held, since it counts every repo's ledger.
  const projectFull = ledger.tasks.filter((t) => t.state === 'running').length >= p.config.agents.max;
  const machine = !projectFull && ledger.tasks.some((t) => t.state === 'todo' && t.held) ? hub.limits()?.machine : null;
  const capped = projectFull ? 'project' as const : machine && machine.total !== null && machine.running >= machine.total ? 'machine' as const : null;
  return (t) => {
    if (t.state === 'todo') {
      const own = plan(t.id);
      const look = startOrder({ id: t.id, files: own }, candidates, flying, shared);
      const h = t.held;
      const held = h ? { at: h.at, failed: h.failed?.reason ?? null, byAutopilot: !!h.failed && byAutopilot(h.failed.by) } : null;
      return { known: !!own, analyzed: !!analyses.get(t.id), shares: look.shares, first: look.first, held, ...(h && capped ? { capped } : {}) };
    }
    // Started beside others, while they're still in flight.
    const shares = IN_FLIGHT_STATES.includes(t.state) ? (t.run?.shares ?? []).filter((s) => live.has(s.task)) : [];
    return shares.length ? { known: true, shares, first: [], held: null } : null;
  };
}

/**
 * What each in-flight task's branch has changed since it left its environment's branch (D-093): its
 * commits, and in its worktree what isn't committed yet, untracked files too. Read only while a task to
 * do is Ready or held, when it can matter, one git call at a time, so a machine that stutters isn't
 * asked for much at once.
 */
export async function loadChanged(hub: Pick<Hub, 'ledger' | 'changed'>, p: Project): Promise<void> {
  const ledger = hub.ledger(p.root);
  if (!ledger?.tasks.some((t) => t.state === 'todo' && (!!t.held || isReady(ledger, t)))) {
    hub.changed.delete(p.root);
    return;
  }
  const out = new Map<string, string[]>();
  for (const t of inFlight(ledger)) {
    if (t.pr?.state === 'merged') continue;
    const branch = `refs/heads/${t.run!.branch}`;
    let base = '';
    for (const ref of [`refs/remotes/origin/${t.environment}`, `refs/heads/${t.environment}`]) {
      const mb = await runFile('git', ['merge-base', branch, ref], p.root);
      if (mb.code === 0 && mb.stdout.trim()) { base = mb.stdout.trim(); break; }
    }
    if (!base) continue;
    const files = new Set<string>();
    const add = (r: { code: number; stdout: string }) => { if (r.code === 0) for (const f of nulPaths(r.stdout)) files.add(f); };
    add(await runFile('git', ['diff', '--name-only', '--no-renames', '-z', base, branch], p.root));
    const wt = t.run!.worktree;
    if (wt && existsSync(wt)) {
      add(await runFile('git', ['diff', '--name-only', '--no-renames', '-z', base], wt));
      add(await runFile('git', ['ls-files', '--others', '--exclude-standard', '-z'], wt));
    }
    out.set(t.id, [...files].sort());
  }
  hub.changed.set(p.root, out);
}
