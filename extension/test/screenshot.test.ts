import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { type AgentsModel, type TasksModel, VIEW_KINDS, type WorktreesModel } from '../src/model.ts';
import { findChrome, PAGES, pageFor, sampleModel, THEMES } from '../scripts/screenshot.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every tab has sample data, built by the real model functions', () => {
  for (const kind of PAGES) assert.equal(sampleModel(kind).kind, kind);
  assert.deepEqual(PAGES.filter((p) => !(VIEW_KINDS as readonly string[]).includes(p)), ['ticket'], 'plus a ticket\'s page');
});

test('the sample data shows every style: each board column, each kind of session, each kind of worktree', () => {
  const tasks = sampleModel('tasks') as TasksModel;
  for (const c of tasks.projects[0]!.columns) assert.ok(c.cards.length, `the ${c.group} column has a card`);
  const agents = (sampleModel('agents') as AgentsModel).places.flatMap((p) => p.agents);
  assert.ok(agents.some((a) => a.needsYou) && agents.some((a) => a.background && !a.needsYou) && agents.some((a) => !a.background));
  assert.ok((sampleModel('agents') as AgentsModel).places.some((p) => p.root === null), 'some sessions are elsewhere on the machine');
  const worktrees = (sampleModel('worktrees') as WorktreesModel).projects[0]!.worktrees;
  assert.deepEqual([...new Set(worktrees.map((w) => w.state.label.replace(/^\d+/, 'N')))].sort(), ['Clean', 'Missing on disk', 'N changed']);
});

test('both themes define every VSCode colour and font the tabs read', () => {
  const css = readFileSync(join(root, 'webview', 'styles.css'), 'utf8');
  const used = new Set([...css.matchAll(/var\(--vscode-([\w-]+)/g)].map((m) => m[1]!));
  for (const [name, vars] of Object.entries(THEMES)) {
    for (const v of used) assert.ok(v in vars, `${name} theme defines --vscode-${v}`);
  }
});

test('the page hands the model to the real webview, and no string in it can close the script', () => {
  const model = sampleModel('agents') as AgentsModel;
  model.places[0]!.agents[0]!.name = '</script><img src=x onerror=alert(1)>';
  const page = pageFor('agents', 'dark', model);
  assert.ok(!page.includes('</script><img'));
  assert.ok(page.includes('src="webview/main.js"') && page.includes('data-view="agents"'));
  assert.ok(page.includes('--vscode-editor-background: #1f1f1f'));
});

test('Chrome is found from $CHROME first, and a wrong $CHROME is reported, not guessed past', () => {
  assert.equal(findChrome({ CHROME: '/opt/chrome' }, (p) => p === '/opt/chrome'), '/opt/chrome');
  assert.equal(findChrome({ CHROME: '/nowhere' }, () => false), null);
  assert.equal(findChrome({}, (p) => p.includes('Chromium.app')), '/Applications/Chromium.app/Contents/MacOS/Chromium');
});
