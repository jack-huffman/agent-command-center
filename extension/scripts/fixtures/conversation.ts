/**
 * A plan's conversation in its own panel (T-111): ACME-21 before its plan, at the start and mid-conversation,
 * ACME-21's Talk it through once it has one, and its page's one line, as the screenshot run draws them.
 */
import type { PlanTalk } from '../../../packages/core/src/plan-talk.ts';
import { type ConversationModel, conversationModel } from '../../src/model/conversation.ts';
import { type Making, ticketTalk } from '../../src/model/talk.ts';
import type { TicketModel } from '../../src/model/task-page.ts';
import { samplePlan } from './analysis.ts';
import { MIN, ROOT } from './shared.ts';
import { sampleTicket } from './task-page.ts';
import { sampleTalk, sampleTalkTicket } from './talk.ts';

/** ACME-21's title, as its page has it. */
const title = (now: number): string => sampleTicket(now, 'ACME-21').title;

/**
 * ACME-21's conversation before its plan: what the person is thinking, the planning agent's answer with what
 * it's unsure of and two questions, the person's answer to them, and, with `answered`, the agent's reply.
 * `earlier` moves it that many minutes back, before a later talk.
 */
export function sampleOpening(now: number, answered = false, earlier = 0): PlanTalk {
  const at = (ago: number) => new Date(now - (ago + earlier) * MIN).toISOString();
  return {
    v: 1, task: 'ACME-21', turns: [
      { id: 't1', who: 'you', by: 'human:jordan', at: at(9), version: 0, text: 'Reps forget the contact roles, and the pipeline report counts Decision Makers. I want the primary contact to get that role on every conversion, from now on. I\'m not sure about the older opportunities: Pat said leave them.' },
      {
        id: 't2', who: 'agent', by: 'analyst:ACME-21', at: at(8), version: 0, sessionId: 'an-acme-21',
        text: 'You want each converted lead\'s opportunity to get a Decision Maker contact role, from now on, so the pipeline report counts it. Pat Lee\'s comment and Jordan Kim\'s agree: no backfill in this ticket.',
        unsure: ['Whether a lead converted by an integration user should get the role too', 'Which contact is primary when a lead converts into an account that has several'],
        asks: ['Should integration users\' conversions get the role too?', 'If the account already has a Decision Maker, keep it, or add another?'],
      },
      { id: 't3', who: 'you', by: 'human:jordan', at: at(3), version: 0, text: 'Yes, integration users too: most of our leads come from the web form. Keep an existing Decision Maker and add none.' },
      ...(answered ? [{ id: 't4', who: 'agent' as const, by: 'analyst:ACME-21', at: at(2), version: 0, sessionId: 'an-acme-21', text: 'Clear: every conversion, integration users too, and never a second Decision Maker. I have no more questions. Draft the plan when you\'re ready.', unsure: [], asks: [] }] : []),
    ],
  };
}

/** A conversation's panel for ACME-21 with no plan yet: its talk, whether a reply is on its way, and what is being made. */
function openingPanel(now: number, talk: PlanTalk, running: boolean, making: Making | null = null): ConversationModel {
  return conversationModel({
    project: ROOT, key: 'ACME-21', taskTitle: title(now),
    talk: ticketTalk({ task: { id: 'ACME-21', state: 'todo' }, analysis: null, analyzing: false, talk, running, open: [], ref: { project: ROOT, task: 'ACME-21' }, making }),
  });
}

/** The panel as Make a plan opens it (T-111): its question, the box, Draft the plan off with why, and Skip to the plan. */
export const sampleConversationStart = (now: number): ConversationModel => openingPanel(now, { v: 1, task: 'ACME-21', turns: [] }, false);

/** The panel mid-conversation beside ACME-21's page: the agent's questions answered, and its reply on its way. */
export const sampleConversation = (now: number): ConversationModel => openingPanel(now, sampleOpening(now), true);

/** The panel once the agent has no more questions (the behaviour case): Draft the plan is on. */
export const sampleConversationReady = (now: number): ConversationModel => openingPanel(now, sampleOpening(now, true), false);

/** The panel after Draft the plan, while its ticket is read. */
export const sampleConversationDrafting = (now: number): ConversationModel => openingPanel(now, sampleOpening(now, true), false, 'reading');

/**
 * ACME-21's Talk it through in its panel, once v2 is made from the conversation and approved: the opening, the
 * talk on v1 with its proposals, what changed, and the next message waiting for its reply.
 */
export function sampleConversationTalk(now: number): ConversationModel {
  const page = sampleTalkTicket(now, true);
  const opening = sampleOpening(now, true, 60);
  const later = sampleTalk(now);
  const talk: PlanTalk = { v: 1, task: 'ACME-21', turns: [...opening.turns, ...later.turns].map((t, i) => ({ ...t, id: `t${i + 1}` })) };
  const at = (ago: number) => new Date(now - ago * MIN).toISOString();
  const plan = samplePlan(now, 'approved');
  talk.turns.push(
    { id: `t${talk.turns.length + 1}`, who: 'plan', by: 'Acme · ACME-21 Lead conversion · analysis', at: at(5), version: 2, text: 'Made v2 from this conversation.', recorded: plan.changes ?? [] },
    { id: `t${talk.turns.length + 2}`, who: 'you', by: 'human:jordan', at: at(1), version: 2, about: { ref: 'r2', kind: 'risk', text: 'Sharing: integration users convert leads without access to every contact' }, text: 'Which integration users convert leads today?' },
  );
  return conversationModel({
    project: ROOT, key: 'ACME-21', taskTitle: page.title,
    talk: ticketTalk({ task: { id: 'ACME-21', state: 'todo' }, analysis: plan, analyzing: false, talk, running: true, open: [], ref: { project: ROOT, task: 'ACME-21' } }),
  });
}

/** ACME-21's page before its plan, with its conversation's one line and Open conversation, never the turns. */
export function sampleConversationTicket(now: number): TicketModel {
  const t = sampleTicket(now, 'ACME-21', false, null, null, 'none');
  return { ...t, talk: openingPanel(now, sampleOpening(now, true), false).talk };
}
