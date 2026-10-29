// The push guard on the branch the cloud clones (T-145): where it stands here and on GitHub, committing its three
// files only, and pushing that branch. Real git, with a bare repo standing in for GitHub.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { cloneBranch, commitGuard, GUARD_FILES, guardPlace, pushGuard } from '../src/cloud-guard-place.ts';
import { run } from '../src/exec.ts';
import { gitIn } from './support.ts';
import { repoWithOrigin } from './cloud-support.ts';

const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };

test('a repo with no guard: not committed here or on GitHub; Do it commits its three files only, then a push puts it on GitHub', () => {
  const { root } = repoWithOrigin(undefined, { guard: false });
  writeFileSync(join(root, 'other.txt'), 'not the guard\n');
  gitIn(root, 'add', 'other.txt');
  const before = guardPlace(run, root, 'main');
  assert.equal(before.base, 'main');
  assert.equal(before.checkedOut, 'main');
  assert.equal(before.local.ok, false);
  assert.match(before.local.why!, /doesn't carry \.claude\/hooks\/acc-push-guard\.mjs/);
  assert.equal(before.pushed.ok, false);
  assert.deepEqual(commitGuard(run, root, 'main'), { base: 'main', committed: true });
  const files = gitIn(root, 'show', '--name-only', '--format=', 'HEAD').split('\n').filter(Boolean).sort();
  assert.deepEqual(files, [...GUARD_FILES].sort(), 'only the guard: the staged other.txt stays out');
  assert.match(gitIn(root, 'status', '--porcelain'), /^A {2}other\.txt$/m, 'other.txt is still staged, as it was');
  const committed = guardPlace(run, root, 'main');
  assert.equal(committed.local.ok, true);
  assert.equal(committed.pushed.ok, false);
  assert.equal(committed.ahead, 1);
  assert.deepEqual(pushGuard(run, root, 'main', env), { base: 'main', pushed: 1 });
  const after = guardPlace(run, root, 'main');
  assert.deepEqual([after.local.ok, after.pushed.ok, after.ahead], [true, true, 0]);
  assert.deepEqual(commitGuard(run, root, 'main'), { base: 'main', committed: false }, 'committed already: nothing to do');
  assert.deepEqual(pushGuard(run, root, 'main', env), { base: 'main', pushed: 0 }, 'on GitHub already: nothing sent');
});

test('edge case: another branch checked out is refused, naming both, and nothing is committed; a push before a commit is refused', () => {
  const { root } = repoWithOrigin(undefined, { guard: false });
  gitIn(root, 'switch', '-q', '-c', 'feature');
  const head = gitIn(root, 'rev-parse', 'HEAD');
  assert.throws(() => commitGuard(run, root, 'main'), /The cloud clones main, and this folder has feature checked out: switch it to main, then commit the push guard\./);
  assert.equal(gitIn(root, 'rev-parse', 'HEAD'), head);
  assert.throws(() => pushGuard(run, root, 'main', env), /The push guard isn't committed on main yet: commit it first\./);
});

test('the branch the cloud clones is origin\'s default, else the first environment\'s', () => {
  const { root } = repoWithOrigin();
  assert.equal(cloneBranch(run, root, 'dev'), 'main', 'origin/HEAD names main');
  gitIn(root, 'remote', 'set-head', 'origin', '-d');
  assert.equal(cloneBranch(run, root, 'dev'), 'dev', 'none named: the fallback');
  const place = guardPlace(run, root, 'dev');
  assert.equal(place.local.ok, false);
  assert.match(place.local.why!, /There's no dev branch here\./);
  assert.match(place.pushed.why!, /GitHub has no dev branch that this folder knows of\./);
});
