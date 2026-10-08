/**
 * How often the extension looks again at what it shows (D-044): quickly while the Command Center is on
 * screen, and slowly, or not at all, while it isn't. extension.ts polls by these numbers, and the Settings
 * section says them, so the two can't drift (GH-109).
 * Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */

export const POLL_KEYS = ['tasks', 'jobs', 'agents', 'worktrees', 'boards', 'prs'] as const;
export type PollKey = (typeof POLL_KEYS)[number];

export interface PollInterval {
  /** What it looks at, in the words the Settings section uses. */
  label: string;
  /** While the page is on screen. */
  everyMs: number;
  /** While it isn't. None: it isn't looked at then. */
  hiddenMs?: number;
}

export const POLL_INTERVALS: Record<PollKey, PollInterval> = {
  tasks: { label: 'Tasks', everyMs: 3_000, hiddenMs: 15_000 },
  jobs: { label: 'In progress', everyMs: 3_000, hiddenMs: 15_000 },
  agents: { label: 'Agents', everyMs: 5_000, hiddenMs: 30_000 },
  worktrees: { label: 'Worktrees', everyMs: 15_000 },
  boards: { label: 'Trackers\' boards', everyMs: 120_000 },
  prs: { label: 'Pull requests', everyMs: 120_000, hiddenMs: 300_000 },
};

/** An interval in words: 3 s, 2 min, 1 min 30 s. */
export function intervalWords(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
}
