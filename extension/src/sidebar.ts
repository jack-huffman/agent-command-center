import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import { MODEL_NAME } from '../../packages/core/src/config.ts';
import type { Hub, Project } from './hub.ts';
import type { AgentSession } from './logic/shared.ts';
import { CLAUDE_EXTENSION, claudeSessionUri, isSessionId, sessionFor } from './logic/agents.ts';
import { nameOf, sessionKey } from './model/shared.ts';
import { type RunResult, runFile } from './run.ts';
import { claudeProjectsDir, savedFolder } from './transcript.ts';

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

/**
 * The sidebar's actions. Task changes always go through acc, so the rules live in one place (D-012). Each
 * area's commands extend it in their own module (D-???), sharing its hub, acc, terminals and helpers.
 */
export class Sidebar {
  readonly hub: Hub;
  readonly acc: Acc;
  readonly log: vscode.LogOutputChannel;
  readonly terminals: Map<string, vscode.Terminal>;
  /** Opens a task's page (D-026). Without it, Details falls back to a plain document. */
  readonly openTicket: ((root: string, key: string) => void) | null;
  readonly helpers: SidebarHelpers;

  constructor(hub: Hub, acc: Acc, log: vscode.LogOutputChannel, openTicket: ((root: string, key: string) => void) | null = null, helpers: SidebarHelpers = {}, terminals = new Map<string, vscode.Terminal>()) {
    this.hub = hub;
    this.acc = acc;
    this.log = log;
    this.openTicket = openTicket;
    this.helpers = helpers;
    this.terminals = terminals;
  }

  // ------------------------------------------------------------ helpers

  protected async pickProject(n?: { project?: Project }): Promise<Project | undefined> {
    if (n?.project) return n.project;
    if (this.hub.projects.length <= 1) return this.hub.projects[0];
    return (await vscode.window.showQuickPick(this.hub.projects.map((p) => ({ label: p.name, description: p.root, p })), { title: 'Which project?' }))?.p;
  }

  protected terminal(name: string, cwd: string): vscode.Terminal {
    const t = this.terminals.get(name);
    if (t && !t.exitStatus) return t;
    const created = vscode.window.createTerminal({ name, cwd, iconPath: new vscode.ThemeIcon('hubot') });
    this.terminals.set(name, created);
    return created;
  }

  /** A command whose output is worth reading but needs no keyboard: in the page when it can be. */
  protected output(cwd: string, command: string, label: string): void {
    if (this.helpers.run) this.helpers.run(command, cwd, label);
    else this.send(cwd, command);
  }

  protected send(cwd: string, command: string, name = 'acc'): void {
    const t = this.terminal(name, cwd);
    t.show();
    t.sendText(command, true);
    this.log.info(`Ran in terminal: ${command}`);
  }

  /** Runs acc, reports what it refused in plain words, and refreshes the tasks. */
  protected async runAcc(project: Project, args: string[], done: (out: any) => string | undefined): Promise<boolean> {
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

  /** A model name a person types, as claude --model takes it. */
  protected async askModelName(title: string): Promise<string | null> {
    const v = await vscode.window.showInputBox({ title, prompt: 'A model alias or full name, as claude --model takes it', validateInput: (v) => (MODEL_NAME.test(v.trim()) ? undefined : 'Letters, digits, dots, dashes, colons and brackets') });
    return v?.trim() || null;
  }

  // ------------------------------------------------------------ open in Claude Code (D-040)

  /**
   * Opens a session's conversation in a Claude Code tab, with its whole history, through Claude Code's
   * own link. A session can't run in two places at once, so one still working in the background is
   * stopped there first, after you say so, and the tab carries on the same conversation.
   */
  async openInClaude(s: AgentSession): Promise<void> {
    if (!isSessionId(s.sessionId)) return void vscode.window.showInformationMessage(`${s.name ?? 'This session'} has no conversation Claude Code can open.`);
    const name = nameOf(this.hub, s);
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
    const live = this.hub.agents.find((a) => a.sessionId === sessionId);
    // The task it builds, by its session: its name no longer looks like a task's id (D-087).
    const task = this.hub.projects.flatMap((p) => this.hub.taskRows(p.root)).find((t) => t.run?.sessionId === sessionId || (!!live && sessionFor(t, [live]) === live));
    const folder = savedFolder(claudeProjectsDir(process.env), sessionId, [s.cwd, task?.run?.worktree, ...this.hub.projects.flatMap((p) => p.worktrees.map((w) => w.path))])
      ?? (live?.pid ? s.cwd : null); // a session that has only just started may not have saved anything yet
    if (!folder) {
      const pick = await vscode.window.showWarningMessage(`Couldn't find where ${name}'s conversation is saved, so Claude Code can't open it.`, 'Watch it here');
      if (pick) this.helpers.watch?.(sessionKey(s));
      return;
    }
    if (live?.kind === 'background' && live.id && live.pid && live.state !== 'done' && live.state !== 'stopped' && live.state !== 'failed') {
      const ok = await vscode.window.showWarningMessage(`Take ${name} over in Claude Code?`, {
        modal: true,
        detail: `It's ${live.state === 'blocked' ? 'waiting for an answer' : 'working'} in the background. A conversation can't run in two places, so acc stops it there, and a Claude Code tab carries on the same conversation, with its whole history. You drive it from the tab.${task?.state === 'running' ? ` Its task stays Running: finish it with acc done ${task.id}, or move it from the page.` : ''}`,
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
}
