/**
 * The extension's answer to a card's or a task page's action (T-147). The page shows the button it pressed
 * as working from the click until this answer comes: the action asked its question (a confirmation opened),
 * started its work after a yes, or came to its result. Every action that reaches the extension gets a
 * result, even one that did nothing, so no button is left working. Like the rest of logic/, no `vscode`
 * import, so it can be tested with node:test.
 */

import type { Ref } from '../model/shared.ts';

/** How far an action has got: asked its question, at work after a yes, or done with its result. */
export interface RanAnswer {
  phase: 'asked' | 'running' | 'done';
  /** Done: false when it was refused or failed, and `error` says why. A cancel is done, and ok. */
  ok?: boolean;
  error?: string;
  /** Done: Clean up removed the task's worktree, so its card leaves Done at once. */
  cleaned?: boolean;
}

/** The message the page hears, naming the action by its command and ref, as it pressed it. */
export interface RanMessage extends RanAnswer {
  type: 'ran';
  command: string;
  ref: Ref;
}

/** A command handler's way to tell the page how far it has got, before it returns its result. */
export type SayRan = (a: RanAnswer) => void;

/** What a handler returned, as the page hears it: its own result when it gave one, else done and ok. */
export function ranResult(out: unknown): RanAnswer {
  if (!out || typeof out !== 'object' || typeof (out as RanAnswer).ok !== 'boolean') return { phase: 'done', ok: true };
  const r = out as RanAnswer;
  return { phase: 'done', ok: r.ok, ...(r.error ? { error: r.error } : {}), ...(r.cleaned ? { cleaned: true } : {}) };
}

/**
 * Runs a page's action with a way to say how far it has got, then answers with its result: what it
 * returned, or why it threw. A handler that already said it was done isn't answered twice.
 */
export async function answerRun(command: string, ref: Ref, run: (say: SayRan) => unknown, post: (m: RanMessage) => void): Promise<void> {
  let done = false;
  const say: SayRan = (a) => {
    if (done) return;
    if (a.phase === 'done') done = true;
    post({ type: 'ran', command, ref, ...a });
  };
  try {
    say(ranResult(await run(say)));
  } catch (e) {
    say({ phase: 'done', ok: false, error: (e as Error)?.message || 'It stopped without saying why.' });
  }
}

/**
 * Asks an action's question (T-147): the page hears it asked as the question opens, so its button goes back
 * while the person answers, and hears it running after an answer, so the button works again until the
 * result. A cancel (no answer) says nothing more: the handler returns, and is answered done.
 */
export async function asking<T>(say: SayRan | undefined, question: () => PromiseLike<T>): Promise<T> {
  say?.({ phase: 'asked' });
  const answer = await question();
  if (answer) say?.({ phase: 'running' });
  return answer;
}

/** Why an action did nothing because the task or thing it was for isn't there any more. */
export const GONE = 'It isn\'t here any more: the page shows it as it was a moment ago.';
