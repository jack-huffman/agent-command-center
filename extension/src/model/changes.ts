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
import { latestDeploys, type TaskDeploy, testsWords } from '../../../packages/core/src/deploy-gate.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import { plural } from '../../../packages/core/src/text.ts';
import type { Look } from './shared.ts';

/** The task's deploys as the page says them (D-206): the latest to each org, with what went and what the tests found. */
export function ticketDeploys(deploys: TaskDeploy[] | null | undefined): TicketDeploy[] {
  return latestDeploys(deploys).map((d) => ({
    org: d.org, at: d.at,
    look: { ...DEPLOY_LOOK.deployed, label: `${DEPLOY_LOOK.deployed.label} ${d.org}` },
    words: `${plural(d.components.length, 'component')}, ${d.verified} listed in the org · ${testsWords(d.tests)}`,
  }));
}

/** How a change outside the plan, and a planned one not made, show: orange, each with its icon and words. */
export const CHANGE_LOOK: Record<'unplanned' | 'unmade', Look> = {
  unplanned: { label: 'Not in the plan', icon: 'diff-added', tone: 'orange' },
  unmade: { label: 'Planned, not changed', icon: 'circle-slash', tone: 'orange' },
};

/** How a builder's own deploy to its org shows under Changes (D-206): blue, with the org's name after "Deployed to". */
export const DEPLOY_LOOK: Record<'deployed', Look> = {
  deployed: { label: 'Deployed to', icon: 'cloud-upload', tone: 'blue' },
};

/** One org the task's builder deployed to, its latest deploy there: when, and what it came to, in a few words. */
export interface TicketDeploy {
  org: string;
  at: string;
  /** DEPLOY_LOOK's, with the org's name: "Deployed to Acme Dev". Carried as data, so the page draws it without the model. */
  look: Look;
  /** "6 components, 6 listed in the org · 2 tests passed in the org, 91% coverage". */
  words: string;
}

/** One thing changed or planned: a component or a file, the paths it stands for, and its mark, if any. */
export interface ChangeItem {
  name: string;
  paths: string[];
  look: Look | null;
  /** Every path it stands for is deleted by the ticket (T-138): the page marks it with an icon and the word. */
  deleted?: boolean;
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

/**
 * The Changes tab's one list (T-138): what the ticket changed once there's work, else what its plan names, by
 * type with a count. Planned but not made, and made but not planned, are kept apart, behind a quiet line.
 */
export interface ChangeList {
  /** "Metadata changed", or "Metadata planned" before there's work; "Files …" outside Salesforce. */
  title: string;
  count: number;
  sets: ChangeSet[];
  /** "2 planned, not made · 1 made, not planned", and those items with their marks; null when there are none. */
  apart: { label: string; sets: ChangeSet[] } | null;
}

export interface TicketChanges {
  task: string;
  /** The tab's one list (T-138). */
  list: ChangeList;
  /** Planned changes before there's work, Changes once there is. */
  title: 'Planned changes' | 'Changes';
  /** "Planned: 6 · Changed: 8", as items: only once there's work. Planned is null with no plan. */
  counts: { planned: number | null; changed: number } | null;
  /** What the lists are, or why there's no list of changes, in a muted line; null when they say it. */
  note: string | null;
  /** When the changes shown were kept with the task, for a task whose work merged; else null. */
  keptAt: string | null;
  /** Each org its builder deployed to (D-206), its latest deploy there, newest first; empty when it hasn't. */
  deployed: TicketDeploy[];
  changed: ChangeGroup[];
  planned: ChangeGroup[];
}

export interface ChangesIn {
  task: Pick<Task, 'id' | 'state' | 'changes' | 'deploys'>;
  profile: Profile;
  /** The plan's paths (plannedFiles); null with no plan, or one that names none. */
  planned: string[] | null;
  /** What its branch has changed so far (branchFiles), read while it's in flight; null when it wasn't read. */
  live: string[] | null;
  /** Of what it changed, the paths it deletes (T-138); left out when they weren't read. */
  deleted?: string[];
}

/** The order marks win in, when one component stands for paths marked differently: in the plan first. */
const RANK: ChangeMark[] = ['planned', 'changed', 'unplanned', 'unmade'];

/** Rows grouped by type or folder, each item once with its paths and its best mark; the catch-all set last. */
export function changeSets(rows: ChangeRow[], profile: Profile, deleted: readonly string[] = []): ChangeSet[] {
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
      items: [...s.items.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, i]) => ({
        name, paths: i.paths.sort(), look: i.mark === 'unplanned' || i.mark === 'unmade' ? CHANGE_LOOK[i.mark] : null,
        ...(deleted.length && i.paths.every((p) => deleted.includes(p)) ? { deleted: true } : {}),
      })),
    }));
}

/** The files group, named for what a person reads in it. */
const filesGroup = (rows: ChangeRow[], profile: Profile, deleted: readonly string[] = []): ChangeGroup[] =>
  rows.length ? [{ id: 'files', title: profile === 'salesforce' ? 'Metadata' : 'Files', sets: changeSets(rows, profile, deleted) }] : [];

/** Sets of only the items `keep` keeps, each without its mark where `plain`; a set left empty goes. */
const only = (sets: ChangeSet[], keep: (i: ChangeItem) => boolean, plain: boolean): ChangeSet[] =>
  sets.map((s) => ({ head: s.head, items: s.items.filter(keep).map((i) => (plain ? { ...i, look: null } : i)) })).filter((s) => s.items.length);

const count = (sets: ChangeSet[]): number => sets.reduce((n, s) => n + s.items.length, 0);

/**
 * The tab's one list (T-138): with work, each component made, unmarked, by type; before, the plan's. What was
 * planned and not made, and made and not planned, wait behind one quiet line that says how many.
 */
export function changeList(profile: Profile, planned: ChangeGroup[], changed: ChangeGroup[] | null): ChangeList {
  const what = profile === 'salesforce' ? 'Metadata' : 'Files';
  if (!changed) {
    const sets = planned.flatMap((g) => g.sets);
    return { title: `${what} planned`, count: count(sets), sets, apart: null };
  }
  const all = changed.flatMap((g) => g.sets);
  const sets = only(all, (i) => i.look !== CHANGE_LOOK.unmade, true);
  const unmade = count(only(all, (i) => i.look === CHANGE_LOOK.unmade, false));
  const unplanned = count(only(all, (i) => i.look === CHANGE_LOOK.unplanned, false));
  const label = [unmade ? `${unmade} planned, not made` : null, unplanned ? `${unplanned} made, not planned` : null].filter(Boolean).join(' · ');
  return { title: `${what} changed`, count: count(sets), sets, apart: label ? { label, sets: only(all, (i) => !!i.look, false) } : null };
}

const items = (groups: ChangeGroup[]): number => groups.reduce((n, g) => n + g.sets.reduce((m, s) => m + s.items.length, 0), 0);

/** What the section lists as changed: once it's done, what acc kept; in flight, its branch's paths, else what acc kept at its land. Null for none. */
function changedNow(i: ChangesIn): { live: string[] | null; kept: Task['changes'] | null; changed: string[] | null } {
  const kept = i.task.changes?.paths.length ? i.task.changes : null;
  const live = i.task.state !== 'done' && i.live?.length ? i.live : null;
  return { live, kept: kept ?? null, changed: live ?? kept?.paths ?? null };
}

/** The paths the section lists as changed, which a tracker's changes field is drafted from too (T-105); none before there's work. */
export const ticketPaths = (i: ChangesIn): string[] => changedNow(i).changed ?? [];

/**
 * The section, or null when there's nothing to show: no plan that names paths, no work yet, and nothing
 * merged. Once it's done, what acc kept shows; in flight, what its branch has changed, else what acc kept
 * at its land.
 */
export function ticketChanges(i: ChangesIn): TicketChanges | null {
  const done = i.task.state === 'done';
  const { live, kept, changed } = changedNow(i);
  const planned = filesGroup((i.planned ?? []).map((path) => ({ path, mark: 'planned' })), i.profile);
  const base = { task: i.task.id, keptAt: !live && kept ? kept.at : null, planned, deployed: ticketDeploys(i.task.deploys) };
  if (!changed) {
    if (done) return { ...base, list: changeList(i.profile, planned, []), title: 'Changes', counts: null, changed: [], note: `It merged before changes were kept with a task, so there's no record of what it changed.${planned.length ? ' Its plan named these.' : ''}` };
    return planned.length ? { ...base, list: changeList(i.profile, planned, null), title: 'Planned changes', counts: null, changed: [], note: null } : null;
  }
  const rows = planAgainst(i.planned, changed);
  const groups = filesGroup(rows, i.profile, i.deleted);
  const made = filesGroup(rows.filter((r) => r.mark !== 'unmade'), i.profile);
  return { ...base, list: changeList(i.profile, planned, groups), title: 'Changes', counts: { planned: planned.length ? items(planned) : null, changed: items(made) }, changed: groups, note: null };
}
