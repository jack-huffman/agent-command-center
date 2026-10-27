/**
 * Setup's step for the checks autopilot waits for (T-108): whether GitHub itself requires them before a
 * pull request merges into the default environment's branch. It only reads: the fix is the gh command a
 * person runs, since the Command Center never changes branch protection. Autopilot waits for the checks the
 * project names whatever GitHub requires, so a plan with no protection skips the step rather than failing.
 */
import { defaultEnvironment } from '../config.ts';
import { quotedChecks } from '../checks.ts';
import { shellLine } from '../shell.ts';
import { requiredChecks, type RequiredChecks } from '../protection.ts';
import { cached, fail, ghEnv, pass, skip, unknown } from './helpers.ts';
import type { Step } from './types.ts';

/**
 * The gh command that makes GitHub require the checks on a branch, as the repo's account: added to the
 * required checks where protection requires some, else protection that requires only them. Empty where
 * protection is on without required checks: replacing it would drop its other rules, so a person adds them.
 */
export function requireChecksFix(repo: string, account: string, branch: string, checks: readonly string[], found: Pick<RequiredChecks, 'protection' | 'statusChecks'>): string {
  const gh = (...args: string[]) => `GH_TOKEN="$(${shellLine('gh', ['auth', 'token', '-u', account])})" ${shellLine('gh', ['api', ...args])}`;
  const path = `repos/${repo}/branches/${encodeURIComponent(branch)}/protection`;
  if (found.protection === 'branch' && found.statusChecks) return gh('-X', 'POST', `${path}/required_status_checks/contexts`, ...checks.flatMap((c) => ['-f', `contexts[]=${c}`]));
  if (found.protection === 'branch') return '';
  return gh('-X', 'PUT', path, '-F', 'required_status_checks[strict]=false', ...checks.flatMap((c) => ['-f', `required_status_checks[contexts][]=${c}`]), '-F', 'enforce_admins=false', '-F', 'required_pull_request_reviews=null', '-F', 'restrictions=null');
}

export const CI_STEPS: Step[] = [
  {
    id: 'B10.required-check', part: 'project', group: 'B10', title: 'GitHub requires the checks autopilot waits for',
    why: 'Autopilot merges a pull request only once the checks the project names pass on GitHub. When GitHub requires them too, a person merging on GitHub waits for them as well. The Command Center never changes this setting: the fix is a command you run.',
    fix: { fromCheck: true },
    check(ctx) {
      if (!ctx.paths) return skip('Not inside a repo.');
      if (!ctx.config) return skip('Needs a valid .acc/config.json first (step B0).');
      const gh = ctx.config.github;
      if (!gh) return skip('The project has no GitHub repo.');
      if (!gh.checks?.length) return skip('The project\'s settings name no GitHub checks for autopilot to wait for.');
      const env = ghEnv(ctx);
      if (!env) return unknown(`gh isn't signed in as ${gh.account}, so whether GitHub requires ${quotedChecks(gh.checks)} isn't known.`);
      const branch = defaultEnvironment(ctx.config).branch;
      const found = cached(ctx, `required-checks ${gh.repo} ${branch}`, () => requiredChecks(ctx.run, gh.repo, branch, env));
      if (found.state === 'unavailable') return skip(`${found.why} Autopilot still waits for ${quotedChecks(gh.checks)} itself before it merges.`);
      if (found.state === 'unknown') return unknown(found.why);
      const missing = gh.checks.filter((c) => !found.checks.includes(c));
      if (!missing.length) return pass(`GitHub requires ${quotedChecks(gh.checks)} before a pull request merges into ${branch}.`);
      const fix = requireChecksFix(gh.repo, gh.account, branch, missing, found);
      const what = `GitHub doesn't require ${quotedChecks(missing)} before a pull request merges into ${branch}.`;
      return fix ? fail(`${what} Autopilot waits for ${missing.length === 1 ? 'it' : 'them'} all the same; a person merging doesn't have to.`, fix)
        : fail(`${what} ${branch}'s protection requires no checks yet: on GitHub, in the repo's Settings, Branches, edit ${branch}'s rule, tick Require status checks to pass, and add ${missing.join(', ')}.`);
    },
  },
];
