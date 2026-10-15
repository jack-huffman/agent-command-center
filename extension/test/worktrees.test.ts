// Worktrees: their rows, and the main checkout.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromWorktreesFolder, worktreesModel } from '../src/model/worktrees.ts';
import { hub, menuFor, pageSource } from './support.ts';

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

test('a worktree shows its path from the worktrees folder, with the full path in the title; the main checkout is words (T-44)', () => {
  const [main, linked] = worktreesModel(hub()).projects[0]!.worktrees;
  assert.equal(linked!.place, 'AV-2');
  assert.equal(linked!.fullPath, '/r.worktrees/AV-2');
  assert.equal(main!.place, 'Main checkout');
  assert.equal(fromWorktreesFolder('/Users/me/Code/Proj/.claude/worktrees/ACME-12'), 'ACME-12');
  assert.equal(fromWorktreesFolder('/elsewhere/checkout'), '/elsewhere/checkout', 'a path outside a worktrees folder stays whole (edge case)');
  const src = pageSource('worktrees.ts');
  assert.ok(src.includes("titled(el('td', w.main ? 'place' : 'place mono', w.place), w.fullPath)"), 'the words are in the normal font, a path in the code font, the full path in the title');
  assert.ok(src.includes('branch.title = w.branch;'), 'a long branch name keeps its full text in the title');
});
