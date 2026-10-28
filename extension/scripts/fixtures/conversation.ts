/**
 * A plan's conversation in its own panel (T-111): ACME-21 before its plan, at the start, with the agent's
 * questions asked one at a time (T-113) and mid-conversation, ACME-21's Talk it through once it has one, long
 * and folded, and its page's one line, as the screenshot run draws them.
 */
import type { PlanTalk } from '../../../packages/core/src/plan-talk.ts';
import { answersText, type TalkAsk } from '../../../packages/core/src/talk-questions.ts';
import { type ConversationModel, conversationModel } from '../../src/model/conversation.ts';
import { type Making, ticketTalk } from '../../src/model/talk.ts';
import type { TicketModel } from '../../src/model/task-page.ts';
import { samplePlan } from './analysis.ts';
import { MIN, ROOT } from './shared.ts';
import { sampleTicket } from './task-page.ts';
import { sampleTalk, sampleTalkTicket } from './talk.ts';

/** ACME-21's title, as its page has it. */
const title = (now: number): string => sampleTicket(now, 'ACME-21').title;

/** The planning agent's three questions before ACME-21's plan (T-113): each with why, its answers, the suggestion first. */
export const OPENING_QUESTIONS: TalkAsk[] = [
  { question: 'Should integration users\' conversions get the role too?', why: 'Most leads come in through the web form, which an integration user converts.', options: ['Yes, them too', 'No, people only'] },
  { question: 'If the account already has a Decision Maker, what then?', why: 'Two Decision Makers would count the deal twice in the pipeline report.', options: ['Keep it, add none', 'Add another', 'Replace it'] },
  { question: 'Which contact is primary when the account has several?', why: 'The role goes on one contact only.', options: ['The lead\'s own contact', 'The account\'s main contact'] },
];

/**
 * ACME-21's conversation before its plan: what the person is thinking, the planning agent's short answer with
 * three questions, then, with `asked` false, the person's answers to them, sent together, and with `answered`, the
 * agent's reply. `earlier` moves it that many minutes back, before a later talk.
 */
export function sampleOpening(now: number, answered = false, earlier = 0, asked = false): PlanTalk {
  const at = (ago: number) => new Date(now - (ago + earlier) * MIN).toISOString();
  return {
    v: 1, task: 'ACME-21', turns: [
      { id: 't1', who: 'you', by: 'human:jordan', at: at(9), version: 0, text: 'Reps forget the contact roles, and the pipeline report counts Decision Makers. I want the primary contact to get that role on every conversion, from now on. I\'m not sure about the older opportunities: Pat said leave them.' },
      {
        id: 't2', who: 'agent', by: 'analyst:ACME-21', at: at(8), version: 0, sessionId: 'an-acme-21',
        text: 'You want each converted lead\'s opportunity to get a Decision Maker contact role, from now on, so the pipeline report counts it. Pat Lee\'s comment and Jordan Kim\'s agree: no backfill in this ticket.',
        questions: OPENING_QUESTIONS,
      },
      ...(asked ? [] : [{ id: 't3', who: 'you' as const, by: 'human:jordan', at: at(3), version: 0, text: answersText(OPENING_QUESTIONS, [{ option: 0 }, { option: 0 }, null]) }]),
      ...(answered && !asked ? [{ id: 't4', who: 'agent' as const, by: 'analyst:ACME-21', at: at(2), version: 0, sessionId: 'an-acme-21', text: 'Clear: every conversion, integration users too, and never a second Decision Maker. I have no more questions. Draft the plan when you\'re ready.', questions: [] }] : []),
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

/** The panel with the agent's three questions waiting (T-113): the card asks them one at a time. */
export const sampleConversationQuestions = (now: number): ConversationModel => openingPanel(now, sampleOpening(now, false, 0, true), false);

/**
 * The card's memory part-way (T-113, T-130): the first question answered with its suggestion, the second on show
 * at its second answer, picked, and the third not answered yet.
 */
export const QUESTIONS_STATE = {
  opened: [] as string[],
  drafts: { [`askq:${ROOT}#ACME-21:t2:at`]: '1', [`askq:${ROOT}#ACME-21:t2:pick:0`]: 'o0', [`askq:${ROOT}#ACME-21:t2:pick:1`]: 'o1' },
};

/** The card's memory at the review (T-130): the first answered with its suggestion, the second skipped, the third in the person's own words. */
export const REVIEW_STATE = {
  opened: [`askq:${ROOT}#ACME-21:t2:skip:1`],
  drafts: {
    [`askq:${ROOT}#ACME-21:t2:at`]: 'review', [`askq:${ROOT}#ACME-21:t2:pick:0`]: 'o0',
    [`askq:${ROOT}#ACME-21:t2:pick:2`]: 'own', [`askq:${ROOT}#ACME-21:t2:own:2`]: 'The lead\'s own contact, unless it has none',
  },
};

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

/**
 * ACME-21's Talk it through, long (T-113): the opening and the talk on v1 fold under "Earlier in this
 * conversation"; the latest exchange shows, its long reply folded with Show more, its proposals one line each,
 * and its question put aside (LONG_STATE).
 */
export function sampleConversationLong(now: number): ConversationModel {
  const opening = sampleOpening(now, true, 60);
  const later = sampleTalk(now);
  const talk: PlanTalk = { v: 1, task: 'ACME-21', turns: [...opening.turns, ...later.turns].map((t, i) => ({ ...t, id: `t${i + 1}` })) };
  const at = (ago: number) => new Date(now - ago * MIN).toISOString();
  const plan = samplePlan(now, 'approved');
  const n = talk.turns.length;
  talk.turns.push(
    { id: `t${n + 1}`, who: 'plan', by: 'Acme · ACME-21 Lead conversion · analysis', at: at(5), version: 2, text: 'Made v2 from this conversation.', recorded: plan.changes ?? [] },
    { id: `t${n + 2}`, who: 'you', by: 'human:jordan', at: at(3), version: 2, text: 'Which integration users convert leads today, and do they see every contact?' },
    {
      id: `t${n + 3}`, who: 'agent', by: 'Acme · ACME-21 Lead conversion · analysis', at: at(2), version: 2, sessionId: 'an-acme-21',
      text: [
        'Two integration users convert leads today: Web Form Integration converts about 80% of them, and Marketo Sync the rest.',
        'Web Form Integration runs with the Integration Profile, which has View All on Contact, so it sees every contact on the account. Marketo Sync runs with a permission set that grants Read on Contact through the sharing rules only, so it can miss contacts owned by the enterprise team.',
        'When it misses one, LeadConversionHandler finds no Decision Maker and adds a second one, which the report then counts twice.',
        'Two ways out: give Marketo Sync View All on Contact, or have the handler run the check without sharing.',
        'The second keeps the change inside the ticket, and the handler already runs without sharing for the opportunity insert, so it\'s one more query in the same class.',
        'Either way, a test with a contact Marketo Sync can\'t see pins it.',
      ].join('\n'),
      proposals: [
        { id: 'p1', kind: 'note', text: 'Step 2: the handler checks for a Decision Maker without sharing.', why: 'Marketo Sync can\'t see every contact, and would add a second Decision Maker.' },
        { id: 'p2', kind: 'note', text: 'Step 3: add a test with a contact Marketo Sync can\'t see.', why: 'It pins the sharing edge.', used: { by: 'human:jordan', at: at(1) } },
      ],
      questions: [{ question: 'Check without sharing, or give Marketo Sync View All?', why: 'View All changes an integration user\'s access.', options: ['Check without sharing', 'Give it View All'] }],
    },
  );
  return conversationModel({
    project: ROOT, key: 'ACME-21', taskTitle: title(now),
    talk: ticketTalk({ task: { id: 'ACME-21', state: 'todo' }, analysis: plan, analyzing: false, talk, running: false, open: [], ref: { project: ROOT, task: 'ACME-21' } }),
  });
}

/** The long conversation's memory (T-113): its question put aside with Escape, as one line. */
export const LONG_STATE = (turn: string) => ({ opened: [`askq:${ROOT}#ACME-21:${turn}:away`] });

/** ACME-21's page before its plan, with its conversation's one line and Open conversation, never the turns. */
export function sampleConversationTicket(now: number): TicketModel {
  const t = sampleTicket(now, 'ACME-21', false, null, null, 'none');
  return { ...t, talk: openingPanel(now, sampleOpening(now, true), false).talk };
}
