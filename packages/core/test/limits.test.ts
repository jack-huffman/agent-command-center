// Limits and checks (GH-111): a project's builder cap and checks, set one key at a time; this machine's total
// across every repo, and the repos it counts; what a start that would pass either cap says; and the numbers
// Settings words a change in.
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { capWait, nextStep, type TaskFacts } from '../src/autopilot-rules.ts';
import { parseConfig } from '../src/config.ts';
import { dispatch } from '../src/dispatch.ts';
import { holdTask } from '../src/holding.ts';
import { startHeld } from '../src/held.ts';
import { agentsMaxSet, configSets, ledgersDir, machineAgents, machineCapProblem, machineCapWords, machineLoad, machineRepos, MAX_MACHINE_AGENTS, median, RECENT, recentWork, registerLedger, setAgentsMax, setBuilderGates, setMachineAgents, setRequiredGates } from '../src/limits.ts';
import { machineDir, machineJson } from '../src/machine.ts';
import { emptyLedger, type Ledger, mutate, projectCapWords, readLedger, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { run } from '../src/exec.ts';
import { fakeRunner, GENERIC_CONFIG, launchedSessions, makeRepo, ok, tempDir } from './support.ts';

const now = () => new Date('2026-10-07T12:00:00.000Z');

/** This machine, as a test's own: its machine.json, and the repos noted beside it. */
const machine = (): NodeJS.ProcessEnv => ({ ACC_MACHINE_FILE: join(tempDir('machine-'), 'machine.json') });

/** A repo with tasks, `running` of them in Running, as acc dispatch leaves them. */
function repoWith(project: string, ids: string[], running: string[] = [], extra: Record<string, unknown> = {}) {
  const raw = { ...GENERIC_CONFIG, project, worktrees: { root: tempDir('wt-') }, ...extra };
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw) });
  const config = parseConfig(raw).config!;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, ids.map((id) => ({ source: { kind: 'manual' as const, key: id }, title: `Work on ${id}` })), 'human', 'human:test', emit, now);
    for (const t of l.tasks) if (running.includes(t.id)) t.state = 'running';
  });
  return { dir, config, paths };
}

test('a project\'s cap and checks are set one key at a time, and a name it doesn\'t have is refused', () => {
  const text = '{\n  "schema": 1,\n  "project": "Tool",\n  "profile": "generic",\n  "environments": [ { "name": "main", "default": true } ],\n  "gates": {\n    "required": [\n      "test"\n    ],\n    "commands": {\n      "test": "npm test",\n      "lint": "npm run lint",\n      "build": "npm run build"\n    }\n  }\n}\n';
  const file = join(tempDir('cfg-'), 'config.json');
  writeFileSync(file, text);
  assert.equal(agentsMaxSet(file), false, 'the Command Center\'s default');
  assert.equal(setAgentsMax(file, 6), 6);
  assert.equal(readFileSync(file, 'utf8'), text.replace('\n  }\n}\n', '\n  },\n  "agents": {\n    "max": 6\n  }\n}\n'));
  assert.equal(agentsMaxSet(file), true);
  assert.deepEqual([configSets(file, ['gates', 'required']), configSets(file, ['gates', 'builder']), configSets(file, ['schema', 'max']), configSets(join(tempDir('none-'), 'x.json'), ['agents'])], [true, false, false, false]);
  for (const bad of [0, 17, 2.5, Number.NaN]) assert.throws(() => setAgentsMax(file, bad), /whole number from 1 to 16/, String(bad));

  const before = readFileSync(file, 'utf8');
  assert.deepEqual(setRequiredGates(file, ['lint', 'test', 'lint', ' ']), ['lint', 'test'], 'each once, in the order given');
  assert.equal(readFileSync(file, 'utf8'), before.replace('"required": [\n      "test"\n    ]', '"required": [\n      "lint",\n      "test"\n    ]'));
  assert.throws(() => setRequiredGates(file, ['deploy']), /deploy isn't a check this project has\. Name the required checks from: test, lint, build\./);
  assert.throws(() => setRequiredGates(file, ['stray-files']), /stray-files is required unless "strayFiles": \{ "required": false \} turns it off/, 'it isn\'t named in the list (GH-103)');
  assert.throws(() => setRequiredGates(file, []), /Name at least one check/);

  const mid = readFileSync(file, 'utf8');
  assert.deepEqual(setBuilderGates(file, ['lint']), ['lint']);
  assert.equal(readFileSync(file, 'utf8'), mid.replace('"build": "npm run build"\n    }\n  }', '"build": "npm run build"\n    },\n    "builder": [\n      "lint"\n    ]\n  }'));
  assert.throws(() => setBuilderGates(file, ['nope', 'other']), /nope, other aren't checks this project has/);
  assert.equal(setBuilderGates(file, null), null);
  assert.equal(readFileSync(file, 'utf8'), mid, 'taken out, the file is as it was');
  assert.equal(setBuilderGates(file, null), null, 'nothing to take out: nothing changes');
  assert.equal(readFileSync(file, 'utf8'), mid);
});

test('this machine\'s total is a key of machine.json, beside its heavy-check slots, and unset means none', () => {
  const env = machine();
  const file = env.ACC_MACHINE_FILE!;
  assert.equal(machineAgents(env), null, 'no file: no total');
  writeFileSync(file, JSON.stringify({ heavySlots: 2 }));
  assert.equal(machineAgents(env), null);
  assert.equal(setMachineAgents(6, env), 6);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { heavySlots: 2, agents: 6 }, 'the slots are kept');
  assert.equal(machineAgents(env), 6);
  for (const bad of [0, MAX_MACHINE_AGENTS + 1, 1.5, Number.NaN]) assert.throws(() => setMachineAgents(bad, env), /whole number from 1 to 64, or --none/, String(bad));
  assert.equal(setMachineAgents(null, env), null);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { heavySlots: 2 });
  writeFileSync(file, JSON.stringify({ agents: 'lots' }));
  assert.equal(machineAgents(env), null, 'one it can\'t read is none');
  // A made-up environment with no home reaches nothing on the machine running the test: the total is read
  // and written through one path, and with none, a write is refused rather than made in the real home.
  assert.equal(machineDir({}), null);
  assert.equal(ledgersDir({}), null);
  assert.equal(machineJson({}), null);
  assert.equal(machineAgents({}), null);
  assert.throws(() => setMachineAgents(4, {}), (e: Error & { code?: string }) => e.code === 'refused' && /no HOME\. Set HOME, or ACC_MACHINE_FILE/.test(e.message));
  assert.throws(() => setMachineAgents(null, {}), /no HOME/);
  assert.equal(machineDir({ HOME: '/home/someone' }), '/home/someone/.acc');
  assert.equal(machineJson({ HOME: '/home/someone' }), '/home/someone/.acc/machine.json');
  assert.equal(machineJson(env), file);
  const home = tempDir('home-');
  assert.equal(setMachineAgents(5, { HOME: home }), 5);
  assert.deepEqual([machineAgents({ HOME: home }), JSON.parse(readFileSync(join(home, '.acc', 'machine.json'), 'utf8'))], [5, { agents: 5 }], 'written where it\'s read');
});

test('every repo that runs builders is noted once, and counted from its own ledger; one whose ledger went is left out, and only acc forgets it', () => {
  const env = machine();
  const a = repoWith('Alpha', ['T-1', 'T-2', 'T-3'], ['T-1', 'T-2']);
  const b = repoWith('Beta', ['T-1'], ['T-1']);
  assert.deepEqual(machineRepos(env), [], 'nothing noted yet');
  registerLedger(a.paths.ledger, 'Alpha', env);
  registerLedger(a.paths.ledger, 'Alpha again', env);
  registerLedger(b.paths.ledger, 'Beta', env);
  const dir = ledgersDir(env)!;
  assert.equal(readdirSync(dir).length, 2, 'a repo is one note, however often it\'s noted');
  const all = machineRepos(env).sort((x, y) => x.project.localeCompare(y.project));
  assert.deepEqual(all.map((r) => [r.project, r.running]), [['Alpha', 2], ['Beta', 1]]);
  assert.deepEqual(machineRepos(env, { except: b.paths.ledger }).map((r) => r.project), ['Alpha'], 'a repo leaves itself out');
  // With no total, nothing elsewhere is read; with one, the rest of the machine is.
  assert.deepEqual(machineLoad(b.paths, 'Beta', env), { max: null, elsewhere: 0 });
  setMachineAgents(4, env);
  assert.deepEqual(machineLoad(b.paths, 'Beta', env), { max: 4, elsewhere: 2 });
  rmSync(join(a.dir, '.git'), { recursive: true, force: true });
  // A read leaves it out and deletes nothing, as the Command Center reads (D-012); acc's own start forgets it.
  assert.deepEqual(machineRepos(env).map((r) => r.project), ['Beta']);
  assert.equal(readdirSync(dir).length, 2, 'a read leaves its note');
  assert.deepEqual(machineLoad(b.paths, 'Beta', env), { max: 4, elsewhere: 0 });
  assert.equal(readdirSync(dir).length, 1, 'acc\'s own start drops its note');
  registerLedger(join(tempDir('gone-'), 'ledger.json'), 'Gone', env);
  assert.deepEqual(machineRepos(env, { prune: true }).map((r) => r.project), ['Beta']);
  assert.equal(readdirSync(dir).length, 1, 'and so does acc machine agents');
});

test('a start that would pass either cap says which: the project\'s first, then this machine\'s', () => {
  const config = parseConfig({ ...GENERIC_CONFIG, agents: { max: 3 } }).config!;
  const ledger: Ledger = emptyLedger();
  upsertTasks(ledger, config, ['T-1', 'T-2', 'T-3', 'T-4'].map((id) => ({ source: { kind: 'manual' as const, key: id }, title: id })), 'human', 'human:test', () => {}, now);
  ledger.tasks[0]!.state = 'running';
  ledger.tasks[1]!.state = 'running';
  assert.equal(capWait(ledger, config, 'T-4', null), null);
  assert.equal(capWait(ledger, config, 'T-4', { max: null, elsewhere: 9 }), null, 'no total: nothing elsewhere counts');
  assert.equal(capWait(ledger, config, 'T-4', { max: 4, elsewhere: 2 }), '4 builders are running on this machine, across every repo, and its total is 4 (acc machine agents).');
  assert.equal(machineCapProblem(ledger, 'T-1', { max: 2, elsewhere: 0 }), null, 'its own run doesn\'t count against it');
  ledger.tasks[2]!.state = 'running';
  assert.equal(capWait(ledger, config, 'T-4', { max: 4, elsewhere: 2 }), '3 builders are running in this project, and its cap is 3 (agents.max).', 'the project\'s cap is named first');
  assert.equal(projectCapWords(1, 1), '1 builder is running in this project, and its cap is 1 (agents.max).');
  assert.equal(machineCapWords(1, 1), '1 builder is running on this machine, across every repo, and its total is 1 (acc machine agents).');
  // Autopilot's re-dispatch of a rework, and its start of a held task, wait for this machine's total too.
  const rework = { ...ledger.tasks[3]!, state: 'rework' as const };
  const facts = (f: Partial<TaskFacts>): TaskFacts => ({ head: 'a'.repeat(40), verdict: null, reviewing: null, landed: null, ...f });
  const roomy = parseConfig({ ...GENERIC_CONFIG, agents: { max: 9 } }).config!;
  assert.deepEqual(nextStep(ledger, roomy, rework, facts({ machine: { max: 5, elsewhere: 2 } })), { step: null, outcome: 'waiting', reason: machineCapWords(5, 5) });
  assert.equal(nextStep(ledger, roomy, rework, facts({ machine: { max: 6, elsewhere: 2 } })).step, 'dispatch');
  const held = { ...ledger.tasks[3]!, held: { at: now().toISOString(), actor: 'human' as const, by: 'human:test', waitsFor: [], first: [] } };
  assert.equal(nextStep(ledger, roomy, held, facts({ machine: { max: 3, elsewhere: 0 }, start: { shares: [], first: [], problems: [] } })).reason, machineCapWords(3, 3));
});

test('a dispatch, and a held start, wait for this machine\'s total across every repo, and say so (GH-111)', () => {
  const env = machine();
  const other = repoWith('Other', ['T-1', 'T-2'], ['T-1', 'T-2']);
  registerLedger(other.paths.ledger, 'Other', env);
  const here = repoWith('Here', ['T-1', 'T-2', 'T-3'], [], { agents: { max: 5 } });
  const calls: string[] = [];
  const runner = fakeRunner({ 'claude --bg': ok('backgrounded'), 'claude agents --json': launchedSessions(calls), 'claude stop': ok() }, calls);
  const deps = { run: runner, now, accBinDir: '/acc/bin', env: { ...env, PATH: '/usr/bin' }, findSessionMs: 0 };
  const go = (id: string) => dispatch(here.paths, here.config, id, deps, { actor: 'human', by: 'human:test' });
  setMachineAgents(3, env);
  assert.equal(go('T-1').held, false, '2 elsewhere, none here: under 3');
  assert.throws(() => go('T-2'), (e: Error & { code?: string }) => e.code === 'move-refused' && e.message === `Can't dispatch T-2:\n- ${machineCapWords(3, 3)}`);
  assert.equal(calls.filter((c) => c.startsWith('claude --bg')).length, 1, 'no builder was started for it');
  assert.ok(machineRepos(env).some((r) => r.project === 'Here' && r.running === 1), 'this repo was noted when it dispatched');

  // A held start waits for the total too, with the same words, and its hold stays.
  holdTask(here.paths, now, 'T-2', { actor: 'human', by: 'human:test' }, { shares: [], first: [] } as never);
  const waiting = startHeld(here.paths, here.config, deps, { actor: 'human', by: 'human:test' });
  assert.deepEqual([waiting.started, waiting.failed, waiting.waiting.map((w) => [w.task, w.reason])], [[], [], [['T-2', machineCapWords(3, 3)]]]);
  assert.ok(readLedger(here.paths.ledger).tasks.find((t) => t.id === 'T-2')!.held, 'still held');

  // Raised, or taken out, it starts.
  setMachineAgents(null, env);
  assert.deepEqual(startHeld(here.paths, here.config, deps, { actor: 'human', by: 'human:test' }).started.map((s) => s.task), ['T-2']);
  assert.equal(go('T-3').held, false);
});

test('recent work: each builder run from its dispatch to its acc done, and the newest reviews\' and analyses\' costs', () => {
  const { paths } = repoWith('Tool', ['T-1', 'T-2', 'T-3']);
  const at = (h: number) => `2026-10-07T${String(h).padStart(2, '0')}:00:00.000Z`;
  mutate(paths, now, (l, emit) => {
    emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'human:test', data: {} });
    const [a, b, c] = l.tasks;
    a!.history.push({ at: at(1), actor: 'human', by: 'p', from: 'todo', to: 'running', reason: null }, { at: at(2), actor: 'builder', by: 'b', from: 'running', to: 'review', reason: null });
    // Blocked on the way: that run didn't finish, and the next one counts from its own start.
    b!.history.push({ at: at(3), actor: 'human', by: 'p', from: 'todo', to: 'running', reason: null }, { at: at(4), actor: 'builder', by: 'b', from: 'running', to: 'blocked', reason: 'x' },
      { at: at(5), actor: 'human', by: 'p', from: 'blocked', to: 'running', reason: null }, { at: at(8), actor: 'builder', by: 'b', from: 'running', to: 'review', reason: null });
    c!.history.push({ at: at(9), actor: 'human', by: 'p', from: 'todo', to: 'running', reason: null });
  });
  const hour = 3_600_000;
  const none = recentWork(paths, readLedger(paths.ledger));
  assert.deepEqual(none.builds, [3 * hour, hour], 'newest first; one still running doesn\'t count');
  assert.deepEqual([none.reviews, none.analyses], [[], []], 'nothing recorded yet');

  mkdirSync(paths.reviews, { recursive: true });
  mkdirSync(paths.analyses, { recursive: true });
  for (let i = 0; i < RECENT + 3; i++) {
    const f = join(paths.reviews, `T-${i}-${'a'.repeat(40)}.json`);
    writeFileSync(f, JSON.stringify({ costUsd: i === 2 ? null : i }));
    utimesSync(f, new Date(1000 * (i + 1)), new Date(1000 * (i + 1)));
  }
  writeFileSync(join(paths.reviews, 'T-1.running.json'), JSON.stringify({ costUsd: 99 }));
  writeFileSync(join(paths.analyses, 'T-1.json'), JSON.stringify({ costUsd: 1.25 }));
  writeFileSync(join(paths.analyses, 'T-2.json'), '{ not yet');
  const w = recentWork(paths, readLedger(paths.ledger));
  assert.deepEqual(w.reviews, [12, 11, 10, 9, 8, 7, 6, 5, 4, 3], 'the newest that recorded a cost, at most ten');
  assert.deepEqual(w.analyses, [1.25]);
  assert.equal(median([]), null);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});
