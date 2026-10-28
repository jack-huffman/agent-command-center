// Starting a project checks this machine as soon as its profile is known (T-133): for Salesforce, before
// Production's org is picked with the Salesforce CLI, so a machine without it sees the machine's list first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type StartProfile, startInOrder, type StartSteps } from '../src/logic/start-order.ts';

interface Choice { profile: StartProfile; org?: string }

/** A start whose machine check finds sf missing: it shows the list and keeps go for Go on anyway. */
function sfMissing(org: string | undefined, template?: Choice) {
  const calls: string[] = [];
  let goOn: (() => Promise<void>) | null = null;
  const steps: StartSteps<Choice> = {
    template: async () => (calls.push('template'), template),
    profileOf: (c) => c.profile,
    check: async (profile, go) => {
      calls.push(`machine list: ${profile}, A1.sf to do`);
      goOn = go;
    },
    choose: async (profile) => {
      calls.push('sf org list');
      return org ? { profile, org } : undefined;
    },
    start: (c) => calls.push(`acc init ${c.profile}${c.org ? ` ${c.org}` : ''}`),
  };
  return { calls, steps, goOn: () => goOn!() };
}

test('the Salesforce choice with sf missing shows the machine list first and never calls sf until Go on anyway', async () => {
  const s = sfMissing('acme-prod');
  await startInOrder('salesforce', s.steps);
  assert.deepEqual(s.calls, ['machine list: salesforce, A1.sf to do'], 'nothing calls sf while the list is shown');
  await s.goOn();
  assert.deepEqual(s.calls, ['machine list: salesforce, A1.sf to do', 'sf org list', 'acc init salesforce acme-prod']);
});

test('edge case: backing out of the Production pick after Go on anyway starts nothing', async () => {
  const s = sfMissing(undefined);
  await startInOrder('salesforce', s.steps);
  await s.goOn();
  assert.deepEqual(s.calls, ['machine list: salesforce, A1.sf to do', 'sf org list']);
});

test('a ready machine starts an Other project at once, with its own profile', async () => {
  const calls: string[] = [];
  await startInOrder<Choice>('generic', {
    template: async () => assert.fail('no template is read'),
    profileOf: (c) => c.profile,
    check: async (profile, go) => (calls.push(`check ${profile}`), go()),
    choose: async (profile) => ({ profile }),
    start: (c) => calls.push(`start ${c.profile}`),
  });
  assert.deepEqual(calls, ['check generic', 'start generic']);
});

test('a team template is read first, since it says the profile, and the machine is checked for the template\'s profile', async () => {
  const s = sfMissing(undefined, { profile: 'salesforce', org: 'acme-prod' });
  await startInOrder('template', s.steps);
  assert.deepEqual(s.calls, ['template', 'machine list: salesforce, A1.sf to do'], 'the template\'s choice needs no Production pick');
  await s.goOn();
  assert.deepEqual(s.calls.slice(2), ['acc init salesforce acme-prod']);
});

test('edge case: a template the person backed out of checks nothing and starts nothing', async () => {
  const s = sfMissing('acme-prod', undefined);
  await startInOrder('template', s.steps);
  assert.deepEqual(s.calls, ['template']);
});
