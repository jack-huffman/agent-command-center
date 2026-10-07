/**
 * What changed since a window last looked (D-044, D-064): each task's move, each step autopilot took, and
 * each new draft update (GH-58). It's worked out at every look, whether or not anyone is told: a toast
 * stays quiet while the page shows the board, and Slack has its own switch. No vscode import, so it's
 * tested with stand-ins.
 */
import type { AutopilotRecord } from '../../packages/core/src/autopilot-log.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import type { Update } from '../../packages/core/src/updates.ts';
import { autopilotNotices, withoutAutopilotEcho } from './logic/autopilot.ts';
import { type TaskNotice, taskNotices } from './logic/notices.ts';
import type { TaskRow } from './logic/shared.ts';
import { autopilotEvent, draftEvents, type SlackEvent, type SlackProject, taskEvent } from './slack.ts';

/** One project as a reload left it. */
export interface NewsInput {
  root: string;
  name: string;
  ledgerPath: string;
  rows: TaskRow[];
  /** Autopilot's steps in its repo, oldest first. */
  log: AutopilotRecord[];
  tasks: Pick<Task, 'id' | 'title' | 'history' | 'run' | 'source'>[];
  updates: Update[];
}

export interface NewsLook {
  /** What a toast says: autopilot's steps first, then the tasks' moves. */
  notices: TaskNotice[];
  /** The same moments, and new drafts, as Slack is told them. */
  slack: SlackEvent[];
}

const newestSeq = (log: { seq: number }[]): number => log.reduce((m, r) => Math.max(m, r.seq), 0);

export class News {
  private readonly seen = new Map<string, TaskRow[]>();
  /** The newest autopilot step told, by ledger: projects of one repo share their steps. */
  private readonly told = new Map<string, number>();
  /** The draft updates seen, by ledger. */
  private readonly drafts = new Map<string, Set<string>>();
  /** Until the first full load (tasks, agents and worktrees), rows are half-known: watch, don't speak. */
  private armed = false;
  /** Whether Slack already heard of a moment, so a draft that replaces one told isn't told again (D-071). */
  private readonly sent: (key: string) => boolean;
  private readonly now: () => number;

  constructor(sent: (key: string) => boolean = () => false, now: () => number = Date.now) {
    this.sent = sent;
    this.now = now;
  }

  /** Everything has loaded once: from here on, a change is news. */
  arm(projects: NewsInput[]): void {
    for (const p of projects) {
      this.seen.set(p.root, p.rows);
      this.told.set(p.ledgerPath, newestSeq(p.log));
      this.drafts.set(p.ledgerPath, new Set(p.updates.map((u) => u.id)));
    }
    this.armed = true;
  }

  /** What changed in a project since the last look. Before arm(), it only watches. */
  look(p: NewsInput): NewsLook {
    const steps = this.armed ? this.newSteps(p.ledgerPath, p.log) : [];
    const told = steps.length ? autopilotNotices(steps, p.tasks.map((t) => ({ id: t.id, source: { kind: t.source.kind, key: t.source.key ?? null }, history: t.history }))) : [];
    const before = this.seen.get(p.root);
    this.seen.set(p.root, p.rows);
    const news = this.armed && before && before !== p.rows ? withoutAutopilotEcho(taskNotices(before, p.rows), p.log) : [];
    const drafts = this.armed ? this.newDrafts(p.ledgerPath, p.updates) : [];
    if (!told.length && !news.length && !drafts.length) return { notices: [], slack: [] };
    // Keyed by the ledger, so every window builds the same key for the same moment (GH-58).
    const sp: SlackProject = { name: p.name, ledgerPath: p.ledgerPath, rows: p.rows, tasks: p.tasks };
    const at = this.now();
    const slack = [
      ...told.map((n) => (n.step ? autopilotEvent(sp, n.step, n.urgent) : null)),
      ...news.map((n) => taskEvent(sp, n, at)),
      ...draftEvents(sp, drafts, p.log, this.sent),
    ].filter((e): e is SlackEvent => !!e);
    return { notices: [...told, ...news], slack };
  }

  /**
   * Autopilot's steps since the last look at this repo, once each. A repo seen for the first time says
   * nothing: its steps were before this window was watching.
   */
  private newSteps(ledger: string, log: AutopilotRecord[]): AutopilotRecord[] {
    const last = this.told.get(ledger);
    const newest = newestSeq(log);
    // A ledger made again numbers its events from 1 again: tell from there on.
    if (last === undefined || newest > last || (log.length && newest < last)) this.told.set(ledger, newest);
    return last === undefined ? [] : log.filter((r) => r.seq > last);
  }

  /** Draft updates since the last look at this repo. A repo seen for the first time says nothing. */
  private newDrafts(ledger: string, updates: Update[]): Update[] {
    const seen = this.drafts.get(ledger);
    this.drafts.set(ledger, new Set([...(seen ?? []), ...updates.map((u) => u.id)]));
    return seen ? updates.filter((u) => u.state === 'draft' && !seen.has(u.id)) : [];
  }
}
