/**
 * ACME-12's Changes tab with its deploy (T-158), on a path of Dev, QA, UAT and Production, with Hotfix a step off
 * QA: before there's work, with its work in review, merged and deployed to QA with each environment read (Dev
 * and QA deployed, UAT partly deployed, Production can't tell), deployed to UAT with steps left to do by hand
 * and Production not deployed, Deploy… open on its three environments, and an agent deploying to UAT.
 */
import { openSteps } from '../../../packages/core/src/change-steps.ts';
import type { Environment } from '../../../packages/core/src/config.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import type { OutsideState } from '../../../packages/core/src/outside-changes.ts';
import type { RecordChange } from '../../../packages/core/src/records.ts';
import type { EnvWhere, TicketWhere, WhereState } from '../../../packages/core/src/where-kept.ts';
import { ticketChanges } from '../../src/model/changes.ts';
import { ticketRecords } from '../../src/model/record-changes.ts';
import type { TicketModel } from '../../src/model/task-page.ts';
import { deployBlockers, ticketDeploy } from '../../src/model/ticket-deploy.ts';
import { MIN, ROOT } from './shared.ts';
import { sampleTicket } from './task-page.ts';

export type DeploySample = 'before' | 'work' | 'deployed' | 'steps' | 'pick' | 'busy';

const D = 'force-app/main/default';
const env = (name: string, promotesTo: string[], more: Partial<Environment> = {}): Environment => ({ name, branch: name.toLowerCase(), type: 'sandbox' as Environment['type'], org: `acme-${name.toLowerCase()}`, default: false, protected: false, promotesTo, ...more });
export const ENVS = [env('Dev', ['qa'], { default: true }), env('QA', ['uat', 'hotfix']), env('UAT', ['production']), env('Hotfix', []), env('Production', [], { type: 'production' as Environment['type'], protected: true, org: 'acme-prod' })];
export const CONFIG = { profile: 'salesforce' as const, environments: ENVS, github: { repo: 'acme/service', account: 'jordan-kim' } };

const PLAN = [`${D}/classes/CaseRouting.cls`, `${D}/classes/CaseRoutingTest.cls`, `${D}/flows/Case_Escalation.flow-meta.xml`, `${D}/objects/Case/fields/Tier__c.field-meta.xml`];
const MADE = [`${D}/classes/CaseRouting.cls`, `${D}/classes/CaseRouting.cls-meta.xml`, `${D}/classes/CaseRoutingTest.cls`, `${D}/flows/Case_Escalation.flow-meta.xml`,
  `${D}/objects/Case/fields/Tier__c.field-meta.xml`, `${D}/permissionsets/Support_Agent.permissionset-meta.xml`, `${D}/classes/LegacyRouting.cls`];
const tier: RecordChange = { object: 'Routing_Tier__c', action: 'create', match: [{ field: 'Name', value: 'Premium' }], fields: [{ field: 'Hours__c', from: null, to: '4' }] };

/** One environment's reading, as acc where keeps it. */
function read(branch: string, state: WhereState, at: string, more: Partial<EnvWhere> = {}): EnvWhere {
  const r = { state, differs: [] as string[], why: null as string | null, at, ...more };
  return { env: branch, name: ENVS.find((e) => e.branch === branch)!.name, ...r, git: r, org: r, leftOut: [], unchecked: [], notes: [], ...more };
}

export function sampleDeployTicket(now: number, which: DeploySample): TicketModel {
  const at = (min: number) => new Date(now - min * MIN).toISOString();
  const m = sampleTicket(now);
  const deployedOnce = which !== 'before' && which !== 'work';
  const inUat = which === 'steps';
  const promotions = [
    ...(deployedOnce ? [{ from: 'dev', to: 'qa', pr: { number: 61, url: 'https://github.com/acme/service/pull/61' }, state: 'merged' as const, at: at(180), mergedAt: at(178) }] : []),
    ...(inUat ? [{ from: 'qa', to: 'uat', pr: { number: 64, url: 'https://github.com/acme/service/pull/64' }, state: 'merged' as const, at: at(25), mergedAt: at(24) }] : []),
  ];
  const outside: OutsideState = {
    changes: [
      { id: 'c1', kind: 'record', detail: tier, why: 'Premium cases route on it', planned: true, actor: 'builder', by: 'builder:ACME-12', at: at(300) },
      // Its first deploy, to QA, kept the class it deletes as a step in each org it reaches.
      ...(deployedOnce ? [{ id: 'c2', kind: 'deletion', detail: { component: 'Apex Class: LegacyRouting', path: `${D}/classes/LegacyRouting.cls` }, why: 'The ticket deletes it, and a deploy never deletes', planned: false, actor: 'human' as const, by: 'human:jordan', at: at(178) }] : []),
    ],
    noted: [], none: [],
    steps: [
      ...(deployedOnce ? [
        { change: 'c1', env: 'qa', org: 'acme-qa', state: 'done' as const, reason: null, by: 'human:jordan', at: at(170), added: at(178) },
        { change: 'c2', env: 'qa', org: 'acme-qa', state: 'done' as const, reason: null, by: 'human:jordan', at: at(168), added: at(178) },
      ] : []),
      ...(inUat ? [
        { change: 'c1', env: 'uat', org: 'acme-uat', state: 'todo' as const, reason: null, by: null, at: null, added: at(24) },
        { change: 'c2', env: 'uat', org: 'acme-uat', state: 'todo' as const, reason: null, by: null, at: null, added: at(24) },
      ] : []),
    ],
  };
  const task = {
    id: 'ACME-12', title: m.title, brief: '', source: { kind: 'jira', key: 'ACME-12', url: null }, environment: 'dev', deps: [], labels: [],
    state: which === 'before' ? 'todo' : which === 'work' ? 'review' : 'done', blocker: null,
    run: which === 'before' ? null : { branch: 'task/ACME-12-premium-escalation' }, pr: deployedOnce ? { number: 58, url: 'u', state: 'merged' } : which === 'work' ? { number: 58, url: 'u', state: 'open' } : null,
    history: [], createdAt: at(600), updatedAt: at(20), promotions, outside,
    deploys: deployedOnce ? [{ env: 'dev', org: 'acme-dev', sha: 'b4d2c0f', at: at(200), jobId: null, paths: [], components: [], verified: 0, tests: null }] : [],
  } as unknown as Task;
  // What acc where last read: each state at least once across the shots, and none before there's work.
  const where: TicketWhere | null = !deployedOnce ? null : {
    v: 1, task: 'ACME-12', envs: [
      read('dev', 'deployed', at(12)), read('qa', 'deployed', at(12)),
      inUat ? read('uat', 'deployed', at(12)) : read('uat', 'partly', at(12), { differs: ['Apex Class: CaseRouting', 'Flow: Case_Escalation'] }),
      inUat ? read('production', 'not-deployed', at(12), { differs: ['Apex Class: CaseRouting', 'Apex Class: CaseRoutingTest', 'Custom Field: Case.Tier__c', 'Flow: Case_Escalation'] })
        : read('production', 'unknown', at(12), { why: 'This machine has no access to Production: acme-prod isn\'t logged in here.' }),
    ],
  };
  const changes = which === 'before'
    ? ticketChanges({ task, profile: 'salesforce', planned: PLAN, live: null })
    : deployedOnce ? ticketChanges({ task: { ...task, changes: { at: at(178), paths: MADE } }, profile: 'salesforce', planned: PLAN, live: null })
      : ticketChanges({ task, profile: 'salesforce', planned: PLAN, live: MADE, deleted: [`${D}/classes/LegacyRouting.cls`] });
  const records = ticketRecords({ task, analysis: null, profile: 'salesforce', environments: ENVS });
  // In review, its validate fails and it conflicts with dev, so Deploy… is off with why; merged, both are behind it.
  const acc = m.acc && deployedOnce ? { ...m.acc, conflicts: null, checks: m.acc.checks.filter((c) => !deployBlockers([c]).length) } : m.acc;
  return {
    ...m, acc, project: ROOT, changes, records,
    deploy: ticketDeploy({ config: CONFIG, task, tasks: [task], deploying: which === 'busy' ? 'uat' : null, failing: deployBlockers(acc?.checks ?? []), conflicts: acc?.conflicts ? 'dev' : null, stepsLeft: openSteps(task).length, where }),
  };
}
