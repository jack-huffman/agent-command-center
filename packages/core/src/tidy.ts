/**
 * The tidy-up after a burst of parallel work (GH-104). With many builders at once and nobody tidying, code
 * collects copies of one helper and comments that say the opposite of the code elsewhere. Once `tidy.every`
 * tasks have merged in a repo since the last tidy-up, the Command Center offers a task to find those in
 * the files they touched, changing no behaviour. acc only drafts it: a person adds it, or skips it, and
 * either resets the count. Nothing here runs on its own: not sync, not autopilot.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Config, defaultEnvironment, tidyEvery } from './config.ts';
import { AccError, type Runner, run as gitRun } from './exec.ts';
import { listed, readList } from './gates.ts';
import { type Ledger, mutate, type Task, upsertTasks, writeAtomic } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { fetchBranches } from './sync.ts';

/** The label a tidy-up task carries, so its own merge never counts toward the next one. */
export const TIDY_LABEL = 'tidy-up';

/** The last tidy-up a person added or skipped, kept at `<git-common-dir>/acc/tidy.json`. */
export interface TidyRecord {
  v: 1;
  at: string;
  by: string;
  outcome: 'added' | 'skipped';
  /** The tidy-up task it added. */
  task?: string;
  /** The merged tasks it covered. */
  covered: string[];
}

export const tidyFile = (paths: Pick<RepoPaths, 'stateDir'>): string => join(paths.stateDir, 'tidy.json');

/** The last tidy-up on record, or null: none yet, or a file acc can't read. */
export function readTidy(paths: Pick<RepoPaths, 'stateDir'>): TidyRecord | null {
  try {
    const r = JSON.parse(readFileSync(tidyFile(paths), 'utf8')) as TidyRecord;
    return r?.v === 1 && typeof r.at === 'string' && (r.outcome === 'added' || r.outcome === 'skipped') && Array.isArray(r.covered) ? r : null;
  } catch {
    return null;
  }
}

/** A task moved to done by its pull request's merge, or whose branch a person merged in git. */
export interface MergedTask {
  id: string;
  title: string;
  /** When it moved to done, else when acc sync saw its merge. */
  at: string;
  /** The pull request's number; null for a branch merged in git with none. */
  pr: number | null;
  mergeSha: string | null;
  branch: string | null;
}

export interface TidyStatus {
  every: number;
  /** The merged tasks since the last tidy-up, oldest first: what a tidy-up would cover. */
  tasks: MergedTask[];
  count: number;
  /** count has reached every, and no tidy-up task is open. */
  due: boolean;
  /** A tidy-up task not done yet: it holds the next offer back. */
  open: string | null;
  last: TidyRecord | null;
}

/** Whether a task's branch is in its environment's branch. */
export type InEnvironment = (t: Task) => boolean;

/**
 * Reads git: the task's branch is an ancestor of its environment's branch (origin's copy when there is one,
 * else the local one), as after a merge a person made. The branch is the local one, or origin's copy once
 * the local one is deleted, as it often is after a merge, as tidyScope reads it.
 */
export function branchInEnvironment(run: Runner, root: string): InEnvironment {
  return (t) => {
    const branch = t.run?.branch;
    if (!branch) return false;
    const inRef = (tip: string, ref: string) => run('git', ['merge-base', '--is-ancestor', tip, ref], { cwd: root }).code === 0;
    return [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`].some((tip) => inRef(tip, `refs/remotes/origin/${t.environment}`) || inRef(tip, `refs/heads/${t.environment}`));
  };
}

/** An InEnvironment that asks git once for each branch and environment, and keeps the answers in `known` (the caller drops them when the ledger is read again). */
export function rememberInEnvironment(ask: InEnvironment, known: Map<string, boolean>): InEnvironment {
  return (t) => {
    const key = `${t.run?.branch}\0${t.environment}`;
    let merged = known.get(key);
    if (merged === undefined) known.set(key, (merged = ask(t)));
    return merged;
  };
}

function mergedTask(t: Task, inEnvironment: InEnvironment): MergedTask | null {
  if (t.state !== 'done' || t.labels.includes(TIDY_LABEL)) return null;
  const viaPr = t.pr?.state === 'merged';
  if (!viaPr && !inEnvironment(t)) return null;
  const done = [...t.history].reverse().find((h) => h.to === 'done');
  const at = done?.at ?? t.pr?.syncedAt ?? t.updatedAt;
  return { id: t.id, title: t.title, at, pr: t.pr?.number ?? null, mergeSha: viaPr ? t.pr?.mergeSha ?? null : null, branch: t.run?.branch ?? null };
}

/**
 * Whether a tidy-up is due in a repo: the tasks merged since the last tidy-up a person added or skipped,
 * not counting tidy-ups. With none on record yet, only the newest `every`, so a busy repo gets an offer at
 * once with a scope a person can read, and older work isn't swept in.
 */
export function tidyDue(ledger: Pick<Ledger, 'tasks'>, config: Pick<Config, 'tidy'>, last: TidyRecord | null, inEnvironment: InEnvironment = () => false): TidyStatus {
  const every = tidyEvery(config);
  const merged = ledger.tasks.map((t) => mergedTask(t, inEnvironment)).filter((m): m is MergedTask => !!m).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const covered = new Set(last?.covered ?? []);
  const tasks = last ? merged.filter((m) => m.at > last.at && !covered.has(m.id)) : every ? merged.slice(-every) : [];
  const open = ledger.tasks.find((t) => t.labels.includes(TIDY_LABEL) && t.state !== 'done')?.id ?? null;
  return { every, tasks, count: tasks.length, due: every > 0 && !open && tasks.length >= every, open, last };
}

/** What a repo's ledger and its record say now. */
export function tidyStatus(paths: Pick<RepoPaths, 'ledger' | 'stateDir' | 'root'>, config: Pick<Config, 'tidy'>, ledger: Pick<Ledger, 'tasks'>, run: Runner = gitRun): TidyStatus {
  return tidyDue(ledger, config, readTidy(paths), branchInEnvironment(run, paths.root));
}

// ---------------------------------------------------------------- the files they touched

export interface TidyScope {
  /** The default environment's branch, where the files are read. */
  branch: string;
  /** The ref read: origin's copy when there is one, else the local branch. */
  tip: string;
  /** Whether origin's copy was fetched just now. False with an origin means it may be behind. */
  fetched: boolean;
  /** The files those tasks' merges changed that are still on the branch, but for what a tidy-up leaves alone. */
  files: string[];
  /** Tasks whose files couldn't be found, with why. */
  unknown: { task: string; why: string }[];
  /** Files changed and still there, but left out: append-only, environment-specific or acc's own. */
  leftOut: string[];
}

const git = (run: Runner, root: string, args: string[]) => run('git', args, { cwd: root });
const names = (out: string): string[] => out.split('\0').filter(Boolean);

/**
 * What a task's branch changed, as two commits to compare, when acc has no merge commit for it: the merge on
 * `tip` that took the branch in, against its first parent; else, for one squashed in, the branch against
 * where it left `tip`. Null when neither tells: a branch fast-forwarded in has no commits of its own to show.
 */
function branchRange(run: Runner, root: string, tip: string, ref: string): [string, string] | null {
  const head = git(run, root, ['rev-parse', `${ref}^{commit}`]).stdout.trim();
  const merges = git(run, root, ['rev-list', '--merges', '--first-parent', '--parents', tip]).stdout.split('\n');
  const merge = merges.map((l) => l.split(' ')).find(([, , ...others]) => others.includes(head))?.[0];
  if (merge) return [`${merge}^1`, merge];
  const base = git(run, root, ['merge-base', tip, ref]).stdout.trim();
  return base && base !== head ? [base, ref] : null;
}

/**
 * The files a tidy-up looks at: what each task's merge changed (its merge commit against its first parent),
 * else its branch against where it left the environment's branch, kept when they still exist at the tip.
 * Append-only files (autopilot.appendOnly), environment-specific ones and .acc/ are left out. A task whose
 * files can't be found is listed as unknown, never dropped quietly.
 */
export function tidyScope(run: Runner, root: string, config: Config, tasks: Pick<MergedTask, 'id' | 'mergeSha' | 'branch'>[], env: NodeJS.ProcessEnv = process.env): TidyScope {
  const branch = defaultEnvironment(config).branch;
  const hasOrigin = git(run, root, ['remote', 'get-url', 'origin']).code === 0;
  // Unattended, so git never stops to ask for a password.
  const fetched = hasOrigin && fetchBranches(run, root, [branch], { ...env, GIT_TERMINAL_PROMPT: '0' });
  const verify = (ref: string) => git(run, root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).code === 0;
  const tip = [`origin/${branch}`, branch].find(verify);
  if (!tip) throw new AccError('no-base', `There's no ${branch} or origin/${branch} branch here to read the files on.`);
  const changed = new Set<string>();
  const unknown: TidyScope['unknown'] = [];
  for (const t of tasks) {
    let files: string[] | null = null;
    let why = '';
    if (t.mergeSha && verify(t.mergeSha)) {
      const d = git(run, root, ['diff', '--name-only', '--no-renames', '-z', `${t.mergeSha}^1`, t.mergeSha]);
      if (d.code === 0) files = names(d.stdout);
      else why = `git couldn't compare its merge commit ${t.mergeSha.slice(0, 7)} with its parent`;
    } else if (t.mergeSha) why = `its merge commit ${t.mergeSha.slice(0, 7)} isn't in this clone${hasOrigin && !fetched ? ', and fetching it failed' : ''}`;
    if (!files && !t.mergeSha) {
      const ref = t.branch ? [`origin/${t.branch}`, t.branch].find(verify) : undefined;
      const range = ref ? branchRange(run, root, tip, ref) : null;
      const d = range ? git(run, root, ['diff', '--name-only', '--no-renames', '-z', ...range]) : null;
      if (d?.code === 0) files = names(d.stdout);
      else why = t.branch ? `acc didn't record its merge commit, and its branch ${t.branch} is gone` : 'acc didn\'t record its merge commit or its branch';
    }
    if (files) files.forEach((f) => changed.add(f));
    else unknown.push({ task: t.id, why });
  }
  const there = new Set(names(git(run, root, ['ls-tree', '-r', '--name-only', '-z', tip]).stdout));
  const skip = [...(config.autopilot?.appendOnly ?? []), ...readList(root, config.environmentSpecific), '.acc'];
  const live = [...changed].filter((f) => there.has(f)).sort();
  return { branch, tip, fetched, files: live.filter((f) => !listed(f, skip)), unknown, leftOut: live.filter((f) => listed(f, skip)) };
}

// ---------------------------------------------------------------- the draft

export interface TidyDraft {
  title: string;
  brief: string;
  labels: string[];
  /** The merged tasks it covers. */
  covered: string[];
  files: string[];
  unknown: TidyScope['unknown'];
}

/** The tidy-up task, as a person reads it before adding it. */
export function draftTidy(status: Pick<TidyStatus, 'tasks'>, scope: TidyScope): TidyDraft {
  const n = status.tasks.length;
  const ids = status.tasks.map((t) => t.id);
  const brief = [
    `${n} task${n === 1 ? '' : 's'} merged in this repo since the last tidy-up: ${ids.join(', ')}. With many builders at once and nobody tidying, code collects copies of one helper, and comments that say the opposite of the code elsewhere. This task finds those in the files those tasks changed, and changes no behaviour.`,
    '',
    '## What to look for',
    '',
    '- **Duplicated helpers:** a function, or a few lines, that does what another one already does. Keep one, the exported one where there is one, and call it from where the copies were.',
    '- **Comments that contradict the code:** a comment or doc line that says the code does something it doesn\'t, or that something isn\'t done when it is elsewhere. Make it say what the code does, or remove it.',
    '',
    '## Acceptance criteria',
    '',
    '- [ ] Each duplicated helper found in these files is one helper now, called from where its copies were, and the note names each.',
    '- [ ] Each comment found contradicting the code says what the code does, or is gone.',
    '- [ ] It changes no behaviour: no test\'s expectations change, and every check passes as before.',
    '- [ ] It changes only the files below. It may call a helper that lives elsewhere; a duplicate whose copies are all elsewhere goes in the note\'s open lines.',
    '',
    `## The files (${scope.files.length})`,
    '',
    `What those tasks' merges changed that is still on \`${scope.branch}\`, without append-only, environment-specific and \`.acc/\` files:`,
    '',
    ...(scope.files.length ? scope.files.map((f) => `- \`${f}\``) : ['- none']),
    ...(scope.unknown.length ? ['', '## Tasks whose files aren\'t known', '', 'Their changes aren\'t in the list above. Look at them by hand if they matter:', '', ...scope.unknown.map((u) => `- ${u.task}: ${u.why}.`)] : []),
  ].join('\n');
  return { title: `Tidy up after ${n} merge${n === 1 ? '' : 's'}`, brief, labels: [TIDY_LABEL], covered: ids, files: scope.files, unknown: scope.unknown };
}

// ---------------------------------------------------------------- a person's choice

function writeRecord(paths: Pick<RepoPaths, 'stateDir'>, r: TidyRecord): void {
  mkdirSync(paths.stateDir, { recursive: true });
  writeAtomic(tidyFile(paths), JSON.stringify(r, null, 2) + '\n');
}

/**
 * Adds the drafted tidy-up as a task of its own, in todo on the default environment, and records it, so the
 * count starts again. Only a person does this: nothing adds one on its own.
 */
export function addTidy(paths: RepoPaths, config: Config, draft: TidyDraft, who: { by: string; now: () => Date }): { task: string; record: TidyRecord } {
  if (!draft.covered.length) throw new AccError('refused', 'Nothing has merged since the last tidy-up, so there\'s nothing to tidy.');
  if (!draft.files.length && !draft.unknown.length) throw new AccError('refused', 'None of the files those tasks changed is left to tidy. acc tidy skip records that, so the count starts again.');
  return mutate(paths, who.now, (ledger, emit) => {
    const open = ledger.tasks.find((t) => t.labels.includes(TIDY_LABEL) && t.state !== 'done');
    if (open) throw new AccError('refused', `${open.id} is a tidy-up that isn't done yet. Finish it, or remove it, before adding another.`);
    const res = upsertTasks(ledger, config, [{ source: { kind: 'manual' }, title: draft.title, brief: draft.brief, labels: draft.labels }], 'human', who.by, emit, who.now);
    const task = res.added[0];
    if (!task) throw new AccError('refused', `The tidy-up couldn't be added: ${res.errors.join(' ') || 'acc doesn\'t know why'}`);
    const record: TidyRecord = { v: 1, at: who.now().toISOString(), by: who.by, outcome: 'added', task, covered: draft.covered };
    writeRecord(paths, record);
    return { task, record };
  });
}

/** Records the offered tidy-up as skipped, by whom and when, so the next offer comes after another `every` merge. */
export function skipTidy(paths: RepoPaths, config: Config, who: { by: string; now: () => Date }): TidyRecord {
  return mutate(paths, who.now, (ledger) => {
    const status = tidyStatus(paths, config, ledger);
    if (!status.count) throw new AccError('refused', 'Nothing has merged since the last tidy-up, so there\'s nothing to skip.');
    const record: TidyRecord = { v: 1, at: who.now().toISOString(), by: who.by, outcome: 'skipped', covered: status.tasks.map((t) => t.id) };
    writeRecord(paths, record);
    return record;
  });
}
