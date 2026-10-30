/**
 * The wording check on a draft update for a client (T-151): the lines of it an agent wrote pass the Simplified
 * Technical English check (T-12, ste.ts) before acc writes the draft, by `noteWording`, as an agent's note does
 * (D-230). They are the reviewer's sentence for the client in a pull request's draft, and a planning agent's
 * question that a person sends. The text acc writes itself around them, such as "The change is ready for
 * review", isn't checked, nor is a field's text, which acc makes from names and values. A person's edit of a
 * draft is never checked: it goes out as they wrote it.
 *
 * Pure: draftUpdate calls it, and node:test.
 */

import { AccError } from './exec.ts';
import { findingLine, type NoteLine, noteWording, type NoteWordingFinding } from './note-wording.ts';
import { plural } from './text.ts';

/** What acc says when an agent's words in a draft fail the check: that it wrote no draft, then each finding with its fix. */
export function draftWordingWords(findings: readonly NoteWordingFinding[]): string {
  return [
    `The agent's words in the draft update don't pass the Simplified Technical English check (${plural(findings.length, 'finding')}), so acc wrote no draft. Write each line again with its fix:`,
    ...findings.map(findingLine),
  ].join('\n');
}

/** Refuses a draft whose agent's words fail the check, with each finding and its fix. A draft that passes goes on. */
export function refuseDraftWording(lines: readonly NoteLine[]): void {
  const found = noteWording(lines);
  if (found.length) throw new AccError('refused', draftWordingWords(found));
}
