// The task sheet (T-74): Add task and Edit open one sheet over the page that asked, as Dispatch's does
// (D-168). A task's own tab and the modal over the board show it over themselves; anything else, such as
// the sidebar, the palette or a key binding, shows it over the Command Center, opened first when it's closed.
import type { Hub } from './hub.ts';
import { TASK_SHEET_MESSAGE, taskSheet, type TaskSheetInput } from './model/task-sheet.ts';
import type { Panels } from './panels.ts';

/** The sheet's input for a project, and the task it edits when one is named, from the hub as it is now. Null when either isn't there. */
export function taskSheetInput(hub: Pick<Hub, 'project' | 'ledger'>, root: string, id: string | null): TaskSheetInput | null {
  const project = hub.project(root);
  if (!project) return null;
  const task = id === null ? null : hub.ledger(root)?.tasks.find((t) => t.id === id.toUpperCase()) ?? null;
  if (id !== null && !task) return null;
  return { project: root, name: project.name, environments: project.config.environments, task };
}

/**
 * Opens the sheet for a new task in a project, or for editing a task. `say` posts to the page that asked;
 * without it, the Command Center shows it (Panels.tell). False when the project or task isn't there, or
 * the task can't be edited now.
 */
export function openTaskSheet(hub: Pick<Hub, 'project' | 'ledger'>, panels: Pick<Panels, 'tell'>, root: string, id: string | null, say?: (msg: Record<string, unknown>) => void): boolean {
  const i = taskSheetInput(hub, root, id);
  const sheet = i ? taskSheet(i) : null;
  if (!sheet) return false;
  const msg = { type: TASK_SHEET_MESSAGE, sheet };
  if (say) say(msg);
  else void panels.tell(msg);
  return true;
}
