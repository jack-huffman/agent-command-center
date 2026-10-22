import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { GITHUB, GITHUB_ISSUES, githubProjectOptions, type SignIn } from '../src/trackers/connect.ts';
import { GITHUB_NO_PROJECT, githubBoard, GithubClient, type GithubProject, pickProject, projectsAccess } from '../src/trackers/github.ts';
import { type Exec, TrackerError } from '../src/trackers/types.ts';
import { GENERIC_CONFIG } from './support.ts';

// A GitHub tracker's Projects as the Connect page's cards (T-107), and a tracker that takes no Project.

/** A stand-in gh: answers by the first fixture whose text the call holds, and records each call. */
function gh(answers: [string, string | { code: number; stderr: string }][]): { exec: Exec; calls: string[] } {
  const calls: string[] = [];
  const exec: Exec = async (_cmd, args) => {
    const line = args.join(' ');
    calls.push(line);
    const hit = answers.find(([part]) => line.includes(part));
    if (!hit) return { code: 1, stdout: '', stderr: `no fixture for: gh ${line}` };
    return typeof hit[1] === 'string' ? { code: 0, stdout: hit[1], stderr: '' } : { code: hit[1].code, stdout: '', stderr: hit[1].stderr };
  };
  return { exec, calls };
}

const LIST = 'projectsV2(first: 50)';
const node = (number: number, title: string, items: number, o: { closed?: boolean; status?: boolean } = {}) => ({ number, title, closed: !!o.closed, items: { totalCount: items }, field: o.status === false ? null : { id: `F_${number}` } });
const listAnswer = (nodes: unknown[]) => JSON.stringify({ data: { repository: { projectsV2: { nodes } } } });
const SCOPE = { code: 1, stderr: 'error: your authentication token is missing required scopes [read:project]' };
const signIn: SignIn = { method: 'gh', fields: {}, header: null, gh: { account: 'jordan-kim', token: 'gho_x' } };
const ctx = (exec: Exec, values: Record<string, string | string[] | null> = {}) => ({ host: 'acme/service', signIn, values, exec });

test('the repo\'s Projects come with their title, number, item count, whether closed, and whether they have a Status field', async () => {
  const { exec, calls } = gh([[LIST, listAnswer([node(5, 'Renewals launch', 17), node(2, 'Ideas', 8, { status: false }), node(1, 'Old backlog', 120, { closed: true })])]]);
  const list = await new GithubClient({ repo: 'acme/service', token: 't', account: 'jordan-kim', exec }).projects();
  assert.deepEqual(list, [
    { number: 5, title: 'Renewals launch', items: 17, closed: false, status: true },
    { number: 2, title: 'Ideas', items: 8, closed: false, status: false },
    { number: 1, title: 'Old backlog', items: 120, closed: true, status: true },
  ] satisfies GithubProject[]);
  assert.match(calls[0]!, /-f owner=acme -f name=service/);
});

test('where gh can\'t read Projects, the list refuses with how to give access, as the Tasks tab says it; another failure stays its own', async () => {
  const refused = new GithubClient({ repo: 'acme/service', token: 't', account: 'jordan-kim', exec: gh([[LIST, SCOPE]]).exec }).projects();
  await assert.rejects(refused, (e) => e instanceof TrackerError && e.kind === 'scope' && e.message === projectsAccess('jordan-kim'));
  assert.match(projectsAccess('jordan-kim'), /^To use your GitHub Project's columns, give jordan-kim access to Projects\. .*gh auth switch -u jordan-kim, then gh auth refresh -h github\.com -s project/);
  const down = new GithubClient({ repo: 'acme/service', token: 't', account: 'jordan-kim', exec: gh([[LIST, { code: 1, stderr: 'HTTP 502: Bad Gateway' }]]).exec }).projects();
  await assert.rejects(down, (e) => e instanceof TrackerError && e.kind === 'other' && /502/.test(e.message));
});

test('the Project cards: Issues, open and closed first, each Project with a Status field, and the repo\'s first open one is its default', () => {
  const projects: GithubProject[] = [
    { number: 5, title: 'Renewals launch', items: 17, closed: false, status: true }, { number: 2, title: 'Ideas', items: 1, closed: false, status: false },
    { number: 3, title: 'Roadmap', items: 1, closed: false, status: true }, { number: 1, title: 'Old', items: 120, closed: true, status: true },
  ];
  assert.deepEqual(githubProjectOptions('jordan-kim', projects), [
    { value: GITHUB_NO_PROJECT, label: GITHUB_ISSUES, detail: 'No Project: the columns are Open and Closed.' },
    { value: '5', label: 'Renewals launch', detail: '#5 · 17 items', default: true },
    { value: '3', label: 'Roadmap', detail: '#3 · 1 item' },
    { value: '1', label: 'Old', detail: '#1 · 120 items · closed' },
  ], 'a Project with no Status field has no columns to give, so it isn\'t offered');
  assert.equal(GITHUB_ISSUES, 'Issues, open and closed');
  // Edge: no Project the board could use, so the issues are what it takes with none named.
  assert.deepEqual(githubProjectOptions('jordan-kim', [{ ...projects[3]! }]).map((o) => [o.value, o.default ?? false]), [[GITHUB_NO_PROJECT, true], ['1', false]], 'only a closed one: the issues are the default');
  assert.deepEqual(githubProjectOptions('jordan-kim', []), [{ value: GITHUB_NO_PROJECT, label: GITHUB_ISSUES, detail: 'No Project: the columns are Open and Closed.', default: true }]);
  // Edge: Projects can't be read: the issues' card says how to give access.
  assert.deepEqual(githubProjectOptions('jordan-kim', null), [{ value: GITHUB_NO_PROJECT, label: GITHUB_ISSUES, detail: projectsAccess('jordan-kim'), default: true }]);
});

test('the Connect page\'s Project list reads the Projects through gh, turns a refusal into the access card, and fails on anything else', async () => {
  const list = GITHUB.pickers.find((p) => p.key === 'board')!;
  assert.deepEqual([list.label, list.dependsOn, list.whole, list.multi, list.idValues], ['Project', [], undefined, undefined, true]);
  assert.deepEqual((await list.load(ctx(gh([[LIST, listAnswer([node(3, 'Roadmap', 4)])]]).exec))).map((o) => o.value), [GITHUB_NO_PROJECT, '3']);
  assert.deepEqual(await list.load(ctx(gh([[LIST, SCOPE]]).exec)), githubProjectOptions('jordan-kim', null), 'no access: one card, which says how');
  await assert.rejects(list.load(ctx(gh([[LIST, { code: 1, stderr: 'HTTP 502: Bad Gateway' }]]).exec)), /502/, 'another failure is the list\'s');
  assert.match(list.fallback!, /first open Project, or Open and Closed/);
});

test('choosing a Project sets the tracker\'s board, its default leaves it out, and no Project is "issues"', () => {
  const save = (board: string | null, defaults: string[] = []) => GITHUB.toConfig({ host: 'acme/service', values: { board, labels: null }, defaults, ownRepo: 'acme/service' }).board;
  assert.equal(save('3'), 3);
  assert.equal(save('5', ['board']), null, 'the repo\'s own first Project: the file leaves board out, and the board takes it');
  assert.equal(save(GITHUB_NO_PROJECT), GITHUB_NO_PROJECT);
  assert.equal(save(null), null, 'edge: nothing chosen yet writes nothing');
  assert.equal(save('Roadmap'), null, 'edge: a value that isn\'t a number is never written');
  const t = parseConfig({ ...JSON.parse(JSON.stringify(GENERIC_CONFIG)), trackers: [{ kind: 'github', board: 'issues' }, { kind: 'github', repo: 'acme/web', board: 3 }] }).config!.trackers;
  assert.deepEqual(t.map((x) => GITHUB.fromConfig(x, 'acme/service').values.board), [GITHUB_NO_PROJECT, '3']);
});

test('the preview follows the Project chosen: its columns, or Open and Closed with no notice for no Project', async () => {
  const project = { id: 'PVT_3', number: 3, title: 'Roadmap', url: 'https://github.com/orgs/acme/projects/3', closed: false, field: { id: 'F', options: [{ id: 'o1', name: 'Todo' }, { id: 'o2', name: 'Done' }] } };
  const items = JSON.stringify({ data: { node: { items: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } } } });
  const withProjects = () => gh([['projectsV2(first: 10)', listAnswer([{ ...project, id: 'PVT_1', number: 1, title: 'First' }, project])], ['query($id', items], ['issue list', '[]']]);
  const chosen = withProjects();
  const b = await (GITHUB.preview(ctx(chosen.exec, { board: '3', labels: null })) as GithubClient).board();
  assert.deepEqual([b.source, b.title, b.columns.map((c) => c.name)], ['github-project', 'Roadmap', ['Todo', 'Done']], 'Project 3, not the repo\'s first');
  const none = withProjects();
  const plain = await (GITHUB.preview(ctx(none.exec, { board: GITHUB_NO_PROJECT, labels: null })) as GithubClient).board();
  assert.deepEqual([plain.source, plain.columns.map((c) => c.name), plain.notice], ['github-state', ['Open', 'Closed'], null], 'chosen, so there\'s nothing to explain');
  assert.ok(!none.calls.some((c) => c.includes('projectsV2')), 'no Project is never asked for');
});

test('a tracker\'s board as the GitHub client takes it, and "issues" picks no Project even where the repo has one', () => {
  assert.deepEqual([githubBoard(3), githubBoard('issues'), githubBoard(null), githubBoard('Stories')], [3, GITHUB_NO_PROJECT, null, null]);
  const nodes = [{ id: 'P1', number: 1, closed: false, field: { id: 'F', options: [{ id: 'o', name: 'Todo' }] } }];
  assert.equal(pickProject(nodes, null)?.number, 1);
  assert.equal(pickProject(nodes, GITHUB_NO_PROJECT), null);
});

test('a GitHub tracker\'s board may be "issues"; anything else that isn\'t a Project number is refused, and on Jira "issues" is refused too', () => {
  const one = (t: Record<string, unknown>) => parseConfig({ ...JSON.parse(JSON.stringify(GENERIC_CONFIG)), trackers: [t] });
  assert.equal(one({ kind: 'github', board: 'issues' }).config!.trackers[0]!.board, 'issues');
  assert.match(one({ kind: 'github', board: 'Roadmap' }).errors.join('\n'), /"board" must be a GitHub Project number, or "issues" for no Project/);
  assert.match(one({ kind: 'jira', site: 's', project: 'K', board: 'issues' }).errors.join('\n'), /"board" must be a Jira board id/);
});
