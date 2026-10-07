// Starting a task that waits for others' files, once it may, and stopping it waiting.

import type { Config } from './config.ts';
import { AccError } from './exec.ts';
import { type Actor, checkMove, type FileShare, mutate, noGateHooks, readLedger, type Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { analysisProblems } from './analyze.ts';
import { filesOf, inFlightFiles, sharedFiles, startCandidates, type StartLook, startOrder, taskList, waits } from './overlap.ts';
import { dispatch, type DispatchDeps } from './dispatch.ts';
import { claimHeld, releaseHeld, startingNow } from './holding.ts';

/** Why a held task waits, in words: "Waits for GH-70's files: a.ts, while GH-74 is ready to start". */
export function holdWords(look: StartLook): string {
  return `Waits for ${filesOf(look.shares)}, while ${taskList(look.first)} ${look.first.length === 1 ? 'is' : 'are'} ready to start`;
}

export interface StartHeldResult {
  started: { task: string; worktree: string; bgId: string | null; shares: FileShare[]; waitedFor: string[] }[];
  /** Held tasks that still wait, and why. */
  waiting: { task: string; reason: string; waitsFor: FileShare[]; first: string[] }[];
  /** Held tasks whose start failed: written on each, which then needs a person. */
  failed: { task: string; reason: string }[];
}

/** Codes of a start that couldn't go for now, not a failure: the cap filled, or the ledger was busy, between the look and the start. */
const FOR_NOW = new Set(['move-refused', 'lock-timeout']);

/**
 * Starts the held tasks that may go now (D-093), as `actor`: a person's own Dispatch click, deferred, or
 * autopilot. Free ones first, oldest hold first, then, when nothing else is ready, one that shares files.
 * Each start changes what's in flight, so the rest are weighed again after it. Each is claimed in the
 * ledger before its builder launches, so two windows and autopilot never start one twice. A start that
 * fails is written on the task, and isn't tried again until a person acts.
 */
export function startHeld(paths: RepoPaths, config: Config, deps: DispatchDeps, opts: { actor: Actor; by: string; only?: string }): StartHeldResult {
  const out: StartHeldResult = { started: [], waiting: [], failed: [] };
  const tried = new Set<string>();
  const shared = sharedFiles(config);
  let fetched = false;
  for (;;) {
    const ledger = readLedger(paths.ledger);
    const held = ledger.tasks
      .filter((t) => t.state === 'todo' && t.held && !t.held.failed && !tried.has(t.id) && (!opts.only || t.id === opts.only))
      .sort((a, b) => a.held!.at.localeCompare(b.held!.at));
    if (!held.length) break;
    const flying = inFlightFiles(paths, ledger, deps.run, { fetch: !fetched });
    fetched = true;
    const candidates = startCandidates(paths, config, ledger);
    const looks = held.map((t) => {
      const look = startOrder({ id: t.id, files: candidates.find((c) => c.id === t.id)?.files ?? null }, candidates, flying, shared);
      const problems = [...checkMove(ledger, config, t, { to: 'running', actor: opts.actor, by: opts.by }, noGateHooks), ...analysisProblems(paths, config, t)];
      const claimed = startingNow(t, deps.now());
      return { t, look, problems, claimed };
    });
    const ok = looks.filter((l) => !l.problems.length && !l.claimed);
    const go = ok.find((l) => !l.look.shares.length) ?? ok.find((l) => !waits(l.look));
    if (!go) {
      for (const l of looks) {
        const reason = l.problems[0] ?? (l.claimed ? `${l.claimed.by} is starting it.` : `${holdWords(l.look)}.`);
        out.waiting.push({ task: l.t.id, reason, waitsFor: l.look.shares, first: l.look.first });
      }
      break;
    }
    const id = go.t.id;
    tried.add(id);
    if (!claimHeld(paths, deps.now, id, opts)) continue;
    const waitedFor = go.t.held!.waitsFor.map((w) => w.task);
    try {
      const r = dispatch(paths, config, id, deps, { actor: opts.actor, by: opts.by, fromHold: { shares: go.look.shares } });
      if (r.held) continue;
      out.started.push({ task: id, worktree: r.worktree, bgId: r.bgId, shares: r.shares, waitedFor });
    } catch (e) {
      const reason = (e as Error).message.trim().split('\n').slice(0, 3).join(' ').replace(/\s+/g, ' ');
      if (FOR_NOW.has((e as AccError).code)) {
        releaseHeld(paths, deps.now, id, opts, null);
        out.waiting.push({ task: id, reason, waitsFor: go.look.shares, first: go.look.first });
      } else {
        releaseHeld(paths, deps.now, id, opts, reason);
        out.failed.push({ task: id, reason });
      }
    }
  }
  return out;
}

/** A person stops a held task waiting: it stays to do, and nothing starts it on its own. */
export function stopWaiting(paths: RepoPaths, now: () => Date, id: string, actor: Actor, by: string): Task {
  return mutate(paths, now, (ledger, emit) => {
    const t = ledger.tasks.find((x) => x.id === id);
    if (!t) throw new AccError('no-task', `No task ${id}.`);
    if (!t.held) throw new AccError('not-held', `${id} isn't waiting for anything.`);
    t.held = null;
    t.updatedAt = now().toISOString();
    emit({ type: 'task.updated', task: id, actor, by, data: { held: null } });
    return t;
  });
}
