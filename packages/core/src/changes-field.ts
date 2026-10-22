/**
 * A tracker's changes field (T-105): the ticket field a team keeps for what a ticket changed, such as
 * "Deployment Notes", so whoever deploys to production knows what to move, records included. A tracker's
 * settings name it (`changesField`); the Command Center drafts its text from the ticket's changes (T-99's
 * paths, T-100's changes outside git), and a person reads it, edits it and saves it to the ticket. Nothing
 * here writes to a tracker.
 */
import type { Profile } from './config.ts';
import type { OutsideChange } from './outside-changes.ts';
import { outsideKind } from './outside-kinds.ts';
import { sfComponent } from './sf-metadata.ts';
import { isObj } from './text.ts';
import { fromMarkdown } from './trackers/doc.ts';
import { GITHUB_CHANGES, plainOf } from './trackers/fields.ts';
import { type FieldFormat, type TextField, type TrackerKind, trackerName } from './trackers/types.ts';

/** The formats a tracker's fields keep text in, so a setting can't name a format its tracker has no field for. */
export const FIELD_FORMATS_OF: Record<TrackerKind, readonly FieldFormat[]> = {
  github: ['markdown'], jira: ['adf', 'plain'], azure: ['html', 'plain'], monday: ['plain'], slack: [],
};

/** Why a tracker can't keep a ticket's changes in a field, or null where it can. Plain words, with no command (D-132). */
export const changesFieldRefusal = (kind: TrackerKind): string | null =>
  (FIELD_FORMATS_OF[kind].length ? null : `A ${trackerName(kind)} thread has no fields, so a ticket's changes stay on its page in the Command Center.`);

/** The longest id or name a field may have. */
const FIELD_TEXT_MAX = 200;

/** Why a tracker's `changesField` is refused, or null when it's one its kind can keep. */
export function changesFieldProblem(kind: TrackerKind, v: unknown): string | null {
  const why = changesFieldRefusal(kind);
  if (why) return `"changesField" can't be set: ${why}`;
  const text = (x: unknown) => typeof x === 'string' && !!x.trim() && x.length <= FIELD_TEXT_MAX;
  const formats = FIELD_FORMATS_OF[kind];
  if (!isObj(v) || !text(v.id) || !text(v.name) || !formats.includes(v.format as FieldFormat)) {
    return `"changesField" names a ${trackerName(kind)} field that holds text, as { "id": …, "name": …, "format": … }, its format one of ${formats.join(', ')}.`;
  }
  if (kind === 'github' && v.id !== GITHUB_CHANGES.id) return `"changesField" on GitHub can only be the issue's description, { "id": "description", "name": "${GITHUB_CHANGES.name}", "format": "markdown" }: an issue has no other field.`;
  return null;
}

/** A tracker's `changesField` as its settings keep it, trimmed; null when it's unset or refused. */
export function readChangesField(kind: TrackerKind, v: unknown): TextField | null {
  if (v === null || v === undefined || changesFieldProblem(kind, v)) return null;
  const f = v as TextField;
  return { id: f.id.trim(), name: f.name.trim(), format: f.format };
}

/**
 * Where a changed path goes in a list a person reads (T-99): in a Salesforce project its component's type and
 * name; elsewhere its folder and file name. `other` puts it with the catch-all set, last.
 */
export function changePlace(path: string, profile: Profile): { head: string; name: string; other: boolean } {
  if (profile === 'salesforce') {
    const c = sfComponent(path);
    return c ? { head: c.label, name: c.name, other: false } : { head: 'Other files', name: path, other: true };
  }
  const slash = path.lastIndexOf('/');
  return slash < 0 ? { head: 'The top folder', name: path, other: true } : { head: path.slice(0, slash), name: path.slice(slash + 1), other: false };
}

/** Escapes what Markdown would read as markup in a name, so it reads back as itself. An underscore inside a word is left. */
const plain = (s: string): string => s.replace(/[\\`*[\]<>]/g, '\\$&').replace(/(^|\s)_|_(?=\s|$)/g, (m) => m.replace('_', '\\_'));

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** The draft's last line: when it was drafted. Two drafts that differ only in it say the same. */
export const draftedOn = (at: Date): string => `As of ${DAY.format(at)}.`;
const DATE_LINE = /^As of \d{1,2} [A-Z][a-z]{2,3} \d{4}\.$/;

export interface ChangesDraftIn {
  profile: Profile;
  /** What the ticket's work changed: its branch's paths while in flight, else what was kept when it merged. */
  paths: string[];
  /** Its changes outside git (T-100), such as record changes. */
  outside: OutsideChange[];
  at: Date;
}

/**
 * The field's text, as Markdown, from a ticket's changes: its components grouped by type (by folder outside
 * Salesforce), each type in bold over a list of names, then its changes outside git, each group under its
 * kind's label, each change in plain words, then the date. Null when it has no changes to say.
 */
export function changesDraft(i: ChangesDraftIn): string | null {
  const sets = new Map<string, { other: boolean; names: Set<string> }>();
  for (const path of i.paths) {
    const p = changePlace(path, i.profile);
    const set = sets.get(p.head) ?? sets.set(p.head, { other: p.other, names: new Set() }).get(p.head)!;
    set.names.add(p.name);
  }
  const groups: { head: string; items: string[] }[] = [...sets.entries()]
    .sort(([a, x], [b, y]) => Number(x.other) - Number(y.other) || a.localeCompare(b))
    .map(([head, s]) => ({ head, items: [...s.names].sort((a, b) => a.localeCompare(b)) }));
  const outside = new Map<string, string[]>();
  for (const c of i.outside) {
    const kind = outsideKind(c.kind);
    const label = kind?.label ?? `Changes of kind ${c.kind}`;
    outside.set(label, [...(outside.get(label) ?? []), kind ? kind.words(c.detail) : JSON.stringify(c.detail)]);
  }
  groups.push(...[...outside.entries()].map(([head, items]) => ({ head, items })));
  if (!groups.length) return null;
  return [...groups.flatMap((g) => [`**${plain(g.head)}**`, '', ...g.items.map((n) => `- ${plain(n)}`), '']), draftedOn(i.at)].join('\n');
}

/** A field's text, as words a person reads, without its date line or spacing: what two texts are compared by. */
const words = (markdown: string): string =>
  plainOf(fromMarkdown(markdown)).split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter((l) => l && !DATE_LINE.test(l)).join('\n');

/** Whether a field's text already says what the draft does, ignoring the date it was drafted, spacing and Markdown. */
export const sameChanges = (field: string, draft: string): boolean => words(field) === words(draft);
