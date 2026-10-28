// Starting a project checks this machine first (T-133): Setup's list of what's still to do, each with its Do it,
// before the project's settings are written, with Go on anyway and Not now; a tool installed but not on PATH has its
// own look; a fix that changes PATH asks first; and Check this machine is a process.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CHECK_MACHINE, inProcessWords, processLine, toolLineDoes } from '../src/logic/processes.ts';
import { type DoctorItem, fixPlan, initArgs, initCommand } from '../src/logic/setup.ts';
import { MACHINE_FIRST_PART, machineFirst, setupModel, STATUS } from '../src/model/setup.ts';
import { addToUserPath, brewShellenv, RESTART, zprofilePath } from '../../packages/core/src/onboarding/path-fix.ts';
import { makeRepo } from '../../packages/core/test/support.ts';
import { activate, fakeVscode, sandboxEnv, until } from './vscode.ts';

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));

const item = (id: string, status: DoctorItem['status'], over: Partial<DoctorItem> = {}): DoctorItem =>
  ({ id, part: 'machine', title: id, status, detail: `${id}: ${status}`, ...over });

/** The machine as the screenshots show it: git ready, the GitHub CLI missing, Claude Code installed but not on PATH. */
const MACHINE: DoctorItem[] = [
  item('A1.git', 'pass'),
  item('A1.gh', 'fail', { fix: 'brew install gh' }),
  item('A1.claude', 'fail', { place: '/opt/homebrew/bin', fix: brewShellenv('/opt/homebrew/bin'), ask: 'Add Homebrew\'s shellenv line to ~/.zprofile, so /opt/homebrew/bin is on your PATH?' }),
];

test('a project being started lists what this machine still needs first, one missing and one not on PATH, with Go on anyway and Not now', () => {
  const m = setupModel(MACHINE, new Set(), false, { profile: 'generic', ids: ['A1.git', 'A1.gh', 'A1.claude'] });
  const f = m.machineFirst!;
  assert.equal(f.part, MACHINE_FIRST_PART);
  assert.equal(f.title, 'Before the project starts: 2 things this machine needs');
  assert.deepEqual(f.rows.map((r) => [r.id, r.look.label]), [['A1.gh', 'To do'], ['A1.claude', 'Not on PATH']], 'only what is still to do, in Setup\'s order');
  assert.deepEqual(f.rows.map((r) => r.actions[0]!.label), ['Do it', 'Do it'], 'each with its Do it');
  assert.deepEqual(f.actions.map((a) => [a.label, a.command, !!a.primary]), [['Go on anyway', 'acc.start.goOn', false], ['Not now', 'acc.start.notNow', false]]);
  assert.match(f.detail, /they stay in Setup, under This machine/);
  assert.equal(setupModel(MACHINE, new Set(), false).machineFirst, null, 'no project being started shows none');
});

test('edge case: once nothing is left, the list says the machine is ready and Start the project is the one to press', () => {
  const ready = machineFirst({ profile: 'salesforce', ids: ['A1.git'] }, setupModel(MACHINE, new Set()).parts[0]!.steps);
  assert.equal(ready.title, 'This machine is ready');
  assert.deepEqual(ready.rows, []);
  assert.match(ready.detail, /every tool a Salesforce project needs\. Nothing has been written yet/);
  assert.deepEqual(ready.actions.map((a) => [a.label, !!a.primary]), [['Start the project', true], ['Not now', false]]);
  // A step the check named that has no row yet, such as one still being checked, isn't listed.
  assert.deepEqual(machineFirst({ profile: 'generic', ids: ['A1.nope'] }, []).rows, []);
});

test('a tool installed but not on PATH has its own look, with an icon and a label, orange as a step to do is', () => {
  assert.deepEqual(STATUS.notOnPath, { label: 'Not on PATH', icon: 'eye-closed', tone: 'orange' });
  const row = setupModel(MACHINE, new Set()).parts[0]!.steps.find((s) => s.id === 'A1.claude')!;
  assert.equal(row.look, STATUS.notOnPath);
  assert.equal(row.done, false);
  assert.equal(row.does, 'Add Homebrew to your PATH', 'Do it is named as what it does');
});

test('edge case: a fix only the person can do, such as quitting VSCode, offers no Do it', () => {
  const restart = item('A1.git', 'fail', { place: 'C:\\Program Files\\Git\\cmd', byHand: RESTART, detail: `git is installed. ${RESTART}` });
  const row = setupModel([restart], new Set()).parts[0]!.steps[0]!;
  assert.ok(!row.actions.some((a) => a.command === 'acc.step.fix'), 'no Do it');
  assert.equal(row.look.label, 'Not on PATH');
  assert.deepEqual(fixPlan(restart, 'winget install --id Git.Git -e'), { kind: 'say', text: RESTART }, 'Do it from elsewhere says it, and runs no install');
});

test('a fix that changes PATH asks first; one that doesn\'t runs; none to run is null', () => {
  const ask = 'Add C:\\Program Files\\Git\\cmd to your PATH?';
  assert.deepEqual(fixPlan({ fix: addToUserPath('C:\\Program Files\\Git\\cmd'), ask }, 'winget install --id Git.Git -e'), { kind: 'ask', question: ask, command: addToUserPath('C:\\Program Files\\Git\\cmd') });
  assert.deepEqual(fixPlan({ fix: null }, 'brew install gh'), { kind: 'run', command: 'brew install gh' }, 'the step\'s own line');
  assert.deepEqual(fixPlan({ fix: 'brew install --cask claude-code' }, 'claude update'), { kind: 'run', command: 'brew install --cask claude-code' }, 'the result\'s line wins');
  assert.equal(fixPlan(undefined, undefined), null);
  // A question with no line of its own asks nothing: the step's line runs as before.
  assert.deepEqual(fixPlan({ ask: 'Add it?' }, 'brew install gh'), { kind: 'run', command: 'brew install gh' });
});

test('Check this machine is a process: acc doctor --part machine reads as it, and each PATH line reads as what it does', () => {
  assert.equal(CHECK_MACHINE.name, 'Check this machine');
  assert.equal(inProcessWords('Run acc doctor --part machine to see them.'), 'Check this machine to see them.');
  assert.equal(inProcessWords('then run `acc doctor --part machine`'), 'then check this machine');
  assert.equal(processLine('acc doctor --part machine'), 'Check this machine');
  assert.equal(processLine('acc doctor'), 'Check the setup', 'the whole check keeps its own name');
  assert.equal(toolLineDoes(addToUserPath('C:\\x')), 'Add the folder to your PATH');
  assert.equal(toolLineDoes(brewShellenv('/opt/homebrew/bin')), 'Add Homebrew to your PATH');
  assert.equal(toolLineDoes(zprofilePath('/Users/jordan/.local/bin')), 'Add the folder to your PATH');
  assert.equal(toolLineDoes('winget install --id EclipseAdoptium.Temurin.25.JDK -e'), 'Install Java');
});

test('acc init goes on anyway only once the person has seen the machine\'s list', () => {
  assert.deepEqual(initArgs({ profile: 'generic', anyway: true }), ['--profile', 'generic', '--anyway']);
  assert.deepEqual(initArgs({ profile: 'generic' }), ['--profile', 'generic']);
  assert.equal(initCommand({ profile: 'salesforce', productionOrg: 'Acme Prod', anyway: true }, 'sh'), "acc init --profile salesforce --production-org 'Acme Prod' --anyway");
});

test('edge case: B0.config\'s Do it checks this machine first and writes nothing; Not now starts nothing; Go on anyway starts the project', { timeout: 240_000 }, async () => {
  const { restore } = sandboxEnv('machine-first-');
  const repo = makeRepo();
  const fake = fakeVscode(repo);
  const started = activate(dist, fake);
  try {
    const run = (id: string, ...a: unknown[]) => fake.calls.commands.get(id)!(...a) as Promise<unknown>;
    await until(() => fake.calls.commands.has('acc.step.fix'), 20_000, 'the commands');
    fake.calls.pick = (items) => items.find((i) => String((i as { label?: string }).label).includes('Other project'));
    await run('acc.step.fix', 'B0.config');
    // The sandbox's gh and claude fail, so the list shows, at the top of Setup, and nothing is written.
    const opened = () => fake.calls.executed.filter(([id, args]) => id === 'acc.open.home' && args[0] === 'setup' && args[1] === MACHINE_FIRST_PART);
    assert.equal(opened().length, 1, 'Setup opens at the list');
    const config = join(repo, '.acc', 'config.json');
    assert.equal(existsSync(config), false, 'nothing is written before the person goes on');
    await run('acc.start.notNow');
    await run('acc.start.goOn');
    assert.ok(fake.calls.info.includes('No project is waiting to start.'), 'Not now left nothing to start');
    assert.equal(existsSync(config), false);
    await run('acc.step.fix', 'B0.config');
    assert.equal(opened().length, 2);
    await run('acc.start.goOn');
    await until(() => existsSync(config), 120_000, 'acc init, gone on anyway, to write the settings');
  } finally {
    started.stop();
    restore();
  }
});
