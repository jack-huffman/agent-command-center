/**
 * The wording check on an agent's note to a person (T-149): a blocked note, its question, its draft for the
 * client, a finish note and a review's words pass the Simplified Technical English check (T-12, ste.ts)
 * before acc records them, as a drafted acceptance criterion does (D-179). Each line is checked on its own,
 * with its API names in backticks first (codeNames), so a name, a path or a command is code the check leaves
 * alone. Only hard findings count: advisory ones are often right to keep. A person's own words are never
 * checked: the callers check an agent's note alone.
 *
 * Pure: the CLI and the review call it, and node:test.
 */

import { BULLET, codeNames } from './agent-notes.ts';
import { AccError } from './exec.ts';
import { NOTE_ALL, NOTE_LABELS, type NoteInput } from './ledger.ts';
import type { Answered } from './review.ts';
import { type SteRule, steLint, wordingMatch } from './ste.ts';

/** One line of a note, with where a person reads it: "Headline", "Thing 2", "What landed 1". */
export interface NoteLine { where: string; text: string }

/** A hard wording finding on one line of a note: the line, and what the check said, which is its fix. */
export interface NoteWordingFinding extends NoteLine { rule: SteRule; match: string; message: string }

/** How often acc gives a reviewer its wording findings to write its review again, before it stops. */
export const NOTE_FIX_TRIES = 2;

/**
 * A note's lines as a person reads them: the lines before its bullets are its headline, and each bullet is a
 * thing, counted from 1. A bullet's own lines under it, such as its options, belong to it. `of` names whose
 * note it is, where the command takes more than one.
 */
export function noteLines(text: string, of?: string): NoteLine[] {
  const at = (where: string) => (of ? `${of}, ${where.toLowerCase()}` : where);
  let n = 0;
  return text.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
    if (BULLET.test(l) && !/^\s/.test(l)) n++;
    return { where: n ? at(`Thing ${n}`) : at('Headline'), text: l.trim() };
  });
}

/** A finish note's lines, by its part: "What landed 1", "Still open 2", "How to test it 1" (T-161). */
export const doneLines = (note: NoteInput | null): NoteLine[] =>
  NOTE_ALL.flatMap((k) => (note?.[k] ?? []).map((text, i) => ({ where: `${NOTE_LABELS[k]} ${i + 1}`, text })));

/** A review's words to a person: its summary, its sentence for the client, and each finding. */
export const verdictLines = (v: Pick<Answered, 'summary' | 'client' | 'findings'>): NoteLine[] => [
  { where: 'Summary', text: v.summary },
  ...(v.client ? [{ where: 'For the client', text: v.client }] : []),
  ...v.findings.map((f, i) => ({ where: `Finding ${i + 1}`, text: f.message })),
];

/**
 * The hard findings on each line of a note. A bullet is checked as a list item, so one that ends on "and" is
 * caught. Text in backticks, and each API name acc puts there, is code, which the check leaves alone.
 */
export function noteWording(lines: readonly NoteLine[]): NoteWordingFinding[] {
  return lines.flatMap(({ where, text }) => {
    const coded = codeNames(text);
    // A line that isn't a bullet is checked as one too: each line of a note stands alone.
    const item = BULLET.test(coded.trim()) ? coded.trim() : `- ${coded.trim()}`;
    return steLint(item).findings.filter((f) => f.level === 'hard').map((f) => ({ where, text, rule: f.rule, match: f.match, message: f.message }));
  });
}

/** Each finding as a line the agent reads: where it is, its fix, and what it matched. */
export const findingLine = (f: NoteWordingFinding): string => {
  const m = wordingMatch(f);
  return `- ${f.where}: ${f.message}${m ? ` [${m}]` : ''}`;
};

/** What acc says when a note's wording fails: that it recorded nothing, then each finding with its fix. */
export function noteWordingWords(findings: readonly NoteWordingFinding[]): string {
  return [
    `The note's wording doesn't pass the Simplified Technical English check (${findings.length} finding${findings.length === 1 ? '' : 's'}), so acc recorded nothing. Write the note again with each fix, then run the command again:`,
    ...findings.map(findingLine),
  ].join('\n');
}

/** Refuses an agent's note whose wording fails, with each finding and its fix. A note that passes goes on. */
export function refuseNoteWording(lines: readonly NoteLine[]): void {
  const found = noteWording(lines);
  if (found.length) throw new AccError('refused', noteWordingWords(found));
}

/** What a reviewer is told when its review's words fail the check: each finding, to fix and answer again. */
export function noteFixPrompt(findings: readonly NoteWordingFinding[]): string {
  return [
    'acc checked the wording of your review, and it fails the Simplified Technical English check. Fix each finding, keep your verdict and what each line says, and answer again with the whole review.',
    '',
    ...findings.map(findingLine),
  ].join('\n');
}
