/**
 * Set up cloud builders (T-145): one stepped modal that walks a person through everything a project needs
 * before a task can go to the cloud, on a Mac or on Windows. Each step does one thing, says it in one line,
 * shows its live check as an icon and a label (blue done, orange needs you), and folds its detail away.
 * Next is off, with why, until a step that must pass has. Plain data, posted to the webview and rendered
 * there with text only. No vscode import, so it's testable.
 */

import { CLOUD_TOKEN, cloudTokenHome } from '../../../packages/core/src/cloud.ts';
import type { GuardPlace } from '../../../packages/core/src/cloud-guard-place.ts';
import { ROUTINE_ID } from '../../../packages/core/src/config.ts';
import { CLOUD_BUTTONS as B, CLOUD_SETUP, CLOUD_SETUP_STEPS, type CloudSetupStep, GITHUB_APP } from '../../../packages/core/src/onboarding/cloud-steps.ts';
import { type Look, LOOK, type ModelArea, short } from './shared.ts';

export type { CloudSetupStep } from '../../../packages/core/src/onboarding/cloud-steps.ts';

/** The steps in order: the modal opens on the first one not done. */
export const CLOUD_SETUP_ORDER = Object.keys(CLOUD_SETUP_STEPS) as CloudSetupStep[];

/** The steps whose check must pass before Next goes on. GitHub access can be connected where the Command Center can't see it (/web-setup), so it never holds Next. */
export const MUST_PASS: readonly CloudSetupStep[] = ['on', 'task', 'token', 'signin', 'guard'];

/** A step's check as the extension last read it. loading: not read yet; unknown: it can't be read here, with why. */
export interface CloudCheck {
  status: 'loading' | 'pass' | 'fail' | 'unknown';
  detail: string;
}

/** What a step's own button does. Each goes to the extension, which alone runs it. */
export const CLOUD_ACTIONS = ['turnOn', 'install', 'confirm', 'copy', 'open', 'keepId', 'keepToken', 'signin', 'commit', 'push', 'check'] as const;
export type CloudAction = (typeof CLOUD_ACTIONS)[number];

/**
 * The modal while it's open, as the extension keeps it. It never holds the token: that's typed in its hidden
 * field and sent once, with Keep the token, straight to the keychain or VS Code's secret storage.
 */
export interface CloudSetupState {
  id: string;
  /** Goes up with every change. */
  rev: number;
  root: string;
  project: string;
  /** The project's GitHub repo, or null when its settings name none. */
  repo: string | null;
  platform: NodeJS.Platform;
  step: CloudSetupStep;
  /** The person moved between steps: a check read later no longer moves them to the first step not done. */
  moved: boolean;
  on: boolean;
  routine: string | null;
  github: CloudCheck;
  /** GitHub access ticked by hand, as Setup's I've done this keeps it. */
  githubConfirmed: boolean;
  token: CloudCheck;
  signin: CloudCheck;
  guard: CloudCheck;
  /** Where the guard stands on the branch the cloud clones, once read. */
  place: GuardPlace | null;
  /** The button whose work is under way, and the last one's error, shown on its step. */
  busy: CloudAction | null;
  error: { step: CloudSetupStep; text: string } | null;
  /** Copy the prompt was clicked: its button says so. */
  copied: boolean;
}

/** A button on a step. disabled: why it's off, in words; null when it's on. */
export interface CloudButton {
  action: CloudAction;
  label: string;
  icon: string;
  primary: boolean;
  disabled: string | null;
  busy: boolean;
}

/** The field a step types into: its label, what it holds, and the pattern it's checked against as it's typed. */
export interface CloudField {
  key: 'routine' | 'token';
  label: string;
  value: string;
  secret: boolean;
  placeholder: string;
  /** The pattern's source, which the page checks each keystroke against, and what it says when it doesn't match. */
  pattern: string;
  problem: string;
  /** The button that keeps what's typed. */
  keep: CloudButton;
}

/** What one step shows: one line of what to do, its check, its buttons, and its detail folded away. */
export interface CloudStepView {
  line: string;
  look: Look;
  buttons: CloudButton[];
  /** The scheduled task's three short numbered lines. Empty elsewhere. */
  numbered: string[];
  field: CloudField | null;
  /** Ready's summary: each step and where it stands. Empty elsewhere. */
  facts: { label: string; look: Look }[];
  error: string | null;
  fold: { summary: string; lines: string[]; links: { label: string; url: string }[] };
}

export interface CloudSetupModel {
  id: string;
  rev: number;
  title: string;
  project: string;
  step: CloudSetupStep;
  steps: { id: CloudSetupStep; title: string; state: 'current' | 'done' | 'todo'; look: Look; can: boolean; why: string | null }[];
  view: CloudStepView;
  /** Next, with why it's off; null on Ready, whose foot has Done. */
  next: { can: boolean; why: Look | null } | null;
  cancel: { can: boolean; why: string | null };
}

const DOCS_ROUTINES = 'https://code.claude.com/docs/en/routines';
const DOCS_GITHUB = 'https://code.claude.com/docs/en/claude-code-on-the-web#github-authentication-options';

/** Whether a check has passed; GitHub access also when ticked by hand. */
export function stepDone(s: CloudSetupState, step: CloudSetupStep): boolean {
  switch (step) {
    case 'on': return s.on;
    case 'github': return s.github.status === 'pass' || s.githubConfirmed;
    case 'task': return !!s.routine;
    case 'token': return s.token.status === 'pass';
    case 'signin': return s.signin.status === 'pass';
    case 'guard': return s.guard.status === 'pass';
    case 'ready': return MUST_PASS.every((x) => stepDone(s, x));
  }
}

/** The first step not done, where the modal opens, so a person can stop and come back: Ready once every one is. */
export function firstNotDone(s: CloudSetupState): CloudSetupStep {
  return CLOUD_SETUP_ORDER.find((x) => x !== 'ready' && !stepDone(s, x)) ?? 'ready';
}

/** Why Next is off on a step that must pass and hasn't, in words; null when it can go on. */
export function nextWhy(s: CloudSetupState, step: CloudSetupStep): string | null {
  if (!MUST_PASS.includes(step) || stepDone(s, step)) return null;
  const check = step === 'token' ? s.token : step === 'signin' ? s.signin : step === 'guard' ? s.guard : null;
  if (check?.status === 'loading') return 'Checking…';
  switch (step) {
    case 'on': return s.repo ? `Click ${B.turnOn} first: nothing is written until you do` : 'The project\'s settings name no GitHub repo, and the cloud clones from GitHub';
    case 'task': return `Paste the trigger id and click ${B.keepId} first`;
    case 'token': return `Paste the token and click ${B.keepToken} first`;
    case 'signin': return 'Sign in first: the check says when it\'s done';
    default: return s.place?.local.ok ? `Click ${B.push} first: the cloud clones what's on GitHub` : `Commit the push guard first: ${B.doIt} does it`;
  }
}

/** Whether a step can be gone to: every step before it that must pass has. */
export const canReach = (s: CloudSetupState, step: CloudSetupStep): boolean =>
  CLOUD_SETUP_ORDER.slice(0, CLOUD_SETUP_ORDER.indexOf(step)).every((x) => !MUST_PASS.includes(x) || stepDone(s, x));

/** A check's look: blue for done, orange for needs you, a quiet spinner while it's read. */
function checkLook(c: CloudCheck, done: string): Look {
  if (c.status === 'loading') return LOOK('Checking…', 'loading~spin', 'neutral');
  if (c.status === 'pass') return LOOK(c.detail || done, 'pass', 'blue');
  if (c.status === 'unknown') return LOOK(c.detail, 'question', 'orange');
  return LOOK(c.detail, 'warning', 'orange');
}

/** Each step's look in the step bar and on its page. */
export function stepLook(s: CloudSetupState, step: CloudSetupStep): Look {
  switch (step) {
    case 'on': return s.on ? LOOK('On', 'pass', 'blue') : s.repo ? LOOK('Off', 'circle-large-outline', 'orange') : LOOK('Needs the repo on GitHub', 'warning', 'orange');
    case 'github': return s.githubConfirmed && s.github.status !== 'pass' ? LOOK('Ticked by you', 'pass', 'blue') : checkLook(s.github, 'Installed');
    case 'task': return s.routine ? LOOK(`Kept: ${s.routine}`, 'pass', 'blue') : LOOK('No trigger id yet', 'circle-large-outline', 'orange');
    case 'token': return checkLook(s.token, 'Kept');
    case 'signin': return checkLook(s.signin, 'Signed in');
    case 'guard': return checkLook(s.guard, 'Committed and on GitHub');
    case 'ready': return stepDone(s, 'ready') ? LOOK('Ready', 'pass', 'blue') : LOOK('Not yet', 'circle-large-outline', 'neutral');
  }
}

/** The pattern a trigger id is checked against as it's typed, and what it says when it doesn't match. */
export const TRIGGER_PROBLEM = 'A trigger id looks like trig_01ABC…';
export const TOKEN_PROBLEM = 'A token is letters, digits, dashes and underscores, 20 or more';

/** What's wrong with a trigger id or a token as typed, or null when it's fine. Empty is said, not passed. */
export const triggerIdProblem = (v: string): string | null => (ROUTINE_ID.test(v.trim()) ? null : TRIGGER_PROBLEM);
export const tokenProblem = (v: string): string | null => (CLOUD_TOKEN.test(v.trim()) ? null : TOKEN_PROBLEM);

/** Each system's own words (D-209): its terminal, and where it keeps the token. */
export function systemWords(platform: NodeJS.Platform): { terminal: string; kept: string; keptLong: string } {
  return cloudTokenHome(platform) === 'vscode'
    ? { terminal: 'PowerShell', kept: 'VS Code on this machine', keptLong: 'VS Code\'s secret storage on this machine. The Command Center hands it over whenever it builds or reviews; a terminal has no way to read it.' }
    : { terminal: 'Terminal', kept: 'this Mac\'s keychain', keptLong: 'This Mac\'s keychain, for this repo. A dispatch typed in a terminal finds it there too.' };
}

function view(s: CloudSetupState): CloudStepView {
  const button = (action: CloudAction, label: string, icon: string, primary = false, disabled: string | null = null): CloudButton => ({
    action, label, icon, primary, busy: s.busy === action,
    // One button's work at a time: the rest wait, and say why.
    disabled: disabled ?? (s.busy && s.busy !== action ? 'Wait for the step under way to finish' : null),
  });
  const look = stepLook(s, s.step);
  const error = s.error?.step === s.step ? s.error.text : null;
  const repo = s.repo ?? 'this repo';
  const words = systemWords(s.platform);
  const check = button('check', B.check, 'refresh');
  const base: CloudStepView = { line: '', look, buttons: [], numbered: [], field: null, facts: [], error, fold: { summary: '', lines: [], links: [] } };
  switch (s.step) {
    case 'on': return {
      ...base,
      line: 'A cloud builder is a Claude Code session on claude.ai that builds one task and pushes its branch.',
      buttons: [button('turnOn', B.turnOn, 'cloud', !s.on, s.on ? 'Cloud builders are on already' : s.repo ? null : 'The project\'s settings name no GitHub repo')],
      fold: {
        summary: 'What it costs, and what it writes',
        lines: [
          'It counts toward your claude.ai plan\'s usage, with no separate charge.',
          'The scheduled task belongs to the claude.ai account that makes it.',
          `${B.turnOn} writes the project's settings and the push guard's files, and commits nothing.`,
          'A local builder stays the default: each task picks Cloud in its Build it sheet.',
        ],
        links: [],
      },
    };
    case 'github': return {
      ...base,
      line: `Install the Claude GitHub App on ${repo}.`,
      buttons: [
        button('install', B.install, 'link-external', s.github.status !== 'pass'),
        check,
        // Only where the check can't see it (/web-setup): a person says they've done it.
        ...(s.github.status === 'unknown' && !s.githubConfirmed ? [button('confirm', 'I\'ve done this', 'check')] : []),
      ],
      fold: {
        summary: 'Or connect GitHub with /web-setup',
        lines: ['In a terminal, start claude and type /web-setup: it gives your claude.ai account the GitHub CLI\'s sign-in.', 'The Command Center can\'t see that way, so tick I\'ve done this.'],
        links: [{ label: 'Claude Code docs: GitHub access', url: DOCS_GITHUB }],
      },
    };
    case 'task': return {
      ...base,
      line: `Make a scheduled task on claude.ai that builds ${repo}'s tasks.`,
      buttons: [button('copy', s.copied ? 'Copied' : B.copy, s.copied ? 'check' : 'clippy', false), button('open', B.open, 'link-external')],
      numbered: ['Paste the prompt as its instructions.', `Pick ${repo} and a model.`, 'Add an API trigger, and copy its id.'],
      field: { key: 'routine', label: B.triggerId, value: s.routine ?? '', secret: false, placeholder: 'trig_01…', pattern: ROUTINE_ID.source, problem: TRIGGER_PROBLEM, keep: button('keepId', B.keepId, 'save', !s.routine) },
      fold: {
        summary: 'About scheduled tasks',
        lines: ['claude.ai calls them scheduled tasks; they used to be called routines.', 'Keep its Default environment: it reaches npm and GitHub, and no org.', 'The Command Center sends each task in the trigger\'s text.'],
        links: [{ label: 'Claude Code docs: scheduled tasks', url: DOCS_ROUTINES }],
      },
    };
    case 'token': return {
      ...base,
      line: 'On the scheduled task\'s page, click Generate token, and paste it here.',
      field: { key: 'token', label: B.token, value: '', secret: true, placeholder: 'Shown once on claude.ai', pattern: CLOUD_TOKEN.source, problem: TOKEN_PROBLEM, keep: button('keepToken', B.keepToken, 'key', s.token.status !== 'pass') },
      buttons: [],
      fold: {
        summary: `Where it's kept: ${words.kept}`,
        lines: [words.keptLong, 'Never in the project\'s settings, a file or git.', 'claude.ai shows it once: generate a new one if it\'s lost.'],
        links: [{ label: 'Claude Code docs: the API trigger', url: `${DOCS_ROUTINES}#add-an-api-trigger` }],
      },
    };
    case 'signin': return {
      ...base,
      line: 'Sign Claude Code in to the claude.ai account that owns the scheduled task.',
      buttons: [button('signin', B.doIt, 'terminal', s.signin.status !== 'pass'), check],
      fold: {
        summary: 'What Do it runs',
        lines: [`${B.doIt} opens ${words.terminal} and runs Claude Code's sign-in there, so you see each step.`, 'An API key isn\'t enough: cloud sessions need a claude.ai account.'],
        links: [],
      },
    };
    case 'guard': {
      const p = s.place;
      const branch = p?.base ?? 'the branch the cloud clones';
      const wrongBranch = p && !p.local.ok && p.checkedOut !== p.base ? `This folder has ${p.checkedOut ?? 'no branch'} checked out: switch it to ${p.base} first` : null;
      const buttons = !p?.local.ok
        ? [button('commit', B.doIt, 'git-commit', true, wrongBranch ?? (p ? null : 'Checking…'))]
        : !p.pushed.ok || p.ahead ? [button('push', B.push, 'cloud-upload', true)] : [];
      return {
        ...base,
        line: `Commit the push guard on ${branch}, the branch the cloud clones, and push it.`,
        buttons: [...buttons, check],
        fold: {
          summary: 'What the push guard is',
          lines: [
            'A hook the cloud session runs: it refuses a push to any branch but the task\'s.',
            `${B.doIt} commits its three files only: .claude/hooks/acc-push-guard.mjs, .claude/hooks/acc-pre-push and .claude/settings.json.`,
            `${B.push} asks before it pushes ${branch}.`,
          ],
          links: [],
        },
      };
    }
    case 'ready': return {
      ...base,
      line: stepDone(s, 'ready') ? 'To send a task to the cloud: Build it, then pick Cloud.' : 'A step before this one still needs you.',
      facts: CLOUD_SETUP_ORDER.filter((x) => x !== 'ready').map((x) => ({ label: CLOUD_SETUP_STEPS[x], look: stepLook(s, x) })),
      fold: { summary: 'Where builders go by default', lines: ['A local builder stays the default. Settings\' Default… changes it, and Reviews… where reviews run.'], links: [] },
    };
  }
}

/** The modal, drawn from what the extension holds. */
export function cloudSetupModel(s: CloudSetupState): CloudSetupModel {
  const at = CLOUD_SETUP_ORDER.indexOf(s.step);
  const why = nextWhy(s, s.step);
  const steps = CLOUD_SETUP_ORDER.map((id, i) => {
    const can = canReach(s, id);
    return { id, title: CLOUD_SETUP_STEPS[id], state: i === at ? 'current' as const : stepDone(s, id) ? 'done' as const : 'todo' as const, look: stepLook(s, id), can, why: can ? null : 'Finish the steps before it first' };
  });
  return {
    id: s.id, rev: s.rev, title: CLOUD_SETUP.title, project: s.project, step: s.step, steps, view: view(s),
    next: s.step === 'ready' ? null : { can: !why, why: why ? LOOK(why, why === 'Checking…' ? 'loading~spin' : 'info', 'neutral') : null },
    // A button's work under way finishes: it's being written, so Cancel can't keep nothing then.
    cancel: { can: !s.busy, why: s.busy ? 'A step\'s work is under way: it finishes, then you can close this' : null },
  };
}

export type Message =
  /** Back, Next or a step in the step bar: the extension goes there only when it can be gone to. */
  | { type: 'cloud-setup-step'; session: string; step: CloudSetupStep }
  /** A step's own button; value is what its field holds, sent once (the token never comes back). */
  | { type: 'cloud-setup-act'; session: string; action: CloudAction; value?: string }
  | { type: 'cloud-setup-cancel'; session: string };

export type CloudSetupMessage = Message;

const session = (x: Record<string, unknown>): boolean => short(x.session, 64);

export const area: ModelArea = {
  messages: {
    'cloud-setup-step': (x) => session(x) && (CLOUD_SETUP_ORDER as unknown[]).includes(x.step),
    'cloud-setup-act': (x) => session(x) && (CLOUD_ACTIONS as readonly unknown[]).includes(x.action) && (x.value === undefined || (typeof x.value === 'string' && x.value.length <= 400)),
    'cloud-setup-cancel': session,
  },
  commands: [CLOUD_SETUP.command],
};
