// A tracker's changes field (T-105): Choose… in Settings' Trackers and on the Connect page picks the field from
// the tracker's own, and acc writes the choice to the project's settings. A ticket's page reads the field back;
// acc drafts its new text as an update when the ticket's changes change, and only a person's Save to the
// ticket writes it.
import * as vscode from 'vscode';
import { changesFieldRefusal } from '../../packages/core/src/changes-field.ts';
import { writtenFor } from '../../packages/core/src/field-drafts.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import type { TicketManifest } from '../../packages/core/src/manifest.ts';
import type { TextField } from '../../packages/core/src/trackers/types.ts';
import { isOpenUpdate, type Update } from '../../packages/core/src/updates.ts';
import { trackerName } from '../../packages/core/src/trackers/types.ts';
import type { ExtensionArea } from './area.ts';
import type { Project } from './hub.ts';
import { FieldReads } from './logic/changes-field.ts';
import { inProcessWords } from './logic/processes.ts';
import { CHANGES_FIELD_LABEL, changesFieldPicks, changesFieldRecord, type FieldRead, fieldName, noTextFields, type TicketField, ticketField } from './model/changes-field.ts';

/** What a task's page asks of its tracker's changes field. */
export interface FieldActions {
  /** Reads the ticket's field again, then redraws its page. Nothing where its tracker names no field. */
  load(p: Project, tracker: number, key: string): void;
  /** The section, from what was read last, the task's changes, and its drafts of the field. */
  model(p: Project, tracker: number, task: Task, paths: string[], updates: Update[], manifest: Pick<TicketManifest, 'types' | 'deletions'> | null): TicketField | null;
  /** What was read last of a ticket's field, for its draft to keep what a person wrote there. */
  read(p: Project, key: string): FieldRead | null;
  /** A save wrote the field: the page shows what was written, then reads it again. */
  saved(p: Project, tracker: number, key: string, field: TextField, text: string): void;
}


export const area: ExtensionArea = {
  register({ reg, hub, trackers, tickets }) {
    const reads = new FieldReads((root) => tickets.refresh(root));
    const fieldOf = (p: Project, index: number) => trackers.trackers(p)[index] ?? null;
    tickets.fields = {
      load(p, index, key) {
        const t = fieldOf(p, index);
        if (t?.changesField) void reads.load(p.root, key, t.changesField, () => trackers.client(p, index));
      },
      model(p, index, task, paths, updates, manifest) {
        const t = fieldOf(p, index);
        if (!t) return null;
        const drafted = updates.some((u) => u.task === task.id && u.event === 'changes' && isOpenUpdate(u));
        return ticketField({
          task, kind: t.kind, field: t.changesField, profile: p.config.profile, paths, manifest, read: reads.read(p.root, task.id), written: writtenFor(updates, task.id), drafted, now: new Date(),
        });
      },
      read: (p, key) => reads.read(p.root, key),
      saved(p, index, key, field, text) {
        reads.wrote(p.root, key, text);
        tickets.refresh(p.root);
        // Read again, so the page shows what the ticket says, as the tracker keeps it.
        void reads.load(p.root, key, field, () => trackers.client(p, index));
      },
    };

    // Choose… and Change…: the tracker's fields that hold text, read through its sign-in, then acc writes the choice.
    // CHANGES_FIELD_COMMAND, written out so the check of what's registered finds it.
    reg('acc.trackers.changesField', async (arg?: unknown) => {
      const chosen = await trackers.pickTracker(arg, CHANGES_FIELD_LABEL);
      if (!chosen) return;
      const { p, index, t } = chosen;
      const refusal = changesFieldRefusal(t.kind);
      if (refusal) {
        void vscode.window.showInformationMessage(refusal);
        return;
      }
      let fields;
      try {
        const client = await trackers.client(p, index);
        if (!client.textFields) throw new Error(`${trackerName(t.kind)} has no fields to choose from.`);
        fields = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Reading ${trackerName(t.kind)}'s fields…` }, () => client.textFields!());
      } catch (e) {
        void vscode.window.showWarningMessage(`Couldn't read ${trackerName(t.kind)}'s fields: ${inProcessWords((e as Error).message)}`);
        return;
      }
      if (!fields.length) {
        void vscode.window.showInformationMessage(noTextFields(t.kind));
        return;
      }
      const picks = changesFieldPicks(t.kind, fields, t.changesField);
      const pick = await vscode.window.showQuickPick(picks.map((x) => ({ label: x.label, description: x.description, picked: x.picked, x })), {
        title: `${CHANGES_FIELD_LABEL}: ${trackers.title(t)}`, placeHolder: 'The Command Center drafts its text from each ticket\'s changes; a person saves it to the ticket.',
      });
      if (!pick) return;
      try {
        await trackers.write(p.root, index, changesFieldRecord(t.kind, pick.x.field));
      } catch (e) {
        void vscode.window.showWarningMessage(`Couldn't keep the choice: ${inProcessWords((e as Error).message)}`);
        return;
      }
      await hub.loadProjects();
      await trackers.reload(p.root);
      tickets.refresh(p.root);
      void vscode.window.showInformationMessage(pick.x.field
        ? `${p.name}'s tickets keep their changes in ${fieldName(t.kind, pick.x.field)}, as the project's settings now say. Commit them to share the choice.`
        : `${p.name}'s tickets show their changes on their page only, as the project's settings now say. Commit them to share the choice.`);
    });
  },
};
