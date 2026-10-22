/**
 * A task's changes on its page (T-99), a section of their own: Planned changes while it has a plan and no
 * work, then Changes once its branch has changed something, with the plan a click away beside it. A change
 * outside the plan is marked, and so is a planned one not made. Once it merges, the changes acc kept with it
 * show after its branch is gone; a task that merged before acc kept them says so. In a Salesforce project
 * each path shows as the component it is part of, grouped by type; elsewhere, by folder. Plain data: no
 * vscode import, so it's testable.
 */

import { type ChangeMark, type ChangeRow, planAgainst } from '../../../packages/core/src/changes.ts';
import { changePlace } from '../../../packages/core/src/changes-field.ts';
import type { Profile } from '../../../packages/core/src/config.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import type { Look } from './shared.ts';

/** How a change outside the plan, and a planned one not made, show: orange, each with its icon and words. */
export const CHANGE_LOOK: Record<'unplanned' | 'unmade', Look> = {
  unplanned: { label: 'Not in the plan', icon: 'diff-added', tone: 'orange' },
  unmade: { label: 'Planned, not changed', icon: 'circle-slash', tone: 'orange' },
};

/** One thing changed or planned: a component or a file, the paths it stands for, and its mark, if any. */
export interface ChangeItem {
  name: string;
  paths: string[];
  look: Look | null;
}

/** The items of one type, or one folder. */
export interface ChangeSet {
  head: string;
  items: ChangeItem[];
}

/** A group of the section: the files git sees. Record changes (T-100) are another. */
export interface ChangeGroup {
  id: string;
  title: string;
  sets: ChangeSet[];
}

export interface TicketChanges {
  task: string;
  /** Planned changes before there's work, Changes once there is. */
  title: 'Planned changes' | 'Changes';
  /** "Planned: 6 · Changed: 8", as items: only once there's work. Planned is null with no plan. */
  counts: { planned: number | null; changed: number } | null;
  /** What the lists are, or why there's no list of changes, in a muted line; null when they say it. */
  note: string | null;
  /** When the changes shown were kept with the task, for a task whose work merged; else null. */
  keptAt: string | null;
  changed: ChangeGroup[];
  planned: ChangeGroup[];
}

export interface ChangesIn {
  task: Pick<Task, 'id' | 'state' | 'changes'>;
  profile: Profile;
  /** The plan's paths (plannedFiles); null with no plan, or one that names none. */
  planned: string[] | null;
  /** What its branch has changed so far (branchFiles), read while it's in flight; null when it wasn't read. */
  live: string[] | null;
}

/** The order marks win in, when one component stands for paths marked differently: in the plan first. */
const RANK: ChangeMark[] = ['planned', 'changed', 'unplanned', 'unmade'];

/** Rows grouped by type or folder, each item once with its paths and its best mark; the catch-all set last. */
export function changeSets(rows: ChangeRow[], profile: Profile): ChangeSet[] {
  const sets = new Map<string, { other: boolean; items: Map<string, { paths: string[]; mark: ChangeMark }> }>();
  for (const r of rows) {
    const p = changePlace(r.path, profile);
    const set = sets.get(p.head) ?? sets.set(p.head, { other: p.other, items: new Map() }).get(p.head)!;
    const item = set.items.get(p.name);
    if (!item) set.items.set(p.name, { paths: [r.path], mark: r.mark });
    else {
      item.paths.push(r.path);
      if (RANK.indexOf(r.mark) < RANK.indexOf(item.mark)) item.mark = r.mark;
    }
  }
  return [...sets.entries()]
    .sort(([a, x], [b, y]) => Number(x.other) - Number(y.other) || a.localeCompare(b))
    .map(([head, s]) => ({
      head,
      items: [...s.items.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, i]) => ({ name, paths: i.paths.sort(), look: i.mark === 'unplanned' || i.mark === 'unmade' ? CHANGE_LOOK[i.mark] : null })),
    }));
}

/** The files group, named for what a person reads in it. */
const filesGroup = (rows: ChangeRow[], profile: Profile): ChangeGroup[] =>
  rows.length ? [{ id: 'files', title: profile === 'salesforce' ? 'Metadata' : 'Files', sets: changeSets(rows, profile) }] : [];

const items = (groups: ChangeGroup[]): number => groups.reduce((n, g) => n + g.sets.reduce((m, s) => m + s.items.length, 0), 0);

/** What the section lists as changed: once it's done, what acc kept; in flight, its branch's paths, else what acc kept at its land. Null for none. */
function changedNow(i: ChangesIn): { live: string[] | null; kept: Task['changes'] | null; changed: string[] | null } {
  const kept = i.task.changes?.paths.length ? i.task.changes : null;
  const live = i.task.state !== 'done' && i.live?.length ? i.live : null;
  return { live, kept: kept ?? null, changed: live ?? kept?.paths ?? null };
}

/** The paths the section lists as changed, which a tracker's changes field is drafted from too (T-105); none before there's work. */
export const changedPaths = (i: ChangesIn): string[] => changedNow(i).changed ?? [];

/**
 * The section, or null when there's nothing to show: no plan that names paths, no work yet, and nothing
 * merged. Once it's done, what acc kept shows; in flight, what its branch has changed, else what acc kept
 * at its land.
 */
export function ticketChanges(i: ChangesIn): TicketChanges | null {
  const done = i.task.state === 'done';
  const { live, kept, changed } = changedNow(i);
  const planned = filesGroup((i.planned ?? []).map((path) => ({ path, mark: 'planned' })), i.profile);
  const base = { task: i.task.id, keptAt: !live && kept ? kept.at : null, planned };
  if (!changed) {
    if (done) return { ...base, title: 'Changes', counts: null, changed: [], note: `It merged before changes were kept with a task, so there's no record of what it changed.${planned.length ? ' Its plan named these.' : ''}` };
    return planned.length ? { ...base, title: 'Planned changes', counts: null, changed: [], note: null } : null;
  }
  const rows = planAgainst(i.planned, changed);
  const groups = filesGroup(rows, i.profile);
  const made = filesGroup(rows.filter((r) => r.mark !== 'unmade'), i.profile);
  return { ...base, title: 'Changes', counts: { planned: planned.length ? items(planned) : null, changed: items(made) }, changed: groups, note: null };
}
