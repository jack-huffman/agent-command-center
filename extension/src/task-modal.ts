// A task opened from the Tasks board, in a modal over the board (GH-158). The ticket controller draws it
// on the Command Center's tab and handles what it sends, as it does for a task's own tab; this wires them.

import type { ExtensionArea } from './area.ts';
import { MODAL_FAILED } from './ticket.ts';

/** Why a task's modal didn't open when its project isn't open here (T-162). */
export const NO_PROJECT = 'Its project isn\'t open in the Command Center any more.';

export const area: ExtensionArea = {
  register({ hub, panels, tickets, receive }) {
    panels.over({
      take: (m) => tickets.fromModal(m),
      ready: () => tickets.modalReady(),
      close: () => tickets.closeModal(),
    });
    // A project that's gone answers too (T-162): the modal that opened at the click says why, with Try again.
    receive('task-modal-open', (m) => {
      if (hub.project(m.project)) tickets.peek(panels, m.project, m.tracker, m.key, m.part);
      else panels.reply({ type: MODAL_FAILED, project: m.project, key: m.key.toUpperCase(), why: NO_PROJECT });
    });
    receive('task-modal-close', (m) => tickets.closeModal(m.project, m.key));
  },
};
