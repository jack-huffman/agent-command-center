import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { autoMergeFor, type Autonomy, type Config } from './config.ts';
import { sendBack } from './checks.ts';
import { analysisProblems } from './analyze.ts';
import { dispatch } from './dispatch.ts';
import { holdWords, startHeld } from './held.ts';
import { AccError, type Runner } from './exec.ts';
import { releaseAwake } from './awake.ts';
import { withJob } from './jobs.ts';
import { AUTOPILOT_BY, type AutopilotFailure, type AutopilotStepName, checkMove, type ClaudeSession, mutate, noGateHooks, readLedger, reworkCause, type State, STOPPED_GRACE_MS } from './ledger.ts';
import { ghToken, land, type LandResult } from './land.ts';
import { type FileShare, startLook } from './overlap.ts';
import { withLock } from './lock.ts';
import type { RepoPaths } from './paths.ts';
import { holdHead, joinQueue, leaveQueue, ordinal, queueOrder, queueTurn } from './queue.ts';
import { askingUnder, pendingQuestions, type Question, questionsDir } from './questions.ts';
import { refresh } from './refresh.ts';
import { clipSaid, listSessions, resume, type ResumeDeps } from './resume.ts';
import { review } from './review.ts';
import type { SlotOptions } from './semaphore.ts';
import { type AutopilotOutcome, type Decision, type FactsGitHub, firstLines, inQueueAt, nextStep, running, sentence, taskFacts } from './autopilot-rules.ts';

/**
 * Autopilot (D-055): under `autonomy: review`, each pass reads the ledger and takes the next step for
 * each task, one at a time. It reviews work a builder finished, lands work whose review passed, and
 * re-dispatches a task the reviewer sent back, once. When an open pull request conflicts with its base,
 * it merges the base into the branch and runs its checks (D-058), so the next passes review and land the
 * merge. A builder that stopped before acc done or acc block is resumed, once a run (D-067). A pull
 * request whose checks failed on GitHub goes back to its builder with what they said, once a commit
 * (D-076). A task a person dispatched that waits for another task's files starts once it may (D-093). It
 * goes up to an open pull request: it waives no check, deploys nothing, promotes nothing, changes nothing
 * on GitHub but its pull request, and starts no task to do that nobody dispatched. It merges a pull
 * request only where the repo turns auto-merge on (GH-67), through the repo's merge queue (GH-73): a
 * reviewed pull request, green on GitHub, into an environment that isn't protected, with nothing waiting on
 * a person, joins it, and at its turn its base is merged in, the full check runs once, and it merges.
 */

// Who autopilot is, and what sent a task to rework, live with the ledger's moves, so dispatch can read them.
export { AUTOPILOT_BY, type ReworkCause, reworkCause, SEND_BACKS, sendBacks, sentBackByAutopilot } from './ledger.ts';

/** The shortest gap `acc autopilot --every` takes between passes. */
export const AUTOPILOT_MIN_EVERY_S = 30;

export interface AutopilotMode {
  autonomy: Autonomy;
  /** Whether autopilot acts at all. */
  on: boolean;
  warnings: string[];
  /** Why autopilot won't run at this level, or null. */
  refusal: string | null;
}

/**
 * What autopilot does under `autonomy: review`, after "autopilot" or "it". Every description of review
 * uses it, in acc and the extension, so a step added here is added there too.
 */
export const AUTOPILOT_REVIEW_DOES = 'reviews finished work, lands work whose review passed, re-dispatches a rework once, sends a pull request whose GitHub checks fail back to its builder once a commit, resumes a stopped builder once a run, merges the base into a pull request that conflicts with it, and starts a task a person dispatched once the files it waits for are free';

/**
 * What autopilot does under `autonomy: review`, after "autopilot" or "it", and whether it merges pull
 * requests: never, or, with auto-merge on (autoMergeOn), how (GH-67), in turn through a merge queue (GH-73).
 * Every description of review uses it.
 */
export function autopilotDoes(autoMerge: boolean): string {
  return autoMerge
    ? `${AUTOPILOT_REVIEW_DOES}. Auto-merge is on: a pull request whose review and checks passed, with nothing waiting on a person, joins the repo's merge queue, and they merge in turn. At its turn its base is merged in, the full check runs once, and it merges once GitHub says it can, or goes back to its builder. It never merges into a protected environment.`
    : `${AUTOPILOT_REVIEW_DOES}. It never merges a pull request.`;
}

/**
 * What `autonomy` means for autopilot. manual: nothing happens on its own. review: autopilot reviews,
 * lands, re-dispatches a rework once, sends back a pull request whose GitHub checks fail once a commit
 * (D-076), resumes a stopped builder once a run (D-067), merges the base into a pull request that
 * conflicts with it (D-058), and starts a held task once it may (D-093). dispatch: as review, and it also starts Ready tasks up to agents.max; that
 * part isn't built, so it refuses. full is read as dispatch.
 */
export function autopilotMode(config: Pick<Config, 'autonomy'>): AutopilotMode {
  const autonomy = config.autonomy;
  if (autonomy === 'manual') return { autonomy, on: false, warnings: [], refusal: null };
  if (autonomy === 'review') return { autonomy, on: true, warnings: [], refusal: null };
  const warnings = autonomy === 'full' ? ['autonomy "full" is read as "dispatch".'] : [];
  return {
    autonomy, on: false, warnings,
    refusal: `autonomy "dispatch" (autopilot also starting Ready tasks) is not built yet. Set "autonomy" to "review" in .acc/config.json: autopilot then ${AUTOPILOT_REVIEW_DOES}.`,
  };
}

// ---------------------------------------------------------------- a pass

export interface AutopilotStep {
  task: string;
  /** Its state when autopilot looked. */
  state: State;
  step: AutopilotStepName | null;
  sha: string | null;
  outcome: AutopilotOutcome;
  reason: string;
  /** A land's pull request, or the one a merge merged. */
  pr?: { number: number; url: string; opened: boolean };
  /** The update a land drafted for the ticket, which waits for a person to post it (D-066). */
  update?: { id: string; key: string };
}

export interface AutopilotResult {
  steps: AutopilotStep[];
  /** The updates its lands drafted for tickets. Autopilot posts nothing: a person reviews and posts each (D-066). */
  updates: { task: string; id: string; key: string }[];
}

/** What a step reports back to the pass. */
type StepRun = Pick<AutopilotStep, 'reason' | 'pr' | 'update'>;

/** The merge queue's turn reports what it did too: merged, or another of its parts, done or waiting (GH-73). */
type TurnRun = StepRun & { step?: 'queue' | 'merge'; outcome?: 'done' | 'waiting' };

/** The steps autopilot takes. Tests put their own in. */
export interface AutopilotSteps {
  review(id: string): StepRun;
  land(id: string): StepRun;
  dispatch(id: string): StepRun;
  refresh(id: string): StepRun;
  resume(id: string): StepRun;
  checks(id: string): StepRun;
  start(id: string): StepRun;
  /** The merge queue's head takes its turn (GH-73). */
  queue(id: string): TurnRun;
}

export interface AutopilotDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  /** The folder holding acc, and how a shell runs it, for a re-dispatched builder. */
  accBinDir: string;
  accCommand?: string;
  /** Told before each step, which can take a long time: a review up to 45 minutes. */
  onStep?: (task: string, step: AutopilotStepName, sha: string) => void;
  /** Asked before each task: true ends the pass there, as when the window hosting autopilot has gone (D-064). */
  stop?: () => boolean;
  steps?: Partial<AutopilotSteps>;
  /** The heavy-check slot a refresh's checks, and the merge queue's full check, take: machine-wide unless a test says otherwise. */
  slots?: SlotOptions;
  /** For tests: how a resume starts its claude, where it finds transcripts, and how it keeps the Mac awake. */
  resume?: Pick<ResumeDeps, 'launch' | 'projectsDir' | 'awake'>;
}

/** The real steps, each as the orchestrator. A review stays the reviewer's move, done for autopilot. */
export function realSteps(paths: RepoPaths, config: Config, deps: AutopilotDeps): AutopilotSteps {
  const { run, now, env } = deps;
  return {
    review: (id) => {
      // review → rework is the reviewer's move (RULES), so the reviewer makes it, for autopilot.
      const r = review(paths, config, id, { run, now, env }, { by: `reviewer:${id} for ${AUTOPILOT_BY}` });
      return { reason: r.verdict.verdict === 'pass' ? `Review passed: ${r.verdict.summary}` : `Review asked for changes, so it went to rework: ${r.verdict.summary}` };
    },
    land: (id) => landStep(land(paths, config, id, { run, now, env }, { actor: 'orchestrator', by: AUTOPILOT_BY })),
    dispatch: (id) => {
      // Its move says what it re-dispatched for, so History and notices needn't guess (D-076).
      const t = readLedger(paths.ledger).tasks.find((x) => x.id === id);
      const cause = (t && reworkCause(t)) ?? 'review';
      const r = dispatch(paths, config, id, { run, now, env, accBinDir: deps.accBinDir, accCommand: deps.accCommand }, { actor: 'orchestrator', by: AUTOPILOT_BY, cause });
      // A rework is never held: its branch already holds its change (D-093).
      if (r.held) throw new AccError('start-waits', `${holdWords({ shares: r.waitsFor, first: r.first })}.`);
      return { reason: `Re-dispatched${cause === 'checks' ? ' for its failing checks' : cause === 'queue' ? ' with what the merge queue found' : ''} in ${r.worktree}${r.bgId ? `, background session ${r.bgId}` : ''}.` };
    },
    // A conflict only: where auto-merge is on, the merge queue brings a pull request up to date at its turn (GH-73).
    refresh: (id) => ({ reason: refresh(paths, config, id, { run, now, env, slots: deps.slots }, { actor: 'orchestrator', by: AUTOPILOT_BY }).reason }),
    resume: (id) => {
      const r = resume(paths, config, id, { run, now, env, accBinDir: deps.accBinDir, accCommand: deps.accCommand, ...deps.resume }, { actor: 'orchestrator', by: AUTOPILOT_BY });
      return { reason: `Resumed its builder${r.said ? `, which last said: ${clipSaid(r.said, 200)}` : '.'}` };
    },
    checks: (id) => ({ reason: sendBack(paths, config, id, { run, now, env }, { actor: 'orchestrator', by: AUTOPILOT_BY }).reason }),
    start: (id) => {
      // A held task, started as the person's Dispatch would have been, once it may (D-093).
      const r = startHeld(paths, config, { run, now, env, accBinDir: deps.accBinDir, accCommand: deps.accCommand }, { actor: 'orchestrator', by: AUTOPILOT_BY, only: id });
      const s = r.started[0];
      if (s) return { reason: `${startedWords(s)}${s.bgId ? `, background session ${s.bgId}` : ''}.` };
      // Its failure is written on the task already, which then needs a person.
      if (r.failed[0]) throw new AccError('start-failed', r.failed[0].reason);
      throw new AccError('start-waits', r.waiting[0]?.reason ?? 'It waits.');
    },
    queue: (id) => queueTurn(paths, config, id, { run, now, env, slots: deps.slots }, { actor: 'orchestrator', by: AUTOPILOT_BY }),
  };
}

/** "Started it: GH-70's files are free", or that nothing else was ready, so it shares files with GH-70 (D-093). */
export function startedWords(s: { waitedFor?: string[]; shares?: FileShare[] }): string {
  if (s.shares?.length) return `Started it: nothing else was ready, so it shares files with ${s.shares.map((x) => x.task).join(', ')}`;
  return s.waitedFor?.length ? `Started it: ${s.waitedFor.join(', ')}'s files are free` : 'Started it';
}

function landStep(r: LandResult): StepRun {
  return {
    reason: `${r.opened ? 'Opened' : 'Updated'} pull request #${r.pr.number}.`,
    pr: { number: r.pr.number, url: r.pr.url, opened: r.opened },
    ...(r.update ? { update: r.update } : {}),
  };
}

/**
 * Why a step's error is only for now, or null when it's a real failure. Only these wait: the ledger was
 * busy, the agent cap filled up between the look and the dispatch, a stopped builder's agent came back,
 * a pull request's checks changed between the look and the send-back (D-076), or a pull request moved on,
 * or wasn't settled, between the look and the merge (GH-67). Anything else is recorded, a heavy-check slot
 * that stayed taken for hours among them (D-069).
 */
function temporary(e: unknown, paths: RepoPaths, config: Config, id: string): string | null {
  const code = (e as AccError).code;
  if (code === 'lock-timeout') return 'The ledger was busy. Autopilot tries again next pass.';
  // Its agent came back between the look and the resume, or its checks or pull request moved on: nothing to do after all.
  if (code === 'agent-active' || code === 'checks-moved' || code === 'merge-waits') return `${(e as Error).message} Autopilot looks again next pass.`;
  // A held task that still waits after all, or whose start was claimed elsewhere (D-093).
  if (code === 'start-waits') return `${sentence((e as Error).message)} Autopilot looks again next pass.`;
  if (code === 'move-refused') {
    const n = running(readLedger(paths.ledger), id);
    if (n >= config.agents.max) return `${n} tasks are running. The limit is ${config.agents.max}.`;
  }
  return null;
}

/**
 * Writes down a step that failed, on the task, as the orchestrator: the task then shows as needs you, and
 * leaves the merge queue (GH-73).
 */
function recordFailure(paths: RepoPaths, now: () => Date, id: string, failed: AutopilotFailure): void {
  mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === id);
    if (!t || t.state !== failed.state) return; // it moved meanwhile: the failure is about a state it left
    // What it sent back stays: the next failing checks on that commit wait for a person (D-076).
    t.autopilot = { ...t.autopilot, failed };
    if (t.autopilot.queued) t.autopilot.queued = null;
    t.updatedAt = failed.at;
    emit({ type: 'task.updated', task: id, actor: 'orchestrator', by: AUTOPILOT_BY, data: { autopilot: { failed } } });
  });
}

/** A task of the merge queue's this pass: its step, filled in once the queue's head has had its turn (GH-73). */
interface InQueue {
  entry: AutopilotStep;
  decision: Decision;
  head: string;
}

/**
 * One pass: for each task, in ledger order, the next step, taken one at a time. The ledger is read again
 * before each, so a task a person moved meanwhile is judged as it is now. A task reviewed in this pass
 * lands in the next. Where auto-merge is on, a pull request ready to merge joins its repo's merge queue,
 * and after every other task, the queue's head alone takes its turn (GH-73): at most one merge a pass, and
 * the next head starts from the base it left.
 */
export function autopilotPass(paths: RepoPaths, config: Config, deps: AutopilotDeps): AutopilotResult {
  const steps = { ...realSteps(paths, config, deps), ...deps.steps };
  const out: AutopilotResult = { steps: [], updates: [] };
  const first = readLedger(paths.ledger);
  // Claude Code's sessions are looked at only when a running task is judged (D-067), and again when the
  // last look is older than the stopped rule's grace: an earlier step in the pass can run for minutes,
  // and a builder dispatched meanwhile isn't in the old look, so it would seem stopped.
  let look: { sessions: ClaudeSession[] | null; at: number } | null = null;
  // GitHub is asked about a pull request's checks only for a task autopilot could send back, as the repo's
  // account, whose token is fetched once, the first time it's needed (D-076).
  const gh = config.github;
  let ghEnv: NodeJS.ProcessEnv | null = null;
  // Agents' questions waiting for a person, read once a pass, the first time a task could join the merge queue.
  let asked: Question[] | null = null;
  const github: FactsGitHub | undefined = gh ? {
    repo: gh.repo, env: () => (ghEnv ??= { ...deps.env, GH_TOKEN: ghToken(deps.run, gh.account) }),
    autoMerge: (branch) => autoMergeFor(config, branch),
    asking: (wt) => askingUnder((asked ??= pendingQuestions(questionsDir(deps.env))), wt),
  } : undefined;
  const who = { actor: 'orchestrator' as const, by: AUTOPILOT_BY };
  const queued = new Map<string, InQueue>();
  let fetched = false;
  /** Takes a step and fills in its entry: done, waiting for now, or failed and written down on the task. */
  const take = (entry: AutopilotStep, fn: () => TurnRun): void => {
    const id = entry.task;
    try {
      const r = fn();
      Object.assign(entry, { step: r.step ?? entry.step, outcome: r.outcome ?? 'done', reason: r.reason, ...(r.pr ? { pr: r.pr } : {}), ...(r.update ? { update: r.update } : {}) });
      if (r.update) out.updates.push({ task: id, ...r.update });
    } catch (e) {
      // A held task's start that failed is written on the task already, which needs a person (D-093).
      if ((e as AccError).code === 'start-failed') {
        Object.assign(entry, { outcome: 'failed', reason: firstLines((e as Error).message) });
        return;
      }
      const wait = temporary(e, paths, config, id);
      if (wait) {
        Object.assign(entry, { outcome: 'waiting', reason: wait });
        return;
      }
      // A failure in the merge queue's merge is the merge's, as GH-67 recorded it.
      const step = (e as { step?: AutopilotStepName }).step ?? entry.step!;
      const reason = firstLines((e as Error).message ?? String(e));
      let unrecorded = '';
      try {
        recordFailure(paths, deps.now, id, { step, sha: entry.sha ?? '', state: entry.state, reason, at: deps.now().toISOString() });
      } catch (err) {
        // Not kept, so the next pass tries again; the pass itself carries on.
        unrecorded = ` (Not recorded on the task: ${(err as Error).message})`;
      }
      Object.assign(entry, { step, outcome: 'failed', reason: reason + unrecorded });
    }
  };
  for (const id of first.tasks.map((t) => t.id)) {
    if (deps.stop?.()) break;
    const ledger = readLedger(paths.ledger);
    const task = ledger.tasks.find((t) => t.id === id);
    if (!task || task.state === 'done') continue;
    if (task.state === 'running' && (!look || deps.now().getTime() - look.at > STOPPED_GRACE_MS)) look = { sessions: listSessions(deps.run, paths.root), at: deps.now().getTime() };
    const facts = taskFacts(paths, task, deps.run, look?.sessions ?? null, deps.now(), github);
    // A held task is weighed against what's in flight now (D-093), after any start earlier in the pass.
    // Autopilot doesn't sync (D-055), so origin is fetched once a pass, for a pull request merged meanwhile.
    if (task.state === 'todo' && task.held && !task.held.failed) {
      try {
        const problems = [...checkMove(ledger, config, task, { to: 'running', actor: 'orchestrator', by: AUTOPILOT_BY }, noGateHooks), ...analysisProblems(paths, config, task)];
        facts.start = { ...startLook(paths, config, ledger, deps.run, id, { fetch: !fetched }), problems };
        fetched = true;
      } catch {
        // git couldn't say: it waits for the next pass
      }
    }
    // A stopped builder's process can linger, idle: it no longer keeps the Mac awake.
    if (facts.stopped) releaseAwake(paths, id);
    const d = nextStep(ledger, config, task, facts);
    const sha = facts.head || null;
    // The merge queue (GH-73): ready, it joins at the back, or keeps its place; waiting on what settles by
    // itself, it keeps its place. Anything else, and it leaves: ready again, it joins at the back.
    const placed = inQueueAt(task, facts.head);
    if (d.queue === 'in' || (d.queue === 'hold' && placed)) {
      let unrecorded = '';
      try {
        if (!placed) joinQueue(paths, deps.now, id, facts.head, who);
      } catch (err) {
        unrecorded = ` (Not in the merge queue yet: ${(err as Error).message})`;
      }
      const entry: AutopilotStep = { task: id, state: task.state, step: null, sha, outcome: 'waiting', reason: d.reason + unrecorded };
      out.steps.push(entry);
      if (!unrecorded) queued.set(id, { entry, decision: d, head: facts.head });
      continue;
    }
    if (task.autopilot?.queued && !d.record) {
      try {
        leaveQueue(paths, deps.now, id, who);
      } catch {
        // it leaves next pass
      }
    }
    // A step it won't take is written down as one that failed, so the task needs you (D-076).
    if (d.record) {
      let unrecorded = '';
      try {
        recordFailure(paths, deps.now, id, { step: d.record.step, sha: facts.head, state: task.state, reason: d.record.reason, at: deps.now().toISOString() });
      } catch (err) {
        unrecorded = ` (Not recorded on the task: ${(err as Error).message})`;
      }
      out.steps.push({ task: id, state: task.state, step: d.record.step, sha, outcome: 'failed', reason: d.record.reason + unrecorded });
      continue;
    }
    if (!d.step) {
      out.steps.push({ task: id, state: task.state, step: null, sha, outcome: d.outcome ?? 'skipped', reason: d.reason });
      continue;
    }
    const act = d.step;
    // Merging is the merge queue's, at a task's turn (GH-73): never a step of its own.
    if (act === 'merge' || act === 'queue') {
      out.steps.push({ task: id, state: task.state, step: null, sha, outcome: 'waiting', reason: d.reason || 'The merge queue merges it, at its turn.' });
      continue;
    }
    deps.onStep?.(id, act, facts.head);
    const entry: AutopilotStep = { task: id, state: task.state, step: act, sha, outcome: 'done', reason: '' };
    out.steps.push(entry);
    // Marked under way while it runs, so every window shows the step, wherever autopilot runs (D-092).
    take(entry, () => withJob(paths, { kind: 'autopilot', task: id, step: act, by: AUTOPILOT_BY }, () => steps[act](id), deps.now));
  }
  if (queued.size && !deps.stop?.()) queueTurns(paths, config, deps, steps, queued, take);
  return out;
}

/**
 * The merge queue's turn, after every other task's (GH-73): its head, if it's ready, takes one; the rest
 * wait behind the task ahead of each, and make no call for the queue.
 */
function queueTurns(paths: RepoPaths, config: Config, deps: AutopilotDeps, steps: AutopilotSteps, queued: Map<string, InQueue>, take: (entry: AutopilotStep, fn: () => TurnRun) => void): void {
  const order = queueOrder(readLedger(paths.ledger), config);
  order.forEach((t, i) => {
    const q = queued.get(t.id);
    if (!q) return;
    if (i > 0) {
      q.entry.reason = `In the merge queue, ${ordinal(i + 1)}: behind ${order[i - 1]!.id}.`;
      return;
    }
    if (q.decision.queue !== 'in') {
      q.entry.reason = `First in the merge queue. ${q.decision.reason}`;
      // The Command Center says what it waits on: GitHub's checks, or this wait in its own words.
      try {
        holdHead(paths, deps.now, t.id, { checks: !!q.decision.checks, why: q.decision.reason }, { actor: 'orchestrator', by: AUTOPILOT_BY });
      } catch {
        // said next pass
      }
      return;
    }
    deps.onStep?.(t.id, 'queue', q.head);
    Object.assign(q.entry, { step: 'queue', outcome: 'done' });
    // Marked under way as autopilot's step, which stands for the land or merge it runs (D-092).
    take(q.entry, () => withJob(paths, { kind: 'autopilot', task: t.id, step: 'queue', by: AUTOPILOT_BY }, () => steps.queue(t.id), deps.now));
  });
}

// ---------------------------------------------------------------- one at a time

/**
 * Runs `fn` holding the repo's autopilot lock, so two autopilots never act on the same tasks. It never
 * goes stale with age, since one pass can take an hour; only a dead owner frees it. A second autopilot is
 * refused at once, naming the one that holds it. Separate from the heavy-check slot, which only a
 * refresh's checks and the merge queue's full check take, as a builder's do (D-058, GH-73).
 */
export function holdAutopilot<T>(paths: RepoPaths, fn: () => T): T {
  // A repo where no task was ever added has no state folder yet, and the lock lives in it.
  mkdirSync(paths.stateDir, { recursive: true });
  let held = false;
  try {
    return withLock(paths.autopilotLock, () => {
      held = true;
      return fn();
    }, { staleMs: Infinity, timeoutMs: 0 });
  } catch (e) {
    // The ledger's own lock timing out inside a pass isn't another autopilot.
    if (held || (e as AccError).code !== 'lock-timeout') throw e;
    let pid: number | null = null;
    try {
      pid = (JSON.parse(readFileSync(join(paths.autopilotLock, 'owner'), 'utf8')) as { pid: number }).pid;
    } catch {
      pid = null;
    }
    throw new AccError('autopilot-running', `Autopilot is already running here (pid ${pid ?? 'unknown'}). Stop that one first.${pid ? '' : ` If none is running, delete ${paths.autopilotLock}.`}`);
  }
}
