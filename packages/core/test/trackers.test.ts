import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type AdfNode, fromAdf, fromMarkdown, plainText, safeHref, toAdf } from '../src/trackers/doc.ts';
import { categoryOf, GithubClient } from '../src/trackers/github.ts';
import { JiraClient } from '../src/trackers/jira.ts';
import { type Exec, movesInto, TrackerError } from '../src/trackers/types.ts';

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
  assert.ok(calls.every((c) => c.quiet), 'with no update check and no prompt (D-???)');
});

test('GitHub without Projects access says how to grant it, instead of failing', async () => {
  const { exec } = fakeGh([
    ['api graphql', { code: 1, stderr: "error: your authentication token is missing required scopes [read:project]\nTo request it, run:  gh auth refresh -s read:project" }],
    ['issue list', '[]'],
  ]);
  const b = await new GithubClient({ repo: 'o/r', token: 't', account: 'me', exec }).board();
  assert.equal(b.source, 'github-state');
  assert.match(b.notice!, /give me access to Projects: gh auth refresh -s project/);
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
    'GET /rest/agile/1.0/board/42/issue?startAt=0': { total: 2, issues: [
      { key: 'MSP-1', fields: { summary: 'Login page', status: jiraStatus('4', 'In Review', 'indeterminate'), assignee: { accountId: 'a1', displayName: 'Pat Lee' }, issuetype: { name: 'Story' }, priority: { name: 'High' }, labels: ['ui'] } },
      { key: 'MSP-2', fields: { summary: 'Fix flow', status: jiraStatus('1', 'To Do', 'new'), assignee: null, issuetype: { name: 'Bug' }, priority: null, labels: [] } },
    ] },
  });
  const jira = new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'me@acme.co', token: 'tok', fetch: f });
  const b = await jira.board();
  assert.deepEqual(b.columns.map((c) => [c.name, c.category, c.statusIds]), [['To Do', 'todo', ['1']], ['In Progress', 'doing', ['3', '4']], ['Done', 'done', ['10']]]);
  assert.deepEqual(b.cards.map((c) => [c.key, c.status.name, c.type, c.priority, c.assignees[0]?.name ?? null]), [['MSP-1', 'In Review', 'Story', 'High', 'Pat Lee'], ['MSP-2', 'To Do', 'Bug', null, null]]);
  assert.equal(b.url, 'https://acme.atlassian.net/jira/software/projects/MSP/boards/42');
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
  assert.deepEqual(b.cards.map((c) => [c.key, c.status.id, c.status.name, c.priority]), [['AB-101', 'Code Review', 'Active', 'High (2)'], ['AB-102', 'New', 'New', 'Highest (1)']], 'two columns share Active; the board column decides');
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
  assert.deepEqual(t.related, [{ key: 'AV-90', title: 'Premium support', relation: 'parent', url: 'https://dev.azure.com/acme/CRM/_workitems/edit/90' }]);
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
