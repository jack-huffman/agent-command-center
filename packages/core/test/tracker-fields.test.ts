// T-90: every tracker fills what it has, in one normal form. Each client is read through a fake of its API,
// fallbacks included: no display name, an email-shaped one, an unknown priority or type, and a states call that fails.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AZURE_PRIORITY, AzureClient, azureWhoAmI } from '../src/trackers/azure.ts';
import { GithubClient, issueState } from '../src/trackers/github.ts';
import { JIRA_PRIORITY, JiraClient } from '../src/trackers/jira.ts';
import { MondayClient } from '../src/trackers/monday.ts';
import { isEmail, personName, TYPE_KIND, typeKindOf } from '../src/trackers/normal.ts';
import { type Exec, TYPE_KINDS } from '../src/trackers/types.ts';

// ---------------------------------------------------------------- the normal form

test('a person\'s name reads as a name: an email-shaped display name, or one split by a space, gives way to the unique name\'s local part (edge cases)', () => {
  assert.equal(personName('Pat Lee', 'pat@acme.example'), 'Pat Lee', 'a real name stays');
  assert.equal(personName('jordan acme.example', 'jordan@acme.example'), 'jordan', 'an address split by a space');
  assert.equal(personName('Jordan ACME.example', 'jordan@acme.example'), 'jordan', 'whatever its case, the split matches the address');
  assert.equal(personName('jordan@acme.example', 'jordan@acme.example'), 'jordan', 'an address as the display name');
  assert.equal(personName('jordan@acme.example', 'ACME\\jordan'), 'jordan', 'an address with no address to fall back on: its own local part');
  assert.equal(personName('jordan acme.example', 'ACME\\jordan'), 'jordan', 'split by a space, with no address: the first part');
  assert.equal(personName('', 'jordan@acme.example'), 'jordan', 'no display name: the unique name\'s local part');
  assert.equal(personName(null, 'ACME\\jordan'), 'ACME\\jordan', 'no display name, and the unique name isn\'t an address');
  assert.equal(personName('  ', null), null, 'neither');
  assert.equal(personName('Mary Ann', 'mary@acme.example'), 'Mary Ann', 'two words that aren\'t an address');
  assert.equal(personName('pat acme.example', 'jordan@acme.example'), 'pat acme.example', 'split, but not this person\'s address: the words stay');
  assert.deepEqual([isEmail('a@b.co'), isEmail('a b.co'), isEmail(''), isEmail(undefined)], [true, false, false, false]);
});

test('a type\'s kind: every name in the table, a sub-task the tracker marks, and an unknown or missing type (edge cases)', () => {
  for (const [name, kind] of Object.entries(TYPE_KIND)) {
    assert.ok(TYPE_KINDS.includes(kind), name);
    assert.equal(typeKindOf(name.toUpperCase()), kind, `${name}, whatever its case`);
  }
  assert.equal(typeKindOf('Sub-Bug', true), 'subtask', 'a sub-task type Jira names itself');
  assert.equal(typeKindOf('Spike'), 'other');
  assert.equal(typeKindOf(''), null);
  assert.equal(typeKindOf(null), null);
});

// ---------------------------------------------------------------- Azure DevOps

/** A stand-in for Azure DevOps: answers by method and path prefix, a route of null as a failure, and records each request. */
function fakeAzure(routes: [string, unknown][]) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://dev.azure.com/acme', '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const hit = routes.find(([k]) => `${method} ${path}`.startsWith(k));
    if (!hit || hit[1] === null) return Response.json({ message: `no route ${method} ${path}` }, { status: hit ? 500 : 404 });
    return Response.json(typeof hit[1] === 'function' ? (hit[1] as (b: unknown) => unknown)(body) : hit[1] ?? {});
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const STORY_STATES = { value: [{ name: 'New', category: 'Proposed' }, { name: 'Active', category: 'InProgress' }, { name: 'Resolved', category: 'Resolved' }, { name: 'Closed', category: 'Completed' }, { name: 'Removed', category: 'Removed' }] };
const azure = (f: typeof fetch) => new AzureClient({ organization: 'acme', project: 'CRM', auth: async () => 'Basic x', fetch: f });
const workItem = (fields: Record<string, unknown>, relations: unknown[] = []) => ({ id: 101, fields: { 'System.Title': 'Escalate', 'System.State': 'Active', 'System.WorkItemType': 'User Story', ...fields }, relations });

test('an Azure work item: clean names with their address, a priority as a word and a level, and the type\'s kind', async () => {
  const { fetch: f } = fakeAzure([
    ['GET /CRM/_apis/wit/workitems/101?$expand', workItem({
      'Microsoft.VSTS.Common.Priority': 3,
      'System.AssignedTo': { displayName: 'jordan acme.example', uniqueName: 'jordan@acme.example' },
      'System.CreatedBy': { uniqueName: 'pat@acme.example' },
    })],
    ['GET /CRM/_apis/wit/workitemtypes/User%20Story/states', STORY_STATES],
    ['GET /CRM/_apis/wit/workItems/101/comments', { comments: [{ id: 7, text: 'Hi', createdBy: { displayName: 'sam@acme.example', uniqueName: 'sam@acme.example' }, createdDate: 'd' }] }],
  ]);
  const t = await azure(f).ticket('AB-101');
  assert.deepEqual(t.assignees, [{ id: 'jordan@acme.example', name: 'jordan', email: 'jordan@acme.example' }], 'not "jordan acme.example", which draws as JA');
  assert.deepEqual(t.reporter, { id: 'pat@acme.example', name: 'pat', email: 'pat@acme.example' }, 'no display name');
  assert.deepEqual(t.comments[0]!.author, { id: 'sam@acme.example', name: 'sam', email: 'sam@acme.example' }, 'an email as the display name');
  assert.deepEqual([t.priority, t.priorityLevel, t.type, t.typeKind], ['Medium', 3, 'User Story', 'story'], 'the plain word, with no "(3)"');
});

test('Azure\'s priorities 1 to 4 are Highest to Low, and any other number has no priority (edge case)', async () => {
  assert.deepEqual(Object.entries(AZURE_PRIORITY).map(([n, p]) => [Number(n), p.name, p.level]), [[1, 'Highest', 1], [2, 'High', 2], [3, 'Medium', 3], [4, 'Low', 4]]);
  for (const [value, want] of [[1, ['Highest', 1]], [2, ['High', 2]], [4, ['Low', 4]], [7, [null, null]], [undefined, [null, null]]] as const) {
    const { fetch: f } = fakeAzure([
      ['GET /CRM/_apis/wit/workitems/101?$expand', workItem({ 'Microsoft.VSTS.Common.Priority': value })],
      ['GET /CRM/_apis/wit/workitemtypes', STORY_STATES], ['GET /CRM/_apis/wit/workItems/101/comments', { comments: [] }],
    ]);
    const t = await azure(f).ticket('AB-101');
    assert.deepEqual([t.priority, t.priorityLevel], want, String(value));
  }
});

test('every Azure work item type has its kind, and one Azure doesn\'t ship is other (edge case)', async () => {
  const names: [string, string][] = [
    ['Bug', 'bug'], ['User Story', 'story'], ['Product Backlog Item', 'story'], ['Requirement', 'story'], ['Task', 'task'], ['Feature', 'feature'],
    ['Epic', 'epic'], ['Test Case', 'test'], ['Issue', 'issue'], ['Impediment', 'issue'], ['Change Request', 'other'],
  ];
  for (const [type, kind] of names) {
    const { fetch: f } = fakeAzure([
      ['GET /CRM/_apis/wit/workitems/101?$expand', workItem({ 'System.WorkItemType': type })],
      ['GET /CRM/_apis/wit/workitemtypes', { value: [] }], ['GET /CRM/_apis/wit/workItems/101/comments', { comments: [] }],
    ]);
    assert.equal((await azure(f).ticket('AB-101')).typeKind, kind, type);
  }
});

test('Azure\'s related items carry their state, its category from their type\'s states read once per type, and their kind; a states call that fails leaves the state under way (edge case)', async () => {
  const rel = (rel: string, id: number) => ({ rel, url: `https://dev.azure.com/acme/xyz/_apis/wit/workItems/${id}` });
  const { fetch: f, calls } = fakeAzure([
    ['GET /CRM/_apis/wit/workitems/101?$expand', workItem({}, [rel('System.LinkTypes.Hierarchy-Reverse', 90), rel('System.LinkTypes.Hierarchy-Forward', 91), rel('System.LinkTypes.Hierarchy-Forward', 92), rel('System.LinkTypes.Related', 93), rel('System.LinkTypes.Related', 94)])],
    ['GET /CRM/_apis/wit/workitemtypes/User%20Story/states', STORY_STATES],
    ['GET /CRM/_apis/wit/workitemtypes/Feature/states', { value: [{ name: 'New', category: 'Proposed' }, { name: 'Done', category: 'Completed' }] }],
    ['GET /CRM/_apis/wit/workitemtypes/Task/states', { value: [{ name: 'To Do', category: 'Proposed' }, { name: 'Done', category: 'Completed' }, { name: 'Removed', category: 'Removed' }] }],
    ['GET /CRM/_apis/wit/workitemtypes/Bug/states', null],
    ['GET /CRM/_apis/wit/workItems/101/comments', { comments: [] }],
    ['POST /CRM/_apis/wit/workitemsbatch', { value: [
      { id: 90, fields: { 'System.Title': 'Premium support', 'System.State': 'Done', 'System.WorkItemType': 'Feature' } },
      { id: 91, fields: { 'System.Title': 'Queue', 'System.State': 'To Do', 'System.WorkItemType': 'Task' } },
      { id: 92, fields: { 'System.Title': 'Old idea', 'System.State': 'Removed', 'System.WorkItemType': 'Task' } },
      { id: 93, fields: { 'System.Title': 'Broken', 'System.State': 'Active', 'System.WorkItemType': 'Bug' } },
    ] }],
  ]);
  const t = await azure(f).ticket('AB-101');
  const batch = calls.find((c) => c.path.includes('workitemsbatch'))!;
  assert.deepEqual((batch.body as { fields: string[] }).fields, ['System.Id', 'System.Title', 'System.State', 'System.WorkItemType']);
  assert.deepEqual(t.related.map((r) => [r.key, r.relation, r.title, r.status, r.typeKind]), [
    ['AB-90', 'parent', 'Premium support', { id: 'Done', name: 'Done', category: 'done', reason: 'completed' }, 'feature'],
    ['AB-91', 'child', 'Queue', { id: 'To Do', name: 'To Do', category: 'todo' }, 'task'],
    ['AB-92', 'child', 'Old idea', { id: 'Removed', name: 'Removed', category: 'done', reason: 'not-planned' }, 'task'],
    ['AB-93', 'related', 'Broken', { id: 'Active', name: 'Active', category: 'doing' }, 'bug'],
    ['AB-94', 'related', '', null, null],
  ], 'Bug\'s states failed: its state stays, under way; 94 didn\'t come back: nothing known');
  assert.equal(calls.filter((c) => c.path.includes('/workitemtypes/Task/states')).length, 1, 'two Tasks, one read of their states');
});

test('Azure\'s board takes each card\'s category from its state, not its column, and keeps the column for where it sits; with no states, the column\'s (edge case)', async () => {
  const columns = [
    { id: 'c0', name: 'New', columnType: 'incoming', stateMappings: { 'User Story': 'New', Bug: 'New' } },
    // A column of Resolved, which the board puts in progress, and Azure's states count as done for a bug.
    { id: 'c1', name: 'Test', columnType: 'inProgress', stateMappings: { 'User Story': 'Resolved', Bug: 'Resolved' } },
    { id: 'c2', name: 'Closed', columnType: 'outgoing', stateMappings: { 'User Story': 'Closed', Bug: 'Closed' } },
  ];
  const routes = (bugStates: unknown): [string, unknown][] => [
    ['GET /_apis/projects/CRM?', { defaultTeam: { name: 'T' } }],
    ['GET /CRM/T/_apis/work/boards?', { value: [{ id: 'b', name: 'Stories' }] }],
    ['GET /CRM/T/_apis/work/boards/b?', { columns }],
    ['GET /CRM/T/_apis/work/teamsettings/teamfieldvalues', { values: [] }],
    ['POST /CRM/T/_apis/wit/wiql', { workItems: [{ id: 1 }, { id: 2 }] }],
    ['POST /CRM/_apis/wit/workitemsbatch', { value: [
      { id: 1, fields: { 'System.Title': 'Story', 'System.State': 'Resolved', 'System.WorkItemType': 'User Story', 'Microsoft.VSTS.Common.Priority': 2, 'System.AssignedTo': { displayName: 'jordan acme.example', uniqueName: 'jordan@acme.example' } } },
      { id: 2, fields: { 'System.Title': 'Bug', 'System.State': 'Resolved', 'System.WorkItemType': 'Bug' } },
    ] }],
    ['GET /CRM/_apis/wit/workitemtypes/User%20Story/states', STORY_STATES],
    ['GET /CRM/_apis/wit/workitemtypes/Bug/states', bugStates],
  ];
  const b = await azure(fakeAzure(routes({ value: [{ name: 'New', category: 'Proposed' }, { name: 'Resolved', category: 'Completed' }, { name: 'Closed', category: 'Completed' }] })).fetch).board();
  assert.deepEqual(b.cards.map((c) => [c.key, c.status.id, c.status.name, c.status.category, c.typeKind, c.priority, c.priorityLevel]), [
    ['AB-1', 'Test', 'Resolved', 'doing', 'story', 'High', 2], ['AB-2', 'Test', 'Resolved', 'done', 'bug', null, null],
  ], 'the same column; the bug\'s Resolved is done by its own states');
  assert.deepEqual(b.cards[0]!.assignees.map((p) => p.name), ['jordan']);
  const failed = await azure(fakeAzure(routes(null)).fetch).board();
  assert.deepEqual(failed.cards.map((c) => c.status.category), ['doing', 'doing'], 'Bug\'s states failed: the column\'s category');
});

test('Azure\'s me names the person, with their address, and an email-shaped name gives way (edge case)', async () => {
  const me = (user: unknown) => azure(fakeAzure([['GET /_apis/connectionData', { authenticatedUser: user }]]).fetch).me();
  assert.deepEqual(await me({ id: 'g1', providerDisplayName: 'Jordan Kim', properties: { Account: { $value: 'jordan@acme.example' } } }), { id: 'jordan@acme.example', name: 'Jordan Kim', email: 'jordan@acme.example' });
  assert.deepEqual(await me({ id: 'g1', providerDisplayName: 'jordan acme.example', properties: { Account: { $value: 'jordan@acme.example' } } }), { id: 'jordan@acme.example', name: 'jordan', email: 'jordan@acme.example' });
  assert.deepEqual(await me({ id: 'g1' }), { id: 'g1', name: '' }, 'nothing to name them by: Commenting as keeps the sign-in\'s words');
  assert.deepEqual(await azureWhoAmI('acme', 'Basic x', fakeAzure([['GET /_apis/connectionData', { authenticatedUser: { id: 'g1' } }]]).fetch), { id: 'g1', name: 'You' }, 'the sign-in check still names them');
});

// ---------------------------------------------------------------- Jira

/** A stand-in for Jira Cloud: answers by method and path prefix. */
function fakeJira(routes: Record<string, unknown>) {
  return (async (url: string, init: RequestInit) => {
    const at = `${init.method ?? 'GET'} ${url.replace('https://acme.atlassian.net', '')}`;
    const key = Object.keys(routes).find((k) => at.startsWith(k));
    return key ? Response.json(routes[key]) : Response.json({ errorMessages: ['Not found'] }, { status: 404 });
  }) as unknown as typeof fetch;
}
const jiraStatus = (id: string, name: string, key: string) => ({ id, name, statusCategory: { key } });
const jira = (routes: Record<string, unknown>) => new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'me@acme.co', token: 't', fetch: fakeJira(routes) });

test('Jira\'s five priorities have their levels, and a priority a site named itself has none (edge case)', async () => {
  assert.deepEqual(JIRA_PRIORITY, { highest: 1, high: 2, medium: 3, low: 4, lowest: 5 });
  const names = ['Highest', 'High', 'Medium', 'Low', 'Lowest', 'P1 - Drop everything', null];
  const t = jira({
    'GET /rest/agile/1.0/board?projectKeyOrId=MSP': { values: [{ id: 42 }] },
    'GET /rest/agile/1.0/board/42/configuration': { name: 'B', columnConfig: { columns: [{ name: 'To Do', statuses: [{ id: '1' }] }] } },
    'GET /rest/api/3/project/MSP/statuses': [{ statuses: [jiraStatus('1', 'To Do', 'new')] }],
    'GET /rest/agile/1.0/board/42/issue?jql=': { total: names.length, issues: names.map((p, n) => ({ key: `MSP-${n}`, fields: { summary: 's', status: jiraStatus('1', 'To Do', 'new'), assignee: null, issuetype: { name: 'Story' }, priority: p ? { name: p } : null, project: { key: 'MSP' } } })) },
  });
  const b = await t.board();
  assert.deepEqual(b.cards.map((c) => [c.priority, c.priorityLevel]), [['Highest', 1], ['High', 2], ['Medium', 3], ['Low', 4], ['Lowest', 5], ['P1 - Drop everything', null], [null, null]]);
});

test('a Jira ticket: people with their address where Jira gives it, its type\'s kind, and related tickets with their status and kind (edge cases)', async () => {
  const t = await jira({
    'GET /rest/api/3/issue/MSP-1?fields': { key: 'MSP-1', fields: {
      summary: 'Login', status: jiraStatus('3', 'In Progress', 'indeterminate'), labels: [], created: 'c', updated: 'u', description: null,
      assignee: { accountId: 'a1', displayName: 'Pat Lee', emailAddress: 'pat@acme.example' }, reporter: { accountId: 'a2', displayName: 'Jo' },
      priority: { name: 'Blocker' }, issuetype: { name: 'Spike' }, project: { key: 'MSP' },
      parent: { key: 'MSP-0', fields: { summary: 'Epic', status: jiraStatus('3', 'In Progress', 'indeterminate'), issuetype: { name: 'Epic' } } },
      subtasks: [{ key: 'MSP-5', fields: { summary: 'Sub', status: jiraStatus('10', 'Done', 'done'), issuetype: { name: 'Sub-task', subtask: true } } }, { key: 'MSP-6', fields: { summary: 'Bare' } }],
      issuelinks: [{ type: { inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'MSP-9', fields: { summary: 'API', status: jiraStatus('1', 'To Do', 'new'), issuetype: { name: 'Bug' } } } }],
    } },
  }).ticket('MSP-1');
  assert.deepEqual(t.assignees, [{ id: 'a1', name: 'Pat Lee', email: 'pat@acme.example' }]);
  assert.deepEqual(t.reporter, { id: 'a2', name: 'Jo' }, 'Jira hides the address: none is made up');
  assert.deepEqual([t.priority, t.priorityLevel, t.type, t.typeKind], ['Blocker', null, 'Spike', 'other'], 'an unknown priority and an unknown type');
  assert.deepEqual(t.related.map((r) => [r.key, r.status?.name ?? null, r.status?.category ?? null, r.typeKind]), [
    ['MSP-0', 'In Progress', 'doing', 'epic'], ['MSP-5', 'Done', 'done', 'subtask'], ['MSP-6', null, null, null], ['MSP-9', 'To Do', 'todo', 'bug'],
  ], 'one with no status or type says nothing');
});

// ---------------------------------------------------------------- GitHub

/** A stand-in gh: answers by argument prefix, a function of the whole line, and records each line. */
function fakeGh(answer: (line: string) => string | { code: number; stderr: string }): { exec: Exec; lines: string[] } {
  const lines: string[] = [];
  const exec: Exec = async (_cmd, args) => {
    const line = args.join(' ');
    lines.push(line);
    const a = answer(line);
    return typeof a === 'string' ? { code: 0, stdout: a, stderr: '' } : { code: a.code, stdout: '', stderr: a.stderr };
  };
  return { exec, lines };
}
const noProjects = JSON.stringify({ data: { repository: { projectsV2: { nodes: [] } } } });
const view = (extra: object) => JSON.stringify({ number: 9, title: 'T', body: '', state: 'OPEN', url: 'https://github.com/o/r/issues/9', author: { login: 'pat' }, assignees: [], labels: [], comments: [], ...extra });
const gh = (exec: Exec) => new GithubClient({ repo: 'o/r', token: 't', account: 'me', exec });

test('a GitHub issue\'s state says what GitHub says: completed, not planned, or open', () => {
  assert.deepEqual(issueState('OPEN', null), { id: 'OPEN', name: 'Open', category: 'todo' });
  assert.deepEqual(issueState('CLOSED', 'COMPLETED'), { id: 'CLOSED', name: 'Closed', category: 'done', reason: 'completed' });
  assert.deepEqual(issueState('CLOSED', 'NOT_PLANNED'), { id: 'CLOSED', name: 'Closed as not planned', category: 'done', reason: 'not-planned' });
  assert.deepEqual(issueState('CLOSED', 'DUPLICATE'), { id: 'CLOSED', name: 'Closed', category: 'done' }, 'a reason acc doesn\'t know: none');
});

test('a GitHub issue has its issue type\'s kind, and no priority', async () => {
  const { exec, lines } = fakeGh((l) => (l.startsWith('api graphql') ? noProjects : view({ state: 'CLOSED', stateReason: 'NOT_PLANNED', issueType: { name: 'Bug' } })));
  const t = await gh(exec).ticket('GH-9');
  assert.ok(lines.some((l) => /^issue view 9 -R o\/r --json .*,issueType$/.test(l)), 'gh is asked for the type');
  assert.deepEqual([t.type, t.typeKind, t.priority, t.priorityLevel], ['Bug', 'bug', null, null]);
  assert.deepEqual([t.status.name, t.status.reason], ['Closed as not planned', 'not-planned']);
});

test('a gh that doesn\'t know issue types is asked again without, once, and its issues have no type (edge case)', async () => {
  const { exec, lines } = fakeGh((l) => {
    if (l.startsWith('api graphql')) return noProjects;
    if (l.includes('issueType')) return { code: 1, stderr: 'Unknown JSON field: "issueType"\nAvailable fields: ...' };
    if (l.startsWith('issue list -R o/r --state open')) return '[]';
    if (l.startsWith('issue list')) return JSON.stringify([{ number: 3, title: 'Old', url: 'u', state: 'CLOSED', stateReason: 'NOT_PLANNED', assignees: [], labels: [] }]);
    return view({});
  });
  const c = gh(exec);
  const t = await c.ticket('GH-9');
  assert.deepEqual([t.type, t.typeKind], [null, null]);
  await c.ticket('GH-9');
  assert.equal(lines.filter((l) => l.includes('issueType')).length, 1, 'refused once, never asked again');
  const b = await c.board();
  assert.deepEqual(b.cards.map((x) => [x.key, x.status.id, x.status.name, x.status.reason, x.typeKind, x.priorityLevel]), [['GH-3', 'CLOSED', 'Closed as not planned', 'not-planned', null, null]], 'still in the Closed column');
});

test('a GitHub Project board\'s cards have their issue type\'s kind, and a GitHub without issue types is asked again without (edge case)', async () => {
  const project = { id: 'P1', number: 1, title: 'Board', url: 'https://github.com/orgs/o/projects/1', closed: false, field: { id: 'F', options: [{ id: 'o1', name: 'Todo' }] } };
  const items = (typed: boolean) => JSON.stringify({ data: { node: { items: { pageInfo: { hasNextPage: false, endCursor: '' }, nodes: [
    { id: 'I1', fieldValueByName: { optionId: 'o1', name: 'Todo' }, content: { __typename: 'Issue', number: 5, title: 'A', url: 'u', state: 'OPEN', ...(typed ? { issueType: { name: 'Feature' } } : {}), repository: { nameWithOwner: 'o/r' }, assignees: { nodes: [] }, labels: { nodes: [] } } },
  ] } } } });
  const projects = JSON.stringify({ data: { repository: { projectsV2: { nodes: [project] } } } });
  const typed = fakeGh((l) => (l.includes('projectsV2') ? projects : items(true)));
  assert.deepEqual((await gh(typed.exec).board()).cards.map((c) => [c.type, c.typeKind]), [['Feature', 'feature']]);
  assert.ok(typed.lines.some((l) => l.includes('issueType { name color }')));
  const old = fakeGh((l) => (l.includes('projectsV2') ? projects : l.includes('issueType') ? JSON.stringify({ errors: [{ message: 'Field \'issueType\' doesn\'t exist on type \'Issue\'' }] }) : items(false)));
  assert.deepEqual((await gh(old.exec).board()).cards.map((c) => [c.type, c.typeKind]), [[null, null]]);
});

// ---------------------------------------------------------------- monday.com

test('monday.com\'s sub-items carry their status from their status column, done where monday marks it, and none with no label (edge case)', async () => {
  const subitems = [
    { id: '201', name: 'Done one', url: null, column_values: [{ id: 'person', type: 'people' }, { id: 'status', type: 'status', column: { title: 'Status' }, index: 1, label: 'Done', is_done: true }] },
    { id: '202', name: 'Working', url: null, column_values: [{ id: 'status', type: 'status', column: { title: 'Status' }, index: 0, label: 'Working on it', is_done: false }] },
    { id: '203', name: 'Blank', url: null, column_values: [{ id: 'status', type: 'status', column: { title: 'Status' }, index: 5, label: null }] },
    { id: '204', name: 'Bare', url: null },
  ];
  const f = (async (_url: string, init: RequestInit) => {
    const { query } = JSON.parse(String(init.body)) as { query: string };
    if (/subitems \{/.test(query)) {
      return Response.json({ data: { items: [{ id: '101', board: { id: '111', name: 'B' }, group: { id: 'g', title: 'G' }, name: 'Item', created_at: 'c', updated_at: 'u', creator: null, column_values: [], updates: [], subitems, parent_item: { id: '100', name: 'Parent' } }] } });
    }
    return Response.json({ data: { users: [] } });
  }) as unknown as typeof fetch;
  const t = await new MondayClient({ account: 'acme', board: 111, token: 't', fetch: f }).ticket('MON-101');
  assert.deepEqual([t.typeKind, t.priorityLevel], [null, null], 'monday.com has no types or priorities of its own');
  assert.deepEqual(t.related.map((r) => [r.key, r.relation, r.status, r.typeKind]), [
    ['MON-100', 'parent', null, null],
    ['MON-201', 'sub-item', { id: '1', name: 'Done', category: 'done' }, null],
    ['MON-202', 'sub-item', { id: '0', name: 'Working on it', category: 'doing' }, null],
    ['MON-203', 'sub-item', null, null], ['MON-204', 'sub-item', null, null],
  ]);
});
