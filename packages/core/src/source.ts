/**
 * Where a file acc copies from lives, and how it's read (GH-80, GH-108): a path, a GitHub file, or a file in
 * a git repo. Team templates and shared rules both come this way, so both refuse the same sources, read
 * GitHub as the same account, share a deadline, and never hand git a source it would read as an option.
 * Each kind of file names itself in the messages.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { AccError, type Runner } from './exec.ts';

/** What a kind of copied file is called, and how big one may be. */
export interface CopyKind {
  /** What it is, in full: "There's no team template at …". */
  noun: string;
  /** What it is, in short: "acc doesn't fetch a template over plain http". */
  short: string;
  /** Where its source is written down, so a sign-in in it would be too. */
  recordedIn: string;
  /** A file's path in a repo, as an example after the #. */
  example: string;
  maxBytes: number;
  /** The error codes: a source that can't be used, and one that couldn't be read. */
  bad: string;
  missing: string;
}

export const COPY_KINDS = {
  template: {
    noun: 'team template', short: 'template', recordedIn: 'the project\'s config', example: 'templates/salesforce.json',
    maxBytes: 64 * 1024, bad: 'bad-template', missing: 'no-template',
  },
  rules: {
    noun: 'rules file', short: 'rules file', recordedIn: 'the copy\'s header', example: 'rules/salesforce.md',
    maxBytes: 64 * 1024, bad: 'bad-rules', missing: 'no-rules',
  },
} as const satisfies Record<string, CopyKind>;

export type CopyKindName = keyof typeof COPY_KINDS;

const FETCH_TIMEOUT_MS = 2 * 60_000;

export type CopySource =
  | { kind: 'github'; owner: string; repo: string; ref: string; path: string }
  | { kind: 'git'; url: string; path: string }
  | { kind: 'file'; path: string };

const a = (s: string) => (/^[aeiou]/i.test(s) ? `an ${s}` : `a ${s}`);
const possessive = (s: string) => `${s[0]!.toUpperCase()}${s.slice(1)}'s`;

/**
 * What's wrong with a source before anything is fetched: a sign-in in its URL, which would be written down
 * with it, plain http, or a leading -, which git would take as an option. A committed source reaches git on
 * every Setup refresh. Null when it's fine to try.
 */
export function sourceProblem(source: string, kind: CopyKindName = 'template'): string | null {
  const k = COPY_KINDS[kind];
  const s = source.trim();
  if (!s) return 'Give a path, a GitHub file URL, or <git-url>#<path>.';
  if (s.startsWith('-')) return `${possessive(a(k.short))} source can't start with "-", which git would read as an option. For a file, start it with ./`;
  if (/^http:\/\//i.test(s)) return `Use https://: acc doesn't fetch ${a(k.short)} over plain http.`;
  const userinfo = /^[a-z][a-z0-9+.-]*:\/\/([^/@#?]*)@/i.exec(s);
  if (userinfo && (/^https:/i.test(s) || userinfo[1]!.includes(':'))) return `Take the sign-in out of the URL: gh and git sign in for you, and the source is written into ${k.recordedIn}.`;
  return null;
}

const GITHUB_BLOB = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:blob|raw)\/([^/?#]+)\/([^?#]+)(?:[?#].*)?$/;
// GitHub's Raw button links as …/<owner>/<repo>/refs/heads/<branch>/<path>, so a leading refs/heads/ or refs/tags/ isn't part of the ref.
const GITHUB_RAW = /^https:\/\/raw\.githubusercontent\.com\/([\w.-]+)\/([\w.-]+)\/(?:refs\/(?:heads|tags)\/)?([^/?#]+)\/([^?#]+)(?:[?#].*)?$/;

/** Where a file is: a GitHub file, a file in a git repo (<git-url>#<path>), or a path, with ~ for the home folder. */
export function parseSource(source: string, base: string = process.cwd(), home: string = homedir(), kind: CopyKindName = 'template'): CopySource {
  const k = COPY_KINDS[kind];
  const s = source.trim();
  const problem = sourceProblem(s, kind);
  if (problem) throw new AccError(k.bad, problem);
  const gh = GITHUB_BLOB.exec(s) ?? GITHUB_RAW.exec(s);
  if (gh) return { kind: 'github', owner: gh[1]!, repo: gh[2]!, ref: decodeURIComponent(gh[3]!), path: decodeURIComponent(gh[4]!) };
  const hash = s.lastIndexOf('#');
  if (hash > 0) {
    const path = s.slice(hash + 1).replace(/^\/+/, '');
    if (!path || path.split('/').includes('..')) throw new AccError(k.bad, `"${s}" needs a file's path in the repo after the #, such as #${k.example}.`);
    return { kind: 'git', url: s.slice(0, hash), path };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    throw new AccError(k.bad, `acc fetches ${a(k.short)} only with gh or git. Give a github.com file URL, <git-url>#<path>, or a path. "${s}" is neither.`);
  }
  const expanded = s === '~' ? home : s.startsWith('~/') ? join(home, s.slice(2)) : s;
  return { kind: 'file', path: resolve(base, expanded) };
}

/**
 * The source as acc writes it down. A path inside the repo is relative to it, and one under the home folder
 * starts ~/, so nothing committed holds a home path (D-079). URLs are kept as given.
 */
export function recordedSource(source: string, opts: { base?: string; home?: string; root?: string; kind?: CopyKindName } = {}): string {
  const src = parseSource(source, opts.base, opts.home, opts.kind);
  if (src.kind !== 'file') return source.trim();
  const inside = (dir: string) => {
    const rel = relative(dir, src.path);
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : null;
  };
  const inRepo = opts.root ? inside(opts.root) : null;
  // A name that starts with - is kept as ./-…, so it's never read as an option, nor refused as one.
  if (inRepo) return inRepo.startsWith('-') ? `./${inRepo}` : inRepo;
  const inHome = inside(opts.home ?? homedir());
  return inHome ? `~/${inHome}` : src.path;
}

export interface FetchOptions {
  /** The GitHub account gh reads as, through GH_TOKEN. Null: gh's active account. */
  account?: string | null;
  env?: NodeJS.ProcessEnv;
  /** Where a relative path starts. */
  base?: string;
  home?: string;
  /** How long the whole fetch may take, every call it makes together. */
  timeoutMs?: number;
  /** When the time runs out, for fetches that share one wait, such as Setup's check of every copy. */
  deadline?: number;
}

export interface Fetched {
  text: string;
  /** The commit it was read at: on GitHub, the last one to change the file at its ref; in git, the clone's HEAD. Null for a path. */
  commit: string | null;
}

const firstLine = (s: string) => s.trim().split('\n')[0] ?? '';

/**
 * A file's text, fetched with gh or git, or read from the path. Never `gh auth switch` (D-007). Its calls
 * share one deadline, `timeoutMs`, so a fetch that takes two of them waits no longer than one would. With
 * `commit`, it also finds the commit it read, at the cost of one more call.
 */
export function fetchSource(run: Runner, source: string, kind: CopyKindName, opts: FetchOptions & { commit?: boolean } = {}): Fetched {
  const k = COPY_KINDS[kind];
  const src = parseSource(source, opts.base, opts.home, kind);
  const total = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const deadline = opts.deadline ?? Date.now() + total;
  const timeoutMs = (): number => {
    const left = deadline - Date.now();
    const secs = Math.ceil(total / 1000);
    if (left <= 0) throw new AccError(k.missing, `Couldn't read ${source} within ${secs} second${secs === 1 ? '' : 's'}, so acc stopped.`);
    return left;
  };
  const tooBig = () => new AccError(k.bad, `${source} is over ${k.maxBytes / 1024} KB, too big for ${a(k.noun)}.`);
  const env = opts.env ?? process.env;
  if (src.kind === 'file') {
    if (!existsSync(src.path)) throw new AccError(k.missing, `There's no ${k.noun} at ${source}.`);
    if (statSync(src.path).size > k.maxBytes) throw tooBig();
    return { text: readFileSync(src.path, 'utf8'), commit: null };
  }
  if (src.kind === 'github') {
    const who = opts.account ?? 'gh\'s active account';
    let ghEnv = env;
    if (opts.account) {
      const t = run('gh', ['auth', 'token', '-u', opts.account], { env, timeoutMs: timeoutMs() });
      if (t.code !== 0 || !t.stdout.trim()) throw new AccError('no-github', `gh isn't logged in as ${opts.account}, the account that reads ${source}. Sign in from Setup, or run gh auth login.`);
      ghEnv = { ...env, GH_TOKEN: t.stdout.trim() };
    }
    const path = src.path.split('/').map(encodeURIComponent).join('/');
    const r = run('gh', ['api', `repos/${src.owner}/${src.repo}/contents/${path}?ref=${encodeURIComponent(src.ref)}`, '-H', 'Accept: application/vnd.github.raw'], { env: ghEnv, timeoutMs: timeoutMs() });
    if (r.code !== 0) {
      const why = firstLine(r.stderr || r.stdout);
      if (/\b404\b|not found/i.test(why)) throw new AccError(k.missing, `${source} wasn't found as ${who}. Check the address, and that ${who} can read ${src.owner}/${src.repo}.`);
      throw new AccError(k.missing, `Couldn't read ${source} as ${who}: ${why || `gh exited ${r.code}`}`);
    }
    if (Buffer.byteLength(r.stdout) > k.maxBytes) throw tooBig();
    if (!opts.commit) return { text: r.stdout, commit: null };
    const c = run('gh', ['api', `repos/${src.owner}/${src.repo}/commits?path=${encodeURIComponent(src.path)}&sha=${encodeURIComponent(src.ref)}&per_page=1`, '--jq', '.[0].sha'], { env: ghEnv, timeoutMs: timeoutMs() });
    const sha = c.stdout.trim();
    return { text: r.stdout, commit: c.code === 0 && /^[0-9a-f]{40}$/.test(sha) ? sha : null };
  }
  // A shallow clone with no files checked out, then the one file: nothing waits for a password, and the folder always goes.
  const dir = mkdtempSync(join(tmpdir(), `acc-${kind}-`));
  try {
    const gitEnv: NodeJS.ProcessEnv = { ...env, GIT_TERMINAL_PROMPT: '0', ...(env.GIT_SSH_COMMAND ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' }) };
    // "--" ends the options: the URL comes from a committed file, and is never read as one.
    const clone = run('git', ['clone', '--quiet', '--depth', '1', '--filter=blob:none', '--no-checkout', '--', src.url, join(dir, 'repo')], { env: gitEnv, timeoutMs: timeoutMs() });
    if (clone.code !== 0) throw new AccError(k.missing, `Couldn't fetch ${src.url} with git: ${firstLine(clone.stderr || clone.stdout) || `git exited ${clone.code}`}`);
    const show = run('git', ['show', `HEAD:${src.path}`], { cwd: join(dir, 'repo'), env: gitEnv, timeoutMs: timeoutMs() });
    if (show.code !== 0) throw new AccError(k.missing, `${src.url} has no ${src.path} on its default branch.`);
    if (Buffer.byteLength(show.stdout) > k.maxBytes) throw tooBig();
    if (!opts.commit) return { text: show.stdout, commit: null };
    const head = run('git', ['rev-parse', 'HEAD'], { cwd: join(dir, 'repo'), env: gitEnv, timeoutMs: timeoutMs() }).stdout.trim();
    return { text: show.stdout, commit: /^[0-9a-f]{40,64}$/.test(head) ? head : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
