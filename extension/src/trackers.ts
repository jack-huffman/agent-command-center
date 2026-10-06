import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import * as vscode from 'vscode';
import { type Tracker, trackerForKey, withTracker } from '../../packages/core/src/config.ts';
import { ghEnv, isGh } from '../../packages/core/src/exec.ts';
import { AzureClient, azureBoards, azureProjects, azureTeams, azureWhoAmI, tenantOf } from '../../packages/core/src/trackers/azure.ts';
import { GithubClient } from '../../packages/core/src/trackers/github.ts';
import { JiraClient, jiraBoards, jiraProjects } from '../../packages/core/src/trackers/jira.ts';
import { type Board, type Exec, movesInto, type Person, type Ticket, type TrackerClient, TrackerError, type Transition } from '../../packages/core/src/trackers/types.ts';
import type { Hub, Project } from './hub.ts';
import { parseHost } from './logic.ts';
import { runFile } from './run.ts';

/** What the board shows for one tracker: its board, or why there isn't one yet. */
export interface BoardState {
  index: number;
  kind: Tracker['kind'];
  title: string;
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

/** Azure DevOps' own resource, as a Microsoft sign-in scope. */
const AZURE_SCOPE = '499b84ac-1321-427f-aa17-267ca6975798/.default';
const azureScopes = (tenant: string | null): string[] => [AZURE_SCOPE, ...(tenant ? [`VSCODE_TENANT:${tenant}`] : [])];
const JIRA_TOKENS = 'https://id.atlassian.com/manage-profile/security/api-tokens';
const b64 = (s: string) => Buffer.from(s).toString('base64');

type JiraCred = { kind: 'jira'; email: string; token: string };
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
  private readonly boards = new Map<string, BoardState[]>();
  private readonly emitter = new vscode.EventEmitter<string>();
  /** Fires with a project root when its boards change. */
  readonly onDidChange = this.emitter.event;
  private readonly secrets: vscode.SecretStorage;
  private readonly hub: Hub;
  private readonly log: vscode.LogOutputChannel;

  constructor(secrets: vscode.SecretStorage, hub: Hub, log: vscode.LogOutputChannel) {
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

  title(t: Tracker): string {
    return t.kind === 'github' ? `GitHub · ${t.repo ?? '?'}` : t.kind === 'jira' ? `Jira · ${t.project}` : `Azure DevOps · ${t.project}`;
  }

  /**
   * Which repo a sign-in belongs to: its GitHub repo when it has one, so every clone and worktree shares
   * it, or else its git directory.
   */
  repoKey(p: Project): string {
    return p.config.github ? `github:${p.config.github.repo.toLowerCase()}` : `git:${dirname(dirname(p.ledgerPath))}`;
  }

  private credKey(p: Project, kind: 'jira' | 'azure', host: string): string {
    return `acc.cred:${this.repoKey(p)}:${kind}:${host}`;
  }

  private async cred(p: Project, t: Tracker): Promise<Cred | null> {
    const raw = await this.secrets.get(this.credKey(p, t.kind as 'jira' | 'azure', hostOf(t)));
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
    return this.boards.get(root) ?? [];
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
      const tok = await runFile('gh', ['auth', 'token', '-u', account], p.root, process.env, undefined, 20_000);
      if (tok.code === 127) throw new TrackerError('other', 'The GitHub CLI (gh) isn\'t installed.');
      if (tok.code !== 0 || !tok.stdout.trim()) throw new TrackerError('auth', `gh isn't logged in as ${account}. Run: gh auth login`);
      return new GithubClient({ repo: t.repo, token: tok.stdout.trim(), account, exec, project: typeof t.board === 'number' ? t.board : null });
    }
    const c = await this.cred(p, t);
    if (t.kind === 'jira') {
      if (!c || c.kind !== 'jira') throw new TrackerError('auth', `Sign in to Jira (${t.site}) for this repo to see its board and tickets.`);
      return new JiraClient({ site: t.site!, project: t.project!, email: c.email, token: c.token, board: typeof t.board === 'number' ? t.board : null });
    }
    if (!c || c.kind !== 'azure') throw new TrackerError('auth', `Sign in to Azure DevOps (${t.organization}) for this repo to see its board and work items.`);
    return new AzureClient({
      organization: t.organization!, project: t.project!, team: t.team, board: typeof t.board === 'string' ? t.board : null, prefix: t.prefix ?? 'AB',
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
        this.emitter.fire(p.root);
        return;
      }
      const prev = this.boards.get(p.root) ?? [];
      const states: BoardState[] = await Promise.all(list.map(async (t, index) => ({ index, kind: t.kind, title: this.title(t), board: prev[index]?.board ?? null, error: null, connect: null, loading: true, signedInAs: await this.signedInAs(p, index) })));
      this.boards.set(p.root, states);
      this.emitter.fire(p.root);
      await Promise.all(states.map(async (s) => {
        try {
          s.board = await (await this.client(p, s.index)).board();
          s.error = null;
        } catch (e) {
          s.error = (e as Error).message;
          if (e instanceof TrackerError && e.kind === 'auth') s.connect = this.signInButton(p, s.index, list[s.index]!);
          this.log.warn(`[trackers] ${s.title}: ${s.error}`);
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

  /** Picks a project, then one of its trackers that takes a sign-in, unless both were given. */
  private async pickTracker(arg: unknown, title: string): Promise<{ p: Project; index: number; t: Tracker } | null> {
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
    if (!choices.length) {
      const add = 'Add a tracker';
      if (await vscode.window.showInformationMessage('No project here has a Jira or Azure DevOps tracker yet.', add) === add) void vscode.commands.executeCommand('acc.trackers.add');
      return null;
    }
    if (choices.length === 1) return choices[0]!;
    const pick = await vscode.window.showQuickPick(choices.map((c) => ({ label: this.title(c.t), description: c.p.name, detail: hostOf(c.t), c })), { title });
    return pick?.c ?? null;
  }

  async signIn(arg?: unknown): Promise<boolean> {
    const chosen = await this.pickTracker(arg, 'Sign in to which tracker?');
    if (!chosen) return false;
    const { p, t } = chosen;
    const ok = t.kind === 'jira' ? await this.signInJira(p, hostOf(t), t.project ?? '') : t.kind === 'azure' ? await this.signInAzure(p, hostOf(t)) : false;
    if (ok) {
      this.clients.clear();
      await this.loadBoards(p.root);
    }
    return ok;
  }

  async signOut(arg?: unknown): Promise<void> {
    const chosen = await this.pickTracker(arg, 'Sign out of which tracker?');
    if (!chosen) return;
    const { p, t } = chosen;
    const c = await this.cred(p, t);
    await this.secrets.delete(this.credKey(p, t.kind as 'jira' | 'azure', hostOf(t)));
    this.clients.clear();
    const msAccount = c?.kind === 'azure' && c.method === 'microsoft' ? ` Your Microsoft account (${c.account.label}) stays signed in to VSCode; manage it under Accounts.` : '';
    void vscode.window.showInformationMessage(`${p.name} is signed out of ${this.title(t)}.${msAccount}`);
    await this.loadBoards(p.root);
  }

  /** Email and API token, checked against Jira, then kept for this repo only. */
  private async signInJira(p: Project, site: string, project: string): Promise<boolean> {
    const open = 'Create a token';
    void vscode.window.showInformationMessage(`${p.name} needs a Jira API token for ${site}. Create one at id.atlassian.com, then paste it here.`, open).then((a) => {
      if (a === open) void vscode.env.openExternal(vscode.Uri.parse(JIRA_TOKENS));
    });
    const email = await vscode.window.showInputBox({ title: `Sign in to Jira (${site}) for ${p.name}, 1 of 2`, prompt: 'The email you sign in to Jira with', ignoreFocusOut: true, validateInput: (v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? null : 'An email address') });
    if (!email) return false;
    const token = await vscode.window.showInputBox({ title: `Sign in to Jira (${site}) for ${p.name}, 2 of 2`, prompt: `An API token from ${JIRA_TOKENS}`, password: true, ignoreFocusOut: true, validateInput: (v) => (v.trim().length >= 16 ? null : 'Paste the whole token') });
    if (!token) return false;
    try {
      const me = await new JiraClient({ site, project, email: email.trim(), token: token.trim() }).me();
      const cred: JiraCred = { kind: 'jira', email: email.trim(), token: token.trim() };
      await this.secrets.store(this.credKey(p, 'jira', site), JSON.stringify(cred));
      void vscode.window.showInformationMessage(`${p.name} is signed in to Jira as ${me.name}. Only this repo uses it.`);
      return true;
    } catch (e) {
      void vscode.window.showErrorMessage(`Couldn't sign in to Jira: ${(e as Error).message}`);
      return false;
    }
  }

  /** Microsoft sign-in in the org's own tenant, or a personal access token; checked, then kept for this repo only. */
  private async signInAzure(p: Project, org: string): Promise<boolean> {
    const how = await vscode.window.showQuickPick([
      { label: '$(account) Sign in with Microsoft', detail: 'Uses a Microsoft account signed in to VSCode, in the tenant that owns this organization. Handles MFA, and there\'s no token to renew.', method: 'microsoft' as const },
      { label: '$(key) Use a personal access token', detail: `Create one in Azure DevOps (User settings → Personal access tokens) with Work Items: Read & write.`, method: 'pat' as const },
    ], { title: `Sign in to Azure DevOps (${org}) for ${p.name}`, ignoreFocusOut: true });
    if (!how) return false;
    try {
      let cred: AzureCred;
      let who: Person;
      if (how.method === 'microsoft') {
        const tenant = await tenantOf(org);
        // clearSessionPreference: ask which account, rather than reuse whichever another repo picked.
        const s = await vscode.authentication.getSession('microsoft', azureScopes(tenant), { createIfNone: true, clearSessionPreference: true });
        who = await azureWhoAmI(org, `Bearer ${s.accessToken}`);
        cred = { kind: 'azure', method: 'microsoft', account: s.account, tenant };
      } else {
        const open = 'Open token settings';
        void vscode.window.showInformationMessage(`Create a token at dev.azure.com/${org} → User settings → Personal access tokens, with Work Items: Read & write.`, open).then((a) => {
          if (a === open) void vscode.env.openExternal(vscode.Uri.parse(`https://dev.azure.com/${encodeURIComponent(org)}/_usersSettings/tokens`));
        });
        const token = await vscode.window.showInputBox({ title: `Azure DevOps (${org}) personal access token for ${p.name}`, password: true, ignoreFocusOut: true, validateInput: (v) => (v.trim().length >= 20 ? null : 'Paste the whole token') });
        if (!token) return false;
        who = await azureWhoAmI(org, `Basic ${b64(`:${token.trim()}`)}`);
        cred = { kind: 'azure', method: 'pat', token: token.trim() };
      }
      await this.secrets.store(this.credKey(p, 'azure', org.toLowerCase()), JSON.stringify(cred));
      void vscode.window.showInformationMessage(`${p.name} is signed in to Azure DevOps (${org}) as ${who.name}. Only this repo uses it.`);
      return true;
    } catch (e) {
      const why = (e as Error).message;
      void vscode.window.showErrorMessage(`Couldn't sign in to Azure DevOps (${org}): ${why}${how.method === 'microsoft' ? ' Try another account, or a personal access token.' : ''}`);
      return false;
    }
  }

  /** The Authorization header for the Azure sign-in this repo already has, for listing projects while setting up. */
  private async azureAuth(p: Project, org: string): Promise<string | null> {
    const raw = await this.secrets.get(this.credKey(p, 'azure', org.toLowerCase()));
    if (!raw) return null;
    const c = JSON.parse(raw) as AzureCred;
    if (c.method === 'pat') return `Basic ${b64(`:${c.token}`)}`;
    const s = await vscode.authentication.getSession('microsoft', azureScopes(c.tenant), { account: c.account, silent: true });
    return s ? `Bearer ${s.accessToken}` : null;
  }

  // ------------------------------------------------------------ adding a tracker to a repo

  /**
   * A guided way to name a repo's tracker: pick the kind, sign in, then pick the project, team and board
   * from what the tracker lists. It's written to that repo's .acc/config.json, and nowhere else.
   */
  async add(opts: { root?: string; kind?: 'azure' | 'jira' | 'github' } = {}): Promise<void> {
    const projects = this.hub.projects;
    if (!projects.length) {
      void vscode.window.showInformationMessage('Onboard this project first: Agent Command Center: Onboard this project.');
      return;
    }
    // From a project's own button, that project; otherwise the only one, or ask.
    const named = opts.root ? projects.find((x) => x.root === opts.root) : undefined;
    const p = named ?? (projects.length === 1 ? projects[0]! : (await vscode.window.showQuickPick(projects.map((x) => ({ label: x.name, description: x.root, x })), { title: 'Add a tracker to which project?' }))?.x);
    if (!p) return;
    const kind = opts.kind ?? (await vscode.window.showQuickPick([
      { label: '$(azure-devops) Azure DevOps', description: 'Azure Boards work items', tracker: 'azure' as const },
      { label: '$(issues) Jira', description: 'Jira Cloud', tracker: 'jira' as const },
      { label: '$(github) GitHub Issues', description: p.config.github?.repo ?? '', tracker: 'github' as const },
    ], { title: `Add a tracker to ${p.name}` }))?.tracker;
    if (!kind) return;
    try {
      const tracker = kind === 'azure' ? await this.addAzure(p) : kind === 'jira' ? await this.addJira(p) : await this.addGithub(p);
      if (!tracker) return;
      this.writeTracker(p, tracker);
      await this.hub.loadProjects();
      this.clients.clear();
      await this.loadBoards(p.root);
      void vscode.commands.executeCommand('acc.open.tasks');
      void vscode.window.showInformationMessage(`${p.name}'s tickets are on the Tasks tab now. acc wrote the tracker to .acc/config.json: commit it on each environment's branch, so every checkout shows the same board.`);
    } catch (e) {
      void vscode.window.showErrorMessage(`Couldn't add the tracker: ${(e as Error).message}`);
    }
  }

  private async addAzure(p: Project): Promise<Record<string, unknown> | null> {
    const input = await vscode.window.showInputBox({ title: `Azure DevOps for ${p.name}, 1 of 4`, prompt: 'The organization, or any URL from it', placeHolder: 'https://dev.azure.com/acme  or  acme', ignoreFocusOut: true, validateInput: (v) => (parseHost('azure', v) ? null : 'An organization name, or a dev.azure.com URL') });
    const org = input && parseHost('azure', input);
    if (!org) return null;
    let auth = await this.azureAuth(p, org);
    if (!auth) {
      if (!(await this.signInAzure(p, org))) return null;
      auth = await this.azureAuth(p, org);
      if (!auth) return null;
    }
    const projectName = await this.pick(`Azure DevOps for ${p.name}, 2 of 4`, 'Project', () => azureProjects(org, auth!));
    if (!projectName) return null;
    const teams = await azureTeams(org, projectName, auth);
    const team = teams.length > 1 ? (await vscode.window.showQuickPick(teams.map((name, i) => ({ label: name, description: i === 0 ? 'default team' : undefined })), { title: `Azure DevOps for ${p.name}, 3 of 4`, placeHolder: 'Whose board?' }))?.label : teams[0];
    if (!team) return null;
    const boards = await azureBoards(org, projectName, team, auth);
    const board = boards.length > 1 ? (await vscode.window.showQuickPick(boards.map((name) => ({ label: name })), { title: `Azure DevOps for ${p.name}, 4 of 4`, placeHolder: 'Which board? Usually the stories or backlog items one' }))?.label : boards[0];
    if (!board) return null;
    return { kind: 'azure', organization: org, project: projectName, ...(team !== teams[0] ? { team } : {}), board };
  }

  private async addJira(p: Project): Promise<Record<string, unknown> | null> {
    const input = await vscode.window.showInputBox({ title: `Jira for ${p.name}, 1 of 3`, prompt: 'The Jira site, or any URL from it', placeHolder: 'acme.atlassian.net', ignoreFocusOut: true, validateInput: (v) => (parseHost('jira', v) ? null : 'A site such as acme.atlassian.net') });
    const site = input && parseHost('jira', input);
    if (!site) return null;
    let raw = await this.secrets.get(this.credKey(p, 'jira', site));
    if (!raw) {
      if (!(await this.signInJira(p, site, ''))) return null;
      raw = await this.secrets.get(this.credKey(p, 'jira', site));
      if (!raw) return null;
    }
    const c = JSON.parse(raw) as JiraCred;
    const projects = await jiraProjects(site, c.email, c.token);
    const key = (await vscode.window.showQuickPick(projects.map((x) => ({ label: x.key, description: x.name })), { title: `Jira for ${p.name}, 2 of 3`, placeHolder: 'Project' }))?.label;
    if (!key) return null;
    const boards = await jiraBoards(site, key, c.email, c.token);
    const board = boards.length > 1 ? (await vscode.window.showQuickPick(boards.map((b) => ({ label: b.name, description: b.type, id: b.id })), { title: `Jira for ${p.name}, 3 of 3`, placeHolder: 'Which board?' }))?.id : boards[0]?.id;
    return { kind: 'jira', site, project: key, ...(board && boards.length > 1 ? { board } : {}) };
  }

  private async addGithub(p: Project): Promise<Record<string, unknown> | null> {
    const own = p.config.github?.repo;
    const repo = await vscode.window.showInputBox({ title: `GitHub Issues for ${p.name}`, prompt: 'owner/name of the repo whose issues to show', value: own ?? '', ignoreFocusOut: true, validateInput: (v) => (/^[\w.-]+\/[\w.-]+$/.test(v.trim()) ? null : 'owner/name') });
    if (!repo) return null;
    return repo.trim() === own ? { kind: 'github' } : { kind: 'github', repo: repo.trim() };
  }

  private async pick(title: string, what: string, load: () => Promise<string[]>): Promise<string | undefined> {
    const items = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Loading ${what.toLowerCase()}s…` }, load);
    if (!items.length) throw new TrackerError('not-found', `There are no ${what.toLowerCase()}s this sign-in can see.`);
    return items.length === 1 ? items[0] : (await vscode.window.showQuickPick(items, { title, placeHolder: what }));
  }

  /** Adds the tracker to the repo's own config, replacing one for the same project. Other keys are left as they are. */
  private writeTracker(p: Project, tracker: Record<string, unknown>): void {
    const file = join(p.root, '.acc', 'config.json');
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { trackers?: Record<string, unknown>[] };
    raw.trackers = withTracker(raw.trackers ?? [], tracker);
    writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
  }
}
