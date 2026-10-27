import { type ChildProcess, execFile, type ExecFileException, type ExecFileOptions, spawn, type SpawnOptions, spawnSync, type SpawnSyncOptions, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { win32 } from 'node:path';

/**
 * The one way acc starts a program, on every system (D-209). A Mac or Linux starts it as named, as before.
 * Windows can't start a .cmd or .bat without cmd.exe, and the tools npm and the Salesforce installer put on
 * PATH are .cmd shims: sf, npm, npx, code, and claude when npm installed it. So on Windows the name is
 * looked up on PATH with PATHEXT, as cmd would, and a .cmd or .bat runs through cmd.exe, its words escaped
 * for cmd. Nothing else in acc starts a program (scripts/test/one-shell.test.ts).
 *
 * The escaping is a command-injection boundary: a word can be ticket text or a path. It's the way the
 * cross-spawn package does it (MIT, github.com/moxystudio/node-cross-spawn, lib/util/escape.js), written
 * again here: each word is quoted for the program's own reading of its command line, then every one of
 * cmd's special characters, the quotes too, gets a caret, so cmd reads none of them as its own. A .cmd
 * shim hands its words on through %*, which cmd reads a second time, so they get a second caret. A line
 * break ends cmd's command line wherever it is, so a word holding one never goes through cmd: an npm shim
 * (claude installed by npm, with dispatch's multi-line prompt) runs its node script by node instead, and
 * any other .cmd is refused, not sent.
 */

export interface StartDeps {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  exists: (path: string) => boolean;
  /** Reads a .cmd, to find the node script an npm shim runs. */
  read?: (path: string) => string | null;
}

/** How a program is started: the file, its arguments, and whether they go to Windows as they are. */
export type Start = { file: string; args: string[]; verbatim: boolean } | { problem: string };

/** A variable of a Windows environment, whatever its case: Path, PATH and path are one there. */
const envOf = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const key = Object.keys(env).find((k) => k.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
};

/**
 * The file a command names on Windows, as cmd finds it: a path as given, with each PATHEXT extension when it
 * has none of its own; a bare name in the current folder's stead on each PATH folder. Null when none is there.
 */
export function windowsProgram(cmd: string, deps: StartDeps): string | null {
  const exts = (envOf(deps.env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase());
  const tries = (base: string): string[] => (win32.extname(base) ? [base, ...exts.map((e) => base + e)] : exts.map((e) => base + e));
  if (/[\\/]/.test(cmd)) return tries(cmd).find(deps.exists) ?? null;
  for (const dir of (envOf(deps.env, 'PATH') ?? '').split(';').filter(Boolean)) {
    const found = tries(win32.join(dir.replace(/^"|"$/g, ''), cmd)).find(deps.exists);
    if (found) return found;
  }
  return null;
}

/** cmd's special characters, each of which a caret makes plain. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/**
 * One word, for a program's command line read through cmd by a .cmd shim: quoted as Windows programs read
 * their words (backslashes before a quote doubled, the quote escaped), then cmd's special characters made
 * plain twice, since the shim reads its words again.
 */
export function cmdWord(word: string): string {
  const w = `"${word.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`;
  return w.replace(CMD_META, '^$1').replace(CMD_META, '^$1');
}

const readText = (path: string): string | null => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

const realDeps = (env: NodeJS.ProcessEnv = process.env): StartDeps => ({ platform: process.platform, env, exists: existsSync, read: readText });

/**
 * The node script an npm shim runs, from the .cmd npm wrote (cmd-shim): its last line starts "%_prog%" with
 * "%dp0%\<script>" and every word. Null for any other .cmd.
 */
export function npmShimScript(cmdFile: string, text: string | null): string | null {
  const m = text ? /"%_prog%"\s+"%~?dp0%?\\([^"]+)"\s+%\*/.exec(text) : null;
  return m ? win32.join(win32.dirname(cmdFile), m[1]!) : null;
}

/** How to start a program on this machine, looked up on the PATH of the environment it will get. */
export const startFor = (cmd: string, args: string[], env: NodeJS.ProcessEnv = process.env): Start => startOf(cmd, args, realDeps(env));

// The three ways acc starts a program, each as startFor says. A start Windows can't make comes back as its
// problem, never thrown.

/**
 * Starts a program and waits for it (spawnSync). A program that exits without reading all of the input it was
 * given leaves spawnSync an error beside its exit (UNREAD): the program ran and answered, so its answer is
 * what comes back, as it is for a program that read everything.
 */
export function startSync(cmd: string, args: string[], opts: SpawnSyncOptions): SpawnSyncReturns<string | Buffer> | { problem: string } {
  const s = startFor(cmd, args, opts.env);
  if ('problem' in s) return s;
  const r = spawnSync(s.file, s.args, { ...opts, windowsVerbatimArguments: s.verbatim });
  return unpiped(r);
}

/**
 * How input a program left unread fails to be written: EPIPE on a Mac and Linux; on Windows EOF (its pipe
 * says it was ended), or ECANCELED for a write still waiting when the program exited and its pipe closed.
 * A timeout (ETIMEDOUT) or too much output (ENOBUFS) keeps its error.
 */
const UNREAD = new Set(['EPIPE', 'EOF', 'ECANCELED']);

/** A result whose only error is the broken pipe of input the program didn't read, with that error taken off. */
export function unpiped<T extends SpawnSyncReturns<string | Buffer>>(r: T): T {
  const broken = UNREAD.has((r.error as NodeJS.ErrnoException | undefined)?.code ?? '') && (r.status !== null || r.signal !== null);
  if (!broken) return r;
  const { error: _, ...rest } = r;
  return rest as T;
}

/** Starts a program and gives its process (spawn). */
export function startChild(cmd: string, args: string[], opts: SpawnOptions): ChildProcess | { problem: string } {
  const s = startFor(cmd, args, opts.env);
  return 'problem' in s ? s : spawn(s.file, s.args, { ...opts, windowsVerbatimArguments: s.verbatim });
}

/** Starts a program and gathers what it prints (execFile). One that can't start calls back with the problem as its error. */
export function startFile(cmd: string, args: string[], opts: ExecFileOptions, done: (err: ExecFileException | null, stdout: string, stderr: string) => void): ChildProcess | null {
  const s = startFor(cmd, args, opts.env);
  if ('problem' in s) {
    done(Object.assign(new Error(s.problem), { code: 1, cmd }), '', s.problem);
    return null;
  }
  return execFile(s.file, s.args, { ...opts, encoding: 'utf8', windowsVerbatimArguments: s.verbatim }, (err, stdout, stderr) => done(err, String(stdout ?? ''), String(stderr ?? '')));
}

/**
 * How to start a program with these words. Elsewhere than Windows, as named. On Windows a .cmd or .bat runs
 * through cmd.exe (/d: no AutoRun; /s /c: the line in quotes is the command), its words escaped; anything
 * else runs as the file PATH has. A program that isn't there is started as named, so it fails as a missing
 * program does everywhere (code 127 in run).
 */
export function startOf(cmd: string, args: string[], deps: StartDeps = realDeps()): Start {
  if (deps.platform !== 'win32') return { file: cmd, args, verbatim: false };
  const file = windowsProgram(cmd, deps);
  if (!file) return { file: cmd, args, verbatim: false };
  if (!/\.(cmd|bat)$/i.test(file)) return { file, args, verbatim: false };
  if ([cmd, ...args].some((a) => /[\r\n]/.test(a))) {
    // An npm shim's script runs by node, as the shim would run it: the node.exe beside it, else node on PATH.
    const script = npmShimScript(file, deps.read?.(file) ?? null);
    const beside = win32.join(win32.dirname(file), 'node.exe');
    const node = script && (deps.exists(beside) ? beside : windowsProgram('node', deps));
    if (script && node) return { file: node, args: [script, ...args], verbatim: false };
    return { problem: `${win32.basename(file)} is a Windows command script, and cmd can't be handed a line break in its words. Run it with that text in a file instead.` };
  }
  // The program's own path gets carets only, as cross-spawn's does: cmd reads it as one word, spaces and all.
  const line = [file.replace(CMD_META, '^$1'), ...args.map(cmdWord)].join(' ');
  return { file: envOf(deps.env, 'COMSPEC') ?? 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
}
