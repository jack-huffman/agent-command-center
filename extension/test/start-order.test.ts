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
    // As templateRest: a Salesforce template's Production org is picked with sf, only after the check.
    complete: async (c) => {
      if (c.profile !== 'salesforce') return c;
      calls.push('sf org list');
      return org ? { ...c, org } : undefined;
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
    complete: async () => assert.fail('no template is completed'),
    start: (c) => calls.push(`start ${c.profile}`),
  });
  assert.deepEqual(calls, ['check generic', 'start generic']);
});

test('a Salesforce team template with sf missing shows the machine list before any sf call, and picks Production after Go on anyway', async () => {
  const s = sfMissing('acme-prod', { profile: 'salesforce' });
  await startInOrder('template', s.steps);
  assert.deepEqual(s.calls, ['template', 'machine list: salesforce, A1.sf to do'], 'nothing calls sf while the list is shown');
  await s.goOn();
  assert.deepEqual(s.calls.slice(2), ['sf org list', 'acc init salesforce acme-prod']);
});

test('edge case: backing out of a Salesforce template\'s Production pick after Go on anyway starts nothing', async () => {
  const s = sfMissing(undefined, { profile: 'salesforce' });
  await startInOrder('template', s.steps);
  await s.goOn();
  assert.deepEqual(s.calls, ['template', 'machine list: salesforce, A1.sf to do', 'sf org list']);
});

test('an Other team template calls no sf, before or after the check', async () => {
  const s = sfMissing('acme-prod', { profile: 'generic' });
  await startInOrder('template', s.steps);
  await s.goOn();
  assert.deepEqual(s.calls, ['template', 'machine list: generic, A1.sf to do', 'acc init generic']);
});

test('edge case: a template the person backed out of checks nothing and starts nothing', async () => {
  const s = sfMissing('acme-prod', undefined);
  await startInOrder('template', s.steps);
  assert.deepEqual(s.calls, ['template']);
});
