/**
 * A ticket's changes field (T-105): ACME-12, being built, whose Jira tracker keeps a ticket's changes in its
 * "Deployment Notes" field. A developer wrote two lines there by hand, so the page shows them, says they differ
 * from what the Command Center found, and drafts the field's new text from the branch's metadata and its
 * record change, for a person to edit and save.
 */
import type { OutsideChange } from '../../../packages/core/src/outside-changes.ts';
import { changedPaths } from '../../src/model/changes.ts';
import { ticketField } from '../../src/model/changes-field.ts';
import type { TicketModel } from '../../src/model/task-page.ts';
import { MIN } from './shared.ts';
import { sampleChangesTicket } from './changes.ts';

const D = 'force-app/main/default';
const LIVE = [
  `${D}/escalationRules/Case.escalationRules-meta.xml`, `${D}/classes/CaseRouting.cls`, `${D}/classes/CaseRouting.cls-meta.xml`, `${D}/classes/CaseRoutingTest.cls`,
  `${D}/objects/Case/fields/Tier__c.field-meta.xml`, `${D}/permissionsets/Support_Agent.permissionset-meta.xml`,
];

export function sampleFieldTicket(now: number): TicketModel {
  const m = sampleChangesTicket(now, 'changes');
  const queue: OutsideChange = {
    id: 'c1', kind: 'record', why: 'Premium cases route to it', planned: true, actor: 'builder', by: 'builder:ACME-12', at: new Date(now - 30 * MIN).toISOString(),
    detail: { object: 'Group', action: 'create', match: [{ field: 'DeveloperName', value: 'Tier_2_Support' }], fields: [{ field: 'Name', from: null, to: 'Tier 2 Support' }] },
  };
  const task = { id: 'ACME-12', state: 'running' as const, outside: { changes: [queue], noted: [], none: [], steps: [] } };
  const handWritten = 'Escalation Rules: Case\n\nAfter the deploy, turn on the Premium escalation rule in Setup.';
  return {
    ...m,
    field: ticketField({
      task, kind: 'jira', field: { id: 'customfield_10042', name: 'Deployment Notes', format: 'adf' }, edits: true, profile: 'salesforce',
      paths: changedPaths({ task, profile: 'salesforce', planned: null, live: LIVE }), read: { state: 'read', text: handWritten }, now: new Date(now),
    }),
  };
}
