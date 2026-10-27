// A test's stand-in program (D-T-123): an sh script a Mac starts by name, and on Windows a .cmd beside it that
// runs the script by Git's sh, so acc's start helper finds it by PATHEXT as it finds sf's shim.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/exec.ts';
import { standIn, standInCmd } from './stand-in.ts';
import { fakeBin, tempDir } from './support.ts';

test('a stand-in is its script, made executable, and a Mac or Linux writes nothing beside it', () => {
  const dir = tempDir('stand-in-');
  standIn(join(dir, 'gh'), '#!/bin/sh\necho hi\n', 'darwin');
  assert.equal(readFileSync(join(dir, 'gh'), 'utf8'), '#!/bin/sh\necho hi\n');
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'gh')).mode & 0o111, 0o111);
  assert.equal(existsSync(join(dir, 'gh.cmd')), false);
});

test('on Windows a stand-in gets a .cmd that runs the script by Git\'s sh, with every word', () => {
  const dir = tempDir('stand-in-');
  standIn(join(dir, 'sf'), '#!/bin/sh\necho hi\n', 'win32', () => 'C:\\Program Files\\Git\\bin\\sh.exe');
  assert.equal(readFileSync(join(dir, 'sf.cmd'), 'utf8'), '@"C:\\Program Files\\Git\\bin\\sh.exe" "%~dp0sf" %*\r\n');
  assert.equal(standInCmd('gh', 'D:/Git/bin/sh.exe'), '@"D:/Git/bin/sh.exe" "%~dp0gh" %*\r\n');
});

test('edge case: a stand-in on PATH is what acc starts by name, ahead of a real one, with hostile words as they were', () => {
  const words = ['a&b', 'space here', '%PATH%'];
  const r = run('gh', words, { env: fakeBin('gh', 'for w in "$@"; do printf "%s\\n" "$w"; done\n') });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split(/\r?\n/), words);
});
