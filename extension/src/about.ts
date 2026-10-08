// Settings' About (GH-114), VS Code's side: the versions of acc, the extension and the plugin, read each
// time Settings is arrived at, and the latest GitHub Release, looked for once when Settings first shows in
// a session, then at most every six hours, or at Check now. Everything here reads: the page writes nothing
// (D-064), and the plugin's update is Setup's own A4 fix. VS Code's API comes from the parts activate()
// hands every area, so a test can drive it with stand-ins (D-099).

import { parseJsonOutput } from '../../packages/core/src/exec.ts';
import { userPlugin } from '../../packages/core/src/onboarding/steps.ts';
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

/** `claude plugin list --json`'s acc, as A4 reads it (userPlugin). */
export function parsePlugins(r: RunResult): NonNullable<AboutFacts['plugin']> {
  if (r.code === 127) return { ok: false, error: 'claude isn\'t installed', missing: true };
  if (r.code !== 0) return { ok: false, error: (r.stderr || r.stdout).trim().split('\n')[0] || `claude exited ${r.code}` };
  try {
    const list = parseJsonOutput<unknown>(r.stdout);
    if (Array.isArray(list) && list.every((x) => x && typeof x === 'object')) return { ok: true, value: userPlugin(list as Record<string, unknown>[]) };
  } catch {
    // said below
  }
  return { ok: false, error: 'claude printed something other than a list' };
}

export class About {
  private acc: AboutFacts['acc'] = null;
  private plugin: AboutFacts['plugin'] = null;
  private release: AboutFacts['release'] = null;
  private checkedAt: number | null = null;
  private reading: Promise<void> | null = null;
  private checking: Promise<void> | null = null;
  private readonly d: AboutDeps;

  constructor(d: AboutDeps) {
    this.d = d;
  }

  facts(): AboutFacts {
    return { extension: this.d.extension(), acc: this.acc, plugin: this.plugin, release: this.release, reading: !!this.reading, checking: !!this.checking, checkedAt: this.checkedAt };
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

  private readVersions(): Promise<void> {
    this.reading ??= (async () => {
      this.d.changed();
      const [acc, plugins] = await Promise.all([this.d.acc(), this.d.run('claude', ['plugin', 'list', '--json'], this.d.env)]);
      this.acc = parseAccVersion(acc);
      this.plugin = parsePlugins(plugins);
    })().finally(() => {
      this.reading = null;
      this.d.changed();
    });
    return this.reading;
  }

  private lookForRelease(): Promise<void> {
    this.checking ??= (async () => {
      this.d.changed();
      this.release = parseRelease(await this.d.run('gh', RELEASE_ARGS, activeAccountEnv(this.d.env)));
    })().catch((e: unknown) => {
      // A look that fails reads neutral, and is looked for again next time.
      this.release = { ok: false, error: (e as Error).message };
    }).finally(() => {
      this.checkedAt = this.d.now();
      this.checking = null;
      this.d.changed();
    });
    return this.checking;
  }
}

export const area: ExtensionArea = {
  register({ reg, about }) {
    reg('acc.about.check', () => about.checkNow());
  },
};
