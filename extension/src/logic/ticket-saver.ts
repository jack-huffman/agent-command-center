/**
 * Saves each card's whole ticket where a session can read it (T-141, D-225), and keeps it up to date. After a
 * board load has drawn, the tickets whose last-changed time moved since their saved copy, and any card with no saved
 * copy, wait in a queue per project; they are read one at a time, spaced, in the background. A ticket that hasn't
 * changed is never read again. Anything the person does goes first: while a ticket is read for them, or a board loads,
 * the queue waits, and a ticket the person opens is saved from that read and leaves the queue. Each ticket is saved as
 * soon as it is read, so a queue stopped part-way (the project or window closed) goes on from there next load.
 * Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */
import {
  markSavedFailed, needsRead, pruneSavedTickets, readSavedTicket, readSavedTickets, removeSavedTicket, removeTrackerTickets, type TicketRead, savedTicketOf, writeSavedTicket,
} from '../../../packages/core/src/saved-tickets.ts';
import type { BoardCard } from '../../../packages/core/src/trackers/types.ts';
import { unreadWhy } from './plan-ticket.ts';

/** What saving tickets needs from the extension, passed in so it's tested without VS Code or a tracker. */
export interface TicketSaverHost {
  /** The ticket from the project's tracker at `index`, read in full. */
  read(root: string, index: number, key: string): Promise<TicketRead>;
  /** The ticket's changes field (T-105), with its name, or null where the tracker names none. */
  changes(root: string, index: number, key: string): Promise<{ name: string; markdown: string } | null>;
  /** Waits between two reads. */
  wait(ms: number): Promise<void>;
  now(): Date;
  /** Told when a read fails or a file can't be written, for the output log. */
  warn(line: string): void;
}

/** How long the queue waits before each read, so reading a board's tickets never floods its tracker. */
export const SAVE_SPACING_MS = 1500;

/** One board as the last load found it: its tracker's key, and its cards, or null when it didn't load. */
export interface FollowedBoard {
  index: number;
  tracker: string;
  cards: readonly Pick<BoardCard, 'key' | 'updated'>[] | null;
}

interface Job {
  root: string;
  paths: { stateDir: string };
  index: number;
  tracker: string;
  key: string;
  updated: string | undefined;
}

export class TicketSaver {
  private readonly host: TicketSaverHost;
  private readonly queues = new Map<string, Job[]>();
  /** Each project's queue's run, by the stop count it started at: a stopped run ends at its next step. */
  private readonly runs = new Map<string, { gen: number; done: Promise<void> }>();
  private readonly gens = new Map<string, number>();
  /** The trackers and keys each project's last load showed, by tracker key: what a ticket the person opens is saved against. */
  private readonly shown = new Map<string, Map<string, Set<string>>>();
  /** What the person is doing now: reads wait until it is none. */
  private held = 0;
  private waiters: (() => void)[] = [];

  constructor(host: TicketSaverHost) {
    this.host = host;
  }

  /**
   * After a board load has drawn: the saved tickets follow the boards (pruneSavedTickets), and the cards whose ticket
   * changed, or has no saved copy, are queued, the board on show (`first`) first. Nothing is read before this returns.
   */
  follow(root: string, paths: { stateDir: string }, boards: readonly FollowedBoard[], first: number | null = null): { queued: string[]; removed: string[] } {
    // Every saved ticket is read once a load: the prune and each card's check both use this read.
    const all = readSavedTickets(paths);
    const removed = pruneSavedTickets(paths, boards.map((b) => ({ tracker: b.tracker, keys: b.cards?.map((c) => c.key) ?? null })), all);
    const gone = new Set(removed.map((k) => k.toUpperCase()));
    const saved = new Map(all.filter((t) => !gone.has(t.key.toUpperCase())).map((t) => [t.key.toUpperCase(), t]));
    const now = this.host.now();
    const seen = new Set<string>();
    const jobs: Job[] = [];
    const shown = new Map<string, Set<string>>();
    for (const b of [...boards].sort((x, y) => Number(y.index === first) - Number(x.index === first))) {
      // A board that didn't load keeps what the last load showed of it.
      shown.set(b.tracker, b.cards ? new Set(b.cards.map((c) => c.key.toUpperCase())) : this.shown.get(root)?.get(b.tracker) ?? new Set());
      for (const c of b.cards ?? []) {
        const key = c.key.toUpperCase();
        if (seen.has(key)) continue;
        seen.add(key);
        if (needsRead(c, saved.get(key) ?? null, now)) jobs.push({ root, paths, index: b.index, tracker: b.tracker, key, updated: c.updated });
      }
    }
    this.shown.set(root, shown);
    this.queues.set(root, jobs);
    this.start(root);
    return { queued: jobs.map((j) => j.key), removed };
  }

  /** The keys still waiting to be read for a project, in the order they will be. */
  waiting(root: string): string[] {
    return (this.queues.get(root) ?? []).map((j) => j.key);
  }

  /** A board the person switched to (T-127): its tickets are read before the rest. */
  first(root: string, index: number): void {
    const q = this.queues.get(root);
    if (q) this.queues.set(root, [...q.filter((j) => j.index === index), ...q.filter((j) => j.index !== index)]);
  }

  /** Runs something the person asked for; the queue reads nothing until it ends. */
  async person<T>(work: () => Promise<T>): Promise<T> {
    this.held++;
    try {
      return await work();
    } finally {
      this.held--;
      if (!this.held) for (const w of this.waiters.splice(0)) w();
    }
  }

  /**
   * A ticket the person opens, read for them now, ahead of the queue. Where the last load showed it and its saved copy
   * is out of date, that read is saved (with its changes field) and it leaves the queue. Gives back the read.
   */
  async open<T extends TicketRead>(root: string, paths: { stateDir: string }, index: number, tracker: string, read: () => Promise<T>): Promise<T> {
    const t = await this.person(read);
    const key = t.key.toUpperCase();
    if (!this.shown.get(root)?.get(tracker)?.has(key)) return t;
    const saved = readSavedTicket(paths, key);
    this.queues.set(root, (this.queues.get(root) ?? []).filter((j) => j.key !== key));
    if (saved && !saved.failed && !needsRead({ updated: t.updated || undefined }, saved, this.host.now())) return t;
    await this.person(async () => {
      const changes = await this.host.changes(root, index, key).catch(() => null);
      this.save({ root, paths, index, tracker, key, updated: t.updated }, t, changes);
    });
    return t;
  }

  /** Signing out of a tracker: its tickets leave the queue, and their saved copies are removed. Gives back the keys removed. */
  forget(root: string, paths: { stateDir: string }, tracker: string): string[] {
    this.queues.set(root, (this.queues.get(root) ?? []).filter((j) => j.tracker !== tracker));
    this.shown.get(root)?.delete(tracker);
    return removeTrackerTickets(paths, tracker);
  }

  /** Stops a project's queue, as when it closes. What was saved stays; the next load goes on from there. */
  stop(root: string): void {
    this.gens.set(root, (this.gens.get(root) ?? 0) + 1);
    this.queues.delete(root);
    this.shown.delete(root);
    this.runs.delete(root);
  }

  /** Stops the queue of every project not in `roots`. */
  keepOnly(roots: readonly string[]): void {
    for (const root of new Set([...this.queues.keys(), ...this.shown.keys()])) if (!roots.includes(root)) this.stop(root);
  }

  /** Stops every queue, as when the window closes. */
  stopAll(): void {
    for (const root of new Set([...this.queues.keys(), ...this.shown.keys(), ...this.runs.keys()])) this.stop(root);
  }

  /** Resolves once a project's queue has nothing left to read, or was stopped. */
  async idle(root: string): Promise<void> {
    while (this.runs.get(root)) await this.runs.get(root)!.done;
  }

  private start(root: string): void {
    const gen = this.gens.get(root) ?? 0;
    if (this.runs.get(root)?.gen === gen) return;
    const run = { gen, done: Promise.resolve() };
    run.done = this.run(root, gen).finally(() => { if (this.runs.get(root) === run) this.runs.delete(root); });
    this.runs.set(root, run);
  }

  private live(root: string, gen: number): boolean {
    return (this.gens.get(root) ?? 0) === gen;
  }

  private async quiet(): Promise<void> {
    while (this.held) await new Promise<void>((r) => this.waiters.push(r));
  }

  private async run(root: string, gen: number): Promise<void> {
    for (;;) {
      // Spaced, and never before the caller's board has drawn: the first read waits too.
      await this.host.wait(SAVE_SPACING_MS);
      await this.quiet();
      if (!this.live(root, gen)) return;
      const job = this.queues.get(root)?.shift();
      if (!job) return;
      await this.readOne(job, gen);
    }
  }

  private async readOne(job: Job, gen: number): Promise<void> {
    // Read and saved since it was queued (the person opened it): not read again.
    const saved = readSavedTicket(job.paths, job.key);
    if (saved && !saved.failed && !needsRead({ updated: job.updated }, saved, this.host.now())) return;
    try {
      const t = await this.host.read(job.root, job.index, job.key);
      const changes = await this.host.changes(job.root, job.index, job.key).catch(() => null);
      // Stopped, or signed out, while it was read: nothing is written after.
      if (!this.live(job.root, gen) || !this.shown.get(job.root)?.has(job.tracker)) return;
      this.save(job, t, changes);
    } catch (e) {
      if (!this.live(job.root, gen)) return;
      // Outside the repo's place (D-072): only tickets in it are kept.
      if ((e as { kind?: unknown })?.kind === 'outside') return removeSavedTicket(job.paths, job.key);
      const why = unreadWhy(e);
      this.host.warn(`[tickets] ${job.key}: ${why}`);
      try {
        markSavedFailed(job.paths, job.key, why, this.host.now());
      } catch (w) {
        this.host.warn(`[tickets] couldn't mark ${job.key}'s saved copy: ${(w as Error).message}`);
      }
    }
  }

  private save(job: Job, t: TicketRead, changes: { name: string; markdown: string } | null): void {
    try {
      writeSavedTicket(job.paths, savedTicketOf(t, changes, job.tracker, this.host.now()));
    } catch (e) {
      this.host.warn(`[tickets] couldn't save ${job.key}: ${(e as Error).message}`);
    }
  }
}
