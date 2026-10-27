import { existsSync } from 'node:fs';
import { basename, dirname, join, posix, win32 } from 'node:path';
import { AccError } from './exec.ts';
import { startSync } from './start.ts';

/**
 * The one way acc runs a shell command line, on every system (D-209). A Mac or Linux has /bin/sh. Windows
 * has no sh of its own, so acc uses the sh that Git for Windows ships: git is a required install, and its sh
 * runs a project's check commands as they are written. Nothing else in acc spawns a shell
 * (scripts/test/one-shell.test.ts).
 */

/** What finding Git's sh needs: the system, and git's own answer to `git --exec-path`. */
export interface ShellDeps {
  platform: NodeJS.Platform;
  /** git's exec path (C:/Program Files/Git/mingw64/libexec/git-core), or null when git didn't run. */
  gitExecPath: () => string | null;
  exists: (path: string) => boolean;
}

const realDeps = (): ShellDeps => ({
  platform: process.platform,
  gitExecPath: () => {
    const r = startSync('git', ['--exec-path'], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
    return 'problem' in r || r.status !== 0 || !String(r.stdout).trim() ? null : String(r.stdout).trim();
  },
  exists: existsSync,
});

/** Where Git for Windows keeps sh, from the folder it's installed in. */
const GIT_SH = [['usr', 'bin', 'sh.exe'], ['bin', 'sh.exe']];

/**
 * The sh acc runs command lines with: /bin/sh on a Mac or Linux; on Windows, the sh in git's own install
 * folder, found from `git --exec-path` (Git/mingw64/libexec/git-core), up to three folders above it. A
 * Windows machine without git, or with a git that has no sh beside it, gets a plain reason (AccError).
 */
export function shellFor(deps: ShellDeps = realDeps()): string {
  if (deps.platform !== 'win32') return '/bin/sh';
  const exec = deps.gitExecPath();
  if (!exec) throw new AccError('missing', 'acc runs command lines with the sh that Git for Windows ships, and git didn\'t run here. Install Git for Windows (git-scm.com), open a new terminal, and try again.');
  let dir = exec;
  for (let up = 0; up <= 3; up++) {
    for (const parts of GIT_SH) {
      const sh = join(dir, ...parts);
      if (deps.exists(sh)) return sh;
    }
    dir = dirname(dir);
  }
  throw new AccError('missing', `acc runs command lines with the sh that Git for Windows ships, and found none near git (${exec}). Reinstall Git for Windows (git-scm.com) and try again.`);
}

let found: string | null = null;

/** This machine's sh, looked up once. */
export const shellPath = (): string => (found ??= shellFor());

/** A command line, as a program and its arguments: `sh -c <line>`, by this machine's sh. */
export const inShell = (line: string): [string, string[]] => [shellPath(), ['-c', line]];

/**
 * The shell a terminal acc types lines into opens with: on Windows, this machine's sh, since the lines are
 * written for one (PowerShell, a terminal's usual shell there, reads them otherwise); elsewhere the person's
 * own shell, as before.
 */
export const terminalShell = (platform: NodeJS.Platform = process.platform, sh: () => string = shellPath): { shellPath?: string } => (platform === 'win32' ? { shellPath: sh() } : {});

/**
 * A program as acc shows and records it: this machine's sh is `sh`, whichever sh it is, so a check's command
 * reads the same on every system and compares with what earlier runs recorded.
 */
export const shownCommand = (cmd: string): string => (/^sh(\.exe)?$/i.test(basename(cmd)) ? 'sh' : cmd);

/** A command as you'd type it, so a logged line can be pasted back into a shell. */
export const shellLine = (cmd: string, args: string[]): string => [cmd, ...args].map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');

/**
 * How a shell line, a hook or a settings file runs acc (D-209): by the launcher beside acc.mjs, which finds
 * a runtime as it always does (D-077), so the line sets no variable of its own and reads the same to a Mac's
 * sh and to Git's sh on Windows (a hook's shell there, as Claude Code's docs say). Run from its source, with
 * no launcher beside it, acc is this runtime and that script. On Windows the paths use forward slashes,
 * which Git's sh reads as well and doesn't take for escapes.
 */
export function accLine(script: string, deps: { platform: NodeJS.Platform; exists: (path: string) => boolean } = { platform: process.platform, exists: existsSync }): string {
  const slashed = (p: string): string => (deps.platform === 'win32' ? p.replaceAll('\\', '/') : p);
  const at = deps.platform === 'win32' ? win32 : posix;
  const launcher = at.join(at.dirname(script), 'acc');
  return deps.exists(launcher) ? shellLine(slashed(launcher), []) : shellLine(slashed(process.execPath), [slashed(script)]);
}

/** How far acc lowers the priority of the checks and builds it starts, as `nice -n 15` did. */
export const NICE_LEVEL = 15;

/**
 * A program that lowers its own priority, then runs the command it's given and exits as it did (D-209).
 * Node's os.setPriority works on a Mac, Linux and Windows, where the nice command is only on the first two.
 * The command inherits the lowered priority, and so does everything it starts. A stop acc sends it is passed
 * on, so a check stopped at its timeout stops too.
 */
export const NICE_SCRIPT = [
  "const { spawn } = require('node:child_process');",
  "const os = require('node:os');",
  `try { os.setPriority(${NICE_LEVEL}); } catch {}`,
  "if (process.env.ACC_NICE_DROP) { delete process.env.ELECTRON_RUN_AS_NODE; delete process.env.ACC_NICE_DROP; }",
  "const [verbatim, cmd, ...args] = process.argv.slice(1);",
  "const child = spawn(cmd, args, { stdio: 'inherit', windowsVerbatimArguments: verbatim === '1' });",
  "child.on('error', (e) => { process.stderr.write(e.message + '\\n'); process.exit(127); });",
  "for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => child.kill(s));",
  "child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));",
].join('\n');

/**
 * A command, run at lowered priority: this runtime runs NICE_SCRIPT, which runs the command. VSCode's own
 * runtime acts as Node only with ELECTRON_RUN_AS_NODE set, so it's set for the script, and taken off again
 * before the command when the environment didn't have it. `verbatim` is startOf's: a command line made for
 * cmd.exe goes to it as it is.
 */
export function nicedCommand(cmd: string, args: string[], env: NodeJS.ProcessEnv, verbatim = false): { cmd: string; args: string[]; env: NodeJS.ProcessEnv } {
  const asNode = process.versions.electron && !env.ELECTRON_RUN_AS_NODE ? { ELECTRON_RUN_AS_NODE: '1', ACC_NICE_DROP: '1' } : {};
  return { cmd: process.execPath, args: ['-e', NICE_SCRIPT, '--', verbatim ? '1' : '0', cmd, ...args], env: { ...env, ...asNode } };
}
