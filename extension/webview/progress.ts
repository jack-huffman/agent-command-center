// In progress's machine line, at the top of its list in the detail its card opens on the Overview (T-36).

import type { ProgressModel } from '../src/progress.ts';
import { el, status } from './dom.ts';

export { answerHere } from './detail.ts';

/** The machine's line (D-092): heavy-check slots, builders and load, each a state with its word; null with none. */
export function machineLine(p: ProgressModel): HTMLElement | null {
  return p.machine.length ? el('div', 'machine-line', ...p.machine.map((c) => Object.assign(status(c.look), { title: c.tip }))) : null;
}
