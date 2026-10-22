/**
 * The last sprint acc saw on each Jira tracker that follows one (T-78), and what changed when the sprint
 * did: how many of its tickets the new sprint carried, and how many went back to the backlog. The Command
 * Center reads the board, since only it signs in to Jira (D-066), and hands what it saw to acc intake,
 * which keeps it here. A ticket that left goes the way any ticket that left the place goes (D-072).
 */

import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeAtomic } from './atomic.ts';
import { taskList } from './overlap.ts';
import type { RepoPaths } from './paths.ts';
import { isObj, plural } from './text.ts';
import type { Sprint } from './trackers/types.ts';

/** What a board in a sprint showed when acc last saw it: its sprints, and its tickets not done yet. */
export interface SprintSeen {
  sprints: Pick<Sprint, 'id' | 'name'>[];
  /** The keys of its cards that weren't done: the ones a new sprint carries, or that go back to the backlog. */
  open: string[];
  at: string;
}

/** What changed when a board's sprint did. */
export interface SprintChange {
  from: string[];
  to: string[];
  /** Tickets in the old sprint, not done, that are in the new one. */
  carried: string[];
  /** Tickets in the old sprint, not done, that left it for the backlog. */
  backlog: string[];
}

export const sprintsFile = (paths: Pick<RepoPaths, 'stateDir'>): string => join(paths.stateDir, 'sprints.json');

/** Which tracker a sprint was seen on: its site, project and board, so another board starts again. */
export const sprintTracker = (t: { site: string | null; project: string | null; board: number | string | null }): string =>
  `jira ${t.site ?? '?'} ${t.project ?? '?'} ${t.board ?? 'first'}`;

/** Whether a value is a SprintSeen, as acc intake's file must hold one. */
export function isSprintSeen(x: unknown): x is SprintSeen {
  return isObj(x) && typeof x.at === 'string' && Array.isArray(x.open) && x.open.every((k) => typeof k === 'string')
    && Array.isArray(x.sprints) && x.sprints.every((s) => isObj(s) && Number.isSafeInteger(s.id) && typeof s.name === 'string');
}

/** Every tracker's last sprint. A missing or broken file is none: the next look starts again, and says nothing. */
export function readSprints(paths: Pick<RepoPaths, 'stateDir'>): Record<string, SprintSeen> {
  try {
    const r = JSON.parse(readFileSync(sprintsFile(paths), 'utf8')) as unknown;
    return isObj(r) ? Object.fromEntries(Object.entries(r).filter(([, v]) => isSprintSeen(v))) as Record<string, SprintSeen> : {};
  } catch {
    return {};
  }
}

/** Keeps the sprint a tracker shows now, in place of the last one, written whole. */
export function rememberSprint(paths: Pick<RepoPaths, 'stateDir'>, tracker: string, seen: SprintSeen): void {
  mkdirSync(paths.stateDir, { recursive: true });
  writeAtomic(sprintsFile(paths), `${JSON.stringify({ ...readSprints(paths), [tracker]: seen }, null, 2)}\n`);
}

const ids = (s: Pick<Sprint, 'id'>[]): string => s.map((x) => x.id).sort((a, b) => a - b).join(',');

/** Whether what a board shows now is worth keeping: a first look, another sprint, or other tickets. */
export function sprintMoved(prev: SprintSeen | undefined, now: Omit<SprintSeen, 'at'>): boolean {
  return !prev || ids(prev.sprints) !== ids(now.sprints) || [...prev.open].sort().join(',') !== [...now.open].sort().join(',');
}

/**
 * The old sprint's open tickets the board no longer shows, once the sprint has changed: the ones to ask
 * the tracker about, since one that was done in time went neither way. None on a first look, or with the
 * same sprint.
 */
export function sprintGone(prev: SprintSeen | undefined, now: { sprints: Pick<Sprint, 'id'>[]; keys: string[] }): string[] {
  if (!prev || ids(prev.sprints) === ids(now.sprints)) return [];
  const on = new Set(now.keys.map((k) => k.toUpperCase()));
  return prev.open.filter((k) => !on.has(k.toUpperCase()));
}

/**
 * What changed when the sprint did, or null on a first look or with the same sprint. `stillOpen` is which
 * of `sprintGone`'s tickets the tracker says aren't done: those went back to the backlog. One it couldn't
 * read isn't counted either way.
 */
export function sprintChange(prev: SprintSeen | undefined, now: { sprints: Pick<Sprint, 'id' | 'name'>[]; keys: string[] }, stillOpen: string[]): SprintChange | null {
  if (!prev || ids(prev.sprints) === ids(now.sprints)) return null;
  const on = new Set(now.keys.map((k) => k.toUpperCase()));
  const open = new Set(stillOpen.map((k) => k.toUpperCase()));
  return {
    from: prev.sprints.map((s) => s.name), to: now.sprints.map((s) => s.name),
    carried: prev.open.filter((k) => on.has(k.toUpperCase())),
    backlog: prev.open.filter((k) => !on.has(k.toUpperCase()) && open.has(k.toUpperCase())),
  };
}

/**
 * The Overview's line for a sprint change, said once (T-78): "Sprint 13 started after Sprint 12: 4 tickets
 * carried into it, 2 went back to the backlog." `stayed` are the tasks whose ticket left after work on it
 * started: they stay on the agent board, and the line names them.
 */
export function sprintNotice(change: SprintChange, stayed: string[]): string {
  const from = taskList(change.from);
  const to = taskList(change.to);
  const counts = `${plural(change.carried.length, 'ticket')} carried into ${change.to.length ? 'it' : 'a new sprint'}, ${change.backlog.length} went back to the backlog`;
  const head = !change.from.length ? `${to} started.`
    : !change.to.length ? `${from} ended, and no sprint is active now: ${counts}.`
      : `${to} started after ${from}: ${counts}.`;
  if (!stayed.length) return head;
  return `${head} ${taskList(stayed)} left the sprint after work started, so ${stayed.length === 1 ? 'it stays' : 'they stay'} on My work.`;
}
