// The tidy-up's VS Code commands (GH-104): acc drafts it, a person reads the draft and adds it, or sets it aside.
import { plural } from '../../packages/core/src/text.ts';
import * as vscode from 'vscode';
import type { TidyDraft, TidyScope } from '../../packages/core/src/tidy.ts';
import type { ExtensionArea } from './area.ts';
import type { Project } from './hub.ts';
import { inProcessWords } from './logic/processes.ts';
import { Sidebar } from './sidebar.ts';

/** What `acc tidy --json` says. */
interface Shown {
  count: number;
  every: number;
  due: boolean;
  open: string | null;
  scope: TidyScope | null;
  draft: TidyDraft | null;
}


class TidyCommands extends Sidebar {
  constructor(from: Sidebar) {
    super(from.hub, from.acc, from.log, from.openTicket, from.helpers, from.terminals);
  }

  register(reg: (id: string, fn: (...args: any[]) => unknown) => void): void {
    reg('acc.tidy.draft', (n?: { project?: Project }) => this.draft(n));
    reg('acc.tidy.skip', (n?: { project?: Project }) => this.skip(n));
  }

  /** Drafts the tidy-up through acc, shows it, and adds it as a task only when the person says so. */
  private async draft(n?: { project?: Project }): Promise<void> {
    const project = await this.pickProject(n);
    if (!project) return;
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Drafting the tidy-up' }, () => this.acc(['tidy', '--json'], project.root));
    let shown: Shown | null = null;
    try {
      shown = JSON.parse(r.stdout) as Shown;
    } catch {
      shown = null;
    }
    // acc's refusal, in process words (GH-163).
    if (r.code !== 0 || !shown) return void vscode.window.showWarningMessage(`Couldn't draft the tidy-up: ${inProcessWords((r.stderr || r.stdout).trim().split('\n')[0] ?? '') || `acc exited ${r.code}`}`);
    const { draft, scope } = shown;
    if (shown.open) return void vscode.window.showInformationMessage(`${shown.open}, a tidy-up, isn't done yet.`);
    if (!draft || !scope) return void vscode.window.showInformationMessage('Nothing has merged since the last tidy-up.');
    const detail = [
      `It covers ${plural(draft.covered.length, 'merged task')}: ${draft.covered.join(', ')}.`,
      `It looks in ${plural(draft.files.length, 'file')} they changed for duplicated helpers and comments that contradict the code, and changes no behaviour.`,
      ...(draft.unknown.length ? [`⚠ ${draft.unknown.map((u) => u.task).join(', ')}: ${draft.unknown.length === 1 ? 'its files aren\'t' : 'their files aren\'t'} known, so ${draft.unknown.length === 1 ? 'it isn\'t' : 'they aren\'t'} in the list.`] : []),
      ...(scope.fetched ? [] : [`⚠ ${scope.tip} wasn't fetched just now, so the list may be behind.`]),
      '',
      'It goes in To do, labelled tidy-up. Nothing starts until you dispatch it.',
    ].join('\n');
    const add = 'Add task';
    if ((await vscode.window.showInformationMessage(`Add "${draft.title}"?`, { modal: true, detail }, add)) !== add) return;
    let task: string | undefined;
    const ok = await this.runAcc(project, ['tidy', 'add'], (out: { task?: string }) => {
      task = out?.task;
      return task ? `Added ${task}: ${draft.title}.` : undefined;
    });
    if (ok && task) this.openTicket?.(project.root, task);
  }

  /** Sets the offer aside, after the person says so: the count starts again. */
  private async skip(n?: { project?: Project }): Promise<void> {
    const project = await this.pickProject(n);
    if (!project) return;
    const every = this.hub.tidy(project.root)?.every;
    const skip = 'Not now';
    const detail = `The count starts again, so the next tidy-up is offered once ${every ? `${every} more tasks` : 'more tasks'} merge. acc records who skipped it, and when.`;
    if ((await vscode.window.showInformationMessage('Skip this tidy-up?', { modal: true, detail }, skip)) !== skip) return;
    await this.runAcc(project, ['tidy', 'skip'], () => 'Skipped the tidy-up.');
  }
}

export const area: ExtensionArea = {
  register(x) {
    new TidyCommands(x.sidebar).register(x.regNode);
  },
};
