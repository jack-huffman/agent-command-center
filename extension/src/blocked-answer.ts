// A blocked banner's answer (T-168): the person picks one of the blocked note's options, or writes their own, on the
// task's page, and it goes to the builder's own session, resumed with the rules it was dispatched with, as the Agent
// panel's reply does (D-060). Where its builder can't take one, the page already says why; this says it again.
import type { ExtensionArea } from './area.ts';
import { answerSession, blockedReply } from './model/banners.ts';

export const area: ExtensionArea = {
  register({ hub, tickets, pages }) {
    tickets.answerBlocked = async (root, id, text) => {
      const task = hub.ledger(root)?.tasks.find((t) => t.id === id.toUpperCase());
      if (!task) return 'That task isn\'t in its project\'s tasks any more.';
      if (task.state !== 'blocked') return 'It isn\'t blocked any more.';
      const s = answerSession(task, root, hub.agents);
      if (!s) return blockedReply(task).why;
      return pages.send(s, text);
    };
  },
};
