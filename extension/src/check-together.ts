// In review's Check together (T-165): asks the person first, then runs acc's group check for one environment in
// the output panel, where its steps show, and says what came of it.
import * as vscode from 'vscode';
import type { Environment } from '../../packages/core/src/config.ts';
import { taskList } from '../../packages/core/src/overlap.ts';
import type { ExtensionArea } from './area.ts';
import type { Project } from './hub.ts';
import { inProcessWords } from './logic/processes.ts';
import { readyForGroup, togetherFor } from './model/group-check.ts';
import { Sidebar } from './sidebar.ts';

class CheckTogether extends Sidebar {
  constructor(from: Sidebar) {
    super(from.hub, from.acc, from.log, from.openTicket, from.helpers, from.terminals);
  }

  register(reg: (id: string, fn: (...args: any[]) => unknown) => void): void {
    reg('acc.task.checkTogether', (n?: { project?: Project; env?: Environment }) => this.check(n));
  }

  /** The group for one environment: off with the command's own reason, else the person's yes, then acc. */
  private async check(n?: { project?: Project; env?: Environment }): Promise<void> {
    const project = await this.pickProject(n);
    if (!project) return;
    const env = n?.env ?? project.config.environments.find((e) => e.default) ?? project.config.environments[0];
    if (!env) return;
    const rows = this.hub.taskRows(project.root);
    const t = togetherFor(project.root, project.config, rows, (env) => this.hub.groupRunning(project.root, env)).find((x) => x.env === env.branch);
    if (!t || t.action.disabled) return void vscode.window.showInformationMessage(t?.action.disabled ?? `No task in review goes to ${env.name}.`);
    const ids = rows.filter((r) => r.environment === env.branch && readyForGroup(r)).map((r) => r.id);
    const go = 'Check together';
    const detail = `Merges ${taskList(ids)} into a copy of ${env.name}, in that order, and runs the full check once. If it passes, each one merges into ${env.name} and moves to done. If it fails, the task whose files the failure names goes back to its builder, and the rest are checked again.`;
    if ((await vscode.window.showInformationMessage(`Check ${ids.length} tasks together for ${env.name}?`, { modal: true, detail }, go)) !== go) return;
    await this.runAcc(project, ['check-together', '--env', env.branch], (out: { summary?: string }) => (out?.summary ? inProcessWords(out.summary) : undefined), `Check ${ids.length} tasks together for ${env.name}`);
  }
}

export const area: ExtensionArea = {
  register(x) {
    new CheckTogether(x.sidebar).register(x.regNode);
  },
};
