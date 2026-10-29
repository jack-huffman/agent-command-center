/**
 * Setup's steps for cloud builders (GH-69): what a project that opted in still needs before a task can go
 * to the cloud, each with its check and its guide. A project that hasn't opted in skips them all: the
 * cloud is never the default, and nothing here nags about it. Each step's Do it opens Set up cloud builders
 * (T-145), whose step names and buttons are named here, so its guide says what the modal's buttons say.
 */
import { claudeLogin, cloudTokenHome, readCloudToken, WINDOWS_TOKEN_FIX } from '../cloud.ts';
import { guardCommitted } from '../cloud-guard.ts';
import { fail, pass, skip, unknown } from './helpers.ts';
import type { CheckContext, CheckResult, Step } from './types.ts';

/** The scheduled task's own instructions, which a person pastes in when they make it: they opt in to the fire's text. */
export const ROUTINE_PROMPT = [
  'You are a builder for Agent Command Center (acc). Each run\'s task is in the routine-fire-payload block below: acc fired this routine to build one task.',
  'Do exactly what the payload says, as the builder it names, on the branch it names, and nothing else. Push only that branch. Never push any other branch, force-push, merge or open a pull request, or deploy.',
  'If there is no payload, do nothing and stop.',
].join(' ');

/** Set up cloud builders (T-145): the modal's title, the VS Code command that opens it, and its steps' names, in order. */
export const CLOUD_SETUP = { title: 'Set up cloud builders', command: 'acc.cloud.setup' } as const;
export const CLOUD_SETUP_STEPS = { on: 'Turn on', github: 'GitHub access', task: 'The scheduled task', token: 'The token', signin: 'Sign in', guard: 'The push guard', ready: 'Ready' } as const;
export type CloudSetupStep = keyof typeof CLOUD_SETUP_STEPS;

/** The modal's buttons and fields (T-145), by what they do: the guides name them by these words. */
export const CLOUD_BUTTONS = {
  turnOn: 'Turn on', install: 'Install the app', copy: 'Copy the prompt', open: 'Open claude.ai', triggerId: 'Trigger id', keepId: 'Keep the id',
  token: 'Token', keepToken: 'Keep the token', doIt: 'Do it', push: 'Push…', check: 'Check again',
} as const;

/** What Sign in's Do it runs in a terminal (T-145): Claude Code's own sign-in, the same line on a Mac and on Windows. */
export const CLAUDE_SIGN_IN = 'claude auth login';

/** Where Install the app goes: the Claude GitHub App's page to install it on a repo. */
export const GITHUB_APP = 'https://github.com/apps/claude/installations/new';

/** Which of the modal's steps each of Setup's cloud steps is: Do it opens the modal, which opens on the first step not done. */
export const CLOUD_STEP_OF: Record<string, CloudSetupStep> = {
  'B15.cloud-github-app': 'github', 'B15.cloud-routine': 'task', 'B15.cloud-token': 'token', 'B15.cloud-login': 'signin', 'B15.cloud-guard': 'guard',
};

/**
 * A guide's line: Do it opens Set up cloud builders, which opens on its first step not done (not on this one),
 * then which step this is done in, and what to do there.
 */
const inModal = (step: CloudSetupStep, what: string): string => `Do it opens ${CLOUD_SETUP.title}; in ${CLOUD_SETUP_STEPS[step]}: ${what}`;

function optedIn(ctx: CheckContext): CheckResult | null {
  if (!ctx.paths) return skip('Not inside a repo.');
  if (!ctx.config) return skip('Needs a valid .acc/config.json first (step B0).');
  if (!ctx.config.github) return skip('Cloud builders need the repo on GitHub.');
  if (!ctx.config.agents.cloud) return skip('Cloud builders are off for this project: acc cloud enable opts in.');
  return null;
}

const B = CLOUD_BUTTONS;

export const CLOUD_STEPS: Step[] = [
  {
    id: 'B15.cloud-github-app', part: 'project', group: 'B15', title: 'Claude can clone the repo from the cloud',
    why: 'A cloud session clones the repo from GitHub and pushes its branch back, through the GitHub access connected to your claude.ai account: the Claude GitHub App on the repo, or /web-setup in a terminal (GH-69).',
    fix: { vscode: CLOUD_SETUP.command, text: inModal('github', `${B.install} opens the Claude GitHub App, to add this repo. Or run /web-setup in a claude session, which the Command Center can't see: then tick I've done this.`), confirm: true, docs: 'https://code.claude.com/docs/en/claude-code-on-the-web#github-authentication-options' },
    check(ctx) {
      const need = optedIn(ctx);
      if (need) return need;
      const repo = ctx.config!.github!.repo;
      const list = ctx.run('gh', ['api', 'user/installations', '--jq', '.installations[] | select(.app_slug == "claude") | [.id, .repository_selection] | @tsv'], { env: ctx.env, timeoutMs: 30_000 });
      if (list.code !== 0) return unknown(`gh couldn't list the apps installed for you: ${(list.stderr || list.stdout).trim().split('\n')[0]}. If you connected with /web-setup, that's fine: tick this yourself.`);
      const installs = list.stdout.trim().split('\n').filter(Boolean).map((l) => l.split('\t') as [string, string]);
      if (!installs.length) return unknown(`The Claude GitHub App isn't installed on any account you can see. Install it, or if you connected with /web-setup, tick this yourself.`);
      for (const [id, selection] of installs) {
        if (selection === 'all') return pass('The Claude GitHub App is installed, on every repo of its account.');
        const repos = ctx.run('gh', ['api', `user/installations/${id}/repositories?per_page=100`, '--jq', '.repositories[].full_name'], { env: ctx.env, timeoutMs: 30_000 });
        if (repos.code === 0 && repos.stdout.split('\n').map((l) => l.trim().toLowerCase()).includes(repo.toLowerCase())) return pass(`The Claude GitHub App is installed on ${repo}.`);
      }
      return unknown(`The Claude GitHub App is installed, but not on ${repo} as far as gh can see. Add the repo to it, or if you connected with /web-setup, tick this yourself.`);
    },
  },
  {
    id: 'B15.cloud-routine', part: 'project', group: 'B15', title: 'A scheduled task for the repo',
    why: 'A script starts a cloud session only by firing a scheduled task\'s API trigger (formerly a routine, GH-69). The scheduled task holds the repo, the model and the environment; the Command Center sends each task in the fire\'s text.',
    fix: { vscode: CLOUD_SETUP.command, text: inModal('task', `${B.copy}, then ${B.open}. There, paste it as a new scheduled task's instructions, pick this repo and a model, and add an API trigger. Paste its trigger id (trig_…) and click ${B.keepId}.`), docs: 'https://code.claude.com/docs/en/routines' },
    check(ctx) {
      const need = optedIn(ctx);
      if (need) return need;
      const routine = ctx.config!.agents.cloud!.routine;
      return routine ? pass(`Scheduled task ${routine}.`) : fail('No trigger id in .acc/config.json (agents.cloud.routine).');
    },
  },
  {
    id: 'B15.cloud-token', part: 'project', group: 'B15', title: 'The scheduled task\'s token is kept',
    why: 'The Command Center fires the scheduled task with its bearer token, never kept in .acc/config.json or git (GH-69): a Mac keeps it in its keychain, and Windows in VS Code, which hands it to acc when the Command Center builds or reviews (T-145). The token is shown once, on the scheduled task\'s page.',
    fix: { vscode: CLOUD_SETUP.command, text: inModal('token', `on the scheduled task's page, click Generate token (it's shown once), paste it in ${B.token}, and click ${B.keepToken}.`), docs: 'https://code.claude.com/docs/en/routines#add-an-api-trigger' },
    check(ctx) {
      const need = optedIn(ctx);
      if (need) return need;
      const repo = ctx.config!.github!.repo;
      if (readCloudToken(ctx.run, repo, ctx.env, ctx.platform)) return pass(cloudTokenHome(ctx.platform) === 'vscode' ? 'The Command Center keeps the token, and handed it over.' : 'The token is in the keychain.');
      // On Windows only the Command Center can see the token, and hands it over when it runs this (T-145).
      return fail(cloudTokenHome(ctx.platform) === 'vscode' ? `No token for ${repo} was handed over. ${WINDOWS_TOKEN_FIX}` : `No token for ${repo} in the keychain.`);
    },
  },
  {
    id: 'B15.cloud-login', part: 'project', group: 'B15', title: 'Claude Code is signed in to claude.ai',
    why: 'Sending a cloud builder a message (claude -p --cloud) needs the CLI signed in to the claude.ai account the scheduled task belongs to (GH-69).',
    fix: { vscode: CLOUD_SETUP.command, text: inModal('signin', `${B.doIt} runs Claude Code's sign-in in a terminal. Sign in with the claude.ai account that owns the scheduled task: an API key isn't enough for cloud sessions.`) },
    check(ctx) {
      const need = optedIn(ctx);
      if (need) return need;
      const login = claudeLogin(ctx.run, ctx.env);
      return login.ok ? pass(`Signed in to claude.ai${login.email ? ` as ${login.email}` : ''}.`) : fail(login.why);
    },
  },
  {
    id: 'B15.cloud-guard', part: 'project', group: 'B15', title: 'The push guard is committed',
    why: 'A cloud session runs the repo\'s own .claude/settings.json hooks and not the Command Center\'s plugin, so the guard that refuses a push to any branch but the task\'s, and the git pre-push hook it installs in the clone to check the push itself, are scripts the repo carries, and only what\'s committed reaches the cloud (GH-69).',
    fix: { vscode: CLOUD_SETUP.command, text: inModal('guard', `${B.doIt} commits the guard's three files on the branch the cloud clones, and ${B.push} pushes that branch once you say so.`) },
    check(ctx) {
      const need = optedIn(ctx);
      if (need) return need;
      // The commit's tree, not the files on disk: a guard written and not committed never reaches the cloud.
      const committed = guardCommitted(ctx.run, ctx.paths!.root, 'HEAD');
      return committed.ok ? pass('The push guard, its pre-push hook and their settings are committed on HEAD.') : fail(committed.why ?? 'The push guard isn\'t committed.');
    },
  },
];
