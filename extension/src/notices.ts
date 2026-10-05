import * as vscode from 'vscode';
import type { Hub } from './hub.ts';
import { autopilotNotices, combinedStatus, noticeActions, type StatusParts, type TaskNotice, taskNotices, type TaskRow, withoutAutopilotEcho } from './logic.ts';
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
  /** The rest of acc's state for the one status bar item (D-065): runs, setup, autopilot, the account. */
  private readonly parts: () => Omit<StatusParts, 'rows' | 'needsYou'>;
  private needsYou = 0;
  /** Until the first full load (tasks, agents and worktrees), rows are half-known: watch, don't speak. */
  private armed = false;

  constructor(hub: Hub, resolve: (command: string, ref: Ref) => unknown, quiet: () => boolean, parts: () => Omit<StatusParts, 'rows' | 'needsYou'>) {
    this.hub = hub;
    this.resolve = resolve;
    this.quiet = quiet;
    this.parts = parts;
    this.item.name = 'Agent Command Center';
    this.item.command = { command: 'acc.status.menu', title: 'Agent Command Center' };
  }

  /** Redraws the one status bar item (D-065): cheap, so runs and setup can call it as they change. */
  draw(): void {
    const rows = this.hub.projects.flatMap((p) => this.hub.taskRows(p.root));
    const s = combinedStatus({ rows, needsYou: this.needsYou, ...this.parts() });
    if (!s.text) { this.item.hide(); return; }
    this.item.text = s.text;
    const md = new vscode.MarkdownString(['**Agent Command Center**', ...s.tooltip, '', 'Click for the Command Center, autopilot and setup.'].join('\n\n'), true);
    this.item.tooltip = md;
    this.item.backgroundColor = s.attention ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    this.item.show();
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
    this.needsYou = needsYou;
    this.draw();
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
