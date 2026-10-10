// Cloud builders' VS Code side (GH-69): dispatching a task to the cloud, watching and messaging a cloud
// builder, collecting its work, and the project's opt-in, routine and token, all through acc. The Command
// Center never writes the config or the keychain itself.
import * as vscode from 'vscode';
import { BUILDER_PLACES, type BuilderPlace, ROUTINE_ID } from '../../packages/core/src/config.ts';
import { ROUTINES_URL } from '../../packages/core/src/cloud.ts';
import { ROUTINE_PROMPT } from '../../packages/core/src/onboarding/cloud-steps.ts';
import type { ExtensionArea } from './area.ts';
import type { Project } from './hub.ts';
import type { TaskNode } from './nodes.ts';
import { displayName } from './logic/agents.ts';
import { runFile } from './run.ts';
import { Sidebar } from './sidebar.ts';

/** The cloud commands: each goes through acc, and says in plain words what acc refused. */
class CloudCommands extends Sidebar {
  constructor(from: Sidebar) {
    super(from.hub, from.acc, from.log, from.openTicket, from.helpers, from.terminals);
  }

  register(regNode: (id: string, fn: (...args: any[]) => unknown) => void, reg: (id: string, fn: (...args: any[]) => unknown) => void): void {
    regNode('acc.task.dispatchCloud', (n: TaskNode) => this.dispatchCloud(n));
    regNode('acc.task.message', (n: TaskNode) => this.message(n));
    regNode('acc.task.collect', (n: TaskNode) => this.collect(n));
    reg('acc.cloud.enable', (root?: unknown) => this.enable(typeof root === 'string' ? root : undefined));
    reg('acc.cloud.disable', (root?: unknown) => this.disable(typeof root === 'string' ? root : undefined));
    reg('acc.cloud.token', (root?: unknown) => this.token(typeof root === 'string' ? root : undefined));
    reg('acc.cloud.default', (root?: unknown) => this.setDefault(typeof root === 'string' ? root : undefined));
    reg('acc.cloud.routine', (root?: unknown) => this.routine(typeof root === 'string' ? root : undefined));
  }

  private projectOf(root?: string): Promise<Project | undefined> {
    const p = root ? this.hub.project(root) : undefined;
    return p ? Promise.resolve(p) : this.pickProject();
  }

  /** Dispatch to the cloud (GH-69): acc dispatch --cloud, which pushes the branch and fires the routine. */
  private async dispatchCloud(n: TaskNode): Promise<void> {
    if (n?.kind !== 'task') return;
    const { project, task } = n;
    const ok = await vscode.window.showInformationMessage(`${task.state === 'rework' ? 'Re-dispatch' : 'Dispatch'} ${task.id} to the cloud?`, { modal: true, detail: 'acc pushes its branch to GitHub and fires the project\'s routine. A cloud session builds it, and acc collects the branch when its last commit says Acc-Done. Checks that need an org run on this Mac when it collects.' }, 'Dispatch to the cloud');
    if (!ok) return;
    let out: { cloud?: { url?: string }; worktree?: string } | null = null;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Dispatching ${task.id} to the cloud`, cancellable: false }, async (progress) => {
      progress.report({ message: 'pushing its branch and firing the routine…' });
      await this.runAcc(project, ['dispatch', task.id, '--cloud'], (o) => { out = o; return undefined; });
    });
    const url = (out as { cloud?: { url?: string } } | null)?.cloud?.url;
    if (!url) return;
    await this.hub.loadWorktrees();
    const pick = await vscode.window.showInformationMessage(`${task.id} is running in the cloud. acc follows its branch on GitHub and collects it when it's done.`, 'Watch on claude.ai');
    if (pick) await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  /** A message to a cloud builder (GH-69): claude -p "<text>" --cloud <session>, which queues it and returns. */
  private async message(n: TaskNode): Promise<void> {
    if (n?.kind !== 'task') return;
    const { project, task } = n;
    const session = task.run?.cloud?.sessionId;
    if (!session) return void vscode.window.showInformationMessage(`${task.id} has no cloud session to message.`);
    const text = await vscode.window.showInputBox({ title: `Message ${displayName(undefined, task)}`, prompt: 'Queued into its cloud session, as if typed on claude.ai. It carries on from there.', validateInput: (v) => (v.trim() ? undefined : 'Say something.') });
    if (!text) return;
    const r = await runFile('claude', ['-p', text.trim(), '--cloud', session, '--output-format', 'json'], task.run?.worktree ?? project.root, process.env, undefined, 60_000);
    let ok = r.code === 0;
    let error = (r.stderr || r.stdout).trim().split('\n')[0] ?? '';
    try {
      const j = JSON.parse(r.stdout) as { ok?: boolean; error?: string };
      ok = ok && j.ok !== false;
      if (j.error) error = j.error;
    } catch {
      // not JSON: the exit code decides
    }
    if (ok) void vscode.window.showInformationMessage(`Sent to ${task.id}'s cloud session.`);
    else void vscode.window.showWarningMessage(`Couldn't send it: ${error || 'claude -p --cloud failed'}. Open the session on claude.ai instead.`);
  }

  /** Collect (GH-69): acc collect, which fetches, runs the checks here and moves the task to review. */
  private async collect(n: TaskNode): Promise<void> {
    if (n?.kind !== 'task') return;
    const { project, task } = n;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Collecting ${task.id} from the cloud`, cancellable: false }, async (progress) => {
      progress.report({ message: 'fetching its branch and running the checks here…' });
      await this.runAcc(project, ['collect', task.id], (o) => (o?.reason as string | undefined) ?? `${task.id} is in review.`);
    });
    await this.hub.loadWorktrees();
  }

  /** Opt in (GH-69): acc cloud enable, with the routine's trigger id when the person has one. */
  private async enable(root?: string): Promise<void> {
    const project = await this.projectOf(root);
    if (!project) return;
    if (!project.config.github) return void vscode.window.showWarningMessage(`Cloud builders need the repo on GitHub: ${project.name} has no "github" section in .acc/config.json.`);
    const current = project.config.agents.cloud?.routine ?? '';
    const routine = await vscode.window.showInputBox({ title: `Cloud builders for ${project.name}: the routine's trigger id`, prompt: `From the routine's API trigger at ${ROUTINES_URL} (trig_…). Leave empty to opt in now and add it later.`, value: current, validateInput: (v) => (!v.trim() || ROUTINE_ID.test(v.trim()) ? undefined : 'A trigger id looks like trig_01ABC…') });
    if (routine === undefined) return;
    await this.runAcc(project, ['cloud', 'enable', ...(routine.trim() ? ['--routine', routine.trim()] : [])], (o) => `Cloud builders are on for ${project.name}. ${o?.guard?.length ? `Commit ${o.guard.join(' and ')} with .acc/config.json.` : ''} A local builder stays the default.`);
    await this.hub.loadProjects();
  }

  private async disable(root?: string): Promise<void> {
    const project = await this.projectOf(root);
    if (!project) return;
    const ok = await vscode.window.showWarningMessage(`Turn cloud builders off for ${project.name}?`, { modal: true, detail: 'Every dispatch goes to this Mac. A cloud builder already running finishes on its own; acc still collects it. The routine\'s token stays in the keychain.' }, 'Turn off');
    if (!ok) return;
    await this.runAcc(project, ['cloud', 'disable'], () => `Cloud builders are off for ${project.name}.`);
    await this.hub.loadProjects();
  }

  /** The routine's token (GH-69): typed hidden, handed to acc in its environment, kept in the keychain. */
  private async token(root?: string): Promise<void> {
    const project = await this.projectOf(root);
    if (!project) return;
    const token = await vscode.window.showInputBox({ title: `The routine's API token for ${project.name}`, prompt: 'Generated once on the routine\'s page. It goes to this Mac\'s keychain, never to a file.', password: true, validateInput: (v) => (/^[A-Za-z0-9_-]{20,}$/.test(v.trim()) ? undefined : 'A token is letters, digits, dashes and underscores, 20 or more.') });
    if (!token) return;
    const r = await runFile(process.execPath, [this.helpers.accScript ?? '', 'cloud', 'token', '--from-env', '--json'], project.root, { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1', ACC_CLOUD_TOKEN_NEW: token.trim() });
    if (r.code !== 0) return void vscode.window.showWarningMessage(`Couldn't keep the token: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
    void vscode.window.showInformationMessage(`Kept the routine's token for ${project.config.github?.repo ?? project.name} in the keychain.`);
    await this.hub.loadProjects();
  }

  private async setDefault(root?: string): Promise<void> {
    const project = await this.projectOf(root);
    if (!project?.config.agents.cloud) return;
    const now = project.config.agents.cloud.default;
    const pick = await vscode.window.showQuickPick(BUILDER_PLACES.map((w) => ({ label: w === 'local' ? '$(device-desktop) This Mac' : '$(cloud) Cloud', description: w === now ? 'Now' : undefined, detail: w === 'local' ? 'A plain dispatch runs the builder here; Dispatch to the cloud sends one task there.' : 'A plain dispatch fires the routine; acc dispatch --local keeps a task here.', value: w as BuilderPlace })), { title: `Where ${project.name}'s builders go by default` });
    if (!pick || pick.value === now) return;
    await this.runAcc(project, ['cloud', 'enable', '--default-place', pick.value], () => `${project.name}'s builders go to ${pick.value === 'cloud' ? 'the cloud' : 'this Mac'} unless a dispatch says otherwise.`);
    await this.hub.loadProjects();
  }

  /** The routine's prompt, for a person to paste when they make the routine on claude.ai. */
  private async routine(root?: string): Promise<void> {
    const project = await this.projectOf(root);
    if (!project) return;
    await vscode.env.clipboard.writeText(ROUTINE_PROMPT);
    const pick = await vscode.window.showInformationMessage('Copied the routine\'s prompt. Paste it as the routine\'s instructions on claude.ai, pick the repo and the model, add an API trigger, then give acc the trigger id and the token.', 'Open claude.ai/code/routines');
    if (pick) await vscode.env.openExternal(vscode.Uri.parse(ROUTINES_URL));
  }
}

export const area: ExtensionArea = {
  register({ sidebar, regNode, reg }) {
    new CloudCommands(sidebar).register(regNode, reg);
  },
};
