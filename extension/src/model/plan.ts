/**
 * A task's plan on its page (T-97): each design choice as options to choose from, the version shown and the
 * ones before it, its approval, and Build it, off with the reason while the plan holds it. Plain data, and
 * the messages its controls send. No vscode import, so it's testable.
 */

import type { Analysis, PlanOption } from '../../../packages/core/src/analyze.ts';
import type { SharedShape, SplitTask } from '../../../packages/core/src/shape-first.ts';
import { CHANGE_APPROVED, CHOICE_TEXT_MAX } from '../../../packages/core/src/plan-choices.ts';
import { choiceName, lapsedWords, planVersion, questionsForYou, unchosen } from '../../../packages/core/src/plan.ts';
import { buildOff } from '../logic/plan.ts';
import type { TaskRow } from '../logic/shared.ts';
import { type Action, KEY, type Look, type ModelArea, type Ref, short } from './shared.ts';

/** What a person chose, as the page shows it: the option or their own words, who and when. */
export interface TicketChoice {
  /** The option's id, or null for their own. */
  option: string | null;
  /** The option's name, or their own words. */
  name: string;
  by: string;
  at: string;
}

/** One design choice: its options side by side, the one recommended and why, and what was chosen. */
export interface TicketDecision {
  id: string;
  title: string;
  why: string;
  options: PlanOption[];
  /** The id of the recommended option. */
  recommended: string;
  because: string;
  choice: TicketChoice | null;
}

/** A version before the one shown: when it was made, its approval, what changed in it, and its choices. */
export interface TicketVersion {
  version: number;
  at: string;
  approved: { by: string; at: string } | null;
  summary: string;
  changes: string[];
  choices: { title: string; chosen: string | null }[];
}

/**
 * The shapes the work changes that other tasks build on, and the split the plan suggests for them (T-104):
 * a small first task for the shape and the rest, which waits for it. A person may ignore it.
 */
export interface TicketShapes {
  shapes: SharedShape[];
  split: {
    why: string;
    first: SplitTask;
    rest: SplitTask;
    /** The two tasks a person made from it: the page names them instead of offering the split. */
    made: { first: string; rest: string } | null;
    /** Split into these tasks: null once made, or past the build. */
    go: { disabled: string | null } | null;
  } | null;
}

export interface TicketPlan {
  version: number;
  /** Approved, needing approval again, or not yet: with an icon and words. */
  look: Look;
  approval: { by: string; at: string } | null;
  /** Why an earlier approval no longer holds, such as "v3 is new since v2 was approved". */
  lapsed: string | null;
  /** What changed in this version, since the one before. Empty for the first. */
  changes: string[];
  decisions: TicketDecision[];
  /** Choices are made only before the build. */
  canChoose: boolean;
  /**
   * What the page asks before a choice changes while the plan is approved, as acc says it (CHANGE_APPROVED),
   * with Change it and Keep the approval. Null when it isn't approved, or past the build: a choice goes at once.
   */
  changeAsk: string | null;
  /** Approve this plan: null once approved or past the build, else off with why while it can't be. */
  approve: { disabled: string | null } | null;
  /** Build it, off with why while the plan holds it. Null past the build. */
  build: Action | null;
  /** The versions before, newest first. */
  earlier: TicketVersion[];
  /** The shared shapes and the split suggested for them (T-104). Null when the plan names none. */
  shapes: TicketShapes | null;
  /** The person's notes on the plan (T-98), such as a changed step: who and when. */
  notes: { text: string; by: string; at: string }[];
}

/** Who did it, as the page names them: the person, without acc's "human:". */
export const byName = (by: string): string => by.replace(/^human:/, '');

/** Why Approve this plan is off, or null: questions for you, or choices, still open, or a split. */
export function approveOff(a: Analysis): string | null {
  if (a.verdict === 'split') return 'Its plan says it\'s too big for one task: split it rather than approve it.';
  const asks = questionsForYou(a).length;
  const choices = unchosen(a).length;
  const parts = [asks ? `answer ${asks === 1 ? 'the question' : `the ${asks} questions`} for you` : '', choices ? `make ${choices === 1 ? 'the choice' : `the ${choices} choices`}` : ''].filter(Boolean);
  return parts.length ? `First ${parts.join(' and ')}.` : null;
}

/** The shapes a plan names that other tasks build on, and its shape-first split (T-104); null when it names neither. */
export function ticketShapes(a: Analysis, todo: boolean): TicketShapes | null {
  const shapes = a.sharedShapes ?? [];
  const s = a.shapeSplit;
  if (!shapes.length && !s) return null;
  return { shapes, split: s ? { why: s.why, first: s.first, rest: s.rest, made: s.made ? { first: s.made.first, rest: s.made.rest } : null, go: todo && !s.made ? { disabled: null } : null } : null };
}

/**
 * The plan part of a task's Analysis section, or null with no analysis. Choosing and approving are only
 * before the build; after it, the page shows what was chosen and approved.
 */
export function ticketPlan(row: TaskRow, a: Analysis | null, ref: Ref): TicketPlan | null {
  if (!a) return null;
  const todo = row.state === 'todo';
  const v = planVersion(a);
  const lapsed = lapsedWords(a);
  const look: Look = a.approval ? { label: `Plan v${v} approved`, icon: 'verified-filled', tone: 'blue' }
    : lapsed ? { label: `Approve again: ${lapsed}`, icon: 'history', tone: 'orange' }
      : { label: `Plan v${v}: not approved yet`, icon: 'verified', tone: row.analysisRequired && todo ? 'orange' : 'neutral' };
  const off = todo ? buildOff(row, lapsed) : null;
  return {
    version: v, look, lapsed, changes: a.changes ?? [],
    approval: a.approval ? { by: byName(a.approval.by), at: a.approval.at } : null,
    decisions: (a.decisions ?? []).map((d) => ({
      id: d.id, title: d.title, why: d.why, options: d.options, recommended: d.recommended, because: d.because,
      choice: d.choice ? { option: d.choice.option, name: choiceName(d), by: byName(d.choice.by), at: d.choice.at } : null,
    })),
    canChoose: todo,
    changeAsk: todo && a.approval ? CHANGE_APPROVED : null,
    approve: todo && !a.approval ? { disabled: approveOff(a) } : null,
    build: todo ? { command: 'acc.task.dispatch', label: 'Build it', icon: 'rocket', ref, primary: !off, ...(off ? { disabled: off } : {}) } : null,
    earlier: [...(a.earlier ?? [])].reverse().map((e) => ({
      version: planVersion(e), at: e.at, approved: e.approval ? { by: byName(e.approval.by), at: e.approval.at } : null, summary: e.summary, changes: e.changes ?? [],
      choices: (e.decisions ?? []).map((d) => ({ title: d.title, chosen: d.choice ? choiceName(d) : null })),
    })),
    shapes: ticketShapes(a, todo),
    notes: (a.notes ?? []).map((n) => ({ text: n.text, by: byName(n.by), at: n.at })),
  };
}

export type Message =
  /**
   * A person's choice for one of a plan's design choices (T-97): an option by its id, or their own words. acc
   * records it. `yes`: they said Change it to a change that undoes the plan's approval.
   */
  | { type: 'plan-choose'; project: string; task: string; decision: string; option?: string; text?: string; yes?: true }
  /** A person approves the plan's latest version (T-97). acc records it. */
  | { type: 'plan-approve'; project: string; task: string }
  /** A person's Split into these tasks (T-104): acc makes the first task for the shape and the rest. */
  | { type: 'plan-split'; project: string; task: string };

const forTask = (x: Record<string, unknown>): boolean => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string);

export const area: ModelArea = {
  messages: {
    // One of an option or their own words, never both, never neither; a yes is only ever true.
    'plan-choose': (x) => forTask(x) && typeof x.decision === 'string' && /^d\d{1,3}$/.test(x.decision) && (x.yes === undefined || x.yes === true)
      && (x.option === undefined ? short(x.text, CHOICE_TEXT_MAX) && !!(x.text as string).trim() : x.text === undefined && typeof x.option === 'string' && /^[a-z]$/.test(x.option)),
    'plan-approve': forTask,
    'plan-split': forTask,
  },
};
