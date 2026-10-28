/**
 * ACME-12's Changes tab with its deploy (T-138), on a path of Dev, QA, UAT and Production: before there's work,
 * with its work in review, merged and deployed once to QA, and deployed to UAT with steps left to do by hand
 * (a record change and a deletion). Then the sheet over it: checking against UAT, a check that passed, one that
 * failed, and Production's, which asks for its name typed.
 */
import type { Environment } from '../../../packages/core/src/config.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import type { OutsideState } from '../../../packages/core/src/outside-changes.ts';
import type { RecordChange } from '../../../packages/core/src/records.ts';
import type { TaskDeployPlan } from '../../../packages/core/src/task-deploy.ts';
import { ticketChanges } from '../../src/model/changes.ts';
import { ticketRecords } from '../../src/model/record-changes.ts';
import type { TicketModel } from '../../src/model/task-page.ts';
import { type DeployRun, ticketDeploy } from '../../src/model/ticket-deploy.ts';
import { MIN, ROOT } from './shared.ts';
import { sampleTicket } from './task-page.ts';

export type DeploySample = 'before' | 'work' | 'deployed' | 'steps' | 'checking' | 'passed' | 'failed' | 'typed' | 'done';

const D = 'force-app/main/default';
const env = (name: string, promotesTo: string[], more: Partial<Environment> = {}): Environment => ({ name, branch: name.toLowerCase(), type: 'sandbox' as Environment['type'], org: `acme-${name.toLowerCase()}`, default: false, protected: false, promotesTo, ...more });
const ENVS = [env('Dev', ['qa'], { default: true }), env('QA', ['uat']), env('UAT', ['production']), env('Production', [], { type: 'production' as Environment['type'], protected: true, org: 'acme-prod' })];
const CONFIG = { profile: 'salesforce' as const, environments: ENVS, github: { repo: 'acme/service', account: 'jordan-kim' } };

const PLAN = [`${D}/classes/CaseRouting.cls`, `${D}/classes/CaseRoutingTest.cls`, `${D}/flows/Case_Escalation.flow-meta.xml`, `${D}/objects/Case/fields/Tier__c.field-meta.xml`];
const MADE = [`${D}/classes/CaseRouting.cls`, `${D}/classes/CaseRouting.cls-meta.xml`, `${D}/classes/CaseRoutingTest.cls`, `${D}/flows/Case_Escalation.flow-meta.xml`,
  `${D}/objects/Case/fields/Tier__c.field-meta.xml`, `${D}/permissionsets/Support_Agent.permissionset-meta.xml`, `${D}/classes/LegacyRouting.cls`];
const tier: RecordChange = { object: 'Routing_Tier__c', action: 'create', match: [{ field: 'Name', value: 'Premium' }], fields: [{ field: 'Hours__c', from: null, to: '4' }] };

/** The check's plan for UAT, or Production's, as acc gives it back. */
function plan(to: Environment, passed: boolean): TaskDeployPlan {
  return {
    task: 'ACME-12', key: 'ACME-12', from: ENVS[ENVS.indexOf(to) - 1]!, to, org: to.org!, confirm: to.protected, confirmName: to.name, commits: ['b4d2c0f'], base: 'a1b2c3d',
    files: MADE.slice(0, 6), gitOnly: [], leftOut: [`${D}/settings/Org.settings-meta.xml`], deletions: [{ path: `${D}/classes/LegacyRouting.cls`, component: 'Apex Class: LegacyRouting' }],
    records: ['Create a Routing_Tier__c record where Name is Premium, setting Hours__c to 4'],
    types: [{ name: 'ApexClass', members: ['CaseRouting', 'CaseRoutingTest'] }, { name: 'CustomField', members: ['Case.Tier__c'] }, { name: 'Flow', members: ['Case_Escalation'] }, { name: 'PermissionSet', members: ['Support_Agent'] }],
    testLevel: 'RunLocalTests', tests: 'The org\'s local tests, since Apex is in it',
    check: passed ? { passed: true, id: '0AfKj000003Ck9pKAC', summary: `Checked 5 components in ${to.org}, 4 tests passed (job 0AfKj000003Ck9pKAC).`, problems: [] }
      : { passed: false, id: '0AfKj000003Ck9qKAC', summary: `2 problems in ${to.org}`, problems: ['Apex Class CaseRouting: line 42: Variable does not exist: Tier__c', 'Flow Case_Escalation: The field Case.Tier__c isn\'t in this org'] },
  };
}

export function sampleDeployTicket(now: number, which: DeploySample): TicketModel {
  const at = (min: number) => new Date(now - min * MIN).toISOString();
  const m = sampleTicket(now);
  const deployedOnce = which !== 'before' && which !== 'work';
  const inUat = which === 'steps' || which === 'typed' || which === 'done';
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
    history: [], createdAt: at(600), updatedAt: at(20), promotions, outside, deploys: [],
  } as unknown as Task;
  const changes = which === 'before'
    ? ticketChanges({ task, profile: 'salesforce', planned: PLAN, live: null })
    : deployedOnce ? ticketChanges({ task: { ...task, changes: { at: at(178), paths: MADE } }, profile: 'salesforce', planned: PLAN, live: null })
      : ticketChanges({ task, profile: 'salesforce', planned: PLAN, live: MADE, deleted: [`${D}/classes/LegacyRouting.cls`] });
  const to = which === 'typed' ? ENVS[3]! : ENVS[2]!;
  const run: DeployRun | null = which === 'checking' ? { to: to.branch, toName: to.name, phase: 'checking', progress: 'Check in acme-uat', plan: null, result: null, error: null }
    : which === 'passed' || which === 'typed' ? { to: to.branch, toName: to.name, phase: 'passed', progress: null, plan: plan(to, true), result: null, error: null }
      : which === 'failed' ? { to: to.branch, toName: to.name, phase: 'failed', progress: null, plan: plan(to, false), result: null, error: null }
        : which === 'done' ? { to: 'uat', toName: 'UAT', phase: 'deployed', progress: null, plan: plan(ENVS[2]!, true), error: null, result: { plan: plan(ENVS[2]!, true), deployed: true, jobId: '0AfKj000003Ck9pKAC', pr: { number: 64, url: 'https://github.com/acme/service/pull/64' }, merged: true, summary: 'Deployed ACME-12 to UAT: Deployed 5 components in acme-uat, 4 tests passed. Pull request #64 merged into uat.', warning: null, update: null } }
        : null;
  const records = ticketRecords({ task, analysis: null, profile: 'salesforce', environments: ENVS });
  return { ...m, project: ROOT, changes, records, deploy: ticketDeploy({ config: CONFIG, task, tasks: [task], running: false, run }) };
}
