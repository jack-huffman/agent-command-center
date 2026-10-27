/**
 * Guided setup (D-035): the project steps that used to be terminal recipes in ONBOARDING.md, as
 * commands the walkthrough's Do it runs. They read orgs and write files in this checkout; only
 * `branches` commits, to the new branches it makes, and nothing is pushed unless asked.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Config, Environment } from './config.ts';
import { AccError, parseJsonOutput, type RunResult, type Runner, sfEnv } from './exec.ts';
import { BASELINE_MANIFEST } from './drift.ts';
import { lastLine, listed, niced, packageDirs, readList, under } from './gates.ts';
import type { RepoPaths } from './paths.ts';
import { promotionPaths } from './promote.ts';
import { orList } from './trackers/types.ts';
import { type SlotOptions, withSlot } from './semaphore.ts';
import { PRODUCTION_NOT_HERE, sfRun } from './sf-discovery.ts';
import { NO_STEPS, type Steps } from './steps.ts';
import { escapeMarkup } from './text.ts';

export interface SetupDeps {
  run: Runner;
  now: () => Date;
  slots?: SlotOptions;
  onStep?: (what: string) => void;
  /** Where its steps are reported (T-65). */
  steps?: Steps;
}

/** The first step of each fix that reads the branches: fetching them, when there's an origin to fetch from. */
function fetchStep(run: Runner, root: string, steps: Steps): void {
  steps.step('fetch', 'Fetch the branches', () => {
    if (git(run, root, 'remote', 'get-url', 'origin').code === 0) git(run, root, 'fetch', '--quiet', 'origin');
  });
}

const git = (run: Runner, cwd: string, ...args: string[]): RunResult => run('git', args, { cwd });

/** The branch as GitHub has it if it's there, else the local one, else null. */
function refFor(run: Runner, root: string, branch: string): string | null {
  for (const ref of [`origin/${branch}`, branch]) if (git(run, root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`).code === 0) return ref;
  return null;
}

/** Runs fn in a throwaway worktree, which is always removed after. */
function inWorktree<T>(run: Runner, root: string, addArgs: string[], fn: (dir: string) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), 'acc-setup-'));
  const dir = join(tmp, 'wt');
  const add = git(run, root, 'worktree', 'add', '--quiet', ...addArgs.slice(0, -1), dir, addArgs.at(-1)!);
  if (add.code !== 0) { rmSync(tmp, { recursive: true, force: true }); throw new AccError('git', `Couldn't make a worktree: ${lastLine(add.stderr)}`); }
  try {
    return fn(dir);
  } finally {
    git(run, root, 'worktree', 'remove', '--force', dir);
    git(run, root, 'worktree', 'prune');
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- B5: one baseline manifest

/** A package.xml's components, by type, and its API version. */
export function parseManifest(xml: string): { types: Map<string, Set<string>>; version: string | null } {
  const types = new Map<string, Set<string>>();
  for (const block of xml.match(/<types>[\s\S]*?<\/types>/g) ?? []) {
    const name = /<name>\s*([^<]+?)\s*<\/name>/.exec(block)?.[1];
    if (!name) continue;
    const set = types.get(name) ?? new Set<string>();
    for (const m of block.matchAll(/<members>\s*([^<]+?)\s*<\/members>/g)) set.add(m[1]!);
    types.set(name, set);
  }
  return { types, version: /<version>\s*([^<]+?)\s*<\/version>/.exec(xml)?.[1] ?? null };
}

/** Every component any of the manifests lists, sorted, at the newest API version among them. */
export function unionManifests(xmls: string[]): string {
  const all = new Map<string, Set<string>>();
  let version: string | null = null;
  for (const xml of xmls) {
    const m = parseManifest(xml);
    for (const [t, ms] of m.types) all.set(t, new Set([...(all.get(t) ?? []), ...ms]));
    if (m.version && (!version || Number(m.version) > Number(version))) version = m.version;
  }
  const types = [...all.keys()].sort().map((t) => [
    '    <types>', ...[...all.get(t)!].sort().map((m) => `        <members>${escapeMarkup(m)}</members>`), `        <name>${escapeMarkup(t)}</name>`, '    </types>',
  ].join('\n'));
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<Package xmlns="http://soap.sforce.com/2006/04/metadata">', ...types, `    <version>${version ?? '62.0'}</version>`, '</Package>', ''].join('\n');
}

export interface BaselineResult {
  file: string;
  from: string[];
  types: number;
  members: number;
}

/** Makes manifest/baseline-package.xml from every environment branch's source (B5). */
export function buildBaseline(paths: RepoPaths, config: Config, deps: SetupDeps): BaselineResult {
  if (config.profile !== 'salesforce') throw new AccError('refused', 'A baseline manifest is for Salesforce projects.');
  const { run } = deps;
  const steps = deps.steps ?? NO_STEPS;
  fetchStep(run, paths.root, steps);
  const out = mkdtempSync(join(tmpdir(), 'acc-manifests-'));
  const xmls: string[] = [];
  const from: string[] = [];
  const generate = (dir: string, name: string) => {
    const dirs = packageDirs(dir).filter((d) => existsSync(join(dir, d)));
    const label = `List the components on ${name}`;
    if (!dirs.length) return steps.skip(`list-${name}`, label, 'It has no Salesforce source');
    deps.onStep?.(`Listing the components on ${name}`);
    steps.step(`list-${name}`, label, () => {
      const r = run(...niced('sf', ['project', 'generate', 'manifest', ...dirs.flatMap((d) => ['--source-dir', d]), '--output-dir', out, '--name', name, '--json']), { cwd: dir, env: sfEnv(), timeoutMs: 10 * 60_000 });
      const file = join(out, `${name}.xml`);
      if (r.code !== 0 || !existsSync(file)) throw new AccError('sf', `sf couldn't list the components on ${name}: ${lastLine(r.stderr || r.stdout)}`);
      xmls.push(readFileSync(file, 'utf8'));
      from.push(name);
    });
  };
  try {
    const branches = config.environments.map((e) => ({ e, ref: refFor(run, paths.root, e.branch) })).filter((x) => x.ref);
    for (const { e, ref } of branches) inWorktree(run, paths.root, ['--detach', ref!], (dir) => generate(dir, e.branch));
    // No environment branch yet: this checkout is all there is.
    if (!from.length) generate(paths.root, 'this-checkout');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
  if (!xmls.length) throw new AccError('refused', 'There\'s no Salesforce source on any environment branch, or in this checkout, to list.');
  const xml = unionManifests(xmls);
  const manifest = join(paths.root, BASELINE_MANIFEST);
  steps.step('write', 'Write the baseline', () => {
    mkdirSync(dirname(manifest), { recursive: true });
    writeFileSync(manifest, xml);
  });
  const parsed = parseManifest(xml);
  return { file: manifest, from, types: parsed.types.size, members: [...parsed.types.values()].reduce((n, s) => n + s.size, 0) };
}

// ---------------------------------------------------------------- B6: a branch per environment

export interface SeededBranch {
  env: string;
  branch: string;
  /** made: created and seeded from its org. failed: why it couldn't be. skipped: Production's, not here (D-208). */
  status: 'made' | 'failed' | 'skipped';
  note: string;
  /** Files that differ from production's branch, a first measure of drift. */
  differs: number | null;
}

/** Retrieves the baseline manifest from an org into a checkout. The org is only read. */
function retrieveInto(run: Runner, dir: string, org: string, deps: SetupDeps): string | null {
  const r = withSlot(() => run(...niced('sf', ['project', 'retrieve', 'start', '--manifest', BASELINE_MANIFEST, '--target-org', org, '--ignore-conflicts', '--wait', '60', '--json']), { cwd: dir, env: sfEnv(), timeoutMs: 70 * 60_000 }), { owner: { what: `Retrieve the baseline from ${org}`, cwd: dir }, ...deps.slots });
  try {
    const j = parseJsonOutput<{ status?: number; message?: string }>(r.stdout);
    if (r.code === 0 && j.status === 0) return null;
    return (j.message ?? '').trim() || lastLine(r.stderr || r.stdout) || `exit ${r.code}`;
  } catch {
    return lastLine(r.stderr || r.stdout) || `exit ${r.code}`;
  }
}

/**
 * Creates the environment branches that don't exist yet (B6). Production's comes first, from this
 * checkout, retrieved from its org. Each other one starts from production's with its source cleared,
 * so what exists only in Production shows as a difference, then is retrieved from its own org.
 */
export function seedBranches(paths: RepoPaths, config: Config, deps: SetupDeps, opts: { push?: boolean; by?: string } = {}): SeededBranch[] {
  const { run, now } = deps;
  const sf = config.profile === 'salesforce';
  const manifest = join(paths.root, BASELINE_MANIFEST);
  if (sf && !existsSync(manifest)) throw new AccError('refused', `There's no ${BASELINE_MANIFEST} yet. Make it first: acc setup baseline (B5).`);
  const steps = deps.steps ?? NO_STEPS;
  fetchStep(run, paths.root, steps);
  const prod = config.environments.find((e) => e.type === 'production') ?? config.environments.find((e) => e.protected) ?? null;
  const date = now().toISOString().slice(0, 10);
  const out: SeededBranch[] = [];
  const commitAll = (dir: string, message: string) => {
    git(run, dir, 'add', '-A');
    const c = git(run, dir, 'commit', '--quiet', '--allow-empty', '-m', message);
    if (c.code !== 0) throw new AccError('git', `Couldn't commit: ${lastLine(c.stderr)}`);
  };
  const seed = (e: Environment, start: string, clear: boolean) => {
    deps.onStep?.(`Making ${e.branch}${sf && e.org ? ` from ${e.org}` : ''}`);
    steps.start(`make-${e.branch}`, `Make ${e.branch}${sf && e.org ? ` from ${e.org}` : ''}`);
    let made = false;
    try {
      inWorktree(run, paths.root, ['-b', e.branch, start], (dir) => {
        if (sf) {
          copyFileSync(manifest, join(dir, BASELINE_MANIFEST));
          if (clear) for (const d of packageDirs(dir)) if (existsSync(join(dir, d))) { git(run, dir, 'rm', '-r', '-q', '--', d); mkdirSync(join(dir, d, 'main', 'default'), { recursive: true }); }
          if (e.org) {
            const failed = retrieveInto(run, dir, e.org, deps);
            if (failed) throw new AccError('sf', `the retrieve from ${e.org} failed: ${failed}`);
          }
        }
        commitAll(dir, sf && e.org ? `Baseline: ${e.name} org metadata, retrieved ${date}` : `Branch for ${e.name}`);
      });
      made = true;
      const differs = prod && prod.branch !== e.branch && refFor(run, paths.root, prod.branch)
        ? git(run, paths.root, 'diff', '--no-renames', '--name-only', refFor(run, paths.root, prod.branch)!, e.branch).stdout.split('\n').filter(Boolean).length
        : null;
      const pushed = opts.push ? git(run, paths.root, 'push', '--quiet', '--set-upstream', 'origin', `${e.branch}:${e.branch}`) : null;
      const note = !pushed ? 'made locally; push it when you\'re happy with it' : pushed.code === 0 ? 'made and pushed' : `made locally, but git push refused it: ${lastLine(pushed.stderr)}`;
      out.push({ env: e.name, branch: e.branch, status: 'made', note, differs });
      steps.done(`make-${e.branch}`, note);
    } catch (err) {
      // A branch whose retrieve failed is taken out again, so the next try starts clean.
      if (!made && git(run, paths.root, 'rev-parse', '--verify', '--quiet', `refs/heads/${e.branch}`).code === 0) git(run, paths.root, 'branch', '-D', e.branch);
      out.push({ env: e.name, branch: e.branch, status: made ? 'made' : 'failed', note: (err as Error).message, differs: null });
      if (made) steps.done(`make-${e.branch}`, (err as Error).message);
      else steps.fail(`make-${e.branch}`, (err as Error).message);
    }
  };
  if (prod && !refFor(run, paths.root, prod.branch)) {
    // Production's branch is retrieved from Production. Without it on this machine (D-208), it's left for
    // someone with access, and each sandbox's branch starts from this checkout instead.
    const away = sf && prod.type === 'production' && (!prod.org || sfRun(run, paths.root, ['org', 'display', '-o', prod.org]).status !== 0);
    if (away) {
      steps.skip(`make-${prod.branch}`, `Make ${prod.branch}`, 'This machine isn\'t logged in to Production');
      out.push({ env: prod.name, branch: prod.branch, status: 'skipped', note: `not made: it's retrieved from Production. ${PRODUCTION_NOT_HERE}`, differs: null });
    } else seed(prod, 'HEAD', false);
  }
  const prodRef = prod ? refFor(run, paths.root, prod.branch) : null;
  for (const e of config.environments) {
    if (e === prod || refFor(run, paths.root, e.branch)) continue;
    seed(e, prodRef ?? 'HEAD', sf && !!prodRef);
  }
  return out;
}

// ---------------------------------------------------------------- B9: draft the two lists

/** Org configuration that differs in every org by design: never promoted, deployed or edited by a task (D-016). */
const ENV_SPECIFIC = [
  /\/emailservices\//, /\/namedCredentials\//, /\/externalCredentials\//, /\/remoteSiteSettings\//, /\/authproviders\//,
  /\/samlssoconfigs\//, /\/connectedApps\//, /\/cspTrustedSites\//, /\/corsWhitelistOrigins\//, /\/sites\//, /\/networks\//,
  /\/certs\//, /\/settings\/(Case|EmailAdministration|EmailIntegration|Security|SingleSignOn|MyDomain|Domain)\.settings-meta\.xml$/,
];
/** A feature a sandbox lacks: app logos and other content assets. */
const KNOWN_DRIFT = [/\/contentassets\//];

/** Reads many files at refs in one git call: `ref:path` → its text, or null when it isn't there. */
function readBlobs(run: Runner, root: string, specs: string[]): Map<string, string | null> {
  const out = new Map<string, string | null>();
  if (!specs.length) return out;
  const r = run('git', ['cat-file', '--batch'], { cwd: root, input: specs.join('\n') + '\n' });
  const buf = Buffer.from(r.stdout, 'utf8');
  let at = 0;
  for (const spec of specs) {
    const nl = buf.indexOf(10, at);
    if (nl < 0) break;
    const head = buf.subarray(at, nl).toString('utf8');
    at = nl + 1;
    const m = /^\S+ \S+ (\d+)$/.exec(head);
    if (!m) { out.set(spec, null); continue; }
    const size = Number(m[1]);
    out.set(spec, buf.subarray(at, at + size).toString('utf8'));
    at += size + 1;
  }
  return out;
}

/** Salesforce's ordering noise: the same lines, in another order. Such a file has no real change. */
export const reorderedOnly = (a: string | null, b: string | null): boolean => {
  if (a === null || b === null || a === b) return false;
  const lines = (s: string) => s.split('\n').map((l) => l.trimEnd()).filter(Boolean).sort().join('\n');
  return lines(a) === lines(b);
};

export interface ListDraft {
  file: string;
  /** Whether acc wrote the file (it didn't exist), or only suggests what to add. */
  written: boolean;
  entries: string[];
}

export interface ListsResult {
  environmentSpecific: ListDraft;
  knownDrift: ListDraft;
  /** Differences neither list explains: real drift, or work in progress. A person decides. */
  unexplained: { branch: string; files: string[] }[];
}

/** Drafts both lists from how each sandbox's branch differs from production's (B9). Never overwrites a list. */
export function draftLists(paths: RepoPaths, config: Config, deps: SetupDeps): ListsResult {
  const { run } = deps;
  if (config.profile !== 'salesforce') throw new AccError('refused', 'The environment-specific and known-drift lists are for Salesforce projects.');
  if (!config.environmentSpecific || !config.knownDrift) throw new AccError('refused', 'Name both lists in .acc/config.json first: "environmentSpecific": "manifest/environment-specific.txt" and "knownDrift": "manifest/known-drift.txt".');
  const steps = deps.steps ?? NO_STEPS;
  fetchStep(run, paths.root, steps);
  const prod = config.environments.find((e) => e.type === 'production');
  const prodRef = prod ? refFor(run, paths.root, prod.branch) : null;
  if (!prod || !prodRef) {
    // Set up without Production (D-208), its branch waits for someone with access to Production.
    throw new AccError('refused', prod && !prod.org
      ? 'There\'s no production branch to compare the others with yet. It\'s retrieved from Production, so someone with access to Production makes it first (B6).'
      : 'There\'s no production branch to compare the others with yet. Make the branches first (B6).');
  }
  const specific = new Set<string>();
  const drift = new Set<string>();
  const unexplained: ListsResult['unexplained'] = [];
  for (const e of config.environments) {
    if (e === prod) continue;
    const ref = refFor(run, paths.root, e.branch);
    if (!ref) continue;
    steps.start(`compare-${e.branch}`, `Compare ${e.branch} with ${prod.branch}`);
    const files = under(git(run, paths.root, 'diff', '--no-renames', '--name-only', prodRef, ref).stdout.split('\n').filter(Boolean), packageDirs(paths.root));
    const rest: string[] = [];
    const maybe: string[] = [];
    for (const f of files) {
      if (ENV_SPECIFIC.some((p) => p.test(f))) specific.add(f);
      else if (KNOWN_DRIFT.some((p) => p.test(f))) drift.add(f);
      else maybe.push(f);
    }
    // What's left is ordering noise only if both branches have the same lines, reordered.
    const blobs = readBlobs(run, paths.root, maybe.flatMap((f) => [`${prodRef}:${f}`, `${ref}:${f}`]));
    for (const f of maybe) {
      if (reorderedOnly(blobs.get(`${prodRef}:${f}`) ?? null, blobs.get(`${ref}:${f}`) ?? null)) drift.add(f);
      else rest.push(f);
    }
    if (rest.length) unexplained.push({ branch: e.branch, files: rest });
    steps.done(`compare-${e.branch}`, files.length ? `${files.length} difference(s), ${rest.length} that neither list explains` : 'No differences');
  }
  const draft = (rel: string, found: Set<string>): ListDraft => {
    const list = join(paths.root, rel);
    const have = readList(paths.root, rel);
    const entries = [...found].filter((f) => !listed(f, have)).sort();
    if (existsSync(list)) return { file: list, written: false, entries };
    mkdirSync(dirname(list), { recursive: true });
    // One path per line and no blank lines: a blank line in a grep pattern file matches everything.
    writeFileSync(list, entries.length ? `${entries.join('\n')}\n` : '');
    return { file: list, written: true, entries };
  };
  const lists = steps.step('write', 'Write the lists', () => ({ environmentSpecific: draft(config.environmentSpecific!, specific), knownDrift: draft(config.knownDrift!, drift) }));
  return { ...lists, unexplained };
}

// ---------------------------------------------------------------- B10: the README's environments

export const README_START = '<!-- acc:environments -->';
export const README_END = '<!-- /acc:environments -->';

/** A tracker's place (D-072) as the README names it: its words, and what the README must carry for B10 to pass. */
export interface ReadmePlace {
  /** Markdown, such as "Jira epic [ACME-3](https://acme.atlassian.net/browse/ACME-3)". */
  line: string;
  /** "the Jira epic ACME-3", for B10's message. */
  words: string;
  /** The links, and an area path or group, the README must contain. */
  needs: string[];
}

const linkText = (s: string): string => s.replace(/([[\]\\])/g, '\\$1');
const code = (s: string): string => `\`${s.replace(/`/g, '')}\``;

/**
 * Where each tracker's tickets come from, when it's narrower than its project (GH-81): each Jira epic by its
 * key, linked; an Azure DevOps area path, in its project, linked; each GitHub label, linked to its issues;
 * a monday.com group, on its board, linked. The key, never the epic's name: the README doesn't go stale when
 * an epic is renamed, and nothing is read from the tracker to write it.
 */
export function readmePlaces(config: Config): ReadmePlace[] {
  const out: ReadmePlace[] = [];
  for (const t of config.trackers) {
    if (t.kind === 'jira' && t.epics.length && t.site) {
      // Each epic linked (T-107): a ticket under any of them is the project's.
      const s = t.epics.length > 1 ? 's' : '';
      const urls = t.epics.map((e) => `https://${t.site}/browse/${encodeURIComponent(e)}`);
      out.push({ line: `Jira epic${s} ${orList(t.epics.map((e, i) => `[${linkText(e)}](${urls[i]})`))}`, words: `the Jira epic${s} ${orList(t.epics)}`, needs: urls });
    } else if (t.kind === 'azure' && t.areaPath && t.organization && t.project) {
      const url = `https://dev.azure.com/${encodeURIComponent(t.organization)}/${encodeURIComponent(t.project)}`;
      out.push({ line: `Azure DevOps area path ${code(t.areaPath)} in [${linkText(t.project)}](${url})`, words: `the Azure DevOps area path ${t.areaPath}`, needs: [t.areaPath, url] });
    } else if (t.kind === 'github' && t.labels.length) {
      const repo = t.repo ?? config.github?.repo ?? null;
      const s = t.labels.length > 1 ? 's' : '';
      const urls = repo ? t.labels.map((l) => `https://github.com/${repo}/issues?q=${encodeURIComponent(`is:issue label:"${l}"`)}`) : [];
      const links = repo ? t.labels.map((l, i) => `[${linkText(l)}](${urls[i]})`) : t.labels.map(code);
      out.push({ line: `GitHub label${s} ${orList(links)}${repo ? '' : ' in this repo'}`, words: `the GitHub label${s} ${orList(t.labels)}`, needs: repo ? urls : t.labels });
    } else if (t.kind === 'monday' && t.group && t.account && t.board !== null) {
      const url = `https://${t.account}.monday.com/boards/${t.board}`;
      out.push({ line: `monday.com group ${code(t.group)} on [board ${t.board}](${url})`, words: `the monday.com group ${t.group}`, needs: [t.group, url] });
    }
  }
  return out;
}

/** The README's environments section: which branch is which org, and how changes move. */
export function environmentsSection(config: Config): string {
  const envs = config.environments;
  const name = (b: string) => `\`${b}\``;
  const role = (e: Environment) => [
    e.protected ? 'protected: changes arrive only by promotion' : '',
    e.default ? 'day-to-day work' : '',
    e.promotesTo.length ? `promotes to ${e.promotesTo.map(name).join(' or ')}` : '',
  ].filter(Boolean).join('; ') || '–';
  const rows = envs.map((e) => `| ${e.name} | ${name(e.branch)} | ${e.org ?? '–'} | ${e.type === 'none' ? 'branch' : e.type.replace('_', ' ')} | ${role(e)} |`);
  const paths = promotionPaths(envs);
  const places = readmePlaces(config);
  return [
    README_START,
    '## Environments',
    '',
    'Each environment has its own branch, named after it.',
    '',
    '| Environment | Branch | Org | Type | Role |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    ...(paths.length ? ['**How changes move:** ' + paths.map((p) => p.map(name).join(' → ')).join(', or ') + '. Each step is a pull request (`acc promote`), and a deploy after it merges (`acc deploy`).', ''] : []),
    ...(places.length ? [`**Its tickets come from** ${places.map((p) => p.line).join(', and ')}.`, ''] : []),
    ...(config.environmentSpecific ? [`**Environment-specific files,** listed in \`${config.environmentSpecific}\`, differ in every org by design. They're never promoted, deployed, or changed as part of a task.`, ''] : []),
    `_This section is kept by \`acc setup readme\`; edit the environments in \`.acc/config.json\`._`,
    README_END,
  ].join('\n');
}

/** Writes or updates the README's environments section (B10). The rest of the README is left as it is. */
export function writeReadme(paths: RepoPaths, config: Config, steps: Steps = NO_STEPS): { file: string; created: boolean; replaced: boolean } {
  return steps.step('readme', 'Write the environments section', () => writeReadmeNow(paths, config));
}

function writeReadmeNow(paths: RepoPaths, config: Config): { file: string; created: boolean; replaced: boolean } {
  const readme = join(paths.root, 'README.md');
  const section = environmentsSection(config);
  if (!existsSync(readme)) {
    writeFileSync(readme, `# ${config.project}\n\n${section}\n`);
    return { file: readme, created: true, replaced: false };
  }
  const text = readFileSync(readme, 'utf8');
  const a = text.indexOf(README_START);
  const b = text.indexOf(README_END);
  if (a >= 0 && b > a) {
    writeFileSync(readme, `${text.slice(0, a)}${section}${text.slice(b + README_END.length)}`);
    return { file: readme, created: false, replaced: true };
  }
  writeFileSync(readme, `${text.replace(/\s*$/, '')}\n\n${section}\n`);
  return { file: readme, created: false, replaced: false };
}

