/**
 * The stray-files check (GH-103): a change mustn't add what an agent leaves behind, or a client's data.
 * PhotoCraft's main branch got fb-test.log and fb-clippy.log from one agent's pull request and a 1,929-line
 * test.tmp from another, and a Salesforce project's root often holds data exports. Only the files a change
 * adds count, never those already on the environment's branch. It's built in for every profile and required
 * unless `strayFiles.required` is false (D-113).
 *
 * It fails a change that adds:
 * - a scratch file: `*.log`, `*.tmp`, `*.orig`, `*.rej` or `.DS_Store`, at any depth;
 * - a new file at the repo's root;
 * - a file whose committed blob is over 1 MB;
 * - in Salesforce, a data file (`*.csv`, `*.xls`, `*.xlsx`, `*.eml`) outside the folders `strayFiles.data` lists.
 *
 * A path or folder in `strayFiles.allow` passes every rule. Allowances come from the checked commit's own
 * .acc/config.json, so a builder and the merge queue give the same answer, and a listing shows in the diff.
 */
import { parseConfig, type Config, type Profile } from './config.ts';
import type { Gate, Outcome } from './gates.ts';

/** Client data, as the setup steps' B3.gitignore and B3.data-files name it too: one definition of it. */
export const DATA_EXT = /\.(csv|xls|xlsx|eml)$/i;
/** Over this many bytes, committed, a file has to be listed: 1 MB. */
export const MAX_FILE_BYTES = 1024 * 1024;

const SCRATCH = /\.(log|tmp|orig|rej)$/i;

export type StrayRule = 'scratch' | 'data' | 'size' | 'root';

export interface StrayFile {
  path: string;
  rule: StrayRule;
}

export interface StrayRules {
  profile: Profile;
  /** Paths, or folders, a change may add whatever they are. */
  allow: string[];
  /** Salesforce: folders where data files belong. */
  data: string[];
}

/** Whether a path is a listed one, or inside a listed folder, as `listed` in gates.ts matches (no globs). */
const inside = (path: string, list: string[]): boolean => list.some((p) => path === p || path.startsWith(`${p.replace(/\/+$/, '')}/`));

/**
 * The files a change adds that it shouldn't, each with the first rule it breaks: scratch, then data, then
 * size, then root. `bytes` is a file's committed size.
 */
export function findStrayFiles(added: { path: string; bytes: number }[], rules: StrayRules): StrayFile[] {
  const out: StrayFile[] = [];
  for (const { path, bytes } of added) {
    if (inside(path, rules.allow)) continue;
    const name = path.slice(path.lastIndexOf('/') + 1);
    const rule: StrayRule | null = SCRATCH.test(name) || name === '.DS_Store' ? 'scratch'
      : rules.profile === 'salesforce' && DATA_EXT.test(name) && !inside(path, rules.data) ? 'data'
        : bytes > MAX_FILE_BYTES ? 'size'
          : !path.includes('/') ? 'root'
            : null;
    if (rule) out.push({ path, rule });
  }
  return out;
}

const WHY: Record<StrayRule, string> = {
  scratch: 'a log, temp file or merge leftover',
  data: 'a data export',
  size: 'over 1 MB',
  root: 'a new file at the repo root',
};

/** The rules a change is checked against: the checked commit's own .acc/config.json, else the caller's. */
function rulesAt(config: Config, show: () => string | null): StrayRules {
  let own: Config['strayFiles'] | undefined;
  try {
    const text = show();
    own = text ? parseConfig(JSON.parse(text)).config?.strayFiles : undefined;
  } catch {
    own = undefined;
  }
  const strayFiles = own ?? config.strayFiles;
  return { profile: config.profile, allow: strayFiles.allow, data: strayFiles.data };
}

/** The failure: each file and the rule it broke, then how to fix it. */
export function strayOutcome(found: StrayFile[], checked: number, profile: Profile): Outcome {
  if (!found.length) {
    const what = profile === 'salesforce' ? 'a log or temp file, a new root file, a file over 1 MB or a data export' : 'a log or temp file, a new root file or a file over 1 MB';
    return { status: 'pass', summary: `Checked ${checked} added file${checked === 1 ? '' : 's'}: none is ${what}.` };
  }
  const quote = (p: string) => (/^[\w@%+=:,./-]+$/.test(p) ? p : JSON.stringify(p));
  const each = found.map((f) => `${f.path} (${WHY[f.rule]})`).join(', ');
  const listing = profile === 'salesforce' ? 'list it under "strayFiles.allow" in .acc/config.json, or a data file\'s folder under "strayFiles.data"' : 'list it under "strayFiles.allow" in .acc/config.json';
  return {
    status: 'fail',
    summary: `This change adds ${found.length === 1 ? 'a file' : `${found.length} files`} that shouldn't be committed: ${each}. Take each out of the commit with git rm --cached ${found.map((f) => quote(f.path)).join(' ')} and add it to .gitignore, or, if it belongs in the repo, ${listing}.`,
    details: { files: found },
  };
}

export const strayFilesGate: Gate = {
  name: 'stray-files', heavy: false, about: 'no logs, temp files, new root files, files over 1 MB or (Salesforce) data exports added',
  plan({ config, changes, unknownBase, git }) {
    if (unknownBase) return { outcome: { status: 'error', summary: `${unknownBase} stray-files checks only the files a change adds, so it needs that branch.` } };
    if (!changes.added.length) return { outcome: { status: 'skip', summary: 'This change adds no files.' } };
    // The committed blob's size, not the working tree's: what git stores, and an LFS pointer is small.
    const sizes = git(['cat-file', '--batch-check=%(objectsize)'], changes.added.map((p) => `HEAD:${p}\n`).join(''));
    if (sizes.code !== 0) return { outcome: { status: 'error', summary: `git couldn't size the added files: ${sizes.stderr.trim().split('\n')[0] ?? ''}` } };
    const lines = sizes.stdout.split('\n');
    const added = changes.added.map((path, i) => ({ path, bytes: Number(lines[i]) || 0 }));
    const rules = rulesAt(config, () => {
      const r = git(['show', 'HEAD:.acc/config.json']);
      return r.code === 0 ? r.stdout : null;
    });
    return { outcome: strayOutcome(findStrayFiles(added, rules), added.length, config.profile) };
  },
};
