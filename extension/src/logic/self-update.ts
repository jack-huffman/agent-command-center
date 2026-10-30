/**
 * The extension's own update (T-62): whether to offer a newer release, the checks a downloaded VSIX must
 * pass before it installs, and what to do on the first activation after an install. No vscode import, so
 * it's testable. extension/src/self-update.ts runs it.
 */

import { vsixName } from '../../../packages/core/src/onboarding/steps.ts';
import { RELEASE_EVERY_MS, RELEASES_REPO, releaseNewer } from '../model/about.ts';
import { type PluginOutcome, pluginWords, savedPlugin } from './plugin-update.ts';

/** How long after activation the first look waits, so a window's start isn't slowed by it. */
export const FIRST_LOOK_MS = 60_000;

/** Global state: the version a person skipped, and the version an install is to open on after its reload. */
export const SKIPPED_STATE = 'acc.update.skipped';
export const AFTER_STATE = 'acc.update.after';

/** The notification's buttons. */
export const OFFER_BUTTONS = { install: 'Install and reload', notes: 'Release notes', skip: 'Skip this version' } as const;

/** The words of the offer. */
export const offerText = (version: string): string => `Agent Command Center ${version} is out`;

/**
 * Whether to offer a version: newer than the running one, not the skipped one or older than it, and not
 * offered already in this session (a closed notification counts as offered).
 */
export function shouldOffer(version: string, running: string, skipped: string | null, offered: ReadonlySet<string>): boolean {
  if (!releaseNewer(version, running) || offered.has(version)) return false;
  return skipped === null || releaseNewer(version, skipped);
}

/**
 * When the next look by itself is due: at once when none has been made, else RELEASE_EVERY_MS after the
 * last, which About's Check now or Settings may have made.
 */
export const nextLookIn = (checkedAt: number | null, now: number): number => (checkedAt === null ? 0 : Math.max(0, checkedAt + RELEASE_EVERY_MS - now));

/** What gh is asked, as its active account: the release's VSIX and its checksum, into one folder. */
export const downloadArgs = (tag: string, dir: string): string[] => ['release', 'download', tag, '--repo', RELEASES_REPO, '--pattern', '*.vsix', '--pattern', '*.vsix.sha256', '--dir', dir];

/**
 * The downloaded VSIX, from what's in the folder: exactly one, named for the release's version. A file
 * named for another version, or none, or two, isn't installed.
 */
export function pickVsix(files: readonly string[], version: string): { ok: true; file: string } | { ok: false; error: string } {
  const found = files.filter((f) => f.endsWith('.vsix'));
  if (found.length === 0) return { ok: false, error: 'the release has no extension file' };
  if (found.length > 1) return { ok: false, error: `the release has ${found.length} extension files, not one` };
  if (found[0] !== vsixName(version)) return { ok: false, error: `its file, ${found[0]}, isn't named for ${version}` };
  return { ok: true, file: found[0] };
}

/**
 * The checksum check: the VSIX's SHA-256 against the release's `<vsix>.sha256`, in the format `shasum -a 256`
 * writes (the hash, two spaces, the file name). A release with no checksum file is refused (D-173), as is a
 * mismatch, a file that names another VSIX, or one that can't be read.
 */
export function checksumCheck(actual: string, asset: string | null, file: string): { ok: true } | { ok: false; error: string } {
  if (asset === null) return { ok: false, error: 'the release has no checksum, so it isn\'t installed' };
  const m = /^([0-9a-fA-F]{64}) [ *](.+)$/.exec(asset.split('\n')[0]!.trim());
  if (!m) return { ok: false, error: 'the release\'s checksum file can\'t be read' };
  if (m[2]!.trim() !== file) return { ok: false, error: `the release's checksum is for ${m[2]!.trim()}, not ${file}` };
  if (m[1]!.toLowerCase() !== actual.toLowerCase()) return { ok: false, error: 'the downloaded file doesn\'t match the release\'s checksum' };
  return { ok: true };
}

/** What an install saves before it reloads the window. */
export interface AfterUpdate { version: string; at: number; plugin?: PluginOutcome }

/** The first activation after an install, as afterUpdate reads it. */
export interface After { kind: 'opened' | 'missed'; version: string; plugin?: PluginOutcome }

/**
 * The first activation after an install: the saved version is running, so the Command Center opens on it,
 * or another version is, so the install didn't take. With what the plugin step did, when it did anything
 * (T-152). Nothing saved, or something that isn't a save, is null.
 */
export function afterUpdate(saved: unknown, running: string): After | null {
  const s = saved as Partial<AfterUpdate> | null | undefined;
  if (!s || typeof s !== 'object' || typeof s.version !== 'string' || !s.version) return null;
  const plugin = savedPlugin(s.plugin);
  return { kind: s.version === running ? 'opened' : 'missed', version: s.version, ...(plugin ? { plugin } : {}) };
}

/** What the person is told after the reload, with what the plugin step did. */
export function afterText(r: After, running: string): string {
  const plugin = r.plugin ? ` ${pluginWords(r.plugin)}` : '';
  return r.kind === 'opened' ? `Updated to ${r.version}${plugin && `.${plugin}`}` : `The update to ${r.version} didn't take: this is still ${running}. Install it again from Settings' About.${plugin}`;
}
