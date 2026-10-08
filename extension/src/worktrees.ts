// The Worktrees area's VS Code commands (D-099).
import { basename } from 'node:path';
import * as vscode from 'vscode';
import { runFile } from './run.ts';
import type { WorktreeNode } from './nodes.ts';
import type { ExtensionArea } from './area.ts';
import { Sidebar } from './sidebar.ts';

/** The Worktrees area's commands. */
class WorktreeCommands extends Sidebar {
  constructor(from: Sidebar) {
    super(from.hub, from.acc, from.log, from.openTicket, from.helpers, from.terminals);
  }

  register(reg: (id: string, fn: (...args: any[]) => unknown) => void): void {
    reg('acc.worktree.open', (n: WorktreeNode) => n?.kind === 'worktree' && vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(n.worktree.path), { forceNewWindow: true }));
    reg('acc.worktree.terminal', (n: WorktreeNode) => n?.kind === 'worktree' && this.terminal(`acc: ${n.worktree.branch ?? basename(n.worktree.path)}`, n.worktree.path).show());
    reg('acc.worktree.reveal', (n: WorktreeNode) => n?.kind === 'worktree' && vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(n.worktree.path)));
    reg('acc.worktree.remove', (n: WorktreeNode) => this.removeWorktree(n));
    reg('acc.worktrees.refresh', () => this.hub.loadWorktrees());
  }

  // ------------------------------------------------------------ worktrees

  /** Refuses anything that would lose work: uncommitted files, or commits that exist only here (D-013). */
  private async removeWorktree(n: WorktreeNode): Promise<void> {
    if (n?.kind !== 'worktree' || n.worktree.main) return;
    const w = n.worktree;
    if (w.changed > 0) return void vscode.window.showWarningMessage(`${w.branch ?? w.path} has ${w.changed} uncommitted file${w.changed === 1 ? '' : 's'}. Commit or discard them first.`);
    const unpushed = await runFile('git', ['log', '--oneline', '-1', 'HEAD', '--not', '--remotes'], w.path);
    if (unpushed.code === 0 && unpushed.stdout.trim()) return void vscode.window.showWarningMessage(`${w.branch ?? w.path} has commits that aren't on GitHub yet. Push or merge them first.`);
    const ok = await vscode.window.showWarningMessage(`Remove the worktree ${w.branch ?? ''}?`, { modal: true, detail: `${w.path}\n\nIts files are deleted. The branch and its commits stay in the repo.` }, 'Remove');
    if (ok !== 'Remove') return;
    const r = await runFile('git', ['worktree', 'remove', w.path], n.project.root);
    if (r.code !== 0) void vscode.window.showWarningMessage(`git refused: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
    await this.hub.loadWorktrees();
  }
}

/**
 * Commits and files changed on a branch since it left its environment's branch: from the merge base with
 * origin's copy, else the local one, as the checks measure changes (gates.ts). Null when git can't say.
 */
export async function branchStats(path: string, env: string): Promise<{ commits: number; files: number } | null> {
  let base = '';
  for (const ref of [`origin/${env}`, env]) {
    const r = await runFile('git', ['merge-base', 'HEAD', ref], path);
    if (r.code === 0 && r.stdout.trim()) { base = r.stdout.trim(); break; }
  }
  if (!base) return null;
  const [count, diff] = await Promise.all([runFile('git', ['rev-list', '--count', `${base}..HEAD`], path), runFile('git', ['diff', '--name-only', base, 'HEAD'], path)]);
  if (count.code !== 0 || diff.code !== 0) return null;
  return { commits: Number(count.stdout.trim()) || 0, files: diff.stdout.split('\n').filter(Boolean).length };
}

export const area: ExtensionArea = {
  register(x) {
    new WorktreeCommands(x.sidebar).register(x.regNode);
  },
};
