// acc agents, acc machine, acc show and acc resume: builders, their settings and this machine's limits (agents.ts).
// acc runs from its source, in throwaway repos (support.ts).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { builderSettings, guardAnalyst, guardBash, mutate, parseConfig, registerLedger, repoPaths, run, transcriptDir } from '../../core/src/index.ts';
import { GENERIC_CONFIG, gh41Lines, makeRepo, tempDir } from '../../core/test/support.ts';
import { cli, LIMITS_CONFIG, repoWithConfig } from './support.ts';
import { nodeStandIn, standIn } from '../../core/test/stand-in.ts';
import { thisMachine } from '../../core/src/this-machine.ts';

/** This machine as acc names it on the system the tests run on (T-150): the Windows CI job reads This PC. */
const HERE = thisMachine();

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

test('acc show says a running task\'s builder stopped, with what it last said, and acc resume carries it on (D-067)', () => {
  const dir = realpathSync(repoWithConfig());
  assert.equal(acc(dir, ['add', 'Ticket updates are drafts']).code, 0);
  // T-1 as GH-41 was after the Mac slept: running for long enough, its session gone, its transcript ending in the API error.
  const file = join(dir, '.git', 'acc', 'ledger.json');
  const l = JSON.parse(readFileSync(file, 'utf8'));
  l.tasks[0].state = 'running';
  l.tasks[0].run = { bgId: 'bg9', sessionId: 'sess-9', worktree: dir, branch: 'main', startedAt: '2026-10-05T21:52:13.000Z' };
  writeFileSync(file, JSON.stringify(l));
  const config = tempDir('claude-config-');
  mkdirSync(transcriptDir(join(config, 'projects'), dir), { recursive: true });
  writeFileSync(join(transcriptDir(join(config, 'projects'), dir), 'sess-9.jsonl'), gh41Lines('sess-9', dir).join('\n') + '\n');
  // Stand-ins for claude (no sessions listed; a resume writes down how it was run) and caffeinate.
  const bin = tempDir('bin-');
  const record = join(bin, 'records.jsonl');
  nodeStandIn(join(bin, 'claude'), `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === 'agents') console.log('[]');
else fs.appendFileSync(${JSON.stringify(record)}, JSON.stringify({ cmd: 'claude', args, cwd: process.cwd(), role: process.env.ACC_ROLE, task: process.env.ACC_TASK }) + '\\n');
`);
  standIn(join(bin, 'caffeinate'), `#!/bin/sh\nprintf '{"cmd":"caffeinate","args":["%s","%s","%s"]}\\n' "$1" "$2" "$3" >> ${JSON.stringify(record)}\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  chmodSync(join(bin, 'caffeinate'), 0o755);
  const env = { PATH: `${bin}${delimiter}${process.env.PATH}`, CLAUDE_CONFIG_DIR: config };

  const show = acc(dir, ['show', 'T-1'], undefined, env).out;
  assert.match(show, /^T-1 {2}! Needs you {2}Ticket updates are drafts\n/);
  assert.match(show, /! Its agent stopped: API Error: Your computer went to sleep mid-response\. The response above may be incomplete\. Resume it with acc resume T-1\./);
  assert.deepEqual(acc(dir, ['show', 'T-1', '--json'], undefined, env).json().stopped, { said: 'API Error: Your computer went to sleep mid-response. The response above may be incomplete.' });

  for (const role of ['builder', 'reviewer', 'analyst']) {
    const refused = acc(dir, ['resume', 'T-1'], undefined, { ...env, ACC_ROLE: role, ACC_TASK: 'T-1' });
    assert.equal(refused.code, 1, role);
    assert.match(refused.err, /can't resume a builder\. A person does that, or autopilot\./);
  }

  const r = acc(dir, ['resume', 'T-1', '--json'], undefined, env);
  assert.equal(r.code, 0, r.err);
  const out = r.json();
  assert.deepEqual([out.folder, out.sessionId, out.said], [dir, 'sess-9', 'API Error: Your computer went to sleep mid-response. The response above may be incomplete.']);
  // The resumed claude runs detached: wait for it to write down how it was run.
  const until = Date.now() + 10_000;
  const records = () => (existsSync(record) ? readFileSync(record, 'utf8').trim().split('\n').map((x) => JSON.parse(x)) : []);
  while (!records().some((x) => x.cmd === 'claude') && Date.now() < until) spawnSync('sleep', ['0.1']);
  const claude = records().find((x) => x.cmd === 'claude')!;
  assert.deepEqual(claude.args.slice(2, 6), ['--resume', 'sess-9', '--permission-mode', 'acceptEdits']);
  assert.match(claude.args[1], /^You are the builder for T-1: Ticket updates are drafts\./);
  assert.deepEqual([claude.cwd, claude.role, claude.task], [dir, 'builder', 'T-1']);
  if (process.platform === 'darwin') {
    while (!records().some((x) => x.cmd === 'caffeinate') && Date.now() < until) spawnSync('sleep', ['0.1']);
    assert.deepEqual(records().find((x) => x.cmd === 'caffeinate')!.args, ['-i', '-w', String(out.pid)]);
  }
  const t = JSON.parse(readFileSync(file, 'utf8')).tasks[0];
  assert.equal(t.run.resumes.length, 1);
  assert.equal(t.run.resumes[0].actor, 'human');

  // Only a running task's builder is resumed.
  assert.equal(acc(dir, ['block', 'T-1', 'needs a date']).code, 0);
  const blocked = acc(dir, ['resume', 'T-1'], undefined, env);
  assert.equal(blocked.code, 1);
  assert.match(blocked.err, /T-1 is blocked\. Only a running task's builder is resumed\./);
});

test('acc dispatch --again with a claude that is not found (exit 127) is refused in the Command Center\'s words, and stops and records nothing (T-93)', () => {
  const dir = realpathSync(repoWithConfig());
  assert.equal(acc(dir, ['add', 'Ticket updates are drafts']).code, 0);
  const file = join(dir, '.git', 'acc', 'ledger.json');
  const l = JSON.parse(readFileSync(file, 'utf8'));
  l.tasks[0].state = 'running';
  l.tasks[0].run = { bgId: 'bg9', sessionId: 'sess-9', worktree: dir, branch: 'main', startedAt: '2026-10-05T21:52:13.000Z' };
  writeFileSync(file, JSON.stringify(l));
  // A claude that every call says isn't found, and that writes down each call, so a stop would show.
  const bin = tempDir('bin-');
  const record = join(bin, 'calls.txt');
  standIn(join(bin, 'claude'), `#!/bin/sh\necho "$@" >> ${record}\nexit 127\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const r = acc(dir, ['dispatch', 'T-1', '--again'], undefined, { PATH: `${bin}${delimiter}${process.env.PATH}` });
  assert.equal(r.code, 1, r.out);
  assert.match(r.err, new RegExp(String.raw`Claude Code isn't on ${HERE}'s path, so the Command Center can't see this builder`));
  assert.ok(!(existsSync(record) ? readFileSync(record, 'utf8') : '').includes('stop'), 'nothing is stopped');
  const after = JSON.parse(readFileSync(file, 'utf8')).tasks[0];
  assert.deepEqual([after.state, after.run.bgId], ['running', 'bg9']);
});

test('acc agents names acc\'s default model where nobody chose one, apart from Claude Code\'s default effort (D-086)', () => {
  const dir = repoWithConfig();
  const shown = acc(dir, ['agents']);
  assert.equal(shown.code, 0, shown.err);
  assert.equal(shown.out, 'builder   model claude-opus-5-5 (acc\'s default), effort default\nreviewer  model claude-opus-5-5 (acc\'s default), effort default\n');
  const json = acc(dir, ['agents', '--json']).json();
  assert.deepEqual([json.builder.model, json.builder.from.model, json.builder.effort, json.builder.from.effort], ['claude-opus-5-5', 'acc', null, 'default']);
  assert.equal(json.reviewer.from.model, 'acc');
  const chosen = repoWithConfig({ ...GENERIC_CONFIG, agents: { reviewer: { model: 'claude-sonnet-5-5' } } });
  assert.match(acc(chosen, ['agents', 'set', 'builder', '--model', 'haiku']).out, /^builder: model haiku, effort default\. Set for this clone only\./);
  assert.equal(acc(chosen, ['agents']).out, 'builder   model haiku (this clone), effort default\nreviewer  model claude-sonnet-5-5 (project), effort default\n');
  assert.match(acc(chosen, ['agents', 'set', 'builder', '--clear', 'model']).out, /^builder: model claude-opus-5-5 \(acc's default\), effort default\./);
});

test('acc agents autonomy: shows it, and a person sets manual or review in .acc/config.json, changing nothing else (D-064)', () => {
  // Spaced and ordered as a person might keep it: the edit moves nothing else.
  const text = '{\n    "schema": 1,\n    "autonomy":   "manual",\n    "project": "Tool",\n    "profile": "generic",\n    "environments": [ { "name": "main", "default": true } ],\n    "agents": { "max": 2 }\n}\n';
  const dir = makeRepo({ '.acc/config.json': text });
  const file = join(dir, '.acc', 'config.json');
  assert.deepEqual(acc(dir, ['agents', 'autonomy', '--json']).json(), { autonomy: 'manual' });
  assert.match(acc(dir, ['agents', 'autonomy']).out, /^autonomy manual \(project\): nothing happens on its own\./);

  const set = acc(dir, ['agents', 'autonomy', 'review', '--json']);
  assert.equal(set.code, 0, set.err);
  assert.deepEqual(set.json(), { autonomy: 'review' });
  assert.equal(readFileSync(file, 'utf8'), text.replace('"manual"', '"review"'), 'only the value changed');
  assert.match(acc(dir, ['agents', 'autonomy']).out, /^autonomy review \(project\): autopilot reviews finished work, .*, and starts a task a person dispatched once the files it waits for are free\. It never merges a pull request\./);
  assert.match(acc(dir, ['agents', 'autonomy', 'manual']).out, /autonomy manual: nothing happens on its own\. Set in \.acc\/config\.json: commit it to share it\./);
  assert.equal(readFileSync(file, 'utf8'), text);

  for (const level of ['dispatch', 'full']) {
    const r = acc(dir, ['agents', 'autonomy', level]);
    assert.equal(r.code, 1, level);
    assert.match(r.err, new RegExp(`autonomy "${level}" isn't built yet[^]*Choose manual or review`));
  }
  assert.equal(acc(dir, ['agents', 'autonomy', 'bogus']).code, 2);
  for (const role of ['builder', 'reviewer', 'analyst']) {
    const r = acc(dir, ['agents', 'autonomy', 'review'], undefined, { ACC_ROLE: role, ACC_TASK: 'T-1' });
    assert.equal(r.code, 1, role);
    assert.match(r.err, new RegExp(`${role} can't change what autopilot may do`));
  }
  assert.equal(readFileSync(file, 'utf8'), text, 'nothing refused touched the file');

  // A config without the key gets it, and keeps the rest.
  const bare = repoWithConfig();
  assert.equal(acc(bare, ['agents', 'autonomy', 'review']).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(bare, '.acc', 'config.json'), 'utf8')), { ...GENERIC_CONFIG, autonomy: 'review' });
});

test('acc agents auto-merge: shows it, and a person turns it on or off in .acc/config.json, changing nothing else (GH-67)', () => {
  // Spaced and ordered as a person might keep it: the edit moves nothing else.
  const text = '{\n    "schema": 1,\n    "project": "Tool",\n    "profile": "generic",\n    "autonomy": "review",\n    "environments": [ { "name": "main", "default": true }, { "name": "release", "protected": true } ],\n    "autopilot": {\n        "appendOnly": [ "docs/DECISIONS.md" ]\n    }\n}\n';
  const dir = makeRepo({ '.acc/config.json': text });
  const file = join(dir, '.acc', 'config.json');
  assert.deepEqual(acc(dir, ['agents', 'auto-merge', '--json']).json(), { autoMerge: false, environments: [], autonomy: 'review' });
  assert.match(acc(dir, ['agents', 'auto-merge']).out, /^auto-merge off \(project\): autopilot never merges a pull request\. A person merges each one\./);
  assert.match(acc(dir, ['agents', 'autonomy']).out, /It never merges a pull request\.$/m);

  const on = acc(dir, ['agents', 'auto-merge', 'on', '--json']);
  assert.equal(on.code, 0, on.err);
  assert.deepEqual(on.json(), { autoMerge: true, environments: ['main'], autonomy: 'review' }, 'release is protected');
  assert.equal(readFileSync(file, 'utf8'), text.replace('"autopilot": {\n        "appendOnly"', '"autopilot": {\n        "autoMerge": true,\n        "appendOnly"'), 'only the key was added');
  const said = acc(dir, ['agents', 'auto-merge']).out;
  assert.match(said, /^auto-merge on \(project\): a pull request into main whose review and checks passed, with nothing waiting on a person and nothing changed under \.acc\/, joins the repo's merge queue, and they merge in turn: .*Never into release: protected, so a person merges\. It merges while autopilot is on\./);
  // Every word on what autopilot does says it merges now, in turn through the merge queue (GH-73).
  assert.match(acc(dir, ['agents', 'autonomy']).out, /Auto-merge is on: a pull request whose review and checks passed, .*joins the repo's merge queue, .*It never merges into a protected environment\.$/m);
  assert.doesNotMatch(acc(dir, ['agents', 'autonomy']).out, /It never merges a pull request/);

  assert.match(acc(dir, ['agents', 'auto-merge', 'off']).out, /^auto-merge off \(project\): .* Set in \.acc\/config\.json: commit it to share it\./);
  assert.equal(readFileSync(file, 'utf8'), text.replace('"autopilot": {\n        "appendOnly"', '"autopilot": {\n        "autoMerge": false,\n        "appendOnly"'), 'the value changed in place');
  assert.equal(acc(dir, ['agents', 'auto-merge', 'on']).code, 0);
  assert.equal(acc(dir, ['agents', 'auto-merge', 'maybe']).code, 2);
  const before = readFileSync(file, 'utf8');
  for (const role of ['builder', 'reviewer', 'analyst']) {
    const r = acc(dir, ['agents', 'auto-merge', 'off'], undefined, { ACC_ROLE: role, ACC_TASK: 'T-1' });
    assert.equal(r.code, 1, role);
    assert.match(r.err, new RegExp(`${role} can't change whether autopilot merges`));
  }
  assert.equal(readFileSync(file, 'utf8'), before, 'nothing refused touched the file');

  // A config with no autopilot block gets one at its end, and keeps the rest.
  const bare = repoWithConfig();
  assert.equal(acc(bare, ['agents', 'auto-merge', 'off']).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(bare, '.acc', 'config.json'), 'utf8')), GENERIC_CONFIG, 'off with nothing written: nothing to change');
  assert.equal(acc(bare, ['agents', 'auto-merge', 'on']).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(bare, '.acc', 'config.json'), 'utf8')), { ...GENERIC_CONFIG, autopilot: { autoMerge: true } });
  assert.match(acc(bare, ['agents', 'auto-merge']).out, /autonomy is "manual", so autopilot doesn't run and nothing merges on its own\./);

  // A Salesforce project merges into its development environment on its own by default (T-157): on with
  // nothing written changes nothing, off writes false, and the words name the development org and what's never merged into.
  const sfRaw = { ...GENERIC_CONFIG, profile: 'salesforce', autonomy: 'review', environments: [{ name: 'Dev', type: 'developer', org: 'Acme Dev', default: true, promotesTo: ['qa'] }, { name: 'QA', type: 'partial', org: 'Acme QA', promotesTo: ['production'] }, { name: 'Production', type: 'production', org: 'Acme Prod' }] };
  const sf = makeRepo({ '.acc/config.json': JSON.stringify(sfRaw) });
  const shown = acc(sf, ['agents', 'auto-merge']);
  assert.match(shown.out, /^auto-merge on \(project\): a task into dev whose review passed, whose own deploy to Acme Dev passed on the commit the review read, .* Never into qa, production: only the development environment, and never a deploy past its org\. It merges while autopilot is on\.$/m);
  assert.deepEqual(JSON.parse(acc(sf, ['agents', 'auto-merge', '--json']).out), { autoMerge: true, environments: ['dev'], autonomy: 'review' });
  assert.equal(acc(sf, ['agents', 'auto-merge', 'on']).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(sf, '.acc', 'config.json'), 'utf8')), sfRaw, 'on is the default: nothing to write');
  assert.equal(acc(sf, ['agents', 'auto-merge', 'off']).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(sf, '.acc', 'config.json'), 'utf8')), { ...sfRaw, autopilot: { autoMerge: false } }, 'off is written');
  assert.match(acc(sf, ['agents', 'auto-merge']).out, /^auto-merge off \(project\): a person merges every pull request\. On, a reviewed task merges into the development environment/);
  assert.deepEqual(JSON.parse(acc(sf, ['agents', 'auto-merge', '--json']).out).environments, []);
});

test('acc machine heavy-slots shows and sets how many heavy checks this machine runs; a builder can\'t change it (D-080)', () => {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  const file = join(tempDir('acc-machine-'), 'machine.json');
  const env = { ACC_MACHINE_FILE: file, ACC_HEAVY_SLOTS: '' };
  assert.match(acc(dir, ['machine', 'heavy-slots'], undefined, env).out, /^1 heavy check at once on this machine\./);
  const set = acc(dir, ['machine', 'heavy-slots', '2', '--json'], undefined, env);
  assert.equal(set.code, 0, set.err);
  assert.deepEqual(set.json(), { heavySlots: 2 });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { heavySlots: 2 });
  assert.match(acc(dir, ['machine', 'heavy-slots'], undefined, env).out, /^2 heavy checks at once/);
  assert.equal(acc(dir, ['machine', 'heavy-slots', '12'], undefined, env).code, 2, 'out of range');
  assert.notEqual(acc(dir, ['machine', 'heavy-slots', '4'], undefined, { ...env, ACC_ROLE: 'builder', ACC_TASK: 'T-1' }).code, 0, 'a builder can\'t');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { heavySlots: 2 }, 'unchanged');
});

test('acc agents max shows the project\'s builder cap and how many run, and a person sets it, changing only that key (GH-111)', () => {
  const dir = makeRepo({ '.acc/config.json': LIMITS_CONFIG });
  const file = join(dir, '.acc', 'config.json');
  assert.equal(acc(dir, ['add', 'One']).code, 0);
  assert.deepEqual(acc(dir, ['agents', 'max', '--json']).json(), { max: 3, from: 'project', running: 0 });
  assert.equal(acc(dir, ['agents', 'max']).out, 'This project runs at most 3 builders at once (agents.max, .acc/config.json). 0 builders running now.\n');
  const set = acc(dir, ['agents', 'max', '5']);
  assert.equal(set.code, 0, set.err);
  assert.equal(set.out, 'This project now runs at most 5 builders at once (agents.max, .acc/config.json). 0 builders running now. Set in .acc/config.json: commit it to share it.\n');
  assert.equal(readFileSync(file, 'utf8'), LIMITS_CONFIG.replace('"max": 3', '"max": 5'), 'byte for byte, but the value');
  for (const bad of ['0', '17', 'two', '2.5']) assert.equal(acc(dir, ['agents', 'max', bad]).code, 2, bad);
  assert.equal(readFileSync(file, 'utf8'), LIMITS_CONFIG.replace('"max": 3', '"max": 5'));
  // A config that names no cap says it's acc's, and gets the key.
  const bare = repoWithConfig();
  assert.match(acc(bare, ['agents', 'max']).out, /^This project runs at most 3 builders at once \(agents\.max, acc's default: \.acc\/config\.json sets none\)\./);
  assert.equal(acc(bare, ['agents', 'max', '2']).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(bare, '.acc', 'config.json'), 'utf8')), { ...GENERIC_CONFIG, agents: { max: 2 } });
});

test('acc machine agents shows this machine\'s total across every repo and how many run, and a person sets it or takes it out (GH-111)', () => {
  const file = join(tempDir('acc-machine-'), 'machine.json');
  writeFileSync(file, JSON.stringify({ heavySlots: 2 }));
  const env = { ACC_MACHINE_FILE: file };
  const other = repoWithConfig({ ...GENERIC_CONFIG, project: 'Other' });
  assert.equal(acc(other, ['add', 'Busy']).code, 0);
  mutate(repoPaths(other, run), () => new Date(), (l, emit) => { l.tasks[0]!.state = 'running'; emit({ type: 'task.updated', task: l.tasks[0]!.id, actor: 'human', by: 'test', data: {} }); });
  registerLedger(repoPaths(other, run).ledger, 'Other', env);
  const dir = repoWithConfig();
  assert.equal(acc(dir, ['machine', 'agents'], undefined, env).out, 'No total on this machine: each project\'s cap (agents.max) is the only limit. 1 builder running now in Other.\n');
  const set = acc(dir, ['machine', 'agents', '6', '--json'], undefined, env);
  assert.equal(set.code, 0, set.err);
  assert.deepEqual([set.json().agents, set.json().running], [6, 1]);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { heavySlots: 2, agents: 6 }, 'beside the heavy-check slots, which stay');
  assert.match(acc(dir, ['machine', 'agents'], undefined, env).out, /^This machine runs at most 6 builders at once, across every repo on it\. 1 builder running now in Other\.$/m);
  assert.equal(acc(dir, ['machine', 'agents', '65'], undefined, env).code, 2, 'out of range');
  assert.equal(acc(dir, ['machine', 'agents', '4', '--none'], undefined, env).code, 2, 'not both');
  assert.match(acc(dir, ['machine', 'agents', '--none'], undefined, env).out, /^This machine has no total now: each project's cap \(agents\.max\) is the only limit\. .* Set in /);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { heavySlots: 2 });
});

test('limits and checks are a person\'s at all three layers: the CLI, the hook and the builder\'s deny list, for every command that sets one (GH-111)', () => {
  const dir = makeRepo({ '.acc/config.json': LIMITS_CONFIG });
  const file = join(dir, '.acc', 'config.json');
  const machine = join(tempDir('acc-machine-'), 'machine.json');
  writeFileSync(machine, '{}\n');
  const env = { ACC_MACHINE_FILE: machine };
  const deny = (builderSettings({ id: 'T-1' } as never, parseConfig(JSON.parse(LIMITS_CONFIG)).config!, '/acc/bin', '/usr/bin') as { permissions: { deny: string[] } }).permissions.deny;
  // Claude Code's Bash(prefix*) rule: the command starts with what's before the star.
  const denied = (line: string) => deny.some((d) => { const p = /^Bash\((.*)\)$/.exec(d)?.[1] ?? ''; return p.endsWith('*') ? line.startsWith(p.slice(0, -1)) : line === p; });
  const commands = [
    ['agents', 'max', '9'], ['agents', 'set', 'builder', '--model', 'sonnet', '--project'],
    ['gate', 'required', 'typecheck'], ['gate', 'builder', 'typecheck'], ['gate', 'builder', '--none'],
    ['machine', 'agents', '2'], ['machine', 'agents', '--none'], ['machine', 'heavy-slots', '3'],
  ];
  // The CLI refuses through one check, noAgent, so each command is run once, by each role in turn: every role
  // meets two commands, and each acc started costs a second of the suite's time.
  const callers = ['builder', 'reviewer', 'analyst', 'autopilot'] as const;
  const met = new Map<string, number>();
  for (const [i, args] of commands.entries()) {
    const line = `acc ${args.join(' ')}`;
    const role = callers[i % callers.length]!;
    met.set(role, (met.get(role) ?? 0) + 1);
    if (role === 'autopilot') {
      const autopilot = acc(dir, [...args, '--as', 'orchestrator'], undefined, env);
      assert.equal(autopilot.code, 1, `autopilot: ${line}`);
      assert.match(autopilot.err, /Only a person can/);
    } else {
      const r = acc(dir, args, undefined, { ...env, ACC_ROLE: role, ACC_TASK: 'T-1' });
      assert.equal(r.code, 1, `${role}: ${line}`);
      assert.match(r.err, new RegExp(`An? ${role} can't .*A person does that\\.`), `${role}: ${line}`);
    }
    assert.match(guardBash({ task: { id: 'T-1', run: {} } } as never, line) ?? '', /is a person's/, `the hook: ${line}`);
    assert.match(guardBash({ task: { id: 'T-1', run: {} } } as never, `cd x && nice -n 15 ${line}`) ?? '', /is a person's/, `the hook, chained: ${line}`);
    assert.ok(guardAnalyst(line), `the analyst's hook: ${line}`);
    assert.ok(denied(line), `the builder's deny list: ${line}`);
  }
  assert.deepEqual([...met.entries()].sort(), [['analyst', 2], ['autopilot', 2], ['builder', 2], ['reviewer', 2]], 'every role, each on two commands');
  // An analyst is the one role a person-only check misses and noAgent catches: it meets every command.
  for (const [i, args] of commands.entries()) {
    if (callers[i % callers.length] === 'analyst') continue;
    const r = acc(dir, args, undefined, { ...env, ACC_ROLE: 'analyst', ACC_TASK: 'T-1' });
    assert.equal(r.code, 1, `analyst: acc ${args.join(' ')}`);
    assert.match(r.err, /An analyst can't .*A person does that\./, `analyst: acc ${args.join(' ')}`);
  }
  assert.equal(readFileSync(file, 'utf8'), LIMITS_CONFIG, 'nothing refused touched the project');
  assert.equal(readFileSync(machine, 'utf8'), '{}\n', 'nor the machine');
  // What a builder may run is still allowed: its checks, and seeing them.
  for (const line of ['acc gate run', 'acc gate list', 'acc gate run typecheck']) {
    assert.equal(guardBash({ task: { id: 'T-1', run: {} } } as never, line), null, line);
    assert.ok(!denied(line), line);
  }
});

test('acc agents set --project is a switch, as the Command Center sends it last, and writes .acc/config.json (D-036)', () => {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  const r = acc(dir, ['agents', 'set', 'builder', '--model', 'claude-opus-5-5', '--project']);
  assert.equal(r.code, 0, r.err);
  assert.equal(JSON.parse(readFileSync(join(dir, '.acc', 'config.json'), 'utf8')).agents.builder.model, 'claude-opus-5-5');
  assert.match(r.out, /Set in \.acc\/config\.json/);
});
