import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { agentArgs, cloneProfile, profileView, setProfile, withCloneAgents } from '../src/agents.ts';
import { loadConfig, parseConfig, writeConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { GENERIC_CONFIG, makeRepo, tempDir } from './support.ts';

test('the config takes a model, effort and fallback for builders and reviewers, and says what\'s wrong with a bad one', () => {
  const ok = parseConfig({ ...GENERIC_CONFIG, agents: { builder: { model: 'opus', effort: 'high', fallbackModel: 'sonnet' }, reviewer: { model: 'claude-sonnet-5-5' } } });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.config!.agents.builder, { model: 'opus', effort: 'high', fallbackModel: 'sonnet' });
  assert.deepEqual(ok.config!.agents.reviewer, { model: 'claude-sonnet-5-5', effort: null, fallbackModel: null });
  assert.deepEqual(parseConfig(GENERIC_CONFIG).config!.agents.builder, { model: null, effort: null, fallbackModel: null }, 'unset is Claude Code\'s default');
  const bad = parseConfig({ ...GENERIC_CONFIG, agents: { builder: { model: 'two words', effort: 'extreme' }, reviewer: 'sonnet' } });
  assert.match(bad.errors.join(' '), /agents\.builder\.model" must be a model alias/);
  assert.match(bad.errors.join(' '), /agents\.builder\.effort" must be one of low, medium, high, xhigh, max/);
  assert.match(bad.errors.join(' '), /agents\.reviewer" must be an object/);
});

test('a profile becomes Claude Code\'s flags, and nothing at all when it\'s unset', () => {
  assert.deepEqual(agentArgs({ model: 'sonnet', effort: 'low', fallbackModel: 'haiku' }), ['--model', 'sonnet', '--effort', 'low', '--fallback-model', 'haiku']);
  assert.deepEqual(agentArgs({ model: null, effort: 'max', fallbackModel: null }), ['--effort', 'max']);
  assert.deepEqual(agentArgs({ model: null, effort: null, fallbackModel: null }), []);
  assert.deepEqual(agentArgs(undefined), []);
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
