// Which trackers drop their saved tickets after a sign-out (T-141): those of the site with no sign-in now; one that
// still has its own, or its site's (GH-79), keeps them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { credKey, readCreds, siteCredKey } from '../src/logic/connect.ts';
import { signedOutTrackers } from '../src/logic/signed-out.ts';

const REPO = { config: { github: null }, ledgerPath: '/x/.git/acc/ledger.json' };
const SITE = 'acme.atlassian.net';
const JIRA = { kind: 'jira', site: SITE, project: 'ACME' };
const BILL = { kind: 'jira', site: SITE, project: 'BILL' };
const OTHER = { kind: 'jira', site: 'other.atlassian.net', project: 'OPS' };
const MONDAY = { kind: 'monday', account: 'acme' };
const jordan = { kind: 'jira', method: 'token', email: 'jordan@acme.example', token: 'jordan-token-0123456789' };

const machine = (entries: [string, unknown][]) => new Map(entries.map(([k, v]) => [k, JSON.stringify(v)]));
const reader = (m: Map<string, string>) => (t: { kind: string }) => readCreds((k) => m.get(k), REPO, t.kind, t.kind === 'jira' ? (t as typeof JIRA).site : 'acme');

test('with no sign-in left on the site, each of its trackers drops its saved tickets, and no other site\'s does', async () => {
  const gone = await signedOutTrackers([JIRA, BILL, OTHER, MONDAY], 'jira', SITE, reader(machine([])));
  assert.deepEqual(gone, [JIRA, BILL]);
});

test('edge case: the site\'s sign-in still serving the project keeps its tickets; a "this project only" sign-out drops them', async () => {
  const m = machine([[siteCredKey('jira', SITE), jordan]]);
  assert.deepEqual(await signedOutTrackers([JIRA, BILL], 'jira', SITE, reader(m)), [], 'the site\'s sign-in keeps them');
  m.set(credKey(REPO, 'jira', SITE), JSON.stringify({ kind: 'jira', signedOut: true }));
  assert.deepEqual(await signedOutTrackers([JIRA, BILL], 'jira', SITE, reader(m)), [JIRA, BILL], 'signed out of this project only: they go');
});

test('edge case: a project\'s own sign-in keeps its tickets when the site\'s is signed out', async () => {
  const m = machine([[credKey(REPO, 'jira', SITE), jordan]]);
  assert.deepEqual(await signedOutTrackers([JIRA], 'jira', SITE, reader(m)), []);
  assert.deepEqual(await signedOutTrackers([], 'jira', SITE, reader(m)), [], 'a project with no trackers drops none');
});
