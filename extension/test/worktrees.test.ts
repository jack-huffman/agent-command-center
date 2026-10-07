// Worktrees: their rows, and the main checkout.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { worktreesModel } from '../src/model/worktrees.ts';
import { hub, menuFor } from './support.ts';

test('worktree rows hide their actions behind one menu, and the main checkout has no Remove', () => {
  assert.deepEqual(menuFor('acc.home', { webviewSection: 'worktree', worktreeLinked: true }), ['acc.worktree.open', 'acc.worktree.terminal', 'acc.worktree.reveal', 'acc.worktree.remove']);
  assert.deepEqual(menuFor('acc.home', { webviewSection: 'worktree', worktreeLinked: false }), ['acc.worktree.open', 'acc.worktree.terminal', 'acc.worktree.reveal']);
  assert.deepEqual(menuFor('acc.agent', { webviewSection: 'worktree', worktreeLinked: true }), [], 'not on an agent\'s own page');
});

test('worktrees show changes in words, and say which one is the main checkout', () => {
  const [main, linked] = worktreesModel(hub()).projects[0]!.worktrees;
  assert.equal(main!.state.label, 'Clean');
  assert.equal(linked!.state.label, '3 changed');
  assert.equal(linked!.state.tone, 'orange');
  assert.equal(main!.main, true);
  assert.equal(linked!.main, false);
});
