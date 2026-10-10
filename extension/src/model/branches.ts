/**
 * An environment branch that moved by anything but acc's own merge (GH-69): one orange item on the
 * Overview per branch, under Needs you, until a person has seen it. acc sync records the move for a
 * project that opted in to cloud builders; a cloud builder can't push past the repo's guard, but someone
 * else might, and a person looks before anything builds on it. Seen runs acc sync --branches-seen;
 * Compare opens the move on GitHub.
 */
import { type BranchMove, moveWords } from '../../../packages/core/src/branches.ts';
import type { Look } from './shared.ts';
import { LOOK, type ModelArea } from './shared.ts';

/** How a moved branch shows: its words and an icon, in orange, since a person has to look. */
export function moveLook(m: BranchMove): Look {
  const n = m.commits.length;
  return LOOK(n ? `Needs you: ${m.branch} moved by ${n} commit${n === 1 ? '' : 's'} that ${n === 1 ? 'isn\'t' : 'aren\'t'} acc's merges` : `Needs you: ${m.branch} was rewritten`, 'git-branch', 'orange');
}

export const area: ModelArea = {
  home: {
    order: 12,
    attention(c, p) {
      const moves = c.hub.branchMoves?.(p.root) ?? [];
      for (const m of moves) {
        // Projects that share a repo share its branches, and its moves: one item for both.
        const key = `branch-move:${p.config.github?.repo ?? p.root}:${m.branch}:${m.to}`;
        if (c.attention.some((a) => a.key === key)) continue;
        const ref = { project: p.root, env: m.branch };
        c.attention.push({
          key, look: moveLook(m), title: `${m.branch} moved on GitHub`,
          detail: `${p.name} · ${moveWords(m)}`,
          tip: m.commits.length ? m.commits.join('\n') : undefined,
          project: p.name,
          actions: [
            ...(p.config.github ? [{ command: 'acc.branches.open', label: 'Compare on GitHub', icon: 'github', ref, primary: true }] : []),
            { command: 'acc.branches.seen', label: 'Seen', icon: 'eye', ref, primary: !p.config.github },
          ],
        });
      }
    },
  },
  commands: ['acc.branches.open', 'acc.branches.seen'],
};
