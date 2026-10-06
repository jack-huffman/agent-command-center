import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { replaceTracker, type Tracker, trackerForKey, withTracker } from '../../packages/core/src/config.ts';
import { ghEnv, isGh } from '../../packages/core/src/exec.ts';
import type { IntakeResult } from '../../packages/core/src/intake.ts';
import { AzureClient } from '../../packages/core/src/trackers/azure.ts';
import { AZURE_SCOPE, describe, type SignIn } from '../../packages/core/src/trackers/connect.ts';
import { GithubClient } from '../../packages/core/src/trackers/github.ts';
import { JiraClient } from '../../packages/core/src/trackers/jira.ts';
import { type Board, type Exec, movesInto, placeText, type Ticket, type TrackerClient, TrackerError, type Transition } from '../../packages/core/src/trackers/types.ts';
import { Pending } from '../webview/pending.ts';
import type { Hub, Project } from './hub.ts';
import { accImport, cardTracking, credKey, liveTrackKeys, outsideKeys, placeCandidates, repoKey, type TrackReply, type TrackState, trackTicket } from './logic.ts';
import { runFile } from './run.ts';

type AccRun = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

/** A ticket's Track (D-074): on its way, and why its last try didn't go. */
export type { TrackState };

/** What the board shows for one tracker: its board, or why there isn't one yet. */
export interface BoardState extends Loaded {
  /** Its cards being tracked, or whose last Track didn't go, by key (D-074). */
  tracking: Record<string, TrackState>;
}

interface Loaded {
  index: number;
  kind: Tracker['kind'];
  title: string;
  /** Where its tickets come from (D-072): the config's, until the board says it with the epic's name. */
  place: string;
  /** Tasks whose tickets left the place after work on them started, each named for a person (D-072). */
  left: string[];
  board: Board | null;
  error: string | null;
  /** A button that fixes the error, such as Sign in to Azure DevOps. */
  connect: { command: string; label: string; arg: string } | null;
  loading: boolean;
  /** Who the board acts as. */
  signedInAs: string | null;
}

/** Runs gh and friends with an argument list, feeding stdin when asked: comments travel that way, never as arguments. gh runs as acc's runner runs it (D-051). */
export const exec: Exec = (cmd, args, opts) => new Promise((resolve) => {
  const env = opts?.env ?? process.env;
  const child = execFile(cmd, args, { env: isGh(cmd) ? ghEnv(env) : env, timeout: 60_000, killSignal: isGh(cmd) ? 'SIGKILL' : 'SIGTERM', maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
    const raw = (err as { code?: unknown } | null)?.code;
    resolve({ code: err ? (typeof raw === 'number' ? raw : raw === 'ENOENT' ? 127 : 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (err && !stdout ? String(err.message) : '') });
  });
  if (opts?.input !== undefined) child.stdin?.end(opts.input);
});

const azureScopes = (tenant: string | null): string[] => [AZURE_SCOPE, ...(tenant ? [`VSCODE_TENANT:${tenant}`] : [])];
const b64 = (s: string) => Buffer.from(s).toString('base64');

/** A sign-in as the Connect page keeps it (GH-51). One kept before then has no method: Jira's is its token. */
type JiraCred = { kind: 'jira'; method?: 'token'; email: string; token: string };
type AzureCred = { kind: 'azure'; method: 'microsoft'; account: vscode.AuthenticationSessionAccountInformation; tenant: string | null } | { kind: 'azure'; method: 'pat'; token: string };
type Cred = JiraCred | AzureCred;

/** A tracker's host: a Jira site or an Azure organization, the part a sign-in is for. */
const hostOf = (t: Pick<Tracker, 'kind' | 'site' | 'organization'>): string => (t.kind === 'jira' ? t.site ?? '' : t.organization ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();

/**
 * The trackers each repo names in .acc/config.json, with their clients and boards. Sign-ins belong to
 * one repo (D-027): a client's Jira or Azure DevOps login never serves another client's repo. It never
 * changes a ticket on its own: every write here starts from a person's click (D-026).
 */
export class Trackers implements vscode.Disposable {
  private readonly clients = new Map<string, Promise<TrackerClient>>();
  private readonly boards = new Map<string, Loaded[]>();
  private readonly emitter = new vscode.EventEmitter<string>();
  /** Fires with a project root when its boards change. */
  readonly onDidChange = this.emitter.event;
  /** Tickets being tracked, and why each one's last try didn't go, by `${root}#${KEY}` (D-074). */
  private readonly tracking = new Pending<'track'>();
  private readonly trackEmitter = new vscode.EventEmitter<string>();
  /** Fires with a project root when one of its tickets starts or stops being tracked, so its pages say so. */
  readonly onDidTrack = this.trackEmitter.event;
  private readonly secrets: vscode.SecretStorage;
  private readonly hub: Hub;
  private readonly log: vscode.LogOutputChannel;
  private readonly acc: AccRun | null;

  constructor(secrets: vscode.SecretStorage, hub: Hub, log: vscode.LogOutputChannel, acc: AccRun | null = null) {
    this.secrets = secrets;
    this.hub = hub;
    this.log = log;
    this.acc = acc;
  }

  dispose(): void {
    this.emitter.dispose();
    this.trackEmitter.dispose();
  }

  /** A project's trackers. A GitHub tracker with no repo uses the project's own repo. */
  trackers(p: Project): Tracker[] {
    return p.config.trackers.map((t) => (t.kind === 'github' && !t.repo && p.config.github ? { ...t, repo: p.config.github.repo } : t));
  }

  title(t: Tracker): string {
    return t.kind === 'github' ? `GitHub · ${t.repo ?? '?'}` : t.kind === 'jira' ? `Jira · ${t.project}` : `Azure DevOps · ${t.project}`;
  }

  /** Where a tracker's tickets come from, as its config says (D-072). */
  place(t: Tracker): string {
    return placeText({ kind: t.kind, project: t.project, repo: t.repo, team: t.team, epic: t.epic, labels: t.labels, areaPath: t.areaPath });
  }

  /**
   * Which repo a sign-in belongs to: its GitHub repo when it has one, so every clone and worktree shares
   * it, or else its git directory.
   */
  repoKey(p: Project): string {
    return repoKey(p);
  }

  private async cred(p: Project, t: Tracker): Promise<Cred | null> {
    const raw = await this.secrets.get(credKey(p, t.kind, hostOf(t)));
    try {
      return raw ? (JSON.parse(raw) as Cred) : null;
    } catch {
      return null;
    }
  }

  /** Who a tracker acts as for this repo: the GitHub account, the Jira email, the Microsoft account. */
  async signedInAs(p: Project, index: number): Promise<string | null> {
    const t = this.trackers(p)[index];
    if (!t) return null;
    if (t.kind === 'github') return p.config.github?.account ?? null;
    const c = await this.cred(p, t);
    if (!c) return null;
    return c.kind === 'jira' ? c.email : c.method === 'microsoft' ? c.account.label : 'a personal access token';
  }

  /** The trackers this repo names but hasn't signed in to yet. GitHub signs in through gh, so it's never listed. */
  async missingSignIns(p: Project): Promise<string[]> {
    const out: string[] = [];
    for (const t of this.trackers(p)) if (t.kind !== 'github' && !(await this.cred(p, t))) out.push(this.title(t));
    return out;
  }

  /** Which tracker a ticket key belongs to: GH-12 to GitHub, AB-123 to Azure, MSP-7 to the Jira project MSP. */
  trackerFor(p: Project, key: string): number | null {
    return trackerForKey(this.trackers(p), key);
  }

  boardStates(root: string): BoardState[] {
    return (this.boards.get(root) ?? []).map((s) => ({
      ...s,
      tracking: cardTracking(s.board?.cards ?? [], (key) => this.trackState(root, key)),
    }));
  }

  /** Whether a ticket is being tracked now, and why its last Track didn't go (D-074). */
  trackState(root: string, key: string): TrackState {
    const k = `${root}#${key.toUpperCase()}`;
    return { busy: !!this.tracking.what(k), error: this.tracking.error(k) ?? null };
  }

  client(p: Project, index: number): Promise<TrackerClient> {
    const t = this.trackers(p)[index];
    if (!t) return Promise.reject(new TrackerError('not-found', 'That tracker is no longer in .acc/config.json.'));
    // The account is part of the key: switching it (D-028) must never reuse the old one's client.
    const key = `${p.root}#${index}#${JSON.stringify(t)}#${p.config.github?.account ?? ''}`;
    let c = this.clients.get(key);
    if (!c) {
      c = this.makeClient(p, t);
      this.clients.set(key, c);
      c.catch(() => this.clients.delete(key)); // a failed sign-in is tried again next time
    }
    return c;
  }

  private async makeClient(p: Project, t: Tracker): Promise<TrackerClient> {
    if (t.kind === 'github') {
      const account = p.config.github?.account;
      if (!t.repo || !account) throw new TrackerError('other', 'A GitHub tracker needs the project\'s "github" section (repo and account) in .acc/config.json.');
      return new GithubClient({ repo: t.repo, token: await this.ghToken(p.root, account), account, exec, project: typeof t.board === 'number' ? t.board : null, labels: t.labels });
    }
    const c = await this.cred(p, t);
    if (t.kind === 'jira') {
      if (!c || c.kind !== 'jira') throw new TrackerError('auth', `Sign in to Jira (${t.site}) for this repo to see its board and tickets.`);
      return new JiraClient({ site: t.site!, project: t.project!, email: c.email, token: c.token, board: typeof t.board === 'number' ? t.board : null, epic: t.epic });
    }
    if (!c || c.kind !== 'azure') throw new TrackerError('auth', `Sign in to Azure DevOps (${t.organization}) for this repo to see its board and work items.`);
    return new AzureClient({
      organization: t.organization!, project: t.project!, team: t.team, board: typeof t.board === 'string' ? t.board : null, prefix: t.prefix ?? 'AB', areaPath: t.areaPath,
      auth: c.method === 'pat' ? async () => `Basic ${b64(`:${c.token}`)}` : async () => {
        const s = await vscode.authentication.getSession('microsoft', azureScopes(c.tenant), { account: c.account, silent: true });
        if (!s) throw new TrackerError('auth', `The Microsoft sign-in this repo uses (${c.account.label}) has ended. Sign in to Azure DevOps again.`);
        return `Bearer ${s.accessToken}`;
      },
    });
  }

  private signInButton(p: Project, index: number, t: Tracker): BoardState['connect'] {
    return t.kind === 'github' ? null : { command: 'acc.trackers.signIn', label: t.kind === 'jira' ? 'Sign in to Jira' : 'Sign in to Azure DevOps', arg: JSON.stringify({ root: p.root, index }) };
  }

  /** Loads every board, or just one project's. Boards load side by side; each shows its own error. */
  async loadBoards(root?: string): Promise<void> {
    const projects = this.hub.projects.filter((p) => !root || p.root === root);
    await Promise.all(projects.map(async (p) => {
      const list = this.trackers(p);
      if (!list.length) {
        this.boards.delete(p.root);
        // Its last Track's reason goes with its boards, as any other project's does (D-074).
        this.forgetTracking();
        this.emitter.fire(p.root);
        return;
      }
      const prev = this.boards.get(p.root) ?? [];
      const states: Loaded[] = await Promise.all(list.map(async (t, index) => ({
        // The last board's place, with its epic's name, until this load says otherwise: no flicker every refresh.
        index, kind: t.kind, title: this.title(t), place: prev[index]?.board?.place ?? this.place(t), left: prev[index]?.left ?? [], board: prev[index]?.board ?? null,
        error: null, connect: null, loading: true, signedInAs: await this.signedInAs(p, index),
      })));
      this.boards.set(p.root, states);
      this.emitter.fire(p.root);
      await Promise.all(states.map(async (s) => {
        try {
          const client = await this.client(p, s.index);
          s.board = await client.board();
          s.place = s.board.place;
          s.error = null;
          await this.followPlace(p, s, client);
        } catch (e) {
          s.error = (e as Error).message;
          if (e instanceof TrackerError && e.kind === 'auth') s.connect = this.signInButton(p, s.index, list[s.index]!);
          this.log.warn(`[trackers] ${s.title}: ${s.error}`);
        } finally {
          s.loading = false;
        }
      }));
      this.forgetTracking();
      this.emitter.fire(p.root);
    }));
  }

  /** A card no board shows any more leaves its last Track's reason behind. One still on its way finishes first. */
  private forgetTracking(): void {
    this.tracking.forget(liveTrackKeys(this.tracking.inFlight(), this.boards));
  }

  /**
   * After a Jira or Azure DevOps board loads, asks its tracker about this repo's unfinished tasks from it
   * that the board doesn't show (D-072). acc intake removes the ones outside the place that never started,
   * and names the rest: those stay on the agent board, and this board says so. Only the Command Center
   * signs in to these trackers (D-066). A failed read never counts as outside (D-048), and nothing here
   * changes a ticket.
   */
  private async followPlace(p: Project, s: Loaded, client: TrackerClient): Promise<void> {
    if (s.kind === 'github' || !s.board || !this.acc) return;
    const keys = placeCandidates(this.hub.ledger(p.root)?.tasks ?? [], { kind: s.kind, index: s.index, cards: s.board.cards }, (key) => this.trackerFor(p, key));
    const outside = await outsideKeys(keys, (k) => client.outside(k));
    if (!outside.length) {
      s.left = [];
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'acc-place-'));
    try {
      const file = join(dir, 'outside.json');
      writeFileSync(file, JSON.stringify({ outside }));
      const r = await this.acc(['intake', s.kind, '--file', file, '--json'], p.root);
      if (r.code !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n')[0] || `acc intake ${s.kind} failed`);
      const res = JSON.parse(r.stdout) as IntakeResult;
      s.left = res.leftAlone.map((l) => l.note);
      if (res.removed.length) {
        this.log.info(`[trackers] ${s.title}: ${res.removed.join(', ')} left this repo's place before work started, so acc took them off the board.`);
        await this.hub.loadTasks(true);
      }
    } catch (e) {
      this.log.warn(`[trackers] ${s.title}: couldn't follow tickets that left the place: ${(e as Error).message}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async ticket(p: Project, index: number, key: string): Promise<Ticket> {
    return (await this.client(p, index)).ticket(key);
  }

  /**
   * Adds a ticket to acc's ledger, from its card or its page (D-074), so an agent can be dispatched to it.
   * It's read again, so one that has left the repo's place is refused, naming the place (D-072), then
   * `acc import` gets its title, description and labels. Nothing here changes the ticket (D-066). A second
   * Track for a ticket already on its way starts nothing.
   */
  track(p: Project, index: number, key: string): Promise<TrackReply> {
    const k = key.toUpperCase();
    const changed = () => {
      this.emitter.fire(p.root);
      this.trackEmitter.fire(p.root);
    };
    return trackTicket(`${p.root}#${k}`, this.tracking, {
      // A window that can't run acc says so before it asks the tracker anything.
      read: async () => {
        if (!this.acc) throw new Error('This window can\'t run acc.');
        return this.ticket(p, index, k);
      },
      importTasks: async (input) => {
        if (!this.acc) throw new Error('This window can\'t run acc.');
        return accImport(this.acc, p.root, input);
      },
      reload: () => this.hub.loadTasks(true),
      changed,
    });
  }

  /**
   * Moves a card to a column the way the tracker would. Azure sets the column itself; elsewhere it's a
   * transition whose target the column holds, picked by the person when there are several.
   */
  async move(p: Project, index: number, key: string, columnId: string): Promise<boolean> {
    const state = this.boardStates(p.root)[index];
    const column = state?.board?.columns.find((c) => c.id === columnId);
    const card = state?.board?.cards.find((c) => c.key === key);
    if (!state?.board || !column || !card) return false;
    if (column.statusIds.includes(card.status.id)) return false;
    const client = await this.client(p, index);
    if (client.moveToColumn) {
      await client.moveToColumn(card, column);
      return true;
    }
    const moves = movesInto(await client.transitions(key), column);
    let pick: Transition | undefined = moves[0];
    if (moves.length > 1) {
      const chosen = await vscode.window.showQuickPick(moves.map((m) => ({ label: m.name, description: `→ ${m.to.name}`, m })), { title: `Move ${key} to ${column.name}`, placeHolder: 'The workflow has more than one way there' });
      pick = chosen?.m;
    }
    if (!pick) {
      if (!moves.length) void vscode.window.showWarningMessage(`${state.kind === 'jira' ? 'Jira\'s workflow' : 'GitHub'} has no move from ${card.status.name} to ${column.name} for ${key}. Open the ticket to see where it can go.`);
      return false;
    }
    await client.transition(key, pick, card);
    return true;
  }


  // ------------------------------------------------------------ signing in, one repo at a time

  /**
   * One of the trackers that takes a sign-in: the one named, the only one, or the one a person picks.
   * Null when no project here has one.
   */
  async pickTracker(arg: unknown, title: string): Promise<{ p: Project; index: number; t: Tracker } | null> {
    if (typeof arg === 'string') {
      try {
        const { root, index } = JSON.parse(arg) as { root: string; index: number };
        const p = this.hub.project(root);
        const t = p && this.trackers(p)[index];
        if (p && t) return { p, index, t };
      } catch {
        // fall through to asking
      }
    }
    const choices = this.hub.projects.flatMap((p) => this.trackers(p).map((t, index) => ({ p, index, t }))).filter((c) => c.t.kind !== 'github');
    if (choices.length <= 1) return choices[0] ?? null;
    const pick = await vscode.window.showQuickPick(choices.map((c) => ({ label: this.title(c.t), description: c.p.name, detail: hostOf(c.t), c })), { title });
    return pick?.c ?? null;
  }

  async signOut(arg?: unknown): Promise<void> {
    const chosen = await this.pickTracker(arg, 'Sign out of which tracker?');
    if (!chosen) {
      void vscode.window.showInformationMessage('No project here has a Jira or Azure DevOps tracker to sign out of.');
      return;
    }
    const { p, t } = chosen;
    const c = await this.cred(p, t);
    await this.secrets.delete(credKey(p, t.kind, hostOf(t)));
    this.clients.clear();
    const msAccount = c?.kind === 'azure' && c.method === 'microsoft' ? ` Your Microsoft account (${c.account.label}) stays signed in to VSCode; manage it under Accounts.` : '';
    void vscode.window.showInformationMessage(`${p.name} is signed out of ${this.title(t)}.${msAccount}`);
    await this.loadBoards(p.root);
  }

  // ------------------------------------------------------------ for the Connect page (GH-51)

  /**
   * The sign-in this repo keeps for a host, ready for the Connect page's checks and lists, or null. A
   * Microsoft sign-in is asked for silently; one that has ended says so.
   */
  async storedSignIn(root: string, kind: string, host: string): Promise<SignIn | null> {
    const p = this.hub.project(root);
    const raw = p ? await this.secrets.get(credKey(p, kind, host.toLowerCase())) : undefined;
    let c: Record<string, unknown>;
    try {
      if (!raw) return null;
      c = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
    if (c.method === 'microsoft') {
      const account = c.account as vscode.AuthenticationSessionAccountInformation;
      const s = await vscode.authentication.getSession('microsoft', azureScopes((c.tenant as string | null) ?? null), { account, silent: true });
      if (!s) throw new TrackerError('auth', `The Microsoft sign-in this repo used (${account.label}) has ended. Sign in again.`);
      return { method: 'microsoft', fields: {}, header: `Bearer ${s.accessToken}`, gh: null };
    }
    // A Jira sign-in from before GH-51 didn't say its method: it's the only one Jira has.
    const method = typeof c.method === 'string' ? c.method : describe(kind)?.methods.find((m) => m.via === 'fields')?.id ?? '';
    const fields = Object.fromEntries(Object.entries(c).filter(([k, v]) => k !== 'kind' && k !== 'method' && typeof v === 'string')) as Record<string, string>;
    return { method, fields, header: null, gh: null };
  }

  /** Keeps a sign-in for this repo only (D-027), under the same key the boards read. */
  async storeSignIn(root: string, kind: string, host: string, cred: Record<string, unknown>): Promise<void> {
    const p = this.hub.project(root);
    if (!p) throw new TrackerError('other', 'That project isn\'t open here.');
    await this.secrets.store(credKey(p, kind, host.toLowerCase()), JSON.stringify(cred));
  }

  /** The repo's git user.email, which a Jira sign-in usually is. */
  async gitEmail(root: string): Promise<string | null> {
    const r = await runFile('git', ['config', 'user.email'], root, process.env, undefined, 10_000);
    return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  }

  /** A token for the project's GitHub account, from gh (D-007). */
  async ghToken(root: string, account: string): Promise<string> {
    const tok = await runFile('gh', ['auth', 'token', '-u', account], root, process.env, undefined, 20_000);
    if (tok.code === 127) throw new TrackerError('other', 'The GitHub CLI (gh) isn\'t installed.');
    if (tok.code !== 0 || !tok.stdout.trim()) throw new TrackerError('auth', `gh isn't logged in as ${account}. Run: gh auth login`);
    return tok.stdout.trim();
  }

  /**
   * VSCode's Microsoft sign-in, in the tenant that owns the host. It asks which account rather than reusing
   * whichever another repo picked (clearSessionPreference). VSCode draws that chooser itself.
   */
  async microsoft(host: string, spec: { scope: string; tenant: (host: string) => Promise<string | null> }): Promise<{ header: string; cred: Record<string, unknown> }> {
    const tenant = await spec.tenant(host);
    const s = await vscode.authentication.getSession('microsoft', [spec.scope, ...(tenant ? [`VSCODE_TENANT:${tenant}`] : [])], { createIfNone: true, clearSessionPreference: true });
    return { header: `Bearer ${s.accessToken}`, cred: { account: s.account, tenant } };
  }

  /**
   * Writes a tracker to the repo's own config: in place of the one at `index`, or added, replacing one for
   * the same project. Keys it doesn't name are kept, and those it names as null are taken out (D-072).
   */
  write(root: string, index: number | null, record: Record<string, unknown>): void {
    const file = join(root, '.acc', 'config.json');
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { trackers?: Record<string, unknown>[] };
    raw.trackers = index === null ? withTracker(raw.trackers ?? [], record) : replaceTracker(raw.trackers ?? [], index, record);
    writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  }

  /** A sign-in changed: every client starts again, and the project's boards reload. */
  async reload(root: string): Promise<void> {
    this.clients.clear();
    await this.loadBoards(root);
  }
}
