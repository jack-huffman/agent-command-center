// Dispatch's sheet (D-168): Dispatch, and the commands kept for one release, open one sheet over the page
// that asked, which asks for the model, the effort and where the builder runs. A task's own tab and the
// modal over the board show it over themselves; anything else, such as the sidebar, a notice or a key
// binding, shows it over the Command Center, opened first when it's closed.
import type { BuilderPlace } from '../../packages/core/src/config.ts';
import type { Hub } from './hub.ts';
import { dispatchSheet, type SheetInput } from './model/dispatch-sheet.ts';
import type { Panels } from './panels.ts';

/** The message the page opens the sheet on (webview/dispatch-sheet.ts). */
export const SHEET_MESSAGE = 'dispatch-sheet';

/** What opened the sheet: Dispatch anyway (D-093), or a place asked for, as Dispatch to the cloud asks. */
export interface SheetAsk { anyway?: boolean; where?: BuilderPlace }

/** The sheet's input for a task, from the hub as it is now. Null when its project or task isn't there. */
export function sheetInput(hub: Pick<Hub, 'project' | 'taskRows'>, root: string, id: string, ask: SheetAsk = {}): SheetInput | null {
  const project = hub.project(root);
  const row = project ? hub.taskRows(root).find((t) => t.id === id) : undefined;
  if (!project || !row) return null;
  return { project: root, row, builder: project.agents.builder, config: project.config, ...ask };
}

/**
 * Opens the sheet for a task. `say` posts to the page that asked, a task's tab or the Command Center under
 * the modal; without it, the Command Center shows it, and opens first when it's closed (Panels.tell). False
 * when the task isn't there to dispatch.
 */
export function openSheet(hub: Pick<Hub, 'project' | 'taskRows'>, panels: Pick<Panels, 'tell'>, root: string, id: string, ask: SheetAsk = {}, say?: (msg: Record<string, unknown>) => void): boolean {
  const i = sheetInput(hub, root, id, ask);
  if (!i) return false;
  const msg = { type: SHEET_MESSAGE, sheet: dispatchSheet(i) };
  if (say) say(msg);
  else void panels.tell(msg);
  return true;
}
