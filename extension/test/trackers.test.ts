// Tracker sign-ins (GH-79): one for every project on a site, or a repo's own.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { credInUse, credKey, credSite, credWrites, type CredWrites, readCreds, reloadRoots, signOutAnswers, signOutPlan, signOutWrites, siteCredKey, trackerHost } from '../src/logic/connect.ts';

// ---------------------------------------------------------------- one sign-in for every project on a site (GH-79)
const REPO_A = { config: { github: { repo: 'Acme/Service' } }, ledgerPath: '/code/acme-service/.git/acc/ledger.json' };

const REPO_B = { config: { github: null }, ledgerPath: '/x/.git/acc/ledger.json' };

type Repo = typeof REPO_A | typeof REPO_B;

const JIRA_SITE = 'acme.atlassian.net';

const jordan = { kind: 'jira', method: 'token', email: 'jordan@acme.example', token: 'jordan-token-0123456789' };

const pat = { kind: 'jira', method: 'token', email: 'pat@acme.example', token: 'pat-token-0123456789' };

const machine = (entries: [string, unknown][]) => new Map(entries.map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));

const applied = (m: Map<string, string>, w: CredWrites) => {
  for (const [k, v] of w.store) m.set(k, v);
  for (const k of w.delete) m.delete(k);
  return m;
};

const inUse = async (m: Map<string, string>, p: Repo, kind = 'jira', host = JIRA_SITE) => credInUse(await readCreds((k) => m.get(k), p, kind, host));

test('a site\'s sign-in is found from a second repo, and a repo\'s own wins over it', async () => {
  assert.equal(siteCredKey('jira', JIRA_SITE), 'acc.cred:site:jira:acme.atlassian.net');
  assert.equal(credKey(REPO_B, 'jira', JIRA_SITE), 'acc.cred:git:/x/.git:jira:acme.atlassian.net', 'no repo key starts with site:');
  const m = machine([[siteCredKey('jira', JIRA_SITE), jordan]]);
  assert.deepEqual(await inUse(m, REPO_B), { cred: jordan, shared: true }, 'repo B never signed in, and uses the site\'s');
  assert.deepEqual(await inUse(m, REPO_B, 'jira', 'ACME.atlassian.net'), { cred: jordan, shared: true }, 'a host in any case');
  m.set(credKey(REPO_B, 'jira', JIRA_SITE), JSON.stringify(pat));
  assert.deepEqual(await inUse(m, REPO_B), { cred: pat, shared: false }, 'its own wins');
  assert.deepEqual(await inUse(m, REPO_A), { cred: jordan, shared: true }, 'and leaves the rest on the site\'s');
  assert.equal(await inUse(m, REPO_B, 'azure', 'acme'), null, 'another tracker\'s host is another site');
  assert.equal(await inUse(machine([[siteCredKey('jira', 'acme'), jordan]]), REPO_B, 'azure', 'acme'), null, 'Jira and Azure never share one, whatever the host');
  assert.equal((await inUse(machine([[siteCredKey('monday', 'acme'), { kind: 'monday', method: 'token', token: 'x' }]]), REPO_B, 'monday', 'acme'))?.shared, true, 'a monday.com account too');
});

test('a sign-in kept before GH-79 is still its repo\'s, and a "this project only" sign-out hides the site\'s', async () => {
  const legacy = { kind: 'jira', email: 'jordan@acme.example', token: 'jordan-token-0123456789' };
  const m = machine([['acc.cred:github:acme/service:jira:acme.atlassian.net', legacy]]);
  assert.deepEqual(await inUse(m, REPO_A), { cred: legacy, shared: false }, 'read as it always was, with no method');
  assert.equal(await inUse(m, REPO_B), null, 'and never another repo\'s');
  const out = machine([[siteCredKey('jira', JIRA_SITE), jordan], [credKey(REPO_B, 'jira', JIRA_SITE), { kind: 'jira', signedOut: true }]]);
  assert.deepEqual(await readCreds((k) => out.get(k), REPO_B, 'jira', JIRA_SITE), { own: 'signed-out', site: jordan });
  assert.equal(await inUse(out, REPO_B), null, 'signed out here, though the site has one');
  assert.deepEqual(await inUse(out, REPO_A), { cred: jordan, shared: true });
  assert.equal(await inUse(machine([[credKey(REPO_B, 'jira', JIRA_SITE), 'not json'], [siteCredKey('jira', JIRA_SITE), '[]']]), REPO_B), null, 'one that can\'t be read is none');
});

test('keeping a sign-in: for the site, taking this repo\'s own key out, or for this repo, leaving the site\'s', () => {
  const m = machine([[credKey(REPO_B, 'jira', JIRA_SITE), { kind: 'jira', signedOut: true }], [siteCredKey('jira', 'other.atlassian.net'), pat]]);
  assert.deepEqual(credWrites(REPO_B, 'jira', 'ACME.atlassian.net', jordan, true), { store: [[siteCredKey('jira', JIRA_SITE), JSON.stringify(jordan)]], delete: [credKey(REPO_B, 'jira', JIRA_SITE)] });
  applied(m, credWrites(REPO_B, 'jira', JIRA_SITE, jordan, true));
  assert.deepEqual([...m.keys()].sort(), [siteCredKey('jira', JIRA_SITE), siteCredKey('jira', 'other.atlassian.net')], 'the sign-out goes, so this repo uses what was just chosen');
  applied(m, credWrites(REPO_B, 'jira', JIRA_SITE, pat, false));
  assert.equal(m.get(credKey(REPO_B, 'jira', JIRA_SITE)), JSON.stringify(pat));
  assert.equal(m.get(siteCredKey('jira', JIRA_SITE)), JSON.stringify(jordan), 'the site\'s stays for every other project');
});

test('signing out of a site\'s sign-in, either way, never touches another site\'s or another repo\'s own', async () => {
  const start = () => machine([
    [siteCredKey('jira', JIRA_SITE), jordan], [siteCredKey('jira', 'other.atlassian.net'), pat], [siteCredKey('azure', 'acme'), { kind: 'azure', method: 'pat', token: 't' }],
    [credKey(REPO_A, 'jira', JIRA_SITE), pat],
  ]);
  assert.deepEqual(signOutWrites(REPO_B, 'jira', JIRA_SITE, 'every'), { store: [], delete: ['acc.cred:site:jira:acme.atlassian.net'] });
  const every = applied(start(), signOutWrites(REPO_B, 'jira', JIRA_SITE, 'every'));
  assert.deepEqual([...every.keys()], [siteCredKey('jira', 'other.atlassian.net'), siteCredKey('azure', 'acme'), credKey(REPO_A, 'jira', JIRA_SITE)]);
  assert.equal(await inUse(every, REPO_B), null);
  assert.deepEqual(await inUse(every, REPO_A), { cred: pat, shared: false }, 'a repo with its own keeps it');

  const only = applied(start(), signOutWrites(REPO_B, 'jira', JIRA_SITE, 'this'));
  assert.deepEqual(JSON.parse(only.get(credKey(REPO_B, 'jira', JIRA_SITE))!), { kind: 'jira', signedOut: true }, 'a sign-out with no secret in it');
  assert.equal(only.get(siteCredKey('jira', JIRA_SITE)), JSON.stringify(jordan), 'the site\'s stays');
  assert.equal(await inUse(only, REPO_B), null);
  assert.equal(only.size, start().size + 1);

  // A repo's own sign-out falls back to the site's: no modal, since no other repo used it.
  const own = applied(start(), signOutWrites(REPO_A, 'jira', JIRA_SITE, 'own'));
  assert.deepEqual(await inUse(own, REPO_A), { cred: jordan, shared: true });
  assert.equal(own.size, start().size - 1);
});

test('signing out asks only about a site\'s sign-in: Cancel writes nothing, and a repo\'s own goes with no question (GH-79)', async () => {
  const start = () => machine([[siteCredKey('jira', JIRA_SITE), jordan], [siteCredKey('jira', 'other.atlassian.net'), pat], [credKey(REPO_A, 'jira', JIRA_SITE), pat]]);
  const asked: { every: string; only: string }[] = [];
  const answer = (pick: 'every' | 'only' | null) => async (a: { every: string; only: string }) => { asked.push(a); return pick ? a[pick] : undefined; };
  const plan = async (m: Map<string, string>, p: Repo, pick: 'every' | 'only' | null) => {
    const r = await signOutPlan(await readCreds((k) => m.get(k), p, 'jira', 'ACME.atlassian.net'), p, 'jira', 'ACME.atlassian.net', answer(pick));
    if (r) applied(m, r.writes);
    return r?.choice ?? null;
  };

  // Repo B uses the site's: it asks, with these two answers.
  let m = start();
  assert.equal(await plan(m, REPO_B, null), null, 'Cancel');
  assert.deepEqual(asked, [{ every: 'Every project on acme.atlassian.net', only: 'This project only' }]);
  assert.deepEqual(asked[0], signOutAnswers(JIRA_SITE));
  assert.deepEqual(m, start(), 'Cancel writes nothing');
  assert.equal(await plan(m, REPO_B, 'every'), 'every');
  assert.deepEqual([...m.keys()], [siteCredKey('jira', 'other.atlassian.net'), credKey(REPO_A, 'jira', JIRA_SITE)], 'only this site\'s shared sign-in goes');
  m = start();
  assert.equal(await plan(m, REPO_B, 'only'), 'this');
  assert.deepEqual([await inUse(m, REPO_B), m.get(siteCredKey('jira', JIRA_SITE))], [null, JSON.stringify(jordan)], 'signed out here, and the site\'s stays');
  assert.equal(asked.length, 3);

  // Repo A keeps its own: no question, and it falls back to the site's.
  m = start();
  assert.equal(await plan(m, REPO_A, 'every'), 'own');
  assert.equal(asked.length, 3, 'an own sign-in never shows the question');
  assert.deepEqual(await inUse(m, REPO_A), { cred: jordan, shared: true });
  assert.equal(m.get(siteCredKey('jira', JIRA_SITE)), JSON.stringify(jordan));

  // Not signed in, or signed out here already: nothing to ask or write.
  m = machine([[siteCredKey('jira', JIRA_SITE), jordan], [credKey(REPO_B, 'jira', JIRA_SITE), { kind: 'jira', signedOut: true }]]);
  const before = new Map(m);
  assert.equal(await plan(m, REPO_B, 'every'), null);
  assert.equal(await plan(machine([]), REPO_B, 'every'), null);
  assert.deepEqual([m, asked.length], [before, 3]);
});

test('a sign-in\'s key names its tracker and host, a repo\'s or a site\'s', () => {
  assert.deepEqual(credSite('acc.cred:site:jira:acme.atlassian.net'), { kind: 'jira', host: 'acme.atlassian.net' });
  assert.deepEqual(credSite('acc.cred:github:acme/service:azure:acme'), { kind: 'azure', host: 'acme' });
  assert.deepEqual(credSite('acc.cred:git:/a:b/c:monday:acme'), { kind: 'monday', host: 'acme' });
  assert.equal(credSite('acc.slack.webhook'), null);
  assert.equal(credSite('acc.cred:jira'), null);
});

test('a sign-in kept for a site reloads every open project with a tracker there, and no other (GH-79)', () => {
  assert.equal(trackerHost({ kind: 'jira', site: 'https://ACME.atlassian.net/' }), 'acme.atlassian.net');
  assert.equal(trackerHost({ kind: 'azure', organization: 'acme' }), 'acme');
  assert.equal(trackerHost({ kind: 'monday', account: 'Acme' }), 'acme');
  // A Slack tracker's host is its workspace (T-29), so its token is kept as acc.cred:<repo>:slack:acme.
  assert.equal(trackerHost({ kind: 'slack', workspace: 'Acme', account: 'other' }), 'acme');
  assert.equal(credKey(REPO_A, 'slack', trackerHost({ kind: 'slack', workspace: 'acme' })), 'acc.cred:github:acme/service:slack:acme');
  assert.equal(trackerHost({ kind: 'slack' }), '', 'the edge case of a Slack tracker with no workspace');
  const projects = [
    { root: '/a', trackers: [{ kind: 'jira', site: 'acme.atlassian.net' }] },
    { root: '/b', trackers: [{ kind: 'github' }, { kind: 'jira', site: 'https://acme.atlassian.net' }] },
    { root: '/c', trackers: [{ kind: 'jira', site: 'other.atlassian.net' }] },
    { root: '/d', trackers: [{ kind: 'azure', organization: 'acme.atlassian.net' }] },
    { root: '/e', trackers: [] },
  ];
  assert.deepEqual(reloadRoots('/a', { kind: 'jira', host: 'ACME.atlassian.net' }, projects), ['/a', '/b'], 'another site, or another kind on a host of that name, isn\'t reloaded');
  assert.deepEqual(reloadRoots('/e', undefined, projects), ['/e'], 'a sign-in for this project only reloads only it');
  assert.deepEqual(reloadRoots(null, { kind: 'jira', host: 'acme.atlassian.net' }, projects), ['/a', '/b']);
});
