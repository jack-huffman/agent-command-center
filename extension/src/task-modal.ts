// A task opened from the Tasks board, in a modal over the board (GH-158). The ticket controller draws it
// on the Command Center's tab and handles what it sends, as it does for a task's own tab; this wires them.

import type { ExtensionArea } from './area.ts';

export const area: ExtensionArea = {
  register({ hub, panels, tickets, receive }) {
    panels.over({
      take: (m) => tickets.fromModal(m),
      ready: () => tickets.modalReady(),
      close: () => tickets.closeModal(),
    });
    receive('task-modal-open', (m) => { if (hub.project(m.project)) tickets.peek(panels, m.project, m.tracker, m.key, m.part); });
    receive('task-modal-close', (m) => tickets.closeModal(m.project, m.key));
  },
};
