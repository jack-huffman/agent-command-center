// Settings' About (GH-114), VS Code's side: the versions of acc, the extension and the plugin, read each
// time Settings is arrived at, and the latest GitHub Release, looked for when Settings shows or by itself
// (T-62), at most every six hours, or at Check now. One look serves both: what the look by itself finds,
// About shows, and the update's offer hears of each look About makes. Everything here reads: the page
// writes nothing (D-064), the plugin's update is Setup's own A4 fix, and the extension's is self-update.ts's. VS Code's API comes from the parts activate()
// hands every area, so a test can drive it with stand-ins (D-099).

import { parsePluginList, PLUGIN_LIST_ARGS, userPlugin } from '../../packages/core/src/onboarding/steps.ts';
import type { ExtensionArea } from './area.ts';
import { type AboutFacts, parseAccVersion, parseRelease, RELEASE_ARGS, releaseDue } from './model/about.ts';
import type { RunResult } from './run.ts';

/** What About needs from the rest of the extension. */
export interface AboutDeps {
  /** The extension's version, read now from its package.json. */
  extension(): string;
  /** `acc --version`, from the bundle the extension runs. */
  acc(): Promise<RunResult>;
  /** A program on PATH: claude, and gh. */
  run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<RunResult>;
  now(): number;
  /** Whether the extension looks for a release by itself (T-62), the setting, read now. */
  auto(): boolean;
  /** What it knows changed: the page redraws. */
  changed(): void;
  env: NodeJS.ProcessEnv;
}

/**
 * gh as its active account (D-088): the repo is private, and its releases are read as whoever is signed in
 * to gh, not as a project's account, so a token in the environment, which would win, is left out.
 */
export const activeAccountEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const { GH_TOKEN: _a, GITHUB_TOKEN: _b, GH_ENTERPRISE_TOKEN: _c, GITHUB_ENTERPRISE_TOKEN: _d, ...rest } = env;
  return rest;
};

/** `claude plugin list --json`'s acc, read through A4's own reader (parsePluginList, then userPlugin; GH-147). */
export function parsePlugins(r: RunResult): NonNullable<AboutFacts['plugin']> {
  const read = parsePluginList(r);
  if (read.ok) return { ok: true, value: userPlugin(read.list) };
  return read.missing ? { ok: false, error: read.error, missing: true } : { ok: false, error: read.error };
}

export class About {
  private acc: AboutFacts['acc'] = null;
  private plugin: AboutFacts['plugin'] = null;
  private release: AboutFacts['release'] = null;
  private checkedAt: number | null = null;
  private reading: Promise<void> | null = null;
  private checking: Promise<void> | null = null;
  private readonly looked: ((r: NonNullable<AboutFacts['release']>) => void)[] = [];
  private readonly d: AboutDeps;

  constructor(d: AboutDeps) {
    this.d = d;
  }

  facts(): AboutFacts {
    return { extension: this.d.extension(), acc: this.acc, plugin: this.plugin, release: this.release, reading: !!this.reading, checking: !!this.checking, checkedAt: this.checkedAt, auto: this.d.auto() };
  }

  /** Hears of each look for a release, whoever asked for it, once it's stored (T-62). */
  onLooked(fn: (r: NonNullable<AboutFacts['release']>) => void): void {
    this.looked.push(fn);
  }

  /** The look by itself (T-62): a release, when one is due, or the look already going. */
  lookIfDue(): Promise<void> {
    return this.checking ?? (releaseDue(this.checkedAt, this.d.now()) ? this.lookForRelease() : Promise.resolve());
  }

  /**
   * Settings was arrived at: the versions are read again, and a release looked for when one is due (once a
   * session, then every six hours). A read already going isn't started twice.
   */
  arrive(): Promise<void> {
    return Promise.all([this.readVersions(), releaseDue(this.checkedAt, this.d.now()) ? this.lookForRelease() : Promise.resolve()]).then(() => undefined);
  }

  /** Check now: the versions and the latest release, whenever it was last looked for. */
  checkNow(): Promise<void> {
    return Promise.all([this.readVersions(), this.lookForRelease()]).then(() => undefined);
  }

  // Each look is stored before the page redraws, so the redraw shows it under way (GH-114).
  private readVersions(): Promise<void> {
    if (this.reading) return this.reading;
    this.reading = (async () => {
      const [acc, plugins] = await Promise.all([this.d.acc(), this.d.run('claude', PLUGIN_LIST_ARGS, this.d.env)]);
      this.acc = parseAccVersion(acc);
      this.plugin = parsePlugins(plugins);
    })().finally(() => {
      this.reading = null;
      this.d.changed();
    });
    this.d.changed();
    return this.reading;
  }

  private lookForRelease(): Promise<void> {
    if (this.checking) return this.checking;
    this.checking = (async () => {
      this.release = parseRelease(await this.d.run('gh', RELEASE_ARGS, activeAccountEnv(this.d.env)));
    })().catch((e: unknown) => {
      // A look that fails reads neutral. It counts as a look, so the next waits its six hours; Check now asks again.
      this.release = { ok: false, error: (e as Error).message };
    }).finally(() => {
      this.checkedAt = this.d.now();
      this.checking = null;
      this.d.changed();
      for (const fn of this.looked) fn(this.release!);
    });
    this.d.changed();
    return this.checking;
  }
}

export const area: ExtensionArea = {
  register({ reg, about }) {
    reg('acc.about.check', () => about.checkNow());
  },
};
