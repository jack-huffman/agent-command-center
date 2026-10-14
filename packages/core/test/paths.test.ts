// samePath (T-13): the one helper onboarding, refresh and dispatch use to tell whether two paths name one
// folder, however each is spelled.
import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { samePath } from '../src/paths.ts';
import { tempDir } from './support.ts';

test('samePath matches two spellings of one folder, one through a symbolic link, and not two different folders', () => {
  const root = tempDir('same-path-');
  const real = join(root, 'real');
  const other = join(root, 'other');
  mkdirSync(real);
  mkdirSync(other);
  const link = join(root, 'link');
  symlinkSync(real, link);
  assert.equal(samePath(link, real), true, 'through the link');
  assert.equal(samePath(real, link), true, 'either way round');
  assert.equal(samePath(join(real, '..', 'real'), real), true, 'a .. in the spelling');
  assert.equal(samePath(real, other), false, 'two folders');
  assert.equal(samePath(link, other), false, 'the link names one of them only');
});

test('samePath on a path that does not exist: the edge case where there is nothing to resolve matches only the same spelling', () => {
  const root = tempDir('same-path-');
  const gone = join(root, 'gone');
  assert.equal(samePath(gone, gone), true, 'the same spelling');
  assert.equal(samePath(gone, root), false, 'a missing folder and a real one');
  assert.equal(samePath(gone, `${root}/gone/../gone`), false, 'two spellings of a missing folder: nothing to resolve them by');
});
