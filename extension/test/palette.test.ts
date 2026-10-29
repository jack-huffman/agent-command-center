// The command palette (T-52): the items paletteItems makes from the page's model, the fuzzy match and the
// results the page shows, and the key that opens it.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { TaskRow } from '../src/logic/shared.ts';
import { homeModel, type HomeModel } from '../src/model/home.ts';
import { PALETTE_STEPS, NO_PROJECT, NOTHING_FINISHED, type PaletteItem, paletteItems, paletteStep } from '../src/model/palette.ts';
import { settingsKey } from '../src/model/settings.ts';
import type { Action } from '../src/model/shared.ts';
import { PALETTE_MESSAGE } from '../src/palette.ts';
import { sampleModel } from '../scripts/screenshot.ts';
import { boldParts, fuzzyMatch, hintAt, PALETTE_KINDS, paletteResults, RECENTS, SCORE, SHOWN } from '../webview/fuzzy.ts';
import { hub, row } from './support.ts';

const NOW = Date.parse('2026-10-15T12:00:00Z');
/** The busy Overview: everything at once (GH-160). */
const busy = (): HomeModel => sampleModel('overview-landing', NOW) as HomeModel;
const item = (title: string, kind: PaletteItem['kind'] = 'action', extra: Partial<PaletteItem> = {}): PaletteItem =>
  ({ id: `${kind}:${title}`, kind, title, hint: '', words: title, icon: 'circle', does: { kind: 'refresh' }, ...extra });
const titles = (items: PaletteItem[], query: string): string[] => paletteResults(items, query).groups.flatMap((g) => g.items.map((s) => s.item.title));

// ---------------------------------------------------------------- the items

test('paletteItems finds every section, part of Settings, task, agent and action on the busy Overview, and what each does', () => {
  const m = busy();
  const items = paletteItems(m);
  assert.ok(items.length > 0, 'made no items');
  assert.deepEqual(m.palette, items, 'the page model carries them');
  const of = (kind: PaletteItem['kind']) => items.filter((i) => i.kind === kind);
  assert.deepEqual(of('section').map((i) => [i.title, i.does]), m.nav.map((n) => [n.label, { kind: 'go', section: n.section }]), 'each section, in the rail\'s order');
  assert.deepEqual(of('setting').map((i) => [i.title, i.hint, i.does]), m.settings.parts.map((p) => [p.title, 'Settings', { kind: 'go', section: 'settings', part: settingsKey(p.id) }]), 'each part of Settings goes to its heading');
  const cards = m.tasks.projects.flatMap((p) => p.columns.flatMap((c) => c.cards.map((card) => ({ root: p.root, card }))));
  assert.deepEqual(of('task').map((i) => [i.title, i.hint, i.does]), cards.map(({ root, card }) => [card.title, card.id, { kind: 'task', project: root, key: card.id }]), 'each task row opens over the page, as its card\'s click does');
  for (const t of of('task')) assert.ok(t.words.includes(t.hint), `${t.hint}'s words hold its key`);
  const agents = m.agents.repos.flatMap((r) => [...r.tasks.flatMap((t) => t.agents), ...r.finished]);
  assert.deepEqual(of('agent').map((i) => [i.title, i.does]), agents.map((a) => [a.name, { kind: 'run', command: 'acc.agent.watch', ref: { session: a.key } }]), 'each agent opens its page');
  // The header's four and Report a problem (T-118), each card's next step with what its button sends, and Agents' Stop finished.
  const root = m.overview.projects[0]!.root;
  const actions = of('action');
  assert.deepEqual(actions.slice(0, 7).map((a) => [a.title, a.does]), [
    ['Add task', { kind: 'toolbar', command: 'acc.task.add', project: root }], ['Start an agent', { kind: 'toolbar', command: 'acc.agent.new', project: root }],
    ['Add a tracker', { kind: 'toolbar', command: 'acc.trackers.add', project: root }], ['Refresh', { kind: 'refresh' }], ['Report a problem', { kind: 'toolbar', command: 'acc.report' }],
    // Check this machine (T-133), as Setup's header offers it.
    ['Check this machine', { kind: 'toolbar', command: 'acc.checkMachine' }],
    // Set up cloud builders (T-145), on the first project, as Settings' Set up… opens it.
    ['Set up cloud builders', { kind: 'toolbar', command: 'acc.cloud.setup', project: root }],
  ]);
  const steps = cards.flatMap(({ card }) => { const s = paletteStep(card.actions); return s ? [{ card, s }] : []; });
  assert.ok(steps.length >= 4, `the sample offers Dispatch, Resume, Answer and Watch steps, found ${steps.length}`);
  assert.deepEqual(actions.slice(7, 7 + steps.length).map((a) => [a.title, a.hint, a.does]), steps.map(({ card, s }) => [`${s.label}: ${card.title}`, card.id, s.question ? { kind: 'answer', question: s.question } : { kind: 'run', command: s.command, ref: s.ref }]));
  // Then Edit for each task that can be edited now (T-74): none whose builder runs, nor one that's done.
  const editable = cards.filter(({ card }) => card.actions.some((a) => a.command === 'acc.task.edit' && !a.disabled));
  assert.ok(editable.length > 0 && editable.length < cards.length, `some tasks can be edited and some can't, found ${editable.length} of ${cards.length}`);
  assert.deepEqual(actions.slice(7 + steps.length, -1).map((a) => [a.title, a.hint, a.does, a.disabled]), editable.map(({ card }) => [`Edit: ${card.title}`, card.id, { kind: 'run', command: 'acc.task.edit', ref: { project: card.actions[0]!.ref.project, task: card.id } }, undefined]));
  const kinds = (cs: { s: Action }[]) => new Set(cs.map(({ s }) => (s.command === 'acc.task.show' ? 'Answer' : s.command)));
  assert.deepEqual(kinds(steps), new Set(['acc.task.dispatch', 'acc.task.dispatchAnyway', 'acc.task.watch', 'Answer']), 'each kind of next step it has');
  // Its stopped builders are left out of the busy Overview: the Tasks sample has them, with Resume.
  const resumes = paletteItems(sampleModel('tasks', NOW) as HomeModel).filter((i) => i.does.kind === 'run' && i.does.command === 'acc.task.resume');
  assert.deepEqual(resumes.map((i) => i.hint), ['ACME-28', 'ACME-29']);
  assert.deepEqual([actions.at(-1)!.title, actions.at(-1)!.does, actions.at(-1)!.disabled], ['Stop finished sessions', { kind: 'toolbar', command: 'acc.agents.stopFinished' }, undefined]);
  assert.equal(items.length, m.nav.length + m.settings.parts.length + cards.length + agents.length + 7 + steps.length + editable.length + 1, 'nothing else, and nothing twice');
  assert.equal(new Set(items.map((i) => i.id)).size, items.length, 'each id once, so what was run is remembered by it');
  for (const i of items) assert.ok(i.words.startsWith(i.title), `${i.id}'s words start with its title, so its matches are drawn in it`);
});

test('a model with no tasks has no task, agent or next-step items, and the header\'s actions are off with their reason', () => {
  const m = sampleModel('setup-first', NOW) as HomeModel;
  const items = paletteItems(m);
  assert.deepEqual(items.filter((i) => i.kind === 'task' || i.id.startsWith('step:')), []);
  assert.equal(items.filter((i) => i.kind === 'section').length, m.nav.length, 'the sections are still there');
  const header = items.filter((i) => ['action:add-task', 'action:start-agent', 'action:add-tracker'].includes(i.id));
  assert.deepEqual(header.map((i) => [i.disabled, i.hint]), [[NO_PROJECT, NO_PROJECT], [NO_PROJECT, NO_PROJECT], [NO_PROJECT, NO_PROJECT]]);
  assert.equal(items.find((i) => i.id === 'action:refresh')!.disabled, undefined, 'Refresh always runs');
});

test('two tasks with one title are told apart by their keys', () => {
  const rows: TaskRow[] = [{ ...row('AV-7', 'todo', 'ready'), title: 'Fix login' }, { ...row('AV-8', 'todo', 'ready'), title: 'Fix login' }];
  const m = homeModel({ hub: { ...hub(), agents: [], taskRows: () => rows }, section: 'tasks', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const tasks = m.palette.filter((i) => i.kind === 'task');
  assert.deepEqual(tasks.map((t) => [t.title, t.hint]), [['Fix login', 'AV-7'], ['Fix login', 'AV-8']]);
  assert.equal(paletteResults(m.palette, 'av8').groups[0]!.items[0]!.item.hint, 'AV-8', 'a key finds its own');
  // Two rows that share a key, as no ledger should hold, still get an id each.
  const twice = homeModel({ hub: { ...hub(), agents: [], taskRows: () => [rows[0]!, rows[0]!] }, section: 'tasks', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() } });
  assert.deepEqual(twice.palette.filter((i) => i.kind === 'task').map((i) => i.id), ['task:/r#AV-7', 'task:/r#AV-7~2']);
});

test('a disabled action carries its reason as its hint, never in its words, and Stop finished is off with none finished', () => {
  const m = busy();
  const none = paletteItems({ ...m, agents: { ...m.agents, stopFinished: 0 } });
  const stop = none.find((i) => i.id === 'action:stop-finished')!;
  assert.deepEqual([stop.disabled, stop.hint], [NOTHING_FINISHED, NOTHING_FINISHED]);
  assert.ok(!stop.words.includes(NOTHING_FINISHED), 'its reason isn\'t searched');
  assert.equal(hintAt(stop), null, 'nor drawn in bold');
  // A next step that is off keeps its reason too.
  const off: Action = { command: 'acc.task.dispatch', label: 'Build it', icon: 'rocket', ref: {}, primary: true, disabled: 'Its files are busy' };
  const card = m.tasks.projects[0]!.columns.find((c) => c.cards.length)!.cards[0]!;
  const withOff = paletteItems({ ...m, tasks: { ...m.tasks, projects: [{ ...m.tasks.projects[0]!, columns: [{ ...m.tasks.projects[0]!.columns[0]!, cards: [{ ...card, actions: [off] }] }] }] } });
  assert.deepEqual(withOff.filter((i) => i.id.startsWith('step:')).map((i) => [i.disabled, i.hint]), [['Its files are busy', 'Its files are busy']]);
});

test('paletteStep offers only the next steps PALETTE_STEPS names and Answer, and none for Move or a card with no next step', () => {
  const a = (command: string, label: string, primary = true): Action => ({ command, label, icon: 'x', ref: {}, primary });
  assert.deepEqual(PALETTE_STEPS, ['acc.task.dispatch', 'acc.task.dispatchAnyway', 'acc.task.resume', 'acc.task.watch']);
  for (const c of PALETTE_STEPS) assert.equal(paletteStep([a(c, 'Go')])?.command, c);
  assert.equal(paletteStep([{ ...a('acc.task.show', 'Answer'), question: 'q1' }])?.label, 'Answer', 'Answer is the show step that carries a question');
  assert.equal(paletteStep([a('acc.task.show', 'Answer')]), null, 'a label alone is not an Answer step');
  assert.equal(paletteStep([a('acc.task.show', 'See the split')]), null);
  assert.equal(paletteStep([a('acc.task.move', 'Move')]), null, 'Move is the board\'s drag, not a next step');
  assert.equal(paletteStep([a('acc.task.land', 'Open pull request')]), null);
  assert.equal(paletteStep([a('acc.task.dispatch', 'Build it', false)]), null, 'only the card\'s primary');
  assert.equal(paletteStep([]), null);
});

// ---------------------------------------------------------------- the match

test('a match at the start of a word ranks above one inside a word', () => {
  assert.ok(fuzzyMatch('port', 'Port forwarding')!.score > fuzzyMatch('port', 'Report')!.score);
  assert.ok(fuzzyMatch('s', 'Settings')!.score > fuzzyMatch('s', 'Tasks')!.score);
  // A capital after a small letter starts a word, and so does a character after a sign.
  assert.deepEqual(fuzzyMatch('16', 'ACME-16')!.at, [5, 6]);
  assert.ok(fuzzyMatch('f', 'stopFinished')!.score > fuzzyMatch('f', 'stopfinished')!.score);
});

test('a run of matched characters ranks above the same characters scattered, and the best way through is found', () => {
  assert.ok(fuzzyMatch('pan', 'Panel')!.score > fuzzyMatch('pan', 'Pick a name')!.score);
  // "set" could take the S of Settings and later letters; the run "Set" at the start is better.
  assert.deepEqual(fuzzyMatch('set', 'Settings set')!.at, [0, 1, 2]);
  assert.deepEqual(fuzzyMatch('rep', 'Read every report')!.at, [11, 12, 13], 'a later run at a word\'s start beats the first letters scattered');
  assert.equal(SCORE.run > SCORE.char && SCORE.wordStart > SCORE.char, true);
});

test('case doesn\'t matter, spaces in the query are left out, and an empty query or no match finds nothing', () => {
  assert.deepEqual(fuzzyMatch('ACME', 'acme-16'), fuzzyMatch('acme', 'ACME-16'));
  assert.deepEqual(fuzzyMatch('stop fin', 'Stop finished')!.at, fuzzyMatch('stopfin', 'Stop finished')!.at);
  assert.equal(fuzzyMatch('', 'Anything'), null);
  assert.equal(fuzzyMatch('   ', 'Anything'), null);
  assert.equal(fuzzyMatch('zz', 'Anything'), null);
  assert.equal(fuzzyMatch('ab', 'ba'), null, 'in order, or not at all');
  assert.equal(fuzzyMatch('long query', 'short'), null);
});

test('results come in this order for a small set, and no other', () => {
  const items = ['Report', 'Port forwarding', 'Open the important file', 'Sports', 'Prop it up', 'Nothing here'].map((t) => item(t));
  // Port's run starts a word; Sports' and Report's runs are inside one, Sports' nearer the front; important's
  // is later still. Prop it up holds the letters out of order, so it doesn't match.
  assert.deepEqual(titles(items, 'port'), ['Port forwarding', 'Sports', 'Report', 'Open the important file']);
});

test('results are grouped by kind, the group with the best match first, and a tie goes by kind', () => {
  const items = [item('Tasks', 'section'), item('Task board tidy', 'task', { hint: 'AV-1', words: 'Task board tidy AV-1' }), item('Start a task', 'action'), item('Settings', 'section')];
  const r = paletteResults(items, 'task');
  assert.deepEqual(r.groups.map((g) => [g.heading, g.items.map((s) => s.item.title)]), [['Sections', ['Tasks']], ['Tasks', ['Task board tidy']], ['Actions', ['Start a task']]]);
  assert.deepEqual([r.total, r.more], [3, 0]);
  assert.deepEqual(Object.values(PALETTE_KINDS).map((k) => k.heading), ['Sections', 'Settings', 'Tasks', 'Agents', 'Actions']);
});

test('a query that matches a key alone finds that task first: 16 finds ACME-16 on the busy Overview', () => {
  const r = paletteResults(busy().palette, '16');
  assert.deepEqual([r.groups[0]!.heading, r.groups[0]!.items[0]!.item.hint], ['Tasks', 'ACME-16']);
  const first = r.groups[0]!.items[0]!;
  assert.deepEqual(first.item.does, { kind: 'task', project: busy().overview.projects[0]!.root, key: 'ACME-16' });
  assert.deepEqual(boldParts(first.item.hint, first.at, hintAt(first.item)!), [{ text: 'ACME-', bold: false }, { text: '16', bold: true }], 'its key\'s matched characters are bold');
});

test('at most SHOWN results show, and the rest are counted; a query with no match shows nothing', () => {
  const items = Array.from({ length: 30 }, (_, i) => item(`Item ${i}`));
  const r = paletteResults(items, 'item');
  assert.deepEqual([r.groups.flatMap((g) => g.items).length, r.total, r.more], [SHOWN, 30, 30 - SHOWN]);
  assert.deepEqual(paletteResults(items, 'qqq'), { groups: [], total: 0, more: 0 });
});

test('an empty query shows the last RECENTS items run that are still there, then the sections not among them', () => {
  const sections = ['Overview', 'Tasks', 'Agents'].map((t) => item(t, 'section'));
  const others = Array.from({ length: 10 }, (_, i) => item(`Act ${i}`));
  const items = [...sections, ...others];
  const recent = ['gone:item', 'section:Tasks', ...others.map((o) => o.id)];
  const r = paletteResults(items, '', recent);
  assert.deepEqual(r.groups.map((g) => g.heading), ['Recent', 'Sections']);
  assert.deepEqual(r.groups[0]!.items.map((s) => s.item.title), ['Tasks', ...others.slice(0, RECENTS - 1).map((o) => o.title)], 'newest first, at most RECENTS, an item no longer there skipped');
  assert.deepEqual(r.groups[1]!.items.map((s) => s.item.title), ['Overview', 'Agents'], 'a section already in Recent isn\'t shown twice');
  assert.deepEqual(paletteResults(items, '  ').groups.map((g) => g.heading), ['Sections'], 'with nothing run yet, the sections');
  assert.deepEqual(paletteResults([], '').groups, [], 'with no items, nothing');
});

test('boldParts splits a text at its matched characters, and hintAt finds a hint that follows the title in the words, or none', () => {
  assert.deepEqual(boldParts('Settings', [0, 1, 2]), [{ text: 'Set', bold: true }, { text: 'tings', bold: false }]);
  assert.deepEqual(boldParts('AV-8', [9, 12], 9), [{ text: 'A', bold: true }, { text: 'V-', bold: false }, { text: '8', bold: true }]);
  assert.deepEqual(boldParts('', [0]), []);
  assert.equal(hintAt({ title: 'Fix login', hint: 'AV-8', words: 'Fix login AV-8 Acme' }), 10);
  assert.equal(hintAt({ title: 'Fix login', hint: '', words: 'Fix login' }), null);
  assert.equal(hintAt({ title: 'Stop', hint: 'Off for a reason', words: 'Stop' }), null);
});

// ---------------------------------------------------------------- the key

const extDir = join(fileURLToPath(new URL('.', import.meta.url)), '..');

test('the manifest contributes acc.palette with Cmd+K on a Mac and Ctrl+K elsewhere, only while the Command Center\'s tab has focus, and no other binding', () => {
  const pkg = JSON.parse(readFileSync(join(extDir, 'package.json'), 'utf8')) as { contributes: { commands: { command: string; title: string }[]; keybindings?: { command: string; key: string; mac?: string; when?: string }[] } };
  const cmd = pkg.contributes.commands.find((c) => c.command === 'acc.palette');
  assert.ok(cmd, 'acc.palette isn\'t contributed');
  assert.match(cmd.title, /Search or run a command/);
  const keys = (pkg.contributes.keybindings ?? []).filter((k) => k.command === 'acc.palette');
  assert.deepEqual(keys, [{ command: 'acc.palette', key: 'ctrl+k', mac: 'cmd+k', when: 'activeWebviewPanelId == \'acc.home\'' }]);
  // The panel it names is the Command Center's, as panels.ts makes it.
  const panels = readFileSync(join(extDir, 'src', 'panels.ts'), 'utf8');
  const viewType = /createWebviewPanel\('([^']+)', 'Command Center'/.exec(panels)?.[1];
  assert.equal(viewType, 'acc.home');
  assert.deepEqual(PALETTE_MESSAGE, { type: 'palette' });
});

test('the rail draws paletteButton under the brand, before the sections, and no other page module draws it', () => {
  const read = (f: string) => readFileSync(join(extDir, 'webview', f), 'utf8');
  assert.match(read('rail.ts'), /el\('nav', 'rail', el\('div', 'brand',[^;]*'No project yet'\)\)\), paletteButton\(\), list,/, 'brand, then the button, then the sections');
  const files = readdirSync(join(extDir, 'webview')).filter((f) => f.endsWith('.ts'));
  assert.ok(files.length > 10, `read ${files.length} page modules`);
  assert.deepEqual(files.filter((f) => read(f).includes('paletteButton(')).sort(), ['palette.ts', 'rail.ts'], 'made by the palette, drawn by the rail, nowhere else');
});
