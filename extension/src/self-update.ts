// The extension's own update (T-62): a look for a newer release by itself, a minute after activation and
// then every six hours, shared with Settings' About; one notification for each newer version; and Install
// and reload, which downloads the release's VSIX as gh's active account, checks it, updates an older Claude
// Code plugin (T-152), installs the VSIX and reloads the window, to open the Command Center on the new
// version. VS Code's API comes in as a part, so a test drives it with a stand-in (D-099). The decisions are
// logic/self-update.ts's and logic/plugin-update.ts's.

import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type * as vscode from 'vscode';
import type { InstallSystem } from '../../packages/core/src/onboarding/install-lines.ts';
import { PLUGIN_LIST_ARGS } from '../../packages/core/src/onboarding/steps.ts';
import { activeAccountEnv, type About } from './about.ts';
import type { ExtensionArea } from './area.ts';
import { PLUGIN_FIX, PLUGIN_STEP, type PluginOutcome, pluginPlan, pluginRunOutcome, pluginUpdateRun } from './logic/plugin-update.ts';
import { AFTER_STATE, afterText, afterUpdate, checksumCheck, downloadArgs, FIRST_LOOK_MS, nextLookIn, OFFER_BUTTONS, offerText, pickVsix, shouldOffer, SKIPPED_STATE } from './logic/self-update.ts';
import { RELEASE_EVERY_MS, type Release } from './model/about.ts';
import type { RunResult } from './run.ts';

/** What the update needs from the rest of the extension. */
export interface SelfUpdateDeps {
  vscode: Pick<typeof vscode, 'window' | 'commands' | 'Uri' | 'env' | 'ProgressLocation'>;
  /** Whether the extension looks by itself: the agentCommandCenter.updates.check setting, default on, read now. */
  auto(): boolean;
  /** VS Code's global state: the skipped version, and the version to open on after the reload. */
  state: { get(key: string): unknown; update(key: string, value: unknown): Thenable<void> };
  /** The running extension's version. */
  running(): string;
  /** Opens the Command Center. */
  open(): unknown;
  about: Pick<About, 'facts' | 'lookIfDue' | 'onLooked'>;
  /** A program on PATH: gh, claude, and the shell that runs the plugin's update. */
  run(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<RunResult>;
  env: NodeJS.ProcessEnv;
  /** The system the plugin's update line is built for: the one the extension runs on, unless a test sets one. */
  system?: InstallSystem;
  now(): number;
  /** The folder each download's own temporary folder is made in. */
  tmp: string;
  log(line: string): void;
}

const INSTALL = 'workbench.extensions.installExtension';
const RELOAD = 'workbench.action.reloadWindow';

export class SelfUpdate {
  private readonly d: SelfUpdateDeps;
  /** Versions offered in this session: a closed notification isn't shown again. */
  private readonly offered = new Set<string>();
  private installing: Promise<boolean> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(d: SelfUpdateDeps) {
    this.d = d;
    d.about.onLooked((r) => { if (r.ok && r.value) void this.offer(r.value); });
  }

  /** The look by itself: the first FIRST_LOOK_MS after activation, then each RELEASE_EVERY_MS after the last look, whoever made it. */
  start(): vscode.Disposable {
    const schedule = (ms: number) => {
      this.timer = setTimeout(() => void tick(), ms);
    };
    const tick = async () => {
      if (this.d.auto()) await this.d.about.lookIfDue();
      // With the setting off, or a look just made, the next is a full interval away.
      schedule(nextLookIn(this.d.about.facts().checkedAt, this.d.now()) || RELEASE_EVERY_MS);
    };
    schedule(FIRST_LOOK_MS);
    return { dispose: () => clearTimeout(this.timer) };
  }

  /** One notification for a newer version: once a session, never for a skipped one, and not with the setting off. */
  async offer(release: Release): Promise<void> {
    const skipped = this.d.state.get(SKIPPED_STATE);
    if (!this.d.auto() || !shouldOffer(release.version, this.d.running(), typeof skipped === 'string' ? skipped : null, this.offered)) return;
    this.offered.add(release.version);
    const pick = await this.d.vscode.window.showInformationMessage(offerText(release.version), OFFER_BUTTONS.install, OFFER_BUTTONS.notes, OFFER_BUTTONS.skip);
    if (pick === OFFER_BUTTONS.install) await this.install(release.version);
    else if (pick === OFFER_BUTTONS.notes) await this.d.vscode.env.openExternal(this.d.vscode.Uri.parse(release.url));
    else if (pick === OFFER_BUTTONS.skip) await this.d.state.update(SKIPPED_STATE, release.version);
  }

  /**
   * Install and reload: the latest release About knows of, when it's the version asked for. Each step shows
   * in a progress notification; a failure says which, offers the release's notes, and installs nothing. An
   * install already going isn't started twice. True when it installed and asked for the reload.
   */
  install(version?: unknown): Promise<boolean> {
    if (this.installing) return this.installing;
    this.installing = this.installRelease(typeof version === 'string' ? version : null).finally(() => { this.installing = null; });
    return this.installing;
  }

  private async installRelease(asked: string | null): Promise<boolean> {
    const { window, commands, Uri, env, ProgressLocation } = this.d.vscode;
    const r = this.d.about.facts().release;
    const release = r?.ok ? r.value : null;
    if (!release || (asked !== null && asked !== release.version)) {
      void window.showWarningMessage(`Couldn't update${asked ? ` to ${asked}` : ''}: it isn't the latest release any more. Check now in Settings' About looks again.`);
      return false;
    }
    const failed = async (why: string) => {
      this.d.log(`The update to ${release.version} failed: ${why}`);
      const pick = await window.showWarningMessage(`Couldn't update to ${release.version}: ${why}.`, OFFER_BUTTONS.notes);
      if (pick === OFFER_BUTTONS.notes) await env.openExternal(Uri.parse(release.url));
      return false;
    };
    let plugin: PluginOutcome | undefined;
    const why = await window.withProgress({ location: ProgressLocation.Notification, title: `Updating Agent Command Center to ${release.version}` }, async (progress) => {
      const dir = mkdtempSync(join(this.d.tmp, 'acc-update-'));
      try {
        progress.report({ message: 'Downloading the release' });
        const got = await this.d.run('gh', downloadArgs(release.tag, dir), activeAccountEnv(this.d.env));
        if (got.code !== 0) return `couldn't download it: ${(got.stderr || got.stdout).trim().split('\n')[0] || `gh exited ${got.code}`}`;
        progress.report({ message: 'Checking the download' });
        const picked = pickVsix(readdirSync(dir), release.version);
        if (!picked.ok) return picked.error;
        const file = join(dir, picked.file);
        const sum = `${file}.sha256`;
        const checked = checksumCheck(createHash('sha256').update(readFileSync(file)).digest('hex'), existsSync(sum) ? readFileSync(sum, 'utf8') : null, picked.file);
        if (!checked.ok) return checked.error;
        plugin = await this.updatePlugin(release.version, (message) => progress.report({ message }));
        progress.report({ message: 'Installing' });
        await commands.executeCommand(INSTALL, Uri.file(file));
        return null;
      } catch (e) {
        return `the install failed: ${(e as Error).message}`;
      } finally {
        // Removed before the reload, which ends this window's run of the extension.
        rmSync(dir, { recursive: true, force: true });
      }
    });
    if (why !== null) return failed(why);
    await this.d.state.update(AFTER_STATE, { version: release.version, at: this.d.now(), ...(plugin ? { plugin } : {}) });
    await commands.executeCommand(RELOAD);
    return true;
  }

  /**
   * The plugin step (T-152): A4's own update line, as gh's active account for the git it runs, for a plugin
   * installed for every session and older than the version being installed. A plugin that isn't there is left
   * for Setup. What it did is the outcome; a failure never stops the extension's update, and its reason is
   * logged and said after the reload. Nothing to do is no outcome.
   */
  private async updatePlugin(version: string, report: (message: string) => void): Promise<PluginOutcome | undefined> {
    let outcome: PluginOutcome | undefined;
    try {
      const plan = pluginPlan(await this.d.run('claude', PLUGIN_LIST_ARGS, this.d.env), version);
      if (plan.kind === 'leave') return undefined;
      if (plan.kind === 'failed') outcome = plan;
      else {
        report(PLUGIN_STEP);
        const { cmd, args } = pluginUpdateRun(this.d.system);
        outcome = pluginRunOutcome(await this.d.run(cmd, args, activeAccountEnv(this.d.env)));
      }
    } catch (e) {
      outcome = { kind: 'failed', why: (e as Error).message };
    }
    if (outcome.kind === 'failed') this.d.log(`The Claude Code plugin didn't update to ${version}: ${outcome.why}`);
    return outcome;
  }

  /**
   * The first activation after an install: open the Command Center on the new version, or say it didn't take,
   * with what the plugin step did. A failed plugin step warns, and its button runs Setup's A4 Do it.
   */
  async afterActivation(): Promise<void> {
    const r = afterUpdate(this.d.state.get(AFTER_STATE), this.d.running());
    if (!r) return;
    await this.d.state.update(AFTER_STATE, undefined);
    const words = afterText(r, this.d.running());
    if (r.kind === 'opened') await this.d.open();
    const { window, commands } = this.d.vscode;
    if (r.plugin?.kind === 'failed') {
      void window.showWarningMessage(words, PLUGIN_FIX.label).then((pick) => pick === PLUGIN_FIX.label && commands.executeCommand(PLUGIN_FIX.command, PLUGIN_FIX.step));
    } else if (r.kind === 'missed') void window.showWarningMessage(words);
    else void window.showInformationMessage(words);
  }
}

export const area: ExtensionArea = {
  register({ reg, selfUpdate }) {
    // ABOUT_COMMANDS.install, named here as areas.test reads registrations.
    reg('acc.update.install', (version?: unknown) => selfUpdate.install(version));
  },
};
