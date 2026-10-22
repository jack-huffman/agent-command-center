/**
 * A plan's conversation in its own panel (T-111): a Command Center tab titled "<key> · Plan conversation", beside
 * the task's page. Before there is a plan, it opens with its question, and Draft the plan or Skip to the plan
 * makes one; with a plan, it is Talk it through (T-98). The task page shows one line of it, and Open
 * conversation. Plain data and the messages' checks: no vscode import.
 */

import type { TicketTalk } from './talk.ts';
import { TALK_REF } from './talk.ts';
import { KEY, type ModelArea, short } from './shared.ts';

/** The panel's title, as its tab and its heading say it. */
export const conversationTitle = (key: string): string => `${key} · Plan conversation`;

/** A conversation's panel. */
export interface ConversationModel {
  kind: 'conversation';
  project: string;
  key: string;
  title: string;
  /** The task's own title, under the panel's. */
  taskTitle: string;
  /** The conversation, as the task page's line is drawn from: null once the task is past its build with nothing said. */
  talk: TicketTalk | null;
}

export interface ConversationIn {
  project: string;
  key: string;
  taskTitle: string;
  talk: TicketTalk | null;
}

export function conversationModel(i: ConversationIn): ConversationModel {
  return { kind: 'conversation', project: i.project, key: i.key, title: conversationTitle(i.key), taskTitle: i.taskTitle, talk: i.talk };
}

/** What a page asks for the conversation's panel to quote: a part of the plan, by its reference and words. */
export interface ConversationQuote { ref: string; text: string }

/** The longest quote a page sends with Discuss: a part of the plan's words. */
export const QUOTE_MAX = 4000;

export type Message =
  /** Open conversation, Discuss and Talk it through (T-111): the task's conversation in its panel, with a part of the plan quoted when `about` names one. */
  | { type: 'conversation-open'; project: string; task: string; about?: ConversationQuote }
  /** Draft the plan, or with `skip` Skip to the plan (T-111): the plan made with the conversation, or from the ticket alone. */
  | { type: 'conversation-draft'; project: string; task: string; skip?: true }
  /** How wide a task's page is (T-111), so its conversation opens beside it, or as a tab of its own when that's too narrow. */
  | { type: 'page-width'; project: string; task: string; width: number };

const forTask = (x: Record<string, unknown>): boolean => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string);
const quoteOk = (q: unknown): boolean => {
  const x = q as Record<string, unknown> | null;
  return !!x && typeof x === 'object' && typeof x.ref === 'string' && TALK_REF.test(x.ref) && short(x.text, QUOTE_MAX);
};

export const area: ModelArea = {
  messages: {
    'conversation-open': (x) => forTask(x) && (x.about === undefined || quoteOk(x.about)),
    'conversation-draft': (x) => forTask(x) && (x.skip === undefined || x.skip === true),
    'page-width': (x) => forTask(x) && typeof x.width === 'number' && Number.isFinite(x.width) && x.width >= 0 && x.width < 100_000,
  },
};
