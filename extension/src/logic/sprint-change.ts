/**
 * After a Jira board held to a sprint loads (T-78): what to keep as its last sprint, and, when the sprint
 * changed since acc last saw it, what to tell the Overview once. The tickets that left go the way any
 * ticket that left the place goes (D-072); this only counts them, and names the started tasks that stay.
 *
 * Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */

import type { LeftAlone } from '../../../packages/core/src/intake.ts';
import { type SprintChange, sprintChange, sprintGone, sprintMoved, sprintNotice, type SprintSeen } from '../../../packages/core/src/sprints.ts';
import type { Board, TrackerClient } from '../../../packages/core/src/trackers/types.ts';

/** What a board in a sprint shows now, against what acc last saw. */
export interface SprintLook {
  /** What acc keeps as its last sprint. */
  seen: SprintSeen;
  /** Whether that differs from the last, so acc should keep it: a first look, another sprint, or other tickets. */
  moved: boolean;
  /** What changed when the sprint did, or null with the same sprint, or on a first look. */
  change: SprintChange | null;
  /** The old sprint's open tickets the board no longer shows. */
  gone: string[];
}

/**
 * Looks at a board against its last sprint. Null for a board not held to a sprint. The old sprint's tickets
 * the board no longer shows are asked about once: the ones not done went back to the backlog. A tracker
 * that can't say, or a read that fails, counts none of them.
 */
export async function lookAtSprint(prev: SprintSeen | undefined, board: Pick<Board, 'sprints' | 'cards'>, client: Pick<TrackerClient, 'stillOpen'>, now: Date): Promise<SprintLook | null> {
  if (!board.sprints) return null;
  const sprints = board.sprints.map(({ id, name }) => ({ id, name }));
  const keys = board.cards.map((c) => c.key);
  const seen: SprintSeen = { sprints, open: board.cards.filter((c) => c.status.category !== 'done').map((c) => c.key), at: now.toISOString() };
  const gone = sprintGone(prev, { sprints, keys });
  const still = gone.length && client.stillOpen ? await client.stillOpen(gone).catch(() => []) : [];
  return { seen, moved: sprintMoved(prev, seen), change: sprintChange(prev, { sprints, keys }, still), gone };
}

/**
 * The Overview's line once acc has kept the new sprint, or null when the sprint didn't change. acc intake's
 * `leftAlone` names the started tasks whose tickets left: those from the old sprint stay, and the line says so.
 */
export function sprintLine(look: SprintLook, leftAlone: LeftAlone[]): string | null {
  if (!look.change) return null;
  const gone = new Set(look.gone.map((k) => k.toUpperCase()));
  return sprintNotice(look.change, leftAlone.filter((l) => gone.has(l.issue.toUpperCase())).map((l) => l.task));
}
