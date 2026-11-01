/**
 * Join a team project (T-176): a teammate clones a project that is set up already, from its repo's address. acc
 * picks the GitHub account that can read the repo, clones with it, and pins the account and the commit identity
 * in that clone only (D-028, B2), never in the global git config. The clone is marked as joined, so Setup shows
 * only the steps that are each person's own and folds the project's own under "Set up by your team".
 */
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join as posixJoin, win32 } from 'node:path';
import { type Config, parseConfig } from './config.ts';
import { AccError, type Runner } from './exec.ts';
import { CLONE_ACCOUNT_KEY, credentialHelper, ghAccounts, JOINED_KEY } from './github.ts';
import type { TaskCommand } from './task-command.ts';

/**
 * The steps that are each person's own in a joined project: the commit identity, the GitHub account and git's
 * push, a login to each environment's org, the tracker sign-in, the plugin and the floors' merge driver. Every
 * other project step was done by whoever set the project up.
 */
export const OWN_STEPS: readonly string[] = ['A4.plugin', 'B2.identity', 'B2.account', 'B2.credentials', 'B6.org-match', 'B10.merge-floors', 'B14.tickets'];

/** The heading of the project's own steps in a joined project's Setup. */
export const TEAM_STEPS_TITLE = 'Set up by your team';

/** The command's name, as the Command Center and the share text say it. */
export const JOIN_TITLE = 'Join a team project';

/** A GitHub repo, as an address names it. */
export interface RepoAddress {
  owner: string;
  repo: string;
  /** owner/repo. */
  slug: string;
  /** The https address the clone is made from. */
  url: string;
}

const NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/**
 * A GitHub repo from its address: https://github.com/owner/repo (with .git, a trailing slash, or a page such as
 * /tree/main after it) or git@github.com:owner/repo.git. Null for anything else, such as another host.
 */
export function parseRepoAddress(text: string): RepoAddress | null {
  const t = text.trim();
  const m = /^https:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/#?].*)?$/i.exec(t)
    ?? /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i.exec(t);
  if (!m) return null;
  const [, owner, repo] = m as unknown as [string, string, string];
  if (!OWNER.test(owner) || !NAME.test(repo) || repo === '.' || repo === '..') return null;
  return { owner, repo, slug: `${owner}/${repo}`, url: `https://github.com/${owner}/${repo}.git` };
}

/** Why an address can't be joined, for an input box; null when it can. */
export const addressProblem = (text: string): string | null =>
  parseRepoAddress(text) ? null : 'A GitHub repo\'s address, such as https://github.com/acme/acme-salesforce';

/**
 * Where the clone goes unless the person says: the repo's name under their Documents folder. On Windows that is
 * This PC's Documents, in the user's profile folder; on a Mac, ~/Documents.
 */
export function defaultJoinDir(repo: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string {
  if (platform === 'win32') return win32.join(env.USERPROFILE || homedir(), 'Documents', repo);
  return posixJoin(env.HOME || homedir(), 'Documents', repo);
}

/** A helper that hands git one account's token, for the clone itself: nothing in any git config is read. */
export const pinnedHelper = (account: string): string =>
  `!f() { test "$1" = get || exit 0; echo username=${account}; echo "password=$(gh auth token -u ${account})"; }; f`;

/** gh's token for one account, or null; never shown. */
function tokenOf(run: Runner, account: string, env: NodeJS.ProcessEnv): string | null {
  const r = run('gh', ['auth', 'token', '-u', account, '--hostname', 'github.com'], { env });
  const t = r.stdout.trim();
  return r.code === 0 && t ? t : null;
}

/**
 * The accounts gh knows that can read the repo, in gh's order. Null when gh isn't installed. Each is asked with
 * its own token, so the active account never decides.
 */
export function joinReaders(run: Runner, address: RepoAddress, env: NodeJS.ProcessEnv = process.env): string[] | null {
  const accounts = ghAccounts(run, env);
  if (!accounts) return null;
  return accounts.map((a) => a.login).filter((login) => {
    const token = tokenOf(run, login, env);
    return !!token && run('gh', ['api', `repos/${address.slug}`, '--jq', '.full_name'], { env: { ...env, GH_TOKEN: token } }).code === 0;
  });
}

/** The commit identity a joined clone gets: the person's own, from their GitHub account, with GitHub's private email. */
export function accountIdentity(run: Runner, account: string, env: NodeJS.ProcessEnv = process.env): { name: string; email: string } {
  const token = tokenOf(run, account, env);
  const r = token ? run('gh', ['api', 'user'], { env: { ...env, GH_TOKEN: token } }) : null;
  let user: { id?: unknown; login?: unknown; name?: unknown } = {};
  try {
    user = r?.code === 0 ? JSON.parse(r.stdout) : {};
  } catch {
    user = {};
  }
  const login = typeof user.login === 'string' && user.login ? user.login : account;
  const name = typeof user.name === 'string' && user.name.trim() ? user.name.trim() : login;
  const email = typeof user.id === 'number' ? `${user.id}+${login}@users.noreply.github.com` : `${login}@users.noreply.github.com`;
  return { name, email };
}

/** What Join a team project needs before it can start. */
export interface JoinState {
  /** gh is installed; null before that's known. */
  gh: boolean | null;
  /** A join is under way in this window. */
  joining: boolean;
}

/** Why Join a team project waits, or that it can run. */
export function joinEnabled(s: JoinState): { ok: true } | { ok: false; why: string } {
  if (s.joining) return { ok: false, why: 'A project is being joined now. Its progress shows in the corner.' };
  if (s.gh === false) return { ok: false, why: 'The GitHub CLI isn\'t installed yet. Install it in Setup, under This machine, first.' };
  return { ok: true };
}

/** Join a team project: the Command Center's, Setup's and the CLI's `acc join`. */
export const JOIN_COMMAND: TaskCommand<JoinState> = {
  id: 'acc.join',
  params: 'The repo\'s address (a GitHub URL); where to put the clone (the repo\'s name under Documents when left out); and the GitHub account to clone as, when more than one can read the repo.',
  enabled: joinEnabled,
};

export interface JoinOptions {
  address: string;
  /** The folder to clone into: absent, defaultJoinDir. */
  dir?: string;
  /** The account to clone as: absent, the one account that can read the repo. */
  account?: string;
  run: Runner;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export interface Joined {
  dir: string;
  repo: string;
  account: string;
  identity: { name: string; email: string };
  /** The project's name from its settings; null when the repo has no .acc/config.json yet. */
  project: string | null;
}

/** Whether a folder is there and holds anything. */
const hasEntries = (dir: string): boolean => {
  try {
    return readdirSync(dir).length > 0;
  } catch {
    return false;
  }
};

/** What a join would do, worked out before anything is written: the repo, who can read it, the account and the folder. */
export interface JoinPlan {
  address: RepoAddress;
  /** The accounts gh knows that can read the repo: never empty. */
  readers: string[];
  /** The account named, or the one reader; null when more than one can read it and none was named. */
  account: string | null;
  dir: string;
}

/**
 * What a join would do, refusing before any folder is made: an address that isn't GitHub's, gh not installed,
 * one no account gh knows can read, an account named that can't, and a folder that holds something already.
 */
export function joinPlan(o: JoinOptions): JoinPlan {
  const env = o.env ?? process.env;
  const address = parseRepoAddress(o.address);
  if (!address) throw new AccError('usage', `"${o.address.trim()}" isn't a GitHub repo's address. Use one such as https://github.com/acme/acme-salesforce.`);
  const readers = joinReaders(o.run, address, env);
  if (readers === null) throw new AccError('no-gh', 'The GitHub CLI (gh) isn\'t installed, so no account can read the repo. Install it, then sign in.');
  if (!readers.length) {
    throw new AccError('refused', `No GitHub account signed in on this machine can read ${address.slug}. Ask for access to it, sign in to gh as an account that has it, then try again. No folder was made.`);
  }
  let account: string | null = null;
  if (o.account) {
    account = readers.find((r) => r.toLowerCase() === o.account!.toLowerCase()) ?? null;
    if (!account) throw new AccError('refused', `${o.account} can't read ${address.slug}, or gh isn't signed in as it. Accounts that can: ${readers.join(', ')}. No folder was made.`);
  } else if (readers.length === 1) account = readers[0]!;
  const dir = o.dir?.trim() || defaultJoinDir(address.repo, o.platform, env);
  if (existsSync(dir) && hasEntries(dir)) throw new AccError('refused', `${dir} holds files already. Pick an empty folder, or a new one. No folder was made.`);
  return { address, readers, account, dir };
}

/**
 * Clones a team project and pins it to its person: the account (acc.githubAccount, with acc's credential helper)
 * and the commit identity, each with `git config --local`, then marks it joined. Every refusal (joinPlan's, and
 * two accounts that can read it with none named) comes before a folder is made. A clone that fails takes away
 * the folder it made.
 */
export function joinProject(o: JoinOptions): Joined {
  const env = o.env ?? process.env;
  const plan = joinPlan(o);
  if (!plan.account) throw new AccError('choose', `More than one account can read ${plan.address.slug}: ${plan.readers.join(', ')}. Name one with --account. No folder was made.`);
  const { address, account, dir } = plan;
  const existed = existsSync(dir);
  const quiet = { ...env, GIT_TERMINAL_PROMPT: '0' };
  const clone = o.run('git', ['-c', 'credential.helper=', '-c', `credential.helper=${pinnedHelper(account)}`, 'clone', '--', address.url, dir], { env: quiet, timeoutMs: 600_000 });
  if (clone.code !== 0) {
    if (!existed) rmSync(dir, { recursive: true, force: true });
    throw new AccError('git', `git couldn't clone ${address.slug}: ${(clone.stderr || clone.stdout).trim().split('\n').pop() ?? 'it failed'}`);
  }
  let config: Config | null = null;
  try {
    config = parseConfig(JSON.parse(readFileSync(posixJoin(dir, '.acc', 'config.json'), 'utf8'))).config;
  } catch {
    config = null;
  }
  const identity = accountIdentity(o.run, account, env);
  // Each in this clone only (D-028, B2): `--local`, never `--global`, so no other repo on the machine changes.
  const local = (...args: string[]) => {
    const r = o.run('git', ['config', '--local', ...args], { cwd: dir });
    if (r.code !== 0) throw new AccError('git', `Couldn't set ${args[0]} in the clone's git config: ${(r.stderr || r.stdout).trim()}`);
  };
  local('user.name', identity.name);
  local('user.email', identity.email);
  local(CLONE_ACCOUNT_KEY, account);
  local('credential.helper', '');
  local('--add', 'credential.helper', credentialHelper(config?.github?.account ?? account));
  local(JOINED_KEY, 'true');
  return { dir, repo: address.slug, account, identity, project: config?.project ?? null };
}

/** Whether this clone was joined, not set up here: its own git config says so. */
export function isJoined(run: Runner, root: string): boolean {
  const r = run('git', ['config', '--local', '--get', JOINED_KEY], { cwd: root });
  return r.code === 0 && r.stdout.trim() === 'true';
}

/**
 * What Share how to join copies: the repo's address and three steps. It names no person and holds no secret: no
 * account, no commit identity, no token. Null for a project with no GitHub repo.
 */
export function joinText(config: Pick<Config, 'github'>): string | null {
  if (!config.github?.repo) return null;
  const url = `https://github.com/${config.github.repo}`;
  return [
    'To join this project in Agent Command Center:',
    '',
    `The repo: ${url}`,
    '',
    '1. Install the Agent Command Center extension in VS Code.',
    `2. Run "${JOIN_TITLE}" from the Command Palette.`,
    '3. Paste the repo\'s address above when it asks.',
  ].join('\n');
}
