import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HOME_SECTIONS, type HomeModel, type TicketModel } from '../src/model.ts';
import { findChrome, PAGES, pageFor, sampleModel, THEMES } from '../scripts/screenshot.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every section of the page, and a ticket, has sample data built by the real model functions', () => {
  for (const kind of PAGES) {
    const m = sampleModel(kind);
    if (kind.startsWith('ticket') || kind === 'agent') assert.equal(m.kind, kind.startsWith('ticket') ? 'ticket' : kind);
    else assert.deepEqual([m.kind, (m as HomeModel).section], ['home', kind === 'output' ? 'setup' : kind]);
  }
  assert.deepEqual(PAGES.filter((p) => !(HOME_SECTIONS as readonly string[]).includes(p)), ['ticket', 'ticket-questions', 'ticket-split', 'ticket-stopped', 'agent', 'output']);
  // A ticket being built, one whose analysis has questions, and one too big for one task (D-052).
  assert.deepEqual(['ticket', 'ticket-questions', 'ticket-split'].map((k) => (sampleModel(k as never) as TicketModel).analysis?.look.label), ['Analyzed before the build', '2 questions for you', 'Too big for one task']);
});

test('the sample data shows every style: each board column, each kind of session, each kind of worktree', () => {
  const home = sampleModel('tasks') as HomeModel;
  const tasks = home.tasks;
  for (const c of tasks.projects[0]!.columns) assert.ok(c.cards.length, `the ${c.group} column has a card`);
  const agents = home.agents.places.flatMap((p) => p.agents);
  assert.ok(agents.some((a) => a.needsYou) && agents.some((a) => a.background && !a.needsYou) && agents.some((a) => !a.background));
  assert.ok(home.agents.places.some((p) => p.root === null), 'some sessions are elsewhere on the machine');
  const worktrees = home.worktrees.projects[0]!.worktrees;
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
  const model = sampleModel('agents') as HomeModel;
  model.agents.places[0]!.agents[0]!.name = '</script><img src=x onerror=alert(1)>';
  const page = pageFor('agents', 'dark', model);
  assert.ok(!page.includes('</script><img'));
  assert.ok(page.includes('src="webview/main.js"') && page.includes('data-view="home"'));
  assert.ok(page.includes('--vscode-editor-background: #1f1f1f'));
});

test('Chrome is found from $CHROME first, and a wrong $CHROME is reported, not guessed past', () => {
  assert.equal(findChrome({ CHROME: '/opt/chrome' }, (p) => p === '/opt/chrome'), '/opt/chrome');
  assert.equal(findChrome({ CHROME: '/nowhere' }, () => false), null);
  assert.equal(findChrome({}, (p) => p.includes('Chromium.app')), '/Applications/Chromium.app/Contents/MacOS/Chromium');
});
