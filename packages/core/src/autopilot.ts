import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Autonomy, Config } from './config.ts';
import { dispatch } from './dispatch.ts';
import { AccError, type Runner } from './exec.ts';
import { type AutopilotFailure, type AutopilotStepName, type Ledger, mutate, readLedger, type State, type Task } from './ledger.ts';
import { land, type LandResult, type PendingComment } from './land.ts';
import { withLock } from './lock.ts';
import type { RepoPaths } from './paths.ts';
import { readVerdict, review, reviewing } from './review.ts';

/**
 * Autopilot (D-???): under `autonomy: review`, each pass reads the ledger and takes the next step for
 * each task, one at a time. It reviews work a builder finished, lands work whose review passed, and
 * re-dispatches a task the reviewer sent back, once. It goes up to an open pull request: it never merges,
 * waives a check, deploys, promotes, or starts a task that's to do.
 */

/** Who autopilot is, in the ledger's history and events. */
export const AUTOPILOT_BY = 'orchestrator:autopilot';

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
 * What `autonomy` means for autopilot. manual: nothing happens on its own. review: autopilot reviews,
 * lands, and re-dispatches a rework once. dispatch: as review, and it also starts Ready tasks up to
 * agents.max; that part isn't built, so it refuses. full is read as dispatch.
 */
export function autopilotMode(config: Pick<Config, 'autonomy'>): AutopilotMode {
  const autonomy = config.autonomy;
  if (autonomy === 'manual') return { autonomy, on: false, warnings: [], refusal: null };
  if (autonomy === 'review') return { autonomy, on: true, warnings: [], refusal: null };
  const warnings = autonomy === 'full' ? ['autonomy "full" is read as "dispatch".'] : [];
  return {
    autonomy, on: false, warnings,
    refusal: 'autonomy "dispatch" (autopilot also starting Ready tasks) is not built yet. Set "autonomy" to "review" in .acc/config.json: autopilot then reviews, lands and re-dispatches a rework once.',
  };
}

// ---------------------------------------------------------------- the rules

/** What autopilot knows about a task before it decides, read from git and the state folder. */
export interface TaskFacts {
  /** The branch's latest commit, or '' when the branch isn't in this clone. */
  head: string;
  /** The review's verdict on that commit, if there is one. */
  verdict: 'pass' | 'changes' | null;
  /** A review under way for the task, by its session. */
  reviewing: string | null;
  /** The commit its open pull request was last landed at, if acc knows it. */
  landed: string | null;
}

export type AutopilotOutcome = 'done' | 'failed' | 'waiting' | 'skipped';

export interface Decision {
  step: AutopilotStepName | null;
  /** Why nothing is done, when step is null: it waits on something, or there's nothing to do. */
  outcome: 'waiting' | 'skipped' | null;
  reason: string;
}

const short = (sha: string): string => sha.slice(0, 7) || 'no commit';
const sentence = (text: string): string => text.replace(/([^.!?])$/, '$1.');

/** Autopilot already re-dispatched it from rework once: every later rework is a person's. */
export const reworkedByAutopilot = (task: Task): boolean =>
  task.history.some((h) => h.from === 'rework' && h.to === 'running' && h.actor === 'orchestrator');

const running = (ledger: Ledger, except: string): number => ledger.tasks.filter((t) => t.state === 'running' && t.id !== except).length;

/** The next step for one task, from the ledger and what's known about its branch. Pure, so each rule can be tested on its own. */
export function nextStep(ledger: Ledger, config: Pick<Config, 'agents'>, task: Task, facts: TaskFacts): Decision {
  const step = (s: AutopilotStepName, reason: string): Decision => {
    // A step that failed isn't tried again on the same commit: a person does it, or a new commit comes.
    const f = task.autopilot?.failed;
    if (f && f.step === s && f.sha === facts.head && f.state === task.state) {
      return { step: null, outcome: 'waiting', reason: `Autopilot couldn't ${s} ${short(f.sha)}: ${sentence(f.reason)} It waits for a person, or a new commit.` };
    }
    return { step: s, outcome: null, reason };
  };
  const none = (outcome: 'waiting' | 'skipped', reason: string): Decision => ({ step: null, outcome, reason });

  if (task.state === 'review') {
    if (facts.reviewing) return none('waiting', `A review is running (session ${facts.reviewing}).`);
    if (!facts.verdict) return step('review', `Nothing has reviewed ${short(facts.head)} yet.`);
    if (facts.verdict === 'changes') return none('waiting', `Its review on ${short(facts.head)} asked for changes, and it's still in review: a person decides.`);
    const pr = task.pr;
    if (pr?.state === 'merged') return none('skipped', `Pull request #${pr.number} merged.`);
    if (pr?.state !== 'open') return step('land', `Its review passed on ${short(facts.head)}, and it has no open pull request.`);
    if (facts.landed === facts.head) return none('skipped', `Pull request #${pr.number} is up to date with ${short(facts.head)}.`);
    return step('land', `Its review passed on ${short(facts.head)}, and pull request #${pr.number} is behind it.`);
  }
  if (task.state === 'rework') {
    if (reworkedByAutopilot(task)) return none('waiting', 'Autopilot re-dispatched it once already. A second rework waits for a person.');
    const n = running(ledger, task.id);
    if (n >= config.agents.max) return none('waiting', `${n} tasks are running. The limit is ${config.agents.max}.`);
    return step('dispatch', 'The reviewer asked for changes.');
  }
  if (task.state === 'todo') return none('skipped', 'To do: autopilot never starts a task that\'s to do.');
  if (task.state === 'running') return none('skipped', 'Its builder is working.');
  if (task.state === 'blocked') return none('skipped', 'Blocked: a person decides.');
  return none('skipped', 'Done.');
}

/** What autopilot needs to know about a task in review or rework. Other states need nothing. */
export function taskFacts(paths: RepoPaths, task: Task, run: Runner): TaskFacts {
  const facts: TaskFacts = { head: '', verdict: null, reviewing: null, landed: null };
  if (task.state !== 'review' && task.state !== 'rework') return facts;
  const branch = task.run?.branch;
  const rev = (ref: string) => run('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: paths.root }).stdout.trim();
  facts.head = branch ? rev(`refs/heads/${branch}`) : '';
  if (task.state !== 'review') return facts;
  facts.reviewing = reviewing(paths, task.id)?.sessionId ?? null;
  facts.verdict = facts.head ? readVerdict(paths, task.id, facts.head)?.verdict ?? null : null;
  // A pull request landed before acc recorded the commit: what GitHub last had, as this clone saw it.
  if (task.pr?.state === 'open') facts.landed = task.pr.sha ?? (branch ? rev(`refs/remotes/origin/${branch}`) || null : null);
  return facts;
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
  /** A land's pull request. */
  pr?: { number: number; url: string; opened: boolean };
  /** A GitHub issue's comment that gh didn't confirm. */
  commentUnconfirmed?: string;
}

export interface AutopilotResult {
  steps: AutopilotStep[];
  /** Comments for Jira and Azure DevOps tickets, which autopilot can't post: a person posts them. */
  pendingComments: (PendingComment & { task: string })[];
}

/** What a step reports back to the pass. */
type StepRun = Pick<AutopilotStep, 'reason' | 'pr' | 'commentUnconfirmed'> & { comment?: PendingComment | null };

/** The three steps autopilot takes. Tests put their own in. */
export interface AutopilotSteps {
  review(id: string): StepRun;
  land(id: string): StepRun;
  dispatch(id: string): StepRun;
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
  steps?: Partial<AutopilotSteps>;
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
      const r = dispatch(paths, config, id, { run, now, env, accBinDir: deps.accBinDir, accCommand: deps.accCommand }, { actor: 'orchestrator', by: AUTOPILOT_BY });
      return { reason: `Re-dispatched in ${r.worktree}${r.bgId ? `, background session ${r.bgId}` : ''}.` };
    },
  };
}

function landStep(r: LandResult): StepRun {
  return {
    reason: `${r.opened ? 'Opened' : 'Updated'} pull request #${r.pr.number}.`,
    pr: { number: r.pr.number, url: r.pr.url, opened: r.opened },
    ...(r.commentUnconfirmed ? { commentUnconfirmed: r.commentUnconfirmed } : {}),
    comment: r.comment,
  };
}

/**
 * Why a step's error is only for now, or null when it's a real failure. Only these wait: the ledger was
 * busy, or the agent cap filled up between the look and the dispatch. Anything else is recorded.
 */
function temporary(e: unknown, paths: RepoPaths, config: Config, id: string): string | null {
  const code = (e as AccError).code;
  if (code === 'lock-timeout') return 'The ledger was busy. Autopilot tries again next pass.';
  if (code === 'move-refused') {
    const n = running(readLedger(paths.ledger), id);
    if (n >= config.agents.max) return `${n} tasks are running. The limit is ${config.agents.max}.`;
  }
  return null;
}

const firstLines = (text: string): string => text.trim().split('\n').slice(0, 3).join(' ').replace(/\s+/g, ' ');

/** Writes down a step that failed, on the task, as the orchestrator: the task then shows as needs you. */
function recordFailure(paths: RepoPaths, now: () => Date, id: string, failed: AutopilotFailure): void {
  mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === id);
    if (!t || t.state !== failed.state) return; // it moved meanwhile: the failure is about a state it left
    t.autopilot = { failed };
    t.updatedAt = failed.at;
    emit({ type: 'task.updated', task: id, actor: 'orchestrator', by: AUTOPILOT_BY, data: { autopilot: { failed } } });
  });
}

/**
 * One pass: for each task, in ledger order, the next step, taken one at a time. The ledger is read again
 * before each, so a task a person moved meanwhile is judged as it is now. A task reviewed in this pass
 * lands in the next.
 */
export function autopilotPass(paths: RepoPaths, config: Config, deps: AutopilotDeps): AutopilotResult {
  const steps = { ...realSteps(paths, config, deps), ...deps.steps };
  const out: AutopilotResult = { steps: [], pendingComments: [] };
  for (const id of readLedger(paths.ledger).tasks.map((t) => t.id)) {
    const ledger = readLedger(paths.ledger);
    const task = ledger.tasks.find((t) => t.id === id);
    if (!task || task.state === 'done') continue;
    const facts = taskFacts(paths, task, deps.run);
    const d = nextStep(ledger, config, task, facts);
    const sha = facts.head || null;
    if (!d.step) {
      out.steps.push({ task: id, state: task.state, step: null, sha, outcome: d.outcome ?? 'skipped', reason: d.reason });
      continue;
    }
    deps.onStep?.(id, d.step, facts.head);
    try {
      const r = steps[d.step](id);
      out.steps.push({ task: id, state: task.state, step: d.step, sha, outcome: 'done', reason: r.reason, ...(r.pr ? { pr: r.pr } : {}), ...(r.commentUnconfirmed ? { commentUnconfirmed: r.commentUnconfirmed } : {}) });
      if (r.comment) out.pendingComments.push({ task: id, ...r.comment });
    } catch (e) {
      const wait = temporary(e, paths, config, id);
      if (wait) {
        out.steps.push({ task: id, state: task.state, step: d.step, sha, outcome: 'waiting', reason: wait });
        continue;
      }
      const reason = firstLines((e as Error).message ?? String(e));
      let unrecorded = '';
      try {
        recordFailure(paths, deps.now, id, { step: d.step, sha: facts.head, state: task.state, reason, at: deps.now().toISOString() });
      } catch (err) {
        // Not kept, so the next pass tries again; the pass itself carries on.
        unrecorded = ` (Not recorded on the task: ${(err as Error).message})`;
      }
      out.steps.push({ task: id, state: task.state, step: d.step, sha, outcome: 'failed', reason: reason + unrecorded });
    }
  }
  return out;
}

// ---------------------------------------------------------------- one at a time

/**
 * Runs `fn` holding the repo's autopilot lock, so two autopilots never act on the same tasks. It never
 * goes stale with age, since one pass can take an hour; only a dead owner frees it. A second autopilot is
 * refused at once, naming the one that holds it. Separate from the heavy-check slot, which it never takes.
 */
export function holdAutopilot<T>(paths: RepoPaths, fn: () => T): T {
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
