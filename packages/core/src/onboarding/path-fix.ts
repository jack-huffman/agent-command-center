/**
 * A tool that isn't on VSCode's PATH, found in a folder its installer puts it in (T-133): installed, which isn't
 * the same as missing. The fix is said for the system:
 *
 * - Windows: when the folder is on the user's or the machine's PATH already, VSCode started before it was added,
 *   so the fix is to quit VSCode and open it again. When it isn't, Do it adds it to the user's PATH (never the
 *   machine's) in PowerShell, after a question that names the folder.
 * - A Mac: Homebrew's own shellenv line in ~/.zprofile, as Homebrew's installer says, or a PATH line there for
 *   another folder, after a question; then VSCode restarts, since it reads PATH from the login shell when it starts.
 * - Linux: in words, for the person's own shell profile.
 *
 * PATH is never changed without the person's yes: each line that changes it carries its question (CheckResult.ask).
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { shellQuote } from './fix-lines.ts';
import { type InstallSystem, RESTART_WHY } from './install-lines.ts';
import { fileOn, type MachineNeed } from './machine-needs.ts';
import { cached } from './helpers.ts';
import type { CheckContext, CheckResult, MachineFiles } from './types.ts';

/** This machine's filesystem, as the machine steps read it. */
export const REAL_FILES: MachineFiles = {
  exists: existsSync,
  list: (dir) => {
    try {
      return readdirSync(dir);
    } catch {
      return [];
    }
  },
  read: (file) => {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  },
};

const filesOf = (ctx: CheckContext): MachineFiles => ctx.files ?? REAL_FILES;
const pathsOn = (system: InstallSystem) => (system === 'windows' ? win32 : posix);
const homeOf = (ctx: CheckContext): string => ctx.env.HOME || ctx.env.USERPROFILE || homedir();

/** VSCode restarts to read PATH again: a window reload keeps the PATH it started with. */
export const RESTART = `Quit VSCode and open it again: ${RESTART_WHY}`;

/** npm's global folder for programs, or null when npm doesn't run here. */
function npmBin(ctx: CheckContext, system: InstallSystem): string | null {
  return cached(ctx, 'npm-prefix', () => {
    const r = ctx.run('npm', ['prefix', '-g'], { env: ctx.env });
    const prefix = r.code === 0 ? r.stdout.trim() : '';
    if (!prefix) return null;
    return system === 'windows' ? prefix : posix.join(prefix, 'bin');
  });
}

/**
 * A place as folders on this machine: its {names} filled in from the environment, and each `*` as every folder
 * there. A place whose name isn't set here is no folder.
 */
export function expandPlace(ctx: CheckContext, place: string, system: InstallSystem): string[] {
  const names: Record<string, string | null | undefined> = {
    HOME: homeOf(ctx), USERPROFILE: ctx.env.USERPROFILE || homeOf(ctx), ProgramFiles: ctx.env.ProgramFiles,
    LOCALAPPDATA: ctx.env.LOCALAPPDATA, APPDATA: ctx.env.APPDATA,
  };
  let missing = false;
  const filled = place.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const v = name === 'npm' ? npmBin(ctx, system) : names[name];
    if (!v) missing = true;
    return v ?? '';
  });
  if (missing) return [];
  const sep = system === 'windows' ? /[\\/]/ : /\//;
  const at = pathsOn(system);
  const [head = '', ...parts] = filled.split(sep);
  // The root: / on a Mac or Linux, a drive's C:\ on Windows.
  let dirs = [head === '' ? at.sep : /^[A-Za-z]:$/.test(head) ? head + at.sep : head];
  for (const part of parts.filter(Boolean)) {
    // Newest first, as a version's folder names sort: jdk-25 before jdk-21.
    dirs = part === '*' ? dirs.flatMap((d) => filesOf(ctx).list(d).sort().reverse().map((e) => at.join(d, e))) : dirs.map((d) => at.join(d, part));
  }
  return dirs;
}

/** The first folder a need's installer puts its program in where the program is, or null when it's in none. */
export function installedAt(ctx: CheckContext, need: MachineNeed, system: InstallSystem): string | null {
  const file = fileOn(need, system);
  if (!file) return null;
  const at = pathsOn(system);
  for (const place of need.places[system] ?? []) {
    for (const dir of expandPlace(ctx, place, system)) if (filesOf(ctx).exists(at.join(dir, file))) return dir;
  }
  return null;
}

/** A PowerShell string literal: single quotes, with each ' doubled. */
export const psLiteral = (s: string): string => `'${s.replace(/'/g, "''")}'`;

/** PowerShell's line that adds a folder to the end of the user's PATH (never the machine's). */
export const addToUserPath = (dir: string): string =>
  `[Environment]::SetEnvironmentVariable('Path', (([Environment]::GetEnvironmentVariable('Path', 'User'), ${psLiteral(dir)}) | Where-Object { $_ }) -join ';', 'User')`;

/** PowerShell's line that prints the user's PATH, then the machine's, each on its own line. */
export const READ_PATHS = "[Environment]::GetEnvironmentVariable('Path', 'User'); [Environment]::GetEnvironmentVariable('Path', 'Machine')";

/** The folders on Windows' saved PATHs, the user's and the machine's, with %NAME% filled in; null when they can't be read. */
function savedWindowsPath(ctx: CheckContext): string[] | null {
  return cached(ctx, 'saved-path', () => {
    const r = ctx.run('powershell', ['-NoProfile', '-NonInteractive', '-Command', READ_PATHS], { env: ctx.env });
    if (r.code !== 0) return null;
    return r.stdout.split(/[\r\n;]+/).map((d) => d.replace(/%(\w+)%/g, (m, n: string) => ctx.env[n] ?? m).trim()).filter(Boolean);
  });
}

const sameDir = (a: string, b: string, system: InstallSystem): boolean => {
  const norm = (d: string) => d.replace(/[\\/]+$/, '');
  return system === 'windows' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

/** Homebrew's shellenv line for ~/.zprofile, as Homebrew's installer prints it, for the brew in a folder. */
export const brewShellenv = (dir: string): string => `echo ${shellQuote(`eval "$(${posix.join(dir, 'brew')} shellenv)"`)} >> ~/.zprofile`;

/** A Mac's line that puts a folder at the front of PATH in ~/.zprofile. */
export const zprofilePath = (dir: string): string => `echo ${shellQuote(`export PATH="${dir}:$PATH"`)} >> ~/.zprofile`;

/**
 * The result for a need's program found in an install folder but not on VSCode's PATH: what it is, and the fix
 * for the system the check runs for.
 */
export function notOnPath(ctx: CheckContext, need: MachineNeed, dir: string, system: InstallSystem): CheckResult {
  const seen = `${need.name} is installed in ${dir}, but VSCode can't see it: that folder isn't on its PATH.`;
  const base = { status: 'fail' as const, place: dir };
  if (system === 'windows') {
    const saved = savedWindowsPath(ctx);
    if (saved?.some((d) => sameDir(d, dir, system))) {
      return { ...base, detail: `${need.name} is installed in ${dir}, and that folder is on your PATH, but VSCode started before it was added. ${RESTART}`, byHand: RESTART };
    }
    return {
      ...base, detail: `${seen} Do it adds it to your own PATH (not the machine's), then quit VSCode and open it again.`,
      fix: addToUserPath(dir), ask: `Add ${dir} to your PATH? It's added to your own PATH, not the machine's, so ${need.name} is found. Then quit VSCode and open it again.`,
    };
  }
  if (system === 'mac') {
    const brew = filesOf(ctx).exists(posix.join(dir, 'brew'));
    const profile = filesOf(ctx).read(posix.join(homeOf(ctx), '.zprofile')) ?? '';
    const there = brew ? /brew shellenv/.test(profile) : profile.includes(dir);
    if (there) return { ...base, detail: `${seen} ~/.zprofile adds it already, so VSCode started before that. ${RESTART}`, byHand: RESTART };
    const what = brew ? 'Homebrew\'s shellenv line' : `a line that adds ${dir} to PATH`;
    return {
      ...base, detail: `${seen} Do it adds ${what} to ~/.zprofile, then quit VSCode and open it again.`,
      fix: brew ? brewShellenv(dir) : zprofilePath(dir), ask: `Add ${what} to ~/.zprofile, so ${dir} is on your PATH? Then quit VSCode and open it again.`,
    };
  }
  const by = `Add ${dir} to PATH in your shell's profile, such as ~/.profile, then quit VSCode and open it again.`;
  return { ...base, detail: `${seen} ${by}`, byHand: by };
}
