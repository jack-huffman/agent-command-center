// The Agents area's VS Code commands (D-099): a session from its row, its page or a row's menu.
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import * as vscode from 'vscode';
import { autoMergeOn, DEFAULT_MODEL, EFFORTS } from '../../packages/core/src/config.ts';
import { agentName, MODEL_CHOICES, stopFinishedPlan } from './logic/agents.ts';
import { EFFORT_WORDS } from './logic/efforts.ts';
import { nameOf, sessionKey } from './model/shared.ts';
import { sessionFolders } from './model/agents.ts';
import { runFile } from './run.ts';
import type { AgentNode } from './nodes.ts';
import type { ExtensionArea } from './area.ts';
import { Sidebar } from './sidebar.ts';
import { agentArgs } from '../../packages/core/src/agents.ts';

/** The Agents area's commands: sessions, and what agents run with. */
class AgentCommands extends Sidebar {
  constructor(from: Sidebar) {
    super(from.hub, from.acc, from.log, from.openTicket, from.helpers, from.terminals);
  }

  register(reg: (id: string, fn: (...args: any[]) => unknown) => void): void {
    reg('acc.agent.new', (n?: AgentNode) => this.newAgent(n));
    reg('acc.agent.watch', (n: AgentNode) => this.watchAgent(n));
    reg('acc.agent.openInClaude', (n: AgentNode) => n?.kind === 'agent' && this.openInClaude(n.session));
    reg('acc.agent.attach', (n: AgentNode) => this.agentTerminal(n, 'attach'));
    // Logs are the activity page now; the terminal is the fallback when there's no page to show.
    reg('acc.agent.logs', (n: AgentNode) => (n?.kind === 'agent' && this.helpers.watch?.(sessionKey(n.session))) || this.agentTerminal(n, 'logs'));
    reg('acc.agent.stop', (n: AgentNode) => this.stopAgent(n));
    reg('acc.agent.openFolder', (n: AgentNode) => n?.kind === 'agent' && vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(n.session.cwd), { forceNewWindow: true }));
    reg('acc.agents.refresh', () => this.hub.loadAgents());
    // With a repo's folder, as a repo's Stop finished on the Agents page sends it, only that repo's (GH-119).
    reg('acc.agents.stopFinished', (repo?: unknown) => this.stopFinished(typeof repo === 'string' ? repo : null));
    reg('acc.agents.configure', (arg?: unknown) => this.configureAgents(arg));
    reg('acc.agents.autonomy', (arg?: unknown) => this.configureAutonomy(arg));
    reg('acc.agents.autoMerge', (arg?: unknown) => this.configureAutoMerge(arg));
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
      { label: '$(symbol-class) Model', description: `${now.model}${now.from.model === 'acc' ? ' (acc\'s default)' : ''}`, key: 'model' as const },
      { label: '$(lightbulb) Effort', description: now.effort ?? 'default', detail: 'How hard it thinks: more effort is slower and uses more of your plan', key: 'effort' as const },
      { label: '$(debug-step-back) Fallback model', description: now.fallbackModel ?? 'none', detail: 'Used when the model is overloaded', key: 'fallback' as const },
      { label: '$(discard) Back to the defaults', key: 'reset' as const },
    ], { title: `${label}: what to change?` });
    if (!what) return;
    // The same models Dispatch with… offers (D-086).
    const models = (current: string | null, none: string) => vscode.window.showQuickPick([
      { label: none, description: undefined as string | undefined, value: null as string | null },
      ...MODEL_CHOICES.map((m) => ({ label: m.name, description: m.about, value: m.name as string | null })),
      { label: 'Another model…', description: 'an alias or a full model name', value: '?' },
    ].map((m) => ({ ...m, picked: m.value === current, description: m.value === current ? `${m.description ?? ''} · now`.replace(/^ · /, '') : m.description })), { title: `${label}: which model?` });
    const args: string[] = [];
    if (what.key === 'model' || what.key === 'fallback') {
      // A model nobody chose is acc's default, and choosing that clears it.
      const pick = await models(what.key === 'model' ? (now.from.model === 'acc' ? null : now.model) : now.fallbackModel, what.key === 'model' ? `acc's default (${DEFAULT_MODEL})` : 'No fallback');
      if (!pick) return;
      let value = pick.value;
      if (value === '?') {
        value = await this.askModelName(`${label}: model name`);
        if (!value) return;
      }
      const flag = what.key === 'model' ? 'model' : 'fallback-model';
      args.push(...(value ? [`--${flag}`, value] : ['--clear', flag]));
    } else if (what.key === 'effort') {
      const pick = await vscode.window.showQuickPick([{ label: 'Default', description: 'Claude Code\'s own', value: null as string | null }, ...EFFORTS.map((e) => ({ label: e, description: EFFORT_WORDS[e], value: e as string | null }))]
        .map((x) => ({ ...x, description: x.value === now.effort ? `${x.description} · now` : x.description })), { title: `${label}: how much effort?` });
      if (!pick) return;
      args.push(...(pick.value ? ['--effort', pick.value] : ['--clear', 'effort']));
    } else {
      args.push('--clear', 'model', '--clear', 'effort', '--clear', 'fallback-model');
    }
    const scope = await vscode.window.showQuickPick([
      { label: '$(device-desktop) This clone only', description: 'git config: nobody else sees it', project: false },
      { label: '$(repo) The project\'s default', description: 'edits the project\'s settings, for you to commit and share', project: true },
    ], { title: `${label}: for whom?` });
    if (!scope) return;
    const ok = await this.runAcc(project, ['agents', 'set', role, ...args, ...(scope.project ? ['--project'] : [])], () => undefined);
    if (ok) {
      await this.hub.loadProjects();
      void vscode.window.showInformationMessage(`${label} changed${scope.project ? ' in the project\'s settings: commit the change to share it' : ' for this clone'}. The next one started uses it.`);
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
    const merges = autoMergeOn(project.config) ? 'merges a reviewed pull request whose checks passed (auto-merge is on)' : 'never merges a pull request';
    const pick = await vscode.window.showQuickPick([
      { label: '$(debug-pause) manual', description: 'Nothing happens on its own', value: 'manual' },
      { label: '$(rocket) review', description: `Autopilot reviews, lands, reworks and resumes once, and merges the base into a conflicting pull request; ${merges}`, value: 'review' },
    ].map((x) => ({ ...x, description: x.value === now ? `${x.description} · now` : x.description })), { title: `${project.name}: what may autopilot do on its own?` });
    if (!pick || pick.value === now) return;
    const ok = await this.runAcc(project, ['agents', 'autonomy', pick.value], () => undefined);
    if (!ok) return;
    await this.hub.loadProjects();
    void vscode.window.showInformationMessage(`Autonomy is ${pick.value}. Changed in the project\'s settings: commit the change to share it.${pick.value === 'review' ? ' Autopilot stays off until you turn it on in the status bar.' : ''}`);
  }

  /**
   * Whether autopilot merges a reviewed pull request whose checks passed (GH-67), changed through acc in
   * .acc/config.json, for the person to commit. acc refuses it in a Salesforce project.
   */
  private async configureAutoMerge(arg: unknown): Promise<void> {
    const project = typeof arg === 'string' ? this.hub.project(arg) : await this.pickProject();
    if (!project) return;
    if (project.config.profile === 'salesforce') return void vscode.window.showInformationMessage(`${project.name} is a Salesforce project, which never auto-merges: a person merges every pull request.`);
    const now = autoMergeOn(project.config) ? 'on' : 'off';
    const protectedEnvs = project.config.environments.filter((e) => e.protected).map((e) => e.name);
    const pick = await vscode.window.showQuickPick([
      { label: '$(circle-slash) off', description: 'A person merges every pull request', value: 'off' },
      { label: '$(git-merge) on', description: `Pull requests whose review and checks passed, with nothing waiting on you, merge in turn through a merge queue${protectedEnvs.length ? `; never into ${protectedEnvs.join(', ')}` : ''}`, value: 'on' },
    ].map((x) => ({ ...x, description: x.value === now ? `${x.description} · now` : x.description })), { title: `${project.name}: may autopilot merge pull requests?` });
    if (!pick || pick.value === now) return;
    const ok = await this.runAcc(project, ['agents', 'auto-merge', pick.value], () => undefined);
    if (!ok) return;
    await this.hub.loadProjects();
    const runs = project.config.autonomy === 'review' ? ' It merges while autopilot is on in the status bar.' : ' Autonomy is manual, so nothing merges until it\'s review.';
    void vscode.window.showInformationMessage(`Auto-merge is ${pick.value}. Changed in the project\'s settings: commit the change to share it.${pick.value === 'on' ? runs : ''}`);
  }

  private watchAgent(n: AgentNode): void {
    if (n?.kind !== 'agent') return;
    if (!this.helpers.watch?.(sessionKey(n.session))) this.agentTerminal(n, 'logs');
  }

  private agentTerminal(n: AgentNode, verb: 'attach' | 'logs'): void {
    if (n?.kind !== 'agent') return;
    const s = n.session;
    if (!s.id) {
      void vscode.window.showInformationMessage(`${s.name ?? 'This session'} is an interactive session in another window or terminal, so there's nothing to attach to here.`, 'Open its folder').then((p) => p && vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(s.cwd), { forceNewWindow: true }));
      return;
    }
    this.send(s.cwd, `claude ${verb} ${s.id}`, `claude: ${nameOf(this.hub, s)}`);
  }

  private async stopAgent(n: AgentNode): Promise<void> {
    if (n?.kind !== 'agent') return;
    const s = n.session;
    const id = s.id;
    if (!id) return;
    const ok = await vscode.window.showWarningMessage(`Stop ${nameOf(this.hub, s)}?`, { modal: true, detail: 'The session stops where it is. Its worktree and transcript are kept, and you can resume it later.' }, 'Stop');
    if (ok !== 'Stop') return;
    const r = await runFile('claude', ['stop', id], s.cwd, process.env, undefined, 30_000);
    if (r.code !== 0) void vscode.window.showWarningMessage(`Couldn't stop it: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
    await this.hub.loadAgents();
  }

  /**
   * Stops every background session whose work is over (D-095): its task is done or has a later run, or its
   * review or analysis is recorded. One list and one confirm. Claude Code is asked again once you've said
   * so, and only what is still finished then is stopped, one at a time. With a repo, only the sessions in it,
   * by the folder rule the Agents page groups them by (GH-119).
   */
  private async stopFinished(repo: string | null = null): Promise<void> {
    const plan = () => {
      const all = stopFinishedPlan(this.hub.agents, (s) => this.hub.tieFor(s), (s) => this.hub.askingFor(s));
      const folders = repo ? sessionFolders(this.hub) : null;
      return folders ? all.filter((s) => folders.get(s.cwd)?.repo?.path === repo) : all;
    };
    await this.hub.loadAgents();
    // claude agents failing lists nothing: say so, rather than that nothing is finished.
    if (this.hub.agentsError) return void vscode.window.showWarningMessage(`Couldn't list Claude Code's sessions: ${this.hub.agentsError}`);
    const first = plan();
    if (!first.length) return void vscode.window.showInformationMessage('No finished sessions to stop.');
    const folders = sessionFolders(this.hub, first.map((s) => s.cwd));
    const list = first.map((s) => `${nameOf(this.hub, s)} · ${folders.get(s.cwd)?.label ?? s.cwd}`).join('\n');
    const one = first.length === 1;
    const ok = await vscode.window.showWarningMessage(`Stop ${one ? '1 finished session' : `${first.length} finished sessions`}?`, {
      modal: true,
      detail: `${list}\n\n${one ? 'Its task is done or has a later run, or its review or analysis is recorded.' : 'Their tasks are done or have a later run, or their review or analysis is recorded.'} Transcripts and worktrees are kept.`,
    }, 'Stop');
    if (ok !== 'Stop') return;
    await this.hub.loadAgents();
    const still = new Set(plan().map((s) => s.id));
    const stopped: string[] = [];
    const failed: string[] = [];
    let left = 0;
    for (const s of first) {
      if (!still.has(s.id)) { left++; continue; }
      const name = nameOf(this.hub, s);
      const r = await runFile('claude', ['stop', s.id!], existsSync(s.cwd) ? s.cwd : (this.hub.projects[0]?.root ?? this.hub.home), process.env, undefined, 30_000);
      if (r.code === 0) stopped.push(name);
      else failed.push(`${name}: ${(r.stderr || r.stdout).trim().split('\n')[0] || `claude stop exited ${r.code}`}`);
    }
    await this.hub.loadAgents();
    const said = [
      stopped.length ? `Stopped ${stopped.length === 1 ? stopped[0] : `${stopped.length} finished sessions`}.` : '',
      left ? `${left === 1 ? '1 was' : `${left} were`} left: no longer finished.` : '',
    ].filter(Boolean).join(' ');
    // Each failure in the log; the notice says how many, in one line (D-119).
    for (const f of failed) this.log.warn(`Stop finished sessions: ${f}`);
    if (failed.length) void vscode.window.showWarningMessage(`${said ? `${said} ` : ''}Couldn't stop ${failed.length === 1 ? 'one' : `${failed.length} of ${first.length}`}: ${failed.length === 1 ? failed[0] : 'the Command Center\'s log has each one\'s reason.'}`);
    else if (said) void vscode.window.showInformationMessage(said);
  }
}

export const area: ExtensionArea = {
  register(x) {
    new AgentCommands(x.sidebar).register(x.regNode);
  },
};
