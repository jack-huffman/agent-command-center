import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { builderGatesFor, fullGates, requiredGates } from '../../packages/core/src/config.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import type { RepoPaths } from '../../packages/core/src/paths.ts';
import { receiptsAt } from '../../packages/core/src/receipts.ts';
import { latestVerdict, reviewCurrent } from '../../packages/core/src/review.ts';
import { signInLabel, type Ticket } from '../../packages/core/src/trackers/types.ts';
import type { Hub, Project } from './hub.ts';
import { type FromWebview, isFromWebview } from './model/messages.ts';
import type { Ref } from './model/shared.ts';
import { type CheckIn, type ReviewIn, ticketActionRefusal, ticketCheck, ticketModel, type TicketModel, ticketReview } from './model/task-page.ts';
import { htmlFor, isWebLink, type Panels, TabTheme } from './panels.ts';
import { MODAL_FAILED, modalTakes, taskOf } from './model/task-modal.ts';
import type { ThemeChoice } from './model/settings.ts';
import { runFile } from './run.ts';
import { showFileAt } from './runs.ts';
import type { Trackers } from './trackers.ts';
import type { ExtensionArea } from './area.ts';
import { addTaskArgs, draftFromOpen } from './logic/tasks.ts';
import { inProcessWords } from './logic/processes.ts';
import { ticketKey } from './logic/shared.ts';
import { type Excerpt, fileInCheckout, mergeBase, reviewExcerpts } from './logic/review-excerpts.ts';
import { openReview } from './rules.ts';
import { pickField } from './ticket-edits.ts';
import type { CriteriaActions } from './criteria.ts';
import type { PlanActions } from './plan.ts';
import type { VerifyActions } from './verify.ts';
import { ticketVerify } from './model/verify.ts';
import { type ChangesIn, ticketChanges, ticketPaths } from './model/changes.ts';
import { withFieldKept } from './model/changes-field.ts';
import { writtenFor } from '../../packages/core/src/field-drafts.ts';
import type { FieldActions } from './changes-field.ts';
import { run as runSync } from '../../packages/core/src/exec.ts';
import { teamKey } from './logic/team-key.ts';
import { branchFiles, IN_FLIGHT_STATES, plannedFiles } from '../../packages/core/src/overlap.ts';
import { repoPaths } from '../../packages/core/src/paths.ts';
import { type Team, teamOf } from '../../packages/core/src/team.ts';
import { ticketTeam } from './model/team.ts';
import type { RecordActions } from './record-changes.ts';
import { ticketRecords } from './model/record-changes.ts';
import type { ManifestActions } from './manifest.ts';
import { ticketManifest } from './model/manifest.ts';
import { wordingReply } from './model/sheet-wording.ts';
import type { DeployActions } from './ticket-deploy.ts';
import type { OrgActions } from './org-open.ts';
import type { BlockedAnswered } from './model/banners.ts';
import { testing } from './model/testing.ts';
import { openSteps } from '../../packages/core/src/change-steps.ts';
import { deployBlockers, ticketDeploy } from './model/ticket-deploy.ts';
import { deletedPaths } from './logic/ticket-deploy.ts';
import type { PlanProgressActions } from './plan-progress.ts';
import type { TalkActions } from './talk.ts';
import { type TicketTalk, ticketTalk } from './model/talk.ts';
import type { ConversationActions } from './conversation.ts';
import { PlansMaking } from './logic/conversation.ts';
import { answerRun, type SayRan } from './logic/ran.ts';

type AccRun = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;
type Reply = { ok: boolean; error?: string };
type AnswerAnalysis = (root: string, task: string, question: string, text: string) => Promise<Reply>;

/** A person's way with a ticket's draft updates, through acc (D-066): post it as you, discard it, or draft a question. */
export interface UpdateActions {
  post(root: string, id: string, text: string, again: boolean): Promise<Reply>;
  discard(root: string, id: string): Promise<Reply>;
  ask(root: string, task: string, question: string): Promise<Reply>;
}

/** Where a task's page is drawn (GH-158): its own tab, or the modal over the Command Center's Tasks board. */
interface TicketView {
  /** On screen, so a model posted now is drawn. */
  readonly visible: boolean;
  /** Draws the page from its model. */
  draw(model: TicketModel): void;
  /** Tells the page how something it sent went. */
  say(msg: Record<string, unknown>): void;
  /** Names it, as a tab's title. The modal names itself from the model. */
  name(text: string): void;
}

/** The Command Center's tab, as the modal over its Tasks board draws on it (GH-158). */
export type ModalHost = Pick<Panels, 'reply' | 'showing'>;

/** A task page's own tab, and the theme it keeps (GH-109). */
interface Tab {
  panel: vscode.WebviewPanel;
  theme: TabTheme;
}

interface Open {
  view: TicketView;
  /** Its own tab, or null for the modal. */
  tab: Tab | null;
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
  /** Its review's excerpts as last read (T-53), by the checkout, branch and verdict they were read for: a commit's change doesn't change. */
  excerpts: { key: string; value: (Excerpt | null)[] } | null;
  /** How wide the page last said it was (T-111), so its conversation opens beside it or as a tab; null before it says. */
  width: number | null;
  /** The part a link asked this page to open (T-134), stamped with when it asked: the page goes there once. */
  part: { part: string; at: number } | null;
}


/** Commands a ticket page may run: the ones its task's card offers, and Dispatch with… and Dispatch to the cloud, kept for one release to open the sheet (D-168). */
const ALLOWED = new Set(['acc.task.edit', 'acc.task.dispatch', 'acc.task.dispatchWith', 'acc.task.dispatchCloud', 'acc.task.dispatchAnyway', 'acc.task.stopWaiting', 'acc.task.dispatchAgain', 'acc.task.attach', 'acc.task.openInClaude', 'acc.task.watch', 'acc.task.resume', 'acc.task.review', 'acc.task.watchReview', 'acc.task.land', 'acc.task.openPr', 'acc.task.openWorktree', 'acc.task.abandon', 'acc.task.cleanup', 'acc.task.move', 'acc.task.block', 'acc.task.unblock', 'acc.task.analyze', 'acc.task.watchAnalysis', 'acc.trackers.signIn']);

/**
 * One editor tab per ticket, like the tracker's own ticket page: rendered description and comments,
 * status, assignee and labels, and acc's side of it. Every change is a person's click (D-026), and the
 * fields change only where the tracker opts in; acc's updates for it are drafts a person posts (D-066).
 */
export class TicketPanels implements vscode.Disposable {
  private readonly open = new Map<string, Open & { tab: Tab }>();
  /**
   * Each task's team as last read (T-162), by `<root>#<id>`, with the heads of the branches and the tasks in flight
   * it was read for: read again only when one moved, so the modal opened again, or its tab, doesn't wait for it.
   */
  private readonly teams = new Map<string, { key: string; value: Team | null }>();
  /** The task in the modal over the Command Center's Tasks board, if any (GH-158). */
  private modal: Open | null = null;
  private readonly ctx: vscode.ExtensionContext;
  /** Where the extension's files are, for a conversation's panel to draw its page from (T-111). */
  get extensionUri(): vscode.Uri {
    return this.ctx.extensionUri;
  }
  private readonly hub: Hub;
  private readonly trackers: Trackers;
  private readonly resolve: (command: string, ref: Ref, say?: SayRan) => unknown;
  private readonly acc: AccRun;
  private readonly answerAnalysis: AnswerAnalysis | null;
  private readonly updates: UpdateActions | null;
  private readonly editsChanged = new vscode.EventEmitter<void>();
  /** Opens a review's session page, as a suggested rule's finding does (T-53): set once the agent pages exist. */
  openReview: ((m: { project: string; task: string; sha: string }) => void) | null = null;
  /**
   * Dispatch's sheet (D-168) and the task sheet (T-74), set by the Tasks area: open shows one over the page
   * that asked, with `say`, and is true when the command is one that opens it; go is Dispatch's, save the task sheet's.
   */
  dispatch: {
    open(command: string, ref: Ref, say: (msg: Record<string, unknown>) => void): boolean;
    go(m: Extract<FromWebview, { type: 'dispatch-sheet-go' }>): void;
    /** The task sheet's Save (T-74), from Edit on this page; `say` tells this page how it went (T-80). */
    save(m: Extract<FromWebview, { type: 'task-sheet-go' }>, say: (msg: Record<string, unknown>) => void): void;
    /** Change on the sheet's status, assignee or labels (T-80), from Edit on this page. */
    field(m: Extract<FromWebview, { type: 'task-sheet-field' }>, say: (msg: Record<string, unknown>) => void): void;
  } | null = null;
  /** Drafted acceptance criteria (T-81), set by its area: the section's state, its buttons, and the sheet's own Draft. */
  criteria: CriteriaActions | null = null;
  /** Its plan's choices and approval (T-97), once that area is registered. */
  plan: PlanActions | null = null;
  /** Verify the developer's work (T-84), set by its area: the section's state, and its buttons. */
  verify: VerifyActions | null = null;
  /** Record changes (T-100), set by its area: Add a change made by hand, and a promotion's steps. */
  records: RecordActions | null = null;
  /** The tracker's changes field (T-105), set by its area: what the ticket's field says, the draft, and its Save. */
  fields: FieldActions | null = null;
  /** Manifest for this ticket (T-101), set by its area: the section's state, and its buttons. */
  manifest: ManifestActions | null = null;
  /** A ticket's deploy (T-138), set by its area: a deploy under way, where its work is, and Deploy…'s pick. */
  deploys: DeployActions | null = null;
  /** Its development org (T-161), set by its area: whether this machine is logged in to it, and Open. */
  orgs: OrgActions | null = null;
  /** A blocked banner's answer to its builder (T-168), set by its area: null once it's on its way, else why not. */
  answerBlocked: ((root: string, id: string, text: string) => Promise<string | null>) | null = null;
  /** Talk it through (T-98), set by its area: the conversation's state, and its buttons. */
  talk: TalkActions | null = null;
  /** The conversation's own panel (T-111), set by its area: opened beside a page, and redrawn with it. */
  conversation: ConversationActions | null = null;
  /** Draft the plan and Skip to the plan (T-111), set by the Tasks area: the plan made, with the conversation or without. */
  draftPlan: ((root: string, id: string, skip: boolean) => void) | null = null;
  /** The whole ticket's file for a conversation's first message (T-111), set by the Tasks area, which reads it for Make a plan. */
  planTicketFile: ((root: string, id: string) => Promise<{ file: string | null; remove: () => void }>) | null = null;
  /** Plans being made from this window (T-111): a page and the conversation show its ticket being read, then the plan. */
  readonly making = new PlansMaking((root) => this.refresh(root));
  /** The planning agent's progress (T-131), set by its area: a task's now, and Watch its session and Stop. */
  planProgress: PlanProgressActions | null = null;
  /** A page's unsent edit of an update began, changed or ended, so the Overview shows it. */
  readonly onDidEdit = this.editsChanged.event;

  constructor(ctx: vscode.ExtensionContext, hub: Hub, trackers: Trackers, resolve: (command: string, ref: Ref, say?: SayRan) => unknown, acc: AccRun, answerAnalysis: AnswerAnalysis | null = null, updates: UpdateActions | null = null) {
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
    for (const o of this.open.values()) o.tab.panel.dispose();
    this.editsChanged.dispose();
  }

  /**
   * The edit an open task page holds for an update and hasn't sent, found through the drafts the update
   * replaced too: what Post on that page would send. Only this window's pages, and only while open (GH-46).
   */
  edited(root: string, id: string, replaces: readonly string[] = []): string | null {
    for (const o of this.pages()) {
      if (o.project !== root) continue;
      for (const x of [id, ...replaces]) {
        const text = o.edits.get(x);
        if (text !== undefined) return text;
      }
    }
    return null;
  }

  /** Opens a ticket's page, or brings it forward. With no tracker given, the key decides which. */
  show(root: string, tracker: number | null | undefined, key: string, part?: string): void {
    const project = this.hub.project(root);
    if (!project) return;
    const index = tracker === undefined ? this.trackers.trackerFor(project, key) : tracker;
    const id = ticketKey(root, key);
    const existing = this.open.get(id);
    if (existing) {
      if (part) existing.part = { part, at: Date.now() };
      existing.tab.panel.reveal();
      void this.load(existing);
      return;
    }
    const base = vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel('acc.ticket', key, vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [base] });
    const icon = (theme: 'light' | 'dark') => vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'media', `acc-${theme}.svg`);
    panel.iconPath = { light: icon('light'), dark: icon('dark') };
    const theme = new TabTheme(panel, (t) => htmlFor(panel.webview, base, 'ticket', randomBytes(16).toString('base64'), key, t));
    const view: TicketView = {
      get visible() { return panel.visible; },
      draw: (model) => void panel.webview.postMessage({ type: 'state', model }),
      say: (msg) => void panel.webview.postMessage(msg),
      name: (text) => { panel.title = text; },
    };
    const o = { ...this.fresh(view, root, index, key), tab: { panel, theme } };
    if (part) o.part = { part, at: Date.now() };
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

  /**
   * Opens a task's page in the modal over the Command Center's Tasks board (GH-158), in place of the one it
   * showed. It's the tab's page: the same model, drawn by the same renderer, and its messages handled here
   * as the tab's are. Open as tab there sends what the card sent before: acc.task.show from the agent
   * board, which gives no tracker, or the ticket from a tracker's. With no tracker given, the key decides.
   */
  peek(host: ModalHost, root: string, tracker: number | null | undefined, key: string, part?: string): void {
    const project = this.hub.project(root);
    if (!project) return;
    const index = tracker === undefined ? this.trackers.trackerFor(project, key) : tracker;
    const tab = tracker === undefined ? { type: 'run', command: 'acc.task.show', ref: { project: root, task: key } } : { type: 'ticket', project: root, tracker, key };
    this.closeModal();
    const view: TicketView = {
      get visible() { return host.showing(); },
      // A model that arrives after the modal closed, or another opened, would open it again.
      draw: (model) => { if (this.modal?.view === view) host.reply({ type: 'task-modal', model, tab }); },
      say: (msg) => host.reply(msg),
      name: () => {},
    };
    const o = this.fresh(view, root, index, key);
    if (part) o.part = { part, at: Date.now() };
    this.modal = o;
    // A load that throws says so in the modal, which would otherwise wait (T-162).
    this.load(o).catch((e: unknown) => { if (this.modal === o) host.reply({ type: MODAL_FAILED, project: root, key: o.key, why: inProcessWords((e as Error)?.message ?? String(e)) }); });
  }

  /**
   * The task's page in a tab of its own (T-112), for its conversation to open beside: opened if no tab shows it,
   * and the modal over the board, if it shows this task, closed onto that tab.
   */
  ensureTab(root: string, key: string): void {
    const up = key.toUpperCase();
    if (!this.open.has(`${root}#${up}`)) this.show(root, undefined, up);
    const o = this.modal;
    if (o?.project !== root || o.key !== up) return;
    o.view.say({ type: 'task-modal-shut', project: root, key: up });
    this.closeModal(root, up);
  }

  /** The modal closed, or the tab under it did (GH-158): its edits go with it, as a closed tab's do. With a task named, only if it's that one. */
  closeModal(project?: string, key?: string): void {
    const o = this.modal;
    if (!o || (key !== undefined && (o.project !== project || o.key !== key.toUpperCase()))) return;
    this.modal = null;
    if (o.edits.size) this.editsChanged.fire();
  }

  /**
   * A message from the Command Center's page that's the modal's (GH-158), handled here as its tab's would
   * be. False for the rest, which are the page's own.
   */
  fromModal(m: FromWebview): boolean {
    const o = this.modal;
    if (!o || !modalTakes(o, m, ALLOWED)) return false;
    void this.receive(o, m);
    return true;
  }

  /** The Command Center's page was drawn afresh, as when its tab comes back: the modal it showed is drawn over it again. */
  modalReady(): void {
    if (this.modal) void this.post(this.modal);
  }

  /** A page that hasn't loaded yet. */
  private fresh(view: TicketView, root: string, tracker: number | null, key: string): Open {
    return { view, tab: null, project: root, tracker, key: key.toUpperCase(), ticket: null, loading: tracker !== null, error: null, outside: null, connect: null, edits: new Map(), excerpts: null, width: null, part: null };
  }

  /** Every page shown: each tab, and the modal (GH-158). */
  private pages(): Open[] {
    return [...this.open.values(), ...(this.modal ? [this.modal] : [])];
  }

  /** Settings changed the theme (GH-109): every task page restyles. The modal is in the Command Center's. */
  retheme(theme: ThemeChoice): void {
    for (const o of this.open.values()) o.tab.theme.set(theme);
    this.conversation?.retheme(theme);
  }

  /**
   * Re-draws every open page, the modal too, for instance after the ledger or an agent changed; and each
   * conversation's panel (T-111), so a change made on a page shows in its conversation, and the other way round.
   */
  refresh(root?: string): void {
    for (const o of this.pages()) if (!root || o.project === root) void this.post(o);
    this.conversation?.refresh(root);
  }

  /** The tasks whose page or conversation's panel is on show now (T-131): each tab, the modal, and each panel. */
  shownTasks(): { root: string; id: string }[] {
    return [...this.pages().filter((o) => o.view.visible).map((o) => ({ root: o.project, id: o.key })), ...(this.conversation?.shown() ?? [])];
  }

  /** Tells the task's pages on show, and its conversation's panel, a message such as its plan's progress (T-131). */
  tell(root: string, id: string, msg: Record<string, unknown>): void {
    for (const o of this.pages()) if (o.project === root && o.key === id.toUpperCase() && o.view.visible) o.view.say(msg);
    this.conversation?.tell(root, id, msg);
  }

  /** How wide the task's open page last said it was (T-111): its tab's, or the modal's; null when none says. */
  widthOf(root: string, key: string): number | null {
    return this.pages().find((o) => o.project === root && o.key === key.toUpperCase())?.width ?? null;
  }

  /**
   * A task's conversation with its planning agent (T-98, T-111), as its page's line and its panel draw it: the
   * same model in both places, so they agree. Null for a task that isn't kept, or past its build with nothing said.
   */
  talkModel(root: string, id: string): TicketTalk | null {
    const task = this.hub.ledger(root)?.tasks.find((t) => t.id === id.toUpperCase());
    if (!task || !this.talk) return null;
    const row = this.hub.taskRows(root).find((r) => r.id === task.id);
    return ticketTalk({ task, analysis: this.hub.analysis(root, task.id), analyzing: !!row?.analyzing, ...this.talk.state(root, task.id), ref: { project: root, task: task.id }, making: this.making.of(root, task.id), progress: this.planProgress?.of(root, task.id) ?? null });
  }

  private project(o: Open): Project | undefined {
    return this.hub.project(o.project);
  }

  /**
   * Reads the task and draws its page. The first draw comes as soon as its record is read, with the slower
   * parts still to come (T-162): its checks, its branch's changes, its review, its team and the org. The page
   * then draws again with them, and once more with the tracker's ticket where it has one.
   */
  private async load(o: Open): Promise<void> {
    const p = this.project(o);
    if (!p || o.tracker === null) {
      o.loading = false;
      await this.post(o, true);
      await settle();
      return this.post(o);
    }
    o.loading = true;
    await this.post(o, true);
    await settle();
    // The tracker is asked while git is: the ticket comes on the draw after, whichever is slower.
    const reading = this.readTicket(o, p, o.tracker);
    await this.post(o);
    await reading;
    // Its changes field (T-105) is read with the ticket, and the page redraws once it's read.
    if (o.ticket) this.fields?.load(p, o.tracker, o.key);
    o.view.name(o.ticket ? `${o.key} ${o.ticket.title}`.slice(0, 60) : o.key);
    await this.post(o);
  }

  /** Reads the task's ticket from its tracker, or why it can't be shown, into the page's state. */
  private async readTicket(o: Open, p: Project, tracker: number): Promise<void> {
    try {
      o.ticket = await this.trackers.ticket(p, tracker, o.key);
      o.error = null;
      o.outside = null;
      o.connect = null;
    } catch (e) {
      // Outside the repo's place (D-072): not shown, nor tracked, and said plainly rather than as a failure.
      const outside = (e as { kind?: string }).kind === 'outside';
      if (outside) o.ticket = null;
      o.outside = outside ? inProcessWords((e as Error).message) : null;
      o.error = outside ? null : inProcessWords((e as Error).message);
      const t = this.trackers.trackers(p)[tracker];
      o.connect = (e as { kind?: string }).kind === 'auth' && t && t.kind !== 'github'
        ? { command: 'acc.trackers.signIn', label: signInLabel(t.kind), arg: JSON.stringify({ root: p.root, index: tracker }) } : null;
    } finally {
      o.loading = false;
    }
  }

  /**
   * Each required check and any other recorded on the task branch's latest commit. Where the merge queue
   * runs the full check, a builder's lighter ones come first, then the full one, each saying which it is (GH-73).
   */
  private async checks(p: Project, branch: string | null, environment: string): Promise<CheckIn[]> {
    const lighter = builderGatesFor(p.config, environment);
    const builder = requiredGates(p.config, environment, 'builder');
    const full = fullGates(p.config);
    const required = [...new Set([...builder, ...full])];
    const scope = (gate: string): { scope?: 'builder' | 'merge' } => (!lighter ? {} : builder.includes(gate) ? { scope: 'builder' } : full.includes(gate) ? { scope: 'merge' } : {});
    const unrun = (gate: string) => (lighter && scope(gate).scope === 'merge' ? 'Not run on this commit: it runs once, in the merge queue' : 'Not run on this commit');
    // A ratchet carries its numbers, from the environment's floor to this commit's (GH-99).
    const ratchet = (gate: string) => p.config.gates.ratchets?.[gate];
    if (!branch) return required.map((gate) => ticketCheck(gate, null, lighter && scope(gate).scope === 'merge' ? unrun(gate) : 'Not run yet', scope(gate), ratchet(gate)));
    const receipts = await this.receiptsFor(p, branch);
    const gates = [...new Set([...required, ...Object.keys(receipts)])];
    return gates.map((gate) => ticketCheck(gate, receipts[gate] ?? null, unrun(gate), scope(gate), ratchet(gate)));
  }

  /**
   * Draws the page from what's known now. `first` draws only what the ledger and acc's own records hold, with
   * no git, tracker or org asked (T-162): the model says it's still filling, and the next draw fills it.
   */
  private async post(o: Open, first = false): Promise<void> {
    const p = this.project(o);
    if (!p || !o.view.visible) return;
    const row = this.hub.taskRows(p.root).find((r) => r.id === o.key) ?? null;
    const task = this.hub.ledger(p.root)?.tasks.find((t) => t.id === o.key) ?? null;
    const tracker = o.tracker !== null ? this.trackers.trackers(p)[o.tracker] : undefined;
    // The page's own load made this client, so it's cached; a client that failed to start says nothing of its fields, which is all three.
    const client = o.tracker !== null && !first ? await this.trackers.client(p, o.tracker).catch(() => null) : null;
    const changes = task && !first ? this.changes(p, task) : null;
    const manifest = task && !first && this.manifest && p.config.profile === 'salesforce' ? this.manifest.state(p.root, task.id) : null;
    const updates = this.hub.updates(p.root);
    const model = ticketModel({
      project: p.root, tracker: o.tracker, trackerTitle: tracker ? this.trackers.title(tracker) : null, trackerKind: tracker?.kind ?? null, key: o.key,
      ticket: o.ticket, loading: o.loading, error: o.error, outside: o.outside, connect: o.connect, row, task, checks: task && !first ? await this.checks(p, task.run?.branch ?? null, task.environment) : [],
      signedInAs: o.tracker !== null && !first ? await this.trackers.signedInAs(p, o.tracker) : null,
      analysis: task ? this.hub.analysis(p.root, task.id) : null,
      trackerEdits: this.edits(o, p), trackerFields: client?.fields, updates, boards: this.trackers.boardStates(p.root), github: p.config.github?.account ?? null,
      tracking: this.trackers.trackState(p.root, o.key).busy,
      review: task && !first ? await this.review(o, p, task) : null,
      ...(task && this.criteria ? this.criteria.state(p.root, task.id) : {}),
      manifest: task && manifest ? ticketManifest({ task, profile: p.config.profile, org: p.config.environments.find((e) => e.branch === task.environment || e.name === task.environment)?.org ?? null, ...manifest }) : null,
      verify: task && this.verify ? ticketVerify({ task, github: p.config.github?.repo ?? null, ...this.verify.state(p.root, task.id), updates: this.hub.updates(p.root).filter((u) => u.task === task.id) }) : null,
      changes: changes ? ticketChanges(changes) : null,
      team: task && !first ? ticketTeam(task, this.team(p, task)) : null,
    });
    if (first) return o.view.draw({ ...model, open: o.part, filling: true });
    // Its record changes (T-100), Talk it through (T-98) and its tracker's changes field (T-105), each a section of
    // its own: the field once read, with its draft update keeping each line a person wrote there.
    const analysis = task ? this.hub.analysis(p.root, task.id) : null;
    const talk = task ? this.talkModel(p.root, task.id) : null;
    // The part a link asked for rides on each draw, stamped, so the page goes there once (T-134).
    o.view.draw(task ? {
      ...model, open: o.part,
      records: ticketRecords({ task, analysis, profile: p.config.profile, environments: p.config.environments }),
      // Its deploy (T-138) waits while its own checks fail, unaccepted, or it conflicts with its environment.
      deploy: this.deploys ? ticketDeploy({
        config: p.config, task, tasks: this.hub.ledger(p.root)?.tasks ?? [], deploying: this.deploys.deploying(p.root, task.id),
        failing: deployBlockers(model.acc?.checks ?? []), conflicts: model.acc?.conflicts ? task.environment : null, stepsLeft: openSteps(task).length,
        where: this.deploys.kept(p.root, task.id), reading: (env) => this.deploys!.reading(p.root, task.id, env),
      }) : null,
      // Its Testing tab (T-161): its development org, and once its builder's deploy there passed, Open and the steps.
      testing: testing(p.config, task, (branch) => this.orgs?.notHere(p.root, branch) ?? false),
      talk,
      field: changes && o.tracker !== null && o.ticket ? this.fields?.model(p, o.tracker, task, ticketPaths(changes), updates, manifest?.manifest ?? null) ?? null : null,
      updates: this.fields ? withFieldKept(model.updates, this.fields.read(p, task.id), writtenFor(updates, task.id)) : model.updates,
    } : { ...model, open: o.part });
  }

  /**
   * What its Planned changes, then Changes (T-99), are drawn from: the plan's paths, and while it's in flight,
   * what its branch has changed so far, read from git; once it's done, what acc kept with it when it merged.
   */
  private changes(p: Project, task: Task): ChangesIn {
    const branch = task.run?.branch;
    const live = branch && IN_FLIGHT_STATES.includes(task.state) ? branchFiles(runSync, p.root, task.environment, branch, task.run?.worktree) : null;
    return { task, profile: p.config.profile, planned: plannedFiles(this.hub.analysis(p.root, task.id), p.root), live, ...(live ? { deleted: deletedPaths(runSync, p.root, branch!, task.run?.worktree, live) } : {}) };
  }

  /**
   * Its team (T-103), read from git and the ledger while it's in flight: the tasks it shares files with now,
   * and the merges its branch doesn't hold yet, as this clone last fetched them. Null when git can't say.
   */
  private team(p: Project, task: Task): Team | null {
    // A task out of flight has no team: its kept read goes too, so the map holds only tasks in flight.
    if (!IN_FLIGHT_STATES.includes(task.state)) { this.teams.delete(`${p.root}#${task.id}`); return null; }
    const ledger = this.hub.ledger(p.root);
    if (!ledger) return null;
    // Read again only when a branch moved or a task in flight changed: a task many merges behind takes git seconds (T-162).
    const key = teamKey(runSync, p.root, ledger.tasks);
    const at = `${p.root}#${task.id}`;
    const kept = this.teams.get(at);
    if (key !== null && kept?.key === key) return kept.value;
    let value: Team | null;
    try {
      value = teamOf(repoPaths(p.root, runSync), p.config, ledger, runSync, task.id);
    } catch {
      value = null;
    }
    if (key !== null) this.teams.set(at, { key, value });
    return value;
  }

  /**
   * The task's latest review, as its page is given it (T-53): whether it's on the latest commit, whether its
   * checkout is there, and each finding's excerpt, read in the checkout against the merge base with its
   * environment's branch. Git isn't asked when the page shows no Review block, nor again for the same verdict.
   */
  private async review(o: Open, p: Project, task: Task): Promise<ReviewIn | null> {
    const paths = { reviews: join(dirname(p.ledgerPath), 'reviews') } as RepoPaths;
    const verdict = latestVerdict(paths, task.id);
    if (!verdict) return null;
    const head = p.worktrees.find((w) => w.branch === task.run?.branch)?.head ?? '';
    const checkout = task.run?.worktree ?? null;
    const there = !!checkout && existsSync(checkout);
    const shell: ReviewIn = { verdict, current: reviewCurrent(paths, task, verdict, head), checkout: there, excerpts: [] };
    if (!checkout || !there || !ticketReview(p.root, task.state, shell)) return shell;
    const branch = p.config.environments.find((e) => e.name === task.environment)?.branch ?? task.environment;
    const key = [checkout, branch, verdict.sha, verdict.at].join('\0');
    if (o.excerpts?.key !== key) {
      const git = (args: string[], cwd: string) => runFile('git', args, cwd);
      const base = await mergeBase(git, checkout, branch, verdict.sha);
      o.excerpts = { key, value: await reviewExcerpts(git, checkout, base, verdict.sha, verdict.findings) };
    }
    return { ...shell, excerpts: o.excerpts.value };
  }

  /**
   * A click on a review finding's file and line (T-53): the file opens there, in the task's checkout. A path
   * outside the checkout is refused, and so is a click for another task, or one whose checkout is gone.
   */
  private async openFile(o: Open, p: Project, m: Extract<FromWebview, { type: 'review-file' }>): Promise<void> {
    if (m.project !== o.project || m.task.toUpperCase() !== o.key) return;
    return openReviewFile(o.key, this.hub.ledger(p.root)?.tasks.find((t) => t.id === o.key)?.run?.worktree, m.file, m.line);
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
      case 'ready': o.tab?.theme.ready(); return this.post(o);
      // Refresh draws again from the ledger: it reads no org (T-167).
      case 'refresh': return this.load(o);
      case 'open': if (isWebLink(m.url)) void vscode.env.openExternal(vscode.Uri.parse(m.url)); return;
      case 'ticket': return this.show(m.project, m.tracker, m.key);
      case 'run':
        // Dispatch (D-168) and Edit (T-74) open their sheets over this page, the tab or the modal, not over the Command Center.
        // Every one is answered (T-147), so the button that sent it stops working: a sheet opened is an answer too.
        await answerRun(m.command, m.ref, (say) => {
          if (!ALLOWED.has(m.command)) return { ok: false, error: 'This page can\'t do that.' };
          return this.dispatch?.open(m.command, m.ref, (msg) => o.view.say(msg)) ? undefined : this.resolve(m.command, m.ref, say);
        }, (msg) => o.view.say({ ...msg }));
        return;
      case 'dispatch-sheet-go': this.dispatch?.go(m); return;
      case 'task-sheet-go': this.dispatch?.save(m, (msg) => o.view.say(msg)); return;
      case 'task-sheet-field': this.dispatch?.field(m, (msg) => o.view.say(msg)); return;
      // The sheet's description, to check its acceptance criteria (T-148).
      case 'task-sheet-wording': o.view.say(wordingReply(m)); return;
      // Drafted acceptance criteria (T-81): this page's own task only.
      case 'criteria-draft': case 'criteria-update': case 'criteria-sheet':
        if (m.project === o.project && m.task.toUpperCase() === o.key) await this.criteria?.act(m, (msg) => o.view.say(msg));
        return;
      case 'task-sheet-criteria': await this.criteria?.sheet(m, (msg) => o.view.say(msg)); return;
      // Its plan's choices and approval (T-97): this page's own task only.
      case 'plan-choose': case 'plan-approve': case 'plan-split':
        if (m.project === o.project && m.task.toUpperCase() === o.key) await this.plan?.act(m, (msg) => o.view.say(msg));
        return;
      // Talk it through (T-98): this page's own task only.
      case 'talk-send': case 'talk-use': case 'talk-claude': case 'talk-answers':
        if (m.project === o.project && m.task.toUpperCase() === o.key) await this.talk?.act(m, (msg) => o.view.say(msg));
        return;
      // Watch its session and Stop on the planning agent's progress (T-131): this page's own task only.
      case 'plan-watch': case 'plan-stop':
        if (m.project === o.project && m.task.toUpperCase() === o.key) await this.planProgress?.act(m);
        return;
      // Its conversation's own panel (T-111): Open conversation, Discuss and Talk it through open it beside this page, or as a tab when it's narrow.
      case 'conversation-open':
        if (m.project === o.project && m.task.toUpperCase() === o.key) this.conversation?.open(o.project, o.key, { about: m.about, width: o.width });
        return;
      case 'page-width':
        if (m.project === o.project && m.task.toUpperCase() === o.key) o.width = m.width;
        return;
      // Verify the developer's work (T-84): this page's own task only.
      case 'verify-run': case 'verify-clear':
        if (m.project === o.project && m.task.toUpperCase() === o.key) await this.verify?.act(m, (msg) => o.view.say(msg));
        return;
      // Record changes (T-100): this page's own task only.
      case 'record-add': case 'record-step':
        if (m.project === o.project && m.task.toUpperCase() === o.key) await this.records?.act(m, (msg) => o.view.say(msg));
        return;
      // Deploy…'s pick, which starts the deploy guide's agent (T-158), and Check this org (T-167): this page's own task only.
      case 'deploy-guide': case 'where-check':
        if (m.project === o.project && m.task.toUpperCase() === o.key) await this.deploys?.act(m);
        return;
      // Open <environment>, or a component a step names (T-161): this page's own task only.
      case 'org-open':
        if (m.project === o.project && m.task.toUpperCase() === o.key) await this.orgs?.open(m.project, m.task, m.path);
        return;
      // Manifest for this ticket (T-101): this page's own task only.
      case 'manifest-build': case 'manifest-retrieve': case 'manifest-commit': case 'manifest-file': case 'manifest-diff':
        if (m.project === o.project && m.task.toUpperCase() === o.key) await this.manifest?.act(m, (msg) => o.view.say(msg));
        return;
      // A blocked banner's answer (T-168): this page's own task only, and the page hears whether it went.
      case 'blocked-answer':
        if (m.project === o.project && m.task.toUpperCase() === o.key) await this.answerBlocked_(o, m);
        return;
      case 'toolbar':
        if (ALLOWED.has(m.command)) await vscode.commands.executeCommand(m.command, m.arg);
        return;
      case 'ticket-action': return this.act(o, p, m.action, m.text);
      case 'review-file': return this.openFile(o, p, m);
      // From the tab: the modal's goes to the Command Center's own handler, as a suggested rule's does.
      case 'rule-open-review': this.openReview?.(m); return;
      default: return;
    }
  }

  /** Gives a blocked banner's answer to its builder (T-168), and tells the page it went, or why it didn't. */
  private async answerBlocked_(o: Open, m: Extract<FromWebview, { type: 'blocked-answer' }>): Promise<void> {
    const why = this.answerBlocked ? await this.answerBlocked(m.project, m.task, m.text).catch((e: unknown) => (e as Error).message) : 'This page can\'t write to builders.';
    o.view.say({ type: 'blocked-answered', project: m.project, task: m.task, item: m.item, ok: !why, ...(why ? { error: why } : {}) } satisfies BlockedAnswered);
  }

  /**
   * A person's answer to one of this page's own task's questions (D-052). The page shows it's sending
   * until the question goes, so every answer gets a reply: done, or why it wasn't recorded.
   */
  private async answer(o: Open, m: Extract<FromWebview, { type: 'analysis-answer' }>): Promise<void> {
    const done = (r: { ok: boolean; error?: string }) => o.view.say({ type: 'done', action: 'analysis-answer', project: m.project, task: m.task, question: m.question, ...r });
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
    const done = (r: Reply) => o.view.say({ type: 'done', action: m.type, project: m.project, ...which, ...r });
    const task = m.type === 'update-ask' ? m.task : taskOf(m.id);
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
    if (m.project !== o.project || taskOf(m.id) !== o.key) return;
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
    const done = (ok: boolean, error?: string) => o.view.say({ type: 'done', action, ok, error });
    // A client's tracker is theirs: its fields change from here only where it opts in (D-066). Comments stay.
    const refused = ticketActionRefusal(action, this.edits(o, p));
    if (refused) return done(false, refused);
    try {
      const client = await this.trackers.client(p, index);
      let changed = false;
      if (action === 'comment') {
        await client.comment(o.key, text ?? '');
        changed = true;
      } else if (action === 'status' || action === 'assign' || action === 'labels') {
        changed = await pickField(client, o.key, o.ticket!, action);
      }
      done(true);
      if (changed) {
        await this.load(o);
        void this.trackers.loadBoards(p.root);
      }
    } catch (e) {
      const msg = inProcessWords((e as Error).message);
      done(false, msg);
      void vscode.window.showErrorMessage(`${o.key}: ${msg}`);
    }
  }

  /** A person sets a failing check aside on the task's latest commit, with a reason (D-031). */
  private async waive(o: Open, p: Project, gate: string): Promise<void> {
    const task = this.hub.ledger(p.root)?.tasks.find((t) => t.id === o.key);
    if (!task?.run?.branch || !fullGates(p.config).concat(requiredGates(p.config, task.environment, 'builder'), Object.keys(await this.receiptsFor(p, task.run.branch))).includes(gate)) return;
    const reason = await vscode.window.showInputBox({
      title: `Accept ${gate} anyway for ${task.id}?`,
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
      void vscode.window.showWarningMessage(`Couldn't waive ${gate}: ${inProcessWords(msg)}`);
    } else {
      void vscode.window.showInformationMessage(`${gate} is waived on ${task.id}'s latest commit.${task.state === 'blocked' ? ' Move it to In review when you\'re ready.' : ''}`);
    }
    await this.hub.loadTasks(true);
    await this.post(o);
  }

  /**
   * A person drafts a task from a still-open line of the task's note (D-106): the title and brief come
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
      void vscode.window.showWarningMessage(`Couldn't make the task: ${inProcessWords(out.message ?? ((r.stderr || r.stdout).trim().split('\n')[0] ?? ''))}`);
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
    if (r.ok) void vscode.window.showInformationMessage(`${o.key} is in your work. Make a plan or build it from here or from My work.`);
    else if ('error' in r) void vscode.window.showErrorMessage(`Couldn't add ${o.key} to your work: ${r.error}`);
    await this.post(o);
  }
}

/**
 * A review finding's file, opened at its line in the task's checkout: from its page (T-53), and from the
 * output panel (T-63). A checkout that is gone, or a path outside it, is refused with why.
 */
export async function openReviewFile(key: string, checkout: string | undefined, file: string, line: number): Promise<void> {
  if (!checkout || !existsSync(checkout)) {
    void vscode.window.showWarningMessage(`${key}'s checkout is gone, so its files don't open here.`);
    return;
  }
  const path = fileInCheckout(checkout, file);
  if (!path) {
    void vscode.window.showWarningMessage(`${file} isn't inside ${key}'s checkout, so it doesn't open.`);
    return;
  }
  await showFileAt(path, file, line - 1);
}

export const area: ExtensionArea = {
  register({ hub, panels, pages, tickets, answerAnalysis, updates, receive }) {
    tickets.openReview = (m) => openReview(hub, pages, m);
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

/** Lets what was posted go before the slower reads start (T-162): git run synchronously would hold it back. */
const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

