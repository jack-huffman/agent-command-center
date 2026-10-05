import * as vscode from 'vscode';
import type { Hub } from './hub.ts';
import { autopilotNotices, noticeActions, statusSummary, type TaskNotice, taskNotices, type TaskRow, withoutAutopilotEcho } from './logic.ts';
import type { Ref } from './model.ts';

/**
 * The swarm at a glance (D-044): one status bar item with what needs you, what's running and what's in
 * review, and a notice when a task changes in a way a person would want to hear about. The page being on
 * screen showing that task's board is reason enough to stay quiet. Each step autopilot takes is told once
 * too, wherever it ran (D-064).
 */
export class Notices implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('acc.summary', vscode.StatusBarAlignment.Left, 98);
  private readonly seen = new Map<string, TaskRow[]>();
  /** The newest autopilot step told, by ledger: projects of one repo share their steps. */
  private readonly told = new Map<string, number>();
  private readonly hub: Hub;
  private readonly resolve: (command: string, ref: Ref) => unknown;
  private readonly quiet: () => boolean;
  /** Until the first full load (tasks, agents and worktrees), rows are half-known: watch, don't speak. */
  private armed = false;

  constructor(hub: Hub, resolve: (command: string, ref: Ref) => unknown, quiet: () => boolean) {
    this.hub = hub;
    this.resolve = resolve;
    this.quiet = quiet;
    this.item.name = 'Agent Command Center: tasks';
    this.item.command = { command: 'acc.open.home', title: 'Open the Command Center', arguments: ['overview'] };
  }

  dispose(): void {
    this.item.dispose();
  }

  /** Everything has loaded once: from here on, a change is news. */
  arm(): void {
    for (const p of this.hub.projects) {
      this.seen.set(p.root, this.hub.taskRows(p.root));
      this.told.set(p.ledgerPath, newestSeq(this.hub.autopilotLog(p.root)));
    }
    this.armed = true;
  }

  /** After any reload: redraw the summary, and say what changed since the last look. */
  update(needsYou: number): void {
    const rows = this.hub.projects.flatMap((p) => this.hub.taskRows(p.root));
    const s = statusSummary(rows, needsYou);
    if (!s.text) this.item.hide();
    else {
      this.item.text = s.text;
      this.item.tooltip = s.tooltip;
      this.item.backgroundColor = s.attention ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
      this.item.show();
    }
    const speak = () => !this.quiet() && vscode.workspace.getConfiguration('agentCommandCenter').get<boolean>('notifications', true);
    for (const p of this.hub.projects) {
      const log = this.hub.autopilotLog(p.root);
      const steps = this.armed ? this.newSteps(p.ledgerPath, log) : [];
      if (steps.length && speak()) {
        const tasks = this.hub.ledger(p.root)?.tasks ?? [];
        for (const n of autopilotNotices(steps, tasks.map((t) => ({ id: t.id, source: { kind: t.source.kind, key: t.source.key ?? null }, history: t.history })))) void this.say(p.root, n);
      }
      const now = this.hub.taskRows(p.root);
      const before = this.seen.get(p.root);
      this.seen.set(p.root, now);
      if (!this.armed || !before || before === now) continue;
      const news = withoutAutopilotEcho(taskNotices(before, now), log);
      if (!news.length || !speak()) continue;
      for (const n of news) void this.say(p.root, n);
    }
  }

  /**
   * Autopilot's steps since the last look at this repo, once each. A repo seen for the first time says
   * nothing: its steps were before this window was watching.
   */
  private newSteps(ledger: string, log: ReturnType<Hub['autopilotLog']>) {
    const last = this.told.get(ledger);
    const newest = newestSeq(log);
    // A ledger made again numbers its events from 1 again: tell from there on.
    if (last === undefined || newest > last || (log.length && newest < last)) this.told.set(ledger, newest);
    return last === undefined ? [] : log.filter((r) => r.seq > last);
  }

  private async say(root: string, n: TaskNotice): Promise<void> {
    const actions = noticeActions(n);
    const show = n.urgent ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    const pick = await show(n.text, ...actions.map(([label]) => label));
    const chosen = actions.find(([label]) => label === pick);
    if (chosen) void this.resolve(chosen[1], { project: root, task: n.task });
  }
}

const newestSeq = (log: { seq: number }[]): number => log.reduce((m, r) => Math.max(m, r.seq), 0);
