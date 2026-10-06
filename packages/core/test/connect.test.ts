import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replaceTracker, type Tracker, withTracker } from '../src/config.ts';
import { AZURE, declaredKeys, DESCRIPTIONS, describe, GITHUB, JIRA, parseHost, parseRepo, type SignIn } from '../src/trackers/connect.ts';
import { TrackerError } from '../src/trackers/types.ts';

const tracker = (t: Partial<Tracker> & Pick<Tracker, 'kind'>): Tracker => ({ site: null, project: null, repo: null, organization: null, team: null, board: null, prefix: null, skipLabels: [], epic: null, labels: [], areaPath: null, edits: false, ...t });
const SITE = 'acme.atlassian.net';

test('a Jira tracker is written as the config keeps it, and the whole project takes its epic out', () => {
  const record = JIRA.toConfig({ host: SITE, values: { project: 'ACME', epic: null, board: '12' }, defaults: [], ownRepo: 'acme/service' });
  assert.deepEqual(record, { kind: 'jira', site: SITE, project: 'ACME', board: 12, epic: null });
  const was = [{ kind: 'jira', site: SITE, project: 'ACME', epic: 'ACME-3', board: 5, edits: true }];
  assert.deepEqual(withTracker(was, record), [{ kind: 'jira', site: SITE, project: 'ACME', board: 12, edits: true }], 'the epic goes, edits stays');
  assert.deepEqual(replaceTracker(was, 0, record), [{ kind: 'jira', site: SITE, project: 'ACME', board: 12, edits: true }]);
  // With no board picked, none is written: the project's first board.
  assert.equal('board' in withTracker([], JIRA.toConfig({ host: SITE, values: { project: 'ACME', epic: 'ACME-3', board: null }, defaults: [], ownRepo: null }))[0]!, false);
});

test('a GitHub tracker on the project\'s own repo leaves repo out, and no label ticked is the whole repo', () => {
  const own = GITHUB.toConfig({ host: 'acme/service', values: { labels: null }, defaults: [], ownRepo: 'Acme/Service' });
  assert.deepEqual(own, { kind: 'github', repo: null, labels: null });
  assert.deepEqual(withTracker([], own), [{ kind: 'github' }]);
  // It's the same tracker as one that never named its repo: its skipLabels stay, its labels go.
  assert.deepEqual(withTracker([{ kind: 'github', skipLabels: ['milestone'], labels: ['old'] }], own), [{ kind: 'github', skipLabels: ['milestone'] }]);
  const other = GITHUB.toConfig({ host: 'acme/billing', values: { labels: ['billing', 'invoices'] }, defaults: [], ownRepo: 'acme/service' });
  assert.deepEqual(withTracker([{ kind: 'github' }], other), [{ kind: 'github' }, { kind: 'github', repo: 'acme/billing', labels: ['billing', 'invoices'] }], 'another repo is another tracker');
});

test('an Azure DevOps tracker leaves the default team out, and its area path when it takes the whole team', () => {
  const record = AZURE.toConfig({ host: 'acme', values: { project: 'CRM', team: 'CRM Team', board: 'Stories', areaPath: null }, defaults: ['team'], ownRepo: null });
  assert.deepEqual(withTracker([], record), [{ kind: 'azure', organization: 'acme', project: 'CRM', board: 'Stories' }]);
  const sales = AZURE.toConfig({ host: 'acme', values: { project: 'CRM', team: 'Sales', board: 'Stories', areaPath: 'CRM\\Billing' }, defaults: [], ownRepo: null });
  const was = [{ kind: 'azure', organization: 'acme', project: 'CRM', board: 'Epics', prefix: 'WI' }];
  assert.deepEqual(replaceTracker(was, 0, sales), [{ kind: 'azure', organization: 'acme', project: 'CRM', board: 'Stories', prefix: 'WI', team: 'Sales', areaPath: 'CRM\\Billing' }], 'prefix is kept');
});

test('replacing a tracker refuses when the list changed under it', () => {
  assert.throws(() => replaceTracker([{ kind: 'github' }], 0, { kind: 'jira', site: SITE, project: 'ACME' }), /changed since this page opened/);
  assert.throws(() => replaceTracker([], 2, { kind: 'jira' }), /changed since this page opened/);
});

test('an existing tracker opens with its own choices, and saves them back as they were', () => {
  const cases: [typeof JIRA, Tracker, Record<string, unknown>][] = [
    [JIRA, tracker({ kind: 'jira', site: SITE, project: 'ACME', board: 7, epic: 'ACME-3' }), { kind: 'jira', site: SITE, project: 'ACME', board: 7, epic: 'ACME-3' }],
    [GITHUB, tracker({ kind: 'github', labels: ['billing'] }), { kind: 'github', repo: null, labels: ['billing'] }],
    [AZURE, tracker({ kind: 'azure', organization: 'acme', project: 'CRM', team: 'Sales', board: 'Stories', areaPath: 'CRM\\Billing' }), { kind: 'azure', organization: 'acme', project: 'CRM', team: 'Sales', board: 'Stories', areaPath: 'CRM\\Billing' }],
  ];
  for (const [d, t, want] of cases) {
    const { host, values } = d.fromConfig(t, 'acme/service');
    assert.deepEqual(d.toConfig({ host, values, defaults: [], ownRepo: 'acme/service' }), want, d.name);
  }
  assert.equal(GITHUB.fromConfig(tracker({ kind: 'github' }), 'acme/service').host, 'acme/service', 'no repo is the project\'s own');
});

test('a site, organization or repo is taken from whatever is pasted, and anything else is refused', () => {
  assert.equal(JIRA.host.parse('https://Acme.atlassian.net/jira/software/projects/ACME/boards/7'), SITE);
  assert.equal(JIRA.host.parse('acme'), SITE);
  assert.equal(JIRA.host.parse('not a site!'), null);
  assert.equal(parseHost('azure', 'https://dev.azure.com/acme/CRM/_boards'), 'acme');
  assert.equal(parseRepo('https://github.com/acme/service.git'), 'acme/service');
  assert.equal(parseRepo('acme/service/issues/12'), 'acme/service');
  assert.equal(parseRepo('acme'), null);
  const email = JIRA.methods[0]!.fields.find((f) => f.key === 'email')!;
  assert.equal(email.check!('jordan@example.com'), null);
  assert.match(email.check!('jordan') ?? '', /email address/);
  assert.equal(email.prefill, 'git-email', 'the email comes from the repo\'s git config');
  const token = JIRA.methods[0]!.fields.find((f) => f.type === 'secret')!;
  assert.equal(token.help!.url(SITE), 'https://id.atlassian.com/manage-profile/security/api-tokens');
  assert.equal(AZURE.methods.find((m) => m.id === 'pat')!.fields[0]!.help!.url('acme'), 'https://dev.azure.com/acme/_usersSettings/tokens');
});

test('the lists come from the tracker as the sign-in sees it: Jira\'s projects, epics and boards', async () => {
  const asked: string[] = [];
  const answers: Record<string, unknown> = {
    '/rest/api/3/myself': { accountId: 'a1', displayName: 'Jordan Kim' },
    '/rest/api/3/project/search': { values: [{ key: 'ACME', name: 'Acme Service Desk' }] },
    '/rest/api/3/search/jql': { issues: [{ key: 'ACME-31', fields: { summary: 'Renewals' } }] },
    '/rest/agile/1.0/board': { values: [{ id: 7, name: 'ACME board', type: 'scrum' }, { id: 9, name: 'Support', type: 'kanban' }] },
  };
  const fetch = (async (url: string, init: { headers: Record<string, string> }) => {
    asked.push(url);
    assert.equal(init.headers.Authorization, `Basic ${Buffer.from('jordan@example.com:secret-token-123456').toString('base64')}`);
    const path = new URL(url).pathname;
    return new Response(JSON.stringify(answers[path]), { status: answers[path] ? 200 : 404 });
  }) as unknown as typeof globalThis.fetch;
  const signIn: SignIn = { method: 'token', fields: { email: 'jordan@example.com', token: 'secret-token-123456' }, header: null, gh: null };
  const ctx = { host: SITE, signIn, values: { project: 'ACME' }, fetch, exec: async () => ({ code: 1, stdout: '', stderr: '' }) };
  assert.equal((await JIRA.verify(ctx)).name, 'Jordan Kim');
  const [project, epic, board] = JIRA.pickers;
  assert.deepEqual(await project!.load(ctx), [{ value: 'ACME', label: 'ACME', detail: 'Acme Service Desk' }]);
  assert.deepEqual(await epic!.load(ctx), [{ value: 'ACME-31', label: 'ACME-31', detail: 'Renewals' }]);
  assert.equal(epic!.whole!({ host: SITE, values: ctx.values }), 'The whole ACME project');
  assert.deepEqual((await board!.load(ctx)).map((b) => [b.value, b.preferred]), [['7', true], ['9', false]], 'the project\'s first board unless another is picked');
  assert.ok(asked.every((u) => u.startsWith(`https://${SITE}/`)));
});

test('Azure DevOps lists the default team first, prefers the stories board, and a refused sign-in says so', async () => {
  const fetch = (async (url: string, init: { headers: Record<string, string> }) => {
    if (init.headers.Authorization !== `Basic ${Buffer.from(':pat-token-0123456789abcdef').toString('base64')}`) return new Response('', { status: 401 });
    const u = new URL(url);
    if (u.pathname.endsWith('/_apis/connectionData')) return Response.json({ authenticatedUser: { id: 'u1', providerDisplayName: 'Jordan Kim' } });
    if (u.pathname.endsWith('/teams')) return Response.json({ value: [{ name: 'Alpha' }, { name: 'CRM Team' }] });
    if (u.pathname.endsWith('/_apis/projects/CRM')) return Response.json({ defaultTeam: { name: 'CRM Team' } });
    if (u.pathname.endsWith('/_apis/work/boards')) return Response.json({ value: [{ name: 'Epics' }, { name: 'Features' }, { name: 'Stories' }] });
    return new Response('', { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  const pat: SignIn = { method: 'pat', fields: { token: 'pat-token-0123456789abcdef' }, header: null, gh: null };
  const ctx = { host: 'acme', signIn: pat, values: { project: 'CRM', team: 'CRM Team' }, fetch, exec: async () => ({ code: 1, stdout: '', stderr: '' }) };
  assert.equal((await AZURE.verify(ctx)).name, 'Jordan Kim');
  const team = AZURE.pickers.find((p) => p.key === 'team')!;
  assert.deepEqual((await team.load(ctx)).map((o) => [o.value, !!o.default]), [['CRM Team', true], ['Alpha', false]]);
  const board = AZURE.pickers.find((p) => p.key === 'board')!;
  assert.deepEqual((await board.load(ctx)).filter((o) => o.preferred).map((o) => o.value), ['Stories']);
  assert.equal(AZURE.pickers.find((p) => p.key === 'areaPath')!.whole!({ host: 'acme', values: ctx.values }), 'All of CRM Team\'s work items');
  await assert.rejects(AZURE.verify({ ...ctx, signIn: { ...pat, fields: { token: 'wrong-token-0123456789' } } }), (e: unknown) => e instanceof TrackerError && e.kind === 'auth');
});

test('every tracker the page offers is described, and its keys are declared for checking what a page sends', () => {
  assert.deepEqual(DESCRIPTIONS.map((d) => d.kind), ['jira', 'github', 'azure']);
  assert.equal(describe('azure'), AZURE);
  assert.equal(describe('monday'), undefined);
  const keys = declaredKeys();
  assert.deepEqual([...keys.fields].sort(), ['email', 'organization', 'repo', 'site', 'token']);
  assert.deepEqual([...keys.pickers].sort(), ['areaPath', 'board', 'epic', 'labels', 'project', 'team']);
  assert.deepEqual([...keys.methods].sort(), ['gh', 'microsoft', 'pat', 'token']);
  // Each tracker's project names which tracker it is, so an existing one shows it fixed.
  assert.deepEqual(DESCRIPTIONS.map((d) => d.pickers.filter((p) => p.identifies).map((p) => p.key)), [['project'], [], ['project']]);
});
