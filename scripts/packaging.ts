/**
 * Packaging this repo (D-079): one version for everything that ships, a CHANGELOG entry for it, no personal
 * data in a package, and a GitHub Release only a person makes. npm run set-version, npm run package and
 * npm run release run these. Releasing this repo isn't acc's product behaviour, so it lives here, not in
 * core (D-003).
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run as realRun, type Runner } from '../packages/core/src/exec.ts';
import { cloneAccount, ghAccounts } from '../packages/core/src/github.ts';
import { GH_TIMEOUT_MS, ghToken } from '../packages/core/src/land.ts';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SEMVER = /^\d+\.\d+\.\d+$/;

// ---------------------------------------------------------------- one version

type Json = { [k: string]: unknown };
const field = (j: Json, ...path: string[]): unknown => path.reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Json)[k] : undefined), j);

interface Place {
  file: string;
  /** How a problem names it. */
  label: string;
  read: (j: Json) => unknown;
  /** Where the version sits in the file's text: before, the version, after. Exactly one match. */
  at: RegExp;
}

const TOP = /^( {2}"version": ")([^"]*)(")/m;

/**
 * Every place the version is written. The root package.json's is the one a person sets, with
 * npm run set-version; the manifests keep literal copies, because vsce and Claude Code read them as they are.
 */
export const VERSION_PLACES: readonly Place[] = [
  { file: 'package.json', label: 'package.json', read: (j) => j.version, at: TOP },
  { file: 'package-lock.json', label: 'package-lock.json', read: (j) => j.version, at: TOP },
  { file: 'package-lock.json', label: 'package-lock.json (its root package)', read: (j) => field(j, 'packages', '', 'version'), at: /^( {4}"": \{\n {6}"name": "[^"]*",\n {6}"version": ")([^"]*)(")/m },
  { file: 'extension/package.json', label: 'extension/package.json', read: (j) => j.version, at: TOP },
  { file: 'plugin/.claude-plugin/plugin.json', label: 'plugin/.claude-plugin/plugin.json', read: (j) => j.version, at: TOP },
  {
    file: '.claude-plugin/marketplace.json', label: '.claude-plugin/marketplace.json (the acc plugin)',
    read: (j) => (j.plugins as Json[] | undefined)?.find((p) => p.name === 'acc')?.version, at: /("name": "acc",[^{}]*?"version": ")([^"]*)(")/,
  },
];

export interface VersionAt {
  file: string;
  label: string;
  version: string | null;
}

export function readVersions(root: string): VersionAt[] {
  return VERSION_PLACES.map((p) => {
    let version: unknown;
    try { version = p.read(JSON.parse(readFileSync(join(root, p.file), 'utf8')) as Json); } catch { version = undefined; }
    return { file: p.file, label: p.label, version: typeof version === 'string' ? version : null };
  });
}

/** Each place that doesn't say the root package.json's version, by name. */
export function versionProblems(found: VersionAt[]): string[] {
  const want = found[0]?.version;
  if (!want || !SEMVER.test(want)) return [`package.json's version is ${want ?? 'missing'}. It should be x.y.z.`];
  return found.slice(1).filter((f) => f.version !== want)
    .map((f) => `${f.label} says ${f.version ?? 'no version'}, not ${want}, the root package.json's. Run npm run set-version -- ${want}.`);
}

/** Writes this version to every place, changing nothing else in those files. Writes nothing if one place can't take it. */
export function setVersion(root: string, version: string): string[] {
  if (!SEMVER.test(version)) throw new Error(`${version} isn't a version: give it as x.y.z.`);
  const texts = new Map<string, string>();
  for (const p of VERSION_PLACES) {
    const text = texts.get(p.file) ?? readFileSync(join(root, p.file), 'utf8');
    const hits = text.match(new RegExp(p.at.source, `${p.at.flags}g`))?.length ?? 0;
    if (hits !== 1) throw new Error(`Couldn't find the one version in ${p.label} (found ${hits}). Nothing was changed.`);
    texts.set(p.file, text.replace(p.at, (_, before: string, _old: string, after: string) => `${before}${version}${after}`));
  }
  for (const p of VERSION_PLACES) {
    if (p.read(JSON.parse(texts.get(p.file)!) as Json) !== version) throw new Error(`${p.label} wouldn't read as ${version}. Nothing was changed.`);
  }
  const changed = [...texts].filter(([file, text]) => readFileSync(join(root, file), 'utf8') !== text);
  for (const [file, text] of changed) writeFileSync(join(root, file), text);
  return changed.map(([file]) => file);
}

// ---------------------------------------------------------------- the CHANGELOG

export const CHANGELOG = 'CHANGELOG.md';
/** The last heading: what came before the first release. */
export const EARLIER = 'Earlier versions';

interface Section {
  title: string;
  line: number;
  body: string;
}

function sections(text: string): Section[] {
  const lines = text.split('\n');
  const out: Section[] = [];
  lines.forEach((l, i) => {
    if (l.startsWith('## ')) out.push({ title: l.slice(3).trim(), line: i + 1, body: '' });
    else if (out.length) out[out.length - 1]!.body += `${l}\n`;
  });
  for (const s of out) s.body = s.body.trim();
  return out;
}

const compareVersions = (a: string, b: string): number => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < 3; i++) if (x![i] !== y![i]) return x![i]! - y![i]!;
  return 0;
};

/** The notes for one version, or null if it has no entry or an empty one. */
export function changelogEntry(text: string, version: string): string | null {
  const s = sections(text).find((x) => x.title === version);
  return s?.body ? s.body : null;
}

/** What's wrong with the CHANGELOG's shape: `## x.y.z` headings, newest first, each once, each with notes. */
export function changelogProblems(text: string): string[] {
  const out: string[] = [];
  const all = sections(text);
  let last: string | null = null;
  const seen = new Set<string>();
  all.forEach((s, i) => {
    if (s.title === EARLIER) {
      if (i !== all.length - 1) out.push(`${CHANGELOG}:${s.line}: "## ${EARLIER}" must be the last heading.`);
      return;
    }
    if (!SEMVER.test(s.title)) { out.push(`${CHANGELOG}:${s.line}: "## ${s.title}" isn't a version. Head each release ## x.y.z.`); return; }
    if (seen.has(s.title)) out.push(`${CHANGELOG}:${s.line}: ${s.title} is listed twice.`);
    else if (last && compareVersions(s.title, last) > 0) out.push(`${CHANGELOG}:${s.line}: ${s.title} comes after ${last}. List the newest first.`);
    if (!s.body) out.push(`${CHANGELOG}:${s.line}: ${s.title} has no notes.`);
    seen.add(s.title);
    last = s.title;
  });
  if (!seen.size) out.push(`${CHANGELOG} lists no versions. Head each release ## x.y.z.`);
  return out;
}

// ---------------------------------------------------------------- no personal data

/**
 * Test fixtures' and docs' placeholder names, never flagged, as whole names only. A packager whose own
 * username is one of these isn't caught by it: accepted, as the names are rare and the rule stays simple.
 */
export const PLACEHOLDERS: readonly string[] = ['acme', 'jordan-kim', 'jordan', 'example', 'you'];

/** The packager's own words, gathered from their machine when they package, never written into the repo. */
export interface Terms {
  emails: string[];
  /** GitHub accounts: every one gh is signed in to, and the repo's own. */
  logins: string[];
  /** The packager's username and real name, flagged in .claude and .acc paths. */
  names: string[];
  /** Tracker hosts from the packager's sign-ins. */
  hosts: string[];
  /** Client repos from the packager's sign-ins, as owner/repo. */
  repos: string[];
  /** Text that may stay although it holds a term: github.com/<the repo> (D-079). */
  allowed: string[];
}

export const NO_TERMS: Terms = { emails: [], logins: [], names: [], hosts: [], repos: [], allowed: [] };

export interface Hit {
  file: string;
  line: number;
  what: string;
}

/** A placeholder, or an email, site, organization or repo named for one: you@…, acme.atlassian.net, dev.azure.com/acme, acme/app. */
const isPlaceholder = (term: string): boolean => {
  const t = term.toLowerCase();
  const head = t.includes('@') ? t.slice(0, t.indexOf('@')) : t.split(/[./]/)[0]!;
  const org = t.startsWith('dev.azure.com/') ? t.slice('dev.azure.com/'.length) : '';
  return [t, head, org].some((x) => PLACEHOLDERS.includes(x));
};
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tidy = (xs: (string | null | undefined)[]): string[] => [...new Set(xs.map((x) => x?.trim().toLowerCase() ?? '').filter((x) => x && !isPlaceholder(x)))].sort();
const anyOf = (xs: string[], before: string, after: string): RegExp | null => (xs.length ? new RegExp(`${before}(${xs.map(escape).join('|')})${after}`, 'gi') : null);

/** Text rules that hold for anyone: a home folder, or a real-looking tracker site. */
const HOME = /(?<![\w.~-])\/(?:Users|home)\/([\w.-]+)/g;
const HOME_ENCODED = /(?<![A-Za-z0-9])-(?:Users|home)-([A-Za-z0-9._]+)/g;
const JIRA = /(?<![\w.-])([a-z0-9][a-z0-9-]*)\.atlassian\.net(?![\w-])/gi;
const AZURE = /(?<![\w.-])dev\.azure\.com\/([A-Za-z0-9][\w.-]*)/gi;
const VSTS = /(?<![\w.-])([a-z0-9][a-z0-9-]*)\.visualstudio\.com(?![\w-])/gi;
const AGENT_PATH = /[^\s'"`()<>,;]*\.(?:claude|acc)\/[^\s'"`()<>,;]*/g;

export interface Matcher {
  terms: Terms;
  allowed: RegExp | null;
  emails: RegExp | null;
  logins: RegExp | null;
  hosts: RegExp | null;
  repos: RegExp | null;
  nameWords: Set<string>;
  nameJoined: string[];
}

export function matcher(terms: Terms): Matcher {
  const words = new Set<string>();
  const joined: string[] = [];
  for (const n of terms.names) {
    const w = n.toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 3 && !isPlaceholder(x));
    w.forEach((x) => words.add(x));
    if (w.length > 1) for (const sep of ['', '-', '.', '_']) joined.push(w.join(sep));
  }
  return {
    terms,
    allowed: terms.allowed.length ? new RegExp(terms.allowed.map(escape).join('|'), 'gi') : null,
    emails: anyOf(terms.emails, '(?<![\\w.+-])', '(?![\\w-]|\\.\\w)'),
    logins: anyOf(terms.logins, '(?<![\\w-])', '(?![\\w-])'),
    hosts: anyOf(terms.hosts, '(?<![\\w.-])', '(?![\\w-])'),
    repos: anyOf(terms.repos, '(?<![\\w.-])', '(?![\\w-])'),
    nameWords: words,
    nameJoined: joined,
  };
}

const each = (re: RegExp | null, text: string): RegExpExecArray[] => (re ? [...text.matchAll(re)] : []);

/** What in one line is personal: a home path, the packager's email, account, name or tracker, or a client's site. */
export function scanLine(line: string, m: Matcher): string[] {
  const text = m.allowed ? line.replace(m.allowed, (s) => ' '.repeat(s.length)) : line;
  const out: string[] = [];
  for (const h of each(HOME, text)) if (!isPlaceholder(h[1]!)) out.push(`a home path (${h[0]})`);
  for (const h of each(HOME_ENCODED, text)) if (!isPlaceholder(h[1]!)) out.push(`a home path, encoded (${h[0]})`);
  for (const h of each(m.emails, text)) out.push(`the packager's email (${h[1]})`);
  for (const h of each(m.logins, text)) out.push(`a GitHub account of the packager's or the repo's (${h[1]})`);
  for (const h of each(AGENT_PATH, text)) {
    const p = h[0].toLowerCase();
    if (p.split(/[^a-z0-9]+/).some((w) => m.nameWords.has(w)) || m.nameJoined.some((j) => p.includes(j))) out.push(`a .claude or .acc path with the packager's name (${h[0]})`);
  }
  for (const h of each(JIRA, text)) if (!isPlaceholder(h[1]!)) out.push(`a Jira site (${h[0]})`);
  for (const h of each(AZURE, text)) if (!isPlaceholder(h[1]!)) out.push(`an Azure DevOps organization (${h[0]})`);
  for (const h of each(VSTS, text)) if (!isPlaceholder(h[1]!)) out.push(`an Azure DevOps organization (${h[0]})`);
  for (const h of each(m.hosts, text)) out.push(`a tracker the packager signed in to (${h[1]})`);
  for (const h of each(m.repos, text)) out.push(`a repo the packager signed in to a tracker for (${h[1]})`);
  return [...new Set(out)];
}

export function scanText(file: string, text: string, m: Matcher): Hit[] {
  const hits: Hit[] = [];
  text.split('\n').forEach((l, i) => { for (const what of scanLine(l, m)) hits.push({ file, line: i + 1, what }); });
  return hits;
}

/** A file's text. One with a NUL byte, a font or an image, is read byte for byte, so a path in its metadata still shows. */
function textOf(path: string): string {
  const b = readFileSync(path);
  return b.subarray(0, 8000).includes(0) ? b.toString('latin1') : b.toString('utf8');
}

/** Every file under a folder, as [its name in the package, its path on disk], in order. */
export function filesIn(dir: string, prefix = ''): [string, string][] {
  const out: [string, string][] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push([join(prefix, relative(dir, p)), p]);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

export function scanFiles(files: [string, string][], m: Matcher): Hit[] {
  return files.flatMap(([name, path]) => scanText(name, textOf(path), m));
}

/** A .vsix is a zip: macOS's unzip opens it into a temporary folder, and every file in it is scanned. */
export function scanVsix(vsix: string, m: Matcher, run: Runner = realRun): { hits: Hit[]; files: number } {
  const dir = mkdtempSync(join(tmpdir(), 'acc-vsix-'));
  try {
    const r = run('/usr/bin/unzip', ['-q', '-o', vsix, '-d', dir]);
    if (r.code !== 0) throw new Error(`Couldn't open ${vsix}: ${(r.stderr || r.stdout).trim()}`);
    const files = filesIn(dir);
    return { hits: scanFiles(files, m), files: files.length };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The plugin as a release commits it: plugin/ with bin/ as the build made it (or, once committed, as it
 * is), and the marketplace entry that points at it.
 */
export function pluginFiles(root: string, bin: 'dist' | 'plugin'): [string, string][] {
  const files = filesIn(join(root, 'plugin'), 'plugin').filter(([name]) => bin === 'plugin' || !name.startsWith('plugin/bin/'));
  if (bin === 'dist') files.push(['plugin/bin/acc', join(root, 'dist', 'acc')], ['plugin/bin/acc.mjs', join(root, 'dist', 'acc.mjs')]);
  files.push(['.claude-plugin/marketplace.json', join(root, '.claude-plugin', 'marketplace.json')]);
  return files;
}

export const hitLine = (pkg: string, h: Hit): string => `${pkg}: ${h.file}:${h.line}: ${h.what}`;

// ---------------------------------------------------------------- the packager's words

export interface TermDeps {
  root: string;
  run: Runner;
  env: NodeJS.ProcessEnv;
  home: string;
  username: string;
  /** VSCode's state.vscdb files, read for the names of tracker sign-ins only, never their values. */
  vscodeState: string[];
}

/** VSCode's own state files, or the one ACC_VSCODE_STATE names (empty: none). */
export function vscodeStateFiles(env: NodeJS.ProcessEnv = process.env, home = homedir()): string[] {
  if (env.ACC_VSCODE_STATE !== undefined) return env.ACC_VSCODE_STATE ? [env.ACC_VSCODE_STATE] : [];
  return ['Code', 'Code - Insiders'].map((app) => join(home, 'Library', 'Application Support', app, 'User', 'globalStorage', 'state.vscdb'));
}

export const defaultTermDeps = (root: string = ROOT, env: NodeJS.ProcessEnv = process.env): TermDeps => ({
  root, run: realRun, env, home: homedir(), username: userInfo().username, vscodeState: vscodeStateFiles(env),
});

/**
 * A tracker sign-in's key, acc.cred:<repoKey>:<kind>:<host> (D-027): its host, and its repo when that's a
 * GitHub repo. An Azure DevOps host is a bare organization, so it's matched only in the forms a URL takes.
 */
export function parseSignIn(key: string): { hosts: string[]; repo: string | null } | null {
  const m = /acc\.cred:([^"]+)/.exec(key);
  const parts = m?.[1]!.split(':') ?? [];
  if (parts.length < 4) return null;
  const host = parts.pop()!.toLowerCase();
  parts.pop();
  const repoKey = parts.join(':');
  return {
    hosts: host.includes('.') ? [host] : [`dev.azure.com/${host}`, `${host}.visualstudio.com`],
    repo: repoKey.startsWith('github:') ? repoKey.slice('github:'.length).toLowerCase() : null,
  };
}

/** The names of the tracker sign-ins VSCode keeps, read-only, keys only. Anything unreadable is said, not fatal. */
export function readSignIns(files: string[]): { keys: string[]; notes: string[] } {
  const keys: string[] = [];
  const notes: string[] = [];
  const there = files.filter((f) => existsSync(f));
  if (!files.length) notes.push('VSCode\'s sign-ins weren\'t read (ACC_VSCODE_STATE is empty), so tracker sites are checked by pattern only.');
  else if (!there.length) notes.push('VSCode\'s sign-ins weren\'t found, so tracker sites are checked by pattern only.');
  for (const f of there) {
    try {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
      const db = new DatabaseSync(f, { readOnly: true });
      try {
        for (const row of db.prepare('SELECT key FROM ItemTable WHERE key LIKE ?').all('%acc.cred:%')) keys.push(String(row.key));
      } finally {
        db.close();
      }
    } catch (e) {
      notes.push(`Couldn't read VSCode's sign-ins in ${f} (${(e as Error).message}), so tracker sites are checked by pattern only.`);
    }
  }
  return { keys, notes };
}

const lines = (run: Runner, cmd: string, args: string[], cwd: string): string[] => {
  const r = run(cmd, args, { cwd });
  return r.code === 0 ? r.stdout.split('\n').map((l) => l.trim()).filter(Boolean) : [];
};

/** The packager's emails, accounts, names and tracker sign-ins, from their machine as it is now. */
export function personalTerms(d: TermDeps): { terms: Terms; notes: string[] } {
  const notes: string[] = [];
  let config: Json = {};
  try { config = JSON.parse(readFileSync(join(d.root, '.acc', 'config.json'), 'utf8')) as Json; } catch { notes.push('No .acc/config.json, so the repo\'s own account isn\'t known.'); }
  const repo = field(config, 'github', 'repo');
  // Every scope, and every file the system and global configs include, whatever its condition: a work
  // email kept for another folder (includeIf) is still the packager's.
  // git resolves a relative include against the folder of the file that includes it, so ask where each came from.
  const included = ['--system', '--global']
    .flatMap((s) => lines(d.run, 'git', ['config', s, '--show-origin', '--get-regexp', '^include(if\\..*)?\\.path$'], d.root))
    .map((l) => {
      const tab = l.indexOf('\t');
      const origin = tab > 0 && l.startsWith('file:') ? l.slice('file:'.length, tab) : '';
      const entry = tab > 0 ? l.slice(tab + 1) : l;
      const p = entry.slice(entry.indexOf(' ') + 1).replace(/^~(?=\/)/, d.home);
      return ['--file', resolve(origin ? dirname(origin) : d.home, p), '--includes'];
    });
  const scopes = [[], ['--system', '--includes'], ['--global', '--includes'], ['--local', '--includes'], ['--worktree', '--includes'], ...included];
  const git = (key: string) => scopes.flatMap((s) => lines(d.run, 'git', ['config', ...s, '--get-all', key], d.root));
  const accounts = ghAccounts(d.run, d.env);
  if (!accounts) notes.push('gh isn\'t installed, so only the repo\'s own GitHub account is checked.');
  const signIns = readSignIns(d.vscodeState);
  notes.push(...signIns.notes);
  const parsed = signIns.keys.map(parseSignIn).filter((x) => x !== null);
  const terms: Terms = {
    emails: tidy([...git('user.email'), d.env.GIT_AUTHOR_EMAIL, d.env.GIT_COMMITTER_EMAIL, d.env.EMAIL, field(config, 'commitIdentity', 'email') as string | undefined]),
    logins: tidy([...(accounts ?? []).map((a) => a.login), field(config, 'github', 'account') as string | undefined, cloneAccount(d.run, d.root)]),
    names: tidy([d.username, ...git('user.name'), d.env.GIT_AUTHOR_NAME, field(config, 'commitIdentity', 'name') as string | undefined, ...lines(d.run, 'id', ['-F'], d.root)]),
    hosts: tidy(parsed.flatMap((p) => p.hosts)),
    repos: tidy(parsed.map((p) => p.repo).filter((r) => r !== (typeof repo === 'string' ? repo.toLowerCase() : null))),
    allowed: typeof repo === 'string' ? [`github.com/${repo}`] : [],
  };
  return { terms, notes };
}

// ---------------------------------------------------------------- npm run package

export const vsixName = (version: string): string => `agent-command-center-${version}.vsix`;

export interface PackageSteps {
  root: string;
  log: (line: string) => void;
  /** npm run check: typecheck, build, test. */
  check: () => boolean;
  /** vsce: packages the extension into this file. */
  vsce: (out: string) => boolean;
  /** Copies the launcher and acc.mjs into plugin/bin, together. */
  shipPlugin: () => void;
  terms: () => { terms: Terms; notes: string[] };
}

export type Outcome = { ok: true; vsix: string } | { ok: false; problems: string[] };

/**
 * npm run package: the version and its CHANGELOG entry first, before anything is built; then the checks,
 * the .vsix, and a scan of the .vsix and the plugin. Only a clean scan writes plugin/bin, so a failed one
 * leaves nothing behind to commit, and no .vsix.
 */
export function packageRelease(s: PackageSteps): Outcome {
  const versions = readVersions(s.root);
  const problems = versionProblems(versions);
  if (problems.length) return { ok: false, problems };
  const version = versions[0]!.version!;
  const log = existsSync(join(s.root, CHANGELOG)) ? readFileSync(join(s.root, CHANGELOG), 'utf8') : '';
  if (!changelogEntry(log, version)) return { ok: false, problems: [`${CHANGELOG} has no entry for ${version}. Add "## ${version}" and what changed, newest first.`] };
  const shape = changelogProblems(log);
  if (shape.length) return { ok: false, problems: shape };

  if (!s.check()) return { ok: false, problems: ['npm run check failed. Fix it, then package again.'] };
  const vsix = join(s.root, 'dist', vsixName(version));
  if (!s.vsce(vsix) || !existsSync(vsix)) return { ok: false, problems: [`vsce didn't make ${relative(s.root, vsix)}.`] };

  const { terms, notes } = s.terms();
  notes.forEach((n) => s.log(n));
  const m = matcher(terms);
  const inVsix = scanVsix(vsix, m);
  const plugin = pluginFiles(s.root, 'dist');
  const hits = [...inVsix.hits.map((h) => hitLine(vsixName(version), h)), ...scanFiles(plugin, m).map((h) => hitLine('plugin', h))];
  if (hits.length) {
    rmSync(vsix, { force: true });
    return { ok: false, problems: [...hits, `Personal data in the package: ${hits.length} found. Nothing was packaged, and plugin/bin is unchanged.`] };
  }
  s.log(`Scanned ${inVsix.files} files in the .vsix and ${plugin.length} in the plugin: no personal data.`);
  s.shipPlugin();
  return { ok: true, vsix };
}

// ---------------------------------------------------------------- npm run release

/** A release uploads the .vsix, which can take longer than other gh calls (D-051, D-053). */
export const RELEASE_TIMEOUT_MS = 10 * 60_000;
export const RELEASE_BRANCH = 'main';

export interface ReleaseDeps {
  root: string;
  run: Runner;
  env: NodeJS.ProcessEnv;
  /** Run from a terminal: a person is there to type the version. */
  isTTY: boolean;
  ask: (question: string) => Promise<string>;
  terms: () => { terms: Terms; notes: string[] };
  log: (line: string) => void;
}

export type Released = { ok: true; url: string } | { ok: false; reason: string };

const short = (sha: string) => sha.slice(0, 7);

/**
 * npm run release: a GitHub Release v<version> of HEAD, on the repo, as the repo's account (D-007), with
 * the .vsix attached and its CHANGELOG entry as the notes. Only a person makes one: it needs a terminal
 * and the version typed, refuses an agent's environment, and builders' hooks deny it.
 */
export async function release(d: ReleaseDeps): Promise<Released> {
  const no = (reason: string): Released => ({ ok: false, reason });
  if (!d.isTTY) return no('npm run release is a person\'s, run in a terminal: it asks you to type the version. Nothing was released.');
  if (d.env.ACC_ROLE) return no(`ACC_ROLE is ${d.env.ACC_ROLE}, so this is an agent's session. A person releases, with npm run release.`);

  let config: Json = {};
  try { config = JSON.parse(readFileSync(join(d.root, '.acc', 'config.json'), 'utf8')) as Json; } catch { /* said below */ }
  const repo = field(config, 'github', 'repo');
  const account = cloneAccount(d.run, d.root) ?? field(config, 'github', 'account');
  if (typeof repo !== 'string' || typeof account !== 'string') return no('.acc/config.json names no GitHub repo and account to release on (github.repo, github.account).');

  const git = (...args: string[]) => d.run('git', args, { cwd: d.root, timeoutMs: GH_TIMEOUT_MS });
  const branch = git('symbolic-ref', '--short', 'HEAD').stdout.trim();
  if (branch !== RELEASE_BRANCH) return no(`HEAD is ${branch || 'detached'}, not ${RELEASE_BRANCH}. Release from ${RELEASE_BRANCH}, after the merge.`);
  const fetched = git('fetch', '--quiet', 'origin', RELEASE_BRANCH);
  if (fetched.code !== 0) return no(`Couldn't fetch origin/${RELEASE_BRANCH}: ${(fetched.stderr || fetched.stdout).trim()}`);
  const head = git('rev-parse', 'HEAD').stdout.trim();
  const remote = git('rev-parse', `origin/${RELEASE_BRANCH}`).stdout.trim();
  if (!head || head !== remote) return no(`HEAD (${short(head)}) isn't origin/${RELEASE_BRANCH} (${short(remote)}). Pull or push first: the release is of the commit GitHub has.`);
  if (git('status', '--porcelain', '--untracked-files=no').stdout.trim()) return no('The tree has uncommitted changes. Commit them first, so the release matches its commit.');

  const versions = readVersions(d.root);
  const vp = versionProblems(versions);
  if (vp.length) return no(vp.join('\n'));
  const version = versions[0]!.version!;
  const notes = changelogEntry(existsSync(join(d.root, CHANGELOG)) ? readFileSync(join(d.root, CHANGELOG), 'utf8') : '', version);
  if (!notes) return no(`${CHANGELOG} has no entry for ${version}.`);

  const vsix = join(d.root, 'dist', vsixName(version));
  if (!existsSync(vsix)) return no(`There's no dist/${vsixName(version)}. Run npm run package on main, commit plugin/bin and push, then release.`);
  const inZip = (path: string) => d.run('/usr/bin/unzip', ['-p', vsix, path]);
  let packed: unknown;
  try { packed = (JSON.parse(inZip('extension/package.json').stdout) as Json).version; } catch { packed = null; }
  if (packed !== version) return no(`dist/${vsixName(version)} holds version ${String(packed ?? 'unknown')}, not ${version}. Run npm run package again.`);
  for (const f of ['acc', 'acc.mjs']) {
    const mine = join(d.root, 'plugin', 'bin', f);
    if (!existsSync(mine) || readFileSync(mine, 'utf8') !== inZip(`extension/dist/bin/${f}`).stdout) {
      return no(`plugin/bin/${f} isn't the ${f} in the .vsix. The plugin and the extension ship the same acc: package them together (npm run package), commit plugin/bin and push, then release.`);
    }
  }

  const { terms, notes: said } = d.terms();
  said.forEach((n) => d.log(n));
  const m = matcher(terms);
  const hits = [...scanVsix(vsix, m, d.run).hits.map((h) => hitLine(vsixName(version), h)), ...scanFiles(pluginFiles(d.root, 'plugin'), m).map((h) => hitLine('plugin', h))];
  if (hits.length) return no([...hits, `Personal data in the package: ${hits.length} found. Nothing was released.`].join('\n'));

  let token: string;
  try { token = ghToken(d.run, account); } catch (e) { return no((e as Error).message); }
  const env = { ...d.env, GH_TOKEN: token };
  const tag = `v${version}`;
  const seen = d.run('gh', ['release', 'view', tag, '-R', repo, '--json', 'url', '--jq', '.url'], { env, timeoutMs: GH_TIMEOUT_MS });
  if (seen.code === 0) return no(`${tag} is already released: ${seen.stdout.trim()}. Set a new version (npm run set-version) to release again.`);
  if (!/not found/i.test(seen.stderr)) return no(`Couldn't ask GitHub about ${tag}: ${(seen.stderr || seen.stdout).trim()}`);
  if (git('ls-remote', '--tags', 'origin', `refs/tags/${tag}`).stdout.trim()) return no(`The tag ${tag} is already on GitHub, with no release. Release a new version, or remove the tag yourself first.`);

  d.log(`Releasing ${tag} on ${repo} as ${account}: ${short(head)}, with dist/${vsixName(version)} and the notes under "## ${version}" in ${CHANGELOG}.`);
  const typed = (await d.ask(`Type ${version} to release it: `)).trim();
  if (typed !== version) return no(`You typed ${typed ? `"${typed}"` : 'nothing'}, not ${version}. Nothing was released.`);

  const tmp = mkdtempSync(join(tmpdir(), 'acc-release-'));
  try {
    const notesFile = join(tmp, 'notes.md');
    writeFileSync(notesFile, `${notes}\n`);
    const r = d.run('gh', ['release', 'create', tag, vsix, '-R', repo, '--target', head, '--title', version, '--notes-file', notesFile], { cwd: d.root, env, timeoutMs: RELEASE_TIMEOUT_MS });
    if (r.code !== 0) return no(`gh release create failed: ${(r.stderr || r.stdout).trim()}`);
    const url = r.stdout.trim().split('\n').pop() ?? '';
    return { ok: true, url };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
