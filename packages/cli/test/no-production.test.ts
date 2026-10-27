// acc init --my-domain and acc setup production (D-T-125), run from source with a stand-in sf on PATH.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fakeBin, makeRepo, SF_CONFIG } from '../../core/test/support.ts';
import { cli } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

/** sf with two acme sandboxes logged in, Dev tracked, and acme-prod as Production with three sandboxes. */
const SF = fakeBin('sf', `case "$1 $2" in
  "org list") echo '{"status":0,"result":{"nonScratchOrgs":[{"alias":"acme-dev","instanceUrl":"https://acme--dev.sandbox.my.salesforce.com","tracksSource":true},{"alias":"acme-uat","instanceUrl":"https://acme--uat.sandbox.my.salesforce.com"}]}}' ;;
  "org display") echo '{"status":0,"result":{"instanceUrl":"https://acme.my.salesforce.com"}}' ;;
  "data query") echo '{"status":0,"result":{"records":[{"SandboxName":"UAT","LicenseType":"FULL"},{"SandboxName":"Dev","LicenseType":"DEVELOPER"},{"SandboxName":"Train","LicenseType":"PARTIAL"}]}}' ;;
  *) echo '{"status":1,"message":"no fake"}'; exit 1 ;;
esac
`);

test('init --my-domain sets up a Salesforce project from the logged-in sandboxes, with Production and no org', () => {
  const dir = makeRepo();
  const r = acc(dir, ['init', '--profile', 'salesforce', '--my-domain', 'acme', '--json'], undefined, SF);
  assert.equal(r.code, 0, r.err);
  const written = JSON.parse(readFileSync(join(dir, '.acc', 'config.json'), 'utf8')) as { environments: { name: string; type: string; org: string | null; default: boolean }[] };
  assert.deepEqual(written.environments.map((e) => [e.name, e.type, e.org, e.default]), [
    ['Production', 'production', null, false], ['dev', 'developer', 'acme-dev', true], ['uat', 'partial', 'acme-uat', false],
  ]);
  assert.match(r.json().notes.join('\n'), /uat is taken as partial/);
});

test('setup production records Production\'s org, corrects the types, and names the sandboxes the settings lack; without --org it says how', () => {
  const config = { ...SF_CONFIG, environments: [{ name: 'Production', type: 'production', org: null }, { name: 'UAT', type: 'partial', org: 'acme-uat', promotesTo: ['production'] }, { name: 'Dev', type: 'developer', org: 'acme-dev', default: true, promotesTo: ['uat', 'production'] }] };
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(config, null, 2) });
  const usage = acc(dir, ['setup', 'production'], undefined, SF);
  assert.equal(usage.code, 2);
  assert.match(usage.err, /acc setup production --org <alias>/);
  const r = acc(dir, ['setup', 'production', '--org', 'acme-prod'], undefined, SF);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Recorded acme-prod as Production's org \(acme\)/);
  assert.match(r.out, /Corrected from Production's sandbox list: UAT: partial → full\./);
  assert.match(r.out, /Production also has Train \(partial\), which the settings don't list/);
  const written = JSON.parse(readFileSync(join(dir, '.acc', 'config.json'), 'utf8')) as { environments: { name: string; type: string; org: string | null }[] };
  assert.deepEqual(written.environments.map((e) => [e.name, e.type, e.org]), [['Production', 'production', 'acme-prod'], ['UAT', 'full', 'acme-uat'], ['Dev', 'developer', 'acme-dev']]);
});
