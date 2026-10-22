/** Talk it through (T-98): ACME-21's conversation with its planning agent, as acc keeps it, for its page. */
import type { PlanTalk } from '../../../packages/core/src/plan-talk.ts';
import { ticketTalk } from '../../src/model/talk.ts';
import type { TicketModel } from '../../src/model/task-page.ts';
import { sampleAnalyses, samplePlan } from './analysis.ts';
import { MIN, ROOT } from './shared.ts';
import { sampleTicket } from './task-page.ts';

/**
 * ACME-21's conversation: the person asks about Backfill too, quoted; the planning agent answers from the org
 * and proposes two changes, one used; then a Claude Code session the person opened, and what it recorded.
 */
export function sampleTalk(now: number): PlanTalk {
  const at = (ago: number) => new Date(now - ago * MIN).toISOString();
  return {
    v: 1, task: 'ACME-21', turns: [
      {
        id: 't1', who: 'you', by: 'human:jordan', at: at(16), version: 1,
        about: { ref: 'd2.b', kind: 'option', text: 'Which converted leads get roles: Backfill too. A one-off batch adds roles to the opportunities converted before.' },
        text: 'The quarterly pipeline report compares this quarter with the last. Would leaving the older opportunities out break that?',
      },
      {
        id: 't2', who: 'agent', by: 'Acme · ACME-21 Lead conversion · analysis', at: at(14), version: 1, sessionId: 'an-acme-21',
        text: 'Yes, for that one report. Pipeline by Role groups by contact role, so the 3,400 older opportunities would show no role. Only 600 of them are still open, and the quarter-on-quarter view reads open deals only.',
        proposals: [
          { id: 'p1', kind: 'choose', decision: 'd2', option: 'Open deals only', text: '', why: 'It fixes the quarterly report with a sixth of the writes.' },
          { id: 'p2', kind: 'note', text: 'Step 3: add a test that a closed opportunity gets no role.', why: 'It pins the edge of the backfill.', used: { by: 'human:jordan', at: at(12) } },
        ],
      },
      {
        id: 't3', who: 'claude-code', by: 'human:jordan', at: at(8), version: 1, text: 'Opened the plan in Claude Code.', sessionId: 'cc-acme-21',
        recorded: ['Note on the plan: Run the backfill batch outside business hours.'],
      },
    ],
  };
}

/**
 * ACME-21's page with its conversation, its notes on the plan, and the next message about an option, quoted.
 * Later, as the screenshot run draws it: v2 was made from the conversation and approved, says what changed,
 * and the person's next message waits for the planning agent's reply.
 */
export function sampleTalkTicket(now: number, later = false): TicketModel {
  const t = later ? sampleTicket(now, 'ACME-21', false, null, null, 'approved') : sampleTicket(now, 'ACME-21');
  const at = (ago: number) => new Date(now - ago * MIN).toISOString();
  const notes = [{ text: 'Step 3: add a test that a closed opportunity gets no role.', by: 'jordan', at: at(12) }, { text: 'Run the backfill batch outside business hours.', by: 'jordan', at: at(6) }];
  const plan = later ? samplePlan(now, 'approved') : sampleAnalyses(now)['ACME-21']!;
  const talk = sampleTalk(now);
  if (later) {
    talk.turns.push(
      { id: 't4', who: 'plan', by: 'Acme · ACME-21 Lead conversion · analysis', at: at(5), version: 2, text: 'Made v2 from this conversation.', recorded: plan.changes ?? [] },
      { id: 't5', who: 'you', by: 'human:jordan', at: at(1), version: 2, about: { ref: 'r2', kind: 'risk', text: 'Sharing: integration users convert leads without access to every contact' }, text: 'Which integration users convert leads today?' },
    );
  }
  return {
    ...t,
    analysis: t.analysis && { ...t.analysis, planState: t.analysis.planState && { ...t.analysis.planState, notes } },
    talk: ticketTalk({ task: { id: 'ACME-21', state: 'todo' }, analysis: plan, analyzing: false, talk, running: later, open: [], ref: { project: ROOT, task: 'ACME-21' } }),
  };
}

/**
 * ACME-21's page once its plan is v2 and approved, with the conversation had on v2 and no reply on its way:
 * Use this on the agent's first proposal changes an approved choice, so it asks first (the behaviour case).
 */
export function sampleTalkApproved(now: number): TicketModel {
  const talk = sampleTalk(now);
  for (const t of talk.turns) t.version = 2;
  return {
    ...sampleTicket(now, 'ACME-21', false, null, null, 'approved'),
    talk: ticketTalk({ task: { id: 'ACME-21', state: 'todo' }, analysis: samplePlan(now, 'approved'), analyzing: false, talk, running: false, open: [], ref: { project: ROOT, task: 'ACME-21' } }),
  };
}

/** The page's memory for it: the next message's words, about the first option of the first choice. */
export const TALK_STATE = {
  drafts: {
    [`talk:${ROOT}#ACME-21:about`]: 'd1.a\nWhere the contact roles are made: In LeadConversionHandler. The handler inserts the roles after it makes the opportunity.',
    [`talk:${ROOT}#ACME-21:send`]: 'If the handler grows, can an admin still turn the roles off without a deploy?',
  },
};
