// The Tasks area's VS Code commands (D-099): a task from its card, its page or a row's menu.
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { allowedMoves, DISPLAY, findRule, type State } from '../../packages/core/src/ledger.ts';
import { autoMergeFor } from '../../packages/core/src/config.ts';
import { run as runSync } from '../../packages/core/src/exec.ts';
import { repoPaths } from '../../packages/core/src/paths.ts';
import { receiptHooks } from '../../packages/core/src/receipts.ts';
import { endResume } from '../../packages/core/src/resume.ts';
import { effortDroppedWords } from '../../packages/core/src/efforts.ts';
import type { Project } from './hub.ts';
import { dispatchModelArgs, dispatchModelItems, displayName, sessionFor } from './logic/agents.ts';
import { dispatchEffortArgs, dispatchEffortItems, noEffortArgs } from './logic/efforts.ts';
import { anywayQuestion, type HeldAsk, heldAskDue, heldAsked, heldAskKey, heldDue, landMessage, sizeLine, startedNotice, waitLine, waitQuestion, waitsForFiles } from './logic/tasks.ts';
import { laneMove } from './model/tasks.ts';
import { sessionKey } from './model/shared.ts';
import { accRunner, runFile } from './run.ts';
import type { TaskNode } from './nodes.ts';
import type { ExtensionArea } from './area.ts';
import { Sidebar } from './sidebar.ts';

/** The Tasks area's commands: adding, moving, dispatching, reviewing and landing tasks, all through acc. */
class TaskCommands extends Sidebar {
  constructor(from: Sidebar) {
    super(from.hub, from.acc, from.log, from.openTicket, from.helpers, from.terminals);
  }

  register(reg: (id: string, fn: (...args: any[]) => unknown) => void): void {
    reg('acc.task.add', (n?: TaskNode) => this.addTask(n));
    reg('acc.task.importGithub', (n?: TaskNode) => this.importGithub(n));
    // Jira, connected on the Command Center's Connect page (site, sign-in, project, epic, board), never by editing a file.
    reg('acc.task.importJira', (n?: TaskNode) => {
      const p = (typeof n === 'object' && n?.project) || this.hub.projects[0];
      if (p?.config.trackers.some((t) => t.kind === 'jira')) return vscode.commands.executeCommand('acc.open.tasks');
      return vscode.commands.executeCommand('acc.trackers.add', { root: p?.root, kind: 'jira' });
    });
    reg('acc.task.intake', (n?: TaskNode) => this.intake(n));
    reg('acc.task.openPacket', (n: TaskNode) => this.openPacket(n));
    reg('acc.task.show', (n: TaskNode) => this.showTask(n));
    reg('acc.task.move', (n: TaskNode) => this.moveTask(n));
    reg('acc.task.block', (n: TaskNode) => this.setState(n, 'blocked'));
    reg('acc.task.unblock', (n: TaskNode) => this.setState(n, 'todo'));
    reg('acc.task.openTicket', (n: TaskNode) => n?.kind === 'task' && n.task.source.url && vscode.env.openExternal(vscode.Uri.parse(n.task.source.url)));
    reg('acc.task.copyId', (n: TaskNode) => n?.kind === 'task' && vscode.env.clipboard.writeText(n.task.id));
    reg('acc.tasks.refresh', () => this.hub.loadTasks(true));
    reg('acc.task.dispatch', (n: TaskNode) => this.dispatchTask(n));
    reg('acc.task.dispatchAnyway', (n: TaskNode) => this.dispatchAnyway(n));
    reg('acc.task.stopWaiting', (n: TaskNode) => this.stopWaiting(n));
    reg('acc.task.dispatchWith', (n: TaskNode) => this.dispatchWith(n));
    reg('acc.task.watch', (n: TaskNode) => this.watchTask(n));
    reg('acc.task.resume', (n: TaskNode) => this.resumeTask(n));
    reg('acc.task.review', (n: TaskNode) => this.reviewTask(n));
    reg('acc.task.watchReview', (n: TaskNode) => this.watchReview(n));
    reg('acc.task.analyze', (n: TaskNode) => this.analyzeTask(n));
    reg('acc.task.watchAnalysis', (n: TaskNode) => this.watchAnalysis(n));
    reg('acc.task.land', (n: TaskNode) => this.landTask(n));
    reg('acc.task.openPr', (n: TaskNode) => n?.kind === 'task' && n.task.pr && vscode.env.openExternal(vscode.Uri.parse(n.task.pr.url)));
    // A terminal is named for the agent it attaches to (D-087).
    reg('acc.task.attach', (n: TaskNode) => n?.kind === 'task' && n.task.run?.bgId && this.send(n.task.run.worktree ?? n.project.root, `claude attach ${n.task.run.bgId}`, `claude: ${displayName(undefined, n.task)}`));
    reg('acc.task.openWorktree', (n: TaskNode) => n?.kind === 'task' && n.task.run?.worktree && vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(n.task.run.worktree), { forceNewWindow: true }));
    reg('acc.task.abandon', (n: TaskNode) => this.abandonTask(n));
    reg('acc.task.cleanup', (n: TaskNode) => this.cleanupTask(n));
    reg('acc.task.openInClaude', (n: TaskNode) => {
      if (n?.kind !== 'task') return;
      const s = sessionFor(n.task, this.hub.agents);
      const id = s?.sessionId ?? n.task.run?.sessionId;
      if (!id) return void vscode.window.showInformationMessage(`${n.task.id} has no agent session to open.`);
      return this.openInClaude(s ?? { cwd: n.task.run?.worktree ?? n.project.root, kind: 'background', startedAt: Date.now(), sessionId: id, name: displayName(undefined, n.task) });
    });
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
      ...(jira ? [{ label: '$(issues) Track a Jira ticket', detail: 'Its board is on the Tasks tab: choose Track on its card, or Track in acc on its page.', go: () => vscode.commands.executeCommand('acc.open.tasks') }]
        : [{ label: '$(plug) Connect Jira', detail: 'On the Connect page: sign in, then pick the project, epic and board. Its tickets show on the Tasks tab.', go: () => vscode.commands.executeCommand('acc.trackers.add', { root: project.root, kind: 'jira' }) }]),
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
    if (n?.kind !== 'task') return;
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
      // One that would wait for others' files asks that instead (D-093).
      if (waitsForFiles(task) && task.files) { await this.dispatchTask(n); await this.hub.loadTasks(true); return; }
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
    if (n?.kind !== 'task') return;
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
    if (n?.kind !== 'task') return;
    let reason: string | undefined;
    if (askReason) {
      reason = await vscode.window.showInputBox({ title: `${n.task.id} → ${DISPLAY[to].label}`, prompt: 'Why? This is recorded in the task\'s history.', validateInput: (v) => (v.trim() ? undefined : 'A reason is required.') });
      if (!reason) return;
    }
    await this.runAcc(n.project, ['set', n.task.id, to, ...(reason ? ['--reason', reason] : [])], () => `${n.task.id} → ${DISPLAY[to].label}.`);
  }

  /**
   * Dispatch with…: the model for this task's builder, then its effort, picked by a person (D-086, D-???).
   * The analysis's size is shown beside the models to weigh the choice by; it picks nothing. Only the levels
   * the model takes are offered, and none for a model that takes none, which drops a level picked for the
   * task and says so. A re-dispatch and a resume keep both.
   */
  private async dispatchWith(n: TaskNode): Promise<void> {
    if (n?.kind !== 'task') return;
    const { project, task } = n;
    const verb = task.state === 'rework' ? 'Re-dispatch' : 'Dispatch';
    const pick = await vscode.window.showQuickPick(dispatchModelItems(task, project.agents.builder), { title: `${verb} ${task.id} with which model?`, placeHolder: sizeLine(task) });
    if (!pick) return;
    const model = pick.value ?? await this.askModelName(`${verb} ${task.id}: model name`);
    if (!model) return;
    const efforts = dispatchEffortItems(task, project.agents.builder, model);
    let effort: string[] = [];
    let dropped: string | null = null;
    if (efforts.length) {
      const level = await vscode.window.showQuickPick(efforts, { title: `${task.id} on ${model}: which effort?`, placeHolder: 'Higher thinks harder: slower, uses more' });
      if (!level) return;
      effort = dispatchEffortArgs(task, project.agents.builder, level.value);
    } else {
      ({ args: effort, dropped } = noEffortArgs(task));
    }
    await this.dispatchTask(n, [...dispatchModelArgs(task, project.agents.builder, model), ...effort], false, dropped ? effortDroppedWords(dropped, model) : undefined);
  }

  /**
   * Dispatch (D-009, D-013): worktree, setup, packet, background session, task → Running. A first dispatch
   * that would wait for others' files asks first, naming each task and its files (D-093): wait, and it
   * starts on its own, or dispatch anyway. acc decides, and a hold it records is said so. `extra` is
   * acc dispatch's other arguments, such as the model Dispatch with… picked (D-086). `dropped` says a level
   * picked for the task was dropped (D-???), as acc says it when it drops one itself.
   */
  private async dispatchTask(n: TaskNode, extra: string[] = [], anyway = false, dropped?: string): Promise<void> {
    if (n?.kind !== 'task') return;
    const { project, task } = n;
    if (!anyway && task.state === 'todo' && waitsForFiles(task) && task.files) {
      const q = waitQuestion({ id: task.id, files: task.files });
      const pick = await vscode.window.showInformationMessage(q.message, { modal: true, detail: q.detail }, q.wait, 'Dispatch anyway');
      if (!pick) return;
      anyway = pick === 'Dispatch anyway';
    }
    type Out = { held?: boolean; waitsFor?: { task: string; files: string[] }[]; first?: string[]; worktree?: string; bgId?: string | null; reused?: boolean; name?: string; effortDropped?: string; task?: { run?: { model?: string } | null; held?: { model?: string } | null } };
    let result: Out | null = null;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Dispatching ${task.id}`, cancellable: false }, async (progress) => {
      progress.report({ message: 'creating the worktree and starting the agent…' });
      await this.runAcc(project, ['dispatch', task.id, ...extra, ...(anyway ? ['--anyway'] : [])], (out) => {
        result = out;
        return undefined;
      });
    });
    if (!result) return;
    const r = result as Out;
    const said = dropped ?? (r.effortDropped ? effortDroppedWords(r.effortDropped, r.task?.run?.model ?? r.task?.held?.model ?? 'the model') : null);
    const also = said ? ` ${said}` : '';
    if (r.held) {
      const pick = await vscode.window.showInformationMessage(`${task.id} ${waitLine(r.waitsFor ?? [], false, r.first ?? []).replace(/^Waits/, 'waits')}. It starts on its own once they're free, or once nothing else is ready.${also}`, 'Dispatch anyway');
      // What acc just reported it waits for, which the board may not have foreseen, so the confirmation names it.
      if (pick) await this.dispatchAnyway(n, extra, r.waitsFor);
      return;
    }
    await Promise.all([this.hub.loadAgents(), this.hub.loadWorktrees()]);
    const where = r.worktree ? basename(r.worktree) : 'its worktree';
    const pick = await vscode.window.showInformationMessage(
      `${task.id} is running: an agent is working in ${where}${r.reused ? ' (reused)' : ''}. It will finish with acc done, or block if it needs you.${also}`,
      ...(r.bgId ? ['Watch', 'Open in Claude Code'] : []), 'Open worktree');
    const terminal = `claude: ${r.name ?? task.id}`;
    if (pick === 'Watch' && r.bgId && !this.helpers.watch?.(r.bgId)) this.send(r.worktree ?? project.root, `claude attach ${r.bgId}`, terminal);
    if (pick === 'Open in Claude Code' && r.bgId) {
      const s = this.hub.agents.find((a) => a.id === r.bgId);
      if (s) await this.openInClaude(s);
      else this.send(r.worktree ?? project.root, `claude attach ${r.bgId}`, terminal);
    }
    if (pick === 'Open worktree' && r.worktree) await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(r.worktree), { forceNewWindow: true });
  }

  /**
   * Dispatch anyway (D-093): a task that waits for others' files starts now, once a person confirms, named
   * overlap and all. `extra` keeps what the Dispatch it follows on from was given, such as a model (D-086).
   * `shares`, when acc has just said what it waits for, names the overlap over the board's guess.
   */
  private async dispatchAnyway(n: TaskNode, extra: string[] = [], shares?: { task: string; files: string[] }[]): Promise<void> {
    if (n?.kind !== 'task') return;
    const row = this.hub.taskRows(n.project.root).find((t) => t.id === n.task.id) ?? n.task;
    const q = anywayQuestion(shares?.length ? { id: row.id, files: { shares } } : row);
    const ok = await vscode.window.showWarningMessage(q.message, { modal: true, detail: q.detail }, 'Dispatch anyway');
    if (ok) await this.dispatchTask({ ...n, task: row }, extra, true);
  }

  /** It stops waiting for others' files, and stays to do (D-093). */
  private async stopWaiting(n: TaskNode): Promise<void> {
    if (n?.kind !== 'task') return;
    await this.runAcc(n.project, ['dispatch', n.task.id, '--stop-waiting'], () => `${n.task.id} stopped waiting. It stays in Ready, and nothing starts it on its own.`);
  }

  /** Stops the task's agent and moves it back to To do. The worktree and its commits are kept. */
  private async abandonTask(n: TaskNode): Promise<void> {
    if (n?.kind !== 'task') return;
    const reason = await vscode.window.showInputBox({ title: `Abandon ${n.task.id}?`, prompt: 'Why? Its agent stops, the task goes back to To do, and the worktree and commits are kept.', validateInput: (v) => (v.trim() ? undefined : 'A reason is required.') });
    if (!reason) return;
    const session = this.hub.agents.find((s) => s.id && s.id === n.task.run?.bgId);
    if (session?.id && session.pid) await runFile('claude', ['stop', session.id], n.project.root, process.env, undefined, 30_000);
    // A resumed builder isn't a background session: its own process is ended (D-067).
    try {
      endResume(repoPaths(n.project.root, runSync), n.task.id);
    } catch (e) {
      this.log.warn(`Couldn't end ${n.task.id}'s resume: ${(e as Error).message}`);
    }
    await this.runAcc(n.project, ['set', n.task.id, 'todo', '--reason', reason], () => `${n.task.id} is back in To do. Its worktree is kept.`);
    await this.hub.loadAgents();
  }

  /**
   * Carries a stopped builder on in its own session, in its worktree (D-067): acc resume, which starts it
   * and returns. It's told it was cut off, and finishes with acc done or blocks.
   */
  private async resumeTask(n: TaskNode): Promise<void> {
    if (n?.kind !== 'task') return;
    const { project, task } = n;
    let resumed = false;
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Resuming ${task.id}`, cancellable: false }, async (progress) => {
      progress.report({ message: 'carrying its builder on in its worktree…' });
      resumed = await this.runAcc(project, ['resume', task.id], () => undefined);
    });
    if (!resumed) return;
    await this.hub.loadAgents();
    const pick = await vscode.window.showInformationMessage(`${task.id} is resumed: its builder carries on in its worktree, told its last turn ended early. It finishes with acc done, or blocks.`, 'Watch');
    if (pick === 'Watch') this.watchTask(n);
  }

  private async cleanupTask(n: TaskNode): Promise<void> {
    if (n?.kind !== 'task' || !n.task.run?.worktree) return;
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
    const { sessionId, name } = n.task.reviewing;
    const root = n.project.root;
    const id = n.task.id;
    const stillReviewing = () => !!this.hub.taskRows(root).find((t) => t.id === id)?.reviewing;
    // Its page keeps the name acc gave it (D-087), after the review is over too.
    this.helpers.watch?.(sessionId, { cwd: n.task.run.worktree, kind: 'background', startedAt: Date.now(), sessionId, name: name ?? `Review ${id}` }, stillReviewing);
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
    const { sessionId, name } = n.task.analyzing;
    const root = n.project.root;
    const id = n.task.id;
    const stillAnalyzing = () => !!this.hub.taskRows(root).find((t) => t.id === id)?.analyzing;
    this.helpers.watch?.(sessionId, { cwd: root, kind: 'background', startedAt: Date.now(), sessionId, name: name ?? `Analysis ${id}` }, stillAnalyzing);
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
      detail: `${again ? 'Pushes the reviewed commits to' : 'Pushes'} ${task.run?.branch ?? 'its branch'} to ${gh.repo} as ${gh.account}${again ? '.' : `, and opens a pull request into ${task.environment}.`} ${autoMergeFor(project.config, task.environment) ? 'Auto-merge is on: with autopilot running, it merges once its checks pass on GitHub and nothing waits on you. You can merge it first, or ask for changes to hold it.' : 'acc never merges it: a person does, on GitHub.'}`,
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

  /** A task's agent: its activity page, found by the session the task records. */
  private watchTask(n: TaskNode): void {
    if (n?.kind !== 'task') return;
    const session = sessionFor(n.task, this.hub.agents);
    if (session && this.helpers.watch?.(sessionKey(session))) return;
    // Its session has ended: its transcript still says what it did.
    const run = n.task.run;
    const startedAt = Date.parse(this.hub.ledger(n.project.root)?.tasks.find((t) => t.id === n.task.id)?.run?.startedAt ?? '') || Date.now();
    if (run?.sessionId && run.worktree && this.helpers.watch?.(run.sessionId, { cwd: run.worktree, kind: 'background', startedAt, sessionId: run.sessionId, name: displayName(undefined, n.task) })) return;
    void vscode.window.showInformationMessage(`${n.task.id} has no agent session to show.`, ...(n.task.run?.worktree ? ['Open worktree'] : []))
      .then((p) => p && n.task.run?.worktree && vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(n.task.run.worktree), { forceNewWindow: true }));
  }
}


export const area: ExtensionArea = {
  register({ sidebar, regNode, hub, setup, accScript, accSays, resolve, receive }) {
    const tasks = new TaskCommands(sidebar);
    tasks.register(regNode);
    // A task's card dropped in a lane of the agent board (D-041).
    receive('move-task', (m) => { const p = hub.project(m.project); if (p) void tasks.moveToLane(p, m.task, m.to); });

    // A task a person dispatched that waits for others' files starts on its own once it may (D-093), at any
    // autonomy: the Dispatch click was the consent. acc decides and claims it, so autopilot or another window
    // starting it too is harmless. Asked only when the board says one may go, at most every 30 seconds a
    // project, and less often, up to every 10 minutes, while acc keeps saying the same tasks wait.
    const startingHeld = new Set<string>();
    const heldAsks = new Map<string, HeldAsk>();
    const startHeld = async () => {
      for (const p of hub.projects) {
        const rows = hub.taskRows(p.root);
        const due = heldDue(rows);
        if (!due.length || startingHeld.has(p.root)) continue;
        const key = heldAskKey(rows, due);
        const last = heldAsks.get(p.root);
        if (!heldAskDue(last, key, Date.now())) continue;
        startingHeld.add(p.root);
        // acc couldn't say: as if it kept them all waiting.
        heldAsks.set(p.root, heldAsked(last, key, Date.now(), due, due));
        try {
          const r = await accRunner(accScript)(['dispatch', '--held', '--json'], p.root);
          if (r.code !== 0) { setup.log.warn(`acc dispatch --held in ${p.name}: ${accSays(r)}`); continue; }
          const out = JSON.parse(r.stdout) as { started: { task: string; waitedFor: string[]; shares: { task: string; files: string[] }[] }[]; failed: { task: string; reason: string }[]; waiting: { task: string }[] };
          heldAsks.set(p.root, heldAsked(last, key, Date.now(), due, out.waiting.map((w) => w.task)));
          for (const s of out.started) {
            void vscode.window.showInformationMessage(startedNotice(`${s.task} started`, s), 'Watch').then((pick) => pick && resolve('acc.task.watch', { project: p.root, task: s.task }));
          }
          for (const f of out.failed) {
            void vscode.window.showWarningMessage(`${f.task} couldn't start: ${f.reason}`, 'Dispatch anyway').then((pick) => pick && resolve('acc.task.dispatchAnyway', { project: p.root, task: f.task }));
          }
        } catch (e) {
          setup.log.warn(`acc dispatch --held in ${p.name}: ${(e as Error).message}`);
        } finally {
          startingHeld.delete(p.root);
          void hub.loadTasks(true);
        }
      }
    };
    hub.onDidChange((part) => { if (part === 'tasks' || part === 'worktrees') void startHeld(); });
  },
};
