// A moved environment branch's VS Code commands (GH-69): a person looks at the move on GitHub, and says
// they've seen it, which clears the notice through acc sync --branches-seen.
import * as vscode from 'vscode';
import { moveUrl } from '../../packages/core/src/branches.ts';
import type { ExtensionArea } from './area.ts';
import type { Project } from './hub.ts';
import { Sidebar } from './sidebar.ts';

/** What the page sends with the item: the project, and the environment whose branch moved. */
interface MoveRef { project?: Project; env?: { branch: string } }

class BranchCommands extends Sidebar {
  constructor(from: Sidebar) {
    super(from.hub, from.acc, from.log, from.openTicket, from.helpers, from.terminals);
  }

  register(reg: (id: string, fn: (...args: any[]) => unknown) => void): void {
    reg('acc.branches.open', (n?: MoveRef) => this.open(n));
    reg('acc.branches.seen', (n?: MoveRef) => this.seen(n));
  }

  /** The move on GitHub: its compare page, from the old head to the new. */
  private async open(n?: MoveRef): Promise<void> {
    const project = await this.pickProject(n);
    if (!project?.config.github) return;
    const move = this.hub.branchMoves(project.root).find((m) => !n?.env || m.branch === n.env?.branch);
    if (!move) return void vscode.window.showInformationMessage(`No move is waiting on ${n?.env?.branch ?? 'any branch'} in ${project.name}.`);
    await vscode.env.openExternal(vscode.Uri.parse(moveUrl(project.config.github.repo, move)));
  }

  /** A person has seen it: acc clears the notice, and the next sync starts from where the branch stands. */
  private async seen(n?: MoveRef): Promise<void> {
    const project = await this.pickProject(n);
    if (!project) return;
    const moves = this.hub.branchMoves(project.root);
    if (!moves.length) return void vscode.window.showInformationMessage(`No branch move is waiting in ${project.name}.`);
    // acc sync --branches-seen clears every move waiting in the repo, so the question says so.
    const branches = moves.map((m) => m.branch).join(', ');
    const seen = 'Seen';
    const detail = `${moves.length === 1 ? `The move on ${branches}` : `The moves on ${branches}`} will no longer show as needing you. The Command Center records where each branch stands now, and flags the next move that isn't its own merge.`;
    if ((await vscode.window.showInformationMessage(`Mark ${moves.length === 1 ? `${branches}'s move` : 'the branch moves'} as seen?`, { modal: true, detail }, seen)) !== seen) return;
    await this.runAcc(project, ['sync', '--branches-seen'], () => `Seen: ${branches}.`);
    await this.hub.loadTasks(true);
  }
}

export const area: ExtensionArea = {
  register(x) {
    new BranchCommands(x.sidebar).register(x.regNode);
  },
};
