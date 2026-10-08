import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { run } from '../src/exec.ts';
import { commandsOf, expands, guardBash, shortPacket } from '../src/hooks.ts';
import { DONE_COMMAND, mutate, readLedger, type Task, upsertTasks } from '../src/ledger.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { repoPaths } from '../src/paths.ts';
import { GENERIC_CONFIG, gitIn, makeRepo, tempDir } from './support.ts';

const MAIN = fileURLToPath(new URL('../../cli/src/main.ts', import.meta.url));
const FIXTURES = fileURLToPath(new URL('./fixtures/hooks/', import.meta.url));
const now = () => new Date('2026-10-02T12:00:00Z');
const RAW = { ...GENERIC_CONFIG, environmentSpecific: 'config/environment-specific.txt' };

/** A repo with T-1 running in a real worktree, the way acc dispatch leaves it. */
function repo() {
  const root = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(RAW), 'config/environment-specific.txt': 'config/prod.json\n', 'config/prod.json': '{}\n', 'src/a.ts': 'export {}\n' }));
  const wt = join(root, '.claude', 'worktrees', 'T-1');
  gitIn(root, 'worktree', 'add', '-q', '-b', 'task/T-1-a', wt);
  const config = parseConfig(RAW).config as Config;
  mutate(repoPaths(root, run), now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Do the thing' }], 'human', 'human:test', emit, now);
    const t = l.tasks[0]!;
    t.state = 'running';
    t.run = { worktree: wt, branch: 'task/T-1-a', sessionId: 'sess-old' };
  });
  return { root, wt, outside: realpathSync(tempDir()) };
}

/** Runs `acc hook <event>` as Claude Code does: the input on stdin, the decision on stdout. */
function hook(event: string, input: unknown, env: Record<string, string>, cwd: string) {
  const r = spawnSync(process.execPath, ['--no-warnings', MAIN, 'hook', event], {
    cwd, input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8',
    env: { ...process.env, ACC_ROLE: '', ACC_TASK: '', ...env },
  });
  return { code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null, err: r.stderr };
}

test('every hook fixture gets the outcome it expects, and no hook ever exits 2 or fails loudly', () => {
  const r = repo();
  const fill = (s: string) => s.replaceAll('{wt}', r.wt).replaceAll('{root}', r.root).replaceAll('{outside}', r.outside);
  const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.json')).sort();
  assert.ok(files.length >= 20, 'a fixture for each rule');
  for (const f of files) {
    const fx = JSON.parse(fill(readFileSync(join(FIXTURES, f), 'utf8'))) as { event: string; env: Record<string, string>; input: { cwd?: string } | string; expect: string };
    const cwd = typeof fx.input === 'string' ? r.wt : fx.input.cwd ?? r.wt;
    const res = hook(fx.event, fx.input, fx.env, cwd);
    assert.equal(res.code, 0, `${f}: exits 0 (${res.err})`);
    const [kind, words] = fx.expect.split(/:(.*)/s) as [string, string | undefined];
    if (kind === 'none' || kind === 'none+linked') assert.equal(res.out, null, `${f}: says nothing`);
    if (kind === 'deny') {
      assert.equal(res.out?.hookSpecificOutput?.permissionDecision, 'deny', `${f}: denied`);
      assert.match(res.out.hookSpecificOutput.permissionDecisionReason, new RegExp(words!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${f}: says why`);
    }
    if (kind === 'context') assert.match(res.out?.hookSpecificOutput?.additionalContext ?? '', new RegExp(words!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${f}: gives its instructions back`);
    if (kind === 'block') {
      assert.equal(res.out?.decision, 'block', `${f}: reminds it`);
      assert.match(res.out.reason, new RegExp(words!));
    }
    if (kind === 'none+linked') assert.equal(readLedger(repoPaths(r.root, run).ledger).tasks[0]!.run?.sessionId, 'sess-new', `${f}: the session is linked to its task`);
  }
});

test('the finish-line reminder comes once a session, and only while the task is still running', () => {
  const r = repo();
  const env = { ACC_ROLE: 'builder', ACC_TASK: 'T-1' };
  const input = { hook_event_name: 'Stop', session_id: 'sess-1', cwd: r.wt };
  const first = hook('stop', input, env, r.wt).out;
  assert.equal(first?.decision, 'block');
  assert.ok(first.reason.includes(DONE_COMMAND), 'the finish command, word for word (D-106)');
  assert.equal(hook('stop', input, env, r.wt).out, null, 'not twice');
  mutate(repoPaths(r.root, run), now, (l, emit) => { l.tasks[0]!.state = 'review'; emit({ type: 'task.updated', task: 'T-1', actor: 'builder', by: 't', data: {} }); });
  assert.equal(hook('stop', { ...input, session_id: 'sess-2' }, env, r.wt).out, null, 'finished: nothing to remind');
});

test('commands are read through quotes, chains and wrappers, the way the shell would split them', () => {
  assert.deepEqual(commandsOf('git add -A && git commit -m "a; b" || echo x'), [['git', 'add', '-A'], ['git', 'commit', '-m', 'a; b'], ['echo', 'x']]);
  assert.deepEqual(commandsOf('FOO=1 nice -n 15 npm test'), [['npm', 'test']]);
  assert.deepEqual(commandsOf("echo 'git push'"), [['echo', 'git push']], 'a quoted mention isn\'t a push');
  assert.deepEqual(commandsOf('(cd x; git push)'), [['cd', 'x'], ['git', 'push']]);
});

test('the short instructions give the finish command word for word, and a note the shell would expand is refused (D-106)', () => {
  const task = { id: 'T-1', title: 'Do the thing', run: { worktree: '/w/T-1', branch: 'task/T-1-a' } } as Task;
  assert.ok(shortPacket(task, ['test']).includes(`then finish with your note, all on one line: \`${DONE_COMMAND}\``));
  // A backtick or a $ the shell acts on: anywhere but inside single quotes, or escaped.
  assert.equal(expands('acc done --landed "Adds `sum`"'), true);
  assert.equal(expands('acc done --landed "Saves $5"'), true);
  assert.equal(expands('acc block $(whoami)'), true);
  assert.equal(expands("acc done --landed 'Saves $5 and `x`'"), false);
  assert.equal(expands('acc done --landed "Saves \\$5" --open "it\'s fine"'), false);
  assert.equal(expands(DONE_COMMAND), false, 'the command it asks for is safe as written');
  // Refused, it's quoted back as the command it was: a block stays a block, never a done.
  const b = { task } as never;
  assert.ok(guardBash(b, 'acc done --landed "Adds `sum`"')!.endsWith(DONE_COMMAND));
  assert.match(guardBash(b, 'acc block "Is the $500 limit per order?"')!, /: acc block "<what you need>"$/);
  assert.match(guardBash(b, 'acc block --client "Is the $500 limit per order?"')!, /: acc block --client "<your question for the client>"$/);
  // acc by its path, as the packet says to use when acc isn't found, is acc.
  assert.match(guardBash(b, '/opt/acc/bin/acc done --landed "Saves $5"')!, /backtick or \$/);
  assert.match(guardBash(b, '/opt/acc/bin/acc set T-1 done')!, /acc set is a person's/);
  // Adding or skipping a tidy-up is a person's (GH-104); looking at it isn't.
  assert.match(guardBash(b, 'acc tidy add')!, /acc tidy add is a person's/);
  assert.match(guardBash(b, 'acc tidy skip --json')!, /acc tidy skip is a person's/);
  assert.equal(guardBash(b, 'acc tidy --json'), null);
});
