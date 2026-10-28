// What the Agent panel says at a glance (T-142): the one line for its checks, the state and its session
// said once, and which actions stand out. Pure, so the page and its tests read the same words.

import type { Action, Look } from '../src/model/shared.ts';
import type { CheckRow, TicketAcc } from '../src/model/task-page.ts';

const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "a", "a and b", "a, b and c". */
const nameList = (names: string[]): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/**
 * Its checks in one line (T-142): "4 passed, 1 failed: validate". The ones that failed, wait for a person
 * or didn't run are named, in orange; a line of checks none of which ran says so in one phrase. The icon and
 * the words carry it; the colour only adds. Null with no checks.
 */
export function checkSummary(checks: CheckRow[]): Look | null {
  if (!checks.length) return null;
  const of = (...labels: string[]): CheckRow[] => checks.filter((c) => labels.includes(c.look.label));
  const [passed, failed, waiting, skipped, unrun, waived] = [of('pass'), of('fail', 'error'), of('needs a person'), of('skip'), of('not run'), of('waived')];
  if (unrun.length === checks.length) return { label: `${count(checks.length, 'check')}, not run on this commit`, icon: 'circle-slash', tone: 'neutral' };
  const named = (rows: CheckRow[]): string => `: ${nameList(rows.map((c) => c.gate))}`;
  const parts = [
    passed.length ? `${passed.length} passed` : null,
    failed.length ? `${failed.length} failed${named(failed)}` : null,
    waiting.length ? `${waiting.length} ${waiting.length === 1 ? 'needs' : 'need'} a person${named(waiting)}` : null,
    unrun.length ? `${unrun.length} not run${named(unrun)}` : null,
    skipped.length ? `${skipped.length} skipped` : null,
    waived.length ? `${waived.length} waived` : null,
  ].filter((p): p is string => !!p);
  const label = passed.length === checks.length ? `${count(checks.length, 'check')} passed` : parts.join(', ');
  if (failed.length) return { label, icon: 'error', tone: 'orange' };
  if (waiting.length) return { label, icon: 'person', tone: 'orange' };
  if (unrun.length) return { label, icon: 'circle-slash', tone: 'neutral' };
  return { label, icon: 'pass', tone: 'blue' };
}

/** The key the tab remembers a fold of the panel open by, per ticket, as the page's other folds are. */
export const detailsKey = (project: string, key: string): string => `agent-details:${project}#${key}`;

/** That a session's look says it's busy at work: Working, Working in the cloud, Resumed: working. */
const working = (agent: Look): boolean => /^(working|resumed: working)/i.test(agent.label);

/** The states a builder's session shouldn't still be working in: its task isn't running. */
const NOT_RUNNING = ['blocked', 'review', 'rework'];

export interface Glance {
  /** The state and the session disagree, in one plain line (T-142), else null. */
  disagree: string | null;
  /** The session's own chip, where it adds to the state: not where it says the same, nor where `disagree` speaks. */
  session: Look | null;
}

/** The state and its session, said once. Blocked while its builder still works says so, not two chips that contradict. */
export function stateGlance(a: Pick<TicketAcc, 'look' | 'state' | 'agent'>): Glance {
  if (!a.agent) return { disagree: null, session: null };
  if (NOT_RUNNING.includes(a.state) && working(a.agent)) return { disagree: `${a.look.label}: its builder is still working`, session: null };
  // Running and working say the same thing: one chip.
  if (a.agent.label === a.look.label || (a.state === 'running' && working(a.agent))) return { disagree: null, session: null };
  return { disagree: null, session: a.agent };
}

/** What each state offers beside its one next step, first to last (T-142): a blocked task, Unblock then Watch. */
const ALSO: Record<string, string[]> = { blocked: ['acc.task.unblock', 'acc.task.watch'] };
const ALSO_DEFAULT = ['acc.task.move', 'acc.task.watch'];

/**
 * A task's actions as the panel offers them (T-142): its next step (or Move, where it has none) and at most
 * two that fit its state in view; every other action in More actions. None is dropped: the two lists hold
 * the same commands as the one they were made from.
 */
export function splitActions(actions: Action[], state: string): { shown: Action[]; more: Action[] } {
  const lead = actions.find((a) => a.primary) ?? actions.find((a) => a.command === 'acc.task.move') ?? actions[0];
  if (!lead) return { shown: [], more: [] };
  const also = (ALSO[state] ?? ALSO_DEFAULT).map((c) => actions.find((a) => a.command === c)).filter((a): a is Action => !!a && a !== lead).slice(0, 2);
  const shown = [lead, ...also];
  return { shown, more: actions.filter((a) => !shown.includes(a)) };
}
