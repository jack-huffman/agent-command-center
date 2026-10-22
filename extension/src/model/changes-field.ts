/**
 * A tracker's changes field (T-105): where a team keeps what a ticket changed, such as Jira's "Deployment
 * Notes". Settings' Trackers names it, a row of its own for each tracker, and so does the Connect page, once a
 * tracker's place is saved. A ticket's page reads the field back, beside the changes the Command Center found,
 * and says where they differ. The field's new text is an update draft (D-066), drafted when the ticket's
 * changes change, that a person reads, edits and saves to the ticket, with each line a person wrote there kept.
 * Nothing is written until that save. Plain data: no vscode import, so it's testable.
 */

import { changesDraft, changesFieldRefusal, keptLines, sameChanges, withKept } from '../../../packages/core/src/changes-field.ts';
import type { Profile, Tracker } from '../../../packages/core/src/config.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import type { TicketManifest } from '../../../packages/core/src/manifest.ts';
import { outsideOf } from '../../../packages/core/src/outside-changes.ts';
import { type Doc, fromMarkdown } from '../../../packages/core/src/trackers/doc.ts';
import { GITHUB_SECTION } from '../../../packages/core/src/trackers/fields.ts';
import { type FieldFormat, isTrackerKind, type TextField, type TrackerKind, trackerName } from '../../../packages/core/src/trackers/types.ts';
import type { ConnectState } from './connect.ts';
import type { SettingsAction } from './settings.ts';
import { type Look, LOOK, type ModelArea } from './shared.ts';
import type { UpdateCard } from './updates.ts';

// ---------------------------------------------------------------- the setting

/** What the setting's row is called, in Settings' Trackers and on the Connect page. */
export const CHANGES_FIELD_LABEL = 'Where to keep a ticket\'s changes';

/** The command that picks the field, from Settings and the Connect page. */
export const CHANGES_FIELD_COMMAND = 'acc.trackers.changesField';

/** A field's format, as a person reads it beside its name. */
export const FORMAT_WORDS: Record<FieldFormat, string> = { markdown: 'Markdown', html: 'rich text', adf: 'rich text', plain: 'plain text' };

/** The field, as a person reads it: a GitHub issue's section of its description, or the field by its name. */
export const fieldName = (kind: TrackerKind, f: TextField): string => (kind === 'github' ? `the description's ${GITHUB_SECTION} section` : f.name);

/** The setting's row: what's chosen, or why it can't be, and the button that picks it. */
export interface ChangesFieldRow {
  label: string;
  /** Its name in Settings' Trackers, one word as its neighbours' are: Place, Board, Sign-in. */
  short: string;
  look: Look;
  action: SettingsAction & { command: typeof CHANGES_FIELD_COMMAND };
}

/**
 * A tracker's row (T-105): the field it keeps a ticket's changes in, in blue, or "Only on the ticket's page"
 * when none is chosen. Slack has no fields: its row and button are off and say why. `saved` is false on the
 * Connect page before the tracker is saved, when there's no tracker yet to read fields from.
 */
export function changesFieldRow(kind: TrackerKind, field: TextField | null, arg: string, whose: string, saved = true): ChangesFieldRow {
  const refusal = changesFieldRefusal(kind);
  const look: Look = refusal ? LOOK(refusal, 'circle-slash', 'neutral')
    : field ? LOOK(kind === 'github' ? `In ${fieldName(kind, field)}` : `${field.name}, a ${trackerName(kind)} field, as ${FORMAT_WORDS[field.format]}`, 'note', 'blue')
      : LOOK('Only on the ticket\'s page: no field chosen', 'circle-outline', 'neutral');
  const disabled = refusal ?? (saved ? null : 'Save the tracker first: then its fields can be read.');
  // Its name starts with the words it shows, so a screen reader and a voice command find it by them.
  const label = field ? 'Change…' : 'Choose…';
  return {
    label: CHANGES_FIELD_LABEL, short: 'Changes', look,
    action: { command: CHANGES_FIELD_COMMAND, label, icon: 'note', arg, name: `${label} where to keep a ticket's changes, for ${whose}`, primary: false, disabled },
  };
}

/**
 * The Connect page's row (T-105): for a tracker already saved, its field and Change…; for a new one, once its
 * place is chosen, the row with its button off until it's saved. Null before the place is chosen, and while a
 * project is being started.
 */
export function connectChangesField(s: Pick<ConnectState, 'root' | 'kind' | 'existing' | 'projectName' | 'start'>, trackers: Pick<Tracker, 'kind' | 'changesField'>[], placeChosen: boolean): ChangesFieldRow | null {
  if (!isTrackerKind(s.kind) || s.start || !s.root) return null;
  const t = s.existing ? trackers[s.existing.index] : undefined;
  if (!t && !placeChosen) return null;
  return changesFieldRow(s.kind, t?.changesField ?? null, JSON.stringify({ root: s.root, index: s.existing?.index ?? null }), `${s.existing?.title ?? trackerName(s.kind)}, in ${s.projectName}`, !!t);
}

/** One choice in the field's picker: a field, or none. */
export interface FieldPick {
  label: string;
  description: string;
  picked: boolean;
  field: TextField | null;
}

/** The picker's choices: none first, then each field with its format, the one chosen marked. */
export function changesFieldPicks(kind: TrackerKind, fields: TextField[], current: TextField | null): FieldPick[] {
  return [
    { label: 'None', description: 'Show a ticket\'s changes on its page only', picked: !current, field: null },
    ...fields.map((f) => ({ label: kind === 'github' ? 'The description' : f.name, description: kind === 'github' ? `Under its own heading, ${GITHUB_SECTION}` : FORMAT_WORDS[f.format], picked: current?.id === f.id, field: f })),
  ];
}

/** What a tracker with no field that holds text says, in the picker's place. */
export const noTextFields = (kind: TrackerKind): string =>
  `${trackerName(kind)} has no field that holds text which this sign-in can change. Add one in ${trackerName(kind)}, then choose it here.`;

/** The tracker's settings to write for a choice: the field, or null to take it out. */
export const changesFieldRecord = (kind: TrackerKind, field: TextField | null): Record<string, unknown> =>
  ({ kind, changesField: field ? { id: field.id, name: field.name, format: field.format } : null });

// ---------------------------------------------------------------- the ticket's page

/** The field's text as last read from the ticket, or why it wasn't. */
export type FieldRead = { state: 'loading' } | { state: 'read'; text: string } | { state: 'failed'; error: string };

/** How the field compares with what the Command Center found: orange where they differ, blue where they agree. */
export const FIELD_LOOK: Record<'differs' | 'same' | 'empty' | 'reading' | 'failed', Look> = {
  differs: { label: 'Differs from the changes the Command Center found', icon: 'diff', tone: 'orange' },
  same: { label: 'Says what the Command Center found', icon: 'pass', tone: 'blue' },
  empty: { label: 'Empty on the ticket', icon: 'circle-outline', tone: 'orange' },
  reading: { label: 'Reading it from the ticket', icon: 'sync~spin', tone: 'blue' },
  failed: { label: 'Couldn\'t read it', icon: 'warning', tone: 'orange' },
};

export interface TicketField {
  task: string;
  heading: string;
  look: Look;
  /** What the ticket's field says, as Markdown; null while it's read, when the read failed, or it's empty. */
  text: string | null;
  /** That text, drawn as the ticket's own text is. */
  doc: Doc | null;
  /** Why it couldn't be read. */
  error: string | null;
  /** A muted line under the heading, or null. */
  note: string | null;
}

export interface FieldIn {
  task: Pick<Task, 'id' | 'outside'>;
  kind: TrackerKind;
  field: TextField | null;
  profile: Profile;
  /** What its work changed: its branch's paths while in flight, else what was kept when it merged. */
  paths: string[];
  /** Its package.xml, where one was built for it (T-101). */
  manifest?: Pick<TicketManifest, 'types' | 'deletions'> | null;
  read: FieldRead | null;
  /** Every text the Command Center drafted for the field, as its updates keep them: what tells its lines from a person's. */
  written: string[];
  /** Whether a draft of the field's new text waits for a person (D-066). */
  drafted: boolean;
  now: Date;
}

/**
 * The read-back (T-105), or null where the tracker names no field: what the ticket's field says, and whether
 * it says what the Command Center found, the lines a person wrote there counted as kept. Its new text is a
 * draft update, drafted when the ticket's changes change and listed with its other drafts; this only says so.
 */
export function ticketField(i: FieldIn): TicketField | null {
  if (!i.field || changesFieldRefusal(i.kind)) return null;
  const name = fieldName(i.kind, i.field);
  const base = { task: i.task.id, heading: `From the ticket's ${i.kind === 'github' ? GITHUB_SECTION : name}`, error: null };
  if (!i.read || i.read.state === 'loading') return { ...base, look: FIELD_LOOK.reading, text: null, doc: null, note: null };
  if (i.read.state === 'failed') return { ...base, look: FIELD_LOOK.failed, text: null, doc: null, error: i.read.error, note: null };
  const now = i.read.text.trim();
  const shown = { ...base, text: now || null, doc: now ? fromMarkdown(now) : null };
  const found = changesDraft({ profile: i.profile, paths: i.paths, outside: outsideOf(i.task).changes, manifest: i.manifest ?? null, at: i.now });
  if (!found) {
    return { ...shown, look: now ? LOOK('The Command Center found no changes yet', 'circle-outline', 'neutral') : FIELD_LOOK.empty, note: now ? 'Written on the ticket: the Command Center has nothing to add yet.' : null };
  }
  if (now && sameChanges(now, withKept(found, keptLines(now, [...i.written, found])))) {
    return { ...shown, look: FIELD_LOOK.same, note: i.drafted ? 'The field says this already: its draft update, in Activity, can be discarded.' : null };
  }
  const note = i.drafted
    ? `Its draft update, in Activity, is the field's new text${now ? ': it keeps each line written here by hand, marked as kept from the ticket.' : '.'}`
    : now ? 'What was written here by hand stays. The Command Center drafts the field\'s new text when the ticket\'s changes next change.' : null;
  return { ...shown, look: now ? FIELD_LOOK.differs : FIELD_LOOK.empty, note };
}

/**
 * The ticket's draft of its changes field (T-105), once the field is read, with each line a person wrote
 * there kept, marked as kept from the ticket: what Save to the ticket offers, so saving it as offered
 * removes none. Other drafts, and this one before the read, are as acc wrote them: the save keeps those
 * lines either way.
 */
export function withFieldKept(cards: UpdateCard[], read: FieldRead | null, written: string[]): UpdateCard[] {
  if (read?.state !== 'read') return cards;
  return cards.map((c) => (c.saves === null ? c : { ...c, text: withKept(c.text, keptLines(read.text, [...written, c.text])) }));
}

export const area: ModelArea = {
  // The setting's Choose… and Change… run it, from Settings and the Connect page.
  commands: [CHANGES_FIELD_COMMAND],
};
