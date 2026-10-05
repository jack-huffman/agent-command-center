import * as vscode from 'vscode';
import type { GithubIdentity } from '../../packages/core/src/github.ts';
import type { Hub, Project } from './hub.ts';
import { type IdentityCard, initials, lookOf } from './model.ts';

type AccRun = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

/**
 * The GitHub account each repo works as, on show in the status bar and the Environments tab, and switched
 * from there (D-028). The choice is this clone's alone: it lives in git config and is never committed.
 */
export class RepoIdentity implements vscode.Disposable {
  private readonly cache = new Map<string, { at: number; id: GithubIdentity | null }>();
  private readonly item: vscode.StatusBarItem;
  private readonly emitter = new vscode.EventEmitter<string>();
  readonly onDidChange = this.emitter.event;
  private readonly hub: Hub;
  private readonly acc: AccRun;
  private readonly signIn: () => Promise<string | null>;

  private readonly onSwitched: () => void;

  constructor(hub: Hub, acc: AccRun, signIn: () => Promise<string | null>, onSwitched: () => void) {
    this.hub = hub;
    this.acc = acc;
    this.signIn = signIn;
    this.onSwitched = onSwitched;
    this.item = vscode.window.createStatusBarItem('acc.github', vscode.StatusBarAlignment.Left, 99);
    this.item.name = 'Agent Command Center: GitHub account';
    this.item.command = 'acc.github.switch';
  }

  dispose(): void {
    this.item.dispose();
    this.emitter.dispose();
  }

  get(root: string): GithubIdentity | null {
    return this.cache.get(root)?.id ?? null;
  }

  /** The project the status bar speaks for: the one holding the open file, or the first. */
  active(): Project | undefined {
    const file = vscode.window.activeTextEditor?.document.uri;
    return (file?.scheme === 'file' ? this.hub.projectFor(file.fsPath) : undefined) ?? this.hub.projects[0];
  }

  /** Reads a repo's identity through acc, at most every 30 seconds unless forced. */
  async refresh(root?: string, force = false): Promise<void> {
    const roots = root ? [root] : this.hub.projects.filter((p) => p.config.github).map((p) => p.root);
    await Promise.all(roots.map(async (r) => {
      const hit = this.cache.get(r);
      if (!force && hit && Date.now() - hit.at < 30_000) return;
      const res = await this.acc(['github', 'status', '--json'], r);
      let id: GithubIdentity | null = null;
      try {
        const j = JSON.parse(res.stdout) as GithubIdentity & { error?: string };
        id = j.error ? null : j;
      } catch {
        id = null;
      }
      this.cache.set(r, { at: Date.now(), id });
      this.emitter.fire(r);
    }));
    this.render();
  }

  render(): void {
    const p = this.active();
    const id = p ? this.get(p.root) : null;
    if (!p?.config.github || !id) {
      this.item.hide();
      return;
    }
    const look = lookOf(id);
    this.item.text = `${look.ok ? '$(github)' : '$(warning)'} ${id.account}`;
    this.item.backgroundColor = look.ok ? undefined : new vscode.ThemeColor('statusBarItem.warningBackground');
    this.item.accessibilityInformation = { label: `${p.name} works as ${id.account} on GitHub${look.problem ? `. ${look.problem}` : ''}. Switch account.` };
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = { enabledCommands: ['acc.github.switch', 'acc.github.signIn'] };
    md.appendMarkdown(`**${p.name}** works as **${id.account}** on GitHub\n\n`);
    md.appendMarkdown(id.from === 'clone'
      ? `$(device-desktop) This clone's choice. The project's is ${id.projectAccount}.\n\n`
      : '$(file-code) The project\'s account, from .acc/config.json.\n\n');
    md.appendMarkdown(id.signedIn
      ? `$(pass) gh is signed in${look.scopes.length ? `: ${look.scopes.join(', ')}` : ''}${look.projects ? '' : '. No GitHub Projects access yet'}\n\n`
      : `$(warning) gh isn't signed in as ${id.account}. [Sign in](command:acc.github.signIn)\n\n`);
    if (id.pushesAs) md.appendMarkdown(`${id.pushesAs.toLowerCase() === id.account.toLowerCase() ? '$(repo-push)' : '$(warning)'} git push as ${id.pushesAs}\n\n`);
    if (id.commit.name || id.commit.email) md.appendMarkdown(`$(git-commit) Commits as ${id.commit.name ?? '?'} <${id.commit.email ?? '?'}>\n\n`);
    md.appendMarkdown(`[$(arrow-swap) Switch account](command:acc.github.switch) · [$(link-external) Profile](https://github.com/${encodeURIComponent(id.account)})`);
    this.item.tooltip = md;
    // The right account is said in the one status bar item's tooltip (D-065); a wrong one keeps its own warning.
    if (look.ok) this.item.hide();
    else this.item.show();
  }

  /** The active project's GitHub account and whether it's right, for the one status bar item (D-065). */
  account(): { name: string; ok: boolean } | null {
    const p = this.active();
    const id = p?.config.github ? this.get(p.root) : null;
    return id ? { name: id.account, ok: lookOf(id).ok } : null;
  }

  /**
   * Picks the account this clone works as: every account gh is logged in to, with what it can do, plus
   * adding one and going back to the project's own. Nothing committed changes.
   */
  async switch(arg?: unknown): Promise<void> {
    const p = (typeof arg === 'string' ? this.hub.project(arg) : undefined) ?? this.active();
    if (!p?.config.github) {
      void vscode.window.showInformationMessage('This folder isn\'t a project with a GitHub repo in .acc/config.json.');
      return;
    }
    await this.refresh(p.root, true);
    const id = this.get(p.root);
    if (!id) return;
    type Item = vscode.QuickPickItem & { act?: 'use' | 'add' | 'default' | 'profile'; login?: string };
    const items: Item[] = (id.accounts ?? []).map((a) => {
      const current = a.login.toLowerCase() === id.account.toLowerCase();
      const tags = [current ? 'current' : '', a.login === id.projectAccount ? 'the project\'s account' : '', a.active ? 'gh\'s active account' : ''].filter(Boolean);
      const projects = a.scopes.includes('project') || a.scopes.includes('read:project');
      return { label: `${current ? '$(check)' : '$(account)'} ${a.login}`, description: tags.join(' · '), detail: `${a.scopes.join(' · ') || 'no scopes listed'}${projects ? '' : '   —   no GitHub Projects access'}`, act: 'use', login: a.login };
    });
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({ label: '$(add) Add a GitHub account…', detail: 'Sign in with VSCode\'s GitHub sign-in. gh gets the login; its active account stays as it is.', act: 'add' });
    if (id.from === 'clone') items.push({ label: `$(discard) Back to the project's account, ${id.projectAccount}`, act: 'default' });
    items.push({ label: `$(link-external) Open ${id.account} on GitHub`, act: 'profile' });
    const pick = await vscode.window.showQuickPick(items, {
      title: `GitHub account for ${p.name}`,
      placeHolder: `${p.name} works as ${id.account}. Pick the account this clone works as.`,
    });
    if (!pick?.act) return;
    if (pick.act === 'profile') {
      void vscode.env.openExternal(vscode.Uri.parse(`https://github.com/${encodeURIComponent(id.account)}`));
      return;
    }
    let login: string | null | undefined = pick.act === 'default' ? null : pick.login;
    if (pick.act === 'add') {
      login = await this.signIn();
      if (!login) return;
    }
    if (login && login.toLowerCase() === id.account.toLowerCase()) return;
    const r = await this.acc(login ? ['github', 'use', login, '--json'] : ['github', 'use', '--default', '--json'], p.root);
    if (r.code !== 0) {
      let msg = (r.stderr || r.stdout).trim();
      try { msg = (JSON.parse(r.stdout) as { message?: string }).message ?? msg; } catch { /* plain text */ }
      void vscode.window.showErrorMessage(`Couldn't switch: ${msg.split('\n')[0]}`);
      return;
    }
    const now = login ?? id.projectAccount;
    void vscode.window.showInformationMessage(`${p.name} now works as ${now} in this clone. gh calls and git push follow; nothing committed changed.`);
    await this.hub.loadProjects();
    await this.refresh(p.root, true);
    this.onSwitched();
  }

  /** The person-sized summary for the Environments tab's identity card. */
  card(root: string): IdentityCard | null {
    const id = this.get(root);
    if (!id) return null;
    const look = lookOf(id);
    return {
      account: id.account, initials: initials(id.account), from: id.from, projectAccount: id.projectAccount,
      signedIn: id.signedIn, scopes: look.scopes, projects: look.projects, problem: look.problem,
      pushesAs: id.pushesAs, commit: id.commit.name || id.commit.email ? `${id.commit.name ?? '?'} <${id.commit.email ?? '?'}>` : null,
      profile: `https://github.com/${encodeURIComponent(id.account)}`, others: (id.accounts ?? []).filter((a) => a.login !== id.account).length,
    };
  }
}
