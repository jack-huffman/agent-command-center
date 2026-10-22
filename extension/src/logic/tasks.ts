/**
 * What a task shows and does: waiting for other tasks' files and starting held ones, its analysis
 *, its pull request, and landing it.
 * Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */

import { type Analysis, SIZE_MEANING } from '../../../packages/core/src/analyze.ts';
import { type FileShare, shownNote, type Task } from '../../../packages/core/src/ledger.ts';
import { askOf, unchosen } from '../../../packages/core/src/plan.ts';
import { fileList, prConflicts, type RowFiles, shortPath, TASK_GROUPS, type TaskGroup, taskNames, type TaskRow } from './shared.ts';
import { forYou } from './plan.ts';

/** Whether a task to do would wait for others' files: it shares some, and another Ready task shares none (D-093). */
export const waitsForFiles = (row: Pick<TaskRow, 'state' | 'files'>): boolean => row.state === 'todo' && !!row.files?.shares.length && !!row.files.first.length;

/**
 * Each task's files for a card: three names in all, short, at least one a task, the rest going to the
 * first; or every file in full, for a task's page.
 */
function namedEach(shares: FileShare[], full: boolean): string[] {
  if (full) return shares.map((s) => s.files.join(', '));
  return shares.map((s, i) => fileList(s.files.map(shortPath), i ? 1 : Math.max(1, 3 - (shares.length - 1))));
}

/**
 * "Waits for GH-70's files: logic.ts, model.ts", and each further task's: ", and GH-71's: main.ts" (D-093).
 * With `first`, what starts before it: ", while GH-74 is ready to start", as acc says it.
 */
export function waitLine(shares: FileShare[], full = false, first: string[] = []): string {
  const files = namedEach(shares, full);
  return `Waits for ${shares.map((s, i) => `${s.task}'s${i ? '' : ' files'}: ${files[i]}`).join(', and ')}${whileFirst(first, full)}`;
}

/** ", while GH-74 is ready to start", or ", while GH-74 and GH-75 are": the Ready tasks that go first. A card names two. */
export function whileFirst(first: string[], full: boolean): string {
  if (!first.length) return '';
  const named = full || first.length <= 2 ? taskNames(first) : `${first.slice(0, 2).join(', ')} and ${first.length - 2} more`;
  return `, while ${named} ${first.length === 1 ? 'is' : 'are'} ready to start`;
}

/** "Shares files with GH-70: logic.ts", and each further task's: ", and GH-71: main.ts" (D-093). */
export function sharesLine(shares: FileShare[], full = false): string {
  const files = namedEach(shares, full);
  return `Shares files with ${shares.map((s, i) => `${s.task}: ${files[i]}`).join(', and ')}`;
}

/** What a Ready card says when its task's files aren't known (D-093): it has no analysis, or one that names no files. */
export const filesUnknown = (analyzed: boolean): string => `Its files aren't known: ${analyzed ? 'its analysis names no files' : 'no analysis to compare with work in flight'}`;

/**
 * What Dispatch asks first when a task would wait for others' files (D-093): which tasks, with each file in
 * full, and what goes first. Its buttons are Wait for GH-x, and Dispatch anyway.
 */
export function waitQuestion(row: Pick<TaskRow, 'id'> & { files: Pick<RowFiles, 'shares' | 'first'> }): { message: string; detail: string; wait: string } {
  const { shares, first } = row.files;
  const blockers = taskNames(shares.map((s) => s.task));
  return {
    message: `${row.id} shares files with ${blockers}`,
    detail: [
      ...shares.map((s) => `${s.task}: ${s.files.join(', ')}`),
      '',
      `${taskNames(first)} ${first.length === 1 ? 'shares' : 'share'} no files with work in flight, so ${first.length === 1 ? 'it goes' : 'they go'} first. ${row.id} waits, and starts on its own once ${blockers} ${shares.length === 1 ? 'merges' : 'merge'} or nothing else is ready.`,
    ].join('\n'),
    wait: `Wait for ${blockers}`,
  };
}

/** What Dispatch anyway confirms (D-093): each task it shares files with, and those files in full. */
export function anywayQuestion(row: Pick<TaskRow, 'id'> & { files?: Pick<RowFiles, 'shares'> | null }): { message: string; detail: string } {
  const shares = row.files?.shares ?? [];
  if (!shares.length) return { message: `Dispatch ${row.id} now?`, detail: 'An agent starts on it in its own worktree.' };
  return {
    message: `Dispatch ${row.id} anyway?`,
    detail: [
      'It shares files with work in flight:',
      ...shares.map((s) => `${s.task}: ${s.files.join(', ')}`),
      '',
      'Both builders may change them, and the second pull request to merge may conflict there.',
    ].join('\n'),
  };
}

/** What a task's row keeps of its analysis: enough for its card, its notices and the Overview. */
export function rowAnalysis(a: Analysis): NonNullable<TaskRow['analysis']> {
  const open = a.questions.filter((q) => !q.answer).map((q) => ({ id: q.id, question: q.question, why: q.why, suggested: q.suggested, askOf: askOf(q) }));
  return { verdict: a.verdict, at: a.at, open, split: a.split, size: a.approach.size, choices: unchosen(a).length, approved: !!a.approval, version: a.version ?? 1 };
}

/** The analysis's size, in words, to weigh the model by (D-086), or that there's none to go on. */
export function sizeLine(row: Pick<TaskRow, 'analysis'>): string {
  const size = row.analysis?.size;
  return size ? `Its analysis sizes it ${size}: ${SIZE_MEANING[size]}.` : row.analysis ? 'Its analysis gave no size.' : 'Not analyzed: no size to go on.';
}

/**
 * Its plan is ready to build from: made, not too big, every question for you answered, every choice made,
 * and its latest version approved (T-97). A question for the ticket's author holds nothing.
 */
export const analysisReady = (row: Pick<TaskRow, 'analysis'>): boolean => !!row.analysis && row.analysis.verdict !== 'split' && !forYou(row.analysis.open).length && !row.analysis.choices && !!row.analysis.approved;

/**
 * What a task to do waits on from its analysis, if anything: a person's answers, or a split (D-052), its
 * choices, or, where the project wants a plan, an approval (T-97). Only a task to do: the plan comes
 * before the build.
 */
export function analysisWait(row: Pick<TaskRow, 'state' | 'analysis' | 'analyzing'> & { analysisRequired?: boolean }): 'questions' | 'split' | 'choices' | 'approve' | null {
  if (row.state !== 'todo' || !row.analysis || row.analyzing) return null;
  if (row.analysis.verdict === 'split') return 'split';
  if (forYou(row.analysis.open).length) return 'questions';
  if (row.analysis.choices) return 'choices';
  return row.analysisRequired && !row.analysis.approved ? 'approve' : null;
}

/** acc's arguments for a person's answer (D-012). The words come after --, so an answer that starts with - stays words. */
export const analysisAnswerArgs = (task: string, question: string, text: string): string[] => ['analysis', 'answer', task, question, '--json', '--', text];

/**
 * Whether acc sync has a pull request to follow for a task: its own, still open, or a promotion taking it
 * on, whose merge tells its ticket the change is in the next environment (D-075). Or an issue to close
 * that it tries again, so a failed close isn't left once no pull request is open (D-082).
 */
export const followsPullRequests = (row: Pick<TaskRow, 'pr' | 'promoting' | 'closing'>): boolean => row.pr?.state === 'open' || !!row.promoting || !!row.closing;

/** What a card, a tracker's card and a ticket's page say about checks that failed on GitHub (D-076). */
export const failedChecksLine = (row: Pick<TaskRow, 'checks'>): string | null => (row.checks?.length ? `Checks failed on GitHub: ${row.checks.join(', ')}` : null);

/**
 * What a card and a ticket's page say about a pull request that won't merge into its base. A card names
 * the first few files by folder and name; the page names every file in full.
 */
export const conflictLine = (row: Pick<TaskRow, 'pr' | 'environment'>, full = false): string | null => {
  const files = prConflicts(row);
  return files.length ? `Conflicts with ${row.environment}: ${full ? files.join(', ') : fileList(files.map(shortPath))}` : null;
};

/**
 * What the Command Center says after a land: the pull request, and that the ticket's update is ready to
 * review, since acc posts nothing itself (D-066). An update that couldn't be drafted is a warning, as the
 * CLI's orange '!' is (D-053).
 */
export function landMessage(id: string, r: { opened?: boolean; pr?: { number: number }; update?: { id: string; key: string } | null; updateError?: string }): { level: 'info' | 'warning'; text: string } {
  const landed = `${id}: ${r.opened ? 'opened' : 'updated'} pull request #${r.pr?.number}.`;
  if (r.updateError) return { level: 'warning', text: `${landed} No update was drafted for its ticket: ${r.updateError.replace(/([^.!?])$/, '$1.')}` };
  // A GitHub issue's key is #12; the board names it by its task, GH-12.
  return { level: 'info', text: r.update ? `${landed} An update for ${r.update.key.startsWith('#') ? id : r.update.key} is ready for you to review and post.` : landed };
}

export function groupTasks(rows: TaskRow[]): { group: TaskGroup; tasks: TaskRow[] }[] {
  return TASK_GROUPS.map((group) => ({ group, tasks: rows.filter((r) => r.display === group) })).filter((g) => g.tasks.length);
}

/**
 * A held task that started (D-093): "GH-73 started: GH-70's files are free", or that nothing else was
 * ready, so it shares files with GH-70. `what` says who started it.
 */
export function startedNotice(what: string, s: { waitedFor?: string[]; shares?: FileShare[] }): string {
  if (s.shares?.length) return `${what}: nothing else was ready, so it shares files with ${taskNames(s.shares.map((x) => x.task))}.`;
  return s.waitedFor?.length ? `${what}: ${taskNames(s.waitedFor)}'s files are free.` : `${what}.`;
}

/** The held tasks the board says may start now (D-093): their wait is over, under the cap, with nothing they depend on unfinished. */
export const heldDue = (rows: Pick<TaskRow, 'id' | 'state' | 'files' | 'deps'>[]): string[] =>
  rows.filter((r) => r.state === 'todo' && !!r.files?.held && !r.files.held.failed && !r.files.capped && !r.deps.length && !waitsForFiles(r)).map((r) => r.id);

/** How soon the board asks acc to start a project's held tasks again, and how rarely at most, while acc keeps them waiting. */
export const HELD_ASK_MS = 30_000;
export const HELD_ASK_MAX_MS = 10 * 60_000;

/** The board's last ask of `acc dispatch --held` in a project: what it saw, when, and how long until it asks again. */
export interface HeldAsk {
  key: string;
  at: number;
  delay: number;
}

/**
 * What the board saw when it asked: the held tasks it said were due, and each task's state and pull
 * request. When any of that changes, as when acc sync marks a pull request merged, it asks again soon.
 */
export const heldAskKey = (rows: Pick<TaskRow, 'id' | 'state' | 'pr'>[], due: string[]): string =>
  JSON.stringify([due, rows.map((r) => [r.id, r.state, r.pr?.state ?? null])]);

/** Whether the board may ask again: 30 seconds after a change, or once the wait since its last ask is over. */
export const heldAskDue = (last: HeldAsk | undefined, key: string, now: number): boolean =>
  !last || now - last.at >= (last.key === key ? last.delay : HELD_ASK_MS);

/**
 * After an ask (D-093). The board and acc can disagree: the board doesn't see a branch merged on origin
 * or a protected environment, and each ask fetches. So while acc keeps returning every task the board
 * said was due under waiting, and the board saw nothing change, it waits twice as long each time, up to
 * 10 minutes. Anything else asks again in 30 seconds.
 */
export function heldAsked(last: HeldAsk | undefined, key: string, now: number, due: string[], waiting: string[]): HeldAsk {
  const same = due.length > 0 && due.every((id) => waiting.includes(id));
  const delay = same ? Math.min((last?.key === key ? last.delay : HELD_ASK_MS) * 2, HELD_ASK_MAX_MS) : HELD_ASK_MS;
  return { key, at: now, delay };
}

/**
 * A task drafted from a still-open line of a task's note (D-106), for a person to edit and confirm: the
 * line as its title, a brief that cites the task, its run and the note's date, the same environment, and,
 * while the task isn't done, a dependency on it. Null when the line isn't one of the note's.
 */
export function draftFromOpen(task: Pick<Task, 'id' | 'title' | 'environment' | 'state' | 'run'>, line: string): { title: string; brief: string; env: string; deps: string[] } | null {
  const { note, fromLast } = shownNote(task);
  if (!note || !note.open.includes(line)) return null;
  const n = (task.run?.n ?? 1) - (fromLast ? 1 : 0);
  return {
    title: line,
    brief: `Still open from ${task.id} (${task.title}), as its builder ${n} noted on ${note.at.slice(0, 10)}:\n\n${line}`,
    env: task.environment,
    deps: task.state === 'done' ? [] : [task.id],
  };
}

/** acc add's arguments for a task drafted from a note's line (D-106). The title goes last and the brief after =, so a leading - is words. */
export const addTaskArgs = (d: { title: string; brief: string; env: string; deps: string[] }): string[] =>
  ['add', `--brief=${d.brief}`, '--env', d.env, ...d.deps.flatMap((x) => ['--dep', x]), '--json', '--', d.title];
