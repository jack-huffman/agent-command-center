// A review in the Command Center's output panel (T-63): a click on a finding's file and line opens it in the
// task's checkout, as the task page's does (T-53). A task open in the modal over the board takes its own
// first (GH-158); this takes the panel's.

import type { ExtensionArea } from './area.ts';
import { openReviewFile } from './ticket.ts';

export const area: ExtensionArea = {
  register({ hub, receive }) {
    receive('review-file', (m) => {
      // Only a project open in this window: the path is checked against its task's checkout.
      if (!hub.project(m.project)) return;
      const key = m.task.toUpperCase();
      void openReviewFile(key, hub.ledger(m.project)?.tasks.find((t) => t.id === key)?.run?.worktree, m.file, m.line);
    });
  },
};
