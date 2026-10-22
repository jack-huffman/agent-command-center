/**
 * Settings' About (GH-114): the versions of acc, the extension and the plugin, read fresh, and whether a
 * newer GitHub Release is out, with a link to its notes. A plugin older than the extension is said with
 * Setup's A4 fix, through the comparison A4 fails on (pluginBehind, D-088).
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 * Each state is its own LOOK with its icon and tone written out: looks.test matches every one to a state
 * its walk reaches (GH-147).
 */

import { pluginBehind } from '../../../packages/core/src/onboarding/helpers.ts';
import { PLUGIN } from '../../../packages/core/src/onboarding/steps.ts';
import { COMMANDS } from '../logic/setup.ts';
import { durationWords } from './limits.ts';
import type { SettingFrom } from './settings.ts';
import { LOOK, type Look, type ModelArea } from './shared.ts';

/** The repo whose Releases are acc's: the marketplace's own, as owner/name. */
export const RELEASES_REPO = PLUGIN.repo.replace(/^https:\/\/github\.com\//, '');

/** How often a newer release is looked for, by itself or when Settings opens, after the first look in a session. */
export const RELEASE_EVERY_MS = 6 * 60 * 60 * 1000;

/** Whether to look for a newer release now: never yet in this session, or not for RELEASE_EVERY_MS. */
export const releaseDue = (last: number | null, now: number): boolean => last === null || now - last >= RELEASE_EVERY_MS;

/** What gh is asked, as gh's active account (D-088): the latest release, which leaves drafts and prereleases out. */
export const RELEASE_ARGS = ['release', 'view', '--repo', RELEASES_REPO, '--json', 'tagName,name,url,publishedAt'];

/** A read that worked, with what it found, or didn't, with why in a line. */
export type Read<T> = { ok: true; value: T } | { ok: false; error: string };

/** The latest release, as gh says it. */
export interface Release {
  /** Its version, its tag without a leading v. */
  version: string;
  tag: string;
  name: string;
  /** Its page on GitHub, where its notes are. */
  url: string;
}

/** The acc plugin in Claude Code, for every session; null when it isn't installed there. */
export type PluginFacts = { version: string | null; enabled: boolean } | null;

/** What About knows. Null reads haven't come back yet in this session. */
export interface AboutFacts {
  /** The extension's version, from its own package.json. */
  extension: string;
  /** acc's, from `acc --version`: the bundle the extension runs, and the acc on its terminals' PATH. */
  acc: Read<string> | null;
  /** `claude plugin list --json`'s acc. Claude Code not installed is an error with missing set. */
  plugin: (Read<PluginFacts> & { missing?: boolean }) | null;
  /** The latest release; value null when the repo has none yet. */
  release: Read<Release | null> | null;
  /** The versions are being read, or a release looked for, now. */
  reading: boolean;
  checking: boolean;
  /** When a release was last looked for, by the extension's clock. */
  checkedAt: number | null;
  /** Whether the extension looks for a release by itself (T-62), as its setting says. */
  auto: boolean;
}

/** A button: one of the commands the page may ask for. Disabled, it says why. */
export interface AboutAction {
  command: string;
  label: string;
  icon: string;
  arg: string | null;
  /** What it does, for a screen reader. */
  name: string;
  primary: boolean;
  disabled: string | null;
}

export interface AboutRow {
  key: 'acc' | 'extension' | 'plugin';
  name: string;
  icon: string;
  look: Look;
  /** Where the version is read from. */
  from: SettingFrom;
  /** What the state means, or what to do, in a line. */
  meaning: string | null;
  action: AboutAction | null;
}

export interface AboutModel {
  rows: AboutRow[];
  release: {
    look: Look;
    /** A newer release's notes. */
    notes: { label: string; url: string } | null;
    /** A newer release's Install and reload (T-62). */
    install: AboutAction | null;
    /** When it was last looked for, and how often it's looked for. */
    when: string;
    check: AboutAction;
  };
}

/** The commands About runs: Check now, Install and reload (T-62), and Setup's own fix for A4 (D-088). */
export const ABOUT_COMMANDS = { check: 'acc.about.check', install: 'acc.update.install', fix: COMMANDS.fix } as const;

/** A release's tag as a version: v0.38.0 is 0.38.0. */
export const tagVersion = (tag: string): string => tag.replace(/^v(?=\d)/, '');

/** Whether a release is newer than this extension. Only x.y.z against x.y.z: anything else isn't said to be newer. */
export const releaseNewer = (release: string, current: string): boolean => pluginBehind(current, release);

/** gh's answer to RELEASE_ARGS. "release not found" is a repo with no release yet, not a failure. */
export function parseRelease(r: { code: number; stdout: string; stderr: string }): Read<Release | null> {
  const said = (r.stderr || r.stdout).trim().split('\n')[0] ?? '';
  if (r.code === 127) return { ok: false, error: 'gh isn\'t installed' };
  if (r.code !== 0) return /release not found/i.test(said) ? { ok: true, value: null } : { ok: false, error: said || `gh exited ${r.code}` };
  try {
    const j = JSON.parse(r.stdout) as Record<string, unknown>;
    if (typeof j.tagName !== 'string' || typeof j.url !== 'string' || !/^https:\/\/github\.com\//.test(j.url)) throw new Error('no tag');
    return { ok: true, value: { version: tagVersion(j.tagName), tag: j.tagName, name: typeof j.name === 'string' && j.name ? j.name : j.tagName, url: j.url } };
  } catch {
    return { ok: false, error: 'gh printed something other than a release' };
  }
}

/** `acc --version`'s answer. */
export function parseAccVersion(r: { code: number; stdout: string; stderr: string }): Read<string> {
  const v = r.stdout.trim();
  if (r.code === 0 && /^\d+\.\d+\.\d+\S*$/.test(v)) return { ok: true, value: v };
  return { ok: false, error: (r.stderr || r.stdout).trim().split('\n')[0] || `the Command Center stopped with code ${r.code}` };
}

const FROM = {
  acc: { label: 'Bundled with the extension', icon: 'package' },
  extension: { label: 'VSCode on this machine', icon: 'extensions' },
  plugin: { label: 'Claude Code on this machine, for every session', icon: 'plug' },
} satisfies Record<AboutRow['key'], SettingFrom>;

const READING = LOOK('Reading it', 'sync~spin', 'blue');

/** Setup's A4 fix, run as Setup runs it: the check again, then the command it names (D-088). */
const fixA4 = (label: string, name: string): AboutAction => ({ command: ABOUT_COMMANDS.fix, label, icon: 'tools', arg: 'A4.plugin', name, primary: true, disabled: null });

function pluginRow(f: AboutFacts): AboutRow {
  const row = (look: Look, meaning: string | null, action: AboutAction | null = null): AboutRow => ({ key: 'plugin', name: 'The Claude Code plugin', icon: 'plug', look, from: FROM.plugin, meaning, action });
  const p = f.plugin;
  if (!p) return row(READING, null);
  if (!p.ok) {
    return p.missing
      ? row(LOOK('Claude Code isn\'t installed', 'warning', 'orange'), 'Setup\'s A4 installs it, then the plugin.', fixA4('Install', 'Install Claude Code and the Command Center\'s plugin, as Setup\'s A4 does'))
      : row(LOOK(`Couldn't read Claude Code's plugins: ${p.error}`, 'circle-outline', 'neutral'), null);
  }
  if (!p.value) return row(LOOK('Not installed in Claude Code', 'warning', 'orange'), 'Its hooks keep each builder in its own worktree. Setup\'s A4 installs it.', fixA4('Install', 'Install the Command Center\'s Claude Code plugin, as Setup\'s A4 does'));
  const v = p.value.version ?? 'unknown version';
  if (!p.value.enabled) return row(LOOK(`${v}, turned off`, 'warning', 'orange'), 'Setup\'s A4 turns it on.', fixA4('Turn on', 'Turn on the Command Center\'s Claude Code plugin, as Setup\'s A4 does'));
  if (pluginBehind(p.value.version, f.extension)) {
    return row(LOOK(`${v}, older than the extension's ${f.extension}`, 'arrow-circle-down', 'orange'),
      'Its hooks may not know what this Command Center asks of builders. Setup\'s A4 updates it; sessions already running keep the old one.',
      fixA4('Update the plugin', `Update the plugin to ${f.extension}: the Command Center's Claude Code plugin, as Setup's A4 does`));
  }
  return row(p.value.version === f.extension ? LOOK(`${v}, the same as the extension`, 'pass', 'blue') : LOOK(`${v}, for every Claude Code session`, 'pass', 'blue'), null);
}

/** About, from what's been read: each version with where it's read from, then the latest release. */
export function aboutModel(f: AboutFacts, now: number): AboutModel {
  const acc: AboutRow = {
    key: 'acc', name: 'The command-line engine', icon: 'terminal', from: FROM.acc, action: null,
    ...(!f.acc ? { look: READING, meaning: null }
      : f.acc.ok ? { look: LOOK(f.acc.value, 'pass', 'blue'), meaning: f.acc.value === f.extension ? null : `The extension is ${f.extension}: reload VSCode's window to run the engine it brings.` }
        : { look: LOOK(`Couldn't run it: ${f.acc.error}`, 'circle-outline', 'neutral'), meaning: null }),
  };
  const extension: AboutRow = { key: 'extension', name: 'The extension', icon: 'extensions', look: f.extension ? LOOK(f.extension, 'pass', 'blue') : LOOK('Unknown', 'circle-outline', 'neutral'), from: FROM.extension, meaning: null, action: null };
  const r = f.release;
  const newer = r?.ok && r.value && releaseNewer(r.value.version, f.extension) ? r.value : null;
  const look: Look = f.checking ? LOOK('Looking on GitHub for a newer release', 'sync~spin', 'blue')
    : !r ? LOOK('Not looked for yet', 'circle-outline', 'neutral')
      // A look that failed isn't a problem: nothing is wrong here, and it's looked for again.
      : !r.ok ? LOOK(`Couldn't look: ${r.error}`, 'circle-outline', 'neutral')
        : !r.value ? LOOK('No release yet', 'circle-outline', 'neutral')
          : newer ? LOOK(`${newer.version} is out: this is ${f.extension}`, 'arrow-circle-up', 'orange')
            : LOOK(`Up to date: ${r.value.version} is the latest release`, 'pass', 'blue');
  const ago = f.checkedAt === null ? null : now - f.checkedAt < 60_000 ? 'just now' : `${durationWords(now - f.checkedAt)} ago`;
  return {
    rows: [acc, extension, pluginRow(f)],
    release: {
      look,
      notes: newer ? { label: `Read ${newer.name}'s notes`, url: newer.url } : null,
      install: newer ? { command: ABOUT_COMMANDS.install, label: 'Install and reload', icon: 'cloud-download', arg: newer.version, name: `Install and reload: ${newer.version}, then the Command Center opens on it`, primary: true, disabled: null } : null,
      when: `${ago ? `Looked ${ago}, as gh's active account.` : 'Looked for as gh\'s active account.'} ${f.auto
        ? `Looked for again by itself, and when Settings opens, at most every ${durationWords(RELEASE_EVERY_MS)}, or now with Check now.`
        : `Looking by itself is off in VSCode's settings: looked for when Settings opens, at most every ${durationWords(RELEASE_EVERY_MS)}, or now with Check now.`}`,
      check: { command: ABOUT_COMMANDS.check, label: 'Check now', icon: 'refresh', arg: null, name: 'Check now for a newer release, and read the versions again', primary: false, disabled: f.checking ? 'It\'s looking now.' : null },
    },
  };
}

export const area: ModelArea = {
  // Setup's acc.step.fix is Setup's to claim; About asks for it too. Install and reload is self-update.ts's.
  commands: [ABOUT_COMMANDS.check, ABOUT_COMMANDS.install],
};
