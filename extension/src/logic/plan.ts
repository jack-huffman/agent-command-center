/**
 * A task's plan as the Command Center shows it (T-97): which of its questions are yours, how many choices
 * are left to make, and why Build it is off. Like the rest of logic/, no `vscode` import.
 */

import { askOf } from '../../../packages/core/src/plan.ts';
import { type AnalysisAsk, questionsWord, taskNames, type TaskRow } from './shared.ts';

/** The questions only you can answer: one for the ticket's author waits on nobody here. */
export const forYou = (open: readonly AnalysisAsk[]): AnalysisAsk[] => open.filter((q) => askOf(q) === 'you');

/** "1 choice", "2 choices". */
export const choicesWord = (n: number): string => `${n} choice${n === 1 ? '' : 's'}`;

/**
 * acc's arguments for a person's choice (D-012): an option by its id, or their own words, given with = so
 * words that start with - stay words.
 */
export const planChooseArgs = (task: string, decision: string, pick: { option?: string; text?: string }): string[] =>
  ['plan', 'choose', task, decision, ...(pick.text !== undefined ? [`--text=${pick.text}`] : [pick.option ?? '']), '--json'];

/** acc's arguments for a person's approval of the plan's latest version. */
export const planApproveArgs = (task: string): string[] => ['plan', 'approve', task, '--json'];

/** "a", "a and b", "a, b and c". */
const inWords = (parts: string[]): string => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? ''));

/**
 * Why Build it is off for a task to do, or null when it can be built. Where the project wants a plan, it
 * waits for every question for you, every choice, and an approval of the latest version; `lapsed` says why
 * an earlier approval no longer holds. Where none is wanted, only what else holds a build does.
 */
export function buildOff(row: Pick<TaskRow, 'state' | 'analysis' | 'analyzing' | 'analysisRequired' | 'deps'>, lapsed: string | null = null): string | null {
  if (row.state !== 'todo' && row.state !== 'rework') return 'It isn\'t waiting to be built.';
  if (row.state === 'rework') return null;
  if (row.deps?.length) return `It waits for ${taskNames(row.deps)}.`;
  if (row.analyzing) return 'Its plan is being made.';
  if (!row.analysisRequired) return null;
  const a = row.analysis;
  if (!a) return 'Make a plan first: this project wants one before a build.';
  if (a.verdict === 'split') return 'Its plan says it\'s too big for one task: split it first.';
  const asks = forYou(a.open).length;
  const parts = [asks ? `answer ${questionsWord(asks)} for you` : '', a.choices ? `make ${choicesWord(a.choices)}` : '', a.approved ? '' : lapsed ? 'approve this plan again' : 'approve this plan'].filter(Boolean);
  if (!parts.length) return null;
  return `${lapsed && !a.approved ? `Plan ${lapsed}. ` : ''}First ${inWords(parts)}.`;
}
