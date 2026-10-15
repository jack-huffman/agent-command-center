/**
 * The check's receipt (T-56, after D-079): when npm run check passes it writes dist/check-receipt.json, and
 * npm run package reads it to skip a second run of the same check. D-079's step stays: package still needs a
 * passed check of this tree. It only isn't repeated when one passed on this tree under 24 hours ago.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RECEIPT_FILE = join('dist', 'check-receipt.json');
export const RECEIPT_MAX_AGE_MS = 24 * 60 * 60_000;

export interface Receipt {
  tree: string;
  clean: boolean;
  at: string;
}

/** What the working tree is, read from git. */
export interface TreeState {
  commit: string;
  tree: string;
  clean: boolean;
}

const git = (root: string, args: string[]): string | null => {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
};

/** HEAD's commit and tree, and whether nothing is changed or untracked (ignored files don't count). Null outside git. */
export function treeState(root: string): TreeState | null {
  const commit = git(root, ['rev-parse', 'HEAD']);
  const tree = git(root, ['rev-parse', 'HEAD^{tree}']);
  const status = git(root, ['status', '--porcelain']);
  return commit && tree && status !== null ? { commit, tree, clean: status === '' } : null;
}

/** Writes the receipt whole (a temp file, then a rename). Null, and no file, when git can't say what HEAD is. */
export function writeReceipt(root: string, state: TreeState | null, now: Date): Receipt | null {
  if (!state) return null;
  const receipt: Receipt = { tree: state.tree, clean: state.clean, at: now.toISOString() };
  const file = join(root, RECEIPT_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, `${JSON.stringify(receipt, null, 2)}\n`);
  renameSync(`${file}.tmp`, file);
  return receipt;
}

/** The receipt on disk, or null when there is none or it isn't one. */
export function readReceipt(root: string): Receipt | null {
  const file = join(root, RECEIPT_FILE);
  if (!existsSync(file)) return null;
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as Partial<Receipt>;
    return typeof j.tree === 'string' && typeof j.clean === 'boolean' && typeof j.at === 'string' && !Number.isNaN(Date.parse(j.at)) ? { tree: j.tree, clean: j.clean, at: j.at } : null;
  } catch {
    return null;
  }
}

export type CheckDecision = { run: true; why: string } | { run: false; message: string };

/** Whether package runs the check: it skips only for a receipt of HEAD's tree, a clean tree now, and under 24 hours. */
export function decideCheck(receipt: Receipt | null, state: TreeState | null, now: Date, force: boolean): CheckDecision {
  if (force) return { run: true, why: '--check asks for the check' };
  if (!receipt) return { run: true, why: 'no receipt of a passed check' };
  if (!state) return { run: true, why: 'git can\'t say what HEAD is' };
  if (receipt.tree !== state.tree) return { run: true, why: 'the receipt is for another commit' };
  if (!receipt.clean || !state.clean) return { run: true, why: 'the working tree isn\'t clean' };
  const age = now.getTime() - Date.parse(receipt.at);
  if (age >= RECEIPT_MAX_AGE_MS) return { run: true, why: 'the receipt is over 24 hours old' };
  if (age < 0) return { run: true, why: 'the receipt is from the future: the clock has moved' };
  return { run: false, message: `Skipping npm run check: it passed on commit ${state.commit.slice(0, 7)} at ${receipt.at}, and nothing has changed. npm run package -- --check runs it again.` };
}

// node scripts/check-receipt.ts: the last step of npm run check.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const r = writeReceipt(root, treeState(root), new Date());
  console.log(r ? `Wrote ${RECEIPT_FILE}: tree ${r.tree.slice(0, 7)}, ${r.clean ? 'clean' : 'not clean'}, ${r.at}.` : 'No receipt: git can\'t say what HEAD is.');
}
