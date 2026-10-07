/**
 * The Worktrees section: every checkout.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import type { HubLike, Look, ModelArea } from './shared.ts';

// ---------------------------------------------------------------- worktrees

export interface WorktreeRow {
  path: string;
  branch: string;
  place: string;
  state: Look;
  main: boolean;
}

export interface WorktreesModel {
  kind: 'worktrees';
  projects: { name: string; root: string; worktrees: WorktreeRow[] }[];
}

export function worktreesModel(hub: HubLike): WorktreesModel {
  return {
    kind: 'worktrees',
    projects: hub.projects.map((p) => ({
      name: p.name, root: p.root,
      worktrees: p.worktrees.map((w) => {
        const state: Look = w.prunable ? { label: 'Missing on disk', icon: 'warning', tone: 'orange' }
          : w.changed < 0 ? { label: 'Status unknown', icon: 'question', tone: 'orange' }
            : w.changed > 0 ? { label: `${w.changed} changed`, icon: 'diff-modified', tone: 'orange' }
              : { label: 'Clean', icon: 'check', tone: 'blue' };
        const place = w.main ? 'Main checkout' : w.path.replace(p.root.replace(/\/[^/]+$/, ''), '…');
        return { path: w.path, branch: w.branch ?? `detached at ${w.head.slice(0, 7)}`, place: w.locked ? `${place} · locked` : place, state, main: w.main };
      }),
    })),
  };
}

export const area: ModelArea = {
  home: {
    order: 30,
    stats({ hub }) {
      const linkedTrees = hub.projects.reduce((n, p) => n + p.worktrees.filter((w) => !w.main).length, 0);
      return [
      { order: 50, tile: { label: 'Worktrees', value: String(linkedTrees), icon: 'git-branch', tone: 'neutral', section: 'worktrees', hint: 'Task checkouts beside the main one' } },
      ];
    },
    nav({ hub }) {
      const linkedTrees = hub.projects.reduce((n, p) => n + p.worktrees.filter((w) => !w.main).length, 0);
      return { section: 'worktrees', label: 'Worktrees', icon: 'git-branch', count: linkedTrees || null, attention: false, hint: `${linkedTrees} task checkout${linkedTrees === 1 ? '' : 's'}` };
    },
  },
};
