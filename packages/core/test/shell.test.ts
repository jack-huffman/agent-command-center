// The one way acc runs a shell command line (D-T-123): which sh it picks on each system, the plain reason
// when Windows has no Git sh, the launcher line hooks and settings run acc by, and the lowered priority acc
// runs its checks at, which os.setPriority gives on every system.
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { getPriority } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AccError, run } from '../src/exec.ts';
import { accLine, inShell, NICE_LEVEL, NICE_SCRIPT, nicedCommand, shellFor, shellLine, shellPath, shownCommand, terminalShell } from '../src/shell.ts';
import { tempDir } from './support.ts';

const GIT = 'C:/Program Files/Git';
const gitDeps = (have: string[], exec: string | null = `${GIT}/mingw64/libexec/git-core`) => ({
  platform: 'win32' as const,
  gitExecPath: () => exec,
  exists: (p: string) => have.includes(p.replaceAll('\\', '/')),
});

test('a Mac and Linux run command lines with /bin/sh, and never ask git', () => {
  for (const platform of ['darwin', 'linux'] as const) {
    assert.equal(shellFor({ platform, gitExecPath: () => assert.fail('git was asked'), exists: () => false }), '/bin/sh', platform);
  }
});

test('Windows runs them with the sh in Git for Windows\' own folder, found from git --exec-path', () => {
  assert.equal(shellFor(gitDeps([`${GIT}/usr/bin/sh.exe`, `${GIT}/bin/sh.exe`])).replaceAll('\\', '/'), `${GIT}/usr/bin/sh.exe`, 'usr/bin first');
  assert.equal(shellFor(gitDeps([`${GIT}/bin/sh.exe`])).replaceAll('\\', '/'), `${GIT}/bin/sh.exe`, 'else bin');
  // A git whose exec path is shallower, such as a portable one: found by walking up.
  assert.equal(shellFor(gitDeps([`${GIT}/usr/bin/sh.exe`], `${GIT}/libexec/git-core`)).replaceAll('\\', '/'), `${GIT}/usr/bin/sh.exe`);
});

test('edge case: Windows with no git, or a git with no sh near it, gets a plain reason, not a missing-file error', () => {
  assert.throws(() => shellFor(gitDeps([], null)), (e: unknown) => e instanceof AccError && /git didn't run here\. Install Git for Windows/.test(e.message));
  assert.throws(() => shellFor(gitDeps([])), (e: unknown) => e instanceof AccError && /found none near git \(C:\/Program Files\/Git\/mingw64\/libexec\/git-core\)\. Reinstall Git for Windows/.test(e.message));
});

test('inShell runs a line by this machine\'s sh, and a project\'s check commands run as written', () => {
  const [cmd, args] = inShell("echo 'a b' \"$HOME\"");
  assert.equal(cmd, shellPath());
  assert.deepEqual(args, ['-c', "echo 'a b' \"$HOME\""]);
  const r = run(...inShell('echo one && echo two | tr a-z A-Z'));
  assert.deepEqual([r.code, r.stdout], [0, 'one\nTWO\n']);
});

test('this machine\'s sh is shown and recorded as sh, whichever sh it is', () => {
  for (const sh of ['/bin/sh', 'sh', 'C:\\Program Files\\Git\\usr\\bin\\sh.exe', 'C:/Program Files/Git/bin/SH.EXE']) assert.equal(shownCommand(sh), sh.includes('\\') && process.platform !== 'win32' ? sh : 'sh', sh);
  assert.equal(shownCommand('/usr/bin/bash'), '/usr/bin/bash', 'another program keeps its name');
  assert.equal(shellLine(shownCommand(shellPath()), ['-c', "echo 'hi'"]), `sh -c 'echo '\\''hi'\\'''`);
});

test('a hook or settings line runs acc by the launcher beside it, with no variable set inline', () => {
  const at = (have: string[], platform: NodeJS.Platform = 'darwin') => ({ platform, exists: (p: string) => have.includes(p.replaceAll('\\', '/')) });
  assert.equal(accLine('/x/dist/bin/acc.mjs', at(['/x/dist/bin/acc'])), '/x/dist/bin/acc');
  assert.equal(accLine('/My Apps/bin/acc.mjs', at(['/My Apps/bin/acc'])), "'/My Apps/bin/acc'", 'quoted for sh');
  assert.equal(accLine('C:\\Users\\Kim Lee\\acc\\acc.mjs', at(['C:/Users/Kim Lee/acc/acc'], 'win32')), "'C:/Users/Kim Lee/acc/acc'", 'forward slashes on Windows, which Git\'s sh reads');
  // Run from its source, with no launcher beside it: this runtime and that script.
  const fromSource = accLine('/repo/packages/cli/src/main.ts', at([]));
  assert.equal(fromSource, shellLine(process.execPath, ['/repo/packages/cli/src/main.ts']));
  for (const line of [fromSource, accLine('/x/acc.mjs', at(['/x/acc']))]) assert.doesNotMatch(line, /^[A-Z_]+=/, line);
});

test('a terminal acc types into opens Git\'s sh on Windows, and the person\'s own shell elsewhere', () => {
  assert.deepEqual(terminalShell('win32', () => 'C:/Git/usr/bin/sh.exe'), { shellPath: 'C:/Git/usr/bin/sh.exe' });
  assert.deepEqual(terminalShell('darwin', () => assert.fail('no sh looked up')), {});
  assert.deepEqual(terminalShell('linux', () => assert.fail('no sh looked up')), {});
});

test('a command run with nice runs at lowered priority, by os.setPriority, and keeps its arguments and exit code', () => {
  const said = run(process.execPath, ['-e', 'console.log(require("node:os").getPriority(), JSON.stringify(process.argv.slice(1)))', '--', '-x', 'a b'], { nice: true });
  assert.equal(said.code, 0, said.stderr);
  const [priority, argv] = [said.stdout.slice(0, said.stdout.indexOf(' ')), said.stdout.slice(said.stdout.indexOf(' ') + 1)];
  // Windows maps 15 to its below-normal class, which reads back as 10.
  assert.equal(Number(priority), process.platform === 'win32' ? 10 : Math.max(NICE_LEVEL, getPriority()));
  assert.deepEqual(JSON.parse(argv!), ['-x', 'a b']);
  assert.equal(run(process.execPath, ['-e', 'process.exit(3)'], { nice: true }).code, 3, 'its exit code');
  const plain = nicedCommand('sf', ['org', 'list'], { A: '1' });
  assert.deepEqual([plain.cmd, plain.args], [process.execPath, ['-e', NICE_SCRIPT, '--', '0', 'sf', 'org', 'list']]);
  assert.equal(plain.env.A, '1');
});

test('edge case: a command nice can\'t start is code 127 with why, as one run without nice is', () => {
  const r = run('acc-no-such-program', [], { nice: true });
  assert.equal(r.code, 127);
  assert.match(r.stderr, /ENOENT/);
});

test('edge case: a niced command stopped at its timeout stops what it ran too', () => {
  const dir = tempDir('acc-nice-');
  const late = join(dir, 'late');
  const started = Date.now();
  const r = run(process.execPath, ['-e', `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(late)}, 'x'), 1500)`], { nice: true, timeoutMs: 300 });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - started < 1400, 'stopped at its timeout');
  // Windows ends a process without a signal it can pass on, so there only the timeout is checked.
  if (process.platform === 'win32') return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2500); // past when it would have written
  assert.equal(existsSync(late), false, 'the command was stopped, not left running');
});

test('edge case: under VSCode\'s runtime the script is run as Node, and the command gets the environment it was given', () => {
  const electron = process.versions.electron;
  try {
    Object.defineProperty(process.versions, 'electron', { value: '30.0.0', configurable: true });
    assert.deepEqual([nicedCommand('x', [], {}).env.ELECTRON_RUN_AS_NODE, nicedCommand('x', [], {}).env.ACC_NICE_DROP], ['1', '1']);
    assert.equal(nicedCommand('x', [], { ELECTRON_RUN_AS_NODE: '1' }).env.ACC_NICE_DROP, undefined, 'already set: kept for the command');
  } finally {
    if (electron === undefined) delete (process.versions as { electron?: string }).electron;
    else Object.defineProperty(process.versions, 'electron', { value: electron, configurable: true });
  }
  // What the script hands the command: the variable it was given only for itself is gone.
  const r = run(process.execPath, ['-e', 'console.log(process.env.ELECTRON_RUN_AS_NODE ?? "unset", process.env.ACC_NICE_DROP ?? "unset")'], { nice: true, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ACC_NICE_DROP: '1' } });
  assert.equal(r.stdout.trim(), 'unset unset');
});
