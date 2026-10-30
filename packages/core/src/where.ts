/**
 * Where a ticket's work is (T-155), for the salesforce profile (D-003), read from two free oracles for each
 * environment on its path. Git: origin's copy of the environment's branch, after a fetch, holds each file the
 * ticket changes with the ticket's content, compared by content so a cherry-pick counts, and doesn't hold a
 * file the ticket deletes. The org: only the ticket's components (its manifest, D-191) are retrieved, into a
 * scratch folder outside the repo, and each file is compared with the ticket's content as Salesforce returns
 * it; a component the ticket deletes counts when the org doesn't list it. The retrieve changes nothing in the
 * org or the repo. Environment-specific files (D-016) are left out, and said. Each org read holds that org's
 * turn (D-206). The readings are kept beside the ledger (where-kept.ts), so a page never waits on an org.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Config, type Environment, environmentByBranch } from './config.ts';
import { listMetadataArgs, orgDisplayArgs, orgLockDir, readListed, readOrgDisplay } from './deploy-gate.ts';
import { environmentNamed } from './drift.ts';
import { AccError, parseJsonOutput, type Runner, sfEnv } from './exec.ts';
import { lastLine, listed, packageDirs, under } from './gates.ts';
import { git, must } from './git-must.ts';
import { readLedger, type Task } from './ledger.ts';
import { generateManifest, sourceApiVersion } from './manifest.ts';
import { nulPaths } from './overlap.ts';
import type { RepoPaths } from './paths.ts';
import { type SlotOptions, withSlot } from './semaphore.ts';
import { sfComponent } from './sf-metadata.ts';
import { NO_STEPS, type Steps } from './steps.ts';
import { listLinesAt, type TaskCommand, ticketCommits } from './task-deploy.ts';
import { type EnvWhere, keepWhere, pathFrom, type Reading, type TicketWhere } from './where-kept.ts';

/** A file the ticket changes: its path, and its content's git blob, or null for a file it deletes. */
export interface TicketFile {
  path: string;
  blob: string | null;
}

/** The ticket's work: the commit that holds its content, and each file it changes. */
export interface TicketWork {
  tip: string;
  files: TicketFile[];
}

/**
 * The ticket's work, read from git: once merged, what its merge commit changed against its first parent; before,
 * what its branch changed since it last took in its environment's branch. Content is the tip's.
 */
export function ticketWork(run: Runner, root: string, t: Pick<Task, 'id' | 'environment' | 'pr' | 'run'>): TicketWork {
  const commits = ticketCommits(run, root, t);
  const tip = commits.at(-1)!.sha;
  let from = `${tip}^1`;
  if (t.pr?.state !== 'merged') {
    const base = [`origin/${t.environment}`, t.environment].find((b) => git(run, root, 'rev-parse', '--verify', '--quiet', `${b}^{commit}`).code === 0)!;
    from = must(git(run, root, 'merge-base', base, tip), `Couldn't find where ${t.id}'s branch left ${t.environment}`).trim();
  }
  const parts = nulPaths(must(git(run, root, 'diff', '--name-status', '--no-renames', '-z', from, tip), `Couldn't read what ${t.id} changes`));
  const files: TicketFile[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const path = parts[i + 1]!;
    files.push({ path, blob: parts[i]!.startsWith('D') ? null : git(run, root, 'rev-parse', `${tip}:${path}`).stdout.trim() });
  }
  return { tip, files };
}

/** A path as its component's label and name ("Apex class: Invoice"), or the path when the profile can't name it. */
export const componentWords = (path: string): string => {
  const c = sfComponent(path);
  return c ? `${c.label}: ${c.name}` : path;
};

/** A reading that can't tell, with why. */
const cannot = (why: string, at: string): Reading => ({ state: 'unknown', differs: [], why, at });

/**
 * One reading from each file's verdict: a component is there when every file of it the ticket changes is as
 * the ticket has it. All there is deployed, none is not deployed, some is partly, naming each that differs.
 */
export function readingOf(found: { path: string; same: boolean }[], at: string): Reading {
  if (!found.length) return cannot('It changes nothing to compare here, apart from environment-specific files.', at);
  const comps = new Map<string, boolean>();
  for (const f of found) {
    const c = componentWords(f.path);
    comps.set(c, (comps.get(c) ?? true) && f.same);
  }
  const differs = [...comps].filter(([, same]) => !same).map(([c]) => c);
  const state = !differs.length ? 'deployed' : differs.length === comps.size ? 'not-deployed' : 'partly';
  return { state, differs, why: null, at };
}

/** Git's reading: each file as origin's copy of the branch holds it, by its blob, so a cherry-pick counts. */
export function readGit(run: Runner, root: string, branch: string, files: TicketFile[], at: string): Reading {
  const ref = `origin/${branch}`;
  if (git(run, root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`).code !== 0) return cannot(`There's no ${branch} branch on origin to read.`, at);
  const held = new Map<string, string>();
  if (files.length) {
    const r = git(run, root, 'ls-tree', '-r', '-z', ref, '--', ...files.map((f) => f.path));
    if (r.code !== 0) return cannot(`git couldn't read the ${branch} branch: ${lastLine(r.stderr)}`, at);
    for (const line of nulPaths(r.stdout)) {
      const tab = line.indexOf('\t');
      held.set(line.slice(tab + 1), line.slice(0, tab).split(' ')[2]!);
    }
  }
  return readingOf(files.map((f) => ({ path: f.path, same: f.blob === null ? !held.has(f.path) : held.get(f.path) === f.blob })), at);
}

/** A file's text as Salesforce and git may each write it: one kind of line ending, no trailing space at its end. */
export const sameText = (a: string, b: string): boolean => {
  const norm = (s: string) => s.replace(/\r\n/g, '\n').replace(/\s+$/, '');
  return norm(a) === norm(b);
};

/** The retrieve's sf arguments: the ticket's manifest from the org, into the scratch folder. It only reads. */
export function whereRetrieveArgs(org: string, manifest: string): string[] {
  return ['project', 'retrieve', 'start', '--manifest', manifest, '--target-org', org, '--ignore-conflicts', '--wait', '30', '--json'];
}

export interface WhereDeps {
  run: Runner;
  now: () => Date;
  steps?: Steps;
  slots?: SlotOptions;
  /** Where the org's reads and deploys take turns, when not acc's own folder (a test's). */
  orgLocks?: string;
  onWait?: () => void;
}

/** The org's reading, and the components it couldn't be asked for. */
interface OrgRead {
  reading: Reading;
  unchecked: string[];
}

/**
 * The org's reading: the ticket's components retrieved into a scratch worktree outside the repo, at the
 * ticket's commit, with the ticket's own files taken out first, so what's there after is what the org sent.
 * A component the ticket deletes whole is asked for by listing its type.
 */
export function readOrg(deps: WhereDeps, paths: Pick<RepoPaths, 'root'>, config: Pick<Config, 'project'>, task: string, env: Environment, tip: string, files: TicketFile[]): OrgRead {
  const { run } = deps;
  const at = () => deps.now().toISOString();
  if (!env.org) return { reading: cannot(`${env.name} has no org in the project's settings.`, at()), unchecked: [] };
  const shown = readOrgDisplay(run('sf', orgDisplayArgs(env.org), { env: sfEnv(), timeoutMs: 2 * 60_000 }));
  if (!shown) {
    // Without Production on this machine (D-208), its org isn't read.
    const why = env.type === 'production' ? `This machine has no access to ${env.name}: ${env.org} isn't logged in here.` : `${env.org} isn't logged in on this machine.`;
    return { reading: cannot(why, at()), unchecked: [] };
  }
  const dir = mkdtempSync(join(tmpdir(), 'acc-where-'));
  const wt = join(dir, 'wt');
  try {
    if (git(run, paths.root, 'worktree', 'add', '--detach', '--quiet', wt, tip).code !== 0) return { reading: cannot(`git couldn't make a scratch copy of ${task}'s work to read ${env.name} into.`, at()), unchecked: [] };
    const dirs = packageDirs(wt);
    const source = files.filter((f) => under([f.path], dirs).length);
    if (!source.length) return { reading: cannot('None of its changes go to an org.', at()), unchecked: [] };
    const held = under(nulPaths(git(run, wt, 'ls-files', '-z').stdout), dirs);
    const keyOf = (p: string) => { const c = sfComponent(p); return c ? `${c.type}:${c.name}` : null; };
    // A file deleted from a component the ticket keeps (one file of a bundle) is read with that component: it must not come back.
    const fetch = new Set(source.filter((f) => f.blob !== null).map((f) => f.path));
    const inFetch: TicketFile[] = source.filter((f) => f.blob !== null);
    const gone: TicketFile[] = [];
    for (const d of source.filter((f) => f.blob === null)) {
      const key = keyOf(d.path);
      const rest = key ? held.find((h) => keyOf(h) === key) : undefined;
      if (rest) { fetch.add(rest); inFetch.push(d); } else gone.push(d);
    }
    const manifest = join(dir, 'out', 'package.xml');
    if (fetch.size) generateManifest(run, wt, [...fetch].sort(), sourceApiVersion(wt), join(dir, 'out'));
    const want = Object.fromEntries(inFetch.filter((f) => f.blob).map((f) => [f.path, readFileSync(join(wt, f.path), 'utf8')]));
    for (const f of inFetch) rmSync(join(wt, f.path), { force: true });
    const turn = { dir: deps.orgLocks ? join(deps.orgLocks, shown.username.replace(/[^\w.-]+/g, '_')) : orgLockDir(shown.username), slots: 1, owner: { what: `Read where ${task} is in ${env.name}`, task, env: env.branch, project: config.project }, onWait: deps.onWait };
    return withSlot(() => {
      const found: { path: string; same: boolean }[] = [];
      if (fetch.size) {
        const args = whereRetrieveArgs(env.org!, manifest);
        const r = run('sf', args, { cwd: wt, env: sfEnv(), timeoutMs: 40 * 60_000, nice: true });
        let ok = false;
        let message = '';
        try {
          const j = parseJsonOutput<{ status?: number; message?: string; result?: { files?: unknown[] } }>(r.stdout);
          ok = Array.isArray(j.result?.files);
          message = j.message ?? '';
        } catch {
          ok = false;
        }
        if (!ok) return { reading: cannot(`Salesforce didn't answer for ${env.org}: ${message.trim() || lastLine(r.stderr || r.stdout) || `exit ${r.code}`}`, at()), unchecked: [] };
        for (const f of inFetch) {
          const file = join(wt, f.path);
          found.push({ path: f.path, same: f.blob === null ? !existsSync(file) : existsSync(file) && sameText(readFileSync(file, 'utf8'), want[f.path]!) });
        }
      }
      const unchecked: string[] = [];
      const lists = new Map<string, string[] | null>();
      for (const d of gone) {
        const c = sfComponent(d.path);
        if (!c) { unchecked.push(d.path); continue; }
        const args = listMetadataArgs(env.org!, c);
        const key = args.join(' ');
        if (!lists.has(key)) lists.set(key, readListed(run('sf', args, { cwd: wt, env: sfEnv(), timeoutMs: 5 * 60_000 })));
        const names = lists.get(key)!;
        if (names === null) unchecked.push(componentWords(d.path));
        else found.push({ path: d.path, same: !names.includes(c.name) });
      }
      if (!found.length) return { reading: cannot(`${env.org} couldn't be asked for ${unchecked.join(', ')}.`, at()), unchecked };
      return { reading: readingOf(found, at()), unchecked };
    }, turn);
  } finally {
    git(run, paths.root, 'worktree', 'remove', '--force', wt);
    git(run, paths.root, 'worktree', 'prune');
    rmSync(dir, { recursive: true, force: true });
  }
}

/** When acc's own record says the ticket reached `env`: a deploy with a check, or a promotion that merged. Null when it doesn't. */
export function recordedAt(t: Pick<Task, 'promotions' | 'deploys'>, env: string): string | null {
  const times = [...(t.deploys ?? []).filter((d) => d.env === env && d.checkId).map((d) => d.at), ...(t.promotions ?? []).filter((p) => p.state === 'merged' && p.to === env).map((p) => p.mergedAt ?? p.at)];
  return times.sort().at(-1) ?? null;
}

/** Where the deploy record, the branch and the org disagree, in words. */
export function whereNotes(t: Pick<Task, 'environment' | 'promotions' | 'deploys'>, env: Pick<Environment, 'name' | 'branch'>, gitR: Reading, org: Reading): string[] {
  const notes: string[] = [];
  const rec = recordedAt(t, env.branch);
  const day = rec?.slice(0, 10);
  if (rec && org.state === 'not-deployed') notes.push(`Its deploy record says it reached ${env.name} on ${day}, but the org doesn't hold it now.`);
  if (rec && org.state === 'partly') notes.push(`Its deploy record says it reached ${env.name} on ${day}, but ${org.differs.join(', ')} differ in the org now.`);
  if (!rec && org.state === 'deployed' && env.branch !== t.environment) notes.push(`It's in ${env.name}'s org, with no deploy of it on record: it got there another way.`);
  if (org.state === 'deployed' && (gitR.state === 'partly' || gitR.state === 'not-deployed')) notes.push(`It's in ${env.name}'s org, but the ${env.branch} branch doesn't hold all of it.`);
  if (gitR.state === 'deployed' && (org.state === 'partly' || org.state === 'not-deployed')) notes.push(`The ${env.branch} branch holds it, but ${env.name}'s org doesn't hold all of it.`);
  return notes;
}

/** Why a ticket's place can't be read now, or that it can. */
export function whereEnabled(config: Pick<Config, 'profile' | 'environments'>, t: Pick<Task, 'id' | 'environment' | 'pr' | 'run'> | undefined): { ok: true } | { ok: false; why: string } {
  if (config.profile !== 'salesforce') return { ok: false, why: 'Where a ticket\'s work is is read from Salesforce orgs, and this isn\'t a Salesforce project.' };
  if (!t) return { ok: false, why: 'There\'s no such task.' };
  if (t.pr?.state !== 'merged' && !t.run?.branch) return { ok: false, why: `${t.id} has no work yet: build it first.` };
  if (!environmentByBranch(config, t.environment)) return { ok: false, why: `${t.id}'s environment, ${t.environment}, isn't in the project's settings.` };
  return { ok: true };
}

/** Read where a ticket's work is: the CLI's, the extension's and an agent's. */
export const WHERE_COMMAND: TaskCommand<{ config: Pick<Config, 'profile' | 'environments'>; task: Parameters<typeof whereEnabled>[1] }> = {
  id: 'acc.task.where',
  params: 'The task\'s id, and one environment on its path to read (every one on its path when left out).',
  enabled: ({ config, task }) => whereEnabled(config, task),
};

/**
 * Reads where a ticket's work is, in one environment on its path or each, from git and from each org, and
 * keeps the readings beside the ledger. Nothing changes in an org, on origin or in the main checkout.
 */
export function whereIs(paths: RepoPaths, config: Config, id: string, envName: string | undefined, deps: WhereDeps): TicketWhere {
  const { run } = deps;
  const steps = deps.steps ?? NO_STEPS;
  const t = readLedger(paths.ledger).tasks.find((x) => x.id === id);
  const can = whereEnabled(config, t);
  if (!can.ok) throw new AccError('refused', can.why);
  const task = t!;
  const path = pathFrom(config.environments, task.environment);
  let envs = path;
  if (envName) {
    const want = environmentNamed(config, envName);
    if (!path.includes(want)) throw new AccError('usage', `${want.name} isn't on ${id}'s path: ${path.map((e) => e.name).join(', ')}.`);
    envs = [want];
  }
  // origin's copy of each branch is read, so each is fetched first; one that can't be fetched is read as it last was.
  steps.step('fetch', 'Fetch the environments\' branches', () => {
    for (const b of new Set([task.environment, ...envs.map((e) => e.branch)])) git(run, paths.root, 'fetch', '--quiet', 'origin', b);
  });
  const work = steps.step('work', `Read ${id}'s changes`, () => ticketWork(run, paths.root, task));
  const read: EnvWhere[] = [];
  for (const env of envs) {
    read.push(steps.step(`read-${env.branch}`, `Read ${env.name}`, () => {
      const specific = config.environmentSpecific ? [...listLinesAt(run, paths.root, `origin/${env.branch}`, config.environmentSpecific), ...listLinesAt(run, paths.root, work.tip, config.environmentSpecific)] : [];
      const leftOut = work.files.filter((f) => listed(f.path, specific)).map((f) => f.path);
      const files = work.files.filter((f) => !leftOut.includes(f.path));
      const gitR = readGit(run, paths.root, env.branch, files, deps.now().toISOString());
      const { reading, unchecked } = readOrg(deps, paths, config, id, env, work.tip, files);
      return { env: env.branch, name: env.name, ...reading, git: gitR, org: reading, leftOut, unchecked, notes: whereNotes(task, env, gitR, reading) };
    }));
  }
  return keepWhere(paths, id, read);
}

/** One environment's reading as a person reads it: its state, what differs or why it can't tell, and the notes. */
export function whereWords(e: Pick<EnvWhere, 'name' | 'state' | 'differs' | 'why' | 'notes' | 'leftOut' | 'unchecked'>): string {
  const head = e.state === 'deployed' ? `${e.name}: deployed.`
    : e.state === 'partly' ? `${e.name}: partly deployed. ${e.differs.join(', ')} differ${e.differs.length === 1 ? 's' : ''}.`
    : e.state === 'not-deployed' ? `${e.name}: not deployed.`
    : `${e.name}: can't tell. ${e.why ?? ''}`.trim();
  return [head, ...e.notes, ...(e.leftOut.length ? [`Environment-specific, left out: ${e.leftOut.join(', ')}.`] : []), ...(e.unchecked.length ? [`Couldn't ask the org for ${e.unchecked.join(', ')}.`] : [])].join(' ');
}
