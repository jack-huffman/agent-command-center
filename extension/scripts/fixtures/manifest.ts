/**
 * ACME-19's manifest (T-101), checked against Acme Dev: its welcome-email flow, class, test and new field, the
 * old helper class it deletes, the flow's org copy that differs from the branch, and the email template
 * someone changed in the org that the branch doesn't have.
 */
import type { TicketManifest } from '../../../packages/core/src/manifest.ts';
import { manifestXml } from '../../../packages/core/src/manifest.ts';
import { MIN } from './shared.ts';

const TYPES = [
  { name: 'ApexClass', members: ['WelcomeEmailService', 'WelcomeEmailServiceTest'] },
  { name: 'CustomField', members: ['Contact.Welcome_Sent_At__c'] },
  { name: 'Flow', members: ['Welcome_Email'] },
];
const DELETIONS = [{ name: 'ApexClass', members: ['WelcomeEmailHelper'] }];
const FLOW = 'force-app/main/default/flows/Welcome_Email.flow-meta.xml';

export function sampleManifest(now: number): TicketManifest {
  const at = new Date(now - 4 * MIN).toISOString();
  return {
    v: 1, task: 'ACME-19', key: 'ACME-19', env: 'dev', org: 'Acme Dev', branch: 'task/ACME-19-welcome-email-once', sha: '7c3e9a1d2b4f6e8a0c1d3e5f7a9b1c3d5e7f9a1b', apiVersion: '62.0',
    paths: { changed: [], deleted: [], leftOut: [] },
    package: manifestXml(TYPES, '62.0'), types: TYPES, destructive: manifestXml(DELETIONS, '62.0'), deletions: DELETIONS,
    created: ['CustomField:Contact.Welcome_Sent_At__c'], findings: [], unchecked: null,
    check: {
      at, org: 'Acme Dev', sha: '7c3e9a1d2b4f6e8a0c1d3e5f7a9b1c3d5e7f9a1b', same: 3, other: [],
      differs: [{ type: 'Flow', member: 'Welcome_Email', files: [FLOW], diff: `--- a/${FLOW}\n+++ b/${FLOW}\n-    <label>Welcome Email</label>\n+    <label>Welcome Email (once a day)</label>` }],
      changes: { available: true, items: [{ type: 'EmailTemplate', member: 'Marketing/Welcome', state: 'Changed', path: 'force-app/main/default/email/Marketing/Welcome.email-meta.xml' }] },
    },
    at,
  };
}
