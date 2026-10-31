/**
 * A task opened from the Tasks board, in a modal over the board (GH-158): its messages, and which of the
 * Command Center page's messages are the modal's own. The modal is the task's page, drawn by the same
 * renderer from the same model, and its controls send what the tab's send; the ticket controller handles
 * them for either. No vscode import, so it's testable.
 */

import type { FromWebview } from './messages.ts';
import { KEY, type ModelArea, short } from './shared.ts';
import { TASK_PART } from './task-tabs.ts';

export type Message =
  /**
   * A card on the Tasks board was clicked: its task opens in the modal. tracker is the tracker board's, or
   * null for a task acc alone keeps; left out, as from the agent board, the key decides, as acc.task.show does.
   * part: the part of its page to open on (T-134), as a Needs you line names it. title: the task's title as
   * the click's line or card showed it, which the modal shows while it loads (T-162); the extension reads its own.
   */
  | { type: 'task-modal-open'; project: string; tracker?: number | null; key: string; part?: string; title?: string }
  /** The modal closed: Close, Escape, the backdrop, or Open as tab. */
  | { type: 'task-modal-close'; project: string; key: string };

/** What the page hears when the task it asked for couldn't open (T-162), so its modal says why, with Try again. */
export const MODAL_FAILED = 'task-modal-failed';

/** Why a task's modal didn't open when its project isn't open here (T-162). */
export const NO_PROJECT = 'Its project isn\'t open in the Command Center any more.';

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
    case 'analysis-answer': case 'update-ask': case 'review-file': case 'criteria-draft': case 'criteria-update': case 'criteria-sheet': case 'verify-run': case 'verify-clear': case 'plan-choose': case 'plan-approve': case 'plan-split':
    case 'manifest-build': case 'manifest-retrieve': case 'manifest-commit': case 'manifest-file': case 'manifest-diff': case 'conversation-open': case 'page-width':
    case 'plan-watch': case 'plan-stop': case 'blocked-answer': return mine(m.project, m.task);
    case 'update-post': case 'update-discard': return mine(m.project, taskOf(m.id));
    case 'run': return commands.has(m.command) && mine(m.ref.project ?? '', m.ref.task ?? '');
    case 'toolbar': return commands.has(m.command) && m.arg !== undefined;
    default: return false;
  }
}

export const area: ModelArea = {
  messages: {
    'task-modal-open': (x) => short(x.project, 4096) && short(x.key, 100) && KEY.test(x.key as string) && (x.tracker === undefined || x.tracker === null || Number.isInteger(x.tracker)) && (x.part === undefined || (typeof x.part === 'string' && TASK_PART.test(x.part))) && (x.title === undefined || short(x.title, 1000)),
    'task-modal-close': (x) => short(x.project, 4096) && short(x.key, 100) && KEY.test(x.key as string),
  },
};
