/**
 * The browser the screenshot and behaviour runs draw with (T-68): Google's chrome-headless-shell from
 * Chrome for Testing, at the version browser.json pins. It is a binary with no app bundle, so macOS never
 * takes it for the Chrome app: a run never flickers in the Dock or takes over the person's Chrome.
 *
 * browser.json holds the version and each platform's zip SHA-256. Each hash was taken on 2026-10-16 with
 * `shasum -a 256` of the zip downloaded from chrome-for-testing-public; mac-arm64's equals the hash of the
 * zip the merger put in the cache that day.
 *
 *   npm run browser            downloads, checks and unpacks the pinned shell into the cache
 *   npm run browser -- --check exits 1 when the pinned shell isn't in the cache
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The pinned shell: its name, its version, and each platform's zip SHA-256. */
export interface Pin { name: string; version: string; sha256: Record<ShellPlatform, string> }

/** Chrome for Testing's names for the platforms the pin covers. */
export const SHELL_PLATFORMS = ['mac-arm64', 'mac-x64', 'linux64'] as const;
export type ShellPlatform = (typeof SHELL_PLATFORMS)[number];

/** Where Chrome for Testing keeps its zips: a version and a platform name one under it. */
export const CFT_BASE = 'https://storage.googleapis.com/chrome-for-testing-public';

/** The pin in browser.json beside this script. */
export const PIN: Pin = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'browser.json'), 'utf8')) as Pin;

/** This machine's platform name, or null on one the pin doesn't cover, such as Windows. */
export function shellPlatform(platform: string = process.platform, arch: string = process.arch): ShellPlatform | null {
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-arm64' : arch === 'x64' ? 'mac-x64' : null;
  return platform === 'linux' && arch === 'x64' ? 'linux64' : null;
}

/** The cache folder the shells are unpacked into: ~/Library/Caches on macOS, else $XDG_CACHE_HOME or ~/.cache. */
export function shellCache(env: NodeJS.ProcessEnv = process.env, platform: string = process.platform, home: string = homedir()): string {
  const caches = platform === 'darwin' ? join(home, 'Library', 'Caches') : env.XDG_CACHE_HOME || join(home, '.cache');
  return join(caches, 'acc', 'chrome-headless-shell');
}

/** Where the pinned shell's binary is once unpacked: <cache>/<version>/chrome-headless-shell-<platform>/chrome-headless-shell. */
export const shellPath = (pin: Pin, platform: ShellPlatform, cache: string): string =>
  join(cache, pin.version, `chrome-headless-shell-${platform}`, 'chrome-headless-shell');

/** The pinned zip's address under base. */
export const zipUrl = (pin: Pin, platform: ShellPlatform, base: string = CFT_BASE): string =>
  `${base}/${pin.version}/${platform}/chrome-headless-shell-${platform}.zip`;

/** The pinned shell on this machine, or null when it isn't in the cache or the pin doesn't cover the platform. */
export function pinnedShell(exists: (p: string) => boolean = existsSync, cache: string = shellCache(), platform: ShellPlatform | null = shellPlatform()): string | null {
  if (!platform) return null;
  const path = shellPath(PIN, platform, cache);
  return exists(path) ? path : null;
}

export const sha256Of = (file: string): string => createHash('sha256').update(readFileSync(file)).digest('hex');

/** Copies a file: URL, or downloads any other, to file. */
export async function fetchTo(url: string, file: string): Promise<void> {
  if (url.startsWith('file:')) { copyFileSync(fileURLToPath(url), file); return; }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} answered ${r.status}.`);
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}

/** Unpacks a zip into a folder with unzip, which macOS and Linux both have. */
function unzip(zip: string, into: string): void {
  const r = spawnSync('unzip', ['-q', '-o', zip, '-d', into], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`unzip failed on ${zip}: ${(r.stderr || r.error?.message || '').trim()}`);
}

export interface GotShell {
  /** there: the pinned version was already unpacked. got: downloaded, checked and unpacked. refused: its hash differed. */
  status: 'there' | 'got' | 'refused';
  path: string;
  line: string;
}

/**
 * Gets the pinned shell into the cache: nothing when its binary is already there; else downloads the zip
 * from base, checks its SHA-256 against the pin, and unpacks it. A zip whose hash differs is deleted and
 * nothing is unpacked. Unpacked into a folder of its own first, then moved into place, so a run stopped
 * partway never leaves a half shell where findChrome looks.
 */
export async function getShell(d: { pin?: Pin; platform: ShellPlatform; cache: string; base?: string; fetch?: typeof fetchTo }): Promise<GotShell> {
  const pin = d.pin ?? PIN;
  const path = shellPath(pin, d.platform, d.cache);
  if (existsSync(path)) return { status: 'there', path, line: `${pin.name} ${pin.version} is already in ${dirname(path)}.` };
  const dir = join(d.cache, pin.version);
  mkdirSync(dir, { recursive: true });
  const zip = join(dir, `chrome-headless-shell-${d.platform}.zip`);
  const url = zipUrl(pin, d.platform, d.base);
  await (d.fetch ?? fetchTo)(url, zip);
  const hash = sha256Of(zip);
  if (hash !== pin.sha256[d.platform]) {
    rmSync(zip, { force: true });
    return { status: 'refused', path, line: `Refused ${url}: its SHA-256 is ${hash}, not the pinned ${pin.sha256[d.platform]}. The zip is deleted and nothing was unpacked.` };
  }
  const unpacking = join(dir, '.unpacking');
  rmSync(unpacking, { recursive: true, force: true });
  try {
    unzip(zip, unpacking);
    const folder = basename(dirname(path));
    if (!existsSync(join(unpacking, folder, 'chrome-headless-shell'))) throw new Error(`${url} holds no ${folder}/chrome-headless-shell.`);
    rmSync(dirname(path), { recursive: true, force: true });
    renameSync(join(unpacking, folder), dirname(path));
  } finally {
    rmSync(unpacking, { recursive: true, force: true });
    rmSync(zip, { force: true });
  }
  return { status: 'got', path, line: `Got ${pin.name} ${pin.version} for ${d.platform}, its SHA-256 checked, in ${dirname(path)}.` };
}

/** A browser as a shot's note names it: its binary's name and the version it says it is. */
export interface Browser { name: string; version: string }

/** The browser at path, as it says with --version; its version is empty when it says none. */
export function browserOf(path: string): Browser {
  const r = spawnSync(path, ['--version'], { encoding: 'utf8', timeout: 30_000 });
  return { name: basename(path), version: /\d+(?:\.\d+){3}/.exec(r.stdout ?? '')?.[0] ?? '' };
}

/** Whether a browser is the pinned shell: its name and version both. */
export const isPinnedShell = (b: Browser | undefined, pin: Pin = PIN): boolean => !!b && b.name === pin.name && b.version === pin.version;

async function main(argv: string[]): Promise<number> {
  const platform = shellPlatform();
  if (!platform) { console.error(`Chrome for Testing has no headless shell pinned for ${process.platform} ${process.arch}. Pinned: ${SHELL_PLATFORMS.join(', ')}.`); return 1; }
  const cache = shellCache();
  if (argv.includes('--check')) {
    const path = pinnedShell(existsSync, cache, platform);
    if (path) { console.log(`${PIN.name} ${PIN.version} is in ${dirname(path)}.`); return 0; }
    console.error(`${PIN.name} ${PIN.version} isn't in ${cache}. Run npm run browser to get it.`);
    return 1;
  }
  const got = await getShell({ platform, cache });
  (got.status === 'refused' ? console.error : console.log)(got.line);
  return got.status === 'refused' ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e: unknown) => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
}
