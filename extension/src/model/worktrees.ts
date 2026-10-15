/**
 * The Worktrees section: every checkout.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import type { HubLike, Look, ModelArea, ProjectLike } from './shared.ts';

// ---------------------------------------------------------------- worktrees

export interface WorktreeRow {
  path: string;
  branch: string;
  /** From the worktrees folder ("ACME-12"), or "Main checkout" for the main one. */
  place: string;
  /** The full path, for the cell's title. */
  fullPath: string;
  state: Look;
  main: boolean;
}

export interface WorktreesModel {
  kind: 'worktrees';
  projects: { name: string; root: string; worktrees: WorktreeRow[] }[];
}

/** A worktree's state: missing, unknown or changed in orange, clean in blue. */
export function worktreeLook(w: Pick<ProjectLike['worktrees'][number], 'prunable' | 'changed'>): Look {
  if (w.prunable) return { label: 'Missing on disk', icon: 'warning', tone: 'orange' };
  if (w.changed < 0) return { label: 'Status unknown', icon: 'question', tone: 'orange' };
  return w.changed > 0 ? { label: `${w.changed} changed`, icon: 'diff-modified', tone: 'orange' } : { label: 'Clean', icon: 'check', tone: 'blue' };
}

/** A worktree's path from its worktrees folder (".claude/worktrees/ACME-12" reads "ACME-12"); a path outside one stays whole. */
export function fromWorktreesFolder(path: string): string {
  return /(?:^|\/)(?:\.claude\/worktrees|[^/]*\.worktrees)\/(.+)$/.exec(path)?.[1] ?? path;
}

export function worktreesModel(hub: HubLike): WorktreesModel {
  return {
    kind: 'worktrees',
    projects: hub.projects.map((p) => ({
      name: p.name, root: p.root,
      worktrees: p.worktrees.map((w) => {
        const state = worktreeLook(w);
        const place = w.main ? 'Main checkout' : fromWorktreesFolder(w.path);
        return { path: w.path, branch: w.branch ?? `detached at ${w.head.slice(0, 7)}`, place: w.locked ? `${place} · locked` : place, fullPath: w.path, state, main: w.main };
      }),
    })),
  };
}

export const area: ModelArea = {
  commands: [
    'acc.worktree.open', 'acc.worktree.terminal', 'acc.worktree.reveal', 'acc.worktree.remove',
  ],
  home: {
    order: 30,
    nav({ hub }) {
      const linkedTrees = hub.projects.reduce((n, p) => n + p.worktrees.filter((w) => !w.main).length, 0);
      return { section: 'worktrees', label: 'Worktrees', icon: 'git-branch', count: linkedTrees || null, attention: false, hint: `${linkedTrees} task checkout${linkedTrees === 1 ? '' : 's'}` };
    },
  },
};
