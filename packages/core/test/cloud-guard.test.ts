// The cloud push guard (GH-69): the script a repo that opted in commits, run as Claude Code runs it in a
// cloud session, with the input on stdin and the decision on stdout. It allows a cloud builder to push its
// own task branch, and refuses everything else it must never do; outside a cloud session it says nothing.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { GUARD_COMMAND, GUARD_PATH, GUARD_SCRIPT, guardInstalled, installGuard, SETTINGS_PATH } from '../src/cloud-guard.ts';
import { run } from '../src/exec.ts';
import { tempDir } from './support.ts';

/** A repo on a branch, with the guard written in it as acc cloud enable writes it. */
function repoOn(branch: string): string {
  const dir = tempDir('guard-');
  const git = (...a: string[]) => {
    const r = run('git', a, { cwd: dir });
    if (r.code !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
  };
  git('init', '-q', '-b', branch);
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '-m', 'initial');
  installGuard(dir);
  return dir;
}

/** Runs the guard as Claude Code does: the hook's input on stdin, in the repo, in or out of a cloud session. */
function guard(root: string, command: string, remote = true): { reason: string | null; code: number | null; err: string } {
  const r = spawnSync(process.execPath, [join(root, GUARD_PATH)], {
    cwd: root, input: JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: root }), encoding: 'utf8',
    env: { ...process.env, CLAUDE_CODE_REMOTE: remote ? 'true' : '' },
  });
  const out = r.stdout.trim() ? JSON.parse(r.stdout) : null;
  return { reason: out?.hookSpecificOutput?.permissionDecisionReason ?? null, code: r.status, err: r.stderr };
}

test('in a cloud session on its task branch, the guard allows a push of that branch alone, and refuses every other push, a pull request and a deploy', () => {
  const root = repoOn('task/T-1-a-thing');
  const allowed = ['git push origin task/T-1-a-thing', 'git push', 'git push -u origin task/T-1-a-thing', 'git push origin HEAD:task/T-1-a-thing', 'git push origin task/T-1-a-thing:refs/heads/task/T-1-a-thing', 'git status && git push origin task/T-1-a-thing', 'npm test', 'git commit -m "x"', 'gh pr view 3', 'git merge origin/main'];
  for (const c of allowed) {
    const r = guard(root, c);
    assert.equal(r.code, 0, `${c}: exits 0 (${r.err})`);
    assert.equal(r.reason, null, `${c}: allowed`);
  }
  const refused: [string, RegExp][] = [
    ['git push origin main', /Push only your task branch, task\/T-1-a-thing, not main/],
    ['git push origin HEAD:main', /never push main/],
    ['git push origin task/T-1-a-thing:main', /never push main/],
    ['git push origin task/T-2-other', /not task\/T-2-other/],
    ['git push --force origin task/T-1-a-thing', /force-push/],
    ['git push -f', /force-push/],
    ['git push origin +task/T-1-a-thing', /force-push/],
    ['git push origin :task/T-1-a-thing', /delete a branch/],
    ['git push --delete origin task/T-1-a-thing', /delete a branch/],
    ['git push --all', /push everything/],
    ['git push upstream task/T-1-a-thing', /origin only/],
    ['git add . ; git push origin main', /not main/],
    ['gh pr merge 3', /Pull requests are a person's/],
    ['gh pr create --fill', /Pull requests are a person's/],
    ['gh pr close 3', /Pull requests are a person's/],
    ['gh api -X PUT repos/o/r/pulls/3/merge', /Never merge through the API/],
    ['sf project deploy start -o Dev', /never deploy/],
    ['nice -n 15 git push origin main', /not main/],
  ];
  for (const [c, why] of refused) {
    const r = guard(root, c);
    assert.equal(r.code, 0, `${c}: exits 0, never 2 (${r.err})`);
    assert.match(r.reason ?? '', why, `${c}: refused, saying why`);
  }
});

test('off a task branch, every push is refused; outside a cloud session, the guard says nothing at all', () => {
  const onMain = repoOn('main');
  assert.match(guard(onMain, 'git push origin main').reason ?? '', /this checkout is on main/);
  assert.match(guard(onMain, 'git push').reason ?? '', /this checkout is on main/);
  // A person on main in their own terminal, or a local builder with the plugin's guards (D-042), sees nothing from this hook.
  assert.equal(guard(onMain, 'git push origin main', false).reason, null);
  assert.equal(guard(repoOn('task/T-1-a'), 'git push origin main', false).reason, null);
  // Junk on stdin, or a tool that isn't Bash, is ignored, and the hook still exits 0.
  const r = spawnSync(process.execPath, [join(onMain, GUARD_PATH)], { cwd: onMain, input: 'not json', encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_REMOTE: 'true' } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  const edit = spawnSync(process.execPath, [join(onMain, GUARD_PATH)], { cwd: onMain, input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'x' } }), encoding: 'utf8', env: { ...process.env, CLAUDE_CODE_REMOTE: 'true' } });
  assert.equal(edit.stdout, '');
});

test('installGuard writes the script and a PreToolUse hook into .claude/settings.json, keeps other settings, and does it again only when something changed', () => {
  const root = tempDir('guard-install-');
  mkdirSync(join(root, '.claude'), { recursive: true });
  writeFileSync(join(root, SETTINGS_PATH), JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] } }));
  assert.equal(guardInstalled(root), false);
  const first = installGuard(root);
  assert.deepEqual(first.written.sort(), [GUARD_PATH, SETTINGS_PATH].sort());
  assert.ok(existsSync(join(root, GUARD_PATH)));
  assert.equal(readFileSync(join(root, GUARD_PATH), 'utf8'), GUARD_SCRIPT);
  const settings = JSON.parse(readFileSync(join(root, SETTINGS_PATH), 'utf8'));
  assert.deepEqual(settings.permissions, { allow: ['Bash(npm test)'] }, 'other settings are kept');
  assert.equal(settings.hooks.Stop[0].hooks[0].command, 'echo bye', 'other hooks are kept');
  assert.deepEqual(settings.hooks.PreToolUse, [{ matcher: 'Bash', hooks: [{ type: 'command', command: GUARD_COMMAND, timeout: 10 }] }]);
  assert.equal(guardInstalled(root), true);
  assert.deepEqual(installGuard(root).written, [], 'nothing to write again');
  // A script someone changed is written again, so the committed guard is always acc's.
  writeFileSync(join(root, GUARD_PATH), '// changed\n');
  assert.deepEqual(installGuard(root).written, [GUARD_PATH]);
});

test('this repo commits the guard, so the real run on it is guarded (GH-69)', () => {
  const repo = join(import.meta.dirname, '..', '..', '..');
  assert.equal(guardInstalled(repo), true, `${GUARD_PATH} and its hook in ${SETTINGS_PATH} are committed`);
  assert.equal(readFileSync(join(repo, GUARD_PATH), 'utf8'), GUARD_SCRIPT, 'the committed script is the current one');
});
