/**
 * Review plan (T-109): a plan's choices and questions as steps, one at a time, as the sheet over a task's page
 * walks them. Questions for you come first, then the choices, then the questions for the ticket's author; each
 * in the plan's order. Each step says whether it's done, so the short plan section can say what's left. Plain
 * data, and no vscode import, so it's testable.
 */

import type { Analysis, PlanDecision, PlanOption } from '../../../packages/core/src/analyze.ts';
import { askOf, choiceName } from '../../../packages/core/src/plan.ts';
import { requirementWording } from '../../../packages/core/src/ste.ts';
import { OPTIONS_MAX } from '../../../packages/core/src/talk-questions.ts';
import { plural } from '../../../packages/core/src/text.ts';
import { questionsWord, type TaskRow } from '../logic/shared.ts';
import { choicesWord } from '../logic/plan.ts';
import type { TicketAnalysis } from './task-page.ts';

/** An option as a step shows it: its name and one line, and, under More about this option, the rest. */
export interface ReviewOption extends PlanOption {
  recommended: boolean;
}

/** One design choice to make: its options with the recommended one first, and what's chosen now. */
export interface ReviewChoice {
  kind: 'choice';
  id: string;
  title: string;
  why: string;
  options: ReviewOption[];
  /** Why the recommended option, as the analyst says it. */
  because: string;
  /** The option's id, or null for the person's own words in `name`. Null when nothing is chosen. */
  chosen: { option: string | null; name: string } | null;
}

/** One question: for you, or for the ticket's author, who can be asked on the ticket. */
export interface ReviewQuestion {
  kind: 'question';
  id: string;
  title: string;
  why: string;
  suggested: string;
  /** Its answer, once it has one. */
  answer: string | null;
  author: boolean;
  /** Sent to the client as a draft update, or posted (D-066). */
  client: 'drafted' | 'posted' | null;
}

/** A step, and whether it's done: chosen or answered, or, for the ticket's author, asked on the ticket. */
export type ReviewStep = (ReviewChoice | ReviewQuestion) & { done: boolean };

export interface PlanReview {
  /** The sheet's title, "Review plan v2". */
  title: string;
  steps: ReviewStep[];
  /** What's left, in words: "1 choice and 2 questions to review", "Approved v2", "2 wording findings to fix", or "Ready to approve". */
  left: string;
  /** Whether "Ask on the ticket" can draft a question for the author: its task has a ticket to post on (D-066). */
  canAsk: boolean;
}

/** A step is done once it's chosen or answered, or, for the ticket's author, asked on the ticket. */
export const stepDone = (s: ReviewChoice | ReviewQuestion): boolean => (s.kind === 'choice' ? !!s.chosen : s.answer !== null || (s.author && s.client !== null));

/**
 * A choice's options as the step offers them (D-205): the recommended first, at most OPTIONS_MAX; the one chosen
 * now keeps its place when it would fall past the cap. Something else… follows them on the page.
 */
function offered(d: PlanDecision): ReviewOption[] {
  const rest = d.options.filter((o) => o.id !== d.recommended);
  const all = [...d.options.filter((o) => o.id === d.recommended), ...rest];
  const kept = all.slice(0, OPTIONS_MAX);
  const chosen = d.choice ? all.find((o) => o.id === d.choice!.option) : undefined;
  if (chosen && !kept.includes(chosen)) kept[OPTIONS_MAX - 1] = chosen;
  return kept.map((o) => ({ ...o, recommended: o.id === d.recommended }));
}

/** Questions for you, then the choices, then the questions for the ticket's author. */
export function reviewSteps(a: Analysis, open: TicketAnalysis['open']): ReviewStep[] {
  const client = new Map(open.map((q) => [q.id, q.client ?? null]));
  const questions = a.questions.map((q): ReviewQuestion => ({
    kind: 'question', id: q.id, title: q.question, why: q.why, suggested: q.suggested, answer: q.answer?.text ?? null, author: askOf(q) === 'author', client: client.get(q.id) ?? null,
  }));
  const choices = (a.decisions ?? []).map((d): ReviewChoice => {
    const rec = d.options.filter((o) => o.id === d.recommended);
    return {
      kind: 'choice', id: d.id, title: d.title, why: d.why, because: d.because,
      options: offered(d),
      chosen: d.choice ? { option: d.choice.option, name: choiceName(d) } : null,
    };
  });
  return [...questions.filter((q) => !q.author), ...choices, ...questions.filter((q) => q.author)].map((s) => ({ ...s, done: stepDone(s) }));
}

/** "2 wording findings": what holds a plan whose questions and choices are done (T-151). */
const wordingFindings = (n: number): string => plural(n, 'wording finding');

/** "a", "a and b": what's left, as the short plan section says it. */
function leftWords(steps: ReviewStep[]): string | null {
  const todo = steps.filter((s) => !s.done);
  const choices = todo.filter((s) => s.kind === 'choice').length;
  const questions = todo.length - choices;
  const parts = [choices ? choicesWord(choices) : '', questions ? questionsWord(questions) : ''].filter(Boolean);
  return parts.length ? `${parts.join(' and ')} to review` : null;
}

/**
 * The review of a task's plan, or null where there's nothing to review: no plan, a plan that says to split
 * the task, or a task past the point of choosing (its build started).
 */
export function planReview(row: Pick<TaskRow, 'state'>, a: Analysis | null, open: TicketAnalysis['open'], version: number, canAsk: boolean): PlanReview | null {
  if (!a || a.verdict === 'split' || row.state !== 'todo') return null;
  const steps = reviewSteps(a, open);
  if (!steps.length) return null;
  // A plan whose requirements fail the wording check isn't ready to approve (T-151): it says what holds it.
  const wording = requirementWording(a.requirements).length;
  const left = leftWords(steps) ?? (a.approval ? `Approved v${version}` : wording ? `${wordingFindings(wording)} to fix` : 'Ready to approve');
  return { title: `Review plan v${version}`, steps, left, canAsk };
}
