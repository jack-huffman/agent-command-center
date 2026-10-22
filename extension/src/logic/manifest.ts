/**
 * A ticket's manifest from the Command Center (T-101): Build and Check against the org ask acc in the output
 * panel, where its steps show; Use the org's copy, Add to this ticket and Add to the ticket's branch ask acc to
 * change the ticket's branch, each as the person's own commit. acc keeps the manifest; this reads it back for
 * the page. Nothing here deploys. Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */
import type { Task } from '../../../packages/core/src/ledger.ts';
import { DESTRUCTIVE_FILE, manifestRefusal, PACKAGE_FILE, readManifest, saveManifest, splitComponent, type TicketManifest } from '../../../packages/core/src/manifest.ts';
import { accRefusal } from './connect.ts';
import { inProcessWords } from './processes.ts';
import { stateOf } from './shared.ts';

type Result = { code: number; stdout: string; stderr: string };

/** What the manifest needs from the extension, passed in so it's tested without VS Code, sf or acc. */
export interface ManifestHost {
  project(root: string): { root: string; ledgerPath: string; profile: string } | undefined;
  task(root: string, id: string): Pick<Task, 'id' | 'run' | 'state'> | undefined;
  /** Runs acc; with a label, in the output panel, where its steps show. */
  acc(args: string[], cwd: string, label?: string): Promise<Result>;
}

/** How a button went: done, or why not. */
export type ManifestReply = { ok: true } | { ok: false; error: string };

/** What the page shows of a task's manifest: the kept one, and what runs now, in words for "It's … now". */
export interface ManifestState {
  manifest: TicketManifest | null;
  running: string | null;
}

/** What View, Copy, Save as a file and See the difference need of the editor, passed in so they're tested without it. */
export interface ManifestUi {
  /** Opens text beside the page, as an editor tab nobody has saved. */
  show(content: string, language: string): Promise<void>;
  copy(text: string): Promise<void>;
  /** Where the person chose to save it, or null when they chose nowhere. */
  saveTo(task: string): Promise<string | null>;
  info(text: string): void;
}

export class Manifests {
  private readonly host: ManifestHost;
  private readonly changed: (root: string, id: string) => void;
  /** What this window has asked acc to do, by project and task, while it runs. */
  private readonly busy = new Map<string, string>();

  constructor(host: ManifestHost, changed: (root: string, id: string) => void = () => {}) {
    this.host = host;
    this.changed = changed;
  }

  /** The task's kept manifest, and what runs for it now. */
  state(root: string, raw: string): ManifestState {
    const id = raw.toUpperCase();
    const p = this.host.project(root);
    return { manifest: p ? readManifest(stateOf(p), id) : null, running: this.busy.get(`${root}#${id}`) ?? null };
  }

  /** acc, once a task at a time: refused before it runs for a project that closed, a task with no manifest to have, or one under way. */
  private async ask(root: string, raw: string, doing: string, args: (id: string) => string[], label?: (id: string) => string): Promise<ManifestReply> {
    const id = raw.toUpperCase();
    const key = `${root}#${id}`;
    const p = this.host.project(root);
    if (!p) return { ok: false, error: 'That project isn\'t open any more.' };
    const why = manifestRefusal(p, this.host.task(root, id), id);
    if (why) return { ok: false, error: why };
    const running = this.busy.get(key);
    if (running) return { ok: false, error: `It's ${running} now. Wait for it to finish.` };
    this.busy.set(key, doing);
    this.changed(root, id);
    try {
      const no = accRefusal(await this.host.acc(args(id), root, label?.(id)));
      return no === null ? { ok: true } : { ok: false, error: no };
    } catch (e) {
      return { ok: false, error: inProcessWords((e as Error).message) };
    } finally {
      this.busy.delete(key);
      this.changed(root, id);
    }
  }

  /** Build the manifest, and with `check`, check it against the org, in the output panel. */
  build(root: string, id: string, check = false): Promise<ManifestReply> {
    return check
      ? this.ask(root, id, 'checking against the org', (t) => ['manifest', t, '--check', '--json'], (t) => `Check ${t}'s manifest against the org`)
      : this.ask(root, id, 'building the manifest', (t) => ['manifest', t, '--json'], (t) => `Build ${t}'s manifest`);
  }

  /** Use the org's copy, or Add to this ticket: one component into the ticket's branch, as the person's commit. */
  retrieve(root: string, id: string, component: string): Promise<ManifestReply> {
    const c = splitComponent(component);
    if (!c) return Promise.resolve({ ok: false, error: `${component} isn't a component.` });
    return this.ask(root, id, `retrieving ${c.type} ${c.member}`, (t) => ['manifest', 'retrieve', t, component, '--json'], (t) => `Use the org's copy in ${t}`);
  }

  /** Add to the ticket's branch: the manifest, committed at manifest/tickets/<key>/, as the person. */
  commit(root: string, id: string): Promise<ManifestReply> {
    return this.ask(root, id, 'adding the manifest to the branch', (t) => ['manifest', 'commit', t, '--json']);
  }

  /** View, Copy or Save as a file: the kept manifest, never one built again. Saving writes the deletions beside it. */
  async file(root: string, raw: string, how: 'view' | 'copy' | 'save', ui: ManifestUi): Promise<ManifestReply> {
    const id = raw.toUpperCase();
    const kept = this.state(root, id).manifest;
    if (!kept) return { ok: false, error: `${id} has no manifest yet. Build it first.` };
    if (how === 'view') {
      await ui.show(kept.package, 'xml');
      if (kept.destructive) await ui.show(kept.destructive, 'xml');
      return { ok: true };
    }
    if (how === 'copy') {
      await ui.copy(kept.package);
      ui.info(kept.destructive ? `Copied ${id}'s ${PACKAGE_FILE}. Its deletions are apart, in ${DESTRUCTIVE_FILE}: Save as a file writes both.` : `Copied ${id}'s ${PACKAGE_FILE}.`);
      return { ok: true };
    }
    const to = await ui.saveTo(id);
    if (!to) return { ok: true };
    try {
      ui.info(`Saved ${saveManifest(kept, to).join(' and ')}.`);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Couldn't save it: ${(e as Error).message}` };
    }
  }

  /** See the difference: one org copy's difference from the branch, from the kept check. */
  async diff(root: string, id: string, component: string, ui: ManifestUi): Promise<ManifestReply> {
    const d = this.state(root, id).manifest?.check?.differs.find((x) => `${x.type}:${x.member}` === component);
    if (!d) return { ok: false, error: 'That difference isn\'t kept any more. Check against the org again.' };
    await ui.show(d.diff, 'diff');
    return { ok: true };
  }
}
