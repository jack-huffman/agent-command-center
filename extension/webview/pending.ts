// What a page is waiting on acc for. Kept apart from main.ts, which runs in the webview, so node's tests
// can import it.

/**
 * Replies a page waits for, by key: an answer being recorded, an update being posted or discarded, a
 * question being drafted for the client. Each shows as on its way until acc replies, and a refusal
 * stays, saying why, until it's tried again or the thing it was for leaves the page (D-059).
 */
export class Pending<W extends string> {
  private readonly sending = new Map<string, W>();
  private readonly errors = new Map<string, string>();

  /** Starts sending, and drops the last try's error. False if one is already on its way. */
  start(key: string, what: W): boolean {
    if (this.sending.has(key)) return false;
    this.sending.set(key, what);
    this.errors.delete(key);
    return true;
  }

  /** What's on its way for this key, if anything. */
  what(key: string): W | undefined {
    return this.sending.get(key);
  }

  /** Why the last try didn't go. */
  error(key: string): string | undefined {
    return this.errors.get(key);
  }

  /** acc replied: it's no longer on its way. A refusal keeps why; a success clears it. Returns what was sent. */
  settle(key: string, why: string | null): W | undefined {
    const was = this.sending.get(key);
    this.sending.delete(key);
    if (why === null) this.errors.delete(key);
    else this.errors.set(key, why);
    return was;
  }

  /** Whatever has left the page leaves nothing behind: no "Sending…", no old error. */
  forget(live: ReadonlySet<string>): void {
    for (const k of [...this.sending.keys()]) if (!live.has(k)) this.sending.delete(k);
    for (const k of [...this.errors.keys()]) if (!live.has(k)) this.errors.delete(k);
  }
}
