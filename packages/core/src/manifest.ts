/**
 * A Salesforce ticket's manifest (T-101), for the salesforce profile (D-003). Salesforce's own CLI maps the
 * ticket branch's changed paths to components (`sf project generate manifest`), never acc's own path rules.
 * Each type and member is checked against the development org, the environment's org (D-015). "Check
 * against the org" retrieves the ticket's components into a throwaway worktree, never the ticket's own, and
 * compares each with the branch; where the project uses source tracking, the org's changes the branch lacks
 * are listed too. A deleted component goes in destructiveChangesPost.xml, never package.xml, and acc never
 * deploys either (D-016). Nothing reaches the ticket's branch but by a person's own command: retrieve one
 * component into it, or commit the manifest to it, each as a commit.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileId } from './analyze.ts';
import { writeAtomic } from './atomic.ts';
import type { Config, Environment } from './config.ts';
import { environmentNamed, filesFor } from './drift.ts';
import { AccError, parseJsonOutput, type Runner, sfEnv } from './exec.ts';
import { baseFor, lastLine, listed, packageDirs, readList, under } from './gates.ts';
import { readLedger, type Task } from './ledger.ts';
import { branchFiles, nulPaths } from './overlap.ts';
import type { RepoPaths } from './paths.ts';
import { type SlotOptions, withSlot } from './semaphore.ts';
import { parseManifest } from './setup.ts';
import { usesSourceTracking } from './source-tracking.ts';
import { NO_STEPS, type Steps } from './steps.ts';
import { escapeMarkup, plural } from './text.ts';

/** Where "Add to the ticket's branch" puts a ticket's manifest: manifest/tickets/<ticket key>/. */
export const TICKET_MANIFESTS = 'manifest/tickets';
export const PACKAGE_FILE = 'package.xml';
/** The deletions' file, as Salesforce names one applied after the deploy. */
export const DESTRUCTIVE_FILE = 'destructiveChangesPost.xml';

/** The longest a manifest's build, check or retrieve may take: the org's retrieve waits up to 60 minutes, and the lists and sf's mapping take some too. */
export const MANIFEST_TIMEOUT_MS = 90 * 60_000;

/** What the page and the CLI say about deletions: they're kept apart, and acc never deploys them. */
export const NEVER_DEPLOYED = 'Deletions are kept apart, in destructiveChangesPost.xml. The Command Center never deploys them, nor this manifest.';

/** What a component that differs in the org says. */
export const ORG_DIFFERS = 'The org\'s copy differs from this ticket\'s branch: changed in the org after the last commit.';

/** One type of a manifest, and its members as Salesforce writes them. */
export interface ManifestType {
  name: string;
  members: string[];
}

/** A type the org doesn't know, a member it doesn't hold, or a check that couldn't run, with why. Never dropped silently. */
export interface ManifestFinding {
  type: string;
  member: string | null;
  kind: 'unknown-type' | 'missing' | 'unchecked';
  why: string;
}

/** A component whose org copy differs from the branch: its files, and the difference (the branch's side first). */
export interface OrgCopy {
  type: string;
  member: string;
  files: string[];
  diff: string;
}

/** A change in the org that the branch doesn't have, as source tracking lists it. */
export interface OrgChange {
  type: string;
  member: string;
  /** What the org did: Add, Changed or Delete, as sf says. */
  state: string;
  /** Where it goes in the project, when sf says. */
  path: string | null;
}

/** What "Check against the org" found. */
export interface OrgCheck {
  at: string;
  org: string;
  /** The branch's commit the org's copies were compared with. */
  sha: string;
  differs: OrgCopy[];
  /** How many of the ticket's components the org holds as the branch does. */
  same: number;
  /** Files the org's copies hold that no component of the ticket names, with the files. */
  other: string[];
  /** The org's changes the branch lacks, or why that check isn't available. */
  changes: { available: true; items: OrgChange[] } | { available: false; why: string };
}

/** A ticket's manifest, as acc keeps it in .git/acc/manifests/<task>.json. */
export interface TicketManifest {
  v: 1;
  task: string;
  key: string;
  env: string;
  /** The development org's alias, or null when the environment has none. */
  org: string | null;
  branch: string;
  /** The branch's commit it was built at. */
  sha: string;
  apiVersion: string;
  /** The changed paths it was built from: kept, deleted, and those outside the project's source folders or environment-specific, left out. */
  paths: { changed: string[]; deleted: string[]; leftOut: string[] };
  package: string;
  types: ManifestType[];
  /** destructiveChangesPost.xml, or null when the ticket deletes nothing. */
  destructive: string | null;
  deletions: ManifestType[];
  /** The components the ticket creates, as `Type:Member`: the org needn't hold them yet. */
  created: string[];
  findings: ManifestFinding[];
  /** Why the org wasn't asked, when it wasn't. */
  unchecked: string | null;
  check: OrgCheck | null;
  at: string;
}

export interface ManifestDeps {
  run: Runner;
  now: () => Date;
  steps?: Steps;
  slots?: SlotOptions;
}

// ---------------------------------------------------------------- reading and writing manifests

const XML_IN: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' };
const unXml = (s: string): string => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : XML_IN[e.toLowerCase()]!));

/** A package.xml's types and members in order, as setup's parseManifest reads them, with XML's escapes read. */
export function manifestTypes(xml: string): ManifestType[] {
  return [...parseManifest(xml).types].map(([name, members]) => ({ name: unXml(name), members: [...members].map(unXml) }));
}

/** A manifest as Salesforce's CLI writes one: types by name, members in order, four spaces a level. */
export function manifestXml(types: ManifestType[], version: string): string {
  const body = [...types].sort((a, b) => a.name.localeCompare(b.name)).filter((t) => t.members.length).map((t) =>
    `    <types>\n${t.members.map((m) => `        <members>${escapeMarkup(m)}</members>\n`).join('')}        <name>${escapeMarkup(t.name)}</name>\n    </types>\n`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${body}    <version>${version}</version>\n</Package>\n`;
}

/** Each member as `Type:Member`, the form sf's --metadata takes. */
export const componentsOf = (types: ManifestType[]): string[] => types.flatMap((t) => t.members.map((m) => `${t.name}:${m}`));

/** A `Type:Member` split at its first colon. Null when it has no type or no member. */
export function splitComponent(c: string): { type: string; member: string } | null {
  const at = c.indexOf(':');
  if (at <= 0 || at === c.length - 1) return null;
  return { type: c.slice(0, at), member: c.slice(at + 1) };
}

/** The project's sourceApiVersion, from sfdx-project.json in `dir`. */
export function sourceApiVersion(dir: string): string {
  let v: unknown;
  try {
    v = (JSON.parse(readFileSync(join(dir, 'sfdx-project.json'), 'utf8')) as { sourceApiVersion?: unknown }).sourceApiVersion;
  } catch {
    throw new AccError('usage', 'There\'s no sfdx-project.json to read the API version from, so this isn\'t a Salesforce project\'s branch.');
  }
  if (typeof v !== 'string' || !/^\d+\.\d+$/.test(v)) throw new AccError('usage', 'sfdx-project.json has no sourceApiVersion, so Salesforce\'s CLI doesn\'t know which API version to write the manifest for. Add one, such as "62.0".');
  return v;
}

/** Where acc keeps a task's manifest. */
export const manifestPath = (paths: Pick<RepoPaths, 'stateDir'>, task: string): string => join(paths.stateDir, 'manifests', `${fileId(task)}.json`);

/** The task's kept manifest, or null with none, or one this version doesn't read. */
export function readManifest(paths: Pick<RepoPaths, 'stateDir'>, task: string): TicketManifest | null {
  try {
    const m = JSON.parse(readFileSync(manifestPath(paths, task), 'utf8')) as TicketManifest;
    return m.v === 1 && m.task === task && typeof m.package === 'string' && Array.isArray(m.types) && Array.isArray(m.findings) ? m : null;
  } catch {
    return null;
  }
}

const keep = (paths: Pick<RepoPaths, 'stateDir'>, m: TicketManifest): void => {
  mkdirSync(join(paths.stateDir, 'manifests'), { recursive: true });
  writeAtomic(manifestPath(paths, m.task), JSON.stringify(m, null, 2) + '\n');
};

// ---------------------------------------------------------------- the ticket and its branch

/** The task, its ticket key, environment and branch, or why it has no manifest. */
export function manifestRefusal(config: { profile: string }, task: Pick<Task, 'id' | 'run'> | undefined, id: string): string | null {
  if (config.profile !== 'salesforce') return 'A manifest lists Salesforce components, and this isn\'t a Salesforce project.';
  if (!task) return `No task ${id}.`;
  if (!task.run?.branch) return `${id} has no branch yet, so there's nothing to build a manifest from. Dispatch it first.`;
  return null;
}

/** Where a ticket's manifest goes in its branch: manifest/tickets/<ticket key>/. */
export const ticketManifestDir = (key: string): string => `${TICKET_MANIFESTS}/${fileId(key)}`;

/**
 * The paths a ticket's branch changed: the one place the manifest reads them, so T-99's kept list can stand in
 * for branchFiles here. Commits since the branch left its environment's branch, and in its worktree what
 * isn't committed yet.
 */
export function ticketPaths(run: Runner, root: string, task: Pick<Task, 'environment' | 'run'>, env: Pick<Environment, 'branch'>): string[] {
  return branchFiles(run, root, env.branch, task.run!.branch!, task.run!.worktree);
}

interface Ticket {
  task: Task;
  key: string;
  env: Environment;
  branch: string;
}

function ticketFor(paths: RepoPaths, config: Config, id: string): Ticket {
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  const why = manifestRefusal(config, task, id);
  if (why) throw new AccError('refused', why);
  return { task: task!, key: task!.source.key ?? task!.id, env: environmentNamed(config, task!.environment), branch: task!.run!.branch! };
}

const git = (run: Runner, cwd: string, args: string[]) => run('git', args, { cwd });

/** A detached worktree at `ref` under acc's state, removed after `fn`, whatever it does: a scratch folder, never the ticket's worktree. */
function scratchCheckout<T>(paths: RepoPaths, run: Runner, ref: string, name: string, fn: (dir: string) => T): T {
  const dir = join(paths.stateDir, 'manifests', name);
  mkdirSync(dirname(dir), { recursive: true });
  const add = git(run, paths.root, ['worktree', 'add', '--detach', '--quiet', dir, ref]);
  if (add.code !== 0) throw new AccError('git', `Couldn't make a scratch checkout of the branch: ${lastLine(add.stderr)}`);
  try {
    return fn(dir);
  } finally {
    git(run, paths.root, ['worktree', 'remove', '--force', dir]);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    git(run, paths.root, ['worktree', 'prune']);
  }
}

/** The ticket's worktree, when it has one on disk. */
const worktreeOf = (t: Ticket): string | null => (t.task.run?.worktree && existsSync(t.task.run.worktree) ? t.task.run.worktree : null);

// ---------------------------------------------------------------- Salesforce's CLI

/** What sf said, from its --json: its result, or why it failed. */
function sfJson<T>(r: { code: number; stdout: string; stderr: string }): { ok: true; result: T } | { ok: false; message: string } {
  try {
    const j = parseJsonOutput<{ status?: number; result?: T; message?: string }>(r.stdout);
    if (r.code === 0 && (j.status ?? 0) === 0) return { ok: true, result: j.result as T };
    return { ok: false, message: (j.message ?? '').trim() || lastLine(r.stderr) || `exit ${r.code}` };
  } catch {
    return { ok: false, message: lastLine(r.stderr || r.stdout) || `exit ${r.code}` };
  }
}

const sf = (run: Runner, cwd: string, args: string[], timeoutMs = 10 * 60_000) => run('sf', args, { cwd, env: sfEnv(), timeoutMs });

/**
 * sf's manifest for `files` in the project at `dir`: package.xml, or with `post`, destructiveChangesPost.xml.
 * Each path is a --source-dir, so sf maps it: a field under its object, a bundle as one member.
 */
export function generateManifest(run: Runner, dir: string, files: string[], apiVersion: string, out: string, post = false): string {
  mkdirSync(out, { recursive: true });
  const args = ['project', 'generate', 'manifest', ...files.flatMap((f) => ['--source-dir', f]), '--api-version', apiVersion, '--output-dir', out, ...(post ? ['--type', 'post'] : ['--name', PACKAGE_FILE]), '--json'];
  const r = sfJson<{ path?: string }>(sf(run, dir, args));
  if (!r.ok) throw new AccError('sf', `Salesforce's CLI couldn't build the manifest: ${r.message}`);
  const file = r.result?.path ?? join(out, post ? DESTRUCTIVE_FILE : PACKAGE_FILE);
  try {
    return readFileSync(file, 'utf8');
  } catch {
    throw new AccError('sf', `Salesforce's CLI said it wrote ${file}, and there's nothing there.`);
  }
}

/** The org's metadata types: each it knows (its child types too), and those kept in folders. */
export function orgTypes(run: Runner, dir: string, org: string, apiVersion: string): { known: Set<string>; inFolder: Set<string> } | string {
  const r = sfJson<{ metadataObjects?: { xmlName?: string; childXmlNames?: string[]; inFolder?: boolean }[] }>(sf(run, dir, ['org', 'list', 'metadata-types', '--target-org', org, '--api-version', apiVersion, '--json']));
  if (!r.ok) return r.message;
  const known = new Set<string>();
  const inFolder = new Set<string>();
  for (const o of r.result?.metadataObjects ?? []) {
    if (!o.xmlName) continue;
    known.add(o.xmlName);
    for (const c of o.childXmlNames ?? []) known.add(c);
    if (o.inFolder) inFolder.add(o.xmlName);
  }
  return { known, inFolder };
}

/** A member's name as the org may list it: as it is, and with its %-encoding read. */
const forms = (name: string): string[] => {
  try {
    return [name, decodeURIComponent(name)];
  } catch {
    return [name];
  }
};

/**
 * The members of one type the org holds, by one call for the type (one a folder, for a type kept in
 * folders: a member is `<folder>/<name>`). A string is why the org couldn't say.
 */
export function orgMembers(run: Runner, dir: string, org: string, apiVersion: string, type: string, folder?: string): Set<string> | string {
  const args = ['org', 'list', 'metadata', '--metadata-type', type, ...(folder ? ['--folder', folder] : []), '--target-org', org, '--api-version', apiVersion, '--json'];
  const r = sfJson<{ fullName?: string }[] | { fullName?: string } | null>(sf(run, dir, args));
  if (!r.ok) return r.message;
  const list = Array.isArray(r.result) ? r.result : r.result ? [r.result] : [];
  return new Set(list.flatMap((m) => (m.fullName ? forms(m.fullName) : [])));
}

/**
 * Each type checked against the org's own list, and each member against what the org holds, batched per
 * type. A type the org doesn't know, or a member it doesn't hold that the ticket doesn't create, is a
 * finding with why.
 */
export function checkMembers(run: Runner, dir: string, org: string, apiVersion: string, types: ManifestType[], created: Set<string>): ManifestFinding[] {
  const known = orgTypes(run, dir, org, apiVersion);
  if (typeof known === 'string') return [{ type: '', member: null, kind: 'unchecked', why: `The org couldn't list its metadata types, so nothing was checked against it: ${known}` }];
  const out: ManifestFinding[] = [];
  for (const t of types) {
    if (!known.known.has(t.name)) {
      out.push({ type: t.name, member: null, kind: 'unknown-type', why: `The org doesn't know ${t.name} at API version ${apiVersion}, so a deploy would fail on ${plural(t.members.length, 'member')}.` });
      continue;
    }
    const batches = known.inFolder.has(t.name)
      ? [...new Set(t.members.map((m) => m.split('/')[0]!))].map((f) => ({ folder: f as string | undefined, members: t.members.filter((m) => m.split('/')[0] === f) }))
      : [{ folder: undefined, members: t.members }];
    for (const b of batches) {
      const held = orgMembers(run, dir, org, apiVersion, t.name, b.folder);
      if (typeof held === 'string') {
        out.push({ type: t.name, member: null, kind: 'unchecked', why: `The org couldn't list its ${t.name}${b.folder ? ` in ${b.folder}` : ''}: ${held}` });
        continue;
      }
      for (const m of b.members) {
        if (forms(m).some((f) => held.has(f)) || created.has(`${t.name}:${m}`)) continue;
        out.push({ type: t.name, member: m, kind: 'missing', why: `The org doesn't hold ${t.name} ${m}, and this ticket doesn't create it: something it needs may be missing there.` });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- building it

/** Paths the base commit holds, of `files`. */
function inCommit(run: Runner, root: string, ref: string, files: string[]): Set<string> {
  if (!files.length) return new Set();
  const r = git(run, root, ['ls-tree', '-r', '--name-only', '-z', ref, '--', ...files]);
  return new Set(r.code === 0 ? nulPaths(r.stdout) : []);
}

/** The files `dir` holds: tracked and untracked, but not ignored, and still on disk. */
function heldFiles(run: Runner, dir: string): string[] {
  const r = git(run, dir, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  return r.code === 0 ? nulPaths(r.stdout).filter((f) => existsSync(join(dir, f))) : [];
}

/** destructiveChangesPost.xml for the deleted files: sf maps the base commit's copies of them, in a scratch project. */
function deletionsManifest(paths: RepoPaths, run: Runner, base: string, deleted: string[], apiVersion: string, scratch: string): string {
  const project = join(scratch, 'deleted');
  mkdirSync(project, { recursive: true });
  const show = (file: string) => git(run, paths.root, ['show', `${base}:${file}`]);
  const sfdx = show('sfdx-project.json');
  writeFileSync(join(project, 'sfdx-project.json'), sfdx.code === 0 ? sfdx.stdout : JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: apiVersion }));
  const there: string[] = [];
  for (const f of deleted) {
    const r = show(f);
    if (r.code !== 0) continue;
    mkdirSync(dirname(join(project, f)), { recursive: true });
    writeFileSync(join(project, f), r.stdout);
    there.push(f);
  }
  return there.length ? generateManifest(run, project, there, apiVersion, join(scratch, 'deleted-out'), true) : '';
}

/**
 * Builds a ticket's manifest, keeps it, and returns it. sf maps the branch's changed paths, as the ticket's
 * worktree holds them, or a scratch checkout of the branch when it has none. Each type and member is
 * checked against the development org, when the environment names one. With `check`, the org's copies are
 * compared with the branch too (checkAgainstOrg).
 */
export function buildManifest(paths: RepoPaths, config: Config, id: string, deps: ManifestDeps, opts: { check?: boolean } = {}): TicketManifest {
  const steps = deps.steps ?? NO_STEPS;
  const t = ticketFor(paths, config, id);
  const ref = `refs/heads/${t.branch}`;
  const tip = git(deps.run, paths.root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
  if (tip.code !== 0) throw new AccError('no-branch', `${t.branch} isn't in this clone, so there's no branch to build ${id}'s manifest from.`);
  const sha = tip.stdout.trim();
  const all = steps.step('paths', 'Read the ticket\'s changed files', () => ticketPaths(deps.run, paths.root, t.task, t.env));

  const build = (dir: string): TicketManifest => {
    const apiVersion = sourceApiVersion(dir);
    const specific = readList(dir, config.environmentSpecific);
    const source = under(all, packageDirs(dir)).filter((f) => !listed(f, specific));
    const leftOut = all.filter((f) => !source.includes(f));
    const changed = source.filter((f) => existsSync(join(dir, f)));
    const deleted = source.filter((f) => !existsSync(join(dir, f)));
    const base = baseFor(deps.run, paths.root, t.env, ref);
    const scratch = join(paths.stateDir, 'manifests', `${fileId(id)}-${deps.now().getTime()}.out`);
    try {
      const { pkg, deletionsXml, createdXml, kept } = steps.step('generate', 'Build the manifest with Salesforce\'s CLI', () => {
        const inBase = inCommit(deps.run, paths.root, base, changed);
        const added = changed.filter((f) => !inBase.has(f));
        const deletedXml = deleted.length ? deletionsManifest(paths, deps.run, base, deleted, apiVersion, scratch) : '';
        // A file deleted from a component the branch still holds, such as one file of a bundle, changes that
        // component: it isn't a deletion, and the component's other files go to sf with the changed ones.
        const held = under(heldFiles(deps.run, dir), packageDirs(dir));
        const still = new Map<string, string[]>();
        for (const d of manifestTypes(deletedXml)) {
          for (const m of d.members) {
            const files = forms(m).flatMap((n) => filesFor(d.name, n, held));
            if (files.length) still.set(`${d.name}:${m}`, files);
          }
        }
        const sources = [...new Set([...changed, ...[...still.values()].flat()])].sort();
        return {
          pkg: sources.length ? generateManifest(deps.run, dir, sources, apiVersion, join(scratch, 'package')) : manifestXml([], apiVersion),
          deletionsXml: deletedXml,
          createdXml: added.length ? generateManifest(deps.run, dir, added, apiVersion, join(scratch, 'created')) : '',
          kept: new Set(still.keys()),
        };
      });
      const types = manifestTypes(pkg);
      const deletions = manifestTypes(deletionsXml).map((d) => ({ name: d.name, members: d.members.filter((m) => !kept.has(`${d.name}:${m}`)) })).filter((d) => d.members.length);
      // sf's own file as it wrote it, unless a member came out of it.
      const destructive = !deletions.length ? null : kept.size ? manifestXml(deletions, apiVersion) : deletionsXml;
      const created = componentsOf(manifestTypes(createdXml));
      let findings: ManifestFinding[] = [];
      const unchecked = !t.env.org ? `${t.env.name} has no org, so nothing was checked against one.` : null;
      if (t.env.org && types.length) findings = steps.step('types', `Check each type and member against ${t.env.org}`, () => checkMembers(deps.run, dir, t.env.org!, apiVersion, types, new Set(created)));
      return {
        v: 1, task: id, key: t.key, env: t.env.branch, org: t.env.org, branch: t.branch, sha, apiVersion,
        paths: { changed, deleted, leftOut }, package: pkg, types, destructive, deletions, created, findings, unchecked, check: null, at: deps.now().toISOString(),
      };
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  };
  const wt = worktreeOf(t);
  const m = wt ? build(wt) : scratchCheckout(paths, deps.run, sha, `${fileId(id)}-${deps.now().getTime()}`, build);
  if (opts.check) {
    if (!t.env.org) throw new AccError('refused', `${t.env.name} has no org to check ${id}'s manifest against.`);
    m.check = checkAgainstOrg(paths, config, t, m, deps);
  }
  keep(paths, m);
  return m;
}

/** The org's tracked changes the branch lacks, by `sf project retrieve preview`, or why that isn't available. */
export function orgChanges(run: Runner, dir: string, config: Pick<Config, 'sourceTracking'>, org: string, inTicket: Set<string>): OrgCheck['changes'] {
  if (!usesSourceTracking(config)) return { available: false, why: 'This project doesn\'t use source tracking, so the org can\'t say what changed there. To change that, turn on Source tracking under Limits and checks in the project\'s settings.' };
  type Item = { fullName?: string; type?: string; state?: string; path?: string; ignored?: boolean };
  const r = sfJson<{ toRetrieve?: Item[]; conflicts?: Item[] }>(sf(run, dir, ['project', 'retrieve', 'preview', '--target-org', org, '--json']));
  if (!r.ok) return { available: false, why: `The org couldn't say what changed there: ${r.message}` };
  const seen = new Set<string>();
  const items: OrgChange[] = [];
  for (const i of [...(r.result?.conflicts ?? []), ...(r.result?.toRetrieve ?? [])]) {
    if (!i.type || !i.fullName || i.ignored) continue;
    const c = `${i.type}:${i.fullName}`;
    if (seen.has(c) || inTicket.has(c)) continue;
    seen.add(c);
    items.push({ type: i.type, member: i.fullName, state: i.state ?? 'Changed', path: i.path ?? null });
  }
  return { available: true, items: items.sort((a, b) => `${a.type}:${a.member}`.localeCompare(`${b.type}:${b.member}`)) };
}

/**
 * Check against the org: the ticket's components are retrieved from the development org into a scratch
 * checkout of the branch's commit, never the ticket's worktree, and each is compared with the branch. The
 * org's own changes come from source tracking, in the ticket's worktree where it has one.
 */
function checkAgainstOrg(paths: RepoPaths, config: Config, t: Ticket, m: TicketManifest, deps: ManifestDeps): OrgCheck {
  const steps = deps.steps ?? NO_STEPS;
  const org = t.env.org!;
  const compared = !m.types.length ? { differs: [], same: 0, other: [] } : scratchCheckout(paths, deps.run, m.sha, `${fileId(m.task)}-${deps.now().getTime()}.org`, (dir) => steps.step('retrieve', `Retrieve the ticket's components from ${org}`, () => {
    const manifest = join(dir, '.acc-ticket-package.xml');
    writeFileSync(manifest, m.package);
    const args = ['project', 'retrieve', 'start', '--manifest', manifest, '--target-org', org, '--ignore-conflicts', '--wait', '60', '--json'];
    const r = withSlot(() => deps.run('sf', args, { cwd: dir, timeoutMs: 70 * 60_000, env: sfEnv(), nice: true }), { owner: { what: `Manifest check for ${m.task}`, env: t.env.branch, project: config.project }, ...deps.slots });
    rmSync(manifest, { force: true });
    const said = sfJson<unknown>(r);
    if (!said.ok) throw new AccError('sf', `The retrieve from ${org} failed: ${said.message}`);
    const status = git(deps.run, dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    if (status.code !== 0) throw new AccError('git', `git status failed in the scratch checkout: ${lastLine(status.stderr)}`);
    const expected = [...readList(dir, config.knownDrift), ...readList(dir, config.environmentSpecific)];
    const source = packageDirs(dir);
    const entries = status.stdout.split('\0').filter(Boolean).map((e) => ({ added: e.startsWith('??'), path: e.slice(3) }));
    const found = entries.filter((e) => under([e.path], source).length && !listed(e.path, expected));
    const files = found.map((e) => e.path);
    const claimed = new Set<string>();
    const differs: OrgCopy[] = [];
    for (const type of m.types) {
      for (const member of type.members) {
        const mine = forms(member).flatMap((n) => filesFor(type.name, n, files));
        const own = [...new Set(mine)].sort();
        if (!own.length) continue;
        for (const f of own) claimed.add(f);
        differs.push({ type: type.name, member, files: own, diff: diffOf(deps.run, dir, own, new Set(found.filter((e) => e.added).map((e) => e.path))) });
      }
    }
    return { differs, same: componentsOf(m.types).length - differs.length, other: files.filter((f) => !claimed.has(f)) };
  }));
  const inTicket = new Set([...componentsOf(m.types), ...componentsOf(m.deletions)]);
  const changes = steps.step('preview', `Ask ${org} what changed there`, () => orgChanges(deps.run, worktreeOf(t) ?? paths.root, config, org, inTicket));
  return { at: deps.now().toISOString(), org, sha: m.sha, ...compared, changes };
}

/** The difference between the branch's files and the org's, the branch's side first: a file only the org has is all added. */
function diffOf(run: Runner, dir: string, files: string[], added: Set<string>): string {
  const tracked = files.filter((f) => !added.has(f));
  const parts: string[] = [];
  if (tracked.length) parts.push(git(run, dir, ['diff', '--no-color', '--', ...tracked]).stdout);
  for (const f of files.filter((x) => added.has(x))) parts.push(git(run, dir, ['diff', '--no-color', '--no-index', '--', '/dev/null', f]).stdout);
  return parts.join('').trimEnd();
}

// ---------------------------------------------------------------- a person's changes to the branch

/** Why the ticket's branch can't take a commit from here now, or null. */
function branchRefusal(run: Runner, t: Ticket, dir: string): string | null {
  if (t.task.state === 'running') return `${t.task.id}'s builder is working in its branch now. Wait for it to finish.`;
  const status = git(run, dir, ['status', '--porcelain=v1', '-z']);
  if (status.code !== 0) return `git couldn't read ${t.task.id}'s worktree: ${lastLine(status.stderr)}`;
  if (status.stdout.split('\0').some((e) => e.length > 3 && !e.startsWith('??'))) return `${t.task.id}'s worktree has changes that aren't committed. Commit or discard them first.`;
  return null;
}

/** `git status`'s entries in `dir`, untracked files one by one, each as its two status letters, a space and the path. */
function changedFiles(run: Runner, dir: string): string[] {
  return git(run, dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout.split('\0').filter(Boolean);
}

/** `fn` in the ticket's worktree, or in a scratch worktree on its branch when it has none, removed after. */
function onBranch<T>(paths: RepoPaths, run: Runner, t: Ticket, now: () => Date, fn: (dir: string) => T): T {
  const wt = worktreeOf(t);
  if (wt) return fn(wt);
  const dir = join(paths.stateDir, 'manifests', `${fileId(t.task.id)}-${now().getTime()}.branch`);
  mkdirSync(dirname(dir), { recursive: true });
  const add = git(run, paths.root, ['worktree', 'add', '--quiet', dir, t.branch]);
  if (add.code !== 0) throw new AccError('git', `Couldn't check out ${t.branch}: ${lastLine(add.stderr)}`);
  try {
    return fn(dir);
  } finally {
    git(run, paths.root, ['worktree', 'remove', '--force', dir]);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    git(run, paths.root, ['worktree', 'prune']);
  }
}

/** Commits `files` in `dir`, as whoever's git identity is set: the person who asked. */
function commitFiles(run: Runner, dir: string, files: string[], message: string): string {
  const add = git(run, dir, ['add', '--all', '--', ...files]);
  if (add.code !== 0) throw new AccError('git', `git couldn't stage the files: ${lastLine(add.stderr)}`);
  const c = git(run, dir, ['commit', '--quiet', '-m', message, '--', ...files]);
  if (c.code !== 0) throw new AccError('git', `git couldn't commit: ${lastLine(c.stderr || c.stdout)}`);
  return git(run, dir, ['rev-parse', 'HEAD']).stdout.trim();
}

/** What a person's retrieve or commit did: the commit, and what it holds. */
export interface BranchCommit {
  task: string;
  branch: string;
  sha: string;
  files: string[];
  message: string;
}

/**
 * "Use the org's copy" and "Add to this ticket": retrieves one component from the development org into the
 * ticket's branch, and commits what changed, as the person. Refused while its builder works there, or with
 * changes in its worktree that aren't committed. A file left untracked there before the click stays out
 * of the commit, unless the retrieve wrote it: then it's the org's copy, and goes in. The kept check drops the component, as it's dealt with.
 */
export function retrieveIntoBranch(paths: RepoPaths, config: Config, id: string, component: string, deps: ManifestDeps): BranchCommit {
  const c = splitComponent(component);
  if (!c) throw new AccError('usage', `${component} isn't a component: name it as Type:Member, such as ApexClass:InvoiceService.`);
  const t = ticketFor(paths, config, id);
  if (!t.env.org) throw new AccError('refused', `${t.env.name} has no org to retrieve ${component} from.`);
  return onBranch(paths, deps.run, t, deps.now, (dir) => {
    const why = branchRefusal(deps.run, t, dir);
    if (why) throw new AccError('refused', why);
    // A file left untracked before the click isn't the org's copy: it stays out of the commit, unless the retrieve
    // wrote it (its text changed), when what's there now is the org's copy.
    const readText = (f: string): string | null => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : null);
    const before = new Map(changedFiles(deps.run, dir).filter((e) => e.startsWith('??')).map((e) => e.slice(3)).map((f) => [f, readText(f)]));
    const args = ['project', 'retrieve', 'start', '--metadata', component, '--target-org', t.env.org!, '--ignore-conflicts', '--wait', '30', '--json'];
    const said = sfJson<unknown>(deps.run('sf', args, { cwd: dir, timeoutMs: 40 * 60_000, env: sfEnv(), nice: true }));
    if (!said.ok) throw new AccError('sf', `The retrieve of ${component} from ${t.env.org} failed: ${said.message}`);
    const files = under(changedFiles(deps.run, dir).map((e) => e.slice(3)), packageDirs(dir)).filter((f) => !before.has(f) || readText(f) !== before.get(f));
    if (!files.length) throw new AccError('no-change', `${t.env.org}'s copy of ${component} is the same as the branch's, so there's nothing to commit.`);
    const message = `${t.key}: Use ${t.env.org}'s copy of ${c.type} ${c.member}`;
    const sha = commitFiles(deps.run, dir, files, message);
    const kept = readManifest(paths, id);
    if (kept?.check) {
      kept.check.differs = kept.check.differs.filter((d) => `${d.type}:${d.member}` !== component);
      if (kept.check.changes.available) kept.check.changes.items = kept.check.changes.items.filter((i) => `${i.type}:${i.member}` !== component);
      keep(paths, kept);
    }
    return { task: id, branch: t.branch, sha, files, message };
  });
}

/**
 * "Add to the ticket's branch": the kept manifest, at manifest/tickets/<ticket key>/package.xml, and the
 * deletions' file beside it when the ticket deletes anything (an old one goes when it deletes nothing),
 * committed as the person. Each file is written whole, a temp file then a rename.
 */
export function commitManifest(paths: RepoPaths, config: Config, id: string, deps: ManifestDeps): BranchCommit {
  const t = ticketFor(paths, config, id);
  const m = readManifest(paths, id);
  if (!m) throw new AccError('no-manifest', `${id} has no manifest yet. Build it first.`);
  return onBranch(paths, deps.run, t, deps.now, (dir) => {
    const why = branchRefusal(deps.run, t, dir);
    if (why) throw new AccError('refused', why);
    const folder = ticketManifestDir(t.key);
    mkdirSync(join(dir, folder), { recursive: true });
    writeAtomic(join(dir, folder, PACKAGE_FILE), m.package);
    const destructive = join(dir, folder, DESTRUCTIVE_FILE);
    if (m.destructive) writeAtomic(destructive, m.destructive);
    else rmSync(destructive, { force: true });
    // Only what changed is staged: a deletions' file that never was isn't a path git knows.
    const files = git(deps.run, dir, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', folder]).stdout.split('\0').filter(Boolean).map((e) => e.slice(3))
      .filter((f) => f === `${folder}/${PACKAGE_FILE}` || f === `${folder}/${DESTRUCTIVE_FILE}`);
    if (!files.length) throw new AccError('no-change', `${folder} already holds this manifest, so there's nothing to commit.`);
    const message = `${t.key}: Add the ticket's manifest`;
    const sha = commitFiles(deps.run, dir, files, message);
    return { task: id, branch: t.branch, sha, files, message };
  });
}

/** Writes the manifest to `file`, and the deletions' file beside it when the ticket deletes anything. Returns what it wrote. */
export function saveManifest(m: Pick<TicketManifest, 'package' | 'destructive'>, file: string): string[] {
  mkdirSync(dirname(file), { recursive: true });
  writeAtomic(file, m.package);
  if (!m.destructive) return [file];
  const beside = join(dirname(file), DESTRUCTIVE_FILE);
  writeAtomic(beside, m.destructive);
  return [file, beside];
}
