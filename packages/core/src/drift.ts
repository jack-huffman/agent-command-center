/**
 * Drift: what changed in an org since its branch was last updated (DESIGN section 9, D-024). The
 * baseline manifest is retrieved into a throwaway worktree and compared with the branch there. The
 * org is only read, and the main checkout isn't touched.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config, Environment } from './config.ts';
import { AccError, type Runner } from './exec.ts';
import { lastLine, listed, niced, packageDirs, readList, under } from './gates.ts';
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
}

export function environmentNamed(config: Config, name: string): Environment {
  const env = config.environments.find((e) => e.branch === name.toLowerCase() || e.name.toLowerCase() === name.toLowerCase());
  if (!env) throw new AccError('usage', `No environment "${name}". The config has: ${config.environments.map((e) => e.branch).join(', ')}.`);
  return env;
}

/** Where the latest drift report for an environment is kept, for doctor and the extension. */
export const driftReportPath = (paths: RepoPaths, branch: string): string => join(paths.stateDir, 'drift', `${branch}.json`);

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

  const dir = join(paths.stateDir, 'drift', `${env.branch}-${deps.now().getTime()}`);
  mkdirSync(join(paths.stateDir, 'drift'), { recursive: true });
  const add = git(['worktree', 'add', '--detach', '--quiet', dir, base]);
  if (add.code !== 0) throw new AccError('git', `Couldn't make a throwaway worktree: ${lastLine(add.stderr)}`);
  try {
    const retrieve = () => deps.run(...niced('sf', ['project', 'retrieve', 'start', '--manifest', manifest, '--target-org', env.org!, '--ignore-conflicts', '--wait', '60', '--json']), { cwd: dir, timeoutMs: 70 * 60_000 });
    const r = withSlot(retrieve, { ...deps.slots, onWait: deps.onWait });
    let status: number | undefined;
    let message = '';
    try {
      const j = JSON.parse(r.stdout) as { status?: number; message?: string };
      status = j.status;
      message = j.message ?? '';
    } catch {
      status = undefined;
    }
    if (r.code !== 0 || status !== 0) throw new AccError('sf', `The retrieve from ${env.org} failed: ${message.trim() || lastLine(r.stderr || r.stdout) || `exit ${r.code}`}`);

    const expected = [...readList(dir, config.knownDrift), ...readList(dir, config.environmentSpecific)];
    const found = statusOf(deps.run, dir);
    // Only source folders count: the retrieve writes nowhere else, and tool folders such as .sf/ aren't drift.
    const source = packageDirs(dir);
    found.changed = under(found.changed, source);
    found.added = under(found.added, source);
    const keep = (p: string) => !listed(p, expected);
    const changed = found.changed.filter(keep);
    const added = found.added.filter(keep);
    const result: DriftResult = {
      env: env.branch, org: env.org, base, changed, added,
      ignored: found.changed.length + found.added.length - changed.length - added.length,
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

