/**
 * What an agent acc starts is called (D-087): `<project> · <key> <title> · <role>`, such as "Acme Service ·
 * ACME-12 Case escalation rules · builder". The same name is Claude Code's (`--name`), the Command
 * Center's, a notice's and a terminal's. It's recorded where acc starts the agent, and acc finds the
 * agent by its session first, by that record second, and never by a name worked out again.
 */

/** What the agent is: a task's builder, its reviewer, or its analyst. */
export type NameRole = 'builder' | 'review' | 'analysis';

/** The longest a title or a project's name gets in an agent's name, its `…` included. */
export const NAME_PART_MAX = 40;

/** Between the project, the task and the role. Taken out of a title, so it only ever separates. */
export const NAME_SEP = ' · ';

/** Prefixes that start a secret, so a word that starts with one is never shown. */
const SECRET_PREFIX = /^(ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|sk-|xox|AKIA|eyJ)/;

/** A word that looks like a token: a secret's prefix, or 20 characters or more mixing letters and digits. */
export const tokenLike = (word: string): boolean => SECRET_PREFIX.test(word) || (word.length >= 20 && /\p{L}/u.test(word) && /\p{N}/u.test(word));

/**
 * Text that's safe to show anywhere, in a shell or a terminal's title included: letters, digits, spaces
 * and `- _ . , : ( ) + #`. Whitespace, control characters, slashes, `~` and `·` become spaces, so a path
 * falls apart into words; everything else is dropped, and so is any word that looks like a token.
 */
export function cleanName(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Z}\s/\\~·]+/gu, ' ')
    .replace(/[^\p{L}\p{M}\p{N} _.,:()+#-]/gu, '')
    .split(' ')
    .filter((w) => w && !tokenLike(w))
    .join(' ');
}

/**
 * Cut at a word to `max` characters, the `…` included. A single word that's too long is cut where it must
 * be. Characters are counted as letters, not UTF-16 units, so a letter outside the BMP is never split.
 */
export function shortTitle(text: string, max = NAME_PART_MAX): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  const head = chars.slice(0, max).join('');
  const hard = chars.slice(0, max - 1).join('');
  const space = head.lastIndexOf(' ');
  const cut = (space > 0 ? head.slice(0, space) : hard).replace(/[\s.,:(+#_-]+$/u, '');
  return `${cut || hard}…`;
}

/** A task's id as it stands in a name. Ids are checked when they're made; anything else is cut to what an id holds. */
const cleanKey = (key: string): string => (/^[A-Z][A-Z0-9_]*-\d+$/.test(key) ? key : key.replace(/[^A-Za-z0-9_-]/g, ''));

export interface NameParts {
  /** The project's name, from `.acc/config.json`. */
  project: string;
  /** The task's id: GH-44, ACME-12, T-3. */
  key: string;
  title: string;
  role: NameRole;
  /** Which of the task's builders this is: the second dispatch is "builder 2". */
  n?: number;
}

/** "Acme Service · ACME-12 Case escalation rules · builder", cleaned and shortened (D-087). */
export function sessionName(p: NameParts): string {
  const project = shortTitle(cleanName(p.project));
  const title = shortTitle(cleanName(p.title));
  const key = cleanKey(p.key);
  const task = [key, title].filter(Boolean).join(' ');
  const role = p.role === 'builder' && p.n && p.n > 1 ? `${p.role} ${p.n}` : p.role;
  return [project, task, role].filter(Boolean).join(NAME_SEP);
}
