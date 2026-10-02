import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { TaskRow } from '../src/logic.ts';
import { agentsModel, cardActions, environmentsModel, homeModel, type HubLike, isFromWebview, promotionPaths, setupModel, tasksModel, VIEW_KINDS, worktreesModel, dropLanes, laneMove } from '../src/model.ts';

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

test('the board has a column for every status, in attention order, and each card has the right actions', () => {
  const m = tasksModel(hub());
  const cols = m.projects[0]!.columns;
  assert.deepEqual(cols.map((c) => c.group), ['needs-you', 'ready', 'running', 'review', 'rework', 'blocked', 'todo', 'done']);
  const card = (id: string) => cols.flatMap((c) => c.cards).find((c) => c.id === id)!;
  assert.deepEqual(card('AV-2').actions.map((a) => a.label), ['Move', 'Block', 'Ticket', 'Details']);
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
    { id: 'A4.plugin', part: 'machine', title: 'Plugin', status: 'skip', detail: 'later' },
  ], new Set());
  assert.equal(m.total, 3, 'planned steps stay out');
  assert.equal(m.done, 1);
  const steps = m.parts.flatMap((p) => p.steps);
  assert.deepEqual(steps.find((s) => s.id === 'B2.identity')!.actions.map((a) => a.label), ['Do it', 'Check']);
  const tickets = steps.find((s) => s.id === 'B14.tickets')!;
  assert.deepEqual(tickets.actions.map((a) => a.label), ['Do it', 'Check', 'Guide'], 'Do it runs Add a tracker or Sign in, in VSCode');
  assert.equal(tickets.fix, null, 'a VSCode command isn\'t shown as one to copy');
  assert.deepEqual(steps.find((s) => s.id === 'B0.repo')!.actions.map((a) => a.label), ['Check', 'Guide'], 'passing steps keep only Check and the guide')
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
  assert.deepEqual(labels({}), ['Dispatch', 'Move', 'Block', 'Details']);
  assert.deepEqual(labels({ state: 'running', display: 'running', run: { bgId: 'bg1', worktree: '/w/AV-9' } }), ['Watch', 'Open in Claude Code', 'Worktree', 'Move', 'Abandon', 'Details']);
  assert.equal(cardActions({ ...row('AV-9', 'running', 'running'), deps: [], run: { bgId: 'bg1' } } as TaskRow, {})[0]!.primary, true, 'Watch is the main action while it runs');
  assert.deepEqual(labels({ state: 'review', display: 'review', run: { sessionId: 's1', worktree: '/w/AV-9' } }).slice(0, 2), ['Review', 'Watch'], 'in review: Review first, and what its builder did can still be read');
  assert.deepEqual(labels({ state: 'rework', display: 'rework', run: { worktree: '/w/AV-9' } }), ['Re-dispatch', 'Worktree', 'Move', 'Block', 'Details']);
  assert.deepEqual(labels({ state: 'done', display: 'done', run: { worktree: '/w/AV-9' } }), ['Worktree', 'Move', 'Clean up', 'Details']);
  assert.equal(cardActions({ ...row('AV-9', 'todo', 'ready'), deps: [] }, {})[0]!.primary, true, 'Dispatch is the main action on a ready card');
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
  assert.deepEqual(lanes('running', 'running', ['T-2']), ['review', 'blocked', 'todo'], 'one that waits on another goes back to To do, where it will show');
  assert.deepEqual(lanes('review', 'review'), ['rework', 'blocked', 'done']);
  assert.deepEqual(lanes('blocked', 'blocked'), ['ready', 'review'], 'blocked work goes back, or on to review once its checks are settled');
  assert.deepEqual(lanes('rework', 'rework'), ['running', 'blocked']);
  assert.ok(!lanes('running', 'needs-you').includes('needs-you'), 'needs you is shown, never chosen');
  assert.deepEqual([laneMove('ready'), laneMove('running'), laneMove('needs-you')], ['todo', 'dispatch', null]);
  const card = tasksModel(hub()).projects[0]!.columns.flatMap((c) => c.cards)[0]!;
  assert.ok(Array.isArray(card.drops));
});
