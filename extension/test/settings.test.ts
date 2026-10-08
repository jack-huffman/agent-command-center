// The Settings section (GH-109): its parts and where each setting lives until it moves there, its place in
// the rail, the theme and the setting that keeps it, and how often the extension refreshes, which it says.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { intervalWords, POLL_INTERVALS, POLL_KEYS } from '../src/logic/polls.ts';
import { AGENT_SETTINGS } from '../src/model/agents.ts';
import { AREAS } from '../src/model/areas.ts';
import { homeModel, type HomeModel } from '../src/model/home.ts';
import { PAGE_COMMANDS } from '../src/model/messages.ts';
import { area as settingsArea, refreshLines, SETTINGS_PARTS, settingsKey, settingsModel, THEME_CHOICES, THEME_SETTING, themeChoice, THEMES } from '../src/model/settings.ts';
import { HOME_SECTIONS, VIEW_KINDS, VIEW_TITLES } from '../src/model/shared.ts';
import { sampleModel } from '../scripts/screenshot.ts';
import { hub, manifest, pageSource, root } from './support.ts';

const home = (theme?: 'vscode' | 'light' | 'dark') => homeModel({ hub: hub(), section: 'settings', boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set() }, ...(theme ? { theme } : {}) });

test('the theme is Match VSCode, Light or Dark, and anything else is Match VSCode', () => {
  assert.deepEqual(THEME_CHOICES, ['vscode', 'light', 'dark']);
  for (const t of THEME_CHOICES) assert.equal(themeChoice(t), t);
  for (const v of ['blue', 'Light', '', undefined, null, 1, '__proto__', 'toString', {}]) assert.equal(themeChoice(v), 'vscode', String(v));
  assert.deepEqual(THEME_CHOICES.map((t) => THEMES[t].label), ['Match VSCode', 'Light', 'Dark']);
  for (const t of THEME_CHOICES) assert.ok(THEMES[t].icon && THEMES[t].meaning, `${t} has an icon and says what it does`);
  // The page can't import the model's values, so its own list is checked against them by its type and here.
  const page = pageSource('theme.ts');
  assert.deepEqual([.../const CHOICES: Record<ThemeChoice, true> = \{ ([^}]*) \}/.exec(page)![1]!.matchAll(/(\w+): true/g)].map((m) => m[1]), [...THEME_CHOICES]);
});

test('the theme is a VSCode setting kept on this machine, Match VSCode until changed', () => {
  const s = manifest.contributes.configuration.properties[`${THEME_SETTING.section}.${THEME_SETTING.key}`];
  assert.deepEqual([s.type, s.enum, s.default, s.scope, s.enumDescriptions.length], ['string', [...THEME_CHOICES], 'vscode', 'machine', 3]);
  assert.equal(home().settings.theme, 'vscode');
  assert.equal(home('dark').settings.theme, 'dark');
});

test('Settings is a section like the others, last in the rail with a gear', () => {
  assert.deepEqual([VIEW_KINDS.at(-1), VIEW_TITLES.settings, HOME_SECTIONS.includes('settings')], ['settings', 'Settings', true]);
  const m = home();
  assert.deepEqual(m.nav.at(-1), { section: 'settings', label: 'Settings', icon: 'settings-gear', count: null, attention: false, hint: 'Appearance, and where each other setting lives' });
  assert.deepEqual(m.nav.map((n) => n.section), ['overview', 'tasks', 'agents', 'worktrees', 'environments', 'setup', 'settings']);
  const orders = AREAS.flatMap((a) => (a.home ? [a.home.order] : []));
  const own = settingsArea.home!.order;
  assert.ok(AREAS.includes(settingsArea));
  assert.ok(orders.every((o) => o <= own) && orders.filter((o) => o === own).length === 1, 'its turn comes after every other area\'s');
  // The page may ask for the theme, and nothing else of Settings' yet: its Refresh is the header's.
  assert.ok(PAGE_COMMANDS.includes('acc.settings.theme'));
  assert.ok(!PAGE_COMMANDS.includes('acc.settings.refresh'));
  assert.match(readFileSync(join(root, 'src', 'panels.ts'), 'utf8'), /settings: \['acc\.settings\.refresh'\]/);
});

test('each part of Settings is built here or says where its settings live today, with a way there', () => {
  const m = home().settings;
  assert.deepEqual(m.parts.map((p) => p.id), [...SETTINGS_PARTS]);
  assert.deepEqual(SETTINGS_PARTS, ['appearance', 'agents', 'limits', 'trackers', 'slack', 'github', 'page', 'about']);
  assert.deepEqual(m.parts.filter((p) => p.built).map((p) => p.id), ['appearance'], 'Appearance is the only part built yet');
  for (const p of m.parts) {
    assert.ok(p.title && p.icon && p.summary, `${p.id} has a title, an icon and a summary`);
    assert.equal(!!p.today, !p.built, `${p.id}: ${p.built ? 'built, so nothing about today' : 'says where its settings live today'}`);
    for (const l of p.links) assert.ok((HOME_SECTIONS as readonly string[]).includes(l.section) && l.label && l.icon, `${p.id}'s ${l.label} goes to a section`);
  }
  // Every part not built has a way there, but the limits, set outside the Command Center today, and How
  // agents run while no project has its settings (this hub's project has none).
  assert.deepEqual(m.parts.filter((p) => !p.built && !p.links.length).map((p) => p.id), ['agents', 'limits']);
  assert.deepEqual(m.themes.map((t) => [t.key, t.label]), [['vscode', 'Match VSCode'], ['light', 'Light'], ['dark', 'Dark']]);
  assert.equal(settingsKey('agents'), 'settings:agents');
});

test('How agents run opens on Agents with its settings open, once there\'s a project for them', () => {
  const none = settingsModel({ theme: 'vscode', agentSettings: false }).parts.find((p) => p.id === 'agents')!;
  assert.deepEqual([none.links, /once this workspace has an onboarded project/.test(none.today!)], [[], true]);
  const sample = (sampleModel('settings') as HomeModel).settings.parts.find((p) => p.id === 'agents')!;
  assert.deepEqual(sample.links, [{ label: 'Open How agents run', icon: 'settings-gear', section: 'agents', open: AGENT_SETTINGS }]);
});

test('the Command Center part says how often it refreshes, from the numbers the extension polls by', () => {
  assert.deepEqual([...POLL_KEYS], ['tasks', 'jobs', 'agents', 'worktrees', 'boards', 'prs']);
  assert.deepEqual([3_000, 59_000, 60_000, 90_000, 300_000].map(intervalWords), ['3 s', '59 s', '1 min', '1 min 30 s', '5 min']);
  const lines = refreshLines();
  assert.equal(lines.length, POLL_KEYS.length);
  assert.equal(lines[0], 'Tasks: every 3 s while the Command Center is on screen, every 15 s while it isn\'t.');
  assert.equal(lines[3], 'Worktrees: every 15 s while the Command Center is on screen, not at all while it isn\'t.');
  assert.deepEqual(home().settings.parts.find((p) => p.id === 'page')!.details, lines);
  // extension.ts polls by these and no number of its own.
  const ext = readFileSync(join(root, 'src', 'extension.ts'), 'utf8');
  assert.match(ext, /POLL_INTERVALS\[key\]\.everyMs : POLL_INTERVALS\[key\]\.hiddenMs/);
  assert.doesNotMatch(ext, /everyMs: \d/);
  assert.ok(POLL_KEYS.every((k) => POLL_INTERVALS[k].everyMs > 0));
});

test('the page draws each part under a heading another page can open Settings at', () => {
  const page = pageSource('settings.ts');
  assert.ok(page.includes('h.id = `settings-${p.id}`') && page.includes('h.dataset.part = `settings:${p.id}`') && page.includes('h.tabIndex = -1'));
  assert.ok(pageSource('main.ts').includes('[data-part="${CSS.escape(part)}"]'), 'a jump that names a part goes to its heading');
  // The theme's buttons ask for the command the page may ask for, with the choice.
  assert.ok(page.includes("{ type: 'toolbar', command: 'acc.settings.theme', arg: key }"));
});
