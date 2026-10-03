import * as vscode from 'vscode';
import type { Hub } from './hub.ts';
import { noticeActions, statusSummary, type TaskNotice, taskNotices, type TaskRow } from './logic.ts';
import type { Ref } from './model.ts';

/**
 * The swarm at a glance (D-044): one status bar item with what needs you, what's running and what's in
 * review, and a notice when a task changes in a way a person would want to hear about. The page being on
 * screen showing that task's board is reason enough to stay quiet.
 */
export class Notices implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('acc.summary', vscode.StatusBarAlignment.Left, 98);
  private readonly seen = new Map<string, TaskRow[]>();
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
    for (const p of this.hub.projects) this.seen.set(p.root, this.hub.taskRows(p.root));
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
    for (const p of this.hub.projects) {
      const now = this.hub.taskRows(p.root);
      const before = this.seen.get(p.root);
      this.seen.set(p.root, now);
      if (!this.armed || !before || before === now) continue;
      const news = taskNotices(before, now);
      if (!news.length || this.quiet() || !vscode.workspace.getConfiguration('agentCommandCenter').get<boolean>('notifications', true)) continue;
      for (const n of news) void this.say(p.root, n);
    }
  }

  private async say(root: string, n: TaskNotice): Promise<void> {
    const actions = noticeActions(n);
    const show = n.urgent ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    const pick = await show(n.text, ...actions.map(([label]) => label));
    const chosen = actions.find(([label]) => label === pick);
    if (chosen) void this.resolve(chosen[1], { project: root, task: n.task });
  }
}
