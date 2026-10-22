/**
 * Changes outside git (T-100): what a ticket changes that no commit holds, such as a record in a Salesforce
 * org. The core keeps them generic, each with its kind; a profile adds a kind (the salesforce profile adds
 * records, D-003). Each is kept on its task in the ledger, with who made it and when, and whether the plan
 * listed it. In a builder's session, acc's hooks note each command that can make one; acc done refuses while
 * a noted command has no change recorded after it, unless the builder says it made none, and why.
 */
import { AccError } from './exec.ts';
import { type Actor, mutate, type Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { plural } from './text.ts';

/** A kind of change outside git, as a profile adds it. `D` is what one change of the kind holds. */
export interface OutsideKind<D> {
  kind: string;
  /** The profile it belongs to: a project of another profile can't record one. */
  profile: string;
  /** What its group is called on a ticket's page. */
  label: string;
  /** Why a change can't be kept, or nothing. */
  problems(d: D): string[];
  /** The change in plain words. */
  words(d: D): string;
  /** What makes two changes the same one, so a recorded change is matched with the plan's. */
  key(d: D): string;
  /** The commands that make it in another org, for a person to review and run. */
  script(d: D, org: string | null): string[];
}

/** A change outside git, as its task keeps it. */
export interface OutsideChange<D = unknown> {
  /** c1, c2, …: its number on the task. */
  id: string;
  kind: string;
  detail: D;
  why: string;
  /** Whether the task's plan listed it. */
  planned: boolean;
  actor: Actor;
  by: string;
  at: string;
}

/** A command a builder ran that can make a change outside git, noted by acc's hooks. */
export interface NotedCommand {
  command: string;
  kind: string;
  at: string;
}

/** A builder saying a noted command made no change, and why. */
export interface NoneMade {
  why: string;
  by: string;
  at: string;
}

/**
 * One change to make by hand in an environment its task's work was promoted to (D-018). todo until a person
 * marks it done, or skips it with a reason.
 */
export interface OutsideStep {
  change: string;
  /** The environment's branch, and its org's alias when it has one. */
  env: string;
  org: string | null;
  state: 'todo' | 'done' | 'skipped';
  reason: string | null;
  by: string | null;
  at: string | null;
  /** When the promotion added it. */
  added: string;
}

/** What a task keeps of its changes outside git. */
export interface OutsideState {
  changes: OutsideChange[];
  noted: NotedCommand[];
  none: NoneMade[];
  steps: OutsideStep[];
}

export const emptyOutside = (): OutsideState => ({ changes: [], noted: [], none: [], steps: [] });

/** The task's changes outside git, made whole: a task from before T-100 has none. */
export const outsideOf = (t: Pick<Task, 'outside'>): OutsideState => ({ ...emptyOutside(), ...(t.outside ?? {}) });

/** The longest a why may be, as a note's line. */
export const WHY_MAX = 300;

export interface Who {
  actor: Actor;
  by: string;
}

function change<T>(paths: RepoPaths, now: () => Date, id: string, who: Who, fn: (t: Task, at: string) => T): T {
  return mutate(paths, now, (ledger, emit) => {
    const t = ledger.tasks.find((x) => x.id === id);
    if (!t) throw new AccError('no-task', `No task ${id}.`);
    const at = now().toISOString();
    const r = fn(t, at);
    t.updatedAt = at;
    emit({ type: 'task.updated', task: t.id, actor: who.actor, by: who.by, data: { outside: r } });
    return r;
  });
}

/** Why a builder can't record for this task: only its own, while it runs. */
function builderRefusal(t: Task, who: Who): string | null {
  if (who.actor !== 'builder') return null;
  if (who.by !== `builder:${t.id}`) return `A builder records changes for its own task only, not ${t.id}.`;
  if (t.state !== 'running' && t.state !== 'rework') return `${t.id} is ${t.state}: its builder isn't running.`;
  return null;
}

const whyProblem = (why: string): string | null => (!why.trim() ? 'Say why it was made (--why "<text>"): whoever replicates it reads that.' : why.trim().length > WHY_MAX ? `Say why in at most ${WHY_MAX} characters.` : null);

/**
 * Keeps a change outside git with its task, with who made it and when (T-100): a builder's for its own task,
 * or a person's for what they did in the org's own pages. Refused, with why, when its kind refuses it.
 */
export function recordOutside<D>(paths: RepoPaths, now: () => Date, id: string, kind: OutsideKind<D>, detail: D, why: string, who: Who, planned: { profile: string; keys: string[] }): OutsideChange<D> {
  if (planned.profile !== kind.profile) throw new AccError('refused', `${kind.label} belong to the ${kind.profile} profile, and this project's is ${planned.profile}.`);
  const problems = [whyProblem(why), ...kind.problems(detail)].filter((x): x is string => !!x);
  if (problems.length) throw new AccError('refused', `That change can't be kept:\n- ${problems.join('\n- ')}`);
  return change(paths, now, id, who, (t, at) => {
    const why2 = builderRefusal(t, who);
    if (why2) throw new AccError('refused', why2);
    const o = outsideOf(t);
    const n = o.changes.reduce((m, c) => Math.max(m, Number(c.id.slice(1)) || 0), 0) + 1;
    const c: OutsideChange<D> = { id: `c${n}`, kind: kind.kind, detail, why: why.trim(), planned: planned.keys.includes(kind.key(detail)), actor: who.actor, by: who.by, at };
    o.changes.push(c);
    t.outside = o;
    return c;
  });
}

/** A builder saying it made no change outside git after the commands acc noted, and why (T-100). */
export function recordNone(paths: RepoPaths, now: () => Date, id: string, why: string, who: Who): NoneMade {
  const problem = whyProblem(why);
  if (problem) throw new AccError('refused', problem.replace('was made', 'none was made').replace(' (--why "<text>")', ': acc change none "<why>"'));
  return change(paths, now, id, who, (t, at) => {
    const refusal = builderRefusal(t, who);
    if (refusal) throw new AccError('refused', refusal);
    const o = outsideOf(t);
    if (!unrecorded(o).length) throw new AccError('refused', `acc noted no command since ${t.id}'s last recorded change, so there's nothing to say none about.`);
    const n: NoneMade = { why: why.trim(), by: who.by, at };
    o.none.push(n);
    t.outside = o;
    return n;
  });
}

/** Notes a command a builder ran that can make a change outside git (T-100). acc's hooks call it. */
export function noteCommand(paths: RepoPaths, now: () => Date, id: string, command: string, kind: string): NotedCommand {
  return change(paths, now, id, { actor: 'builder', by: `builder:${id}` }, (t, at) => {
    const o = outsideOf(t);
    const n: NotedCommand = { command: command.length > 500 ? `${command.slice(0, 499)}…` : command, kind, at };
    o.noted.push(n);
    t.outside = o;
    return n;
  });
}

/** The noted commands with no change recorded after them, nor a builder's word that none was made. */
export function unrecorded(o: Pick<OutsideState, 'changes' | 'noted' | 'none'>): NotedCommand[] {
  const last = [...o.changes.map((c) => c.at), ...o.none.map((n) => n.at)].sort().pop() ?? '';
  return o.noted.filter((n) => n.at > last);
}

/**
 * Why acc done refuses (T-100): a command that can change records ran after the last recorded change. The
 * builder records what it changed, or says none was made, and why.
 */
export function unrecordedProblems(t: Pick<Task, 'id' | 'outside'>): string[] {
  const left = unrecorded(outsideOf(t));
  if (!left.length) return [];
  return [`${plural(left.length, 'command')} you ran can change records, and no change was recorded after ${left.length === 1 ? 'it' : 'them'}: ${left.map((n) => n.command).join('; ')}. Record each change with acc change record ${t.id} --object <Object> --match '<field>=<value>' --set '<field>=<value>' --why "<why>", or say none was made: acc change none "<why>".`];
}

/** The changes a task planned that nobody has recorded yet, by key. */
export const unmade = <D>(planned: (D & { why: string; refused?: string })[], made: OutsideChange[], kind: OutsideKind<D>): (D & { why: string; refused?: string })[] => {
  const keys = new Set(made.filter((c) => c.kind === kind.kind).map((c) => kind.key(c.detail as D)));
  return planned.filter((p) => !keys.has(kind.key(p)));
};
