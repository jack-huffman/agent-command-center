/**
 * The wording check on a plan (T-151): the planning agent's requirements and its questions pass the Simplified
 * Technical English check (T-12, ste.ts) before acc records the plan, as a drafted acceptance criterion (D-179)
 * and an agent's note (D-230) do. The requirements are checked by `requirementWording`, line by line, as a plan
 * always was; a question is checked by `noteWording`, as a line a person reads, since a person can send it to the
 * client as a draft. Only hard findings count. A plan whose requirements have one can't be approved: a person
 * makes a new plan, whose planning agent is given each finding and its fix.
 *
 * Pure: analyze, the approval, the CLI and the Command Center call it, and node:test.
 */

import type { Analysis } from './analyze.ts';
import { findingLine, noteWording, type NoteWordingFinding } from './note-wording.ts';
import { requirementWording, type WordingFinding, wordingPlace } from './ste.ts';
import { plural } from './text.ts';

/** A requirement's finding as a line of a note: where it is ("Criterion 2") and what the check said. */
export const requirementLine = (f: WordingFinding): NoteWordingFinding =>
  ({ where: wordingPlace(f), text: f.text, rule: f.rule, match: f.match, message: f.message });

/** A question's place, as a person reads it: "Question q2". */
export const questionPlace = (id: string): string => `Question ${id}`;

/** The hard findings on a plan's requirements, then on each of its questions, each with where it is. */
export function planWording(a: Pick<Analysis, 'requirements' | 'questions'>): NoteWordingFinding[] {
  return [
    ...requirementWording(a.requirements).map(requirementLine),
    ...noteWording(a.questions.map((q) => ({ where: questionPlace(q.id), text: q.question }))),
  ];
}

/** What the planning agent is told when its plan's words fail the check: each finding, to fix and answer again. */
export function planFixPrompt(findings: readonly NoteWordingFinding[]): string {
  return [
    'acc checked the wording of your requirements and questions, and it fails the Simplified Technical English check. Fix each finding, keep what each line says, and answer again with the whole analysis.',
    '',
    ...findings.map(findingLine),
  ].join('\n');
}

/** What acc says when a plan still fails after the planning agent's fixes: that it recorded no plan, then each finding. */
export function planWordingWords(findings: readonly NoteWordingFinding[], tries: number): string {
  return [
    `The plan's wording still fails the Simplified Technical English check after ${plural(tries, 'fix', 'fixes')} (${plural(findings.length, 'finding')}), so acc recorded no plan. Make a new plan:`,
    ...findings.map(findingLine),
  ].join('\n');
}

/** Why a person can't approve a plan for its wording, or null: its requirements' hard findings, each with its fix. */
export function approveWording(a: Pick<Analysis, 'requirements'>, id: string): string | null {
  const found = requirementWording(a.requirements).map(requirementLine);
  if (!found.length) return null;
  return [
    `${id}'s requirements fail the Simplified Technical English check (${plural(found.length, 'finding')}), so the plan can't be approved. Make a new plan with acc analyze ${id}:`,
    ...found.map(findingLine),
  ].join('\n');
}
