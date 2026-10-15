// The Command Center's first open in a folder that isn't set up (GH-138): nothing opens on its own when a
// folder opens, the first open lands on Setup once per folder, and the walkthroughs open when asked for.
// The decisions are tested here, then the built extension against the vscode stand-in. Run after npm run build.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FIRST_OPEN_STATE, FIRST_OPEN_WAIT_MS, firstOpen, type FirstOpenInput, KIND_QUESTION, machineDone, SETUP_PARTS, waitsForMachine } from '../src/logic/first-open.ts';
import { COMMANDS, type DoctorItem, EXTENSION_ID, WALKTHROUGHS } from '../src/logic/setup.ts';
import { setupModel } from '../src/model/setup.ts';
import { makeRepo, tempDir } from '../../packages/core/test/support.ts';
import { activate, fakeVscode, until } from './vscode.ts';

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));

const item = (id: string, part: 'machine' | 'project', status: DoctorItem['status']): DoctorItem => ({ id, part, title: id, status, detail: '' });

test('the first open lands on Setup only in a folder that isn\'t set up, with nothing asked for, once', () => {
  const base: FirstOpenInput = { asked: false, open: false, shown: false, setUp: false, machineChecked: true, machineDone: true };
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

test('a first open before the machine is checked waits for it, and still unchecked lands at the question, not This machine', () => {
  const early: FirstOpenInput = { asked: false, open: false, shown: false, setUp: false, machineChecked: false, machineDone: false };
  assert.equal(waitsForMachine(early), true);
  assert.deepEqual(firstOpen(early), { section: 'setup', part: SETUP_PARTS.kind }, 'the machine may well be ready');
  assert.equal(waitsForMachine({ ...early, machineChecked: true }), false, 'checked: no wait, and its results decide');
  // Only a first open waits: an open that wouldn't land on Setup goes at once.
  const not: Partial<FirstOpenInput>[] = [{ asked: true }, { open: true }, { shown: true }, { setUp: true }, { setUp: null }];
  for (const change of not) assert.equal(waitsForMachine({ ...early, ...change }), false, JSON.stringify(change));
  assert.ok(FIRST_OPEN_WAIT_MS >= 2000 && FIRST_OPEN_WAIT_MS <= 5000, 'a few seconds');
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

type WaitTimer = { requested: number; fire: () => void };
/** Waits for cond, up to what's left of the test's budget, and fails naming what. */
type Wait = (what: string, cond: () => boolean) => Promise<void>;
/** Waits for p in the same way. */
type Settle = <T>(what: string, p: Promise<T>) => Promise<T>;

/** All a test in a folder may wait, for the checks, the open and the listener together (T-51). */
const FOLDER_BUDGET_MS = 150_000;
/** Its timeout: the budget, and time to put the folder back after it, so a slow test fails rather than being cancelled. */
const IN_FOLDER = { timeout: FOLDER_BUDGET_MS + 30_000 };

/** Takes over the one timer the first open's wait sets (FIRST_OPEN_WAIT_MS); every other timer runs as it does. */
function holdWaitTimer(): { waitTimer: WaitTimer; restore: () => void } {
  const real = globalThis.setTimeout;
  let fn: (() => void) | undefined;
  const waitTimer: WaitTimer = { requested: 0, fire: () => { const f = fn; fn = undefined; f?.(); } };
  globalThis.setTimeout = ((cb: () => void, ms?: number, ...rest: unknown[]) => {
    if (ms !== FIRST_OPEN_WAIT_MS) return real(cb, ms, ...rest);
    waitTimer.requested++;
    fn = cb;
    // A handle for clearTimeout, which never fires.
    return real(() => {}, 2 ** 31 - 1).unref();
  }) as typeof setTimeout;
  return { waitTimer, restore: () => { globalThis.setTimeout = real; } };
}

/**
 * The built extension in a folder of its own, in a sandbox: its own home, gh, claude and sf that fail at
 * once, and this machine's results given, so no machine check runs. Each run loads the extension afresh.
 * Early (GH-149), the results given are an older version's, as in the first window after an upgrade, so the
 * checks run again, and claude --version doesn't answer until fn calls release(): fn runs while they're
 * running. The wait's own timer is held too (waitTimer): it fires only when fn says so, so the machine's
 * speed can't change which of the two ends the open first (T-20: the first check is two acc doctor runs
 * one after the other, and a 1 s sleep on top, all racing a real 4 s timer; on a busy machine the timer won,
 * "waited 4008 ms"). With
 * doctorFails, the results are as old and every acc doctor prints none, and fn runs once that check is over.
 *
 * Every wait in here, and each one fn makes through wait() and settle(), shares one budget (budgetMs), well
 * under the test's timeout (T-51). A test that runs out fails naming what it waited for, and its finally
 * puts the folder back before the next test starts. node:test doesn't stop a test's body at its timeout:
 * with waits longer than the timeout (60 s, 60 s, and an open with no end), a busy machine's test was
 * cancelled while its body went on, and its finally later gave the next test the real HOME, PATH and
 * setTimeout, so that test's checks ran the real tools and waited for files nothing would write. With
 * slow, each fake tool sleeps that many seconds before it answers, as on a busy machine.
 */
async function inFolder(files: Record<string, string>, machine: DoctorItem['status'], profile: string, fn: (s: Started & { repo: string; release: () => void; waitTimer: WaitTimer; wait: Wait; settle: Settle }) => Promise<void>, opts: { early?: boolean; doctorFails?: boolean; slow?: number; budgetMs?: number } = {}): Promise<void> {
  const end = Date.now() + (opts.budgetMs ?? FOLDER_BUDGET_MS);
  const wait: Wait = (what, cond) => until(cond, Math.max(0, end - Date.now()), what);
  const settle: Settle = async (what, p) => {
    let done = false;
    const ended = p.finally(() => { done = true; });
    // Out of budget, the wait throws; p may still fail later, after nobody listens.
    ended.catch(() => {});
    await wait(what, () => done);
    return ended;
  };
  const sandbox = realpathSync(tempDir('acc-first-open-'));
  const at = (...p: string[]) => join(sandbox, ...p);
  for (const d of ['home/.claude', 'state/questions', 'state/heavy', 'state/slack', 'bin']) mkdirSync(at(d), { recursive: true });
  writeFileSync(at('home', '.claude.json'), '{"projects":{}}\n');
  const slow = `sleep ${opts.slow ?? 0}\n`;
  // The held claude --version ends at the release, or at the budget's end by the clock, however slow each sleep is.
  const holdVersion = `[ "$1" = --version ] && while [ ! -f '${at('release')}' ] && [ "$(date +%s)" -lt ${Math.ceil(end / 1000)} ]; do sleep 0.05; done\n`;
  for (const name of ['gh', 'claude', 'sf', 'code', 'open', 'osascript', 'caffeinate']) {
    writeFileSync(at('bin', name), `#!/bin/sh\n${slow}${name === 'claude' && opts.early ? holdVersion : ''}exit 1\n`);
    chmodSync(at('bin', name), 0o755);
  }
  const saved = { ...process.env };
  const held = opts.early || opts.doctorFails ? holdWaitTimer() : null;
  Object.assign(process.env, {
    HOME: at('home'), CLAUDE_CONFIG_DIR: at('home', '.claude'), PATH: `${at('bin')}:${process.env.PATH}`, NO_COLOR: '1',
    ACC_QUESTIONS_DIR: at('state', 'questions'), ACC_HEAVY_DIR: at('state', 'heavy'), ACC_MACHINE_FILE: at('state', 'machine.json'), ACC_REPOS_FILE: at('state', 'repos.json'),
    ACC_RUNTIME_FILE: at('state', 'runtime'), ACC_SLACK_DIR: at('state', 'slack'),
  });
  // Node reads NODE_OPTIONS as it starts, so only the acc runs started from here on load this.
  writeFileSync(at('bin', 'no-doctor.cjs'), "if (process.argv.includes('doctor')) { process.stdout.write('acc broke'); process.exit(1); }\n");
  if (opts.doctorFails) process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS ?? ''} --require ${at('bin', 'no-doctor.cjs')}`.trim();
  delete process.env.ACC_ROLE;
  delete process.env.ACC_TASK;
  const repo = makeRepo(files);
  const fake = fakeVscode(repo);
  const version = (JSON.parse(readFileSync(join(dist, '..', '..', 'package.json'), 'utf8')) as { version: string }).version;
  // No acc.welcomed: before GH-138, a machine's first window opened the machine walkthrough.
  const activated = activate(dist, fake, { 'acc.machineItems': { at: Date.now(), profile, version: opts.early || opts.doctorFails ? `${version}-older` : version, items: [item('A1.git', 'machine', machine)] } });
  let stopped = false;
  const started = { ...activated, stop: () => { if (!stopped) activated.stop(); stopped = true; } };
  const ready = async () => {
    // Started, its whole setup pass done: with acc doctor failing, there are no steps to show.
    await wait('the extension to start and its first check to finish', () => fake.calls.contexts.get('acc.profile') === profile && (opts.doctorFails || fake.calls.contexts.has('acc.step.A1.git')));
    // And listening for agents' questions, which starts once the projects load, so nothing it starts is
    // left for the next test. A stopped extension never listens: that file would never come.
    if (!stopped) await wait('the extension to listen for agents\' questions', () => readdirSync(at('state', 'questions')).length > 0);
  };
  try {
    if (!opts.early) await ready();
    await fn({ fake, started, repo, release: () => writeFileSync(at('release'), ''), waitTimer: held?.waitTimer ?? { requested: 0, fire: () => {} }, wait, settle });
    if (opts.early) await ready();
  } finally {
    // A test that fails before it releases the held check still lets the fake claude end.
    writeFileSync(at('release'), '');
    held?.restore();
    started.stop();
    delete createRequire(import.meta.url).cache[dist];
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
}

const walkthroughs = (fake: Started['fake']) => fake.calls.executed.filter(([id]) => id === 'workbench.action.openWalkthrough');
const lastState = (tab: { posted: unknown[] }) => (tab.posted as Posted[]).filter((x) => x.model).at(-1)!;

test('a Salesforce folder that isn\'t set up opens nothing, and the Command Center\'s first open there lands on Setup, once', IN_FOLDER, async () => {
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

test('on a machine with steps still to do, the first open in a folder of any kind lands on Setup\'s machine part', IN_FOLDER, async () => {
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

test('a folder that\'s set up opens as it did: the section it was left at, never Setup on its own', IN_FOLDER, async () => {
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

const sfdx = { 'sfdx-project.json': '{"packageDirectories":[{"path":"force-app","default":true}]}\n' };
const OPEN_ITEM = '$(home) Open the Command Center';

test('the status bar menu\'s Open the Command Center is a first open too: it lands on Setup', IN_FOLDER, async () => {
  await inFolder(sfdx, 'pass', 'none', async ({ fake, started }) => {
    const offered: string[] = [];
    fake.calls.pick = (items) => {
      const all = items as unknown as { label: string }[];
      offered.push(...all.map((i) => i.label));
      return all.find((i) => i.label === OPEN_ITEM);
    };
    await fake.calls.commands.get('acc.status.menu')!();
    assert.ok(offered.includes(OPEN_ITEM), 'the menu offers it');
    assert.equal(fake.panels.length, 1);
    const tab = fake.panels[0]!;
    tab.receive!({ type: 'ready' });
    const landed = lastState(tab);
    assert.deepEqual([landed.model!.section, landed.open], ['setup', SETUP_PARTS.kind]);
    assert.equal(started.ctx.workspaceState.get(FIRST_OPEN_STATE), true);
  });
});

test('the launcher view becoming visible, as the activity bar icon makes it, is a first open: it lands on Setup', IN_FOLDER, async () => {
  await inFolder(sfdx, 'pass', 'none', async ({ fake, started, wait }) => {
    const shown = fake.treeShown.get('acc.home')!;
    assert.equal(shown.length, 1, 'the launcher listens');
    // Hidden, it opens nothing.
    for (const l of shown) l({ visible: false });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(fake.panels.length, 0);
    for (const l of shown) l({ visible: true });
    await wait('the Command Center\'s tab', () => fake.panels.length === 1);
    const tab = fake.panels[0]!;
    tab.receive!({ type: 'ready' });
    const landed = lastState(tab);
    assert.deepEqual([landed.model!.section, landed.open], ['setup', SETUP_PARTS.kind]);
    assert.equal(started.ctx.workspaceState.get(FIRST_OPEN_STATE), true);
    assert.ok(fake.calls.executed.some(([id]) => id === 'workbench.action.closeSidebar'), 'and the sidebar closes, as openFromActivityBar says');
  });
});

test('an early first open on a ready machine waits for the checks, and when the wait ends first lands at the question, not This machine', IN_FOLDER, async () => {
  await inFolder(sfdx, 'pass', 'none', async ({ fake, started, release, waitTimer, settle }) => {
    const { calls, panels } = fake;
    const opening = calls.commands.get('acc.open.home')!() as Promise<void>;
    // It waits: no tab yet, and the first open isn't spent. The checks are held, and so is the wait's timer.
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(waitTimer.requested, 1, 'one wait, of FIRST_OPEN_WAIT_MS');
    assert.equal(panels.length, 0, 'waiting for the checks');
    assert.equal(started.ctx.workspaceState.get(FIRST_OPEN_STATE), undefined);
    // Clicked again meanwhile, it's the same first open: one tab, and the jump to its part isn't lost.
    const again = calls.commands.get('acc.open.home')!() as Promise<void>;
    // The wait runs out with the checks still held: it's the wait that ended the open.
    waitTimer.fire();
    await settle('both opens to end when the wait ran out', Promise.all([opening, again]));
    assert.equal(panels.length, 1);
    assert.equal(calls.contexts.has('acc.step.A1.git'), false, 'the checks still haven\'t finished');
    const tab = panels[0]!;
    tab.receive!({ type: 'ready' });
    const landed = lastState(tab);
    assert.deepEqual([landed.model!.section, landed.jump, landed.open], ['setup', true, SETUP_PARTS.kind], 'the question, not a machine it couldn\'t check');
    assert.equal(started.ctx.workspaceState.get(FIRST_OPEN_STATE), true);
    release();
  }, { early: true });
});

/** An early first open whose checks finish inside the wait lands at This machine; slow, each fake tool takes that many seconds. */
const checksInsideTheWait = (slow?: number) => inFolder(sfdx, 'pass', 'none', async ({ fake, release, waitTimer, settle }) => {
  const { calls, panels } = fake;
  assert.equal(calls.contexts.has('acc.step.A1.git'), false, 'opened while the checks run');
  const opening = calls.commands.get('acc.open.home')!() as Promise<void>;
  // The wait's timer never fires here, so only the checks finishing can end the open, however slow the
  // machine is. An open that didn't wait for them would have a tab by now.
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(waitTimer.requested, 1, 'one wait, of FIRST_OPEN_WAIT_MS');
  assert.equal(panels.length, 0, 'it waits for the checks');
  release();
  await settle('the first open to end when the checks finished', opening);
  assert.ok(calls.contexts.has('acc.step.A1.git'), 'the checks finished first');
  const tab = panels[0]!;
  tab.receive!({ type: 'ready' });
  const landed = lastState(tab);
  // The sandbox's claude fails, so the machine has a step to do, whatever the older results said.
  assert.deepEqual([landed.model!.section, landed.open], ['setup', SETUP_PARTS.machine]);
}, { early: true, slow });

test('an early first open whose checks finish inside the wait, with a step failing, lands at This machine', IN_FOLDER, () => checksInsideTheWait());

test('a slow machine, each tool taking 1 s to answer, still finishes the early first open inside its wait (T-51)', IN_FOLDER, async () => {
  const began = Date.now();
  await checksInsideTheWait(1);
  // Each of the check's tools slept: the fake was slow, and the test still ended, on the checks.
  assert.ok(Date.now() - began > 1000 * 3, `took ${Date.now() - began} ms`);
});

test('a check slower than the test\'s budget fails naming what it waited for, and puts the folder back for the next test (T-51)', IN_FOLDER, async () => {
  const before = { home: process.env.HOME, path: process.env.PATH, timer: globalThis.setTimeout };
  const began = Date.now();
  let ran = false;
  await assert.rejects(
    inFolder(sfdx, 'pass', 'none', async ({ release }) => { ran = true; release(); }, { early: true, slow: 1, budgetMs: 1000 }),
    /^Error: timed out after \d+ ms waiting for the extension to start and its first check to finish$/,
  );
  assert.ok(ran, 'the test\'s own part ran');
  // Failed at its budget's end, not at the test's timeout, after which node:test would leave it running.
  assert.ok(Date.now() - began < 20_000, `failed after ${Date.now() - began} ms`);
  assert.deepEqual({ home: process.env.HOME, path: process.env.PATH, timer: globalThis.setTimeout }, before, 'this process\'s HOME, PATH and timers are its own again');
});

test('a first check that gets no results from acc doctor hasn\'t checked the machine: the first open lands at the question', IN_FOLDER, async () => {
  await inFolder({ 'README.md': '# A repo\n' }, 'pass', 'none', async ({ fake, started, settle }) => {
    const { calls, panels } = fake;
    assert.equal(calls.contexts.has('acc.step.A1.git'), false, 'the check finished, with no machine rows');
    await settle('the first open to end after a check with no results', calls.commands.get('acc.open.home')!() as Promise<void>);
    // The wait's timer never fires here, so the open came back because the check was over, not on time:
    // an open that waited for the timer would fail at the budget's end.
    const tab = panels[0]!;
    tab.receive!({ type: 'ready' });
    const landed = lastState(tab);
    assert.deepEqual([landed.model!.section, landed.open], ['setup', SETUP_PARTS.kind], 'not a machine it couldn\'t check');
    assert.equal(started.ctx.workspaceState.get(FIRST_OPEN_STATE), true);
  }, { doctorFails: true });
});

test('a first open still waiting when the extension stops opens nothing, so no page or poll outlives it (GH-149)', IN_FOLDER, async () => {
  await inFolder(sfdx, 'pass', 'none', async ({ fake, started, release, waitTimer }) => {
    // Opened early, it waits for the checks; the window closes during that wait.
    void fake.calls.commands.get('acc.open.home')!();
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(fake.panels.length, 0, 'still waiting');
    started.stop();
    // The wait runs out after the stop: nothing was opened by an extension that had stopped.
    waitTimer.fire();
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(fake.panels.length, 0, 'nothing opened after it stopped');
    release();
  }, { early: true });
});

