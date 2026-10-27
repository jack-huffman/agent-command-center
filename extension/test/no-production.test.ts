// Setting up and using the Command Center without access to Production (D-208): B0.config's Do it offers
// it beside the Production orgs and asks which My Domain, and Production's org controls say why they're off.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PRODUCTION_NOT_HERE } from '../../packages/core/src/sf-discovery.ts';
import { asksProduction, domainItem, LOGIN_PRODUCTION, NO_PRODUCTION, productionChoices, productionNext, productionNotHere, type SandboxDomain, sandboxDomains } from '../src/logic/no-production.ts';
import { type DoctorItem, initArgs, initCommand, productionOrgs } from '../src/logic/setup.ts';
import { environmentsModel, PRODUCTION_AWAY } from '../src/model/environments.ts';
import type { HomeModel } from '../src/model/home.ts';
import { PAGES, sampleModel } from '../scripts/screenshot.ts';
import { pageDom, type PageElement } from './page-dom.ts';
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
const ONLY_PRODUCTION = { status: 0, result: { nonScratchOrgs: [LIST.result.nonScratchOrgs[0]] } };

test('the My Domains offered are those with a logged-in sandbox, each with its sandboxes; none when sf failed or listed none', () => {
  const domains: SandboxDomain[] = sandboxDomains(LIST);
  assert.deepEqual(domains, [{ domain: 'acme', sandboxes: ['dev', 'uat'] }, { domain: 'globex', sandboxes: ['qa'] }], 'Production isn\'t a sandbox, and one with no alias can\'t be used');
  assert.deepEqual(domainItem(domains[0]!), { label: '$(cloud) acme', description: '2 sandboxes: dev, uat', domain: 'acme' });
  assert.equal(domainItem(domains[1]!).description, '1 sandbox: qa');
  assert.deepEqual(sandboxDomains({ status: 1, message: 'sf failed' }), []);
  assert.deepEqual(sandboxDomains(null), []);
});

test('"Which org is Production?" offers the orgs found, then Log in to another and no access; with no org logged in, only those two', () => {
  const choices = productionChoices(productionOrgs(LIST));
  assert.deepEqual(choices.map((c) => c.label), ['acme-prod', LOGIN_PRODUCTION.label, NO_PRODUCTION.label]);
  assert.match(NO_PRODUCTION.label, /I don't have access to Production$/);
  assert.deepEqual(productionChoices([]), [LOGIN_PRODUCTION, NO_PRODUCTION]);
});

test('each answer leads on: an org to acc init, a login, the My Domain question, or nothing when backed out', () => {
  const [org] = productionChoices(['acme-prod']);
  assert.deepEqual(productionNext(org, LIST), { kind: 'org', productionOrg: 'acme-prod' });
  assert.deepEqual(productionNext(LOGIN_PRODUCTION, LIST), { kind: 'login-production' });
  assert.deepEqual(productionNext(undefined, LIST), { kind: 'cancel' }, 'backed out');
  assert.deepEqual(productionNext(NO_PRODUCTION, LIST), { kind: 'ask-domain', domains: sandboxDomains(LIST) }, 'no access asks which My Domain');
});

test('no access with no sandbox logged in, or an sf that failed, offers the sandbox login instead of the My Domain question', () => {
  assert.deepEqual(productionNext(NO_PRODUCTION, ONLY_PRODUCTION), { kind: 'login-sandbox' });
  assert.deepEqual(productionNext(NO_PRODUCTION, null), { kind: 'login-sandbox' });
});

test('a team template asks the Production question only for a Salesforce project, whether it sets the profile or the person picked it', () => {
  assert.equal(asksProduction('salesforce', undefined), true);
  assert.equal(asksProduction(undefined, 'salesforce'), true);
  assert.equal(asksProduction('generic', undefined), false);
  assert.equal(asksProduction(undefined, 'generic'), false);
  assert.equal(asksProduction(undefined, undefined), false);
  assert.equal(asksProduction(null, 'salesforce'), true, 'a template that sets no profile reads as null');
  assert.equal(initCommand({ from: 't.json', myDomain: 'acme' }), 'acc init --from t.json --my-domain acme', 'the template path gets the My Domain');
});

test('acc init gets --my-domain without Production, never with --production-org', () => {
  assert.deepEqual(initArgs({ profile: 'salesforce', myDomain: 'acme' }), ['--profile', 'salesforce', '--my-domain', 'acme']);
  assert.deepEqual(initArgs({ profile: 'salesforce', productionOrg: 'acme-prod' }), ['--profile', 'salesforce', '--production-org', 'acme-prod'], 'unchanged with Production');
});

test('Production with no org on this machine shows Open org and Deploy disabled, with who they need; a sandbox without one shows neither', () => {
  const h = hub();
  const p = h.projects[0]!;
  p.config = { ...p.config, environments: envs.map((e) => (e.type === 'production' ? { ...e, org: null } : e.branch === 'sandbox' ? { ...e, org: null } : e)) };
  const cards = environmentsModel(h).projects[0]!.envs;
  const prod = cards.find((e) => e.branch === 'production')!;
  assert.deepEqual(prod.actions.filter((a) => a.disabled).map((a) => [a.label, a.disabled]), [['Open org', PRODUCTION_AWAY], ['Deploy…', PRODUCTION_AWAY]]);
  assert.match(PRODUCTION_AWAY, /Someone with access to Production/);
  const sandbox = cards.find((e) => e.branch === 'sandbox')!;
  assert.ok(!sandbox.actions.some((a) => a.label === 'Open org' || a.label === 'Deploy…'));
});

/** B6.org-match's result as acc reports it, with Production's line when it isn't logged in here. */
const orgMatch = (detail: string, status: DoctorItem['status'] = 'pass'): DoctorItem => ({ id: 'B6.org-match', part: 'project', title: 'Each branch points at the right org', status, detail });

test('joining: Production has an alias this machine isn\'t logged in to, and the last Setup check said so: Open org and Deploy are off with why', () => {
  const h = hub();
  const root = h.projects[0]!.root;
  const items = [orgMatch(`production: ${PRODUCTION_NOT_HERE}, sandbox → acme--sandbox`)];
  const cards = environmentsModel(h, undefined, productionNotHere(items, root, (path) => h.projectFor(path))).projects[0]!.envs;
  const prod = cards.find((e) => e.branch === 'production')!;
  assert.equal(prod.org !== null, true, 'Production has its alias');
  assert.deepEqual(prod.actions.filter((a) => a.label === 'Open org' || a.label === 'Deploy…').map((a) => [a.label, a.disabled]), [['Open org', PRODUCTION_AWAY], ['Deploy…', PRODUCTION_AWAY]]);
  assert.ok(cards.filter((e) => e.branch !== 'production').every((e) => e.actions.every((a) => !a.disabled)), 'the sandboxes\' controls stay on');
  const failed = productionNotHere([orgMatch(`"x" isn't a sandbox. production: ${PRODUCTION_NOT_HERE}`, 'fail')], root, (path) => h.projectFor(path));
  assert.equal(failed(root, 'production'), true, 'a failure on a sandbox still says Production isn\'t here');
});

test('the page draws a disabled environment action disabled, with why in its title, and a click sends nothing; edge case: an enabled one still runs', async () => {
  const page = pageDom();
  const { actionButton } = await import('../webview/dom.ts');
  const ref = { project: '/r', env: 'production' };
  const off = actionButton({ command: 'acc.env.openOrg', label: 'Open org', icon: 'globe', ref, disabled: PRODUCTION_AWAY }) as unknown as PageElement;
  assert.deepEqual([off.disabled, off.title, off.getAttribute('aria-description')], [true, `Open org: ${PRODUCTION_AWAY}`, PRODUCTION_AWAY]);
  off.click();
  assert.equal(page.sent.length, 0, 'a disabled button sends nothing');
  const on = actionButton({ command: 'acc.env.openOrg', label: 'Open org', icon: 'globe', ref }) as unknown as PageElement;
  assert.equal(on.disabled, false);
  on.click();
  assert.deepEqual(page.sent, [{ type: 'run', command: 'acc.env.openOrg', ref }]);
});

test('the screenshot run draws Environments on a machine not logged in to Production, its Open org and Deploy… off', () => {
  assert.ok(PAGES.includes('environments-away'));
  const m = sampleModel('environments-away') as HomeModel;
  assert.equal(m.section, 'environments');
  const prod = m.environments.projects[0]!.envs.find((e) => e.type === 'production')!;
  assert.deepEqual(prod.actions.filter((a) => a.disabled).map((a) => a.label), ['Open org', 'Deploy…']);
});

test('Production\'s controls stay on before the first Setup check, when it found Production logged in, and for another project than the one checked', () => {
  const h = hub();
  const root = h.projects[0]!.root;
  const on = (notHere: (root: string, branch: string) => boolean) => environmentsModel(h, undefined, notHere).projects[0]!.envs
    .find((e) => e.branch === 'production')!.actions.filter((a) => a.label === 'Open org' || a.label === 'Deploy…').every((a) => !a.disabled);
  assert.equal(on(productionNotHere([], root, (path) => h.projectFor(path))), true, 'no result yet');
  assert.equal(on(productionNotHere([orgMatch('production → acme, sandbox → acme--sandbox')], root, (path) => h.projectFor(path))), true, 'logged in, unchanged');
  assert.equal(on(productionNotHere([orgMatch(`production: ${PRODUCTION_NOT_HERE}`)], '/somewhere/else', () => undefined)), true, 'checked in another folder');
  assert.equal(on(productionNotHere([orgMatch(`production: ${PRODUCTION_NOT_HERE}`)], null, (path) => h.projectFor(path))), true, 'no folder open');
});
