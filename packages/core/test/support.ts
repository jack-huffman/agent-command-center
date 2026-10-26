import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, globSync, lstatSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { delimiter, dirname, join, relative } from 'node:path';
import { run, type Runner, type RunOptions, type RunResult } from '../src/exec.ts';
import type { Exec } from '../src/trackers/types.ts';
import { tempDir } from './temp-root.ts';

export { RUN_ROOT, tempDir } from './temp-root.ts';

/** The test files npm test runs: the quoted globs in package.json's test script, expanded, sorted. */
export function npmTestFiles(root: string): string[] {
  const script = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts.test as string;
  const globs = [...script.matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? '');
  return [...new Set(globs.flatMap((g) => globSync(g, { cwd: root })))].sort();
}

export const ok = (stdout = ''): RunResult => ({ code: 0, stdout, stderr: '' });
export const bad = (stderr = 'failed', code = 1): RunResult => ({ code, stdout: '', stderr });
export const sf = (result: unknown, status = 0): RunResult => ({ code: status ? 1 : 0, stdout: JSON.stringify({ status, result, message: status ? 'sf error' : undefined }), stderr: '' });

/**
 * A runner that answers from fixtures keyed by "cmd arg arg…" (prefix match, longest wins) and falls
 * back to really running git, so checks can use real throwaway repos with fake sf and gh.
 */
export function fakeRunner(fixtures: Record<string, RunResult | ((opts?: RunOptions) => RunResult)>, calls: string[] = []): Runner {
  const keys = Object.keys(fixtures).sort((a, b) => b.length - a.length);
  return (cmd, args, opts) => {
    const line = [cmd, ...args].join(' ');
    calls.push(line);
    const key = keys.find((k) => line === k || line.startsWith(k + ' '));
    if (key) {
      const f = fixtures[key]!;
      return typeof f === 'function' ? f(opts) : f;
    }
    if (cmd === 'git') return run(cmd, args, opts);
    return { code: 127, stdout: '', stderr: `no fixture for: ${line}` };
  };
}

/**
 * `claude agents --json` listing a background session with a process for each builder `claude --bg` started,
 * by the name it was given: a builder that started (T-92).
 */
export const launchedSessions = (calls: string[]) => (): RunResult => ok(JSON.stringify(calls.filter((c) => c.startsWith('claude --bg ')).map((c, i) => (
  { id: `bg${i + 1}`, sessionId: `sess-${i + 1}`, name: / --name (.+?) --permission-mode /.exec(c)?.[1], kind: 'background', startedAt: Date.now(), state: 'working', status: 'busy', pid: 4_000_001 + i }))));

/** A stand-in program on PATH: a shell script, and the env that finds it first. */
export function fakeBin(name: string, script: string, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const bin = join(tempDir('fake-bin-'), 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, name), `#!/bin/sh\n${script}`);
  chmodSync(join(bin, name), 0o755);
  return { ...env, PATH: `${bin}${delimiter}${process.env.PATH}` };
}

/** A real git repo with one commit, an origin-less main branch, and local identity. */
export function makeRepo(files: Record<string, string> = {}): string {
  const dir = tempDir();
  const git = (...a: string[]) => {
    const r = run('git', a, { cwd: dir });
    if (r.code !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
    return r.stdout;
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test Person');
  git('config', 'user.email', 'test@example.com');
  git('config', 'commit.gpgsign', 'false');
  for (const [rel, text] of Object.entries({ 'README.md': '# test\n', ...files })) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  git('add', '-A');
  git('commit', '-q', '-m', 'initial');
  return dir;
}

export const gitIn = (dir: string, ...a: string[]): string => {
  const r = run('git', a, { cwd: dir });
  if (r.code !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
};

export const SF_CONFIG = {
  schema: 1,
  project: 'Acme',
  profile: 'salesforce',
  github: { repo: 'acme-co/acme-salesforce', account: 'work-account' },
  commitIdentity: { name: 'Test Person', email: 'test@example.com' },
  environments: [
    { name: 'Production', type: 'production', org: 'Acme Production' },
    { name: 'UAT', type: 'full', org: 'Acme UAT', promotesTo: ['production'] },
    { name: 'Dev', type: 'developer', org: 'Acme Dev', default: true, promotesTo: ['uat', 'production'] },
  ],
  environmentSpecific: 'manifest/environment-specific.txt',
  knownDrift: 'manifest/known-drift.txt',
  agents: { max: 2 },
  gates: { required: ['format', 'validate'] },
};

export const GENERIC_CONFIG = {
  schema: 1,
  project: 'Tool',
  profile: 'generic',
  environments: [{ name: 'main', default: true }],
};

/** A stand-in for starting caffeinate (D-067): records what it was asked to run, and which pids were ended. */
export function fakeAwake(platform: NodeJS.Platform = 'darwin') {
  const spawned: string[][] = [];
  const killed: number[] = [];
  // Above any pid macOS hands out, so a real process is never mistaken for one of these.
  let next = 4_100_000;
  return {
    spawned,
    killed,
    deps: {
      platform,
      spawn: (cmd: string, args: string[]) => {
        spawned.push([cmd, ...args]);
        return { pid: next++, unref: () => undefined };
      },
      kill: (pid: number) => { killed.push(pid); },
    },
  };
}

export const SLEPT = 'API Error: Your computer went to sleep mid-response. The response above may be incomplete.';

/** GH-41's transcript as it ended (D-067): its narration, a tool call, then Claude Code's own record of the sleep. */
export function gh41Lines(sessionId: string, cwd: string): string[] {
  const rec = (r: Record<string, unknown>) => JSON.stringify({ sessionId, cwd, isSidechain: false, ...r });
  return [
    rec({ type: 'user', message: { role: 'user', content: 'Read your task instructions below and do the task.' } }),
    rec({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Now the drafts store.' }] } }),
    rec({ type: 'assistant', message: { model: 'claude-opus-5-5', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }] } }),
    // A helper agent's turn isn't the builder speaking.
    JSON.stringify({ type: 'assistant', isSidechain: true, message: { content: [{ type: 'text', text: 'helper says hi' }] } }),
    rec({ type: 'assistant', isApiErrorMessage: true, error: 'server_error', message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: SLEPT }] } }),
    JSON.stringify({ type: 'cost-state', sessionId, totalCostUSD: 1.2 }),
    '{ a line that isn\'t JSON',
  ];
}

/** An analysis that's ready to build, planning to change these files, written where acc keeps it (D-052). */
export function writePlan(analyses: string, task: string, files: string[], extra: Record<string, unknown> = {}): void {
  mkdirSync(analyses, { recursive: true });
  writeFileSync(join(analyses, `${task}.json`), JSON.stringify({
    v: 1, task, env: 'main', base: '', verdict: 'ready', summary: '', requirements: { goal: '', criteria: [], assumptions: [], outOfScope: [] },
    questions: [], findings: [], approach: { plan: [], files: files.map((path) => ({ path, change: 'update', why: '' })), refactors: [], risks: [], tests: [], size: 'S' },
    split: [], orgs: [], sessionId: 's', at: '2026-10-06T10:00:00.000Z', durationMs: 1, costUsd: null, ...extra,
  }));
}

/** Every file under a folder: its path, size and hash. Links are recorded, never followed. */
export function snapshot(dir: string): Map<string, string> {
  const all = new Map<string, string>();
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      const s = lstatSync(p);
      const rel = relative(dir, p);
      if (s.isDirectory()) { all.set(`${rel}/`, 'dir'); walk(p); }
      else if (s.isSymbolicLink()) all.set(rel, 'link');
      else all.set(rel, `${s.size} ${createHash('sha256').update(readFileSync(p)).digest('hex')}`);
    }
  };
  if (existsSync(dir)) walk(dir);
  return all;
}

/** What changed between two snapshots, a line each. */
export function changes(before: Map<string, string>, after: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [p, v] of after) if (!before.has(p)) out.push(`added ${p}`); else if (before.get(p) !== v) out.push(`changed ${p}`);
  for (const p of before.keys()) if (!after.has(p)) out.push(`removed ${p}`);
  return out;
}

/** An item that made `pool` reject: where it sat, what it was, and what went wrong. */
export class PoolError extends Error {
  readonly index: number;
  readonly item: unknown;
  constructor(index: number, item: unknown, reason: unknown) {
    const shown = typeof item === 'string' ? JSON.stringify(item.length > 60 ? `${item.slice(0, 60)}…` : item) : (() => { try { return JSON.stringify(item)?.slice(0, 80) ?? String(item); } catch { return String(item); } })();
    super(`item ${index} (${shown}) failed: ${(reason as Error)?.message ?? String(reason)}`, { cause: reason });
    this.name = 'PoolError';
    this.index = index;
    this.item = item;
  }
}

/**
 * Runs `fn` on each item, at most `size` calls at once, and gives the results in the items' order, so a test
 * starts its processes together instead of one after another. No items give []. When a call throws or
 * rejects, the pool starts no more calls and rejects with a PoolError that names the item.
 */
export async function pool<T, R>(items: readonly T[], size: number = 4, fn: (item: T, index: number) => R | Promise<R>): Promise<R[]> {
  if (!Number.isInteger(size) || size < 1) throw new RangeError(`pool size must be a whole number of 1 or more, not ${size}`);
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed: PoolError | undefined;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (e) {
        failed ??= new PoolError(i, items[i], e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  if (failed) throw failed;
  return results;
}

/** What a program run by `spawnWith` gave: its exit code, and what it wrote to stdout and stderr. */
export interface Spawned { code: number | null; out: string; err: string }

/**
 * Runs a program with `input` on its stdin, without waiting for it, so a test can start several together
 * through pool (T-57). It rejects only when the program can't be started; a program that exits before
 * reading its input still gives what it wrote.
 */
export function spawnWith(cmd: string, args: readonly string[], input: string, opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<Spawned> {
  return new Promise((done, fail) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env });
    let out = '';
    let err = '';
    child.stdout.setEncoding('utf8').on('data', (d: string) => { out += d; });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { err += d; });
    // A program that exits before it reads its input closes the pipe: that isn't a failure of the run.
    child.stdin.on('error', () => {});
    child.on('error', fail);
    child.on('close', (code) => done({ code, out, err }));
    child.stdin.end(input);
  });
}

// ---------------------------------------------------------------- stand-ins for a tracker's own tools

/** A stand-in for Jira Cloud (acme.atlassian.net): answers by method and path prefix, with an optional status per prefix, and records each request. */
export function fakeJira(routes: Record<string, unknown | ((body: unknown) => unknown)>, status: Record<string, number> = {}) {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const path = url.replace('https://acme.atlassian.net', '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body, auth: (init.headers as Record<string, string>).Authorization ?? null });
    const key = Object.keys(routes).find((k) => `${method} ${path}`.startsWith(k));
    const code = Object.entries(status).find(([k]) => `${method} ${path}`.startsWith(k))?.[1] ?? (key ? 200 : 404);
    const r = key ? routes[key] : { errorMessages: ['Not found'] };
    const payload = typeof r === 'function' ? (r as (b: unknown) => unknown)(body) : r;
    return new Response(payload === undefined ? null : JSON.stringify(payload), { status: payload === undefined && code === 200 ? 204 : code });
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}

/** A stand-in gh: answers by the first fixture whose text the call's arguments hold (or start with, under `prefix`), and records what it was asked, with the env it got. */
export function fakeGh(answers: [string, string | ((input?: string) => string) | { code: number; stderr: string }][], match: 'part' | 'prefix' = 'part'): { exec: Exec; calls: { args: string; input?: string; token?: string; quiet: boolean }[] } {
  const calls: { args: string; input?: string; token?: string; quiet: boolean }[] = [];
  const exec: Exec = async (_cmd, args, opts) => {
    const line = args.join(' ');
    calls.push({ args: line, input: opts?.input, token: opts?.env?.GH_TOKEN, quiet: opts?.env?.GH_NO_UPDATE_NOTIFIER === '1' && opts?.env?.GH_PROMPT_DISABLED === '1' });
    const hit = answers.find(([part]) => (match === 'prefix' ? line.startsWith(part) : line.includes(part)));
    if (!hit) return { code: 1, stdout: '', stderr: `no fixture for: gh ${line}` };
    const a = hit[1];
    if (typeof a === 'object') return { code: a.code, stdout: '', stderr: a.stderr };
    return { code: 0, stdout: typeof a === 'function' ? a(opts?.input) : a, stderr: '' };
  };
  return { exec, calls };
}

/** A stand-in gh that answers by a function of the whole argument line (a string is its output, an object a failure), and records each line. fakeGh answers by fixture text; this one is for an answer that depends on the line's shape. */
export function fakeGhBy(answer: (line: string) => string | { code: number; stderr: string }): { exec: Exec; lines: string[] } {
  const lines: string[] = [];
  const exec: Exec = async (_cmd, args) => {
    const line = args.join(' ');
    lines.push(line);
    const a = answer(line);
    return typeof a === 'string' ? { code: 0, stdout: a, stderr: '' } : { code: a.code, stdout: '', stderr: a.stderr };
  };
  return { exec, lines };
}
