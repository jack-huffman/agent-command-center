// Autopilot's rules: the facts a task's next step is decided on, and the step.

import { autoMergeFor, type Config } from './config.ts';
import { type CheckRead, readChecks } from './checks.ts';
import { holdWords } from './held.ts';
import type { Runner } from './exec.ts';
import { autopilotFailure, type AutopilotStepName, builders, builderStopped, type ClaudeSession, closedPr, type HistoryEntry, type Ledger, projectCapWords, reworkCause, SEND_BACKS, sendBacks, sentBackAt, sentBackByAutopilot, type Task } from './ledger.ts';
import { machineCapProblem, type MachineLoad } from './limits.ts';
import { type StartLook, waits } from './overlap.ts';
import { NO_CHECKS_GRACE_MS } from './merge.ts';
import type { RepoPaths } from './paths.ts';
import { resuming } from './resume.ts';
import { carriedVerdict, readVerdict, reviewing } from './review.ts';
import { byAutopilot } from './autopilot-log.ts';

// ---------------------------------------------------------------- the rules

/** What autopilot knows about a task before it decides, read from git and the state folder. */
export interface TaskFacts {
  /** The branch's latest commit, or '' when the branch isn't in this clone. */
  head: string;
  /** The review's verdict on that commit, if there is one. */
  verdict: 'pass' | 'changes' | null;
  /** A review under way for the task, by its session: here, or in the cloud (T-86). */
  reviewing: string | null;
  /** The commit its open pull request was last landed at, if acc knows it. */
  landed: string | null;
  /** A running task's builder stopped before acc done or acc block (builderStopped, D-067). */
  stopped?: boolean;
  /** What GitHub's checks say on its pull request, read only when autopilot could send it back (D-076). */
  checks?: CheckRead;
  /** Why gh couldn't read them. */
  checksError?: string;
  /** A held task to do (D-093): what it shares with work in flight, what could start first, and what stops it starting now. */
  start?: StartLook & { problems: string[] };
  /** GitHub reports no checks on it, and it was landed under 2 minutes ago: a slow CI may not have started (GH-67). */
  noChecksYet?: boolean;
  /**
   * What it changes under `.acc/`, against its base as last fetched, asked only when it would join the
   * merge queue (GH-73). The merge asks again, fetched.
   */
  accChanges?: () => string[];
  /** An agent in its worktree waits for a person's answer, asked only where it could join the merge queue (GH-73). */
  asking?: boolean;
  /** This machine's total, and the builders running in its other repos, read once a pass where a start could pass it (GH-111). */
  machine?: MachineLoad | null;
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
export const sentence = (text: string): string => text.replace(/([^.!?])$/, '$1.');

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

export const running = (ledger: Ledger, except: string): number => builders(ledger, except);

/**
 * Why another builder can't start beside those running, or null: the project's cap (agents.max), then this
 * machine's total across every repo (GH-111), each named, so it's clear which to raise.
 */
export function capWait(ledger: Ledger, config: Pick<Config, 'agents'>, except: string, machine: MachineLoad | null | undefined): string | null {
  const n = builders(ledger, except);
  if (n >= config.agents.max) return projectCapWords(n, config.agents.max);
  return machineCapProblem(ledger, except, machine ?? null);
}

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
    // Its cloud review gave no verdict acc could read (T-86): a person reviews it on this Mac.
    if (task.cloudReview?.failed) return none('waiting', `Its cloud review gave no verdict acc could take: ${sentence(task.cloudReview.failed.reason)} A person reviews it on this Mac.`);
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
    const capped = capWait(ledger, config, task.id, facts.machine);
    if (capped) return none('waiting', capped);
    const back = task.autopilot?.sentBack;
    if (cause === 'queue') return step('dispatch', back?.conflicts?.length ? `The merge queue found it conflicts with ${task.environment}: ${back.conflicts.join(', ')}.` : `The merge queue's full check failed: ${back?.checks.join(', ') || 'see its report'}.`);
    return step('dispatch', own ? `Checks failed on GitHub: ${back?.checks.join(', ') || 'see its pull request'}.` : 'The reviewer asked for changes.');
  }
  if (task.state === 'todo') {
    // A person's Dispatch that waits for another task's files is started once it may (D-093); nothing else is.
    const held = task.held;
    if (!held) return none('skipped', 'To do: autopilot starts a task to do only once a person has dispatched it.');
    if (held.failed) return none('waiting', `Its start failed: ${sentence(held.failed.reason)} It waits for a person.`);
    const s = facts.start;
    if (!s) return none('waiting', 'Autopilot couldn\'t tell what it shares with work in flight. It looks again next pass.');
    if (s.problems.length) return none('waiting', s.problems[0]!);
    if (waits(s)) return none('waiting', `${holdWords(s)}.`);
    const capped = capWait(ledger, config, task.id, facts.machine);
    if (capped) return none('waiting', capped);
    if (s.shares.length) return step('start', `Nothing else is ready to start, so it starts sharing files with ${s.shares.map((x) => x.task).join(', ')}.`);
    return step('start', held.waitsFor.length ? `${held.waitsFor.map((x) => x.task).join(', ')}'s files are free.` : 'Nothing in flight shares its files.');
  }
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
  if (s === 'start') return 'start it';
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
  // A review under way here, or in a cloud session (T-86), whose verdict acc sync reads.
  facts.reviewing = reviewing(paths, task.id)?.sessionId ?? (task.cloudReview && !task.cloudReview.failed ? task.cloudReview.sessionId : null);
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

export const firstLines = (text: string): string => text.trim().split('\n').slice(0, 3).join(' ').replace(/\s+/g, ' ');
