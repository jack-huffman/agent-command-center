import * as vscode from 'vscode';
import type { Hub } from './hub.ts';
import { combinedStatus, type StatusParts } from './logic/status.ts';
import { noticeActions, type TaskNotice } from './logic/notices.ts';
import type { Ref } from './model/shared.ts';
import { News, type NewsInput } from './news.ts';
import type { SlackSink } from './slack.ts';
import type { ExtensionArea } from './area.ts';
import { settingsKey } from './model/settings.ts';

/**
 * The swarm at a glance (D-044): one status bar item with what needs you, what's running and what's in
 * review, and a notice when a task changes in a way a person would want to hear about. The page being on
 * screen showing that task's board is reason enough to stay quiet. Each step autopilot takes is told once
 * too, wherever it ran (D-064). What changed is worked out whether or not a toast shows, and offered to
 * Slack, which has its own switch (GH-58), with every new draft update.
 */
export class Notices implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem('acc.summary', vscode.StatusBarAlignment.Left, 98);
  private readonly hub: Hub;
  private readonly resolve: (command: string, ref: Ref) => unknown;
  private readonly quiet: () => boolean;
  /** The rest of acc's state for the one status bar item (D-065): runs, setup, autopilot, the account. */
  private readonly parts: () => Omit<StatusParts, 'rows' | 'needsYou'>;
  private readonly slack: SlackSink | null;
  private readonly news: News;
  private needsYou = 0;

  constructor(hub: Hub, resolve: (command: string, ref: Ref) => unknown, quiet: () => boolean, parts: () => Omit<StatusParts, 'rows' | 'needsYou'>, slack: SlackSink | null = null) {
    this.hub = hub;
    this.resolve = resolve;
    this.quiet = quiet;
    this.parts = parts;
    this.slack = slack;
    this.news = new News((key) => slack?.told(key) ?? false);
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

  private input(p: Hub['projects'][number]): NewsInput {
    return {
      root: p.root, name: p.name, ledgerPath: p.ledgerPath, rows: this.hub.taskRows(p.root), log: this.hub.autopilotLog(p.root),
      tasks: this.hub.ledger(p.root)?.tasks ?? [], updates: this.hub.updates(p.root),
    };
  }

  /** Everything has loaded once: from here on, a change is news. */
  arm(): void {
    this.news.arm(this.hub.projects.map((p) => this.input(p)));
  }

  /** After any reload: redraw the summary, and say what changed since the last look. */
  update(needsYou: number): void {
    this.needsYou = needsYou;
    this.draw();
    const speak = () => !this.quiet() && vscode.workspace.getConfiguration('agentCommandCenter').get<boolean>('notifications', true);
    for (const p of this.hub.projects) {
      const { notices, slack } = this.news.look(this.input(p));
      if (notices.length && speak()) for (const n of notices) void this.say(p.root, n);
      for (const ev of slack) this.slack?.offer(ev);
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

export const area: ExtensionArea = {
  register({ reg, setup, identity, autopilot, panels, runs, showRun }) {
    // What a click on the one status bar item offers (D-065).
    reg('acc.status.menu', async () => {
      const look = setup.look();
      const account = identity.account();
      type Item = vscode.QuickPickItem & { go: () => unknown };
      const items: Item[] = [
        { label: '$(home) Open the Command Center', go: () => panels.show('overview') },
        ...autopilot.looks().filter((a) => a.state !== 'refused').map((a): Item => ({
          label: a.state === 'on' ? '$(hubot) Turn autopilot off' : '$(hubot) Turn autopilot on',
          description: `${a.project}${a.state === 'elsewhere' ? ' · on in another window' : ''}`,
          go: () => vscode.commands.executeCommand('acc.autopilot.toggle', a.key),
        })),
        // Whether autopilot merges pull requests in each repo (GH-67), set in Settings' How agents run (GH-110).
        ...autopilot.mergeLooks().map((m): Item => ({
          label: m.on ? '$(git-merge) Auto-merge: on' : '$(circle-slash) Auto-merge: off',
          description: `${m.project}${m.on && !m.acts ? ' · autonomy manual, so nothing merges' : ''}`,
          go: () => panels.show('settings', settingsKey('agents')),
        })),
        ...(runs.live().length ? [{ label: '$(terminal) Show what\'s running', go: () => showRun() }] : []),
        { label: '$(checklist) Setup', description: look.total ? `${look.done} of ${look.total} done${look.checking ? ', checking now' : ''}` : '', go: () => panels.show('setup') },
        ...(account ? [{ label: account.ok ? '$(github) GitHub account' : '$(warning) GitHub account', description: account.name, go: () => vscode.commands.executeCommand('acc.github.switch') }] : []),
      ];
      const pick = await vscode.window.showQuickPick(items, { title: 'Agent Command Center' });
      await pick?.go();
    });
  },
};
