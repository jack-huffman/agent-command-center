import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import type { RepoPaths } from '../../packages/core/src/paths.ts';
import { receiptsAt } from '../../packages/core/src/receipts.ts';
import type { Ticket, TrackerClient } from '../../packages/core/src/trackers/types.ts';
import type { Hub, Project } from './hub.ts';
import { isFromWebview, type Ref, type TicketAcc, ticketModel, type TicketModel } from './model.ts';
import { htmlFor, isWebLink } from './panels.ts';
import { runFile } from './run.ts';
import type { Trackers } from './trackers.ts';

type AccRun = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

interface Open {
  panel: vscode.WebviewPanel;
  project: string;
  tracker: number | null;
  key: string;
  ticket: Ticket | null;
  loading: boolean;
  error: string | null;
  connect: TicketModel['connect'];
}

/** Commands a ticket page may run, the same ones its task's card offers. */
const ALLOWED = new Set(['acc.task.dispatch', 'acc.task.attach', 'acc.task.watch', 'acc.task.review', 'acc.task.watchReview', 'acc.task.land', 'acc.task.openPr', 'acc.task.openWorktree', 'acc.task.abandon', 'acc.task.cleanup', 'acc.task.move', 'acc.task.block', 'acc.task.unblock', 'acc.trackers.signIn']);

/**
 * One editor tab per ticket, like the tracker's own ticket page: rendered description and comments,
 * status, assignee and labels, and acc's side of it. Every change is a person's click (D-026).
 */
export class TicketPanels implements vscode.Disposable {
  private readonly open = new Map<string, Open>();
  private readonly ctx: vscode.ExtensionContext;
  private readonly hub: Hub;
  private readonly trackers: Trackers;
  private readonly resolve: (command: string, ref: Ref) => unknown;
  private readonly acc: AccRun;

  constructor(ctx: vscode.ExtensionContext, hub: Hub, trackers: Trackers, resolve: (command: string, ref: Ref) => unknown, acc: AccRun) {
    this.ctx = ctx;
    this.hub = hub;
    this.trackers = trackers;
    this.resolve = resolve;
    this.acc = acc;
  }

  dispose(): void {
    for (const o of this.open.values()) o.panel.dispose();
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
    panel.webview.html = htmlFor(panel.webview, base, 'ticket', randomBytes(16).toString('base64'), key);
    const o: Open = { panel, project: root, tracker: index, key: key.toUpperCase(), ticket: null, loading: index !== null, error: null, connect: null };
    this.open.set(id, o);
    panel.onDidDispose(() => this.open.delete(id));
    panel.onDidChangeViewState((e) => { if (e.webviewPanel.visible) void this.post(o); });
    panel.webview.onDidReceiveMessage((m: unknown) => void this.receive(o, m));
    void this.load(o);
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
      o.connect = null;
    } catch (e) {
      o.error = (e as Error).message;
      const t = this.trackers.trackers(p)[o.tracker];
      o.connect = (e as { kind?: string }).kind === 'auth' && t && t.kind !== 'github'
        ? { command: 'acc.trackers.signIn', label: t.kind === 'jira' ? 'Sign in to Jira' : 'Sign in to Azure DevOps', arg: JSON.stringify({ root: p.root, index: o.tracker }) } : null;
    } finally {
      o.loading = false;
    }
    o.panel.title = o.ticket ? `${o.key} ${o.ticket.title}`.slice(0, 60) : o.key;
    await this.post(o);
  }

  /** Each required check and any other recorded on the task branch's latest commit. */
  private async checks(p: Project, branch: string | null): Promise<TicketAcc['checks']> {
    const required = p.config.gates.required;
    if (!branch) return required.map((gate) => ({ gate, status: 'skip' as const, summary: 'Not run yet' }));
    const sha = await runFile('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], p.root);
    const receipts = sha.code === 0 ? receiptsAt({ receipts: join(dirname(p.ledgerPath), 'receipts') } as RepoPaths, sha.stdout.trim()) : {};
    const gates = [...new Set([...required, ...Object.keys(receipts)])];
    return gates.map((gate) => receipts[gate] ? { gate, status: receipts[gate]!.status, summary: receipts[gate]!.summary, waived: !!receipts[gate]!.waived } : { gate, status: 'skip' as const, summary: 'Not run on this commit' });
  }

  private async post(o: Open): Promise<void> {
    const p = this.project(o);
    if (!p || !o.panel.visible) return;
    const row = this.hub.taskRows(p.root).find((r) => r.id === o.key) ?? null;
    const task = this.hub.ledger(p.root)?.tasks.find((t) => t.id === o.key) ?? null;
    const tracker = o.tracker !== null ? this.trackers.trackers(p)[o.tracker] : undefined;
    const model = ticketModel({
      project: p.root, tracker: o.tracker, trackerTitle: tracker ? this.trackers.title(tracker) : null, trackerKind: tracker?.kind ?? null, key: o.key,
      ticket: o.ticket, loading: o.loading, error: o.error, connect: o.connect, row, task, checks: task ? await this.checks(p, task.run?.branch ?? null) : [],
      signedInAs: o.tracker !== null ? await this.trackers.signedInAs(p, o.tracker) : null,
    });
    void o.panel.webview.postMessage({ type: 'state', model });
  }

  private async receive(o: Open, m: unknown): Promise<void> {
    if (!isFromWebview(m)) return;
    const p = this.project(o);
    if (!p) return;
    switch (m.type) {
      case 'ready': return this.post(o);
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

  private async act(o: Open, p: Project, action: string, text?: string): Promise<void> {
    if (action === 'refresh') return this.load(o);
    if (action === 'track') return this.track(o, p);
    if (action === 'waive') return this.waive(o, p, text ?? '');
    if (o.tracker === null || !o.ticket) return;
    const index = o.tracker;
    const done = (ok: boolean, error?: string) => void o.panel.webview.postMessage({ type: 'done', action, ok, error });
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
    if (client.kind === 'github') {
      // GitHub takes several assignees: a checklist of everyone who can be assigned.
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
    if (!task?.run?.branch || !p.config.gates.required.concat(Object.keys(await this.receiptsFor(p, task.run.branch))).includes(gate)) return;
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

  private async receiptsFor(p: Project, branch: string) {
    const sha = await runFile('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], p.root);
    return sha.code === 0 ? receiptsAt({ receipts: join(dirname(p.ledgerPath), 'receipts') } as RepoPaths, sha.stdout.trim()) : {};
  }

  /** Adds a tracker ticket to acc's ledger, so an agent can be dispatched to it. The ticket isn't changed. */
  private async track(o: Open, p: Project): Promise<void> {
    if (!o.ticket) return;
    const t = o.ticket;
    const input = [{
      source: { kind: t.kind, key: t.kind === 'github' ? `#${t.key.replace(/^GH-/i, '')}` : t.key, url: t.url },
      title: t.title, brief: t.markdown, labels: t.labels.map((l) => l.name),
    }];
    const dir = mkdtempSync(join(tmpdir(), 'acc-track-'));
    try {
      const file = join(dir, 'task.json');
      writeFileSync(file, JSON.stringify(input));
      const r = await this.acc(['import', '--file', file], p.root);
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n')[0] || 'acc import failed');
      await this.hub.loadTasks(true);
      void vscode.window.showInformationMessage(`${o.key} is now a task in acc. Dispatch it from here or the board.`);
    } catch (e) {
      void vscode.window.showErrorMessage(`Couldn't track ${o.key}: ${(e as Error).message}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    await this.post(o);
  }
}
