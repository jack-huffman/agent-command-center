import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunOptions } from '../src/exec.ts';
import { git, must } from '../src/git-must.ts';
import { ok } from './support.ts';

test('git runs in the folder it is given, and must hands back its output', () => {
  const seen: [string, string[], RunOptions | undefined][] = [];
  const r = git((cmd, args, opts) => { seen.push([cmd, args, opts]); return ok('abc\n'); }, '/repo', 'rev-parse', 'HEAD');
  assert.deepEqual(seen, [['git', ['rev-parse', 'HEAD'], { cwd: '/repo' }]]);
  assert.equal(must(r, 'No HEAD'), 'abc\n');
});

test('edge case: a failed git stops with what failed and git\'s last line, from stdout when stderr is empty', () => {
  assert.throws(() => must({ code: 128, stdout: '', stderr: 'hint: one\nfatal: not a git repository\n' }, 'Couldn\'t read HEAD'), (e: Error & { code?: string }) => e.code === 'git' && e.message === 'Couldn\'t read HEAD: fatal: not a git repository');
  assert.throws(() => must({ code: 1, stdout: 'CONFLICT in a.txt\n', stderr: '' }, 'No merge'), (e: Error) => e.message === 'No merge: CONFLICT in a.txt');
});
