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
    // The Connect page opens over the section it came from (GH-51).
    else if (kind.startsWith('connect-')) assert.deepEqual([m.kind, (m as HomeModel).section, !!(m as HomeModel).connect], ['home', 'tasks', true]);
    // The Slack card at each of its states, on Environments (GH-58).
    else if (kind.startsWith('slack-')) assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).environments.slack?.state], ['home', 'environments', kind.slice('slack-'.length)]);
    // The Tasks tab with a monday.com board (GH-70).
    else if (kind === 'tasks-monday') assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).tasks.projects[0]!.boards[0]!.kind], ['home', 'tasks', 'monday']);
    // The Agents tab with How agents run opened by its Settings button (D-089).
    else if (kind === 'agents-settings') assert.deepEqual([m.kind, (m as HomeModel).section], ['home', 'agents']);
    // Agents with its Where column showing full paths (GH-83).
    else if (kind === 'agents-path') assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).agents.whereView], ['home', 'agents', 'path']);
    // The Overview with In progress busy, and with nothing running (D-092).
    else if (kind.startsWith('overview-')) assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).overview.inProgress.empty === null], ['home', 'overview', kind === 'overview-busy']);
    // The Overview of a project with a merge queue, autopilot on and off (GH-73).
    else if (kind.startsWith('queue')) assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).overview.queue[0]?.rows.length, (m as HomeModel).overview.queue[0]?.off], ['home', 'overview', 3, kind === 'queue-off']);
    else assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).connect], ['home', kind === 'output' ? 'setup' : kind, null]);
  }
  assert.equal((sampleModel('agents') as HomeModel).agents.whereView, 'folder');
  assert.deepEqual(PAGES.filter((p) => !(HOME_SECTIONS as readonly string[]).includes(p)), ['agents-path', 'ticket', 'ticket-questions', 'ticket-split', 'ticket-stopped', 'ticket-track', 'ticket-checks', 'agent', 'output', 'connect-start', 'connect-shared', 'connect-jira', 'connect-azure', 'connect-github', 'connect-existing', 'connect-monday', 'slack-none', 'slack-off', 'slack-paused', 'tasks-monday', 'agents-settings', 'overview-busy', 'overview-idle', 'queue', 'queue-off']);
  assert.equal((sampleModel('environments') as HomeModel).environments.slack?.state, 'on');
  // monday.com's Connect page: its token page, its board picked by name, and two status columns to choose from.
  const monday = (sampleModel('connect-monday') as HomeModel).connect!;
  assert.deepEqual([monday.kind, monday.fields[0]?.help?.url, monday.pickers.map((p) => [p.key, p.hidden])], ['monday', 'https://acme.monday.com/apps/manage/tokens', [['board', false], ['group', false], ['statusColumn', false]]]);
  // The tick for every project on the site, named for it (GH-79), and the sign-in it keeps said on the board.
  const shared = (sampleModel('connect-shared') as HomeModel).connect!;
  assert.deepEqual([shared.share.shown, shared.share.on, shared.share.label], [true, true, 'Use this sign-in for every project on acme.atlassian.net']);
  assert.equal((sampleModel('tasks') as HomeModel).tasks.projects[0]!.boards[0]!.signIn?.label, 'Signed in as jordan@acme.example, for every project on acme.atlassian.net');
  // Busy: several tasks with two or three jobs each, both slots held and one check waiting, and a done line (D-092).
  const busy = (sampleModel('overview-busy') as HomeModel).overview.inProgress;
  assert.ok(busy.groups.filter((g) => g.jobs.length >= 2).length >= 3, 'several tasks with two or three jobs');
  assert.ok(busy.groups.some((g) => g.done.length), 'a done line');
  assert.equal(busy.machine[0]!.look.label, 'Heavy checks: 2 of 2 in use, none free, 1 waiting');
  assert.equal((sampleModel('overview-idle') as HomeModel).overview.inProgress.empty, 'Nothing is running.');
  // A ticket acc doesn't keep yet, being tracked from its card (D-074).
  assert.deepEqual([(sampleModel('ticket-track') as TicketModel).trackable, (sampleModel('ticket-track') as TicketModel).tracking], [true, true]);
  // A ticket being built, one whose analysis has questions, and one too big for one task (D-052).
  assert.deepEqual(['ticket', 'ticket-questions', 'ticket-split'].map((k) => (sampleModel(k as never) as TicketModel).analysis?.look.label), ['Analyzed before the build', '2 questions for you', 'Too big for one task']);
});

test('the sample data shows every style: each board column, each kind of session, each kind of worktree', () => {
  const home = sampleModel('tasks') as HomeModel;
  const tasks = home.tasks;
  for (const c of tasks.projects[0]!.columns) assert.ok(c.cards.length, `the ${c.group} column has a card`);
  // Track on the tracker's board (D-074): ready, on its way and refused, and none on a done ticket acc doesn't keep.
  const tcards = tasks.projects[0]!.boards[0]!.columns.flatMap((c) => c.cards.map((x) => ({ ...x, done: c.done })));
  const track = (key: string) => tcards.find((x) => x.key === key)!.track;
  assert.deepEqual([track('ACME-30'), track('ACME-31')?.busy, !!track('ACME-32')?.error], [{ busy: false, error: null }, true, true]);
  assert.ok(tcards.some((x) => x.done && !x.acc && !x.track), 'a done ticket acc doesn\'t keep has no Track');
  const agents = home.agents.places.flatMap((p) => p.agents);
  assert.ok(agents.some((a) => a.needsYou) && agents.some((a) => a.background && !a.needsYou) && agents.some((a) => !a.background));
  assert.ok(home.agents.places.some((p) => p.root === null), 'some sessions are elsewhere on the machine');
  // Each kind of folder a session can be in, and two repos of one name (GH-83).
  const here = home.agents.places[0]!.agents.map((a) => a.where);
  assert.ok(here.includes('main checkout') && here.some((w) => w.startsWith('worktree ')), 'in the project: its main checkout and a worktree');
  const away = home.agents.places.find((p) => p.root === null)!.agents.map((a) => a.where);
  for (const w of ['clients/Acme Service', 'personal/Acme Service', 'clients/Acme Service › worktree ACME-40', 'side-project › force-app/main', '~', 'scratch']) assert.ok(away.includes(w), `elsewhere: ${w}`);
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
