// Every command the extension contributes, called with junk (GH-106): no argument, undefined, null, empty and
// wrong-typed values, a 1 MB string, objects of the wrong shape, a menu row naming a task that isn't there,
// and paths outside the repo. The list is extension/package.json's contributes.commands, so a new command
// is covered without anyone adding it here. Each call must settle within the time limit without throwing,
// no promise may reject unhandled, and nothing outside the repo may change. Run after npm run build.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { changes, makeRepo, snapshot, tempDir } from '../../packages/core/test/support.ts';
import { activate, fakeVscode } from './vscode.ts';

const dist = fileURLToPath(new URL('../dist/extension.js', import.meta.url));
/** The extension's folder, as VSCode gives it: its package.json, media/ and dist/. */
const extDir = join(dist, '..', '..');

/** How long one call may take before it counts as hanging. */
const LIMIT_MS = 10_000;

/** What one call did wrong: it threw or rejected, or never settled. */
export async function exercise(fn: (...a: unknown[]) => unknown, args: unknown[], limitMs = LIMIT_MS): Promise<string | null> {
  let timer: NodeJS.Timeout | undefined;
  const hung = new Promise<string>((r) => { timer = setTimeout(() => r(`didn't settle within ${limitMs / 1000}s`), limitMs); });
  try {
    return await Promise.race([Promise.resolve().then(() => fn(...args)).then(() => null, (e: unknown) => `rejected: ${clip((e as Error)?.message ?? String(e))}`), hung]);
  } finally {
    clearTimeout(timer);
  }
}

const clip = (s: string): string => (s.length > 200 ? `${s.slice(0, 200)}… (${s.length} characters)` : s);
const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shown = (v: unknown): string => {
  if (typeof v === 'string') return v.length > 40 ? `<${v.length} chars>` : JSON.stringify(v);
  if (typeof v === 'number') return String(v);
  try {
    return JSON.stringify(v)?.slice(0, 60) ?? String(v);
  } catch {
    return String(v);
  }
};

test('the harness catches a command that throws, rejects, hangs or leaves a rejection behind', async () => {
  assert.equal(await exercise(() => 1, []), null);
  assert.equal(await exercise(async () => undefined, [undefined]), null);
  assert.match((await exercise((n: unknown) => (n as { kind: string }).kind, [undefined]))!, /rejected: Cannot read properties of undefined/);
  assert.match((await exercise(async () => { throw new Error('boom'); }, []))!, /rejected: boom/);
  assert.match((await exercise(() => new Promise(() => {}), [], 50))!, /didn't settle within 0.05s/);
  // node:test fails a test on an unhandled rejection itself; set its listener aside to see that ours hears one.
  const theirs = process.listeners('unhandledRejection');
  process.removeAllListeners('unhandledRejection');
  const caught: unknown[] = [];
  const listen = (e: unknown) => caught.push(e);
  process.on('unhandledRejection', listen);
  try {
    assert.equal(await exercise(() => { void Promise.reject(new Error('left behind')); }, []), null, 'the call itself returned');
    await settle(20);
    assert.equal(caught.length, 1, 'and the rejection it left is seen');
  } finally {
    process.off('unhandledRejection', listen);
    for (const l of theirs) process.on('unhandledRejection', l);
  }
});

test('every contributed command survives junk arguments (GH-106)', { timeout: 20 * 60_000 }, async (t) => {
  const sandbox = realpathSync(tempDir('acc-ext-junk-'));
  const at = (...p: string[]) => join(sandbox, ...p);
  for (const d of ['home/.claude', 'state/questions', 'state/heavy', 'state/slack', 'bin', 'OUTSIDE/X']) mkdirSync(at(d), { recursive: true });
  writeFileSync(at('home', '.claude.json'), '{"projects":{}}\n');
  writeFileSync(at('OUTSIDE', 'sentinel.txt'), 'The extension must never change this file.\n');
  for (const name of ['gh', 'claude', 'sf', 'code', 'open', 'osascript', 'caffeinate']) {
    writeFileSync(at('bin', name), '#!/bin/sh\nexit 1\n');
    chmodSync(at('bin', name), 0o755);
  }
  const saved = { ...process.env };
  Object.assign(process.env, {
    HOME: at('home'), CLAUDE_CONFIG_DIR: at('home', '.claude'), PATH: `${at('bin')}:${process.env.PATH}`, NO_COLOR: '1',
    ACC_QUESTIONS_DIR: at('state', 'questions'), ACC_HEAVY_DIR: at('state', 'heavy'), ACC_MACHINE_FILE: at('state', 'machine.json'),
    ACC_RUNTIME_FILE: at('state', 'runtime'), ACC_SLACK_DIR: at('state', 'slack'),
  });
  delete process.env.ACC_ROLE;
  delete process.env.ACC_TASK;
  const repo = makeRepo({ '.acc/config.json': JSON.stringify({ schema: 1, project: 'Tool', profile: 'generic', environments: [{ name: 'main', default: true }], trackers: [{ kind: 'github' }] }), '.gitignore': '.claude/worktrees/\n' });
  const outside = at('OUTSIDE');
  const JUNK: [string, unknown[]][] = [
    ['no argument', []],
    ...([
      undefined, null, '', 0, -1, NaN, '{}', 'x'.repeat(1024 * 1024), {}, [], { kind: 'task' }, { kind: 'agent', session: null },
      { webviewSection: 'task', accRef: { project: repo, task: 'T-99999' } },
      { webviewSection: 'env', accRef: { project: outside, env: '../x' } },
      outside, { root: outside }, '../../OUTSIDE/X', 'T-99999',
    ] as unknown[]).map((v): [string, unknown[]] => [shown(v), [v]]),
  ];
  const fake = fakeVscode(repo);
  const rejections: string[] = [];
  let current = '';
  const onRejection = (e: unknown) => rejections.push(`${current}: ${clip((e as Error)?.message ?? String(e))}`);
  process.on('unhandledRejection', onRejection);
  // Fresh machine results, so no slow machine CLI runs, and no welcome.
  const started = activate(dist, fake, { 'acc.welcomed': true, 'acc.machineItems': { at: Date.now(), profile: 'generic', items: [] } });
  try {
    const contributed = (JSON.parse(readFileSync(join(extDir, 'package.json'), 'utf8')) as { contributes: { commands: { command: string }[] } }).contributes.commands.map((c) => c.command);
    const homeBefore = snapshot(at('home'));
    const outsideBefore = snapshot(outside);
    const failures: string[] = [];
    let calls = 0;
    const t0 = Date.now();
    for (const id of contributed) {
      const fn = fake.calls.commands.get(id);
      assert.ok(fn, `${id} is contributed, so it's registered`);
      for (const [name, args] of JUNK) {
        current = `${id}(${name})`;
        const why = await exercise(fn!, args);
        calls++;
        if (why) failures.push(`${current} ${why}`);
      }
      // A rejection the command left behind surfaces here, and is put down to it.
      await settle(100);
    }
    const seconds = ((Date.now() - t0) / 1000).toFixed(1);
    t.diagnostic(`${contributed.length} commands, ${JUNK.length} values each, ${calls} calls, ${seconds}s`);
    assert.deepEqual([...failures, ...rejections.map((r) => `unhandled rejection after ${r}`)], [], 'every call settled cleanly');
    assert.deepEqual(changes(outsideBefore, snapshot(outside)), [], 'nothing outside the repo changed');
    assert.deepEqual(changes(homeBefore, snapshot(at('home'))), [], 'nothing in HOME changed');
    // Nothing drops out silently: every contributed command was called with every value.
    assert.ok(contributed.length >= 87, `${contributed.length} commands`);
    assert.equal(calls, contributed.length * JUNK.length);

    // Regressions it found, on the same activation (the bundle holds the fake it was loaded with).
    const run = (id: string, ...a: unknown[]) => Promise.resolve(fake.calls.commands.get(id)!(...a));
    await t.test('acc.job.stop with JSON that isn\'t an object, such as null, stops nothing (GH-106)', async () => {
      for (const v of [null, 'null', '5', '"x"', '[]']) assert.equal(await run('acc.job.stop', v), undefined, String(v));
    });
    await t.test('a node command given nothing or null does nothing, where it read n.kind and threw (GH-106)', async () => {
      const commands = ['acc.agent.openFolder', 'acc.env.openOrg', 'acc.env.openGithub', 'acc.env.copyBranch', 'acc.env.compare', 'acc.task.openTicket', 'acc.task.copyId', 'acc.task.attach', 'acc.task.openWorktree', 'acc.task.show', 'acc.task.move', 'acc.worktree.open', 'acc.worktree.terminal', 'acc.worktree.reveal', 'acc.worktree.remove'];
      for (const id of commands) for (const v of [undefined, null]) assert.equal(await exercise(fake.calls.commands.get(id)!, [v]), null, `${id}(${v})`);
    });
    await t.test('acc.task.importJira with a string, not a row, connects Jira for the first project (GH-106)', async () => {
      const from = fake.calls.executed.length;
      await run('acc.task.importJira', 'T-99999');
      const connect = fake.calls.executed.slice(from).find(([id]) => id === 'acc.trackers.add');
      assert.deepEqual((connect?.[1][0] as { kind: string }).kind, 'jira');
    });  } finally {
    started.stop();
    process.off('unhandledRejection', onRejection);
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});
