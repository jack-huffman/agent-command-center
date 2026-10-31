/**
 * Which task in a group check caused a failure (T-165): what the failed check's log names, matched against what
 * each task changed. The log names the failing test files, the files in an error and its stack, and a geometry
 * finding's page. A task matches when one of those is a file it changed, a file a changed file imports, or a
 * test that imports a changed file. Only one match is a send-back; the group check splits the group for any
 * other count, so a task is never sent back on a guess.
 */
import { posix } from 'node:path';

/** What a failed check's log names, read against the files the repo tracks. */
export interface GroupFailure {
  /** The checks that failed, by name. */
  checks: string[];
  /** Test files that failed. */
  tests: string[];
  /** Every tracked file the log names: the tests, and the files in an error or its stack. */
  files: string[];
  /** The pages a geometry finding names. */
  pages: string[];
  /** The log's lines that name one of those, as many as LOG_LINES. */
  lines: string[];
}

/** How many of the log's own lines a send-back keeps. */
export const LOG_LINES = 12;

/** A path a log can name: a relative or absolute path that ends in a source file's extension, and maybe a line. */
const PATH = /(?:[A-Za-z]:)?[\w@.~/\\-]*[\w-]\.(?:[cm]?[jt]sx?|json|css|html|md|cls|trigger|xml)\b/g;
/** A node:test or TAP line that names a failing test file. */
const FAILED_TEST = /^\s*(?:not ok \d+ - |✖ |# Subtest: |FAIL |test at )(\S+?\.test\.[cm]?[jt]sx?)/;
/** A geometry finding: "<page> <theme> <width>px: <check>: …" (extension/scripts/geometry.ts). */
const GEOMETRY = /^(\S+) (?:dark|light) \d+px: \w+:/;

/** A path as the repo names it: forward slashes, without the checkout's own folder in front. */
export function repoPath(p: string, roots: string[]): string {
  let s = p.replace(/\\/g, '/').replace(/^file:\/\//, '');
  for (const r of roots.map((x) => x.replace(/\\/g, '/').replace(/\/$/, ''))) if (r && s.startsWith(`${r}/`)) s = s.slice(r.length + 1);
  return s.replace(/^\.\//, '');
}

/**
 * What a failed check's log names: the failing test files, the tracked files in an error or its stack, and a
 * geometry finding's page. `tracked` is every file the repo tracks; anything else, such as a file under
 * node_modules, isn't the group's. `roots` are the checkout's folders, which absolute paths start with.
 */
export function failureOf(checks: string[], log: string, tracked: ReadonlySet<string>, roots: string[] = []): GroupFailure {
  const tests = new Set<string>();
  const files = new Set<string>();
  const pages = new Set<string>();
  const lines: string[] = [];
  for (const line of log.split(/\r?\n/)) {
    let named = false;
    const t = FAILED_TEST.exec(line);
    if (t) {
      const p = repoPath(t[1]!, roots);
      if (tracked.has(p)) {
        tests.add(p);
        named = true;
      }
    }
    for (const m of line.matchAll(PATH)) {
      const p = repoPath(m[0], roots);
      if (!tracked.has(p)) continue;
      files.add(p);
      named = true;
    }
    const g = GEOMETRY.exec(line.trim());
    if (g) {
      pages.add(g[1]!);
      named = true;
    }
    if (named && lines.length < LOG_LINES) lines.push(line.trim());
  }
  for (const t of tests) files.add(t);
  return { checks, tests: [...tests].sort(), files: [...files].sort(), pages: [...pages].sort(), lines };
}

/** The relative paths a source file imports, as written: `from '…'`, `import('…')` and `require('…')`. */
export function importsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"](\.{1,2}\/[^'"]+)['"]/gm)) out.push(m[1]!);
  return out;
}

/** An import resolved to a tracked file: as written, or with an extension or an index file added. */
export function resolveImport(from: string, spec: string, tracked: ReadonlySet<string>): string | null {
  const base = posix.normalize(posix.join(posix.dirname(from), spec));
  const tries = [base, ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'].map((e) => base + e), ...['index.ts', 'index.js'].map((i) => posix.join(base, i))];
  // A .js import of a .ts file, as TypeScript writes them.
  if (/\.js$/.test(base)) tries.push(base.replace(/\.js$/, '.ts'));
  return tries.find((t) => tracked.has(t)) ?? null;
}

const isTest = (f: string): boolean => /\.test\.[cm]?[jt]sx?$/.test(f) || /(^|\/)test\//.test(f);

/**
 * The files a task's change reaches: each file it changed, each file those import, and each test that
 * imports one of them. `read` gives a tracked file's text, or null.
 */
export function reachOf(changed: string[], tracked: ReadonlySet<string>, read: (file: string) => string | null): Set<string> {
  const reach = new Set(changed);
  for (const f of changed) {
    const text = read(f);
    if (text === null) continue;
    for (const spec of importsOf(text)) {
      const r = resolveImport(f, spec, tracked);
      if (r) reach.add(r);
    }
  }
  const mine = new Set(changed);
  for (const t of [...tracked].filter(isTest)) {
    if (reach.has(t)) continue;
    const text = read(t);
    if (text === null) continue;
    if (importsOf(text).some((spec) => { const r = resolveImport(t, spec, tracked); return !!r && mine.has(r); })) reach.add(t);
  }
  return reach;
}

/** A page a geometry finding names is a task's when it changed a file named for it, such as fixtures/agents.ts. */
const pageFile = (page: string, f: string): boolean => posix.basename(f).replace(/\.[^.]+$/, '') === page;

/** The task in a group that one of the failure's files or pages belongs to. */
export interface Suspect {
  id: string;
  /** What it changed, and the files that reaches (reachOf). */
  changed: string[];
  reach: ReadonlySet<string>;
}

/** Which of the failure's files and pages each suspect's change reaches: every suspect that reaches one, with what it reaches. */
export function matchFailure(f: Pick<GroupFailure, 'files' | 'pages'>, suspects: Suspect[]): { id: string; files: string[] }[] {
  const out: { id: string; files: string[] }[] = [];
  for (const s of suspects) {
    const files = f.files.filter((x) => s.reach.has(x));
    const pages = f.pages.filter((p) => s.changed.some((c) => pageFile(p, c)));
    if (files.length || pages.length) out.push({ id: s.id, files: [...files, ...pages.map((p) => `the ${p} page`)] });
  }
  return out;
}

