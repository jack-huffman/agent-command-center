/**
 * The warning above a tracker's board for tickets that left where its tickets come from after work on them
 * started (D-072), in plain words (T-42). acc's note for each reads "ACME-18 left this repo's place: it isn't
 * in epic ACME-3; ACME-18 is still blocked": a word for the code. The person reads which tickets, and out
 * of what, in the tracker's own word: epic, labels, area path or group.
 *
 * Like the rest of logic/, no `vscode` import.
 */

/** The tracker's own word for each kind of narrowing, as `placeText` writes it in a place. */
const SEGMENT = /^(epic|labels?|area|group) (.+)$/;

/**
 * What the board's tickets were narrowed to, from its place ("Jira · ACME · epic ACME-3 Premium Support"):
 * "epic ACME-3". An epic's own name is dropped, since its key says which. Null when the place narrows
 * nothing, such as a whole repo or project.
 */
export function narrowedTo(place: string | null): string | null {
  const last = place?.split(' · ').slice(1).pop();
  const m = last ? SEGMENT.exec(last) : null;
  if (!m) return null;
  if (m[1] === 'epic') return `epic ${m[2]!.split(' ')[0]}`;
  return m[1] === 'area' ? `area path ${m[2]}` : last!;
}

/** The ticket a note is about: its first word, as acc writes "ACME-18 left ...". */
export const noteKey = (note: string): string => /^(\S+) left /.exec(note)?.[1] ?? note;

/** "Moved out of epic ACME-3 after work started: ACME-18." None when nothing left. */
export function movedOut(place: string | null, left: string[]): string | null {
  if (!left.length) return null;
  return `Moved out of ${narrowedTo(place) ?? 'this board\'s tickets'} after work started: ${left.map(noteKey).join(', ')}.`;
}
