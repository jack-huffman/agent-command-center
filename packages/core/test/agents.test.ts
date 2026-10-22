import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { agentArgs, cloneProfile, modelOf, profileView, setProfile, withCloneAgents } from '../src/agents.ts';
import { DEFAULT_MODEL, loadConfig, parseConfig, writeConfig } from '../src/config.ts';
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
  for (const role of ['builder', 'reviewer'] as const) {
    const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
    const file = join(dir, '.acc/config.json');
    let v = profileView(loadConfig(file).config, run, dir, role);
    assert.deepEqual([v.model, v.from.model, v.effort, v.from.effort, v.fallbackModel, v.from.fallbackModel], ['claude-opus-5-5', 'acc', null, 'default', null, 'default'], `${role}: acc's model, Claude Code's effort`);
    assert.deepEqual(agentArgs(withCloneAgents(loadConfig(file).config, dir, run).agents[role]), ['--model', 'claude-opus-5-5']);
    setProfile(run, dir, file, role, { model: 'claude-sonnet-5-5' }, 'project');
    v = profileView(loadConfig(file).config, run, dir, role);
    assert.deepEqual([v.model, v.from.model], ['claude-sonnet-5-5', 'project'], `${role}: the project's`);
    assert.deepEqual(agentArgs(withCloneAgents(loadConfig(file).config, dir, run).agents[role]), ['--model', 'claude-sonnet-5-5']);
    setProfile(run, dir, file, role, { model: 'haiku' }, 'clone');
    v = profileView(loadConfig(file).config, run, dir, role);
    assert.deepEqual([v.model, v.from.model], ['haiku', 'clone'], `${role}: the clone's`);
    assert.deepEqual(agentArgs(withCloneAgents(loadConfig(file).config, dir, run).agents[role]), ['--model', 'haiku']);
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
