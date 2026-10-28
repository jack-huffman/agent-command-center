/**
 * The Agent panel's states beyond the ticket pages' own (T-142): ACME-12 blocked, with its builder gone, and
 * blocked while its builder's session still shows Working, which the panel says in one line. The model is
 * ACME-12's with its task state, look, blocker and actions as a blocked task's, the actions from the card's
 * own list for that state.
 */
import { displayLook } from '../../src/model/shared.ts';
import { checkRows } from '../../src/model/task-page.ts';
import { cardActions } from '../../src/model/cards.ts';
import type { TicketModel } from '../../src/model/task-page.ts';
import { sampleHub } from './hub.ts';
import { ROOT } from './shared.ts';
import { sampleTicket } from './task-page.ts';

export type AgentPanelSample = 'blocked' | 'disagree' | 'waits' | 'failed';

export function sampleAgentPanelTicket(now: number, which: AgentPanelSample): TicketModel {
  // ACME-19 in review with one more check, failed, so the behaviour run's summary case has a failure of its own to name.
  if (which === 'failed') {
    const r = sampleTicket(now, 'ACME-19');
    return { ...r, acc: { ...r.acc!, checks: [...r.acc!.checks, ...checkRows([{ gate: 'static', status: 'fail', summary: 'Static analysis found 1 severity-2 violation in WelcomeEmailService.cls.' }], r.acc!.branch)] } };
  }
  const m = sampleTicket(now);
  const row = { ...sampleHub(now).taskRows(ROOT).find((r) => r.id === 'ACME-12')!, state: 'blocked' as const, display: 'blocked' as const };
  const acc = m.acc!;
  const blocked = {
    ...acc, state: 'blocked', look: displayLook('blocked'),
    blocker: 'The checks error on validate: the Acme Dev login has expired. Log in to Acme Dev again, then run the checks.',
    agent: which === 'disagree' ? { label: 'Working', icon: 'sync~spin', tone: 'blue' as const } : null,
    actions: cardActions(row, { project: ROOT, task: 'ACME-12' }).filter((a) => !['acc.task.show', 'acc.task.openTicket', 'acc.task.analyze', 'acc.task.watchAnalysis'].includes(a.command)),
  };
  // Blocked and also waiting on two tasks: the blocker is the page's notice, the tasks it waits on are a row of Details.
  return { ...m, acc: which === 'waits' ? { ...blocked, waitingOn: ['ACME-19', 'ACME-35'] } : blocked };
}
