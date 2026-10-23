/**
 * A ticket's Planned changes, then Changes (T-99), in a Salesforce project: ACME-35 to do with its plan,
 * ACME-12 being built with a change outside its plan and a planned one not made yet, and ACME-20 merged,
 * with the changes kept with it after its branch is gone.
 */
import { ticketChanges } from '../../src/model/changes.ts';
import { statusLook } from '../../src/model/boards.ts';
import { displayLook } from '../../src/model/shared.ts';
import type { TicketModel } from '../../src/model/task-page.ts';
import { DONE } from './boards.ts';
import { MIN } from './shared.ts';
import { sampleTicket } from './task-page.ts';

export type ChangesSample = 'planned' | 'changes' | 'kept';

const D = 'force-app/main/default';

/** ACME-12's plan: the premium entry, the routing class and its test, and the email alert. */
const ESCALATION_PLAN = [
  `${D}/escalationRules/Case.escalationRules-meta.xml`,
  `${D}/classes/CaseRouting.cls`,
  `${D}/classes/CaseRoutingTest.cls`,
  `${D}/workflows/Case.workflow-meta.xml`,
];

export function sampleChangesTicket(now: number, which: ChangesSample): TicketModel {
  if (which === 'planned') {
    const m = sampleTicket(now, 'ACME-35');
    const planned = [`${D}/flows/Case_No_Reply_Escalation.flow-meta.xml`, `${D}/objects/Case/fields/First_Reply_At__c.field-meta.xml`, `${D}/queues/Tier_2.queue-meta.xml`, `${D}/classes/CaseNoReplyTest.cls`];
    return { ...m, changes: ticketChanges({ task: { id: 'ACME-35', state: 'todo' }, profile: 'salesforce', planned, live: null }) };
  }
  if (which === 'changes') {
    const m = sampleTicket(now);
    // Built so far: the plan's entry and classes, a field and a permission set it didn't plan; the alert not yet.
    const live = [
      `${D}/escalationRules/Case.escalationRules-meta.xml`, `${D}/classes/CaseRouting.cls`, `${D}/classes/CaseRouting.cls-meta.xml`, `${D}/classes/CaseRoutingTest.cls`,
      `${D}/objects/Case/fields/Tier__c.field-meta.xml`, `${D}/permissionsets/Support_Agent.permissionset-meta.xml`,
    ];
    // Its builder deployed to the build org (D-T-115): every component listed there, and the routing tests passed in the org.
    const deploys = [{
      env: 'dev', org: 'Acme Dev', sha: 'b4d2c0ffee0000000000000000000000000000ab', at: new Date(now - 12 * MIN).toISOString(), jobId: '0AfKj000002Hx1pKAC',
      paths: live, components: ['Escalation Rules: Case', 'Apex Class: CaseRouting', 'Apex Class: CaseRoutingTest', 'Custom Field: Case.Tier__c', 'Permission Set: Support_Agent'], verified: 5,
      tests: { names: ['CaseRoutingTest'], outcome: 'pass' as const, ran: 4, failed: 0, coverage: '91%' },
    }];
    return { ...m, changes: ticketChanges({ task: { id: 'ACME-12', state: 'running', deploys }, profile: 'salesforce', planned: ESCALATION_PLAN, live }) };
  }
  // ACME-20 merged into dev: done, its branch gone, what it changed kept with it.
  const m = sampleTicket(now, 'ACME-20');
  const kept = {
    at: new Date(now - 20 * MIN).toISOString(),
    paths: [
      `${D}/objects/Account/fields/Renewal_Date__c.field-meta.xml`, `${D}/layouts/Account-Account Layout.layout-meta.xml`, `${D}/flexipages/Account_Record_Page.flexipage-meta.xml`,
      `${D}/permissionsets/Sales_Ops.permissionset-meta.xml`, `${D}/classes/AccountRenewal.cls`, `${D}/classes/AccountRenewal.cls-meta.xml`, `${D}/classes/AccountRenewalTest.cls`,
    ],
  };
  const planned = [`${D}/objects/Account/fields/Renewal_Date__c.field-meta.xml`, `${D}/layouts/Account-Account Layout.layout-meta.xml`, `${D}/permissionsets/Sales_Ops.permissionset-meta.xml`, `${D}/classes/AccountRenewal.cls`, `${D}/classes/AccountRenewalTest.cls`];
  return {
    ...m, status: { name: DONE.name, ...statusLook(DONE) },
    acc: m.acc ? { ...m.acc, look: displayLook('done') } : null,
    changes: ticketChanges({ task: { id: 'ACME-20', state: 'done', changes: kept }, profile: 'salesforce', planned, live: null }),
  };
}
