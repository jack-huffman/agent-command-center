import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseAnalysis } from '../src/analyze.ts';
import {
  parsePlannedRecords, plannedRecordKeys, RECORD_CHANGES_SCHEMA, RECORD_ID, RECORD_KIND, RECORD_PLAN_PROMPT, recordKey, recordKeyWords, recordPacketSection, recordPair, recordProblems,
  recordReviewSection, recordScript, recordWords, readRecordChange, type RecordChange,
} from '../src/records.ts';
import { OUTSIDE_KINDS, outsideKind } from '../src/outside-kinds.ts';

const rename: RecordChange = { object: 'Account', action: 'update', match: [{ field: 'Name', value: 'Acme Corp' }], fields: [{ field: 'Name', from: null, to: 'Acme Corporation' }] };
const region: RecordChange = { object: 'Region__c', action: 'create', match: [{ field: 'External_Id__c', value: 'EMEA-1' }], fields: [{ field: 'Name', from: null, to: 'EMEA' }] };
const gone: RecordChange = { object: 'Region__c', action: 'delete', match: [{ field: 'External_Id__c', value: 'OLD-9' }], fields: [] };

test('the plan\'s record changes are parsed from the analyst\'s answer, each with why', () => {
  const answer = {
    verdict: 'ready', summary: 'S.', requirements: {}, questions: [], findings: [], approach: {}, split: [],
    recordChanges: [
      { object: 'Account', action: 'update', match: [{ field: 'Name', value: 'Acme Corp' }], fields: [{ field: 'Name', from: 'Acme Corp', to: 'Acme Corporation' }], why: 'The brand changed' },
      { object: 'Region__c', action: 'create', match: [{ field: 'External_Id__c', value: 'EMEA-1' }], fields: [{ field: 'Name', from: '', to: 'EMEA' }], why: 'The flow reads it' },
    ],
  };
  const { analysis } = parseAnalysis(JSON.stringify({ structured_output: answer, session_id: 's' }));
  assert.equal(analysis.recordChanges?.length, 2);
  assert.deepEqual(analysis.recordChanges![0], { ...rename, fields: [{ field: 'Name', from: 'Acme Corp', to: 'Acme Corporation' }], why: 'The brand changed' });
  assert.equal(analysis.recordChanges![1]!.fields[0]!.from, null, 'an empty old value is unknown');
  assert.deepEqual(plannedRecordKeys(analysis), [recordKey(rename), recordKey(region)]);
});

test('edge case: an analysis with no recordChanges, or junk in it, plans none', () => {
  assert.deepEqual(parsePlannedRecords(undefined), []);
  assert.deepEqual(parsePlannedRecords([null, 3, { action: 'update' }]), [], 'nothing without an object');
  assert.deepEqual(plannedRecordKeys(null), []);
  assert.equal(readRecordChange({ object: 'Account', action: 'rename' })?.action, 'update', 'an unknown action reads as an update, then is checked');
});

test('a planned change named by its record ID stays in the plan, refused with why, and matches nothing', () => {
  const [p] = parsePlannedRecords([{ object: 'Account', action: 'update', match: [{ field: 'Id', value: '001Dn00000AbCdEFGH' }], fields: [{ field: 'Name', from: '', to: 'X' }], why: 'w' }]);
  assert.match(p!.refused!, /different in every org/);
  assert.deepEqual(plannedRecordKeys({ recordChanges: [p!] }), []);
});

test('a change named only by ID is refused: the Id field, a value shaped like an ID, and a field set to one', () => {
  assert.ok(RECORD_ID.test('001Dn00000AbCdE') && RECORD_ID.test('001Dn00000AbCdEFGH'), '15 and 18 characters');
  assert.ok(!RECORD_ID.test('Acme Corp') && !RECORD_ID.test('EMEA-1'));
  assert.match(recordProblems({ ...rename, match: [{ field: 'Id', value: 'anything' }] }).join(' '), /by its ID/);
  assert.match(recordProblems({ ...rename, match: [{ field: 'External_Id__c', value: '001Dn00000AbCdE' }] }).join(' '), /by its ID/);
  assert.match(recordProblems({ ...rename, fields: [{ field: 'OwnerId', from: null, to: '005Dn00000AbCdE' }] }).join(' '), /OwnerId to a record ID/);
  assert.deepEqual(recordProblems(rename), []);
  assert.deepEqual(recordProblems(region), []);
  assert.deepEqual(recordProblems(gone), []);
});

test('edge case: a change with no key, a bad name, an update with no field, or a delete with fields is refused', () => {
  assert.match(recordProblems({ ...rename, match: [] }).join(' '), /same in every org/);
  assert.match(recordProblems({ ...rename, object: 'Account.Name' }).join(' '), /object's API name/);
  assert.match(recordProblems({ ...rename, fields: [{ field: 'Bad Field', from: null, to: 'x' }] }).join(' '), /field's API name/);
  assert.match(recordProblems({ ...rename, fields: [] }).join(' '), /at least one field/);
  assert.match(recordProblems({ ...gone, fields: [{ field: 'Name', from: null, to: 'x' }] }).join(' '), /sets no fields/);
  assert.equal(recordPair('=x'), null);
  assert.deepEqual(recordPair('Name=Acme = Corp'), { field: 'Name', value: 'Acme = Corp' }, 'split at the first =');
});

test('a record change reads plainly: its object, its name, and each field', () => {
  assert.equal(recordWords(rename), 'Account \'Acme Corp\': Name → \'Acme Corporation\'');
  assert.equal(recordWords({ ...rename, fields: [{ field: 'Name', from: 'Acme Corp', to: 'Acme Corporation' }] }), 'Account \'Acme Corp\': Name \'Acme Corp\' → \'Acme Corporation\'');
  assert.equal(recordWords(region), 'New Region__c External_Id__c \'EMEA-1\': Name → \'EMEA\'');
  assert.equal(recordWords(gone), 'Delete Region__c External_Id__c \'OLD-9\'');
  assert.equal(recordKeyWords({ match: [{ field: 'Type', value: 'A' }, { field: 'Name', value: 'B' }] }), 'Type \'A\', Name \'B\'');
  assert.equal(recordKey({ ...rename, object: 'ACCOUNT' }), recordKey(rename), 'the same record whatever the case of its object');
});

test('the script for a create, an update and a delete is matched on the stable key, never an ID', () => {
  const update = recordScript(rename, 'acme-uat');
  assert.equal(update.at(-1), 'sf data update record --target-org "acme-uat" --sobject Account --where "Name=\'Acme Corp\'" --values "Name=\'Acme Corporation\'"');
  assert.equal(update[1], 'sf data query --target-org "acme-uat" --query "SELECT Id FROM Account WHERE Name = \'Acme Corp\'"', 'it checks it finds the record first');
  const create = recordScript(region, 'acme-uat');
  assert.equal(create.at(-1), 'sf data create record --target-org "acme-uat" --sobject Region__c --values "External_Id__c=\'EMEA-1\' Name=\'EMEA\'"', 'the key is set on the new record');
  assert.match(create[0]!, /no record yet/);
  assert.equal(recordScript(gone, 'acme-uat').at(-1), 'sf data delete record --target-org "acme-uat" --sobject Region__c --where "External_Id__c=\'OLD-9\'"');
  assert.ok(![...update, ...create].some((l) => /\bId\s*=/.test(l)), 'no line finds a record by its Id');
});

test('edge case: an org alias with a space or a $ stays one shell argument in every line', () => {
  const lines = recordScript(rename, 'Acme UAT $x').filter((l) => l.startsWith('sf '));
  assert.equal(lines.length, 2);
  for (const l of lines) assert.match(l, /--target-org "Acme UAT \\\$x" /);
});

test('edge case: a quote, a $ or a backtick in a value is escaped, and an environment with no org gets a placeholder', () => {
  const tricky = recordScript({ ...rename, match: [{ field: 'Name', value: 'O\'Brien $HOME `x`' }] }, null);
  assert.match(tricky.at(-1)!, /--target-org <org>/);
  assert.match(tricky.at(-1)!, /Name='O\\\\'Brien \\\$HOME \\`x\\`'/);
});

test('the Salesforce profile registers records as a kind of change outside git', () => {
  assert.equal(OUTSIDE_KINDS.record, RECORD_KIND);
  assert.equal(outsideKind('record')?.profile, 'salesforce');
  assert.equal(outsideKind('toString'), null, 'edge case: a name that isn\'t a registered kind');
  assert.equal(RECORD_KIND.words(rename), recordWords(rename));
});

test('the analyst is told to list record changes, and the schema adds recordChanges with a stable key', () => {
  assert.match(RECORD_PLAN_PROMPT, /without a record ID/);
  assert.deepEqual(RECORD_CHANGES_SCHEMA.items.required, ['object', 'action', 'match', 'fields', 'why']);
});

test('the builder is told how to record a change, and the plan\'s; a generic project is told nothing', () => {
  const s = recordPacketSection(parsePlannedRecords([{ ...rename, why: 'The brand changed' }]), true).join('\n');
  assert.match(s, /acc change record --object/);
  assert.match(s, /acc change none/);
  assert.match(s, /Account 'Acme Corp': Name → 'Acme Corporation'\. Why: The brand changed/);
  assert.deepEqual(recordPacketSection([], false), []);
});

test('the reviewer checks recorded changes against the plan\'s and the noted commands', () => {
  const s = recordReviewSection({
    changes: [{ id: 'c1', kind: 'record', detail: rename, why: 'w', planned: false, actor: 'builder', by: 'builder:T-1', at: '2026-10-22T10:00:00Z' }],
    noted: [{ command: 'sf data update record', kind: 'record', at: '2026-10-22T09:59:00Z' }], none: [{ why: 'it failed', by: 'builder:T-1', at: 'x' }],
  }, true).join('\n');
  assert.match(s, /c1: Account 'Acme Corp'.*Not in the plan/);
  assert.match(s, /`sf data update record`/);
  assert.match(s, /it failed/);
  assert.match(recordReviewSection({ changes: [], noted: [], none: [] }, true).join('\n'), /Recorded:\n\n- none/, 'edge case: nothing recorded says none');
  assert.deepEqual(recordReviewSection({ changes: [], noted: [], none: [] }, false), []);
});
