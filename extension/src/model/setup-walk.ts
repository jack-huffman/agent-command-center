/**
 * Setup as a guided walkthrough (T-153): the chapters, in the order things are set up, and each step as its own
 * screen shows it: the one thing to do, why in a sentence or two, its one action, and why Next is off until its
 * check passes. Where the person is in the walk is the page's (extension/webview/walk.ts); this is what each
 * screen holds. Plain data, no vscode import, so it's testable.
 */

import { CLOUD_SETUP } from '../../../packages/core/src/onboarding/cloud-steps.ts';
import { GROUP_TITLES, STEPS } from '../../../packages/core/src/onboarding/steps.ts';
import { REPORT_COMMAND } from './report.ts';
import type { SetupModel, SetupRow, SetupStart } from './setup.ts';
import { type Action, type Look, LOOK, type ModelArea, short } from './shared.ts';

/** One step as its screen shows it. */
export interface WalkStep {
  id: string;
  /** The one thing to do, as an instruction: "Install the GitHub CLI". */
  title: string;
  /** The step's own name, as its chapter lists it: "GitHub CLI". */
  name: string;
  look: Look;
  done: boolean;
  /** Why it matters, in a sentence or two. */
  why: string;
  /** What's wrong and what to do, folded under Show how. */
  detail: string;
  /** A command line to copy, folded under Show how with the detail. */
  fix: string | null;
  /** What Do it does, as its process. */
  does: string | null;
  /** The one action: Do it, I've done this, or the step's one choice. Null when only a check is left. */
  main: Action | null;
  /** The rest, such as Guide and Report a problem, folded under Show how. */
  more: Action[];
  /** Check again, beside the live check. */
  check: Action | null;
  /** Why Next is off, until the check passes; null once it has. */
  next: string | null;
  /** The modal Do it opens over the walkthrough, such as Set up cloud builders; the walkthrough waits under it. */
  opens: string | null;
}

/** A chapter: the steps that set up one thing, such as the repo's GitHub account. */
export interface Chapter {
  key: string;
  part: 'machine' | 'project';
  title: string;
  look: Look;
  steps: WalkStep[];
}

/** Where the person is in the walk, kept so they come back to it: the screen on show, the walk's steps, and those skipped. */
export interface WalkPlace {
  /** A step's id, or the start or end screen's (WALK_START, WALK_END in extension/webview/walk.ts). */
  at: string;
  /** The steps the walk goes through, as they were when it started, in order. */
  walk: string[];
  skipped: string[];
}

/** Where a folder keeps where Setup's walkthrough was left (workspace state). */
export const WALK_STATE = 'acc.setup.walk';

/** The id the walk gives "What kind of project is this?" in a folder that isn't set up (GH-138): B0.config's, whose Do it answers it. */
export const KIND_STEP = 'B0.config';

/**
 * Each step as an instruction, for its screen's title. A step this build doesn't know keeps its name. Every step
 * in STEPS has one: extension/test/setup-walk.test.ts fails on one without.
 */
export const WALK_TITLES: Record<string, string> = {
  'A1.brew': 'Install Homebrew',
  'A1.winget': 'Install winget',
  'A1.git': 'Install git 2.40 or later',
  'A1.sh': 'Install Git for Windows',
  'A1.node': 'Install Node 20 or later',
  'A1.npm': 'Install npm',
  'A1.gh': 'Install the GitHub CLI',
  'A1.claude': 'Install the Claude Code CLI',
  'A1.claude-billing': 'Bill agents to your Claude subscription',
  'A1.sf': 'Install the Salesforce CLI',
  'A1.code-analyzer': 'Install Salesforce Code Analyzer',
  'A1.java': 'Install Java 11 or later',
  'A1.python': 'Install Python 3.10 or later',
  'A2.gh-login': 'Sign in to GitHub',
  'A4.plugin': 'Install the Command Center\'s Claude Code plugin',
  'B0.repo': 'Open the project\'s repo',
  'B0.config': 'Make the project\'s settings',
  'B0.template': 'Bring the team template up to date',
  'B0.rules': 'Bring the copied-in rules up to date',
  'B1.orgs': 'List every org',
  'B2.identity': 'Set who commits in this repo',
  'B2.account': 'Sign in to the repo\'s GitHub account',
  'B2.credentials': 'Make git push as the right account',
  'B3.gitignore': 'Block client data at the repo root',
  'B3.data-files': 'Take client data files out of git',
  'B3.secrets': 'Take credentials out of tracked files',
  'B4.skeleton': 'Add the Salesforce project skeleton',
  'B5.baseline': 'Add the baseline manifest',
  'B6.branches': 'Make a branch for every environment',
  'B6.org-match': 'Point each branch at the right org',
  'B8.tracking': 'Turn on source tracking in Developer sandboxes',
  'B8.cli-tracking': 'Tell the Salesforce CLI they\'re tracked',
  'B9.lists': 'List what differs by environment',
  'B10.default-branch': 'Make the day-to-day branch GitHub\'s default',
  'B10.default-org': 'Make the day-to-day org the local default',
  'B10.ignore-worktrees': 'Keep task worktrees out of git',
  'B10.merge-floors': 'Let raised floors merge on their own',
  'B10.required-check': 'Make GitHub require the checks autopilot waits for',
  'B10.readme': 'Name every environment in the README',
  'B12.trust': 'Trust the repo in Claude Code',
  'B13.gate-tools': 'Get the required checks ready to run',
  'B13.tools': 'Install the tools the project\'s checks need',
  'B14.tickets': 'Connect the repo\'s ticket source',
  'B15.cloud-github-app': 'Let Claude clone the repo from the cloud',
  'B15.cloud-routine': 'Make a scheduled task for the repo',
  'B15.cloud-token': 'Keep the scheduled task\'s token',
  'B15.cloud-login': 'Sign Claude Code in to claude.ai',
  'B15.cloud-guard': 'Commit the push guard',
  'B11.drift': 'Match the day-to-day org to its branch',
};

/** The modals a step's Do it opens over Setup, by the command it runs, and what each is called. */
export const WALK_MODALS: Record<string, string> = { [CLOUD_SETUP.command]: CLOUD_SETUP.title, 'acc.trackers.add': 'Connect a tracker' };

/**
 * Why a step matters, in a sentence or two: its first two sentences, without the decision or issue it cites,
 * and without the backticks a command line's name is quoted in.
 */
export function plainWhy(why: string): string {
  const text = why.replace(/\s*\((?:[DT]|GH)-\d+(?:, (?:[DT]|GH)-\d+)*\)/g, '').replaceAll('`', '').trim();
  // A sentence ends at a stop with a space after it, so "monday.com" stays whole.
  return text.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
}

/** Why Next is off on a step: its check hasn't passed, said as what would let it on. Null once it's done. */
export function nextWhy(row: SetupRow): string | null {
  if (row.done) return null;
  if (row.actions.some((a) => a.command === 'acc.step.confirm')) return 'Its check can\'t see this: say you\'ve done it, or skip it for now';
  return 'Its check hasn\'t passed yet: do it, or skip it for now';
}

/**
 * The step's one action (T-153): Do it where it has one, else I've done this, else its own one choice, such as
 * Open in Salesforce. Guide and Report a problem never are: they fold under Show how. Check is beside the live
 * check. A done step has none: Next is all it needs.
 */
export function mainAction(row: SetupRow): Action | null {
  if (row.done) return null;
  const aside = new Set(['acc.step.check', 'acc.openGuide', REPORT_COMMAND.id]);
  const a = row.actions.find((x) => x.primary) ?? row.actions.find((x) => x.command === 'acc.step.confirm') ?? row.actions.find((x) => !aside.has(x.command));
  return a ? { ...a, primary: true } : null;
}

/** A Setup row as its screen shows it. */
export function walkStep(row: SetupRow): WalkStep {
  const main = mainAction(row);
  const check = row.actions.find((a) => a.command === 'acc.step.check') ?? null;
  const vscodeFix = STEPS.find((s) => s.id === row.id)?.fix?.vscode;
  return {
    id: row.id, title: WALK_TITLES[row.id] ?? row.title, name: row.title, look: row.look, done: row.done, why: plainWhy(row.why), detail: row.detail,
    fix: row.fix, does: row.does, main, more: row.actions.filter((a) => a !== check && a.command !== main?.command).map((a) => ({ ...a, primary: false })),
    check, next: nextWhy(row), opens: main?.command === 'acc.step.fix' && vscodeFix ? WALK_MODALS[vscodeFix] ?? null : null,
  };
}

/** "What kind of project is this?" (GH-138) as a step of the walk, in a folder that isn't set up: its one choice is Choose…. */
export function kindStep(s: SetupStart): WalkStep {
  const choose = s.actions.find((a) => a.primary) ?? s.actions[0]!;
  return {
    id: KIND_STEP, title: s.question, name: s.question, look: LOOK('To do', 'warning', 'orange'), done: false,
    why: 'The kind of project decides which steps follow, and what the project\'s settings hold.', detail: s.detail, fix: null, does: null,
    main: { ...choose, primary: true }, more: s.actions.filter((a) => a !== choose), check: null, next: 'Choose what kind of project this is first, or skip it for now', opens: null,
  };
}

/** How a chapter shows: done, or how many of its steps are left to do. */
export function chapterLook(todo: number): Look {
  return todo ? LOOK(`${todo} to do`, 'warning', 'orange') : LOOK('Done', 'pass', 'blue');
}

/**
 * The chapters, in the order things are set up (D-047): each of Setup's sections, This machine's then This
 * project's. In a folder that isn't set up, The repo starts with what kind of project it is, unless a project is
 * being started already (T-133).
 */
export function setupChapters(m: Pick<SetupModel, 'parts' | 'start' | 'machineFirst'>): Chapter[] {
  const out: Chapter[] = [];
  for (const part of m.parts) {
    for (const sec of part.sections) out.push({ key: `${part.part}:${sec.key}`, part: part.part, title: sec.title, look: chapterLook(sec.todo), steps: sec.steps.map(walkStep) });
    if (part.part !== 'project' || !m.start || m.machineFirst || part.steps.some((s) => s.id === KIND_STEP)) continue;
    // The project's chapters are the last ones in: the question goes first in The repo, or in a The repo of its own before them.
    let repo = out.find((c) => c.key === 'project:B0');
    if (!repo) out.splice(out.length - part.sections.length, 0, repo = { key: 'project:B0', part: 'project', title: GROUP_TITLES.B0!, look: chapterLook(0), steps: [] });
    repo.steps.unshift(kindStep(m.start));
    repo.look = chapterLook(repo.steps.filter((s) => !s.done).length);
  }
  return out;
}

export type Message =
  /** Where the walkthrough is, kept for the folder so a tab opened later comes back to it. */
  | { type: 'setup-walk'; place: WalkPlace };

/** A place that fits: a short id or screen, and lists of short ids no longer than Setup has steps, with room to spare. */
export const isWalkPlace = (x: unknown): x is WalkPlace => {
  const p = x as Partial<WalkPlace> | null;
  const ids = (v: unknown) => Array.isArray(v) && v.length <= 200 && v.every((i) => short(i, 80));
  return !!p && typeof p === 'object' && short(p.at, 80) && ids(p.walk) && ids(p.skipped);
};

export const area: ModelArea = {
  messages: { 'setup-walk': (x) => isWalkPlace(x.place) },
};
