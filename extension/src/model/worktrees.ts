/**
 * The Worktrees section: every checkout.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { sep } from 'node:path';
import { worktreeRoot } from '../../../packages/core/src/dispatch.ts';
import { plural } from '../../../packages/core/src/text.ts';
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

/** A worktree's path from the project's worktrees folder (`worktreeRoot`: "ACME-12"); a path outside it stays whole. */
export function fromWorktreesFolder(path: string, folder: string): string {
  const prefix = folder.endsWith(sep) ? folder : folder + sep;
  return path.startsWith(prefix) && path.length > prefix.length ? path.slice(prefix.length) : path;
}

export function worktreesModel(hub: HubLike): WorktreesModel {
  return {
    kind: 'worktrees',
    projects: hub.projects.map((p) => {
      const folder = worktreeRoot({ worktrees: { root: p.config.worktrees?.root ?? null, setup: [] } }, p.worktrees.find((w) => w.main)?.path ?? p.root);
      const worktrees = p.worktrees.map((w) => {
        const place = w.main ? 'Main checkout' : fromWorktreesFolder(w.path, folder);
        return { path: w.path, branch: w.branch ?? `detached at ${w.head.slice(0, 7)}`, place: w.locked ? `${place} · locked` : place, fullPath: w.path, state: worktreeLook(w), main: w.main };
      });
      return { name: p.name, root: p.root, worktrees };
    }),
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
      return { section: 'worktrees', label: 'Worktrees', icon: 'git-branch', count: linkedTrees || null, attention: false, hint: plural(linkedTrees, 'task checkout') };
    },
  },
};
