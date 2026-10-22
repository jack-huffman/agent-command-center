import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readAnalysis } from './analyze.ts';
import { writeAtomic } from './atomic.ts';
import { mergeCommitPaths } from './changes.ts';
import type { Config } from './config.ts';
import type { Runner } from './exec.ts';
import { type Ledger, type State, type Task } from './ledger.ts';
import { branchFiles, branchMerged, inFlight, overlaps, plannedFiles, sharedFiles } from './overlap.ts';
import type { RepoPaths } from './paths.ts';
import { escapeRegExp } from './text.ts';

/**
 * Builders as a team (T-103). Each builder knows the other tasks in flight in its project: what each plans
 * to change, what its branch has changed so far, and, first, the files it shares with this task. It also
 * knows what merged into its environment's branch since its own branch left it. The packet carries this as
 * dispatch saw it, `acc team` says it as of now, the reviewer's prompt carries it too, and the task's page
 * shows it. When a teammate's merge shares files with a running builder, acc's hook tells that builder
 * once, and `acc refresh` takes the merge in (take-in.ts).
 */

/** Another task in flight, as its teammates see it. */
export interface Mate {
  id: string;
  title: string;
  state: State;
  environment: string;
  /** What its plan intends to change; null when its plan names no files. */
  planned: string[] | null;
  /** What its branch has changed so far, uncommitted work in its worktree too. */
  changed: string[];
  /** The files it shares with this task, without the ones every task edits. */
  shares: string[];
}

/** A change that reached the environment's branch since this task's branch left it: one first-parent commit there. */
export interface Landed {
  sha: string;
  subject: string;
  /** The task whose work it merged, when acc can tell; null for a change it can't match to one. */
  task: string | null;
  title: string | null;
  /** What it changed; null when git can't say. */
  files: string[] | null;
  /** What of that this task changes or plans to. */
  shares: string[];
}

export interface Team {
  task: string;
  /** The environment's branch the task builds on. */
  env: string;
  /** What the task itself plans and has changed, which the shares are measured against. */
  own: string[];
  /** Sharing first, then by id. */
  mates: Mate[];
  /** Oldest first: how many merges behind its branch is. */
  landed: Landed[];
}

/** A task's state in the words its teammates read. */
export const MATE_STATE: Partial<Record<State, string>> = { running: 'being built', review: 'in review', rework: 'sent back', blocked: 'blocked' };

const git = (run: Runner, root: string, ...args: string[]) => run('git', args, { cwd: root });

/** The environment's branch as this clone has it: origin's copy first, else the local one. Null when neither is here. */
export function envRef(run: Runner, root: string, env: string): string | null {
  for (const ref of [`refs/remotes/origin/${env}`, `refs/heads/${env}`]) {
    if (git(run, root, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`).code === 0) return ref;
  }
  return null;
}

/** The commits on the environment's branch, its first parents only, that `branch` doesn't hold yet, oldest first. Empty when git can't say. */
export function landedCommits(run: Runner, root: string, env: string, branch: string): { sha: string; subject: string }[] {
  const ref = envRef(run, root, env);
  if (!ref) return [];
  const r = git(run, root, 'log', '--first-parent', '--reverse', '--format=%H%x00%s', `^refs/heads/${branch}`, ref);
  if (r.code !== 0) return [];
  return r.stdout.split('\n').filter(Boolean).map((l) => {
    const [sha, subject] = l.split('\0');
    return { sha: sha!, subject: subject ?? '' };
  });
}

/**
 * The task a commit on the environment's branch merged: the one whose pull request's merge it is, the
 * pull request its subject names, as GitHub's merge and squash subjects do, or the task its subject starts
 * with, as acc's "Merge T-102: …" and a builder's "T-102: …" do.
 */
export function taskOfCommit(tasks: Pick<Task, 'id' | 'pr'>[], sha: string, subject: string): string | null {
  const byMerge = tasks.find((t) => t.pr?.mergeSha === sha);
  if (byMerge) return byMerge.id;
  const byPr = tasks.find((t) => t.pr && new RegExp(`(?:\\(#${t.pr.number}\\)$|^Merge pull request #${t.pr.number}\\b)`).test(subject));
  if (byPr) return byPr.id;
  return tasks.find((t) => new RegExp(`^(?:Merge )?${escapeRegExp(t.id)}(?:[:\\s]|$)`).test(subject))?.id ?? null;
}

/** What a task plans and what its branch has changed: the files its teammates are measured against. */
export function ownFiles(paths: RepoPaths, run: Runner, task: Pick<Task, 'id' | 'environment' | 'run'>): string[] {
  const planned = plannedFiles(readAnalysis(paths, task.id), paths.root) ?? [];
  const changed = task.run?.branch ? branchFiles(run, paths.root, task.environment, task.run.branch, task.run.worktree) : [];
  return [...new Set([...planned, ...changed])].sort();
}

/** Each landed commit, with what it changed and what of that the task shares. */
export function landedFor(paths: RepoPaths, run: Runner, ledger: Pick<Ledger, 'tasks'>, commits: { sha: string; subject: string }[], own: string[], shared: string[]): Landed[] {
  return commits.map((c) => {
    const id = taskOfCommit(ledger.tasks, c.sha, c.subject);
    const files = mergeCommitPaths(run, paths.root, c.sha);
    return {
      sha: c.sha, subject: c.subject, task: id, title: ledger.tasks.find((t) => t.id === id)?.title ?? null, files,
      shares: files ? overlaps(own, [{ task: c.sha, files }], shared)[0]?.files ?? [] : [],
    };
  });
}

/**
 * The team of a task, as git and the ledger say now: every other task in flight whose work hasn't merged,
 * and what reached its environment's branch since its branch left it. A task with no branch yet has none
 * behind it. Git isn't fetched here: what origin holds is as this clone last fetched it.
 */
export function teamOf(paths: RepoPaths, config: Config, ledger: Pick<Ledger, 'tasks'>, run: Runner, id: string): Team {
  const task = ledger.tasks.find((t) => t.id === id);
  if (!task) return { task: id, env: '', own: [], mates: [], landed: [] };
  const shared = sharedFiles(config);
  const own = ownFiles(paths, run, task);
  const mates = inFlight(ledger, id).filter((t) => !branchMerged(run, paths.root, t)).map((t): Mate => {
    const planned = plannedFiles(readAnalysis(paths, t.id), paths.root);
    const changed = branchFiles(run, paths.root, t.environment, t.run!.branch!, t.run!.worktree);
    const files = [...new Set([...(planned ?? []), ...changed])];
    return { id: t.id, title: t.title, state: t.state, environment: t.environment, planned, changed, shares: overlaps(own, [{ task: t.id, files }], shared)[0]?.files ?? [] };
  }).sort((a, b) => Number(!a.shares.length) - Number(!b.shares.length) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  const landed = task.run?.branch ? landedFor(paths, run, ledger, landedCommits(run, paths.root, task.environment, task.run.branch), own, shared) : [];
  return { task: id, env: task.environment, own, mates, landed };
}

/**
 * A dispatched task's team, for its packet: read with its branch and worktree as this run has them, which
 * a first dispatch hasn't recorded yet. The merges it lists are marked told, since the packet tells them.
 * Null when it can't be read: the packet goes without it.
 */
export function teamForRun(paths: RepoPaths, config: Config, ledger: Pick<Ledger, 'tasks'>, run: Runner, id: string, branch: string, worktree: string): Team | null {
  try {
    const tasks = ledger.tasks.map((t) => (t.id === id ? { ...t, run: { ...t.run, branch, worktree } } : t));
    const team = teamOf(paths, config, { tasks }, run, id);
    markTold(paths, id, team.landed.map((l) => l.sha));
    return team;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- in words

/** How many files a list names before it says how many more. */
export const FILES_SHOWN = 12;

/** "`a.ts`, `b.ts` and 3 more". */
export function codeList(files: string[], max = FILES_SHOWN): string {
  const shown = files.slice(0, max).map((f) => `\`${f}\``);
  return files.length > max ? `${shown.join(', ')} and ${files.length - max} more` : shown.join(', ');
}

/** "2 merges behind", "1 merge behind" or "Up to date with main", as the task's page and acc team say it. */
export const behindWords = (team: Pick<Team, 'env' | 'landed'>): string =>
  team.landed.length ? `${team.landed.length} merge${team.landed.length === 1 ? '' : 's'} behind ${team.env}` : `Up to date with ${team.env}`;

function mateLines(m: Mate): string[] {
  return [
    `- **${m.id}** (${MATE_STATE[m.state] ?? m.state}${m.environment ? `, into \`${m.environment}\`` : ''}): ${m.title}`,
    ...(m.shares.length ? [`  - **Shares with you:** ${codeList(m.shares)}`] : []),
    `  - Its plan changes: ${m.planned?.length ? codeList(m.planned) : 'its plan names no files'}`,
    `  - Its branch has changed: ${m.changed.length ? codeList(m.changed) : 'nothing yet'}`,
  ];
}

function landedLine(l: Landed): string {
  const who = l.task ? `**${l.task}**${l.title ? `: ${l.title}` : ''}` : `"${l.subject}"`;
  const what = l.files === null ? 'git can\'t say what it changed' : l.files.length ? `changed ${codeList(l.files)}` : 'changed no files';
  return `- ${who} (${l.sha.slice(0, 7)}): ${what}${l.shares.length ? `. **Shares with you:** ${codeList(l.shares)}` : ''}`;
}

/**
 * The team as a section of the builder's packet ("Your team right now") or the reviewer's prompt ("The
 * team right now"): the tasks sharing files first and marked, the rest of the team, what merged since its
 * branch left the environment's branch, and how to work with them.
 */
export function teamSection(team: Team, who: 'builder' | 'reviewer'): string[] {
  const sharing = team.mates.filter((m) => m.shares.length);
  const rest = team.mates.filter((m) => !m.shares.length);
  const you = who === 'builder';
  const lines = [
    you ? '## Your team right now' : '## The team right now',
    '',
    you
      ? 'Other builders work in this project at the same time. This is the team as acc dispatched you. Run `acc team` for how it is now, and run it before you change a file the team shares.'
      : `Other tasks were in flight while ${team.task} was built. Judge whether this change steps on another task's area: where it changes a file another task shares, the change must be small, and the builder's note must say so.`,
    '',
  ];
  if (!team.mates.length) lines.push(`No other task is in flight${you ? ' now' : ''}.`, '');
  if (sharing.length) lines.push(`### Sharing files with ${you ? 'you' : team.task}`, '', ...sharing.flatMap(mateLines).map((l) => (you ? l : l.replace('Shares with you', `Shares with ${team.task}`))), '');
  if (rest.length) lines.push(sharing.length ? '### The rest of the team' : '### The team', '', ...rest.flatMap(mateLines), '');
  lines.push(`### Merged into \`${team.env}\` since ${you ? 'your' : 'its'} branch left it`, '');
  if (team.landed.length) lines.push(...team.landed.map((l) => (you ? landedLine(l) : landedLine(l).replace('Shares with you', `Shares with ${team.task}`))), '');
  else lines.push('Nothing yet.', '');
  if (you) {
    lines.push(
      '### How to work with them',
      '',
      '- Keep to your own module where you can.',
      '- Where you must change a module the team shares, keep the change small, and say so in your note.',
      `- When a teammate's work merges into \`${team.env}\` and shares files with yours, acc tells you. Run \`acc refresh\` to take it in early, while the conflicts are small.`,
      '',
    );
  }
  return lines;
}

// ---------------------------------------------------------------- told when a teammate lands

/** What acc keeps for a builder's notices: the merges it was told of, and what each merge changed, read once. */
export interface TeamSeen {
  told: string[];
  files: Record<string, string[] | null>;
}

/** Where acc keeps it, in the clone's state. */
export const seenPath = (paths: Pick<RepoPaths, 'stateDir'>, id: string): string => join(paths.stateDir, 'team', `${id.replace(/[^A-Za-z0-9_-]/g, '')}.json`);

/** What acc kept for a task's notices: nothing told yet when there's no file, or one it can't read. */
export function readSeen(paths: Pick<RepoPaths, 'stateDir'>, id: string): TeamSeen {
  try {
    const x = JSON.parse(readFileSync(seenPath(paths, id), 'utf8')) as Partial<TeamSeen>;
    return {
      told: Array.isArray(x.told) ? x.told.filter((s): s is string => typeof s === 'string') : [],
      files: x.files && typeof x.files === 'object' && !Array.isArray(x.files) ? x.files : {},
    };
  } catch {
    return { told: [], files: {} };
  }
}

/** Keeps it, written whole: a temp file beside it, then a rename. */
export function writeSeen(paths: Pick<RepoPaths, 'stateDir'>, id: string, seen: TeamSeen): void {
  mkdirSync(join(paths.stateDir, 'team'), { recursive: true });
  writeAtomic(seenPath(paths, id), JSON.stringify(seen));
}

/** Marks merges as told, as dispatch does for those the packet lists already. */
export function markTold(paths: Pick<RepoPaths, 'stateDir'>, id: string, shas: string[]): void {
  if (!shas.length) return;
  const seen = readSeen(paths, id);
  writeSeen(paths, id, { ...seen, told: [...new Set([...seen.told, ...shas])] });
}

/**
 * What a builder is told on its next tool use after a teammate's work merges (T-103): each merge into its
 * environment's branch that its branch doesn't hold yet, that it wasn't told of before, and that shares
 * files with its work. A merge that shares nothing now is weighed again later, as the builder's work
 * grows; what it changed is read from git once. Null when there's nothing to tell.
 */
export function teamNotice(paths: RepoPaths, config: Config, ledger: Pick<Ledger, 'tasks'>, run: Runner, id: string): string | null {
  const task = ledger.tasks.find((t) => t.id === id);
  const branch = task?.run?.branch;
  if (!task || !branch) return null;
  const seen = readSeen(paths, id);
  const fresh = landedCommits(run, paths.root, task.environment, branch).filter((c) => !seen.told.includes(c.sha));
  if (!fresh.length) return null;
  const own = ownFiles(paths, run, task);
  const shared = sharedFiles(config);
  const files = { ...seen.files };
  const told = fresh.flatMap((c) => {
    const changed = c.sha in files ? files[c.sha]! : (files[c.sha] = mergeCommitPaths(run, paths.root, c.sha));
    const shares = changed ? overlaps(own, [{ task: c.sha, files: changed }], shared)[0]?.files ?? [] : [];
    if (!shares.length) return [];
    const by = taskOfCommit(ledger.tasks, c.sha, c.subject);
    return [{ ...c, task: by, title: ledger.tasks.find((t) => t.id === by)?.title ?? null, shares }];
  });
  writeSeen(paths, id, { told: [...seen.told, ...told.map((l) => l.sha)], files });
  if (!told.length) return null;
  return [
    `A teammate's work merged into ${task.environment}, and it shares files with yours (${id}):`,
    ...told.map((l) => `- ${l.task ? `${l.task}${l.title ? ` (${l.title})` : ''}` : `"${l.subject}"`} merged as ${l.sha.slice(0, 7)}. It changed what you share: ${codeList(l.shares)}.`),
    'Run `acc refresh` to take it in now, while the conflicts are small. `acc team` shows the whole team.',
  ].join('\n');
}
