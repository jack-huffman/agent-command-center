import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sfComponent } from '../src/sf-metadata.ts';

const D = 'force-app/main/default';

/** Each path the salesforce profile names, as "Label: name", with the Metadata API's type after it. */
const NAMED: [string, string, string][] = [
  [`${D}/objects/Job_History__c/Job_History__c.object-meta.xml`, 'Custom Object: Job_History__c', 'CustomObject'],
  [`${D}/objects/Contact/Contact.object-meta.xml`, 'Custom Object: Contact', 'CustomObject'],
  [`${D}/objects/Contact/fields/Job_Title__c.field-meta.xml`, 'Custom Field: Contact.Job_Title__c', 'CustomField'],
  [`${D}/objects/Contact/validationRules/Title_Required.validationRule-meta.xml`, 'Validation Rule: Contact.Title_Required', 'ValidationRule'],
  [`${D}/objects/Contact/recordTypes/Partner.recordType-meta.xml`, 'Record Type: Contact.Partner', 'RecordType'],
  [`${D}/objects/Contact/listViews/All.listView-meta.xml`, 'List View: Contact.All', 'ListView'],
  [`${D}/flows/Contact_Job_History.flow-meta.xml`, 'Flow: Contact_Job_History', 'Flow'],
  [`${D}/escalationRules/Case.escalationRules-meta.xml`, 'Escalation Rules: Case', 'EscalationRules'],
  [`${D}/classes/JobHistoryService.cls`, 'Apex Class: JobHistoryService', 'ApexClass'],
  [`${D}/classes/JobHistoryService.cls-meta.xml`, 'Apex Class: JobHistoryService', 'ApexClass'],
  [`${D}/triggers/ContactTrigger.trigger`, 'Apex Trigger: ContactTrigger', 'ApexTrigger'],
  [`${D}/triggers/ContactTrigger.trigger-meta.xml`, 'Apex Trigger: ContactTrigger', 'ApexTrigger'],
  [`${D}/lwc/jobHistory/jobHistory.js`, 'Lightning Web Component: jobHistory', 'LightningComponentBundle'],
  [`${D}/lwc/jobHistory/__tests__/jobHistory.test.js`, 'Lightning Web Component: jobHistory', 'LightningComponentBundle'],
  [`${D}/aura/JobPanel/JobPanelController.js`, 'Aura Component: JobPanel', 'AuraDefinitionBundle'],
  [`${D}/layouts/Contact-Contact Layout.layout-meta.xml`, 'Page Layout: Contact-Contact Layout', 'Layout'],
  [`${D}/permissionsets/Job_History_Access.permissionset-meta.xml`, 'Permission Set: Job_History_Access', 'PermissionSet'],
  [`${D}/customMetadata/Job_Setting.Default.md-meta.xml`, 'Custom Metadata Record: Job_Setting.Default', 'CustomMetadata'],
  [`${D}/reports/Sales_Reports/Job_Changes.report-meta.xml`, 'Report: Sales_Reports/Job_Changes', 'Report'],
  [`${D}/reports/Sales_Reports.reportFolder-meta.xml`, 'Report Folder: Sales_Reports', 'Report'],
  [`${D}/dashboards/Sales_Dashboards/Job_Moves.dashboard-meta.xml`, 'Dashboard: Sales_Dashboards/Job_Moves', 'Dashboard'],
  [`${D}/dashboards/Sales_Dashboards.dashboardFolder-meta.xml`, 'Dashboard Folder: Sales_Dashboards', 'Dashboard'],
  [`${D}/staticresources/logo.png`, 'Static Resource: logo', 'StaticResource'],
  [`${D}/staticresources/logo.resource-meta.xml`, 'Static Resource: logo', 'StaticResource'],
  // Not under force-app: the folder decides, wherever the package directory is.
  ['src/classes/Other.cls', 'Apex Class: Other', 'ApexClass'],
];

test('the salesforce profile names objects, fields, flows, Apex, LWC and Aura bundles, layouts, permission sets, custom metadata, reports and dashboards by type (T-99)', (t) => {
  for (const [path, shown, type] of NAMED) {
    const c = sfComponent(path);
    assert.ok(c, `${path} is a component`);
    assert.equal(`${c.label}: ${c.name}`, shown, path);
    assert.equal(c.type, type, path);
  }
  t.diagnostic(`named ${NAMED.length} paths`);
  assert.ok(NAMED.length >= 20);
});

test('edge case: a path the profile doesn\'t know is null, for its caller to show as itself, never dropped (T-99)', () => {
  for (const path of [
    'README.md', 'scripts/apex/seed.apex', 'docs/classes/notes.md', `${D}/classes`, `${D}/objects/Contact/fields`,
    `${D}/objects/Contact/Account.object-meta.xml`, `${D}/objects/Contact/oddParts/X.thing-meta.xml`, `${D}/lwc/loose.js`, `${D}/flows/README.md`, '',
  ]) assert.equal(sfComponent(path), null, path || 'an empty path');
});
