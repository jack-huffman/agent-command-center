/**
 * Drift: what changed in an org since its branch was last updated (DESIGN section 9, D-024). The
 * baseline manifest is retrieved into a throwaway worktree and compared with the branch there. The
 * org is only read, and the main checkout isn't touched.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config, Environment } from './config.ts';
import { AccError, parseJsonOutput, type Runner, sfEnv } from './exec.ts';
import { lastLine, listed, niced, packageDirs, readList, shellLine, under } from './gates.ts';
import type { RepoPaths } from './paths.ts';
import { type SlotOptions, withSlot } from './semaphore.ts';

export const BASELINE_MANIFEST = 'manifest/baseline-package.xml';

export interface DriftResult {
  env: string;
  org: string;
  /** The branch commit the org was compared with. */
  base: string;
  /** Files whose content in the org differs from the branch. */
  changed: string[];
  /** Files the org has that the branch doesn't. */
  added: string[];
  /** Files of components the branch has and the org doesn't: added elsewhere, deleted there, or a feature it lacks. */
  missing: string[];
  /** Components the retrieve couldn't fetch for other reasons, with sf's message. A manifest problem, not drift. */
  unretrievable: string[];
  /** Differences left out because they're expected: known drift or environment-specific. */
  ignored: number;
  checkedAt: string;
  /** The retrieved worktree, when asked to keep it. */
  kept: string | null;
}

export interface DriftDeps {
  run: Runner;
  now: () => Date;
  slots?: SlotOptions;
  onWait?: () => void;
  /** Called once the environment and its baseline are found, just before the org is read. */
  onRetrieve?: (env: Environment) => void;
}

export function environmentNamed(config: Config, name: string): Environment {
  const env = config.environments.find((e) => e.branch === name.toLowerCase() || e.name.toLowerCase() === name.toLowerCase());
  if (!env) throw new AccError('usage', `No environment "${name}". The config has: ${config.environments.map((e) => e.branch).join(', ')}.`);
  return env;
}

/** Where the latest drift report for an environment is kept, for doctor and the extension. */
export const driftReportPath = (paths: RepoPaths, branch: string): string => join(paths.stateDir, 'drift', `${branch}.json`);

/** Standard metadata folders, so a missing component is matched to its own files and not a namesake's. */
const FOLDER: Record<string, string> = {
  ApexClass: 'classes', ApexTrigger: 'triggers', ApexPage: 'pages', ApexComponent: 'components', CustomObject: 'objects',
  CustomField: 'fields', ListView: 'listViews', RecordType: 'recordTypes', ValidationRule: 'validationRules', WebLink: 'webLinks',
  CompactLayout: 'compactLayouts', FieldSet: 'fieldSets', BusinessProcess: 'businessProcesses', Flow: 'flows', ContentAsset: 'contentassets',
  ReportType: 'reportTypes', Layout: 'layouts', PermissionSet: 'permissionsets', Profile: 'profiles', CustomTab: 'tabs',
  CustomApplication: 'applications', QuickAction: 'quickActions', FlexiPage: 'flexipages', StaticResource: 'staticresources',
  LightningComponentBundle: 'lwc', AuraDefinitionBundle: 'aura', EmailTemplate: 'email', Report: 'reports', Dashboard: 'dashboards',
  GlobalValueSet: 'globalValueSets', StandardValueSet: 'standardValueSets', CustomMetadata: 'customMetadata', CustomLabels: 'labels',
};

/**
 * The branch's files for a component, by Salesforce's naming: `Case.Foo__c` is a file named `Foo__c.*`
 * under a `Case` folder, in the type's own folder when it has one.
 */
export function filesFor(type: string, fullName: string, tracked: string[]): string[] {
  const parts = fullName.split('.');
  const name = parts.pop()!;
  const folder = FOLDER[type];
  return tracked.filter((f) => {
    const segs = f.split('/');
    const base = segs.at(-1)!;
    const inBundle = segs.at(-2) === name && (type === 'LightningComponentBundle' || type === 'AuraDefinitionBundle');
    if (!base.startsWith(`${name}.`) && !inBundle) return false;
    if (folder && !segs.includes(folder)) return false;
    return parts.every((p) => segs.includes(p));
  });
}

/** Reads the retrieve's file list: components the org lacks, and ones it couldn't send for another reason. */
function failures(stdout: string): { lacking: { type: string; fullName: string }[]; other: string[] } {
  let files: { type?: string; fullName?: string; state?: string; error?: string }[] = [];
  try {
    files = parseJsonOutput<{ result?: { files?: typeof files } }>(stdout).result?.files ?? [];
  } catch {
    files = [];
  }
  const failed = files.filter((f) => f.state === 'Failed');
  const isAbsent = (f: { error?: string }) => /cannot be found/i.test(f.error ?? '');
  return {
    lacking: failed.filter(isAbsent).map((f) => ({ type: f.type ?? '', fullName: f.fullName ?? '' })),
    other: failed.filter((f) => !isAbsent(f)).map((f) => `${f.type && f.fullName ? `${f.type}:${f.fullName}: ` : ''}${(f.error ?? 'failed').trim()}`),
  };
}

/** `git status -z` entries: modified files and untracked ones, with folders already expanded. */
function statusOf(run: Runner, dir: string): { changed: string[]; added: string[] } {
  const r = run('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: dir });
  if (r.code !== 0) throw new AccError('git', `git status failed in the drift worktree: ${lastLine(r.stderr)}`);
  const changed: string[] = [];
  const added: string[] = [];
  for (const entry of r.stdout.split('\0').filter(Boolean)) {
    const [code, path] = [entry.slice(0, 2), entry.slice(3)];
    (code === '??' ? added : changed).push(path);
  }
  return { changed, added };
}

export function drift(paths: RepoPaths, config: Config, envName: string, deps: DriftDeps, opts: { manifest?: string; keep?: boolean } = {}): DriftResult {
  if (config.profile !== 'salesforce') throw new AccError('usage', 'acc drift compares a Salesforce org with its branch. This project has no orgs.');
  const env = environmentNamed(config, envName);
  if (!env.org) throw new AccError('usage', `${env.name} has no org alias in .acc/config.json.`);
  const manifest = opts.manifest ?? BASELINE_MANIFEST;
  const git = (args: string[], cwd = paths.root) => deps.run('git', args, { cwd });

  // Compare with the branch as the remote has it, when there is a remote.
  if (git(['remote', 'get-url', 'origin']).code === 0) git(['fetch', '--quiet', 'origin', env.branch]);
  const ref = [`origin/${env.branch}`, env.branch].find((r) => git(['rev-parse', '--verify', '--quiet', `${r}^{commit}`]).code === 0);
  if (!ref) throw new AccError('no-base', `There's no ${env.branch} or origin/${env.branch} branch to compare ${env.name} with.`);
  const base = git(['rev-parse', ref]).stdout.trim();
  if (git(['cat-file', '-e', `${base}:${manifest}`]).code !== 0) throw new AccError('usage', `${ref} has no ${manifest}. Make the baseline manifest first (ONBOARDING.md, B5), or pass --manifest.`);

  deps.onRetrieve?.(env);
  const dir = join(paths.stateDir, 'drift', `${env.branch}-${deps.now().getTime()}`);
  mkdirSync(join(paths.stateDir, 'drift'), { recursive: true });
  const add = git(['worktree', 'add', '--detach', '--quiet', dir, base]);
  if (add.code !== 0) throw new AccError('git', `Couldn't make a throwaway worktree: ${lastLine(add.stderr)}`);
  try {
    const args = ['project', 'retrieve', 'start', '--manifest', manifest, '--target-org', env.org!, '--ignore-conflicts', '--wait', '60', '--json'];
    const retrieve = () => deps.run(...niced('sf', args), { cwd: dir, timeoutMs: 70 * 60_000, env: sfEnv() });
    const r = withSlot(retrieve, { owner: { what: `Drift check on ${env.branch}`, env: env.branch, project: config.project }, ...deps.slots, onWait: deps.onWait });
    const log = join(paths.logs, 'drift', `${env.branch}.log`);
    mkdirSync(join(paths.logs, 'drift'), { recursive: true });
    writeFileSync(log, `$ ${shellLine('sf', args)}\n# exit ${r.code}\n\n${r.stdout}${r.stderr ? `\n--- stderr ---\n${r.stderr}` : ''}`);
    let status: number | undefined;
    let message = '';
    try {
      const j = parseJsonOutput<{ status?: number; message?: string }>(r.stdout);
      status = j.status;
      message = j.message ?? '';
    } catch {
      status = undefined;
    }
    if (r.code !== 0 || status !== 0) throw new AccError('sf', `The retrieve from ${env.org} failed: ${message.trim() || lastLine(r.stderr || r.stdout) || `exit ${r.code}`}. The full output is in ${log}`);

    const expected = [...readList(dir, config.knownDrift), ...readList(dir, config.environmentSpecific)];
    const found = statusOf(deps.run, dir);
    // Only source folders count: the retrieve writes nowhere else, and tool folders such as .sf/ aren't drift.
    const source = packageDirs(dir);
    found.changed = under(found.changed, source);
    found.added = under(found.added, source);
    const keep = (p: string) => !listed(p, expected);
    const changed = found.changed.filter(keep);
    const added = found.added.filter(keep);
    // A retrieve doesn't delete local files, so what the org lacks shows only in its "cannot be found" list.
    const { lacking, other } = failures(r.stdout);
    const tracked = under(git(['ls-files'], dir).stdout.split('\n').filter(Boolean), source);
    const lackingFiles = [...new Set(lacking.flatMap((c) => filesFor(c.type, c.fullName, tracked)))].sort();
    const missing = lackingFiles.filter(keep);
    const result: DriftResult = {
      env: env.branch, org: env.org, base, changed, added, missing, unretrievable: other,
      ignored: found.changed.length + found.added.length + lackingFiles.length - changed.length - added.length - missing.length,
      checkedAt: deps.now().toISOString(), kept: opts.keep ? dir : null,
    };
    writeFileSync(driftReportPath(paths, env.branch), JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally {
    if (!opts.keep) {
      git(['worktree', 'remove', '--force', dir]);
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      git(['worktree', 'prune']);
    }
  }
}

