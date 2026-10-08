import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { builderGatesFor, requiredGates } from '../../packages/core/src/config.ts';
import type { RepoPaths } from '../../packages/core/src/paths.ts';
import { receiptsAt } from '../../packages/core/src/receipts.ts';
import { signInLabel, type Ticket, type TrackerClient } from '../../packages/core/src/trackers/types.ts';
import type { Hub, Project } from './hub.ts';
import { type FromWebview, isFromWebview } from './model/messages.ts';
import type { Ref } from './model/shared.ts';
import { type TicketAcc, ticketActionRefusal, ticketModel, type TicketModel } from './model/task-page.ts';
import { htmlFor, isWebLink, TabTheme } from './panels.ts';
import type { ThemeChoice } from './model/settings.ts';
import { runFile } from './run.ts';
import type { Trackers } from './trackers.ts';
import type { ExtensionArea } from './area.ts';
import { addTaskArgs, draftFromOpen } from './logic/tasks.ts';

type AccRun = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;
type Reply = { ok: boolean; error?: string };
type AnswerAnalysis = (root: string, task: string, question: string, text: string) => Promise<Reply>;

/** A person's way with a ticket's draft updates, through acc (D-066): post it as you, discard it, or draft a question. */
export interface UpdateActions {
  post(root: string, id: string, text: string, again: boolean): Promise<Reply>;
  discard(root: string, id: string): Promise<Reply>;
  ask(root: string, task: string, question: string): Promise<Reply>;
}

interface Open {
  panel: vscode.WebviewPanel;
  project: string;
  tracker: number | null;
  key: string;
  ticket: Ticket | null;
  loading: boolean;
  error: string | null;
  /** Why the ticket isn't shown: it's outside the repo's place (D-072). */
  outside: string | null;
  connect: TicketModel['connect'];
  /** Its updates' unsent edits, by update id, as the page last said (GH-46). */
  edits: Map<string, string>;
  /** Keeps it in the Command Center's theme (GH-109). */
  theme: TabTheme;
}

/** Commands a ticket page may run, the same ones its task's card offers. */
const ALLOWED = new Set(['acc.task.dispatch', 'acc.task.dispatchWith', 'acc.task.dispatchAnyway', 'acc.task.stopWaiting', 'acc.task.attach', 'acc.task.openInClaude', 'acc.task.watch', 'acc.task.resume', 'acc.task.review', 'acc.task.watchReview', 'acc.task.land', 'acc.task.openPr', 'acc.task.openWorktree', 'acc.task.abandon', 'acc.task.cleanup', 'acc.task.move', 'acc.task.block', 'acc.task.unblock', 'acc.task.analyze', 'acc.task.watchAnalysis', 'acc.trackers.signIn']);

/**
 * One editor tab per ticket, like the tracker's own ticket page: rendered description and comments,
 * status, assignee and labels, and acc's side of it. Every change is a person's click (D-026), and the
 * fields change only where the tracker opts in; acc's updates for it are drafts a person posts (D-066).
 */
export class TicketPanels implements vscode.Disposable {
  private readonly open = new Map<string, Open>();
  private readonly ctx: vscode.ExtensionContext;
  private readonly hub: Hub;
  private readonly trackers: Trackers;
  private readonly resolve: (command: string, ref: Ref) => unknown;
  private readonly acc: AccRun;
  private readonly answerAnalysis: AnswerAnalysis | null;
  private readonly updates: UpdateActions | null;
  private readonly editsChanged = new vscode.EventEmitter<void>();
  /** A page's unsent edit of an update began, changed or ended, so the Overview shows it. */
  readonly onDidEdit = this.editsChanged.event;

  constructor(ctx: vscode.ExtensionContext, hub: Hub, trackers: Trackers, resolve: (command: string, ref: Ref) => unknown, acc: AccRun, answerAnalysis: AnswerAnalysis | null = null, updates: UpdateActions | null = null) {
    this.ctx = ctx;
    this.hub = hub;
    this.trackers = trackers;
    this.resolve = resolve;
    this.acc = acc;
    this.answerAnalysis = answerAnalysis;
    this.updates = updates;
  }

  /** Whether this page's tracker lets it change a ticket's status, assignee and labels (D-066). */
  private edits(o: Open, p: Project): boolean {
    return o.tracker !== null && !!this.trackers.trackers(p)[o.tracker]?.edits;
  }

  dispose(): void {
    for (const o of this.open.values()) o.panel.dispose();
    this.editsChanged.dispose();
  }

  /**
   * The edit an open task page holds for an update and hasn't sent, found through the drafts the update
   * replaced too: what Post on that page would send. Only this window's pages, and only while open (GH-46).
   */
  edited(root: string, id: string, replaces: readonly string[] = []): string | null {
    for (const o of this.open.values()) {
      if (o.project !== root) continue;
      for (const x of [id, ...replaces]) {
        const text = o.edits.get(x);
        if (text !== undefined) return text;
      }
    }
    return null;
  }

  /** Opens a ticket's page, or brings it forward. With no tracker given, the key decides which. */
  show(root: string, tracker: number | null | undefined, key: string): void {
    const project = this.hub.project(root);
    if (!project) return;
    const index = tracker === undefined ? this.trackers.trackerFor(project, key) : tracker;
    const id = `${root}#${key.toUpperCase()}`;
    const existing = this.open.get(id);
    if (existing) {
      existing.panel.reveal();
      void this.load(existing);
      return;
    }
    const base = vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel('acc.ticket', key, vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [base] });
    const icon = (theme: 'light' | 'dark') => vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'media', `acc-${theme}.svg`);
    panel.iconPath = { light: icon('light'), dark: icon('dark') };
    const theme = new TabTheme(panel, (t) => htmlFor(panel.webview, base, 'ticket', randomBytes(16).toString('base64'), key, t));
    const o: Open = { panel, project: root, tracker: index, key: key.toUpperCase(), ticket: null, loading: index !== null, error: null, outside: null, connect: null, edits: new Map(), theme };
    this.open.set(id, o);
    // Closing the page drops its edits (D-066), and the Overview goes back to acc's text.
    panel.onDidDispose(() => {
      this.open.delete(id);
      if (o.edits.size) this.editsChanged.fire();
    });
    panel.onDidChangeViewState((e) => { if (e.webviewPanel.visible) void this.post(o); });
    panel.webview.onDidReceiveMessage((m: unknown) => void this.receive(o, m));
    void this.load(o);
  }

  /** Settings changed the theme (GH-109): every task page restyles. */
  retheme(theme: ThemeChoice): void {
    for (const o of this.open.values()) o.theme.set(theme);
  }

  /** Re-draws every open page, for instance after the ledger or an agent changed. */
  refresh(root?: string): void {
    for (const o of this.open.values()) if (!root || o.project === root) void this.post(o);
  }

  private project(o: Open): Project | undefined {
    return this.hub.project(o.project);
  }

  private async load(o: Open): Promise<void> {
    const p = this.project(o);
    if (!p || o.tracker === null) {
      o.loading = false;
      return this.post(o);
    }
    o.loading = true;
    await this.post(o);
    try {
      o.ticket = await this.trackers.ticket(p, o.tracker, o.key);
      o.error = null;
      o.outside = null;
      o.connect = null;
    } catch (e) {
      // Outside the repo's place (D-072): not shown, nor tracked, and said plainly rather than as a failure.
      const outside = (e as { kind?: string }).kind === 'outside';
      if (outside) o.ticket = null;
      o.outside = outside ? (e as Error).message : null;
      o.error = outside ? null : (e as Error).message;
      const t = this.trackers.trackers(p)[o.tracker];
      o.connect = (e as { kind?: string }).kind === 'auth' && t && t.kind !== 'github'
        ? { command: 'acc.trackers.signIn', label: signInLabel(t.kind), arg: JSON.stringify({ root: p.root, index: o.tracker }) } : null;
    } finally {
      o.loading = false;
    }
    o.panel.title = o.ticket ? `${o.key} ${o.ticket.title}`.slice(0, 60) : o.key;
    await this.post(o);
  }

  /**
   * Each required check and any other recorded on the task branch's latest commit. Where the merge queue
   * runs the full check, a builder's lighter ones come first, then the full one, each saying which it is (GH-73).
   */
  private async checks(p: Project, branch: string | null, environment: string): Promise<TicketAcc['checks']> {
    const lighter = builderGatesFor(p.config, environment);
    const builder = requiredGates(p.config, environment, 'builder');
    const required = [...new Set([...builder, ...p.config.gates.required])];
    const scope = (gate: string): { scope?: 'builder' | 'merge' } => (!lighter ? {} : builder.includes(gate) ? { scope: 'builder' } : p.config.gates.required.includes(gate) ? { scope: 'merge' } : {});
    const unrun = (gate: string) => (lighter && scope(gate).scope === 'merge' ? 'Not run on this commit: it runs once, in the merge queue' : 'Not run on this commit');
    if (!branch) return required.map((gate) => ({ gate, status: 'skip' as const, summary: lighter && scope(gate).scope === 'merge' ? unrun(gate) : 'Not run yet', ...scope(gate) }));
    const sha = await runFile('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], p.root);
    const receipts = sha.code === 0 ? receiptsAt({ receipts: join(dirname(p.ledgerPath), 'receipts') } as RepoPaths, sha.stdout.trim()) : {};
    const gates = [...new Set([...required, ...Object.keys(receipts)])];
    return gates.map((gate) => receipts[gate] ? { gate, status: receipts[gate]!.status, summary: receipts[gate]!.summary, waived: !!receipts[gate]!.waived, ...scope(gate) } : { gate, status: 'skip' as const, summary: unrun(gate), ...scope(gate) });
  }

  private async post(o: Open): Promise<void> {
    const p = this.project(o);
    if (!p || !o.panel.visible) return;
    const row = this.hub.taskRows(p.root).find((r) => r.id === o.key) ?? null;
    const task = this.hub.ledger(p.root)?.tasks.find((t) => t.id === o.key) ?? null;
    const tracker = o.tracker !== null ? this.trackers.trackers(p)[o.tracker] : undefined;
    const model = ticketModel({
      project: p.root, tracker: o.tracker, trackerTitle: tracker ? this.trackers.title(tracker) : null, trackerKind: tracker?.kind ?? null, key: o.key,
      ticket: o.ticket, loading: o.loading, error: o.error, outside: o.outside, connect: o.connect, row, task, checks: task ? await this.checks(p, task.run?.branch ?? null, task.environment) : [],
      signedInAs: o.tracker !== null ? await this.trackers.signedInAs(p, o.tracker) : null,
      analysis: task ? this.hub.analysis(p.root, task.id) : null,
      trackerEdits: this.edits(o, p), updates: this.hub.updates(p.root), boards: this.trackers.boardStates(p.root), github: p.config.github?.account ?? null,
      tracking: this.trackers.trackState(p.root, o.key).busy,
    });
    void o.panel.webview.postMessage({ type: 'state', model });
  }

  private async receive(o: Open, m: unknown): Promise<void> {
    if (!isFromWebview(m)) return;
    // Answered even once its project has closed: the page waits for a reply.
    if (m.type === 'analysis-answer') return this.answer(o, m);
    if (m.type === 'update-post' || m.type === 'update-discard' || m.type === 'update-ask') return this.update(o, m);
    if (m.type === 'update-edit') return this.edit(o, m);
    const p = this.project(o);
    if (!p) return;
    switch (m.type) {
      case 'ready': o.theme.ready(); return this.post(o);
      case 'refresh': return this.load(o);
      case 'open': if (isWebLink(m.url)) void vscode.env.openExternal(vscode.Uri.parse(m.url)); return;
      case 'ticket': return this.show(m.project, m.tracker, m.key);
      case 'run':
        if (ALLOWED.has(m.command)) await this.resolve(m.command, m.ref);
        return;
      case 'toolbar':
        if (ALLOWED.has(m.command)) await vscode.commands.executeCommand(m.command, m.arg);
        return;
      case 'ticket-action': return this.act(o, p, m.action, m.text);
      default: return;
    }
  }

  /**
   * A person's answer to one of this page's own task's questions (D-052). The page shows it's sending
   * until the question goes, so every answer gets a reply: done, or why it wasn't recorded.
   */
  private async answer(o: Open, m: Extract<FromWebview, { type: 'analysis-answer' }>): Promise<void> {
    const done = (r: { ok: boolean; error?: string }) => void o.panel.webview.postMessage({ type: 'done', action: 'analysis-answer', project: m.project, task: m.task, question: m.question, ...r });
    if (m.project !== o.project || m.task !== o.key) return done({ ok: false, error: 'That answer isn\'t for this task.' });
    if (!this.answerAnalysis) return done({ ok: false, error: 'This page can\'t record answers.' });
    done(await this.answerAnalysis(m.project, m.task, m.question, m.text).catch((e: unknown) => ({ ok: false, error: (e as Error).message })));
    return this.post(o);
  }

  /**
   * A person posts one of this task's updates with the text they edited, discards it, or sends one of its
   * analysis's questions to the client (D-066). Every one gets a reply, and a post reloads the ticket, so
   * the comment shows in the feed.
   */
  private async update(o: Open, m: Extract<FromWebview, { type: 'update-post' | 'update-discard' | 'update-ask' }>): Promise<void> {
    const which = m.type === 'update-ask' ? { task: m.task, question: m.question } : { id: m.id };
    const done = (r: Reply) => void o.panel.webview.postMessage({ type: 'done', action: m.type, project: m.project, ...which, ...r });
    const task = m.type === 'update-ask' ? m.task : m.id.slice(0, m.id.lastIndexOf('.'));
    if (m.project !== o.project || task !== o.key) return done({ ok: false, error: 'That update isn\'t for this task.' });
    if (!this.updates) return done({ ok: false, error: 'This page can\'t post updates.' });
    const r = await (m.type === 'update-post' ? this.updates.post(m.project, m.id, m.text, m.again === true)
      : m.type === 'update-discard' ? this.updates.discard(m.project, m.id)
        : this.updates.ask(m.project, m.task, m.question)).catch((e: unknown) => ({ ok: false, error: (e as Error).message }));
    done(r);
    if (r.ok && m.type !== 'update-ask' && o.edits.delete(m.id)) this.editsChanged.fire();
    if (m.type === 'update-post' && r.ok) return this.load(o);
    return this.post(o);
  }

  /**
   * The page's unsent edit of one of its task's updates, or null once it's acc's text again. It's kept
   * here, not in acc, so the Overview shows it and its Post won't send acc's text instead (GH-46).
   */
  private edit(o: Open, m: Extract<FromWebview, { type: 'update-edit' }>): void {
    if (m.project !== o.project || m.id.slice(0, m.id.lastIndexOf('.')) !== o.key) return;
    // An edit for a newer draft stands in for any the page held for the drafts it replaced.
    const replaced = this.hub.updates(o.project).find((u) => u.id === m.id)?.replaces ?? [];
    let changed = false;
    for (const r of replaced) changed = o.edits.delete(r) || changed;
    if (m.text === null) changed = o.edits.delete(m.id) || changed;
    else if (o.edits.get(m.id) !== m.text) {
      o.edits.set(m.id, m.text);
      changed = true;
    }
    if (changed) this.editsChanged.fire();
  }

  private async act(o: Open, p: Project, action: string, text?: string): Promise<void> {
    if (action === 'refresh') return this.load(o);
    if (action === 'track') return this.track(o, p);
    if (action === 'waive') return this.waive(o, p, text ?? '');
    if (action === 'task') return this.makeTask(o, p, text ?? '');
    if (o.tracker === null || !o.ticket) return;
    const index = o.tracker;
    const done = (ok: boolean, error?: string) => void o.panel.webview.postMessage({ type: 'done', action, ok, error });
    // A client's tracker is theirs: its fields change from here only where it opts in (D-066). Comments stay.
    const refused = ticketActionRefusal(action, this.edits(o, p));
    if (refused) return done(false, refused);
    try {
      const client = await this.trackers.client(p, index);
      let changed = false;
      if (action === 'comment') {
        await client.comment(o.key, text ?? '');
        changed = true;
      } else if (action === 'status') {
        changed = await this.pickStatus(client, o);
      } else if (action === 'assign') {
        changed = await this.pickAssignees(client, o);
      } else if (action === 'labels') {
        changed = await this.pickLabels(client, o);
      }
      done(true);
      if (changed) {
        await this.load(o);
        void this.trackers.loadBoards(p.root);
      }
    } catch (e) {
      const msg = (e as Error).message;
      done(false, msg);
      void vscode.window.showErrorMessage(`${o.key}: ${msg}`);
    }
  }

  private async pickStatus(client: TrackerClient, o: Open): Promise<boolean> {
    const moves = await client.transitions(o.key);
    if (!moves.length) {
      void vscode.window.showInformationMessage(`${o.key} has no moves from ${o.ticket!.status.name} right now.`);
      return false;
    }
    const pick = await vscode.window.showQuickPick(moves.map((m) => ({ label: m.name, description: m.to.name === m.name ? undefined : `→ ${m.to.name}`, m })), { title: `${o.key}: ${o.ticket!.status.name}`, placeHolder: 'Move it to…' });
    if (!pick) return false;
    await client.transition(o.key, pick.m);
    return true;
  }

  private async pickAssignees(client: TrackerClient, o: Open): Promise<boolean> {
    const current = o.ticket!.assignees;
    if (client.kind === 'github' || client.kind === 'monday') {
      // GitHub and a monday.com People column take several: a checklist of everyone who can be assigned.
      const people = await client.assignable(o.key, '');
      const items = people.map((x) => ({ label: x.name, picked: current.some((c) => c.id === x.id), x }));
      const chosen = await vscode.window.showQuickPick(items, { title: `Assignees for ${o.key}`, canPickMany: true, placeHolder: 'Tick everyone who should work on it' });
      if (!chosen) return false;
      await client.assign(o.key, chosen.map((c) => c.x));
      return true;
    }
    // Jira takes one: search as you type, with yourself and nobody first.
    const me = await client.me();
    const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { id: string | null; name: string }>();
    qp.title = `Assignee for ${o.key}`;
    qp.placeholder = 'Type a name to search';
    const base = [{ label: '$(account) Assign to me', description: me.name, id: me.id, name: me.name }, { label: '$(circle-slash) Unassigned', id: null, name: '' }];
    qp.items = base;
    let timer: NodeJS.Timeout | undefined;
    qp.onDidChangeValue((v) => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        qp.busy = true;
        try {
          const found = await client.assignable(o.key, v);
          qp.items = [...base, ...found.map((x) => ({ label: x.name, id: x.id, name: x.name }))];
        } finally {
          qp.busy = false;
        }
      }, 250);
    });
    const pick = await new Promise<(typeof base)[number] | undefined>((resolve) => {
      qp.onDidAccept(() => { resolve(qp.selectedItems[0] as (typeof base)[number] | undefined); qp.hide(); });
      qp.onDidHide(() => resolve(undefined));
      qp.show();
    });
    qp.dispose();
    if (!pick) return false;
    await client.assign(o.key, pick.id ? [{ id: pick.id, name: pick.name }] : []);
    return true;
  }

  private async pickLabels(client: TrackerClient, o: Open): Promise<boolean> {
    const have = new Set(o.ticket!.labels.map((l) => l.name));
    const all = await client.labels();
    const names = [...new Set([...all.map((l) => l.name), ...have])].sort((a, b) => a.localeCompare(b));
    const qp = vscode.window.createQuickPick<vscode.QuickPickItem>();
    qp.title = `Labels for ${o.key}`;
    qp.canSelectMany = true;
    qp.placeholder = client.kind === 'jira' ? 'Tick labels, or type a new one' : 'Tick labels';
    const items = names.map((label) => ({ label }));
    qp.items = items;
    qp.selectedItems = items.filter((i) => have.has(i.label));
    if (client.kind === 'jira') {
      // Jira labels are free text, so a typed name that isn't there yet can be added.
      qp.onDidChangeValue((v) => {
        const typed = v.trim().replace(/\s+/g, '-');
        const extra = typed && !names.includes(typed) ? [{ label: typed, description: 'new label' }] : [];
        const kept = qp.selectedItems;
        qp.items = [...extra, ...items];
        qp.selectedItems = qp.items.filter((i) => kept.some((k) => k.label === i.label));
      });
    }
    const chosen = await new Promise<readonly vscode.QuickPickItem[] | undefined>((resolve) => {
      qp.onDidAccept(() => { resolve(qp.selectedItems); qp.hide(); });
      qp.onDidHide(() => resolve(undefined));
      qp.show();
    });
    qp.dispose();
    if (!chosen) return false;
    const want = new Set(chosen.map((c) => c.label));
    const add = [...want].filter((n) => !have.has(n));
    const remove = [...have].filter((n) => !want.has(n));
    if (!add.length && !remove.length) return false;
    await client.setLabels(o.key, add, remove);
    return true;
  }

  /** A person sets a failing check aside on the task's latest commit, with a reason (D-031). */
  private async waive(o: Open, p: Project, gate: string): Promise<void> {
    const task = this.hub.ledger(p.root)?.tasks.find((t) => t.id === o.key);
    if (!task?.run?.branch || !p.config.gates.required.concat(requiredGates(p.config, task.environment, 'builder'), Object.keys(await this.receiptsFor(p, task.run.branch))).includes(gate)) return;
    const reason = await vscode.window.showInputBox({
      title: `Waive ${gate} for ${task.id}?`,
      prompt: 'Why is it fine to set this check aside? The reason is kept with the commit\'s checks. A new commit needs its checks again.',
      placeHolder: 'For example: a test task, never promoted',
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : 'A waiver needs a reason.'),
    });
    if (!reason) return;
    const r = await this.acc(['gate', 'waive', gate, '--task', task.id, '--reason', reason.trim(), '--json'], p.root);
    if (r.code !== 0) {
      let msg = (r.stderr || r.stdout).trim().split('\n')[0] ?? '';
      try { msg = (JSON.parse(r.stdout) as { message?: string }).message ?? msg; } catch { /* plain text */ }
      void vscode.window.showWarningMessage(`Couldn't waive ${gate}: ${msg}`);
    } else {
      void vscode.window.showInformationMessage(`${gate} is waived on ${task.id}'s latest commit.${task.state === 'blocked' ? ' Move it to In review when you\'re ready.' : ''}`);
    }
    await this.hub.loadTasks(true);
    await this.post(o);
  }

  /**
   * A person drafts a task from a still-open line of the task's note (D-???): the title and brief come
   * prefilled, to edit, and Esc creates nothing. It's an acc task in the same environment, waiting on this
   * one while it isn't done. Nothing is written to a tracker.
   */
  private async makeTask(o: Open, p: Project, line: string): Promise<void> {
    const task = this.hub.ledger(p.root)?.tasks.find((t) => t.id === o.key);
    const draft = task ? draftFromOpen(task, line) : null;
    if (!task || !draft) return;
    const title = await vscode.window.showInputBox({
      title: `A task from ${task.id}'s note`,
      prompt: `Its title. It goes in ${draft.env}${draft.deps.length ? `, after ${task.id}` : ''}. Press Esc to make nothing.`,
      value: draft.title,
      ignoreFocusOut: true,
      validateInput: (v) => (v.trim() ? undefined : 'A task needs a title.'),
    });
    if (!title) return;
    const brief = await vscode.window.showInputBox({
      title: `A task from ${task.id}'s note`,
      prompt: 'Its details, for whoever builds it. Press Enter to make it, or Esc to make nothing.',
      value: draft.brief,
      ignoreFocusOut: true,
    });
    if (brief === undefined) return;
    const r = await this.acc(addTaskArgs({ ...draft, title: title.trim(), brief: brief.trim() }), p.root);
    let out: { added?: string[]; message?: string } = {};
    try { out = JSON.parse(r.stdout) as typeof out; } catch { /* plain text */ }
    if (r.code !== 0 || !out.added?.length) {
      void vscode.window.showWarningMessage(`Couldn't make the task: ${out.message ?? ((r.stderr || r.stdout).trim().split('\n')[0] ?? '')}`);
    } else {
      void vscode.window.showInformationMessage(`Added ${out.added.join(', ')}${draft.deps.length ? `, after ${task.id}` : ''}.`);
    }
    await this.hub.loadTasks(true);
    await this.post(o);
  }

  private async receiptsFor(p: Project, branch: string) {
    const sha = await runFile('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], p.root);
    return sha.code === 0 ? receiptsAt({ receipts: join(dirname(p.ledgerPath), 'receipts') } as RepoPaths, sha.stdout.trim()) : {};
  }

  /**
   * Adds a tracker ticket to acc's ledger the way its card's Track does (D-074), so an agent can be
   * dispatched to it. The ticket isn't changed. A Track already on its way, from here or the card, says nothing more.
   */
  private async track(o: Open, p: Project): Promise<void> {
    if (o.tracker === null || !o.ticket) return;
    const r = await this.trackers.track(p, o.tracker, o.key);
    if (r.ok) void vscode.window.showInformationMessage(`${o.key} is now a task in acc. Dispatch it from here or the board.`);
    else if ('error' in r) void vscode.window.showErrorMessage(`Couldn't track ${o.key}: ${r.error}`);
    await this.post(o);
  }
}

export const area: ExtensionArea = {
  register({ hub, panels, tickets, answerAnalysis, updates, receive }) {
    receive('ticket', (m) => { if (hub.project(m.project)) tickets.show(m.project, m.tracker, m.key); });
    receive('analysis-answer', (m) => {
      // The page shows it's sending until the question goes. Every answer gets a reply: a refusal, or a
      // project that isn't open here, tells it to stop and why.
      void answerAnalysis(m.project, m.task, m.question, m.text)
        .catch((e: unknown) => ({ ok: false, error: (e as Error).message }))
        .then((r) => panels.reply({ type: 'done', action: 'analysis-answer', project: m.project, task: m.task, question: m.question, ...r }));
    });
    const update = (m: Extract<FromWebview, { type: 'update-post' | 'update-discard' | 'update-ask' }>) => {
      // Posted as drafted, or set aside, from Needs you; edited on the task's page (D-066). Every one gets a reply.
      const u = updates;
      const which = m.type === 'update-ask' ? { task: m.task, question: m.question } : { id: m.id };
      const reply = (r: { ok: boolean; error?: string }) => panels.reply({ type: 'done', action: m.type, project: m.project, ...which, ...r });
      if (m.type === 'update-post') {
        // An edit on its task's page is what Post there sends. A row drawn before the edit arrived would
        // send acc's text instead, so it's refused, and the row says to post it from there (GH-46).
        const replaces = hub.updates(m.project).find((x) => x.id === m.id)?.replaces ?? [];
        const edit = tickets.edited(m.project, m.id, replaces);
        if (edit !== null && edit.trim() !== m.text.trim()) {
          void reply({ ok: false, error: 'it was edited on the task page, so post it from there.' });
          return;
        }
      }
      void (m.type === 'update-post' ? u.post(m.project, m.id, m.text, m.again === true) : m.type === 'update-discard' ? u.discard(m.project, m.id) : u.ask(m.project, m.task, m.question))
        .catch((e: unknown) => ({ ok: false, error: (e as Error).message }))
        .then(reply);
    };
    for (const type of ['update-post', 'update-discard', 'update-ask'] as const) receive(type, update);
  },
};
