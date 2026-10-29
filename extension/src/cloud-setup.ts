/**
 * Set up cloud builders' other half (T-145): the modal's state, each step's live check, and each step's own
 * button, all through acc but the token on Windows. The page can't reach acc, git or VS Code's secrets, so
 * every check and button runs here, and only its words go back. The token comes from the page once, with
 * Keep the token, and goes to this Mac's keychain (through acc) or, on Windows, to VS Code's secret storage
 * (D-027): never into the model, the log, a file or the project's settings. No vscode import, so it's tested
 * with stand-ins.
 */
import { randomBytes } from 'node:crypto';
import { CLOUD_TOKEN, CLOUD_TOKEN_ENV, cloudTokenHome, ROUTINES_URL } from '../../packages/core/src/cloud.ts';
import type { GuardPlace } from '../../packages/core/src/cloud-guard-place.ts';
import { ROUTINE_ID } from '../../packages/core/src/config.ts';
import { CLAUDE_SIGN_IN, GITHUB_APP, ROUTINE_PROMPT } from '../../packages/core/src/onboarding/cloud-steps.ts';
import type { ExtensionArea } from './area.ts';
import { area as page, canReach, type CloudAction, type CloudCheck, type CloudSetupMessage, cloudSetupModel, type CloudSetupModel, type CloudSetupState, type CloudSetupStep, firstNotDone, TOKEN_PROBLEM, TRIGGER_PROBLEM } from './model/cloud-setup.ts';
import type { RunResult } from './run.ts';

/** Where VS Code keeps a repo's token on Windows (T-145): its secret storage, by repo, as tracker sign-ins are (D-027). */
export const tokenKey = (repo: string): string => `acc.cloud.token:${repo.toLowerCase()}`;

/** VS Code's secret storage, as much of it as the tokens use. */
export interface SecretStore {
  get(key: string): Thenable<string | undefined>;
  store(key: string, value: string): Thenable<void>;
}

/**
 * The scheduled task's token, kept where this system keeps it (T-145). A Mac: its keychain, written through
 * acc, which this never reads, so a terminal's dispatch finds it there. Windows: VS Code's secret storage,
 * read into memory here as the projects load, and handed to acc in its environment (CLOUD_TOKEN_ENV) whenever
 * the Command Center runs acc for that repo, so a dispatch or a review finds it. Never written anywhere else.
 */
export class CloudTokens {
  private readonly held = new Map<string, string>();
  private readonly secrets: SecretStore;
  private readonly platform: NodeJS.Platform;
  /** Keeps a token in a Mac's keychain: acc cloud token, with the token in its environment, never on its command line. */
  private readonly keychain: (root: string, token: string) => Promise<RunResult>;

  constructor(secrets: SecretStore, platform: NodeJS.Platform, keychain: (root: string, token: string) => Promise<RunResult>) {
    this.secrets = secrets;
    this.platform = platform;
    this.keychain = keychain;
  }

  /** Whether VS Code keeps the token here, not the keychain: Windows. */
  get inVsCode(): boolean {
    return cloudTokenHome(this.platform) === 'vscode';
  }

  /** Reads each repo's token from secret storage into memory, on Windows; a Mac's stay in its keychain. */
  async load(repos: string[]): Promise<void> {
    if (!this.inVsCode) return;
    for (const repo of new Set(repos)) {
      const t = await this.secrets.get(tokenKey(repo));
      if (t && CLOUD_TOKEN.test(t)) this.held.set(repo.toLowerCase(), t);
      else this.held.delete(repo.toLowerCase());
    }
  }

  /** Whether a repo's token is kept here, on Windows; null on a Mac, where acc's check reads the keychain. */
  has(repo: string): boolean | null {
    return this.inVsCode ? this.held.has(repo.toLowerCase()) : null;
  }

  /** What acc's environment gets for a repo: its token on Windows, nothing on a Mac or for a repo with none. */
  env(repo: string | null | undefined): Record<string, string> {
    const t = repo && this.inVsCode ? this.held.get(repo.toLowerCase()) : undefined;
    return t ? { [CLOUD_TOKEN_ENV]: t } : {};
  }

  /** Keeps a token for a repo where this system keeps it. Throws in words when it isn't one, or wasn't kept. */
  async keep(root: string, repo: string, token: string): Promise<void> {
    const t = token.trim();
    if (!CLOUD_TOKEN.test(t)) throw new Error(TOKEN_PROBLEM);
    if (this.inVsCode) {
      await this.secrets.store(tokenKey(repo), t);
      this.held.set(repo.toLowerCase(), t);
      return;
    }
    const r = await this.keychain(root, t);
    if (r.code !== 0) throw new Error(acceptedWords(r) || 'The keychain wouldn\'t keep it');
  }
}

/** acc's words for a failed run: its JSON message, else its first line. */
function acceptedWords(r: RunResult): string {
  try {
    const j = JSON.parse(r.stdout) as { message?: string };
    if (j.message) return j.message.replace(/^✗ /, '');
  } catch {
    // not JSON: its first line says it
  }
  return (r.stderr || r.stdout).trim().split('\n')[0] ?? '';
}

/** A project as the modal reads it from the hub. */
export interface CloudSetupProject {
  root: string;
  name: string;
  repo: string | null;
  on: boolean;
  routine: string | null;
}

/** What the session needs from the extension. */
export interface CloudSetupDeps {
  project(root: string): CloudSetupProject | null;
  /** The project to set up when none is named: the only one, or the one picked. Null when there's none. */
  pick(): Promise<string | null>;
  /** acc, with the token in its environment on Windows (CloudTokens.env). */
  acc(args: string[], root: string): Promise<RunResult>;
  tokens: CloudTokens;
  platform: NodeJS.Platform;
  /** Setup's I've done this for GitHub access: whether it's ticked, and ticking it. */
  confirmed(): boolean;
  confirm(): Promise<void>;
  copy(text: string): Promise<void>;
  open(url: string): void;
  /** Runs a command in a terminal the person sees, and calls back when it ends or the terminal closes. */
  terminal(command: string, cwd: string, ended: () => void): void;
  /** Asks in a modal before something leaves the machine: true to go on. */
  ask(message: string, detail: string, go: string): Promise<boolean>;
  /** The project's settings changed: the hub reads them again, and Setup checks its cloud steps. */
  reload(): Promise<void>;
  changed(): void;
  log(line: string): void;
}

const LOADING: CloudCheck = { status: 'loading', detail: '' };

/** What acc cloud --json says, as much of it as the modal reads. */
interface CloudJson {
  needs?: { id: string; ok: boolean; fix: string }[];
  guardPlace?: GuardPlace;
}

export class CloudSetupSession {
  private s: CloudSetupState | null = null;
  /** Goes up with each read and with closing, so a late answer is dropped. */
  private gen = 0;
  private readonly deps: CloudSetupDeps;

  constructor(deps: CloudSetupDeps) {
    this.deps = deps;
  }

  model(): CloudSetupModel | null {
    return this.s ? cloudSetupModel(this.s) : null;
  }

  /** What's open, for tests and the fixtures. */
  state(): CloudSetupState | null {
    return this.s;
  }

  /**
   * Opens the modal for a project, on the first step not done as far as is known now; once its checks are
   * read, on the first step not done, unless the person has moved. False when there's no project.
   */
  async open(root?: string): Promise<boolean> {
    const r = root ?? (await this.deps.pick());
    const p = r ? this.deps.project(r) : null;
    if (!p) return false;
    this.gen++;
    const s: CloudSetupState = {
      id: randomBytes(8).toString('hex'), rev: 0, root: p.root, project: p.name, repo: p.repo, platform: this.deps.platform, step: 'on', moved: false,
      on: p.on, routine: p.routine, github: LOADING, githubConfirmed: this.deps.confirmed(), token: LOADING, signin: LOADING, guard: LOADING, place: null,
      busy: null, error: null, copied: false,
    };
    // Before the checks are read, a step that's loading is taken as done, so the modal doesn't stop at it.
    s.step = firstNotDone({ ...s, github: ok(), token: ok(), signin: ok(), guard: ok() });
    this.s = s;
    this.deps.changed();
    await this.read();
    return true;
  }

  close(): void {
    const was = !!this.s;
    this.gen++;
    this.s = null;
    if (was) this.deps.changed();
  }

  receive(m: CloudSetupMessage): void {
    const s = this.s;
    if (!s || m.session !== s.id) return;
    if (m.type === 'cloud-setup-cancel') {
      // A step's work under way finishes first: it's being written, so Cancel can't keep nothing then.
      if (!s.busy) this.close();
      return;
    }
    if (m.type === 'cloud-setup-step') return this.go(m.step);
    void this.act(m.action, m.value);
  }

  /** Back, Next or a step in the bar: only to a step every must-pass step before it has passed. */
  private go(step: CloudSetupStep): void {
    const s = this.s!;
    if (!canReach(s, step)) return;
    s.step = step;
    s.moved = true;
    s.error = null;
    this.bump();
  }

  private bump(): void {
    if (!this.s) return;
    this.s.rev++;
    this.deps.changed();
  }

  /** Reads every check again, and draws them. A read answered after a newer one, or after closing, is dropped. */
  async read(): Promise<void> {
    const s = this.s;
    if (!s) return;
    const gen = ++this.gen;
    const p = this.deps.project(s.root);
    if (p) Object.assign(s, { on: p.on, routine: p.routine, repo: p.repo, project: p.name });
    s.githubConfirmed = this.deps.confirmed();
    if (!s.repo) {
      for (const k of ['github', 'token', 'signin', 'guard'] as const) s[k] = { status: 'unknown', detail: 'The project\'s settings name no GitHub repo' };
      return this.settle(s);
    }
    const [cloud, doctor] = await Promise.all([this.deps.acc(['cloud', '--json'], s.root), this.deps.acc(['doctor', '--step', 'B15.cloud-github-app', '--json'], s.root)]);
    if (gen !== this.gen || this.s !== s) return;
    let j: CloudJson | null = null;
    try {
      j = cloud.code === 0 ? (JSON.parse(cloud.stdout) as CloudJson) : null;
    } catch {
      j = null;
    }
    const cant = (why: string): CloudCheck => ({ status: 'unknown', detail: why });
    const accWhy = `Couldn't check: ${acceptedWords(cloud) || 'the check didn\'t answer'}`;
    const need = (id: string) => j?.needs?.find((n) => n.id === id);
    // The token: on Windows from VS Code's secret storage, which acc saw only as it was handed over.
    const held = this.deps.tokens.has(s.repo);
    const token = need('token');
    s.token = held !== null ? (held ? pass('Kept in VS Code on this machine') : fail('No token kept yet'))
      : !token ? cant(accWhy) : token.ok ? pass('Kept in this Mac\'s keychain') : fail('No token in the keychain yet');
    const login = need('login');
    s.signin = !login ? cant(accWhy) : login.ok ? pass('Signed in to claude.ai') : fail(login.fix.replace(/\s*Run: .*$/, '') || 'Not signed in');
    const place = j?.guardPlace ?? null;
    s.place = place;
    s.guard = !place ? cant(accWhy) : place.pushed.ok ? pass(`Committed, and on GitHub's ${place.base}`) : place.local.ok ? fail(`Committed here, not on GitHub's ${place.base} yet`) : fail(`Not committed on ${place.base}`);
    s.github = githubCheck(doctor);
    this.settle(s);
  }

  /** After a read: the first one moves to the first step not done; a step that can't be on show any more moves back to it. */
  private settle(s: CloudSetupState): void {
    if (!s.moved || !canReach(s, s.step)) s.step = firstNotDone(s);
    s.moved = true;
    this.bump();
  }

  /** A step's own button: the only things that write, and each writes only what it says. */
  private async act(action: CloudAction, value?: string): Promise<void> {
    const s = this.s!;
    if (s.busy) return;
    const step = s.step;
    const run = async (what: CloudAction, fn: () => Promise<void>) => {
      s.busy = what;
      s.error = null;
      this.bump();
      try {
        await fn();
      } catch (e) {
        if (this.s === s) s.error = { step, text: (e as Error).message };
        this.deps.log(`[cloud setup] ${s.project}: ${what}: ${(e as Error).message}`);
      } finally {
        if (this.s === s) s.busy = null;
      }
      if (this.s === s) await this.read();
    };
    const accOrSay = async (args: string[]) => {
      const r = await this.deps.acc([...args, '--json'], s.root);
      if (r.code !== 0) throw new Error(acceptedWords(r) || `It didn't work (exit ${r.code})`);
    };
    switch (action) {
      case 'check': return this.read();
      case 'install': return this.deps.open(GITHUB_APP);
      case 'open': return this.deps.open(ROUTINES_URL);
      case 'copy':
        await this.deps.copy(ROUTINE_PROMPT);
        s.copied = true;
        return this.bump();
      case 'confirm': return run('confirm', () => this.deps.confirm());
      case 'turnOn': return run('turnOn', async () => {
        await accOrSay(['cloud', 'enable']);
        await this.deps.reload();
      });
      case 'keepId': {
        const id = (value ?? '').trim();
        if (!ROUTINE_ID.test(id)) {
          s.error = { step, text: TRIGGER_PROBLEM };
          return this.bump();
        }
        return run('keepId', async () => {
          await accOrSay(['cloud', 'enable', '--routine', id]);
          await this.deps.reload();
        });
      }
      case 'keepToken': {
        const t = (value ?? '').trim();
        if (!CLOUD_TOKEN.test(t) || !s.repo) {
          s.error = { step, text: TOKEN_PROBLEM };
          return this.bump();
        }
        return run('keepToken', () => this.deps.tokens.keep(s.root, s.repo!, t));
      }
      case 'signin':
        this.deps.terminal(CLAUDE_SIGN_IN, s.root, () => void this.read());
        return;
      case 'commit': return run('commit', () => accOrSay(['cloud', 'guard', '--commit']));
      case 'push': {
        const place = s.place;
        if (!place) return;
        // Nothing leaves the machine without a yes: the question names the branch and what goes with it.
        const n = place.ahead;
        const go = await this.deps.ask(`Push ${place.base} to GitHub?`, `The cloud clones ${place.base}, so the push guard must be there. This sends ${n ? `${n} commit${n === 1 ? '' : 's'} on ${place.base}` : place.base}, the guard among them, and nothing else.`, 'Push');
        if (!go || this.s !== s) return;
        return run('push', () => accOrSay(['cloud', 'guard', '--push']));
      }
    }
  }
}

const pass = (detail: string): CloudCheck => ({ status: 'pass', detail });
const fail = (detail: string): CloudCheck => ({ status: 'fail', detail });
const ok = (): CloudCheck => pass('');

/** GitHub access from Setup's own step: passed, or why it can't be seen here; off before cloud builders are on. */
export function githubCheck(r: RunResult): CloudCheck {
  try {
    const rows = JSON.parse(r.stdout) as { id?: string; status?: string; detail?: string }[];
    const row = Array.isArray(rows) ? rows.find((x) => x.id === 'B15.cloud-github-app') : undefined;
    if (row?.status === 'pass') return pass(row.detail ?? 'Installed');
    if (row?.status === 'skip') return { status: 'unknown', detail: 'Checked once cloud builders are on' };
    if (row) return { status: 'unknown', detail: row.detail ?? 'Can\'t see it from here' };
  } catch {
    // not JSON: said below
  }
  return { status: 'unknown', detail: `Couldn't check: ${acceptedWords(r) || 'the check didn\'t answer'}` };
}

export const area: ExtensionArea = {
  register({ cloudSetup, receive, reg, vscode, subscribe }) {
    // Every message the modal sends, for the modal that's open.
    for (const type of Object.keys(page.messages ?? {}) as CloudSetupMessage['type'][]) receive(type, (m) => cloudSetup.receive(m));
    // From Settings' Set up… (a root), the palettes (a project node, or nothing) and Setup's B15 Do it (nothing).
    reg('acc.cloud.setup', (arg?: unknown) => {
      const root = typeof arg === 'string' ? arg : (arg as { project?: { root?: string }; root?: string } | undefined)?.project?.root ?? (arg as { root?: string } | undefined)?.root;
      void vscode.commands.executeCommand('acc.open.home').then(() => cloudSetup.open(root));
    });
    // Live checks: coming back to VS Code, as from claude.ai or GitHub, reads them again.
    subscribe(vscode.window.onDidChangeWindowState((w) => { if (w.focused && cloudSetup.state()) void cloudSetup.read(); }));
  },
};
