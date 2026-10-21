/**
 * A task opened from the Tasks board, in a modal over the board (GH-158): its messages, and which of the
 * Command Center page's messages are the modal's own. The modal is the task's page, drawn by the same
 * renderer from the same model, and its controls send what the tab's send; the ticket controller handles
 * them for either. No vscode import, so it's testable.
 */

import type { FromWebview } from './messages.ts';
import { KEY, type ModelArea, short } from './shared.ts';

export type Message =
  /**
   * A card on the Tasks board was clicked: its task opens in the modal. tracker is the tracker board's, or
   * null for a task acc alone keeps; left out, as from the agent board, the key decides, as acc.task.show does.
   */
  | { type: 'task-modal-open'; project: string; tracker?: number | null; key: string }
  /** The modal closed: Close, Escape, the backdrop, or Open as tab. */
  | { type: 'task-modal-close'; project: string; key: string };

/** The task the modal shows. */
export interface ModalTask { project: string; key: string }

/** What an update's id names: its task, as T-1 of T-1.2. */
export const taskOf = (id: string): string => id.slice(0, id.lastIndexOf('.'));

/**
 * Whether a message the Command Center's page sent is the modal's: one only a task's page sends, or one
 * for the modal's task, which the board underneath can't send while the modal covers it. The rest, such
 * as a card's Open as tab, an Open in GitHub or a related ticket, are the page's, as they were.
 * `commands` are those a task's page may run, as its tab's.
 */
export function modalTakes(o: ModalTask, m: FromWebview, commands: ReadonlySet<string>): boolean {
  const mine = (project: string, task: string): boolean => project === o.project && task.toUpperCase() === o.key.toUpperCase();
  switch (m.type) {
    case 'ticket-action': case 'update-edit': return true;
    case 'analysis-answer': case 'update-ask': case 'review-file': case 'criteria-draft': case 'criteria-update': case 'criteria-sheet': case 'verify-run': case 'verify-clear': return mine(m.project, m.task);
    case 'update-post': case 'update-discard': return mine(m.project, taskOf(m.id));
    case 'run': return commands.has(m.command) && mine(m.ref.project ?? '', m.ref.task ?? '');
    case 'toolbar': return commands.has(m.command) && m.arg !== undefined;
    default: return false;
  }
}

export const area: ModelArea = {
  messages: {
    'task-modal-open': (x) => short(x.project, 4096) && short(x.key, 100) && KEY.test(x.key as string) && (x.tracker === undefined || x.tracker === null || Number.isInteger(x.tracker)),
    'task-modal-close': (x) => short(x.project, 4096) && short(x.key, 100) && KEY.test(x.key as string),
  },
};
