/**
 * Drafting a ticket's acceptance criteria from the Command Center (T-81): the ticket is read from its
 * tracker with its comments and related tickets, handed to acc in a file that's removed after, and acc runs
 * the read-only drafter and keeps the draft with the task. Open as an update asks acc for an update draft.
 * Neither writes to the tracker: the person saves the sheet, or posts the update. Like the rest of logic/,
 * no `vscode` import, so it can be tested with node:test.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { criteriaRefusal, criteriaSection, criteriaTicket, type CriteriaDraft, drafting, readCriteria } from '../../../packages/core/src/criteria.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import type { Ticket } from '../../../packages/core/src/trackers/types.ts';
import { withSheetCriteria } from '../model/criteria.ts';
import type { TaskSheet } from '../model/task-sheet.ts';
import { accRefusal } from './connect.ts';
import { inProcessWords } from './processes.ts';

type Result = { code: number; stdout: string; stderr: string };

/** What drafting needs from the extension, passed in so it's tested without VS Code, a tracker or acc. */
export interface CriteriaHost {
  project(root: string): { root: string; ledgerPath: string } | undefined;
  task(root: string, id: string): Pick<Task, 'id' | 'source' | 'state'> | undefined;
  /** The ticket from its tracker, with its comments and related tickets. */
  ticket(root: string, key: string): Promise<Pick<Ticket, 'key' | 'title' | 'url' | 'markdown' | 'comments' | 'related'>>;
  /** Runs acc; with a label, in the output panel, where its steps show. */
  acc(args: string[], cwd: string, label?: string): Promise<Result>;
}

/** How a draft, or its update, went: done, or why not. A draft's reply holds the draft under its heading. */
export type CriteriaReply = { ok: true; section?: string } | { ok: false; error: string };

const stateOf = (p: { ledgerPath: string }) => ({ stateDir: dirname(p.ledgerPath) });

export class CriteriaDrafts {
  private readonly host: CriteriaHost;
  private readonly changed: (root: string, id: string) => void;
  /** The drafts this window started, by project and task, while acc runs them. */
  private readonly busy = new Set<string>();

  constructor(host: CriteriaHost, changed: (root: string, id: string) => void = () => {}) {
    this.host = host;
    this.changed = changed;
  }

  /** The task's stored draft, or null. */
  stored(root: string, id: string): CriteriaDraft | null {
    const p = this.host.project(root);
    return p ? readCriteria(stateOf(p), id.toUpperCase()) : null;
  }

  /** Whether a draft is under way: started here, or by acc anywhere while its process lives. */
  drafting(root: string, id: string): boolean {
    const p = this.host.project(root);
    return this.busy.has(`${root}#${id.toUpperCase()}`) || (!!p && !!drafting(stateOf(p), id.toUpperCase()));
  }

  /**
   * Drafts the task's acceptance criteria. The ticket is read first, with its comments and related tickets;
   * a ticket that can't be read leaves acc to draft from the task's description, and the draft says so.
   * One draft a task at a time. A task with no ticket is refused before anything runs.
   */
  async draft(root: string, raw: string): Promise<CriteriaReply> {
    const id = raw.toUpperCase();
    const key = `${root}#${id}`;
    const p = this.host.project(root);
    const task = p ? this.host.task(root, id) : undefined;
    if (!p) return { ok: false, error: 'That project isn\'t open any more.' };
    const why = criteriaRefusal(task, id);
    if (why) return { ok: false, error: why };
    if (this.drafting(root, id)) return { ok: false, error: `${id}'s acceptance criteria are being drafted now.` };
    this.busy.add(key);
    this.changed(root, id);
    const dir = mkdtempSync(join(tmpdir(), 'acc-criteria-'));
    try {
      let ticket: string | null = null;
      try {
        ticket = JSON.stringify(criteriaTicket(await this.host.ticket(root, task!.source.key ?? id)));
      } catch {
        // Offline, or signed out: acc drafts from the description it keeps, and the draft says so.
      }
      const file = join(dir, 'ticket.json');
      if (ticket) writeFileSync(file, ticket);
      const r = await this.host.acc(['draft', 'criteria', id, ...(ticket ? ['--ticket', file] : []), '--json'], root, `Draft ${id}'s acceptance criteria`);
      const no = accRefusal(r);
      if (no !== null) return { ok: false, error: no };
      const d = this.stored(root, id);
      return d ? { ok: true, section: criteriaSection(d.markdown) } : { ok: false, error: 'The draft wasn\'t kept.' };
    } catch (e) {
      return { ok: false, error: inProcessWords((e as Error).message) };
    } finally {
      rmSync(dir, { recursive: true, force: true });
      this.busy.delete(key);
      this.changed(root, id);
    }
  }

  /** The stored draft as an update draft, to edit and post as a comment. acc writes it; nothing is posted. */
  async toUpdate(root: string, raw: string): Promise<CriteriaReply> {
    const id = raw.toUpperCase();
    if (!this.host.project(root)) return { ok: false, error: 'That project isn\'t open any more.' };
    if (!this.stored(root, id)) return { ok: false, error: `${id} has no drafted acceptance criteria yet. Draft them first.` };
    const no = accRefusal(await this.host.acc(['draft', 'update', id, '--json'], root));
    return no === null ? { ok: true } : { ok: false, error: no };
  }

  /** What the task sheet adds for its drafting (T-81); with `add`, the draft below its description's text. */
  dress(root: string, id: string, add = false): (s: TaskSheet) => TaskSheet {
    return (s) => withSheetCriteria(s, this.stored(root, id), this.drafting(root, id), add);
  }
}
