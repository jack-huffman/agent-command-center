/**
 * The Setup section: the checklist, by part and by what each step sets up.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { GROUP_TITLES, STEPS } from '../../../packages/core/src/onboarding/steps.ts';
import type { CheckStatus } from '../../../packages/core/src/onboarding/types.ts';
import { plural } from '../../../packages/core/src/text.ts';
import { KIND_QUESTION, SETUP_PARTS } from '../logic/first-open.ts';
import { inProcessWords, processLine, toolLineDoes } from '../logic/processes.ts';
import { type DoctorItem, hasRunnableFix } from '../logic/setup.ts';
import { REPORT_COMMAND } from './report.ts';
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
  /** A command line to copy, when the fix is another tool's, such as `brew install gh`. With does, the page folds it away: it's shown on request (GH-168). */
  fix: string | null;
  /** What Do it does, as its process (GH-163): "Compare the rules with their source", "Install the acc plugin in Claude Code". */
  does: string | null;
  actions: Action[];
}

/** Steps that set up one thing, such as the repo's GitHub account, in the order they're done. */
export interface SetupSection {
  key: string;
  title: string;
  todo: number;
  steps: SetupRow[];
}

/** A folder that isn't set up (GH-138): the question it starts from, with B0.config's Do it to answer it. */
export interface SetupStart {
  /** The data-part its heading carries, where the first open lands. */
  part: string;
  question: string;
  detail: string;
  actions: Action[];
}

/** A project being started (T-133): its profile, and the machine steps Check this machine ran for it. */
export interface SetupStarting {
  profile: 'salesforce' | 'generic';
  ids: string[];
}

/**
 * Before a project starts (T-133): what this machine still needs for it, each with its Do it, before the
 * project's settings are written. The person fixes them, or goes on anyway and comes back to Setup.
 */
export interface MachineFirst {
  /** The data-part its heading carries, where Setup jumps to show it. */
  part: string;
  title: string;
  detail: string;
  /** The steps still to do, each a Setup row: missing, or installed but not on PATH. */
  rows: SetupRow[];
  /** Start the project (when nothing is left) or Go on anyway, and Not now. */
  actions: Action[];
}

export interface SetupModel {
  kind: 'setup';
  done: number;
  total: number;
  /** In a folder with no .acc/config.json, what kind of project it is, asked at the top of This project. */
  start: SetupStart | null;
  /** A project being started, and what this machine still needs for it, shown first (T-133). */
  machineFirst: MachineFirst | null;
  /** jump: the data-part its heading carries, for a jump such as the first open's (GH-138). */
  parts: { part: 'machine' | 'project'; jump: string; label: string; todo: number; steps: SetupRow[]; sections: SetupSection[] }[];
}

/**
 * How a setup step's check shows, a step a person confirmed by hand, and a tool that's installed but not on
 * VSCode's PATH (T-133), which isn't the same as missing.
 */
export const STATUS: Record<CheckStatus | 'confirmed' | 'notOnPath', Look> = {
  pass: { label: 'Done', icon: 'pass', tone: 'blue' },
  fail: { label: 'To do', icon: 'warning', tone: 'orange' },
  unknown: { label: 'Check by hand', icon: 'question', tone: 'orange' },
  skip: { label: 'Doesn\'t apply', icon: 'circle-slash', tone: 'neutral' },
  confirmed: { label: 'Done by hand', icon: 'pass', tone: 'blue' },
  notOnPath: { label: 'Not on PATH', icon: 'eye-closed', tone: 'orange' },
};

/** What the start of a project calls each profile. */
const PROFILE_WORDS: Record<SetupStarting['profile'], string> = { salesforce: 'a Salesforce project', generic: 'this project' };

/** The part a project being started shows at the top of Setup (T-133). */
export const MACHINE_FIRST_PART = 'machine-first';

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

/** What Setup asks in a folder that isn't set up, whatever its profile will be (GH-138). */
export function setupStart(): SetupStart {
  return {
    part: SETUP_PARTS.kind,
    question: KIND_QUESTION,
    detail: 'This folder has no project settings yet. Choose a Salesforce project, another kind, a team template or a Jira epic, and Choose… sets up this project.',
    actions: [
      { command: 'acc.step.fix', label: 'Choose…', icon: 'wrench', ref: { step: 'B0.config' }, primary: true },
      { command: 'acc.openGuide', label: 'Guide', icon: 'book', ref: { step: 'B0.config' } },
    ],
  };
}

/**
 * Before a project starts (T-133): the steps Check this machine ran for its profile that are still to do. With
 * none left, Start the project; otherwise Go on anyway. Not now starts nothing, and Setup keeps the steps.
 */
export function machineFirst(starting: SetupStarting, rows: SetupRow[]): MachineFirst {
  const todo = starting.ids.map((id) => rows.find((r) => r.id === id)).filter((r): r is SetupRow => !!r && !r.done);
  const kind = PROFILE_WORDS[starting.profile];
  const go: Action = todo.length
    ? { command: 'acc.start.goOn', label: 'Go on anyway', icon: 'arrow-right', ref: {} }
    : { command: 'acc.start.goOn', label: 'Start the project', icon: 'arrow-right', ref: {}, primary: true };
  return {
    part: MACHINE_FIRST_PART,
    title: todo.length ? `Before the project starts: ${plural(todo.length, 'thing')} this machine needs` : 'This machine is ready',
    detail: todo.length
      ? `${upperFirst(kind)} needs these on this machine. Fix each one, or go on anyway: they stay in Setup, under This machine.`
      : `This machine has every tool ${kind} needs. Nothing has been written yet.`,
    rows: todo,
    actions: [go, { command: 'acc.start.notNow', label: 'Not now', icon: 'close', ref: {} }],
  };
}

const upperFirst = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * setUp: whether the folder has a .acc/config.json, null with no folder open. Only false asks what kind of project it is.
 * starting: a project being started (T-133), whose machine steps show first.
 */
export function setupModel(items: DoctorItem[], confirmed: Set<string>, setUp: boolean | null = true, starting: SetupStarting | null = null): SetupModel {
  const start = setUp === false ? setupStart() : null;
  const visible = [...items].sort((a, b) => stepOrder(a.id) - stepOrder(b.id));
  const rows = (part: 'machine' | 'project') => visible.filter((i) => i.part === part).map((i): SetupRow => {
    const step = STEPS.find((s) => s.id === i.id);
    const status = confirmed.has(i.id) && i.status !== 'pass' ? 'confirmed' : i.status;
    const ref: Ref = { step: i.id };
    const actions: Action[] = [{ command: 'acc.step.check', label: 'Check', icon: 'refresh', ref }];
    // What the step always offers, whatever its status, such as Import rules… (GH-108).
    if (step?.offer) actions.push({ command: step.offer.vscode, label: step.offer.label, icon: step.offer.icon, ref });
    const open = status === 'fail' || status === 'unknown';
    // A fix only the person can do, such as quitting VSCode, has no Do it (T-133): its detail says what to do.
    if (open && step && hasRunnableFix(step) && !i.byHand) actions.unshift({ command: 'acc.step.fix', label: 'Do it', icon: 'wrench', ref, primary: true });
    if (open && step?.fix?.setupPath) actions.push({ command: 'acc.step.openSetup', label: 'Open in Salesforce', icon: 'globe', ref });
    if (status === 'unknown') actions.push({ command: 'acc.step.confirm', label: 'I\'ve done this', icon: 'check', ref });
    if (step?.fix?.docs) actions.push({ command: 'acc.openGuide', label: 'Guide', icon: 'book', ref });
    // A step whose check failed can be reported (T-118): the draft starts with the step and its result.
    if (status === 'fail') actions.push({ command: REPORT_COMMAND.id, label: 'Report a problem', icon: 'report', ref });
    // Installed, but not on VSCode's PATH (T-133): its own look, so it isn't read as missing.
    const look = (status === 'fail' && i.place ? STATUS.notOnPath : STATUS[status]) ?? STATUS.skip;
    // A fix that's a VSCode command runs from Do it; one of acc's is named as its process (GH-163). Another
    // tool's command line is named too, and kept to show on request, for someone who runs it by hand (GH-168).
    // What acc says of the step is in process words as well.
    const fix = step?.fix?.vscode ? null : i.fix ?? null;
    const accDoes = fix ? processLine(fix) : null;
    const does = accDoes ?? (fix ? toolLineDoes(fix) : null);
    return { id: i.id, title: i.title, look, done: look.tone !== 'orange', detail: inProcessWords(i.detail), why: inProcessWords(step?.why ?? ''), fix: accDoes ? null : fix, does, actions };
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
    return { part, jump: part === 'machine' ? SETUP_PARTS.machine : SETUP_PARTS.project, label: part === 'machine' ? 'This machine' : 'This project', todo: steps.filter((s) => !s.done).length, steps, sections: sectionsOf(steps) };
  }).filter((p) => p.steps.length || (p.part === 'project' && start));
  const all = parts.flatMap((p) => p.steps);
  const first = starting ? machineFirst(starting, parts.find((p) => p.part === 'machine')?.steps ?? []) : null;
  return { kind: 'setup', done: all.filter((s) => s.done).length, total: all.length, start, machineFirst: first, parts };
}

/** Steps still to do, and those failing. */
function counts(setup: SetupModel): { todo: number; failing: number } {
  const todo = setup.total - setup.done;
  const failing = setup.parts.reduce((n, part) => n + part.steps.filter((s) => s.look.tone === 'orange').length, 0);
  return { todo, failing };
}

export const area: ModelArea = {
  commands: [
    'acc.step.check', 'acc.step.fix', 'acc.step.openSetup', 'acc.step.confirm', 'acc.openGuide', 'acc.openMachineWalkthrough', 'acc.openProjectWalkthrough', 'acc.importRules', 'acc.checkMachine', 'acc.start.goOn', 'acc.start.notNow',
  ],
  home: {
    order: 50,
    after({ setup, attention }) {
      const { todo, failing } = counts(setup);
      if (todo > 0) attention.push({ key: 'setup', look: LOOK(`${plural(todo, 'setup step')} to do`, 'checklist', failing ? 'orange' : 'neutral'), title: 'Setup', detail: setup.parts.flatMap((part) => part.steps).filter((s) => s.look.tone === 'orange').slice(0, 3).map((s) => s.title).join(' · ') || 'Some steps are left to confirm', project: '', actions: [], go: { section: 'setup', label: 'Open Setup' } });
    },
    nav({ setup }) {
      const { todo, failing } = counts(setup);
      return { section: 'setup', label: 'Setup', icon: 'checklist', count: todo || null, attention: failing > 0, hint: todo ? `${todo} to do` : 'All done' };
    },
  },
};
