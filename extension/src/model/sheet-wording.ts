/**
 * The wording check in the task sheet (T-148): acc add and acc edit refuse a brief whose acceptance criteria
 * fail the Simplified Technical English check, so the sheet shows each finding beside its criterion before
 * Save. The sheet opens with the findings on its description; as the person writes, the page asks again, and
 * the extension answers with the same check acc runs. A tracker's task isn't checked: its ticket keeps the
 * client's words. Plain data, no vscode import, so it's testable.
 */

import { briefCriteria, briefWording, STE_RULE_WORDS } from '../../../packages/core/src/brief-wording.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import { wordingMatch } from '../../../packages/core/src/ste.ts';
import { plural } from '../../../packages/core/src/text.ts';
import { type ModelArea, short } from './shared.ts';

/** The message the page asks with, and the extension answers with. */
export const TASK_SHEET_WORDING = 'task-sheet-wording';

/** One finding on a criterion: hard ones stop Save, advice doesn't. */
export interface SheetFinding {
  hard: boolean;
  /** The rule, in words: "Phrasal verb". */
  rule: string;
  /** The check's message, which is its fix. */
  message: string;
  /** What it matched, or null where that's the whole criterion. */
  match: string | null;
}

/** A criterion with findings: which one, from 1, its line in the description, and its text. */
export interface SheetCriterion { criterion: number; line: number; text: string; findings: SheetFinding[] }

/** The findings on a description's acceptance criteria, for the brief they were found on. */
export interface SheetWording {
  brief: string;
  /** How many criteria it has: none, and the sheet says nothing. */
  checked: number;
  /** How many hard findings, which stop Save. */
  hard: number;
  /** Each criterion with a finding, in order. */
  criteria: SheetCriterion[];
}

/** The sheet checks the wording of a new task, and of acc's own; never a tracker's ticket. */
export const wordingChecked = (t: Pick<Task, 'source'> | null): boolean => !t || t.source.kind === 'manual';

/** The findings on a description's acceptance criteria, each beside its criterion, as the sheet shows them. */
export function sheetWording(brief: string): SheetWording {
  // Lines are counted on the text as the box holds it: blank lines before it are lines too.
  const lead = (/^\s*/.exec(brief)![0].match(/\n/g) ?? []).length;
  const found = briefWording(brief.trim()).map((f) => ({ ...f, line: f.line + lead }));
  const criteria: SheetCriterion[] = [];
  for (const f of found) {
    let c = criteria.at(-1);
    if (c?.criterion !== f.criterion) criteria.push((c = { criterion: f.criterion, line: f.line, text: f.text, findings: [] }));
    c.findings.push({ hard: f.level === 'hard', rule: STE_RULE_WORDS[f.rule], message: f.message, match: wordingMatch(f) });
  }
  return { brief, checked: briefCriteria(brief.trim()).length, hard: found.filter((f) => f.level === 'hard').length, criteria };
}

/** Why Save is off for the wording, or null when it may go: a hard finding on the last check. */
export const wordingOff = (w: Pick<SheetWording, 'hard'> | null | undefined): string | null =>
  (w?.hard ? `Fix the wording of the acceptance criteria first: ${plural(w.hard, 'finding')}` : null);

export type Message =
  /** The sheet's description as it is now, to check its acceptance criteria. */
  | { type: 'task-sheet-wording'; project: string; brief: string };

/** The extension's answer to the page's ask: the findings for the description it sent. */
export const wordingReply = (m: Message): { type: typeof TASK_SHEET_WORDING; project: string; wording: SheetWording } => ({ type: TASK_SHEET_WORDING, project: m.project, wording: sheetWording(m.brief) });

export const area: ModelArea = {
  messages: { 'task-sheet-wording': (x) => short(x.project, 4096) && typeof x.brief === 'string' && x.brief.length <= 65536 },
};
