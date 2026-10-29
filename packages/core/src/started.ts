import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from './atomic.ts';
import { CLOUD_QUIET_MINUTES } from './config.ts';
import { runStartedAt, STOPPED_GRACE_MS, type Task } from './ledger.ts';
import { sleep } from './lock.ts';
import type { RepoPaths } from './paths.ts';
import { transcriptDir, transcriptFile } from './transcript.ts';
import { thisMachine } from './this-machine.ts';

// Whether a local builder started, and what acc says when it can't see one at all (T-92, D-186). acc never
// shows a builder as working when nothing runs: "can't tell" is a state of its own, never "fine".

/** Why a dispatch didn't leave its task Running: its session never showed a process or wrote a conversation. */
export const NOT_STARTED = 'Its builder didn\'t start: Claude Code\'s background sessions aren\'t answering';

/** The way on from a builder that didn't start, or one acc can't see that has gone quiet. */
export const DISPATCH_AGAIN = 'Build it again';

/** How long a dispatch waits for its builder to show it started, at most. */
export const START_WAIT_MS = 60_000;

/** A session as findSession finds it. */
export interface FoundSession {
  bgId: string | null;
  sessionId: string | null;
  pid: number | null;
}

/**
 * The latest time, in ms, the builder's conversation was written: its session's own file where its id is
 * known, else the newest under the worktree's folder in Claude Code's projects written since `since`.
 * Null when there's none: nothing was ever saved for it.
 */
export function transcriptWrittenAt(projectsDir: string, o: { worktree: string; sessionId?: string | null; since: number }): number | null {
  const times: number[] = [];
  const own = o.sessionId ? transcriptFile(projectsDir, o.sessionId, [o.worktree]) : null;
  if (own) {
    try {
      times.push(statSync(own).mtimeMs);
    } catch {
      // gone since it was found
    }
  }
  const dir = transcriptDir(projectsDir, o.worktree);
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    // no conversation saved for the worktree
  }
  for (const f of files) {
    try {
      const t = statSync(join(dir, f)).mtimeMs;
      if (t >= o.since) times.push(t);
    } catch {
      // gone since it was listed
    }
  }
  return times.length ? Math.max(...times) : null;
}

/**
 * Whether the builder started (T-92): its session listed with a process, or its conversation written.
 * Asked again within `waitMs`, a second apart; a look that finds nothing keeps the ids found before. A
 * `waitMs` of 0 judges what is there now.
 */
export function awaitStart(first: FoundSession, look: () => FoundSession, written: () => boolean, waitMs: number): FoundSession & { started: boolean } {
  const until = Date.now() + waitMs;
  let found = first;
  for (;;) {
    if (found.pid || written()) return { ...found, started: true };
    if (Date.now() >= until) return { ...found, started: false };
    sleep(1_000);
    const again = look();
    if (again.bgId || again.pid) found = again;
  }
}

/** Why acc can't see a running task's builder, where `claude agents` doesn't answer: and, worse, its conversation has gone quiet too. */
export type Silent = 'unanswered' | 'quiet';

/** The same, or that there is no `claude` to ask (T-93): then nothing is silent, and nothing a person can click starts it. */
export type Unseen = Silent | 'missing';

/** How long a builder may write nothing before it counts as quiet: the cloud's quiet setting, the only one acc has (GH-69). */
export const quietMs = (config: { agents?: { cloud?: { quietMinutes?: number } | null } | null } | null | undefined): number =>
  (config?.agents?.cloud?.quietMinutes ?? CLOUD_QUIET_MINUTES) * 60_000;

/**
 * Whether acc can't see a running local task's builder (T-92): `claude agents` hasn't answered since
 * `silentSince` for longer than the grace, and the run is older than the grace. Quiet when its
 * conversation, or its start where none was written, is older than the quiet limit too. Null when
 * `claude agents` answers (builderStopped judges then), for a cloud builder (its branch says, D-140),
 * and while a resume runs.
 */
export function builderUnseen(task: Pick<Task, 'state' | 'run'>, o: { silentSince: number | null; now: Date; resuming: boolean; writtenAt: number | null; quietMs: number; graceMs?: number }): Silent | null {
  if (task.state !== 'running' || o.resuming || o.silentSince === null || task.run?.where === 'cloud') return null;
  const grace = o.graceMs ?? STOPPED_GRACE_MS;
  const now = o.now.getTime();
  const started = runStartedAt(task);
  if (!started || now - o.silentSince <= grace || now - Date.parse(started) <= grace) return null;
  const last = Math.max(o.writtenAt ?? 0, Date.parse(started));
  return now - last > o.quietMs ? 'quiet' : 'unanswered';
}

/** What a person reads for each: a label, the line, and the way on, in process words (D-132): no command is named. */
export const UNSEEN_WORDS: Record<Unseen, { label: string; line: string; wayOn: string }> = {
  unanswered: {
    label: 'Needs you: the Command Center can\'t see its builder',
    line: 'Claude Code\'s background sessions aren\'t answering, so the Command Center can\'t see this builder',
    wayOn: 'Open a terminal and check that Claude Code lists its background agents, or restart Claude Code.',
  },
  quiet: {
    label: 'Needs you: its builder has gone quiet',
    line: 'Claude Code\'s background sessions aren\'t answering, and this builder hasn\'t written to its conversation for longer than the quiet limit',
    wayOn: `${DISPATCH_AGAIN}: it starts a new builder with the same model, effort and place.`,
  },
  missing: {
    label: 'Needs you: Claude Code isn\'t found',
    line: `Claude Code isn't on ${thisMachine()}'s path, so the Command Center can't see this builder`,
    wayOn: 'Install Claude Code, or start VS Code from a terminal where Claude Code runs, then reload the window.',
  },
};

/** Why Build it again can't start a builder with no `claude` (T-93, T-94): the Command Center's words and acc's alike. */
export const MISSING_WORDS = `${UNSEEN_WORDS.missing.line}, and ${DISPATCH_AGAIN} needs it to start another. ${UNSEEN_WORDS.missing.wayOn}`;

/** Where acc keeps since when `claude agents` hasn't answered, so one look after another can tell how long. */
const silenceFile = (paths: Pick<RepoPaths, 'stateDir'>): string => join(paths.stateDir, 'agents-silent.json');

/**
 * Records whether `claude agents` answered just now, and returns since when it hasn't, in ms, or null
 * when it answered. A first silence starts the clock; an answer clears it. Written whole (atomic).
 */
export function noteAnswer(paths: Pick<RepoPaths, 'stateDir'>, answered: boolean, now: Date): number | null {
  const file = silenceFile(paths);
  let since: number | null = null;
  try {
    const v = JSON.parse(readFileSync(file, 'utf8')) as { since?: unknown };
    since = typeof v.since === 'number' ? v.since : null;
  } catch {
    // none yet, or unreadable: a fresh start
  }
  const next = answered ? null : since ?? now.getTime();
  if (next !== since) {
    mkdirSync(paths.stateDir, { recursive: true });
    writeAtomic(file, JSON.stringify({ since: next }) + '\n');
  }
  return next;
}

/** `claude agents` failing because Claude Code's background service is down: its control socket is gone. */
export const SERVICE_DOWN = /control\.sock|cc-daemon/;
