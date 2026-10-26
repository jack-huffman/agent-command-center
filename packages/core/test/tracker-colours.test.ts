// T-95: a ticket takes its tracker's own label and type colours wherever the tracker gives them. Each client is
// read through a fake of its API: Azure DevOps' card rules and work item types, GitHub's named issue type colours,
// and Jira and monday.com, which give none. A call that fails leaves the colours null and says nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AzureClient, tagColours } from '../src/trackers/azure.ts';
import { GITHUB_TYPE_COLOUR, GithubClient, issueTypeColour } from '../src/trackers/github.ts';
import { JiraClient } from '../src/trackers/jira.ts';
import { MondayClient } from '../src/trackers/monday.ts';
import { hexOf } from '../src/trackers/normal.ts';
import type { Exec } from '../src/trackers/types.ts';
import { fakeGhBy } from './support.ts';

test('hexOf keeps six hex digits, with or without a #, and nothing else (edge cases)', () => {
  assert.deepEqual(['#CC293D', 'cc293d', ' #009CCC '].map(hexOf), ['CC293D', 'cc293d', '009CCC']);
  assert.deepEqual(['', 'RED', '#fff', 'FFCC293D', 'zzzzzz', null, undefined, 7].map(hexOf), [null, null, null, null, null, null, null, null]);
});

// ---------------------------------------------------------------- Azure DevOps

/**
 * A stand-in for Azure DevOps: answers by method and path prefix, a route of null as a failure, and records each
 * request. A near-copy of tracker-fields.test.ts's, which a test file can't import without running its tests.
 */
function fakeAzure(routes: [string, unknown][]) {
  const calls: string[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://dev.azure.com/acme', '');
    const at = `${init.method ?? 'GET'} ${path}`;
    calls.push(at);
    const hit = routes.find(([k]) => at.startsWith(k));
    if (!hit || hit[1] === null) return Response.json({ message: `no route ${at}` }, { status: hit ? 500 : 404 });
    return Response.json(hit[1]);
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}
const azure = (f: typeof fetch) => new AzureClient({ organization: 'acme', project: 'CRM', auth: async () => 'Basic x', fetch: f });

const CARD_RULES = { rules: { fill: [], tagStyle: [
  { name: 'Premium', isEnabled: true, settings: { 'background-color': '#fbd144', 'title-color': '#000000' } },
  { name: 'service', isEnabled: 'True', settings: { 'background-color': '#00a1f1' } },
  { name: 'old', isEnabled: 'False', settings: { 'background-color': '#ec001d' } },
  { name: 'blank', isEnabled: true, settings: {} },
] } };
const TYPES = { value: [{ name: 'Bug', color: 'CC293D' }, { name: 'Product Backlog Item', color: '009CCC' }, { name: 'Task', color: 'F2CB1D' }, { name: 'Odd', color: 'teal' }] };
const STATES = { value: [{ name: 'New', category: 'Proposed' }, { name: 'Done', category: 'Completed' }] };

/** A board of two cards, with card rules and type colours as given: null fails that call. */
const boardRoutes = (rules: unknown, types: unknown): [string, unknown][] => [
  ['GET /_apis/projects/CRM?', { defaultTeam: { name: 'T' } }],
  ['GET /CRM/T/_apis/work/boards?', { value: [{ id: 'b', name: 'Backlog items' }] }],
  ['GET /CRM/T/_apis/work/boards/b/cardrulesettings?', rules],
  ['GET /CRM/T/_apis/work/boards/b?', { columns: [{ id: 'c0', name: 'New', columnType: 'incoming', stateMappings: { Bug: 'New', 'Product Backlog Item': 'New', Spike: 'New' } }] }],
  ['GET /CRM/T/_apis/work/teamsettings/teamfieldvalues', { values: [] }],
  ['POST /CRM/T/_apis/wit/wiql', { workItems: [{ id: 1 }, { id: 2 }, { id: 3 }] }],
  ['POST /CRM/_apis/wit/workitemsbatch', { value: [
    { id: 1, fields: { 'System.Title': 'A', 'System.State': 'New', 'System.WorkItemType': 'Bug', 'System.Tags': 'premium; history' } },
    { id: 2, fields: { 'System.Title': 'B', 'System.State': 'New', 'System.WorkItemType': 'Product Backlog Item', 'System.Tags': 'Service; old; blank' } },
    { id: 3, fields: { 'System.Title': 'C', 'System.State': 'New', 'System.WorkItemType': 'Spike' } },
  ] }],
  ['GET /CRM/_apis/wit/workitemtypes?', types],
  ['GET /CRM/_apis/wit/workitemtypes/', STATES],
];

test('Azure\'s tag colours come from the board\'s card rules by name, whatever its case; a rule turned off or with no colour gives none (edge cases)', () => {
  assert.deepEqual([...tagColours(CARD_RULES)], [['premium', 'fbd144'], ['service', '00a1f1']]);
  assert.deepEqual([...tagColours(null)], [], 'no rules');
  assert.deepEqual([...tagColours({ rules: {} })], [], 'no tag rules');
});

test('an Azure board\'s cards take their tags\' colours from its card rules and their types\' from the work item types, read once per load', async () => {
  const { fetch: f, calls } = fakeAzure(boardRoutes(CARD_RULES, TYPES));
  const c = azure(f);
  const b = await c.board();
  assert.deepEqual(b.cards.map((x) => [x.key, x.labels, x.typeColor]), [
    ['AB-1', [{ name: 'premium', color: 'fbd144' }, { name: 'history', color: null }], 'CC293D'],
    ['AB-2', [{ name: 'Service', color: '00a1f1' }, { name: 'old', color: null }, { name: 'blank', color: null }], '009CCC'],
    ['AB-3', [], null],
  ], 'a tag with no rule, one turned off and a type Azure gives no colour have none');
  await c.board();
  assert.equal(calls.filter((x) => x.includes('/cardrulesettings')).length, 2, 'one read of the card rules per board load');
  assert.equal(calls.filter((x) => x.startsWith('GET /CRM/_apis/wit/workitemtypes?')).length, 2, 'one read of the types per board load');
});

test('edge case: an Azure board whose card rules and types calls fail keeps null colours, and draws its cards still', async () => {
  const b = await azure(fakeAzure(boardRoutes(null, null)).fetch).board();
  assert.deepEqual(b.cards.map((x) => [x.key, x.labels.map((l) => l.color), x.typeColor]), [['AB-1', [null, null], null], ['AB-2', [null, null, null], null], ['AB-3', [], null]]);
  assert.equal(b.notice, null, 'nothing is said');
});

const ticketRoutes = (rules: unknown, types: unknown): [string, unknown][] => [
  ...boardRoutes(rules, types),
  ['GET /CRM/_apis/wit/workitems/7?$expand', { id: 7, fields: { 'System.Title': 'T', 'System.State': 'New', 'System.WorkItemType': 'Bug', 'System.Tags': 'Premium; plain' },
    relations: [{ rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://dev.azure.com/acme/x/_apis/wit/workItems/8' }, { rel: 'System.LinkTypes.Related', url: 'https://dev.azure.com/acme/x/_apis/wit/workItems/9' }] }],
  ['GET /CRM/_apis/wit/workItems/7/comments', { comments: [] }],
];

test('an Azure ticket\'s page takes its tags\', its type\'s and its related items\' colours, and reuses the board\'s read', async () => {
  const routes = ticketRoutes(CARD_RULES, TYPES);
  // The related items come back from the batch call the board's route answers: give them their own.
  routes.unshift(['POST /CRM/_apis/wit/workitemsbatch', { value: [{ id: 8, fields: { 'System.Title': 'Child', 'System.State': 'New', 'System.WorkItemType': 'Task' } }] }]);
  const { fetch: f, calls } = fakeAzure(routes);
  const c = azure(f);
  await c.board();
  const t = await c.ticket('AB-7');
  assert.deepEqual(t.labels, [{ name: 'Premium', color: 'fbd144' }, { name: 'plain', color: null }]);
  assert.equal(t.typeColor, 'CC293D');
  assert.deepEqual(t.related.map((r) => [r.key, r.typeColor]), [['AB-8', 'F2CB1D'], ['AB-9', null]], 'one that didn\'t come back has no colour');
  assert.equal(calls.filter((x) => x.includes('/cardrulesettings')).length, 1, 'the ticket reuses the board\'s read');
  await c.ticket('AB-7');
  assert.deepEqual([calls.filter((x) => x.includes('/cardrulesettings')).length, calls.filter((x) => x.startsWith('GET /CRM/_apis/wit/workitemtypes?')).length], [1, 1], 'so does a second ticket');
  const alone = fakeAzure(ticketRoutes(CARD_RULES, TYPES));
  assert.equal((await azure(alone.fetch).ticket('AB-7')).labels[0]!.color, 'fbd144', 'a ticket opened before any board reads them itself');
  assert.equal(alone.calls.filter((x) => x.includes('/cardrulesettings')).length, 1);
});

test('edge case: an Azure ticket whose colour calls fail, or whose project has no team to read card rules from, keeps null colours', async () => {
  const failed = await azure(fakeAzure(ticketRoutes(null, null)).fetch).ticket('AB-7');
  assert.deepEqual([failed.labels.map((l) => l.color), failed.typeColor], [[null, null], null]);
  const noTeam = ticketRoutes(CARD_RULES, TYPES).filter(([k]) => !k.startsWith('GET /_apis/projects/'));
  const t = await azure(fakeAzure(noTeam).fetch).ticket('AB-7');
  assert.deepEqual([t.labels.map((l) => l.color), t.typeColor], [[null, null], 'CC293D'], 'no board, so no tag colours; the types still read');
});

// ---------------------------------------------------------------- GitHub

const fakeGh = (answer: (line: string) => string): Exec => fakeGhBy(answer).exec;
const gh = (exec: Exec) => new GithubClient({ repo: 'o/r', token: 't', account: 'me', exec });
const noProjects = JSON.stringify({ data: { repository: { projectsV2: { nodes: [] } } } });

test('GitHub\'s named issue type colours map to hex, a hex stays, and an unknown name or none has no colour (edge cases)', () => {
  assert.deepEqual(Object.keys(GITHUB_TYPE_COLOUR), ['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE']);
  for (const hex of Object.values(GITHUB_TYPE_COLOUR)) assert.equal(hexOf(hex), hex);
  assert.equal(issueTypeColour({ color: 'RED' }), 'd1242f');
  assert.equal(issueTypeColour({ color: 'purple' }), '8250df', 'whatever its case');
  assert.equal(issueTypeColour({ color: '#0e8a16' }), '0e8a16');
  assert.deepEqual([issueTypeColour({ color: 'TEAL' }), issueTypeColour({ color: null }), issueTypeColour({}), issueTypeColour(null)], [null, null, null, null]);
});

test('a GitHub issue, an issue list\'s card and a Project\'s card take their issue type\'s colour', async () => {
  const view = JSON.stringify({ number: 9, title: 'T', body: '', state: 'OPEN', url: 'https://github.com/o/r/issues/9', author: { login: 'p' }, assignees: [], labels: [], comments: [], issueType: { name: 'Bug', color: 'RED' } });
  const list = JSON.stringify([{ number: 3, title: 'A', url: 'u', state: 'OPEN', assignees: [], labels: [], issueType: { name: 'Feature', color: 'BLUE' } }, { number: 4, title: 'B', url: 'u', state: 'OPEN', assignees: [], labels: [] }]);
  const issues = gh(fakeGh((l) => (l.startsWith('api graphql') ? noProjects : l.startsWith('issue view') ? view : l.includes('--state open') ? list : '[]')));
  assert.equal((await issues.ticket('GH-9')).typeColor, GITHUB_TYPE_COLOUR.RED);
  assert.deepEqual((await issues.board()).cards.map((c) => [c.key, c.typeColor]), [['GH-3', GITHUB_TYPE_COLOUR.BLUE], ['GH-4', null]], 'an issue with no type has none');
  const project = { id: 'P1', number: 1, title: 'Board', url: 'u', closed: false, field: { id: 'F', options: [{ id: 'o1', name: 'Todo' }] } };
  const lines: string[] = [];
  const items = JSON.stringify({ data: { node: { items: { pageInfo: { hasNextPage: false, endCursor: '' }, nodes: [
    { id: 'I1', fieldValueByName: { optionId: 'o1', name: 'Todo' }, content: { __typename: 'Issue', number: 5, title: 'A', url: 'u', state: 'OPEN', issueType: { name: 'Task', color: 'YELLOW' }, repository: { nameWithOwner: 'o/r' }, assignees: { nodes: [] }, labels: { nodes: [] } } },
  ] } } } });
  const board = gh(fakeGh((l) => { lines.push(l); return l.includes('projectsV2') ? JSON.stringify({ data: { repository: { projectsV2: { nodes: [project] } } } }) : items; }));
  assert.deepEqual((await board.board()).cards.map((c) => c.typeColor), [GITHUB_TYPE_COLOUR.YELLOW]);
  assert.ok(lines.some((l) => l.includes('issueType { name color }')), 'the Project query asks for the colour');
});

// ---------------------------------------------------------------- Jira and monday.com

test('edge case: Jira and monday.com give no type colours, so their tickets\', cards\' and related items\' are null', async () => {
  const status = { id: '1', name: 'To Do', statusCategory: { key: 'new' } };
  const jiraRoutes: Record<string, unknown> = {
    'GET /rest/api/3/issue/MSP-1?fields': { key: 'MSP-1', fields: { summary: 'S', status, labels: [], created: 'c', updated: 'u', description: null, issuetype: { name: 'Bug', iconUrl: 'https://acme.atlassian.net/bug.svg' }, project: { key: 'MSP' },
      parent: { key: 'MSP-0', fields: { summary: 'E', status, issuetype: { name: 'Epic' } } } } },
    'GET /rest/agile/1.0/board?projectKeyOrId=MSP': { values: [{ id: 42 }] },
    'GET /rest/agile/1.0/board/42/configuration': { name: 'B', columnConfig: { columns: [{ name: 'To Do', statuses: [{ id: '1' }] }] } },
    'GET /rest/api/3/project/MSP/statuses': [{ statuses: [status] }],
    'GET /rest/agile/1.0/board/42/issue?jql=': { total: 1, issues: [{ key: 'MSP-1', fields: { summary: 's', status, assignee: null, issuetype: { name: 'Story' }, priority: null, project: { key: 'MSP' } } }] },
  };
  const jiraFetch = (async (url: string, init: RequestInit) => {
    const at = `${init.method ?? 'GET'} ${url.replace('https://acme.atlassian.net', '')}`;
    const key = Object.keys(jiraRoutes).find((k) => at.startsWith(k));
    return key ? Response.json(jiraRoutes[key]) : Response.json({ errorMessages: ['Not found'] }, { status: 404 });
  }) as unknown as typeof fetch;
  const jira = new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'e', token: 't', fetch: jiraFetch });
  const t = await jira.ticket('MSP-1');
  assert.deepEqual([t.typeKind, t.typeColor, t.related.map((r) => [r.typeKind, r.typeColor])], ['bug', null, [['epic', null]]]);
  assert.deepEqual((await jira.board()).cards.map((c) => [c.typeKind, c.typeColor]), [['story', null]]);
  const mondayFetch = (async (_url: string, init: RequestInit) => {
    const { query } = JSON.parse(String(init.body)) as { query: string };
    if (/subitems \{/.test(query)) {
      return Response.json({ data: { items: [{ id: '101', board: { id: '111', name: 'B' }, group: { id: 'g', title: 'G', color: '#037f4c' }, name: 'Item', created_at: 'c', updated_at: 'u', creator: null, column_values: [], updates: [], subitems: [{ id: '201', name: 'Sub', url: null }], parent_item: null }] } });
    }
    return Response.json({ data: { users: [] } });
  }) as unknown as typeof fetch;
  const m = await new MondayClient({ account: 'acme', board: 111, token: 't', fetch: mondayFetch }).ticket('MON-101');
  assert.deepEqual([m.typeColor, m.labels, m.related.map((r) => r.typeColor)], [null, [], [null]], 'a group\'s colour isn\'t a type\'s or a label\'s');
});
