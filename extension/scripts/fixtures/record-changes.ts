/**
 * ACME-20's record changes (T-100): the renewal date it shows needs a custom setting's record, a field set on
 * the Acme account, and a stale reminder setting deleted. Its plan lists three; its builder recorded two, a
 * person added one made by hand in Setup, and one the plan named by its ID is refused. Promoted, the task is
 * done and its work went to UAT: one step made, one skipped with a reason, and one to run.
 */
import type { Task } from '../../../packages/core/src/ledger.ts';
import type { OutsideState } from '../../../packages/core/src/outside-changes.ts';
import { parsePlannedRecords, type RecordChange } from '../../../packages/core/src/records.ts';
import { statusLook } from '../../src/model/boards.ts';
import { ticketRecords } from '../../src/model/record-changes.ts';
import { displayLook } from '../../src/model/shared.ts';
import type { TicketModel } from '../../src/model/task-page.ts';
import { DONE } from './boards.ts';
import { MIN, ROOT } from './shared.ts';
import { sampleTicket } from './task-page.ts';

/** The three pages: the changes kept; the work promoted, with a step to run; and that with the form and a step's Skip open. */
export type RecordsSample = 'kept' | 'form' | 'promoted';

const setting: RecordChange = { object: 'Renewal_Settings__c', action: 'create', match: [{ field: 'Name', value: 'Default' }], fields: [{ field: 'Lead_Days__c', from: null, to: '60' }] };
const acme: RecordChange = { object: 'Account', action: 'update', match: [{ field: 'External_Id__c', value: 'ACME-0001' }], fields: [{ field: 'Renewal_Date__c', from: null, to: '2027-03-31' }] };
const stale: RecordChange = { object: 'Reminder_Setting__mdt', action: 'delete', match: [{ field: 'DeveloperName', value: 'Old_Renewal' }], fields: [] };
const rename: RecordChange = { object: 'Account', action: 'update', match: [{ field: 'Name', value: 'Acme Corp' }], fields: [{ field: 'Name', from: 'Acme Corp', to: 'Acme Corporation' }] };

/** The plan's record changes, as the analyst wrote them: one named by its ID, which acc refuses. */
export const PLANNED_RECORDS = parsePlannedRecords([
  { ...setting, fields: [{ field: 'Lead_Days__c', from: '', to: '60' }], why: 'The renewal reminder reads its lead time from this setting' },
  { ...acme, fields: [{ field: 'Renewal_Date__c', from: '', to: '2027-03-31' }], why: 'The pilot account shows a renewal date from day one' },
  { ...stale, why: 'The old reminder would send a second email' },
  { object: 'Contract', action: 'update', match: [{ field: 'Id', value: '800Dn000001AbCdEAA' }], fields: [{ field: 'Status', from: 'Draft', to: 'Activated' }], why: 'Its renewal date needs an active contract' },
]);

function outside(now: number, promoted: boolean): OutsideState {
  const at = (min: number) => new Date(now - min * MIN).toISOString();
  return {
    changes: [
      { id: 'c1', kind: 'record', detail: setting, why: 'The renewal reminder reads its lead time from this setting', planned: true, actor: 'builder', by: 'builder:ACME-20', at: at(70) },
      { id: 'c2', kind: 'record', detail: acme, why: 'The pilot account shows a renewal date from day one', planned: true, actor: 'builder', by: 'builder:ACME-20', at: at(65) },
      { id: 'c3', kind: 'record', detail: rename, why: 'Sales Ops renamed it in Setup while the renewal date was tested', planned: false, actor: 'human', by: 'human:jordan', at: at(50) },
    ],
    noted: [{ command: 'sf data create record --sobject Renewal_Settings__c', kind: 'record', at: at(71) }],
    none: [],
    steps: promoted ? [
      { change: 'c1', env: 'uat', org: 'acme-uat', state: 'done', reason: null, by: 'human:jordan', at: at(10), added: at(30) },
      { change: 'c2', env: 'uat', org: 'acme-uat', state: 'todo', reason: null, by: null, at: null, added: at(30) },
      { change: 'c3', env: 'uat', org: 'acme-uat', state: 'skipped', reason: 'UAT was refreshed from production, which has the new name', by: 'human:jordan', at: at(8), added: at(30) },
    ] : [],
  };
}

/** ACME-20's page with its Record changes: kept in review, or done and promoted to UAT with a step to run. */
export function sampleRecordsTicket(now = Date.now(), which: RecordsSample = 'kept'): TicketModel {
  const base = sampleTicket(now, 'ACME-20');
  const promoted = which !== 'kept';
  const task = {
    id: 'ACME-20', state: promoted ? 'done' : 'review', outside: outside(now, promoted),
    promotions: promoted ? [{ from: 'dev', to: 'uat', pr: { number: 51, url: 'https://github.com/acme/service/pull/51' }, state: 'open', at: new Date(now - 30 * MIN).toISOString() }] : [],
  } as unknown as Pick<Task, 'id' | 'state' | 'outside' | 'promotions'>;
  const records = ticketRecords({ task, analysis: { recordChanges: PLANNED_RECORDS }, profile: 'salesforce', environments: [{ branch: 'dev', name: 'Dev' }, { branch: 'uat', name: 'UAT' }] });
  if (!promoted || !base.acc) return { ...base, records };
  // Merged into Dev and promoted on: the ticket is done.
  const done = new Date(now - 35 * MIN).toISOString();
  return {
    ...base, records, status: { name: DONE.name, ...statusLook(DONE) },
    acc: { ...base.acc, look: displayLook('done'), actions: [], history: [{ at: done, from: 'review', to: 'done', by: 'acc sync', reason: null, look: displayLook('done') }, ...base.acc.history] },
  };
}

/** "Add a change made by hand" half-filled, and the step to do with its Skip open, as a person leaves them: in the tab's memory. */
export const RECORDS_FORM_STATE = { drafts: {
  [`records-form:${ROOT}#ACME-20`]: JSON.stringify({ object: 'Account', action: 'update', match: ['External_Id__c=ACME-0002'], set: ['Renewal_Date__c=2027-06-30'], why: '' }),
  [`records-skip:${ROOT}#ACME-20`]: JSON.stringify({ step: 'uat:c2', reason: '' }),
} };
