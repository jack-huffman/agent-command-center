import * as vscode from 'vscode';
import type { Hub } from './hub.ts';
import { combinedStatus, type StatusParts } from './logic/status.ts';
import { Away, welcomeBack } from './logic/away.ts';
import { noticeBurst, type ProjectNotice, type Said } from './logic/notices.ts';
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
 * Slack, which has its own switch (GH-58), with every new draft update. While the person is away from the
 * window, news waits for them in the Overview's Since you last looked, and one notification on their return
 * counts it (D-164).
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
  /** The window's away spans, and the news the newest held (D-164). In this window's memory only. */
  private readonly away: Away;
  private readonly clock: () => number;
  /** Since you last looked changed: the page draws it again. */
  private readonly onSince: () => void;

  constructor(hub: Hub, resolve: (command: string, ref: Ref) => unknown, quiet: () => boolean, parts: () => Omit<StatusParts, 'rows' | 'needsYou'>, slack: SlackSink | null = null,
    { clock = Date.now, onSince = () => {} }: { clock?: () => number; onSince?: () => void } = {}) {
    this.hub = hub;
    this.resolve = resolve;
    this.quiet = quiet;
    this.parts = parts;
    this.slack = slack;
    this.news = new News((key) => slack?.told(key) ?? false);
    this.clock = clock;
    this.onSince = onSince;
    this.away = new Away(vscode.window.state.focused, clock());
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
    // Every project's notices first, so a burst after a person was away is one notification (D-162).
    const all: ProjectNotice[] = [];
    for (const p of this.hub.projects) {
      const { notices, slack } = this.news.look(this.input(p));
      all.push(...notices.map((notice) => ({ root: p.root, notice })));
      for (const ev of slack) this.slack?.offer(ev);
    }
    // A new span replaces the list; news in a span grows it. Either redraws the Overview (T-61 review).
    const before = this.away.since();
    const held = before.length;
    const shown = this.away.sort(all, this.clock());
    const after = this.away.since();
    if (after !== before || after.length !== held) this.onSince();
    if (shown.length && this.speaks()) for (const s of noticeBurst(shown)) void this.say(s);
  }

  /**
   * The window's focus changed. Back after an away span, the Overview shows what the span held, and one
   * notification counts its news; a span with none says nothing.
   */
  focus(focused: boolean): void {
    const back = this.away.focus(focused, this.clock());
    if (!back) return;
    this.onSince();
    const said = welcomeBack(back);
    if (said && this.speaks()) void this.say(said);
  }

  /** The news the newest away span held, for the Overview's Since you last looked. */
  since(): readonly ProjectNotice[] {
    return this.away.since();
  }

  /** A Jira board's sprint changed (T-78): Since you last looked says so, once, with no notification. */
  sprint(root: string, text: string): void {
    this.away.note({ root, notice: { kind: 'sprint', task: '', text, urgent: false } }, this.clock());
    this.onSince();
  }

  /** Clear on Since you last looked. */

  clearSince(): void {
    this.away.clear();
    this.onSince();
  }

  /** Notifications are on, and the page isn't on screen showing what they'd say. */
  private speaks(): boolean {
    return !this.quiet() && vscode.workspace.getConfiguration('agentCommandCenter').get<boolean>('notifications', true);
  }

  private async say(s: Said): Promise<void> {
    const show = s.urgent ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
    const pick = await show(s.text, ...s.actions.map(([label]) => label));
    const chosen = s.actions.find(([label]) => label === pick);
    if (!chosen) return;
    // A burst across tasks has no task: its Show opens the Overview, at its part where it names one.
    if (s.task) void this.resolve(chosen[1], { project: s.task.root, task: s.task.task });
    else void vscode.commands.executeCommand(chosen[1], 'overview', ...(s.part ? [s.part] : []));
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
        { label: '$(home) Open the Command Center', go: () => panels.open() },
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
