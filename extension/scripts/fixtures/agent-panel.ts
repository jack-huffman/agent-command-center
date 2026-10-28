/**
 * The Agent panel's states beyond the ticket pages' own (T-142): ACME-12 blocked, with its builder gone, and
 * blocked while its builder's session still shows Working, which the panel says in one line. The model is
 * ACME-12's with its task state, look, blocker and actions as a blocked task's, the actions from the card's
 * own list for that state.
 */
import { displayLook } from '../../src/model/shared.ts';
import { cardActions } from '../../src/model/cards.ts';
import type { TicketModel } from '../../src/model/task-page.ts';
import { sampleHub } from './hub.ts';
import { ROOT } from './shared.ts';
import { sampleTicket } from './task-page.ts';

export type AgentPanelSample = 'blocked' | 'disagree';

export function sampleAgentPanelTicket(now: number, which: AgentPanelSample): TicketModel {
  const m = sampleTicket(now);
  const row = { ...sampleHub(now).taskRows(ROOT).find((r) => r.id === 'ACME-12')!, state: 'blocked' as const, display: 'blocked' as const };
  const acc = m.acc!;
  const blocked = {
    ...acc, state: 'blocked', look: displayLook('blocked'),
    blocker: 'The checks error on validate: the Acme Dev login has expired. Log in to Acme Dev again, then run the checks.',
    agent: which === 'disagree' ? { label: 'Working', icon: 'sync~spin', tone: 'blue' as const } : null,
    actions: cardActions(row, { project: ROOT, task: 'ACME-12' }).filter((a) => !['acc.task.show', 'acc.task.openTicket', 'acc.task.analyze', 'acc.task.watchAnalysis'].includes(a.command)),
  };
  return { ...m, acc: blocked };
}
