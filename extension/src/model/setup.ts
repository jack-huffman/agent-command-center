/**
 * The Setup section: the checklist, by part and by what each step sets up.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { GROUP_TITLES, STEPS } from '../../../packages/core/src/onboarding/steps.ts';
import type { DoctorItem } from '../logic/setup.ts';
import { type Action, type Look, LOOK, type ModelArea, type Ref } from './shared.ts';

// ---------------------------------------------------------------- setup

export interface SetupRow {
  id: string;
  title: string;
  look: Look;
  /** Passed, done by hand, or doesn't apply: shown muted, in one line. */
  done: boolean;
  detail: string;
  why: string;
  fix: string | null;
  actions: Action[];
}

/** Steps that set up one thing, such as the repo's GitHub account, in the order they're done. */
export interface SetupSection {
  key: string;
  title: string;
  todo: number;
  steps: SetupRow[];
}

export interface SetupModel {
  kind: 'setup';
  done: number;
  total: number;
  parts: { part: 'machine' | 'project'; label: string; todo: number; steps: SetupRow[]; sections: SetupSection[] }[];
}

const STATUS: Record<string, Look> = {
  pass: { label: 'Done', icon: 'pass', tone: 'blue' },
  fail: { label: 'To do', icon: 'warning', tone: 'orange' },
  unknown: { label: 'Check by hand', icon: 'question', tone: 'orange' },
  skip: { label: 'Doesn\'t apply', icon: 'circle-slash', tone: 'neutral' },
  confirmed: { label: 'Done by hand', icon: 'pass', tone: 'blue' },
};

/** A step's group: its own, or its id's prefix for a step this build doesn't know. */
const groupOf = (id: string): string => STEPS.find((s) => s.id === id)?.group ?? id.split('.')[0]!;

/**
 * Where a step comes in the order you'd set things up (D-047): the step list's order, whatever order the
 * checks finished in. A step this build doesn't know goes at the end of its group.
 */
function stepOrder(id: string): number {
  const i = STEPS.findIndex((s) => s.id === id);
  if (i >= 0) return i;
  const group = groupOf(id);
  const last = STEPS.reduce((n, s, k) => (s.group === group ? k : n), -1);
  return last >= 0 ? last + 0.5 : STEPS.length;
}

export function setupModel(items: DoctorItem[], confirmed: Set<string>): SetupModel {
  const visible = [...items].sort((a, b) => stepOrder(a.id) - stepOrder(b.id));
  const rows = (part: 'machine' | 'project') => visible.filter((i) => i.part === part).map((i): SetupRow => {
    const step = STEPS.find((s) => s.id === i.id);
    const status = confirmed.has(i.id) && i.status !== 'pass' ? 'confirmed' : i.status;
    const ref: Ref = { step: i.id };
    const actions: Action[] = [{ command: 'acc.step.check', label: 'Check', icon: 'refresh', ref }];
    const open = status === 'fail' || status === 'unknown';
    if (open && (step?.fix?.command || step?.fix?.fromCheck || step?.fix?.vscode)) actions.unshift({ command: 'acc.step.fix', label: 'Do it', icon: 'wrench', ref, primary: true });
    if (open && step?.fix?.setupPath) actions.push({ command: 'acc.step.openSetup', label: 'Open in Salesforce', icon: 'globe', ref });
    if (status === 'unknown') actions.push({ command: 'acc.step.confirm', label: 'I\'ve done this', icon: 'check', ref });
    if (step?.fix?.docs) actions.push({ command: 'acc.openGuide', label: 'Guide', icon: 'book', ref });
    const look = STATUS[status] ?? STATUS.skip!;
    // A fix that's a VSCode command runs from Do it; only terminal commands are shown to copy.
    return { id: i.id, title: i.title, look, done: look.tone !== 'orange', detail: i.detail, why: step?.why ?? '', fix: step?.fix?.vscode ? null : i.fix ?? null, actions };
  });
  /** Neighbouring steps that set up the same thing make one section. */
  const sectionsOf = (steps: SetupRow[]): SetupSection[] => {
    const out: SetupSection[] = [];
    for (const s of steps) {
      const group = groupOf(s.id);
      const title = GROUP_TITLES[group] ?? group;
      const prev = out[out.length - 1];
      if (prev && prev.title === title) prev.steps.push(s);
      else out.push({ key: group, title, todo: 0, steps: [s] });
    }
    for (const sec of out) sec.todo = sec.steps.filter((s) => !s.done).length;
    return out;
  };
  const parts = (['machine', 'project'] as const).map((part) => {
    const steps = rows(part);
    return { part, label: part === 'machine' ? 'This machine' : 'This project', todo: steps.filter((s) => !s.done).length, steps, sections: sectionsOf(steps) };
  }).filter((p) => p.steps.length);
  const all = parts.flatMap((p) => p.steps);
  return { kind: 'setup', done: all.filter((s) => s.done).length, total: all.length, parts };
}

/** Steps still to do, and those failing. */
function counts(setup: SetupModel): { todo: number; failing: number } {
  const todo = setup.total - setup.done;
  const failing = setup.parts.reduce((n, part) => n + part.steps.filter((s) => s.look.tone === 'orange').length, 0);
  return { todo, failing };
}

export const area: ModelArea = {
  home: {
    order: 50,
    after({ setup, attention }) {
      const { todo, failing } = counts(setup);
      if (todo > 0) attention.push({ key: 'setup', look: LOOK(`${todo} setup step${todo === 1 ? '' : 's'} to do`, 'checklist', failing ? 'orange' : 'neutral'), title: 'Setup', detail: setup.parts.flatMap((part) => part.steps).filter((s) => s.look.tone === 'orange').slice(0, 3).map((s) => s.title).join(' · ') || 'Some steps are left to confirm', project: '', actions: [], go: { section: 'setup', label: 'Open Setup' } });
    },
    stats({ setup }) {
      const { failing } = counts(setup);
      return [
      { order: 60, tile: { label: 'Setup', value: `${setup.done}/${setup.total}`, icon: 'checklist', tone: failing ? 'orange' : 'neutral', section: 'setup', hint: failing ? `${failing} step${failing === 1 ? '' : 's'} failing` : 'Steps done' } },
      ];
    },
    nav({ setup }) {
      const { todo, failing } = counts(setup);
      return { section: 'setup', label: 'Setup', icon: 'checklist', count: todo || null, attention: failing > 0, hint: todo ? `${todo} to do` : 'All done' };
    },
  },
};
