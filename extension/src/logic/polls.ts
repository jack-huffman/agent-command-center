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

// ---------------------------------------------------------------- the refresh pace (GH-113)

/**
 * How often the Command Center refreshes while it's on screen: Normal, the intervals above; Relaxed, each one
 * twice as long; Slow, four times. While it's hidden, each stays as it is, and so do agents' questions and
 * autopilot's timers, which aren't the page's polls: a slower page never makes acc slower to notice what
 * needs you.
 */
export const PACES = ['normal', 'relaxed', 'slow'] as const;
export type Pace = (typeof PACES)[number];

/**
 * Where it's kept: a VSCode setting of machine scope, as the theme is (D-101), so it stays on this machine
 * and every window hears when it changes.
 */
export const PACE_SETTING = { section: 'agentCommandCenter', key: 'refreshPace' } as const;

/** A pace as the setting holds it. Anything else, or nothing, is Normal. */
export const paceChoice = (v: unknown): Pace => ((PACES as readonly unknown[]).includes(v) ? (v as Pace) : 'normal');

export const PACE_WORDS: Record<Pace, { label: string; icon: string; times: number; meaning: string }> = {
  normal: { label: 'Normal', icon: 'pulse', times: 1, meaning: 'Each part refreshes as often as it always has while the Command Center is on screen.' },
  relaxed: { label: 'Relaxed', icon: 'coffee', times: 2, meaning: 'Each part refreshes half as often while the Command Center is on screen, so VSCode does less.' },
  slow: { label: 'Slow', icon: 'watch', times: 4, meaning: 'Each part refreshes a quarter as often while the Command Center is on screen, for a machine that feels the load.' },
};

/** How often a part is looked at: on screen, its interval at the pace; hidden, its own hidden interval or none, whatever the pace. */
export function pollEvery(key: PollKey, visible: boolean, pace: Pace = 'normal'): number | undefined {
  const p = POLL_INTERVALS[key];
  return visible ? p.everyMs * PACE_WORDS[pace].times : p.hiddenMs;
}
