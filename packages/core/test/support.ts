import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { delimiter, dirname, join, relative } from 'node:path';
import { run, type Runner, type RunOptions, type RunResult } from '../src/exec.ts';
import { tempDir } from './temp-root.ts';

export { RUN_ROOT, tempDir } from './temp-root.ts';

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
