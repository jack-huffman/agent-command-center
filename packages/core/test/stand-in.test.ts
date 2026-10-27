// A test's stand-in program (D-209): an sh script a Mac starts by name, and on Windows npm's .cmd beside it
// for a node runner that runs the script by Git's sh, so acc's start helper finds it by PATHEXT as it finds
// npm's claude, and runs it by node when a word holds a line break.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { run } from '../src/exec.ts';
import { shellPath } from '../src/shell.ts';
import { npmShimScript } from '../src/start.ts';
import { npmShim, standIn, standInRunner, standInRunnerName } from './stand-in.ts';
import { fakeBin, tempDir } from './support.ts';

/** Prints each word it was given on a line of its own. */
const ECHO_WORDS = 'for w in "$@"; do printf "%s\\n" "$w"; done\n';

test('a stand-in is its script, made executable, and a Mac or Linux writes nothing beside it', () => {
  const dir = tempDir('stand-in-');
  standIn(join(dir, 'gh'), '#!/bin/sh\necho hi\n', 'darwin');
  assert.equal(readFileSync(join(dir, 'gh'), 'utf8'), '#!/bin/sh\necho hi\n');
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'gh')).mode & 0o111, 0o111);
  assert.equal(existsSync(join(dir, 'gh.cmd')), false);
  assert.equal(existsSync(join(dir, standInRunnerName('gh'))), false);
});

test('on Windows a stand-in gets npm\'s .cmd for a runner beside it, which names Git\'s sh and the script', () => {
  const dir = tempDir('stand-in-');
  const sh = 'C:\\Program Files\\Git\\usr\\bin\\sh.exe';
  standIn(join(dir, 'sf'), '#!/bin/sh\necho hi\n', 'win32', () => sh);
  assert.equal(readFileSync(join(dir, 'sf.cmd'), 'utf8'), npmShim('sf.stand-in.cjs'));
  assert.equal(npmShimScript('C:\\bin\\sf.cmd', readFileSync(join(dir, 'sf.cmd'), 'utf8')), 'C:\\bin\\sf.stand-in.cjs', 'acc\'s start helper reads it as npm\'s shim');
  assert.equal(readFileSync(join(dir, 'sf.stand-in.cjs'), 'utf8'), standInRunner('sf', sh));
  assert.ok(standInRunner('sf', sh).includes(JSON.stringify(sh)), 'the sh, as a string');
});

test('edge case: the runner gives the script every word as it was, a line break, quotes, @, braces and ~ too, its input, and its exit', () => {
  const dir = tempDir('stand-in-');
  writeFileSync(join(dir, 'tool'), `#!/bin/sh\n${ECHO_WORDS}cat\nexit 3\n`);
  writeFileSync(join(dir, 'tool.stand-in.cjs'), standInRunner('tool', shellPath()));
  const words = ['line\nbreak', 'a "quoted" word', 'C:\\dir\\file', 'back\\slash', '@file', '{a,b}', '~/x', '*'];
  const r = spawnSync(process.execPath, [join(dir, 'tool.stand-in.cjs'), ...words], { input: 'from stdin', encoding: 'utf8' });
  assert.equal(r.status, 3, r.stderr);
  assert.equal(r.stdout, `${words.join('\n')}\nfrom stdin`);
});

test('edge case: a stand-in on PATH is what acc starts by name, ahead of a real one, with hostile words as they were', () => {
  const words = ['a&b', 'space here', '%PATH%'];
  const r = run('gh', words, { env: fakeBin('gh', ECHO_WORDS) });
  assert.equal(r.code, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split(/\r?\n/), words);
});

test('edge case: a word with a line break reaches a stand-in acc starts by name, as dispatch\'s prompt reaches npm\'s claude', () => {
  const words = ['--append-system-prompt', 'one line\nand another', 'a&b'];
  const r = run('claude', words, { env: fakeBin('claude', ECHO_WORDS) });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.replace(/\r\n/g, '\n'), `${words.join('\n')}\n`);
});
