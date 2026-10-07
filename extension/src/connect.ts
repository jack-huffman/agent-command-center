/**
 * The Connect page's other half (GH-51): what's typed, who it signed in as, and each list of the place and
 * board, kept here while the page is open. The page can't reach a tracker (its CSP is default-src 'none'),
 * so every check and list runs here, and only its words go back. A token comes from the page once, to
 * sign in, and goes to VSCode's secret storage on this machine, for every project on its site or for this
 * repo only (GH-79, D-027): never into the model, the log or .acc/config.json. No vscode import, so it's
 * tested with stand-ins.
 */
import { randomBytes } from 'node:crypto';
import type { Tracker } from '../../packages/core/src/config.ts';
import { type Ctx, describe, DESCRIPTIONS, type PickerSpec, type SignIn, type SignInMethod, type TrackerDescription } from '../../packages/core/src/trackers/connect.ts';
import { type Exec, TrackerError } from '../../packages/core/src/trackers/types.ts';
import { blankConnect, type ConnectMessage, type ConnectModel, connectModel, type ConnectState, connectValues, type HomeSection } from './model.ts';

export interface ConnectProject {
  name: string;
  root: string;
  config: { github: { repo: string; account: string } | null };
}

/** What the session needs from the extension: the projects, VSCode's sign-ins and secrets, and writing the config. */
export interface ConnectDeps {
  projects(): ConnectProject[];
  /** A project's trackers, as the board numbers them. */
  trackers(root: string): Tracker[];
  title(t: Tracker): string;
  /**
   * The sign-in this repo uses for a host, ready to use: its own, or the one for every project on the site
   * (GH-79), and which. Null when there's none. Throws when it has ended.
   */
  storedSignIn(root: string, kind: string, host: string): Promise<{ signIn: SignIn; shared: boolean } | null>;
  /** Whether this repo keeps its own key for a host: a sign-in, or a "this project only" sign-out (GH-79). */
  ownSignIn(root: string, kind: string, host: string): Promise<boolean>;
  /** Keeps a sign-in for every project on the site, or for this repo only (GH-79, D-027). */
  storeSignIn(root: string, kind: string, host: string, cred: Record<string, unknown>, shared: boolean): Promise<void>;
  gitEmail(root: string): Promise<string | null>;
  /** A token for the project's gh account, or a TrackerError saying why not. */
  ghToken(root: string, account: string): Promise<string>;
  /** VSCode's Microsoft sign-in, asking which account: the header to use, and what to keep. */
  microsoft(host: string, spec: NonNullable<SignInMethod['microsoft']>): Promise<{ header: string; cred: Record<string, unknown> }>;
  /** Writes the tracker to the repo's .acc/config.json: in place of the one at index, or added. */
  write(root: string, index: number | null, record: Record<string, unknown>): void;
  /** Signed in: the boards that can use it load now, this project's and every one on the site (GH-79). */
  signedIn(root: string, kind: string, host: string): Promise<void>;
  /** After Save: reload, re-check setup, and show the Tasks tab. */
  saved(root: string, name: string): Promise<void>;
  /** The page has something new to show. */
  changed(): void;
  log(line: string): void;
  exec: Exec;
  fetch?: typeof fetch;
  /** The trackers on offer. Every one by default; tests add their own. */
  list?: TrackerDescription[];
}

export interface OpenOptions {
  root?: string;
  kind?: string;
  /** An existing tracker, by its place in the project's list. */
  index?: number;
  /** Opened from a Sign in button: the sign-in shows, ready to type. */
  signIn?: boolean;
  from: HomeSection;
}

export class ConnectSession {
  private s: ConnectState | null = null;
  /** The sign-in the lists use. Kept here, never in the state the page is drawn from. */
  private signIn: SignIn | null = null;
  /** Goes up when what the page is about changes (project, kind, host, closing), so a late answer is dropped. */
  private epoch = 0;
  private readonly gens: Record<string, number> = {};
  private email: string | null = null;
  private readonly deps: ConnectDeps;
  private readonly list: TrackerDescription[];

  constructor(deps: ConnectDeps) {
    this.deps = deps;
    this.list = deps.list ?? DESCRIPTIONS;
  }

  model(): ConnectModel | null {
    return this.s ? connectModel(this.s, this.list) : null;
  }

  /** What's open, for tests and the fixtures. */
  state(): ConnectState | null {
    return this.s;
  }

  /** Opens the page: a new tracker for a project, or an existing one. False when there's no project to connect. */
  async open(o: OpenOptions): Promise<boolean> {
    const projects = this.deps.projects();
    if (!projects.length) return false;
    const p = o.root ? projects.find((x) => x.root === o.root) : projects.length === 1 ? projects[0] : undefined;
    const t = p && o.index !== undefined ? this.deps.trackers(p.root)[o.index] : undefined;
    const d = (t && describe(t.kind, this.list)) ?? (o.kind ? describe(o.kind, this.list) : undefined) ?? this.list[0]!;
    this.email = p ? await this.deps.gitEmail(p.root).catch(() => null) : null;
    this.epoch++;
    this.signIn = null;
    this.s = blankConnect(d, {
      id: randomBytes(8).toString('hex'), root: p?.root ?? null, projects: projects.map((x) => ({ root: x.root, name: x.name })), projectName: p?.name ?? '',
      ownRepo: p?.config.github?.repo ?? null, ghAccount: p?.config.github?.account ?? null, from: o.from, gitEmail: this.email,
      existing: t ? { index: o.index!, title: this.deps.title(t), ...d.fromConfig(t, p?.config.github?.repo ?? null) } : null,
    });
    if (t && o.signIn) this.s.signIn.again = true;
    this.bump();
    if (this.method.via === 'gh') this.autoTest();
    else void this.resume();
    return true;
  }

  close(): void {
    const was = !!this.s;
    this.epoch++;
    this.s = null;
    this.signIn = null;
    if (was) this.deps.changed();
  }

  /** A message from the page, for the page that's open now. */
  receive(m: ConnectMessage): void {
    const s = this.s;
    if (!s || m.session !== s.id) return;
    switch (m.type) {
      case 'connect-cancel': return this.close();
      case 'connect-project': return void this.reopen({ root: m.root, kind: s.kind });
      case 'connect-kind': if (!s.existing) void this.reopen({ root: s.root ?? undefined, kind: m.kind }); return;
      case 'connect-method': return this.setMethod(m.method);
      case 'connect-set': return this.set(m.field, m.value);
      case 'connect-test': return void this.test(m.host, m.fields);
      case 'connect-again': s.signIn.again = true; return this.bump();
      case 'connect-share': s.share = m.on; return this.bump();
      case 'connect-pick': return this.pick(m.key, m.value);
      case 'connect-save': return void this.save();
    }
  }

  private get d(): TrackerDescription {
    return describe(this.s!.kind, this.list)!;
  }

  private get method(): SignInMethod {
    return this.d.methods.find((m) => m.id === this.s!.method) ?? this.d.methods[0]!;
  }

  private bump(): void {
    if (!this.s) return;
    this.s.rev++;
    this.deps.changed();
  }

  private async reopen(o: { root?: string; kind: string }): Promise<void> {
    if (!this.s) return;
    await this.open({ ...o, from: this.s.from });
  }

  private ctx(signIn: SignIn): Ctx {
    const s = this.s!;
    return { host: s.host, signIn, values: connectValues(s, this.d), fetch: this.deps.fetch, exec: this.deps.exec };
  }

  /** A sign-in through gh needs nothing typed, so it's tried as soon as the repo is known. */
  private autoTest(): void {
    if (this.method.via === 'gh' && this.s?.host) void this.test(this.s.host, {});
  }

  private setMethod(id: string): void {
    const s = this.s!;
    if (!this.d.methods.some((m) => m.id === id)) return;
    s.method = id;
    s.fieldErrors = {};
    if (s.signIn.state === 'failed') s.signIn = { state: 'none', who: null, error: null, again: s.signIn.again };
    this.bump();
  }

  /** Something typed, taken in when the field is left. The site, organization or repo starts the sign-in over. */
  private set(field: string, value: string): void {
    const s = this.s!;
    const d = this.d;
    if (field === d.host.key) {
      if (s.existing) return;
      const parsed = d.host.parse(value);
      if (!parsed) {
        s.host = value.trim();
        s.hostError = value.trim() ? d.host.invalid : null;
        return this.bump();
      }
      s.hostError = null;
      const changed = parsed !== s.host;
      if (changed) {
        s.host = parsed;
        this.restart();
      }
      this.bump();
      // A site this repo, or every project, signs in to already needs nothing typed (GH-79).
      if (this.method.via === 'gh') this.autoTest();
      else if (changed) void this.resume();
      return;
    }
    const f = this.method.fields.find((x) => x.key === field);
    if (!f || f.type === 'secret') return;
    s.fields[field] = value.trim();
    delete s.fieldErrors[field];
    this.bump();
  }

  /** Signed out of the page's own sign-in, and every list emptied: a new host is another tracker. */
  private restart(): void {
    const s = this.s!;
    this.epoch++;
    this.signIn = null;
    s.signIn = { state: 'none', who: null, error: null, again: false };
    s.share = true;
    for (const p of this.d.pickers) s.pickers[p.key] = { options: [], selected: [], state: 'waiting', error: null };
  }

  /**
   * The sign-in this repo would use for the host, checked, then the lists: an existing tracker's, or a new
   * one's on a site this repo, or every project, already signs in to (GH-79). The tick for every project
   * starts where this repo's sign-in is kept now: off when it keeps its own, or signed out here only.
   * True when one was found, whether or not it still works.
   */
  private async resume(): Promise<boolean> {
    const s = this.s!;
    if (!s.root || !s.host) return false;
    const epoch = this.epoch;
    const [root, host] = [s.root, s.host];
    try {
      const own = await this.deps.ownSignIn(root, s.kind, host);
      if (epoch !== this.epoch) return false;
      s.share = !own;
      const stored = await this.deps.storedSignIn(root, s.kind, host);
      if (epoch !== this.epoch) return false;
      if (!stored) {
        if (s.existing) s.signIn = { state: 'none', who: null, error: null, again: true };
        this.bump();
        return false;
      }
      s.signIn = { ...s.signIn, state: 'testing' };
      this.bump();
      if (this.d.methods.some((m) => m.id === stored.signIn.method)) s.method = stored.signIn.method;
      const who = await this.d.verify(this.ctx(stored.signIn));
      if (epoch !== this.epoch) return true;
      this.signedIn(stored.signIn, who.name, stored.shared);
    } catch (e) {
      if (epoch !== this.epoch) return true;
      this.failed(e);
      s.signIn.again = true;
      this.bump();
    }
    return true;
  }

  private signedIn(signIn: SignIn, who: string, shared?: boolean): void {
    const s = this.s!;
    this.signIn = signIn;
    s.signIn = { state: 'ok', who, error: null, again: false, ...(shared === undefined ? {} : { shared }) };
    s.fieldErrors = {};
    s.hostError = null;
    this.bump();
    this.loadReady();
  }

  /**
   * Test connection: checks what's typed, signs in, keeps the sign-in for every project on the site or for
   * this repo, as the tick says (GH-79), then fills the lists. A new site with nothing typed for its secret
   * first looks for a sign-in kept for it.
   */
  async test(hostInput: string, typed: Record<string, string>): Promise<void> {
    const s = this.s;
    if (!s?.root) return;
    const d = this.d;
    const method = this.method;
    const host = s.existing ? s.host : d.host.parse(hostInput || s.host);
    if (!host) {
      s.hostError = d.host.invalid;
      return this.bump();
    }
    if (host !== s.host) {
      s.host = host;
      this.restart();
      s.hostError = null;
      const blank = method.fields.every((f) => f.type !== 'secret' || !(typed[f.key] ?? '').trim());
      if (method.via !== 'gh' && blank && await this.resume()) return;
    }
    s.hostError = null;
    const values: Record<string, string> = {};
    const errors: Record<string, string> = {};
    for (const f of method.fields) {
      const v = (typed[f.key] ?? (f.type === 'secret' ? '' : s.fields[f.key] ?? '')).trim();
      if (f.type !== 'secret') s.fields[f.key] = v;
      const why = f.check?.(v) ?? (v ? null : `${f.label} is needed.`);
      if (why) errors[f.key] = why;
      values[f.key] = v;
    }
    s.fieldErrors = errors;
    if (Object.keys(errors).length) return this.bump();
    if (method.via === 'gh' && !s.ghAccount) {
      s.hostError = 'This project has no "github" section in .acc/config.json (its repo and account), so gh has no account to sign in as.';
      s.signIn = { state: 'failed', who: null, error: null, again: s.signIn.again };
      return this.bump();
    }
    const epoch = ++this.epoch;
    s.signIn = { ...s.signIn, state: 'testing', error: null };
    s.saveError = null;
    this.bump();
    try {
      let signIn: SignIn;
      let cred: Record<string, unknown> | null = null;
      if (method.via === 'fields') {
        signIn = { method: method.id, fields: values, header: null, gh: null };
        cred = { kind: s.kind, method: method.id, ...values };
      } else if (method.via === 'microsoft') {
        const r = await this.deps.microsoft(host, method.microsoft!);
        signIn = { method: method.id, fields: {}, header: r.header, gh: null };
        cred = { kind: s.kind, method: method.id, ...r.cred };
      } else {
        signIn = { method: method.id, fields: {}, header: null, gh: { account: s.ghAccount!, token: await this.deps.ghToken(s.root, s.ghAccount!) } };
      }
      if (epoch !== this.epoch) return;
      const who = await d.verify(this.ctx(signIn));
      if (epoch !== this.epoch) return;
      // Kept once it works, because the lists need it: for every project on the site, or only this repo (GH-79, D-027).
      const shared = s.share;
      if (cred) await this.deps.storeSignIn(s.root, s.kind, host, cred, shared);
      if (epoch !== this.epoch) return;
      this.signedIn(signIn, who.name, cred ? shared : undefined);
      if (s.existing || cred) void this.deps.signedIn(s.root, s.kind, host);
    } catch (e) {
      if (epoch !== this.epoch) return;
      this.failed(e);
      this.bump();
    }
  }

  /**
   * Puts a failed sign-in beside what it's about: the site, organization or repo when it couldn't be
   * reached, the token when it was refused, and otherwise the sign-in itself.
   */
  private failed(e: unknown): void {
    const s = this.s!;
    const why = (e as Error).message || 'It didn\'t answer.';
    const kind = e instanceof TrackerError ? e.kind : 'other';
    const secret = this.method.fields.find((f) => f.type === 'secret');
    s.signIn = { state: 'failed', who: null, error: null, again: s.signIn.again };
    if (kind === 'network' || kind === 'not-found') s.hostError = why;
    else if (kind === 'auth' && secret) s.fieldErrors = { ...s.fieldErrors, [secret.key]: why };
    else s.signIn.error = why;
    this.deps.log(`[connect] ${this.d.name} (${s.host}): ${why}`);
  }

  /**
   * Loads each list whose choices it depends on are made. An existing tracker's project isn't changed here,
   * so it isn't loaded, unless its values are ids: then it's loaded to show the name.
   */
  private loadReady(): void {
    const s = this.s;
    if (!s || !this.signIn) return;
    let again = true;
    while (again) {
      again = false;
      for (const p of this.d.pickers) {
        const ps = s.pickers[p.key]!;
        if (ps.state !== 'waiting' || !p.dependsOn.every((k) => s.pickers[k]?.selected.length && ['ready', 'failed'].includes(s.pickers[k]!.state))) continue;
        if (s.existing && p.identifies && !p.idValues) {
          ps.state = 'ready';
          again = true;
          continue;
        }
        void this.load(p);
      }
    }
    this.bump();
  }

  private async load(p: PickerSpec): Promise<void> {
    const s = this.s!;
    const ps = s.pickers[p.key]!;
    const gen = (this.gens[p.key] ?? 0) + 1;
    this.gens[p.key] = gen;
    const epoch = this.epoch;
    ps.state = 'loading';
    ps.error = null;
    try {
      const options = await p.load(this.ctx(this.signIn!));
      if (epoch !== this.epoch || gen !== this.gens[p.key] || this.s !== s) return;
      ps.options = options;
      ps.state = 'ready';
      // A list with one choice to make picks the tracker's own: its default, the one it prefers, or the only one.
      if (!ps.selected.length && !p.whole && !p.multi) {
        const pick = options.find((o) => o.default) ?? options.find((o) => o.preferred) ?? (options.length === 1 ? options[0] : undefined);
        if (pick) ps.selected = [pick.value];
      }
    } catch (e) {
      if (epoch !== this.epoch || gen !== this.gens[p.key] || this.s !== s) return;
      ps.state = 'failed';
      ps.error = (e as Error).message;
      this.deps.log(`[connect] ${this.d.name}: couldn't list ${p.label.toLowerCase()}: ${ps.error}`);
    }
    this.loadReady();
  }

  /** A choice made: the lists that depend on it start again from it. */
  private pick(key: string, value: string | string[] | null): void {
    const s = this.s!;
    const p = this.d.pickers.find((x) => x.key === key);
    const ps = s.pickers[key];
    if (!p || !ps || !this.signIn || ps.state === 'waiting' || ps.state === 'loading' || (s.existing && p.identifies)) return;
    const known = new Set([...ps.options.map((o) => o.value), ...ps.selected]);
    const chosen = (value === null ? [] : Array.isArray(value) ? value : [value]).filter((v) => known.has(v));
    ps.selected = p.multi ? chosen : chosen.slice(0, 1);
    const below = new Set([key]);
    for (const q of this.d.pickers) {
      if (!q.dependsOn.some((k) => below.has(k))) continue;
      below.add(q.key);
      this.gens[q.key] = (this.gens[q.key] ?? 0) + 1;
      s.pickers[q.key] = { options: [], selected: [], state: 'waiting', error: null };
    }
    this.loadReady();
  }

  /** Writes the tracker to the repo's config, then shows its board. */
  private async save(): Promise<void> {
    const s = this.s!;
    if (!this.model()?.save.can) return;
    const d = this.d;
    s.saving = true;
    s.saveError = null;
    this.bump();
    try {
      const defaults = d.pickers.filter((p) => s.pickers[p.key]!.options.find((o) => o.value === s.pickers[p.key]!.selected[0])?.default).map((p) => p.key);
      const record = d.toConfig({ host: s.host, values: connectValues(s, d), defaults, ownRepo: s.ownRepo });
      this.deps.write(s.root!, s.existing?.index ?? null, record);
      const root = s.root!;
      this.close();
      await this.deps.saved(root, d.name);
    } catch (e) {
      // Written, then the reload after it failed: the page has closed, so the log says so.
      if (this.s !== s) { this.deps.log(`[connect] ${d.name}: saved, but reloading after it failed: ${(e as Error).message}`); return; }
      s.saving = false;
      s.saveError = `Couldn't save: ${(e as Error).message}`;
      this.bump();
    }
  }
}
