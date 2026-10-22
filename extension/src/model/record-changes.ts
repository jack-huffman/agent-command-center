/**
 * Record changes on a task's page (T-100): what the ticket changes in an org that git never sees. Each one
 * the plan lists, each one recorded by its builder or a person (with who and when, and whether it was
 * planned), and, for each environment its work was promoted to, a step for each change with the commands
 * that make it, for a person to mark done or skip with a reason. "Add a change made by hand" records what a
 * person did in the org's own pages. A section of its own for now: T-99's Changes section takes it as a
 * group. Plain data and the messages' checks: no vscode import, so it's testable.
 */

import type { Analysis } from '../../../packages/core/src/analyze.ts';
import { stepsOf } from '../../../packages/core/src/change-steps.ts';
import type { Environment } from '../../../packages/core/src/config.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import { outsideOf, unmade } from '../../../packages/core/src/outside-changes.ts';
import { RECORD_ACTIONS, RECORD_KIND, type RecordChange, recordWords } from '../../../packages/core/src/records.ts';
import { plural } from '../../../packages/core/src/text.ts';
import { KEY, type Look, type ModelArea, short } from './shared.ts';

/** What tells a page how its Add or a step's Done or Skip went. */
export const RECORDS_DONE = 'records-done';

/** How each record change, each step and the section show: orange for what needs a person, blue for what's made. */
export const RECORD_LOOK: Record<'made' | 'unplanned' | 'planned' | 'refused' | 'todo' | 'done' | 'skipped' | 'none' | 'kept' | 'steps', Look> = {
  made: { label: 'Made, planned', icon: 'pass', tone: 'blue' },
  unplanned: { label: 'Made, not in the plan', icon: 'warning', tone: 'orange' },
  planned: { label: 'Planned, not made yet', icon: 'circle-large-outline', tone: 'neutral' },
  refused: { label: 'Named by ID', icon: 'warning', tone: 'orange' },
  todo: { label: 'To do', icon: 'circle-large-outline', tone: 'orange' },
  done: { label: 'Done', icon: 'pass', tone: 'blue' },
  skipped: { label: 'Skipped', icon: 'debug-step-over', tone: 'neutral' },
  none: { label: 'None yet', icon: 'circle-large-outline', tone: 'neutral' },
  kept: { label: 'Kept', icon: 'database', tone: 'blue' },
  steps: { label: 'Steps to do', icon: 'tasklist', tone: 'orange' },
};

/** A record change as the section lists it. */
export interface RecordRow {
  look: Look;
  words: string;
  why: string;
  /** Who made it, "builder:ACME-7" or "human:jordan", and when; null for one only planned. */
  by: string | null;
  at: string | null;
  /** Why the plan's change is refused: it names its record by ID. */
  refused: string | null;
}

/** A button: its label, and why it's off, or null when it's on. */
export interface RecordButton {
  label: string;
  disabled: string | null;
}

/** One change to make by hand in an environment: its words, the commands, its state, and its two buttons while it's to do. */
export interface StepRow {
  change: string;
  env: string;
  look: Look;
  words: string;
  script: string[];
  reason: string | null;
  by: string | null;
  at: string | null;
  done: RecordButton | null;
  skip: RecordButton | null;
}

/** An environment the work was promoted to, with its steps, and how many are left. */
export interface PromotionSteps {
  env: string;
  name: string;
  pr: { number: number; url: string } | null;
  /** "1 step not done", orange, or null when every step is done or skipped. */
  left: Look | null;
  steps: StepRow[];
}

/** The task page's Record changes section. */
export interface TicketRecords {
  task: string;
  look: Look;
  note: string | null;
  rows: RecordRow[];
  promotions: PromotionSteps[];
  /** Add a change made by hand: the form's button, off with why for a project of another profile. */
  add: RecordButton;
}

export interface RecordsIn {
  task: Pick<Task, 'id' | 'state' | 'outside' | 'promotions'>;
  analysis: Pick<Analysis, 'recordChanges'> | null;
  profile: string;
  environments: Pick<Environment, 'branch' | 'name'>[];
}

/** The section, for a Salesforce task; null for another profile, whose changes git holds. */
export function ticketRecords(i: RecordsIn): TicketRecords | null {
  if (i.profile !== RECORD_KIND.profile) return null;
  const o = outsideOf(i.task);
  const planned = i.analysis?.recordChanges ?? [];
  const made = o.changes.filter((c) => c.kind === RECORD_KIND.kind);
  const rows: RecordRow[] = [
    ...made.map((c): RecordRow => ({ look: c.planned ? RECORD_LOOK.made : RECORD_LOOK.unplanned, words: recordWords(c.detail as RecordChange), why: c.why, by: c.by, at: c.at, refused: null })),
    ...unmade(planned, made, RECORD_KIND).map((p): RecordRow => ({ look: p.refused ? RECORD_LOOK.refused : RECORD_LOOK.planned, words: recordWords(p), why: p.why, by: null, at: null, refused: p.refused ?? null })),
  ];
  const envs = [...new Set(o.steps.map((s) => s.env))];
  const promotions = envs.map((env): PromotionSteps => {
    const steps = stepsOf(i.task, env).map((s): StepRow => {
      const todo = s.step.state === 'todo';
      return {
        change: s.step.change, env, look: RECORD_LOOK[s.step.state], words: s.words, script: s.script, reason: s.step.reason, by: s.step.by, at: s.step.at,
        done: todo ? { label: 'Mark done', disabled: null } : null, skip: todo ? { label: 'Skip', disabled: null } : null,
      };
    });
    const left = steps.filter((s) => s.done).length;
    const pr = [...(i.task.promotions ?? [])].reverse().find((p) => p.to === env)?.pr ?? null;
    return { env, name: i.environments.find((e) => e.branch === env)?.name ?? env, pr, left: left ? { ...RECORD_LOOK.steps, label: `${plural(left, 'step')} not done` } : null, steps };
  });
  const toDo = promotions.reduce((n, p) => n + p.steps.filter((s) => s.done).length, 0);
  const look = toDo ? { ...RECORD_LOOK.steps, label: `${plural(toDo, 'step')} to do` } : rows.length ? RECORD_LOOK.kept : RECORD_LOOK.none;
  const note = rows.length ? null : 'No record changes yet. A change to a record in the org, which git never sees, shows here when its builder or a person records it.';
  return { task: i.task.id, look, note, rows, promotions, add: { label: 'Add a change made by hand', disabled: null } };
}

/** What the page's form sends: a change a person made by hand in the org's own pages. */
export interface RecordForm {
  object: string;
  action: (typeof RECORD_ACTIONS)[number];
  match: string[];
  set: string[];
  why: string;
}

/** acc's arguments for a change made by hand, as the page's form gave it. */
export function recordArgs(task: string, f: RecordForm): string[] {
  return ['change', 'record', task, '--object', f.object.trim(), ...f.match.flatMap((m) => ['--match', m.trim()]), ...f.set.flatMap((s) => ['--set', s.trim()]),
    ...(f.action === 'create' ? ['--create'] : f.action === 'delete' ? ['--delete'] : []), '--why', f.why.trim(), '--json'];
}

/** acc's arguments for a step marked done, or skipped with a reason. */
export const stepArgs = (task: string, change: string, env: string, skip: string | null): string[] =>
  ['change', 'step', task, change, '--env', env, ...(skip === null ? ['--done'] : ['--skip', skip.trim()]), '--json'];

export type Message =
  /** "Add a change made by hand" (T-100): acc records it as the person's. */
  | ({ type: 'record-add'; project: string; task: string } & RecordForm)
  /** A promotion's step marked done, or skipped with a reason (T-100). */
  | { type: 'record-step'; project: string; task: string; change: string; env: string; skip: string | null };

const lines = (v: unknown): boolean => Array.isArray(v) && v.length <= 50 && v.every((x) => short(x, 2000) && (x as string).includes('='));

export const area: ModelArea = {
  messages: {
    'record-add': (x) => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string) && short(x.object, 200) && !!(x.object as string).trim()
      && (RECORD_ACTIONS as readonly string[]).includes(x.action as string) && lines(x.match) && (x.match as string[]).length > 0 && lines(x.set) && short(x.why, 300) && !!(x.why as string).trim(),
    'record-step': (x) => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string) && short(x.change, 20) && /^c\d+$/.test(x.change as string) && short(x.env, 100)
      && (x.skip === null || (short(x.skip, 300) && !!(x.skip as string).trim())),
  },
};
