import { execFile } from 'node:child_process';
import * as vscode from 'vscode';
import type { Tracker } from '../../packages/core/src/config.ts';
import { GithubClient } from '../../packages/core/src/trackers/github.ts';
import { JiraClient } from '../../packages/core/src/trackers/jira.ts';
import { type Board, type Exec, movesInto, type Ticket, type TrackerClient, TrackerError, type Transition } from '../../packages/core/src/trackers/types.ts';
import type { Hub, Project } from './hub.ts';
import { runFile } from './run.ts';

/** What the board shows for one tracker: its board, or why there isn't one yet. */
export interface BoardState {
  index: number;
  kind: Tracker['kind'];
  title: string;
  board: Board | null;
  error: string | null;
  /** A button that fixes the error, such as Connect to Jira. */
  connect: { command: string; label: string; arg: string } | null;
  loading: boolean;
}

/** Runs gh and friends with an argument list, feeding stdin when asked: comments travel that way, never as arguments. */
export const exec: Exec = (cmd, args, opts) => new Promise((resolve) => {
  const child = execFile(cmd, args, { env: opts?.env ?? process.env, timeout: 60_000, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
    const raw = (err as { code?: unknown } | null)?.code;
    resolve({ code: err ? (typeof raw === 'number' ? raw : raw === 'ENOENT' ? 127 : 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (err && !stdout ? String(err.message) : '') });
  });
  if (opts?.input !== undefined) child.stdin?.end(opts.input);
});

const secretKey = (site: string) => `acc.jira:${site.replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase()}`;
const TOKEN_PAGE = 'https://id.atlassian.com/manage-profile/security/api-tokens';

/**
 * The trackers each project names in .acc/config.json, with their clients and boards. It never changes a
 * ticket on its own: every write here starts from a person's click on the ticket page or the board (D-026).
 */
export class Trackers implements vscode.Disposable {
  private readonly clients = new Map<string, Promise<TrackerClient>>();
  private readonly boards = new Map<string, BoardState[]>();
  private readonly emitter = new vscode.EventEmitter<string>();
  /** Fires with a project root when its boards change. */
  readonly onDidChange = this.emitter.event;
  private readonly secrets: vscode.SecretStorage;
  private readonly hub: Hub;
  private readonly log: vscode.OutputChannel;

  constructor(secrets: vscode.SecretStorage, hub: Hub, log: vscode.OutputChannel) {
    this.secrets = secrets;
    this.hub = hub;
    this.log = log;
  }

  dispose(): void {
    this.emitter.dispose();
  }

  /** A project's trackers. A GitHub tracker with no repo uses the project's own repo. */
  trackers(p: Project): Tracker[] {
    return p.config.trackers.map((t) => (t.kind === 'github' && !t.repo && p.config.github ? { ...t, repo: p.config.github.repo } : t));
  }

  /** Which tracker a ticket key belongs to: GH-12 to the GitHub one, MSP-7 to the Jira project MSP. */
  trackerFor(p: Project, key: string): number | null {
    const list = this.trackers(p);
    const gh = /^GH-\d+$/i.test(key);
    const i = list.findIndex((t) => (gh ? t.kind === 'github' : t.kind === 'jira' && !!t.project && key.toUpperCase().startsWith(`${t.project.toUpperCase()}-`)));
    return i >= 0 ? i : null;
  }

  boardStates(root: string): BoardState[] {
    return this.boards.get(root) ?? [];
  }

  client(p: Project, index: number): Promise<TrackerClient> {
    const t = this.trackers(p)[index];
    if (!t) return Promise.reject(new TrackerError('not-found', 'That tracker is no longer in .acc/config.json.'));
    const key = `${p.root}#${index}#${t.kind}#${t.repo ?? t.site}#${t.project}#${t.board}`;
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
      const tok = await runFile('gh', ['auth', 'token', '-u', account], p.root, process.env, undefined, 20_000);
      if (tok.code === 127) throw new TrackerError('other', 'The GitHub CLI (gh) isn\'t installed.');
      if (tok.code !== 0 || !tok.stdout.trim()) throw new TrackerError('auth', `gh isn't logged in as ${account}. Run: gh auth login`);
      return new GithubClient({ repo: t.repo, token: tok.stdout.trim(), account, exec, project: t.board });
    }
    const stored = await this.secrets.get(secretKey(t.site!));
    if (!stored) throw new TrackerError('auth', `Connect to Jira (${t.site}) to see its board and tickets.`);
    const { email, token } = JSON.parse(stored) as { email: string; token: string };
    return new JiraClient({ site: t.site!, project: t.project!, email, token, board: t.board });
  }

  /** Loads every board, or just one project's. Boards load side by side; each shows its own error. */
  async loadBoards(root?: string): Promise<void> {
    const projects = this.hub.projects.filter((p) => !root || p.root === root);
    await Promise.all(projects.map(async (p) => {
      const list = this.trackers(p);
      if (!list.length) {
        this.boards.delete(p.root);
        return;
      }
      const prev = this.boards.get(p.root) ?? [];
      const states: BoardState[] = list.map((t, index) => ({
        index, kind: t.kind, title: t.kind === 'github' ? `GitHub · ${t.repo ?? '?'}` : `Jira · ${t.project}`,
        board: prev[index]?.board ?? null, error: null, connect: null, loading: true,
      }));
      this.boards.set(p.root, states);
      this.emitter.fire(p.root);
      await Promise.all(states.map(async (s) => {
        try {
          s.board = await (await this.client(p, s.index)).board();
          s.error = null;
        } catch (e) {
          s.error = (e as Error).message;
          const t = list[s.index]!;
          if (e instanceof TrackerError && e.kind === 'auth' && t.kind === 'jira') s.connect = { command: 'acc.jira.connect', label: 'Connect to Jira', arg: t.site! };
          this.log.appendLine(`[trackers] ${s.title}: ${s.error}`);
        } finally {
          s.loading = false;
        }
      }));
      this.emitter.fire(p.root);
    }));
  }

  async ticket(p: Project, index: number, key: string): Promise<Ticket> {
    return (await this.client(p, index)).ticket(key);
  }

  /**
   * Moves a card to a column the way the tracker would: a transition whose target the column holds.
   * When the workflow offers several, the person picks one; when it offers none, it says so.
   */
  async move(p: Project, index: number, key: string, columnId: string): Promise<boolean> {
    const state = this.boardStates(p.root)[index];
    const column = state?.board?.columns.find((c) => c.id === columnId);
    const card = state?.board?.cards.find((c) => c.key === key);
    if (!state?.board || !column || !card) return false;
    if (column.statusIds.includes(card.status.id)) return false;
    const client = await this.client(p, index);
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

  // ------------------------------------------------------------ Jira sign-in

  /** Asks for the email and API token, checks them against Jira, and keeps them in VSCode's secret storage. */
  async connectJira(site: string): Promise<boolean> {
    const open = 'Create a token';
    void vscode.window.showInformationMessage(`Jira needs an API token for ${site}. Create one at id.atlassian.com, then paste it here.`, open).then((a) => {
      if (a === open) void vscode.env.openExternal(vscode.Uri.parse(TOKEN_PAGE));
    });
    const email = await vscode.window.showInputBox({ title: `Connect to Jira (${site}), 1 of 2`, prompt: 'The email you sign in to Jira with', ignoreFocusOut: true, validateInput: (v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? null : 'An email address') });
    if (!email) return false;
    const token = await vscode.window.showInputBox({ title: `Connect to Jira (${site}), 2 of 2`, prompt: `An API token from ${TOKEN_PAGE}`, password: true, ignoreFocusOut: true, validateInput: (v) => (v.trim().length >= 16 ? null : 'Paste the whole token') });
    if (!token) return false;
    const project = this.hub.projects.flatMap((p) => this.trackers(p)).find((t) => t.kind === 'jira' && t.site === site)?.project ?? '';
    try {
      const me = await new JiraClient({ site, project, email: email.trim(), token: token.trim() }).me();
      await this.secrets.store(secretKey(site), JSON.stringify({ email: email.trim(), token: token.trim() }));
      this.clients.clear();
      void vscode.window.showInformationMessage(`Connected to Jira as ${me.name}.`);
      await this.loadBoards();
      return true;
    } catch (e) {
      void vscode.window.showErrorMessage(`Couldn't connect to Jira: ${(e as Error).message}`);
      return false;
    }
  }

  async disconnectJira(site?: string): Promise<void> {
    const sites = [...new Set(this.hub.projects.flatMap((p) => this.trackers(p)).filter((t) => t.kind === 'jira').map((t) => t.site!))];
    const chosen = site ?? (sites.length === 1 ? sites[0] : await vscode.window.showQuickPick(sites, { title: 'Disconnect from which Jira site?' }));
    if (!chosen) return;
    await this.secrets.delete(secretKey(chosen));
    this.clients.clear();
    void vscode.window.showInformationMessage(`Disconnected from ${chosen}. Its token is gone from this machine.`);
    await this.loadBoards();
  }
}
