import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { agentArgs, AGENTS_MODEL_COMMAND, agentsModelEnabled, cloneProfile, modelOf, profileView, roleArgs, setProfile, withCloneAgents, withRoleDefaults } from '../src/agents.ts';
import { DEFAULT_MODEL, loadConfig, parseConfig, ROLE_DEFAULTS, writeConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { GENERIC_CONFIG, makeRepo, tempDir } from './support.ts';

test('the config takes a model, effort and fallback for builders and reviewers, and says what\'s wrong with a bad one', () => {
  const ok = parseConfig({ ...GENERIC_CONFIG, agents: { builder: { model: 'opus', effort: 'high', fallbackModel: 'sonnet' }, reviewer: { model: 'claude-sonnet-5-5' } } });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.config!.agents.builder, { model: 'opus', effort: 'high', fallbackModel: 'sonnet' });
  assert.deepEqual(ok.config!.agents.reviewer, { model: 'claude-sonnet-5-5', effort: null, fallbackModel: null });
  assert.deepEqual(parseConfig(GENERIC_CONFIG).config!.agents.builder, { model: null, effort: null, fallbackModel: null }, 'unset: the Command Center\'s default model, Claude Code\'s effort');
  const bad = parseConfig({ ...GENERIC_CONFIG, agents: { builder: { model: 'two words', effort: 'extreme' }, reviewer: 'sonnet' } });
  assert.match(bad.errors.join(' '), /agents\.builder\.model" must be a model alias/);
  assert.match(bad.errors.join(' '), /agents\.builder\.effort" must be one of low, medium, high, xhigh, max/);
  assert.match(bad.errors.join(' '), /agents\.reviewer" must be an object/);
});

test('a profile becomes Claude Code\'s flags, with the Command Center\'s default model when it names none (D-086)', () => {
  assert.equal(DEFAULT_MODEL, 'claude-opus-5-5');
  assert.deepEqual(agentArgs({ model: 'sonnet', effort: 'low', fallbackModel: 'haiku' }), ['--model', 'sonnet', '--effort', 'low', '--fallback-model', 'haiku']);
  assert.deepEqual(agentArgs({ model: null, effort: 'max', fallbackModel: null }), ['--model', 'claude-opus-5-5', '--effort', 'max']);
  assert.deepEqual(agentArgs({ model: null, effort: null, fallbackModel: null }), ['--model', 'claude-opus-5-5'], 'effort and fallback stay Claude Code\'s');
  assert.deepEqual(agentArgs(undefined), ['--model', 'claude-opus-5-5']);
  assert.deepEqual(agentArgs({ model: 'sonnet', effort: null, fallbackModel: 'sonnet' }), ['--model', 'sonnet'], 'Claude Code won\'t start with a fallback the same as its model');
  assert.deepEqual(agentArgs({ model: null, effort: null, fallbackModel: 'claude-opus-5-5' }), ['--model', 'claude-opus-5-5'], 'nor with the Command Center\'s default as its fallback');
  assert.equal(modelOf(undefined), 'claude-opus-5-5');
  assert.equal(modelOf({ model: 'fable' }), 'fable');
});

test('with nothing set, each role runs the Command Center\'s default model; the project\'s wins over it, and the clone\'s over both (D-086)', () => {
  for (const role of ['builder', 'planner', 'reviewer'] as const) {
    const wantEffort = ROLE_DEFAULTS[role].effort;
    const effortArgs = wantEffort ? ['--effort', wantEffort] : [];
    const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
    const file = join(dir, '.acc/config.json');
    let v = profileView(loadConfig(file).config, run, dir, role);
    assert.deepEqual([v.model, v.from.model, v.effort, v.from.effort, v.fallbackModel, v.from.fallbackModel], ['claude-opus-5-5', 'acc', wantEffort, wantEffort ? 'acc' : 'default', null, 'default'], `${role}: acc's default for the role`);
    assert.deepEqual(roleArgs(withCloneAgents(loadConfig(file).config, dir, run), role), ['--model', 'claude-opus-5-5', ...effortArgs]);
    setProfile(run, dir, file, role, { model: 'claude-sonnet-5-5' }, 'project');
    v = profileView(loadConfig(file).config, run, dir, role);
    assert.deepEqual([v.model, v.from.model, v.effort], ['claude-sonnet-5-5', 'project', null], `${role}: the project's model, and no default effort for a model it chose`);
    assert.deepEqual(roleArgs(withCloneAgents(loadConfig(file).config, dir, run), role), ['--model', 'claude-sonnet-5-5']);
    setProfile(run, dir, file, role, { model: 'haiku' }, 'clone');
    v = profileView(loadConfig(file).config, run, dir, role);
    assert.deepEqual([v.model, v.from.model], ['haiku', 'clone'], `${role}: the clone's`);
    assert.deepEqual(roleArgs(withCloneAgents(loadConfig(file).config, dir, run), role), ['--model', 'haiku']);
  }
});

test('a clone\'s own choice wins over the project\'s, part by part, and says where each part comes from', () => {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, agents: { reviewer: { model: 'opus', effort: 'high' } } }) });
  const file = join(dir, '.acc/config.json');
  const config = loadConfig(file).config;
  setProfile(run, dir, file, 'reviewer', { model: 'sonnet' }, 'clone');
  assert.deepEqual(cloneProfile(run, dir, 'reviewer'), { model: 'sonnet' });
  const v = profileView(config, run, dir, 'reviewer');
  assert.deepEqual([v.model, v.from.model, v.effort, v.from.effort, v.from.fallbackModel], ['sonnet', 'clone', 'high', 'project', 'default']);
  assert.deepEqual(withCloneAgents(config, dir, run).agents.reviewer, { model: 'sonnet', effort: 'high', fallbackModel: null });
  setProfile(run, dir, file, 'reviewer', { model: null }, 'clone');
  setProfile(run, dir, file, 'reviewer', { model: null }, 'clone');
  assert.equal(profileView(config, run, dir, 'reviewer').from.model, 'project', 'clearing goes back to the project\'s, and clearing twice is fine');
  assert.throws(() => setProfile(run, dir, file, 'builder', { effort: 'huge' as never }, 'clone'), /Effort is one of/);
});

test('the project\'s default is changed in .acc/config.json alone, leaving the rest of the file as it was', () => {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, agents: { max: 2 }, autonomy: 'manual' }, null, 2) + '\n' });
  const file = join(dir, '.acc/config.json');
  setProfile(run, dir, file, 'builder', { model: 'opus', effort: 'xhigh' }, 'project');
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual(raw.agents, { max: 2, builder: { model: 'opus', effort: 'xhigh' } });
  assert.equal(raw.autonomy, 'manual');
  assert.ok(!('trackers' in raw), 'no defaults written into the file');
  setProfile(run, dir, file, 'builder', { model: null, effort: null }, 'project');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).agents, { max: 2 }, 'an empty profile is removed');
  assert.equal(run('git', ['config', '--get', 'acc.builder.model'], { cwd: dir }).code, 1, 'and git config is untouched');
});

test('writing a config leaves out profiles with nothing chosen', () => {
  const file = join(tempDir(), 'config.json');
  writeConfig(file, parseConfig(GENERIC_CONFIG).config!);
  assert.ok(!('builder' in JSON.parse(readFileSync(file, 'utf8')).agents));
  writeConfig(file, parseConfig({ ...GENERIC_CONFIG, agents: { reviewer: { effort: 'low' } } }).config!);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).agents.reviewer, { effort: 'low' });
  writeFileSync(file, '');
});

test('the config takes a model, effort and fallback for the planning agent, and says what\'s wrong with a bad one (T-163)', () => {
  const ok = parseConfig({ ...GENERIC_CONFIG, agents: { planner: { model: 'sonnet', effort: 'low', fallbackModel: 'haiku' } } });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.config!.agents.planner, { model: 'sonnet', effort: 'low', fallbackModel: 'haiku' });
  assert.deepEqual(parseConfig(GENERIC_CONFIG).config!.agents.planner, { model: null, effort: null, fallbackModel: null }, 'edge case: nothing set is acc\'s default, never a value in the file');
  const bad = parseConfig({ ...GENERIC_CONFIG, agents: { planner: { model: 'two words', effort: 'extreme' } } });
  assert.match(bad.errors.join(' '), /agents\.planner\.model" must be a model alias/);
  assert.match(bad.errors.join(' '), /agents\.planner\.effort" must be one of low, medium, high, xhigh, max/);
  assert.match(parseConfig({ ...GENERIC_CONFIG, agents: { planner: 'sonnet' } }).errors.join(' '), /agents\.planner" must be an object/);
  const file = join(tempDir(), 'config.json');
  writeConfig(file, ok.config!);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).agents.planner, { model: 'sonnet', effort: 'low', fallbackModel: 'haiku' }, 'written, and read again');
});

test('the defaults for each role sit in one table: Opus 5.5 for all three, medium effort for planning and review, none for a builder (T-163, D-135)', () => {
  assert.deepEqual(ROLE_DEFAULTS, {
    builder: { model: 'claude-opus-5-5', effort: null },
    planner: { model: 'claude-opus-5-5', effort: 'medium' },
    reviewer: { model: 'claude-opus-5-5', effort: 'medium' },
  });
  // The profile with acc's default in place: a profile of nothing, and none at all, take the row.
  assert.deepEqual(withRoleDefaults('planner', undefined), { model: 'claude-opus-5-5', effort: 'medium', fallbackModel: null });
  assert.deepEqual(withRoleDefaults('builder', { model: null, effort: null, fallbackModel: 'sonnet' }), { model: 'claude-opus-5-5', effort: null, fallbackModel: 'sonnet' });
  assert.deepEqual(withRoleDefaults('reviewer', { model: 'sonnet', effort: null, fallbackModel: null }), { model: 'sonnet', effort: null, fallbackModel: null }, 'a model it chose takes no default effort');
  const none = parseConfig(GENERIC_CONFIG).config!;
  assert.deepEqual(roleArgs(none, 'builder'), ['--model', 'claude-opus-5-5'], 'a builder\'s effort stays Claude Code\'s');
  assert.deepEqual(roleArgs(none, 'planner'), ['--model', 'claude-opus-5-5', '--effort', 'medium'], 'never Claude Code\'s own model');
  assert.deepEqual(roleArgs(none, 'reviewer'), ['--model', 'claude-opus-5-5', '--effort', 'medium']);
  // Edge case: a project that names a model but no effort gets no default effort, which the model might not take.
  const named = parseConfig({ ...GENERIC_CONFIG, agents: { planner: { model: 'claude-haiku-4-5' } } }).config!;
  assert.deepEqual(roleArgs(named, 'planner'), ['--model', 'claude-haiku-4-5']);
  // And one that names an effort alone keeps acc's default model.
  const effortOnly = parseConfig({ ...GENERIC_CONFIG, agents: { planner: { effort: 'high' } } }).config!;
  assert.deepEqual(roleArgs(effortOnly, 'planner'), ['--model', 'claude-opus-5-5', '--effort', 'high']);
});

test('the planning agent runs with the planner\'s settings and the reviewer with the reviewer\'s, each from its own profile (T-163)', () => {
  const config = parseConfig({ ...GENERIC_CONFIG, agents: { planner: { model: 'claude-sonnet-5-5', effort: 'low' }, reviewer: { model: 'claude-haiku-5-5', effort: 'high' } } }).config!;
  assert.deepEqual(roleArgs(config, 'planner'), ['--model', 'claude-sonnet-5-5', '--effort', 'low']);
  assert.deepEqual(roleArgs(config, 'reviewer'), ['--model', 'claude-haiku-5-5', '--effort', 'high']);
  // A planner with settings of its own is not run with the reviewer's, nor the reverse.
  assert.notDeepEqual(roleArgs(config, 'planner'), roleArgs(config, 'reviewer'));
  // The modules that run an agent ask for their own role: planning for the analysis, the plan conversation (opening and talk)
  // and drafted criteria; reviewing for review and verify. A planner swapped for the reviewer's fails here.
  const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
  for (const f of ['analyze.ts', 'plan-opening.ts', 'plan-talk.ts', 'criteria.ts']) {
    assert.ok(src(f).includes("roleArgs(config, 'planner')"), `${f} runs with the planner's`);
    assert.ok(!src(f).includes("roleArgs(config, 'reviewer')") && !src(f).includes('config.agents.reviewer'), `${f} never the reviewer's`);
  }
  for (const f of ['review.ts', 'verify.ts']) {
    assert.ok(src(f).includes("roleArgs(config, 'reviewer')") && !src(f).includes("roleArgs(config, 'planner')"), `${f} runs with the reviewer's`);
  }
});

test('a clone\'s own planning settings win over the project\'s, which win over acc\'s default, and each says where it comes from (T-163)', () => {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, agents: { planner: { model: 'claude-sonnet-5-5' } } }) });
  const file = join(dir, '.acc/config.json');
  const config = loadConfig(file).config;
  assert.deepEqual(profileView(config, run, dir, 'planner').from, { model: 'project', effort: 'default', fallbackModel: 'default' });
  setProfile(run, dir, file, 'planner', { model: 'claude-haiku-5-5', effort: 'low' }, 'clone');
  assert.deepEqual(roleArgs(withCloneAgents(config, dir, run), 'planner'), ['--model', 'claude-haiku-5-5', '--effort', 'low']);
  assert.deepEqual(roleArgs(withCloneAgents(config, dir, run), 'reviewer'), ['--model', 'claude-opus-5-5', '--effort', 'medium'], 'the reviewer is not the planner\'s');
});

test('AGENTS_MODEL_COMMAND has an id and params, is enabled for a person, and refuses a builder, reviewer or analyst with the reason (T-163)', () => {
  assert.equal(AGENTS_MODEL_COMMAND.id, 'acc.agents.model');
  assert.match(AGENTS_MODEL_COMMAND.params, /planner/);
  assert.deepEqual(AGENTS_MODEL_COMMAND.enabled({}), { ok: true });
  assert.deepEqual(agentsModelEnabled({ agentRole: 'builder' }), AGENTS_MODEL_COMMAND.enabled({ agentRole: 'builder' }));
  for (const [role, article] of [['builder', 'A'], ['reviewer', 'A'], ['analyst', 'An']] as const) {
    assert.deepEqual(AGENTS_MODEL_COMMAND.enabled({ agentRole: role }), { ok: false, why: `${article} ${role} can't change what agents run with. A person does that.` });
  }
});
