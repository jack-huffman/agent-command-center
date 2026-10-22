import { execFile } from 'node:child_process';
import type * as vscode from 'vscode';
import { ghEnv, isGh } from '../../packages/core/src/exec.ts';
import { LAND_TIMEOUT_MS, UPDATE_POST_TIMEOUT_MS } from '../../packages/core/src/land.ts';
import { CRITERIA_TIMEOUT_MS } from '../../packages/core/src/criteria.ts';
import { MANIFEST_TIMEOUT_MS } from '../../packages/core/src/manifest.ts';
import { VERIFY_TIMEOUT_MS } from '../../packages/core/src/verify.ts';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export const RUN_TIMEOUT_MS = 180_000;

/** Runs a program with an argument list (never a shell string), with a timeout and cancellation. gh runs as acc's runner runs it (D-051). */
export function runFile(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env, token?: vscode.CancellationToken, timeoutMs = RUN_TIMEOUT_MS): Promise<RunResult> {
  return new Promise((resolve) => {
    const abort = new AbortController();
    const sub = token?.onCancellationRequested(() => abort.abort());
    execFile(file, args, { cwd, env: isGh(file) ? ghEnv(env) : env, timeout: timeoutMs, killSignal: isGh(file) ? 'SIGKILL' : 'SIGTERM', maxBuffer: 32 * 1024 * 1024, signal: abort.signal }, (err, stdout, stderr) => {
      sub?.dispose();
      const raw = (err as { code?: unknown } | null)?.code;
      const code = err ? (typeof raw === 'number' ? raw : raw === 'ENOENT' ? 127 : 1) : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (err && !stdout ? String(err.message) : '') });
    });
  });
}

/**
 * How long the extension waits for an acc command. A land pushes and calls gh several times, and posting
 * an update calls gh twice, so each gets as long as those can take (D-053). Drafting acceptance criteria
 * runs an agent, which may fix its wording once (T-81), so it gets two of the drafter's limits and a minute.
 * Verifying a developer's pull request runs the checks first, as long as a heavy one may take, then an agent
 * that may fix its wording once (T-84): the checks' 90 minutes and two of the verifier's limits. A ticket's
 * manifest asks the org, and its check and its retrieve wait for one (T-101): its own limit, but to read it back.
 */
export const accTimeoutMs = (args: string[]): number => (args[0] === 'land' ? LAND_TIMEOUT_MS : args[0] === 'update' && args[1] === 'post' ? UPDATE_POST_TIMEOUT_MS
  : args[0] === 'draft' && args[1] === 'criteria' ? 2 * CRITERIA_TIMEOUT_MS + 60_000
    : args[0] === 'verify' && args[1] !== 'show' && args[1] !== 'clear' ? 90 * 60_000 + 2 * VERIFY_TIMEOUT_MS
      : args[0] === 'manifest' && args[1] !== 'show' ? MANIFEST_TIMEOUT_MS : RUN_TIMEOUT_MS);

/** The bundled acc, run by VSCode's own runtime so it works even before Node is on PATH. */
export function accRunner(script: string) {
  return (args: string[], cwd: string, token?: vscode.CancellationToken): Promise<RunResult> =>
    runFile(process.execPath, [script, ...args], cwd, { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' }, token, accTimeoutMs(args));
}
