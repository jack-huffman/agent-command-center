// Where each component opens in its org (T-161): one table, a page for each type it names, a lookup by name where
// the page needs the record's id, the type's list where the org has none, and Setup for a type it doesn't name.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sfComponent } from '../src/sf-metadata.ts';
import { idFrom, idQueryArgs, lookedUp, ORG_PAGES, orgOpen, orgOpenArgs, SAFE_NAME, SETUP_HOME } from '../src/sf-org-pages.ts';

const D = 'force-app/main/default';
const ID = '0011x00000AbCdEAAZ';

/** Each type the table names: a source path of that type, and the page it opens, with the id looked up where one is needed. */
const PAGES: [string, string, string][] = [
  [`${D}/objects/Job_History__c/Job_History__c.object-meta.xml`, '/lightning/setup/ObjectManager/Job_History__c/Details/view', 'Object Manager'],
  [`${D}/objects/Contact/fields/Job_Title__c.field-meta.xml`, '/lightning/setup/ObjectManager/Contact/FieldsAndRelationships/view', 'Object Manager'],
  [`${D}/objects/Contact/validationRules/Title_Required.validationRule-meta.xml`, '/lightning/setup/ObjectManager/Contact/ValidationRules/view', 'Object Manager'],
  [`${D}/objects/Contact/recordTypes/Partner.recordType-meta.xml`, '/lightning/setup/ObjectManager/Contact/RecordTypes/view', 'Object Manager'],
  [`${D}/objects/Contact/compactLayouts/Short.compactLayout-meta.xml`, '/lightning/setup/ObjectManager/Contact/CompactLayouts/view', 'Object Manager'],
  [`${D}/objects/Contact/fieldSets/Main.fieldSet-meta.xml`, '/lightning/setup/ObjectManager/Contact/FieldSets/view', 'Object Manager'],
  [`${D}/objects/Contact/webLinks/Call.webLink-meta.xml`, '/lightning/setup/ObjectManager/Contact/ButtonsLinksActions/view', 'Object Manager'],
  [`${D}/layouts/Contact-Contact Layout.layout-meta.xml`, '/lightning/setup/ObjectManager/Contact/PageLayouts/view', 'Object Manager'],
  [`${D}/flows/Contact_Job_History.flow-meta.xml`, `/builder_platform_interaction/flowBuilder.app?flowDefId=${ID}`, 'Flow Builder'],
  [`${D}/classes/JobHistoryService.cls`, `/lightning/setup/ApexClasses/page?address=%2F${ID}`, 'its Setup page'],
  [`${D}/triggers/ContactTrigger.trigger`, `/lightning/setup/ApexTriggers/page?address=%2F${ID}`, 'its Setup page'],
  [`${D}/flexipages/Job_Record_Page.flexipage-meta.xml`, `/visualEditor/appBuilder.app?pageId=${ID}`, 'the Lightning App Builder'],
  [`${D}/permissionsets/Job_History_Access.permissionset-meta.xml`, `/lightning/setup/PermSets/page?address=%2F${ID}`, 'its Setup page'],
  [`${D}/permissionsetgroups/Job_Team.permissionsetgroup-meta.xml`, `/lightning/setup/PermSetGroups/page?address=%2F${ID}`, 'its Setup page'],
  [`${D}/reports/Sales_Reports/Job_Changes.report-meta.xml`, `/lightning/r/Report/${ID}/view`, 'its record'],
  [`${D}/dashboards/Sales_Dashboards/Job_Moves.dashboard-meta.xml`, `/lightning/r/Dashboard/${ID}/view`, 'its record'],
];

/** The page a path opens, with the org answering the lookup with `id` (or with nothing). */
function pageOf(path: string, id: string | null): string {
  const o = orgOpen(sfComponent(path)!);
  return o.kind === 'page' ? o.page : lookedUp(o, id);
}

test('each type in the table opens at its own page in the org: an object or field in Object Manager, a flow in Flow Builder, Apex at its Setup page, a Lightning page in the App Builder, a permission set at its page, a report or dashboard at its record (T-161)', () => {
  const types = new Set<string>();
  for (const [path, page, where] of PAGES) {
    const c = sfComponent(path);
    assert.ok(c, `${path} is a component`);
    assert.equal(pageOf(path, ID), page, path);
    assert.equal(orgOpen(c).where, where, path);
    types.add(c.type);
  }
  // Every type in the table has its case here, and the count proves the loop ran.
  assert.deepEqual([...types].sort(), Object.keys(ORG_PAGES).sort());
  assert.equal(types.size, 16);
});

test('a lookup asks for the component\'s own name, through the Tooling API where the type lives there; a report is asked for by its name, not its folder (T-161)', () => {
  const flow = orgOpen({ type: 'Flow', name: 'Contact_Job_History' });
  assert.equal(flow.kind, 'lookup');
  assert.deepEqual(idQueryArgs('acme-dev', flow as Extract<typeof flow, { kind: 'lookup' }>), ['data', 'query', '--use-tooling-api', '--query', 'SELECT Id FROM FlowDefinition WHERE DeveloperName = \'Contact_Job_History\' LIMIT 1', '--target-org', 'acme-dev', '--json']);
  const report = orgOpen({ type: 'Report', name: 'Sales_Reports/Job_Changes' });
  assert.deepEqual(idQueryArgs('acme-dev', report as Extract<typeof report, { kind: 'lookup' }>), ['data', 'query', '--query', 'SELECT Id FROM Report WHERE DeveloperName = \'Job_Changes\' LIMIT 1', '--target-org', 'acme-dev', '--json']);
  const apex = orgOpen({ type: 'ApexClass', name: 'JobHistoryService' }) as Extract<ReturnType<typeof orgOpen>, { kind: 'lookup' }>;
  assert.match(apex.soql, /NamespacePrefix = null/, 'its own class, not a package\'s of the same name');
});

test('edge case: where the org finds no id, a type with a lookup opens its list; a type with no known page opens Setup (T-161)', () => {
  const lists = PAGES.filter(([path]) => orgOpen(sfComponent(path)!).kind === 'lookup');
  assert.equal(lists.length, 8);
  for (const [path] of lists) {
    const o = orgOpen(sfComponent(path)!) as Extract<ReturnType<typeof orgOpen>, { kind: 'lookup' }>;
    assert.equal(pageOf(path, null), o.list, path);
    assert.notEqual(o.list, SETUP_HOME, `${path} has a list of its own`);
  }
  for (const path of [`${D}/lwc/jobHistory/jobHistory.js`, `${D}/staticresources/logo.png`, `${D}/customMetadata/Job_Setting.Default.md-meta.xml`]) {
    assert.deepEqual(orgOpen(sfComponent(path)!), { kind: 'page', page: SETUP_HOME, where: 'Setup' }, path);
  }
});

test('edge case: a name a URL or a query can\'t carry as it is opens the type\'s list, never a query with it in (T-161)', () => {
  assert.equal(SAFE_NAME.test('Job_History__c'), true);
  for (const bad of ['O\'Brien', 'a b', '1abc', '']) assert.equal(SAFE_NAME.test(bad), false, bad);
  assert.deepEqual(orgOpen({ type: 'Flow', name: 'Bad\'Name' }), { kind: 'page', page: '/lightning/setup/Flows/home', where: 'Flow Builder' });
  assert.deepEqual(orgOpen({ type: 'CustomObject', name: 'Bad Name' }), { kind: 'page', page: SETUP_HOME, where: 'Setup' });
});

test('edge case: the id comes from the query\'s answer, and none from a failed or empty answer, or one that isn\'t an id (T-161)', () => {
  assert.equal(idFrom(JSON.stringify({ status: 0, result: { records: [{ Id: ID }] } })), ID);
  assert.equal(idFrom(JSON.stringify({ status: 0, result: { records: [] } })), null);
  assert.equal(idFrom(JSON.stringify({ status: 1, message: 'No authorization' })), null);
  assert.equal(idFrom(JSON.stringify({ result: { records: [{ Id: '../x' }] } })), null);
  assert.equal(idFrom('not json'), null);
});

test('sf opens the org at a page, or at its home with none (T-161)', () => {
  assert.deepEqual(orgOpenArgs('acme-dev', '/lightning/setup/Flows/home'), ['org', 'open', '--target-org', 'acme-dev', '--path', '/lightning/setup/Flows/home']);
  assert.deepEqual(orgOpenArgs('acme-dev'), ['org', 'open', '--target-org', 'acme-dev']);
});
