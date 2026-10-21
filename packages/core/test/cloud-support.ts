// What the cloud tests share (T-86): a generic project on GitHub that opted in, the commands a cloud
// dispatch runs besides git, a repo whose origin is a local bare repo standing in for GitHub, a second
// clone standing in for the cloud session, and T-1 dispatched to the cloud. cloud.test.ts (builders) and
// cloud-review.test.ts (reviewers) both build on these.
import assert from 'node:assert/strict';
import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { installGuard } from '../src/cloud-guard.ts';
import { parseConfig } from '../src/config.ts';
import { dispatch } from '../src/dispatch.ts';
import { run } from '../src/exec.ts';
import { mutate, readLedger, type Task, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, tempDir } from './support.ts';

export const now = () => new Date('2026-10-09T12:00:00Z');
export const CLOUD = { routine: 'trig_01ABCDEFGHJKLMNOPQRSTUVW', default: 'local' as const, quietMinutes: 120, max: 3, review: 'local' as const };
/** A generic project on GitHub that opted in, with no checks, so a collect needs none (GH-103 off). */
export const RAW = { ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'acme-bot' }, commitIdentity: { name: 'Acme Bot', email: 'bot@example.com' }, agents: { max: 2, cloud: CLOUD }, strayFiles: { required: false } };
export const cfg = (raw: Record<string, unknown> = RAW) => parseConfig(JSON.parse(JSON.stringify(raw))).config!;
export const FIRED = JSON.stringify({ type: 'routine_fire', claude_code_session_id: 'session_01TEST', claude_code_session_url: 'https://claude.ai/code/session_01TEST' });
/** The commands a cloud dispatch runs besides git: claude's sign-in, the keychain, and curl's fire. */
export const CLOUD_FIXTURES = {
  'claude auth status': ok(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'me@example.com' })),
  'security find-generic-password': ok('tok_0123456789abcdefghij\n'),
  curl: ok(`${FIRED}\n200`),
};

/**
 * A repo whose origin is a local bare repo, as a dispatch leaves it: the config committed, T-1 to do. A
 * second clone stands in for the cloud session, which pushes to origin.
 */
export function repoWithOrigin(raw: Record<string, unknown> = RAW, opts: { guard?: boolean } = {}) {
  const origin = join(tempDir('origin-'), 'repo.git');
  run('git', ['init', '-q', '--bare', origin]);
  const root = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(raw, null, 2), '.gitignore': '.claude/worktrees/\n' }));
  // The push guard, committed as acc cloud enable leaves it to commit (GH-69): the cloud loads it from the commit.
  if (opts.guard !== false) {
    installGuard(root);
    gitIn(root, 'add', '-A');
    gitIn(root, 'commit', '-q', '-m', 'the push guard');
  }
  gitIn(root, 'remote', 'add', 'origin', origin);
  gitIn(root, 'push', '-q', '-u', 'origin', 'main');
  gitIn(root, 'remote', 'set-head', 'origin', 'main');
  const config = cfg(raw);
  const paths = repoPaths(root, run);
  mutate(paths, now, (l, emit) => upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'A thing', brief: 'Do it.' }], 'human', 'h', emit, now));
  return { root, origin, config, paths };
}

/** The cloud session's clone: it checks the task branch out, commits, and pushes it, as the session does. */
export function cloudClone(origin: string, branch: string): string {
  const dir = tempDir('cloud-');
  run('git', ['clone', '-q', origin, dir]);
  gitIn(dir, 'config', 'user.name', 'Cloud');
  gitIn(dir, 'config', 'user.email', 'cloud@example.com');
  gitIn(dir, 'config', 'commit.gpgsign', 'false');
  gitIn(dir, 'switch', '-q', branch);
  return dir;
}

export const commitAndPush = (dir: string, branch: string, file: string, message: string): string => {
  writeFileSync(join(dir, file), `${message}\n`);
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', message);
  gitIn(dir, 'push', '-q', 'origin', branch);
  return gitIn(dir, 'rev-parse', 'HEAD');
};

export const task = (paths: ReturnType<typeof repoPaths>, id = 'T-1'): Task => readLedger(paths.ledger).tasks.find((t) => t.id === id)!;

/** A cloud dispatch of T-1, done, with the clone that stands in for its session. */
export function fired(raw: Record<string, unknown> = RAW) {
  const repo = repoWithOrigin(raw);
  const r = fakeRunner(CLOUD_FIXTURES);
  const deps = { run: r, now, accBinDir: '/acc/bin', env: { ...process.env, PATH: '/usr/bin' } as NodeJS.ProcessEnv, awake: { platform: 'darwin' as const, spawn: () => ({ pid: 4_100_002, unref: () => undefined }), kill: () => undefined } };
  const out = dispatch(repo.paths, repo.config, 'T-1', deps, { actor: 'human', by: 'h', where: 'cloud' });
  assert.equal(out.held, false);
  const branch = task(repo.paths).run!.branch!;
  return { ...repo, branch, clone: cloudClone(repo.origin, branch), follow: { run: r, now, env: deps.env } };
}

