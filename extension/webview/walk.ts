// Where the person is in Setup's walkthrough (T-153), worked out from the chapters and the place the tab keeps:
// which screen shows, and where Start, Continue, Next, Back and Skip for now go. Plain functions with no DOM, so
// extension/test/setup-walk.test.ts runs them in Node; setup.ts draws what they say.

import type { Chapter, WalkPlace, WalkStep } from '../src/model/setup-walk.ts';
import type { StepState } from './stepper.ts';

/** The screens that aren't a step's. */
export const WALK_START = 'start';
export const WALK_END = 'end';

/** How long a step that has just passed stays on show, with its Done, before the walk moves on by itself. */
export const PASS_PAUSE_MS = 1200;

/** A step and the chapter it's in. */
export interface Placed { step: WalkStep; chapter: Chapter }

export type WalkScreen =
  | { kind: 'start' }
  /** list: the walk's steps, the dots; index: this one's place in it. */
  | { kind: 'step'; step: WalkStep; chapter: Chapter; list: Placed[]; index: number }
  /** left: the steps still to do, skipped ones among them. */
  | { kind: 'end'; left: Placed[] };

/** Every step, in the order things are set up. */
export const placed = (chapters: Chapter[]): Placed[] => chapters.flatMap((chapter) => chapter.steps.map((step) => ({ step, chapter })));

const todo = (chapters: Chapter[]): Placed[] => placed(chapters).filter((x) => !x.step.done);

/**
 * The walk's steps, for its dots: each still to do, and each it started with that has passed since, so the
 * dots count what's been done. holding: a step just passed, still on show.
 */
export function walkList(chapters: Chapter[], place: WalkPlace, holding: string | null = null): Placed[] {
  return placed(chapters).filter((x) => !x.step.done || place.walk.includes(x.step.id) || x.step.id === holding);
}

/** The first step still to do after `from`, in order, or the end. A step this build doesn't know looks from the start. */
export function after(chapters: Chapter[], from: string): string {
  const all = placed(chapters);
  const i = all.findIndex((x) => x.step.id === from);
  return all.slice(i + 1).find((x) => !x.step.done)?.step.id ?? WALK_END;
}

/** The last step still to do before `from`, or the start screen. */
export function before(chapters: Chapter[], from: string): string {
  const all = placed(chapters);
  const i = from === WALK_END ? all.length : all.findIndex((x) => x.step.id === from);
  return all.slice(0, Math.max(i, 0)).reverse().find((x) => !x.step.done)?.step.id ?? WALK_START;
}

/**
 * The screen on show. A step that's done isn't shown: the walk goes on to the next one still to do, unless it's
 * `holding`, a step that passed while it was on show, which stays a moment with its Done.
 */
export function walkScreen(chapters: Chapter[], place: WalkPlace | null, holding: string | null = null): WalkScreen {
  if (!place || place.at === WALK_START) return { kind: 'start' };
  const all = placed(chapters);
  const at = place.at === WALK_END ? undefined : all.find((x) => x.step.id === place.at);
  const shows = at && (!at.step.done || at.step.id === holding) ? at : undefined;
  const id = shows ? shows.step.id : place.at === WALK_END ? WALK_END : at ? after(chapters, at.step.id) : todo(chapters)[0]?.step.id ?? WALK_END;
  const target = all.find((x) => x.step.id === id);
  if (!target) return { kind: 'end', left: todo(chapters) };
  const list = walkList(chapters, place, holding);
  return { kind: 'step', step: target.step, chapter: target.chapter, list, index: list.findIndex((x) => x.step.id === id) };
}

/** Start: a walk through every step still to do, from the first, or from `at`. */
export function begin(chapters: Chapter[], at?: string): WalkPlace {
  const walk = todo(chapters).map((x) => x.step.id);
  return { at: at ?? walk[0] ?? WALK_END, walk, skipped: [] };
}

/** A step's screen, from its chapter or the output panel: in the walk under way, or a new one. */
export function goTo(chapters: Chapter[], place: WalkPlace | null, id: string): WalkPlace {
  if (!place?.walk.length) return begin(chapters, id);
  return { ...place, at: id, walk: place.walk.includes(id) ? place.walk : [...place.walk, id] };
}

/**
 * Continue: the step on show when the person stopped, while it's still to do; else the next one still to do
 * after it, then the first, skipped ones too; else the end.
 */
export function resume(chapters: Chapter[], place: WalkPlace | null): WalkPlace {
  if (!place?.walk.length) return begin(chapters);
  const at = placed(chapters).find((x) => x.step.id === place.at);
  if (at && !at.step.done) return place;
  const next = at ? after(chapters, at.step.id) : WALK_END;
  return { ...place, at: next !== WALK_END ? next : todo(chapters)[0]?.step.id ?? WALK_END };
}

/** Next: the next step still to do. */
export const next = (chapters: Chapter[], place: WalkPlace, from: string): WalkPlace => ({ ...place, at: after(chapters, from) });

/** Back: the step still to do before this one, or the start screen. */
export const back = (chapters: Chapter[], place: WalkPlace, from: string): WalkPlace => ({ ...place, at: before(chapters, from) });

/** Skip for now: on to the next step, and this one is kept for the end screen. */
export function skip(chapters: Chapter[], place: WalkPlace, id: string): WalkPlace {
  return { ...place, at: after(chapters, id), skipped: place.skipped.includes(id) ? place.skipped : [...place.skipped, id] };
}

/** What the start screen offers: Start before a walk, Continue once one is under way, Check again with nothing left. */
export function startButton(chapters: Chapter[], place: WalkPlace | null): { left: number; button: 'start' | 'continue' | 'check' } {
  const left = todo(chapters).length;
  return { left, button: !left ? 'check' : place?.walk.length ? 'continue' : 'start' };
}

/** Each dot's state: here, done, skipped for now, or still to come. */
export function dotState(x: Placed, place: WalkPlace, current: string): StepState {
  if (x.step.id === current) return 'current';
  if (x.step.done) return 'done';
  return place.skipped.includes(x.step.id) ? 'skipped' : 'todo';
}
