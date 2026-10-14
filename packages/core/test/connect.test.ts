import assert from 'node:assert/strict';
import { test } from 'node:test';
import { replaceTracker, type Tracker, withTracker } from '../src/config.ts';
import { AZURE, declaredKeys, DESCRIPTIONS, describe, GITHUB, JIRA, MONDAY, parseHost, parseRepo, type SignIn, SLACK, SLACK_APPS, SLACK_BOT_TOKEN } from '../src/trackers/connect.ts';
import { TrackerError } from '../src/trackers/types.ts';

const tracker = (t: Partial<Tracker> & Pick<Tracker, 'kind'>): Tracker => ({ site: null, project: null, repo: null, organization: null, account: null, workspace: null, channel: null, team: null, board: null, statusColumn: null, prefix: null, skipLabels: [], epic: null, labels: [], areaPath: null, group: null, edits: false, statusFor: null, ...t });
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
    [MONDAY, tracker({ kind: 'monday', account: 'acme', board: 1234567890, group: 'topics', statusColumn: 'priority' }), { kind: 'monday', account: 'acme', board: 1234567890, group: 'topics', statusColumn: 'priority' }],
    [SLACK, tracker({ kind: 'slack', workspace: 'acme', channel: 'C0123ABCD' }), { kind: 'slack', workspace: 'acme', channel: 'C0123ABCD' }],
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
  for (const pasted of ['acme', 'Acme.monday.com', 'https://acme.monday.com/boards/1234567890/pulses/42', 'acme.monday.com?x=1']) assert.equal(MONDAY.host.parse(pasted), 'acme', pasted);
  for (const bad of ['acme.atlassian.net', 'https://monday.com', 'not an account!', '']) assert.equal(MONDAY.host.parse(bad), null, bad);
  const mondayToken = MONDAY.methods[0]!.fields[0]!;
  assert.deepEqual([mondayToken.type, mondayToken.help!.label, mondayToken.help!.url('acme'), mondayToken.help!.url('')], ['secret', 'Create a token', 'https://acme.monday.com/apps/manage/tokens', null], 'no account yet, no page to open');
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
  assert.deepEqual(DESCRIPTIONS.map((d) => d.kind), ['jira', 'github', 'azure', 'monday', 'slack']);
  assert.equal(describe('azure'), AZURE);
  assert.equal(describe('monday'), MONDAY);
  assert.equal(describe('slack'), SLACK);
  assert.equal(describe('linear'), undefined);
  const keys = declaredKeys();
  assert.deepEqual([...keys.fields].sort(), ['account', 'email', 'organization', 'repo', 'site', 'token', 'workspace']);
  assert.deepEqual([...keys.pickers].sort(), ['areaPath', 'board', 'channel', 'epic', 'group', 'labels', 'project', 'statusColumn', 'team']);
  assert.deepEqual([...keys.methods].sort(), ['gh', 'microsoft', 'pat', 'token']);
  // Each tracker's project names which tracker it is, so an existing one shows it fixed. monday.com's is its board, and Slack's its channel.
  assert.deepEqual(DESCRIPTIONS.map((d) => d.pickers.filter((p) => p.identifies).map((p) => p.key)), [['project'], [], ['project'], ['board'], ['channel']]);
});

test('every description says which of its lists stands in for an epic, in words the page shows (GH-81)', () => {
  let checked = 0;
  for (const d of DESCRIPTIONS) {
    const p = d.pickers.find((x) => x.key === d.place.key);
    assert.ok(p, `${d.name}'s place, ${d.place.key}, is one of its lists`);
    // Slack's channel is the whole tracker, as a project is: it has no whole to narrow, so it's the list that names the tracker.
    assert.ok(p.whole || p.identifies, `${d.name}'s place is the list that narrows the whole project, or the one that names it`);
    assert.match(d.place.words, /\bepic\b/, `${d.name}'s words say what stands in for an epic`);
    checked++;
  }
  assert.equal(checked, 5);
  assert.deepEqual(DESCRIPTIONS.map((d) => d.place.key), ['epic', 'labels', 'areaPath', 'group', 'channel']);
  assert.match(SLACK.place.words, /^In Slack, the channel stands in for an epic/);
  assert.match(AZURE.place.words, /^In Azure DevOps, an area path stands in for an epic/);
  assert.match(GITHUB.place.words, /^In GitHub, labels stand in for an epic/);
});

/** monday.com's GraphQL API, answering only this token, by what each query asks for. */
const MONDAY_TOKEN = 'monday-token-0123456789abcdef';
function mondayApi(o: { account?: string } = {}) {
  const asked: { query: string; variables: Record<string, unknown>; version: string | null }[] = [];
  const fetch = (async (url: string, init: { headers: Record<string, string>; body: string }) => {
    assert.equal(url, 'https://api.monday.com/v2');
    const { query, variables } = JSON.parse(init.body) as { query: string; variables: Record<string, unknown> };
    asked.push({ query, variables, version: init.headers['API-Version'] ?? null });
    if (init.headers.Authorization !== MONDAY_TOKEN) return Response.json({ errors: [{ message: 'Not Authenticated', extensions: { code: 'Unauthorized', status_code: 401 } }] }, { status: 401 });
    if (/\bme \{/.test(query)) return Response.json({ data: { me: { id: 7, name: 'Jordan Kim', account: { slug: o.account ?? 'acme' } } } });
    if (/boards\(limit/.test(query)) {
      return Response.json({ data: { boards: variables.page === 1 ? [
        { id: '555', name: 'Approvals', type: 'board', state: 'active', workspace: null },
        { id: '111', name: 'Client work', type: 'board', state: 'active', workspace: { name: 'Acme' } },
        { id: '222', name: 'Subitems of Client work', type: 'sub_items_board', state: 'active', workspace: { name: 'Acme' } },
        { id: '333', name: 'Kickoff notes', type: 'document', state: 'active', workspace: { name: 'Acme' } },
        { id: '444', name: 'Archive 2025', type: 'board', state: 'archived', workspace: { name: 'Acme' } },
      ] : [] } });
    }
    if (/groups \{ id title archived/.test(query)) return Response.json({ data: { boards: [{ groups: [{ id: 'topics', title: 'This sprint' }, { id: 'old', title: 'Done in 2025', archived: true }, { id: 'gone', title: 'Gone', deleted: true }] }] } });
    if (/columns\(types: \[status\]\)/.test(query)) {
      const label = (id: number, name: string, index: number, done = false) => ({ id, label: name, index, is_done: done, is_deactivated: false });
      return Response.json({ data: { boards: [{ name: 'Client work', columns: [
        { id: 'priority', title: 'Priority', type: 'status', settings: { labels: [label(0, 'High', 0), label(1, 'Low', 1)] } },
        { id: 'status', title: 'Status', type: 'status', settings: { labels: [label(5, '', 9), label(0, 'Working on it', 1), label(1, 'Done', 2, true), label(2, 'Stuck', 0)] } },
      ] }] } });
    }
    return Response.json({ errors: [{ message: `no answer for ${query}` }] });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, asked };
}

test('monday.com signs in with a personal API token for the account, then lists its boards, a board\'s groups and its status columns', async () => {
  const api = mondayApi();
  const signIn: SignIn = { method: 'token', fields: { token: MONDAY_TOKEN }, header: null, gh: null };
  const ctx = { host: 'acme', signIn, values: { board: '111' } as Record<string, string | null>, fetch: api.fetch, exec: async () => ({ code: 1, stdout: '', stderr: '' }) };
  assert.deepEqual(await MONDAY.verify(ctx), { id: '7', name: 'Jordan Kim' });
  assert.ok(api.asked.every((a) => a.version === '2026-10'), 'every call names its API version');
  await assert.rejects(MONDAY.verify({ ...ctx, signIn: { ...signIn, fields: { token: 'wrong-token-0123456789' } } }), (e: unknown) => e instanceof TrackerError && e.kind === 'auth' && /didn't accept/.test(e.message));
  const other = mondayApi({ account: 'globex' });
  await assert.rejects(MONDAY.verify({ ...ctx, fetch: other.fetch }), (e: unknown) => e instanceof TrackerError && e.kind === 'auth' && /account globex, not acme/.test(e.message), 'a token from another account is refused, naming it');

  assert.deepEqual(MONDAY.pickers.map((p) => [p.key, p.dependsOn, !!p.identifies, !!p.whole, !!p.hideSingle]), [['board', [], true, false, false], ['group', ['board'], false, true, false], ['statusColumn', ['board'], false, false, true]]);
  const [board, group, status] = MONDAY.pickers;
  assert.deepEqual(await board!.load(ctx), [{ value: '111', label: 'Client work', detail: 'Acme' }, { value: '555', label: 'Approvals', detail: 'Main workspace' }], 'by workspace, then name; no sub-item boards, documents or archived boards');
  assert.deepEqual(await group!.load(ctx), [{ value: 'topics', label: 'This sprint' }], 'no archived or deleted groups');
  assert.equal(group!.whole!({ host: 'acme', values: ctx.values, labels: { board: 'Client work' } }), 'Every group on Client work');
  assert.deepEqual((await status!.load(ctx)).map((o) => [o.value, o.detail, !!o.default]), [['priority', 'High, Low', false], ['status', 'Stuck, Working on it, Done', true]], 'the one called Status is the usual one; labels in monday\'s order, the blank left out');
  assert.equal(api.asked.find((a) => /groups/.test(a.query))!.variables.board?.toString(), '111', 'the board goes as a variable');

  // Save leaves out the whole board's group and the usual status column.
  assert.deepEqual(MONDAY.toConfig({ host: 'acme', values: { board: '111', group: null, statusColumn: 'status' }, defaults: ['statusColumn'], ownRepo: null }), { kind: 'monday', account: 'acme', board: 111, group: null, statusColumn: null });
  assert.deepEqual(withTracker([], MONDAY.toConfig({ host: 'acme', values: { board: '111', group: null, statusColumn: 'status' }, defaults: ['statusColumn'], ownRepo: null })), [{ kind: 'monday', account: 'acme', board: 111 }]);
});

/** Slack's Web API, answering only this bot token: the app, its workspace, and the channels it lists. */
const SLACK_TOKEN = 'xoxb-1234-5678-abcdefghijkl';
function slackApi(o: { workspace?: string } = {}) {
  const asked: string[] = [];
  const fetch = (async (url: string, init: { headers: Record<string, string> }) => {
    const u = new URL(url);
    asked.push(u.pathname);
    if (init.headers.Authorization !== `Bearer ${SLACK_TOKEN}`) return Response.json({ ok: false, error: 'invalid_auth' });
    if (u.pathname === '/api/auth.test') return Response.json({ ok: true, url: `https://${o.workspace ?? 'acme'}.slack.com/`, team: 'Acme', user: 'acc', user_id: 'U0BOT', bot_id: 'B0APP' });
    if (u.pathname === '/api/bots.info') return Response.json({ ok: true, bot: { id: 'B0APP', name: 'Acme Command Center' } });
    if (u.pathname === '/api/conversations.list') {
      return Response.json({ ok: true, channels: [
        { id: 'C0SUPPORT1', name: 'premium-support', is_member: true },
        { id: 'G0BILLING1', name: 'billing', is_private: true, is_member: true },
        { id: 'C0RANDOM01', name: 'random', is_member: false },
      ] });
    }
    return Response.json({ ok: false, error: 'unknown_method' });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, asked };
}

test('Slack: a workspace from any link, a bot token that starts xoxb-, and the channels the app is in', async () => {
  for (const pasted of ['acme', 'Acme.slack.com', 'https://acme.slack.com/archives/C0123ABCD/p1696512345123456', 'acme.slack.com?x=1']) assert.equal(SLACK.host.parse(pasted), 'acme', pasted);
  for (const bad of ['acme.monday.com', 'https://slack.com', 'not a workspace!', '']) assert.equal(SLACK.host.parse(bad), null, bad);
  assert.match(SLACK.host.invalid, /such as acme, or a link from acme\.slack\.com/, 'the refusal gives an example');

  const method = SLACK.methods[0]!;
  const token = method.fields[0]!;
  assert.deepEqual([SLACK.methods.length, method.via, token.key, token.type, token.help!.url(''), token.help!.url('acme')], [1, 'fields', 'token', 'secret', SLACK_APPS, SLACK_APPS], 'Slack\'s page for apps, with or without a workspace');
  assert.equal(token.check!(SLACK_TOKEN), null);
  assert.equal(SLACK_BOT_TOKEN, 'xoxb-');
  for (const bad of ['xoxp-1234-5678-abcdefghijkl', 'abcdefghijklmnopqrstuvwxyz', '']) assert.match(token.check!(bad) ?? '', /starts with xoxb-/, `a token that isn't a bot token: ${bad || 'the empty edge case'}`);
  assert.match(token.check!('xoxb-12') ?? '', /whole token/, 'a bot token cut short');
  assert.match(method.hint, /stays in VSCode on this machine, never in the repo/);
  assert.match(method.hint, /Invite the app to the channel/);

  const api = slackApi();
  const signIn: SignIn = { method: 'token', fields: { token: SLACK_TOKEN }, header: null, gh: null };
  const ctx = { host: 'acme', signIn, values: {}, fetch: api.fetch, exec: async () => ({ code: 1, stdout: '', stderr: '' }) };
  assert.deepEqual(await SLACK.verify(ctx), { id: 'U0BOT', name: 'Acme Command Center' }, 'who a reply posts as: the app');
  assert.deepEqual(api.asked, ['/api/auth.test', '/api/bots.info']);
  await assert.rejects(SLACK.verify({ ...ctx, fetch: slackApi({ workspace: 'globex' }).fetch }), (e: unknown) => e instanceof TrackerError && e.kind === 'auth' && /workspace globex, not acme/.test(e.message), 'a token for another workspace is refused, naming it');
  await assert.rejects(SLACK.verify({ ...ctx, signIn: { ...signIn, fields: { token: 'xoxb-wrong-0000000000' } } }), (e: unknown) => e instanceof TrackerError && e.kind === 'auth');

  assert.deepEqual(SLACK.pickers.map((p) => [p.key, p.dependsOn, !!p.identifies, !!p.idValues, !!p.whole]), [['channel', [], true, true, false]]);
  assert.deepEqual(await SLACK.pickers[0]!.load(ctx), [
    { value: 'G0BILLING1', label: '#billing', detail: 'private' },
    { value: 'C0SUPPORT1', label: '#premium-support', detail: 'public' },
  ], 'by name, and not a channel the app isn\'t in');
  assert.deepEqual(SLACK.toConfig({ host: 'acme', values: { channel: 'C0SUPPORT1' }, defaults: [], ownRepo: null }), { kind: 'slack', workspace: 'acme', channel: 'C0SUPPORT1' });
  assert.deepEqual(SLACK.fromConfig(tracker({ kind: 'slack', workspace: 'acme', channel: 'C0SUPPORT1' }), null), { host: 'acme', values: { channel: 'C0SUPPORT1' } });
});

test('Slack: a second channel is a second tracker with its own prefix, and the same channel again replaces the first, keeping its settings', () => {
  const support = SLACK.toConfig({ host: 'acme', values: { channel: 'C0SUPPORT1' }, defaults: [], ownRepo: null });
  const billing = SLACK.toConfig({ host: 'acme', values: { channel: 'G0BILLING1' }, defaults: [], ownRepo: null });
  const one = withTracker([], support);
  assert.deepEqual(one, [{ kind: 'slack', workspace: 'acme', channel: 'C0SUPPORT1' }]);
  const two = withTracker(one, billing);
  assert.deepEqual(two, [{ kind: 'slack', workspace: 'acme', channel: 'C0SUPPORT1' }, { kind: 'slack', workspace: 'acme', channel: 'G0BILLING1', prefix: 'SL2' }], 'its threads are SL2-, not the first channel\'s SL-');
  assert.deepEqual(withTracker(two, SLACK.toConfig({ host: 'acme', values: { channel: 'C0OPS00001' }, defaults: [], ownRepo: null }))[2], { kind: 'slack', workspace: 'acme', channel: 'C0OPS00001', prefix: 'SL3' });
  // The edge case of a channel id written in lower case by hand: it's still the same channel.
  assert.deepEqual(withTracker([{ kind: 'slack', workspace: 'acme', channel: 'c0support1', edits: true }], support), [{ kind: 'slack', workspace: 'acme', channel: 'C0SUPPORT1', edits: true }]);
  assert.equal(withTracker([{ kind: 'slack', workspace: 'globex', channel: 'C0SUPPORT1' }], support).length, 2, 'the same id in another workspace is another tracker');
  assert.deepEqual(withTracker(one, { ...billing, prefix: 'BILL' })[1], { kind: 'slack', workspace: 'acme', channel: 'G0BILLING1', prefix: 'BILL' }, 'one that names its prefix keeps it');
});
