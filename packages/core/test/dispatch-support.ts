// What the dispatch tests share: a stand-in claude, a home that trusts the repo, and acc run as a person or
// builder runs it. dispatch.test.ts, dispatch-run.test.ts and held.test.ts were one file; they're three so
// npm test runs them side by side (T-57).
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nodeStandIn } from './stand-in.ts';
import { tempDir } from './support.ts';

const MAIN = fileURLToPath(new URL('../../cli/src/main.ts', import.meta.url));


/** A stand-in claude: records every call, starts "sessions", and lists them like `claude agents --json`. */
export function fakeClaude(): { bin: string; dir: string; calls: () => { args: string[]; cwd: string }[] } {
  const dir = tempDir('fake-claude-');
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  nodeStandIn(join(bin, 'claude'), `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const dir = ${JSON.stringify(dir)};
const args = process.argv.slice(2);
fs.appendFileSync(path.join(dir, 'calls.jsonl'), JSON.stringify({ args, cwd: process.cwd() }) + '\\n');
const sessions = fs.existsSync(path.join(dir, 'sessions.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8')) : [];
if (args[0] === '--bg') {
  const name = args[args.indexOf('--name') + 1];
  const n = sessions.length + 1;
  // A pid no process has, as Claude Code lists a background session's own process.
  sessions.push({ id: 'bg' + n, sessionId: 'sess-' + n, name, kind: 'background', cwd: process.cwd(), startedAt: Date.now(), state: 'working', pid: 4000000 + n });
  fs.writeFileSync(path.join(dir, 'sessions.json'), JSON.stringify(sessions));
  console.log('bg' + n);
} else if (args[0] === 'agents') {
  // Its background service down (T-92): its socket is gone, and it says so.
  if (fs.existsSync(path.join(dir, 'down'))) { console.error('Error: connect ENOENT /tmp/cc-daemon-502/x/control.sock'); process.exit(1); }
  console.log(JSON.stringify(sessions));
}
`);
  chmodSync(join(bin, 'claude'), 0o755);
  const calls = () => (existsSync(join(dir, 'calls.jsonl')) ? readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { bin, dir, calls };
}

/** A home folder whose Claude Code state trusts these repos, so background dispatch is allowed (D-022). */
export function trustingHome(...repos: string[]): string {
  const home = tempDir('home-');
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: Object.fromEntries(repos.map((r) => [realpathSync(r), { hasTrustDialogAccepted: true }])) }));
  // Git for Windows' own config turns line endings to CRLF on checkout. A home that doesn't say otherwise
  // would leave a worktree acc makes here changed to the tests' own git, which keeps LF (D-T-123).
  writeFileSync(join(home, '.gitconfig'), '[core]\n\tautocrlf = false\n');
  return home;
}

export const IGNORE = { '.gitignore': '.claude/worktrees/\n' };
/** For a test of a builder's run, not its checks: stray-files off, so acc done needs none (GH-103). */
export const QUIET = { strayFiles: { required: false } };

export function acc(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(process.execPath, ['--no-warnings', MAIN, ...args], { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', ACC_ROLE: '', ACC_TASK: '', CLAUDE_CONFIG_DIR: '', ...env } });
  return { code: r.status ?? 1, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
}

/** A builder's note on acc done (D-106): what landed, and nothing moved or open. */
export const NOTE = ['--landed', 'The change', '--moved', 'none', '--open', 'none'];

export const tasksOf = (repo: string) => JSON.parse(readFileSync(join(repo, '.git', 'acc', 'ledger.json'), 'utf8')).tasks as { id: string; state: string; run?: Record<string, string> }[];
