/**
 * The wording check on a task's acceptance criteria (T-148): `acc add`, `acc edit` and the Command Center's
 * task sheet run the Simplified Technical English check (T-12, ste.ts) on each item under a brief's
 * "Acceptance criteria" heading, as acc runs it on a drafted criterion (D-179) and an agent's note (D-230).
 * Each criterion is checked on its own, with its API names in backticks first (codeNames), so a name, a path
 * or a command is code the check leaves alone. A hard finding stops the command before it writes; an advisory
 * one is advice. A ticket from a tracker keeps the client's words: its callers never check one.
 *
 * Pure: the CLI, the ledger's edit and the task sheet call it, and node:test.
 */

import { codeNames } from './agent-notes.ts';
import { AccError } from './exec.ts';
import { type SteLevel, type SteRule, steLint, splitLines, wordingMatch } from './ste.ts';
import { plural } from './text.ts';

/** The heading the criteria sit under, at any level: the same words a drafted criteria section uses (T-81). */
export const CRITERIA_TITLE = 'Acceptance criteria';

/** One acceptance criterion in a brief: its line there, from 1, and its text without its bullet or box. */
export interface BriefCriterion { line: number; text: string }

/** A finding on one criterion: which one, from 1, its line in the brief, and what the check said, which is its fix. */
export interface CriterionFinding {
  criterion: number;
  line: number;
  text: string;
  rule: SteRule;
  level: SteLevel;
  match: string;
  message: string;
}

/** Each rule's name as a person reads it. */
export const STE_RULE_WORDS: Record<SteRule, string> = {
  semicolon: 'Semicolon', 'phrasal-verb': 'Phrasal verb', 'marketing-adjective': 'Marketing word', nominalization: 'Action as a noun',
  'passive-voice': 'Passive voice', 'present-perfect': 'Compound tense', 'long-sentence': 'Long sentence', 'synonym-rotation': 'Two words for one action',
  'dangling-conjunction': 'Ends on and or or',
};

const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/u;
const FENCE = /^ {0,3}(```|~~~)/u;
/** A list item, bullet or numbered, with or without its box: "- [ ] ", "* [x] ", "1. ". */
const ITEM = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/u;

/**
 * The list items under each "Acceptance criteria" heading, until a heading of the same or a higher level. A
 * line indented under an item, which isn't an item itself, belongs to it. Lines in a code fence don't count.
 */
export function briefCriteria(brief: string): BriefCriterion[] {
  const found: BriefCriterion[] = [];
  let level = 0;
  let fence = false;
  let last: BriefCriterion | null = null;
  splitLines(brief).forEach((raw, i) => {
    if (FENCE.test(raw)) {
      fence = !fence;
      last = null;
      return;
    }
    if (fence) return;
    const h = HEADING.exec(raw);
    if (h) {
      const at = h[1]!.length;
      if (h[2]!.trim().toLowerCase() === CRITERIA_TITLE.toLowerCase()) level = at;
      else if (level && at <= level) level = 0;
      last = null;
      return;
    }
    if (!level) return;
    const item = ITEM.exec(raw);
    if (item) {
      last = { line: i + 1, text: item[1]!.trim() };
      if (last.text) found.push(last);
      return;
    }
    // A blank line ends an item's own lines; an indented line goes on with it.
    if (!raw.trim() || !/^\s/.test(raw)) last = null;
    else if (last) last.text = `${last.text} ${raw.trim()}`;
  });
  return found;
}

/**
 * Every finding on each acceptance criterion, hard and advisory. A criterion is checked as a list item, so one
 * that ends on "and" is caught, and on its own, so a synonym in one never counts against another.
 */
export function briefWording(brief: string): CriterionFinding[] {
  return briefCriteria(brief).flatMap(({ line, text }, n) => steLint(`- ${codeNames(text)}`).findings
    .map((f) => ({ criterion: n + 1, line, text, rule: f.rule, level: f.level, match: f.match, message: f.message })));
}

/** A finding as a line a person reads: its line, its criterion, its rule and its fix, and what it matched. */
export const criterionLine = (f: CriterionFinding): string => {
  const m = wordingMatch(f);
  return `- Line ${f.line} (criterion ${f.criterion}), ${f.rule}: ${f.message}${m ? ` [${m}]` : ''}`;
};

/** What acc says when the criteria's wording fails: that it wrote nothing, then each hard finding with its fix. */
export function briefWordingWords(hard: readonly CriterionFinding[], id: string | null): string {
  return [
    `${id ? `${id}'s` : 'The'} acceptance criteria don't pass the Simplified Technical English check (${plural(hard.length, 'finding')}), so acc wrote nothing. Write each criterion again with its fix, then run the command again:`,
    ...hard.map(criterionLine),
  ].join('\n');
}

/** The advice a passing brief still gets: each advisory finding, which doesn't stop the command. Empty for none. */
export const briefAdviceLines = (advice: readonly CriterionFinding[]): string[] => (advice.length
  ? ['Advice on the wording of the acceptance criteria. It doesn\'t stop the command:', ...advice.map(criterionLine)] : []);

/**
 * Refuses a brief whose acceptance criteria have a hard finding, with each finding and its fix. A brief that
 * passes goes on, with its advisory findings, which the caller shows as advice.
 */
export function refuseBriefWording(brief: string, id: string | null = null): CriterionFinding[] {
  const found = briefWording(brief);
  const hard = found.filter((f) => f.level === 'hard');
  if (hard.length) throw new AccError('refused', briefWordingWords(hard, id));
  return found;
}
