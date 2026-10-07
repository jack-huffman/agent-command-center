import { closeSync, mkdirSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { autoMergeFor, type Autonomy, type Config } from './config.ts';
import { type CheckRead, readChecks, sendBack } from './checks.ts';
import { dispatch } from './dispatch.ts';
import { AccError, type Runner } from './exec.ts';
import { releaseAwake } from './awake.ts';
import { withJob } from './jobs.ts';
import { AUTOPILOT_BY, AUTOPILOT_STEPS, type AutopilotFailure, autopilotFailure, type AutopilotStepName, builderStopped, type ClaudeSession, closedPr, type HistoryEntry, type Ledger, type LedgerEvent, mutate, readLedger, type ReworkCause, reworkCause, SEND_BACKS, sendBacks, sentBackAt, sentBackByAutopilot, type State, STOPPED_GRACE_MS, type Task } from './ledger.ts';
import { ghToken, land, type LandResult } from './land.ts';
import { withLock } from './lock.ts';
import { NO_CHECKS_GRACE_MS } from './merge.ts';
import type { RepoPaths } from './paths.ts';
import { holdHead, joinQueue, leaveQueue, ordinal, queueOrder, queueTurn } from './queue.ts';
import { askingUnder, pendingQuestions, type Question, questionsDir } from './questions.ts';
import { refresh } from './refresh.ts';
import { clipSaid, listSessions, resume, type ResumeDeps, resuming } from './resume.ts';
import { carriedVerdict, readVerdict, review, reviewing } from './review.ts';
import type { SlotOptions } from './semaphore.ts';

/**
 * Autopilot (D-055): under `autonomy: review`, each pass reads the ledger and takes the next step for
 * each task, one at a time. It reviews work a builder finished, lands work whose review passed, and
 * re-dispatches a task the reviewer sent back, once. When an open pull request conflicts with its base,
 * it merges the base into the branch and runs its checks (D-058), so the next passes review and land the
 * merge. A builder that stopped before acc done or acc block is resumed, once a run (D-067). A pull
 * request whose checks failed on GitHub goes back to its builder with what they said, once a commit
 * (D-076). It goes up to an open pull request: it waives no check, deploys nothing, promotes nothing,
 * changes nothing on GitHub but its pull request, and starts no task that's to do. It merges a pull
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
export const AUTOPILOT_REVIEW_DOES = 'reviews finished work, lands work whose review passed, re-dispatches a rework once, sends a pull request whose GitHub checks fail back to its builder once a commit, resumes a stopped builder once a run, and merges the base into a pull request that conflicts with it';

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
 * (D-076), resumes a stopped builder once a run (D-067), and merges the base into a pull request that
 * conflicts with it (D-058). dispatch: as review, and it also starts Ready tasks up to agents.max; that
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
  /** A running task's builder stopped before acc done or acc block (builderStopped, D-067). */
  stopped?: boolean;
  /** What GitHub's checks say on its pull request, read only when autopilot could send it back (D-076). */
  checks?: CheckRead;
  /** Why gh couldn't read them. */
  checksError?: string;
  /** GitHub reports no checks on it, and it was landed under 2 minutes ago: a slow CI may not have started (GH-67). */
  noChecksYet?: boolean;
  /**
   * What it changes under `.acc/`, against its base as last fetched, asked only when it would join the
   * merge queue (GH-73). The merge asks again, fetched.
   */
  accChanges?: () => string[];
  /** An agent in its worktree waits for a person's answer, asked only where it could join the merge queue (GH-73). */
  asking?: boolean;
}

export type AutopilotOutcome = 'done' | 'failed' | 'waiting' | 'skipped';

export interface Decision {
  step: AutopilotStepName | null;
  /** Why nothing is done, when step is null: it waits on something, or there's nothing to do. */
  outcome: 'waiting' | 'skipped' | null;
  reason: string;
  /**
   * A step autopilot won't take, to write down on the task as if it had failed, so the task needs you:
   * checks that failed again on a commit it already sent back (D-076).
   */
  record?: { step: AutopilotStepName; reason: string };
  /** A wait that settles by itself, such as GitHub's checks still running: a task in the merge queue keeps its place. */
  settles?: true;
  /** The wait is for GitHub's checks: the head of the merge queue says so, and otherwise says why it waits (GH-73). */
  checks?: true;
  /**
   * The merge queue (GH-73). in: ready to merge, so it joins the queue, or keeps its place. hold: it waits
   * on something that settles by itself, and keeps its place if it has one. Without it, it leaves.
   */
  queue?: 'in' | 'hold';
}

const short = (sha: string): string => sha.slice(0, 7) || 'no commit';
const sentence = (text: string): string => text.replace(/([^.!?])$/, '$1.');

/** A move in a task's history, as the ledger keeps it and the Command Center reads it. */
type Move = Pick<HistoryEntry, 'at' | 'by'> & { from: string | null; to: string; actor: string };


/**
 * Autopilot already re-dispatched a review's rework once (D-055), before `before` when given: every later
 * one is a person's. A re-dispatch after its own send-back, for failing checks (D-076) or from the merge
 * queue (GH-73), is that send-back's, and doesn't count.
 */
export function reworkedByAutopilot(task: { history: Move[] }, before?: string): boolean {
  let own = false;
  for (const h of task.history) {
    if (before !== undefined && h.at >= before) break;
    if (h.to === 'rework') own = sentBackByAutopilot(h);
    else if (h.from === 'rework' && h.to === 'running' && h.actor === 'orchestrator' && !own) return true;
  }
  return false;
}

/**
 * The checks that failed on GitHub, as a task names them (D-076): in review, what acc sync last saw on
 * its open pull request; in rework after autopilot sent it back, what it sent it back for. Else null.
 */
export function failedChecks(task: Pick<Task, 'state' | 'pr' | 'autopilot' | 'history'>): string[] | null {
  const pr = task.pr;
  if (task.state === 'review' && pr?.state === 'open' && pr.ci === 'failing' && pr.failing?.length) return pr.failing;
  const back = task.autopilot?.sentBack;
  if (task.state === 'rework' && back?.checks.length && reworkCause(task) === 'checks') return back.checks;
  return null;
}

/** Autopilot already resumed this run's builder once: a second stop waits for a person (D-067). A new dispatch is a new run. */
export const resumedByAutopilot = (task: Task): boolean => !!task.run?.resumes?.some((r) => byAutopilot(r.by));

const running = (ledger: Ledger, except: string): number => ledger.tasks.filter((t) => t.state === 'running' && t.id !== except).length;

/** What nextStep reads of the config: the agent cap, and whether auto-merge covers a task's environment (GH-67). */
export type StepConfig = Pick<Config, 'agents' | 'profile' | 'autonomy' | 'environments' | 'autopilot'>;

/**
 * The next step for one task, from the ledger and what's known about its branch. Pure but for a look at
 * whether its base moved on, made only when auto-merge would merge it next, so each rule can be tested on
 * its own.
 */
export function nextStep(ledger: Ledger, config: StepConfig, task: Task, facts: TaskFacts): Decision {
  const step = (s: AutopilotStepName, reason: string): Decision => {
    // A step that failed isn't tried again on the same commit: a person does it, or a new commit comes.
    const f = task.autopilot?.failed;
    if (f && f.step === s && f.sha === facts.head && f.state === task.state) {
      return { step: null, outcome: 'waiting', reason: `Autopilot couldn't ${failedWords(s, f.sha)}: ${sentence(f.reason)} It waits for a person, or a new commit.` };
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
    // Someone closed it: autopilot never opens another in its place (D-063).
    const closed = closedPr(task);
    if (closed) return none('waiting', `Pull request #${closed.number} was closed without merging. Autopilot won't replace it: reopen it on GitHub and land to update it, or land to open a new one.`);
    if (pr?.state !== 'open') return step('land', `Its review passed on ${short(facts.head)}, and it has no pull request.`);
    if (facts.landed === facts.head) {
      // Where the repo turns auto-merge on, and the environment isn't protected: the merge queue, which
      // brings it up to date with its base at its turn, conflict or not, then merges it (GH-73).
      if (autoMergeFor(config, task.environment)) return queueStep(task, facts, step, none);
      // Its base moved on and it conflicts (D-049): the base is merged in, and the merge goes the same way (D-058).
      if (pr.conflicts?.length) return step('refresh', `Pull request #${pr.number} conflicts with ${task.environment} in ${pr.conflicts.join(', ')}.`);
      const checks = checksStep(task, facts, step, none);
      if (checks) return checks;
      return none('skipped', `Pull request #${pr.number} is up to date with ${short(facts.head)}.`);
    }
    return step('land', `Its review passed on ${short(facts.head)}, and pull request #${pr.number} is behind it.`);
  }
  if (task.state === 'rework') {
    // Its own send-back, for failing checks (D-076) or from the merge queue (GH-73), is re-dispatched, whatever came before.
    const cause = reworkCause(task);
    const own = cause === 'checks' || cause === 'queue';
    if (!own && reworkedByAutopilot(task)) return none('waiting', 'Autopilot re-dispatched it once already. A second rework waits for a person.');
    const n = running(ledger, task.id);
    if (n >= config.agents.max) return none('waiting', `${n} tasks are running. The limit is ${config.agents.max}.`);
    const back = task.autopilot?.sentBack;
    if (cause === 'queue') return step('dispatch', back?.conflicts?.length ? `The merge queue found it conflicts with ${task.environment}: ${back.conflicts.join(', ')}.` : `The merge queue's full check failed: ${back?.checks.join(', ') || 'see its report'}.`);
    return step('dispatch', own ? `Checks failed on GitHub: ${back?.checks.join(', ') || 'see its pull request'}.` : 'The reviewer asked for changes.');
  }
  if (task.state === 'todo') return none('skipped', 'To do: autopilot never starts a task that\'s to do.');
  if (task.state === 'running') {
    if (!facts.stopped) return none('skipped', 'Its builder is working.');
    if (resumedByAutopilot(task)) return none('waiting', 'Its agent stopped again. Autopilot resumed it once already: a person resumes it.');
    return step('resume', 'Its agent stopped before acc done or acc block.');
  }
  if (task.state === 'blocked') return none('skipped', 'Blocked: a person decides.');
  return none('skipped', 'Done.');
}

/** A step autopilot couldn't take, in words: "land abc1234", "send abc1234 back for its failing checks". */
function failedWords(s: AutopilotStepName, sha: string): string {
  if (s === 'refresh') return `update ${short(sha)} from its base`;
  if (s === 'checks') return `send ${short(sha)} back for its failing checks`;
  if (s === 'queue') return `take ${short(sha)} through the merge queue`;
  return `${s} ${short(sha)}`;
}

const names = (list: string[]): string => list.join(', ');

/**
 * What a pull request's checks on GitHub mean for a task in review whose pull request is landed at its
 * latest commit and merges cleanly (D-076), or, `queueing`, is in the merge queue's hands, conflict or not
 * (GH-73); null when they mean nothing to do. Still running: it waits, a wait that settles by itself.
 * Failed, with a log to send: back to its builder, once a commit and 3 times a task, with the queue's
 * send-backs. Checks that failed again on a commit it already sent back are written down, so the task needs you.
 */
function checksStep(task: Task, facts: TaskFacts, step: (s: AutopilotStepName, reason: string) => Decision, none: (o: 'waiting' | 'skipped', reason: string) => Decision, queueing = false): Decision | null {
  const pr = task.pr!;
  const head = facts.head;
  // Already written down on this commit: it waits, and GitHub isn't asked again.
  const f = task.autopilot?.failed;
  if (f?.step === 'checks' && f.sha === head && f.state === task.state) return step('checks', '');
  // Waits that settle by themselves: a task in the merge queue keeps its place through them (GH-73).
  const settling = (reason: string, checks = false): Decision => ({ step: null, outcome: 'waiting', reason, ...(queueing ? { settles: true as const, ...(checks ? { checks: true as const } : {}) } : {}) });
  if (facts.checksError) return settling(`Autopilot couldn't read pull request #${pr.number}'s checks on GitHub: ${sentence(facts.checksError)} It tries again next pass.`);
  const c = facts.checks;
  if (!c) return null;
  // Another commit on GitHub: in the merge queue, its turn looks at it (queueStep), since it may never settle.
  if (c.sha !== head) return queueing ? null : settling(`Pull request #${pr.number} is at ${short(c.sha)} on GitHub, not ${short(head)}: a land or a person comes first.`);
  if (c.pending.length) return settling(`Checks are still running on GitHub: ${names(c.pending)}.`, true);
  if (!c.failed.length) return null;
  const failed = names(c.failed.map((x) => x.name));
  // A commit status or another app's check keeps no log on GitHub: nothing to send its builder (D-076).
  if (!c.failed.some((x) => x.job)) return none('waiting', `Checks failed on GitHub: ${failed}. GitHub keeps no log for ${c.failed.length === 1 ? 'it' : 'them'}, so autopilot doesn't send it back: a person decides.`);
  const record = (reason: string): Decision => ({ step: null, outcome: 'waiting', reason, record: { step: 'checks', reason } });
  if (sentBackAt(task, head)) return record(`Checks failed on GitHub again: ${failed}. Autopilot already sent ${short(head)} back once: a person decides.`);
  // One limit for both of autopilot's send-backs, where the merge queue sends back too (GH-73).
  if (sendBacks(task) >= SEND_BACKS) return record(`Checks failed on GitHub: ${failed}. Autopilot sent ${task.id} back ${queueing ? 'to its builder' : 'for failing checks'} ${SEND_BACKS} times already: a person decides.`);
  return step('checks', `Checks failed on GitHub on ${short(head)}: ${failed}.`);
}

/**
 * Whether a task in review whose pull request is landed at its latest commit is ready for the merge queue,
 * where the repo turns auto-merge on (GH-73): GH-67's merge conditions, but for being up to date with its
 * base, which the queue sees to at its turn, conflict or not. in: it joins the queue, or keeps its place.
 * hold: it waits on something that settles by itself, such as GitHub's checks still running, and keeps its
 * place if it has one. Anything else, a step to take or a wait on a person, such as an agent in its
 * worktree asking something, and it leaves the queue. Merged already, it waits for acc sync. Checks that
 * were cancelled, or a change to `.acc/`, are written down, so the task needs you. No checks at all count
 * once 2 minutes have passed since the land, where the base requires none, and at once where it conflicts:
 * GitHub starts none on a pull request until it merges. One at another commit on GitHub, such as after
 * Update branch, is in: its turn fetches the branch, and finds what a person has to bring in.
 */
function queueStep(task: Task, facts: TaskFacts, step: (s: AutopilotStepName, reason: string) => Decision, none: (o: 'waiting' | 'skipped', reason: string) => Decision): Decision {
  const pr = task.pr!;
  const merged = task.autopilot?.merged;
  if (merged?.sha === facts.head) return none('skipped', `Autopilot merged pull request #${merged.pr.number}. acc sync moves it to done.`);
  // Its merge, or its turn, failed on this commit: not tried again (D-055).
  const f = task.autopilot?.failed;
  if (f && (f.step === 'merge' || f.step === 'queue') && f.sha === facts.head && f.state === task.state) return step(f.step, '');
  const checks = checksStep(task, facts, step, none, true);
  if (checks) return checks.settles ? { ...checks, queue: 'hold' } : checks;
  const failure = autopilotFailure(task);
  if (failure) return none('waiting', `Autopilot couldn't ${failedWords(failure.step, failure.sha)}: a person decides before it merges.`);
  if (pr.changesRequested) return none('waiting', `A person asked for changes on pull request #${pr.number}, so autopilot doesn't merge it.`);
  // An agent in its worktree asking a person something: nothing may wait on a person in the queue, so it
  // joins once they've answered.
  if (facts.asking) return none('waiting', `An agent in ${task.id}'s worktree is waiting for your answer: it joins the merge queue once you've answered.`);
  const hold = (reason: string, checks = false): Decision => ({ step: null, outcome: 'waiting', reason, queue: 'hold', ...(checks ? { checks: true as const } : {}) });
  const c = facts.checks;
  if (!c) return hold(`Autopilot hasn't read pull request #${pr.number}'s checks on GitHub yet.`);
  // GitHub has a commit acc didn't land, such as one Update branch made: its checks say nothing about this
  // one, and waiting would hold the queue for good. Its turn fetches the branch, and a commit this clone
  // lacks needs a person.
  const moved = c.sha !== facts.head;
  if (!moved && c.cancelled.length) {
    const reason = `Checks were cancelled on GitHub: ${names(c.cancelled)}. Run them again, or merge it yourself.`;
    return { step: null, outcome: 'waiting', reason, record: { step: 'merge', reason } };
  }
  // c.required is a guard: gh answers --required on a commit with no checks as "no checks reported". One
  // that conflicts gets none to wait for: GitHub runs no pull_request workflows until its base is merged in,
  // which its turn does, pushing a commit they run on.
  if (!moved && !c.count && !pr.conflicts?.length && (c.required || facts.noChecksYet)) return hold(`GitHub reports no checks on pull request #${pr.number} yet. Autopilot gives them 2 minutes after a land.`, true);
  const placed = inQueueAt(task, facts.head);
  if (!placed) {
    // acc's own config, such as whether a repo auto-merges, is a person's to merge (GH-67): asked as it joins.
    const acc = facts.accChanges?.() ?? [];
    if (acc.length) {
      const reason = `It changes .acc/, which a person merges: ${acc.join(', ')}.`;
      return { step: null, outcome: 'waiting', reason, record: { step: 'merge', reason } };
    }
  }
  if (moved) return { step: null, outcome: 'waiting', reason: `Pull request #${pr.number} is at ${short(c.sha)} on GitHub, not ${short(facts.head)}, the commit acc landed: at its turn the merge queue fetches it, and a commit this clone lacks needs a person.`, queue: 'in' };
  return { step: null, outcome: 'waiting', reason: placed ? 'In the merge queue.' : `Pull request #${pr.number} passed its review and its checks on ${short(facts.head)}: it joins the merge queue.`, queue: 'in' };
}

/** Whether the task holds a place in the merge queue at this commit: the one it joined at, or the queue's own merge on it (GH-73). */
export function inQueueAt(task: Pick<Task, 'state' | 'autopilot'>, head: string): boolean {
  const q = task.autopilot?.queued;
  return task.state === 'review' && !!q && !!head && (q.sha === head || task.autopilot?.carried?.to === head);
}

/** Who reads GitHub for autopilot: the repo, and its account's environment, fetched once it's needed. */
export interface FactsGitHub {
  repo: string;
  env: () => NodeJS.ProcessEnv;
  /** Whether auto-merge covers an environment's branch (GH-67): its pull requests' checks are read for the merge queue (GH-73). */
  autoMerge?: (branch: string) => boolean;
  /** Whether an agent working in a folder waits for a person's answer, asked of a task that could join the merge queue (GH-73). */
  asking?: (worktree: string) => boolean;
}

/**
 * Whether to ask GitHub about a task's checks: in review, its review passed, its open pull request landed
 * at its latest commit and merging cleanly, and acc sync didn't last see its checks passing (D-076). One
 * auto-merge could merge is asked even then, unless it merged it already (GH-67), and conflict or not:
 * the merge queue merges its base in at its turn (GH-73).
 */
function checksWanted(task: Task, facts: TaskFacts, merging: boolean): boolean {
  const pr = task.pr;
  if (task.state !== 'review' || pr?.state !== 'open' || facts.verdict !== 'pass' || facts.reviewing) return false;
  if (!facts.head || pr.sha !== facts.head || facts.landed !== facts.head || (!merging && pr.conflicts?.length)) return false;
  if (merging ? task.autopilot?.merged?.sha === facts.head : pr.ci === 'passing') return false;
  const f = task.autopilot?.failed;
  return !(f && (f.step === 'checks' || f.step === 'merge') && f.sha === facts.head && f.state === task.state);
}

/**
 * What autopilot needs to know about a task in review, rework or running. Other states need nothing. A
 * running task's builder has stopped by the sessions `claude agents` listed, or not when it didn't answer.
 * With `github`, a task autopilot could send back has its pull request's checks read (D-076).
 */
/**
 * Each task's last checks read that had all finished with nothing to send back, by its commit, kept for the life of the
 * process: `acc autopilot --every` then asks GitHub once a commit, and a quiet board makes no calls, with
 * or without acc sync (D-076). A new commit is read afresh.
 */
const settledChecks = new Map<string, { sha: string; checks: NonNullable<TaskFacts['checks']> }>();

export function taskFacts(paths: RepoPaths, task: Task, run: Runner, sessions: ClaudeSession[] | null = null, now: Date = new Date(), github?: FactsGitHub): TaskFacts {
  const facts: TaskFacts = { head: '', verdict: null, reviewing: null, landed: null };
  if (task.state !== 'review' && task.state !== 'rework' && task.state !== 'running') return facts;
  const branch = task.run?.branch;
  const rev = (ref: string) => run('git', ['rev-parse', '--verify', '--quiet', ref], { cwd: paths.root }).stdout.trim();
  facts.head = branch ? rev(`refs/heads/${branch}`) : '';
  if (task.state === 'running') {
    facts.stopped = builderStopped(task, sessions, { resuming: !!resuming(paths, task.id), now });
    return facts;
  }
  if (task.state !== 'review') return facts;
  facts.reviewing = reviewing(paths, task.id)?.sessionId ?? null;
  // Its own review, or the one the merge queue's merge commit carries (GH-73).
  facts.verdict = facts.head ? readVerdict(paths, task.id, facts.head)?.verdict ?? (carriedVerdict(paths, task, facts.head) ? 'pass' : null) : null;
  // A pull request landed before acc recorded the commit: what GitHub last had, as this clone saw it.
  if (task.pr?.state === 'open') facts.landed = task.pr.sha ?? (branch ? rev(`refs/remotes/origin/${branch}`) || null : null);
  const merging = !!github?.autoMerge?.(task.environment);
  if (github && checksWanted(task, facts, merging)) {
    const key = `${paths.ledger}#${task.id}`;
    const settled = settledChecks.get(key);
    if (settled?.sha === facts.head) facts.checks = settled.checks;
    else {
      try {
        facts.checks = readChecks(run, github.repo, task.pr!.number, github.env());
        const c = facts.checks;
        // Settled with nothing to send back (all passed, or only checks GitHub keeps no log for): kept. A
        // failure autopilot would act on is read again, since its send-back reads it afresh anyway. So is
        // none at all, which a slow CI can still change (GH-67).
        if (c && c.sha === facts.head && c.count && !c.pending.length && !c.failed.some((x) => x.job)) settledChecks.set(key, { sha: facts.head, checks: c });
      } catch (e) {
        facts.checksError = firstLines((e as Error).message ?? String(e));
      }
    }
    const landedAt = Date.parse(task.pr?.landedAt ?? '');
    if (facts.checks && !facts.checks.count && Number.isFinite(landedAt)) facts.noChecksYet = now.getTime() - landedAt < NO_CHECKS_GRACE_MS;
  }
  // What it changes under .acc/, asked only as it would join the merge queue, against its base as last
  // fetched: no fetch for it, and the merge asks again (GH-73).
  if (merging && branch && facts.head) {
    const base = task.environment;
    const head = facts.head;
    facts.accChanges = () => {
      const r = run('git', ['diff', '--name-only', '--no-renames', `refs/remotes/origin/${base}...${head}`, '--', '.acc'], { cwd: paths.root });
      return r.code === 0 ? r.stdout.split('\n').filter(Boolean) : [];
    };
  }
  // Nothing waits on a person in the merge queue: an agent in its worktree asking one something keeps it out (GH-73).
  const wt = task.run?.worktree;
  if (merging && wt && task.pr?.state === 'open' && facts.verdict === 'pass' && github?.asking) facts.asking = github.asking(wt);
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
      return { reason: `Re-dispatched${cause === 'checks' ? ' for its failing checks' : cause === 'queue' ? ' with what the merge queue found' : ''} in ${r.worktree}${r.bgId ? `, background session ${r.bgId}` : ''}.` };
    },
    // A conflict only: where auto-merge is on, the merge queue brings a pull request up to date at its turn (GH-73).
    refresh: (id) => ({ reason: refresh(paths, config, id, { run, now, env, slots: deps.slots }, { actor: 'orchestrator', by: AUTOPILOT_BY }).reason }),
    resume: (id) => {
      const r = resume(paths, config, id, { run, now, env, accBinDir: deps.accBinDir, accCommand: deps.accCommand, ...deps.resume }, { actor: 'orchestrator', by: AUTOPILOT_BY });
      return { reason: `Resumed its builder${r.said ? `, which last said: ${clipSaid(r.said, 200)}` : '.'}` };
    },
    checks: (id) => ({ reason: sendBack(paths, config, id, { run, now, env }, { actor: 'orchestrator', by: AUTOPILOT_BY }).reason }),
    queue: (id) => queueTurn(paths, config, id, { run, now, env, slots: deps.slots }, { actor: 'orchestrator', by: AUTOPILOT_BY }),
  };
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
  if (code === 'move-refused') {
    const n = running(readLedger(paths.ledger), id);
    if (n >= config.agents.max) return `${n} tasks are running. The limit is ${config.agents.max}.`;
  }
  return null;
}

const firstLines = (text: string): string => text.trim().split('\n').slice(0, 3).join(' ').replace(/\s+/g, ' ');

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
  /** Takes a step and fills in its entry: done, waiting for now, or failed and written down on the task. */
  const take = (entry: AutopilotStep, fn: () => TurnRun): void => {
    const id = entry.task;
    try {
      const r = fn();
      Object.assign(entry, { step: r.step ?? entry.step, outcome: r.outcome ?? 'done', reason: r.reason, ...(r.pr ? { pr: r.pr } : {}), ...(r.update ? { update: r.update } : {}) });
      if (r.update) out.updates.push({ task: id, ...r.update });
    } catch (e) {
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

// ---------------------------------------------------------------- what it did, read back

/** Whether autopilot did it: as the orchestrator, or a reviewer's move made for it. */
export const byAutopilot = (by: string): boolean => by === AUTOPILOT_BY || by.endsWith(` for ${AUTOPILOT_BY}`);

/** A step autopilot took, as its ledger event tells it, so any window can show what it did (D-064). */
export interface AutopilotRecord {
  seq: number;
  at: string;
  task: string;
  step: AutopilotStepName;
  outcome: 'done' | 'failed';
  /** A review's verdict. */
  verdict?: 'pass' | 'changes';
  /** A land's pull request, and whether it opened it or updated one, or the pull request a merge merged. */
  pr?: { number: number; url: string; opened: boolean };
  /** A refresh: the base it merged in, or null when the conflict had gone and nothing was merged. */
  base?: string | null;
  /** Why it failed, what the review asked for, or what a builder it resumed last said. */
  reason?: string;
  /** The checks that failed on GitHub, when it sent the task back for them (D-076), or the gates of the merge queue's full check that failed (GH-73). */
  checks?: string[];
  /** The files the merge queue couldn't merge the base into, when it sent the task back for them (GH-73). */
  conflicts?: string[];
  /** A refresh the merge queue made at the task's turn, which it pushes once its full check passed, and merges after (GH-73). */
  queue?: true;
  /** What a re-dispatch was for: the checks it sent back for, the merge queue's send-back, or a review's changes. */
  cause?: ReworkCause;
}

const obj = (v: unknown): Record<string, any> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : null);

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string') : []);

/**
 * The step a ledger event records, when autopilot took it, or null. A review that passed, a land, a
 * refresh and a merge are task.updated; a review that asked for changes, a send-back and a re-dispatch are
 * moves; a failure is the failure written on the task. A re-dispatch's run record, a task's place in the
 * merge queue, and a person's steps are null.
 */
export function autopilotEvent(e: Pick<LedgerEvent, 'seq' | 'at' | 'type' | 'task' | 'by' | 'data'>): AutopilotRecord | null {
  if (!e || typeof e.by !== 'string' || !byAutopilot(e.by) || typeof e.task !== 'string') return null;
  const base = { seq: e.seq, at: e.at, task: e.task };
  const d = obj(e.data) ?? {};
  if (e.type === 'task.moved') {
    // Autopilot's own move to rework sends back failing checks (D-076), or what the merge queue found
    // (GH-73), as its event says; a review's is made for it.
    if (d.from === 'review' && d.to === 'rework' && e.by === AUTOPILOT_BY) {
      const reason = typeof d.reason === 'string' && d.reason ? { reason: d.reason } : {};
      if (d.kind === 'queue') {
        const conflicts = strings(d.conflicts);
        return { ...base, step: 'queue', outcome: 'done', checks: strings(d.checks), ...(conflicts.length ? { conflicts } : {}), ...reason };
      }
      return { ...base, step: 'checks', outcome: 'done', checks: strings(d.checks), ...reason };
    }
    if (d.from === 'review' && d.to === 'rework') {
      const reason = typeof d.reason === 'string' ? d.reason.replace(/^Review asked for changes:\s*/, '') : undefined;
      return { ...base, step: 'review', outcome: 'done', verdict: 'changes', ...(reason ? { reason } : {}) };
    }
    if (d.from === 'rework' && d.to === 'running') return { ...base, step: 'dispatch', outcome: 'done', ...(d.cause === 'checks' || d.cause === 'queue' || d.cause === 'review' ? { cause: d.cause } : {}) };
    return null;
  }
  if (e.type !== 'task.updated') return null;
  const failed = obj(obj(d.autopilot)?.failed);
  if (failed && (AUTOPILOT_STEPS as readonly string[]).includes(failed.step)) {
    return { ...base, step: failed.step as AutopilotStepName, outcome: 'failed', reason: String(failed.reason ?? '') };
  }
  // A pull request it merged (GH-67): its own key, read before a bare pull request, which is a refresh's.
  const merged = obj(d.merged);
  const mergedPr = obj(merged?.pr);
  if (mergedPr && typeof mergedPr.number === 'number') return { ...base, step: 'merge', outcome: 'done', pr: { number: mergedPr.number, url: String(mergedPr.url ?? ''), opened: false } };
  const reviewed = obj(d.reviewed);
  if (reviewed?.verdict === 'pass') return { ...base, step: 'review', outcome: 'done', verdict: 'pass' };
  const pr = obj(d.pr);
  if (pr && typeof d.opened === 'boolean' && typeof pr.number === 'number') {
    return { ...base, step: 'land', outcome: 'done', pr: { number: pr.number, url: String(pr.url ?? ''), opened: d.opened } };
  }
  // A builder it resumed (D-067), with the last thing it said.
  const resumed = obj(d.resumed);
  if (resumed) return { ...base, step: 'resume', outcome: 'done', ...(typeof resumed.said === 'string' && resumed.said ? { reason: resumed.said } : {}) };
  const refreshed = obj(d.refreshed);
  if (refreshed) return { ...base, step: 'refresh', outcome: 'done', base: typeof refreshed.base === 'string' ? refreshed.base : null, ...(refreshed.queue === true ? { queue: true as const } : {}) };
  // A refresh that found the conflict gone marks the pull request so, and merges nothing (D-058).
  if (pr && typeof pr.number === 'number') return { ...base, step: 'refresh', outcome: 'done', base: null, pr: { number: pr.number, url: String(pr.url ?? ''), opened: false } };
  return null;
}

/** How much of a repo's events a first look reads, and how many of autopilot's steps a log keeps. */
const EVENTS_TAIL_BYTES = 256 * 1024;
const KEEP_STEPS = 300;

/** What has been read of a repo's events (events.jsonl, never trimmed), and the steps autopilot took in them. */
export interface AutopilotLog {
  /** The byte after the last whole line read. */
  offset: number;
  ino: number;
  /** Still to drop the half line the first read starts in. */
  fresh: boolean;
  /** Autopilot's steps, oldest first: the newest 300. */
  records: AutopilotRecord[];
}

/**
 * Reads what was added to a repo's events since the last look, keeping autopilot's steps (D-064). The
 * first look reads only the last 256 KB, so a long history costs nothing, and each look after reads
 * only what was added. A file that shrank or was replaced is read again from its tail. Undefined when
 * there's no file yet.
 */
export function readAutopilotLog(file: string, log?: AutopilotLog): AutopilotLog | undefined {
  let st;
  try {
    st = statSync(file);
  } catch {
    return undefined;
  }
  const s: AutopilotLog = !log || log.ino !== st.ino || st.size < log.offset
    ? { offset: Math.max(0, st.size - EVENTS_TAIL_BYTES), ino: st.ino, fresh: true, records: [] }
    : { ...log, records: [...log.records] };
  if (st.size === s.offset) return s;
  const buf = Buffer.alloc(st.size - s.offset);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, buf, 0, buf.length, s.offset);
  } finally {
    closeSync(fd);
  }
  let from = 0;
  if (s.fresh && s.offset > 0) {
    const nl = buf.indexOf(10);
    if (nl < 0) return s;
    from = nl + 1;
  }
  // Only whole lines: one being written is read next time.
  const end = buf.lastIndexOf(10);
  if (end < from) return { ...s, offset: s.offset + from, fresh: false };
  for (const line of buf.subarray(from, end).toString('utf8').split('\n')) {
    try {
      const r = autopilotEvent(JSON.parse(line));
      if (r) s.records.push(r);
    } catch {
      // a line that isn't an event
    }
  }
  if (s.records.length > KEEP_STEPS) s.records.splice(0, s.records.length - KEEP_STEPS);
  return { ...s, offset: s.offset + end + 1, fresh: false };
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
