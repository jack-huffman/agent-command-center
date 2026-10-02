/**
 * Which GitHub account a repo works as (D-007, D-028). The project names one in .acc/config.json; a clone
 * can choose its own in git config (acc.githubAccount), which is never committed and is shared by every
 * worktree. git's credential helper reads the same setting, so a push always follows the choice.
 */
import type { Config } from './config.ts';
import { AccError, type Runner } from './exec.ts';

export const CLONE_ACCOUNT_KEY = 'acc.githubAccount';

/** The credential helper acc sets: it asks gh for the token of whichever account this clone uses right now. */
export const credentialHelper = (fallback: string): string =>
  `!f() { test "$1" = get || exit 0; a=$(git config --get ${CLONE_ACCOUNT_KEY} || echo ${fallback}); echo username=$a; echo "password=$(gh auth token -u $a)"; }; f`;

const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/** This clone's own choice of account, if it made one. */
export function cloneAccount(run: Runner, root: string): string | null {
  const r = run('git', ['config', '--get', CLONE_ACCOUNT_KEY], { cwd: root });
  const v = r.stdout.trim();
  return r.code === 0 && LOGIN.test(v) ? v : null;
}

/** The config with this clone's account in place of the project's, so every gh call and check uses it. */
export function withCloneAccount(config: Config, root: string, run: Runner): Config {
  if (!config.github) return config;
  const mine = cloneAccount(run, root);
  return mine && mine !== config.github.account ? { ...config, github: { ...config.github, account: mine } } : config;
}

export interface GhAccount {
  login: string;
  active: boolean;
  scopes: string[];
}

/** The accounts gh is logged in to on github.com, from `gh auth status`. */
export function parseGhStatus(text: string): GhAccount[] {
  const out: GhAccount[] = [];
  for (const block of text.split(/(?=Logged in to )/)) {
    const m = /^Logged in to github\.com account (\S+)/.exec(block);
    if (!m) continue;
    const scopes = /Token scopes: (.*)/.exec(block)?.[1] ?? '';
    out.push({ login: m[1]!, active: /Active account: true/.test(block), scopes: [...scopes.matchAll(/'([^']+)'/g)].map((s) => s[1]!) });
  }
  return out;
}

export function ghAccounts(run: Runner, env: NodeJS.ProcessEnv = process.env): GhAccount[] | null {
  const r = run('gh', ['auth', 'status', '--hostname', 'github.com'], { env });
  if (r.code === 127) return null;
  return parseGhStatus(r.stdout + r.stderr);
}

/** What git's credential helpers say about pushing: following the clone's choice, pinned to one account, or neither. */
export function pushSetup(run: Runner, root: string): { kind: 'follows' | 'pinned' | 'other' | 'none'; account: string | null } {
  const r = run('git', ['config', '--get-all', 'credential.helper'], { cwd: root });
  const helpers = r.code === 0 ? r.stdout.split('\n').filter((l) => l.trim()) : [];
  if (helpers.some((h) => h.includes(CLONE_ACCOUNT_KEY))) return { kind: 'follows', account: null };
  const pinned = helpers.map((h) => /gh auth token -u ([A-Za-z0-9-]+)/.exec(h)?.[1]).find(Boolean);
  if (pinned) return { kind: 'pinned', account: pinned };
  return { kind: helpers.length ? 'other' : 'none', account: null };
}

export interface GithubIdentity {
  repo: string;
  /** The account this clone works as. */
  account: string;
  /** Where that comes from: this clone's own choice, or the project's config. */
  from: 'clone' | 'config';
  projectAccount: string;
  /** Whether gh is logged in as the account. */
  signedIn: boolean;
  /** Every account gh is logged in to, with its scopes. Null when gh isn't installed. */
  accounts: GhAccount[] | null;
  commit: { name: string | null; email: string | null };
  /** The account git push would use. */
  pushesAs: string | null;
  push: ReturnType<typeof pushSetup>['kind'];
}

export function githubIdentity(config: Config, root: string, run: Runner, env: NodeJS.ProcessEnv = process.env): GithubIdentity | null {
  if (!config.github) return null;
  const mine = cloneAccount(run, root);
  const account = mine ?? config.github.account;
  const accounts = ghAccounts(run, env);
  const git = (k: string) => {
    const r = run('git', ['config', '--get', k], { cwd: root });
    return r.code === 0 ? r.stdout.trim() || null : null;
  };
  const push = pushSetup(run, root);
  return {
    repo: config.github.repo, account, from: mine && mine !== config.github.account ? 'clone' : 'config', projectAccount: config.github.account,
    signedIn: !!accounts?.some((a) => a.login.toLowerCase() === account.toLowerCase()),
    accounts, commit: { name: git('user.name'), email: git('user.email') },
    pushesAs: push.kind === 'follows' ? account : push.account, push: push.kind,
  };
}

/**
 * Makes this clone work as an account: its own choice in git config, or back to the project's with null.
 * The credential helper is set to follow that choice, so git push matches. Nothing committed changes.
 */
export function useGithubAccount(config: Config, root: string, run: Runner, account: string | null, env: NodeJS.ProcessEnv = process.env): GithubIdentity {
  if (!config.github) throw new AccError('no-github', 'This project has no "github" section in .acc/config.json.');
  const want = account ?? config.github.account;
  if (!LOGIN.test(want)) throw new AccError('usage', `${want} isn't a GitHub login.`);
  const accounts = ghAccounts(run, env);
  if (accounts && !accounts.some((a) => a.login.toLowerCase() === want.toLowerCase())) {
    throw new AccError('not-signed-in', `gh isn't logged in as ${want}. Sign in first: in VSCode, "Sign in to GitHub as this repo's account"; in a terminal, gh auth login.`);
  }
  const git = (...args: string[]) => run('git', args, { cwd: root });
  if (want === config.github.account) git('config', '--unset', CLONE_ACCOUNT_KEY);
  else if (git('config', CLONE_ACCOUNT_KEY, want).code !== 0) throw new AccError('git', `Couldn't record ${want} in this clone's git config.`);
  // The helper reads the choice each time, so this only rewrites it if it doesn't already.
  if (pushSetup(run, root).kind !== 'follows') {
    git('config', '--unset-all', 'credential.helper');
    git('config', 'credential.helper', '');
    git('config', '--add', 'credential.helper', credentialHelper(config.github.account));
  }
  return githubIdentity(config, root, run, env)!;
}
