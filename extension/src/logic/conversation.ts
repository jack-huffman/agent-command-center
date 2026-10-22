/**
 * A plan's conversation in its own panel (T-111): where it opens, beside the task's page or as a tab of its own
 * when that page is too narrow to share, and a plan being made from it, once at a time for a task. Like the rest
 * of logic/, no `vscode` import, so it can be tested with node:test.
 */
import type { Making } from '../model/talk.ts';

/**
 * The narrowest task page its conversation opens beside: narrower, and the two halves would each be too narrow
 * to read, so it opens as a tab of its own in the page's place.
 */
export const BESIDE_MIN = 900;

/** Where the conversation opens: beside the task's page, or as a tab of its own. */
export type Place = 'beside' | 'tab';

/** Where the conversation opens for a page this wide; with no width known, beside it. */
export const conversationPlace = (width: number | null | undefined): Place => (typeof width === 'number' && width > 0 && width < BESIDE_MIN ? 'tab' : 'beside');

/** acc's arguments for a message before the plan (D-012): the words with =, and the ticket's file for the first one (T-110). */
export const startArgs = (task: string, text: string, ticket: string | null = null): string[] => ['plan', 'start', task, `--message=${text}`, ...(ticket ? ['--ticket', ticket] : []), '--json'];

/**
 * Plans being made from this window (T-111), by project and task: its ticket being read, then the plan. A second
 * Make a plan, Draft the plan or Skip to the plan while one is under way is ignored. Each change is told, so the
 * panel and the task page redraw.
 */
export class PlansMaking {
  private readonly now = new Map<string, Making>();
  private readonly changed: (root: string, id: string) => void;

  constructor(changed: (root: string, id: string) => void = () => {}) {
    this.changed = changed;
  }

  private static key = (root: string, id: string): string => `${root}#${id.toUpperCase()}`;

  /** Starts one, reading its ticket first: false, and nothing changes, when one is under way already. */
  begin(root: string, id: string): boolean {
    const k = PlansMaking.key(root, id);
    if (this.now.has(k)) return false;
    this.now.set(k, 'reading');
    this.changed(root, id);
    return true;
  }

  /** Its ticket is read: the plan is being made. */
  planning(root: string, id: string): void {
    const k = PlansMaking.key(root, id);
    if (!this.now.has(k)) return;
    this.now.set(k, 'planning');
    this.changed(root, id);
  }

  /** It ended, made or not. */
  end(root: string, id: string): void {
    if (this.now.delete(PlansMaking.key(root, id))) this.changed(root, id);
  }

  /** What is under way for the task, or null. */
  of(root: string, id: string): Making | null {
    return this.now.get(PlansMaking.key(root, id)) ?? null;
  }
}
