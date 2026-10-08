/**
 * The repos acc has set up on this machine (GH-81): ~/.acc/repos.json, which holds their roots and nothing
 * else. acc init adds a repo when it writes its config, and the Command Center adds each project it loads,
 * so repos set up before the list existed count too. Each repo's .acc/config.json is read when it's needed,
 * never copied here, and one that's gone or can't be read is skipped. The Connect page reads it to say which
 * epic, area path, labels or group another repo here uses already.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { type Config, parseConfig, type Tracker } from './config.ts';
import { orList } from './trackers/types.ts';

/** Where the list is: ACC_REPOS_FILE, for tests, else ~/.acc/repos.json. */
export const reposFile = (env: NodeJS.ProcessEnv = process.env): string => env.ACC_REPOS_FILE || join(homedir(), '.acc', 'repos.json');

const configOf = (root: string): string => join(root, '.acc', 'config.json');

/** The roots listed, in the order they were added. A list that can't be read is empty. */
export function listedRepos(env: NodeJS.ProcessEnv = process.env): string[] {
  try {
    const j = JSON.parse(readFileSync(reposFile(env), 'utf8')) as { repos?: unknown };
    return Array.isArray(j.repos) ? [...new Set(j.repos.filter((r): r is string => typeof r === 'string' && r.startsWith('/')))] : [];
  } catch {
    return [];
  }
}

/**
 * Adds a repo's root to the end of the list, and drops roots whose config is gone. A root listed already
 * stays where it is, so loading the projects again writes nothing. It writes the whole file or nothing, and
 * only when the list changed. A list that can't be written is no reason to fail what called it, so it says
 * false. True when it wrote.
 */
export function rememberRepo(root: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const was = listedRepos(env);
  const kept = was.filter((r) => r === root || existsSync(configOf(r)));
  const next = kept.includes(root) ? kept : [...kept, root];
  if (was.length === next.length && was.every((r, i) => r === next[i])) return false;
  const file = reposFile(env);
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(tmp, `${JSON.stringify({ schema: 1, repos: next }, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, file);
    return true;
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // its folder couldn't be made, so there's nothing to take out
    }
    return false;
  }
}

/**
 * The git directory every clone's worktrees share, read from the files git keeps, so no git runs for each
 * listed repo: .git itself, or for a worktree the commondir its .git file points to. Null when it isn't git.
 */
export function gitCommonDir(root: string): string | null {
  const dotGit = join(root, '.git');
  try {
    if (statSync(dotGit).isDirectory()) return realpathSync(dotGit);
    const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'));
    if (!m) return null;
    const gitdir = resolve(root, m[1]!.trim());
    let common = gitdir;
    try {
      common = resolve(gitdir, readFileSync(join(gitdir, 'commondir'), 'utf8').trim());
    } catch {
      // a submodule's git directory is its own
    }
    return realpathSync(common);
  } catch {
    return null;
  }
}

/**
 * Which repo a root is, as D-027 tells repos apart: its GitHub repo when it has one, so every clone and
 * worktree is the same repo, else its git directory, else its root.
 */
export const repoIdentity = (root: string, github: { repo: string } | null): string =>
  github ? `github:${github.repo.toLowerCase()}` : `git:${gitCommonDir(root) ?? root}`;

/** A repo on this machine and its trackers, as its config says now. */
export interface RepoInUse {
  root: string;
  /** Its project's name, as the mark says it. */
  name: string;
  /** Which repo it is (repoIdentity): a clone of the same repo isn't another one. */
  key: string;
  /** Its own GitHub repo, which a GitHub tracker with no repo uses. */
  github: string | null;
  trackers: Tracker[];
}

const readConfig = (root: string): Config | null => {
  try {
    return parseConfig(JSON.parse(readFileSync(configOf(root), 'utf8'))).config;
  } catch {
    return null;
  }
};

/** Every listed repo whose config can be read now. One that's gone, or broken, is skipped. */
export function reposInUse(env: NodeJS.ProcessEnv = process.env, read: (root: string) => Config | null = readConfig): RepoInUse[] {
  const out: RepoInUse[] = [];
  for (const root of listedRepos(env)) {
    const c = read(root);
    if (c) out.push({ root, name: c.project, key: repoIdentity(root, c.github), github: c.github?.repo ?? null, trackers: c.trackers });
  }
  return out;
}

/** A place a person could pick on the Connect page: one epic, label, area path or group, and where. */
export interface PlaceChoice {
  kind: string;
  /** The Jira site, GitHub repo, Azure DevOps organization or monday.com account. */
  host: string;
  /** Azure DevOps: the project. */
  project?: string | null;
  /** monday.com: the board. */
  board?: string | number | null;
  /** The epic's key, a label, an area path or a group's id. */
  value: string;
}

/** Another repo's use of a place: who, and whether it's the same place or one over or under it. */
export interface UsedBy {
  names: string[];
  overlap: boolean;
  /** "used by acme-portal", or "overlaps acme-portal" for an Azure area path over or under another's. */
  words: string;
}

const lc = (s: string | number | null | undefined): string => String(s ?? '').trim().toLowerCase();
const area = (s: string | null | undefined): string => lc(s).replace(/^\\+|\\+$/g, '');

/** How a tracker meets a place: the same one, one over or under it (an Azure area path), or not at all. */
function meets(t: Tracker, ownRepo: string | null, c: PlaceChoice): 'same' | 'overlap' | null {
  if (t.kind !== c.kind) return null;
  const v = lc(c.value);
  if (t.kind === 'jira') return lc(t.site) === lc(c.host) && !!t.epic && lc(t.epic) === v ? 'same' : null;
  if (t.kind === 'github') return lc(t.repo ?? ownRepo) === lc(c.host) && t.labels.some((l) => lc(l) === v) ? 'same' : null;
  if (t.kind === 'monday') return lc(t.account) === lc(c.host) && lc(t.board) === lc(c.board) && !!t.group && lc(t.group) === v ? 'same' : null;
  if (lc(t.organization) !== lc(c.host) || lc(t.project) !== lc(c.project) || !t.areaPath) return null;
  const [a, b] = [area(t.areaPath), area(c.value)];
  return a === b ? 'same' : a.startsWith(`${b}\\`) || b.startsWith(`${a}\\`) ? 'overlap' : null;
}

/**
 * Which other repos on this machine use a place already (GH-81): the same Jira epic, the same GitHub label
 * on the same repo, the same monday.com group, or an Azure DevOps area path that's the same or one over or
 * under it. Names and keys match whatever their case. The repo itself, and any clone or worktree of it (the
 * same key), never count. Null when none does.
 */
export function usedBy(repos: RepoInUse[], c: PlaceChoice, own: { root: string; key: string }): UsedBy | null {
  const same = new Map<string, string>();
  const over = new Map<string, string>();
  for (const r of repos) {
    if (r.root === own.root || r.key === own.key) continue;
    for (const t of r.trackers) {
      const how = meets(t, r.github, c);
      if (how === 'same') same.set(r.key, r.name);
      else if (how === 'overlap' && !same.has(r.key)) over.set(r.key, r.name);
    }
  }
  for (const k of same.keys()) over.delete(k);
  if (!same.size && !over.size) return null;
  const names = [...same.values(), ...over.values()];
  const words = [same.size ? `used by ${orList([...same.values()])}` : '', over.size ? `overlaps ${orList([...over.values()])}` : ''].filter(Boolean).join('; ');
  return { names, overlap: !same.size, words };
}

/**
 * The hosts other repos here use for one kind of tracker, the most used first: a Jira site, an Azure DevOps
 * organization or a monday.com account. A project started on the Connect page looks for a sign-in kept for
 * one of these, so a site every project shares is filled in and signed in with nothing typed (GH-79).
 */
export function hostsInUse(repos: RepoInUse[], kind: string): string[] {
  const count = new Map<string, number>();
  for (const r of repos) {
    for (const t of r.trackers) {
      const host = t.kind !== kind ? null : t.site ?? t.organization ?? t.account;
      if (host) count.set(host.toLowerCase(), (count.get(host.toLowerCase()) ?? 0) + 1);
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([h]) => h);
}
