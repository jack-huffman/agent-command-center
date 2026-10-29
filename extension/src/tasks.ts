// The Tasks area's VS Code commands (D-099): a task from its card, its page or a row's menu.
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { allowedMoves, DISPLAY, findRule, type State } from '../../packages/core/src/ledger.ts';
import { autoMergeFor } from '../../packages/core/src/config.ts';
import { run as runSync } from '../../packages/core/src/exec.ts';
import { repoPaths } from '../../packages/core/src/paths.ts';
import { receiptHooks } from '../../packages/core/src/receipts.ts';
import { endResume } from '../../packages/core/src/resume.ts';
import { effortDroppedWords } from '../../packages/core/src/efforts.ts';
import type { Hub, Project } from './hub.ts';
import type { Trackers } from './trackers.ts';
import { displayName, sessionFor } from './logic/agents.ts';
import { newestVerdictText, readReviewRun } from './logic/dock-review.ts';
import { type PlanTicketHost, planTicketFolder } from './logic/plan-ticket.ts';
import { projectTracker, readProjectTicket } from './logic/project-ticket.ts';
import { inProcessWords } from './logic/processes.ts';
import type { RanAnswer } from './logic/ran.ts';
import { shq } from './logic/shared.ts';
import { reasonInWords } from './logic/relayed.ts';
import { anywayQuestion, type HeldAsk, heldAskDue, heldAsked, heldAskKey, heldDue, landMessage, startedNotice, waitLine, waitQuestion, waitsForFiles } from './logic/tasks.ts';
import { dispatchChoiceArgs, type Message as SheetGo, SHEET_COMMANDS } from './model/dispatch-sheet.ts';
import { openSheet, type SheetAsk, sheetInput } from './dispatch-sheet.ts';
import { editRefusal } from '../../packages/core/src/edit.ts';
import { dispatchAgainOff } from './model/cards.ts';
import { type Message as TaskSheetMessage, openTaskSheet, TASK_SHEET_DONE, TASK_SHEET_ROWS, taskSheetArgs, taskSheetInput } from './model/task-sheet.ts';
import type { TicketEdits } from './ticket-edits.ts';
import type { TicketPanels } from './ticket.ts';
import { verdictFrom } from './model/dock-review.ts';
import { laneMove } from './model/tasks.ts';
import { sessionKey } from './model/shared.ts';
import { accRunner, runFile } from './run.ts';
import type { TaskNode } from './nodes.ts';
import type { ExtensionArea } from './area.ts';
import { Sidebar } from './sidebar.ts';
import { sheetDress } from './criteria.ts';
import { WORDS } from '../webview/plain-words.ts';

/** The button that starts a task though it waits for others' files (D-093). */
const ANYWAY = `${WORDS.buildIt} anyway`;

/** The Tasks area's commands: adding, moving, dispatching, reviewing and landing tasks, all through acc. */
export class TaskCommands extends Sidebar {
  /** Opens Dispatch's sheet over the Command Center (D-168): false when the task isn't there. */
  private readonly sheet: (root: string, id: string, ask?: SheetAsk) => boolean;

  /** Opens the task sheet (T-74) over the Command Center, for a new task or to edit one: false when it isn't there to open. */
  private readonly taskSheet: (root: string, id: string | null) => boolean;

  /** A tracker task's ticket, changed from the sheet where the project allows edits (T-80). */
  private readonly edits: TicketEdits | null;

  /** Reads a tracker task's whole ticket for Make a plan (T-110). */
  private readonly planTicket: PlanTicketHost | null;

  /** The task pages (T-111): a plan's conversation to open, and the plans being made from this window. Set by the area. */
  tickets: Pick<TicketPanels, 'conversation' | 'making'> | null = null;

  constructor(from: Sidebar, sheet: (root: string, id: string, ask?: SheetAsk) => boolean, taskSheet: (root: string, id: string | null) => boolean, edits: TicketEdits | null = null, planTicket: PlanTicketHost | null = null) {
    super(from.hub, from.acc, from.log, from.openTicket, from.helpers, from.terminals);
    this.sheet = sheet;
    this.taskSheet = taskSheet;
    this.edits = edits;
    this.planTicket = planTicket;
  }

  register(reg: (id: string, fn: (...args: any[]) => unknown) => void): void {
    reg('acc.task.add', (n?: TaskNode) => this.addTask(n));
    reg('acc.task.edit', (n: TaskNode) => this.editTask(n));
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
    // Each opens Dispatch's sheet (D-168). Dispatch with… and Dispatch to the cloud are kept for one release, so a key binding still works.
    reg('acc.task.dispatch', (n: TaskNode) => this.ask(n));
    reg('acc.task.dispatchAnyway', (n: TaskNode) => this.ask(n, { anyway: true }));
    reg('acc.task.stopWaiting', (n: TaskNode) => this.stopWaiting(n));
    reg('acc.task.dispatchAgain', (n: TaskNode) => this.dispatchAgain(n));
    reg('acc.task.dispatchWith', (n: TaskNode) => this.ask(n));
    reg('acc.task.dispatchCloud', (n: TaskNode) => this.ask(n, { where: 'cloud' }));
    reg('acc.task.watch', (n: TaskNode) => this.watchTask(n));
    reg('acc.task.resume', (n: TaskNode) => this.resumeTask(n));
    reg('acc.task.review', (n: TaskNode) => this.reviewTask(n));
    // A review on this Mac, whatever the project's setting says (T-86): the way on when a cloud review needs you.
    reg('acc.task.reviewLocal', (n: TaskNode) => this.reviewTask(n, true));
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

  /** Opens the task sheet for a new task (T-74): a title, a description in Markdown, its dependencies, environment and labels. */
  private async addTask(n?: TaskNode): Promise<void> {
    const project = await this.pickProject(n);
    if (!project) return void vscode.window.showInformationMessage('Onboard a project first: Agent Command Center: Onboard this project.');
    this.taskSheet(project.root, null);
  }

  /** Opens the task sheet filled in with a task (T-74); one that can't be edited now says why, and one that has gone says so. */
  private editTask(n: TaskNode): void {
    if (n?.kind !== 'task') return;
    const why = editRefusal(n.task as { state: State });
    if (why) return void vscode.window.showInformationMessage(`${n.task.id} can't be edited now. ${why}`);
    if (!this.taskSheet(n.project.root, n.task.id)) void vscode.window.showInformationMessage(`${n.task.id} isn't in ${n.project.name}'s tasks any more.`);
  }

  /**
   * The task sheet's Add task or Save (T-74): acc add, or acc edit with the fields that changed, worked out
   * from the task as it is now. An edit that changes nothing runs nothing; a task gone since says so.
   * Where the sheet holds its ticket's text (T-80), that goes to the ticket first: a change made there
   * since the sheet opened, or a failed write, stops Save before acc changes anything, and the sheet keeps
   * what the person wrote. `say` tells the page that sent it how it went.
   */
  async saveSheet(m: Extract<TaskSheetMessage, { type: 'task-sheet-go' }>, say: (msg: Record<string, unknown>) => void = () => {}): Promise<void> {
    const done = (r: Record<string, unknown>) => say({ type: TASK_SHEET_DONE, project: m.project, task: m.task ?? null, ...r });
    const project = this.hub.project(m.project);
    const i = project ? taskSheetInput(this.hub, m.project, m.task ?? null) : null;
    if (!project || !i) {
      const why = m.task ? `${m.task} isn't there to edit any more.` : 'That project isn\'t open any more.';
      void vscode.window.showInformationMessage(why);
      return done({ ok: false, error: why });
    }
    let wrote = false;
    if (m.base && m.task) {
      const r = this.edits ? await this.edits.saveText(m.project, m.task, m.base, { title: m.title, markdown: m.brief }) : { ok: false as const, error: 'This window can\'t change tickets.' };
      if (!r.ok) return done(r);
      wrote = r.wrote;
    }
    // Written to the ticket, the task was refreshed from it, so acc edit works from the task as it is now.
    const now = (wrote && taskSheetInput(this.hub, m.project, m.task ?? null)) || i;
    const args = taskSheetArgs(now, m);
    if (!args.length) {
      void vscode.window.showInformationMessage(wrote ? `Saved ${m.task} to its ticket.` : `Nothing changed in ${m.task}.`);
      return done({ ok: true });
    }
    const ok = await this.runAcc(project, args, (out) => (m.task ? `Saved ${m.task}${wrote ? ' and its ticket' : ''}.` : out?.added?.length ? `Added ${out.added.join(', ')}.` : undefined));
    done(ok ? { ok: true } : { ok: false, error: wrote ? 'Its ticket was saved, but the rest wasn\'t: the message says why.' : 'It wasn\'t saved: the message says why.' });
  }

  /** Change on the sheet's status, assignee or labels (T-80): the ticket page's quick pick, then the sheet's rows as the ticket has them now. */
  async sheetField(m: Extract<TaskSheetMessage, { type: 'task-sheet-field' }>, say: (msg: Record<string, unknown>) => void): Promise<void> {
    const r = this.edits ? await this.edits.changeField(m.project, m.task, m.field) : { ok: false as const, error: 'This window can\'t change tickets.' };
    say({ type: TASK_SHEET_ROWS, project: m.project, task: m.task, field: m.field, ...r });
  }

  private async importGithub(n?: TaskNode): Promise<void> {
    const project = await this.pickProject(n);
    if (!project) return;
    if (!project.config.github) return void vscode.window.showWarningMessage(`${project.name} names no GitHub repo in its settings.`);
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
      { label: '$(add) Write a task', detail: 'A title and details, kept by the Command Center.', go: () => this.addTask(node) },
      ...(project.config.github ? [{ label: '$(github) Import GitHub issues', description: project.config.github.repo, detail: 'Adds a task for each open issue, and refreshes the ones already here.', go: () => this.importGithub(node) }] : []),
      ...(jira ? [{ label: '$(issues) Add a Jira ticket to my work', detail: 'Its board is on the Tasks tab: choose Add to my work on its card, or on its page.', go: () => vscode.commands.executeCommand('acc.open.tasks') }]
        : [{ label: '$(plug) Connect Jira', detail: 'On the Connect page: sign in, then pick the project, epic and board. Its tickets show on the Tasks tab.', go: () => vscode.commands.executeCommand('acc.trackers.add', { root: project.root, kind: 'jira' }) }]),
    ];
    const pick = await vscode.window.showQuickPick(items, { title: `New work for ${project.name}` });
    await pick?.go();
  }

  /** The instructions acc wrote for the task's builder when it dispatched it. */
  private async openPacket(n: TaskNode): Promise<void> {
    if (n?.kind !== 'task') return;
    const file = vscode.Uri.file(join(dirname(n.project.ledgerPath), 'packets', `${n.task.id}.md`));
    if (!existsSync(file.fsPath)) return void vscode.window.showInformationMessage(`${n.task.id} has no instructions yet. They're written when the task is built.`);
    try {
      await vscode.commands.executeCommand('markdown.showPreview', file);
    } catch {
      await vscode.window.showTextDocument(file, { preview: true });
    }
  }

  private async showTask(n: TaskNode): Promise<void> {
    if (n?.kind !== 'task') return;
    if (this.openTicket) return this.openTicket(n.project.root, n.task.id, n.part);
    const ledger = this.hub.ledger(n.project.root);
    const t = ledger?.tasks.find((x) => x.id === n.task.id);
    if (!t) return;
    const lines = [
      `# ${t.id}: ${t.title}`, '',
      `**${DISPLAY[n.task.display].label}** · environment \`${t.environment}\` · ${t.source.kind}${t.source.url ? ` · [ticket](${t.source.url})` : ''}`, '',
      t.deps.length ? `Depends on: ${t.deps.join(', ')}\n` : '',
      t.blocker ? `> Blocked: ${reasonInWords(t.blocker)}\n` : '',
      t.brief || '_No details._', '',
      '## History', '',
      ...t.history.map((h) => `- ${h.at.replace('T', ' ').slice(0, 16)}: ${h.from ?? '–'} → **${h.to}** by ${h.by}${h.reason ? `: ${reasonInWords(h.reason)}` : ''}${h.override ? ' (override)' : ''}`),
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
      // Dropped in Running, it asks as Dispatch does, in its sheet (D-168). The card goes back to its lane
      // meanwhile, and moves once the task runs.
      this.ask(n);
      await this.hub.loadTasks(true);
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

  /** Opens Dispatch's sheet for a task (D-168); one that has gone from the project's tasks is said so. */
  private ask(n: TaskNode, ask: SheetAsk = {}): void {
    if (n?.kind !== 'task') return;
    if (!this.sheet(n.project.root, n.task.id, ask)) void vscode.window.showInformationMessage(`${n.task.id} isn't in ${n.project.name}'s tasks any more.`);
  }

  /**
   * The sheet's Dispatch (D-168): acc dispatch with the arguments for what was chosen, worked out from the
   * task as it is now. A task that has gone since the sheet opened is said so.
   */
  async go(m: SheetGo): Promise<void> {
    const project = this.hub.project(m.project);
    const i = project ? sheetInput(this.hub, m.project, m.task) : null;
    if (!project || !i) return void vscode.window.showInformationMessage(`${m.task} isn't there to dispatch any more.`);
    const { args, dropped } = dispatchChoiceArgs(i, { model: m.model, effort: m.effort, where: m.where });
    const task = this.hub.taskRows(m.project).find((t) => t.id === m.task)!;
    await this.dispatchTask({ kind: 'task', project, task }, args, m.anyway === true, dropped ?? undefined);
  }

  /**
   * Dispatch (D-009, D-013): worktree, setup, packet, background session, task → Running. A first dispatch
   * that would wait for others' files asks first, naming each task and its files (D-093): wait, and it
   * starts on its own, or dispatch anyway. acc decides, and a hold it records is said so. `extra` is
   * acc dispatch's other arguments: the model, effort and place picked in the sheet (D-168). `dropped`
   * says a level picked for the task was dropped (D-128), as acc says it when it drops one itself. In the
   * cloud (GH-69), it says so, and offers its session on claude.ai.
   */
  private async dispatchTask(n: TaskNode, extra: string[] = [], anyway = false, dropped?: string): Promise<void> {
    if (n?.kind !== 'task') return;
    const { project, task } = n;
    if (!anyway && task.state === 'todo' && waitsForFiles(task) && task.files) {
      const q = waitQuestion({ id: task.id, files: task.files });
      const pick = await vscode.window.showInformationMessage(q.message, { modal: true, detail: q.detail }, q.wait, ANYWAY);
      if (!pick) return;
      anyway = pick === ANYWAY;
    }
    type Out = { held?: boolean; waitsFor?: { task: string; files: string[] }[]; first?: string[]; worktree?: string; bgId?: string | null; reused?: boolean; name?: string; effortDropped?: string; cloud?: { url?: string }; task?: { run?: { model?: string } | null; held?: { model?: string } | null } };
    let result: Out | null = null;
    const cloud = extra.includes('--cloud');
    const go = (shown?: string) => this.runAcc(project, ['dispatch', task.id, ...extra, ...(anyway ? ['--anyway'] : [])], (out) => {
      result = out;
      return undefined;
    }, shown);
    // In the output panel, where its steps show as it goes (T-65); else under a notification.
    if (this.helpers.runAccShown) await go(`Build ${task.id}${cloud ? ' in the cloud' : ''}`);
    else {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Building ${task.id}${cloud ? ' in the cloud' : ''}`, cancellable: false }, async (progress) => {
        progress.report({ message: cloud ? 'pushing its branch and firing the routine…' : 'creating the worktree and starting the agent…' });
        await go();
      });
    }
    if (!result) return;
    const r = result as Out;
    const said = dropped ?? (r.effortDropped ? effortDroppedWords(r.effortDropped, r.task?.run?.model ?? r.task?.held?.model ?? 'the model') : null);
    const also = said ? ` ${said}` : '';
    if (r.held) {
      const pick = await vscode.window.showInformationMessage(`${task.id} ${waitLine(r.waitsFor ?? [], false, r.first ?? []).replace(/^Waits/, 'waits')}. It starts on its own once they're free, or once nothing else is ready.${also}`, ANYWAY);
      // What acc just reported it waits for, which the board may not have foreseen, so the confirmation names it.
      if (pick) await this.dispatchAnyway(n, extra, r.waitsFor);
      return;
    }
    // A cloud builder (GH-69), as the project's default or picked in the sheet: its session is on claude.ai.
    if (r.cloud?.url) {
      await this.hub.loadWorktrees();
      const watch = await vscode.window.showInformationMessage(`${task.id} is running in the cloud. The Command Center follows its branch on GitHub and collects it when it's done.${also}`, 'Watch on claude.ai');
      if (watch) await vscode.env.openExternal(vscode.Uri.parse(r.cloud.url));
      return;
    }
    await Promise.all([this.hub.loadAgents(), this.hub.loadWorktrees()]);
    const where = r.worktree ? basename(r.worktree) : 'its worktree';
    const pick = await vscode.window.showInformationMessage(
      `${task.id} is running: an agent is working in ${where}${r.reused ? ' (reused)' : ''}. It finishes the task when its checks pass, or marks it blocked if it needs you.${also}`,
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
   * Dispatch anyway, once acc held a dispatch (D-093): a task that waits for others' files starts now, once a
   * person confirms, named overlap and all. `extra` keeps what the sheet chose (D-168). `shares`, what acc
   * has just said it waits for, names the overlap over the board's guess.
   */
  private async dispatchAnyway(n: TaskNode, extra: string[] = [], shares?: { task: string; files: string[] }[]): Promise<void> {
    if (n?.kind !== 'task') return;
    const row = this.hub.taskRows(n.project.root).find((t) => t.id === n.task.id) ?? n.task;
    const q = anywayQuestion(shares?.length ? { id: row.id, files: { shares } } : row);
    const ok = await vscode.window.showWarningMessage(q.message, { modal: true, detail: q.detail }, ANYWAY);
    if (ok) await this.dispatchTask({ ...n, task: row }, extra, true);
  }

  /**
   * Dispatch again (T-92): a task whose builder didn't start, with the model, effort and place it had; or a
   * running one acc can't see, set back and dispatched in one step, its History saying why.
   */
  private async dispatchAgain(n: TaskNode): Promise<void> {
    if (n?.kind !== 'task') return;
    // Only where acc can't see the builder (T-93): else it would stop one at work. The row says, as the card does.
    const row = this.hub.taskRows(n.project.root).find((t) => t.id === n.task.id) ?? n.task;
    const off = dispatchAgainOff(row);
    if (off) {
      void vscode.window.showWarningMessage(off);
      return;
    }
    const silent = this.hub.agentsSilentSince;
    const ran = await this.runAcc(n.project, ['dispatch', n.task.id, '--again', ...(row.state === 'running' && silent ? ['--silent-since', String(silent)] : [])], () => `${n.task.id} was dispatched again.`);
    if (ran) await this.hub.loadAgents();
  }

  /** It stops waiting for others' files, and stays to do (D-093). */
  private async stopWaiting(n: TaskNode): Promise<void> {
    if (n?.kind !== 'task') return;
    await this.runAcc(n.project, ['dispatch', n.task.id, '--stop-waiting'], () => `${n.task.id} stopped waiting. It stays in Ready, and nothing starts it on its own.`);
  }

  /** Stops the task's agent and moves it back to To do. The worktree and its commits are kept. */
  private async abandonTask(n: TaskNode): Promise<void> {
    if (n?.kind !== 'task') return;
    // A cloud builder can't be stopped from here (GH-69): the task is set aside, and its page offered, to archive it there.
    const cloud = n.task.run?.where === 'cloud' ? n.task.run.cloud?.url ?? null : null;
    const reason = await vscode.window.showInputBox({ title: `Abandon ${n.task.id}?`, prompt: cloud ? 'Why? The task goes back to To do, and the worktree and commits are kept. Its cloud session isn\'t stopped: archive it on claude.ai.' : 'Why? Its agent stops, the task goes back to To do, and the worktree and commits are kept.', validateInput: (v) => (v.trim() ? undefined : 'A reason is required.') });
    if (!reason) return;
    if (cloud) {
      const done = await this.runAcc(n.project, ['set', n.task.id, 'todo', '--reason', reason], () => undefined);
      if (!done) return;
      const pick = await vscode.window.showInformationMessage(`${n.task.id} is back in To do. Its worktree is kept, and its cloud session is still on claude.ai.`, 'Open the session to archive it');
      if (pick) await vscode.env.openExternal(vscode.Uri.parse(cloud));
      return;
    }
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
    const pick = await vscode.window.showInformationMessage(`${task.id} is resumed: its builder carries on in its worktree, told its last turn ended early. It finishes the task, or marks it blocked.`, 'Watch');
    if (pick === 'Watch') this.watchTask(n);
  }

  /**
   * Asks first, then cleans up (T-147): nothing is read before the question, so it opens as the click
   * arrives. The page hears that it asked, that it started after the yes, and acc's answer as soon as acc
   * gives it, before the reload: a removed worktree takes the card out of Done at once, and a refusal
   * says why on the card. A cancel ends with nothing done, so the button goes back.
   */
  private async cleanupTask(n: TaskNode): Promise<RanAnswer | undefined> {
    if (n?.kind !== 'task' || !n.task.run?.worktree) return;
    n.say?.({ phase: 'asked' });
    const ok = await vscode.window.showWarningMessage(`Clean up ${n.task.id}'s worktree?`, { modal: true, detail: `${n.task.run.worktree}\n\nacc removes it only if nothing would be lost: no uncommitted changes, and every commit already merged.` }, 'Clean up');
    if (ok !== 'Clean up') return;
    n.say?.({ phase: 'running' });
    const r = await this.acc(['cleanup', n.task.id, '--json'], n.project.root);
    let out: { removed?: boolean; reasons?: string[] } = {};
    try {
      out = JSON.parse(r.stdout);
    } catch {
      out = {};
    }
    const why = out.removed ? null : inProcessWords((out.reasons ?? [(r.stderr || r.stdout).trim()]).join(' ') || 'the Command Center didn\'t say why.');
    if (!why) void vscode.window.showInformationMessage(`Removed ${basename(n.task.run.worktree)}.`);
    else void vscode.window.showWarningMessage(`Kept the worktree: ${why}`);
    const answer: RanAnswer = why ? { phase: 'done', ok: false, error: `Kept the worktree: ${why}` } : { phase: 'done', ok: true, cleaned: true };
    n.say?.(answer);
    await Promise.all([this.hub.loadTasks(true), this.hub.loadWorktrees()]);
    return answer;
  }

  // ------------------------------------------------------------ review and land (D-032, D-033)

  /**
   * The reviewer runs in the output panel; its session can be watched while it reads. The panel shows it as a
   * review (T-63): once it ends, the verdict it wrote, with the lines around each finding, read as its page reads them.
   */
  private reviewTask(n: TaskNode, local = false): void {
    if (n?.kind !== 'task') return;
    const { project, task } = n;
    const acc = this.helpers.accCommand ?? 'acc';
    // --local keeps the review here (T-86); a plain review follows the project's setting, which may be the cloud.
    const flag = local ? ' --local' : '';
    const done = () => void this.hub.loadTasks(true);
    if (this.helpers.run) {
      const reviews = join(dirname(project.ledgerPath), 'reviews');
      const sha = project.worktrees.find((w) => w.branch === task.run?.branch)?.head || null;
      const checkout = task.run?.worktree ?? null;
      const read = (startedAt: number) => readReviewRun({
        reviews, task: task.id, startedAt, checkout, there: !!checkout && existsSync(checkout),
        branch: project.config.environments.find((e) => e.name === task.environment)?.branch ?? task.environment, git: (args, cwd) => runFile('git', args, cwd),
      });
      // acc review exits 1 when it asks for changes: a verdict written is a review that worked.
      const startedAt = Date.now();
      const made = (code: number | null) => code === 0 || !('why' in verdictFrom(newestVerdictText(reviews, task.id), startedAt));
      this.helpers.run(`${acc} review ${task.id}${flag}`, project.root, `Review ${task.id}`, done, made, { run: { project: project.root, task: task.id, sha }, read });
      // The reviewer's session shows once acc has started it.
      setTimeout(done, 2_000);
    } else {
      this.send(project.root, `acc review ${task.id}${flag}`);
    }
  }

  private watchReview(n: TaskNode): void {
    if (n?.kind !== 'task' || !n.task.reviewing) return;
    // A cloud reviewer's session lives on claude.ai (T-86): Watch opens it there.
    if (n.task.reviewing.url) return void vscode.env.openExternal(vscode.Uri.parse(n.task.reviewing.url));
    if (!n.task.run?.worktree) return;
    const { sessionId, name } = n.task.reviewing;
    const root = n.project.root;
    const id = n.task.id;
    const stillReviewing = () => !!this.hub.taskRows(root).find((t) => t.id === id)?.reviewing;
    // Its page keeps the name acc gave it (D-087), after the review is over too.
    this.helpers.watch?.(sessionId, { cwd: n.task.run.worktree, kind: 'background', startedAt: Date.now(), sessionId, name: name ?? `Review ${id}` }, stillReviewing);
  }

  // ------------------------------------------------------------ the analysis before a build (D-052)

  /**
   * Make a plan: for a task with no plan yet, its conversation opens first (T-111), with its question, and Draft
   * the plan or Skip to the plan there makes it. Make a new plan makes one at once, with what was said.
   */
  private async analyzeTask(n: TaskNode): Promise<void> {
    if (n?.kind !== 'task') return;
    const { project, task } = n;
    const talk = this.tickets?.conversation;
    if (talk && this.helpers.run && !this.hub.analysis(project.root, task.id)) return talk.open(project.root, task.id);
    return this.makePlan(project.root, task.id, false);
  }

  /** Draft the plan, or with `skip` Skip to the plan (T-111): from the conversation's panel. */
  draftPlan(root: string, id: string, skip: boolean): void {
    void this.makePlan(root, id, skip);
  }

  /**
   * The whole ticket's file (T-110), in a folder `remove` deletes once acc ends. A file that can't be written is
   * removed, the person is told why, and acc reads the description.
   */
  async planTicketFile(root: string, id: string): Promise<{ file: string | null; remove: () => void }> {
    const kept = this.hub.ledger(root)?.tasks.find((t) => t.id === id.toUpperCase());
    if (!this.planTicket || !kept) return { file: null, remove: () => {} };
    const { file, failed, remove } = await planTicketFolder(this.planTicket, root, kept, () => mkdtempSync(join(tmpdir(), 'acc-plan-')));
    if (failed) void vscode.window.showWarningMessage(failed);
    return { file, remove };
  }

  /**
   * Makes the plan in the output panel, like a review: its session can be watched while the analyst reads. Its ticket
   * is read first, shown as under way, then acc analyze. Once at a time for a task: a second Make a plan, Draft the plan or Skip to the plan while one is under way is ignored.
   */
  private async makePlan(root: string, id: string, skip: boolean): Promise<void> {
    const acc = this.helpers.accCommand ?? 'acc';
    const done = () => void this.hub.loadTasks(true);
    if (!this.helpers.run) return this.send(root, `acc analyze ${id}${skip ? ' --skip-opening' : ''}`);
    const making = this.tickets?.making;
    if (making && !making.begin(root, id)) return;
    // The whole ticket first (T-110): its comments, related tickets and changes field; the status bar and the
    // conversation say so while it's read.
    const reading = this.planTicketFile(root, id);
    void vscode.window.withProgress({ location: vscode.ProgressLocation.Window, title: `Reading ${id}'s ticket for its plan` }, () => reading);
    const read = await reading;
    making?.planning(root, id);
    // acc analyze exits 1 when the analysis has questions or says to split it: a new analysis is a run that
    // worked, and its notice says what it found. An error writes none.
    const before = this.hub.analysis(root, id)?.at ?? null;
    const made = (code: number | null) => code === 0 || (this.hub.analysis(root, id)?.at ?? null) !== before;
    const ended = () => {
      read.remove();
      making?.end(root, id);
      done();
    };
    this.helpers.run(`${acc} analyze ${id}${read.file ? ` --ticket ${shq(read.file)}` : ''}${skip ? ' --skip-opening' : ''}`, root, `Make a plan for ${id}`, ended, made);
    // The analyst's session shows once acc has started it.
    setTimeout(done, 2_000);
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
    if (!gh) return void vscode.window.showWarningMessage(`${project.name} names no GitHub repo in its settings, so there's nowhere to open a pull request.`);
    const again = task.pr?.state === 'open';
    const ok = await vscode.window.showWarningMessage(again ? `Update pull request #${task.pr!.number} for ${task.id}?` : `Send ${task.id} to merge?`, {
      modal: true,
      detail: `${again ? 'Pushes the reviewed commits to' : 'Pushes'} ${task.run?.branch ?? 'its branch'} to ${gh.repo} as ${gh.account}${again ? '.' : `, and opens a pull request into ${task.environment}.`} ${autoMergeFor(project.config, task.environment) ? 'Auto-merge is on: with autopilot running, it merges once its checks pass on GitHub and nothing waits on you. You can merge it first, or ask for changes to hold it.' : 'The Command Center never merges it: a person does, on GitHub.'}`,
    }, again ? 'Update' : 'Push and open');
    if (!ok) return;
    type Landed = { pr?: { number: number; url: string }; opened?: boolean; update?: { id: string; key: string } | null; updateError?: string };
    const box: { r: Landed | null } = { r: null };
    const go = (shown?: string) => this.runAcc(project, ['land', task.id], (out) => { box.r = out as Landed; return undefined; }, shown);
    // In the output panel, where its steps show as it goes (T-65); else under a notification.
    if (this.helpers.runAccShown) await go(`Send ${task.id} to merge`);
    else {
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Landing ${task.id}`, cancellable: false }, async (progress) => {
        progress.report({ message: 'pushing and opening the pull request…' });
        await go();
      });
    }
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
    // A cloud builder's session lives on claude.ai (GH-69): Watch opens it there.
    if (n.task.run?.where === 'cloud' && n.task.run.cloud?.url) return void vscode.env.openExternal(vscode.Uri.parse(n.task.run.cloud.url));
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


/** Make a plan's read of a tracker task's ticket (T-110), through the tracker's own sign-in, as drafting criteria reads it. */
function planTicketHost(hub: Hub, trackers: Trackers): PlanTicketHost {
  return {
    ticket: (root, key) => readProjectTicket(hub, trackers, root, key),
    changes: async (root, key) => {
      const { p, index } = projectTracker({ hub, trackers }, root, key);
      const field = trackers.trackers(p)[index]?.changesField;
      if (!field) return null;
      const client = await trackers.client(p, index);
      return client.readField ? { name: field.name, markdown: await client.readField(key, field) } : null;
    },
  };
}

export const area: ExtensionArea = {
  register({ sidebar, regNode, hub, setup, accScript, accSays, resolve, receive, panels, tickets, ticketEdits: edits, trackers }) {
    const read = (root: string, key: string) => edits.sheetTicket(root, key);
    const tasks = new TaskCommands(sidebar, (root, id, ask) => openSheet(hub, panels, root, id, ask), (root, id) => openTaskSheet(hub, (m) => void panels.tell(m), root, id, undefined, read, sheetDress(root, id)), edits, planTicketHost(hub, trackers));
    tasks.register(regNode);
    // A plan's conversation (T-111): Make a plan opens it; Draft the plan and Skip to the plan there make it here.
    tasks.tickets = tickets;
    tickets.draftPlan = (root, id, skip) => tasks.draftPlan(root, id, skip);
    tickets.planTicketFile = (root, id) => tasks.planTicketFile(root, id);
    // Dispatch's sheet (D-168): its Dispatch from the Command Center's page. A task's own tab, and the modal
    // over the board, show the sheet over that page, and send its Dispatch here too.
    receive('dispatch-sheet-go', (m) => void tasks.go(m));
    // The task sheet (T-74): its Add task or Save, from any page; Edit on a task's tab or the modal opens it over that page.
    receive('task-sheet-go', (m) => void tasks.saveSheet(m, (msg) => panels.reply(msg)));
    // Change on the sheet's status, assignee or labels (T-80), over the Command Center or its modal.
    receive('task-sheet-field', (m) => void tasks.sheetField(m, (msg) => panels.reply(msg)));
    tickets.dispatch = {
      open: (command, ref, say) => (command === 'acc.task.edit' && !!ref.project && !!ref.task ? openTaskSheet(hub, (m) => void panels.tell(m), ref.project, ref.task, say, read, sheetDress(ref.project, ref.task))
        : SHEET_COMMANDS.includes(command) && !!ref.project && !!ref.task
        && openSheet(hub, panels, ref.project, ref.task, command === 'acc.task.dispatchAnyway' ? { anyway: true } : command === 'acc.task.dispatchCloud' ? { where: 'cloud' } : {}, say)),
      go: (m) => void tasks.go(m),
      save: (m, say) => void tasks.saveSheet(m, say),
      field: (m, say) => void tasks.sheetField(m, say),
    };
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
            void vscode.window.showWarningMessage(`${f.task} couldn't start: ${reasonInWords(f.reason)}`, ANYWAY).then((pick) => pick && resolve('acc.task.dispatchAnyway', { project: p.root, task: f.task }));
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
