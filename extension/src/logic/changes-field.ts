/**
 * A tracker's changes field, read and saved (T-105). A ticket's page reads the field once each time it loads
 * the ticket, and keeps what it read here, by project and ticket. A save writes only what a person saved,
 * and only after the field is read again and still says what the page showed them, as D-177's text does.
 * Nothing here writes to a ticket on its own. Like the rest of logic/, no `vscode` import.
 */
import type { TextField, TrackerClient } from '../../../packages/core/src/trackers/types.ts';
import type { FieldRead } from '../model/changes-field.ts';
import { EDITS_OFF } from '../model/task-sheet.ts';
import { inProcessWords } from './processes.ts';

type FieldClient = Pick<TrackerClient, 'readField' | 'writeField'>;

/** What the ticket's page was told the field says, by `${root}#${KEY}`. A read on its way stays until it's answered. */
export class FieldReads {
  private readonly reads = new Map<string, FieldRead>();
  private readonly redraw: (root: string) => void;

  constructor(redraw: (root: string) => void) {
    this.redraw = redraw;
  }

  private key(root: string, key: string): string {
    return `${root}#${key.toUpperCase()}`;
  }

  /** What was read last, or null before the first read. */
  read(root: string, key: string): FieldRead | null {
    return this.reads.get(this.key(root, key)) ?? null;
  }

  /**
   * Reads the field again, then redraws the page. While it's read, the last text stays on the page. A
   * client that can't be made, or can't read fields, says why.
   */
  async load(root: string, key: string, field: TextField, client: () => Promise<FieldClient>): Promise<void> {
    const k = this.key(root, key);
    if (!this.reads.has(k)) this.reads.set(k, { state: 'loading' });
    try {
      const c = await client();
      if (!c.readField) throw new Error('This tracker has no fields to read.');
      this.reads.set(k, { state: 'read', text: await c.readField(key, field) });
    } catch (e) {
      this.reads.set(k, { state: 'failed', error: inProcessWords((e as Error).message) });
    }
    this.redraw(root);
  }

  /** A save wrote the field: the page shows what was written until it's read again. */
  wrote(root: string, key: string, text: string): void {
    this.reads.set(this.key(root, key), { state: 'read', text });
  }
}

export interface SaveIn {
  field: TextField | null;
  /** Whether the tracker's settings let a person's edits write to its tickets (D-177). */
  edits: boolean;
  key: string;
  /** The field's name, as the page shows it. */
  name: string;
  text: string;
  /** What the field said when the page drew the draft. */
  before: string;
}

export type SaveOut = { ok: true } | { ok: false; error: string; now?: string };

/**
 * A person's save (T-105): refused, with nothing written, where the project names no field or its settings
 * keep edits off. Otherwise the field is read again; when it changed since the page showed it, nothing is
 * written, and the page gets what it says now. Then it's written, once.
 */
export async function saveField(client: FieldClient, i: SaveIn): Promise<SaveOut> {
  if (!i.field) return { ok: false, error: 'The project\'s settings name no field for a ticket\'s changes any more, so nothing was written.' };
  if (!i.edits) return { ok: false, error: `The ticket's ${i.name} can't change from here, so nothing was written. ${EDITS_OFF}` };
  if (!client.readField || !client.writeField) return { ok: false, error: 'This tracker has no fields to write, so nothing was written.' };
  try {
    const now = await client.readField(i.key, i.field);
    if (now.trim() !== i.before.trim()) {
      return { ok: false, error: `The ticket's ${i.name} changed since this page showed it, so nothing was written. The page shows what it says now: check your draft against it, then save again.`, now };
    }
    await client.writeField(i.key, i.field, i.text);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Couldn't save it: ${inProcessWords((e as Error).message)}` };
  }
}
