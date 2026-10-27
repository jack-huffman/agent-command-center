// Setting up and using the Command Center without access to Production (D-T-125): B0.config's Do it offers
// it beside the Production orgs and asks which My Domain, and Production's org controls say why they're off.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { domainItem, NO_PRODUCTION, type SandboxDomain, sandboxDomains } from '../src/logic/no-production.ts';
import { initArgs, initCommand, productionOrgs } from '../src/logic/setup.ts';
import { environmentsModel, PRODUCTION_NO_ORG } from '../src/model/environments.ts';
import { envs, hub } from './support.ts';

const LIST = {
  status: 0,
  result: {
    nonScratchOrgs: [
      { alias: 'acme-prod', instanceUrl: 'https://acme.my.salesforce.com', isSandbox: false },
      { alias: 'acme-uat', instanceUrl: 'https://acme--uat.sandbox.my.salesforce.com', isSandbox: true },
      { alias: 'globex-qa', instanceUrl: 'https://globex--qa.sandbox.my.salesforce.com', isSandbox: true },
      { instanceUrl: 'https://initech--dev.sandbox.my.salesforce.com', isSandbox: true },
    ],
    sandboxes: [{ alias: 'acme-dev', instanceUrl: 'https://acme--dev.sandbox.my.salesforce.com', isSandbox: true }],
  },
};

test('the My Domains offered are those with a logged-in sandbox, each with its sandboxes; none when sf failed or listed none', () => {
  const domains: SandboxDomain[] = sandboxDomains(LIST);
  assert.deepEqual(domains, [{ domain: 'acme', sandboxes: ['dev', 'uat'] }, { domain: 'globex', sandboxes: ['qa'] }], 'Production isn\'t a sandbox, and one with no alias can\'t be used');
  assert.deepEqual(domainItem(domains[0]!), { label: '$(cloud) acme', description: '2 sandboxes: dev, uat', domain: 'acme' });
  assert.equal(domainItem(domains[1]!).description, '1 sandbox: qa');
  assert.deepEqual(sandboxDomains({ status: 1, message: 'sf failed' }), []);
  assert.deepEqual(sandboxDomains(null), []);
  assert.deepEqual(productionOrgs(LIST), ['acme-prod'], 'the Production orgs are still listed beside it');
});

test('"I don\'t have access to Production" is the third answer, beside the orgs and logging in to another', () => {
  assert.match(NO_PRODUCTION.label, /I don't have access to Production$/);
  assert.match(NO_PRODUCTION.description, /sandboxes you're logged in to/);
  const src = readFileSync(join(import.meta.dirname, '..', 'src', 'setup.ts'), 'utf8');
  assert.match(src, /\[\.\.\.orgs\.map\(\(label\) => \(\{ label \}\)\), other, NO_PRODUCTION\]/, 'the orgs found, Log in to another, and no access');
});

test('acc init gets --my-domain without Production, never with --production-org', () => {
  assert.deepEqual(initArgs({ profile: 'salesforce', myDomain: 'acme' }), ['--profile', 'salesforce', '--my-domain', 'acme']);
  assert.equal(initCommand({ from: 't.json', myDomain: 'acme' }), 'acc init --from t.json --my-domain acme');
  assert.deepEqual(initArgs({ profile: 'salesforce', productionOrg: 'acme-prod' }), ['--profile', 'salesforce', '--production-org', 'acme-prod'], 'unchanged with Production');
});

test('Production with no org on this machine shows Open org and Deploy disabled, with who they need; a sandbox without one shows neither', () => {
  const h = hub();
  const p = h.projects[0]!;
  p.config = { ...p.config, environments: envs.map((e) => (e.type === 'production' ? { ...e, org: null } : e.branch === 'sandbox' ? { ...e, org: null } : e)) };
  const cards = environmentsModel(h).projects[0]!.envs;
  const prod = cards.find((e) => e.branch === 'production')!;
  assert.deepEqual(prod.actions.filter((a) => a.disabled).map((a) => [a.label, a.disabled]), [['Open org', PRODUCTION_NO_ORG], ['Deploy…', PRODUCTION_NO_ORG]]);
  assert.match(PRODUCTION_NO_ORG, /Someone with access to Production/);
  const sandbox = cards.find((e) => e.branch === 'sandbox')!;
  assert.ok(!sandbox.actions.some((a) => a.label === 'Open org' || a.label === 'Deploy…'));
  const loggedIn = environmentsModel(hub()).projects[0]!.envs.find((e) => e.branch === 'production')!;
  assert.ok(loggedIn.actions.filter((a) => a.label === 'Open org' || a.label === 'Deploy…').every((a) => !a.disabled), 'with an org, both work as before');
});
