// A ticket's conversation in its own panel (T-111, T-169): "Discuss <key>" and the task's title at its head, then
// the conversation itself, drawn by talk.ts. The cursor starts in its box when the panel opens.

import type { ConversationModel } from '../src/model/conversation.ts';
import { el, icon } from './dom.ts';
import type { PageArea } from './state.ts';
import { focusTalk, renderConversation } from './talk.ts';

/** The panel draws its first model once: the cursor goes to the box then, and stays where the person puts it after. */
let first = true;

export function renderConversationPage(m: ConversationModel): Node[] {
  if (first) { first = false; focusTalk(); }
  const head = el('header', 'convo-head', el('h1', 'convo-title', icon('comment-discussion'), el('span', '', m.title)), m.taskTitle ? el('p', 'muted convo-task', m.taskTitle) : null);
  if (!m.talk) return [head, el('p', 'muted', 'The Command Center doesn\'t keep this ticket, so there is nothing to discuss yet.')];
  return [head, renderConversation(m.project, m.talk)];
}

export const area: PageArea = {
  views: { conversation: renderConversationPage },
};
