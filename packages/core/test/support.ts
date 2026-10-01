import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { run, type Runner, type RunOptions, type RunResult } from '../src/exec.ts';

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

export function tempDir(prefix = 'acc-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
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
