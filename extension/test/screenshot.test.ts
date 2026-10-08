import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tempDir } from '../../packages/core/test/support.ts';
import { HOME_SECTIONS } from '../src/model/shared.ts';
import type { HomeModel } from '../src/model/home.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { COLOUR_PAGES, COLOUR_PROPERTIES, colourDiffs, type Colours, dumpedColours, findChrome, FONTS, PAGES, pageFor, sampleModel } from '../scripts/screenshot.ts';
import { cssRules, pageStyles, palettes, readsVars, styleFile, styleFiles, vscodeDefaults } from '../scripts/styles.ts';

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
    // The Agents tab with agents that would bill per token (D-089), and Settings at How agents run (GH-110).
    else if (kind === 'agents-billing') assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).agents.billing?.tone], ['home', 'agents', 'orange']);
    else if (kind === 'settings-agents') assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).settings.agents.projects.length], ['home', 'settings', 2]);
    // Agents with its Where column showing full paths (GH-83).
    else if (kind === 'agents-path') assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).agents.whereView], ['home', 'agents', 'path']);
    // The Overview with In progress busy, and with nothing running (D-092).
    else if (kind.startsWith('overview-')) assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).overview.inProgress.empty === null], ['home', 'overview', kind === 'overview-busy']);
    // The Overview of a project with a merge queue, autopilot on and off, and its head held (GH-73).
    else if (kind.startsWith('queue')) assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).overview.queue[0]?.rows.length, (m as HomeModel).overview.queue[0]?.off, !!(m as HomeModel).overview.queue[0]?.rows[0]?.tip], ['home', 'overview', 3, kind === 'queue-off', kind === 'queue-held']);
    else assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).connect], ['home', kind === 'output' ? 'setup' : kind, null]);
  }
  assert.equal((sampleModel('agents') as HomeModel).agents.whereView, 'folder');
  assert.deepEqual(PAGES.filter((p) => !(HOME_SECTIONS as readonly string[]).includes(p)), ['agents-path', 'ticket', 'ticket-questions', 'ticket-split', 'ticket-stopped', 'ticket-track', 'ticket-checks', 'ticket-waits', 'agent', 'output', 'connect-start', 'connect-shared', 'connect-jira', 'connect-azure', 'connect-github', 'connect-existing', 'connect-monday', 'connect-epic', 'connect-epic-used', 'connect-epic-azure', 'connect-epic-github', 'slack-none', 'slack-off', 'slack-paused', 'tasks-monday', 'agents-billing', 'overview-busy', 'overview-idle', 'queue', 'queue-off', 'queue-held', 'settings-agents']);
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
  // Finished sessions (D-095): in the project, a done task's builder, an earlier run's and a recorded review's;
  // elsewhere, two of another repo's done tasks; and an untied one that still needs you. Each can be stopped but the reviewer's.
  const look = (p: string | null) => home.agents.places.find((x) => x.root === p)!.agents.filter((a) => a.finished).map((a) => [a.name, a.look.label]);
  const finishedHere = look(home.agents.places[0]!.root);
  assert.equal(finishedHere.length, 3, 'a done task\'s builder, an earlier run\'s and a recorded review\'s');
  assert.ok(finishedHere.every(([, label]) => label === 'Finished'));
  assert.deepEqual(look(null), [['Acme Service · ACME-38 Merge the support queues · builder', 'Finished'], ['ACME-37', 'Finished']]);
  assert.equal(agents.find((a) => a.name === 'ACME-11')?.look.label, 'Needs you: permission prompt', 'acc can\'t tie it');
  assert.equal(home.agents.stopFinished, 4);
  const worktrees = home.worktrees.projects[0]!.worktrees;
  assert.deepEqual([...new Set(worktrees.map((w) => w.state.label.replace(/^\d+/, 'N')))].sort(), ['Clean', 'Missing on disk', 'N changed']);
});

test('Light and Dark each set exactly the colours the pages and VSCode\'s webview stylesheet read, both ways (GH-109)', () => {
  const read = new Set([...readsVars(pageStyles()), ...readsVars(vscodeDefaults())]);
  // The only variables read that aren't colours: fonts, which stay VSCode's in Light and Dark.
  assert.deepEqual(Object.keys(FONTS).sort(), ['editor-font-family', 'font-family', 'font-size', 'font-weight']);
  const colours = [...read].filter((v) => !(v in FONTS)).sort();
  assert.ok(colours.length >= 40, `${colours.length} colours compared`);
  assert.ok(colours.includes('scrollbarSlider-background') && colours.includes('charts-orange'), 'from VSCode\'s stylesheet and the page\'s');
  const all = palettes();
  assert.deepEqual(Object.keys(all).sort(), ['dark', 'light']);
  for (const [theme, palette] of Object.entries(all)) {
    const set = Object.keys(palette).sort();
    assert.deepEqual(set.filter((v) => !colours.includes(v)), [], `${theme} sets no colour nothing reads`);
    assert.deepEqual(colours.filter((v) => !set.includes(v)), [], `${theme} sets every colour read`);
    for (const f of Object.keys(FONTS)) assert.ok(!(f in palette), `${theme} leaves ${f} to VSCode`);
  }
});

test('the palettes are theme.css\'s alone: !important on <html>, each with its color-scheme, and nothing else keys on VSCode\'s theme (GH-109)', () => {
  const rules = cssRules(styleFile('theme.css'));
  assert.deepEqual(rules.map((r) => r.selector), ['html[data-theme="dark"]', 'html[data-theme="light"]']);
  for (const r of rules) {
    const theme = /"(\w+)"/.exec(r.selector)![1];
    assert.deepEqual(r.declarations.filter((d) => d.name === 'color-scheme').map((d) => d.value), [theme], `${theme} sets its color-scheme`);
    const colours = r.declarations.filter((d) => d.name !== 'color-scheme');
    assert.ok(colours.length >= 40, `${theme}: ${colours.length} colours`);
    for (const d of colours) assert.ok(d.name.startsWith('--vscode-') && d.important, `${theme}: ${d.name} is a --vscode-* colour, !important`);
  }
  // Outside theme.css, VSCode's body classes count only while the page matches VSCode, and no rule sets a --vscode-* colour.
  let keyed = 0;
  for (const f of styleFiles().filter((x) => x !== 'theme.css')) {
    for (const r of cssRules(styleFile(f))) {
      for (const sel of r.selector.split(',').map((s) => s.trim())) {
        if (!/\.vscode-(light|dark|high-contrast)/.test(sel)) continue;
        keyed++;
        assert.ok(sel.includes('[data-theme="vscode"]'), `${f}: ${sel} keys on VSCode's theme only under [data-theme="vscode"]`);
      }
      for (const d of r.declarations) assert.ok(!d.name.startsWith('--vscode-'), `${f}: ${r.selector} sets ${d.name}`);
    }
  }
  assert.ok(keyed >= 4, `${keyed} selectors key on VSCode's theme: the mark's`);
});

test('no colour is written into the page\'s styles outside theme.css, but for masks and a fallback (GH-109)', () => {
  const literal = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(/g;
  const found = Object.fromEntries(styleFiles().filter((f) => f !== 'theme.css').map((f) => [f, (styleFile(f).replace(/\/\*[\s\S]*?\*\//g, '').match(literal) ?? []).length]).filter(([, n]) => n));
  // The board's and a clamped reason's fade are masks, which use only alpha, so they're the same in every
  // theme. --line's fallback is for a VSCode theme that sets neither border colour; Light and Dark set both.
  assert.deepEqual(found, { 'boards.css': 8, 'task-page.css': 4, 'styles.css': 1 });
  assert.equal((styleFile('theme.css').replace(/\/\*[\s\S]*?\*\//g, '').match(literal) ?? []).length, 112, 'and theme.css holds every colour of both palettes');
});

test('a shot forces its theme under VSCode\'s other one, with VSCode\'s own stylesheet first (GH-109)', () => {
  const page = pageFor('settings', 'light', sampleModel('settings', Date.now(), 'light'));
  assert.match(page, /<html lang="en" data-theme="light" style="[^"]*--vscode-editor-background: #1f1f1f;/, 'Dark\'s colours injected, as VSCode would');
  assert.match(page, /--vscode-font-family: -apple-system/);
  assert.match(page, /<body class="vscode-dark" data-view="home"/);
  assert.ok(page.indexOf('@layer vscode-default') < page.indexOf('webview/styles.css'), 'VSCode\'s stylesheet comes first');
  assert.ok(!page.includes('collectColours'), 'a shot gathers no colours');
  const matched = pageFor('overview', 'vscode', sampleModel('overview'), 'light', true);
  assert.match(matched, /<html lang="en" data-theme="vscode" style="[^"]*--vscode-editor-background: #ffffff;/);
  assert.ok(matched.includes('setTimeout(collectColours, 500)') && matched.includes('window.requestAnimationFrame = '), 'gathered once the page\'s frame callbacks have run');
  const settings = sampleModel('settings', Date.now(), 'dark') as HomeModel;
  assert.deepEqual([settings.section, settings.settings.theme], ['settings', 'dark']);
});

test('the colour check reads what a page gathered, and finds where two drawings differ (GH-109)', () => {
  const rows: Colours = [['div.a', COLOUR_PROPERTIES.map(() => 'rgb(0, 0, 0)')], ['span::before', COLOUR_PROPERTIES.map(() => 'rgb(1, 1, 1)')]];
  assert.deepEqual(dumpedColours(`<html><body><main></main><script type="application/json" id="acc-colours">${JSON.stringify(rows)}</script></body></html>`), rows);
  assert.equal(dumpedColours('<html><body></body></html>'), null);
  assert.deepEqual(colourDiffs(rows, rows), []);
  const other = structuredClone(rows);
  other[1]![1][1] = 'rgb(9, 9, 9)';
  assert.deepEqual(colourDiffs(rows, other), [{ what: 'span::before', property: 'background-color', a: 'rgb(1, 1, 1)', b: 'rgb(9, 9, 9)' }]);
  assert.deepEqual(colourDiffs(rows, rows.slice(1)), [{ what: 'the page, from element 0', property: 'its elements', a: '2 elements, div.a there', b: '1 elements, span::before there' }], 'different elements differ as a whole');
  assert.deepEqual(colourDiffs(rows, rows.slice(0, 1)).map((d) => d.what), ['the page, from element 1'], 'and so does one with fewer');
  assert.deepEqual(COLOUR_PAGES, ['overview', 'tasks', 'settings', 'settings-agents', 'ticket', 'agent']);
});

test('the page\'s styles: what every area shares first, then each area\'s own by file name, each named for a module of the page (GH-95)', () => {
  const files = styleFiles();
  assert.ok(files.length >= 10, `${files.length} stylesheets`);
  assert.deepEqual([files[0], files.slice(1)], ['styles.css', [...files.slice(1)].sort()]);
  assert.ok(pageStyles().startsWith('/* Theme-native'), 'styles.css comes first');
  const dir = tempDir('acc-styles-');
  for (const f of ['styles.css', 'tasks.css', 'tasks.ts', 'agents.css', 'agents.ts']) writeFileSync(join(dir, f), `/* ${f} */\n`);
  assert.deepEqual(styleFiles(dir), ['styles.css', 'agents.css', 'tasks.css']);
  assert.equal(pageStyles(dir), '/* styles.css */\n\n/* agents.css */\n\n/* tasks.css */\n');
  writeFileSync(join(dir, 'cards.css'), '');
  assert.throws(() => styleFiles(dir), /No module of the page is named for cards\.css/);
});

test('the page hands the model to the real webview, and no string in it can close the script', () => {
  const model = sampleModel('agents') as HomeModel;
  model.agents.places[0]!.agents[0]!.name = '</script><img src=x onerror=alert(1)>';
  const page = pageFor('agents', 'dark', model);
  assert.ok(!page.includes('</script><img'));
  assert.ok(page.includes('src="webview/main.js"') && page.includes('data-view="home"'));
  assert.ok(page.includes('data-theme="dark"') && page.includes('--vscode-editor-background: #ffffff'), 'Dark, under VSCode\'s light theme');
});

test('Chrome is found from $CHROME first, and a wrong $CHROME is reported, not guessed past', () => {
  assert.equal(findChrome({ CHROME: '/opt/chrome' }, (p) => p === '/opt/chrome'), '/opt/chrome');
  assert.equal(findChrome({ CHROME: '/nowhere' }, () => false), null);
  assert.equal(findChrome({}, (p) => p.includes('Chromium.app')), '/Applications/Chromium.app/Contents/MacOS/Chromium');
});
