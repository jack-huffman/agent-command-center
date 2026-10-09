// The Command Center's first open in a folder that isn't set up (GH-138): nothing opens on its own when a
// folder opens, the first open lands on Setup once per folder, and the walkthroughs open when asked for.
// The decisions are tested here, then the built extension against the vscode stand-in. Run after npm run build.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FIRST_OPEN_STATE, firstOpen, type FirstOpenInput, KIND_QUESTION, machineDone, SETUP_PARTS } from '../src/logic/first-open.ts';
import { COMMANDS, type DoctorItem, EXTENSION_ID, WALKTHROUGHS } from '../src/logic/setup.ts';
import { setupModel } from '../src/model/setup.ts';
import { makeRepo, tempDir } from '../../packages/core/test/support.ts';
import { activate, fakeVscode, until } from './vscode.ts';

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));

const item = (id: string, part: 'machine' | 'project', status: DoctorItem['status']): DoctorItem => ({ id, part, title: id, status, detail: '' });

test('the first open lands on Setup only in a folder that isn\'t set up, with nothing asked for, once', () => {
  const base: FirstOpenInput = { asked: false, open: false, shown: false, setUp: false, machineDone: true };
  assert.deepEqual(firstOpen(base), { section: 'setup', part: SETUP_PARTS.kind }, 'at what kind of project it is');
  assert.deepEqual(firstOpen({ ...base, machineDone: false }), { section: 'setup', part: SETUP_PARTS.machine }, 'at the machine part while it has steps to do');
  const not: [string, Partial<FirstOpenInput>][] = [
    ['a section asked for, such as Connect a tracker\'s', { asked: true }],
    ['the tab already open', { open: true }],
    ['a second open', { shown: true }],
    ['a folder that\'s set up', { setUp: true }],
    ['no folder open', { setUp: null }],
  ];
  for (const [why, change] of not) assert.equal(firstOpen({ ...base, ...change }), null, why);
  assert.equal(not.length, 5);
});

test('the machine is done when every one of its steps passed, doesn\'t apply or was done by hand, and not before it\'s checked', () => {
  assert.equal(machineDone([], new Set()), false, 'nothing checked yet');
  assert.equal(machineDone([item('A1.git', 'machine', 'pass'), item('A1.node', 'machine', 'skip'), item('B0.config', 'project', 'fail')], new Set()), true, 'a project step doesn\'t count');
  assert.equal(machineDone([item('A1.git', 'machine', 'pass'), item('A1.gh', 'machine', 'fail')], new Set()), false);
  assert.equal(machineDone([item('A1.git', 'machine', 'pass'), item('A1.gh', 'machine', 'unknown')], new Set(['A1.gh'])), true, 'confirmed by hand');
});

test('Setup asks what kind of project it is only in a folder that isn\'t set up, whatever its profile will be', () => {
  const machineOnly = [item('A1.git', 'machine', 'pass')];
  const m = setupModel(machineOnly, new Set(), false);
  assert.equal(m.start?.question, KIND_QUESTION);
  assert.equal(m.start?.part, SETUP_PARTS.kind);
  assert.deepEqual(m.start?.actions.map((a) => [a.label, a.command, a.ref]), [['Choose…', 'acc.step.fix', { step: 'B0.config' }], ['Guide', 'acc.openGuide', { step: 'B0.config' }]], 'B0.config\'s Do it answers it');
  assert.deepEqual(m.parts.map((p) => [p.part, p.jump, p.steps.length]), [['machine', SETUP_PARTS.machine, 1], ['project', SETUP_PARTS.project, 0]], 'This project shows, with no checks of its own yet');
  assert.equal(setupModel(machineOnly, new Set(), true).start, null, 'set up');
  assert.equal(setupModel(machineOnly, new Set(), null).start, null, 'no folder open');
  assert.deepEqual(setupModel(machineOnly, new Set(), true).parts.map((p) => p.part), ['machine'], 'and no empty This project');
});

type Posted = { type?: string; jump?: boolean; open?: string; model?: { section: string; setup: { start: { question: string } | null } } };
type Started = { fake: ReturnType<typeof fakeVscode>; started: ReturnType<typeof activate> };

/**
 * The built extension in a folder of its own, in a sandbox: its own home, gh, claude and sf that fail at
 * once, and this machine's results given, so no machine check runs. Each run loads the extension afresh.
 */
async function inFolder(files: Record<string, string>, machine: DoctorItem['status'], profile: string, fn: (s: Started & { repo: string }) => Promise<void>): Promise<void> {
  const sandbox = realpathSync(tempDir('acc-first-open-'));
  const at = (...p: string[]) => join(sandbox, ...p);
  for (const d of ['home/.claude', 'state/questions', 'state/heavy', 'state/slack', 'bin']) mkdirSync(at(d), { recursive: true });
  writeFileSync(at('home', '.claude.json'), '{"projects":{}}\n');
  for (const name of ['gh', 'claude', 'sf', 'code', 'open', 'osascript', 'caffeinate']) {
    writeFileSync(at('bin', name), '#!/bin/sh\nexit 1\n');
    chmodSync(at('bin', name), 0o755);
  }
  const saved = { ...process.env };
  Object.assign(process.env, {
    HOME: at('home'), CLAUDE_CONFIG_DIR: at('home', '.claude'), PATH: `${at('bin')}:${process.env.PATH}`, NO_COLOR: '1',
    ACC_QUESTIONS_DIR: at('state', 'questions'), ACC_HEAVY_DIR: at('state', 'heavy'), ACC_MACHINE_FILE: at('state', 'machine.json'), ACC_REPOS_FILE: at('state', 'repos.json'),
    ACC_RUNTIME_FILE: at('state', 'runtime'), ACC_SLACK_DIR: at('state', 'slack'),
  });
  delete process.env.ACC_ROLE;
  delete process.env.ACC_TASK;
  const repo = makeRepo(files);
  const fake = fakeVscode(repo);
  const version = (JSON.parse(readFileSync(join(dist, '..', '..', 'package.json'), 'utf8')) as { version: string }).version;
  // No acc.welcomed: before GH-138, a machine's first window opened the machine walkthrough.
  const started = activate(dist, fake, { 'acc.machineItems': { at: Date.now(), profile, version, items: [item('A1.git', 'machine', machine)] } });
  try {
    // Started, its whole setup pass done.
    await until(() => fake.calls.contexts.get('acc.profile') === profile && fake.calls.contexts.has('acc.step.A1.git'), 60_000);
    // And listening for agents' questions, which starts once the projects load: started after stop(), its
    // file watcher would outlive the test and keep the process from exiting.
    await until(() => readdirSync(at('state', 'questions')).length > 0, 60_000);
    await fn({ fake, started, repo });
  } finally {
    started.stop();
    delete createRequire(import.meta.url).cache[dist];
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

const walkthroughs = (fake: Started['fake']) => fake.calls.executed.filter(([id]) => id === 'workbench.action.openWalkthrough');
const lastState = (tab: { posted: unknown[] }) => (tab.posted as Posted[]).filter((x) => x.model).at(-1)!;

test('a Salesforce folder that isn\'t set up opens nothing, and the Command Center\'s first open there lands on Setup, once', { timeout: 120_000 }, async () => {
  await inFolder({ 'sfdx-project.json': '{"packageDirectories":[{"path":"force-app","default":true}]}\n' }, 'pass', 'none', async ({ fake, started }) => {
    const { calls, panels } = fake;
    const { ctx } = started;
    // Opening the folder: no walkthrough tab, no Command Center, no notification.
    assert.deepEqual(walkthroughs(fake), []);
    assert.equal(panels.length, 0);
    assert.deepEqual([calls.info, calls.warn, calls.error], [[], [], []]);
    assert.equal(ctx.workspaceState.get(FIRST_OPEN_STATE), undefined);

    // Sent somewhere, such as Tasks by Connect a tracker, it goes there, and that isn't its first open.
    await calls.commands.get('acc.open.tasks')!();
    const sent = panels[0]!;
    sent.receive!({ type: 'ready' });
    assert.equal(lastState(sent).model!.section, 'tasks');
    assert.equal(ctx.workspaceState.get(FIRST_OPEN_STATE), undefined);
    sent.close!();
    // And a section picked in the sidebar's list, which names it.
    await calls.commands.get('acc.open.home')!('worktrees');
    const picked = panels.at(-1)!;
    picked.receive!({ type: 'ready' });
    assert.equal(lastState(picked).model!.section, 'worktrees');
    assert.equal(ctx.workspaceState.get(FIRST_OPEN_STATE), undefined);
    picked.close!();

    // Opened by a person, from the activity bar, the status bar or a command: Setup, at what kind of project it is.
    await calls.commands.get('acc.open.home')!();
    const first = panels.at(-1)!;
    first.receive!({ type: 'ready' });
    const landed = lastState(first);
    assert.deepEqual([landed.model!.section, landed.jump, landed.open], ['setup', true, SETUP_PARTS.kind]);
    assert.equal(landed.model!.setup.start?.question, KIND_QUESTION);
    assert.equal(ctx.workspaceState.get(FIRST_OPEN_STATE), true, 'remembered for the folder');

    // The walkthroughs open when asked for: Setup's buttons send their commands, and each opens its own.
    const ran = calls.executed.length;
    first.receive!({ type: 'toolbar', command: COMMANDS.machine });
    first.receive!({ type: 'toolbar', command: COMMANDS.project });
    assert.deepEqual(calls.executed.slice(ran).map(([id]) => id), [COMMANDS.machine, COMMANDS.project], 'the page may ask for both');
    await calls.commands.get(COMMANDS.machine)!();
    await calls.commands.get(COMMANDS.project)!();
    assert.deepEqual(walkthroughs(fake).map(([, args]) => args), [[`${EXTENSION_ID}#${WALKTHROUGHS.machine.id}`, false], [`${EXTENSION_ID}#${WALKTHROUGHS.project.id}`, false]]);

    // Left at Agents, the next open is where it was left, not Setup.
    first.receive!({ type: 'nav', section: 'agents' });
    first.close!();
    await calls.commands.get('acc.open.home')!();
    const second = panels.at(-1)!;
    second.receive!({ type: 'ready' });
    const again = lastState(second);
    assert.equal(again.model!.section, 'agents');
    assert.equal(again.open, undefined);
    assert.equal(panels.length, 4);
  });
});

test('on a machine with steps still to do, the first open in a folder of any kind lands on Setup\'s machine part', { timeout: 120_000 }, async () => {
  // No sfdx-project.json: a folder of no profile yet gets the same first open.
  await inFolder({ 'README.md': '# A repo\n' }, 'fail', 'none', async ({ fake }) => {
    assert.deepEqual(walkthroughs(fake), []);
    assert.equal(fake.panels.length, 0);
    await fake.calls.commands.get('acc.open.home')!();
    const tab = fake.panels[0]!;
    tab.receive!({ type: 'ready' });
    const landed = lastState(tab);
    assert.deepEqual([landed.model!.section, landed.open], ['setup', SETUP_PARTS.machine]);
    assert.equal(landed.model!.setup.start?.question, KIND_QUESTION, 'and This project asks what kind it is');
  });
});

test('a folder that\'s set up opens as it did: the section it was left at, never Setup on its own', { timeout: 120_000 }, async () => {
  const config = JSON.stringify({ schema: 1, project: 'Tool', profile: 'generic', environments: [{ name: 'main', default: true }], trackers: [{ kind: 'github' }] });
  await inFolder({ '.acc/config.json': config, '.gitignore': '.claude/worktrees/\n' }, 'pass', 'generic', async ({ fake, started }) => {
    assert.deepEqual(walkthroughs(fake), []);
    await fake.calls.commands.get('acc.open.home')!();
    const tab = fake.panels[0]!;
    tab.receive!({ type: 'ready' });
    const opened = lastState(tab);
    assert.deepEqual([opened.model!.section, opened.open], ['overview', undefined]);
    assert.equal(opened.model!.setup.start, null, 'and Setup asks nothing');
    assert.equal(started.ctx.workspaceState.get(FIRST_OPEN_STATE), undefined);
  });
});
