// Loads the built extension with a stand-in for the vscode API, so activation, commands and context
// keys are tested without a VSCode window. Run after npm run build.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../src/logic/setup.ts';
import { makeRepo, tempDir } from '../../packages/core/test/support.ts';
import { slackApp, SlackClient } from '../../packages/core/src/trackers/slack.ts';
import { updatePoster } from '../src/model/updates.ts';
import { activate, fakeVscode, SANDBOX_TOOLS, sandboxEnv, until } from './vscode.ts';

test('sandboxEnv points the environment at a sandbox of stand-in tools, and restore gives it back; edge case: a variable it added is dropped (T-70)', () => {
  const before = { ...process.env };
  process.env.ACC_ROLE = 'builder';
  const { at, restore } = sandboxEnv('acc-sandbox-', (name) => (name === 'gh' ? 'echo gh\n' : 'exit 1\n'));
  try {
    assert.equal(process.env.HOME, at('home'));
    assert.ok(process.env.PATH!.startsWith(`${at('bin')}:`));
    assert.equal(process.env.ACC_ROLE, undefined, 'a builder\'s role is cleared');
    assert.equal(readFileSync(at('home', '.claude.json'), 'utf8'), '{"projects":{}}\n');
    assert.equal(SANDBOX_TOOLS.filter((t) => existsSync(at('bin', t))).length, SANDBOX_TOOLS.length);
    assert.equal(spawnSync(at('bin', 'gh'), { encoding: 'utf8' }).stdout, 'gh\n');
    assert.equal(spawnSync(at('bin', 'claude')).status, 1, 'a tool not given its own script fails at once');
    process.env.ACC_SANDBOX_ADDED = '1';
  } finally {
    restore();
  }
  assert.equal(process.env.ACC_ROLE, 'builder');
  assert.equal(process.env.ACC_SANDBOX_ADDED, undefined);
  assert.equal(process.env.HOME, before.HOME);
  delete process.env.ACC_ROLE;
  if (before.ACC_ROLE !== undefined) process.env.ACC_ROLE = before.ACC_ROLE;
});

test('every test that points the environment at a sandbox makes it with sandboxEnv; edge case: one that builds its own is named (T-71)', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const files = readdirSync(dir).filter((f) => f.endsWith('.ts') && f !== 'vscode.ts');
  const using = files.filter((f) => readFileSync(join(dir, f), 'utf8').includes('= sandboxEnv('));
  assert.ok(using.length >= 7, `found ${using.length} tests that use sandboxEnv`);
  assert.ok(using.includes('rule-accept.test.ts'));
  // A sandbox built by hand points ACC_QUESTIONS_DIR into it, as sandboxEnv does.
  const handMade = ['ACC_QUESTIONS_DIR', ': at('].join('');
  const own = files.filter((f) => readFileSync(join(dir, f), 'utf8').includes(handMade));
  assert.deepEqual(own, [], 'these build their own sandbox: use sandboxEnv');
});

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));
/** The extension's folder, as VSCode gives it: its package.json, media/ and dist/. */
const extDir = join(dist, '..', '..');

// The extension says it's listening for agents' questions (D-030); keep that out of the real ~/.acc.
process.env.ACC_QUESTIONS_DIR = tempDir('acc-questions-');
// It records its runtime for acc's launcher (D-077); that goes here too, not in the real ~/.acc.
const RUNTIME_FILE = join(tempDir('acc-runtime-'), 'runtime');
process.env.ACC_RUNTIME_FILE = RUNTIME_FILE;
// And Slack's claims (GH-58), which it prunes at start.
process.env.ACC_SLACK_DIR = tempDir('acc-slack-');
// And this machine's repos, which it adds each project it loads to (GH-81).
const REPOS_FILE = join(tempDir('acc-repos-'), 'repos.json');
process.env.ACC_REPOS_FILE = REPOS_FILE;
// And this machine's limits (GH-111): its total and slots, and the repos it counts, which Settings reads and changes.
const MACHINE_FILE = join(tempDir('acc-machine-'), 'machine.json');
process.env.ACC_MACHINE_FILE = MACHINE_FILE;
// About's two looks (GH-114) answered here, so opening Settings stays offline: gh release view and claude
// plugin list go to these stand-ins, which log each call; anything else goes on to the real gh or claude.
const STANDIN_BIN = tempDir('acc-standin-');
const STANDIN_LOG = join(STANDIN_BIN, 'calls.log');
const real = (cmd: string) => spawnSync('sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' }).stdout.trim();
const standIn = (cmd: string, when: string, answer: string) => writeFileSync(join(STANDIN_BIN, cmd), [
  '#!/bin/sh',
  `if ${when}; then echo "${cmd} $*" >> '${STANDIN_LOG}'; printf '%s\\n' '${answer}'; exit 0; fi`,
  real(cmd) ? `exec '${real(cmd)}' "$@"` : 'exit 127',
].join('\n'), { mode: 0o755 });
standIn('gh', '[ "$1" = release ] && [ "$2" = view ]', JSON.stringify({ tagName: 'v0.1.0', name: 'v0.1.0', url: 'https://github.com/jack-huffman/agent-command-center/releases/tag/v0.1.0', publishedAt: '2026-01-01T00:00:00Z' }));
standIn('claude', '[ "$1" = plugin ] && [ "$2" = list ]', '[]');
process.env.PATH = `${STANDIN_BIN}:${process.env.PATH}`;
delete process.env.ACC_HEAVY_SLOTS;
// The extension runs acc as the person at VSCode, even when these tests run in a builder's session.
delete process.env.ACC_ROLE;
delete process.env.ACC_TASK;

test('activation registers the commands, adds acc to PATH, and ticks the steps that pass', { timeout: 60_000 }, async () => {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify({ schema: 1, project: 'Tool', environments: [{ name: 'main', default: true }], trackers: [{ kind: 'github' }] }), '.gitignore': '.claude/worktrees/\n' });
  // Claude Code state that trusts the repo, as accepting the prompt once leaves it (B12.trust).
  const claudeDir = tempDir('claude-state-');
  writeFileSync(join(claudeDir, '.claude.json'), JSON.stringify({ projects: { [realpathSync(repo)]: { hasTrustDialogAccepted: true } } }));
  const savedClaudeDir = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = claudeDir;
  const fake = fakeVscode(repo);
  const { calls, status, trees, panels, autopilot, settings } = fake;
  // Fresh machine results for this folder's profile, checked by this version (GH-114), so the test doesn't call slow machine CLIs.
  const version = (JSON.parse(readFileSync(join(dist, '..', '..', 'package.json'), 'utf8')) as { version: string }).version;
  const started = activate(dist, fake, { 'acc.welcomed': true, 'acc.machineItems': { at: Date.now(), profile: 'generic', version, items: [{ id: 'A1.git', part: 'machine', title: 'git', status: 'pass', detail: 'git 2.54.0' }] } });
  const { ctx, prepends, secrets, secretsAsked } = started;
  try {
    for (const c of Object.values(COMMANDS)) assert.ok(calls.commands.has(c), `${c} registered`);
    // The Agents tab's Stop finished sessions (D-095), beside a single agent's Stop.
    for (const c of ['acc.agent.stop', 'acc.agents.stopFinished']) assert.ok(calls.commands.has(c), `${c} registered`);
    // Every command the manifest contributes is registered when the extension starts, whatever area holds it (D-099).
    const contributed = (JSON.parse(readFileSync(join(extDir, 'package.json'), 'utf8')) as { contributes: { commands: { command: string }[] } }).contributes.commands;
    for (const c of contributed) assert.ok(calls.commands.has(c.command), `${c.command} is contributed, so it's registered`);
    // Setup watches each folder's own root, never every file of those names below it, a builder's worktree's included.
    const setupWatch = calls.watched.find((p) => typeof p === 'object' && p !== null && String((p as { pattern: string }).pattern).includes('.acc/config.json')) as { base: { uri: { fsPath: string } }; pattern: string } | undefined;
    assert.ok(setupWatch, 'a watcher for the setup files');
    assert.ok(!setupWatch!.pattern.startsWith('**/'), 'only at the folder\'s root');
    assert.ok(!calls.watched.some((p) => typeof p === 'string' && p.includes('.acc/config.json')), 'no workspace-wide glob');
    assert.equal(prepends[0]?.[0], 'PATH');
    assert.match(prepends[0]![1], /extension\/dist\/bin:$/);
    assert.equal(readFileSync(RUNTIME_FILE, 'utf8'), `${process.execPath}\n`, 'acc\'s launcher can use this runtime where node isn\'t on PATH');

    // The full setup pass, not just an early single-step re-check (B14 re-checks as soon as projects load).
    await until(() => calls.contexts.get('acc.profile') === 'generic' && calls.contexts.has('acc.step.B0.config') && calls.contexts.has('acc.step.A1.git')).catch((e) => {
      throw new Error(`${e.message}. Contexts: ${JSON.stringify([...calls.contexts])}. Warnings: ${JSON.stringify(calls.warn)}. Info: ${JSON.stringify(calls.info)}`);
    });
    assert.equal(calls.contexts.get('acc.step.B0.config'), true);
    assert.equal(calls.contexts.get('acc.step.B0.repo'), true);
    assert.equal(calls.contexts.get('acc.step.A1.git'), true, 'reused machine results are applied');
    // Setup speaks through the one status bar item now (D-065): its own stays hidden.
    assert.equal(status.shown, false);

    // The sidebar is one launcher listing the page's sections (D-029).
    assert.deepEqual([...trees.keys()], ['acc.home']);
    await until(() => calls.contexts.get('acc.hasProject') === true);
    // The project it loaded is on this machine's list, for the Connect page's "used by" (GH-81).
    assert.deepEqual((JSON.parse(readFileSync(REPOS_FILE, 'utf8')) as { repos: string[] }).repos, [repo]);
    const launcher = trees.get('acc.home')!;
    assert.deepEqual((launcher.getChildren() as { section: string }[]).map((n) => n.section), ['overview', 'tasks', 'agents', 'worktrees', 'environments', 'setup', 'settings'], 'Settings last (GH-109)');
    // The extension runs the bundle itself; terminals get the launcher beside it.
    const accBin = join(extDir, 'dist', 'bin', 'acc.mjs');
    const added = spawnSync(process.execPath, [accBin, 'add', 'Try the page'], { cwd: repo, encoding: 'utf8' });
    assert.equal(added.status, 0, added.stderr);
    await calls.commands.get('acc.tasks.refresh')!();

    // The page, opened at Tasks: a strict CSP, and every section's data arrives once it's ready.
    await calls.commands.get('acc.open.tasks')!();
    const tab = panels[0]!;
    assert.match(tab.html, /Content-Security-Policy" content="default-src 'none'; [^"]*script-src 'nonce-[A-Za-z0-9+/=]+'/);
    assert.doesNotMatch(tab.html, /unsafe-inline|unsafe-eval/);
    assert.match(tab.html, /<script nonce="[A-Za-z0-9+/=]+" src=/);
    assert.match(tab.html, /data-view="home"/);
    assert.match(tab.html, /<html lang="en" data-theme="vscode">/, 'Match VSCode until Settings says otherwise (GH-109)');
    tab.receive!({ type: 'ready' });
    type Posted = { model: { kind: string; section: string; overview: { ready: { id: string }[] }; tasks: { projects: { root: string; columns: { group: string; cards: { id: string }[] }[] }[] }; environments: { projects: { envs: { name: string }[] }[] } } };
    const state = tab.posted.at(-1) as Posted;
    assert.deepEqual([state.model.kind, state.model.section], ['home', 'tasks']);
    assert.deepEqual(state.model.tasks.projects[0]!.columns.find((c) => c.group === 'ready')!.cards.map((c) => c.id), ['T-1']);
    assert.deepEqual(state.model.overview.ready.map((r) => r.id), ['T-1'], 'the Overview offers it to dispatch');
    assert.equal(state.model.environments.projects[0]!.envs[0]!.name, 'main');

    await calls.commands.get('acc.open.agents')!();
    assert.equal(panels.length, 1, 'one page: opening a section reveals it there');
    assert.equal((tab.posted.at(-1) as Posted).model.section, 'agents');
    // The Where column's view is kept for the window: the page's pick is saved and reaches the model, and a
    // view the page can't ask for changes nothing (GH-83).
    const whereView = () => (tab.posted.at(-1) as { model: { agents: { whereView: string } } }).model.agents.whereView;
    assert.equal(whereView(), 'folder');
    tab.receive!({ type: 'agents-where', view: 'path' });
    assert.equal(ctx.workspaceState.get('acc.agents.where'), 'path');
    await calls.commands.get('acc.open.agents')!();
    assert.equal(whereView(), 'path');
    tab.receive!({ type: 'agents-where', view: 'tree' });
    assert.equal(ctx.workspaceState.get('acc.agents.where'), 'path', 'not a view the page can ask for');
    tab.receive!({ type: 'run', command: 'workbench.action.quit', ref: {} });
    // The palette's key (T-52): acc.palette tells the open page to open its palette, and opens no second page.
    const postedBefore = tab.posted.length;
    await calls.commands.get('acc.palette')!();
    // A board read meanwhile redraws the page too (T-127: each board is drawn as it's read), so it's found among the posts.
    assert.ok(tab.posted.slice(postedBefore).some((m) => JSON.stringify(m) === JSON.stringify({ type: 'palette' })), 'acc.palette posts the palette message to the page');
    assert.equal(panels.length, 1, 'it opens no second page');

    // Every answer sent from a page gets a reply, so it never stays on "Sending your answer…" (D-059).
    type Done = { type: string; action: string; ok: boolean; error?: string; task: string; question: string };
    const reply = async (page: (typeof panels)[number], project: string, task: string): Promise<Done> => {
      const from = page.posted.length;
      const done = () => page.posted.slice(from).find((x) => (x as Done).type === 'done') as Done | undefined;
      page.receive!({ type: 'analysis-answer', project, task, question: 'q1', text: 'Yes.' });
      await until(() => !!done());
      return done()!;
    };
    const root = state.model.tasks.projects[0]!.root;
    const away = await reply(tab, '/nowhere', 'T-1');
    assert.deepEqual([away.action, away.ok, away.task, away.question], ['analysis-answer', false, 'T-1', 'q1']);
    assert.match(away.error ?? '', /isn't open/, 'a project that isn\'t open says so');
    assert.match((await reply(tab, root, 'T-1')).error ?? '', /hasn't been analyzed/, 'acc\'s refusal comes back');
    tab.receive!({ type: 'ticket', project: root, tracker: null, key: 'T-1' });
    const page = panels[1]!;
    page.receive!({ type: 'ready' });
    assert.match((await reply(page, root, 'T-2')).error ?? '', /isn't for this task/, 'the task\'s page answers only its own questions');
    assert.match((await reply(page, root, 'T-1')).error ?? '', /hasn't been analyzed/);

    // So does every Post, Discard and Send to the client (D-066): acc's refusal, or why not, comes back.
    const updated = async (on: (typeof panels)[number], m: Record<string, unknown>): Promise<Done & { id?: string }> => {
      const from = on.posted.length;
      const done = () => on.posted.slice(from).find((x) => (x as Done).type === 'done') as (Done & { id?: string }) | undefined;
      on.receive!(m);
      await until(() => !!done());
      return done()!;
    };
    const gone = await updated(tab, { type: 'update-discard', project: '/nowhere', id: 'T-1.1' });
    assert.deepEqual([gone.action, gone.ok, gone.id], ['update-discard', false, 'T-1.1']);
    assert.match(gone.error ?? '', /isn't open/);
    assert.match((await updated(tab, { type: 'update-discard', project: root, id: 'T-1.1' })).error ?? '', /No update T-1\.1/);
    assert.match((await updated(tab, { type: 'update-post', project: root, id: 'T-1.1', text: 'Hello' })).error ?? '', /isn't there any more/);
    assert.match((await updated(tab, { type: 'update-ask', project: root, task: 'T-1', question: 'q1' })).error ?? '', /hasn't been analyzed/);
    assert.match((await updated(page, { type: 'update-post', project: root, id: 'T-2.1', text: 'Hello' })).error ?? '', /isn't for this task/, 'the task\'s page posts only its own updates');
    assert.match((await updated(page, { type: 'update-discard', project: root, id: 'T-1.1' })).error ?? '', /No update T-1\.1/);

    // An edit on the task's page is what the Overview shows, and the Overview's Post can't send acc's text
    // instead (GH-46). The drafts are acc's files, as acc sync leaves them.
    const store = join(repo, '.git', 'acc', 'updates');
    mkdirSync(store, { recursive: true });
    const said = 'The change was approved and merged into main.';
    const draft = (id: string, extra: Record<string, unknown> = {}) => writeFileSync(join(store, `${id}.json`), JSON.stringify({
      v: 1, id, task: id.slice(0, id.lastIndexOf('.')), tracker: 'github', key: `#${id.split('-')[1]!.split('.')[0]}`, url: null, event: 'merged', env: 'main', text: said, state: 'draft', createdAt: new Date().toISOString(), by: 'acc sync', ...extra,
    }));
    draft('T-1.1');
    draft('T-2.1');
    await calls.commands.get('acc.tasks.refresh')!();
    type Row = { look: { label: string; icon: string; tone: string }; actions: { label: string; primary?: boolean }[]; update?: { id: string; edited: string | null } };
    const rows = () => ((tab.posted.filter((x) => (x as Posted).model).at(-1) as { model: { overview: { attention: Row[] } } }).model.overview.attention.filter((a) => a.update));
    const look = (id: string) => { const r = rows().find((a) => a.update!.id === id); return r && [r.look.label, r.update!.edited, r.actions.map((a) => `${a.label}${a.primary ? '*' : ''}`).join(',')]; };
    await until(() => rows().length === 2);
    assert.deepEqual(look('T-1.1'), ['Draft update', null, 'Edit']);
    page.receive!({ type: 'update-edit', project: root, id: 'T-1.1', text: 'Merged into main: try it there.' });
    await until(() => look('T-1.1')?.[0] === 'Edited on the task page');
    assert.deepEqual(look('T-1.1'), ['Edited on the task page', 'Merged into main: try it there.', 'Edit*'], 'the edit, and Edit leads');
    // A row drawn before the edit arrived still offers Post: acc's text is refused, and nothing is posted.
    const refused = await updated(tab, { type: 'update-post', project: root, id: 'T-1.1', text: said });
    assert.deepEqual([refused.action, refused.ok, refused.id], ['update-post', false, 'T-1.1']);
    assert.match(refused.error ?? '', /edited on the task page, so post it from there/);
    assert.equal(JSON.parse(readFileSync(join(store, 'T-1.1.json'), 'utf8')).state, 'draft', 'nothing was claimed or posted');
    // The page edits only its own task's updates.
    page.receive!({ type: 'update-edit', project: root, id: 'T-2.1', text: 'Not this page\'s.' });
    assert.deepEqual(look('T-2.1'), ['Draft update', null, 'Edit']);

    // acc drafts the same news again while the page is hidden: the newer draft is still edited there.
    draft('T-1.2', { replaces: ['T-1.1'] });
    rmSync(join(store, 'T-1.1.json'));
    await calls.commands.get('acc.tasks.refresh')!();
    await until(() => !!look('T-1.2'));
    assert.deepEqual(look('T-1.2'), ['Edited on the task page', 'Merged into main: try it there.', 'Edit*'], 'found through the draft it replaced');
    // Back on screen, the page carries its edit to the newer draft; typed back to acc's text, it's gone.
    page.receive!({ type: 'update-edit', project: root, id: 'T-1.2', text: 'Merged into main: have a look.' });
    await until(() => look('T-1.2')?.[1] === 'Merged into main: have a look.');
    page.receive!({ type: 'update-edit', project: root, id: 'T-1.2', text: null });
    await until(() => look('T-1.2')?.[0] === 'Draft update');
    assert.deepEqual(look('T-1.2'), ['Draft update', null, 'Edit'], 'the replaced draft\'s edit went with it');
    // Closing the page drops its edit too (D-066).
    page.receive!({ type: 'update-edit', project: root, id: 'T-1.2', text: 'One more go.' });
    await until(() => look('T-1.2')?.[0] === 'Edited on the task page');
    page.close!();
    await until(() => look('T-1.2')?.[0] === 'Draft update');

    // Autopilot (D-064): a switch for the repo, hidden while its autonomy is manual, and off until clicked.
    assert.ok(calls.commands.has('acc.autopilot.toggle') && calls.commands.has('acc.autopilot.output'));
    // Its switch is in the one status bar item's menu (D-065), not an item of its own.
    assert.equal(autopilot.length, 0, 'autopilot makes no status bar item of its own');
    // Changing autonomy goes through acc, which writes the config.
    calls.pick = (items) => items.find((i) => i.value === 'review');
    await calls.commands.get('acc.agents.autonomy')!(root);
    calls.pick = undefined;
    assert.equal(JSON.parse(readFileSync(join(repo, '.acc', 'config.json'), 'utf8')).autonomy, 'review');
    assert.match(calls.info.at(-1) ?? '', /^Autonomy is review\. Changed in the project's settings: commit the change to share it\./);
    // No "github" section, so it can't land anything: the menu offers no switch for it.
    let offered: { label: string }[] = [];
    calls.pick = (items) => { offered = items as { label: string }[]; return undefined; };
    await calls.commands.get('acc.status.menu')!();
    calls.pick = undefined;
    assert.ok(offered.some((i) => /Open the Command Center/.test(i.label)), 'the menu opens the page');
    assert.ok(!offered.some((i) => /Turn autopilot/.test(i.label)), 'a repo whose autopilot can\'t run offers no switch');
    const warned = calls.warn.length;
    await calls.commands.get('acc.autopilot.toggle')!();
    assert.match(calls.warn[warned] ?? '', /settings name no GitHub repo/, 'a click says why, and starts nothing');

    // How agents run is in Settings (GH-110). Each Change… asks acc, which writes the project's
    // .acc/config.json; the page writes neither.
    const answer = (...picks: ((items: Record<string, unknown>[]) => unknown)[]) => { let n = 0; calls.pick = (items) => picks[n++]?.(items as Record<string, unknown>[]); };
    const config = () => JSON.parse(readFileSync(join(repo, '.acc', 'config.json'), 'utf8'));
    // Change… asks for a model (the default, two models and the person's own words, D-205) and an effort, and
    // asks acc to write the project's settings, for the person to commit (T-163).
    const models: string[][] = [];
    answer((i) => { models.push(i.map((x) => String(x.label))); return i.find((x) => x.value === 'claude-sonnet-5-5'); }, (i) => i.find((x) => x.value === 'low'));
    await calls.commands.get('acc.agents.configure')!(`builder|${root}`);
    assert.deepEqual(config().agents.builder, { model: 'claude-sonnet-5-5', effort: 'low' }, 'the project\'s settings: its .acc/config.json');
    assert.equal(spawnSync('git', ['config', '--get', 'acc.builder.model'], { cwd: repo, encoding: 'utf8' }).stdout.trim(), '', 'and not this clone\'s own settings');
    assert.equal(models[0]!.length, 4, 'three models to pick and the person\'s own words');
    assert.ok(/default/i.test(models[0]![0]!) && models[0]!.some((l) => /another model/i.test(l)), 'the default first, and a way to type a model');
    answer((i) => i.find((x) => x.value === null), (i) => i.find((x) => x.value === 'high'));
    await calls.commands.get('acc.agents.configure')!(`reviewer|${root}`);
    assert.deepEqual(config().agents.reviewer, { effort: 'high' }, 'the default model takes the setting out; the effort is kept');
    // The planning agent has its own row's Change…, and the person's own words name another model.
    calls.input = 'claude-haiku-5-5';
    answer((i) => i.find((x) => x.value === '?'), (i) => i.find((x) => x.value === null));
    await calls.commands.get('acc.agents.configure')!(`planner|${root}`);
    calls.input = undefined;
    assert.deepEqual(config().agents.planner, { model: 'claude-haiku-5-5' }, 'the planning agent\'s own model, with the default effort left out');
    answer((i) => i.find((x) => x.value === 'on'));
    await calls.commands.get('acc.agents.autoMerge')!(root);
    calls.pick = undefined;
    assert.equal(config().autopilot.autoMerge, true);
    assert.match(calls.info.at(-1) ?? '', /^Auto-merge is on\. Changed in the project's settings: commit the change to share it\./);
    // The status bar's Auto-merge opens Settings at How agents run, which shows each change under the
    // project's name, with where it's set.
    calls.pick = (items) => (items as { label: string }[]).find((i) => /Auto-merge: on/.test(i.label));
    await calls.commands.get('acc.status.menu')!();
    calls.pick = undefined;
    type Opened = { jump?: boolean; open?: string; model?: { section: string; settings: SettingsShown } };
    type SettingsShown = { agents: { projects: { project: string; roles: { parts: { name: string; value: string; from: { label: string } }[] }[]; autoMerge: { look: { label: string } } }[] } };
    const opened = tab.posted.filter((x) => (x as Opened).model).at(-1) as Opened;
    assert.deepEqual([opened.jump, opened.open, opened.model!.section], [true, 'settings:agents', 'settings']);
    const shown = opened.model!.settings.agents.projects[0]!;
    assert.equal(shown.project, 'Tool');
    assert.deepEqual(shown.roles.map((r) => r.parts.slice(0, 2).map((p) => `${p.name} ${p.value} · ${p.from.label}`)), [
      ['Model claude-sonnet-5-5 · project default', 'Effort low · project default'],
      ['Model claude-haiku-5-5 · project default', 'Effort default · Claude Code\'s default'],
      ['Model claude-opus-5-5 · the Command Center\'s default', 'Effort high · project default'],
    ]);
    assert.equal(shown.autoMerge.look.label, 'on');

    // The Jira button, on a repo with no Jira yet, connects one here with Jira chosen: never a file to edit.
    const ran = calls.executed.length;
    await calls.commands.get('acc.task.importJira')!();
    const connect = calls.executed.slice(ran).find(([id]) => id === 'acc.trackers.add');
    assert.ok(connect, 'it starts the guided connect');
    assert.deepEqual([(connect![1][0] as { kind: string }).kind, typeof (connect![1][0] as { root: string }).root], ['jira', 'string']);
    assert.ok(!calls.info.some((m) => /config\.json \("trackers"/.test(m)), 'no instructions to edit the config');

    // That connect is the Connect page in the Command Center, with Jira chosen: no prompt at the top of
    // VSCode (GH-51). So is Setup's Do it, with no argument, and a Sign in with no tracker to sign in to.
    const prompted = calls.prompts;
    type Connected = { model?: { connect: { id: string; kind: string; title: string; fields: { key: string; value: string }[] } | null } };
    const connectShown = () => (tab.posted.filter((x) => (x as Connected).model).at(-1) as Connected).model!.connect;
    for (const [command, arg] of [['acc.trackers.add', { root, kind: 'jira' }], ['acc.trackers.add', undefined], ['acc.trackers.signIn', undefined]] as const) {
      await calls.commands.get(command)!(arg);
      const c = connectShown();
      assert.deepEqual([c?.kind, c?.title], ['jira', 'Connect a tracker'], `${command} opens the page`);
      tab.receive!({ type: 'connect-cancel', session: c!.id });
      await until(() => connectShown() === null);
    }
    assert.equal(calls.prompts, prompted, 'no input box or quick pick');

    // Trackers and sign-ins in Settings (GH-112). acc writes a Jira tracker to the project's config, as the
    // Connect page's Save asks it to. Nothing here is signed in when a board loads, so none is read over the network.
    const jiraFile = join(tempDir('acc-tracker-'), 'jira.json');
    writeFileSync(jiraFile, JSON.stringify({ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME' }));
    const setTracker = spawnSync(process.execPath, [accBin, 'trackers', 'set', '--file', jiraFile, '--json'], { cwd: repo, encoding: 'utf8' });
    assert.equal(setTracker.status, 0, setTracker.stderr);
    assert.equal(JSON.parse(setTracker.stdout).index, 1, 'after the GitHub tracker');
    await calls.commands.get('acc.open.settings')!();
    await calls.commands.get('acc.settings.refresh')!();
    // About looked, offline: its release and plugin list came from the stand-ins (GH-114).
    const standInCalls = () => (existsSync(STANDIN_LOG) ? readFileSync(STANDIN_LOG, 'utf8') : '');
    await until(() => standInCalls().includes('gh release view') && standInCalls().includes('claude plugin list'));
    type TrackerShown = { title: string; signIn: { label: string; tone: string }; actions: { command: string; arg: string | null; disabled: string | null }[] };
    type WithTrackers = { model?: { settings: { trackers: { projects: { project: string; trackers: TrackerShown[] }[]; connect: { command: string; arg: string | null } | null } } } };
    const shownTrackers = () => (tab.posted.filter((x) => (x as WithTrackers).model).at(-1) as WithTrackers).model!.settings.trackers;
    const jiraShown = () => shownTrackers().projects[0]?.trackers.find((t) => t.title === 'Jira · ACME');
    await until(() => jiraShown()?.signIn.label === 'Not signed in');
    assert.deepEqual(shownTrackers().projects.map((p) => [p.project, p.trackers.map((t) => t.title)]), [['Tool', ['GitHub · ?', 'Jira · ACME']]], 'one list, under the project\'s name');
    assert.match(shownTrackers().projects[0]!.trackers[0]!.signIn.label, /needs the project's GitHub repo and account, in its settings/, 'GitHub says why gh has no account to sign in as');
    const jiraOut = jiraShown()!.actions.find((a) => a.command === 'acc.trackers.signOut')!;
    assert.match(jiraOut.disabled ?? '', /isn't signed in/, 'nothing to sign out of yet');
    // The board looked for this project's own sign-in first, then the site's (D-091).
    const siteKey = 'acc.cred:site:jira:acme.atlassian.net';
    const ownKey = [...secretsAsked].find((k) => k.endsWith(':jira:acme.atlassian.net') && k !== siteKey)!;
    assert.ok(ownKey && secretsAsked.has(siteKey), [...secretsAsked].join(', '));

    // Sign out: the page may ask for it now. This project's own sign-in goes with no question.
    const asked = calls.executed.length;
    tab.receive!({ type: 'toolbar', command: 'acc.trackers.signOut', arg: jiraOut.arg! });
    assert.deepEqual(calls.executed.slice(asked), [['acc.trackers.signOut', [jiraOut.arg]]]);
    secrets.set(ownKey, JSON.stringify({ kind: 'jira', method: 'token', email: 'jordan@acme.example', token: 'secret-token-0123456789' }));
    const warnedAt = calls.warn.length;
    await calls.commands.get('acc.trackers.signOut')!(jiraOut.arg);
    assert.deepEqual([secrets.has(ownKey), calls.warn.length, calls.info.at(-1)], [false, warnedAt, 'Tool is signed out of Jira · ACME.']);
    // The sign-in every project on the site shares asks: every project, or this one only (D-091).
    secrets.set(siteKey, JSON.stringify({ kind: 'jira', method: 'token', email: 'team@acme.example', token: 'secret-token-0123456789' }));
    let buttons: string[] = [];
    calls.warnPick = (items) => { buttons = items; return 'This project only'; };
    await calls.commands.get('acc.trackers.signOut')!(jiraOut.arg);
    calls.warnPick = undefined;
    assert.match(calls.warn[warnedAt] ?? '', /^Sign out of Jira on acme\.atlassian\.net\?/);
    assert.deepEqual(buttons, ['Every project on acme.atlassian.net', 'This project only']);
    assert.deepEqual([JSON.parse(secrets.get(ownKey)!), secrets.has(siteKey)], [{ kind: 'jira', signedOut: true }, true], 'this project stops using it, and every other keeps it');
    assert.equal(calls.info.at(-1), 'Tool is signed out of Jira · ACME. Other projects on acme.atlassian.net still use the sign-in for every project there (team@acme.example).');
    await until(() => jiraShown()?.signIn.label === 'Not signed in');

    // Sign in again and Change tracker… open the Connect page at that tracker, and its Back comes back here.
    type ConnectBack = { model?: { connect: { id: string; title: string; back: { section: string; label: string; part: string | null }; fields: { key: string }[] } | null } };
    const connectOpen = () => (tab.posted.filter((x) => (x as ConnectBack).model).at(-1) as ConnectBack).model!.connect;
    for (const [command, fields] of [['acc.trackers.signIn', ['email', 'token']], ['acc.trackers.add', ['email', 'token']]] as const) {
      const before = calls.executed.length;
      tab.receive!({ type: 'toolbar', command, arg: jiraOut.arg! });
      assert.deepEqual(calls.executed.slice(before), [[command, [jiraOut.arg]]], `the page asks for ${command}`);
      await calls.commands.get(command)!(jiraOut.arg);
      await until(() => !!connectOpen()?.fields.length);
      const c = connectOpen()!;
      assert.deepEqual([c.title, c.back, c.fields.map((f) => f.key)], ['Change Jira · ACME', { section: 'settings', label: 'Back to Settings', part: 'settings:trackers' }, fields], command);
      tab.receive!({ type: 'connect-cancel', session: c.id });
      await until(() => connectOpen() === null);
    }
    // Connect a tracker sends no tracker: the Connect page starts a new one.
    assert.equal(shownTrackers().connect?.arg, null);
    const before = calls.executed.length;
    tab.receive!({ type: 'toolbar', command: 'acc.trackers.add' });
    assert.deepEqual(calls.executed.slice(before), [['acc.trackers.add', [undefined]]]);

    // A Slack channel (T-29): with no bot token kept, its board offers Sign in to Slack; with one, the
    // extension makes a Slack client from it, and shows a box for a thread's link in place of a board (T-31).
    const slackFile = join(tempDir('acc-tracker-'), 'slack.json');
    writeFileSync(slackFile, JSON.stringify({ kind: 'slack', workspace: 'acme', channel: 'C0123ABCD' }));
    const setSlack = spawnSync(process.execPath, [accBin, 'trackers', 'set', '--file', slackFile, '--json'], { cwd: repo, encoding: 'utf8' });
    assert.equal(setSlack.status, 0, setSlack.stderr);
    type SlackBoard = {
      index: number; kind: string; title: string; error: string | null; connect: { command: string; label: string; arg: string } | null; signedInAs: string | null;
      paste: { hint: string; error: string | null } | null; off: string | null; source: string | null; moves: boolean;
      columns: { id: string; cards: { key: string; title: string; people: { name: string }[]; acc: unknown; track: unknown }[] }[];
    };
    type WithBoards = { model?: { tasks: { projects: { root: string; boards: SlackBoard[] }[] } } };
    const slackBoard = () => (tab.posted.filter((x) => (x as WithBoards).model).at(-1) as WithBoards).model!.tasks.projects[0]?.boards.find((b) => b.kind === 'slack');
    await calls.commands.get('acc.settings.refresh')!();
    await until(() => !!slackBoard()?.error);
    assert.deepEqual([slackBoard()!.error, slackBoard()!.connect?.command, slackBoard()!.connect?.label], ['Sign in to Slack (acme) for this repo to read its channel\'s threads.', 'acc.trackers.signIn', 'Sign in to Slack']);
    const slackToken = 'xoxb-0000-1111-slacktokenforthetest';
    secrets.set('acc.cred:site:slack:acme', JSON.stringify({ kind: 'slack', method: 'token', token: slackToken }));
    // Slack answers as the app Acme Command Center (bots.info), as it does on the Connect page.
    const realFetch = globalThis.fetch;
    const slackApi = (async (url: string) => {
      const m = new URL(url).pathname;
      if (m === '/api/auth.test') return Response.json({ ok: true, url: 'https://acme.slack.com/', team: 'Acme', user: 'acc-bot', user_id: 'U0BOT', bot_id: 'B0APP' });
      if (m === '/api/bots.info') return Response.json({ ok: true, bot: { id: 'B0APP', name: 'Acme Command Center' } });
      return Response.json({ ok: false, error: 'unknown_method' });
    }) as unknown as typeof fetch;
    // Edge case, Slack refusing the token (the client can't start): Commenting as says the bot-token words, not a name.
    globalThis.fetch = (async () => Response.json({ ok: false, error: 'invalid_auth' })) as unknown as typeof fetch;
    try {
      await calls.commands.get('acc.trackers.refresh')!();
      await until(() => !!slackBoard()?.signedInAs);
      assert.equal(slackBoard()!.signedInAs, 'a Slack app\'s bot token', 'a client that cannot start leaves the token\'s words');
    } finally {
      globalThis.fetch = realFetch;
    }
    globalThis.fetch = slackApi;
    try {
      await calls.commands.get('acc.trackers.refresh')!();
      await until(() => slackBoard()?.signedInAs === 'Acme Command Center');
      // The same name three ways (T-32): the client's me, the Connect page's sign-in, and the board the task page and the update card's Post read.
      const app = (await slackApp('acme', slackToken, slackApi)).name;
      const me = (await new SlackClient({ workspace: 'acme', channel: 'C0123ABCD', prefix: 'SL', token: slackToken, fetch: slackApi }).me()).name;
      const post = updatePoster('slack', slackBoard()!.index, '/r', null, [{ ...slackBoard()!, loading: false } as never]).postAs;
      assert.deepEqual([me, slackBoard()!.signedInAs, post], [app, app, app], 'me, the task page\'s Commenting as, and the update card\'s Post');
      assert.equal(app, 'Acme Command Center');
      assert.deepEqual([slackBoard()!.error, slackBoard()!.connect], [null, null], 'no sign-in to ask for, and not the client\'s refusal of a board');
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.match(slackBoard()!.paste?.hint ?? '', /channel C0123ABCD of acme\.slack\.com/, 'a box for a thread\'s link, which says the channel');
    // Track from the box: a link to a thread in another channel is refused before Slack is asked, naming it.
    const slackRoot = (tab.posted.filter((x) => (x as WithBoards).model).at(-1) as WithBoards).model!.tasks.projects[0]!.root;
    tab.receive!({ type: 'track-link', project: slackRoot, tracker: slackBoard()!.index, link: 'https://acme.slack.com/archives/C0999WXYZ/p1696512345123456' });
    await until(() => !!slackBoard()?.paste?.error);
    assert.match(slackBoard()!.paste!.error!, /^That thread is in channel C0999WXYZ, not C0123ABCD\./);
    // A Slack tracker that names no reaction (T-85): its board is off, saying why and how to turn it on, beside the box.
    assert.match(slackBoard()!.off ?? '', /names no reaction\. Choose a reaction with Change/);
    assert.deepEqual([slackBoard()!.error, slackBoard()!.columns], [null, []]);
    // With a reaction, the channel's marked messages are its board, and Track on a card makes its task. Every
    // method the stand-in Slack is asked is recorded, and none of them writes.
    writeFileSync(slackFile, JSON.stringify({ kind: 'slack', workspace: 'acme', channel: 'C0123ABCD', reaction: 'ticket', doneReaction: 'white_check_mark' }));
    const setReaction = spawnSync(process.execPath, [accBin, 'trackers', 'set', '--file', slackFile, '--json'], { cwd: repo, encoding: 'utf8' });
    assert.equal(setReaction.status, 0, setReaction.stderr);
    const slackAsked: string[] = [];
    const marked = { ts: '1760000300.000300', user: 'U01', text: 'Export drops the last row\nSince Monday.', reactions: [{ name: 'ticket', count: 1 }] };
    const boardApi = (async (url: string) => {
      const u = new URL(url);
      const m = u.pathname.replace('/api/', '');
      slackAsked.push(m);
      if (m === 'conversations.history') {
        return Response.json({ ok: true, messages: [marked, { ts: '1760000200.000200', user: 'U02', text: 'Login is slow', reactions: [{ name: 'ticket' }, { name: 'white_check_mark' }] }, { ts: '1760000100.000100', user: 'U02', text: 'Lunch?' }] });
      }
      if (m === 'conversations.replies') return Response.json({ ok: true, messages: [marked] });
      if (m === 'users.info') return Response.json({ ok: true, user: { id: u.searchParams.get('user'), profile: { display_name: u.searchParams.get('user') === 'U01' ? 'Jordan' : 'Sam' } } });
      if (m === 'chat.getPermalink') return Response.json({ ok: true, permalink: `https://acme.slack.com/archives/C0123ABCD/p${u.searchParams.get('message_ts')!.replace('.', '')}` });
      return slackApi(url);
    }) as unknown as typeof fetch;
    globalThis.fetch = boardApi;
    try {
      await calls.commands.get('acc.settings.refresh')!();
      await calls.commands.get('acc.trackers.refresh')!();
      await until(() => !!slackBoard()?.columns.length);
      const b = slackBoard()!;
      assert.deepEqual([b.source, b.off, b.moves, b.columns.map((c) => [c.id, c.cards.map((k) => [k.key, k.title, k.people.map((p) => p.name)])])], ['slack', null, false, [
        ['open', [['SL-1760000300000300', 'Export drops the last row', ['Jordan']]]],
        ['done', [['SL-1760000200000200', 'Login is slow', ['Sam']]]],
      ]]);
      assert.deepEqual([b.columns[0]!.cards[0]!.track, b.columns[1]!.cards[0]!.track], [{ busy: false, error: null }, null], 'Track on an open card; none in Done');
      assert.ok(b.paste, 'the box for a thread\'s link stays above the board');
      tab.receive!({ type: 'track', project: slackRoot, tracker: b.index, key: 'SL-1760000300000300' });
      await until(() => !!slackBoard()?.columns[0]?.cards[0]?.acc);
      assert.equal(slackBoard()!.columns[0]!.cards[0]!.track, null, 'a tracked message shows its task, not Track');
      const ledger = JSON.parse(readFileSync(join(repo, '.git', 'acc', 'ledger.json'), 'utf8')) as { tasks: { id: string; title: string }[] };
      assert.equal(ledger.tasks.find((t) => t.id === 'SL-1760000300000300')?.title, 'Export drops the last row');
    } finally {
      globalThis.fetch = realFetch;
    }
    assert.ok(slackAsked.includes('conversations.history') && slackAsked.includes('conversations.replies'), slackAsked.join(', '));
    assert.deepEqual(slackAsked.filter((m) => !['auth.test', 'bots.info', 'conversations.history', 'conversations.replies', 'users.info', 'chat.getPermalink'].includes(m)), [], 'the board and Track make no write call');
    assert.ok(!tab.posted.some((x) => JSON.stringify(x).includes(slackToken)), 'the token is never in the page model');
    assert.ok(!readFileSync(join(repo, '.acc', 'config.json'), 'utf8').includes('xoxb-'), 'nor in the project\'s settings');

    // Settings (GH-109): a section like the others, its Refresh, and the theme every tab follows.
    await calls.commands.get('acc.open.settings')!();
    type Themed = { model: { section: string; settings: { theme: string } } };
    const lastState = (t: (typeof panels)[number]) => (t.posted.filter((x) => (x as Themed).model).at(-1) as Themed).model;
    assert.deepEqual([lastState(tab).section, lastState(tab).settings.theme], ['settings', 'vscode']);
    // About (GH-114): the extension's own version, from its package.json, and Check now, which the page may ask for.
    type WithAbout = { settings: { about: { rows: { key: string; look: { label: string } }[]; release: { check: { command: string } } } | null } };
    const about = (lastState(tab) as unknown as WithAbout).settings.about!;
    assert.deepEqual([about.rows.find((r) => r.key === 'extension')!.look.label, about.release.check.command], [(JSON.parse(readFileSync(join(extDir, 'package.json'), 'utf8')) as { version: string }).version, 'acc.about.check']);
    const executed = calls.executed.length;
    tab.receive!({ type: 'refresh' });
    assert.deepEqual(calls.executed.slice(executed).map(([id]) => id), ['acc.settings.refresh']);
    // A task page opened with a theme the setting can't hold is Match VSCode; then it's hidden behind another tab.
    settings.set('agentCommandCenter.theme', 'blue');
    tab.receive!({ type: 'ticket', project: root, tracker: null, key: 'T-2' });
    const hidden = panels.at(-1)!;
    assert.match(hidden.html, /<html lang="en" data-theme="vscode">/);
    settings.delete('agentCommandCenter.theme');
    hidden.hide();
    const themes = (t: (typeof panels)[number]) => t.posted.filter((x) => (x as { type: string }).type === 'theme');
    // Not one of the three: refused in words, and nothing changes.
    const warnedBefore = calls.warn.length;
    await calls.commands.get('acc.settings.theme')!('blue');
    assert.match(calls.warn[warnedBefore] ?? '', /Match VSCode, Light, Dark: not blue/);
    assert.deepEqual([settings.get('agentCommandCenter.theme'), themes(tab).length, hidden.htmlSets], [undefined, 0, 1]);
    // Light: kept as the machine's setting. The tab on screen restyles in place, with no new HTML, and
    // Settings shows the pick; the hidden one's HTML is written again, so it comes back light.
    const tabHtml = tab.htmlSets;
    await calls.commands.get('acc.settings.theme')!('light');
    assert.equal(settings.get('agentCommandCenter.theme'), 'light');
    assert.deepEqual(themes(tab), [{ type: 'theme', theme: 'light' }]);
    assert.deepEqual([tab.htmlSets, lastState(tab).settings.theme], [tabHtml, 'light']);
    assert.match(hidden.html, /<html lang="en" data-theme="light">/);
    assert.deepEqual(themes(hidden), [], 'a hidden tab isn\'t sent it: VSCode rebuilds it from its HTML');
    // The tab that was on screen gets its HTML written again once it's hidden, so it comes back light too.
    assert.match(tab.html, /data-theme="vscode"/);
    tab.hide();
    assert.deepEqual([tab.htmlSets, /<html lang="en" data-theme="light">/.test(tab.html)], [tabHtml + 1, true]);
    // Without an argument, it asks.
    calls.pick = (items) => items.find((i) => i.value === 'dark');
    await calls.commands.get('acc.settings.theme')!();
    calls.pick = undefined;
    assert.equal(settings.get('agentCommandCenter.theme'), 'dark');
    assert.ok([tab, hidden].every((t) => /<html lang="en" data-theme="dark">/.test(t.html)), 'both hidden tabs come back dark');
    assert.equal(themes(tab).length, 1, 'hidden, it isn\'t sent the change');

    // Limits and checks (GH-111): Change… picks, and − or + sends the number; acc changes the file, and only its key.
    const configFile = join(repo, '.acc', 'config.json');
    const configWas = readFileSync(configFile, 'utf8');
    calls.pick = (items) => items.find((i) => (i as { value?: unknown }).value === 4);
    await calls.commands.get('acc.settings.agentsMax')!(root);
    calls.pick = undefined;
    // How agents run's steps above set the reviewer's effort here (GH-110): kept, with max beside it.
    assert.deepEqual(JSON.parse(readFileSync(configFile, 'utf8')).agents, { ...JSON.parse(configWas).agents, max: 4 });
    assert.match(calls.info.at(-1) ?? '', /^Tool now runs at most 4 builders at once\. Changed in the project's settings: commit the change to share it\.$/);
    await calls.commands.get('acc.settings.machineAgents')!('5');
    assert.deepEqual(JSON.parse(readFileSync(MACHINE_FILE, 'utf8')), { agents: 5 });
    await calls.commands.get('acc.settings.heavySlots')!('2');
    assert.deepEqual(JSON.parse(readFileSync(MACHINE_FILE, 'utf8')), { agents: 5, heavySlots: 2 });
    // This project has no checks to pick from: it says so, and asks nothing.
    const promptsWere = calls.prompts;
    await calls.commands.get('acc.settings.requiredGates')!(root);
    assert.equal(calls.prompts, promptsWere);
    assert.match(calls.info.at(-1) ?? '', /^Tool has no checks to choose from yet/);
    // The new key goes after its object's last, indented as the file is, and nothing else moved.
    const agentsWas = '  "agents": {\n    "builder": {\n      "model": "claude-sonnet-5-5",\n      "effort": "low"\n    },\n    "reviewer": {\n      "effort": "high"\n    },\n    "planner": {\n      "model": "claude-haiku-5-5"\n    }\n  },\n';
    assert.ok(configWas.includes(agentsWas), 'as acc agents model left it, above');
    assert.equal(readFileSync(configFile, 'utf8'), configWas.replace(agentsWas, agentsWas.replace('    }\n  },\n', '    },\n    "max": 4\n  },\n')));

    // The Command Center's own preferences (GH-113), each through its command, and Slack's way to its card.
    type Prefs = { jump?: boolean; open?: string; model?: { section: string; settings: { page: { preferences: { id: string; choices: { key: string; on: boolean }[] }[]; refresh: string[] } }; agents: { whereView: string } } };
    const lastModel = () => (tab.posted.filter((x) => (x as Prefs).model).at(-1) as Prefs).model!;
    const chosen = () => lastModel().settings.page.preferences.map((p) => p.choices.find((c) => c.on)?.key);
    tab.visible = true;
    await calls.commands.get('acc.open.settings')!();
    // The Where view is as Agents' toggle left it above; the others are their defaults.
    assert.deepEqual([chosen()[0], chosen()[2]], ['left', 'normal']);
    // The pace: a machine setting, written through VSCode; Settings says the intervals at it.
    await calls.commands.get('acc.settings.pace')!('slow');
    assert.equal(settings.get('agentCommandCenter.refreshPace'), 'slow');
    assert.deepEqual([chosen()[2], lastModel().settings.page.refresh[0]], ['slow', 'Tasks: every 12 s while the Command Center is on screen, every 15 s while it isn\'t.']);
    let prefWarned = calls.warn.length;
    await calls.commands.get('acc.settings.pace')!('fast');
    assert.match(calls.warn[prefWarned] ?? '', /^How often the Command Center refreshes is Normal, Relaxed, Slow: not fast\.$/);
    assert.equal(settings.get('agentCommandCenter.refreshPace'), 'slow', 'refused, nothing changes');
    calls.pick = (items) => items.find((i) => i.value === 'relaxed');
    await calls.commands.get('acc.settings.pace')!();
    calls.pick = undefined;
    assert.equal(settings.get('agentCommandCenter.refreshPace'), 'relaxed', 'without a choice, it asks');
    // Agents' Where, for this window: the same as Agents' own toggle.
    await calls.commands.get('acc.settings.where')!('folder');
    assert.deepEqual([ctx.workspaceState.get('acc.agents.where'), chosen()[1]], ['folder', 'folder']);
    await calls.commands.get('acc.settings.where')!('path');
    assert.deepEqual([ctx.workspaceState.get('acc.agents.where'), lastModel().agents.whereView, chosen()[1]], ['path', 'path', 'path']);
    tab.receive!({ type: 'agents-where', view: 'folder' });
    await until(() => ctx.workspaceState.get('acc.agents.where') === 'folder');
    // The section it opens on, for this window: kept in its workspaceState, and used when it opens afresh.
    prefWarned = calls.warn.length;
    await calls.commands.get('acc.settings.opensOn')!('home');
    assert.match(calls.warn[prefWarned] ?? '', /^The section the Command Center opens on is Where I left it, Overview, Tasks, Agents, Worktrees, Environments, Setup, Settings: not home\.$/);
    await calls.commands.get('acc.settings.opensOn')!('worktrees');
    assert.deepEqual([ctx.workspaceState.get('acc.home.opensOn'), chosen()[0]], ['worktrees', 'worktrees']);
    await calls.commands.get('acc.open.home')!();
    assert.equal(lastModel().section, 'settings', 'already open, it stays where it is');
    tab.close!();
    await calls.commands.get('acc.open.home')!();
    const reopened = panels.at(-1)!;
    reopened.receive!({ type: 'ready' });
    assert.equal((reopened.posted.filter((x) => (x as Prefs).model).at(-1) as Prefs).model!.section, 'worktrees', 'opened afresh, on the section chosen');
    await calls.commands.get('acc.open.tasks')!();
    assert.equal((reopened.posted.filter((x) => (x as Prefs).model).at(-1) as Prefs).model!.section, 'tasks', 'a section asked for still opens');
    // Notices in Slack: its commands open Settings at its part (GH-113).
    await calls.commands.get('acc.slack.connect')!();
    const toSlack = reopened.posted.at(-1) as Prefs;
    assert.deepEqual([toSlack.jump, toSlack.open, toSlack.model!.section], [true, 'settings:slack', 'settings']);
    // GitHub accounts' Sign in asks for the account it names: signed in as another, it says which it wanted (GH-150).
    const signInWarned = calls.warn.length;
    calls.signsInAs = 'someone-else';
    await calls.commands.get('acc.github.signIn')!('jordan-kim');
    calls.signsInAs = undefined;
    assert.deepEqual(calls.warn.slice(signInWarned), ['That\'s someone-else, but this repo works as jordan-kim.']);

    // With the page closed, acc.palette opens it, and the palette message waits for the page to be ready (T-52).
    reopened.close!();
    await calls.commands.get('acc.palette')!();
    const fresh = panels.at(-1)!;
    assert.notEqual(fresh, reopened, 'a page opened for it');
    assert.ok(!fresh.posted.some((x) => (x as { type?: string }).type === 'palette'), 'nothing is posted before the page is ready: it would be lost');
    fresh.receive!({ type: 'ready' });
    assert.deepEqual(fresh.posted.map((x) => (x as { type: string }).type).slice(-1), ['palette'], 'once ready, after its model, the page gets the palette message');
    assert.ok(fresh.posted.some((x) => (x as { type?: string }).type === 'state'), 'and its model first');
    fresh.receive!({ type: 'ready' });
    assert.equal(fresh.posted.filter((x) => (x as { type?: string }).type === 'palette').length, 1, 'once, not again on the next ready');

    await calls.commands.get(COMMANDS.check)!('B0.repo');
    assert.match(calls.info.at(-1) ?? '', /^✓ Inside the project's repo: Repo at /);
  } finally {
    started.stop();
    if (savedClaudeDir === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = savedClaudeDir;
  }
});
