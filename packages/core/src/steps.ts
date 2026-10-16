/**
 * acc's step channel (T-65): a long command (a deploy, a promotion, a dispatch, a land, an analysis, one of
 * Setup's fixes) says each step it takes, as a person would name it, so the Command Center can show the run
 * as a list of steps. When ACC_STEPS names a file, each step event is one JSON line in it, and the last line
 * is the result. Without ACC_STEPS nothing is written, and what acc prints never changes either way.
 */
import { renameSync, writeFileSync } from 'node:fs';

/** The variable that names the steps file. */
export const STEPS_VAR = 'ACC_STEPS';

export const STEP_STATES = ['started', 'done', 'skipped', 'failed'] as const;
export type StepState = (typeof STEP_STATES)[number];

/** A step's event: its id, its label in process words, its state, and a short note. Or the run's result: ok or not, in one sentence. */
export type StepEvent =
  | { kind: 'step'; id: string; label: string; state: StepState; note?: string; at: string }
  | { kind: 'result'; ok: boolean; sentence: string; at: string };

/** The longest note a step keeps: a sentence, not a log. */
export const NOTE_MAX = 300;

export interface Steps {
  /** Whether anything listens: false without ACC_STEPS. */
  readonly on: boolean;
  start(id: string, label: string, note?: string): void;
  done(id: string, note?: string): void;
  /** A step that doesn't apply this time, such as a check with no org to check against. */
  skip(id: string, label: string, note?: string): void;
  fail(id: string, note: string): void;
  /** The run's result, the last event: a step still open is done with it, or failed with its sentence. */
  result(ok: boolean, sentence: string): void;
  /** A step around fn: started, then done, or failed with what fn threw, which is thrown on. */
  step<T>(id: string, label: string, fn: () => T): T;
  /** Whether a step has been written, so a command that reported none writes no result either. Never, without a file. */
  readonly used: boolean;
  /** Whether the result has been written. */
  readonly ended: boolean;
}

const cut = (s: string): string => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > NOTE_MAX ? `${one.slice(0, NOTE_MAX - 1)}…` : one;
};

/**
 * The steps of one run of acc, written to `file` (null: written nowhere). The file is written whole for
 * each event, to a temp file beside it then renamed into place, so a reader never sees half a line. A
 * write that fails is dropped: a step channel never stops the work it reports on.
 */
export function stepsTo(file: string | null, now: () => Date = () => new Date()): Steps {
  const lines: string[] = [];
  const labels = new Map<string, string>();
  const open = new Set<string>();
  let used = false;
  let ended = false;
  const write = (e: StepEvent) => {
    if (ended || !file) return;
    if (e.kind === 'result') ended = true;
    else used = true;
    lines.push(JSON.stringify(e));
    try {
      writeFileSync(`${file}.tmp`, `${lines.join('\n')}\n`);
      renameSync(`${file}.tmp`, file);
    } catch {
      // A folder that's gone or can't be written: the work goes on, unreported.
    }
  };
  const at = () => now().toISOString();
  const event = (id: string, state: StepState, note?: string) => {
    if (state === 'started') open.add(id);
    else open.delete(id);
    write({ kind: 'step', id, label: labels.get(id) ?? id, state, ...(note?.trim() ? { note: cut(note) } : {}), at: at() });
  };
  const steps: Steps = {
    get on() { return file !== null; },
    get used() { return used; },
    get ended() { return ended; },
    start(id, label, note) { labels.set(id, label); event(id, 'started', note); },
    done(id, note) { event(id, 'done', note); },
    skip(id, label, note) { labels.set(id, label); event(id, 'skipped', note); },
    fail(id, note) { event(id, 'failed', note); },
    result(ok, sentence) {
      if (ended) return;
      for (const id of [...open]) event(id, ok ? 'done' : 'failed', ok ? undefined : sentence);
      write({ kind: 'result', ok, sentence: cut(sentence), at: at() });
    },
    step<T>(id: string, label: string, fn: () => T): T {
      steps.start(id, label);
      let out: T;
      try {
        out = fn();
      } catch (e) {
        steps.fail(id, (e as Error)?.message ?? String(e));
        throw e;
      }
      steps.done(id);
      return out;
    },
  };
  return steps;
}

/** The steps of this run, to the file ACC_STEPS names; reported nowhere without it. */
export const stepsFrom = (env: NodeJS.ProcessEnv, now?: () => Date): Steps => stepsTo(env[STEPS_VAR]?.trim() || null, now);

/** Steps reported nowhere: what a command reports to when nothing listens, such as autopilot's own calls. */
export const NO_STEPS: Steps = stepsTo(null);

/** Reads a steps file's events, skipping a line that isn't one. */
export function readStepEvents(text: string): StepEvent[] {
  const out: StepEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as StepEvent;
      if (e?.kind === 'step' && typeof e.id === 'string' && typeof e.label === 'string' && (STEP_STATES as readonly string[]).includes(e.state)) out.push(e);
      else if (e?.kind === 'result' && typeof e.ok === 'boolean' && typeof e.sentence === 'string') out.push(e);
    } catch {
      // half a line from an older writer, or junk: skipped
    }
  }
  return out;
}
