/**
 * Dispatch's sheet (D-???): one sheet over the page asks for the model, the effort and where the builder
 * runs, then dispatches. What it offers, and acc dispatch's arguments for what a person chose, from the
 * same functions Dispatch with… used (D-086, D-128). Plain data, posted to the page. No vscode import, so
 * it's testable.
 */

import { BUILDER_PLACE_LOOK } from '../../../packages/core/src/cloud.ts';
import { BUILDER_PLACES, type BuilderPlace, type CloudAgents, EFFORTS, type Effort } from '../../../packages/core/src/config.ts';
import { effortDroppedWords } from '../../../packages/core/src/efforts.ts';
import { dispatchModelArgs, dispatchModelItems } from '../logic/agents.ts';
import { type BuilderEffort, dispatchEffortArgs, dispatchEffortItems, type EffortItem, noEffortArgs } from '../logic/efforts.ts';
import type { TaskRow } from '../logic/shared.ts';
import { anywayQuestion, sizeLine } from '../logic/tasks.ts';
import { cloudDisabled } from './cards.ts';
import { KEY, type ModelArea, short } from './shared.ts';

/**
 * The commands that open the sheet. Dispatch with… and Dispatch to the cloud are kept for one release, so a
 * key binding still works; Dispatch anyway opens it saying what the task shares (D-093).
 */
export const SHEET_COMMANDS: readonly string[] = ['acc.task.dispatch', 'acc.task.dispatchWith', 'acc.task.dispatchCloud', 'acc.task.dispatchAnyway'];

/** What the sheet's Effort offers: a level, null for none named, or `default` to drop the level picked for the task. */
export type EffortValue = Effort | 'default' | null;

/** One segment of Effort: its level, and the words under the control while it's chosen. */
export interface SheetEffort {
  label: string;
  value: EffortValue;
  /** Where it's set, or what the level means, and that it drops a pick, as Dispatch with… said it. */
  about: string;
}

/** One model the sheet offers, with the levels it takes. */
export interface SheetModel {
  /** The model's name, or null for Another model…, which asks for one in a text box. */
  value: string | null;
  label: string;
  /** Where it's set, such as "project default", or what it is, in muted type. */
  about: string;
  /** Its levels, lowest first; none for a model that takes none. */
  efforts: SheetEffort[];
  /** The level chosen when the model is: the one the builder would run with. -1 when it takes none. */
  effort: number;
  /** For a model that takes no level: the line that says so, and that it drops a pick. */
  none: string | null;
}

/** One place the builder may run: This Mac or the cloud, off with its reason. */
export interface SheetPlace {
  value: BuilderPlace;
  label: string;
  icon: string;
  disabled?: string;
}

export interface DispatchSheet {
  project: string;
  task: string;
  /** "Dispatch ACME-12", or "Re-dispatch ACME-12" for a task in rework. */
  title: string;
  /** The primary button's label. */
  go: string;
  /** Dispatch anyway (D-093): it starts though it shares files, and `shares` says which. */
  anyway: boolean;
  shares: { message: string; lines: { task: string; files: string }[] } | null;
  /** The model chosen first, the one the builder uses, is models[0]. */
  models: SheetModel[];
  places: SheetPlace[];
  /** The place chosen first: the project's default, or This Mac when the cloud is off. */
  place: BuilderPlace;
  /** What going to the cloud means for the model and the effort, under Where while the cloud is chosen. */
  cloudNote: string;
  /** The analysis's size, in muted type, when the task has one. */
  size: string | null;
}

/** What the sheet is made from: the task's row, the project's builder and config, and what opened it. */
export interface SheetInput {
  project: string;
  row: Pick<TaskRow, 'id' | 'state' | 'run' | 'analysis' | 'files'>;
  builder: BuilderEffort & { model: string; from: { model: string; effort: string } };
  config: { github: { repo: string } | null; agents?: { cloud?: CloudAgents | null } | null } | null | undefined;
  /** Dispatch anyway opened it (D-093). */
  anyway?: boolean;
  /** The place asked for, as Dispatch to the cloud asks for the cloud; else the project's default. */
  where?: BuilderPlace;
}

/** What a person chose in the sheet, as the page sends it. */
export interface SheetChoice {
  model: string;
  /** Left out when the model takes no level. */
  effort?: EffortValue;
  where: BuilderPlace;
}

/** Where a plain dispatch runs: the project's default (GH-69), else This Mac. */
export const defaultPlace = (config: SheetInput['config']): BuilderPlace => config?.agents?.cloud?.default ?? 'local';

/** Where the sheet's model text box finds a model's levels: one acc doesn't know takes every level. */
const ANOTHER = '';

/**
 * Effort's segments for a model: Dispatch with…'s items in level order, lowest first, each label once (the
 * first, which is the task's pick, wins). A level that isn't one, such as "Default", goes first. And which
 * is chosen: the first item, the one the builder would run with.
 */
export function effortSegments(items: EffortItem[]): { efforts: SheetEffort[]; chosen: number } {
  const seen = new Set<string>();
  const once = items.filter((i) => !seen.has(i.label) && seen.add(i.label));
  const rank = (i: EffortItem) => (EFFORTS as readonly string[]).indexOf(i.label);
  const sorted = [...once].sort((a, b) => rank(a) - rank(b));
  const efforts = sorted.map((i) => ({ label: i.label, value: i.value, about: i.detail ? `${i.description}. ${i.detail}` : i.description }));
  return { efforts, chosen: items.length ? sorted.indexOf(items[0]!) : -1 };
}

/** The sheet for a task: its models first among them the one its builder uses, their efforts, and where it may run. */
export function dispatchSheet(i: SheetInput): DispatchSheet {
  const { row, builder } = i;
  const rework = row.state === 'rework';
  const verb = rework ? 'Re-dispatch' : 'Dispatch';
  const models = dispatchModelItems(row, builder).map((m): SheetModel => {
    const { efforts, chosen } = effortSegments(dispatchEffortItems(row, builder, m.value ?? ANOTHER));
    const dropped = efforts.length ? null : noEffortArgs(row).dropped;
    const none = efforts.length ? null : `${m.label} takes no effort level.${dropped ? ` ${effortDroppedWords(dropped, m.label)}` : ''}`;
    return { value: m.value, label: m.label, about: m.description, efforts, effort: chosen, none };
  });
  const off = cloudDisabled(i.config);
  const places = BUILDER_PLACES.map((p): SheetPlace => ({ value: p, ...BUILDER_PLACE_LOOK[p], ...(p === 'cloud' && off ? { disabled: off } : {}) }));
  const wanted = i.where ?? defaultPlace(i.config);
  const shares = i.anyway && row.files?.shares.length ? row.files.shares : null;
  return {
    project: i.project,
    task: row.id,
    title: `${verb} ${row.id}`,
    go: i.anyway ? `${verb} anyway` : verb,
    anyway: !!i.anyway,
    shares: shares ? { message: anywayQuestion({ id: row.id, files: { shares } }).message, lines: shares.map((s) => ({ task: s.task, files: s.files.join(', ') })) } : null,
    models,
    places,
    place: wanted === 'cloud' && off ? 'local' : wanted,
    cloudNote: 'Its branch goes to GitHub, and the project\'s routine builds it in a cloud session with the routine\'s own model and effort. The model and effort here are kept for a later dispatch on this Mac.',
    size: row.analysis ? sizeLine(row) : null,
  };
}

/**
 * acc dispatch's arguments for what a person chose in the sheet, and the level it drops, if any (D-128). A
 * choice the same as the sheet's defaults sends no model or effort: acc runs with what it would anyway, and
 * keeps a pick made before. Otherwise the model and effort go as Dispatch with… sent them (D-086, D-128).
 * A place other than the project's default sends --cloud or --local.
 */
export function dispatchChoiceArgs(i: SheetInput, choice: SheetChoice): { args: string[]; dropped: string | null } {
  const sheet = dispatchSheet(i);
  const first = sheet.models[0]!;
  const levels = dispatchEffortItems(i.row, i.builder, choice.model);
  const place = choice.where === defaultPlace(i.config) ? [] : [choice.where === 'cloud' ? '--cloud' : '--local'];
  const asFirst = choice.model === first.value && (levels.length ? choice.effort === levels[0]!.value : true);
  if (asFirst) return { args: place, dropped: null };
  const effort = levels.length ? { args: dispatchEffortArgs(i.row, i.builder, choice.effort ?? null), dropped: null } : noEffortArgs(i.row);
  return { args: [...dispatchModelArgs(i.row, i.builder, choice.model), ...effort.args, ...place], dropped: effort.dropped ? effortDroppedWords(effort.dropped, choice.model) : null };
}

export type Message =
  /** The sheet's Dispatch: the task, and what was chosen in it. effort is left out for a model that takes none. */
  | { type: 'dispatch-sheet-go'; project: string; task: string; model: string; effort?: EffortValue; where: BuilderPlace; anyway?: boolean };

/** Whether an effort the page sent is one the sheet offers. */
const anEffort = (v: unknown): boolean => v === undefined || v === null || v === 'default' || (EFFORTS as readonly unknown[]).includes(v);

export const area: ModelArea = {
  messages: {
    'dispatch-sheet-go': (x) => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string) && short(x.model, 200) && anEffort(x.effort)
      && (BUILDER_PLACES as readonly unknown[]).includes(x.where) && (x.anyway === undefined || typeof x.anyway === 'boolean'),
  },
};
