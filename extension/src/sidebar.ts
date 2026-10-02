import { basename } from 'node:path';
import * as vscode from 'vscode';
import { allowedMoves, DISPLAY, type State } from '../../packages/core/src/ledger.ts';
import { run as runSync } from '../../packages/core/src/exec.ts';
import { repoPaths } from '../../packages/core/src/paths.ts';
import { receiptHooks } from '../../packages/core/src/receipts.ts';
import type { Hub, Project } from './hub.ts';
import { type AgentSession, agentName, githubBranchUrl, sessionFor } from './logic.ts';
import { sessionKey } from './model.ts';
import { type RunResult, runFile } from './run.ts';
import type { AgentNode, EnvNode, TaskNode, WorktreeNode } from './nodes.ts';

type Acc = (args: string[], cwd: string, token?: vscode.CancellationToken) => Promise<RunResult>;

/** What the sidebar's actions can use from the rest of the extension (D-030). */
export interface SidebarHelpers {
  /** Runs a command with its output in the page, instead of a terminal. */
  run?: (command: string, cwd: string, label: string) => void;
  /** Opens a session's activity page. A session that has ended needs the hint to find its transcript. */
  watch?: (key: string, ended?: AgentSession) => boolean;
  /** --settings for a background agent started here, so its questions come to the page. */
  sessionSettings?: string;
}

/** The sidebar's actions. Task changes always go through acc, so the rules live in one place (D-012). */
export class Sidebar {
  private readonly hub: Hub;
  private readonly acc: Acc;
  private readonly log: vscode.LogOutputChannel;
  private readonly terminals = new Map<string, vscode.Terminal>();
  /** Opens a task's page (D-026). Without it, Details falls back to a plain document. */
  private readonly openTicket: ((root: string, key: string) => void) | null;
  private readonly helpers: SidebarHelpers;

  constructor(hub: Hub, acc: Acc, log: vscode.LogOutputChannel, openTicket: ((root: string, key: string) => void) | null = null, helpers: SidebarHelpers = {}) {
    this.hub = hub;
    this.acc = acc;
    this.log = log;
    this.openTicket = openTicket;
    this.helpers = helpers;
  }

  register(reg: (id: string, fn: (...args: any[]) => unknown) => void): void {
    reg('acc.task.add', (n?: TaskNode) => this.addTask(n));
    reg('acc.task.importGithub', (n?: TaskNode) => this.importGithub(n));
    reg('acc.task.importJira', (n?: TaskNode) => {
      const p = n && 'project' in n ? n.project : this.hub.projects[0];
      const jira = p?.config.trackers.some((t) => t.kind === 'jira');
      return vscode.window.showInformationMessage(jira
        ? 'Jira tickets are on the Tasks board. Open one and choose Track in acc to hand it to an agent.'
        : 'Add a Jira tracker to .acc/config.json ("trackers": [{ "kind": "jira", "site": "…atlassian.net", "project": "KEY" }]), and its board shows on the Tasks tab.');
    });
    reg('acc.task.show', (n: TaskNode) => this.showTask(n));
    reg('acc.task.move', (n: TaskNode) => this.moveTask(n));
    reg('acc.task.block', (n: TaskNode) => this.setState(n, 'blocked'));
    reg('acc.task.unblock', (n: TaskNode) => this.setState(n, 'todo'));
    reg('acc.task.openTicket', (n: TaskNode) => n.kind === 'task' && n.task.source.url && vscode.env.openExternal(vscode.Uri.parse(n.task.source.url)));
    reg('acc.task.copyId', (n: TaskNode) => n.kind === 'task' && vscode.env.clipboard.writeText(n.task.id));
    reg('acc.tasks.refresh', () => this.hub.loadTasks(true));
    reg('acc.task.dispatch', (n: TaskNode) => this.dispatchTask(n));
    reg('acc.task.watch', (n: TaskNode) => this.watchTask(n));
    reg('acc.task.attach', (n: TaskNode) => n.kind === 'task' && n.task.run?.bgId && this.send(n.task.run.worktree ?? n.project.root, `claude attach ${n.task.run.bgId}`, `claude: ${n.task.id}`));
    reg('acc.task.openWorktree', (n: TaskNode) => n.kind === 'task' && n.task.run?.worktree && vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(n.task.run.worktree), { forceNewWindow: true }));
    reg('acc.task.abandon', (n: TaskNode) => this.abandonTask(n));
    reg('acc.task.cleanup', (n: TaskNode) => this.cleanupTask(n));
    reg('acc.agent.new', (n?: AgentNode) => this.newAgent(n));
    reg('acc.agent.watch', (n: AgentNode) => this.watchAgent(n));
    reg('acc.agent.attach', (n: AgentNode) => this.agentTerminal(n, 'attach'));
    // Logs are the activity page now; the terminal is the fallback when there's no page to show.
    reg('acc.agent.logs', (n: AgentNode) => (n?.kind === 'agent' && this.helpers.watch?.(sessionKey(n.session))) || this.agentTerminal(n, 'logs'));
    reg('acc.agent.stop', (n: AgentNode) => this.stopAgent(n));
    reg('acc.agent.openFolder', (n: AgentNode) => n.kind === 'agent' && vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(n.session.cwd), { forceNewWindow: true }));
    reg('acc.agents.refresh', () => this.hub.loadAgents());
    reg('acc.worktree.open', (n: WorktreeNode) => n.kind === 'worktree' && vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(n.worktree.path), { forceNewWindow: true }));
    reg('acc.worktree.terminal', (n: WorktreeNode) => n.kind === 'worktree' && this.terminal(`acc: ${n.worktree.branch ?? basename(n.worktree.path)}`, n.worktree.path).show());
    reg('acc.worktree.reveal', (n: WorktreeNode) => n.kind === 'worktree' && vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(n.worktree.path)));
    reg('acc.worktree.remove', (n: WorktreeNode) => this.removeWorktree(n));
    reg('acc.worktrees.refresh', () => this.hub.loadWorktrees());
    reg('acc.env.openOrg', (n: EnvNode) => n.kind === 'env' && n.env.org && this.output(n.project.root, `sf org open -o "${n.env.org}"`, `Open ${n.env.name}`));
    reg('acc.env.openGithub', (n: EnvNode) => n.kind === 'env' && n.project.config.github && vscode.env.openExternal(vscode.Uri.parse(githubBranchUrl(n.project.config.github.repo, n.env.branch))));
    reg('acc.env.compare', (n: EnvNode) => this.compare(n));
    reg('acc.env.copyBranch', (n: EnvNode) => n.kind === 'env' && vscode.env.clipboard.writeText(n.env.branch));
  }

  // ------------------------------------------------------------ helpers

  private async pickProject(n?: { project?: Project }): Promise<Project | undefined> {
    if (n?.project) return n.project;
    if (this.hub.projects.length <= 1) return this.hub.projects[0];
    return (await vscode.window.showQuickPick(this.hub.projects.map((p) => ({ label: p.name, description: p.root, p })), { title: 'Which project?' }))?.p;
  }

  private terminal(name: string, cwd: string): vscode.Terminal {
    const t = this.terminals.get(name);
    if (t && !t.exitStatus) return t;
    const created = vscode.window.createTerminal({ name, cwd, iconPath: new vscode.ThemeIcon('hubot') });
    this.terminals.set(name, created);
    return created;
  }

  /** A command whose output is worth reading but needs no keyboard: in the page when it can be. */
  private output(cwd: string, command: string, label: string): void {
    if (this.helpers.run) this.helpers.run(command, cwd, label);
    else this.send(cwd, command);
  }

  private send(cwd: string, command: string, name = 'acc'): void {
    const t = this.terminal(name, cwd);
    t.show();
    t.sendText(command, true);
    this.log.info(`Ran in terminal: ${command}`);
  }

  /** Runs acc, reports what it refused in plain words, and refreshes the tasks. */
  private async runAcc(project: Project, args: string[], done: (out: any) => string | undefined): Promise<boolean> {
    const r = await this.acc([...args, '--json'], project.root);
    let out: any = null;
    try {
      out = JSON.parse(r.stdout);
    } catch {
      out = null;
    }
    await this.hub.loadTasks(true);
    if (r.code !== 0) {
      const msg = out?.message ?? (r.stderr || r.stdout).trim();
      void vscode.window.showWarningMessage(msg.replace(/^✗ /, ''));
      this.log.warn(`acc ${args.join(' ')}: ${msg}`);
      return false;
    }
    const message = done(out);
    if (message) void vscode.window.showInformationMessage(message);
    return true;
  }

  // ------------------------------------------------------------ tasks

  private async addTask(n?: TaskNode): Promise<void> {
    const project = await this.pickProject(n);
    if (!project) return void vscode.window.showInformationMessage('Onboard a project first: Agent Command Center: Onboard this project.');
    const title = await vscode.window.showInputBox({ title: `New task in ${project.name}`, prompt: 'What needs doing?', validateInput: (v) => (v.trim() ? undefined : 'A task needs a title.') });
    if (!title) return;
    const brief = await vscode.window.showInputBox({ title: 'Details (optional)', prompt: 'Acceptance criteria, links, anything an agent should know. Press Enter to skip.' });
    const args = ['add', title.trim(), ...(brief?.trim() ? ['--brief', brief.trim()] : [])];
    await this.runAcc(project, args, (out) => (out?.added?.length ? `Added ${out.added.join(', ')}.` : undefined));
  }

  private async importGithub(n?: TaskNode): Promise<void> {
    const project = await this.pickProject(n);
    if (!project) return;
    if (!project.config.github) return void vscode.window.showWarningMessage(`${project.name} has no GitHub repo in .acc/config.json.`);
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Reading open issues on ${project.config.github.repo}` }, () =>
      this.runAcc(project, ['intake', 'github'], (out) => {
        const parts = [out?.added?.length ? `added ${out.added.length}` : '', out?.updated?.length ? `updated ${out.updated.length}` : '', out?.unchanged?.length ? `${out.unchanged.length} unchanged` : ''].filter(Boolean);
        return `GitHub issues: ${parts.join(', ') || 'no open issues'}.`;
      }));
  }

  private async showTask(n: TaskNode): Promise<void> {
    if (n.kind !== 'task') return;
    if (this.openTicket) return this.openTicket(n.project.root, n.task.id);
    const ledger = this.hub.ledger(n.project.root);
    const t = ledger?.tasks.find((x) => x.id === n.task.id);
    if (!t) return;
    const lines = [
      `# ${t.id}: ${t.title}`, '',
      `**${DISPLAY[n.task.display].label}** · environment \`${t.environment}\` · ${t.source.kind}${t.source.url ? ` · [ticket](${t.source.url})` : ''}`, '',
      t.deps.length ? `Depends on: ${t.deps.join(', ')}\n` : '',
      t.blocker ? `> Blocked: ${t.blocker}\n` : '',
      t.brief || '_No details._', '',
      '## History', '',
      ...t.history.map((h) => `- ${h.at.replace('T', ' ').slice(0, 16)}: ${h.from ?? '–'} → **${h.to}** by ${h.by}${h.reason ? `: ${h.reason}` : ''}${h.override ? ' (override)' : ''}`),
    ];
    const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  private async moveTask(n: TaskNode): Promise<void> {
    if (n.kind !== 'task') return;
    const ledger = this.hub.ledger(n.project.root);
    const task = ledger?.tasks.find((t) => t.id === n.task.id);
    if (!ledger || !task) return;
    const paths = repoPaths(n.project.root, runSync);
    const moves = allowedMoves(ledger, n.project.config, task, 'human', receiptHooks(paths, n.project.config, runSync));
    if (!moves.length) return void vscode.window.showInformationMessage(`${task.id} has no moves a person can make from ${task.state}.`);
    const pick = await vscode.window.showQuickPick(moves.map((m) => ({
      label: `${DISPLAY[m.to].glyph} ${DISPLAY[m.to].label}`,
      description: m.problems.length ? `not now: ${m.problems[0]}` : m.needsReason ? 'needs a reason' : '',
      move: m,
    })), { title: `Move ${task.id} from ${DISPLAY[task.state].label}` });
    if (!pick) return;
    if (pick.move.problems.length) return void vscode.window.showWarningMessage(`Can't move ${task.id} to ${pick.move.to}: ${pick.move.problems.join(' ')}`);
    await this.setState(n, pick.move.to, pick.move.needsReason);
  }

  private async setState(n: TaskNode, to: State, askReason = to === 'blocked'): Promise<void> {
    if (n.kind !== 'task') return;
    let reason: string | undefined;
    if (askReason) {
      reason = await vscode.window.showInputBox({ title: `${n.task.id} → ${DISPLAY[to].label}`, prompt: 'Why? This is recorded in the task\'s history.', validateInput: (v) => (v.trim() ? undefined : 'A reason is required.') });
      if (!reason) return;
    }
    await this.runAcc(n.project, ['set', n.task.id, to, ...(reason ? ['--reason', reason] : [])], () => `${n.task.id} → ${DISPLAY[to].label}.`);
  }

  /** Dispatch (D-009, D-013): worktree, setup, packet, background session, task → Running. */
  private async dispatchTask(n: TaskNode): Promise<void> {
    if (n.kind !== 'task') return;
    const { project, task } = n;
    let result: { worktree?: string; bgId?: string | null; reused?: boolean } | null = null;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Dispatching ${task.id}`, cancellable: false }, async (progress) => {
      progress.report({ message: 'creating the worktree and starting the agent…' });
      await this.runAcc(project, ['dispatch', task.id], (out) => {
        result = out;
        return undefined;
      });
    });
    if (!result) return;
    const r = result as { worktree?: string; bgId?: string | null; reused?: boolean };
    await Promise.all([this.hub.loadAgents(), this.hub.loadWorktrees()]);
    const where = r.worktree ? basename(r.worktree) : 'its worktree';
    const pick = await vscode.window.showInformationMessage(
      `${task.id} is running: an agent is working in ${where}${r.reused ? ' (reused)' : ''}. It will finish with acc done, or block if it needs you.`,
      ...(r.bgId ? ['Watch', 'Attach'] : []), 'Open worktree');
    if (pick === 'Watch' && r.bgId && !this.helpers.watch?.(r.bgId)) this.send(r.worktree ?? project.root, `claude attach ${r.bgId}`, `claude: ${task.id}`);
    if (pick === 'Attach' && r.bgId) this.send(r.worktree ?? project.root, `claude attach ${r.bgId}`, `claude: ${task.id}`);
    if (pick === 'Open worktree' && r.worktree) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(r.worktree), { forceNewWindow: true });
  }

  /** Stops the task's agent and moves it back to To do. The worktree and its commits are kept. */
  private async abandonTask(n: TaskNode): Promise<void> {
    if (n.kind !== 'task') return;
    const reason = await vscode.window.showInputBox({ title: `Abandon ${n.task.id}?`, prompt: 'Why? Its agent stops, the task goes back to To do, and the worktree and commits are kept.', validateInput: (v) => (v.trim() ? undefined : 'A reason is required.') });
    if (!reason) return;
    const session = this.hub.agents.find((s) => s.id && s.id === n.task.run?.bgId);
    if (session?.id && session.pid) await runFile('claude', ['stop', session.id], n.project.root, process.env, undefined, 30_000);
    await this.runAcc(n.project, ['set', n.task.id, 'todo', '--reason', reason], () => `${n.task.id} is back in To do. Its worktree is kept.`);
    await this.hub.loadAgents();
  }

  private async cleanupTask(n: TaskNode): Promise<void> {
    if (n.kind !== 'task' || !n.task.run?.worktree) return;
    const ok = await vscode.window.showWarningMessage(`Clean up ${n.task.id}'s worktree?`, { modal: true, detail: `${n.task.run.worktree}\n\nacc removes it only if nothing would be lost: no uncommitted changes, and every commit already merged.` }, 'Clean up');
    if (ok !== 'Clean up') return;
    const r = await this.acc(['cleanup', n.task.id, '--json'], n.project.root);
    let out: { removed?: boolean; reasons?: string[] } = {};
    try {
      out = JSON.parse(r.stdout);
    } catch {
      out = {};
    }
    if (out.removed) void vscode.window.showInformationMessage(`Removed ${basename(n.task.run.worktree)}.`);
    else void vscode.window.showWarningMessage(`Kept the worktree: ${(out.reasons ?? [(r.stderr || r.stdout).trim()]).join(' ')}`);
    await Promise.all([this.hub.loadTasks(true), this.hub.loadWorktrees()]);
  }

  // ------------------------------------------------------------ agents

  /** Until M3's dispatch, a free-form background agent: Claude Code isolates its edits in its own worktree. */
  private async newAgent(n?: AgentNode): Promise<void> {
    const project = n?.kind === 'place' && n.root ? this.hub.project(n.root) : await this.pickProject();
    const cwd = project?.root ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) return void vscode.window.showWarningMessage('Open a folder first.');
    const prompt = await vscode.window.showInputBox({
      title: `New background agent in ${project?.name ?? basename(cwd)}`,
      prompt: 'What should it do? It runs as a Claude Code background session, edits in its own worktree, and asks before anything risky.',
      validateInput: (v) => (v.trim().length >= 5 ? undefined : 'Say a bit more about the task.'),
    });
    if (!prompt) return;
    const name = await vscode.window.showInputBox({ title: 'Session name', value: agentName(prompt), validateInput: (v) => (/^[\w.-]+$/.test(v) ? undefined : 'Letters, digits, dots, dashes and underscores only.') });
    if (!name) return;
    const settings = this.helpers.sessionSettings ? ['--settings', this.helpers.sessionSettings] : [];
    const r = await runFile('claude', ['--bg', '--name', name, ...settings, prompt.trim()], cwd, process.env, undefined, 60_000);
    if (r.code !== 0) return void vscode.window.showWarningMessage(`Claude Code didn't start the agent: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
    this.log.info(`Started background agent ${name} in ${cwd}: ${r.stdout.trim()}`);
    await this.hub.loadAgents();
    // Attach by the short id claude agents reports, not by name.
    const started = this.hub.agents.find((s) => s.name === name && s.id);
    const pick = await vscode.window.showInformationMessage(`Started ${name}. It shows in Agents as it works, and asks you here if it needs anything.`, ...(started ? ['Watch', 'Attach'] : []));
    if (pick === 'Watch' && started) this.helpers.watch?.(sessionKey(started));
    if (pick === 'Attach' && started?.id) this.send(cwd, `claude attach ${started.id}`, `claude: ${name}`);
  }

  private watchAgent(n: AgentNode): void {
    if (n?.kind !== 'agent') return;
    if (!this.helpers.watch?.(sessionKey(n.session))) this.agentTerminal(n, 'logs');
  }

  /** A task's agent: its activity page, found by the session the task records. */
  private watchTask(n: TaskNode): void {
    if (n?.kind !== 'task') return;
    const session = sessionFor(n.task, this.hub.agents);
    if (session && this.helpers.watch?.(sessionKey(session))) return;
    // Its session has ended: its transcript still says what it did.
    const run = n.task.run;
    const startedAt = Date.parse(this.hub.ledger(n.project.root)?.tasks.find((t) => t.id === n.task.id)?.run?.startedAt ?? '') || Date.now();
    if (run?.sessionId && run.worktree && this.helpers.watch?.(run.sessionId, { cwd: run.worktree, kind: 'background', startedAt, sessionId: run.sessionId, name: n.task.id })) return;
    void vscode.window.showInformationMessage(`${n.task.id} has no agent session to show.`, ...(n.task.run?.worktree ? ['Open worktree'] : []))
      .then((p) => p && n.task.run?.worktree && vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(n.task.run.worktree), { forceNewWindow: true }));
  }

  private agentTerminal(n: AgentNode, verb: 'attach' | 'logs'): void {
    if (n.kind !== 'agent') return;
    const s = n.session;
    if (!s.id) {
      void vscode.window.showInformationMessage(`${s.name ?? 'This session'} is an interactive session in another window or terminal, so there's nothing to attach to here.`, 'Open its folder').then((p) => p && vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(s.cwd), { forceNewWindow: true }));
      return;
    }
    this.send(s.cwd, `claude ${verb} ${s.id}`, `claude: ${s.name ?? s.id}`);
  }

  private async stopAgent(n: AgentNode): Promise<void> {
    if (n.kind !== 'agent') return;
    const s = n.session;
    const id = s.id;
    if (!id) return;
    const ok = await vscode.window.showWarningMessage(`Stop ${s.name ?? id}?`, { modal: true, detail: 'The session stops where it is. Its worktree and transcript are kept, and you can resume it later.' }, 'Stop');
    if (ok !== 'Stop') return;
    const r = await runFile('claude', ['stop', id], s.cwd, process.env, undefined, 30_000);
    if (r.code !== 0) void vscode.window.showWarningMessage(`Couldn't stop it: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
    await this.hub.loadAgents();
  }

  // ------------------------------------------------------------ worktrees and environments

  /** Refuses anything that would lose work: uncommitted files, or commits that exist only here (D-013). */
  private async removeWorktree(n: WorktreeNode): Promise<void> {
    if (n.kind !== 'worktree' || n.worktree.main) return;
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

  private compare(n: EnvNode): void {
    if (n.kind !== 'env') return;
    const prod = n.project.config.environments.find((e) => e.type === 'production' || e.protected);
    const base = prod && prod.branch !== n.env.branch ? prod.branch : n.project.config.environments.find((e) => e.default && e.branch !== n.env.branch)?.branch;
    if (!base) return void vscode.window.showInformationMessage('There\'s no other environment to compare with.');
    this.output(n.project.root, `git diff --no-renames --stat ${base}...${n.env.branch}`, `Compare ${n.env.branch} with ${base}`);
  }
}
