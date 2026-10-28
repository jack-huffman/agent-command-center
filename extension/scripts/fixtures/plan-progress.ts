/**
 * The planning agent's progress (T-131), as the screenshot run draws it: ACME-21's conversation panel after Draft the
 * plan, mid-plan with its steps; the same once it hasn't moved for six minutes, with Watch its session and Stop; and
 * ACME-21's page with the progress in its plan section. The steps come from a transcript's lines, as the extension reads them.
 */
import { feedLines, newFeed, type PlanStep } from '../../src/logic/plan-progress.ts';
import { type ConversationModel, conversationModel } from '../../src/model/conversation.ts';
import { type PlanProgress, planProgress } from '../../src/model/plan-progress.ts';
import { ticketTalk } from '../../src/model/talk.ts';
import { ticketAnalysis, type TicketModel } from '../../src/model/task-page.ts';
import { sampleHub } from './hub.ts';
import { sampleOpening } from './conversation.ts';
import { ROOT } from './shared.ts';
import { sampleTicket } from './task-page.ts';

const SEC = 1_000;

/** A transcript's assistant record with one tool call, `ago` seconds before now. */
const use = (now: number, ago: number, name: string, input: Record<string, unknown>): string =>
  JSON.stringify({ type: 'assistant', timestamp: new Date(now - ago * SEC).toISOString(), cwd: ROOT, message: { content: [{ type: 'tool_use', id: `u${ago}`, name, input }] } });

/** ACME-21's planning agent's steps, from its transcript: the ticket, the code, a command and a query. `quiet` moves them back. */
export function sampleSteps(now: number, quiet = 0): { steps: PlanStep[]; movedAt: number | null } {
  const at = (s: number) => s + quiet;
  const feed = feedLines(newFeed(now - (190 + quiet) * SEC, [ROOT], 'plan'), [
    use(now, at(170), 'Glob', { pattern: 'force-app/**/LeadConversion*' }),
    use(now, at(150), 'Read', { file_path: `${ROOT}/force-app/main/default/classes/LeadConversionHandler.cls` }),
    use(now, at(120), 'Grep', { pattern: 'OpportunityContactRole', path: ROOT }),
    use(now, at(80), 'Bash', { command: 'git log --oneline -20 -- force-app/main/default/classes', description: 'Recent changes to classes' }),
    use(now, at(40), 'Bash', { command: 'sf data query --query "SELECT Id FROM OpportunityContactRole LIMIT 5"' }),
    use(now, at(12), 'Read', { file_path: `${ROOT}/force-app/main/default/classes/LeadConversionHandlerTest.cls` }),
  ]);
  return { steps: feed.steps, movedAt: feed.movedAt };
}

/** The progress three minutes into ACME-21's plan; `stalled`, six minutes since it last moved, with Watch its session and Stop. */
export function sampleProgress(now: number, stalled = false): PlanProgress {
  const quiet = stalled ? 360 : 0;
  const { steps, movedAt } = sampleSteps(now, quiet);
  return planProgress({ job: 'plan', phase: 'working', startedAt: now - (190 + quiet) * SEC, steps, movedAt, found: true, now, typicalMs: 4 * 60 * SEC, watch: true, stop: true });
}

/** ACME-21's conversation panel after Draft the plan: its talk, and the planning agent's progress. */
export function sampleProgressPanel(now: number, stalled = false): ConversationModel {
  return conversationModel({
    project: ROOT, key: 'ACME-21', taskTitle: sampleTicket(now, 'ACME-21').title,
    talk: ticketTalk({ task: { id: 'ACME-21', state: 'todo' }, analysis: null, analyzing: true, talk: sampleOpening(now, true), running: false, open: [], ref: { project: ROOT, task: 'ACME-21' }, making: 'planning', progress: sampleProgress(now, stalled) }),
  });
}

/** ACME-21's page while its plan is made: the plan section Making a plan, with the progress under its note. */
export function sampleProgressTicket(now: number): TicketModel {
  const t = sampleTicket(now, 'ACME-21', false, null, null, 'none');
  const row = { ...sampleHub(now).taskRows(ROOT).find((r) => r.id === 'ACME-21')!, analysis: null, analyzing: { sessionId: 'an-acme-21', name: 'Acme · ACME-21 Lead conversion · analysis' } };
  return { ...t, analysis: ticketAnalysis(row, null, { project: ROOT, task: 'ACME-21' }), talk: sampleProgressPanel(now).talk };
}
