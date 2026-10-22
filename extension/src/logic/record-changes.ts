/**
 * Record changes from a task's page (T-100): "Add a change made by hand", and a promotion's Mark done and
 * Skip, each asked of acc as the person. Nothing here writes a record in any org. Like the rest of logic/,
 * no `vscode` import, so it can be tested with node:test.
 */
import { type Message, recordArgs, stepArgs } from '../model/record-changes.ts';
import { accRefusal } from './connect.ts';
import { inProcessWords } from './processes.ts';

type Result = { code: number; stdout: string; stderr: string };
export type RecordReply = { ok: true } | { ok: false; error: string };

/** How acc's answer reads on the page: done, or why not, each of a refusal's lines in one. */
export function recordReply(r: Result): RecordReply {
  const no = accRefusal(r);
  return no === null ? { ok: true } : { ok: false, error: no.replace(/:?\n- /g, ': ').replace(/\n- /g, ' ') };
}

/** Runs acc for a page's message, as the person, and says how it went. */
export async function actOn(m: Message, acc: (args: string[], cwd: string) => Promise<Result>): Promise<RecordReply> {
  const args = m.type === 'record-add' ? recordArgs(m.task, m) : stepArgs(m.task, m.change, m.env, m.skip);
  try {
    return recordReply(await acc(args, m.project));
  } catch (e) {
    return { ok: false, error: inProcessWords((e as Error).message) };
  }
}
