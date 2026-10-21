/**
 * Away from the window (D-164): from its focus changes and the time, whether the person has been gone long
 * enough that news should wait for them on the Overview, not in a notification. Like the rest of logic/, no
 * `vscode` import, so it can be tested with node:test.
 */

import { noticeCounts, OVERVIEW_COMMAND, type ProjectNotice, type Said } from './notices.ts';

/** The window has had no focus this long: the person is away. */
export const AWAY_AFTER_MS = 10 * 60_000;

/** The Overview's "Since you last looked" heading, which the welcome back's Show opens at. */
export const SINCE_PART = 'overview:since';

/**
 * One window's away spans, and the news held in the newest. A span starts when the focus has been gone
 * AWAY_AFTER_MS, and ends when it comes back. While a span lasts, news is held and urgent notices still
 * show. What it held stays, for the Overview, until a person clears it or the next span starts.
 */
export class Away {
  /** When the window lost focus, or null while it has it. */
  private lost: number | null;
  /** The span that started with this loss of focus has reset the list. */
  private started = false;
  private held: ProjectNotice[] = [];

  constructor(focused: boolean, now: number) {
    this.lost = focused ? null : now;
  }

  /** Whether the person is away now, and the start of a new span if they just became so: its news starts empty. */
  away(now: number): boolean {
    if (this.lost === null || now - this.lost < AWAY_AFTER_MS) return false;
    if (!this.started) {
      this.started = true;
      this.held = [];
    }
    return true;
  }

  /**
   * The window's focus changed. Back after an away span, it's the news that span held, which may be none;
   * otherwise null. Focus going, or coming back before the person was away, ends nothing.
   */
  focus(focused: boolean, now: number): ProjectNotice[] | null {
    if (!focused) {
      if (this.lost === null) this.lost = now;
      return null;
    }
    const wasAway = this.lost !== null && this.away(now);
    this.lost = null;
    this.started = false;
    return wasAway ? [...this.held] : null;
  }

  /** What to show of one reload's notices: all of them, or, while away, the urgent ones; the news is held. */
  sort(all: ProjectNotice[], now: number): ProjectNotice[] {
    if (!this.away(now)) return all;
    this.held.push(...all.filter((p) => !p.notice.urgent));
    return all.filter((p) => p.notice.urgent);
  }

  /**
   * News that waits on the Overview whether or not the person is away, such as a board's sprint changing
   * (T-78): it joins the list, and is never a notification of its own.
   */
  note(n: ProjectNotice, now: number): void {
    // Start the span first if it is due, so its reset cannot drop this line when away() first passes the limit.
    this.away(now);
    this.held.push(n);
  }

  /** The news the newest span held, oldest first, for the Overview. */

  since(): readonly ProjectNotice[] {
    return this.held;
  }

  /** A person cleared the list on the Overview. */
  clear(): void {
    this.held = [];
  }
}

/** The one notification on coming back: "While you were away", then the counts as a burst words them; Show opens the Overview at the list. */
export function welcomeBack(news: ProjectNotice[]): Said | null {
  if (!news.length) return null;
  return { text: `While you were away: ${noticeCounts(news)}.`, urgent: news.some((p) => p.notice.urgent), actions: [['Show', OVERVIEW_COMMAND]], task: null, part: SINCE_PART };
}
