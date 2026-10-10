/**
 * Setup's steps for cloud builders (GH-69): what a project that opted in still needs before a task can go
 * to the cloud, each with its check and its guide. A project that hasn't opted in skips them all: the
 * cloud is never the default, and nothing here nags about it.
 */
import { claudeLogin, readCloudToken, ROUTINES_URL } from '../cloud.ts';
import { guardCommitted } from '../cloud-guard.ts';
import { fail, pass, skip, unknown } from './helpers.ts';
import type { CheckContext, CheckResult, Step } from './types.ts';

/** The routine's own instructions, which a person pastes in when they make it: they opt in to the fire's text. */
export const ROUTINE_PROMPT = [
  'You are a builder for Agent Command Center (acc). Each run\'s task is in the routine-fire-payload block below: acc fired this routine to build one task.',
  'Do exactly what the payload says, as the builder it names, on the branch it names, and nothing else. Push only that branch. Never push any other branch, force-push, merge or open a pull request, or deploy.',
  'If there is no payload, do nothing and stop.',
].join(' ');

/** The guide every cloud step shares: how to make the routine, as the docs describe it. */
const ROUTINE_GUIDE = `At ${ROUTINES_URL}, make a routine for this repo: paste acc's routine prompt as its instructions (acc cloud shows it), pick the repo and the model, keep the Default environment (Trusted network access reaches npm and GitHub; no org), and add an API trigger. Save it and copy its trigger id (trig_…): acc cloud enable --routine <id> records it. Then click Generate token and copy the token once: acc cloud token keeps it in the keychain, pasted when it asks.`;

const GITHUB_APP = 'https://github.com/apps/claude';

function optedIn(ctx: CheckContext): CheckResult | null {
  if (!ctx.paths) return skip('Not inside a repo.');
  if (!ctx.config) return skip('Needs a valid .acc/config.json first (step B0).');
  if (!ctx.config.github) return skip('Cloud builders need the repo on GitHub.');
  if (!ctx.config.agents.cloud) return skip('Cloud builders are off for this project: acc cloud enable opts in.');
  return null;
}

export const CLOUD_STEPS: Step[] = [
  {
    id: 'B15.cloud-github-app', part: 'project', group: 'B15', title: 'Claude can clone the repo from the cloud',
    why: 'A cloud session clones the repo from GitHub and pushes its branch back, through the GitHub access connected to your claude.ai account: the Claude GitHub App on the repo, or /web-setup in a terminal (GH-69).',
    fix: { text: `Install the Claude GitHub App on the repo at ${GITHUB_APP}, or run /web-setup in a claude session, which sends gh's token to your claude.ai account. acc can see only the app.`, confirm: true, docs: 'https://code.claude.com/docs/en/claude-code-on-the-web#github-authentication-options' },
    check(ctx) {
      const need = optedIn(ctx);
      if (need) return need;
      const repo = ctx.config!.github!.repo;
      const list = ctx.run('gh', ['api', 'user/installations', '--jq', '.installations[] | select(.app_slug == "claude") | [.id, .repository_selection] | @tsv'], { env: ctx.env, timeoutMs: 30_000 });
      if (list.code !== 0) return unknown(`gh couldn't list the apps installed for you: ${(list.stderr || list.stdout).trim().split('\n')[0]}. If you connected with /web-setup, that's fine: tick this yourself.`);
      const installs = list.stdout.trim().split('\n').filter(Boolean).map((l) => l.split('\t') as [string, string]);
      if (!installs.length) return unknown(`The Claude GitHub App isn't installed on any account you can see. Install it at ${GITHUB_APP}, or if you connected with /web-setup, tick this yourself.`);
      for (const [id, selection] of installs) {
        if (selection === 'all') return pass('The Claude GitHub App is installed, on every repo of its account.');
        const repos = ctx.run('gh', ['api', `user/installations/${id}/repositories?per_page=100`, '--jq', '.repositories[].full_name'], { env: ctx.env, timeoutMs: 30_000 });
        if (repos.code === 0 && repos.stdout.split('\n').map((l) => l.trim().toLowerCase()).includes(repo.toLowerCase())) return pass(`The Claude GitHub App is installed on ${repo}.`);
      }
      return unknown(`The Claude GitHub App is installed, but not on ${repo} as far as gh can see. Add the repo to it at ${GITHUB_APP}, or if you connected with /web-setup, tick this yourself.`);
    },
  },
  {
    id: 'B15.cloud-routine', part: 'project', group: 'B15', title: 'A routine for the repo',
    why: 'A script starts a cloud session only by firing a routine\'s API trigger (GH-69). The routine holds the repo, the model and the environment; acc sends each task in the fire\'s text.',
    fix: { text: ROUTINE_GUIDE, docs: 'https://code.claude.com/docs/en/routines' },
    check(ctx) {
      const need = optedIn(ctx);
      if (need) return need;
      const routine = ctx.config!.agents.cloud!.routine;
      return routine ? pass(`Routine ${routine}.`) : fail('No routine id in .acc/config.json (agents.cloud.routine).');
    },
  },
  {
    id: 'B15.cloud-token', part: 'project', group: 'B15', title: 'The routine\'s token is in the keychain',
    why: 'acc fires the routine with its bearer token, kept in this Mac\'s keychain and never in .acc/config.json or git (GH-69). The token is shown once, on the routine\'s page.',
    fix: { text: 'On the routine\'s page, under its API trigger, click Generate token and copy it. Then, in a terminal, acc cloud token keeps it in the keychain under acc-cloud-routine, for this repo: paste the token when it asks.', docs: 'https://code.claude.com/docs/en/routines#add-an-api-trigger' },
    check(ctx) {
      const need = optedIn(ctx);
      if (need) return need;
      return readCloudToken(ctx.run, ctx.config!.github!.repo, ctx.env) ? pass('The routine\'s token is in the keychain.') : fail(`No token for ${ctx.config!.github!.repo} in the keychain.`);
    },
  },
  {
    id: 'B15.cloud-login', part: 'project', group: 'B15', title: 'Claude Code is signed in to claude.ai',
    why: 'Sending a cloud builder a message (claude -p --cloud) needs the CLI signed in to the claude.ai account the routine belongs to (GH-69).',
    fix: { command: 'claude auth login', text: 'Sign in with the claude.ai account that owns the routine. An API key isn\'t enough for cloud sessions.' },
    check(ctx) {
      const need = optedIn(ctx);
      if (need) return need;
      const login = claudeLogin(ctx.run, ctx.env);
      return login.ok ? pass(`Signed in to claude.ai${login.email ? ` as ${login.email}` : ''}.`) : fail(login.why, 'claude auth login');
    },
  },
  {
    id: 'B15.cloud-guard', part: 'project', group: 'B15', title: 'The push guard is committed',
    why: 'A cloud session runs the repo\'s own .claude/settings.json hooks and not acc\'s plugin, so the guard that refuses a push to any branch but the task\'s, and the git pre-push hook it installs in the clone to check the push itself, are scripts the repo carries, and only what\'s committed reaches the cloud (GH-69).',
    fix: { command: 'acc cloud enable', text: 'acc cloud enable writes .claude/hooks/acc-push-guard.mjs, .claude/hooks/acc-pre-push beside it, and their hooks into .claude/settings.json. Commit all three, and merge them into every branch a cloud session starts from.' },
    check(ctx) {
      const need = optedIn(ctx);
      if (need) return need;
      // The commit's tree, not the files on disk: a guard written and not committed never reaches the cloud.
      const committed = guardCommitted(ctx.run, ctx.paths!.root, 'HEAD');
      return committed.ok ? pass('The push guard, its pre-push hook and their settings are committed on HEAD.') : fail(committed.why ?? 'The push guard isn\'t committed.', 'acc cloud enable');
    },
  },
];
