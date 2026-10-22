/**
 * A task's team on its page (T-103), in a Salesforce project: ACME-12 being built, sharing files with two
 * others in flight and two merges behind dev; then ACME-12 up to date with dev, sharing files with no one.
 */
import type { Team } from '../../../packages/core/src/team.ts';
import { ticketTeam } from '../../src/model/team.ts';
import type { TicketModel } from '../../src/model/task-page.ts';
import { sampleTicket } from './task-page.ts';

export type TeamSample = 'shared' | 'alone';

const D = 'force-app/main/default';

/** The merges into dev since ACME-12's branch left it: ACME-16's, and a change made by hand. */
const LANDED: Team['landed'] = [
  { sha: '4c1d9e07a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7', subject: 'Merge ACME-16: Escalate premium cases after one hour', task: 'ACME-16', title: 'Escalate premium cases after one hour', files: [`${D}/classes/CaseRouting.cls`], shares: [`${D}/classes/CaseRouting.cls`] },
  { sha: '9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f', subject: 'Tidy the README', task: null, title: null, files: ['README.md'], shares: [] },
];

export function sampleTeamTicket(now: number, which: TeamSample): TicketModel {
  const m = sampleTicket(now);
  const team: Team = which === 'shared'
    ? {
      task: 'ACME-12', env: 'dev', own: [], landed: LANDED,
      mates: [
        { id: 'ACME-14', title: 'Route web-to-case submissions by product line', state: 'running', environment: 'dev', planned: null, changed: [], shares: [`${D}/classes/CaseRouting.cls`, `${D}/classes/CaseRoutingTest.cls`] },
        { id: 'ACME-19', title: 'Fix the flow that double-sends welcome emails', state: 'rework', environment: 'dev', planned: null, changed: [], shares: [`${D}/workflows/Case.workflow-meta.xml`] },
        { id: 'ACME-21', title: 'Show the renewal date on the account page', state: 'review', environment: 'dev', planned: null, changed: [], shares: [] },
      ],
    }
    : { task: 'ACME-12', env: 'dev', own: [], landed: [], mates: [{ id: 'ACME-21', title: 'Show the renewal date on the account page', state: 'review', environment: 'dev', planned: null, changed: [], shares: [] }] };
  return { ...m, team: ticketTeam({ state: 'running' }, team) };
}
