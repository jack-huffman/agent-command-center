// The Connect page (GH-51): its steps, where each error lands, what it writes and keeps, and that a token
// never leaves the extension. The session runs with stand-ins for VSCode's secrets, the trackers and gh.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { replaceTracker, type Tracker, withTracker } from '../../packages/core/src/config.ts';
import { DESCRIPTIONS, type TrackerDescription } from '../../packages/core/src/trackers/connect.ts';
import type { Exec } from '../../packages/core/src/trackers/types.ts';
import { type ConnectDeps, type ConnectProject, ConnectSession } from '../src/connect.ts';
import { credKey } from '../src/logic.ts';
import { blankConnect, type ConnectMessage, type ConnectModel, connectModel, isFromWebview } from '../src/model.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = '/Users/me/code/acme-service';
const SITE = 'acme.atlassian.net';
const EMAIL = 'jordan.kim@example.com';
const TOKEN = 'secret-token-0123456789';
const ACME: ConnectProject & { ledgerPath: string } = { name: 'Acme Service', root: ROOT, config: { github: { repo: 'acme/service', account: 'jordan-kim' } }, ledgerPath: `${ROOT}/.git/acc/ledger.json` };
const b64 = (s: string) => Buffer.from(s).toString('base64');
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };

const full = (t: Record<string, unknown>): Tracker => ({
  kind: t.kind as Tracker['kind'], site: (t.site as string) ?? null, project: (t.project as string) ?? null, repo: (t.repo as string) ?? null, organization: (t.organization as string) ?? null,
  team: (t.team as string) ?? null, board: (t.board as number | string) ?? null, prefix: (t.prefix as string) ?? null, skipLabels: (t.skipLabels as string[]) ?? [],
  epic: (t.epic as string) ?? null, labels: (t.labels as string[]) ?? [], areaPath: (t.areaPath as string) ?? null, edits: t.edits === true,
});

type Answer = Response | Promise<Response>;
/** Jira, answering only this email and token. Epics can be held back or fail. */
function jira(epics?: (url: URL) => Answer): typeof fetch {
  return (async (url: string, init: { headers: Record<string, string> }) => {
    if (init.headers.Authorization !== `Basic ${b64(`${EMAIL}:${TOKEN}`)}`) return new Response(JSON.stringify({ errorMessages: ['Unauthorized'] }), { status: 401 });
    const u = new URL(url);
    if (u.pathname === '/rest/api/3/myself') return Response.json({ accountId: 'a1', displayName: 'Jordan Kim' });
    if (u.pathname === '/rest/api/3/project/search') return Response.json({ values: [{ key: 'ACME', name: 'Acme Service Desk' }, { key: 'OPS', name: 'Operations' }] });
    if (u.pathname === '/rest/api/3/search/jql') return epics ? epics(u) : Response.json({ issues: [{ key: 'ACME-31', fields: { summary: 'Renewals' } }] });
    if (u.pathname === '/rest/agile/1.0/board') return Response.json({ values: [{ id: 7, name: 'ACME board', type: 'scrum' }, { id: 9, name: 'Support', type: 'kanban' }] });
    return new Response('', { status: 404 });
  }) as unknown as typeof fetch;
}

/** Azure DevOps, answering only the Microsoft sign-in's header. */
const azure = (async (url: string, init: { headers: Record<string, string> }) => {
  if (init.headers.Authorization !== 'Bearer ms-token') return new Response('', { status: 401 });
  const u = new URL(url);
  if (u.pathname.endsWith('/_apis/connectionData')) return Response.json({ authenticatedUser: { id: 'u1', providerDisplayName: 'Jordan Kim' } });
  if (u.pathname === '/acme/_apis/projects') return Response.json({ value: [{ name: 'CRM' }] });
  if (u.pathname.endsWith('/teams')) return Response.json({ value: [{ name: 'Alpha' }, { name: 'CRM Team' }] });
  if (u.pathname === '/acme/_apis/projects/CRM') return Response.json({ defaultTeam: { name: 'CRM Team' } });
  if (u.pathname.endsWith('/_apis/work/boards')) return Response.json({ value: [{ name: 'Epics' }, { name: 'Stories' }] });
  if (u.pathname.endsWith('/teamfieldvalues')) return Response.json({ field: { referenceName: 'System.AreaPath' }, values: [{ value: 'CRM\\Billing', includeChildren: false }] });
  if (u.pathname.endsWith('/classificationnodes/Areas')) return Response.json({ name: 'CRM', children: [{ name: 'Billing' }] });
  return new Response('', { status: 404 });
}) as unknown as typeof fetch;

/** gh, as the project's account: who it is, and the repo's labels. */
const gh: Exec = async (_cmd, args) => {
  if (args[0] === 'api' && args[1] === 'user') return { code: 0, stdout: JSON.stringify({ login: 'jordan-kim', name: 'Jordan Kim' }), stderr: '' };
  if (args[0] === 'label') return { code: 0, stdout: JSON.stringify([{ name: 'billing', color: 'aabbcc' }, { name: 'invoices', color: '' }]), stderr: '' };
  return { code: 1, stdout: '', stderr: 'unexpected' };
};

function harness(o: { trackers?: Record<string, unknown>[]; fetch?: typeof fetch; project?: typeof ACME; list?: TrackerDescription[] } = {}) {
  const project = o.project ?? ACME;
  const h = {
    raw: o.trackers ?? [] as Record<string, unknown>[],
    secrets: new Map<string, string>(),
    posted: [] as string[], logs: [] as string[], saved: [] as string[], signedIn: [] as string[],
    session: null as unknown as ConnectSession,
    model: () => h.session.model() as ConnectModel,
    send: (m: Record<string, unknown>) => {
      const msg = { ...m, session: h.model().id };
      assert.ok(isFromWebview(msg), `the page may send ${JSON.stringify(m)}`);
      h.session.receive(msg as ConnectMessage);
    },
  };
  const deps: ConnectDeps = {
    projects: () => [project],
    trackers: () => h.raw.map(full),
    title: (t) => `${t.kind} · ${t.project ?? t.repo}`,
    storedSignIn: async (_root, kind, host) => {
      const raw = h.secrets.get(credKey(project, kind, host.toLowerCase()));
      if (!raw) return null;
      const { kind: _k, method, ...fields } = JSON.parse(raw) as Record<string, string>;
      return { method: method ?? 'token', fields, header: null, gh: null };
    },
    storeSignIn: async (_root, kind, host, cred) => { h.secrets.set(credKey(project, kind, host.toLowerCase()), JSON.stringify(cred)); },
    gitEmail: async () => EMAIL,
    ghToken: async () => 'gh-token',
    microsoft: async () => ({ header: 'Bearer ms-token', cred: { account: { id: 'm1', label: 'jordan@acme.example' }, tenant: 'tenant-1' } }),
    write: (_root, index, record) => { h.raw = index === null ? withTracker(h.raw, record) : replaceTracker(h.raw, index, record); },
    signedIn: async (r) => { h.signedIn.push(r); },
    saved: async (_root, name) => { h.saved.push(name); },
    changed: () => h.posted.push(JSON.stringify(h.session.model())),
    log: (line) => h.logs.push(line),
    exec: gh,
    fetch: o.fetch ?? jira(),
    list: o.list,
  };
  h.session = new ConnectSession(deps);
  return h;
}

const field = (m: ConnectModel, key: string) => m.fields.find((f) => f.key === key)!;
const picker = (m: ConnectModel, key: string) => m.pickers.find((p) => p.key === key)!;

test('a new Jira tracker: the email from the repo, nothing to pick until it signs in, and each error beside its field', async () => {
  const h = harness();
  assert.equal(await h.session.open({ root: ROOT, kind: 'jira', from: 'tasks' }), true);
  let m = h.model();
  assert.deepEqual([m.kind, m.title, m.back.label], ['jira', 'Connect a tracker', 'Back to Tasks']);
  assert.deepEqual(m.kinds.map((k) => k.kind), ['jira', 'github', 'azure']);
  assert.equal(field(m, 'email').value, EMAIL, 'the email is the repo\'s git user.email');
  assert.deepEqual([field(m, 'token').type, field(m, 'token').help?.url], ['secret', 'https://id.atlassian.com/manage-profile/security/api-tokens']);
  assert.ok(m.pickers.every((p) => p.disabled), 'nothing to pick before it signs in');
  assert.equal(m.save.can, false);

  h.send({ type: 'connect-test', host: 'not a site!', fields: { email: EMAIL, token: TOKEN } });
  await settle();
  m = h.model();
  assert.match(m.host.error ?? '', /A Jira Cloud site/, 'beside the site');
  h.send({ type: 'connect-test', host: `https://${SITE}/browse/ACME-1`, fields: { email: 'jordan', token: TOKEN } });
  await settle();
  m = h.model();
  assert.deepEqual([m.host.value, m.host.error], [SITE, null], 'any link from the site will do');
  assert.match(field(m, 'email').error ?? '', /An email address/, 'beside the email');

  h.send({ type: 'connect-test', host: SITE, fields: { email: EMAIL, token: 'wrong-token-0123456789' } });
  await settle();
  m = h.model();
  assert.match(field(m, 'token').error ?? '', /refused the email and API token/, 'a refused token, beside the token');
  assert.deepEqual([m.signIn.look.label, m.signIn.look.icon, m.signIn.look.tone], ['Not signed in', 'warning', 'orange']);
  assert.equal(h.secrets.size, 0, 'nothing is kept');
});

test('Test connection signs in for this repo only and fills the lists; Save writes the tracker and nothing else', async () => {
  const h = harness();
  await h.session.open({ root: ROOT, kind: 'jira', from: 'overview' });
  h.send({ type: 'connect-test', host: SITE, fields: { email: EMAIL, token: TOKEN } });
  await settle();
  let m = h.model();
  assert.deepEqual([m.signIn.look.label, m.signIn.look.icon, m.signIn.look.tone, m.signIn.editing], ['Signed in as Jordan Kim', 'pass', 'blue', false]);
  assert.deepEqual([...h.secrets.keys()], ['acc.cred:github:acme/service:jira:acme.atlassian.net'], 'kept under this repo\'s key (D-027)');
  assert.deepEqual(JSON.parse(h.secrets.get('acc.cred:github:acme/service:jira:acme.atlassian.net')!), { kind: 'jira', method: 'token', email: EMAIL, token: TOKEN });
  assert.deepEqual(picker(m, 'project').options.map((o) => o.value), ['ACME', 'OPS']);
  assert.deepEqual(picker(m, 'project').selected, [], 'two projects: a person picks');
  assert.equal(m.save.can, false);

  h.send({ type: 'connect-pick', key: 'project', value: 'ACME' });
  await settle();
  m = h.model();
  assert.equal(picker(m, 'epic').whole, 'The whole ACME project');
  assert.deepEqual(picker(m, 'epic').options.map((o) => o.value), ['ACME-31']);
  assert.deepEqual(picker(m, 'board').selected, ['7'], 'the project\'s first board, until another is picked');
  assert.equal(m.save.can, true);
  assert.equal(m.save.label, 'Connect Jira');

  h.send({ type: 'connect-save' });
  await settle();
  assert.deepEqual(h.raw, [{ kind: 'jira', site: SITE, project: 'ACME', board: 7 }], 'the whole project: no epic');
  assert.deepEqual(h.saved, ['Jira'], 'then the projects reload, B14 is checked again and the Tasks tab opens');
  assert.equal(h.session.model(), null, 'the page closes');
  for (const p of [...h.posted, ...h.logs]) assert.ok(!p.includes(TOKEN), 'no token in anything the page is sent, or the log');
});

test('a list that can\'t be read says why beside it, and the whole project can still be taken', async () => {
  const h = harness({ fetch: jira(() => new Response(JSON.stringify({ errorMessages: ['Search is down'] }), { status: 500 })) });
  await h.session.open({ root: ROOT, kind: 'jira', from: 'tasks' });
  h.send({ type: 'connect-test', host: SITE, fields: { email: EMAIL, token: TOKEN } });
  await settle();
  h.send({ type: 'connect-pick', key: 'project', value: 'ACME' });
  await settle();
  const m = h.model();
  const epic = picker(m, 'epic');
  assert.deepEqual([epic.look?.icon, epic.look?.tone], ['warning', 'orange']);
  assert.match(epic.look?.label ?? '', /^Couldn't list them: .*Search is down.* You can take the whole project now/);
  assert.equal(epic.whole, 'The whole ACME project');
  assert.equal(m.save.can, true);
  h.send({ type: 'connect-save' });
  await settle();
  assert.deepEqual(h.raw, [{ kind: 'jira', site: SITE, project: 'ACME', board: 7 }]);
});

test('an existing tracker opens signed in, its project fixed and its done epic kept; Save replaces it in place', async () => {
  const h = harness({ trackers: [{ kind: 'github', skipLabels: ['milestone'] }, { kind: 'jira', site: SITE, project: 'ACME', epic: 'ACME-3', board: 9, edits: true }] });
  // A sign-in kept before GH-51, with no method.
  h.secrets.set(credKey(ACME, 'jira', SITE), JSON.stringify({ kind: 'jira', email: EMAIL, token: TOKEN }));
  await h.session.open({ root: ROOT, index: 1, from: 'tasks' });
  await settle();
  let m = h.model();
  assert.deepEqual([m.title, m.kinds.length, m.host.fixed, m.host.value], ['Change jira · ACME', 0, true, SITE]);
  assert.equal(m.signIn.look.label, 'Signed in as Jordan Kim');
  assert.deepEqual([picker(m, 'project').fixed, picker(m, 'project').selected], [true, ['ACME']], 'another project is another tracker');
  const epic = picker(m, 'epic');
  assert.deepEqual(epic.selected, ['ACME-3']);
  assert.deepEqual(epic.options.map((o) => [o.value, o.detail]), [['ACME-3', 'chosen before, not listed now'], ['ACME-31', 'Renewals']], 'a done epic isn\'t listed, but stays chosen');
  assert.deepEqual(picker(m, 'board').selected, ['9']);
  assert.equal(m.save.label, 'Save changes');

  h.send({ type: 'connect-pick', key: 'project', value: 'OPS' });
  assert.deepEqual(picker(h.model(), 'project').selected, ['ACME'], 'the page can\'t change the project');
  h.send({ type: 'connect-pick', key: 'epic', value: 'ACME-31' });
  await settle();
  m = h.model();
  h.send({ type: 'connect-save' });
  await settle();
  assert.deepEqual(h.raw, [{ kind: 'github', skipLabels: ['milestone'] }, { kind: 'jira', site: SITE, project: 'ACME', epic: 'ACME-31', board: 9, edits: true }], 'in place, keeping what the page doesn\'t manage');
});

test('opened from a Sign in button, the tracker shows its sign-in to type, and signing in lets its board load', async () => {
  const h = harness({ trackers: [{ kind: 'jira', site: SITE, project: 'ACME' }] });
  await h.session.open({ root: ROOT, index: 0, signIn: true, from: 'overview' });
  await settle();
  let m = h.model();
  assert.deepEqual([m.signIn.editing, m.signIn.look.label, m.fields.map((f) => f.key)], [true, 'Not signed in yet', ['email', 'token']]);
  h.send({ type: 'connect-test', host: '', fields: { email: EMAIL, token: TOKEN } });
  await settle();
  m = h.model();
  assert.equal(m.signIn.look.label, 'Signed in as Jordan Kim');
  assert.deepEqual(h.signedIn, [ROOT], 'the board reloads with the new sign-in');
  assert.deepEqual(picker(m, 'board').selected, ['7'], 'no board was set: the first, as the board already shows');
});

test('a late list for a project no longer chosen is dropped', async () => {
  const held: Record<string, (r: Response) => void> = {};
  const h = harness({ fetch: jira((u) => new Promise((resolve) => { held[/"OPS"/.test(u.searchParams.get('jql') ?? '') ? 'OPS' : 'ACME'] = resolve; })) });
  await h.session.open({ root: ROOT, kind: 'jira', from: 'tasks' });
  h.send({ type: 'connect-test', host: SITE, fields: { email: EMAIL, token: TOKEN } });
  await settle();
  h.send({ type: 'connect-pick', key: 'project', value: 'ACME' });
  await settle();
  h.send({ type: 'connect-pick', key: 'project', value: 'OPS' });
  await settle();
  held.OPS!(Response.json({ issues: [{ key: 'OPS-4', fields: { summary: 'Runbooks' } }] }));
  await settle();
  held.ACME!(Response.json({ issues: [{ key: 'ACME-31', fields: { summary: 'Renewals' } }] }));
  await settle();
  const m = h.model();
  assert.deepEqual([picker(m, 'epic').options.map((o) => o.value), picker(m, 'epic').whole], [['OPS-4'], 'The whole OPS project']);
});

test('GitHub signs in through gh as the project\'s account, with its labels to tick; no ticks is the whole repo', async () => {
  const h = harness();
  await h.session.open({ root: ROOT, kind: 'github', from: 'tasks' });
  await settle();
  let m = h.model();
  assert.deepEqual([m.host.value, m.fields.length, m.signIn.look.label], ['acme/service', 0, 'Signed in as Jordan Kim'], 'nothing to type: it signs in at once');
  assert.deepEqual([picker(m, 'labels').multi, picker(m, 'labels').options.map((o) => o.value), picker(m, 'labels').whole], [true, ['billing', 'invoices'], 'Every issue in acme/service']);
  h.send({ type: 'connect-pick', key: 'labels', value: ['billing', 'not-a-label'] });
  m = h.model();
  assert.deepEqual(picker(m, 'labels').selected, ['billing'], 'only labels the repo has');
  h.send({ type: 'connect-save' });
  await settle();
  assert.deepEqual(h.raw, [{ kind: 'github', labels: ['billing'] }], 'the project\'s own repo is left out');
  assert.equal(h.secrets.size, 0, 'gh keeps its own sign-in');

  // A project with no "github" section has no account for gh: said beside the repo.
  const bare = harness({ project: { ...ACME, config: { github: null } } });
  await bare.session.open({ root: ROOT, kind: 'github', from: 'tasks' });
  bare.send({ type: 'connect-test', host: 'acme/service', fields: {} });
  await settle();
  assert.match(bare.model().host.error ?? '', /no "github" section/);
});

test('Azure DevOps signs in with Microsoft, picks the default team and the stories board, and leaves the default team out', async () => {
  const h = harness({ fetch: azure });
  await h.session.open({ root: ROOT, kind: 'azure', from: 'setup' });
  let m = h.model();
  assert.deepEqual(m.methods.map((x) => [x.id, x.on]), [['microsoft', true], ['pat', false]]);
  assert.deepEqual([m.method.test, m.fields.length], ['Sign in with Microsoft', 0]);
  h.send({ type: 'connect-method', method: 'pat' });
  m = h.model();
  assert.deepEqual([m.fields.map((f) => [f.key, f.type]), m.fields[0]!.help], [[['token', 'secret']], null], 'its token page needs the organization first');
  h.send({ type: 'connect-set', field: 'organization', value: 'https://dev.azure.com/acme/CRM' });
  assert.equal(h.model().fields[0]!.help?.url, 'https://dev.azure.com/acme/_usersSettings/tokens');
  h.send({ type: 'connect-method', method: 'microsoft' });
  h.send({ type: 'connect-test', host: 'acme', fields: {} });
  await settle();
  assert.deepEqual(JSON.parse(h.secrets.get('acc.cred:github:acme/service:azure:acme')!), { kind: 'azure', method: 'microsoft', account: { id: 'm1', label: 'jordan@acme.example' }, tenant: 'tenant-1' });
  m = h.model();
  assert.deepEqual(picker(m, 'project').selected, ['CRM'], 'the only project');
  assert.deepEqual([picker(m, 'team').selected, picker(m, 'board').selected], [['CRM Team'], ['Stories']]);
  assert.deepEqual([picker(m, 'areaPath').whole, picker(m, 'areaPath').options.map((o) => o.value)], ['All of CRM Team\'s work items', ['CRM\\Billing']]);
  h.send({ type: 'connect-save' });
  await settle();
  assert.deepEqual(h.raw, [{ kind: 'azure', organization: 'acme', project: 'CRM', board: 'Stories' }]);
});

test('a page message names its page, and only what a description declares: a token has a size, a pick a shape', () => {
  const s = 'abc123';
  assert.ok(isFromWebview({ type: 'connect-test', session: s, host: SITE, fields: { email: EMAIL, token: TOKEN } }));
  assert.ok(isFromWebview({ type: 'connect-pick', session: s, key: 'labels', value: ['billing'] }));
  assert.ok(isFromWebview({ type: 'connect-pick', session: s, key: 'epic', value: null }));
  assert.ok(isFromWebview({ type: 'connect-kind', session: s, kind: 'azure' }));
  assert.ok(!isFromWebview({ type: 'connect-kind', session: s, kind: 'monday' }), 'a kind no description has');
  assert.ok(!isFromWebview({ type: 'connect-test', session: s, host: SITE, fields: { token: 'x'.repeat(5000) } }), 'an oversized token');
  assert.ok(!isFromWebview({ type: 'connect-test', session: s, host: SITE, fields: { password: TOKEN } }), 'a field no description has');
  assert.ok(!isFromWebview({ type: 'connect-set', session: s, field: 'site', value: 3 }), 'a value that isn\'t words');
  assert.ok(!isFromWebview({ type: 'connect-pick', session: s, key: 'secret', value: 'x' }), 'a picker no description has');
  assert.ok(!isFromWebview({ type: 'connect-pick', session: s, key: 'labels', value: [1] }));
  assert.ok(!isFromWebview({ type: 'connect-save' }), 'every message names its page');
});

test('another tracker is a description, not another page: a fourth one gets its fields, sign-in and lists', () => {
  const MONDAY: TrackerDescription = {
    kind: 'monday', name: 'monday.com', icon: 'calendar',
    host: { key: 'account', label: 'Account', placeholder: 'acme', hint: 'Your monday.com account.', parse: (v) => v.trim() || null, invalid: 'An account name.' },
    methods: [{ id: 'apiToken', label: 'API token', icon: 'key', via: 'fields', test: 'Test connection', hint: 'A personal API token.', fields: [{ key: 'apiToken', label: 'API token', type: 'secret', placeholder: 'Paste it', help: { label: 'Get a token', url: (a) => `https://${a}.monday.com/apps/manage/tokens` } }] }],
    pickers: [
      { key: 'workspace', label: 'Workspace', dependsOn: [], identifies: true, load: async () => [] },
      { key: 'group', label: 'Group', dependsOn: ['workspace'], whole: () => 'Every group', load: async () => [] },
    ],
    verify: async () => ({ id: '1', name: 'Jordan' }),
    toConfig: (c) => ({ kind: 'monday', account: c.host, workspace: c.values.workspace }),
    fromConfig: () => ({ host: '', values: {} }),
  };
  const list = [...DESCRIPTIONS, MONDAY];
  const s = blankConnect(MONDAY, { id: 'p', root: ROOT, projectName: 'Acme Service', ownRepo: null, ghAccount: null, from: 'tasks' });
  s.host = 'acme';
  const m = connectModel(s, list);
  assert.deepEqual(m.kinds.map((k) => k.kind), ['jira', 'github', 'azure', 'monday']);
  assert.deepEqual([m.host.label, m.fields.map((f) => [f.key, f.type, f.value, f.help?.url]), m.method.test], ['Account', [['apiToken', 'secret', '', 'https://acme.monday.com/apps/manage/tokens']], 'Test connection']);
  assert.deepEqual(m.pickers.map((p) => [p.key, p.whole, p.required, p.disabled]), [['workspace', null, true, true], ['group', 'Every group', false, true]]);
});

test('the prompts are gone, and the page draws every tracker without knowing one from another', () => {
  const trackers = readFileSync(join(root, 'src', 'trackers.ts'), 'utf8');
  for (const gone of ['showInputBox', 'Add a tracker to which project', ', 1 of ', 'addJira', 'addAzure', 'addGithub', 'listForPlace']) assert.ok(!trackers.includes(gone), `trackers.ts has no ${gone}`);
  const main = readFileSync(join(root, 'webview', 'main.ts'), 'utf8');
  const start = main.indexOf('// ---------------------------------------------------------------- connecting a tracker (GH-51)');
  const end = main.indexOf('// ---------------------------------------------------------------- the Command Center page');
  assert.ok(start > 0 && end > start);
  assert.doesNotMatch(main.slice(start, end), /jira|azure|github/i, 'no tracker named in the Connect page\'s drawing');
});
