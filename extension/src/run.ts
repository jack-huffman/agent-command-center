import { execFile } from 'node:child_process';
import type * as vscode from 'vscode';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a program with an argument list (never a shell string), with a timeout and cancellation. */
export function runFile(file: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env, token?: vscode.CancellationToken, timeoutMs = 180_000): Promise<RunResult> {
  return new Promise((resolve) => {
    const abort = new AbortController();
    const sub = token?.onCancellationRequested(() => abort.abort());
    execFile(file, args, { cwd, env, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, signal: abort.signal }, (err, stdout, stderr) => {
      sub?.dispose();
      const raw = (err as { code?: unknown } | null)?.code;
      const code = err ? (typeof raw === 'number' ? raw : raw === 'ENOENT' ? 127 : 1) : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (err && !stdout ? String(err.message) : '') });
    });
  });
}

/** The bundled acc, run by VSCode's own runtime so it works even before Node is on PATH. */
export function accRunner(script: string) {
  return (args: string[], cwd: string, token?: vscode.CancellationToken): Promise<RunResult> =>
    runFile(process.execPath, [script, ...args], cwd, { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' }, token);
}
