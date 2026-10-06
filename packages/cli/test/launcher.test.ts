// acc's launcher (D-???): which runtime it picks, what a hook does with none, and the one-line error.
// The runtimes here are stand-in sh scripts on a PATH of their own plus /usr/bin:/bin, where no node is.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from '../../core/test/support.ts';

const LAUNCHER = fileURLToPath(new URL('../bin/acc', import.meta.url));
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SYSTEM_PATH = '/usr/bin:/bin';

/** A stand-in runtime: answers --version, else prints its name, ELECTRON_RUN_AS_NODE and each argument on a line. */
function runtime(dir: string, name: string, version = 'v22.1.0', exit = 0): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n[ "$1" = --version ] && { echo ${version}; exit 0; }\nprintf '%s\\n' ${name} "\${ELECTRON_RUN_AS_NODE-unset}" "$@"\nexit ${exit}\n`);
  chmodSync(file, 0o755);
  return file;
}

/** A copy of the launcher with a stand-in acc.mjs beside it, a home of its own, and a folder for fake programs. */
function setup() {
  const dir = tempDir('acc-launcher-');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  copyFileSync(LAUNCHER, join(bin, 'acc'));
  chmodSync(join(bin, 'acc'), 0o755);
  writeFileSync(join(bin, 'acc.mjs'), '// stand-in\n');
  const home = join(dir, 'home');
  mkdirSync(home);
  const fake = join(dir, 'fake');
  mkdirSync(fake);
  // The launcher names acc.mjs by its real path, and the temp folder is behind a symlink on macOS.
  return { dir, bin, home, fake, mjs: realpathSync(join(bin, 'acc.mjs')), runtimeFile: join(dir, 'runtime') };
}

type Env = Record<string, string>;
/** Runs it with only the environment given: nothing of the test's own, such as a builder's ACC_TASK, leaks in. */
function launch(file: string, args: string[], env: Env, input?: string) {
  const r = spawnSync(file, args, { env, input, encoding: 'utf8' });
  return { code: r.status, out: r.stdout, err: r.stderr, lines: r.stdout.split('\n').slice(0, -1) };
}

/** Exit code, stdout and stderr: a silent success is [0, '', '']. */
const said = (r: ReturnType<typeof launch>) => [r.code, r.out, r.err];

test('the launcher prefers ACC_NODE, then node 20 or later on PATH, then the recorded runtime', () => {
  const s = setup();
  const explicit = runtime(join(s.dir, 'explicit'), 'explicit');
  runtime(s.fake, 'node', 'v22.1.0');
  const recorded = runtime(join(s.dir, 'vscode'), 'vscode');
  writeFileSync(s.runtimeFile, `${recorded}\n`);
  const env: Env = { HOME: s.home, PATH: `${s.fake}:${SYSTEM_PATH}`, ACC_RUNTIME_FILE: s.runtimeFile };
  const acc = join(s.bin, 'acc');

  assert.deepEqual(launch(acc, ['status'], { ...env, ACC_NODE: explicit }).lines, ['explicit', '1', s.mjs, 'status'], 'ACC_NODE wins over node on PATH, run as Node');
  assert.deepEqual(launch(acc, ['status'], env).lines, ['node', 'unset', s.mjs, 'status'], 'node 22 on PATH, with nothing set for Electron');

  runtime(s.fake, 'node', 'v18.20.4');
  assert.deepEqual(launch(acc, ['status'], env).lines, ['vscode', '1', s.mjs, 'status'], 'node 18 is too old, so the recorded runtime runs it');
  runtime(s.fake, 'node', 'v20.0.0');
  assert.equal(launch(acc, ['status'], env).lines[0], 'node', 'node 20 is enough');
});

test('with no node on PATH, the recorded runtime runs acc, with or without a trailing newline', () => {
  const s = setup();
  const recorded = runtime(join(s.dir, 'Code Helper (Plugin).app'), 'helper');
  const env: Env = { HOME: s.home, PATH: `${s.fake}:${SYSTEM_PATH}`, ACC_RUNTIME_FILE: s.runtimeFile };
  for (const text of [`${recorded}\n`, recorded]) {
    writeFileSync(s.runtimeFile, text);
    const r = launch(join(s.bin, 'acc'), ['--version'], env);
    assert.equal(r.code, 0, r.err);
    assert.deepEqual(r.lines, ['helper', '1', s.mjs, '--version'], JSON.stringify(text));
  }
  // Without ACC_RUNTIME_FILE it's ~/.acc/runtime.
  mkdirSync(join(s.home, '.acc'));
  writeFileSync(join(s.home, '.acc', 'runtime'), `${recorded}\n`);
  assert.equal(launch(join(s.bin, 'acc'), [], { HOME: s.home, PATH: SYSTEM_PATH }).lines[0], 'helper');
});

test('arguments arrive as given, acc\'s exit code is the launcher\'s, and a symlink to it works', () => {
  const s = setup();
  runtime(s.fake, 'node', 'v22.1.0', 7);
  const env: Env = { HOME: s.home, PATH: `${s.fake}:${SYSTEM_PATH}`, ACC_RUNTIME_FILE: s.runtimeFile };
  const args = ['block', 'needs "the" answer', "it's  two  spaces", '', '$HOME', '*'];
  const r = launch(join(s.bin, 'acc'), args, env);
  assert.equal(r.code, 7);
  assert.deepEqual(r.lines, ['node', 'unset', s.mjs, ...args]);

  // On PATH through a relative symlink, and a symlink to that: acc.mjs is still found beside the real file.
  const links = join(s.dir, 'links');
  mkdirSync(links);
  symlinkSync('../bin/acc', join(links, 'acc-direct'));
  symlinkSync('acc-direct', join(links, 'acc'));
  const linked = spawnSync('acc', ['status'], { env: { ...env, PATH: `${links}:${env.PATH}` }, encoding: 'utf8' });
  assert.deepEqual(linked.stdout.split('\n').slice(2, 4), [s.mjs, 'status'], linked.stderr);
});

test('with no runtime, a hook exits 0 without a word, and anything else names the fix in one line', () => {
  const s = setup();
  runtime(s.fake, 'node', 'v18.20.4');
  writeFileSync(s.runtimeFile, `${join(s.dir, 'gone', 'Code Helper')}\n`);
  const env: Env = { HOME: s.home, PATH: `${s.fake}:${SYSTEM_PATH}`, ACC_RUNTIME_FILE: s.runtimeFile };
  const acc = join(s.bin, 'acc');

  const input = JSON.stringify({ hook_event_name: 'PreToolUse', cwd: s.dir, tool_name: 'Bash', tool_input: { command: 'git push' } });
  for (const [args, stdin] of [[['hook', 'pre-tool-use'], input], [['hook', 'stop'], '{}'], [['hook', 'session-start'], undefined]] as const) {
    assert.deepEqual(said(launch(acc, [...args], env, stdin)), [0, '', ''], args.join(' '));
  }

  const r = launch(acc, ['done'], env);
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
  const lines = r.err.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, r.err);
  assert.match(lines[0]!, /^✗ acc needs Node 20 or later: /);
  for (const fix of ['VSCode with Agent Command Center', 'brew install node', 'ACC_NODE']) assert.ok(lines[0]!.includes(fix), `names ${fix}`);
  assert.doesNotMatch(r.err, /\x1b\[/, 'no colour when stderr isn\'t a terminal');
  // No runtime file at all says the same.
  assert.equal(launch(acc, ['done'], { ...env, ACC_RUNTIME_FILE: join(s.dir, 'none') }).err, r.err);
});

test('an ACC_NODE acc can\'t run is an error that names it, never a quiet fall back', () => {
  const s = setup();
  runtime(s.fake, 'node', 'v22.1.0');
  const env: Env = { HOME: s.home, PATH: `${s.fake}:${SYSTEM_PATH}`, ACC_RUNTIME_FILE: s.runtimeFile, ACC_NODE: join(s.dir, 'no-such-node') };
  const acc = join(s.bin, 'acc');
  const r = launch(acc, ['status'], env);
  assert.equal(r.code, 1);
  assert.equal(r.out, '');
  assert.equal(r.err.split('\n').filter(Boolean).length, 1);
  assert.match(r.err, /ACC_NODE is set to .*no-such-node/);
  // Not executable: a plain file, or a folder.
  writeFileSync(join(s.dir, 'plain'), '');
  assert.match(launch(acc, ['status'], { ...env, ACC_NODE: join(s.dir, 'plain') }).err, /ACC_NODE/);
  assert.match(launch(acc, ['status'], { ...env, ACC_NODE: s.dir }).err, /ACC_NODE/);
  // A hook still says nothing.
  assert.deepEqual(said(launch(acc, ['hook', 'stop'], env, '{}')), [0, '', '']);
  // A name on PATH is fine.
  assert.equal(launch(acc, ['status'], { ...env, ACC_NODE: 'node' }).lines[1], '1');
});

test('a launcher without acc.mjs beside it says so, and its hooks stay silent', () => {
  const s = setup();
  runtime(s.fake, 'node', 'v22.1.0');
  const bin = join(s.dir, 'half');
  mkdirSync(bin);
  copyFileSync(LAUNCHER, join(bin, 'acc'));
  const env: Env = { HOME: s.home, PATH: `${s.fake}:${SYSTEM_PATH}`, ACC_RUNTIME_FILE: s.runtimeFile };
  const r = launch(join(bin, 'acc'), ['status'], env);
  assert.equal(r.code, 1);
  assert.match(r.err, /acc\.mjs is missing/);
  assert.deepEqual(said(launch(join(bin, 'acc'), ['hook', 'stop'], env, '{}')), [0, '', '']);
});

test('the build ships the launcher and acc.mjs side by side', () => {
  const src = readFileSync(LAUNCHER, 'utf8');
  for (const dir of [join(ROOT, 'dist'), join(ROOT, 'extension', 'dist', 'bin')]) {
    assert.equal(readFileSync(join(dir, 'acc'), 'utf8'), src, `${dir}/acc is the launcher`);
    assert.equal(statSync(join(dir, 'acc')).mode & 0o777, 0o755);
    assert.equal(statSync(join(dir, 'acc.mjs')).mode & 0o777, 0o644, 'the bundle isn\'t a command on PATH');
    assert.doesNotMatch(readFileSync(join(dir, 'acc.mjs'), 'utf8').slice(0, 50), /^#!/);
  }
  // A release copies both, or the plugin's hooks would all break (D-042).
  const plugin = join(ROOT, 'plugin', 'bin');
  if (readFileSync(join(plugin, 'acc'), 'utf8').startsWith('#!/bin/sh')) assert.ok(existsSync(join(plugin, 'acc.mjs')), 'plugin/bin/acc.mjs ships with the launcher');
});

test('the built acc runs with no node on PATH, on the recorded runtime', () => {
  const s = setup();
  writeFileSync(s.runtimeFile, `${process.execPath}\n`);
  const env: Env = { HOME: s.home, PATH: SYSTEM_PATH, ACC_RUNTIME_FILE: s.runtimeFile };
  assert.notEqual(spawnSync('/bin/sh', ['-c', 'command -v node'], { env }).status, 0, 'no node on this PATH');
  const r = launch(join(ROOT, 'extension', 'dist', 'bin', 'acc'), ['--version'], env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^\d+\.\d+\.\d+\n$/);
});
