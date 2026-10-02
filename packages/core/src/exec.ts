import { spawnSync } from 'node:child_process';

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
}

/** Runs a command and returns its result. Never throws; a missing binary is code 127. */
export type Runner = (cmd: string, args: string[], opts?: RunOptions) => RunResult;

export const run: Runner = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    env: opts.env ?? process.env,
    input: opts.input,
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) return { code: 127, stdout: '', stderr: r.error.message };
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};

export class AccError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'AccError';
  }
}

/** Environment for sf: no colour codes in its JSON, and no update notice in its output. */
export const sfEnv = (env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => ({
  ...env, NO_COLOR: '1', FORCE_COLOR: '0', SF_NO_UPDATE_NOTIFIER: 'true', SF_SKIP_NEW_VERSION_CHECK: 'true', SF_DISABLE_TELEMETRY: 'true',
});

/**
 * Reads a CLI's --json output. Colour codes are stripped first: a CLI run from a shell that asks for
 * colour can colour its JSON, which then won't parse. Text before the JSON, such as a notice, is skipped.
 */
export function parseJsonOutput<T>(text: string): T {
  const plain = text.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  try {
    return JSON.parse(plain) as T;
  } catch {
    const start = plain.search(/^[{[]/m);
    if (start < 0) throw new SyntaxError('No JSON in the output.');
    return JSON.parse(plain.slice(start)) as T;
  }
}
