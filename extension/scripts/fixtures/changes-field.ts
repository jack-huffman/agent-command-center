/**
 * A ticket's changes field (T-105): ACME-12, being built, whose Jira tracker keeps a ticket's changes in its
 * "Deployment Notes" field. A developer wrote two lines there by hand, so the page shows them and says they
 * differ from what the Command Center found. Its draft update, drafted when its record change was recorded,
 * leads its Activity: the branch's metadata and its record change, then the two hand-written lines, kept from
 * the ticket, for a person to edit and save.
 */
import { changesDraft } from '../../../packages/core/src/changes-field.ts';
import type { OutsideChange } from '../../../packages/core/src/outside-changes.ts';
import type { TextField } from '../../../packages/core/src/trackers/types.ts';
import type { Update } from '../../../packages/core/src/updates.ts';
import { ticketPaths } from '../../src/model/changes.ts';
import { ticketField, withFieldKept } from '../../src/model/changes-field.ts';
import type { TicketModel } from '../../src/model/task-page.ts';
import { updateCards } from '../../src/model/updates.ts';
import { MIN } from './shared.ts';
import { sampleChangesTicket } from './changes.ts';

const D = 'force-app/main/default';
const LIVE = [
  `${D}/escalationRules/Case.escalationRules-meta.xml`, `${D}/classes/CaseRouting.cls`, `${D}/classes/CaseRouting.cls-meta.xml`, `${D}/classes/CaseRoutingTest.cls`,
  `${D}/objects/Case/fields/Tier__c.field-meta.xml`, `${D}/permissionsets/Support_Agent.permissionset-meta.xml`,
];
const NOTES: TextField = { id: 'customfield_10042', name: 'Deployment Notes', format: 'adf' };

/** What a developer wrote in the field by hand: both lines are kept in the draft. */
const HAND_WRITTEN = 'Escalation Rules: Case\n\nAfter the deploy, turn on the Premium escalation rule in Setup.';

export function sampleFieldTicket(now: number): TicketModel {
  const m = sampleChangesTicket(now, 'changes');
  const queue: OutsideChange = {
    id: 'c1', kind: 'record', why: 'Premium cases route to it', planned: true, actor: 'builder', by: 'builder:ACME-12', at: new Date(now - 30 * MIN).toISOString(),
    detail: { object: 'Group', action: 'create', match: [{ field: 'DeveloperName', value: 'Tier_2_Support' }], fields: [{ field: 'Name', from: null, to: 'Tier 2 Support' }] },
  };
  const task = { id: 'ACME-12', state: 'running' as const, outside: { changes: [queue], noted: [], none: [], steps: [] } };
  const paths = ticketPaths({ task, profile: 'salesforce', planned: null, live: LIVE });
  const at = new Date(now - 25 * MIN);
  const draft: Update = {
    v: 1, id: 'ACME-12.4', task: 'ACME-12', tracker: 'jira', key: 'ACME-12', url: null, event: 'changes', field: NOTES, state: 'draft',
    text: changesDraft({ profile: 'salesforce', paths, outside: task.outside.changes, at })!, createdAt: at.toISOString(), by: 'acc change',
  };
  const read = { state: 'read' as const, text: HAND_WRITTEN };
  const boards = [{ index: 0, kind: 'jira' as const, title: 'Jira · ACME', board: null, error: null, connect: null, loading: false, signedInAs: 'Jordan Kim', signInScope: null }];
  const card = updateCards(m.project, [draft], null, boards, () => 0, () => true, now);
  return {
    ...m,
    updates: [...withFieldKept(card, read, [draft.text]), ...m.updates],
    field: ticketField({ task, kind: 'jira', field: NOTES, profile: 'salesforce', paths, read, written: [draft.text], drafted: true, now: new Date(now) }),
  };
}
