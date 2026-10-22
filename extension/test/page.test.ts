// The Command Center page itself: one page for every section, the messages it takes, its row menus, and its layout rules.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { isWebviewMenuContext } from '../src/logic/shared.ts';
import { VIEW_KINDS } from '../src/model/shared.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { pageStyles } from '../scripts/styles.ts';
import { root, manifest, pageSource, row } from './support.ts';

test('a webview menu passes its row context, which is told apart from a sidebar node', () => {
  assert.ok(isWebviewMenuContext({ webviewSection: 'agent', accRef: { session: 's1' }, webview: 'acc.agents' }));
  assert.ok(!isWebviewMenuContext({ kind: 'agent', session: {} }));
  assert.ok(!isWebviewMenuContext(undefined));
  assert.ok(!isWebviewMenuContext('acc.agents'));
});

test('the row menus are for the page the rows are on: the Command Center\'s own webview', () => {
  const panels = readFileSync(join(root, 'src', 'panels.ts'), 'utf8');
  const viewType = /createWebviewPanel\('([\w.]+)'/.exec(panels)?.[1];
  assert.equal(viewType, 'acc.home');
  for (const i of manifest.contributes.menus['webview/context'] as { command: string; when: string }[]) assert.match(i.when, new RegExp(`webviewId == '${viewType}'`), `${i.command} shows on the page`);
});

test('row menus: every item is a declared command, and the rows set the keys the menus test', () => {
  const commands = new Set((manifest.contributes.commands as { command: string }[]).map((c) => c.command));
  const menu = manifest.contributes.menus['webview/context'] as { command: string; when: string }[];
  for (const i of menu) assert.ok(commands.has(i.command), `${i.command} is a declared command`);
  const src = pageSource('agents.ts', 'worktrees.ts', 'environments.ts', 'dom.ts');
  assert.ok(src.includes("withMenu(row, 'agent', { session: a.key }, { agentBackground: a.background })"));
  assert.ok(src.includes("withMenu(row, 'worktree', { project: p.root, worktree: w.path }, { worktreeLinked: !w.main })"));
  // The Overview's lines open the menu their model names (GH-160): a task's, an agent's or the tidy-up's.
  assert.ok(pageSource('landing.ts').includes('if (r.menu) withMenu(row, r.menu.section, r.menu.ref, r.menu.flags);'));
  const model = readFileSync(join(root, 'src', 'model', 'landing.ts'), 'utf8');
  const overview = new Set([...model.matchAll(/section: '(\w+)'/g)].map((m) => m[1]!).filter((s) => s !== 'tasks'));
  assert.deepEqual([...overview].sort(), ['task'], 'the landing model makes task menus; agents and the tidy-up name their own');
  overview.add('tidy');
  // A moved environment branch's line names its own menu too (GH-69).
  overview.add('branch');
  for (const section of new Set(menu.map((i) => /webviewSection == '(\w+)'/.exec(i.when)?.[1]))) assert.ok(src.includes(`withMenu(row, '${section}'`) || overview.has(section!), `some row opens the ${section} menu`);
  assert.ok(src.includes("new MouseEvent('contextmenu'"), 'the caret opens the same menu');
  for (const [from, to] of [['function renderAgents', 'function renderWorktrees'], ['function renderWorktrees', 'function renderEnvironments']] as const) {
    assert.ok(!/\.actions\.map/.test(src.slice(src.indexOf(from), src.indexOf(to))), `no inline buttons left in ${from.slice(9)}`);
  }
});

test('webview messages: only known shapes and acc commands get through', () => {
  assert.ok(isFromWebview({ type: 'ready' }));
  assert.ok(isFromWebview({ type: 'run', command: 'acc.task.move', ref: {} }));
  assert.ok(!isFromWebview({ type: 'run', command: 'workbench.action.terminal.sendSequence', ref: {} }));
  assert.ok(!isFromWebview({ type: 'eval', command: 'acc.x' }));
  assert.ok(!isFromWebview(null));
});

test('the tab page never turns data into markup, and runs under a strict nonce CSP', async () => {
  const src = pageSource();
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

test('table cells keep table layout (a flex cell misaligns its row\'s lines)', () => {
  const css = pageStyles();
  const src = pageSource();
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

test('the Worktrees table fits beside the sticky actions at 500 px: its state cell wraps, where nowrap ran it under them on Linux (T-108)', () => {
  const page = pageSource('worktrees.ts');
  assert.match(page, /el\('td', 'state', status\(w\.state\)\)/);
  // Edge: no state cell kept to one line.
  assert.doesNotMatch(page, /el\('td', 'nowrap', status\(/);
  const css = readFileSync(join(root, 'webview', 'styles.css'), 'utf8');
  const top = css.replace(/@media[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  assert.match(top, /\.grid td\.state \.status \{ white-space: normal; min-width: 9em; \}/, 'at every width, not only in a narrow tab');
  // A narrow tab gives the state room first, so it seldom needs to wrap.
  assert.match(css, /@media \(max-width: 560px\) \{ \.grid td\.clip\.name \{ max-width: 12em; \} \}/);
});
