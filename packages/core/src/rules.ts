/**
 * Shared rules (GH-108, D-098): a team's rules file, copied into the repo under .acc/rules/ with a header
 * saying where it came from. Packets, reviews and analyses read only the repo's own files, so a source that
 * moves or goes changes nothing here. Setup says when a source has changed since its copy, and copying it
 * in again is a person's choice. acc ships no rules: docs/RULES.md shows ACME's.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { Profile } from './config.ts';
import { AccError, type Runner } from './exec.ts';
import { fetchSource, type FetchOptions, parseSource, recordedSource, sourceProblem } from './source.ts';

/** Where the copies go, from the repo's root. */
export const RULES_DIR = '.acc/rules';
/** The repo's own rules, which win over every other. */
export const OWN_RULES = '.acc/rules.md';
/** Every copy together: each is at most 64 KB, and every packet, review and analysis carries them all. */
export const RULES_TOTAL_MAX_BYTES = 128 * 1024;

/**
 * The profile's rules (D-003): what every builder, reviewer and analyst of this kind of project keeps to.
 * They come first, so a team's copied-in rules and the repo's own can say otherwise.
 */
export const PROFILE_RULES: Record<Profile, string[]> = {
  generic: [],
  salesforce: [
    'Apex is bulk-safe: no SOQL or DML inside loops, and triggers handle 200 records.',
    'Apex respects sharing and object and field access where the data calls for it.',
    'Apex tests assert outcomes, cover the changed paths, and don\'t depend on org data they don\'t create.',
    'Metadata carries no values that belong to one org: user names, record ids, org URLs.',
  ],
};

const PROFILE_NAME: Record<Profile, string> = { generic: 'generic', salesforce: 'Salesforce' };

/** What the packet, the review and the analysis each say about the order, before the rules. */
export const RULES_ORDER = 'These come in a fixed order: the profile\'s rules, then rules copied in from elsewhere, then this repo\'s own. Where two disagree, the later one wins, so this repo\'s own rules win over the others.';

export const rulesDigest = (text: string): string => createHash('sha256').update(text).digest('hex');

// ---------------------------------------------------------------- the header

/** Where a copy came from, as its header says. */
export interface RulesHeader {
  /** The source as given, but for a path: from the repo's root, or from ~/, never a home path (D-079). */
  source: string;
  /** The commit it was read at, from GitHub or git. Null for a path. */
  commit: string | null;
  /** The day it was copied, as YYYY-MM-DD. */
  copied: string;
  /** sha256 of the text as copied, so a change at the source is told apart from an edit here. */
  sha256: string;
}

const MARK = '<!-- acc-rules v1:';
const NOTE = 'copied in by acc rules import. This repo keeps its own copy and may edit it; acc rules diff compares it with the source.';
const KEYS = ['source', 'commit', 'copied', 'sha256'] as const;

export function renderHeader(h: RulesHeader): string {
  return [`${MARK} ${NOTE}`, `source: ${h.source}`, ...(h.commit ? [`commit: ${h.commit}`] : []), `copied: ${h.copied}`, `sha256: ${h.sha256}`, '-->', ''].join('\n');
}

export interface RulesFile {
  /** Null when the file has no header, or one acc can't read. */
  header: RulesHeader | null;
  /** What's wrong with its header, when it has one acc can't read. */
  problem: string | null;
  /** The rules, after the header. */
  body: string;
}

/**
 * A copy's header and rules. The header is read strictly: its first line, then only the keys acc writes,
 * each once, then -->. A file with no header is rules kept here with no source.
 */
export function parseRulesFile(text: string): RulesFile {
  if (!text.startsWith(MARK)) return { header: null, problem: null, body: text };
  const end = text.indexOf('\n-->');
  const bad = (why: string): RulesFile => ({ header: null, problem: `Its header can't be read: ${why}`, body: text });
  if (end < 0) return bad('it has no closing -->.');
  const after = text.slice(end + 4);
  if (after && !after.startsWith('\n')) return bad('its --> isn\'t on a line of its own.');
  const lines = text.slice(0, end).split('\n').slice(1);
  const seen: Partial<Record<(typeof KEYS)[number], string>> = {};
  for (const line of lines) {
    const m = /^([a-z0-9]+): (.+)$/.exec(line);
    const key = m?.[1] as (typeof KEYS)[number] | undefined;
    if (!m || !key || !KEYS.includes(key)) return bad(`"${line.slice(0, 60)}" isn't a line acc writes.`);
    if (seen[key] !== undefined) return bad(`it says ${key} twice.`);
    seen[key] = m[2]!.trim();
  }
  if (!seen.source) return bad('it names no source.');
  if (seen.commit !== undefined && !/^[0-9a-f]{40,64}$/.test(seen.commit)) return bad(`its commit, "${seen.commit}", isn't a commit id.`);
  if (!seen.copied || !/^\d{4}-\d{2}-\d{2}$/.test(seen.copied)) return bad('its copied date isn\'t a YYYY-MM-DD date.');
  if (!seen.sha256 || !/^[0-9a-f]{64}$/.test(seen.sha256)) return bad('its sha256 isn\'t a sha256.');
  return { header: { source: seen.source, commit: seen.commit ?? null, copied: seen.copied, sha256: seen.sha256 }, problem: null, body: after.slice(1) };
}

// ---------------------------------------------------------------- the repo's copies

export interface RulesCopy extends RulesFile {
  /** Its name: the file's, without .md. */
  name: string;
  /** From the repo's root: .acc/rules/<name>.md. */
  file: string;
  path: string;
  /** It has a header, and its rules differ from what was copied: someone edited them here. */
  edited: boolean;
  bytes: number;
}

/** The copies in a repo or worktree, by file name: the order they come in. Only the repo's own files are read. */
export function importedRules(dir: string): RulesCopy[] {
  const at = join(dir, RULES_DIR);
  if (!existsSync(at)) return [];
  return readdirSync(at, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort()
    .map((n) => {
      const path = join(at, n);
      const text = readFileSync(path, 'utf8');
      const f = parseRulesFile(text);
      return { ...f, name: n.slice(0, -3), file: `${RULES_DIR}/${n}`, path, edited: !!f.header && rulesDigest(f.body) !== f.header.sha256, bytes: Buffer.byteLength(text) };
    });
}

/**
 * Every rule the builder, the reviewer and the analyst keep to, in the one order (GH-108): the profile's,
 * then each copy in .acc/rules/ by file name, then .acc/rules.md, which wins. Null when there are none.
 * It reads only `dir`: a task's worktree, or the main checkout.
 */
/**
 * A copy's rules without a leading acc header (GH-108): one whose header can't be read keeps it in its body,
 * and a copy imported from another project's .acc/rules/ carries that project's. Neither is a rule.
 */
export function withoutHeader(body: string): string {
  if (!body.startsWith(MARK)) return body;
  const end = body.indexOf('\n-->');
  return end >= 0 ? body.slice(end + 4).replace(/^\n/, '') : body.split('\n').slice(1).join('\n');
}

export function rulesText(dir: string, profile: Profile): string | null {
  const parts: string[] = [];
  const own = PROFILE_RULES[profile];
  if (own.length) parts.push(`### The ${PROFILE_NAME[profile]} profile's rules`, '', ...own.map((r) => `- ${r}`), '');
  for (const c of importedRules(dir)) {
    const body = withoutHeader(c.body).trim();
    if (!body) continue;
    const heading = c.header ? `Copied in from ${c.header.source}` : c.problem ? 'Copied in, but its header can\'t be read' : 'Kept in this repo';
    parts.push(`### ${heading} (\`${c.file}\`)`, '', body, '');
  }
  const ownFile = join(dir, OWN_RULES);
  const mine = existsSync(ownFile) ? readFileSync(ownFile, 'utf8').trim() : '';
  if (mine) parts.push(`### This repo's own rules (\`${OWN_RULES}\`)`, '', mine, '');
  if (!parts.length) return null;
  return [RULES_ORDER, '', ...parts].join('\n').trim();
}

// ---------------------------------------------------------------- copying one in

/** A copy's name: letters, digits, dots, dashes and underscores, so it's safe in a file name and a command. */
const NAME = /^[a-z0-9][a-z0-9._-]{0,59}$/;

/** The name a source's copy takes: its file name, without its extension. */
export function rulesName(source: string, base?: string, home?: string): string {
  const src = parseSource(source, base, home, 'rules');
  const n = basename(src.path).replace(/\.(md|markdown|txt)$/i, '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-._]+|-+$/g, '').slice(0, 60);
  return n || 'rules';
}

function checkName(name: string): string {
  const n = name.trim().replace(/\.md$/i, '').toLowerCase();
  if (!NAME.test(n)) throw new AccError('usage', `"${name}" can't be a rules file's name: use lower-case letters, digits, dots, dashes and underscores, such as acme-salesforce.`);
  return n;
}

/**
 * What's wrong with a rules source a team template names, or null (GH-108). A relative path is refused: it
 * would mean a different file on each machine.
 */
export function templateRulesProblem(source: string): string | null {
  const problem = sourceProblem(source, 'rules');
  if (problem) return problem;
  try {
    const src = parseSource(source, '/', homedir(), 'rules');
    const s = source.trim();
    if (src.kind === 'file' && !isAbsolute(s) && s !== '~' && !s.startsWith('~/')) return `${s} is a relative path, which would mean a different file on each machine. Give a GitHub file URL, <git-url>#<path>, or a path from / or ~/.`;
  } catch (e) {
    return (e as Error).message;
  }
  return null;
}

export interface ImportOptions extends FetchOptions {
  /** The copy's name, in place of the source's file name. */
  name?: string;
  now?: () => Date;
}

/** A copy ready to write, with what it replaces. */
export interface RulesImport {
  name: string;
  file: string;
  path: string;
  header: RulesHeader;
  /** The source's text, which follows the header unchanged. */
  text: string;
  /** The copy already there under this name, if any. */
  replaces: { source: string | null; copied: string | null; edited: boolean } | null;
}

const day = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Reads a rules file and makes its copy, writing nothing. It refuses what can't be rules, and a total too big to send. */
export function prepareImport(run: Runner, root: string, source: string, opts: ImportOptions = {}): RulesImport {
  const s = source.trim();
  const problem = sourceProblem(s, 'rules') ?? (/[\r\n]|-->/.test(s) ? 'A rules file\'s source is one line, with no -->, since its copy\'s header holds it.' : null);
  if (problem) throw new AccError('bad-rules', problem);
  const name = opts.name ? checkName(opts.name) : rulesName(s, opts.base, opts.home);
  const fetched = fetchSource(run, s, 'rules', { ...opts, commit: true });
  const text = fetched.text;
  if (!text.trim()) throw new AccError('bad-rules', `${s} is empty: there are no rules in it to copy in.`);
  if (text.includes('\u0000')) throw new AccError('bad-rules', `${s} isn't text, so it can't be rules.`);
  const file = `${RULES_DIR}/${name}.md`;
  const path = join(root, RULES_DIR, `${name}.md`);
  const copies = importedRules(root);
  const there = copies.find((c) => c.name === name);
  const header: RulesHeader = { source: recordedSource(s, { base: opts.base, home: opts.home, root, kind: 'rules' }), commit: fetched.commit, copied: day((opts.now ?? (() => new Date()))()), sha256: rulesDigest(text) };
  const imp = { name, file, path, header, text, replaces: there ? { source: there.header?.source ?? null, copied: there.header?.copied ?? null, edited: there.edited } : null };
  checkTotal(root, [imp], s);
  return imp;
}

/** Refuses copies that would bring every copy together over what a packet can carry. */
function checkTotal(root: string, imps: Pick<RulesImport, 'name' | 'header' | 'text'>[], what: string): void {
  const names = new Set(imps.map((i) => i.name));
  const total = importedRules(root).filter((c) => !names.has(c.name)).reduce((n, c) => n + c.bytes, 0) + imps.reduce((n, i) => n + Buffer.byteLength(renderHeader(i.header) + i.text), 0);
  if (total > RULES_TOTAL_MAX_BYTES) {
    throw new AccError('bad-rules', `With ${what}, the copied-in rules would come to ${Math.ceil(total / 1024)} KB, over the ${RULES_TOTAL_MAX_BYTES / 1024} KB every packet, review and analysis can carry. Copy in less, or remove a copy from ${RULES_DIR}/ first.`);
  }
}

/**
 * Several rules files read together, as a team template names them (GH-108), writing nothing. Each is read
 * before any is written, so one that can't be read leaves the repo as it was. A copy already here is kept.
 */
export function prepareImports(run: Runner, root: string, sources: string[], opts: ImportOptions = {}): RulesImport[] {
  const imps = sources.map((s) => prepareImport(run, root, s, opts));
  checkTotal(root, imps.filter((i) => !i.replaces), sources.length === 1 ? sources[0]! : 'the template\'s rules');
  return imps;
}

/** Writes a prepared copy: its header, then the source's text as it was read. */
export function writeImport(imp: RulesImport): void {
  mkdirSync(dirname(imp.path), { recursive: true });
  writeFileSync(`${imp.path}.tmp`, renderHeader(imp.header) + imp.text);
  renameSync(`${imp.path}.tmp`, imp.path);
}

/**
 * `acc rules import`: copies a rules file into .acc/rules/ with its header. A copy already there is replaced
 * only with `force`, and `dryRun` writes nothing. A person reviews it and commits it.
 */
export function importRules(run: Runner, root: string, source: string, opts: ImportOptions & { force?: boolean; dryRun?: boolean } = {}): RulesImport & { written: boolean } {
  const imp = prepareImport(run, root, source, opts);
  if (imp.replaces && !opts.force && !opts.dryRun) {
    const from = imp.replaces.source ? `, copied from ${imp.replaces.source}${imp.replaces.copied ? ` on ${imp.replaces.copied}` : ''}` : '';
    throw new AccError('exists', `${imp.file} is already here${from}. To replace it with ${source.trim()} as it is now, add --force; git shows the change before you commit it. Or give this copy another name with --name.`);
  }
  if (!opts.dryRun) writeImport(imp);
  return { ...imp, written: !opts.dryRun };
}

// ---------------------------------------------------------------- whether a source has changed

export type CopyState =
  /** The source reads as it did when it was copied. */
  | 'unchanged'
  /** The source has changed since. */
  | 'changed'
  /** The source couldn't be read: gh or git failed, or it isn't there now. */
  | 'unreachable'
  /** The source is a file that isn't on this machine. */
  | 'not-here'
  /** The time ran out before it was read. */
  | 'unchecked'
  /** Its header can't be read, or names a source acc won't fetch. */
  | 'bad-header'
  /** It has no header: rules kept here, with no source. */
  | 'local';

export interface CopyStatus {
  name: string;
  file: string;
  source: string | null;
  commit: string | null;
  copied: string | null;
  state: CopyState;
  edited: boolean;
  reason: string | null;
  /** The copy's rules, and the source's now when it was read: what rulesDiff compares. */
  body: string;
  now: string | null;
}

const RULES_TIMEOUT_MS = 60_000;

/**
 * Whether each copy's source has changed since it was copied in, compared by digest, so an edit made here
 * never counts as a change there. Every read shares one wait, `timeoutMs`; a copy not reached in time is
 * unchecked. A header's source is untrusted, as a committed config's is: one acc won't fetch never reaches
 * gh or git. It writes nothing.
 */
export function rulesStatus(run: Runner, root: string, opts: FetchOptions = {}, only?: string): CopyStatus[] {
  const total = opts.timeoutMs ?? RULES_TIMEOUT_MS;
  const deadline = Date.now() + total;
  const home = opts.home ?? opts.env?.HOME ?? homedir();
  // With `only`, just that copy's source is read, so a slow or unreachable other one costs nothing.
  return importedRules(root).filter((c) => only === undefined || c.name === only).map((c): CopyStatus => {
    const base = { name: c.name, file: c.file, source: c.header?.source ?? null, commit: c.header?.commit ?? null, copied: c.header?.copied ?? null, edited: c.edited, body: c.body, now: null };
    if (c.problem) return { ...base, state: 'bad-header', reason: c.problem };
    if (!c.header) return { ...base, state: 'local', reason: null };
    const src = c.header.source;
    const problem = sourceProblem(src, 'rules');
    if (problem) return { ...base, state: 'bad-header', reason: `Its header's source, ${src}, can't be read: ${problem}` };
    let local: string | null = null;
    try {
      const parsed = parseSource(src, root, home, 'rules');
      if (parsed.kind === 'file') local = parsed.path;
    } catch (e) {
      return { ...base, state: 'bad-header', reason: `Its header's source, ${src}, can't be read: ${(e as Error).message}` };
    }
    if (local && !existsSync(local)) return { ...base, state: 'not-here', reason: `It came from ${src}, which isn't on this machine.` };
    if (Date.now() >= deadline) return { ...base, state: 'unchecked', reason: `The ${Math.ceil(total / 1000)} seconds ran out before ${src} was read.` };
    let text: string;
    try {
      text = fetchSource(run, src, 'rules', { ...opts, base: root, home, timeoutMs: total, deadline }).text;
    } catch (e) {
      return { ...base, state: 'unreachable', reason: `Couldn't read ${src}: ${(e as Error).message}` };
    }
    return { ...base, now: text, state: rulesDigest(text) === c.header.sha256 ? 'unchanged' : 'changed', reason: null };
  });
}

export interface RulesDiff {
  name: string;
  file: string;
  source: string | null;
  state: CopyState;
  edited: boolean;
  reason: string | null;
  /** A unified diff from the repo's copy to the source now: what copying it in again would change. Null when they're the same, or the source wasn't read. */
  diff: string | null;
}

/** A unified diff from one text to another, by git, labelled with where each is. Empty when they're the same. */
function unifiedDiff(run: Runner, from: string, to: string, labels: { from: string; to: string }): string {
  if (from === to) return '';
  const dir = mkdtempSync(join(tmpdir(), 'acc-rules-diff-'));
  try {
    mkdirSync(join(dir, 'copy'));
    mkdirSync(join(dir, 'source'));
    writeFileSync(join(dir, 'copy', 'rules.md'), from);
    writeFileSync(join(dir, 'source', 'rules.md'), to);
    const r = run('git', ['-c', 'core.quotepath=off', 'diff', '--no-index', '--no-color', '--no-ext-diff', '--no-prefix', '--', 'copy/rules.md', 'source/rules.md'], { cwd: dir });
    if (r.code !== 0 && r.code !== 1) throw new AccError('rules', `git couldn't compare the copy with its source: ${r.stderr.trim().split('\n')[0] ?? `git exited ${r.code}`}`);
    const lines = r.stdout.split('\n');
    const at = lines.findIndex((l) => l.startsWith('@@'));
    return [`--- ${labels.from}`, `+++ ${labels.to}`, ...lines.slice(at < 0 ? lines.length : at)].join('\n').trimEnd();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * `acc rules diff`: how each copy, or the one named, differs from its source as it is now. It writes nothing:
 * copying one in again is `acc rules import <source> --name <name> --force`.
 */
export function rulesDiff(run: Runner, root: string, name: string | undefined, opts: FetchOptions = {}): RulesDiff[] {
  const only = name ? name.trim().replace(/\.md$/i, '') : undefined;
  const wanted = rulesStatus(run, root, opts, only);
  if (name && !wanted.length) throw new AccError('usage', `There's no ${RULES_DIR}/${name}.md. acc rules list shows the copies.`);
  return wanted.map((c) => ({
    name: c.name, file: c.file, source: c.source, state: c.state, edited: c.edited, reason: c.reason,
    diff: c.state === 'changed' || (c.now !== null && c.edited) ? unifiedDiff(run, c.body, c.now ?? '', { from: `${c.file} (this repo's copy)`, to: `${c.source} (the source now)` }) || null : null,
  }));
}

/** The command that copies one in again, replacing it: what a person runs once they've read the diff. */
export const reimportCommand = (c: Pick<CopyStatus, 'name' | 'source'>): string => `acc rules import '${(c.source ?? '').replace(/'/g, `'\\''`)}' --name ${c.name} --force`;
