/**
 * The shape-first split's actions (T-104): the tasks in flight and ready the analyst reads, a person's "Split
 * into these tasks", and what the rest's packet says about the shape it builds on. The shapes themselves,
 * and how they're read, are in shape-first.ts.
 */

import { type Analysis, readAnalysis, writeAnalysis } from './analyze.ts';
import type { Config } from './config.ts';
import { AccError, type Runner } from './exec.ts';
import { applyMove, checkMove, type Ledger, mutate, noGateHooks, readyTasks, type Task, upsertTasks } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { decisionIn } from './shape-first.ts';
import { codeList, MATE_STATE, teamOf } from './team.ts';

/**
 * The tasks in flight and ready, for the analyst (T-103's team): who would use a shape. Empty when the team
 * can't be read, so a plan is made without it.
 */
export function shapeTeamLines(paths: RepoPaths, config: Config, ledger: Pick<Ledger, 'tasks'>, run: Runner, id: string): string[] {
  try {
    const team = teamOf(paths, config, ledger, run, id);
    const flight = team.mates.map((m) => `- ${m.id} (${MATE_STATE[m.state] ?? m.state}): ${m.title}.${m.planned?.length ? ` Its plan changes ${codeList(m.planned)}.` : ''}`);
    const ready = readyTasks(ledger as Ledger).filter((t) => t.id !== id).map((t) => `- ${t.id} (ready): ${t.title}`);
    if (!flight.length && !ready.length) return [];
    return ['## The tasks in flight and ready', '', 'Look here for tasks that would build on a shape this work changes.', '', ...flight, ...ready, ''];
  } catch {
    return [];
  }
}

/** The ticket's own words for a suggestion that no longer holds: a task already running, or done. */
export function splitRefusal(task: Pick<Task, 'id' | 'state'>, a: Analysis): string | null {
  if (!a.shapeSplit) return `${task.id}'s plan suggests no shape-first split.`;
  if (a.shapeSplit.made) return `${task.id} is already split into ${a.shapeSplit.made.first} and ${a.shapeSplit.made.rest}.`;
  if (task.state !== 'todo') return `${task.id} isn't waiting to be built, so it can't be split.`;
  return null;
}

/**
 * A person's "Split into these tasks": makes the first task (the shape) and the rest, which depends on it,
 * on the task's environment. The task itself is blocked with the reason, so nobody builds it twice. Only a
 * person does it; the CLI refuses an agent.
 */
export function splitShapeFirst(paths: RepoPaths, config: Config, id: string, by: string, now: () => Date): { first: string; rest: string } {
  const a = readAnalysis(paths, id);
  if (!a) throw new AccError('no-analysis', `${id} has no plan yet: acc analyze ${id}.`);
  const made = mutate(paths, now, (ledger, emit) => {
    const task = ledger.tasks.find((t) => t.id === id);
    if (!task) throw new AccError('no-task', `No task ${id}.`);
    const why = splitRefusal(task, a);
    if (why) throw new AccError('refused', why);
    const s = a.shapeSplit!;
    const from = `Split from ${id}: ${task.title}.`;
    const base = { source: { kind: 'manual' as const }, environment: task.environment, labels: task.labels };
    const first = upsertTasks(ledger, config, [{ ...base, title: s.first.title, brief: `${s.first.brief}\n\n${from} It makes the shape and its tests only: nothing is drawn.` }], 'human', by, emit, now);
    if (first.errors.length) throw new AccError('refused', first.errors.join(' '));
    const firstId = first.added[0]!;
    const rest = upsertTasks(ledger, config, [{ ...base, title: s.rest.title, brief: `${s.rest.brief}\n\n${from} It waits for ${firstId}, which makes the shape it builds on.`, deps: [firstId] }], 'human', by, emit, now);
    if (rest.errors.length) throw new AccError('refused', rest.errors.join(' '));
    const restId = rest.added[0]!;
    ledger.tasks.find((t) => t.id === restId)!.shapeFrom = { task: firstId, shapes: (a.sharedShapes ?? []).map((x) => x.name), files: [...new Set((a.sharedShapes ?? []).flatMap((x) => x.files))] };
    const req = { to: 'blocked' as const, actor: 'human' as const, by, reason: `Split into ${firstId} (the shape) and ${restId} (the rest).` };
    const problems = checkMove(ledger, config, task, req, noGateHooks);
    if (problems.length) throw new AccError('refused', problems.join(' '));
    applyMove(task, req, emit, now);
    return { first: firstId, rest: restId };
  });
  a.shapeSplit!.made = { ...made, by, at: now().toISOString() };
  writeAnalysis(paths, a);
  return made;
}

/**
 * For the rest of a split, in its packet: the task that made the shape, the shapes, its decision and the files
 * that hold them. The files are what that task changed once it merged, else the ones its plan named. Nothing
 * for a task that isn't the rest of a split.
 */
export function shapeSection(task: Pick<Task, 'shapeFrom'>, deps: Pick<Task, 'id' | 'title' | 'state' | 'changes'>[]): string[] {
  const from = task.shapeFrom;
  if (!from) return [];
  const first = deps.find((d) => d.id === from.task);
  const merged = first?.changes?.paths ?? [];
  const decision = decisionIn(merged);
  const files = merged.length ? merged.filter((f) => !f.startsWith('docs/decisions/')) : from.files;
  return [
    '## The shape you build on',
    '',
    `${from.task}${first ? `, ${first.title},` : ''} made the shape first so this task could start: ${from.shapes.length ? from.shapes.join('; ') : 'the shape the plan names'}. Build on it as it is. If it needs a change, block with the question, and never change it here.`,
    '',
    decision ? `- Its decision: ${decision.id}, in \`${decision.file}\`.` : `- Its decision: ${from.task}'s own note and decision file in \`docs/decisions/\`.`,
    `- Its files: ${files.length ? codeList(files) : 'none named'}.`,
    '',
  ];
}
