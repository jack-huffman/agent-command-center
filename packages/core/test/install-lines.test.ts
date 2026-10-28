import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BREW_INSTALL, INSTALL_LINES, needsBrew, INSTALL_SYSTEMS, type InstallTool, installCommand, installLine, installText, restartNote, RESTART_NOTE, RESTART_PAGE_NOTE, RESTART_WHY, SYSTEM, systemOf } from '../src/onboarding/install-lines.ts';
import { makeContext } from '../src/onboarding/helpers.ts';
import { runSteps, STEPS } from '../src/onboarding/steps.ts';
import { fakeRunner, NO_FILES, ok, tempDir } from './support.ts';

const MISSING = { code: 127, stdout: '', stderr: 'not found' };

test('the system is read from the platform acc runs on, and anything but a Mac or Windows is Linux', () => {
  assert.deepEqual(['darwin', 'win32', 'linux', 'freebsd'].map(systemOf), ['mac', 'windows', 'linux', 'linux']);
  assert.equal(SYSTEM, systemOf(process.platform));
});

test('the table gives the lines the person decided on for a Mac and for Windows', () => {
  assert.deepEqual(INSTALL_SYSTEMS.map((s) => installCommand('git', s)), ['brew install git', 'winget install --id Git.Git -e', 'sudo apt-get install git']);
  assert.deepEqual(['mac', 'windows'].map((s) => installCommand('gh', s as 'mac')), ['brew install gh', 'winget install --id GitHub.cli -e']);
  assert.deepEqual(['mac', 'windows'].map((s) => installCommand('node', s as 'mac')), ['brew install node', 'winget install --id OpenJS.NodeJS.LTS -e']);
  assert.deepEqual(['mac', 'windows'].map((s) => installCommand('claude', s as 'mac')), ['brew install --cask claude-code', 'irm https://claude.ai/install.ps1 | iex']);
});

test('where a maker gives Linux no one line, the line is its page, not a command', () => {
  for (const tool of ['node', 'gh'] as const) {
    assert.equal(installCommand(tool, 'linux'), null, tool);
    assert.match(installText(tool, 'linux') ?? '', /^Install it from https:\/\//, tool);
  }
  assert.equal(installText('git', 'mac'), null, 'a line to run needs no page');
  assert.deepEqual(installLine('git', 'windows'), { command: 'winget install --id Git.Git -e', shell: 'powershell' });
});

test('only Windows is told to restart VSCode after an install', () => {
  assert.equal(restartNote('windows'), RESTART_NOTE);
  assert.match(RESTART_NOTE, /isn't on its PATH until VSCode restarts/);
  assert.ok(RESTART_NOTE.endsWith(RESTART_WHY) && RESTART_PAGE_NOTE.endsWith(RESTART_WHY), 'one reason for every restart (T-133)');
  // The step page's sentence and Setup's note share one source: they differ only in how they open.
  assert.equal(RESTART_PAGE_NOTE.replace('On Windows, after it installs', 'After it installs'), RESTART_NOTE);
  assert.equal(restartNote('mac'), '');
  assert.equal(restartNote('linux'), '');
});

test('every step that offers an install line has a mac and a windows entry, and the test counts them', () => {
  const installing = STEPS.filter((s) => s.install);
  assert.deepEqual(installing.map((s) => s.id), ['A1.git', 'A1.sh', 'A1.node', 'A1.npm', 'A1.gh', 'A1.claude', 'A1.sf', 'A1.java', 'A1.python']);
  for (const s of installing) {
    const lines = INSTALL_LINES[s.install!];
    for (const system of ['mac', 'windows'] as const) {
      const line = lines[system];
      assert.ok(line && ('command' in line ? line.command.length > 0 : line.page.startsWith('https://')), `${s.id} has a ${system} line`);
    }
  }
  // A step whose fix looks like an install but names no tool would slip past the walk above.
  const looksLikeInstall = STEPS.filter((s) => /^(brew|winget) install/.test(s.fix?.command ?? '') || /\birm https/.test(s.fix?.command ?? ''));
  assert.deepEqual(looksLikeInstall.filter((s) => !s.install).map((s) => s.id), [], 'each install line comes from the table');
});

test('a tool that isn\'t installed gets the line for the system the check runs for, and Windows is told to restart VSCode', () => {
  const missing: [string, InstallTool, string[]][] = [
    ['git --version', 'git', ['A1.git']], ['gh --version', 'gh', ['A1.gh']], ['claude --version', 'claude', ['A1.claude']],
  ];
  for (const [call, tool, ids] of missing) {
    for (const system of INSTALL_SYSTEMS) {
      const ctx = { ...makeContext(tempDir(), fakeRunner({ [call]: MISSING, 'brew --version': ok('Homebrew 4.5.0') }), {}), system, files: NO_FILES };
      const res = runSteps(ctx, 'machine', ids)[0]!.result;
      assert.equal(res.status, 'fail', `${tool} on ${system}`);
      assert.equal(res.fix, installCommand(tool, system) ?? undefined, `${tool} on ${system}`);
      assert.equal(res.detail.includes(RESTART_NOTE), system === 'windows', `${tool} on ${system}`);
    }
  }
});

test('Node, a Salesforce step, gets its Windows line, and the plugin step names Claude Code\'s own line', () => {
  const node = runSteps({ ...makeContext(tempDir(), fakeRunner({ 'node --version': MISSING }), {}), system: 'windows' as const, files: NO_FILES }, 'machine', ['A1.node'])[0]!.result;
  assert.equal(node.fix, 'winget install --id OpenJS.NodeJS.LTS -e');
  const plugin = runSteps({ ...makeContext(tempDir(), fakeRunner({ 'claude plugin list --json': MISSING }), {}), system: 'windows' as const, files: NO_FILES }, 'machine', ['A4.plugin'])[0]!.result;
  assert.equal(plugin.fix, 'irm https://claude.ai/install.ps1 | iex');
  assert.match(plugin.detail, /Do A1\.claude first\./);
});

const onMac = (fixtures: Parameters<typeof fakeRunner>[0], system: 'mac' | 'windows' | 'linux' = 'mac') => ({ ...makeContext(tempDir(), fakeRunner(fixtures), {}), system, files: NO_FILES });

test('A1.brew passes on a Mac that has Homebrew, and fails with Homebrew\'s own installer when it is missing', () => {
  const present = runSteps(onMac({ 'brew --version': ok('Homebrew 4.5.0\nHomebrew/homebrew-core') }), 'machine', ['A1.brew'])[0]!.result;
  assert.deepEqual([present.status, present.detail], ['pass', 'brew 4.5.0']);
  const missing = runSteps(onMac({ 'brew --version': MISSING }), 'machine', ['A1.brew'])[0]!.result;
  assert.deepEqual([missing.status, missing.detail], ['fail', 'Homebrew isn\'t installed.']);
  assert.equal(STEPS.find((s) => s.id === 'A1.brew')!.fix?.command, BREW_INSTALL);
  assert.equal(BREW_INSTALL, '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
  const broken = runSteps(onMac({ 'brew --version': { code: 1, stdout: '', stderr: 'Error: broken' } }), 'machine', ['A1.brew'])[0]!.result;
  assert.deepEqual([broken.status, broken.detail], ['fail', 'brew didn\'t run: Error: broken']);
});

test('A1.brew is skipped with a reason on Windows and Linux, and is the first of the tools', () => {
  for (const system of ['windows', 'linux'] as const) {
    const r = runSteps(onMac({}, system), 'machine', ['A1.brew'])[0]!.result;
    assert.equal(r.status, 'skip', system);
    assert.match(r.detail, /^Only on a Mac/, system);
  }
  const ids = STEPS.map((s) => s.id);
  assert.ok(ids.indexOf('A1.brew') < ids.indexOf('A1.git'), 'before the steps whose Mac line is a brew command');
});

test('while Homebrew is missing on a Mac, a step whose line is a brew command says to do A1.brew first, and Windows doesn\'t', () => {
  const none = { 'brew --version': MISSING };
  for (const [call, id] of [['git --version', 'A1.git'], ['node --version', 'A1.node'], ['gh --version', 'A1.gh'], ['claude --version', 'A1.claude']] as const) {
    const r = runSteps(onMac({ ...none, [call]: MISSING }), 'machine', [id])[0]!.result;
    assert.match(r.detail, /do A1\.brew first\.$/, id);
    assert.equal(r.fix, BREW_INSTALL, id);
    const win = runSteps(onMac({ ...none, [call]: MISSING }, 'windows'), 'machine', [id])[0]!.result;
    assert.doesNotMatch(win.detail, /A1\.brew/, `${id} on Windows`);
  }
  const plugin = runSteps(onMac({ ...none, 'claude plugin list --json': MISSING }), 'machine', ['A4.plugin'])[0]!.result;
  assert.match(plugin.detail, /Do A1\.claude first\. Homebrew isn't installed: do A1\.brew first\./);
  assert.ok(needsBrew('git', 'mac') && !needsBrew('git', 'windows') && !needsBrew('claude', 'linux'));
});

test('an installed tool says nothing of installing, on any system', () => {
  for (const system of INSTALL_SYSTEMS) {
    const ctx = { ...makeContext(tempDir(), fakeRunner({ 'git --version': ok('git version 2.45.0') }), {}), system, files: NO_FILES };
    const res = runSteps(ctx, 'machine', ['A1.git'])[0]!.result;
    assert.deepEqual([res.status, res.fix], ['pass', undefined], system);
  }
});
