import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { allowedMoves, DISPLAY, findRule, type State } from '../../packages/core/src/ledger.ts';
import { skippedOn } from '../../packages/core/src/promote.ts';
import { agentArgs } from '../../packages/core/src/agents.ts';
import { EFFORTS } from '../../packages/core/src/config.ts';
import { run as runSync } from '../../packages/core/src/exec.ts';
import { repoPaths } from '../../packages/core/src/paths.ts';
import { receiptHooks } from '../../packages/core/src/receipts.ts';
import type { Hub, Project } from './hub.ts';
import { type AgentSession, agentName, CLAUDE_EXTENSION, claudeSessionUri, githubBranchUrl, isSessionId, landMessage, sessionFor } from './logic.ts';
import { laneMove, sessionKey } from './model.ts';
import { type RunResult, runFile } from './run.ts';
import { savedFolder } from './transcript.ts';
import type { AgentNode, EnvNode, TaskNode, WorktreeNode } from './nodes.ts';

type Acc = (args: string[], cwd: string, token?: vscode.CancellationToken) => Promise<RunResult>;

/** What the sidebar's actions can use from the rest of the extension (D-030). */
export interface SidebarHelpers {
  /** Runs a command with its output in the page, instead of a terminal. `ok` judges an exit code that says more than done or failed. */
  run?: (command: string, cwd: string, label: string, onExit?: (code: number | null) => void, ok?: (code: number | null) => boolean) => void;
  /** Opens a session's activity page. A session that has ended needs the hint to find its transcript. */
  watch?: (key: string, ended?: AgentSession, active?: () => boolean) => boolean;
  /** How a shell runs the bundled acc, for commands run in the page. */
  accCommand?: string;
  /** Remembers a conversation to open once a folder's window starts, for a session that lives in another folder (D-040). */
  openLater?: (folder: string, sessionId: string) => Promise<void>;
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
    reg('acc.task.intake', (n?: TaskNode) => this.intake(n));
    reg('acc.task.openPacket', (n: TaskNode) => this.openPacket(n));
    reg('acc.task.show', (n: TaskNode) => this.showTask(n));
    reg('acc.task.move', (n: TaskNode) => this.moveTask(n));
    reg('acc.task.block', (n: TaskNode) => this.setState(n, 'blocked'));
    reg('acc.task.unblock', (n: TaskNode) => this.setState(n, 'todo'));
    reg('acc.task.openTicket', (n: TaskNode) => n.kind === 'task' && n.task.source.url && vscode.env.openExternal(vscode.Uri.parse(n.task.source.url)));
    reg('acc.task.copyId', (n: TaskNode) => n.kind === 'task' && vscode.env.clipboard.writeText(n.task.id));
    reg('acc.tasks.refresh', () => this.hub.loadTasks(true));
    reg('acc.task.dispatch', (n: TaskNode) => this.dispatchTask(n));
    reg('acc.task.watch', (n: TaskNode) => this.watchTask(n));
    reg('acc.task.review', (n: TaskNode) => this.reviewTask(n));
    reg('acc.task.watchReview', (n: TaskNode) => this.watchReview(n));
    reg('acc.task.analyze', (n: TaskNode) => this.analyzeTask(n));
    reg('acc.task.watchAnalysis', (n: TaskNode) => this.watchAnalysis(n));
    reg('acc.task.land', (n: TaskNode) => this.landTask(n));
    reg('acc.task.openPr', (n: TaskNode) => n?.kind === 'task' && n.task.pr && vscode.env.openExternal(vscode.Uri.parse(n.task.pr.url)));
    reg('acc.task.attach', (n: TaskNode) => n.kind === 'task' && n.task.run?.bgId && this.send(n.task.run.worktree ?? n.project.root, `claude attach ${n.task.run.bgId}`, `claude: ${n.task.id}`));
    reg('acc.task.openWorktree', (n: TaskNode) => n.kind === 'task' && n.task.run?.worktree && vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(n.task.run.worktree), { forceNewWindow: true }));
    reg('acc.task.abandon', (n: TaskNode) => this.abandonTask(n));
    reg('acc.task.cleanup', (n: TaskNode) => this.cleanupTask(n));
    reg('acc.agent.new', (n?: AgentNode) => this.newAgent(n));
    reg('acc.agent.watch', (n: AgentNode) => this.watchAgent(n));
    reg('acc.agent.openInClaude', (n: AgentNode) => n?.kind === 'agent' && this.openInClaude(n.session));
    reg('acc.task.openInClaude', (n: TaskNode) => {
      if (n?.kind !== 'task') return;
      const s = sessionFor(n.task, this.hub.agents);
      const id = s?.sessionId ?? n.task.run?.sessionId;
      if (!id) return void vscode.window.showInformationMessage(`${n.task.id} has no agent session to open.`);
      return this.openInClaude(s ?? { cwd: n.task.run?.worktree ?? n.project.root, kind: 'background', startedAt: Date.now(), sessionId: id, name: n.task.id });
    });
    reg('acc.agent.attach', (n: AgentNode) => this.agentTerminal(n, 'attach'));
    // Logs are the activity page now; the terminal is the fallback when there's no page to show.
    reg('acc.agent.logs', (n: AgentNode) => (n?.kind === 'agent' && this.helpers.watch?.(sessionKey(n.session))) || this.agentTerminal(n, 'logs'));
    reg('acc.agent.stop', (n: AgentNode) => this.stopAgent(n));
    reg('acc.agent.openFolder', (n: AgentNode) => n.kind === 'agent' && vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(n.session.cwd), { forceNewWindow: true }));
    reg('acc.agents.refresh', () => this.hub.loadAgents());
    reg('acc.agents.configure', (arg?: unknown) => this.configureAgents(arg));
    reg('acc.agents.autonomy', (arg?: unknown) => this.configureAutonomy(arg));
    reg('acc.worktree.open', (n: WorktreeNode) => n.kind === 'worktree' && vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(n.worktree.path), { forceNewWindow: true }));
    reg('acc.worktree.terminal', (n: WorktreeNode) => n.kind === 'worktree' && this.terminal(`acc: ${n.worktree.branch ?? basename(n.worktree.path)}`, n.worktree.path).show());
    reg('acc.worktree.reveal', (n: WorktreeNode) => n.kind === 'worktree' && vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(n.worktree.path)));
    reg('acc.worktree.remove', (n: WorktreeNode) => this.removeWorktree(n));
    reg('acc.worktrees.refresh', () => this.hub.loadWorktrees());
    reg('acc.env.openOrg', (n: EnvNode) => n.kind === 'env' && n.env.org && this.output(n.project.root, `sf org open -o "${n.env.org}"`, `Open ${n.env.name}`));
    reg('acc.env.openGithub', (n: EnvNode) => n.kind === 'env' && n.project.config.github && vscode.env.openExternal(vscode.Uri.parse(githubBranchUrl(n.project.config.github.repo, n.env.branch))));
    reg('acc.env.compare', (n: EnvNode) => this.compare(n));
    reg('acc.env.copyBranch', (n: EnvNode) => n.kind === 'env' && vscode.env.clipboard.writeText(n.env.branch));
    reg('acc.env.promote', (n: EnvNode) => this.promoteEnv(n));
    reg('acc.env.deploy', (n: EnvNode) => this.deployEnv(n));
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
        const parts = [
          out?.added?.length ? `added ${out.added.length}` : '', out?.updated?.length ? `updated ${out.updated.length}` : '', out?.unchanged?.length ? `${out.unchanged.length} unchanged` : '',
          out?.closed?.length ? `${out.closed.length} done (closed on GitHub)` : '', out?.removed?.length ? `removed ${out.removed.length} (skipped label)` : '',
          out?.leftAlone?.length ? `left ${out.leftAlone.map((l: { task: string }) => l.task).join(', ')} as they are (already started)` : '',
        ].filter(Boolean);
        return `GitHub issues: ${parts.join(', ') || 'no open issues'}.`;
      }));
  }

  /** Every way work comes in, in one list: write a task, import the repo's issues, or track a Jira ticket. */
  private async intake(n?: TaskNode): Promise<void> {
    const project = await this.pickProject(n);
    if (!project) return void vscode.window.showInformationMessage('Onboard a project first: Agent Command Center: Onboard this project.');
    const node: TaskNode = { kind: 'project', project };
    const jira = project.config.trackers.some((t) => t.kind === 'jira');
    const items = [
      { label: '$(add) Write a task', detail: 'A title and details, kept by acc.', go: () => this.addTask(node) },
      ...(project.config.github ? [{ label: '$(github) Import GitHub issues', description: project.config.github.repo, detail: 'Adds a task for each open issue, and refreshes the ones already here.', go: () => this.importGithub(node) }] : []),
      ...(jira ? [{ label: '$(issues) Track a Jira ticket', detail: 'Its board is on the Tasks tab: open a ticket and choose Track in acc.', go: () => vscode.commands.executeCommand('acc.open.tasks') }] : []),
    ];
    const pick = await vscode.window.showQuickPick(items, { title: `New work for ${project.name}` });
    await pick?.go();
  }

  /** The instructions acc wrote for the task's builder when it dispatched it. */
  private async openPacket(n: TaskNode): Promise<void> {
    if (n?.kind !== 'task') return;
    const file = vscode.Uri.file(join(dirname(n.project.ledgerPath), 'packets', `${n.task.id}.md`));
    if (!existsSync(file.fsPath)) return void vscode.window.showInformationMessage(`${n.task.id} has no instructions yet. acc writes them when it dispatches the task.`);
    try {
      await vscode.commands.executeCommand('markdown.showPreview', file);
    } catch {
      await vscode.window.showTextDocument(file, { preview: true });
    }
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

  /**
   * A card dropped in a lane (D-041): the move to that lane's state, asking for a reason when the rules
   * want one. Running means dispatching it, after a confirmation. acc decides whether it may go.
   */
  async moveToLane(project: Project, id: string, lane: string): Promise<void> {
    const task = this.hub.taskRows(project.root).find((t) => t.id === id);
    if (!task) return;
    const n = { kind: 'task', project, task } as TaskNode;
    const to = laneMove(lane);
    if (!to) { await this.hub.loadTasks(true); return; }
    if (to === 'dispatch') {
      const ok = await vscode.window.showInformationMessage(`Dispatch ${id}?`, { modal: true, detail: 'An agent starts on it in its own worktree.' }, 'Dispatch');
      if (ok === 'Dispatch') await this.dispatchTask(n);
      else await this.hub.loadTasks(true);
      return;
    }
    const rule = findRule(task.state as State, to);
    await this.setState(n, to, !!rule?.requires.includes('reason'));
    await this.hub.loadTasks(true); // snaps back if it was refused or cancelled
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
      ...(r.bgId ? ['Watch', 'Open in Claude Code'] : []), 'Open worktree');
    if (pick === 'Watch' && r.bgId && !this.helpers.watch?.(r.bgId)) this.send(r.worktree ?? project.root, `claude attach ${r.bgId}`, `claude: ${task.id}`);
    if (pick === 'Open in Claude Code' && r.bgId) {
      const s = this.hub.agents.find((a) => a.id === r.bgId);
      if (s) await this.openInClaude(s);
      else this.send(r.worktree ?? project.root, `claude attach ${r.bgId}`, `claude: ${task.id}`);
    }
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
    // A free-form agent runs like a builder: the same model and effort (D-036).
    const r = await runFile('claude', ['--bg', '--name', name, ...agentArgs(project?.agents.builder), ...settings, prompt.trim()], cwd, process.env, undefined, 60_000);
    if (r.code !== 0) return void vscode.window.showWarningMessage(`Claude Code didn't start the agent: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
    this.log.info(`Started background agent ${name} in ${cwd}: ${r.stdout.trim()}`);
    await this.hub.loadAgents();
    // Attach by the short id claude agents reports, not by name.
    const started = this.hub.agents.find((s) => s.name === name && s.id);
    const pick = await vscode.window.showInformationMessage(`Started ${name}. It shows in Agents as it works, and asks you here if it needs anything.`, ...(started ? ['Watch', 'Open in Claude Code'] : []));
    if (pick === 'Watch' && started) this.helpers.watch?.(sessionKey(started));
    if (pick === 'Open in Claude Code' && started) await this.openInClaude(started);
  }

  // ------------------------------------------------------------ what agents run with (D-036)

  /** Change a role's model, effort or fallback, for this clone or as the project's default. */
  private async configureAgents(arg: unknown): Promise<void> {
    const [role, root] = typeof arg === 'string' ? arg.split('|') : [];
    const project = root ? this.hub.project(root) : await this.pickProject();
    if (!project || (role !== 'builder' && role !== 'reviewer')) return;
    const now = project.agents[role];
    const label = role === 'builder' ? 'Builders' : 'Reviewers';
    const what = await vscode.window.showQuickPick([
      { label: '$(symbol-class) Model', description: now.model ?? 'Claude Code\'s default', key: 'model' as const },
      { label: '$(lightbulb) Effort', description: now.effort ?? 'default', detail: 'How hard it thinks: more effort is slower and uses more of your plan', key: 'effort' as const },
      { label: '$(debug-step-back) Fallback model', description: now.fallbackModel ?? 'none', detail: 'Used when the model is overloaded', key: 'fallback' as const },
      { label: '$(discard) Back to the defaults', key: 'reset' as const },
    ], { title: `${label}: what to change?` });
    if (!what) return;
    const models = (current: string | null, none: string) => vscode.window.showQuickPick([
      { label: none, value: null as string | null },
      { label: 'opus', description: 'Claude Opus, the latest', value: 'opus' },
      { label: 'sonnet', description: 'Claude Sonnet, the latest: lighter on your plan', value: 'sonnet' },
      { label: 'fable', description: 'Claude Fable, the latest', value: 'fable' },
      { label: 'haiku', description: 'Claude Haiku, the latest: the lightest', value: 'haiku' },
      { label: 'Another model…', description: 'a full model name', value: '?' },
    ].map((m) => ({ ...m, picked: m.value === current, description: m.value === current ? `${m.description ?? ''} · now`.replace(/^ · /, '') : m.description })), { title: `${label}: which model?` });
    const args: string[] = [];
    if (what.key === 'model' || what.key === 'fallback') {
      const pick = await models(what.key === 'model' ? now.model : now.fallbackModel, what.key === 'model' ? 'Claude Code\'s default' : 'No fallback');
      if (!pick) return;
      let value = pick.value;
      if (value === '?') {
        value = (await vscode.window.showInputBox({ title: `${label}: model name`, prompt: 'A model alias or full name, as claude --model takes it', validateInput: (v) => (/^[A-Za-z0-9][A-Za-z0-9._:[\]-]{0,79}$/.test(v.trim()) ? undefined : 'Letters, digits, dots, dashes, colons and brackets') }))?.trim() ?? null;
        if (!value) return;
      }
      const flag = what.key === 'model' ? 'model' : 'fallback-model';
      args.push(...(value ? [`--${flag}`, value] : ['--clear', flag]));
    } else if (what.key === 'effort') {
      const words: Record<string, string> = { low: 'Quickest, the least thinking', medium: 'Balanced', high: 'Thinks it through', xhigh: 'Thinks hard', max: 'The most thinking: slowest, uses the most' };
      const pick = await vscode.window.showQuickPick([{ label: 'Default', description: 'Claude Code\'s own', value: null as string | null }, ...EFFORTS.map((e) => ({ label: e, description: words[e], value: e as string | null }))]
        .map((x) => ({ ...x, description: x.value === now.effort ? `${x.description} · now` : x.description })), { title: `${label}: how much effort?` });
      if (!pick) return;
      args.push(...(pick.value ? ['--effort', pick.value] : ['--clear', 'effort']));
    } else {
      args.push('--clear', 'model', '--clear', 'effort', '--clear', 'fallback-model');
    }
    const scope = await vscode.window.showQuickPick([
      { label: '$(device-desktop) This clone only', description: 'git config: nobody else sees it', project: false },
      { label: '$(repo) The project\'s default', description: 'edits .acc/config.json, for you to commit and share', project: true },
    ], { title: `${label}: for whom?` });
    if (!scope) return;
    const ok = await this.runAcc(project, ['agents', 'set', role, ...args, ...(scope.project ? ['--project'] : [])], () => undefined);
    if (ok) {
      await this.hub.loadProjects();
      void vscode.window.showInformationMessage(`${label} changed${scope.project ? ' in .acc/config.json: commit it to share it' : ' for this clone'}. The next one started uses it.`);
    }
  }

  /**
   * What autopilot may do on its own in a project (D-055), changed through acc in .acc/config.json, for
   * the person to commit. Turning autopilot on is a separate click, in the status bar (D-064).
   */
  private async configureAutonomy(arg: unknown): Promise<void> {
    const project = typeof arg === 'string' ? this.hub.project(arg) : await this.pickProject();
    if (!project) return;
    const now = project.config.autonomy;
    const pick = await vscode.window.showQuickPick([
      { label: '$(debug-pause) manual', description: 'Nothing happens on its own', value: 'manual' },
      { label: '$(rocket) review', description: 'Autopilot reviews, lands and re-dispatches a rework once; never merges', value: 'review' },
    ].map((x) => ({ ...x, description: x.value === now ? `${x.description} · now` : x.description })), { title: `${project.name}: what may autopilot do on its own?` });
    if (!pick || pick.value === now) return;
    const ok = await this.runAcc(project, ['agents', 'autonomy', pick.value], () => undefined);
    if (!ok) return;
    await this.hub.loadProjects();
    void vscode.window.showInformationMessage(`Autonomy is ${pick.value}. Changed in .acc/config.json: commit it to share it.${pick.value === 'review' ? ' Autopilot stays off until you turn it on in the status bar.' : ''}`);
  }

  // ------------------------------------------------------------ review and land (D-032, D-033)

  /** The reviewer runs in the output panel; its session can be watched while it reads. */
  private reviewTask(n: TaskNode): void {
    if (n?.kind !== 'task') return;
    const { project, task } = n;
    const acc = this.helpers.accCommand ?? 'acc';
    const done = () => void this.hub.loadTasks(true);
    if (this.helpers.run) {
      this.helpers.run(`${acc} review ${task.id}`, project.root, `Review ${task.id}`, done);
      // The reviewer's session shows once acc has started it.
      setTimeout(done, 2_000);
    } else {
      this.send(project.root, `acc review ${task.id}`);
    }
  }

  private watchReview(n: TaskNode): void {
    if (n?.kind !== 'task' || !n.task.reviewing || !n.task.run?.worktree) return;
    const { sessionId } = n.task.reviewing;
    const root = n.project.root;
    const id = n.task.id;
    const stillReviewing = () => !!this.hub.taskRows(root).find((t) => t.id === id)?.reviewing;
    this.helpers.watch?.(sessionId, { cwd: n.task.run.worktree, kind: 'background', startedAt: Date.now(), sessionId, name: `Review ${id}` }, stillReviewing);
  }

  // ------------------------------------------------------------ the analysis before a build (D-052)

  /** The analyst runs in the output panel, like a review; its session can be watched while it reads. */
  private analyzeTask(n: TaskNode): void {
    if (n?.kind !== 'task') return;
    const { project, task } = n;
    const acc = this.helpers.accCommand ?? 'acc';
    const done = () => void this.hub.loadTasks(true);
    if (this.helpers.run) {
      // acc analyze exits 1 when the analysis has questions or says to split it: a new analysis is a run that
      // worked, and its notice says what it found. An error writes none.
      const before = this.hub.analysis(project.root, task.id)?.at ?? null;
      const made = (code: number | null) => code === 0 || (this.hub.analysis(project.root, task.id)?.at ?? null) !== before;
      this.helpers.run(`${acc} analyze ${task.id}`, project.root, `Analyze ${task.id}`, done, made);
      // The analyst's session shows once acc has started it.
      setTimeout(done, 2_000);
    } else {
      this.send(project.root, `acc analyze ${task.id}`);
    }
  }

  private watchAnalysis(n: TaskNode): void {
    if (n?.kind !== 'task' || !n.task.analyzing) return;
    const { sessionId } = n.task.analyzing;
    const root = n.project.root;
    const id = n.task.id;
    const stillAnalyzing = () => !!this.hub.taskRows(root).find((t) => t.id === id)?.analyzing;
    this.helpers.watch?.(sessionId, { cwd: root, kind: 'background', startedAt: Date.now(), sessionId, name: `Analysis ${id}` }, stillAnalyzing);
  }

  /** Pushes and opens the pull request, after a person says so: it's the first thing that leaves this machine. */
  private async landTask(n: TaskNode): Promise<void> {
    if (n?.kind !== 'task') return;
    const { project, task } = n;
    const gh = project.config.github;
    if (!gh) return void vscode.window.showWarningMessage(`${project.name} has no GitHub repo in .acc/config.json, so there's nowhere to open a pull request.`);
    const again = task.pr?.state === 'open';
    const ok = await vscode.window.showWarningMessage(again ? `Update pull request #${task.pr!.number} for ${task.id}?` : `Land ${task.id}?`, {
      modal: true,
      detail: `${again ? 'Pushes the reviewed commits to' : 'Pushes'} ${task.run?.branch ?? 'its branch'} to ${gh.repo} as ${gh.account}${again ? '.' : `, and opens a pull request into ${task.environment}.`} acc never merges: a person does, on GitHub.`,
    }, again ? 'Update' : 'Push and open');
    if (!ok) return;
    type Landed = { pr?: { number: number; url: string }; opened?: boolean; update?: { id: string; key: string } | null; updateError?: string };
    const box: { r: Landed | null } = { r: null };
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Landing ${task.id}`, cancellable: false }, async (progress) => {
      progress.report({ message: 'pushing and opening the pull request…' });
      await this.runAcc(project, ['land', task.id], (out) => { box.r = out as Landed; return undefined; });
    });
    const r = box.r;
    if (!r) return;
    // The ticket hears about it only once a person posts the update acc drafted (D-066).
    const { level, text } = landMessage(task.id, r);
    const buttons = [...(r.update ? ['Review the update'] : []), 'Open pull request'];
    const pick = level === 'warning' ? await vscode.window.showWarningMessage(text, ...buttons) : await vscode.window.showInformationMessage(text, ...buttons);
    if (pick === 'Review the update') this.openTicket?.(project.root, task.id);
    if (pick === 'Open pull request' && r.pr) await vscode.env.openExternal(vscode.Uri.parse(r.pr.url));
  }

  // ------------------------------------------------------------ open in Claude Code (D-040)

  /**
   * Opens a session's conversation in a Claude Code tab, with its whole history, through Claude Code's
   * own link. A session can't run in two places at once, so one still working in the background is
   * stopped there first, after you say so, and the tab carries on the same conversation.
   */
  async openInClaude(s: AgentSession): Promise<void> {
    if (!isSessionId(s.sessionId)) return void vscode.window.showInformationMessage(`${s.name ?? 'This session'} has no conversation Claude Code can open.`);
    const name = s.name ?? s.sessionId.slice(0, 8);
    if (!vscode.extensions.getExtension(CLAUDE_EXTENSION)) {
      const pick = await vscode.window.showInformationMessage('Opening a session in a tab needs Claude Code for VSCode.', 'Install it', ...(s.id ? ['Attach in a terminal'] : []));
      if (pick === 'Install it') await vscode.commands.executeCommand('workbench.extensions.installExtension', CLAUDE_EXTENSION);
      if (pick === 'Attach in a terminal' && s.id) this.send(s.cwd, `claude attach ${s.id}`, `claude: ${name}`);
      return;
    }
    // The folder the conversation is saved under, from the file itself: a stopped builder can report the
    // main checkout it started from, and the window asking may be another repo's (D-046).
    const sessionId = s.sessionId;
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    const task = this.hub.projects.flatMap((p) => this.hub.taskRows(p.root)).find((t) => t.run?.sessionId === sessionId);
    const live = this.hub.agents.find((a) => a.sessionId === sessionId);
    const folder = savedFolder(join(homedir(), '.claude', 'projects'), sessionId, [s.cwd, task?.run?.worktree, ...this.hub.projects.flatMap((p) => p.worktrees.map((w) => w.path))])
      ?? (live?.pid ? s.cwd : null); // a session that has only just started may not have saved anything yet
    if (!folder) {
      const pick = await vscode.window.showWarningMessage(`Couldn't find where ${name}'s conversation is saved, so Claude Code can't open it.`, 'Watch it here');
      if (pick) this.helpers.watch?.(sessionKey(s));
      return;
    }
    if (live?.kind === 'background' && live.id && live.pid && live.state !== 'done' && live.state !== 'stopped' && live.state !== 'failed') {
      const ok = await vscode.window.showWarningMessage(`Take ${name} over in Claude Code?`, {
        modal: true,
        detail: `It's ${live.state === 'blocked' ? 'waiting for an answer' : 'working'} in the background. A conversation can't run in two places, so acc stops it there, and a Claude Code tab carries on the same conversation, with its whole history. You drive it from the tab.${live.name && /^[A-Z][A-Z0-9_]*-\d+$/.test(live.name) ? ` Its task stays Running: finish it with acc done ${live.name}, or move it from the page.` : ''}`,
      }, 'Stop it and open');
      if (ok !== 'Stop it and open') return;
      const r = await runFile('claude', ['stop', live.id], live.cwd, process.env, undefined, 30_000);
      if (r.code !== 0) return void vscode.window.showWarningMessage(`Couldn't stop it in the background: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
      // Wait until Claude Code no longer lists it as running, so the tab is the only one.
      for (let i = 0; i < 20; i++) {
        await this.hub.loadAgents();
        const still = this.hub.agents.find((a) => a.sessionId === s.sessionId);
        if (!still?.pid || still.state === 'stopped') break;
        await new Promise((res) => setTimeout(res, 500));
      }
    } else if (live?.kind === 'interactive' && live.pid) {
      const ok = await vscode.window.showWarningMessage(`${name} is open somewhere else.`, {
        modal: true, detail: 'It\'s running in a terminal or another Claude Code tab. Using it in two places at once can mix up its messages. If it\'s already in a Claude Code tab in this window, opening it again brings that tab forward.',
      }, 'Open anyway');
      if (ok !== 'Open anyway') return;
    }
    // Claude Code opens only a conversation that belongs to the window's own folder. A builder's lives
    // in its worktree, so that folder opens in a new window, and the conversation opens there.
    if (!folders.includes(folder) && existsSync(folder) && this.helpers.openLater) {
      await this.helpers.openLater(folder, sessionId);
      this.log.info(`Opening ${name}'s folder ${folder} in a new window, to open its conversation there.`);
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(folder), { forceNewWindow: true });
      return;
    }
    const uri = vscode.Uri.parse(claudeSessionUri(vscode.env.uriScheme, sessionId));
    this.log.info(`Opening ${name} in Claude Code: ${uri.toString(true)}`);
    await vscode.env.openExternal(uri);
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

  // ------------------------------------------------------------ promote and deploy (D-034)

  /** Runs `acc … --json` and reads its answer, or says what it refused. */
  private async accJson<T>(project: Project, args: string[], title: string, expected?: RegExp): Promise<T | { refused: string } | null> {
    const r = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, () => this.acc([...args, '--json'], project.root));
    try {
      const out = JSON.parse(r.stdout) as T & { error?: string; message?: string };
      if (r.code === 0 && !out.error) return out;
      const message = (out.message ?? (r.stderr || r.stdout).trim()).replace(/^✗ /, '');
      // A refusal the caller handles itself, such as a first deploy needing its starting point.
      if (expected?.test(message)) return { refused: message };
      void vscode.window.showWarningMessage(message);
    } catch {
      void vscode.window.showWarningMessage((r.stderr || r.stdout).trim().split('\n')[0] || `acc ${args[0]} didn't answer.`);
    }
    return null;
  }

  private async promoteEnv(n: EnvNode): Promise<void> {
    if (n?.kind !== 'env') return;
    const { project, env } = n;
    const envs = project.config.environments;
    const name = (b: string) => envs.find((e) => e.branch === b)?.name ?? b;
    const to = env.promotesTo.length === 1 ? env.promotesTo[0] : (await vscode.window.showQuickPick(env.promotesTo.map((b, i) => {
      const skips = skippedOn(project.config, env, envs.find((e) => e.branch === b)!);
      return { label: name(b), description: b, detail: i === 0 ? 'The usual next step' : skips.length ? `Skips ${skips.map((e) => e.name).join(' and ')}: the change won't have been validated there` : undefined, b };
    }), { title: `Promote ${env.name} to…` }))?.b;
    if (!to) return;
    type Plan = { files: string[]; deleted: string[]; leftOut: string[]; skipped: { name: string; branch: string }[]; fromSha: string };
    const got = await this.accJson<Plan>(project, ['promote', env.branch, '--to', to, '--plan'], `Working out what ${env.name} has for ${name(to)}`);
    if (!got || 'refused' in got) return;
    const plan = got;
    if (!plan.files.length && !plan.deleted.length) return void vscode.window.showInformationMessage(`${name(to)} already has everything from ${env.name}.`);
    const sf = project.config.profile === 'salesforce' && envs.find((e) => e.branch === to)?.org;
    const lines = [
      `${plan.files.length} file${plan.files.length === 1 ? '' : 's'} to bring over${plan.leftOut.length ? `, ${plan.leftOut.length} environment-specific left out` : ''}.`,
      ...plan.skipped.map((e) => `⚠ Skips ${e.name}: this change hasn't been validated there.`),
      ...(plan.deleted.length ? [`⚠ Deletes ${plan.deleted.length} file${plan.deleted.length === 1 ? '' : 's'} in ${name(to)}, which usually means the branches have drifted apart: ${plan.deleted.slice(0, 4).join(', ')}${plan.deleted.length > 4 ? ', …' : ''}`] : []),
      '',
      `${sf ? `First, a check-only deploy to ${name(to)}'s org, which saves nothing. If it passes, acc` : 'acc'} pushes a promotion branch and opens a pull request into ${to}. Nothing merges or deploys until a person does.`,
    ];
    const go = plan.deleted.length ? 'Promote, with the deletions' : 'Promote';
    const ok = await vscode.window.showWarningMessage(`Promote ${env.name} to ${name(to)}?`, { modal: true, detail: lines.join('\n') }, go);
    if (ok !== go) return;
    const acc = this.helpers.accCommand ?? 'acc';
    const command = `${acc} promote ${env.branch} --to ${to}${plan.deleted.length ? ' --allow-deletions' : ''}`;
    if (this.helpers.run) this.helpers.run(command, project.root, `Promote ${env.name} → ${name(to)}`);
    else this.send(project.root, command);
  }

  private async deployEnv(n: EnvNode): Promise<void> {
    if (n?.kind !== 'env' || !n.env.org) return;
    const { project, env } = n;
    type Plan = { files: string[]; deleted: string[]; leftOut: string[]; base: string; head: string; testLevel: string; confirm: boolean };
    const base = ['deploy', env.branch, '--plan'];
    let since: string | undefined;
    const first = await this.accJson<Plan>(project, base, `Working out what ${env.name} needs`, /hasn't been deployed by acc before/);
    if (!first) return;
    let plan: Plan;
    if (!('refused' in first)) plan = first;
    else {
      // A first deploy needs a starting point: the commit the org already matches.
      since = (await vscode.window.showInputBox({
        title: `${env.name}: where does the org's deploy start?`,
        prompt: `acc hasn't deployed ${env.name} before. Give the commit or tag ${env.org} already has, and acc deploys what changed on ${env.branch} after it.`,
        placeHolder: 'a commit sha, tag or branch', ignoreFocusOut: true,
        validateInput: (v) => (/^[\w./-]+$/.test(v.trim()) ? undefined : 'A commit, tag or branch name'),
      }))?.trim();
      if (!since) return;
      const again = await this.accJson<Plan>(project, [...base, '--since', since], `Working out what ${env.name} needs`);
      if (!again || 'refused' in again) return;
      plan = again;
    }
    if (!plan.files.length) return void vscode.window.showInformationMessage(plan.deleted.length ? `Only deletions changed on ${env.branch}; acc doesn't deploy those.` : `${env.name} already has ${env.branch} at ${plan.head.slice(0, 7)}.`);
    if (plan.deleted.length) return void vscode.window.showWarningMessage(`${plan.deleted.length} file(s) were deleted on ${env.branch} since the last deploy. acc doesn't deploy deletions: remove them from the org by hand first.`);
    const detail = [
      `Deploys ${plan.files.length} file${plan.files.length === 1 ? '' : 's'} from ${env.branch} (${plan.base.slice(0, 7)} → ${plan.head.slice(0, 7)}) to ${env.org}, with ${plan.testLevel === 'RunLocalTests' ? 'the org\'s local tests' : 'no tests'}.`,
      plan.leftOut.length ? `${plan.leftOut.length} environment-specific file(s) are left out.` : '',
      'This changes the org. It runs one deploy at a time on this machine.',
    ].filter(Boolean).join('\n');
    if (plan.confirm) {
      // A protected org: the person types its name, so it can't be a stray click.
      const typed = await vscode.window.showInputBox({ title: `Deploy to ${env.name}?`, prompt: `${detail}\n\n${env.name} is protected. Type ${env.name} to deploy.`, ignoreFocusOut: true, validateInput: (v) => (v.trim() === env.name ? undefined : `Type ${env.name} exactly`) });
      if (typed?.trim() !== env.name) return;
    } else {
      const ok = await vscode.window.showWarningMessage(`Deploy to ${env.name}?`, { modal: true, detail }, 'Deploy');
      if (ok !== 'Deploy') return;
    }
    const acc = this.helpers.accCommand ?? 'acc';
    const command = `${acc} deploy ${env.branch}${since ? ` --since ${since}` : ''}${plan.confirm ? ' --confirm-production' : ''}`;
    if (this.helpers.run) this.helpers.run(command, project.root, `Deploy ${env.name}`);
    else this.send(project.root, command);
  }

  private compare(n: EnvNode): void {
    if (n.kind !== 'env') return;
    const prod = n.project.config.environments.find((e) => e.type === 'production' || e.protected);
    const base = prod && prod.branch !== n.env.branch ? prod.branch : n.project.config.environments.find((e) => e.default && e.branch !== n.env.branch)?.branch;
    if (!base) return void vscode.window.showInformationMessage('There\'s no other environment to compare with.');
    this.output(n.project.root, `git diff --no-renames --stat ${base}...${n.env.branch}`, `Compare ${n.env.branch} with ${base}`);
  }
}
