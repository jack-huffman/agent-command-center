import assert from 'node:assert/strict';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { machineAgents, setMachineAgents } from '../src/limits.ts';
import { readMachineKey } from '../src/machine.ts';
import { heavySlots, heavyState, MAX_HEAVY_SLOTS, setHeavySlots, withSlot } from '../src/semaphore.ts';
import { tempDir } from './support.ts';

test('a machine runs one heavy check at once unless it says more: ACC_HEAVY_SLOTS, then machine.json, capped (D-080)', () => {
  const file = join(tempDir('acc-machine-'), 'machine.json');
  const env = { ACC_MACHINE_FILE: file };
  assert.equal(heavySlots(env), 1, 'nothing set: one');
  writeFileSync(file, JSON.stringify({ heavySlots: 2, other: 'kept' }));
  assert.equal(heavySlots(env), 2);
  assert.equal(heavySlots({ ...env, ACC_HEAVY_SLOTS: '3' }), 3, 'the environment wins');
  writeFileSync(file, JSON.stringify({ heavySlots: 50 }));
  assert.equal(heavySlots(env), MAX_HEAVY_SLOTS, 'capped');
  writeFileSync(file, '{ not json');
  assert.equal(heavySlots(env), 1, 'a file it can\'t read is one');
  writeFileSync(file, JSON.stringify({ heavySlots: 2, other: 'kept' }));
  assert.equal(setHeavySlots(4, env), 4);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { heavySlots: 4, other: 'kept' }, 'the rest of the file stays');
  for (const bad of [0, 2.5, 9, Number.NaN]) assert.throws(() => setHeavySlots(bad, env), /whole number from 1 to 8/, String(bad));
});

test('the heavy-check slots are read and written where the machine\'s total is, and with no home a write is refused (GH-131)', () => {
  // A made-up environment with no home reaches nothing on the machine running the test: one slot, and no write.
  assert.equal(heavySlots({}), 1, 'no home: one');
  assert.throws(() => setHeavySlots(2, {}), (e: Error & { code?: string }) => e.code === 'refused' && /no HOME\. Set HOME, or ACC_MACHINE_FILE/.test(e.message));
  const home = tempDir('home-');
  assert.equal(setHeavySlots(3, { HOME: home }), 3);
  assert.equal(setMachineAgents(5, { HOME: home }), 5);
  assert.deepEqual(JSON.parse(readFileSync(join(home, '.acc', 'machine.json'), 'utf8')), { heavySlots: 3, agents: 5 }, 'one file, under HOME');
  assert.deepEqual([heavySlots({ HOME: home }), machineAgents({ HOME: home })], [3, 5], 'each read where it was written');
});

/**
 * Another process setting one of machine.json's keys 300 times through its setter, from `start`, counting 1 to
 * `top` and round again, so it ends on `top`. After each change it reads its key back, and prints how many it
 * found lost: only the other process writes the file meanwhile, and that one sets its own key.
 */
function setter(file: string, start: number, module: string, call: string, key: string, top: number): Promise<{ code: number | null; out: string }> {
  const url = new URL(`../src/${module}`, import.meta.url).href;
  const code = `import { readFileSync } from 'node:fs';
import * as m from ${JSON.stringify(url)};
const env = { ACC_MACHINE_FILE: process.env.FILE };
while (Date.now() < ${start});
let lost = 0;
for (let i = 0; i < 300; i++) {
  const n = (i % ${top}) + 1;
  m.${call}(n, env);
  if (JSON.parse(readFileSync(env.ACC_MACHINE_FILE, 'utf8')).${key} !== n) lost++;
}
process.stdout.write(String(lost));`;
  const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], { env: { ...process.env, FILE: file }, stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  child.stdout!.on('data', (b: Buffer) => { out += b.toString(); });
  return new Promise((resolve) => child.on('close', (code) => resolve({ code, out })));
}

test('a slots change and a total change made at once both survive in machine.json, through its one writer (GH-148)', async () => {
  const dir = tempDir('acc-machine-');
  const file = join(dir, 'machine.json');
  writeFileSync(file, JSON.stringify({ other: 'kept' }));
  // Two processes, each setting its own key many times while the other does, from the same moment: with a
  // read, merge and write that weren't one at a time, each would write over the other's key now and then.
  const start = Date.now() + 1_500;
  const runs = await Promise.all([setter(file, start, 'semaphore.ts', 'setHeavySlots', 'heavySlots', 6), setter(file, start, 'limits.ts', 'setMachineAgents', 'agents', 50)]);
  assert.deepEqual(runs, [{ code: 0, out: '0' }, { code: 0, out: '0' }], 'both ran to the end, and neither lost a change to the other');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { other: 'kept', heavySlots: 6, agents: 50 }, 'each kept the other\'s key, and the rest');
  assert.deepEqual(readdirSync(dir), ['machine.json'], 'no temp file or lock left beside it');
});

const deadPid = (): number => Number(spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' }).stdout);
const hold = (dir: string, slot: number, owner: Record<string, unknown>) => {
  mkdirSync(join(dir, `slot-${slot}`), { recursive: true });
  writeFileSync(join(dir, `slot-${slot}`, 'owner'), JSON.stringify(owner));
};
const waiter = (dir: string, name: string, w: Record<string, unknown>) => {
  mkdirSync(join(dir, 'waiting'), { recursive: true });
  writeFileSync(join(dir, 'waiting', name), JSON.stringify(w));
  return join(dir, 'waiting', name);
};

test('a slot\'s owner file says what holds it: the gate, its task, its project and its folder (D-092)', () => {
  const dir = tempDir('slots-');
  const owner = { what: 'check', task: 'GH-76', project: 'Agent Command Center', cwd: '/wt/GH-76' };
  const seen = withSlot(() => JSON.parse(readFileSync(join(dir, 'slot-0', 'owner'), 'utf8')), { dir, slots: 1, owner });
  assert.deepEqual({ ...seen, at: 0 }, { ...owner, pid: process.pid, at: 0 });
  assert.equal(typeof seen.at, 'number');
});

test('a free slot goes to whoever has waited longest: a newcomer never jumps the line, unless the waiter ahead has gone or gone quiet (D-092)', () => {
  const dir = tempDir('slots-');
  const older = waiter(dir, '1-1.json', { pid: process.pid, at: Date.now() - 1000, what: 'validate', task: 'T-1' });
  let waited = 0;
  assert.throws(() => withSlot(() => 'ran', { dir, slots: 1, timeoutMs: 150, pollMs: 20, onWait: () => waited++ }), /stayed taken/, 'the slot is free, but someone waited first');
  assert.equal(waited, 1, 'told once that it waits');
  assert.deepEqual(readdirSync(join(dir, 'waiting')), ['1-1.json'], 'it left the line when it gave up');
  assert.equal(withSlot(() => 'ran', { dir, slots: 2, timeoutMs: 150, pollMs: 20 }), 'ran', 'two free slots and one ahead: there\'s one for each');

  const old = new Date(Date.now() - 60_000);
  utimesSync(older, old, old);
  assert.equal(withSlot(() => 'ran', { dir, slots: 1, timeoutMs: 150, pollMs: 20 }), 'ran', 'a waiter that stopped touching its file has lost its place');
  rmSync(older);
  waiter(dir, '2-1.json', { pid: deadPid(), at: 1 });
  assert.equal(withSlot(() => 'ran', { dir, slots: 1, timeoutMs: 150, pollMs: 20 }), 'ran', 'and so has one whose process is gone');
});

test('the slots say who holds each and who waits, in order; an older acc\'s owner says only its pid (D-092)', () => {
  const dir = tempDir('slots-');
  hold(dir, 0, { pid: process.pid, at: 5, what: 'validate', task: 'T-1', project: 'Acme', cwd: '/wt/T-1', junk: 1 });
  hold(dir, 1, { pid: process.pid, at: 6 });
  hold(dir, 2, { pid: deadPid(), at: 7, what: 'gone' });
  hold(dir, 3, { pid: process.pid, at: 8, what: 7 });
  mkdirSync(join(dir, 'slot-4')); // being taken: no owner yet
  waiter(dir, 'b.json', { pid: process.pid, at: 20, what: 'Deploy dev', env: 'dev' });
  waiter(dir, 'a.json', { pid: process.pid, at: 10, what: 'check', task: 'T-2' });
  waiter(dir, 'c.json', { pid: deadPid(), at: 1, what: 'gone' });
  const s = heavyState({ dir, slots: 2 });
  assert.equal(s.slots, 2);
  assert.deepEqual(s.held, [
    { slot: 1, pid: process.pid, at: 5, what: 'validate', task: 'T-1', project: 'Acme', cwd: '/wt/T-1' },
    { slot: 2, pid: process.pid, at: 6 },
    { slot: 4, pid: process.pid, at: 8 },
  ], 'a slot past the count, after it went down, is still held; a field that isn\'t a string is dropped');
  assert.deepEqual(s.waiting, [
    { pid: process.pid, at: 10, place: 1, what: 'check', task: 'T-2' },
    { pid: process.pid, at: 20, place: 2, what: 'Deploy dev', env: 'dev' },
  ]);
  assert.deepEqual(heavyState({ dir: join(dir, 'none'), slots: 1 }), { dir: join(dir, 'none'), slots: 1, held: [], waiting: [] }, 'no check has run yet');
});

/** Another process waiting for a slot in `dir`: it says when it took it, and holds it a moment. */
function contender(dir: string, name: string): { child: ChildProcess; out: Promise<string> } {
  const url = new URL('../src/semaphore.ts', import.meta.url).href;
  const code = `import { withSlot } from ${JSON.stringify(url)};
withSlot(() => { process.stdout.write('took ' + process.env.NAME + ' ' + Date.now() + '\\n'); const end = Date.now() + 300; while (Date.now() < end); }, { dir: process.env.SLOT_DIR, slots: 1, pollMs: 20, timeoutMs: 20000, owner: { what: process.env.NAME } });`;
  const child = spawn(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], { env: { ...process.env, SLOT_DIR: dir, NAME: name }, stdio: ['ignore', 'pipe', 'inherit'] });
  let text = '';
  child.stdout!.on('data', (b: Buffer) => { text += b.toString(); });
  return { child, out: new Promise((resolve) => child.on('close', () => resolve(text))) };
}

const until = async (what: string, ok: () => boolean, ms = 10_000): Promise<void> => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('two checks waiting for one slot take it in the order they came, and each leaves the line when it takes it (D-092)', async () => {
  const dir = tempDir('slots-');
  hold(dir, 0, { pid: process.pid, at: Date.now(), what: 'held by the test' });
  const a = contender(dir, 'A');
  await until('A to wait', () => heavyState({ dir, slots: 1 }).waiting.length === 1);
  const b = contender(dir, 'B');
  await until('B to wait', () => heavyState({ dir, slots: 1 }).waiting.length === 2);
  assert.deepEqual(heavyState({ dir, slots: 1 }).waiting.map((w) => [w.place, w.what, w.pid]), [[1, 'A', a.child.pid], [2, 'B', b.child.pid]]);
  rmSync(join(dir, 'slot-0'), { recursive: true, force: true });
  const [ta, tb] = (await Promise.all([a.out, b.out])).map((t) => Number(/^took \w (\d+)$/m.exec(t)?.[1]));
  assert.ok(ta! > 0 && tb! > 0, 'both ran');
  assert.ok(ta! < tb!, 'A came first, so A took the slot first');
  assert.deepEqual(heavyState({ dir, slots: 1 }), { dir, slots: 1, held: [], waiting: [] }, 'nobody holds it or waits');
});

test('readMachineKey gives a key as the file holds it, and undefined with no home, no file, a file that is not JSON, or no such key', () => {
  const file = join(tempDir('acc-machine-key-'), 'machine.json');
  const env = { ACC_MACHINE_FILE: file };
  assert.equal(readMachineKey('agents', {}), undefined, 'no home');
  assert.equal(readMachineKey('agents', env), undefined, 'no file yet');
  writeFileSync(file, 'not json');
  assert.equal(readMachineKey('agents', env), undefined, 'not JSON');
  writeFileSync(file, 'null');
  assert.equal(readMachineKey('agents', env), undefined, 'JSON null');
  writeFileSync(file, JSON.stringify({ agents: 5, heavySlots: 2 }));
  assert.deepEqual([readMachineKey('agents', env), readMachineKey('heavySlots', env), readMachineKey('other', env)], [5, 2, undefined]);
});
