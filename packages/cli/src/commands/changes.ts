// acc change (T-100): a ticket's changes outside git, such as records in a Salesforce org. A builder or a
// person records each one with its task, a builder says when a noted command made none, and a person marks
// each step a promotion added, done or skipped with a reason.

import {
  AccError, markStep, outsideOf, plannedRecordKeys, readAnalysis, readLedger, RECORD_KIND, type RecordChange, recordNone, recordOutside, recordPair, recordWords, stepsOf, unmade, unrecordedProblems,
} from '../../../core/src/index.ts';
import { tone } from '../format.ts';
import { actorFrom, type CommandArea, now, type Opts, out, personOnly, project, taskIdFrom } from '../shared.ts';

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : []);
const looksLikeId = (s: string | undefined): s is string => !!s && /^[A-Z][A-Z0-9_]*-\d+$/i.test(s);

/** The record change the flags describe, refused when a pair has no field. */
export function recordFromFlags(o: Opts): RecordChange {
  const pairs = (flag: string) => strings(o[flag]).map((p) => {
    const pair = recordPair(p);
    if (!pair) throw new AccError('usage', `--${flag} takes <field>=<value>: "${p}" has no field before its =.`);
    return pair;
  });
  if (o.create === true && o.delete === true) throw new AccError('usage', 'A record change creates or deletes, not both.');
  const object = typeof o.object === 'string' ? o.object.trim() : '';
  if (!object) throw new AccError('usage', 'Name the object: --object <Object>, such as Account.');
  return { object, action: o.create === true ? 'create' : o.delete === true ? 'delete' : 'update', match: pairs('match'), fields: pairs('set').map((p) => ({ field: p.field, from: null, to: p.value })) };
}

/**
 * acc done's refusal (T-100): a command acc noted can write records, and no change was recorded after it,
 * nor did the builder say none was made. Nothing for a task with no noted command.
 */
export function refuseUnrecorded(id: string): void {
  const { paths } = project(process.cwd());
  const task = readLedger(paths.ledger).tasks.find((x) => x.id === id.toUpperCase());
  const problems = task ? unrecordedProblems(task) : [];
  if (problems.length) throw new AccError('move-refused', `Can't move ${task!.id} to review:\n- ${problems.join('\n- ')}`);
}

function cmdRecord(o: Opts, rest: string[]): number {
  const id = taskIdFrom(rest[0]).toUpperCase();
  const { paths, config } = project(process.cwd());
  const detail = recordFromFlags(o);
  const keys = plannedRecordKeys(readAnalysis(paths, id));
  const c = recordOutside(paths, now, id, RECORD_KIND, detail, typeof o.why === 'string' ? o.why : '', actorFrom(o), { profile: config.profile, keys });
  out(o, () => [`${id}: kept ${c.id}, ${recordWords(detail)}.`, tone(c.planned ? 'The plan listed it.' : 'The plan didn\'t list it: say why in your note.', c.planned ? 'dim' : 'orange')].join('\n'), c);
  return 0;
}

function cmdNone(o: Opts, rest: string[]): number {
  const [first, ...more] = rest;
  const named = looksLikeId(first) && more.length > 0;
  const id = taskIdFrom(named ? first : undefined).toUpperCase();
  const why = (typeof o.why === 'string' ? o.why : (named ? more : rest).join(' ')).trim();
  const { paths } = project(process.cwd());
  const n = recordNone(paths, now, id, why, actorFrom(o));
  out(o, () => `${id}: kept that the commands acc noted made no change outside git. acc done goes on.`, n);
  return 0;
}

function cmdList(o: Opts, rest: string[]): number {
  const id = taskIdFrom(rest[0]).toUpperCase();
  const { paths } = project(process.cwd());
  const task = readLedger(paths.ledger).tasks.find((x) => x.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  const o2 = outsideOf(task);
  const planned = readAnalysis(paths, id)?.recordChanges ?? [];
  const left = unmade(planned, o2.changes, RECORD_KIND);
  const steps = stepsOf(task);
  out(o, () => [
    `${id}: ${o2.changes.length} change${o2.changes.length === 1 ? '' : 's'} outside git recorded.`,
    ...o2.changes.map((c) => `  ${c.id} ${recordWords(c.detail as RecordChange)}  ${tone(`${c.planned ? 'planned' : 'not in the plan'}, by ${c.by}, ${c.at}`, 'dim')}`),
    ...(left.length ? ['', 'Planned, not made yet:', ...left.map((p) => `  ${recordWords(p)}${p.refused ? tone(`  refused: ${p.refused}`, 'orange') : ''}`)] : []),
    ...(steps.length ? ['', 'Promotion steps:', ...steps.map((s) => `  ${s.step.env} ${s.step.change} ${s.step.state === 'todo' ? tone('to do', 'orange') : s.step.state === 'done' ? tone('done', 'blue') : `skipped: ${s.step.reason}`}  ${s.words}`)] : []),
  ].join('\n'), { changes: o2.changes, planned, unmade: left, noted: o2.noted, none: o2.none, steps });
  return 0;
}

function cmdStep(o: Opts, rest: string[]): number {
  const by = personOnly(o, 'mark a promotion\'s step');
  const [raw, change] = rest;
  const env = typeof o.env === 'string' ? o.env.trim() : '';
  const skip = typeof o.skip === 'string' ? o.skip : undefined;
  if (!raw || !change || !env || (o.done !== true) === (skip === undefined)) throw new AccError('usage', 'acc change step <id> <change> --env <branch> --done | --skip "<why>"');
  const { paths } = project(process.cwd());
  const id = raw.toUpperCase();
  const s = markStep(paths, now, id, change, env, skip === undefined ? { done: true } : { skip }, { actor: 'human', by });
  out(o, () => `${id}: ${change} in ${env} is ${s.state === 'done' ? 'done' : `skipped: ${s.reason}`}.`, s);
  return 0;
}

export const area: CommandArea = {
  help: {
    section: 'Agents',
    order: 45,
    lines: `  acc change record [<id>] --object <Object> --match '<field>=<value>'... [--set '<field>=<value>']...
                    [--create|--delete] --why "<text>"
                                        Keep a record change with its task: who made it, when, and whether the plan
                                        listed it. Name the record by what is the same in every org, never its ID
  acc change none [<id>] "<why>"        Say the record commands acc noted made no change, so acc done goes on
  acc change list [<id>]                The task's changes outside git, the plan's not made yet, and its steps
  acc change step <id> <change> --env <branch> --done | --skip "<why>"
                                        Mark a promotion's step: made by hand in that environment, or skipped`,
  },
  options: {
    object: { type: 'string' },
    match: { type: 'string', multiple: true },
    set: { type: 'string', multiple: true },
    create: { type: 'boolean', default: false },
    delete: { type: 'boolean', default: false },
    why: { type: 'string' },
    env: { type: 'string' },
    done: { type: 'boolean', default: false },
    skip: { type: 'string' },
  },
  subcommands: { change: ['record', 'none', 'list', 'step'] },
  commands: {
    change: (o, rest) => {
      const [sub, ...more] = rest;
      if (sub === 'record') return cmdRecord(o, more);
      if (sub === 'none') return cmdNone(o, more);
      if (sub === 'list') return cmdList(o, more);
      if (sub === 'step') return cmdStep(o, more);
      throw new AccError('usage', 'acc change record|none|list|step: see acc help.');
    },
  },
};
