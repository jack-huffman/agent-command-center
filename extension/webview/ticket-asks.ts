// What a section of a task's page has asked the extension for (T-81, T-84, T-100, T-101): each button sends
// a message, shows it's on its way until the extension replies, and a refusal shows why, beside the buttons.
// The sections of criteria, verify, manifest and record changes each keep one of these, by the task's peekKey.

import { peekKey } from './dom.ts';
import { Pending } from './pending.ts';
import { api, state } from './state.ts';

/** What the page says when a reply holds no reason of its own. */
const NO_REASON = 'It didn\'t go, and the Command Center didn\'t say why.';

/** The extension's reply to an ask: which task it was for, and how it went. */
export interface AskReply { project?: string; task?: string; ok?: boolean; error?: string }

export class TicketAsks<W extends string = string> {
  private readonly pending = new Pending<W>();

  /** What's on its way for this task's key, if anything. */
  busy(key: string): W | undefined {
    return this.pending.what(key);
  }

  /** Why the last try didn't go. */
  error(key: string): string | undefined {
    return this.pending.error(key);
  }

  /** Shows `why` beside the buttons without asking anything: the page itself found the reason. */
  fail(key: string, why: string): void {
    this.pending.settle(key, why);
    if (state.last) state.draw(state.last);
  }

  /** Sends `msg` for the task, and shows `what` as on its way. One at a time: nothing is sent while another is. */
  ask(key: string, what: W, msg: Record<string, unknown>): void {
    if (!this.pending.start(key, what)) return;
    api.postMessage(msg);
    if (state.last) state.draw(state.last);
  }

  /**
   * The extension's reply to the task the message names: no longer on its way. A refusal keeps why, to try
   * again; a success runs `onOk` before the page redraws with what was done. Nothing happens for a reply to
   * what wasn't asked.
   */
  done(msg: AskReply, onOk: (key: string) => void = () => {}): void {
    const key = peekKey(msg.project ?? '', msg.task ?? '');
    if (this.pending.what(key) === undefined) return;
    this.pending.settle(key, msg.ok ? null : msg.error?.trim() || NO_REASON);
    if (msg.ok) onOk(key);
    if (state.last) state.draw(state.last);
  }
}
