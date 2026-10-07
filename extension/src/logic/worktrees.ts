/**
 * Worktrees: reading git's list of them.
 * Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */

export interface Worktree {
  path: string;
  head: string;
  branch: string | null;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
}

/** Parses `git worktree list --porcelain`. The first entry is the main checkout. */
export function parseWorktrees(porcelain: string): Worktree[] {
  const out: Worktree[] = [];
  for (const block of porcelain.trim().split(/\n\s*\n/)) {
    if (!block.trim()) continue;
    const w: Worktree = { path: '', head: '', branch: null, bare: false, locked: false, prunable: false };
    for (const line of block.split('\n')) {
      const [key, ...restParts] = line.split(' ');
      const rest = restParts.join(' ');
      if (key === 'worktree') w.path = rest;
      else if (key === 'HEAD') w.head = rest;
      else if (key === 'branch') w.branch = rest.replace(/^refs\/heads\//, '');
      else if (key === 'bare') w.bare = true;
      else if (key === 'locked') w.locked = true;
      else if (key === 'prunable') w.prunable = true;
    }
    if (w.path) out.push(w);
  }
  return out;
}
