import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type AdfNode, fromAdf, fromMarkdown, plainText, safeHref, toAdf } from '../src/trackers/doc.ts';
import { categoryOf, GithubClient } from '../src/trackers/github.ts';
import { jiraSprintOptions } from '../src/trackers/connect.ts';
import { JiraClient, jiraSprints, NO_ACTIVE_SPRINT } from '../src/trackers/jira.ts';
import { type Exec, FIELD_LACKS, movesInto, TRACKER_FIELDS, TrackerError, trackerHasField } from '../src/trackers/types.ts';

test('trackerHasField: a tracker without fields has all three; one with a list has only those (T-28)', () => {
  for (const f of TRACKER_FIELDS) {
    assert.equal(trackerHasField({}, f), true);
    assert.equal(trackerHasField({ fields: [] }, f), false, 'an empty list is a tracker with none');
    assert.ok(FIELD_LACKS[f]);
  }
  assert.equal(trackerHasField({ fields: ['labels'] }, 'labels'), true);
  assert.equal(trackerHasField({ fields: ['labels'] }, 'status'), false);
});

// ---------------------------------------------------------------- the document model

test('markdown becomes blocks and marks, with GitHub references linked and raw HTML kept as words', () => {
  const doc = fromMarkdown([
    '# Title', '', 'Some **bold**, _em_, `code`, ~~gone~~ and [a link](https://x.y). <b>Tagged</b> <script>alert(1)</script> &amp; Depends on #12, thanks @jane.', '',
    '- [ ] todo', '- [x] done', '  - nested', '', '3. three', '4. four', '', '```js', 'const a = 1;', '```', '', '> quoted', '', '| a | b |', '|---|---|', '| 1 | 2 |', '', '---', '',
    '![diagram](https://img.example/d.png)', '', '<details><summary>More</summary>Hidden words<!-- secret --></details>', '', '[bad](javascript:alert(1))',
  ].join('\n'), { issueUrl: (n) => `https://github.com/o/r/issues/${n}`, userUrl: (u) => `https://github.com/${u}` });
  const [h, p, tasks, ordered, code, quote, table, hr, media, details, bad] = doc.blocks;
  assert.deepEqual(h, { t: 'h', level: 1, c: [{ t: 'text', text: 'Title' }] });
  assert.equal(p!.t, 'p');
  const inl = (p as { c: { t: string; text?: string; marks?: string[]; href?: string }[] }).c;
  assert.deepEqual(inl.find((i) => i.text === 'bold')!.marks, ['strong']);
  assert.deepEqual(inl.find((i) => i.text === 'em')!.marks, ['em']);
  assert.deepEqual(inl.find((i) => i.text === 'code')!.marks, ['code']);
  assert.deepEqual(inl.find((i) => i.text === 'gone')!.marks, ['strike']);
  assert.equal(inl.find((i) => i.text === 'a link')!.href, 'https://x.y');
  assert.deepEqual(inl.find((i) => i.text === 'Tagged')!.marks, ['strong'], '<b> means bold');
  assert.ok(!inl.some((i) => i.text?.includes('<script')), 'unknown tags are dropped');
  assert.ok(inl.some((i) => i.text?.includes('&')), 'entities decoded');
  assert.equal(inl.find((i) => i.text === '#12')!.href, 'https://github.com/o/r/issues/12');
  assert.equal(inl.find((i) => i.text === '@jane')!.href, 'https://github.com/jane');
  assert.deepEqual((tasks as { items: { checked?: boolean; c: { t: string }[] }[] }).items.map((i) => i.checked), [false, true]);
  assert.equal((tasks as { items: { c: { t: string }[] }[] }).items[1]!.c[1]!.t, 'list', 'nested list kept');
  assert.deepEqual([ordered!.t, (ordered as { start?: number }).start], ['list', 3]);
  assert.deepEqual(code, { t: 'code', lang: 'js', text: 'const a = 1;' });
  assert.equal(quote!.t, 'quote');
  assert.deepEqual((table as { head: unknown[][]; rows: unknown[][][] }).head.length, 2);
  assert.equal(hr!.t, 'hr');
  assert.deepEqual(media, { t: 'media', label: 'diagram', href: 'https://img.example/d.png' });
  assert.deepEqual(details, { t: 'p', c: [{ t: 'text', text: 'MoreHidden words' }] }, 'block HTML keeps its words, drops comments');
  assert.ok(!JSON.stringify(bad).includes('javascript:'), 'only web links survive');
  assert.equal(safeHref('file:///etc/passwd'), null);
  assert.deepEqual(fromMarkdown('  '), { blocks: [] });
});

test('Jira\'s rich text becomes the same blocks: marks, links, mentions, panels, tables, attachments', () => {
  const adf: AdfNode = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Steps' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'Ask ' }, { type: 'mention', attrs: { text: '@Pat Lee' } }, { type: 'text', text: ' about ' },
      { type: 'text', text: 'this', marks: [{ type: 'strong' }, { type: 'link', attrs: { href: 'https://acme.atlassian.net/wiki' } }] }, { type: 'hardBreak' },
      { type: 'status', attrs: { text: 'blocked' } }, { type: 'inlineCard', attrs: { url: 'https://x.y/z' } },
    ] },
    { type: 'orderedList', attrs: { order: 2 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }] }] },
    { type: 'panel', attrs: { panelType: 'warning' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Careful' }] }] },
    { type: 'codeBlock', attrs: { language: 'apex' }, content: [{ type: 'text', text: 'System.debug(1);' }] },
    { type: 'table', content: [
      { type: 'tableRow', content: [{ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Field' }] }] }] },
      { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Region__c' }] }] }] },
    ] },
    { type: 'mediaSingle', content: [{ type: 'media', attrs: { alt: 'screenshot.png' } }] },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { state: 'DONE' }, content: [{ type: 'text', text: 'checked' }] }] },
    { type: 'rule' },
  ] };
  const [h, p, ol, panel, code, table, media, tasks, hr] = fromAdf(adf).blocks;
  assert.deepEqual(h, { t: 'h', level: 2, c: [{ t: 'text', text: 'Steps' }] });
  assert.deepEqual((p as { c: unknown[] }).c, [
    { t: 'text', text: 'Ask ' }, { t: 'mention', text: '@Pat Lee' }, { t: 'text', text: ' about ' },
    { t: 'text', text: 'this', marks: ['strong'], href: 'https://acme.atlassian.net/wiki' }, { t: 'br' },
    { t: 'text', text: 'BLOCKED', marks: ['code'] }, { t: 'text', text: 'https://x.y/z', href: 'https://x.y/z' },
  ]);
  assert.deepEqual([ol!.t, (ol as { start?: number }).start], ['list', 2]);
  assert.deepEqual([panel!.t, (panel as { label?: string }).label], ['quote', 'Warning']);
  assert.deepEqual(code, { t: 'code', lang: 'apex', text: 'System.debug(1);' });
  assert.deepEqual(table, { t: 'table', head: [[{ t: 'text', text: 'Field' }]], rows: [[[{ t: 'text', text: 'Region__c' }]]] });
  assert.deepEqual(media, { t: 'media', label: 'screenshot.png', href: null }, 'attachments aren\'t loaded');
  assert.equal((tasks as { items: { checked?: boolean }[] }).items[0]!.checked, true);
  assert.equal(hr!.t, 'hr');
  assert.deepEqual(fromAdf(null), { blocks: [] });
});

test('a comment typed as markdown goes to Jira as ADF, and plain text reads naturally', () => {
  const adf = toAdf(fromMarkdown('Looks **good**. See [the doc](https://x.y) and `Foo.cls`.\n\n- one\n- two\n\n```\ncode\n```'));
  assert.equal(adf.type, 'doc');
  const [p, list, code] = adf.content!;
  assert.deepEqual(p!.content!.map((n) => [n.text, (n.marks ?? []).map((m) => m.type).join('+')]), [['Looks ', ''], ['good', 'strong'], ['. See ', ''], ['the doc', 'link'], [' and ', ''], ['Foo.cls', 'code'], ['.', '']]);
  assert.equal(list!.type, 'bulletList');
  assert.equal(list!.content![0]!.type, 'listItem');
  assert.deepEqual(code, { type: 'codeBlock', content: [{ type: 'text', text: 'code' }] });
  assert.equal(plainText(fromMarkdown('# Hi\n\nThere **you**\n\n- a\n- b')), 'Hi\nThere you\na\nb');
});

// ---------------------------------------------------------------- GitHub

/** A stand-in gh: answers by argument prefix and records what it was asked, with the env it got. */
function fakeGh(answers: [string, string | ((input?: string) => string) | { code: number; stderr: string }][]): { exec: Exec; calls: { args: string; input?: string; token?: string; quiet: boolean }[] } {
  const calls: { args: string; input?: string; token?: string; quiet: boolean }[] = [];
  const exec: Exec = async (cmd, args, opts) => {
    const line = args.join(' ');
    calls.push({ args: line, input: opts?.input, token: opts?.env?.GH_TOKEN, quiet: opts?.env?.GH_NO_UPDATE_NOTIFIER === '1' && opts?.env?.GH_PROMPT_DISABLED === '1' });
    const hit = answers.find(([prefix]) => line.startsWith(prefix));
    if (!hit) return { code: 1, stdout: '', stderr: `no fixture for: gh ${line}` };
    const a = hit[1];
    if (typeof a === 'object') return { code: a.code, stdout: '', stderr: a.stderr };
    return { code: 0, stdout: typeof a === 'function' ? a(opts?.input) : a, stderr: '' };
  };
  return { exec, calls };
}

const projectsAnswer = (nodes: unknown[]) => JSON.stringify({ data: { repository: { projectsV2: { nodes } } } });
const issue = (n: number, state: string, extra: object = {}) => ({ number: n, title: `Issue ${n}`, url: `https://github.com/o/r/issues/${n}`, state, assignees: [{ login: 'jane', name: 'Jane Doe' }], labels: [{ name: 'bug', color: 'd73a4a' }], ...extra });

test('GitHub without a Project: Open and Closed columns, and the notice says why', async () => {
  const { exec, calls } = fakeGh([
    ['api graphql -f query=query($owner', projectsAnswer([])],
    ['issue list -R o/r --state open', JSON.stringify([issue(1, 'OPEN'), issue(2, 'OPEN')])],
    ['issue list -R o/r --state closed', JSON.stringify([issue(3, 'CLOSED')])],
  ]);
  const b = await new GithubClient({ repo: 'o/r', token: 'tok', account: 'me', exec }).board();
  assert.equal(b.source, 'github-state');
  assert.deepEqual(b.columns.map((c) => [c.name, c.statusIds]), [['Open', ['OPEN']], ['Closed', ['CLOSED']]]);
  assert.deepEqual(b.cards.map((c) => [c.key, c.status.id]), [['GH-1', 'OPEN'], ['GH-2', 'OPEN'], ['GH-3', 'CLOSED']]);
  assert.deepEqual(b.cards[0]!.labels, [{ name: 'bug', color: 'd73a4a' }]);
  assert.match(b.notice!, /aren't on a GitHub Project/);
  assert.ok(calls.every((c) => c.token === 'tok'), 'every call runs as the repo\'s account (D-007)');
  assert.ok(calls.every((c) => c.quiet), 'with no update check and no prompt (D-051)');
});

test('GitHub without Projects access says how to grant it, instead of failing', async () => {
  const { exec } = fakeGh([
    ['api graphql', { code: 1, stderr: "error: your authentication token is missing required scopes [read:project]\nTo request it, run:  gh auth refresh -s read:project" }],
    ['issue list', '[]'],
  ]);
  const b = await new GithubClient({ repo: 'o/r', token: 't', account: 'me', exec }).board();
  assert.equal(b.source, 'github-state');
  assert.match(b.notice!, /give me access to Projects\. gh refreshes only its active account, so run gh auth switch -u me, then gh auth refresh -h github\.com -s project and sign in as me, then switch back/);
});

test('GitHub with a Project: its Status options are the columns, in order, and a move edits the card there', async () => {
  const project = { id: 'PVT_1', number: 3, title: 'Roadmap', url: 'https://github.com/users/o/projects/3', closed: false, field: { id: 'F_1', options: [{ id: 'o1', name: 'Todo' }, { id: 'o2', name: 'In Progress' }, { id: 'o3', name: 'Done' }] } };
  const items = { data: { node: { items: { pageInfo: { hasNextPage: false, endCursor: 'x' }, nodes: [
    { id: 'I_1', fieldValueByName: { optionId: 'o2', name: 'In Progress' }, content: { __typename: 'Issue', repository: { nameWithOwner: 'o/r' }, ...issue(5, 'OPEN'), assignees: { nodes: [] }, labels: { nodes: [] } } },
    { id: 'I_2', fieldValueByName: null, content: { __typename: 'Issue', repository: { nameWithOwner: 'o/r' }, ...issue(6, 'OPEN'), assignees: { nodes: [] }, labels: { nodes: [] } } },
    { id: 'I_3', fieldValueByName: { optionId: 'o1', name: 'Todo' }, content: { __typename: 'Issue', repository: { nameWithOwner: 'other/repo' }, ...issue(7, 'OPEN'), assignees: { nodes: [] }, labels: { nodes: [] } } },
    { id: 'I_4', fieldValueByName: null, content: { __typename: 'DraftIssue' } },
  ] } } } };
  const { exec, calls } = fakeGh([
    ['api graphql -f query=query($owner: String!, $name: String!) {\n  repository(owner: $owner, name: $name) {\n    projectsV2', projectsAnswer([project])],
    ['api graphql -f query=query($id', JSON.stringify(items)],
    ['project item-edit', ''],
  ]);
  const gh = new GithubClient({ repo: 'o/r', token: 't', account: 'me', exec });
  const b = await gh.board();
  assert.equal(b.source, 'github-project');
  assert.deepEqual(b.columns.map((c) => [c.name, c.category]), [['No status', 'todo'], ['Todo', 'todo'], ['In Progress', 'doing'], ['Done', 'done']]);
  assert.deepEqual(b.cards.map((c) => [c.key, c.status.name, c.itemId]), [['GH-5', 'In Progress', 'I_1'], ['GH-6', 'No status', 'I_2']], 'only this repo\'s issues');
  const done = b.columns.find((c) => c.name === 'Done')!;
  await gh.transition('GH-5', { id: 'status:o3', name: 'Done', to: { id: 'o3', name: 'Done', category: 'done' } }, b.cards[0]);
  assert.equal(calls.at(-1)!.args, 'project item-edit --id I_1 --project-id PVT_1 --field-id F_1 --single-select-option-id o3');
  assert.deepEqual(done.statusIds, ['o3']);
  assert.equal(categoryOf('Shipped'), 'done');
  assert.equal(categoryOf('Backlog'), 'todo');
  assert.equal(categoryOf('In review'), 'doing');
});

test('a GitHub issue: body and comments rendered from markdown, status from its state, and every action as gh would run it', async () => {
  const view = { number: 9, title: 'Fix it', body: 'See #3', state: 'CLOSED', stateReason: 'NOT_PLANNED', author: { login: 'pat', name: 'Pat' }, assignees: [], labels: [], createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z', url: 'https://github.com/o/r/issues/9', milestone: null,
    comments: [{ id: 'C1', author: { login: 'jane' }, body: '**Agreed**', createdAt: '2026-09-01T01:00:00Z', url: 'https://github.com/o/r/issues/9#c1' }] };
  const { exec, calls } = fakeGh([
    ['api graphql -f query=query($owner: String!, $name: String!) {\n  repository(owner: $owner, name: $name) {\n    projectsV2', projectsAnswer([])],
    ['issue view 9 -R o/r --json number', JSON.stringify(view)],
    ['issue view 9 -R o/r --json state', JSON.stringify({ state: 'CLOSED' })],
    ['issue view 9 -R o/r --json assignees', JSON.stringify({ assignees: [{ login: 'pat' }] })],
    ['issue comment', ''], ['issue reopen', ''], ['issue close', ''], ['issue edit', ''],
    ['api repos/o/r/assignees', 'jane\npat\njo'],
  ]);
  const gh = new GithubClient({ repo: 'o/r', token: 't', account: 'me', exec });
  const t = await gh.ticket('GH-9');
  assert.deepEqual([t.key, t.status.name, t.status.category, t.reporter!.name], ['GH-9', 'Closed as not planned', 'done', 'Pat']);
  assert.equal((t.body.blocks[0] as { c: { href?: string }[] }).c[1]!.href, 'https://github.com/o/r/issues/3');
  assert.deepEqual(t.comments[0]!.body, { blocks: [{ t: 'p', c: [{ t: 'text', text: 'Agreed', marks: ['strong'] }] }] });
  assert.deepEqual((await gh.transitions('GH-9')).map((x) => x.name), ['Reopen']);
  await gh.comment('GH-9', 'Thanks!');
  assert.deepEqual([calls.at(-1)!.args, calls.at(-1)!.input], ['issue comment 9 -R o/r --body-file -', 'Thanks!'], 'the comment goes on stdin, never as an argument');
  await gh.transition('GH-9', { id: 'close-not-planned', name: 'Close as not planned', to: { id: 'CLOSED', name: 'Closed', category: 'done' } });
  assert.equal(calls.at(-1)!.args, 'issue close 9 -R o/r --reason not planned');
  await gh.assign('GH-9', [{ id: 'jane', name: 'jane' }]);
  assert.equal(calls.at(-1)!.args, 'issue edit 9 -R o/r --add-assignee jane --remove-assignee pat');
  await gh.setLabels('GH-9', ['bug', 'ui'], ['wontfix']);
  assert.equal(calls.at(-1)!.args, 'issue edit 9 -R o/r --add-label bug,ui --remove-label wontfix');
  assert.deepEqual((await gh.assignable('GH-9', 'J')).map((p) => p.id), ['jane', 'jo']);
  await assert.rejects(gh.ticket('MSP-1'), /isn't a GitHub issue key/);
  await assert.rejects(gh.comment('GH-9', '  '), /empty/);
});

// ---------------------------------------------------------------- Jira

/** A stand-in for Jira Cloud: answers by method and path, and records each request. */
function fakeJira(routes: Record<string, unknown | ((body: unknown) => unknown)>, status: Record<string, number> = {}) {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const path = url.replace('https://acme.atlassian.net', '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, auth: (init.headers as Record<string, string>).Authorization ?? null });
    const key = Object.keys(routes).find((k) => `${method} ${path}`.startsWith(k));
    const code = Object.entries(status).find(([k]) => `${method} ${path}`.startsWith(k))?.[1] ?? (key ? 200 : 404);
    const r = key ? routes[key] : { errorMessages: ['Not found'] };
    const payload = typeof r === 'function' ? (r as (b: unknown) => unknown)(body) : r;
    return new Response(payload === undefined ? null : JSON.stringify(payload), { status: payload === undefined && code === 200 ? 204 : code });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const jiraStatus = (id: string, name: string, key: string) => ({ id, name, statusCategory: { key } });

test('a Jira board: the board\'s own columns, each holding its statuses, with every card placed', async () => {
  const { fetch: f, calls } = fakeJira({
    'GET /rest/agile/1.0/board?projectKeyOrId=MSP': { values: [{ id: 42, name: 'MSP board', type: 'kanban' }] },
    'GET /rest/agile/1.0/board/42/configuration': { name: 'MSP board', columnConfig: { columns: [
      { name: 'To Do', statuses: [{ id: '1' }] }, { name: 'In Progress', statuses: [{ id: '3' }, { id: '4' }] }, { name: 'Done', statuses: [{ id: '10' }] },
    ] } },
    'GET /rest/api/3/project/MSP/statuses': [{ statuses: [jiraStatus('1', 'To Do', 'new'), jiraStatus('3', 'In Progress', 'indeterminate'), jiraStatus('4', 'In Review', 'indeterminate'), jiraStatus('10', 'Done', 'done')] }],
    'GET /rest/agile/1.0/board/42/issue?jql=': { total: 3, issues: [
      { key: 'MSP-1', fields: { summary: 'Login page', status: jiraStatus('4', 'In Review', 'indeterminate'), assignee: { accountId: 'a1', displayName: 'Pat Lee' }, issuetype: { name: 'Story' }, priority: { name: 'High' }, labels: ['ui'], project: { key: 'MSP' } } },
      { key: 'MSP-2', fields: { summary: 'Fix flow', status: jiraStatus('1', 'To Do', 'new'), assignee: null, issuetype: { name: 'Bug' }, priority: null, labels: [], project: { key: 'MSP' } } },
      // The board's own filter spans another project, and Jira still sent one of its cards.
      { key: 'OPS-1', fields: { summary: 'Another client\'s ticket', status: jiraStatus('1', 'To Do', 'new'), assignee: null, issuetype: { name: 'Task' }, priority: null, labels: [], project: { key: 'OPS' } } },
    ] },
  });
  const jira = new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'me@acme.co', token: 'tok', fetch: f });
  const b = await jira.board();
  assert.deepEqual(b.columns.map((c) => [c.name, c.category, c.statusIds]), [['To Do', 'todo', ['1']], ['In Progress', 'doing', ['3', '4']], ['Done', 'done', ['10']]]);
  assert.deepEqual(b.cards.map((c) => [c.key, c.status.name, c.type, c.priority, c.assignees[0]?.name ?? null]), [['MSP-1', 'In Review', 'Story', 'High', 'Pat Lee'], ['MSP-2', 'To Do', 'Bug', null, null]], 'only this project\'s cards (D-072)');
  assert.equal(b.url, 'https://acme.atlassian.net/jira/software/projects/MSP/boards/42');
  assert.equal(b.place, 'Jira · MSP');
  const cardsCall = new URL(`https://x${calls.find((c) => c.path.includes('/issue?'))!.path}`);
  assert.equal(cardsCall.searchParams.get('jql'), 'project = "MSP"', 'the board\'s cards are held to the project');
  assert.equal(calls[0]!.auth, `Basic ${Buffer.from('me@acme.co:tok').toString('base64')}`);
});

test('a Jira ticket: ADF description and comments, related tickets, transitions that land in a column, and every write', async () => {
  const { fetch: f, calls } = fakeJira({
    'GET /rest/api/3/issue/MSP-1?fields': { key: 'MSP-1', fields: {
      summary: 'Login page', status: jiraStatus('3', 'In Progress', 'indeterminate'), assignee: { accountId: 'a1', displayName: 'Pat Lee' }, reporter: { accountId: 'a2', displayName: 'Jo' },
      labels: ['ui'], priority: { name: 'High' }, issuetype: { name: 'Story' }, created: '2026-09-01T00:00:00.000+0000', updated: '2026-09-02T00:00:00.000+0000',
      description: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'As a user…' }] }] },
      comment: { comments: [{ id: '100', author: { accountId: 'a2', displayName: 'Jo' }, created: '2026-09-01T02:00:00.000+0000', body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'On it' }] }] } }] },
      parent: { key: 'MSP-0', fields: { summary: 'Epic' } }, subtasks: [{ key: 'MSP-5', fields: { summary: 'Sub' } }],
      issuelinks: [{ type: { inward: 'is blocked by', outward: 'blocks' }, inwardIssue: { key: 'MSP-9', fields: { summary: 'API' } } }],
    } },
    'GET /rest/api/3/issue/MSP-1/transitions': { transitions: [
      { id: '11', name: 'Back to To Do', to: jiraStatus('1', 'To Do', 'new') }, { id: '21', name: 'Send to review', to: jiraStatus('4', 'In Review', 'indeterminate') }, { id: '31', name: 'Done', to: jiraStatus('10', 'Done', 'done') },
    ] },
    'POST /rest/api/3/issue/MSP-1/transitions': undefined,
    'POST /rest/api/3/issue/MSP-1/comment': { id: '101' },
    'PUT /rest/api/3/issue/MSP-1/assignee': undefined,
    'PUT /rest/api/3/issue/MSP-1': undefined,
  });
  const jira = new JiraClient({ site: 'https://acme.atlassian.net/', project: 'MSP', email: 'me@acme.co', token: 'tok', fetch: f });
  const t = await jira.ticket('MSP-1');
  assert.deepEqual([t.title, t.type, t.status.name, t.priority, t.reporter!.name], ['Login page', 'Story', 'In Progress', 'High', 'Jo']);
  assert.deepEqual(t.body, { blocks: [{ t: 'p', c: [{ t: 'text', text: 'As a user…' }] }] });
  assert.equal(t.comments[0]!.url, 'https://acme.atlassian.net/browse/MSP-1?focusedCommentId=100');
  assert.deepEqual(t.related.map((r) => [r.key, r.relation]), [['MSP-0', 'parent'], ['MSP-5', 'sub-task'], ['MSP-9', 'is blocked by']]);
  const moves = await jira.transitions('MSP-1');
  const review = { id: 'col-1', name: 'In Progress', category: 'doing' as const, statusIds: ['3', '4'] };
  assert.deepEqual(movesInto(moves, review).map((m) => m.name), ['Send to review'], 'only moves whose target the column holds');
  await jira.transition('MSP-1', moves[2]!);
  assert.deepEqual(calls.at(-1)!.body, { transition: { id: '31' } });
  await jira.comment('MSP-1', 'Looks **good**');
  assert.equal((calls.at(-1)!.body as { body: { type: string } }).body.type, 'doc', 'comments go as ADF');
  await jira.assign('MSP-1', []);
  assert.deepEqual(calls.at(-1)!.body, { accountId: null }, 'unassign');
  await jira.setLabels('MSP-1', ['backend'], ['ui']);
  assert.deepEqual(calls.at(-1)!.body, { update: { labels: [{ add: 'backend' }, { remove: 'ui' }] } });
  await assert.rejects(jira.setLabels('MSP-1', ['two words'], []), /can't contain spaces/);
});

// ---------------------------------------------------------------- the place (D-072)

const isOutside = (re: RegExp) => (e: unknown) => e instanceof TrackerError && e.kind === 'outside' && re.test(e.message);
const jql = (path: string) => new URL(`https://x${path}`).searchParams.get('jql');
/** A Jira issue as Jira sends it, with its project and parent. A parent comes with its own summary, as Jira's does. */
const placed = (key: string, fields: Record<string, unknown>) => {
  const parent = fields.parent as { key: string; fields?: unknown } | undefined;
  return { key, fields: { summary: key, status: jiraStatus('1', 'To Do', 'new'), assignee: null, issuetype: { name: 'Story', subtask: false }, labels: [], ...fields, ...(parent ? { parent: { fields: { summary: parent.key }, ...parent } } : {}) } };
};

test('a Jira board with an epic shows only its tickets and their sub-tasks, and says so with the epic\'s name', async () => {
  const children = `GET /rest/agile/1.0/board/42/issue?jql=${encodeURIComponent('project = "MSP" AND parent in (MSP-3)')}`;
  const subtasks = `GET /rest/agile/1.0/board/42/issue?jql=${encodeURIComponent('project = "MSP" AND parent in (MSP-4, MSP-5)')}`;
  const { fetch: f, calls } = fakeJira({
    'GET /rest/agile/1.0/board/42/configuration': { name: 'MSP board', columnConfig: { columns: [{ name: 'To Do', statuses: [{ id: '1' }] }] } },
    'GET /rest/api/3/project/MSP/statuses': [{ statuses: [jiraStatus('1', 'To Do', 'new')] }],
    'GET /rest/api/3/issue/MSP-3?fields=summary': { key: 'MSP-3', fields: { summary: 'Premium Support' } },
    [children]: { total: 4, issues: [
      placed('MSP-4', { project: { key: 'MSP' }, parent: { key: 'MSP-3' } }),
      placed('MSP-5', { project: { key: 'MSP' }, parent: { key: 'msp-3' } }),
      placed('OPS-1', { project: { key: 'OPS' }, parent: { key: 'MSP-3' } }),
      placed('MSP-8', { project: { key: 'MSP' }, parent: { key: 'MSP-9' } }),
    ] },
    [subtasks]: { total: 2, issues: [placed('MSP-6', { project: { key: 'MSP' }, parent: { key: 'MSP-4' }, issuetype: { name: 'Sub-task', subtask: true } }), placed('MSP-7', { project: { key: 'MSP' }, parent: { key: 'MSP-2' } })] },
  });
  const jira = new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'e', token: 't', board: 42, epics: ['msp-3'], fetch: f });
  assert.equal(jira.place, 'Jira · MSP · epic MSP-3', 'before the board loads, without its name');
  const b = await jira.board();
  assert.deepEqual(b.cards.map((c) => c.key), ['MSP-4', 'MSP-5', 'MSP-6'], 'the epic\'s tickets and their sub-tasks; not another project\'s, nor a stray');
  assert.equal(b.place, 'Jira · MSP · epic MSP-3 Premium Support');
  assert.equal(b.notice, null);
  assert.deepEqual(calls.filter((c) => c.path.includes('/issue?jql=')).map((c) => jql(c.path)), ['project = "MSP" AND parent in (MSP-3)', 'project = "MSP" AND parent in (MSP-4, MSP-5)']);

  const empty = fakeJira({
    'GET /rest/agile/1.0/board/42/configuration': { name: 'MSP board', columnConfig: { columns: [{ name: 'To Do', statuses: [{ id: '1' }] }] } },
    'GET /rest/api/3/project/MSP/statuses': [], 'GET /rest/api/3/issue/MSP-3?fields=summary': { fields: { summary: 'Premium Support' } },
    'GET /rest/agile/1.0/board/42/issue?jql=': { total: 0, issues: [] },
  });
  const none = await new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'e', token: 't', board: 42, epics: ['MSP-3'], fetch: empty.fetch }).board();
  assert.match(none.notice!, /No ticket in epic MSP-3 is on this board\. Its own filter may leave them out/, 'a board whose filter leaves the epic out says why it\'s empty');
});

test('a Jira ticket outside the place isn\'t shown: another project\'s, a moved one, or with an epic, one outside it', async () => {
  const { fetch: f, calls } = fakeJira({
    'GET /rest/api/3/issue/OPS-1?': placed('OPS-1', { project: { key: 'OPS' } }),
    'GET /rest/api/3/issue/MSP-9?': placed('OPS-2', { project: { key: 'OPS' } }), // moved: Jira answers with its new key
    'GET /rest/api/3/issue/MSP-4?fields=parent': { key: 'MSP-4', fields: { parent: { key: 'MSP-3' } } },
    'GET /rest/api/3/issue/MSP-4?': placed('MSP-4', { project: { key: 'MSP' }, parent: { key: 'MSP-3' } }),
    'GET /rest/api/3/issue/MSP-6?': placed('MSP-6', { project: { key: 'MSP' }, parent: { key: 'MSP-4', fields: { summary: 'MSP-4' } }, issuetype: { name: 'Sub-task', subtask: true } }),
    'GET /rest/api/3/issue/MSP-5?fields=parent': { key: 'MSP-5', fields: { parent: { key: 'MSP-1' } } },
    'GET /rest/api/3/issue/MSP-7?': placed('MSP-7', { project: { key: 'MSP' }, parent: { key: 'MSP-5' }, issuetype: { name: 'Sub-task', subtask: true } }),
    'GET /rest/api/3/issue/MSP-8?': placed('MSP-8', { project: { key: 'MSP' }, parent: { key: 'MSP-1' } }),
    'GET /rest/api/3/issue/MSP-3?': placed('MSP-3', { project: { key: 'MSP' }, issuetype: { name: 'Epic', subtask: false } }),
  });
  const whole = new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'e', token: 't', fetch: f });
  await assert.rejects(whole.ticket('OPS-1'), isOutside(/^OPS-1 isn't one of this repo's tickets, which come from Jira · MSP: it's in project OPS\.$/));
  await assert.rejects(whole.ticket('MSP-9'), isOutside(/MSP-9 .*: it moved to OPS-2, in project OPS/), 'the key that comes back is compared, not the one asked for');
  assert.ok(calls.some((c) => c.path.startsWith('/rest/api/3/issue/OPS-1?') && c.path.includes('project')), 'the ticket\'s project is asked for');
  assert.equal((await whole.ticket('MSP-8')).key, 'MSP-8', 'with no epic, any of the project\'s tickets');

  const epic = new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'e', token: 't', epics: ['MSP-3'], fetch: f });
  assert.equal((await epic.ticket('MSP-4')).key, 'MSP-4', 'a child of the epic');
  assert.equal((await epic.ticket('MSP-6')).key, 'MSP-6', 'a sub-task of one of its children');
  await assert.rejects(epic.ticket('MSP-8'), isOutside(/MSP-8 isn't one of this repo's tickets, which come from Jira · MSP · epic MSP-3: it isn't in epic MSP-3\./));
  await assert.rejects(epic.ticket('MSP-7'), isOutside(/it isn't in epic MSP-3/), 'a sub-task of a ticket outside it');
  await assert.rejects(epic.ticket('MSP-3'), isOutside(/the epic itself/), 'the epic itself doesn\'t count');

  assert.deepEqual(await epic.outside(['MSP-4', 'OPS-1', 'MSP-8', 'MSP-404']), [{ key: 'OPS-1', why: 'it\'s in project OPS' }, { key: 'MSP-8', why: 'it isn\'t in epic MSP-3' }], 'one it can\'t read is never outside');
  assert.deepEqual(await epic.outside(['MSP-8', 'MSP-9'], { project: true }), [{ key: 'MSP-9', why: 'it moved to OPS-2, in project OPS' }], 'held to the project only, the epic doesn\'t count');
});

test('Jira lists a project\'s open epics through the search that replaced the old one', async () => {
  const { jiraEpics } = await import('../src/trackers/jira.ts');
  const { fetch: f, calls } = fakeJira({ 'GET /rest/api/3/search/jql?': { issues: [{ key: 'MSP-3', fields: { summary: 'Premium Support' } }] } });
  assert.deepEqual(await jiraEpics('acme.atlassian.net', 'MSP', 'e', 't', f), [{ key: 'MSP-3', name: 'Premium Support' }]);
  assert.equal(jql(calls[0]!.path), 'project = "MSP" AND issuetype = Epic AND statusCategory != Done ORDER BY created DESC');
});

test('GitHub labels hold the place: one list per label, merged, on the Open and Closed board; any one of them counts, whatever its case', async () => {
  const lab = (...names: string[]) => ({ labels: names.map((name) => ({ name, color: 'ededed' })) });
  const { exec, calls } = fakeGh([
    ['api graphql', projectsAnswer([])],
    ['issue list -R o/r --state open --limit 200 --label billing', JSON.stringify([issue(4, 'OPEN', lab('billing')), issue(2, 'OPEN', lab('billing', 'invoices'))])],
    ['issue list -R o/r --state open --limit 200 --label invoices', JSON.stringify([issue(5, 'OPEN', lab('Invoices')), issue(2, 'OPEN', lab('billing', 'invoices'))])],
    ['issue list -R o/r --state closed --limit 30 --label billing', JSON.stringify([issue(1, 'CLOSED', lab('billing'))])],
    ['issue list -R o/r --state closed --limit 30 --label invoices', '[]'],
    ['issue view 6 ', JSON.stringify({ ...issue(6, 'OPEN', lab('docs')), body: '', author: null, comments: [], createdAt: '', updatedAt: '' })],
    ['issue view 7 ', JSON.stringify({ ...issue(7, 'OPEN', lab('BILLING')), body: '', author: null, comments: [], createdAt: '', updatedAt: '' })],
    ['issue view 8 ', JSON.stringify({ ...issue(8, 'OPEN', lab('billing')), url: 'https://github.com/other/repo/issues/3', body: '', author: null, comments: [], createdAt: '', updatedAt: '' })],
  ]);
  const gh = new GithubClient({ repo: 'o/r', token: 't', account: 'me', exec, labels: ['billing', 'invoices'] });
  const b = await gh.board();
  assert.deepEqual(b.cards.map((c) => c.key), ['GH-5', 'GH-4', 'GH-2', 'GH-1'], 'each issue once, newest first');
  assert.equal(b.place, 'GitHub · o/r · labels billing or invoices');
  assert.equal(calls.filter((c) => c.args.startsWith('issue list')).length, 4, 'gh wants every --label it\'s given, so one list per label and state');
  assert.equal(new GithubClient({ repo: 'o/r', token: 't', account: 'me', exec, labels: ['billing'] }).place, 'GitHub · o/r · label billing');
  assert.equal(new GithubClient({ repo: 'o/r', token: 't', account: 'me', exec }).place, 'GitHub · o/r');

  await assert.rejects(gh.ticket('GH-6'), isOutside(/^GH-6 isn't one of this repo's tickets, which come from GitHub · o\/r · labels billing or invoices: it has none of the labels billing or invoices\.$/));
  assert.equal((await gh.ticket('GH-7')).key, 'GH-7', 'labels ignore case');
  await assert.rejects(gh.ticket('GH-8'), isOutside(/it moved to other\/repo/), 'an issue transferred to another repo');
  assert.deepEqual(await gh.outside(['GH-6', 'GH-7', 'GH-8', 'GH-99']), [{ key: 'GH-6', why: 'it has none of the labels billing or invoices' }, { key: 'GH-8', why: 'it moved to other/repo' }]);
  assert.deepEqual(await gh.outside(['GH-6', 'GH-8'], { project: true }), [{ key: 'GH-8', why: 'it moved to other/repo' }], 'held to the repo only, labels don\'t count');
});

test('GitHub labels hold a Project board too: an issue with none of them isn\'t a card', async () => {
  const project = { id: 'PVT_1', number: 3, title: 'Roadmap', url: 'u', closed: false, field: { id: 'F_1', options: [{ id: 'o1', name: 'Todo' }] } };
  const item = (id: string, n: number, labels: string[]) => ({ id, fieldValueByName: { optionId: 'o1', name: 'Todo' }, content: { __typename: 'Issue', repository: { nameWithOwner: 'o/r' }, ...issue(n, 'OPEN'), assignees: { nodes: [] }, labels: { nodes: labels.map((name) => ({ name, color: 'ededed' })) } } });
  const items = { data: { node: { items: { pageInfo: { hasNextPage: false, endCursor: 'x' }, nodes: [item('I_1', 1, ['Billing']), item('I_2', 2, ['docs']), item('I_3', 3, [])] } } } };
  const { exec, calls } = fakeGh([
    ['api graphql -f query=query($owner: String!, $name: String!) {\n  repository(owner: $owner, name: $name) {\n    projectsV2', projectsAnswer([project])],
    ['api graphql -f query=query($id', JSON.stringify(items)],
  ]);
  const b = await new GithubClient({ repo: 'o/r', token: 't', account: 'me', exec, labels: ['billing'] }).board();
  assert.deepEqual(b.cards.map((c) => c.key), ['GH-1']);
  assert.equal(b.place, 'GitHub · o/r · label billing');
  assert.match(calls.find((c) => c.args.includes('query($id'))!.args, /labels\(first: 50\)/, 'enough labels that a place label isn\'t cut off');
});

test('Jira errors say what to do: a refused token, a missing board, an unreachable site', async () => {
  const refused = fakeJira({ 'GET /rest/api/3/myself': { message: 'nope' } }, { 'GET /rest/api/3/myself': 401 });
  await assert.rejects(new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'e', token: 't', fetch: refused.fetch }).me(), (e: unknown) => e instanceof TrackerError && e.kind === 'auth' && /Connect again/.test(e.message));
  const noBoard = fakeJira({ 'GET /rest/agile/1.0/board?projectKeyOrId=MSP': { values: [] } });
  await assert.rejects(new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'e', token: 't', fetch: noBoard.fetch }).board(), /has no Jira board/);
  const down = (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch;
  await assert.rejects(new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'e', token: 't', fetch: down }).me(), (e: unknown) => e instanceof TrackerError && e.kind === 'network');
});

test('a document goes back to markdown for a builder\'s brief, and survives the round trip', async () => {
  const { toMarkdown } = await import('../src/trackers/doc.ts');
  const md = '## Steps\n\nAdd **Region__c** to `Account`, see [docs](https://x.y).\n\n- [x] field\n- [ ] layout\n  - nested\n\n1. one\n2. two\n\n```apex\nSystem.debug(1);\n```\n\n> careful\n\n| a | b |\n| --- | --- |\n| 1 | 2 |';
  const out = toMarkdown(fromMarkdown(md));
  assert.deepEqual(fromMarkdown(out), fromMarkdown(md), 'markdown → doc → markdown keeps the meaning');
  assert.match(toMarkdown(fromAdf({ type: 'doc', content: [{ type: 'panel', attrs: { panelType: 'info' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Heads up' }] }] }] })), /^> \*\*Info\*\*\n>\n> Heads up$/);
});

// ---------------------------------------------------------------- Azure DevOps

test('HTML from Azure becomes the same blocks: structure and marks kept, scripts and markup gone', async () => {
  const { fromHtml, toHtml } = await import('../src/trackers/doc.ts');
  const doc = fromHtml([
    '<div>As a <b>support lead</b>, I want <i>premium</i> cases <span style="color:red">escalated</span>&nbsp;&amp; flagged.<br>Second line</div>',
    '<h2>Steps</h2><ol><li>Open a case<li>Wait <u>two</u> hours</ol>',
    '<ul><li><a href="https://x.y/doc">Spec</a> and <a href="javascript:alert(1)">bad</a></li><li><a href="#" data-vss-mention="version:2.0,abc">@Pat Lee</a></li></ul>',
    '<p><img src="https://dev.azure.com/acme/_apis/wit/attachments/1?fileName=shot.png" alt="shot.png"></p>',
    '<table><tr><th>Priority</th><th>After</th></tr><tr><td>High</td><td>2 h</td></tr></table>',
    '<pre>line 1\n  line 2</pre><script>alert(1)</script><style>p{}</style><!-- note --><p>End &lt;tag&gt;</p>',
  ].join(''));
  const [p1, h, ol, ul, img, table, pre, end] = doc.blocks;
  assert.deepEqual((p1 as { c: unknown[] }).c, [
    { t: 'text', text: 'As a ' }, { t: 'text', text: 'support lead', marks: ['strong'] }, { t: 'text', text: ', I want ' }, { t: 'text', text: 'premium', marks: ['em'] },
    { t: 'text', text: ' cases escalated & flagged.'.replace(' ', ' ') }, { t: 'br' }, { t: 'text', text: 'Second line' },
  ]);
  assert.deepEqual(h, { t: 'h', level: 2, c: [{ t: 'text', text: 'Steps' }] });
  assert.deepEqual((ol as { items: unknown[] }).items.length, 2, 'unclosed <li>s still make two items');
  const links = JSON.stringify(ul);
  assert.ok(links.includes('"href":"https://x.y/doc"') && !links.includes('javascript:'));
  assert.ok(links.includes('"t":"mention","text":"@Pat Lee"'));
  assert.deepEqual(img, { t: 'media', label: 'shot.png', href: 'https://dev.azure.com/acme/_apis/wit/attachments/1?fileName=shot.png' });
  assert.deepEqual(table, { t: 'table', head: [[{ t: 'text', text: 'Priority' }], [{ t: 'text', text: 'After' }]], rows: [[[{ t: 'text', text: 'High' }], [{ t: 'text', text: '2 h' }]]] });
  assert.deepEqual(pre, { t: 'code', lang: null, text: 'line 1\n  line 2' });
  assert.deepEqual(end, { t: 'p', c: [{ t: 'text', text: 'End <tag>' }] });
  assert.ok(!JSON.stringify(doc).includes('alert'), 'script contents never become words');
  assert.equal(toHtml(fromMarkdown('Say **<b>hi</b>** & [go](https://x.y)')), '<p>Say <b>hi</b> &amp; <a href="https://x.y">go</a></p>', 'bold once, however it was written');
  assert.equal(toHtml(fromMarkdown('If `a < b` and x > "y"')), '<p>If <code>a &lt; b</code> and x &gt; &quot;y&quot;</p>', 'every word going out is escaped');
});

/** A stand-in for Azure DevOps: answers by method and path prefix, and records each request. */
function fakeAzure(routes: [string, unknown | ((body: unknown) => unknown)][], opts: { status?: number; contentType?: string; headers?: Record<string, string> } = {}) {
  const calls: { method: string; path: string; body: unknown; auth: string | null; type: string | null }[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    const path = url.replace('https://dev.azure.com/acme', '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const h = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method, path, body, auth: h.Authorization ?? null, type: h['Content-Type'] ?? null });
    const hit = routes.find(([k]) => `${method} ${path}`.startsWith(k));
    if (!hit) return new Response(JSON.stringify({ message: `no route ${method} ${path}` }), { status: 404 });
    const payload = typeof hit[1] === 'function' ? (hit[1] as (b: unknown) => unknown)(body) : hit[1];
    return new Response(JSON.stringify(payload ?? {}), { status: opts.status ?? 200, headers: { 'content-type': opts.contentType ?? 'application/json', ...opts.headers } });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

const COLUMNS = [
  { id: 'c0', name: 'New', columnType: 'incoming', stateMappings: { 'User Story': 'New', Bug: 'New' } },
  { id: 'c1', name: 'Dev', columnType: 'inProgress', stateMappings: { 'User Story': 'Active', Bug: 'Active' } },
  { id: 'c2', name: 'Code Review', columnType: 'inProgress', stateMappings: { 'User Story': 'Active', Bug: 'Active' } },
  { id: 'c3', name: 'Closed', columnType: 'outgoing', stateMappings: { 'User Story': 'Closed', Bug: 'Closed' } },
];
const COL_FIELD = 'WEF_ABC_Kanban.Column';
const boardRoutes = (items: unknown[]): [string, unknown][] => [
  ['GET /CRM/_apis/projects/CRM?', {}],
  ['GET /_apis/projects/CRM?', { defaultTeam: { name: 'CRM Team' } }],
  ['GET /CRM/CRM%20Team/_apis/work/boards?', { value: [{ id: 'b1', name: 'Epics' }, { id: 'b2', name: 'Features' }, { id: 'b3', name: 'Stories' }] }],
  ['GET /CRM/CRM%20Team/_apis/work/boards/b3?', { columns: COLUMNS, fields: { columnField: { referenceName: COL_FIELD } } }],
  ['GET /CRM/CRM%20Team/_apis/work/teamsettings/teamfieldvalues', { field: { referenceName: 'System.AreaPath' }, values: [{ value: "CRM\\Sales O'Brien", includeChildren: true }] }],
  ['POST /CRM/CRM%20Team/_apis/wit/wiql', { workItems: [{ id: 101 }, { id: 102 }, { id: 103 }] }],
  ['POST /CRM/_apis/wit/workitemsbatch', { value: items }],
  ['PATCH /CRM/_apis/wit/workitems/', {}],
];

test('an Azure board: the team\'s Kanban columns, cards placed by their board column, and a move sets column and state', async () => {
  const { AzureClient } = await import('../src/trackers/azure.ts');
  const items = [
    { id: 101, fields: { 'System.Title': 'Escalate premium cases', 'System.State': 'Active', 'System.WorkItemType': 'User Story', 'System.AssignedTo': { displayName: 'Pat Lee', uniqueName: 'pat@acme.com' }, 'System.Tags': 'service; sla', 'Microsoft.VSTS.Common.Priority': 2, [COL_FIELD]: 'Code Review' } },
    { id: 102, fields: { 'System.Title': 'Fix welcome email', 'System.State': 'New', 'System.WorkItemType': 'Bug', 'Microsoft.VSTS.Common.Priority': 1 } },
    { id: 103, fields: { 'System.Title': 'A task the board doesn\'t show', 'System.State': 'Active', 'System.WorkItemType': 'Task' } },
  ];
  const { fetch: f, calls } = fakeAzure(boardRoutes(items));
  const az = new AzureClient({ organization: 'acme', project: 'CRM', auth: async () => 'Bearer tok', fetch: f });
  const b = await az.board();
  assert.equal(b.source, 'azure-board');
  assert.equal(b.title, 'Stories · CRM Team', 'the requirements board, not Epics');
  assert.deepEqual(b.columns.map((c) => [c.name, c.category]), [['New', 'todo'], ['Dev', 'doing'], ['Code Review', 'doing'], ['Closed', 'done']]);
  assert.deepEqual(b.cards.map((c) => [c.key, c.status.id, c.status.name, c.priority]), [['AB-101', 'Code Review', 'Active', 'High'], ['AB-102', 'New', 'New', 'Highest']], 'two columns share Active; the board column decides');
  assert.deepEqual(b.cards[0]!.labels.map((l) => l.name), ['service', 'sla']);
  const wiql = (calls.find((c) => c.path.includes('/wiql'))!.body as { query: string }).query;
  assert.match(wiql, /\[System\.WorkItemType\] IN \('User Story', 'Bug'\)/);
  assert.match(wiql, /\[System\.AreaPath\] UNDER 'CRM\\Sales O''Brien'/, 'quotes are doubled');
  assert.match(wiql, /NOT IN \('Closed'\) OR \[System\.ChangedDate\] >= @Today - 30/);
  assert.ok(calls.every((c) => c.auth === 'Bearer tok'));

  await az.moveToColumn(b.cards[1]!, b.columns[2]!);
  const patch = calls.at(-1)!;
  assert.equal(patch.type, 'application/json-patch+json');
  assert.deepEqual(patch.body, [{ op: 'add', path: `/fields/${COL_FIELD}`, value: 'Code Review' }, { op: 'add', path: '/fields/System.State', value: 'Active' }]);
  await az.moveToColumn(b.cards[0]!, b.columns[1]!);
  assert.deepEqual(calls.at(-1)!.body, [{ op: 'add', path: `/fields/${COL_FIELD}`, value: 'Dev' }], 'same state: only the column changes');
});

test('an Azure work item: HTML or markdown fields, acceptance criteria, comments, links, and every write as a JSON patch', async () => {
  const { AzureClient } = await import('../src/trackers/azure.ts');
  const { fetch: f, calls } = fakeAzure([
    ['GET /CRM/_apis/wit/workitems/101?$expand', { id: 101, fields: {
      'System.Title': 'Escalate premium cases', 'System.State': 'Active', 'System.WorkItemType': 'User Story', 'System.Tags': 'sla',
      'System.Description': '<div>Premium cases <b>escalate</b>.</div>', 'Microsoft.VSTS.Common.AcceptanceCriteria': '- [ ] Tier 2 queue\n- [x] Owner told',
      'System.CreatedBy': { displayName: 'Jo', uniqueName: 'jo@acme.com' }, 'System.CreatedDate': '2026-09-01T00:00:00Z', 'System.ChangedDate': '2026-09-02T00:00:00Z',
    }, multilineFieldsFormat: { 'Microsoft.VSTS.Common.AcceptanceCriteria': 'Markdown' },
    relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'https://dev.azure.com/acme/xyz/_apis/wit/workItems/90' }, { rel: 'ArtifactLink', url: 'vstfs:///Git/Commit/1' }] }],
    ['GET /CRM/_apis/wit/workitemtypes/User%20Story/states', { value: [{ name: 'New', category: 'Proposed' }, { name: 'Active', category: 'InProgress' }, { name: 'Resolved', category: 'Resolved' }, { name: 'Closed', category: 'Completed' }, { name: 'Removed', category: 'Removed' }] }],
    ['GET /CRM/_apis/wit/workItems/101/comments', { comments: [{ id: 7, text: '<p>On <i>it</i></p>', createdBy: { displayName: 'Pat Lee' }, createdDate: '2026-09-01T02:00:00Z' }] }],
    ['POST /CRM/_apis/wit/workitemsbatch', { value: [{ id: 90, fields: { 'System.Title': 'Premium support' } }] }],
    ['GET /CRM/_apis/wit/workitems/101?fields=System.State', { fields: { 'System.State': 'Active', 'System.WorkItemType': 'User Story' } }],
    ['GET /CRM/_apis/wit/workitems/101?fields=System.Tags', { fields: { 'System.Tags': 'sla; old' } }],
    ['POST /CRM/_apis/wit/workItems/101/comments', { id: 8 }],
    ['PATCH /CRM/_apis/wit/workitems/101', {}],
  ]);
  const az = new AzureClient({ organization: 'acme', project: 'CRM', auth: async () => 'Basic x', fetch: f, prefix: 'av' });
  const t = await az.ticket('AV-101');
  assert.deepEqual([t.key, t.kind, t.status.name, t.status.category, t.reporter!.name], ['AV-101', 'azure', 'Active', 'doing', 'Jo']);
  assert.equal(t.url, 'https://dev.azure.com/acme/CRM/_workitems/edit/101');
  assert.deepEqual(t.body.blocks.map((b) => b.t), ['p', 'h', 'list'], 'description, then its acceptance criteria under a heading');
  assert.equal((t.body.blocks[2] as { items: { checked?: boolean }[] }).items[1]!.checked, true, 'markdown fields are read as markdown');
  assert.deepEqual(t.comments[0]!.body, { blocks: [{ t: 'p', c: [{ t: 'text', text: 'On ' }, { t: 'text', text: 'it', marks: ['em'] }] }] });
  assert.deepEqual(t.related, [{ key: 'AV-90', title: 'Premium support', relation: 'parent', url: 'https://dev.azure.com/acme/CRM/_workitems/edit/90', status: null, typeKind: null, typeColor: null }]);
  assert.match(t.markdown, /Premium cases \*\*escalate\*\*/);
  assert.deepEqual((await az.transitions('AV-101')).map((x) => x.name), ['New', 'Resolved', 'Closed'], 'not where it is, and never Removed');
  await az.comment('AV-101', 'Looks **good**');
  assert.deepEqual(calls.at(-1)!.body, { text: '<p>Looks <b>good</b></p>' });
  await az.setLabels('AV-101', ['new'], ['old']);
  assert.deepEqual(calls.at(-1)!.body, [{ op: 'add', path: '/fields/System.Tags', value: 'sla; new' }]);
  await az.assign('AV-101', []);
  assert.deepEqual(calls.at(-1)!.body, [{ op: 'add', path: '/fields/System.AssignedTo', value: '' }]);
  assert.throws(() => az.idOf('MSP-1'), /isn't a work item key \(AV-<id>\)/);
});

test('Azure sign-in trouble is named: a sign-in page instead of data, and the tenant comes from the org\'s own header', async () => {
  const { AzureClient, tenantOf } = await import('../src/trackers/azure.ts');
  const page = fakeAzure([['GET /_apis/connectionData', '<html>Sign in</html>']], { status: 203, contentType: 'text/html' });
  await assert.rejects(new AzureClient({ organization: 'acme', project: 'CRM', auth: async () => 'Basic bad', fetch: page.fetch }).me(), (e: unknown) => e instanceof TrackerError && e.kind === 'auth' && /Sign in again/.test(e.message));
  const head = fakeAzure([['HEAD /_apis/connectionData', {}]], { status: 401, headers: { 'x-vss-resourcetenant': '1f2e3d4c-0000-1111-2222-333344445555' } });
  assert.equal(await tenantOf('acme', head.fetch), '1f2e3d4c-0000-1111-2222-333344445555');
  const msa = fakeAzure([['HEAD /_apis/connectionData', {}]], { status: 401, headers: { 'x-vss-resourcetenant': '00000000-0000-0000-0000-000000000000' } });
  assert.equal(await tenantOf('acme', msa.fetch), null, 'an org with no tenant of its own');
});

test('an Azure area path holds the board\'s query, and a work item from another project or outside the area isn\'t shown', async () => {
  const { AzureClient } = await import('../src/trackers/azure.ts');
  const board = fakeAzure(boardRoutes([]));
  const az = new AzureClient({ organization: 'acme', project: 'CRM', areaPath: "CRM\\Billing", auth: async () => 'Bearer tok', fetch: board.fetch });
  const b = await az.board();
  const wiql = (board.calls.find((c) => c.path.includes('/wiql'))!.body as { query: string }).query;
  assert.match(wiql, /AND \[System\.AreaPath\] UNDER 'CRM\\Billing'/);
  assert.match(wiql, /\[System\.TeamProject\] = @project/, 'still held to the project and the team\'s areas');
  assert.equal(b.place, 'Azure DevOps · CRM · CRM Team · area CRM\\Billing');
  assert.match(b.notice!, /No work item under CRM\\Billing is on this board/);
  assert.equal(new AzureClient({ organization: 'acme', project: 'CRM', auth: async () => 'x' }).place, 'Azure DevOps · CRM', 'no narrower place: just the project');

  const item = (id: number, project: string, area: string) => [`GET /CRM/_apis/wit/workitems/${id}?$expand`, { id, fields: { 'System.Title': `Item ${id}`, 'System.State': 'New', 'System.WorkItemType': 'Bug', 'System.TeamProject': project, 'System.AreaPath': area } }] as [string, unknown];
  const { fetch: f, calls } = fakeAzure([
    item(7, 'Other', 'Other'), item(8, 'CRM', 'CRM\\Sales'), item(9, 'CRM', 'crm\\billing\\Invoices'), item(10, 'CRM', 'CRM\\BillingOld'),
    ['GET /CRM/_apis/wit/workitemtypes', { value: [] }], ['GET /CRM/_apis/wit/workItems/', { comments: [] }],
    ['POST /_apis/wit/workitemsbatch', (body: unknown) => {
      const known: Record<number, Record<string, string>> = { 7: { 'System.TeamProject': 'Other', 'System.AreaPath': 'Other' }, 8: { 'System.TeamProject': 'CRM', 'System.AreaPath': 'CRM\\Sales' } };
      return { value: (body as { ids: number[] }).ids.map((id) => (known[id] ? { id, fields: known[id] } : null)) };
    }],
  ]);
  const whole = new AzureClient({ organization: 'acme', project: 'CRM', auth: async () => 'x', fetch: f });
  await assert.rejects(whole.ticket('AB-7'), isOutside(/^AB-7 isn't one of this repo's tickets, which come from Azure DevOps · CRM: it's in project Other\.$/), 'work item ids are the organization\'s, so the project is checked even with no area');
  assert.equal((await whole.ticket('AB-8')).key, 'AB-8');
  const area = new AzureClient({ organization: 'acme', project: 'CRM', team: 'Billing', areaPath: 'CRM\\Billing', auth: async () => 'x', fetch: f });
  await assert.rejects(area.ticket('AB-8'), isOutside(/its area CRM\\Sales isn't under CRM\\Billing/));
  assert.equal((await area.ticket('AB-9')).key, 'AB-9', 'under the area, whatever its case');
  await assert.rejects(area.ticket('AB-10'), isOutside(/isn't under/), 'a sibling whose name starts the same isn\'t under it');

  assert.deepEqual(await area.outside(['AB-7', 'AB-99', 'AB-8', 'MSP-1']), [{ key: 'AB-7', why: 'it\'s in project Other' }, { key: 'AB-8', why: 'its area CRM\\Sales isn\'t under CRM\\Billing' }], 'a deleted one comes back null and isn\'t outside');
  const batch = calls.find((c) => c.path.startsWith('/_apis/wit/workitemsbatch'))!;
  assert.deepEqual(batch.body, { ids: [7, 99, 8], fields: ['System.Id', 'System.TeamProject', 'System.AreaPath'], errorPolicy: 'omit' }, 'one call, from the organization, leaving out what it can\'t read');
  assert.deepEqual(await area.outside(['AB-8'], { project: true }), [], 'held to the project only, the area doesn\'t count');
});

test('Azure lists a team\'s area paths and the ones under them, for picking a place', async () => {
  const { azureAreas } = await import('../src/trackers/azure.ts');
  const tree = { name: 'CRM', children: [{ name: 'Sales', children: [{ name: 'EMEA' }] }, { name: 'Billing', children: [{ name: 'Invoices' }, { name: 'Refunds' }] }] };
  const { fetch: f } = fakeAzure([
    ['GET /CRM/Billing%20Team/_apis/work/teamsettings/teamfieldvalues', { field: { referenceName: 'System.AreaPath' }, values: [{ value: 'CRM\\Billing', includeChildren: true }, { value: 'CRM\\Sales', includeChildren: false }] }],
    ['GET /CRM/_apis/wit/classificationnodes/Areas', tree],
  ]);
  assert.deepEqual(await azureAreas('acme', 'CRM', 'Billing Team', 'x', f), ['CRM\\Billing', 'CRM\\Billing\\Invoices', 'CRM\\Billing\\Refunds', 'CRM\\Sales']);
});

// ---------------------------------------------------------------- monday.com

type MondayRoute = [RegExp, ((v: Record<string, unknown>) => unknown) | object];
/** A stand-in for monday.com's GraphQL API: answers by what each query asks for, and records its text, variables and headers. */
function fakeMonday(routes: MondayRoute[]) {
  const calls: { query: string; variables: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://api.monday.com/v2');
    const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
    calls.push({ query, variables, headers: init.headers as Record<string, string> });
    const hit = routes.find(([re]) => re.test(query));
    if (!hit) return Response.json({ errors: [{ message: `no route for ${query}`, extensions: { code: 'InvalidArgumentException' } }] });
    const data = typeof hit[1] === 'function' ? (hit[1] as (v: Record<string, unknown>) => unknown)(variables ?? {}) : hit[1];
    return data instanceof Response ? data : Response.json({ data });
  }) as unknown as typeof fetch;
  return { fetch: f, calls, mutations: () => calls.filter((c) => /^\s*mutation/.test(c.query)) };
}

const MON_STATUS = { labels: [
  { id: 5, label: '', index: 9 },
  { id: 0, label: 'Working on it', index: 1 },
  { id: 1, label: 'Done', index: 3, is_done: true },
  { id: 2, label: 'Stuck', index: 2 },
  { id: 3, label: 'Not started', index: 0 },
  { id: 4, label: 'On hold', index: 4, is_deactivated: true },
] };
const monMeta = (columns: unknown[] = [
  { id: 'priority', title: 'Priority', type: 'status', settings: { labels: [{ id: 0, label: 'High', index: 0 }, { id: 1, label: 'Low', index: 1 }] } },
  { id: 'status', title: 'Status', type: 'status', settings: MON_STATUS },
  { id: 'person', title: 'Owner', type: 'people', settings: {} },
]) => ({ boards: [{ id: '111', name: 'Client work', columns, groups: [{ id: 'topics', title: 'This sprint' }, { id: 'backlog', title: 'Backlog' }] }] });
const card = (id: string, name: string, status: number | null, people: { id: number; kind: string }[] = []) => ({ id, name, group: { id: 'topics' }, column_values: [{ id: 'status', index: status }, { id: 'person', persons_and_teams: people }] });
const monBoardRoutes = (pages: { cursor: string | null; items: unknown[] }[], meta = monMeta()): MondayRoute[] => [
  [/columns\(types: \[status, people\]\)/, meta],
  [/groups\(ids: \$group\) \{ items_page/, (v) => ({ boards: [{ groups: (v.group as string[]).includes('topics') ? [{ items_page: pages[0] }] : [] }] })],
  [/items_page\(limit/, { boards: [{ items_page: pages[0] }] }],
  [/next_items_page/, (v) => ({ next_items_page: pages[Number(String(v.cursor).slice(1))] })],
  [/users\(ids/, (v) => ({ users: (v.ids as string[]).filter((id) => id === '9').map((id) => ({ id: Number(id), name: 'Pat Lee' })) })],
];

test('a monday.com board: its status column\'s labels in monday\'s order, No status first when a card has none, and every page of items', async () => {
  const { MondayClient } = await import('../src/trackers/monday.ts');
  const { fetch: f, calls } = fakeMonday(monBoardRoutes([
    { cursor: 'p1', items: [card('101', 'Escalate premium cases', 0, [{ id: 9, kind: 'person' }, { id: 3, kind: 'team' }]), card('102', 'Fix welcome email', null)] },
    { cursor: null, items: [card('1234567890123', 'Renewal reminders', 1), card('104', 'Paused work', 4), card('105', 'On the blank label', 5)] },
  ]));
  const mon = new MondayClient({ account: 'acme', board: 111, token: 'tok', fetch: f });
  assert.deepEqual([mon.title, mon.place], ['monday.com · acme', 'monday.com · acme · board 111'], 'by id until the board says its name');
  const b = await mon.board();
  assert.deepEqual([b.source, b.title, b.url, b.place, b.notice], ['monday-board', 'Client work', 'https://acme.monday.com/boards/111', 'monday.com · acme · Client work', null]);
  assert.deepEqual(b.columns.map((c) => [c.name, c.category, c.statusIds]), [
    ['No status', 'todo', ['none']], ['Not started', 'doing', ['3']], ['Working on it', 'doing', ['0']], ['Stuck', 'doing', ['2']], ['Done', 'done', ['1']], ['On hold', 'doing', ['4']],
  ], 'the Status column, not the first status column; a switched-off label only while a card is on it');
  assert.deepEqual(b.cards.map((c) => [c.key, c.status.name, c.assignees.map((a) => a.name)]), [
    ['MON-101', 'Working on it', ['Pat Lee']], ['MON-102', 'No status', []], ['MON-1234567890123', 'Done', []], ['MON-104', 'On hold', []], ['MON-105', 'No status', []],
  ], 'ids too big for 32 bits stay as they are');
  assert.equal(b.cards[0]!.url, 'https://acme.monday.com/boards/111/pulses/101');
  const first = calls.find((c) => /items_page\(limit/.test(c.query))!;
  assert.doesNotMatch(first.query, /groups/, 'the whole board');
  assert.deepEqual(first.variables, { board: ['111'], cols: ['status', 'person'], limit: 500 }, 'only the columns a card needs');
  assert.deepEqual(calls.find((c) => /next_items_page/.test(c.query))!.variables, { cursor: 'p1', cols: ['status', 'person'], limit: 500 });
  assert.deepEqual(calls.find((c) => /users\(ids/.test(c.query))!.variables.ids, ['9'], 'people, not teams');
  assert.ok(calls.every((c) => c.headers.Authorization === 'tok' && c.headers['API-Version'] === '2026-10'));

  // Every card with a status: no No status column, and no column for a switched-off label nobody's on.
  const all = fakeMonday(monBoardRoutes([{ cursor: null, items: [card('101', 'A', 0), card('102', 'B', 1)] }]));
  const whole = await new MondayClient({ account: 'acme', board: 111, token: 'tok', fetch: all.fetch }).board();
  assert.deepEqual(whole.columns.map((c) => c.name), ['Not started', 'Working on it', 'Stuck', 'Done']);
  const priority = await new MondayClient({ account: 'acme', board: 111, statusColumn: 'priority', token: 'tok', fetch: all.fetch }).board();
  assert.deepEqual(priority.columns.map((c) => c.name), ['No status', 'High', 'Low'], 'the status column the tracker names, which these cards have no label in');
  const none = fakeMonday(monBoardRoutes([], monMeta([{ id: 'person', title: 'Owner', type: 'people', settings: {} }])));
  await assert.rejects(new MondayClient({ account: 'acme', board: 111, token: 'tok', fetch: none.fetch }).board(), /Client work has no status column/);
});

test('a monday.com group holds the board\'s query to it, and the place says the board\'s and group\'s names once they load', async () => {
  const { MondayClient } = await import('../src/trackers/monday.ts');
  const { fetch: f, calls } = fakeMonday(monBoardRoutes([{ cursor: null, items: [card('101', 'Escalate premium cases', 0)] }]));
  const mon = new MondayClient({ account: 'acme', board: 111, group: 'topics', token: 'tok', fetch: f });
  assert.equal(mon.place, 'monday.com · acme · board 111 · group topics');
  const b = await mon.board();
  assert.deepEqual([b.title, b.place, b.cards.map((c) => c.key)], ['Client work · This sprint', 'monday.com · acme · Client work · group This sprint', ['MON-101']]);
  const q = calls.find((c) => /items_page/.test(c.query))!;
  assert.match(q.query, /groups\(ids: \$group\) \{ items_page/);
  assert.deepEqual(q.variables.group, ['topics'], 'only the group\'s items are asked for');
  const gone = await new MondayClient({ account: 'acme', board: 111, group: 'old_group', token: 'tok', fetch: f }).board();
  assert.deepEqual([gone.cards.length, gone.notice], [0, 'The group old_group isn\'t on Client work any more, so no items show. Pick another with Change, above it.']);
});

const monPlaced = (id: string, board: [string, string], group: [string, string]) => ({ id, board: { id: board[0], name: board[1] }, group: { id: group[0], title: group[1] } });
const monItem = (id: string, extra: Record<string, unknown> = {}) => ({
  ...monPlaced(id, ['111', 'Client work'], ['topics', 'This sprint']), name: `Item ${id}`, state: 'active', url: `https://acme.monday.com/boards/111/pulses/${id}`,
  created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-04T00:00:00Z', creator: { id: 7, name: 'Jordan Kim' }, column_values: [], updates: [], subitems: [], parent_item: null, ...extra,
});

test('a monday.com item: its long-text columns are its description, its updates and their replies its comments, its sub-items related', async () => {
  const { MondayClient } = await import('../src/trackers/monday.ts');
  const items: Record<string, unknown> = {
    101: monItem('101', {
      name: 'Escalate premium cases',
      column_values: [
        { id: 'status', type: 'status', text: 'Working on it', column: { title: 'Status' }, index: 0, label: 'Working on it', is_done: false },
        { id: 'person', type: 'people', text: 'Pat Lee', column: { title: 'Owner' }, persons_and_teams: [{ id: 9, kind: 'person' }] },
        { id: 'long_text', type: 'long_text', text: 'Premium cases escalate.\n\nTier 2 owns them.\nWithin a day.', column: { title: 'Description' } },
        { id: 'notes', type: 'long_text', text: '  ', column: { title: 'Notes' } },
        { id: 'ac', type: 'long_text', text: '- A queue for them **now**', column: { title: 'Acceptance criteria' } },
      ],
      updates: [
        { id: 'u2', body: '<p>On <b>it</b></p>', created_at: '2026-09-02T00:00:00Z', creator: { id: 9, name: 'Pat Lee' }, replies: [{ id: 'r1', body: '<p>Thanks</p>', created_at: '2026-09-03T00:00:00Z', creator: { id: 7, name: 'Jordan Kim' } }] },
        { id: 'u1', body: '<p>First</p>', created_at: '2026-09-01T00:00:00Z', creator: { id: 7, name: 'Jordan Kim' }, replies: [] },
      ],
      subitems: [{ id: '201', name: 'Draft the runbook', url: 'https://acme.monday.com/boards/112/pulses/201' }],
    }),
    102: monItem('102', { updates: [{ id: 'u9', body: '<p>The <i>brief</i>, as an update</p>', created_at: '2026-09-01T00:00:00Z', creator: null }, { id: 'u10', body: '<p>Later</p>', created_at: '2026-09-05T00:00:00Z', creator: null }] }),
  };
  const { fetch: f, calls } = fakeMonday([
    [/items\(ids: \$ids\) \{ id board/, (v) => ({ items: (v.ids as string[]).map((id) => items[id]).filter(Boolean) })],
    [/users\(ids/, { users: [{ id: 9, name: 'Pat Lee' }] }],
  ]);
  const mon = new MondayClient({ account: 'acme', board: '111', token: 'tok', fetch: f });
  const t = await mon.ticket('mon-101');
  assert.deepEqual([t.key, t.kind, t.title, t.url, t.type, t.priority, t.labels], ['MON-101', 'monday', 'Escalate premium cases', 'https://acme.monday.com/boards/111/pulses/101', null, null, []]);
  assert.deepEqual([t.status, t.assignees, t.reporter], [{ id: '0', name: 'Working on it', category: 'doing' }, [{ id: '9', name: 'Pat Lee' }], { id: '7', name: 'Jordan Kim' }]);
  assert.deepEqual(t.body.blocks.map((b) => b.t), ['h', 'p', 'p', 'h', 'p'], 'each long-text column under its title, the empty one left out');
  assert.deepEqual(t.body.blocks[2], { t: 'p', c: [{ t: 'text', text: 'Tier 2 owns them.' }, { t: 'br' }, { t: 'text', text: 'Within a day.' }] }, 'plain text, its line breaks kept');
  assert.match(t.markdown, /^## Description\n\nPremium cases escalate\./);
  assert.match(t.markdown, /## Acceptance criteria\n\n.*A queue for them/, 'the brief has the acceptance criteria');
  assert.deepEqual(t.comments.map((c) => [c.id, c.author.name, c.url]), [
    ['u1', 'Jordan Kim', 'https://acme.monday.com/boards/111/pulses/101/posts/u1'], ['u2', 'Pat Lee', 'https://acme.monday.com/boards/111/pulses/101/posts/u2'], ['r1', 'Jordan Kim', 'https://acme.monday.com/boards/111/pulses/101/posts/r1'],
  ], 'oldest first, each update followed by its replies');
  assert.deepEqual(t.comments[1]!.body, { blocks: [{ t: 'p', c: [{ t: 'text', text: 'On ' }, { t: 'text', text: 'it', marks: ['strong'] }] }] });
  assert.deepEqual(t.related, [{ key: 'MON-201', title: 'Draft the runbook', relation: 'sub-item', url: 'https://acme.monday.com/boards/112/pulses/201', status: null, typeKind: null, typeColor: null }]);
  assert.deepEqual(calls[0]!.variables, { ids: ['101'] });

  const noText = await mon.ticket('MON-102');
  assert.deepEqual(noText.body, { blocks: [{ t: 'p', c: [{ t: 'text', text: 'The ' }, { t: 'text', text: 'brief', marks: ['em'] }, { t: 'text', text: ', as an update' }] }] }, 'no long text: its oldest update');
  assert.deepEqual([noText.status.name, noText.status.category, noText.comments.length, noText.comments[0]!.author.name], ['No status', 'todo', 2, 'Someone'], 'the update still shows as a comment');
  await assert.rejects(mon.ticket('MON-999'), (e: unknown) => e instanceof TrackerError && e.kind === 'not-found');
  assert.throws(() => mon.idOf('ACME-1'), /isn't a monday\.com item key \(MON-<id>\)/);
});

test('a monday.com item on another board, or in another group, is outside the place; a read that fails never counts', async () => {
  const { MondayClient } = await import('../src/trackers/monday.ts');
  const known: Record<string, unknown> = {
    301: monPlaced('301', ['999', 'Other client'], ['topics', 'Topics']),
    302: monPlaced('302', ['111', 'Client work'], ['backlog', 'Backlog']),
    101: monPlaced('101', ['111', 'Client work'], ['topics', 'This sprint']),
  };
  const full = (id: string) => ({ ...monItem(id), ...(known[id] as object) });
  const { fetch: f, calls } = fakeMonday([
    [/items\(ids: \$ids\) \{ id board \{ id name \} group \{ id title \} name/, (v) => ({ items: (v.ids as string[]).filter((id) => known[id]).map(full) })],
    [/items\(ids: \$ids, limit: \$limit\)/, (v) => {
      const ids = v.ids as string[];
      if (ids.includes('666')) return Response.json({ errors: [{ message: 'Internal error', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] });
      return { items: ids.filter((id) => known[id]).map((id) => known[id]) };
    }],
  ]);
  const whole = new MondayClient({ account: 'acme', board: 111, token: 'tok', fetch: f });
  await assert.rejects(whole.ticket('MON-301'), isOutside(/^MON-301 isn't one of this repo's tickets, which come from monday\.com · acme · board 111: it's on board Other client\.$/), 'item ids are the account\'s, so the board is checked');
  assert.equal((await whole.ticket('MON-302')).key, 'MON-302', 'no group: the whole board');
  const group = new MondayClient({ account: 'acme', board: 111, group: 'topics', token: 'tok', fetch: f });
  await assert.rejects(group.ticket('MON-302'), isOutside(/which come from monday\.com · acme · board 111 · group topics: it's in group Backlog\./));
  assert.equal((await group.ticket('MON-101')).key, 'MON-101');

  assert.deepEqual(await group.outside(['MON-301', 'MON-404', 'MON-302', 'MON-101', 'GH-1']), [{ key: 'MON-301', why: 'it\'s on board Other client' }, { key: 'MON-302', why: 'it\'s in group Backlog' }], 'one it can\'t see doesn\'t come back, and isn\'t outside');
  assert.deepEqual(await group.outside(['MON-302'], { project: true }), [], 'held to the board only, the group doesn\'t count');
  calls.length = 0;
  const many = Array.from({ length: 150 }, (_, i) => `MON-${5000 + i}`);
  assert.deepEqual(await group.outside([...many, 'MON-301']), [{ key: 'MON-301', why: 'it\'s on board Other client' }]);
  assert.deepEqual(calls.map((c) => (c.variables.ids as string[]).length), [100, 51], 'read a hundred at a time');
  assert.deepEqual(await group.outside(['MON-301', 'MON-666']), [], 'its batch couldn\'t be read: nothing in it is outside (D-048)');
});

test('monday.com writes: an update as HTML, a status label by its id, people on the People column, and never labels', async () => {
  const { MondayClient } = await import('../src/trackers/monday.ts');
  const { fetch: f, calls, mutations } = fakeMonday([
    [/columns\(types: \[status, people\]\)/, monMeta()],
    [/items\(ids: \$ids\) \{ column_values/, { items: [{ column_values: [{ id: 'status', index: 0 }] }] }],
    [/subscribers/, { boards: [{ subscribers: [{ id: 9, name: 'Pat Lee' }, { id: 7, name: 'Jordan Kim' }] }] }],
    [/^\s*mutation/, (v) => (v.body !== undefined ? { create_update: { id: 'u5' } } : { change_column_value: { id: v.item } })],
  ]);
  const mon = new MondayClient({ account: 'acme', board: 111, token: 'tok', fetch: f });
  await mon.comment('MON-101', 'Looks **good** if a < b & "you" agree');
  const posted = mutations().at(-1)!;
  assert.match(posted.query, /create_update\(item_id: \$item, body: \$body\)/);
  assert.deepEqual(posted.variables, { item: '101', body: '<p>Looks <b>good</b> if a &lt; b &amp; &quot;you&quot; agree</p>' }, 'the item and the text go as variables, every word escaped');
  assert.doesNotMatch(posted.query, /Looks|101/, 'nothing posted is in the query\'s text');
  await assert.rejects(mon.comment('MON-101', '  '), /empty/);

  const moves = await mon.transitions('MON-101');
  assert.deepEqual(moves.map((m) => [m.id, m.name, m.to.category]), [['3', 'Not started', 'doing'], ['2', 'Stuck', 'doing'], ['1', 'Done', 'done']], 'every label but where it is and switched-off ones');
  const done = { id: '1', name: 'Done', category: 'done' as const, statusIds: ['1'] };
  assert.deepEqual(movesInto(moves, done).map((m) => m.name), ['Done'], 'a card dragged to a column takes its label');
  await mon.transition('MON-101', moves[2]!);
  const moved = mutations().at(-1)!;
  assert.match(moved.query, /change_column_value\(board_id: \$board, item_id: \$item, column_id: \$column, value: \$value\)/);
  assert.deepEqual(moved.variables, { board: '111', item: '101', column: 'status', value: '{"index":1}' });

  assert.deepEqual((await mon.assignable('MON-101', 'pat')).map((p) => p.name), ['Pat Lee'], 'the board\'s people');
  await mon.assign('MON-101', [{ id: '9', name: 'Pat Lee' }]);
  assert.deepEqual(mutations().at(-1)!.variables, { board: '111', item: '101', column: 'person', value: '{"personsAndTeams":[{"id":9,"kind":"person"}]}' });
  const count = mutations().length;
  await assert.rejects(mon.labels(), (e: unknown) => e instanceof TrackerError && e.kind === 'refused' && e.message === 'monday.com items have no labels.');
  await assert.rejects(mon.setLabels(), /monday\.com items have no labels/);
  assert.equal(mutations().length, count, 'nothing was sent');

  const noPeople = fakeMonday([[/columns\(types: \[status, people\]\)/, monMeta([{ id: 'status', title: 'Status', type: 'status', settings: MON_STATUS }])]]);
  await assert.rejects(new MondayClient({ account: 'acme', board: 111, token: 'tok', fetch: noPeople.fetch }).assign('MON-101', []), /Client work has no People column, so there's no one to assign/);
  assert.equal(noPeople.mutations().length, 0);
  assert.equal(calls.filter((c) => /columns\(types/.test(c.query)).length, 1, 'the board\'s columns are read once between boards');
});

test('monday.com trouble is named: a refused token, a rate limit with its wait, and a refusal', async () => {
  const { MondayClient, mondayMe } = await import('../src/trackers/monday.ts');
  const answer = (r: Response) => fakeMonday([[/./, r]]).fetch;
  const me = (r: Response) => new MondayClient({ account: 'acme', board: 1, token: 'tok', fetch: answer(r) }).me();
  await assert.rejects(me(Response.json({ errors: [{ message: 'Not Authenticated' }] }, { status: 401 })), (e: unknown) => e instanceof TrackerError && e.kind === 'auth' && /Sign in again/.test(e.message));
  await assert.rejects(me(Response.json({ errors: [{ message: 'Complexity budget exhausted', extensions: { code: 'COMPLEXITY_BUDGET_EXHAUSTED', retry_in_seconds: 24.2 } }] }, { status: 429 })), /rate limit for this account was reached: it takes requests again in 25 seconds/);
  await assert.rejects(me(Response.json({ errors: [{ message: 'Rate Limit Exceeded' }] }, { status: 429, headers: { 'retry-after': '40' } })), /again in 40 seconds/);
  await assert.rejects(me(Response.json({ errors: [{ message: 'User unauthorized to perform action', extensions: { code: 'UserUnauthorizedException', status_code: 403 } }] })), (e: unknown) => e instanceof TrackerError && e.kind === 'refused' && /said no: User unauthorized/.test(e.message));
  await assert.rejects(me(new Response('<html>oops</html>', { status: 502 })), /answered HTTP 502/);
  assert.deepEqual(await mondayMe('tok', answer(Response.json({ data: { me: { id: 7, name: 'Jordan Kim', account: { slug: 'Acme' } } } }))), { id: '7', name: 'Jordan Kim', account: 'acme' });
});

// ---------------------------------------------------------------- a Jira board held to a sprint (T-78)

/** The routes every sprint board below shares: board 42's columns and the project's statuses. */
const sprintBoard = {
  'GET /rest/agile/1.0/board/42/configuration': { name: 'MSP board', columnConfig: { columns: [{ name: 'To Do', statuses: [{ id: '1' }] }] } },
  'GET /rest/api/3/project/MSP/statuses': [{ statuses: [jiraStatus('1', 'To Do', 'new')] }],
};
const SPRINT_12 = { id: 12, name: 'MSP Sprint 12', state: 'active', startDate: '2026-10-06T09:00:00.000Z', endDate: '2026-10-19T17:00:00.000Z' };

test('placeJql holds a Jira board to the active sprint, a named sprint, or a sprint in an epic (T-78)', () => {
  const at = (o: Partial<ConstructorParameters<typeof JiraClient>[0]>) => new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'e', token: 't', ...o });
  assert.equal(at({ sprint: 'active' }).placeJql(), 'project = "MSP" AND sprint in openSprints()', 'the active sprint, before the board says which');
  assert.equal(at({ sprint: 'active' }).placeJql([12, 13]), 'project = "MSP" AND sprint in (12, 13)', 'once the board says which, only its own open sprints');
  assert.equal(at({ sprint: 42 }).placeJql(), 'project = "MSP" AND sprint = 42', 'a named sprint');
  assert.equal(at({ sprint: 42, epics: ['msp-3'] }).placeJql(), 'project = "MSP" AND parent in (MSP-3) AND sprint = 42', 'a sprint with an epic: both hold');
  assert.equal(at({ sprint: 'active', epics: ['MSP-3'] }).placeJql([12]), 'project = "MSP" AND parent in (MSP-3) AND sprint in (12)');
  assert.equal(at({ sprint: null }).placeJql(), 'project = "MSP"', 'no sprint: the whole board');
  assert.throws(() => at({ sprint: 0 }).placeJql(), /isn't a Jira sprint's id/, 'a sprint id that isn\'t one is refused, never sent to Jira');
  assert.equal(at({ sprint: 'active' }).place, 'Jira · MSP · the active sprint', 'before the board loads');
  assert.equal(at({ sprint: 42, epics: ['MSP-3'] }).place, 'Jira · MSP · epic MSP-3 · sprint 42');
});

test('a Jira board in the active sprint shows only its tickets, and its place names the sprint and its dates (T-78)', async () => {
  const { fetch: f, calls } = fakeJira({
    ...sprintBoard,
    'GET /rest/agile/1.0/board/42/sprint?state=active': { values: [SPRINT_12] },
    'GET /rest/agile/1.0/board/42/issue?jql=': { total: 1, issues: [placed('MSP-4', { project: { key: 'MSP' } })] },
  });
  const b = await new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'e', token: 't', board: 42, sprint: 'active', fetch: f }).board();
  assert.deepEqual(b.cards.map((c) => c.key), ['MSP-4']);
  assert.equal(b.place, 'Jira · MSP · active sprint MSP Sprint 12 (6 Oct to 19 Oct)');
  assert.deepEqual(b.sprints, [{ id: 12, name: 'MSP Sprint 12', state: 'active', start: SPRINT_12.startDate, end: SPRINT_12.endDate }]);
  assert.equal(b.notice, null);
  assert.deepEqual(calls.filter((c) => c.path.includes('/issue?jql=')).map((c) => jql(c.path)), ['project = "MSP" AND sprint in (12)'], 'the board\'s own open sprint, by id');

  // An epic in a named sprint: the sub-tasks are held to the sprint too.
  const named = fakeJira({
    ...sprintBoard,
    'GET /rest/api/3/issue/MSP-3?fields=summary': { key: 'MSP-3', fields: { summary: 'Premium Support' } },
    'GET /rest/agile/1.0/sprint/12': SPRINT_12,
    'GET /rest/agile/1.0/board/42/issue?jql=': { total: 1, issues: [placed('MSP-4', { project: { key: 'MSP' }, parent: { key: 'MSP-3' } })] },
  });
  const e = await new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'e', token: 't', board: 42, epics: ['MSP-3'], sprint: 12, fetch: named.fetch }).board();
  assert.equal(e.place, 'Jira · MSP · epic MSP-3 Premium Support · sprint MSP Sprint 12 (6 Oct to 19 Oct)');
  assert.deepEqual(named.calls.filter((c) => c.path.includes('/issue?jql=')).map((c) => jql(c.path)), ['project = "MSP" AND parent in (MSP-3) AND sprint = 12', 'project = "MSP" AND parent in (MSP-4) AND sprint = 12']);
});

test('a Jira board following the active sprint with none open shows no cards and says there is no active sprint (T-78)', async () => {
  const { fetch: f, calls } = fakeJira({ ...sprintBoard, 'GET /rest/agile/1.0/board/42/sprint?state=active': { values: [] }, 'GET /rest/agile/1.0/board/42/issue?jql=': { total: 1, issues: [placed('MSP-4', { project: { key: 'MSP' } })] } });
  const b = await new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'e', token: 't', board: 42, sprint: 'active', fetch: f }).board();
  assert.deepEqual(b.cards, [], 'no cards, not the whole board');
  assert.equal(b.notice, NO_ACTIVE_SPRINT);
  assert.match(b.notice!, /no active sprint/);
  assert.equal(b.place, 'Jira · MSP · no active sprint');
  assert.deepEqual(b.sprints, []);
  assert.equal(calls.filter((c) => c.path.includes('/issue?jql=')).length, 0, 'it never asks for the issues');

  const missing = fakeJira({ ...sprintBoard });
  await assert.rejects(new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'e', token: 't', board: 42, sprint: 99, fetch: missing.fetch }).board(), /Sprint 99 isn't in Jira/, 'a named sprint Jira doesn\'t have says so');
});

test('a Jira ticket outside the sprint is outside the place, and stillOpen counts the ones not done (T-78)', async () => {
  const inSprint = `GET /rest/api/3/search/jql?jql=${encodeURIComponent('key = MSP-4 AND sprint in (12)')}`;
  const { fetch: f } = fakeJira({
    'GET /rest/agile/1.0/board/42/sprint?state=active': { values: [SPRINT_12] },
    [inSprint]: { issues: [{ key: 'MSP-4' }] },
    'GET /rest/api/3/search/jql?jql=': { issues: [] },
    'GET /rest/api/3/issue/MSP-4?fields=status': { key: 'MSP-4', fields: { status: jiraStatus('1', 'To Do', 'new') } },
    'GET /rest/api/3/issue/MSP-5?fields=status': { key: 'MSP-5', fields: { status: jiraStatus('10', 'Done', 'done') } },
    'GET /rest/api/3/issue/MSP-4?': placed('MSP-4', { project: { key: 'MSP' } }),
    'GET /rest/api/3/issue/MSP-5?': placed('MSP-5', { project: { key: 'MSP' } }),
    'GET /rest/api/3/issue/OPS-1?': placed('OPS-1', { project: { key: 'OPS' } }),
  });
  const jira = new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'e', token: 't', board: 42, sprint: 'active', fetch: f });
  assert.equal((await jira.ticket('MSP-4')).key, 'MSP-4', 'a ticket in the sprint');
  await assert.rejects(jira.ticket('MSP-5'), isOutside(/MSP-5 .*: it isn't in the active sprint\./), 'one outside it, such as back in the backlog');
  assert.deepEqual(await jira.outside(['MSP-4', 'MSP-5', 'OPS-1', 'MSP-404']), [{ key: 'MSP-5', why: 'it isn\'t in the active sprint' }, { key: 'OPS-1', why: 'it\'s in project OPS' }], 'one it can\'t read is never outside');
  assert.deepEqual(await jira.outside(['MSP-5'], { project: true }), [], 'held to the project only, the sprint doesn\'t count');
  assert.deepEqual(await jira.stillOpen(['MSP-4', 'MSP-5', 'MSP-404']), ['MSP-4'], 'a done one, and one it can\'t read, aren\'t counted');

  const none = fakeJira({ 'GET /rest/agile/1.0/board/42/sprint?state=active': { values: [] }, 'GET /rest/api/3/issue/MSP-4?': placed('MSP-4', { project: { key: 'MSP' } }) });
  const idle = new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'e', token: 't', board: 42, sprint: 'active', fetch: none.fetch });
  assert.deepEqual(await idle.outside(['MSP-4']), [{ key: 'MSP-4', why: 'its board has no active sprint' }], 'with no active sprint, every ticket is outside it');
});

test('Jira lists a board\'s open and future sprints for Connect, and a kanban board has none (T-78)', async () => {
  const { fetch: f } = fakeJira({ 'GET /rest/agile/1.0/board/42/sprint?state=active,future': { values: [{ id: 13, name: 'MSP Sprint 13', state: 'future' }, SPRINT_12] } });
  const sprints = await jiraSprints('acme.atlassian.net', 'MSP', 42, 'e', 't', f);
  assert.deepEqual(sprints?.map((s) => [s.id, s.state]), [[12, 'active'], [13, 'future']], 'the open one first');
  assert.deepEqual(jiraSprintOptions(sprints).map((o) => [o.value, o.label, o.detail]), [
    ['active', 'The active sprint', 'now MSP Sprint 12'], ['12', 'MSP Sprint 12', 'open, 6 Oct to 19 Oct'], ['13', 'MSP Sprint 13', 'future'],
  ]);
  assert.deepEqual(jiraSprintOptions([]).map((o) => [o.value, o.detail]), [['active', 'none open now']], 'a scrum board between sprints still offers the active one');
  const kanban = fakeJira({ 'GET /rest/agile/1.0/board?projectKeyOrId=MSP': { values: [{ id: 9, name: 'Kanban', type: 'kanban' }] } }, { 'GET /rest/agile/1.0/board/9/sprint': 400 });
  assert.equal(await jiraSprints('acme.atlassian.net', 'MSP', null, 'e', 't', kanban.fetch), null, 'no board picked: the project\'s first, which refuses sprints');
  assert.deepEqual(jiraSprintOptions(null), [], 'so only the whole board is offered');
});
