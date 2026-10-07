import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { TaskRow } from '../src/logic.ts';
import type { Update } from '../../packages/core/src/updates.ts';
import { agentsModel, analysisLook, type BoardInput, cardActions, environmentsModel, homeModel, type HubLike, isFromWebview, needsYouCount, promotionPaths, setupModel, tasksModel, ticketModel, trackerBoard, VIEW_KINDS, worktreesModel, dropLanes, laneMove } from '../src/model.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const envs = [
  { name: 'Production', branch: 'production', type: 'production' as const, org: 'P', default: false, protected: true, promotesTo: [] },
  { name: 'Devbox', branch: 'devbox', type: 'developer' as const, org: 'A', default: true, protected: false, promotesTo: ['sandbox', 'production'] },
  { name: 'Sandbox', branch: 'sandbox', type: 'partial' as const, org: 'S', default: false, protected: false, promotesTo: ['production'] },
];
const row = (id: string, state: string, display: TaskRow['display'], url: string | null = null): TaskRow => ({ id, title: `Task ${id}`, state, display, environment: 'devbox', deps: display === 'todo' ? ['AV-1'] : [], source: { kind: 'jira', url } });

function hub(): HubLike {
  const project = {
    name: 'Acme', root: '/r', branch: 'devbox',
    config: { github: { repo: 'o/r', account: 'me' }, environments: envs, profile: 'salesforce' },
    worktrees: [
      { path: '/r', head: 'abc1234', branch: 'devbox', main: true, changed: 0, locked: false, prunable: false },
      { path: '/r.worktrees/AV-2', head: 'def5678', branch: 'task/AV-2-login', main: false, changed: 3, locked: false, prunable: false },
    ],
  };
  return {
    projects: [project],
    agents: [
      { cwd: '/r.worktrees/AV-2', kind: 'background', startedAt: 2, id: 'bg1', name: 'av-2', state: 'blocked', waitingFor: 'permission prompt' },
      { cwd: '/elsewhere', kind: 'interactive', startedAt: 1, sessionId: 'uuid', name: 'other', status: 'idle', pid: 9 },
    ],
    agentsError: null,
    taskRows: () => [row('AV-1', 'running', 'running'), row('AV-2', 'todo', 'todo', 'https://x/AV-2'), row('AV-3', 'blocked', 'blocked'), row('AV-4', 'done', 'done')],
    projectFor: (p: string) => (p.startsWith('/r') ? project : undefined),
  };
}

test('the board has a column for every status, left to right as a task goes, and each card has the right actions', () => {
  const m = tasksModel(hub());
  const cols = m.projects[0]!.columns;
  assert.deepEqual(cols.map((c) => c.group), ['todo', 'ready', 'running', 'needs-you', 'review', 'rework', 'blocked', 'done'], 'left to right as a task goes: To do first (D-068)');
  const card = (id: string) => cols.flatMap((c) => c.cards).find((c) => c.id === id)!;
  assert.deepEqual(card('AV-2').actions.map((a) => a.label), ['Analyze', 'Move', 'Block', 'Ticket', 'Details'], 'waiting on another task, it can still be analyzed');
  assert.deepEqual(card('AV-3').actions.map((a) => a.label), ['Move', 'Unblock', 'Details']);
  assert.deepEqual(card('AV-4').actions.map((a) => a.label), ['Move', 'Details'], 'done tasks can\'t be blocked');
  assert.deepEqual(card('AV-2').waitingOn, ['AV-1']);
  assert.deepEqual(card('AV-2').actions[0]!.ref, { project: '/r', task: 'AV-2' });
});

test('agents: this project first, needs-you on top, background sessions can be stopped', () => {
  const m = agentsModel(hub());
  assert.deepEqual(m.places.map((p) => p.label), ['Acme', 'Elsewhere on this machine']);
  const bg = m.places[0]!.agents[0]!;
  assert.equal(bg.look.label, 'Needs you: permission prompt');
  assert.equal(bg.where, 'AV-2');
  assert.equal(bg.background, true);
  assert.equal(m.places[1]!.agents[0]!.background, false, 'interactive sessions are managed where they run');
});

test('an agent is called by the name acc gave it on the Agents tab, the Overview and its page, though Claude Code lists another (D-087)', async () => {
  const { agentModel } = await import('../src/model.ts');
  const name = 'Acme · AV-1 Login page for the partner portal · builder 2';
  const review = 'Acme · AV-3 Lead routing · review';
  const h = hub();
  // A resumed builder Claude Code lists under a name of its own, waiting on you; a reviewer it lists without one.
  h.agents = [
    { cwd: '/r.worktrees/AV-1', kind: 'interactive', startedAt: 3, sessionId: 'sess-1', name: 'r-worktrees-5e', status: 'waiting', pid: 11 },
    { cwd: '/r.worktrees/AV-3', kind: 'interactive', startedAt: 2, sessionId: 'sess-r', status: 'busy', pid: 12 },
    { cwd: '/r', kind: 'background', startedAt: 1, id: 'bg9', sessionId: 'sess-9', name: 'AV-9', state: 'working', pid: 13 },
  ];
  const rows = h.taskRows('/r');
  h.taskRows = () => rows.map((r) => (r.id === 'AV-1' ? { ...r, title: 'Retitled since', run: { bgId: 'bg1', sessionId: 'sess-1', name } } : r.id === 'AV-3' ? { ...r, state: 'review', reviewing: { sessionId: 'sess-r', name: review } } : r));
  const names = agentsModel(h).places[0]!.agents.map((a) => a.name);
  assert.deepEqual(names, [name, review, 'AV-9'], 'by its recorded name; one from before names by Claude Code\'s');
  const page = agentModel({ hub: h, key: 'sess-1', seen: null, entries: [], readable: false, lastAt: null });
  assert.equal(page.name, name);
  assert.equal(page.task?.id, 'AV-1', 'its task, found by its session');
  assert.equal(agentModel({ hub: h, key: 'sess-r', seen: null, entries: [], readable: false, lastAt: null }).name, review);
  const m = homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  assert.ok(m.overview.attention.some((a) => a.title === name), 'the Overview names a waiting agent the same way');
  // A card shows its builder's name when its agent line is hovered.
  const card = tasksModel(h).projects[0]!.columns.flatMap((c) => c.cards).find((c) => c.id === 'AV-1')!;
  assert.equal(card.agentName, name);
});

/** The webview/context items VSCode would show for a row with these context keys, in menu order. */
function menuFor(webviewId: string, keys: Record<string, string | boolean>): string[] {
  const ctx: Record<string, string | boolean> = { webviewId, ...keys };
  const holds = (term: string): boolean => {
    const eq = /^(\w+) == '([^']*)'$/.exec(term);
    if (eq) return ctx[eq[1]!] === eq[2];
    if (term.startsWith('!')) return !ctx[term.slice(1)];
    assert.match(term, /^\w+$/, `a when-clause term this test can't read: ${term}`);
    return !!ctx[term];
  };
  return (manifest.contributes.menus['webview/context'] as { command: string; when: string; group: string }[])
    .filter((i) => i.when.split('&&').every((t) => holds(t.trim())))
    .sort((a, b) => a.group.localeCompare(b.group))
    .map((i) => i.command);
}

test('agent rows hide their actions behind one menu: Watch first, and background sessions also attach and stop', () => {
  assert.deepEqual(menuFor('acc.home', { webviewSection: 'agent', agentBackground: true }), ['acc.agent.watch', 'acc.agent.openInClaude', 'acc.agent.attach', 'acc.agent.openFolder', 'acc.agent.stop'], 'Stop sits alone at the bottom');
  assert.deepEqual(menuFor('acc.home', { webviewSection: 'agent', agentBackground: false }), ['acc.agent.watch', 'acc.agent.openInClaude', 'acc.agent.openFolder']);
});

test('the row menus are for the page the rows are on: the Command Center\'s own webview', () => {
  const panels = readFileSync(join(root, 'src', 'panels.ts'), 'utf8');
  const viewType = /createWebviewPanel\('([\w.]+)'/.exec(panels)?.[1];
  assert.equal(viewType, 'acc.home');
  for (const i of manifest.contributes.menus['webview/context'] as { command: string; when: string }[]) assert.match(i.when, new RegExp(`webviewId == '${viewType}'`), `${i.command} shows on the page`);
});

test('worktree rows hide their actions behind one menu, and the main checkout has no Remove', () => {
  assert.deepEqual(menuFor('acc.home', { webviewSection: 'worktree', worktreeLinked: true }), ['acc.worktree.open', 'acc.worktree.terminal', 'acc.worktree.reveal', 'acc.worktree.remove']);
  assert.deepEqual(menuFor('acc.home', { webviewSection: 'worktree', worktreeLinked: false }), ['acc.worktree.open', 'acc.worktree.terminal', 'acc.worktree.reveal']);
  assert.deepEqual(menuFor('acc.agent', { webviewSection: 'worktree', worktreeLinked: true }), [], 'not on an agent\'s own page');
});

test('row menus: every item is a declared command, and the rows set the keys the menus test', () => {
  const commands = new Set((manifest.contributes.commands as { command: string }[]).map((c) => c.command));
  const menu = manifest.contributes.menus['webview/context'] as { command: string; when: string }[];
  for (const i of menu) assert.ok(commands.has(i.command), `${i.command} is a declared command`);
  const src = readFileSync(join(root, 'webview', 'main.ts'), 'utf8');
  assert.ok(src.includes("withMenu(row, 'agent', { session: a.key }, { agentBackground: a.background })"));
  assert.ok(src.includes("withMenu(row, 'worktree', { project: p.root, worktree: w.path }, { worktreeLinked: !w.main })"));
  for (const section of new Set(menu.map((i) => /webviewSection == '(\w+)'/.exec(i.when)?.[1]))) assert.ok(src.includes(`withMenu(row, '${section}'`), `some row opens the ${section} menu`);
  assert.ok(src.includes("new MouseEvent('contextmenu'"), 'the caret opens the same menu');
  for (const [from, to] of [['function renderAgents', 'function renderWorktrees'], ['function renderWorktrees', 'function renderEnvironments']] as const) {
    assert.ok(!/\.actions\.map/.test(src.slice(src.indexOf(from), src.indexOf(to))), `no inline buttons left in ${from.slice(9)}`);
  }
});

test('worktrees show changes in words, and say which one is the main checkout', () => {
  const [main, linked] = worktreesModel(hub()).projects[0]!.worktrees;
  assert.equal(main!.state.label, 'Clean');
  assert.equal(linked!.state.label, '3 changed');
  assert.equal(linked!.state.tone, 'orange');
  assert.equal(main!.main, true);
  assert.equal(linked!.main, false);
});

test('environments draw every promotion path, including skipping QA (D-018)', () => {
  assert.deepEqual(promotionPaths(envs), [['devbox', 'sandbox', 'production'], ['devbox', 'production']]);
  const m = environmentsModel(hub()).projects[0]!;
  const devbox = m.envs.find((e) => e.branch === 'devbox')!;
  assert.deepEqual(devbox.badges, ['default', 'checked out']);
  assert.ok(!devbox.actions.some((a) => a.label === 'Compare'), 'no comparing a branch with itself');
  assert.deepEqual(m.envs.find((e) => e.branch === 'production')!.badges, ['protected']);
});

test('setup counts steps done, and offers fixes only where something is open', () => {
  const m = setupModel([
    { id: 'B0.repo', part: 'project', title: 'Repo', status: 'pass', detail: 'ok' },
    { id: 'B2.identity', part: 'project', title: 'Identity', status: 'fail', detail: 'wrong', fix: 'git config user.name x' },
    { id: 'B14.tickets', part: 'project', title: 'Tickets', status: 'fail', detail: 'Not signed in', fix: 'acc.trackers.signIn' },
    { id: 'A4.plugin', part: 'machine', title: 'Plugin', status: 'pass', detail: 'acc 0.35.0, for every Claude Code session.' },
  ], new Set());
  assert.equal(m.total, 4);
  assert.equal(m.done, 2);
  const steps = m.parts.flatMap((p) => p.steps);
  assert.deepEqual(steps.find((s) => s.id === 'B2.identity')!.actions.map((a) => a.label), ['Do it', 'Check']);
  const tickets = steps.find((s) => s.id === 'B14.tickets')!;
  assert.deepEqual(tickets.actions.map((a) => a.label), ['Do it', 'Check', 'Guide'], 'Do it runs Add a tracker or Sign in, in VSCode');
  assert.equal(tickets.fix, null, 'a VSCode command isn\'t shown as one to copy');
  assert.deepEqual(steps.find((s) => s.id === 'B0.repo')!.actions.map((a) => a.label), ['Check', 'Guide'], 'passing steps keep only Check and the guide')
  assert.deepEqual(steps.find((s) => s.id === 'A4.plugin')!.actions.map((a) => a.label), ['Check']);
});

test('setup shows the acc plugin under its own section, with Do it while it fails', () => {
  const add = 'claude plugin marketplace add https://github.com/jack-huffman/agent-command-center && claude plugin install acc@agent-command-center --scope user';
  const m = setupModel([
    { id: 'A2.gh-login', part: 'machine', title: 'Logged in to GitHub', status: 'pass', detail: 'ok' },
    { id: 'A4.plugin', part: 'machine', title: 'The acc plugin in Claude Code', status: 'fail', detail: 'acc isn\'t installed in Claude Code, and its marketplace isn\'t added.', fix: add },
  ], new Set());
  const machine = m.parts.find((p) => p.part === 'machine')!;
  assert.deepEqual(machine.sections.map((s) => [s.title, s.todo]), [['Accounts', 0], ['The acc plugin', 1]]);
  const a4 = machine.steps.find((s) => s.id === 'A4.plugin')!;
  assert.deepEqual(a4.actions.map((a) => a.label), ['Do it', 'Check']);
  assert.equal(a4.fix, add, 'the command is shown to copy');
  assert.deepEqual([a4.look.label, a4.look.tone], ['To do', 'orange']);
});

test('setup reads in the order things are set up, a section for each thing, whatever order the checks finished in (D-047)', () => {
  // B14 is re-checked first, as soon as projects load: it still comes after the repo's own steps.
  const item = (id: string, status: 'pass' | 'fail' | 'skip' | 'unknown' = 'pass') => ({ id, part: id.startsWith('A') ? 'machine' as const : 'project' as const, title: id, status, detail: 'd' });
  const m = setupModel([item('B14.tickets', 'unknown'), item('B2.account'), item('B0.config'), item('B0.repo'), item('B2.identity', 'fail'), item('B12.trust'), item('B13.gate-tools', 'skip'), item('A1.claude-billing'), item('A1.git'), item('A2.gh-login')], new Set());
  const project = m.parts.find((p) => p.part === 'project')!;
  assert.deepEqual(project.steps.map((s) => s.id), ['B0.repo', 'B0.config', 'B2.identity', 'B2.account', 'B12.trust', 'B13.gate-tools', 'B14.tickets']);
  assert.deepEqual(project.sections.map((s) => [s.title, s.todo, s.steps.length]), [['The repo', 0, 2], ['GitHub account', 1, 2], ['Background agents', 0, 2], ['Tickets', 1, 1]], 'neighbouring groups that set up one thing share a section');
  assert.deepEqual(m.parts.find((p) => p.part === 'machine')!.steps.map((s) => s.id), ['A1.git', 'A1.claude-billing', 'A2.gh-login'], 'a step this build doesn\'t know goes at the end of its group');
  assert.deepEqual(project.steps.map((s) => [s.look.label, s.done]), [['Done', true], ['Done', true], ['To do', false], ['Done', true], ['Done', true], ['Doesn\'t apply', true], ['Check by hand', false]]);
  assert.deepEqual([m.done, m.total], [8, 10]);
});

test('webview messages: only known shapes and acc commands get through', () => {
  assert.ok(isFromWebview({ type: 'ready' }));
  assert.ok(isFromWebview({ type: 'run', command: 'acc.task.move', ref: {} }));
  assert.ok(!isFromWebview({ type: 'run', command: 'workbench.action.terminal.sendSequence', ref: {} }));
  assert.ok(!isFromWebview({ type: 'eval', command: 'acc.x' }));
  assert.ok(!isFromWebview(null));
});

test('the tab page never turns data into markup, and runs under a strict nonce CSP', async () => {
  const src = readFileSync(join(root, 'webview', 'main.ts'), 'utf8');
  for (const bad of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval(', 'new Function']) assert.ok(!src.includes(bad), bad);
  const { htmlFor } = await import('../src/panels.ts').catch(() => ({ htmlFor: null as never }));
  void htmlFor; // panels.ts needs vscode; its HTML is checked in the activation test.
});

test('one page holds every section: the activity bar opens it, and each section has a command (D-029)', () => {
  const commands = new Set(manifest.contributes.commands.map((c: { command: string }) => c.command));
  assert.ok(commands.has('acc.open.home'));
  for (const k of VIEW_KINDS) assert.ok(commands.has(`acc.open.${k}`), k);
  assert.deepEqual(manifest.contributes.views.acc.map((v: { id: string }) => v.id), ['acc.home'], 'one launcher, no trees');
  assert.ok(manifest.contributes.viewsWelcome.some((w: { view: string; contents: string }) => w.view === 'acc.home' && w.contents.includes('command:acc.open.home')));
  assert.equal(manifest.contributes.configuration.properties['agentCommandCenter.openFromActivityBar'].default, true);
  assert.equal(manifest.contributes.menus['view/item/context'], undefined);
});

test('the Overview gathers what needs a person, counts it once, and groups review apart', () => {
  const steps = [
    { id: 'B0.repo', part: 'project' as const, title: 'Repo', status: 'pass' as const, detail: 'ok' },
    { id: 'B2.identity', part: 'project' as const, title: 'Commit identity', status: 'fail' as const, detail: 'wrong' },
  ];
  const h = hub();
  const m = homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: steps, confirmed: new Set() } });
  assert.equal(m.kind, 'home');
  const titles = m.overview.attention.map((a) => [a.look.tone, a.title]);
  assert.deepEqual(titles.map(([tone]) => tone), [...titles.map(([tone]) => tone)].sort((x, y) => (x === 'orange' ? 0 : 1) - (y === 'orange' ? 0 : 1)), 'orange first');
  assert.ok(m.overview.attention.some((a) => a.title === 'AV-3 Task AV-3' && a.look.label === 'Blocked'));
  assert.ok(m.overview.attention.some((a) => a.title === 'av-2' && a.actions[0]!.command === 'acc.agent.attach'), 'an agent waiting on a prompt, with Attach');
  assert.ok(m.overview.attention.some((a) => a.key === 'setup' && a.go?.section === 'setup'));
  const people = m.overview.attention.filter((a) => a.look.tone === 'orange').length;
  const nav = Object.fromEntries(m.nav.map((n) => [n.section, n]));
  assert.deepEqual([nav.overview!.count, nav.overview!.attention], [people, true], 'the rail and the inbox agree');
  assert.deepEqual([nav.setup!.count, nav.setup!.attention], [1, true]);
  assert.deepEqual(m.nav.map((n) => n.section), ['overview', 'tasks', 'agents', 'worktrees', 'environments', 'setup']);
  assert.equal(m.overview.stats.find((s) => s.section === 'setup')!.value, '1/2');
  // An agent already shown through its task isn't listed twice.
  const linked = { ...h, taskRows: () => [{ ...h.taskRows('/r')[1]!, display: 'needs-you' as const, run: { bgId: 'bg1' }, agent: { label: 'Needs you: permission prompt', icon: 'bell', tone: 'orange' as const } }] };
  const once = homeModel({ hub: linked, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  assert.deepEqual(once.overview.attention.map((a) => a.title), ['AV-2 Task AV-2']);
  assert.ok(isFromWebview({ type: 'nav', section: 'agents' }) && !isFromWebview({ type: 'nav', section: 'secrets' }));
});

test('cards follow a task through dispatch: Dispatch, then Watch, Attach and Abandon, then Clean up', () => {
  const labels = (r: Partial<TaskRow>) => cardActions({ ...row('AV-9', 'todo', 'ready'), deps: [], ...r } as TaskRow, {}).map((a) => a.label);
  assert.deepEqual(labels({}), ['Dispatch', 'Dispatch with…', 'Analyze', 'Move', 'Block', 'Details']);
  assert.deepEqual(labels({ state: 'running', display: 'running', run: { bgId: 'bg1', worktree: '/w/AV-9' } }), ['Watch', 'Open in Claude Code', 'Worktree', 'Instructions', 'Move', 'Abandon', 'Details']);
  assert.equal(cardActions({ ...row('AV-9', 'running', 'running'), deps: [], run: { bgId: 'bg1' } } as TaskRow, {})[0]!.primary, true, 'Watch is the main action while it runs');
  assert.deepEqual(labels({ state: 'review', display: 'review', run: { sessionId: 's1', worktree: '/w/AV-9' } }).slice(0, 2), ['Review', 'Watch'], 'in review: Review first, and what its builder did can still be read');
  assert.deepEqual(labels({ state: 'rework', display: 'rework', run: { worktree: '/w/AV-9' } }), ['Re-dispatch', 'Re-dispatch with…', 'Worktree', 'Instructions', 'Move', 'Block', 'Details']);
  assert.deepEqual(labels({ state: 'done', display: 'done', run: { worktree: '/w/AV-9' } }), ['Worktree', 'Instructions', 'Move', 'Clean up', 'Details']);
  assert.equal(cardActions({ ...row('AV-9', 'todo', 'ready'), deps: [] }, {})[0]!.primary, true, 'Dispatch is the main action on a ready card');
});

const ask = (id: string) => ({ id, question: `Question ${id}?`, why: 'It changes the build.', suggested: 'The usual.' });
const asks = { verdict: 'questions' as const, at: 't1', open: [ask('q1'), ask('q2')], split: [] };
const tooBig = { verdict: 'split' as const, at: 't1', open: [], split: ['One part', 'Another part', 'The rest'] };
const analysed = { verdict: 'ready' as const, at: 't1', open: [], split: [] };

test('before a build, a card offers its analysis first, and Dispatch once it\'s ready or none is wanted (D-052)', () => {
  const labels = (r: Partial<TaskRow>) => cardActions({ ...row('AV-9', 'todo', 'ready'), deps: [], ...r } as TaskRow, {}).map((a) => `${a.label}${a.primary ? '*' : ''}`);
  // Where the project wants an analysis first: Dispatch waits for a ready one, and the command line keeps the override.
  assert.deepEqual(labels({ analysisRequired: true }), ['Analyze*', 'Move', 'Block', 'Details']);
  assert.deepEqual(labels({ analysisRequired: true, analyzing: { sessionId: 's' } }), ['Watch the analysis*', 'Move', 'Block', 'Details']);
  assert.deepEqual(labels({ analysisRequired: true, display: 'needs-you', analysis: asks }), ['Answer*', 'Move', 'Block', 'Details']);
  assert.deepEqual(labels({ analysisRequired: true, display: 'needs-you', analysis: tooBig }), ['See the split*', 'Move', 'Block', 'Details']);
  assert.deepEqual(labels({ analysisRequired: true, analysis: analysed }), ['Dispatch*', 'Dispatch with…', 'Move', 'Block', 'Details']);
  assert.deepEqual(labels({ analysisRequired: true, deps: ['AV-1'], display: 'todo' }), ['Analyze*', 'Move', 'Block', 'Details'], 'waiting on another task: analyze it meanwhile');
  // Where it's optional: Dispatch stays, second to answering questions the analysis did ask.
  assert.deepEqual(labels({}), ['Dispatch*', 'Dispatch with…', 'Analyze', 'Move', 'Block', 'Details']);
  assert.deepEqual(labels({ display: 'needs-you', analysis: asks }), ['Answer*', 'Dispatch', 'Dispatch with…', 'Move', 'Block', 'Details']);
  assert.deepEqual(labels({ analysis: analysed }), ['Dispatch*', 'Dispatch with…', 'Move', 'Block', 'Details']);
  assert.deepEqual(labels({ analyzing: { sessionId: 's' } }), ['Watch the analysis*', 'Move', 'Block', 'Details'], 'not while it\'s being analyzed');
  assert.equal(labels({ state: 'rework', display: 'rework', analysisRequired: true })[0], 'Re-dispatch*', 'a rework already had its analysis');
  // Dragging to Running is dispatching, so it's held the same way.
  const lanes = (r: Partial<TaskRow>) => dropLanes({ state: 'todo', display: 'ready', deps: [], ...r });
  assert.ok(!lanes({ analysisRequired: true }).includes('running'), 'held until its analysis is ready');
  assert.ok(lanes({ analysisRequired: true, analysis: analysed }).includes('running'));
  assert.ok(lanes({ display: 'needs-you', analysis: asks }).includes('running'), 'optional: it can still go');
  // What the card says, in words and an icon, orange when it waits on you.
  assert.deepEqual(analysisLook({ state: 'todo', analysis: asks }), { label: 'Needs you: 2 questions from its analysis', icon: 'question', tone: 'orange' });
  assert.equal(analysisLook({ state: 'todo', analysis: { ...asks, open: [ask('q1')] } })!.label, 'Needs you: 1 question from its analysis');
  assert.deepEqual(analysisLook({ state: 'todo', analysis: tooBig }), { label: 'Needs you: too big for one task', icon: 'split-horizontal', tone: 'orange' });
  assert.deepEqual(analysisLook({ state: 'todo', analyzing: { sessionId: 's' } }), { label: 'Analyzing', icon: 'sync~spin', tone: 'blue' });
  assert.deepEqual(analysisLook({ state: 'todo', analysis: analysed }), { label: 'Analyzed: ready to build', icon: 'pass', tone: 'blue' });
  assert.equal(analysisLook({ state: 'running', analysis: asks }), null, 'once it\'s built, its agent speaks for it');
});

test('the Overview asks an analysis\'s questions in place, counts each task once, and lists what to analyze as ready (D-052)', () => {
  const rows: TaskRow[] = [
    { ...row('AV-5', 'todo', 'needs-you'), analysisRequired: true, analysis: asks },
    { ...row('AV-6', 'todo', 'needs-you'), analysisRequired: true, analysis: tooBig },
    { ...row('AV-7', 'todo', 'ready'), analysisRequired: true },
    { ...row('AV-8', 'todo', 'ready'), analysisRequired: true, analyzing: { sessionId: 's' } },
    { ...row('AV-9', 'todo', 'ready'), analysisRequired: true, analysis: analysed },
  ];
  const m = homeModel({ hub: { ...hub(), agents: [], taskRows: () => rows }, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const item = m.overview.attention.find((a) => a.title === 'AV-5 Task AV-5')!;
  assert.deepEqual([item.look.label, item.look.icon, item.look.tone], ['Needs you: 2 questions from its analysis', 'question', 'orange']);
  assert.deepEqual(item.analysis, { project: '/r', task: 'AV-5', questions: asks.open, canAsk: true }, 'its questions, to answer right there, or send to the client');
  assert.ok(!item.detail.includes('terminal'), 'not an agent waiting in its terminal');
  const split = m.overview.attention.find((a) => a.title === 'AV-6 Task AV-6')!;
  assert.deepEqual([split.look.label, split.analysis, split.detail], ['Needs you: too big for one task', undefined, 'Acme · its analysis suggests 3 smaller tasks, on its page']);
  assert.equal(m.overview.attention.length, 2, 'each task once');
  assert.equal(needsYouCount(m.overview), 2);
  assert.deepEqual([m.nav[0]!.count, m.nav[0]!.attention], [2, true], 'the rail, the badge and the status bar count the same');
  assert.deepEqual(m.overview.ready.map((r) => [r.id, r.action.label]), [['AV-7', 'Analyze'], ['AV-8', 'Watch the analysis'], ['AV-9', 'Dispatch']], 'a task held for its analysis stays in sight');
  const cards = tasksModel({ ...hub(), taskRows: () => rows }).projects[0]!.columns.find((c) => c.group === 'needs-you')!.cards;
  assert.deepEqual(cards.map((c) => [c.id, c.analysis?.label, c.actions[0]!.label]), [['AV-5', 'Needs you: 2 questions from its analysis', 'Answer'], ['AV-6', 'Needs you: too big for one task', 'See the split']]);
});

test('each update acc drafted waits in Needs you, orange with its icon, counted, to post, edit or discard; a question sent to the client says so (D-066)', () => {
  const draft = (id: string, extra: Partial<Update> = {}): Update => ({ v: 1, id, task: id.split('.')[0]!, tracker: 'jira', key: id.split('.')[0]!, url: null, event: 'pr-opened', text: 'The change is ready for review: https://github.com/o/r/pull/3\nLeads now keep their region.', state: 'draft', pr: { number: 3, url: 'https://github.com/o/r/pull/3' }, createdAt: '2026-10-05T12:00:00.000Z', by: 'acc land', ...extra });
  const updates = [draft('AV-1.1'), draft('AV-5.1', { event: 'question', question: 'q1', text: 'Before we start, a question for you:\nWhich?' }), draft('AV-3.1', { state: 'discarded' }), draft('AV-4.1', { state: 'posted' })];
  const rows: TaskRow[] = [row('AV-1', 'review', 'review'), { ...row('AV-5', 'todo', 'needs-you'), analysisRequired: true, analysis: asks }];
  const boards = (): BoardInput[] => [{ index: 0, kind: 'jira', title: 'Jira · AV', board: null, error: null, connect: null, loading: false, signedInAs: 'me@acme.example' }];
  // The project's Jira trackers, by project key: which one owns a ticket's key is who its update posts as.
  const withJira = (...projects: string[]) => {
    const base = hub();
    return { ...base, projects: [{ ...base.projects[0]!, config: { ...base.projects[0]!.config, trackers: projects.map((project) => ({ kind: 'jira' as const, project, prefix: null })) } }] };
  };
  const m = homeModel({ hub: { ...withJira('AV'), agents: [], taskRows: () => rows, updates: () => updates }, section: 'overview', boards, identity: () => null, setup: { items: [], confirmed: new Set() } });
  const items = m.overview.attention.filter((a) => a.update);
  assert.deepEqual(items.map((a) => [a.title, a.look.label, a.look.icon, a.look.tone, a.detail]), [
    ['Update ready for AV-1', 'Draft update', 'comment-draft', 'orange', 'Acme · Pull request #3 is ready for review'],
    ['Update ready for AV-5', 'Draft update', 'comment-draft', 'orange', 'Acme · A question from its analysis'],
  ], 'only drafts: not the discarded or the posted');
  assert.deepEqual([items[0]!.update!.text, items[0]!.update!.postAs], [updates[0]!.text, 'me@acme.example'], 'its text, and who Post sends it as');
  assert.deepEqual(items[0]!.actions.map((a) => [a.label, a.command, a.ref.task]), [['Edit', 'acc.task.show', 'AV-1']], 'Edit opens its task\'s page; Post and Discard are the page\'s own');
  assert.equal(needsYouCount(m.overview), 3, 'two updates and AV-5\'s questions, each counted');
  assert.deepEqual([m.nav[0]!.count, m.nav[0]!.attention], [3, true], 'and the rail and badge with them');
  const asked = m.overview.attention.find((a) => a.analysis)!.analysis!;
  assert.deepEqual(asked.questions.map((q) => [q.id, q.client]), [['q1', 'drafted'], ['q2', undefined]], 'q1 is drafted for the client; q2 can still be sent');

  // Not signed in: Post waits for the sign-in, which the row offers.
  const out = homeModel({ hub: { ...withJira('AV'), agents: [], taskRows: () => rows, updates: () => updates }, section: 'overview', boards: () => [{ ...boards()[0]!, signedInAs: null }], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const first = out.overview.attention.find((a) => a.update)!;
  assert.deepEqual([first.update!.blocked, first.extra?.label], ['Sign in to Jira first.', 'Sign in to Jira']);

  // Two Jira sites: each ticket's update posts as the sign-in of the site that owns its key, not the first.
  const sites = (): BoardInput[] => [{ ...boards()[0]!, title: 'Jira · OPS', signedInAs: 'ops@other.example' }, { ...boards()[0]!, index: 1, signedInAs: 'me@acme.example' }];
  const both = homeModel({ hub: { ...withJira('OPS', 'AV'), agents: [], taskRows: () => rows, updates: () => updates }, section: 'overview', boards: sites, identity: () => null, setup: { items: [], confirmed: new Set() } });
  assert.deepEqual(both.overview.attention.filter((a) => a.update).map((a) => a.update!.postAs), ['me@acme.example', 'me@acme.example'], 'AV-1 and AV-5 post through the AV site');
});

test('an update edited on its task\'s page shows that edit in Needs you, with Edit first and no Post of acc\'s text (GH-46)', () => {
  const draft = (id: string, extra: Partial<Update> = {}): Update => ({ v: 1, id, task: id.split('.')[0]!, tracker: 'github', key: '#9', url: null, event: 'merged', env: 'Dev', text: 'The change was approved and merged into Dev.', state: 'draft', createdAt: '2026-10-05T12:00:00.000Z', by: 'acc sync', ...extra });
  // AV-1's draft replaced two others; AV-2's is acc's own; AV-3's is being posted.
  const updates = [draft('AV-1.3', { replaces: ['AV-1.2', 'AV-1.1'] }), draft('AV-2.1'), draft('AV-3.1', { state: 'posting', posting: { at: new Date().toISOString(), by: 'human:me' } })];
  const held: Record<string, string> = { 'AV-1.1': 'Merged into Dev. Have a look in the sandbox.', 'AV-2.1': '  The change was approved and merged into Dev.  ', 'AV-3.1': 'Posting this one.' };
  const asked: [string, string, string[]][] = [];
  const edited = (root: string, id: string, replaces: string[]) => {
    asked.push([root, id, replaces]);
    for (const x of [id, ...replaces]) if (held[x] !== undefined) return held[x]!;
    return null;
  };
  const input = { hub: { ...hub(), agents: [], taskRows: () => [], updates: () => updates }, section: 'overview' as const, boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set<string>() } };
  const rows = homeModel({ ...input, edited }).overview.attention.filter((a) => a.update);
  assert.deepEqual(rows.map((a) => [a.update!.id, a.look.label, a.look.icon, a.look.tone, a.update!.edited, a.actions.map((x) => [x.label, !!x.primary])]), [
    ['AV-1.3', 'Edited on the task page', 'edit', 'orange', 'Merged into Dev. Have a look in the sandbox.', [['Edit', true]]],
    ['AV-2.1', 'Draft update', 'comment-draft', 'orange', null, [['Edit', false]]],
    ['AV-3.1', 'Posting', 'sync~spin', 'blue', null, [['Edit', false]]],
  ], 'the edit typed for a draft AV-1.3 replaced is its edit; text typed back to acc\'s isn\'t one; one being posted is past editing');
  assert.equal(rows[0]!.update!.text, updates[0]!.text, 'acc\'s own text stays on the card');
  assert.deepEqual(rows[0]!.update!.replaces, ['AV-1.2', 'AV-1.1']);
  assert.deepEqual(asked.map(([, id, replaces]) => [id, replaces]), [['AV-1.3', ['AV-1.2', 'AV-1.1']], ['AV-2.1', []]], 'it asks for drafts only, through the drafts each replaced');
  assert.equal(needsYouCount(homeModel({ ...input, edited }).overview), needsYouCount(homeModel(input).overview), 'an edited update needs you just the same');

  // A claim to post that may have gone out still warns so, though its page holds an edit.
  const stale = draft('AV-3.1', { state: 'posting', posting: { at: '2026-10-05T12:00:00.000Z', by: 'human:me' } });
  const warned = homeModel({ ...input, hub: { ...input.hub, updates: () => [stale] }, edited }).overview.attention.find((a) => a.update)!;
  assert.deepEqual([warned.look.label, warned.look.icon, warned.update!.edited, warned.actions[0]!.primary], ['May have posted', 'warning', 'Posting this one.', true]);

  // Without the task page, or once its edit is gone, the row is as acc drafted it.
  const plain = homeModel(input).overview.attention.filter((a) => a.update);
  assert.deepEqual(plain.map((a) => [a.look.label, a.update!.edited, a.actions[0]!.primary]), [['Draft update', null, undefined], ['Draft update', null, undefined], ['Posting', null, undefined]]);
});

test('in review, a card offers the one next step: watch the reviewer, land a passing review, then follow the pull request', () => {
  const first = (r: Partial<TaskRow>) => cardActions({ ...row('AV-9', 'review', 'review'), deps: [], run: { worktree: '/w', branch: 'b' }, ...r } as TaskRow, {}).find((a) => a.primary)!.label;
  assert.equal(first({}), 'Review');
  assert.equal(first({ reviewing: { sessionId: 's' } }), 'Watch the review');
  assert.equal(first({ review: { verdict: 'pass', summary: 's', current: true } }), 'Land');
  assert.equal(first({ review: { verdict: 'pass', summary: 's', current: false } }), 'Review', 'a review of an older commit doesn\'t count');
  assert.equal(first({ review: { verdict: 'changes', summary: 's', current: true } }), 'Review again');
  const open = cardActions({ ...row('AV-9', 'review', 'review'), deps: [], run: { worktree: '/w' }, review: { verdict: 'pass', summary: 's', current: true }, pr: { number: 42, url: 'u', state: 'open' } } as TaskRow, {}).map((a) => a.label);
  assert.deepEqual(open.slice(0, 2), ['Pull request #42', 'Update pull request']);
});

test('a pull request that conflicts with its base says so on its card and on the Overview, naming the files (D-049)', () => {
  const h = hub();
  const pr = (conflicts: string[]) => ({ number: 16, url: 'https://github.com/o/r/pull/16', state: 'open', ci: 'passing', changesRequested: false, conflicts });
  const rows = [
    { ...row('AV-5', 'review', 'needs-you'), pr: pr(['docs/DECISIONS.md', 'plugin/bin/acc']) },
    { ...row('AV-6', 'review', 'review'), pr: pr([]) },
    { ...row('AV-7', 'review', 'needs-you'), pr: pr(['force-app/main/default/layouts/Lead-Lead Layout.layout-meta.xml', 'b.ts', 'c.ts', 'd.ts']) },
  ];
  const conflicted = { ...h, taskRows: () => rows };
  const card = (id: string) => tasksModel(conflicted).projects[0]!.columns.flatMap((c) => c.cards).find((c) => c.id === id)!;
  assert.equal(card('AV-5').conflicts, 'Conflicts with devbox: docs/DECISIONS.md, bin/acc');
  assert.equal(card('AV-6').conflicts, null, 'a clean merge says nothing');
  assert.equal(card('AV-7').conflicts, 'Conflicts with devbox: layouts/Lead-Lead Layout.layout-meta.xml, b.ts, c.ts and 1 more', 'a card names the first few, by folder and name');
  assert.equal(tasksModel(conflicted).projects[0]!.columns.find((c) => c.group === 'needs-you')!.cards.length, 2);
  const m = homeModel({ hub: conflicted, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const item = m.overview.attention.find((a) => a.title === 'AV-5 Task AV-5')!;
  assert.deepEqual([item.look.label, item.look.icon, item.look.tone], ['Conflicts', 'git-pull-request', 'orange'], 'its words and icon, in orange');
  assert.equal(item.detail, 'Acme · pull request #16: it conflicts with devbox in docs/DECISIONS.md, bin/acc', 'by folder and name, as on the cards');
  assert.equal(item.tip, 'docs/DECISIONS.md\nplugin/bin/acc', 'every file in full, on hover');
  const many = m.overview.attention.find((a) => a.title === 'AV-7 Task AV-7')!;
  assert.equal(many.detail, 'Acme · pull request #16: it conflicts with devbox in layouts/Lead-Lead Layout.layout-meta.xml, b.ts, c.ts and 1 more');
  assert.equal(many.tip?.split('\n').length, 4);
  assert.equal(item.actions[0]!.command, 'acc.task.openPr');
});

test('checks that failed on GitHub say so on the card, the tracker\'s card and the task page, in orange with an icon, in review and after autopilot sent it back (D-076)', () => {
  const pr = { number: 16, url: 'https://github.com/o/r/pull/16', state: 'open', ci: 'failing', changesRequested: false, conflicts: [] };
  const rows: TaskRow[] = [
    { ...row('AV-5', 'review', 'needs-you'), run: { worktree: '/w5', branch: 'b5' }, review: { verdict: 'pass', summary: 's', current: true }, pr, checks: ['build', 'test'] },
    { ...row('AV-6', 'rework', 'rework'), run: { worktree: '/w6', branch: 'b6' }, pr, checks: ['build', 'test'] },
    // Re-dispatched: its builder is on it, so the card says it's running and nothing more.
    { ...row('AV-7', 'running', 'running'), run: { worktree: '/w7', branch: 'b7' }, pr, checks: null },
  ];
  const h = { ...hub(), agents: [], taskRows: () => rows };
  const card = (id: string) => tasksModel(h).projects[0]!.columns.flatMap((c) => c.cards).find((c) => c.id === id)!;
  assert.equal(card('AV-5').failedChecks, 'Checks failed on GitHub: build, test');
  assert.equal(card('AV-6').failedChecks, 'Checks failed on GitHub: build, test', 'in rework, the ones autopilot sent it back for');
  assert.equal(card('AV-7').failedChecks, null);
  assert.equal(card('AV-5').conflicts, null, 'its own line, apart from a conflict\'s');

  // The Overview's needs-you item names them.
  const m = homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const item = m.overview.attention.find((a) => a.title === 'AV-5 Task AV-5')!;
  assert.deepEqual([item.look.label, item.look.tone], ['Checks failing', 'orange']);
  assert.equal(item.detail, 'Acme · pull request #16: its checks are failing: build, test');

  const board: BoardInput = {
    index: 0, kind: 'jira', title: 'Jira', error: null, connect: null, loading: false,
    board: { source: 'jira-board', title: 'Board', url: null, notice: null, columns: [{ id: 'c', name: 'In Review', category: 'doing', statusIds: ['4'] }], cards: ['AV-5', 'AV-6', 'AV-7'].map((key) => ({ key, title: `Task ${key}`, url: 'u', status: { id: '4', name: 'In Review' }, type: 'Story', assignees: [], labels: [], priority: null })) },
  };
  const tracked = trackerBoard(board, rows, '/r').columns[0]!.cards.map((c) => [c.key, c.acc!.failedChecks]);
  assert.deepEqual(tracked, [['AV-5', 'Checks failed on GitHub: build, test'], ['AV-6', 'Checks failed on GitHub: build, test'], ['AV-7', null]], 'the tracker\'s card says it too');

  const task = { id: 'AV-6', title: 'Task AV-6', brief: '', source: { kind: 'jira', key: 'AV-6', url: null }, environment: 'devbox', deps: [], labels: [], state: 'rework', blocker: null, run: rows[1]!.run, pr,
    history: [{ at: '2026-10-06T09:00:00Z', from: 'review', to: 'rework', by: 'orchestrator:autopilot', reason: 'Checks failed on GitHub on abc1234: build, test.' }], createdAt: '', updatedAt: '' } as never;
  const page = ticketModel({ project: '/r', tracker: null, trackerTitle: null, trackerKind: null, key: 'AV-6', ticket: null, loading: false, error: null, connect: null, checks: [], row: rows[1]!, task });
  assert.equal(page.acc!.failedChecks, 'Checks failed on GitHub: build, test', 'and its page');

  // Drawn as a note, which is orange, with GitHub's checks icon beside the words.
  const main = readFileSync(join(root, 'webview', 'main.ts'), 'utf8');
  assert.match(main, /card\.failedChecks \? el\('div', 'card-note conflict', icon\('github-action'\)/);
  assert.match(main, /c\.acc\?\.failedChecks \? el\('div', 'card-note conflict tcard-conflict', icon\('github-action'\)/);
  assert.match(main, /icon\('github-action', 'orange'\)/);
  assert.match(readFileSync(join(root, 'webview', 'styles.css'), 'utf8'), /\.card-note \{[^}]*color: var\(--orange\)/);
});

test('a task autopilot couldn\'t move on says why on its card and on the Overview, with the step to take by hand (D-055)', () => {
  const rows: TaskRow[] = [
    { ...row('AV-5', 'review', 'needs-you'), run: { worktree: '/w', branch: 'b' }, review: { verdict: 'pass', summary: 's', current: true }, autopilot: { step: 'land', reason: 'git push refused task/AV-5: rejected' } },
    { ...row('AV-6', 'rework', 'needs-you'), run: { worktree: '/w6', branch: 'b6' }, autopilot: { step: 'dispatch', reason: 'Claude Code doesn\'t trust /r yet.' } },
  ];
  const failed = { ...hub(), agents: [], taskRows: () => rows };
  const card = (id: string) => tasksModel(failed).projects[0]!.columns.flatMap((c) => c.cards).find((c) => c.id === id)!;
  assert.deepEqual(card('AV-5').autopilot, { label: 'Needs you: autopilot couldn\'t land: git push refused task/AV-5: rejected', icon: 'bell', tone: 'orange' });
  assert.equal(card('AV-6').autopilot!.label, 'Needs you: autopilot couldn\'t re-dispatch: Claude Code doesn\'t trust /r yet.');
  assert.equal(card('AV-5').actions[0]!.label, 'Land', 'the step it couldn\'t take, to take by hand');
  const m = homeModel({ hub: failed, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const item = m.overview.attention.find((a) => a.title === 'AV-5 Task AV-5')!;
  assert.deepEqual([item.look.label, item.look.icon, item.look.tone], ['Needs you: autopilot couldn\'t land', 'bell', 'orange'], 'its words and icon, in orange');
  assert.equal(item.detail, 'Acme · git push refused task/AV-5: rejected. Do it by hand, or a new commit lets autopilot try again.', 'why, not an agent waiting in its terminal');
  assert.deepEqual(item.actions.map((a) => a.label), ['Land', 'Open']);
  assert.deepEqual(m.overview.attention.find((a) => a.title === 'AV-6 Task AV-6')!.actions.map((a) => a.label), ['Re-dispatch', 'Open']);
  assert.equal(needsYouCount(m.overview), 2);
});

test('a pull request autopilot couldn\'t update from its base says so in words, with the bell, in orange, and offers the pull request (D-058)', () => {
  const reason = 'Conflicts with devbox that autopilot can\'t resolve: force-app/main/default/classes/Sum.cls. The branch is as it was, at abc1234, and nothing was pushed.';
  const rows: TaskRow[] = [{
    ...row('AV-7', 'review', 'needs-you'), run: { worktree: '/w7', branch: 'b7' }, review: { verdict: 'pass', summary: 's', current: true },
    pr: { number: 18, url: 'https://github.com/o/r/pull/18', state: 'open', conflicts: ['force-app/main/default/classes/Sum.cls'] },
    autopilot: { step: 'refresh', reason },
  }];
  const failed = { ...hub(), agents: [], taskRows: () => rows };
  const card = tasksModel(failed).projects[0]!.columns.flatMap((c) => c.cards).find((c) => c.id === 'AV-7')!;
  assert.deepEqual(card.autopilot, { label: `Needs you: autopilot couldn't update from its base: ${reason}`, icon: 'bell', tone: 'orange' });
  const m = homeModel({ hub: failed, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const item = m.overview.attention.find((a) => a.title === 'AV-7 Task AV-7')!;
  assert.deepEqual([item.look.label, item.look.icon, item.look.tone], ['Needs you: autopilot couldn\'t update from its base', 'bell', 'orange']);
  assert.equal(item.detail, `Acme · ${reason} Do it by hand, or a new commit lets autopilot try again.`);
  assert.deepEqual(item.actions.map((a) => a.label), ['Pull request #18', 'Open'], 'the pull request, where a person resolves it');
});

test('a closed pull request in review says so in words, with its icon, in orange, on the card, the tracker\'s card and the Overview, and offers Land (D-063)', () => {
  const closed = { number: 16, url: 'https://github.com/o/r/pull/16', state: 'closed', ci: 'passing', changesRequested: false, conflicts: [] };
  const rows: TaskRow[] = [
    // Its builder's session is still around: the closed pull request is what needs you, not the agent.
    { ...row('AV-8', 'review', 'needs-you'), run: { worktree: '/w8', branch: 'b8', bgId: 'bg8' }, agent: { label: 'Idle', icon: 'circle-outline', tone: 'neutral' }, pr: closed, review: { verdict: 'pass', summary: 's', current: true } },
    { ...row('AV-9', 'review', 'needs-you'), run: { worktree: '/w9', branch: 'b9' }, pr: { ...closed, number: 17, url: 'https://github.com/o/r/pull/17' } },
    { ...row('AV-10', 'blocked', 'blocked'), pr: { ...closed, number: 18 } },
  ];
  const h = { ...hub(), agents: [], taskRows: () => rows };
  const look = { label: 'Needs you: pull request #16 was closed without merging', icon: 'git-pull-request-closed', tone: 'orange' };
  const cards = tasksModel(h).projects[0]!.columns;
  const card = (id: string) => cards.flatMap((c) => c.cards).find((c) => c.id === id)!;
  assert.deepEqual(card('AV-8').closedPr, look);
  assert.deepEqual(cards.find((c) => c.group === 'needs-you')!.cards.map((c) => c.id), ['AV-8', 'AV-9']);
  assert.equal(card('AV-8').actions[0]!.label, 'Land');
  assert.equal(card('AV-10').closedPr, null, 'blocked, as acc sync leaves it, it says blocked');

  const m = homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const item = m.overview.attention.find((a) => a.title === 'AV-8 Task AV-8')!;
  assert.deepEqual([item.look.label, item.look.icon, item.look.tone], ['Pull request closed', 'git-pull-request-closed', 'orange']);
  assert.equal(item.detail, 'Acme · pull request #16 was closed without merging. Land it to open a new one, or reopen it on GitHub and land to update it.');
  assert.doesNotMatch(item.detail, /terminal/, 'not an agent waiting in its terminal');
  assert.deepEqual(item.actions.map((a) => [a.label, !!a.primary]), [['Land', true], ['Pull request #16', false], ['Open', false]]);
  const unreviewed = m.overview.attention.find((a) => a.title === 'AV-9 Task AV-9')!;
  assert.deepEqual(unreviewed.actions.map((a) => a.label), ['Review', 'Pull request #17', 'Open'], 'nothing reviewed its latest commit yet');

  const board: BoardInput = {
    index: 0, kind: 'jira', title: 'Jira', error: null, connect: null, loading: false,
    board: { source: 'jira-board', title: 'Board', url: null, notice: null, columns: [{ id: 'c', name: 'In Review', category: 'doing', statusIds: ['4'] }], cards: [{ key: 'AV-8', title: 'Task AV-8', url: 'u', status: { id: '4', name: 'In Review' }, type: 'Story', assignees: [], labels: [], priority: null }] },
  };
  const tracked = trackerBoard(board, rows, '/r').columns[0]!.cards[0]!.acc!;
  assert.deepEqual([tracked.look, tracked.needsYou], [look, true], 'the tracker\'s card says the same');
});

test('a builder that stopped says so with what it last said, in orange with its icon, on the card, the tracker\'s card and the Overview, and offers Resume (D-067)', () => {
  const said = 'API Error: Your computer went to sleep mid-response. The response above may be incomplete.';
  const rows: TaskRow[] = [
    // Its old background session still says blocked: the stopped line says it all.
    { ...row('AV-5', 'running', 'needs-you'), run: { worktree: '/w5', branch: 'b5', bgId: 'bg5', sessionId: 'sess-5' }, agent: { label: 'Needs you', icon: 'bell', tone: 'orange' }, stopped: { said } },
    { ...row('AV-6', 'running', 'needs-you'), run: { worktree: '/w6', branch: 'b6', bgId: 'bg6', sessionId: 'sess-6' }, stopped: { said: `I stopped here. ${'x'.repeat(300)}` } },
    { ...row('AV-7', 'running', 'needs-you'), run: { worktree: '/w7', branch: 'b7', sessionId: 'sess-7' }, stopped: { said: null } },
    // Being resumed: no second Resume.
    { ...row('AV-11', 'running', 'running'), run: { worktree: '/w11', branch: 'b11', sessionId: 'sess-11' }, resuming: true, agent: { label: 'Resumed: working', icon: 'sync~spin', tone: 'blue' } },
  ];
  const h = { ...hub(), agents: [], taskRows: () => rows };
  const cards = tasksModel(h).projects[0]!.columns;
  const card = (id: string) => cards.flatMap((c) => c.cards).find((c) => c.id === id)!;
  assert.deepEqual(card('AV-5').stopped, { label: `Needs you: its agent stopped: ${said}`, icon: 'debug-disconnect', tone: 'orange' });
  assert.equal(card('AV-5').agent, null, 'not "Agent: Needs you" as well');
  assert.ok(card('AV-6').stopped!.label.length < 160 && card('AV-6').stopped!.label.endsWith('…'), 'a long quote is clipped on a card');
  assert.equal(card('AV-7').stopped!.label, 'Needs you: its agent stopped before acc done or acc block');
  assert.deepEqual(cards.find((c) => c.group === 'needs-you')!.cards.map((c) => c.id), ['AV-5', 'AV-6', 'AV-7']);
  // Its one next step is Resume (D-062); Watch and Open in Claude Code wait behind ⋯.
  const acts = card('AV-5').actions;
  assert.deepEqual([acts[0]!.command, acts[0]!.label, acts[0]!.icon, !!acts[0]!.primary], ['acc.task.resume', 'Resume', 'debug-continue', true]);
  assert.deepEqual(acts.filter((a) => a.primary).map((a) => a.command), ['acc.task.resume']);
  assert.ok(acts.some((a) => a.command === 'acc.task.watch') && acts.some((a) => a.command === 'acc.task.openInClaude'));
  assert.ok(!card('AV-11').actions.some((a) => a.command === 'acc.task.resume'));
  assert.equal(card('AV-11').stopped, null);

  const m = homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const item = m.overview.attention.find((a) => a.title === 'AV-5 Task AV-5')!;
  assert.deepEqual([item.look.label, item.look.icon, item.look.tone], ['Its agent stopped', 'debug-disconnect', 'orange']);
  assert.equal(item.detail, `Acme · ${said}`);
  assert.doesNotMatch(item.detail, /terminal/, 'not an agent waiting in its terminal');
  assert.deepEqual(item.actions.map((a) => [a.label, !!a.primary]), [['Resume', true], ['Watch', false], ['Open', false]]);
  assert.equal(m.overview.attention.find((a) => a.title === 'AV-7 Task AV-7')!.detail, 'Acme · its turn ended before acc done or acc block');
  assert.ok(needsYouCount(m.overview) >= 3, 'counted in the badge and the status bar');

  const board: BoardInput = {
    index: 0, kind: 'jira', title: 'Jira', error: null, connect: null, loading: false,
    board: { source: 'jira-board', title: 'Board', url: null, notice: null, columns: [{ id: 'c', name: 'Doing', category: 'doing', statusIds: ['3'] }], cards: [{ key: 'AV-5', title: 'Task AV-5', url: 'u', status: { id: '3', name: 'Doing' }, type: 'Story', assignees: [], labels: [], priority: null }] },
  };
  const tracked = trackerBoard(board, rows, '/r').columns[0]!.cards[0]!.acc!;
  assert.deepEqual([tracked.look.label, tracked.look.tone, tracked.needsYou, tracked.action?.command], [`Needs you: its agent stopped: ${said}`, 'orange', true, 'acc.task.resume']);
});

test('table cells keep table layout (a flex cell misaligns its row\'s lines)', () => {
  const css = readFileSync(join(root, 'webview', 'styles.css'), 'utf8');
  const src = readFileSync(join(root, 'webview', 'main.ts'), 'utf8');
  // Every class the page puts on a cell or row, so a bare `.actions` rule can't slip past by not naming td.
  const cellClasses = new Set([...src.matchAll(/el\('(?:td|th|tr)', '([^']*)'/g)].flatMap((m) => m[1]!.split(/\s+/)).concat('clip').filter(Boolean));
  // Comments and @media wrappers out, so rules inside a media query are checked too.
  for (const rule of css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const [selector, body] = [rule[1]!.trim(), rule[2]!];
    if (!/(^|;)\s*display\s*:(?!\s*none\b)/.test(body)) continue; // hiding a column is fine
    for (const sel of selector.split(',')) {
      const target = sel.trim().split(/[\s>+~]+/).pop()!; // the element the rule styles
      const tag = /^[a-z]+/.exec(target)?.[0];
      if (tag && !['td', 'th', 'tr'].includes(tag)) continue; // div.actions can't reach a cell
      const hits = tag ? [tag] : [...cellClasses].filter((c) => new RegExp(`\\.${c}(?![\\w-])`).test(target));
      assert.deepEqual(hits, [], `${sel.trim()} sets display on a table cell or row`);
    }
  }
});

test('tab icons are built from the sidebar icon, white for dark themes and dark grey for light ones', () => {
  const source = readFileSync(join(root, 'media', 'acc.svg'), 'utf8');
  assert.ok(source.includes('currentColor'), 'the sidebar icon follows the theme');
  for (const [theme, colour] of [['dark', '#ffffff'], ['light', '#424242']] as const) {
    const built = readFileSync(join(root, 'dist', 'media', `acc-${theme}.svg`), 'utf8');
    assert.equal(built, source.replaceAll('currentColor', colour), `${theme} tab icon`);
  }
  const panels = readFileSync(join(root, 'src', 'panels.ts'), 'utf8');
  assert.ok(panels.includes("panel.iconPath = { light: icon('light'), dark: icon('dark') }"));
  for (const theme of ['dark', 'light']) assert.ok(readFileSync(join(root, 'dist', 'webview', `acc-${theme}.svg`), 'utf8').includes('<svg'), `the page's ${theme} mark`);
});

test('a card can be dropped only in the lanes acc\'s rules let a person move it to, and Running means dispatching (D-041)', () => {
  const lanes = (state: string, display: string, deps: string[] = []) => dropLanes({ state, display, deps } as TaskRow);
  assert.deepEqual(lanes('todo', 'ready'), ['running', 'blocked'], 'a ready task: dispatch it, or block it');
  assert.deepEqual(lanes('running', 'running'), ['ready', 'review', 'blocked'], 'a running task: back to ready, review, or block');
  assert.deepEqual(lanes('running', 'running', ['T-2']), ['todo', 'review', 'blocked'], 'one that waits on another goes back to To do, where it will show');
  assert.deepEqual(lanes('review', 'review'), ['rework', 'blocked', 'done']);
  assert.deepEqual(lanes('blocked', 'blocked'), ['ready', 'review'], 'blocked work goes back, or on to review once its checks are settled');
  assert.deepEqual(lanes('rework', 'rework'), ['running', 'blocked']);
  assert.ok(!lanes('running', 'needs-you').includes('needs-you'), 'needs you is shown, never chosen');
  assert.deepEqual([laneMove('ready'), laneMove('running'), laneMove('needs-you')], ['todo', 'dispatch', null]);
  const card = tasksModel(hub()).projects[0]!.columns.flatMap((c) => c.cards)[0]!;
  assert.ok(Array.isArray(card.drops));
});

test('History tells each step autopilot took once, under Tasks, with its icon and words, in place of its moves (D-064)', () => {
  const h = hub();
  const at = (min: number) => new Date(Date.UTC(2026, 9, 5, 12, min)).toISOString();
  const later = (min: number, ms: number) => new Date(Date.parse(at(min)) + ms).toISOString();
  h.history = () => [
    { at: at(0), task: 'AV-1', title: 'Task AV-1', from: 'running', to: 'review', by: 'builder:AV-1' },
    // Autopilot's review asked for changes, and it re-dispatched: moves its steps tell.
    { at: later(1, 3), task: 'AV-1', title: 'Task AV-1', from: 'review', to: 'rework', by: 'reviewer:AV-1 for orchestrator:autopilot' },
    { at: later(2, 2), task: 'AV-1', title: 'Task AV-1', from: 'rework', to: 'running', by: 'orchestrator:autopilot' },
  ];
  h.autopilotLog = () => [
    { seq: 5, at: at(1), task: 'AV-1', step: 'review', outcome: 'done', verdict: 'changes', reason: 'No test for the login.' },
    { seq: 8, at: at(2), task: 'AV-1', step: 'dispatch', outcome: 'done' },
    { seq: 9, at: at(3), task: 'AV-3', step: 'land', outcome: 'done', pr: { number: 40, url: 'https://github.com/o/r/pull/40', opened: true } },
    { seq: 11, at: at(4), task: 'AV-3', step: 'land', outcome: 'failed', reason: 'The push was refused.' },
  ];
  // Two folders of one repo share its steps: each is told once.
  h.projects = [h.projects[0]!, { ...h.projects[0]!, root: '/r.worktrees/AV-2' }];
  const items = homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } }).overview.history;
  const steps = items.filter((i) => i.kind === 'autopilot');
  assert.deepEqual(steps.map((i) => i.kind === 'autopilot' && [i.task, i.look.icon, i.look.label, i.look.tone, i.detail, i.url]), [
    ['AV-3', 'warning', 'Autopilot couldn\'t land', 'orange', 'The push was refused.', null],
    ['AV-3', 'git-pull-request', 'Autopilot landed it: pull request #40', 'blue', null, 'https://github.com/o/r/pull/40'],
    ['AV-1', 'debug-restart', 'Autopilot re-dispatched it for the review\'s changes', 'blue', null, null],
    ['AV-1', 'request-changes', 'Autopilot\'s review asked for changes', 'neutral', 'No test for the login.', null],
  ], 'newest first, with its task\'s title');
  assert.equal(steps[0]!.kind === 'autopilot' && steps[0]!.title, 'Task AV-3');
  const moves = items.filter((i) => i.kind === 'move');
  assert.deepEqual(moves.map((i) => i.kind === 'move' && `${i.from}→${i.to}`), ['running→review', 'running→review'], 'autopilot\'s moves aren\'t listed twice; a builder\'s still are');
  // Tasks is the filter they count under: the page has four filters, not five.
  assert.match(readFileSync(join(root, 'webview', 'main.ts'), 'utf8'), /const historyKind = \(i: HistoryItem\): string => \(i\.kind === 'autopilot' \? 'move' : i\.kind\);/);
});

test('How agents run shows the project\'s autonomy, where it\'s set, and a way to change it (D-064)', () => {
  const h = hub();
  const p = h.projects[0]!;
  p.agents = {
    builder: { model: null, effort: null, fallbackModel: null, from: { model: 'default', effort: 'default', fallbackModel: 'default' } },
    reviewer: { model: null, effort: null, fallbackModel: null, from: { model: 'default', effort: 'default', fallbackModel: 'default' } },
  };
  p.config = { ...p.config, autonomy: 'review' };
  const s = agentsModel(h).settings[0]!;
  assert.deepEqual(s.autonomy, { value: 'review', from: 'project', meaning: 'Autopilot reviews finished work, lands work whose review passed, re-dispatches a rework once, sends a pull request whose GitHub checks fail back to its builder once a commit, resumes a stopped builder once a run, and merges the base into a pull request that conflicts with it. It never merges a pull request.' });
  p.config = { ...p.config, autonomy: 'manual' };
  assert.deepEqual(agentsModel(h).settings[0]!.autonomy, { value: 'manual', from: 'project', meaning: 'Nothing happens on its own.' });
  // The page asks acc to change it: the webview never writes the config.
  const page = readFileSync(join(root, 'webview', 'main.ts'), 'utf8');
  assert.match(page, /argButton\('acc\.agents\.autonomy', 'Change…', 'edit', s\.root\)/);
  assert.match(readFileSync(join(root, 'src', 'panels.ts'), 'utf8'), /'acc\.agents\.autonomy'/, 'the page may ask for it');
  assert.ok(manifest.contributes.commands.some((c: { command: string }) => c.command === 'acc.agents.autonomy'));
  assert.match(readFileSync(join(root, 'src', 'sidebar.ts'), 'utf8'), /this\.runAcc\(project, \['agents', 'autonomy', pick\.value\]/);
});

test('How agents run has an Auto-merge row: on or off, what it means, and Change… through acc; the autonomy row says when autopilot merges (GH-67)', () => {
  const h = hub();
  const p = h.projects[0]!;
  p.agents = {
    builder: { model: null, effort: null, fallbackModel: null, from: { model: 'default', effort: 'default', fallbackModel: 'default' } },
    reviewer: { model: null, effort: null, fallbackModel: null, from: { model: 'default', effort: 'default', fallbackModel: 'default' } },
  };
  p.config = { ...p.config, profile: 'generic', autonomy: 'review' };
  assert.deepEqual(agentsModel(h).settings[0]!.autoMerge, { value: 'off', from: 'project', meaning: 'Autopilot never merges a pull request: a person merges each one.', settable: true });
  // Its environments include Production, which is protected.
  assert.ok(p.config.environments.some((e) => e.name === 'Production' && e.protected));
  p.config = { ...p.config, autopilot: { autoMerge: true } };
  const s = agentsModel(h).settings[0]!;
  assert.deepEqual(s.autoMerge, { value: 'on', from: 'project', settable: true, meaning: 'Autopilot merges a pull request once its review and checks passed, it\'s up to date with its base, GitHub says it can merge and nothing waits on you, one a pass. Never into Production: protected.' });
  assert.match(s.autonomy!.meaning, /Auto-merge is on: it also merges a pull request whose review and checks passed, .* It never merges into a protected environment\.$/);
  assert.doesNotMatch(s.autonomy!.meaning, /It never merges a pull request/);
  p.config = { ...p.config, autonomy: 'manual' };
  assert.match(agentsModel(h).settings[0]!.autoMerge!.meaning, /Autonomy is manual, so nothing merges on its own\.$/);
  // A Salesforce project never auto-merges, so there's nothing to change.
  p.config = { ...p.config, profile: 'salesforce' };
  assert.deepEqual(agentsModel(h).settings[0]!.autoMerge, { value: 'off', from: 'project', meaning: 'A Salesforce project never auto-merges: a person merges every pull request.', settable: false });

  // The page asks acc to change it, with an icon beside the words; the webview never writes the config.
  const page = readFileSync(join(root, 'webview', 'main.ts'), 'utf8');
  assert.match(page, /icon\(s\.autoMerge\.value === 'on' \? 'git-merge' : 'circle-slash'\), el\('span', 'strong', 'Auto-merge'\)/);
  assert.match(page, /s\.autoMerge\.settable \? argButton\('acc\.agents\.autoMerge', 'Change…', 'edit', s\.root\)/);
  assert.match(readFileSync(join(root, 'src', 'panels.ts'), 'utf8'), /'acc\.agents\.autoMerge'/, 'the page may ask for it');
  assert.ok(manifest.contributes.commands.some((c: { command: string }) => c.command === 'acc.agents.autoMerge'));
  const sidebar = readFileSync(join(root, 'src', 'sidebar.ts'), 'utf8');
  assert.match(sidebar, /this\.runAcc\(project, \['agents', 'auto-merge', pick\.value\]/);
  // The status bar's menu says on or off for each repo, with an icon, and opens the Agents section.
  const ext = readFileSync(join(root, 'src', 'extension.ts'), 'utf8');
  assert.match(ext, /autopilot\.mergeLooks\(\)\.map/);
  assert.match(ext, /m\.on \? '\$\(git-merge\) Auto-merge: on' : '\$\(circle-slash\) Auto-merge: off'/);
  assert.match(ext, /go: \(\) => panels\.show\('agents'\)/);
});

test('History tells a pull request autopilot merged, with its link (GH-67)', () => {
  const h = hub();
  h.autopilotLog = () => [{ seq: 12, at: new Date(Date.UTC(2026, 9, 6, 12)).toISOString(), task: 'AV-3', step: 'merge', outcome: 'done', pr: { number: 40, url: 'https://github.com/o/r/pull/40', opened: false } }];
  const items = homeModel({ hub: h, section: 'overview', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } }).overview.history;
  const merged = items.filter((i) => i.kind === 'autopilot').map((i) => i.kind === 'autopilot' && [i.task, i.look.icon, i.look.label, i.look.tone, i.detail, i.url]);
  assert.deepEqual(merged, [['AV-3', 'git-merge', 'Autopilot merged pull request #40', 'blue', 'acc sync moves it to done.', 'https://github.com/o/r/pull/40']]);
});

test('Dispatch with… sits behind ⋯ wherever Dispatch is offered, and on the task page, and the pages may ask for it (D-086)', () => {
  const actions = (r: Partial<TaskRow>) => cardActions({ ...row('AV-9', 'todo', 'ready'), deps: [], ...r } as TaskRow, { project: '/r', task: 'AV-9' });
  const withIt = actions({}).find((a) => a.command === 'acc.task.dispatchWith')!;
  assert.deepEqual([withIt.label, withIt.icon, !!withIt.primary], ['Dispatch with…', 'sparkle', false], 'never the next step, so it sits behind ⋯');
  assert.equal(actions({ state: 'rework', display: 'rework' }).find((a) => a.command === 'acc.task.dispatchWith')!.label, 'Re-dispatch with…');
  for (const r of [{ state: 'running', display: 'running' as const, run: { bgId: 'bg1' } }, { state: 'review', display: 'review' as const }, { analysisRequired: true }, { analyzing: { sessionId: 's' } }]) {
    assert.ok(!actions(r).some((a) => a.command === 'acc.task.dispatchWith'), `only where Dispatch is: ${JSON.stringify(r)}`);
  }
  const task = { id: 'AV-9', title: 'Task AV-9', brief: '', source: { kind: 'jira', key: 'AV-9', url: null }, environment: 'devbox', deps: [], labels: [], state: 'todo', blocker: null, history: [], createdAt: '', updatedAt: '' } as never;
  const page = ticketModel({ project: '/r', tracker: null, trackerTitle: null, trackerKind: null, key: 'AV-9', ticket: null, loading: false, error: null, connect: null, checks: [], row: { ...row('AV-9', 'todo', 'ready'), deps: [] }, task });
  assert.deepEqual(page.acc!.actions.slice(0, 2).map((a) => a.command), ['acc.task.dispatch', 'acc.task.dispatchWith'], 'the task page offers it beside Dispatch');
  assert.match(readFileSync(join(root, 'src', 'panels.ts'), 'utf8'), /'acc\.task\.dispatchWith'/);
  assert.match(readFileSync(join(root, 'src', 'ticket.ts'), 'utf8'), /'acc\.task\.dispatchWith'/);
  assert.ok(manifest.contributes.commands.some((c: { command: string }) => c.command === 'acc.task.dispatchWith'));
  assert.match(readFileSync(join(root, 'src', 'sidebar.ts'), 'utf8'), /reg\('acc\.task\.dispatchWith'/);
});

test('a running card, its task page and its Agents row name the model its agent runs with, in plain text (D-086)', () => {
  const h = hub();
  const running: TaskRow = { ...row('AV-1', 'running', 'running'), run: { bgId: 'bg1', model: 'claude-sonnet-5-5', modelPicked: true }, agent: { label: 'Working', icon: 'sync~spin', tone: 'blue' }, model: 'claude-sonnet-5-5' };
  const stopped: TaskRow = { ...row('AV-3', 'running', 'needs-you'), run: { sessionId: 's3', model: 'claude-opus-5-5' }, stopped: { said: null }, agent: { label: 'Stopped', icon: 'debug-pause', tone: 'orange' }, model: 'claude-opus-5-5' };
  h.taskRows = () => [running, stopped, { ...row('AV-2', 'todo', 'ready'), deps: [] }];
  const cards = tasksModel(h).projects[0]!.columns.flatMap((c) => c.cards);
  assert.equal(cards.find((c) => c.id === 'AV-1')!.model, 'claude-sonnet-5-5');
  assert.equal(cards.find((c) => c.id === 'AV-3')!.model, null, 'a stopped builder\'s line says it all');
  assert.equal(cards.find((c) => c.id === 'AV-2')!.model, null, 'no agent, no model');
  const task = { id: 'AV-1', title: 'Task AV-1', brief: '', source: { kind: 'jira', key: 'AV-1', url: null }, environment: 'devbox', deps: [], labels: [], state: 'running', blocker: null, run: running.run, history: [], createdAt: '', updatedAt: '' } as never;
  const page = ticketModel({ project: '/r', tracker: null, trackerTitle: null, trackerKind: null, key: 'AV-1', ticket: null, loading: false, error: null, connect: null, checks: [], row: running, task });
  assert.equal(page.acc!.model, 'claude-sonnet-5-5');
  // The Agents tab asks the hub, which reads the transcript, then what acc started it with.
  h.modelFor = (s) => (s.id === 'bg1' ? 'claude-sonnet-5-5' : null);
  const rows = agentsModel(h).places.flatMap((p) => p.agents);
  assert.deepEqual(rows.map((r) => [r.name, r.model]), [['av-2', 'claude-sonnet-5-5'], ['other', null]]);
  const main = readFileSync(join(root, 'webview', 'main.ts'), 'utf8');
  assert.match(main, /\['Model', 'model'\]/, 'a Model column');
  assert.match(main, /el\('td', 'nowrap mono muted model', a\.model \? shortModel\(a\.model\) : '—'\), \{ title: a\.model/, 'a dash until it\'s known, in neutral mono text, its full name on hover');
  assert.match(main, /card\.agent && card\.model \? el\('div', 'card-where card-model'/);
  assert.match(main, /field\('Model', el\('span', 'mono', a\.model\)\)/);
});

test('How agents run names acc\'s default model, apart from Claude Code\'s default effort (D-086)', () => {
  const h = hub();
  h.projects[0]!.agents = {
    builder: { model: 'claude-opus-5-5', effort: null, fallbackModel: null, from: { model: 'acc', effort: 'default', fallbackModel: 'default' } },
    reviewer: { model: 'claude-sonnet-5-5', effort: 'high', fallbackModel: null, from: { model: 'clone', effort: 'project', fallbackModel: 'default' } },
  };
  const [builder, reviewer] = agentsModel(h).settings[0]!.roles;
  assert.deepEqual(builder!.parts, [{ name: 'Model', value: 'claude-opus-5-5', from: 'acc\'s default' }, { name: 'Effort', value: 'default', from: 'Claude Code\'s default' }]);
  assert.deepEqual(reviewer!.parts.map((p) => p.from), ['this clone', 'project default']);
});

test('a board says who it\'s signed in as, and whether every project on the site shares that sign-in (GH-79)', () => {
  const board = (b: Partial<BoardInput>): BoardInput => ({ index: 0, kind: 'jira', title: 'Jira · ACME', board: null, error: null, connect: null, loading: false, ...b });
  const shared = trackerBoard(board({ signedInAs: 'jordan@acme.example', signInScope: { shared: true, host: 'acme.atlassian.net' } }), [], '/r');
  assert.deepEqual(shared.signIn, { label: 'Signed in as jordan@acme.example, for every project on acme.atlassian.net', icon: 'globe', tone: 'blue' });
  const own = trackerBoard(board({ signedInAs: 'jordan@acme.example', signInScope: { shared: false, host: 'acme.atlassian.net' } }), [], '/r');
  assert.deepEqual(own.signIn, { label: 'Signed in as jordan@acme.example, for this project only', icon: 'repo', tone: 'blue' });
  assert.equal(trackerBoard(board({ signedInAs: null, signInScope: null }), [], '/r').signIn, null, 'not signed in: its error says so');
  const gh = trackerBoard(board({ kind: 'github', title: 'GitHub · acme/service', signedInAs: 'jordan-kim', signInScope: null }), [], '/r');
  assert.deepEqual([gh.signIn, gh.signedInAs], [null, 'jordan-kim'], 'GitHub signs in through gh as the repo\'s account (D-007), as before');
});
