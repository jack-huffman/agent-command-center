// The Settings section (GH-109): its parts and where each setting lives until it moves there, its place in
// the rail, the theme and the setting that keeps it, and how often the extension refreshes, which it says.
// How agents run (GH-110): each project's builders, reviewers, autonomy and auto-merge, where each is set,
// the commands its Change… buttons run, what agents bill, and the ways other pages open it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { intervalWords, POLL_INTERVALS, POLL_KEYS } from '../src/logic/polls.ts';
import { AREAS } from '../src/model/areas.ts';
import { homeModel, type HomeModel } from '../src/model/home.ts';
import { PAGE_COMMANDS } from '../src/model/messages.ts';
import { agentSettings, area as settingsArea, autoMergeSetting, autonomySetting, howAgentsRun, refreshLines, settingFrom, SETTINGS_PARTS, settingsKey, settingsModel, THEME_CHOICES, THEME_SETTING, themeChoice, THEMES } from '../src/model/settings.ts';
import type { DoctorItem } from '../src/logic/setup.ts';
import type { ProjectLike } from '../src/model/shared.ts';
import { HOME_SECTIONS, VIEW_KINDS, VIEW_TITLES } from '../src/model/shared.ts';
import { openAt, PAGES, sampleModel } from '../scripts/screenshot.ts';
import { hub, manifest, pageSource, root } from './support.ts';

const source = (...path: string[]) => readFileSync(join(root, ...path), 'utf8');

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
  assert.deepEqual(m.nav.at(-1), { section: 'settings', label: 'Settings', icon: 'settings-gear', count: null, attention: false, hint: 'Appearance, how agents run, and where each other setting lives' });
  assert.deepEqual(m.nav.map((n) => n.section), ['overview', 'tasks', 'agents', 'worktrees', 'environments', 'setup', 'settings']);
  const orders = AREAS.flatMap((a) => (a.home ? [a.home.order] : []));
  const own = settingsArea.home!.order;
  assert.ok(AREAS.includes(settingsArea));
  assert.ok(orders.every((o) => o <= own) && orders.filter((o) => o === own).length === 1, 'its turn comes after every other area\'s');
  // The page may ask for the theme, and How agents run's Change… (GH-110): its Refresh is the header's.
  assert.deepEqual(settingsArea.commands, ['acc.settings.theme', 'acc.agents.configure', 'acc.agents.autonomy', 'acc.agents.autoMerge']);
  assert.ok(settingsArea.commands!.every((c) => PAGE_COMMANDS.includes(c)));
  assert.ok(!PAGE_COMMANDS.includes('acc.settings.refresh'));
  assert.match(readFileSync(join(root, 'src', 'panels.ts'), 'utf8'), /settings: \['acc\.settings\.refresh'\]/);
});

test('each part of Settings is built here or says where its settings live today, with a way there', () => {
  const m = home().settings;
  assert.deepEqual(m.parts.map((p) => p.id), [...SETTINGS_PARTS]);
  assert.deepEqual(SETTINGS_PARTS, ['appearance', 'agents', 'limits', 'trackers', 'slack', 'github', 'page', 'about']);
  assert.deepEqual(m.parts.filter((p) => p.built).map((p) => p.id), ['appearance', 'agents'], 'Appearance and How agents run are built');
  for (const p of m.parts) {
    assert.ok(p.title && p.icon && p.summary, `${p.id} has a title, an icon and a summary`);
    assert.equal(!!p.today, !p.built, `${p.id}: ${p.built ? 'built, so nothing about today' : 'says where its settings live today'}`);
    for (const l of p.links) assert.ok((HOME_SECTIONS as readonly string[]).includes(l.section) && l.label && l.icon, `${p.id}'s ${l.label} goes to a section`);
  }
  // Every part not built has a way there, but the limits, set outside the Command Center today.
  assert.deepEqual(m.parts.filter((p) => !p.built && !p.links.length).map((p) => p.id), ['limits']);
  assert.deepEqual(m.themes.map((t) => [t.key, t.label]), [['vscode', 'Match VSCode'], ['light', 'Light'], ['dark', 'Dark']]);
  assert.equal(settingsKey('agents'), 'settings:agents');
});

/** A project with agents' settings: the builder's model this clone's, the reviewer's effort the project's. */
function withAgents(more: Partial<ProjectLike['config']> = {}): ProjectLike {
  const p = hub().projects[0]!;
  return {
    ...p, config: { ...p.config, ...more },
    agents: {
      builder: { model: 'claude-sonnet-5-5', effort: null, fallbackModel: 'claude-haiku-4-5-20251001', from: { model: 'clone', effort: 'default', fallbackModel: 'project' } },
      reviewer: { model: 'claude-opus-5-5', effort: 'high', fallbackModel: null, from: { model: 'acc', effort: 'project', fallbackModel: 'default' } },
    },
  };
}
const billingItem = (status: DoctorItem['status'], detail = 'Agents use your Claude subscription.'): DoctorItem => ({ id: 'A1.claude-billing', part: 'machine', title: 'Agents bill your Claude subscription', status, detail });

test('How agents run says, for each part, its value and where it\'s set, in words with an icon (D-036, D-086)', () => {
  const [builder, reviewer] = agentSettings(withAgents());
  assert.deepEqual([builder!.label, builder!.icon, reviewer!.label, reviewer!.icon], ['Builders', 'tools', 'Reviewers', 'checklist']);
  assert.deepEqual(builder!.parts, [
    { key: 'agents.builder.model', name: 'Model', value: 'claude-sonnet-5-5', from: { label: 'this clone', icon: 'device-desktop' } },
    { key: 'agents.builder.effort', name: 'Effort', value: 'default', from: { label: 'Claude Code\'s default', icon: 'circle-outline' } },
    { key: 'agents.builder.fallbackModel', name: 'Falls back to', value: 'claude-haiku-4-5-20251001', from: { label: 'project default', icon: 'repo' } },
  ]);
  // acc's default model, apart from Claude Code's default effort; no fallback, no line for one.
  assert.deepEqual(reviewer!.parts.map((p) => `${p.name} ${p.value} · ${p.from.label}`), ['Model claude-opus-5-5 · acc\'s default', 'Effort high · project default']);
  // Every source has words and an icon, the clone's and the project's apart.
  for (const f of ['clone', 'project', 'acc', 'default']) assert.ok(settingFrom(f).label && settingFrom(f).icon, f);
  assert.notEqual(settingFrom('clone').icon, settingFrom('project').icon);
  assert.deepEqual(agentSettings(hub().projects[0]!), [], 'a project without its agents\' settings has none');
});

test('How agents run shows the project\'s autonomy, with an icon, and orange for a level autopilot refuses (D-064)', () => {
  const review = autonomySetting(withAgents({ autonomy: 'review' }))!;
  assert.deepEqual([review.look, review.from], [{ label: 'review', icon: 'rocket', tone: 'neutral' }, { label: 'project', icon: 'repo' }]);
  assert.equal(review.meaning, 'Autopilot reviews finished work, lands work whose review passed, re-dispatches a rework once, sends a pull request whose GitHub checks fail back to its builder once a commit, resumes a stopped builder once a run, merges the base into a pull request that conflicts with it, and starts a task a person dispatched once the files it waits for are free. It never merges a pull request.');
  assert.deepEqual(autonomySetting(withAgents({ autonomy: 'manual' })), { key: 'autonomy', look: { label: 'manual', icon: 'debug-pause', tone: 'neutral' }, from: { label: 'project', icon: 'repo' }, meaning: 'Nothing happens on its own.' });
  for (const level of ['dispatch', 'full']) assert.deepEqual(autonomySetting(withAgents({ autonomy: level }))!.look, { label: level, icon: 'warning', tone: 'orange' }, level);
  assert.equal(autonomySetting(withAgents({ autonomy: 'toString' }))!.look.icon, 'question', 'a level acc doesn\'t know has no meaning of another\'s');
  assert.equal(autonomySetting(withAgents()), null, 'no autonomy in the config, no row');
});

test('How agents run has an Auto-merge row: on or off with an icon, what it means, and Change… where it can change (GH-67)', () => {
  const generic = { profile: 'generic', autonomy: 'review' };
  assert.deepEqual(autoMergeSetting(withAgents(generic)), { key: 'autopilot.autoMerge', look: { label: 'off', icon: 'circle-slash', tone: 'neutral' }, from: { label: 'project', icon: 'repo' }, meaning: 'Autopilot never merges a pull request: a person merges each one.', settable: true });
  // Its environments include Production, which is protected.
  const on = withAgents({ ...generic, autopilot: { autoMerge: true } });
  assert.ok(on.config.environments.some((e) => e.name === 'Production' && e.protected));
  assert.deepEqual(autoMergeSetting(on), { key: 'autopilot.autoMerge', look: { label: 'on', icon: 'git-merge', tone: 'neutral' }, from: { label: 'project', icon: 'repo' }, settable: true, meaning: 'A pull request whose review and checks passed, with nothing waiting on you, joins the merge queue, and they merge in turn: its base merged in, the full check run once, then merged once GitHub says it can. Never into Production: protected.' });
  // The autonomy row says when autopilot merges.
  assert.match(autonomySetting(on)!.meaning, /Auto-merge is on: a pull request whose review and checks passed, .* joins the repo's merge queue, .* It never merges into a protected environment\.$/);
  assert.doesNotMatch(autonomySetting(on)!.meaning, /It never merges a pull request/);
  assert.match(autoMergeSetting(withAgents({ ...generic, autonomy: 'manual', autopilot: { autoMerge: true } }))!.meaning, /Autonomy is manual, so nothing merges on its own\.$/);
  // A Salesforce project never auto-merges, so there's nothing to change.
  assert.deepEqual(autoMergeSetting(withAgents({ autonomy: 'review' })), { key: 'autopilot.autoMerge', look: { label: 'off', icon: 'circle-slash', tone: 'neutral' }, from: { label: 'project', icon: 'repo' }, meaning: 'A Salesforce project never auto-merges: a person merges every pull request.', settable: false });
});

test('How agents run names each project, and says once what this machine\'s agents bill, blue or orange, with a way to fix it (D-036)', () => {
  const portal: ProjectLike = { ...withAgents({ autonomy: 'review' }), name: 'Portal', root: '/p' };
  const run = howAgentsRun([withAgents({ autonomy: 'manual' }), hub().projects[0]!, portal], [billingItem('pass')]);
  // Every project with agents' settings, under its own name; one without them isn't listed.
  assert.deepEqual(run.projects.map((p) => [p.project, p.root, p.roles.length, p.autonomy?.look.label]), [['Acme', '/r', 2, 'manual'], ['Portal', '/p', 2, 'review']]);
  const toSetup = { label: 'Open Setup', icon: 'checklist', section: 'setup' };
  assert.deepEqual(run.billing, { look: { label: 'Agents use your Claude subscription', icon: 'pass', tone: 'blue' }, link: null });
  assert.deepEqual(howAgentsRun([], [billingItem('fail', 'Agents would bill per token: ANTHROPIC_API_KEY in the environment.')]).billing,
    { look: { label: 'Per-token billing: Agents would bill per token: ANTHROPIC_API_KEY in the environment.', icon: 'warning', tone: 'orange' }, link: toSetup });
  for (const items of [[], [billingItem('skip')]]) assert.deepEqual(howAgentsRun([], items).billing, { look: { label: 'Not checked yet: Setup checks it', icon: 'circle-outline', tone: 'neutral' }, link: toSetup });
});

test('How agents run is a built part, or says no project is onboarded yet, with a way to Setup', () => {
  const part = (projects: ProjectLike[]) => settingsModel({ theme: 'vscode', projects, setup: [] }).parts.find((p) => p.id === 'agents')!;
  const some = part([withAgents({ autonomy: 'review' })]);
  assert.deepEqual([some.built, some.today, some.links], [true, null, []]);
  assert.match(some.summary, /Each Change… asks acc to make the change\.$/);
  assert.deepEqual(some.details, ['This clone\'s choice is kept in its git config, where nobody else sees it. A project\'s is kept in its .acc/config.json, for you to commit and share.']);
  const none = part([]);
  assert.deepEqual([none.built, none.links], [true, [{ label: 'Open Setup', icon: 'checklist', section: 'setup' }]]);
  assert.match(none.details[0]!, /^No project in this workspace is onboarded yet\./);
  // The Command Center passes the hub's projects and Setup's checks.
  assert.match(source('src', 'model', 'home.ts'), /settingsModel\(\{ theme: i\.theme \?\? 'vscode', projects: hub\.projects, setup: i\.setup\.items \}\)/);
});

test('each Change… asks acc through a command the page may ask for, named for what and whose it changes (D-064)', () => {
  const page = pageSource('settings.ts');
  assert.ok(page.includes("argButton('acc.agents.configure', 'Change…', 'edit', `${r.role}|${s.root}`)"));
  assert.ok(page.includes("argButton('acc.agents.autonomy', 'Change…', 'edit', s.root)"));
  assert.ok(page.includes("s.autoMerge.settable ? argButton('acc.agents.autoMerge', 'Change…', 'edit', s.root) : null"), 'none where it can\'t change');
  assert.ok(page.includes("change.setAttribute('aria-label', `Change ${changes}`)") && page.includes('in ${s.project}`'), 'each names its project');
  assert.ok(page.includes("box.append(el('h3', 'settings-project-name', icon('repo'), el('span', '', s.project)))"), 'each project under its name');
  // The page writes no file, and asks for nothing but its commands and a section to go to.
  assert.doesNotMatch(page, /writeFile|config\.json'|fs\./);
  // The extension runs acc for each: this clone's git config, or the project's .acc/config.json.
  const agents = source('src', 'agents.ts');
  for (const [id, fn] of [['acc.agents.configure', 'configureAgents'], ['acc.agents.autonomy', 'configureAutonomy'], ['acc.agents.autoMerge', 'configureAutoMerge']]) {
    assert.ok(agents.includes(`reg('${id}', (arg?: unknown) => this.${fn}(arg))`), `${id} is registered`);
    assert.ok(manifest.contributes.commands.some((c: { command: string }) => c.command === id), `${id} is contributed`);
  }
  assert.match(agents, /this\.runAcc\(project, \['agents', 'set', role, \.\.\.args, \.\.\.\(scope\.project \? \['--project'\] : \[\]\)\]/);
  assert.match(agents, /this\.runAcc\(project, \['agents', 'autonomy', pick\.value\]/);
  assert.match(agents, /this\.runAcc\(project, \['agents', 'auto-merge', pick\.value\]/);
  // Billing's way to Setup is a section to go to, as every part's link is.
  assert.ok(page.includes('b.link ? linkButton(b.link) : null') && page.includes('button(l.label, l.icon, () => go(l.section))'));
});

test('Agents\' Settings button and the status bar\'s Auto-merge open Settings at How agents run (D-089)', () => {
  assert.match(source('src', 'notices.ts'), /go: \(\) => panels\.show\('settings', settingsKey\('agents'\)\)/);
  assert.equal(pageSource('agents.ts').match(/const HOW_AGENTS_RUN = '([^']+)'/)?.[1], settingsKey('agents'));
  // The page goes to a part's heading as the extension asks, or as a button of its own does.
  const state = pageSource('state.ts');
  assert.ok(state.includes('if (!part || !jumpTo(part))') && state.includes('[data-part="${CSS.escape(part)}"]'));
  // Under 820 px the rail is a sticky strip: the heading stops below it, not under it.
  assert.ok(state.includes("getComputedStyle(rail).position === 'sticky'") && state.includes('heading.style.scrollMarginTop = strip ?'));
  assert.match(source('webview', 'styles.css'), /\.rail \{[^}]*position: sticky; top: 0;/, 'the strip the jump allows for');
  assert.ok(pageSource('main.ts').includes('if (msg.open) jumpTo(msg.open);'));
  // Autopilot's own words send you there too.
  assert.equal((source('src', 'autopilot.ts').match(/Change it in Settings, under How agents run\./g) ?? []).length, 2);
});

test('the screenshots show How agents run with every state: two projects, each source, both autonomies, auto-merge on and off, per-token billing', () => {
  assert.ok(PAGES.includes('settings-agents') && PAGES.includes('agents-billing'));
  assert.deepEqual([openAt('settings-agents'), openAt('settings')], ['settings:agents', null], 'opened at its heading, as the status bar opens it');
  const m = (sampleModel('settings-agents') as HomeModel);
  assert.equal(m.section, 'settings');
  const run = m.settings.agents;
  assert.deepEqual(run.projects.map((p) => p.project), ['Acme Service', 'Acme Portal']);
  const froms = new Set(run.projects.flatMap((p) => p.roles.flatMap((r) => r.parts.map((x) => x.from.label))));
  for (const f of ['this clone', 'project default', 'acc\'s default', 'Claude Code\'s default']) assert.ok(froms.has(f), f);
  assert.deepEqual(run.projects.map((p) => [p.autonomy?.look.label, p.autoMerge?.look.label, p.autoMerge?.settable]), [['review', 'off', false], ['manual', 'on', true]]);
  assert.deepEqual([run.billing.look.tone, run.billing.link?.section], ['orange', 'setup']);
  assert.deepEqual([(sampleModel('settings') as HomeModel).settings.agents.billing.look.tone, (sampleModel('agents-billing') as HomeModel).agents.billing?.tone], ['blue', 'orange']);
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
  assert.ok(pageSource('state.ts').includes('[data-part="${CSS.escape(part)}"]'), 'a jump that names a part goes to its heading');
  // The theme's buttons ask for the command the page may ask for, with the choice.
  assert.ok(page.includes("{ type: 'toolbar', command: 'acc.settings.theme', arg: key }"));
});
