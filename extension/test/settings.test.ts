// The Settings section (GH-109): its parts and where each setting lives until it moves there, its place in
// the rail, the theme and the setting that keeps it, and how often the extension refreshes, which it says.
// How agents run (GH-110): each project's builders, reviewers, autonomy and auto-merge, where each is set,
// the commands its Change… buttons run, what agents bill, and the ways other pages open it. Limits and
// checks (GH-111) has its own tests, in limits.test.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { intervalWords, POLL_INTERVALS, POLL_KEYS } from '../src/logic/polls.ts';
import { AREAS } from '../src/model/areas.ts';
import { homeModel, type HomeModel } from '../src/model/home.ts';
import { PAGE_COMMANDS } from '../src/model/messages.ts';
import { agentSettings, area as settingsArea, autoMergeSetting, autonomySetting, GH_SIGN_IN_KEPT, howAgentsRun, refreshLines, settingFrom, SETTINGS_PARTS, settingsKey, settingsModel, SIGN_IN_KEPT, THEME_CHOICES, THEME_SETTING, themeChoice, THEMES, trackerSetting, trackersAndSignIns } from '../src/model/settings.ts';
import { area as boardsArea, type BoardInput } from '../src/model/boards.ts';
import type { DoctorItem } from '../src/logic/setup.ts';
import type { ProjectLike } from '../src/model/shared.ts';
import { HOME_SECTIONS, VIEW_KINDS, VIEW_TITLES } from '../src/model/shared.ts';
import { COLOUR_PAGES, openAt, PAGE_HEIGHT, PAGES, sampleModel } from '../scripts/screenshot.ts';
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
  assert.deepEqual(m.nav.at(-1), { section: 'settings', label: 'Settings', icon: 'settings-gear', count: null, attention: false, hint: 'Appearance, how agents run, limits and checks, trackers and sign-ins, and where each other setting lives' });
  assert.deepEqual(m.nav.map((n) => n.section), ['overview', 'tasks', 'agents', 'worktrees', 'environments', 'setup', 'settings']);
  const orders = AREAS.flatMap((a) => (a.home ? [a.home.order] : []));
  const own = settingsArea.home!.order;
  assert.ok(AREAS.includes(settingsArea));
  assert.ok(orders.every((o) => o <= own) && orders.filter((o) => o === own).length === 1, 'its turn comes after every other area\'s');
  // The page may ask for the theme, How agents run's Change… (GH-110) and a tracker's Sign out (GH-112), and
  // Limits and checks' changes, which the limits area asks for (GH-111): its Refresh is the header's.
  assert.deepEqual(settingsArea.commands, ['acc.settings.theme', 'acc.agents.configure', 'acc.agents.autonomy', 'acc.agents.autoMerge', 'acc.trackers.signOut']);
  assert.ok(settingsArea.commands!.every((c) => PAGE_COMMANDS.includes(c)));
  assert.ok(!PAGE_COMMANDS.includes('acc.settings.refresh'));
  assert.match(readFileSync(join(root, 'src', 'panels.ts'), 'utf8'), /settings: \['acc\.settings\.refresh'\]/);
});

test('each part of Settings is built here or says where its settings live today, with a way there', () => {
  const m = home().settings;
  assert.deepEqual(m.parts.map((p) => p.id), [...SETTINGS_PARTS]);
  assert.deepEqual(SETTINGS_PARTS, ['appearance', 'agents', 'limits', 'trackers', 'slack', 'github', 'page', 'about']);
  assert.deepEqual(m.parts.filter((p) => p.built).map((p) => p.id), ['appearance', 'agents', 'limits', 'trackers'], 'Appearance, How agents run, Limits and checks (GH-111), and Trackers and sign-ins (GH-112) are built');
  for (const p of m.parts) {
    assert.ok(p.title && p.icon && p.summary, `${p.id} has a title, an icon and a summary`);
    assert.equal(!!p.today, !p.built, `${p.id}: ${p.built ? 'built, so nothing about today' : 'says where its settings live today'}`);
    for (const l of p.links) assert.ok((HOME_SECTIONS as readonly string[]).includes(l.section) && l.label && l.icon, `${p.id}'s ${l.label} goes to a section`);
  }
  // Every part not built has a way there. Limits and checks are here, though this hub reads none, so the
  // part says it's reading (GH-111).
  assert.deepEqual(m.parts.filter((p) => !p.built && !p.links.length).map((p) => p.id), []);
  assert.equal(m.limits, null);
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
  // The Command Center passes the hub's projects, Setup's checks, the limits while Settings shows (GH-111) and what the trackers' boards know.
  assert.match(source('src', 'model', 'home.ts'), /settingsModel\(\{ theme: i\.theme \?\? 'vscode', projects: hub\.projects, setup: i\.setup\.items, limits: .*, boards: i\.boards \}\)/);
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

// ---------------------------------------------------------------- Trackers and sign-ins (GH-112)

/** A tracker's board as the extension knows it, with nothing read yet. */
const tracked = (index: number, kind: BoardInput['kind'], title: string, more: Partial<BoardInput> = {}): BoardInput => ({
  index, kind, title, board: null, error: null, connect: null, loading: false, signedInAs: null, signInScope: null, ...more,
});
const ACME = { root: '/r', name: 'Acme' };
const read = (title: string): NonNullable<BoardInput['board']> => ({ source: 'jira-board', title, url: null, notice: null, columns: [], cards: [] });
const wantsSignIn = { command: 'acc.trackers.signIn', label: 'Sign in to Jira', arg: '{}' };

test('each tracker says its kind, place and board, and who it signs in as, for every project on its site or this one only (D-072, D-091)', () => {
  const shared = trackerSetting(tracked(0, 'jira', 'Jira · ACME', { signedInAs: 'jordan@acme.example', signInScope: { shared: true, host: 'acme.atlassian.net' }, place: 'Jira · ACME · epic ACME-3 Premium Support', board: read('ACME board') }), ACME);
  assert.deepEqual([shared.kind, shared.name, shared.icon, shared.title, shared.place], ['jira', 'Jira', 'issues', 'Jira · ACME', 'Jira · ACME · epic ACME-3 Premium Support']);
  assert.deepEqual(shared.board, { label: 'ACME board', icon: 'project', tone: 'neutral' });
  assert.deepEqual(shared.signIn, { label: 'Signed in as jordan@acme.example, for every project on acme.atlassian.net', icon: 'globe', tone: 'blue' });
  // Where each is kept: the place and board in the project's .acc/config.json, the sign-in in VSCode here.
  assert.deepEqual([shared.from, shared.signInFrom], [{ label: 'project', icon: 'repo' }, SIGN_IN_KEPT]);
  assert.deepEqual(SIGN_IN_KEPT, { label: 'VSCode on this machine', icon: 'key' });

  const own = trackerSetting(tracked(1, 'azure', 'Azure DevOps · CRM', { signedInAs: 'jordan@acme.example', signInScope: { shared: false, host: 'acme' }, loading: true }), ACME);
  assert.deepEqual([own.name, own.icon, own.place], ['Azure DevOps', 'azure-devops', 'Azure DevOps · CRM'], 'no place yet: its title');
  assert.deepEqual(own.signIn, { label: 'Signed in as jordan@acme.example, for this project only', icon: 'repo', tone: 'blue' });
  assert.deepEqual(own.board, { label: 'Reading it', icon: 'sync~spin', tone: 'blue' });

  // Not signed in, or signed in and refused: orange, with what's wrong, and the board doesn't say it twice.
  const none = trackerSetting(tracked(2, 'monday', 'monday.com · acme', { error: 'Sign in to monday.com (acme) for this repo to see its board and items.', connect: wantsSignIn }), ACME);
  assert.deepEqual([none.name, none.signIn, none.board], ['monday.com', { label: 'Not signed in', icon: 'plug', tone: 'orange' }, { label: 'Shows once it\'s signed in', icon: 'circle-outline', tone: 'neutral' }]);
  const refused = trackerSetting(tracked(3, 'jira', 'Jira · GLX', { signedInAs: 'jordan@globex.example', signInScope: { shared: false, host: 'globex.atlassian.net' }, error: 'Jira refused the email and API token.', connect: wantsSignIn }), ACME);
  assert.deepEqual(refused.signIn, { label: 'Signed in as jordan@globex.example, for this project only, but it didn\'t work: Jira refused the email and API token.', icon: 'warning', tone: 'orange' });
  assert.deepEqual(refused.board, { label: 'Shows once its sign-in works', icon: 'circle-outline', tone: 'neutral' });
  // Signed in, a board that can't be read for another reason says why in orange.
  const down = trackerSetting(tracked(4, 'jira', 'Jira · OPS', { signedInAs: 'jordan@acme.example', signInScope: { shared: true, host: 'acme.atlassian.net' }, error: 'Jira didn\'t answer.' }), ACME);
  assert.deepEqual([down.signIn.tone, down.board], ['blue', { label: 'Couldn\'t read it: Jira didn\'t answer.', icon: 'warning', tone: 'orange' }]);
  assert.deepEqual(trackerSetting(tracked(5, 'jira', 'Jira · NEW', { signedInAs: 'jordan@acme.example', signInScope: { shared: true, host: 'a' } }), ACME).board, { label: 'Not read yet', icon: 'circle-outline', tone: 'neutral' });

  // GitHub signs in through gh, as the project's account (D-007), which gh keeps.
  const gh = trackerSetting(tracked(6, 'github', 'GitHub · acme/service', { signedInAs: 'jordan-kim', board: read('Issues · acme/service') }), ACME);
  assert.deepEqual([gh.name, gh.icon, gh.signIn, gh.signInFrom], ['GitHub Issues', 'github', { label: 'Signs in through gh as jordan-kim, the project\'s GitHub account', icon: 'github', tone: 'blue' }, GH_SIGN_IN_KEPT]);
  assert.deepEqual(GH_SIGN_IN_KEPT, { label: 'gh on this machine', icon: 'terminal' });
  assert.deepEqual(trackerSetting(tracked(7, 'github', 'GitHub · ?', { error: 'gh isn\'t logged in as jordan-kim. Run: gh auth login' }), ACME).signIn, { label: 'gh isn\'t logged in as jordan-kim. Run: gh auth login', icon: 'warning', tone: 'orange' });
  assert.equal(trackerSetting(tracked(11, 'github', 'GitHub · ?', { error: 'A GitHub tracker needs the project\'s "github" section (repo and account) in .acc/config.json.' }), ACME).signIn.tone, 'orange', 'no account named: the sign-in\'s');
  // A GitHub outage, or a repo gh can't read, is the board's, not a sign-in that failed.
  const ghDown = trackerSetting(tracked(9, 'github', 'GitHub · acme/gone', { signedInAs: 'jordan-kim', error: 'Could not resolve to a Repository with the name acme/gone.' }), ACME);
  assert.deepEqual([ghDown.signIn.tone, ghDown.board], ['blue', { label: 'Couldn\'t read it: Could not resolve to a Repository with the name acme/gone.', icon: 'warning', tone: 'orange' }]);
  // Its credentials not read yet: checking, in blue, and Sign in isn't pressed on it.
  const checking = trackerSetting(tracked(10, 'jira', 'Jira · NEW', { loading: true }), ACME);
  assert.deepEqual(checking.signIn, { label: 'Checking its sign-in', icon: 'sync~spin', tone: 'blue' });
  assert.ok(!checking.actions.some((x) => x.primary), 'no button leads while it checks');
  assert.deepEqual(trackerSetting(tracked(8, 'github', 'GitHub · ?'), ACME).signIn, { label: 'No GitHub account: the project\'s "github" section names none', icon: 'warning', tone: 'orange' });

  // Every state has words and an icon, and colour only adds to them: blue or orange, never red or green.
  for (const t of [shared, own, none, refused, down, gh]) {
    for (const l of [t.board, t.signIn]) assert.ok(l.label && l.icon && ['blue', 'orange', 'neutral'].includes(l.tone), JSON.stringify(l));
  }
});

test('each tracker\'s buttons are commands the page may ask for, with its tracker, named for whose they are; Sign out says why it can\'t (GH-112)', () => {
  const t = trackerSetting(tracked(1, 'jira', 'Jira · ACME', { signedInAs: 'jordan@acme.example', signInScope: { shared: true, host: 'acme.atlassian.net' } }), ACME);
  assert.deepEqual(t.actions.map((a) => [a.command, a.label, a.icon, a.primary, a.disabled]), [
    ['acc.trackers.signIn', 'Sign in again', 'sign-in', false, null],
    ['acc.trackers.signOut', 'Sign out', 'sign-out', false, null],
    ['acc.trackers.add', 'Change place…', 'edit', false, null],
  ]);
  // Each takes its tracker as the commands parse it: the project's root and its place in the list.
  for (const a of t.actions) assert.deepEqual(JSON.parse(a.arg!), { root: '/r', index: 1 });
  assert.deepEqual(t.actions.map((a) => a.name), ['Sign in again to Jira · ACME, in Acme', 'Sign out of Jira · ACME, in Acme', 'Change where Jira · ACME, in Acme gets its tickets, and its board']);
  // Not signed in: Sign in leads, and Sign out can't be used, and says why.
  const none = trackerSetting(tracked(0, 'jira', 'Jira · ACME', { error: 'Sign in to Jira (acme.atlassian.net) for this repo to see its board and tickets.', connect: wantsSignIn }), ACME);
  assert.deepEqual(none.actions.map((a) => [a.label, a.primary, a.disabled]), [['Sign in', true, null], ['Sign out', false, 'It isn\'t signed in, so there\'s nothing to sign out of.'], ['Change place…', false, null]]);
  const refused = trackerSetting(tracked(0, 'jira', 'Jira · ACME', { signedInAs: 'j', signInScope: { shared: false, host: 'a' }, error: 'Jira refused it.', connect: wantsSignIn }), ACME);
  assert.deepEqual(refused.actions.map((a) => [a.label, a.primary, a.disabled]), [['Sign in again', true, null], ['Sign out', false, null], ['Change place…', false, null]]);
  // GitHub signs in through gh, so it has its place to change and nothing else.
  assert.deepEqual(trackerSetting(tracked(0, 'github', 'GitHub · o/r', { signedInAs: 'me' }), ACME).actions.map((a) => a.command), ['acc.trackers.add']);

  // The page may ask for each: Sign out is drawn only here, Sign in and Change place on the boards too.
  for (const c of ['acc.trackers.signIn', 'acc.trackers.signOut', 'acc.trackers.add']) assert.ok(PAGE_COMMANDS.includes(c), c);
  assert.ok(boardsArea.commands!.includes('acc.trackers.signIn') && boardsArea.commands!.includes('acc.trackers.add') && !boardsArea.commands!.includes('acc.trackers.signOut'));
  // Each is registered and contributed, and takes its tracker as the page sends it.
  const trackers = source('src', 'trackers.ts');
  for (const c of ['acc.trackers.signIn', 'acc.trackers.signOut', 'acc.trackers.add']) {
    assert.ok(trackers.includes(`reg('${c}'`), `${c} is registered`);
    assert.ok(manifest.contributes.commands.some((x: { command: string }) => x.command === c), `${c} is contributed`);
  }
  assert.ok(trackers.includes("reg('acc.trackers.signOut', async (arg?: unknown) => { await trackers.signOut(arg); await setup.recheck('B14.tickets'); });"));
  assert.ok(trackers.includes('const { root, index } = JSON.parse(arg) as { root: string; index: number };'), 'Sign in and Sign out find the tracker it names');
  assert.ok(trackers.includes("index: Number.isInteger(a?.index) ? a!.index as number : undefined"), 'Change place opens that tracker on the Connect page');
  // Sign out asks about a site's sign-in, this project or every project (D-091), and nothing writes a file.
  assert.ok(trackers.includes('signOutPlan(was, p, t.kind, host,'));
  assert.doesNotMatch(trackers, /writeFileSync\(join\(root, '\.acc'|config\.json'\)/);
});

test('Trackers and sign-ins lists every open project under its name, says when one has none or is still being read, and offers Connect a tracker (GH-112)', () => {
  const p = (name: string, root: string, trackers: { kind: 'jira'; project: string; prefix: null }[] = []): ProjectLike => ({ ...hub().projects[0]!, name, root, config: { ...hub().projects[0]!.config, trackers } });
  const boards = (root: string): BoardInput[] => (root === '/a' ? [tracked(0, 'jira', 'Jira · ACME', { signedInAs: 'j', signInScope: { shared: true, host: 'acme.atlassian.net' } }), tracked(1, 'github', 'GitHub · o/r', { signedInAs: 'me' })] : []);
  const t = trackersAndSignIns([p('Acme', '/a'), p('Portal', '/b'), p('Billing', '/c', [{ kind: 'jira', project: 'BIL', prefix: null }])], boards);
  assert.deepEqual(t.projects.map((x) => [x.project, x.root, x.trackers.map((y) => y.title), x.loading]), [
    ['Acme', '/a', ['Jira · ACME', 'GitHub · o/r'], false], ['Portal', '/b', [], false], ['Billing', '/c', [], true],
  ], 'every project under its name: one with no tracker, and one whose trackers haven\'t been read yet');
  assert.deepEqual(t.connect, { command: 'acc.trackers.add', label: 'Connect a tracker…', icon: 'add', arg: null, name: 'Connect a tracker to a project', primary: false, disabled: null }, 'the Connect page asks which project');
  assert.equal(trackersAndSignIns([], boards).connect, null, 'with no project, nothing to connect to');

  const part = (projects: ProjectLike[]) => settingsModel({ theme: 'vscode', projects, setup: [], boards }).parts.find((x) => x.id === 'trackers')!;
  const some = part([p('Acme', '/a')]);
  assert.deepEqual([some.built, some.today, some.links, some.title, some.icon], [true, null, [], 'Trackers and sign-ins', 'issues']);
  assert.match(some.details[0]!, /Change place… and Connect a tracker ask acc to write it, for you to commit\. A Jira, Azure DevOps or monday\.com sign-in stays in VSCode on this machine, never in a file; GitHub's is gh's\.$/);
  const none = part([]);
  assert.deepEqual(none.links, [{ label: 'Open Setup', icon: 'checklist', section: 'setup' }]);
  assert.match(none.details[0]!, /^No project in this workspace is onboarded yet\./);
  assert.equal(settingsModel({ theme: 'vscode', projects: [p('Acme', '/a')], setup: [] }).trackers.projects[0]!.trackers.length, 0, 'no boards given, none listed');
});

test('the page draws each tracker under its project, its buttons named for whose they are, and one it can\'t use says why (GH-112)', () => {
  const page = pageSource('settings.ts');
  assert.ok(page.includes("if (p.id === 'trackers') part.append(...trackersPart(m));"));
  assert.ok(page.includes("box.append(el('h3', 'settings-project-name', icon('repo'), el('span', '', p.project)));"), 'each project under its name');
  assert.ok(page.includes("b.setAttribute('aria-label', a.name);") && page.includes('b.title = a.disabled;') && page.includes("b.setAttribute('aria-description', a.disabled);"));
  assert.ok(page.includes('a.arg === null ? toolbarButton(a.command, a.label, a.icon, undefined, a.primary) : argButton(a.command, a.label, a.icon, a.arg, a.primary)'));
  for (const name of ['Place', 'Board', 'Sign-in']) assert.ok(page.includes(`line('${name}', `), name);
  assert.ok(page.includes("{ label: 'Reading its trackers', icon: 'sync~spin', tone: 'blue' }") && page.includes("{ label: 'No tracker yet', icon: 'circle-outline', tone: 'neutral' }"));
  assert.doesNotMatch(page, /writeFile|config\.json'|fs\./, 'the page writes no file');
  // Opened from Settings, the Connect page's Back and Save come back to this part.
  assert.ok(pageSource('connect.ts').includes('m.back.part ? go(m.back.section, m.back.part)'));
  assert.ok(source('src', 'extension.ts').includes("if (settings) panels.show('settings', settingsKey('trackers'));"));
});

test('the screenshots show Trackers and sign-ins with a tracker in every state, opened at its heading (GH-112)', () => {
  assert.ok(PAGES.includes('settings-trackers') && COLOUR_PAGES.includes('settings-trackers'));
  assert.equal(openAt('settings-trackers'), 'settings:trackers');
  assert.ok((PAGE_HEIGHT['settings-trackers'] ?? 0) >= 4000, 'tall enough not to scroll at 500 px');
  const m = (sampleModel('settings-trackers') as HomeModel);
  assert.equal(m.section, 'settings');
  const t = m.settings.trackers;
  assert.deepEqual(t.projects.map((p) => [p.project, p.trackers.map((x) => x.kind)]), [['Acme Service', ['jira', 'monday']], ['Acme Portal', ['github', 'azure', 'jira']]]);
  const all = t.projects.flatMap((p) => p.trackers);
  assert.deepEqual(all.map((x) => `${x.signIn.icon} ${x.signIn.tone}`), ['globe blue', 'plug orange', 'github blue', 'repo blue', 'warning orange'], 'shared, none, gh, this project only, refused');
  assert.deepEqual(all.map((x) => x.board.icon), ['project', 'circle-outline', 'project', 'sync~spin', 'circle-outline'], 'read, waiting for a sign-in, reading');
  assert.ok(all.some((x) => x.actions.some((a) => a.disabled)), 'a Sign out it can\'t use');
  assert.ok(t.connect);
});
