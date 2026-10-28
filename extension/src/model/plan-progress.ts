/**
 * The planning agent's progress, where the person waits for it (T-131): in the conversation's panel and the task
 * page's plan section, while a plan is made, a reply comes, or Draft the plan runs. How long it has worked, what
 * it does now, its last few steps, how long since it last moved, and once a project has a few plans, how long they
 * usually take there. With no move for STALL_MS, an orange line says so, with Watch its session, and Stop where
 * this window can stop it. Plain data and the messages' checks: no vscode import.
 */
import type { PlanJobKind, PlanStep } from '../logic/plan-progress.ts';
import { tookWords } from './run-view.ts';
import { KEY, type Look, LOOK, type ModelArea, short } from './shared.ts';

/**
 * How long with no move before the progress says the agent hasn't moved (D-213). Claude Code writes a turn to
 * its transcript once the turn is whole, so the longest quiet spells that are fine are the plan written in one
 * turn, which on a large ticket takes a few minutes, and a Salesforce retrieve; five minutes clears both.
 */
export const STALL_MS = 5 * 60_000;

/** How many earlier steps show under the one it's on: a short list, newest first. */
export const STEPS_SHOWN = 4;

/** The progress's state: working, or not moving for STALL_MS. */
export const PROGRESS_LOOK = {
  working: LOOK('Working', 'sync~spin', 'blue'),
  stalled: LOOK('Not moving', 'warning', 'orange'),
} satisfies Record<string, Look>;

/** One step as the progress shows it: its words, what it acted on as work data, and how long ago it began. */
export interface StepLine {
  icon: string;
  words: string;
  data: string | null;
  ago: string;
}

export interface PlanProgress {
  look: Look;
  /** What it's for: "Making the plan", or "Writing its reply". */
  heading: string;
  /** How long it has worked: "2 min 5 s so far". */
  elapsed: string;
  /** What it does now. */
  now: StepLine;
  /** The steps before it, newest first, at most STEPS_SHOWN. */
  earlier: StepLine[];
  /** How long since it last moved: "Last step 12 s ago"; null before its first step. */
  last: string | null;
  /** "Plans here usually take about 4 minutes", once the project has a few; else null. */
  typical: string | null;
  /** With no move for STALL_MS: what it says, and whether Watch its session and Stop are offered. */
  stalled: { words: string; watch: boolean; stop: boolean } | null;
}

export interface PlanProgressIn {
  job: PlanJobKind;
  /** Reading the ticket before the agent starts, or the agent at work. */
  phase: 'reading' | 'working';
  startedAt: number;
  steps: readonly PlanStep[];
  movedAt: number | null;
  /** Whether its transcript was found: with none, nothing can say it stalled. */
  found: boolean;
  now: number;
  typicalMs: number | null;
  watch: boolean;
  stop: boolean;
}

/** How long plans usually take, in words: "under a minute", "about 1 minute", "about 4 minutes". */
export function typicalWords(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m < 1 ? 'under a minute' : `about ${m} minute${m === 1 ? '' : 's'}`;
}

/** What it does before its first step: the ticket for a plan, the person's message for a reply. */
const FIRST: Record<PlanJobKind, Omit<PlanStep, 'at'>> = {
  plan: { kind: 'ticket', icon: 'book', words: 'Reading the ticket', data: null },
  reply: { kind: 'message', icon: 'comment', words: 'Reading your message', data: null },
};

/** Before the agent starts, the Command Center reads the ticket, its comments too (T-110). */
const READING: Omit<PlanStep, 'at'> = { kind: 'ticket', icon: 'book', words: 'Reading the ticket, its comments too', data: null };

export function planProgress(i: PlanProgressIn): PlanProgress {
  const line = (s: Omit<PlanStep, 'at'>, at: number): StepLine => ({ icon: s.icon, words: s.words, data: s.data, ago: `${tookWords(i.now - at)} ago` });
  const latest = i.steps.at(-1);
  const now = i.phase === 'reading' ? line(READING, i.startedAt) : latest ? line(latest, latest.at) : line(FIRST[i.job], i.startedAt);
  const earlier = i.phase === 'reading' ? [] : i.steps.slice(0, -1).slice(-STEPS_SHOWN).reverse().map((s) => line(s, s.at));
  const quiet = i.now - (i.movedAt ?? i.startedAt);
  const stalled = i.phase === 'working' && i.found && quiet >= STALL_MS;
  return {
    look: stalled ? PROGRESS_LOOK.stalled : PROGRESS_LOOK.working,
    heading: i.job === 'plan' ? 'Making the plan' : 'Writing its reply',
    elapsed: `${tookWords(i.now - i.startedAt)} so far`,
    now, earlier,
    last: i.movedAt === null ? null : `Last step ${tookWords(i.now - i.movedAt)} ago`,
    typical: i.job === 'plan' && i.typicalMs !== null ? `Plans here usually take ${typicalWords(i.typicalMs)}` : null,
    stalled: stalled ? { words: `The planning agent hasn't moved for ${Math.floor(quiet / 60_000)} minutes.`, watch: i.watch, stop: i.stop } : null,
  };
}

export type Message =
  /** Watch its session (T-131): the planning agent's session, on its page. */
  | { type: 'plan-watch'; project: string; task: string }
  /** Stop (T-131): the job this window started, after the person says so. */
  | { type: 'plan-stop'; project: string; task: string };

const forTask = (x: Record<string, unknown>): boolean => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string);

export const area: ModelArea = {
  messages: { 'plan-watch': forTask, 'plan-stop': forTask },
};
