/**
 * The warning above a tracker's board for tickets that left where its tickets come from after work on them
 * started (D-072), in plain words (T-42). acc's note for each reads "ACME-18 left this repo's place: it isn't
 * in epic ACME-3; ACME-18 is still blocked": a word for the code. The person reads which tickets, and out
 * of what, in the tracker's own word: epic, labels, area path, group or sprint.
 *
 * Like the rest of logic/, no `vscode` import.
 */

/** The tracker's own word for each kind of narrowing, as `placeText` writes it in a place. */
const SEGMENT = /^(epic|labels?|area|group|sprint) (.+)$/;

/** One narrowing part of a place in a person's words, or null for one that names the project, board or team. */
function narrowing(part: string, jira: boolean): string | null {
  // A Jira sprint (T-78), as sprintPlace writes it: the active one, whichever it is now, or one by name.
  if (jira && (part === 'the active sprint' || part === 'no active sprint' || /^active sprints? /.test(part))) return 'the active sprint';
  const m = SEGMENT.exec(part);
  if (!m || (m[1] === 'sprint' && !jira)) return null;
  if (m[1] === 'epic') return `epic ${m[2]!.split(' ')[0]}`;
  // Its dates are dropped, since its name says which.
  if (m[1] === 'sprint') return `sprint ${m[2]!.replace(/ \([^)]*\)/g, '')}`;
  return m[1] === 'area' ? `area path ${m[2]}` : part;
}

/**
 * What the board's tickets were narrowed to, from its place ("Jira · ACME · epic ACME-3 Premium Support"):
 * "epic ACME-3". An epic's own name is dropped, since its key says which. A Jira epic in a sprint is
 * either: "epic ACME-3 or the active sprint". Null when the place narrows nothing, such as a whole repo or project.
 */
export function narrowedTo(place: string | null): string | null {
  const all = place?.split(' · ') ?? [];
  // Only Jira narrows twice, by an epic and a sprint; elsewhere the last part is the narrowing one.
  const jira = all[0] === 'Jira';
  const parts = (jira ? all.slice(2) : all.slice(1).slice(-1)).map((p) => narrowing(p, jira)).filter((p): p is string => !!p);
  return parts.length ? parts.join(' or ') : null;
}

/** The ticket a note is about: its first word, as acc writes "ACME-18 left ...". */
export const noteKey = (note: string): string => /^(\S+) left /.exec(note)?.[1] ?? note;

/** "Moved out of epic ACME-3 after work started: ACME-18." None when nothing left. */
export function movedOut(place: string | null, left: string[]): string | null {
  if (!left.length) return null;
  return `Moved out of ${narrowedTo(place) ?? 'this board\'s tickets'} after work started: ${left.map(noteKey).join(', ')}.`;
}
