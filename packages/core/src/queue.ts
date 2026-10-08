import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { type Config, environmentByBranch, requiredGates } from './config.ts';
import { type QueueCheck, type QueueReport, queueReportPath, tailText } from './checks.ts';
import { AccError, type Runner } from './exec.ts';
import type { GateResult } from './gates.ts';
import { land } from './land.ts';
import { type Actor, applyMove, checkMove, inQueue, type Ledger, mutate, noGateHooks, type QueueCover, type QueuePhase, readLedger, SEND_BACKS, sendBacks, sentBackAt, type Task } from './ledger.ts';
import { mergePr } from './merge.ts';
import type { RepoPaths } from './paths.ts';
import { readReceipt, satisfies } from './receipts.ts';
import { CheckFailure, checkCommit, MergeConflict, mergeBaseIn, mergePlace, type MergePlace, undoMerge } from './refresh.ts';
import type { SlotOptions } from './semaphore.ts';
import { fetchBranches } from './sync.ts';

/**
 * The merge queue (GH-73). Where a repo turns auto-merge on (GH-67), a pull request that's ready to merge
 * joins its repo's queue, in the order autopilot first saw it ready: reviewed, landed at its latest commit,
 * green on GitHub, and nothing waiting on a person. Being up to date with its base isn't asked: the queue
 * sees to that. Only the task at the head takes a turn, at the end of an autopilot pass:
 *
 * - its base is merged into its branch, in its worktree, when it moved on (D-058's rules)
 * - the full check, `gates.required`, runs once on the result, in a heavy-check slot (D-080)
 * - a merge commit is pushed to the same pull request, carrying the review of the commit it was made on,
 *   and merges once GitHub's checks pass there; one that was up to date merges now (GH-67's merge)
 *
 * A conflict autopilot can't resolve, or a full check that fails, puts the branch back, and the task goes
 * back to its builder with what the queue found, under D-076's limits; past them, or for anything else
 * that stops it, it needs you. Either way it leaves the queue, and the next task is the head.
 */

/** What the queue reads of the config: whether auto-merge covers an environment, and its checks. */
export type QueueConfig = QueueCover;

const short = (sha: string): string => sha.slice(0, 7) || 'no commit';

/**
 * A repo's merge queue, head first: its tasks in review that joined, where auto-merge still covers their
 * environment, by when they were ready, ties in ledger order. One queue a repo, whatever the environment.
 */
export function queueOrder(ledger: Pick<Ledger, 'tasks'>, config: QueueConfig): Task[] {
  const index = new Map(ledger.tasks.map((t, i) => [t.id, i]));
  return ledger.tasks.filter((t) => inQueue(t, config))
    .sort((a, b) => a.autopilot!.queued!.at.localeCompare(b.autopilot!.queued!.at) || index.get(a.id)! - index.get(b.id)!);
}

/** "1st", "2nd", "3rd", "4th", "11th", "22nd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${suffix}`;
}

/** A task's place in its repo's merge queue: 1 is the head. What it waits on: its phase, or the task ahead. */
export interface QueuePlace {
  id: string;
  place: number;
  of: number;
  /** The task right ahead of it, or null at the head. */
  ahead: string | null;
  phase: QueuePhase;
  /** What the head waits on, in words, while it's held. */
  why: string | null;
}

export function queuePlaces(ledger: Pick<Ledger, 'tasks'>, config: QueueConfig): QueuePlace[] {
  const order = queueOrder(ledger, config);
  return order.map((t, i) => ({ id: t.id, place: i + 1, of: order.length, ahead: i ? order[i - 1]!.id : null, phase: t.autopilot!.queued!.phase, why: t.autopilot!.queued!.why ?? null }));
}

/** What the head of a queue is doing, in words, as acc and the Command Center say it. Held, it's why it waits. */
export function phaseWords(phase: QueuePhase, base: string, why?: string | null): string {
  return {
    waiting: 'Next to merge',
    refreshing: `Merging ${base} in`,
    slot: 'Waiting for a heavy-check slot',
    checking: 'Running the full check',
    github: 'Waiting for GitHub\'s checks',
    held: why?.trim().replace(/\.$/, '') || 'Waiting',
    merging: 'Merging',
  }[phase];
}

/** What a task in the queue waits on, in words: the head's phase, or the task ahead of it. */
export const queueWaits = (p: QueuePlace, base: string): string => (p.ahead ? `Behind ${p.ahead}` : phaseWords(p.phase, base, p.why));

// ---------------------------------------------------------------- joining, leaving and the phase

type Who = { actor: Actor; by: string };

/** Writes the queue's change on a task, as autopilot. Its event says only `queued`, which History doesn't list. */
function setQueued(paths: RepoPaths, now: () => Date, id: string, who: Who, change: (t: Task) => boolean): void {
  mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === id);
    if (!t || !change(t)) return;
    t.updatedAt = now().toISOString();
    emit({ type: 'task.updated', task: id, actor: who.actor, by: who.by, data: { queued: t.autopilot?.queued ?? null } });
  });
}

/** It joins at the back: ready now, at this commit. */
export function joinQueue(paths: RepoPaths, now: () => Date, id: string, sha: string, who: Who): void {
  setQueued(paths, now, id, who, (t) => {
    if (t.state !== 'review') return false;
    t.autopilot = { failed: null, ...t.autopilot, queued: { at: now().toISOString(), sha, phase: 'waiting' } };
    return true;
  });
}

/** It leaves: no longer ready. When it is again, it joins at the back. */
export function leaveQueue(paths: RepoPaths, now: () => Date, id: string, who: Who): void {
  setQueued(paths, now, id, who, (t) => {
    if (!t.autopilot?.queued) return false;
    t.autopilot.queued = null;
    return true;
  });
}

/** Where the head is in its turn, so the Command Center shows it while the turn runs, and, held, why it waits. */
function setPhase(paths: RepoPaths, now: () => Date, id: string, phase: QueuePhase, who: Who, why?: string): void {
  setQueued(paths, now, id, who, (t) => {
    const q = t.autopilot?.queued;
    if (!q || (q.phase === phase && q.why === why)) return false;
    t.autopilot!.queued = { at: q.at, sha: q.sha, phase, ...(why ? { why } : {}) };
    return true;
  });
}

/**
 * The head waits before its turn: on GitHub's checks, or on something else, in that wait's own words. The
 * Command Center says which, not one word for every wait.
 */
export function holdHead(paths: RepoPaths, now: () => Date, id: string, wait: { checks: boolean; why: string }, who: Who): void {
  if (wait.checks) setPhase(paths, now, id, 'github', who);
  else setPhase(paths, now, id, 'held', who, wait.why);
}

// ---------------------------------------------------------------- the head's turn

export interface QueueDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  /** The heavy-check slot the full check takes, machine-wide unless a test says otherwise. */
  slots?: SlotOptions;
}

export interface QueueTurn {
  /** merge when it merged the pull request; queue for anything else it did, or waits on. */
  step: 'queue' | 'merge';
  outcome: 'done' | 'waiting';
  reason: string;
  /** The pull request it pushed the merge commit to, or merged. */
  pr?: { number: number; url: string; opened: boolean };
  /** The update the push drafted for the ticket (D-066). */
  update?: { id: string; key: string };
}

/** An error in the merge itself is the merge's, as GH-67 records it; anything else stops the queue's turn. */
const asMerge = (e: unknown): Error => Object.assign(e as Error, { step: 'merge' as const });

/**
 * The head's turn (GH-73): its base merged in if it moved on, the full check run once on the result if it
 * hasn't passed there, then the merge commit pushed to its pull request, or, with nothing to merge in, the
 * pull request merged. Whatever only has to wait, such as GitHub's checks still running, stops it with code
 * merge-waits. A conflict or a failed check sends it back to its builder. Anything else is an AccError, which
 * autopilot records, so the task needs you; one from the merge says so (`step: 'merge'`).
 */
export function queueTurn(paths: RepoPaths, config: Config, id: string, deps: QueueDeps, who: Who): QueueTurn {
  const { run, now } = deps;
  const ledger = readLedger(paths.ledger);
  const task = ledger.tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  const waits = (why: string) => new AccError('merge-waits', why);
  if (queueOrder(ledger, config)[0]?.id !== id) throw waits(`${id} isn't at the head of the merge queue any more.`);
  const pr = task.pr;
  if (pr?.state !== 'open') throw waits(`${id} has no open pull request.`);
  const env = environmentByBranch(config, task.environment);
  if (!env) throw new AccError('queue', `${id}'s environment "${task.environment}" isn't in the config.`);
  const branch = task.run?.branch;
  const git = (...args: string[]) => run('git', args, { cwd: paths.root });
  const head = branch ? git('rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).stdout.trim() : '';
  if (!branch || !head) throw new AccError('queue', `${id}'s branch isn't in this clone.`);
  if (pr.sha !== head) throw waits(`Pull request #${pr.number} was landed at ${short(pr.sha ?? '')}, not ${short(head)}: a land comes first.`);
  const phase = (p: QueuePhase, why?: string) => setPhase(paths, now, id, p, who, why);

  // The base and the branch as origin has them, unattended.
  if (!fetchBranches(run, paths.root, [env.branch, branch], { ...deps.env, GIT_TERMINAL_PROMPT: '0' })) throw waits(`Couldn't fetch ${env.branch} and ${branch} from origin.`);
  // The pull request is at the commit acc landed. One pushed to it since, such as by GitHub's Update branch,
  // is a person's to bring in: merging here would leave a branch that can't push, and waiting for GitHub
  // to come back to the landed commit would hold the queue for good.
  const remote = git('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`).stdout.trim();
  if (remote !== head) {
    const more = !remote || git('merge-base', '--is-ancestor', remote, head).code !== 0;
    throw new AccError('queue', more
      ? `origin's ${branch} has commits this clone's branch doesn't, perhaps pushed on GitHub, such as with Update branch. Bring them into ${short(head)} by hand, and autopilot reviews it again.`
      : `origin's ${branch} is at ${short(remote)}, behind ${short(head)}, the commit acc landed. Land it again.`);
  }
  const behind = git('merge-base', '--is-ancestor', `refs/remotes/origin/${env.branch}`, head).code !== 0;

  // Its worktree, asked for only when there's something to do in it.
  let place: MergePlace | null = null;
  const placed = (): MergePlace => {
    place ??= mergePlace(paths, config, task, run);
    if (place.from !== head) throw new AccError('queue', `${place.wt} is at ${short(place.from)}, not ${short(head)}.`);
    return place;
  };
  const found = (f: Found) => sendBackFromQueue(paths, config, task, deps, who, f, env.branch, head);

  let made: { sha: string; resolved: string[] } | null = null;
  if (behind) {
    const p = placed();
    phase('refreshing');
    try {
      made = mergeBaseIn(config, p, run);
    } catch (e) {
      if (e instanceof MergeConflict) return found({ kind: 'conflict', conflicts: e.files });
      throw e;
    }
  }
  const sha = made?.sha ?? head;

  // The full check, once: whatever already passed on this commit isn't run again.
  const missing = requiredGates(config, env.branch, 'merge').filter((g) => !satisfies(readReceipt(paths, sha, g)));
  if (missing.length) {
    const p = placed();
    phase('checking');
    try {
      checkCommit(paths, config, p, sha, missing, { run, now, slots: { ...deps.slots, onTake: () => phase('checking') }, onWait: () => phase('slot') });
    } catch (e) {
      if (e instanceof CheckFailure) return found({ kind: 'check', failed: e.failed, merge: made?.sha ?? null });
      throw e;
    }
  }

  if (made) {
    // Pushed to the same pull request. It carries the review of the commit it was made on: no reviewer reads
    // a clean merge again (a person decided), and the full check passed on it.
    const p = place!;
    const kept = made.resolved.length ? `, keeping both sides' additions to ${made.resolved.join(', ')}` : '';
    mutate(paths, now, (l, emit) => {
      const t = l.tasks.find((x) => x.id === id);
      if (!t) return;
      const was = t.autopilot?.carried;
      const from = was?.to === head ? was.from : head;
      const at = now().toISOString();
      t.autopilot = { failed: null, ...t.autopilot, carried: { from, to: made!.sha, base: env.branch, resolved: made!.resolved, at } };
      t.updatedAt = at;
      emit({ type: 'task.updated', task: id, actor: who.actor, by: who.by, data: { refreshed: { base: env.branch, from: head, to: made!.sha, resolved: made!.resolved, queue: true } } });
    });
    let landed;
    try {
      landed = land(paths, config, id, { run, now, env: deps.env }, { actor: who.actor, by: who.by, gates: 'merge' });
    } catch (e) {
      // Not on GitHub: the branch goes back, as it was. On GitHub, it stays, for a person to look at.
      const pushed = git('rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`).stdout.trim() === made.sha;
      const back = pushed ? `${short(made.sha)} is on GitHub, but its pull request may not say so.` : undoMerge(config, p, run);
      throw new AccError((e as AccError).code ?? 'queue', `Merged ${env.branch} in as ${short(made.sha)} and its full check passed, but it wasn't landed: ${(e as Error).message} ${back}`);
    }
    phase('github');
    return {
      step: 'queue', outcome: 'done',
      reason: `Merged ${env.branch} into ${short(head)} as ${short(made.sha)}${kept}, and its full check passed. Pushed it to pull request #${landed.pr.number}: it merges once GitHub's checks pass.`,
      pr: { number: landed.pr.number, url: landed.pr.url, opened: landed.opened },
      ...(landed.update ? { update: landed.update } : {}),
    };
  }

  // Up to date with its base and checked in full: merged now, as GitHub allows.
  phase('merging');
  try {
    const r = mergePr(paths, config, id, { run, now, env: deps.env }, who);
    return { step: 'merge', outcome: 'done', reason: r.reason, pr: { number: r.pr.number, url: r.pr.url, opened: false } };
  } catch (e) {
    if ((e as AccError).code === 'merge-waits') {
      // What it waits on: GitHub's checks, or anything else in that wait's own words.
      const why = (e as Error).message;
      if ((e as { checks?: true }).checks) phase('github');
      else phase('held', why);
      return { step: 'queue', outcome: 'waiting', reason: why };
    }
    throw asMerge(e);
  }
}

// ---------------------------------------------------------------- leaving it for its builder

type Found = { kind: 'conflict'; conflicts: string[] } | { kind: 'check'; failed: GateResult[]; merge: string | null };

/** The end of a check's log on this machine, or null when it can't be read. */
function tailOfFile(file: string | null): string | null {
  if (!file) return null;
  try {
    return tailText(readFileSync(file, 'utf8')) || null;
  } catch {
    return null;
  }
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Sends the head back to its builder with what the queue found, kept for its packet at
 * `<state>/queue/<task>-<sha>.json`, as the orchestrator, review → rework (D-076). It shares D-076's limits:
 * once a commit, and 3 times a task with GitHub's checks. Past them, where a check that failed was waived
 * on its own commit (D-031), or where one needs a person (GH-100), it's an AccError, so the task needs you.
 */
function sendBackFromQueue(paths: RepoPaths, config: Config, task: Task, deps: QueueDeps, who: Who, f: Found, base: string, head: string): QueueTurn {
  const pr = task.pr!;
  // A check that ran no tests, or skipped more than before, is a person's call, not its builder's (GH-100).
  const held = f.kind === 'check' ? f.failed.filter((r) => r.status === 'hold') : [];
  if (held.length) {
    throw new AccError('queue', `The full check${f.kind === 'check' && f.merge ? ` with ${base} merged in` : ''} needs a person: ${held.map((r) => `${r.gate}: ${r.summary.replace(/[.!?]$/, '')}`).join('; ')}. A person decides: waive it on ${short(head)}, with a reason, or ask its builder for changes.`);
  }
  const names = f.kind === 'check' ? f.failed.map((r) => r.gate) : [];
  const why = f.kind === 'conflict'
    ? `merging ${base} in conflicts in ${f.conflicts.join(', ')}`
    : `the full check failed${f.merge ? ` with ${base} merged in` : ''}: ${names.join(', ')}`;
  // A waiver holds for its own commit only (D-031): the person who waived it decides.
  const waived = f.kind === 'check' ? names.filter((g) => readReceipt(paths, head, g)?.waived) : [];
  if (waived.length) throw new AccError('queue', `${cap(why)}. ${waived.join(', ')} ${waived.length === 1 ? 'was' : 'were'} waived on ${short(head)}, and a waiver holds for its own commit only: a person decides.`);
  if (sentBackAt(task, head)) throw new AccError('queue', `${cap(why)}. Autopilot already sent ${short(head)} back once: a person decides.`);
  if (sendBacks(task) >= SEND_BACKS) throw new AccError('queue', `${cap(why)}. Autopilot sent ${task.id} back to its builder ${SEND_BACKS} times already: a person decides.`);

  const at = deps.now().toISOString();
  const checks: QueueCheck[] = f.kind === 'check' ? f.failed.map((r) => ({ gate: r.gate, status: r.status, summary: r.summary, file: r.receipt.log, log: tailOfFile(r.receipt.log) })) : [];
  const conflicts = f.kind === 'conflict' ? f.conflicts : [];
  const report: QueueReport = { v: 1, task: task.id, sha: head, base, pr: { number: pr.number, url: pr.url }, kind: f.kind, conflicts, checks, merge: f.kind === 'check' ? f.merge : null, at };
  mkdirSync(paths.queue, { recursive: true });
  writeFileSync(queueReportPath(paths, task.id, head), JSON.stringify(report, null, 2) + '\n');

  const reason = `The merge queue sent it back: ${why}.`;
  mutate(paths, deps.now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === task.id);
    if (!t) throw new AccError('no-task', `No task ${task.id}.`);
    if (!inQueue(t, config)) throw new AccError('merge-waits', `${task.id} left the merge queue meanwhile.`);
    const req = { to: 'rework' as const, actor: who.actor, by: who.by, reason };
    const problems = checkMove(l, config, t, req, noGateHooks);
    if (problems.length) throw new AccError('move-refused', `Can't send ${task.id} back:\n- ${problems.join('\n- ')}`);
    // What it was for goes with the move, so it's never read back from its words (D-076).
    applyMove(t, req, emit, deps.now, { kind: 'queue', checks: names, conflicts, sha: head });
    const sentBack = { sha: head, checks: names, at, kind: 'queue' as const, ...(conflicts.length ? { conflicts } : {}) };
    t.autopilot = { failed: null, ...t.autopilot, sentBack };
    emit({ type: 'task.updated', task: task.id, actor: who.actor, by: who.by, data: { autopilot: { sentBack } } });
  });
  return { step: 'queue', outcome: 'done', reason: `Sent it back to its builder: ${why}.` };
}
