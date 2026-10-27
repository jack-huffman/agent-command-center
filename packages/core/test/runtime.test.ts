import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { recordRuntime, runtimeFile } from '../src/runtime.ts';
import { tempDir } from './support.ts';

test('the runtime file is ~/.acc/runtime, unless ACC_RUNTIME_FILE says otherwise', () => {
  assert.equal(runtimeFile({}), join(homedir(), '.acc', 'runtime'));
  assert.equal(runtimeFile({ ACC_RUNTIME_FILE: '/tmp/x' }), '/tmp/x');
});

test('recordRuntime writes the path and a newline, creating the folder, and only when it changed', () => {
  const dir = join(tempDir(), 'home', '.acc');
  const env = { ACC_RUNTIME_FILE: join(dir, 'runtime') };
  const helper = '/Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)';
  assert.equal(recordRuntime(helper, env), true);
  assert.equal(readFileSync(env.ACC_RUNTIME_FILE, 'utf8'), `${helper}\n`);
  // Windows has no POSIX modes.
  if (process.platform !== 'win32') {
    assert.equal(statSync(dir).mode & 0o777, 0o700);
    assert.equal(statSync(env.ACC_RUNTIME_FILE).mode & 0o777, 0o600);
  }

  const before = statSync(env.ACC_RUNTIME_FILE).mtimeMs;
  assert.equal(recordRuntime(helper, env), false, 'unchanged, so not written');
  assert.equal(statSync(env.ACC_RUNTIME_FILE).mtimeMs, before);

  // VSCode moved, or another build of it started: the newest one wins.
  assert.equal(recordRuntime('/Applications/Cursor.app/Contents/MacOS/Cursor Helper', env), true);
  assert.equal(readFileSync(env.ACC_RUNTIME_FILE, 'utf8'), '/Applications/Cursor.app/Contents/MacOS/Cursor Helper\n');
  // A file someone edited by hand, with no newline, is put right.
  writeFileSync(env.ACC_RUNTIME_FILE, helper);
  assert.equal(recordRuntime(helper, env), true);
  assert.deepEqual(readdirSync(dir), ['runtime'], 'no temp file left behind');
});
