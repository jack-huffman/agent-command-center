// What a machine needs, by system and profile, and how a tool that's installed but not on PATH is told apart
// from a missing one (T-133): machine-needs.ts, path-fix.ts, machine-check.ts and the A1 steps that read them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeContext } from '../src/onboarding/helpers.ts';
import { APP_INSTALLER_PAGE, INSTALL_LINES, INSTALL_SYSTEMS, type InstallSystem, RESTART_WHY, WINGET_REGISTER } from '../src/onboarding/install-lines.ts';
import { checkMachine, machineLines, machineState } from '../src/onboarding/machine-check.ts';
import { fileOn, MACHINE_NEEDS, needOf, needsFor, programOn } from '../src/onboarding/machine-needs.ts';
import { addToUserPath, brewShellenv, expandPlace, installedAt, notOnPath, psLiteral, READ_PATHS, REAL_FILES, RESTART, zprofilePath } from '../src/onboarding/path-fix.ts';
import { runSteps, STEPS } from '../src/onboarding/steps.ts';
import type { CheckContext, MachineFiles } from '../src/onboarding/types.ts';
import { fakeRunner, NO_FILES, ok, someFiles, tempDir } from './support.ts';

const MISSING = { code: 127, stdout: '', stderr: 'not found' };
const WIN_ENV = { ProgramFiles: 'C:\\Program Files', LOCALAPPDATA: 'C:\\Users\\jordan\\AppData\\Local', APPDATA: 'C:\\Users\\jordan\\AppData\\Roaming', USERPROFILE: 'C:\\Users\\jordan' };
const MAC_ENV = { HOME: '/Users/jordan' };

/** A context for one system, with its fixtures and filesystem. */
function on(system: InstallSystem, fixtures: Parameters<typeof fakeRunner>[0], files: MachineFiles = NO_FILES, calls: string[] = []): CheckContext {
  const env = system === 'windows' ? WIN_ENV : MAC_ENV;
  return { ...makeContext(tempDir(), fakeRunner(fixtures, calls), env), system, files };
}
const result = (ctx: CheckContext, id: string) => runSteps(ctx, 'machine', [id])[0]!.result;

test('each system\'s list for each profile names the steps it needs, in Setup\'s order', () => {
  const ids = (s: InstallSystem, p: 'generic' | 'salesforce') => needsFor(s, p).map((n) => n.step);
  assert.deepEqual(ids('mac', 'generic'), ['A1.brew', 'A1.git', 'A1.gh', 'A1.claude']);
  assert.deepEqual(ids('windows', 'generic'), ['A1.winget', 'A1.git', 'A1.sh', 'A1.gh', 'A1.claude']);
  assert.deepEqual(ids('linux', 'generic'), ['A1.git', 'A1.gh', 'A1.claude']);
  const sf = ['A1.node', 'A1.npm', 'A1.sf', 'A1.code-analyzer', 'A1.java', 'A1.python'];
  assert.deepEqual(ids('mac', 'salesforce'), ['A1.brew', 'A1.git', 'A1.node', 'A1.npm', 'A1.gh', 'A1.claude', 'A1.sf', 'A1.code-analyzer', 'A1.java', 'A1.python']);
  assert.deepEqual(ids('windows', 'salesforce'), ['A1.winget', 'A1.git', 'A1.sh', 'A1.node', 'A1.npm', 'A1.gh', 'A1.claude', 'A1.sf', 'A1.code-analyzer', 'A1.java', 'A1.python']);
  for (const s of INSTALL_SYSTEMS) for (const id of sf) assert.ok(ids(s, 'salesforce').includes(id) && !ids(s, 'generic').includes(id), `${s} ${id}`);
});

test('every need is a step, checked against its maker\'s page on a date, with its least versions where acc needs one', () => {
  assert.equal(MACHINE_NEEDS.length, 12, 'the test counts every need');
  for (const n of MACHINE_NEEDS) {
    assert.ok(STEPS.some((s) => s.id === n.step && s.part === 'machine'), `${n.step} is a machine step`);
    assert.match(n.source.page, /^https:\/\//, n.step);
    assert.match(n.source.read, /^\d{4}-\d{2}-\d{2}$/, n.step);
    assert.ok(n.why.length > 20, n.step);
  }
  const min = Object.fromEntries(MACHINE_NEEDS.map((n) => [n.step, n.min]));
  assert.deepEqual([min['A1.git'], min['A1.node'], min['A1.java'], min['A1.python'], min['A1.code-analyzer']], ['2.40', '20', '11', '3.10', '5.0']);
  // Code Analyzer's engines: the page and date beside each.
  for (const id of ['A1.java', 'A1.python']) assert.match(needOf(id).why, /Code Analyzer/);
  assert.match(needOf('A1.java').source.page, /salesforce-code-analyzer\/guide\/setup\.html$/);
  assert.throws(() => needOf('A1.nope'), /No machine need for A1\.nope/);
});

test('every need that names a program has its install places on each system it\'s needed on, and an install line there', () => {
  let counted = 0;
  for (const n of MACHINE_NEEDS) {
    for (const s of n.systems) {
      if (!programOn(n, s)) continue;
      counted++;
      assert.ok((n.places[s] ?? []).length > 0, `${n.step} names where its installer puts it on ${s}`);
      const step = STEPS.find((x) => x.id === n.step)!;
      assert.ok(n.install ? INSTALL_LINES[n.install][s] : step.fix?.command, `${n.step} has a way to install it on ${s}`);
    }
  }
  assert.ok(counted >= 25, `counted ${counted}`);
  // Windows' places name its own folders; a Mac's name Homebrew's two prefixes.
  assert.ok(needOf('A1.git').places.windows!.includes('{ProgramFiles}\\Git\\cmd'));
  assert.deepEqual(needOf('A1.brew').places.mac, ['/opt/homebrew/bin', '/usr/local/bin']);
  assert.ok(needOf('A1.sf').places.mac!.includes('{npm}'), 'npm\'s global folder');
  assert.equal(fileOn(needOf('A1.sf'), 'windows'), 'sf.cmd');
  assert.equal(fileOn(needOf('A1.git'), 'windows'), 'git.exe');
  assert.equal(fileOn(needOf('A1.git'), 'mac'), 'git');
  assert.equal(fileOn(needOf('A1.code-analyzer'), 'mac'), null, 'a plugin is no program');
});

test('a tool on PATH passes, whatever is in its install places', () => {
  const ctx = on('mac', { 'gh --version': ok('gh version 2.101.0') }, someFiles(['/opt/homebrew/bin/gh']));
  assert.deepEqual([result(ctx, 'A1.gh').status, result(ctx, 'A1.gh').detail], ['pass', 'gh 2.101.0']);
});

test('edge case: a Mac tool only in Homebrew\'s folder is installed, not missing, and Do it adds Homebrew\'s shellenv line after asking', () => {
  const r = result(on('mac', { 'gh --version': MISSING }, someFiles(['/opt/homebrew/bin/gh', '/opt/homebrew/bin/brew'])), 'A1.gh');
  assert.equal(r.status, 'fail');
  assert.equal(r.place, '/opt/homebrew/bin');
  assert.match(r.detail, /^the GitHub CLI is installed in \/opt\/homebrew\/bin, but VSCode can't see it/);
  assert.equal(r.fix, `echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> ~/.zprofile`);
  assert.match(r.ask!, /^Add Homebrew's shellenv line to ~\/\.zprofile, so \/opt\/homebrew\/bin is on your PATH\?/);
  assert.match(r.ask!, /quit VSCode and open it again/);
});

test('edge case: when ~/.zprofile has the shellenv line already, a Mac is told to restart VSCode, and nothing is changed', () => {
  const files = someFiles(['/opt/homebrew/bin/gh', '/opt/homebrew/bin/brew'], { '/Users/jordan/.zprofile': 'eval "$(/opt/homebrew/bin/brew shellenv)"\n' });
  const r = result(on('mac', { 'gh --version': MISSING }, files), 'A1.gh');
  assert.equal(r.byHand, RESTART);
  assert.ok(RESTART.endsWith(RESTART_WHY), 'the restart gives the same reason an install line does');
  assert.equal(r.fix, undefined, 'no line to run');
  assert.equal(r.ask, undefined);
  assert.equal(machineState({ step: STEPS[0]!, result: r }), 'not-on-path');
});

test('a Mac tool in a folder that isn\'t Homebrew\'s gets a PATH line in ~/.zprofile, quoted for the Mac\'s shell', () => {
  const r = result(on('mac', { 'claude --version': MISSING }, someFiles(['/Users/jordan/.local/bin/claude'])), 'A1.claude');
  assert.equal(r.place, '/Users/jordan/.local/bin');
  assert.equal(r.fix, `echo 'export PATH="/Users/jordan/.local/bin:$PATH"' >> ~/.zprofile`);
  assert.equal(zprofilePath("/Users/o'neil/bin"), `echo 'export PATH="/Users/o'\\''neil/bin:$PATH"' >> ~/.zprofile`, 'a quote in the folder');
  assert.equal(brewShellenv('/usr/local/bin'), `echo 'eval "$(/usr/local/bin/brew shellenv)"' >> ~/.zprofile`);
});

test('edge case: a Windows tool in its install folder that isn\'t on the user\'s PATH gets a Do it that adds it to the user\'s PATH, never the machine\'s, after asking', () => {
  const calls: string[] = [];
  const paths = ok('C:\\Users\\jordan\\AppData\\Local\\Microsoft\\WindowsApps\r\nC:\\Windows\\system32;C:\\Windows');
  const r = result(on('windows', { 'git --version': MISSING, powershell: paths }, someFiles(['C:\\Program Files\\Git\\cmd\\git.exe']), calls), 'A1.git');
  assert.equal(r.place, 'C:\\Program Files\\Git\\cmd');
  assert.equal(r.fix, addToUserPath('C:\\Program Files\\Git\\cmd'));
  assert.match(r.fix!, /SetEnvironmentVariable\('Path', .*, 'User'\)$/);
  assert.doesNotMatch(r.fix!, /SetEnvironmentVariable\([^)]*'Machine'/, 'the machine\'s PATH is never changed');
  assert.match(r.ask!, /^Add C:\\Program Files\\Git\\cmd to your PATH\? It's added to your own PATH, not the machine's/);
  assert.ok(calls.some((c) => c.startsWith('powershell ') && c.includes(READ_PATHS)), 'the saved PATHs are read');
});

test('edge case: a Windows tool whose folder is on the saved PATH already is told to restart VSCode', () => {
  const paths = ok('%ProgramFiles%\\GitHub CLI\\\r\nC:\\Windows\\system32');
  const r = result(on('windows', { 'gh --version': MISSING, powershell: paths }, someFiles(['C:\\Program Files\\GitHub CLI\\gh.exe'])), 'A1.gh');
  assert.equal(r.byHand, RESTART, '%NAME% filled in, a trailing \\ and the case ignored');
  assert.equal(r.fix, undefined);
  assert.match(r.detail, /that folder is on your PATH, but VSCode started before it was added/);
});

test('the PowerShell line quotes the folder as a PowerShell string', () => {
  assert.equal(psLiteral("C:\\Users\\o'neil\\bin"), "'C:\\Users\\o''neil\\bin'");
  assert.equal(addToUserPath('C:\\x y'), "[Environment]::SetEnvironmentVariable('Path', (([Environment]::GetEnvironmentVariable('Path', 'User'), 'C:\\x y') | Where-Object { $_ }) -join ';', 'User')");
});

test('edge case: Linux says in words where to add the folder, and offers no line', () => {
  const r = result(on('linux', { 'gh --version': MISSING }, someFiles(['/usr/local/bin/gh'])), 'A1.gh');
  assert.equal(r.place, '/usr/local/bin');
  assert.equal(r.fix, undefined);
  assert.match(r.byHand!, /^Add \/usr\/local\/bin to PATH in your shell's profile/);
});

test('a tool in no install place is missing, with its install line for the system', () => {
  assert.deepEqual([result(on('windows', { 'gh --version': MISSING }), 'A1.gh').fix, result(on('windows', { 'gh --version': MISSING }), 'A1.gh').place], ['winget install --id GitHub.cli -e', undefined]);
  const java = result(on('windows', { 'java -version': MISSING }), 'A1.java');
  assert.equal(java.fix, 'winget install --id EclipseAdoptium.Temurin.25.JDK -e');
  assert.match(java.detail, /restart VSCode/);
});

test('edge case: a stand-in that exits with an error, such as a Mac\'s java with no Java, reads as not installed', () => {
  const stub = { code: 1, stdout: '', stderr: 'The operation couldn\'t be completed. Unable to locate a Java Runtime.' };
  const r = result(on('mac', { 'java -version': stub, 'brew --version': ok('Homebrew 4.5.0') }), 'A1.java');
  assert.deepEqual([r.status, r.detail, r.fix], ['fail', 'java isn\'t installed.', 'brew install --cask temurin']);
  const py = result(on('windows', { 'python --version': { code: 9009, stdout: '', stderr: 'Python was not found; run without arguments to install from the Microsoft Store' } }), 'A1.python');
  assert.match(py.fix!, /^winget install 9NQ7512CXL7T/);
});

test('Java and Python pass at their least versions and fail below them', () => {
  const java = (stderr: string) => result(on('mac', { 'java -version': { code: 0, stdout: '', stderr } }), 'A1.java');
  assert.equal(java('openjdk version "21.0.4" 2024-07-16').status, 'pass');
  assert.match(java('java version "1.8.0_401"').detail, /older than 11/);
  const py = (v: string) => result(on('mac', { 'python3 --version': ok(v) }), 'A1.python');
  assert.equal(py('Python 3.12.7').status, 'pass');
  assert.match(py('Python 3.9.6').detail, /3\.9\.6 is older than 3\.10/);
});

test('a place\'s * stands for each folder there, newest first, and a place whose name isn\'t set is no folder', () => {
  const files = someFiles(['C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.4\\bin\\java.exe', 'C:\\Program Files\\Eclipse Adoptium\\jdk-25.0.1\\bin\\java.exe']);
  const ctx = on('windows', {}, files);
  assert.deepEqual(expandPlace(ctx, '{ProgramFiles}\\Eclipse Adoptium\\*\\bin', 'windows'), ['C:\\Program Files\\Eclipse Adoptium\\jdk-25.0.1\\bin', 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.4\\bin']);
  assert.equal(installedAt(ctx, needOf('A1.java'), 'windows'), 'C:\\Program Files\\Eclipse Adoptium\\jdk-25.0.1\\bin');
  assert.deepEqual(expandPlace({ ...ctx, env: {} }, '{LOCALAPPDATA}\\Python\\bin', 'windows'), []);
  assert.deepEqual(expandPlace(on('mac', {}), '/opt/homebrew/bin', 'mac'), ['/opt/homebrew/bin']);
});

test('edge case: npm\'s global folder is asked of npm once, and is no place when npm doesn\'t run', () => {
  const calls: string[] = [];
  const ctx = on('mac', { 'sf --version': MISSING, 'npm prefix -g': ok('/Users/jordan/.npm-global\n') }, someFiles(['/Users/jordan/.npm-global/bin/sf']), calls);
  assert.equal(result(ctx, 'A1.sf').place, '/Users/jordan/.npm-global/bin');
  assert.deepEqual(expandPlace(on('mac', { 'npm prefix -g': MISSING }), '{npm}', 'mac'), []);
  assert.equal(calls.filter((c) => c === 'npm prefix -g').length, 1);
});

test('Homebrew found only in its own folder gets its shellenv line; missing, it gets its installer', () => {
  const r = result(on('mac', { 'brew --version': MISSING }, someFiles(['/opt/homebrew/bin/brew'])), 'A1.brew');
  assert.equal(r.fix, brewShellenv('/opt/homebrew/bin'));
  const gone = runSteps(on('mac', { 'brew --version': MISSING }), 'machine', ['A1.brew'])[0]!;
  assert.deepEqual([gone.result.detail, gone.step.fix?.command?.startsWith('/bin/bash -c')], ['Homebrew isn\'t installed.', true]);
});

test('winget is checked on Windows as Homebrew is on a Mac, and each skips the other\'s system', () => {
  assert.equal(result(on('windows', { 'winget --version': ok('v1.9.25200') }), 'A1.winget').status, 'pass');
  const gone = runSteps(on('windows', { 'winget --version': MISSING }), 'machine', ['A1.winget'])[0]!;
  assert.deepEqual([gone.result.status, gone.result.detail], ['fail', 'winget (App Installer) isn\'t installed.']);
  assert.equal(gone.step.fix?.command, WINGET_REGISTER);
  assert.ok(gone.step.fix?.text?.includes(APP_INSTALLER_PAGE));
  assert.equal(result(on('mac', {}), 'A1.winget').status, 'skip');
  assert.equal(result(on('windows', {}), 'A1.brew').status, 'skip');
});

test('Git for Windows\' sh: found beside git passes; git without one is installed again; no git is missing', () => {
  const exec = { 'git --exec-path': ok('C:/Program Files/Git/mingw64/libexec/git-core\n') };
  // shellFor joins with the path module of the system the test runs on: forward slashes off Windows, either on it.
  const sh = process.platform === 'win32' ? 'C:\\Program Files\\Git\\usr\\bin\\sh.exe' : 'C:/Program Files/Git/usr/bin/sh.exe';
  const found = result(on('windows', exec, someFiles([sh])), 'A1.sh');
  assert.equal(found.status, 'pass');
  assert.match(found.detail, /sh\.exe$/);
  const none = result(on('windows', exec), 'A1.sh');
  assert.match(none.detail, /Git for Windows' sh isn't beside it/);
  assert.equal(none.fix, 'winget install --id Git.Git -e');
  const noGit = result(on('windows', { 'git --exec-path': MISSING }), 'A1.sh');
  assert.match(noGit.detail, /^git isn't installed, and Git for Windows brings the sh/);
  assert.equal(result(on('mac', {}), 'A1.sh').status, 'skip');
});

test('Code Analyzer older than 5.0 fails with the line that updates it, and needs sf first', () => {
  assert.equal(result(on('mac', { 'sf plugins': ok('code-analyzer 5.6.1') }), 'A1.code-analyzer').status, 'pass');
  const old = result(on('mac', { 'sf plugins': ok('code-analyzer 4.12.0') }), 'A1.code-analyzer');
  assert.deepEqual([old.status, old.fix], ['fail', 'sf plugins install code-analyzer@latest']);
  assert.match(result(on('mac', { 'sf plugins': MISSING }), 'A1.code-analyzer').detail, /do A1\.sf first/);
});

test('edge case: Check this machine for a profile lists only what is still to do, and the list says each one\'s fix', () => {
  const ctx = on('mac', { 'brew --version': ok('Homebrew 4.5.0'), 'git --version': ok('git version 2.45.0'), 'gh --version': MISSING, 'claude --version': MISSING }, someFiles(['/opt/homebrew/bin/claude', '/opt/homebrew/bin/brew']));
  const generic = checkMachine(ctx, 'generic');
  assert.ok(generic.results.every((r) => r.step.part === 'machine'));
  assert.ok(!generic.results.some((r) => r.step.id === 'A1.sf'), 'a generic project runs no Salesforce step');
  const todo = generic.todo.map((r) => r.step.id);
  assert.ok(todo.includes('A1.gh') && todo.includes('A1.claude'));
  assert.ok(!todo.includes('A1.git'));
  const lines = machineLines(generic.todo).join('\n');
  assert.match(lines, /to do {2}A1\.gh/);
  assert.match(lines, /not on PATH {2}A1\.claude/);
  assert.match(lines, /asks first: Add Homebrew's shellenv line/);
  assert.ok(checkMachine(ctx, 'salesforce').results.some((r) => r.step.id === 'A1.sf'));
  assert.deepEqual(machineLines([]), [], 'nothing to do lists nothing');
});

test('the real filesystem reads a folder that isn\'t there as empty, and a file that isn\'t there as null', () => {
  assert.deepEqual(REAL_FILES.list('/no/such/folder/t133'), []);
  assert.equal(REAL_FILES.read('/no/such/file/t133'), null);
  assert.equal(REAL_FILES.exists('/no/such/file/t133'), false);
  assert.ok(notOnPath(on('linux', {}), needOf('A1.gh'), '/opt/x', 'linux').byHand);
});
