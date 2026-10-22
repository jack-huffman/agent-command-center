/**
 * A tracker's changes field (T-105): where a team keeps what a ticket changed, such as Jira's "Deployment
 * Notes". Settings' Trackers names it, a row of its own for each tracker, and so does the Connect page, once a
 * tracker's place is saved. A ticket's page reads the field back, beside the changes the Command Center found,
 * and says where they differ; where they do, it drafts the field's new text for a person to read, edit and
 * save to the ticket. Nothing is written until that save. Plain data: no vscode import, so it's testable.
 */

import { changesDraft, changesFieldRefusal, sameChanges } from '../../../packages/core/src/changes-field.ts';
import type { Profile, Tracker } from '../../../packages/core/src/config.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import { outsideOf } from '../../../packages/core/src/outside-changes.ts';
import { type Doc, fromMarkdown } from '../../../packages/core/src/trackers/doc.ts';
import { GITHUB_SECTION } from '../../../packages/core/src/trackers/fields.ts';
import { type FieldFormat, isTrackerKind, type TextField, type TrackerKind, trackerName } from '../../../packages/core/src/trackers/types.ts';
import type { ConnectState } from './connect.ts';
import type { SettingsAction } from './settings.ts';
import { KEY, type Look, LOOK, type ModelArea, short } from './shared.ts';
import { EDITS_OFF } from './task-sheet.ts';

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
    label: CHANGES_FIELD_LABEL, look,
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
export const FIELD_LOOK: Record<'differs' | 'same' | 'empty' | 'reading' | 'failed' | 'draft', Look> = {
  differs: { label: 'Differs from the changes the Command Center found', icon: 'diff', tone: 'orange' },
  same: { label: 'Says what the Command Center found', icon: 'pass', tone: 'blue' },
  empty: { label: 'Empty on the ticket', icon: 'circle-outline', tone: 'orange' },
  reading: { label: 'Reading it from the ticket', icon: 'sync~spin', tone: 'blue' },
  failed: { label: 'Couldn\'t read it', icon: 'warning', tone: 'orange' },
  draft: { label: 'Draft, not saved', icon: 'comment-draft', tone: 'orange' },
};

export interface FieldDraft {
  title: string;
  /** Draft, not saved: orange, with its icon. */
  look: Look;
  /** The Command Center's text, as Markdown, for the person to edit. */
  text: string;
  /** What the field says now, which a save replaces: the page sends it back so a field changed since isn't overwritten. */
  replaces: string;
  save: { label: string; disabled: string | null };
}

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
  draft: FieldDraft | null;
}

export interface FieldIn {
  task: Pick<Task, 'id' | 'outside'>;
  kind: TrackerKind;
  field: TextField | null;
  /** Whether the tracker's settings let a person's edits write to its tickets (D-066, D-177). */
  edits: boolean;
  profile: Profile;
  /** What its work changed: its branch's paths while in flight, else what was kept when it merged. */
  paths: string[];
  read: FieldRead | null;
  now: Date;
}

/**
 * The read-back and the draft (T-105), or null where the tracker names no field. The draft shows once the
 * field is read, when the Command Center found changes and the field doesn't say them already: the person
 * edits it and saves it, where the tracker's settings let edits write to tickets.
 */
export function ticketField(i: FieldIn): TicketField | null {
  if (!i.field || changesFieldRefusal(i.kind)) return null;
  const name = fieldName(i.kind, i.field);
  const base = { task: i.task.id, heading: `From the ticket's ${i.kind === 'github' ? GITHUB_SECTION : name}` };
  if (!i.read || i.read.state === 'loading') return { ...base, look: FIELD_LOOK.reading, text: null, doc: null, error: null, note: null, draft: null };
  if (i.read.state === 'failed') return { ...base, look: FIELD_LOOK.failed, text: null, doc: null, error: i.read.error, note: null, draft: null };
  const now = i.read.text.trim();
  const doc = now ? fromMarkdown(now) : null;
  const drafted = changesDraft({ profile: i.profile, paths: i.paths, outside: outsideOf(i.task).changes, at: i.now });
  if (!drafted) {
    return { ...base, look: now ? LOOK('The Command Center found no changes yet', 'circle-outline', 'neutral') : FIELD_LOOK.empty, text: now || null, doc, error: null, note: now ? 'Written on the ticket: the Command Center has nothing to add yet.' : null, draft: null };
  }
  if (now && sameChanges(now, drafted)) return { ...base, look: FIELD_LOOK.same, text: now, doc, error: null, note: null, draft: null };
  return {
    ...base, look: now ? FIELD_LOOK.differs : FIELD_LOOK.empty, text: now || null, doc, error: null,
    note: now ? 'What a developer wrote here by hand stays on the ticket until you save the draft below over it.' : null,
    draft: {
      title: `Update ${name}`, look: FIELD_LOOK.draft, text: drafted, replaces: now,
      save: { label: 'Save to the ticket', disabled: i.edits ? null : `The ticket's ${name} can't change from here. ${EDITS_OFF}` },
    },
  };
}

/** What the extension tells the page once a save went, or didn't. */
export const FIELD_SAVED = 'changes-field-saved';

export type Message =
  /**
   * A person saves the drafted text, as edited, to the ticket's field (T-105), with what the field said
   * when the page drew it, so a field changed since isn't written over.
   */
  { type: 'changes-field-save'; project: string; task: string; text: string; before: string };

/** The most text a save carries. */
export const FIELD_TEXT_MAX = 65_536;

export const area: ModelArea = {
  // The setting's Choose… and Change… run it, from Settings and the Connect page.
  commands: [CHANGES_FIELD_COMMAND],
  messages: {
    'changes-field-save': (x) => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string) && short(x.text, FIELD_TEXT_MAX) && !!(x.text as string).trim()
      // What the field said may be nothing: an empty field.
      && typeof x.before === 'string' && x.before.length <= FIELD_TEXT_MAX,
  },
};
