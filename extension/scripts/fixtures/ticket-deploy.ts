/**
 * ACME-12's Changes tab with its deploy (T-158, T-167), on a path of Dev, QA, UAT and Production, with Hotfix a step
 * off QA. Each row's state is acc's record: before there's work (each not deployed, Check this org off), with its
 * work in review, then merged with Dev deployed by its builder, QA by the deploy guide and UAT's deploy failed, with
 * what Check this org found in QA (matches) and UAT (differs, open); the same with Hotfix's check open on what's
 * missing; every check can't tell, with its reason; in UAT by a merged promotion alone, Dev merged with no deploy,
 * Production's check open on what's missing; Deploy… open on its three environments, Deploy… open with Hotfix off
 * for want of an org, Deploy… off as a dependency is in none of them, QA's Check this org under way, and an agent
 * deploying to UAT.
 * Its Testing tab (T-161): before its builder's deploy to Dev (work); built, in review with that deploy passed, so the
 * tab opens Dev and numbers its builder's steps, three of them with a link to the one component each names; built-off:
 * this machine isn't logged in to acme-dev, and its builder gave no steps.
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
import { testing } from '../../src/model/testing.ts';
import { MIN, ROOT } from './shared.ts';
import { sampleTicket } from './task-page.ts';

export type DeploySample = 'before' | 'work' | 'deployed' | 'not' | 'unknown' | 'steps' | 'pick' | 'pick-off' | 'off' | 'checking' | 'busy' | 'built' | 'built-off';

const D = 'force-app/main/default';
const env = (name: string, promotesTo: string[], more: Partial<Environment> = {}): Environment => ({ name, branch: name.toLowerCase(), type: 'sandbox' as Environment['type'], org: `acme-${name.toLowerCase()}`, default: false, protected: false, promotesTo, ...more });
export const ENVS = [env('Dev', ['qa'], { default: true }), env('QA', ['uat', 'hotfix']), env('UAT', ['production']), env('Hotfix', []), env('Production', [], { type: 'production' as Environment['type'], protected: true, org: 'acme-prod' })];
export const CONFIG = { profile: 'salesforce' as const, environments: ENVS, github: { repo: 'acme/service', account: 'jordan-kim' } };

const PLAN = [`${D}/classes/CaseRouting.cls`, `${D}/classes/CaseRoutingTest.cls`, `${D}/flows/Case_Escalation.flow-meta.xml`, `${D}/objects/Case/fields/Tier__c.field-meta.xml`];
const MADE = [`${D}/classes/CaseRouting.cls`, `${D}/classes/CaseRouting.cls-meta.xml`, `${D}/classes/CaseRoutingTest.cls`, `${D}/flows/Case_Escalation.flow-meta.xml`,
  `${D}/objects/Case/fields/Tier__c.field-meta.xml`, `${D}/permissionsets/Support_Agent.permissionset-meta.xml`, `${D}/classes/LegacyRouting.cls`];
/** How to test it, as ACME-12's builder wrote it in its note (T-161). */
const BUILT_STEPS = [
  'Open the Tier__c field on Case, and check that its values include Premium.',
  'Open a Case with the Premium tier and click Escalate.',
  'The Case goes to the Premium queue. Open Case_Escalation to see the path it took.',
  'Give a user the Support_Agent permission set, and check that they see the Tier field.',
];
const tier: RecordChange = { object: 'Routing_Tier__c', action: 'create', match: [{ field: 'Name', value: 'Premium' }], fields: [{ field: 'Hours__c', from: null, to: '4' }] };

/** One environment's reading, as acc where keeps it. */
function read(branch: string, state: WhereState, at: string, more: Partial<EnvWhere> = {}): EnvWhere {
  const r = { state, differs: [] as string[], why: null as string | null, at, ...more };
  return { env: branch, name: ENVS.find((e) => e.branch === branch)!.name, ...r, git: r, org: r, leftOut: [], unchecked: [], notes: [], ...more };
}

export function sampleDeployTicket(now: number, which: DeploySample): TicketModel {
  const at = (min: number) => new Date(now - min * MIN).toISOString();
  const m = sampleTicket(now);
  const built = which === 'built' || which === 'built-off';
  const deployedOnce = which !== 'before' && which !== 'work' && !built;
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
    state: which === 'before' ? 'todo' : which === 'work' || built ? 'review' : 'done', blocker: null,
    run: which === 'before' ? null : { branch: 'task/ACME-12-premium-escalation', ...(built ? { note: { landed: ['Cases route by tier.'], moved: [], open: [], at: at(30), by: 'builder:ACME-12', ended: 'review', ...(which === 'built' ? { test: BUILT_STEPS } : {}) } } : {}) },
    pr: deployedOnce ? { number: 58, url: 'u', state: 'merged' } : which === 'work' || built ? { number: 58, url: 'u', state: 'open' } : null,
    history: [], createdAt: at(600), updatedAt: at(20), promotions, outside,
    // The deploy guide's deploy to UAT failed (T-167), so its row says so, and why.
    deployFailures: deployedOnce && !inUat ? [{ env: 'uat', org: 'acme-uat', at: at(50), reason: 'The deploy to acme-uat failed (job 0Af7), 1 problem: force-app/main/default/classes/CaseRouting.cls:12: Variable does not exist: Tier__c', by: 'human:jordan', checkId: '0AfU' }] : [],
    deploys: deployedOnce ? [
      ...(inUat ? [] : [{ env: 'dev', org: 'acme-dev', sha: 'b4d2c0f', at: at(200), jobId: null, paths: [], components: [], verified: 0, tests: null }]),
      { env: 'qa', org: 'acme-qa', sha: 'b4d2c0f', at: at(178), jobId: '0Af9', paths: [], components: [], verified: 5, tests: null, by: 'human:jordan', checkId: '0AfQ', pr: { number: 61, url: 'https://github.com/acme/service/pull/61' } },
    ]
      : built ? [{ env: 'dev', org: 'acme-dev', sha: 'b4d2c0f', at: at(35), jobId: '0Af1', paths: MADE.filter((p) => !p.includes('Legacy')), components: [], verified: 5, tests: { names: ['CaseRoutingTest'], outcome: 'pass', ran: 4, failed: 0, coverage: '92%' } }] : [],
  } as unknown as Task;
  // What Check this org last found, a note beside each row it was asked for: none before there's work.
  const where: TicketWhere | null = !deployedOnce ? null : {
    v: 1, task: 'ACME-12', envs: which === 'unknown' ? [
      read('dev', 'unknown', at(12), { why: 'Salesforce didn\'t answer: the retrieve from acme-dev timed out.' }),
      read('qa', 'unknown', at(12), { why: 'This machine isn\'t logged in to acme-qa.' }),
      read('uat', 'unknown', at(12), { why: 'The branch uat couldn\'t be fetched from GitHub.' }),
      read('production', 'unknown', at(12), { why: 'This machine has no access to Production: acme-prod isn\'t logged in here.' }),
      read('hotfix', 'unknown', at(12), { why: 'This machine isn\'t logged in to acme-hotfix.' }),
    ] : inUat ? [
      read('uat', 'deployed', at(12)),
      read('production', 'not-deployed', at(12), { differs: ['Apex Class: CaseRouting', 'Apex Class: CaseRoutingTest', 'Custom Field: Case.Tier__c', 'Flow: Case_Escalation'] }),
    ] : [
      read('qa', 'deployed', at(12)),
      read('uat', 'partly', at(12), { differs: ['Apex Class: CaseRouting', 'Flow: Case_Escalation'], notes: ['It\'s in UAT\'s org, with no deploy of it on record: it got there another way.'] }),
      ...(which === 'not' ? [read('hotfix', 'not-deployed', at(40), { differs: ['Apex Class: CaseRouting', 'Flow: Case_Escalation', 'Permission Set: Support_Agent'] })] : []),
    ],
  };
  // Hotfix has no org in the settings, so its choice is off; ACME-3, which it depends on, is in no environment ahead.
  const config = which === 'pick-off' ? { ...CONFIG, environments: ENVS.map((e) => (e.branch === 'hotfix' ? { ...e, org: null } : e)) } : CONFIG;
  const dep = { ...task, id: 'ACME-3', deps: [], promotions: [], deploys: [] } as Task;
  const changes = which === 'before'
    ? ticketChanges({ task, profile: 'salesforce', planned: PLAN, live: null })
    : deployedOnce ? ticketChanges({ task: { ...task, changes: { at: at(178), paths: MADE } }, profile: 'salesforce', planned: PLAN, live: null })
      : ticketChanges({ task, profile: 'salesforce', planned: PLAN, live: MADE, deleted: [`${D}/classes/LegacyRouting.cls`] });
  const records = ticketRecords({ task, analysis: null, profile: 'salesforce', environments: ENVS });
  // In review, its validate fails and it conflicts with dev, so Deploy… is off with why; merged, both are behind it.
  const acc = m.acc && deployedOnce ? { ...m.acc, conflicts: null, checks: m.acc.checks.filter((c) => !deployBlockers([c]).length) } : m.acc;
  return {
    ...m, acc, project: ROOT, changes, records,
    testing: testing(config, task, (b) => which === 'built-off' && b === 'dev'),
    deploy: ticketDeploy({
      config, task: which === 'off' ? { ...task, deps: ['ACME-3'] } : task, tasks: which === 'off' ? [task, dep] : [task], deploying: which === 'busy' ? 'uat' : null,
      failing: deployBlockers(acc?.checks ?? []), conflicts: acc?.conflicts ? 'dev' : null, stepsLeft: openSteps(task).length, where, reading: (b) => which === 'checking' && b === 'qa',
    }),
  };
}
