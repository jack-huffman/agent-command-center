// Settings' Change… on an agent's row (T-163): the model and effort, the fallback model, or back to the default,
// for this clone only or the project's settings. The arguments are checked, then run through acc itself.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { agentsChangeArgs } from '../src/logic/agents-change.ts';
import { GENERIC_CONFIG } from '../../packages/core/test/support.ts';
import { cli, repoWithConfig } from '../../packages/cli/test/support.ts';

const acc = cli(fileURLToPath(new URL('../../packages/cli/src/main.ts', import.meta.url)));
const none = { model: null, effort: null, fallback: null };

test('the project\'s model and effort go through acc agents model, and a choice set back to the default is written as default', () => {
  assert.deepEqual(agentsChangeArgs('planner', 'model', { ...none, model: 'claude-sonnet-5-5', effort: 'low' }, true), ['agents', 'model', 'planner', 'claude-sonnet-5-5', '--effort', 'low']);
  assert.deepEqual(agentsChangeArgs('reviewer', 'model', none, true), ['agents', 'model', 'reviewer', 'default', '--effort', 'default']);
});

test('edge case: this clone only, a fallback model, and back to the default go through acc agents set, with --clear for a value set back', () => {
  assert.deepEqual(agentsChangeArgs('builder', 'model', { ...none, model: 'haiku' }, false), ['agents', 'set', 'builder', '--model', 'haiku', '--clear', 'effort']);
  assert.deepEqual(agentsChangeArgs('planner', 'fallback', { ...none, fallback: 'claude-sonnet-5-5' }, true), ['agents', 'set', 'planner', '--fallback-model', 'claude-sonnet-5-5', '--project']);
  assert.deepEqual(agentsChangeArgs('planner', 'fallback', none, false), ['agents', 'set', 'planner', '--clear', 'fallback-model']);
  assert.deepEqual(agentsChangeArgs('reviewer', 'reset', { model: 'x', effort: 'high', fallback: 'y' }, false), ['agents', 'set', 'reviewer', '--clear', 'model', '--clear', 'effort', '--clear', 'fallback-model'], 'reset ignores what was picked');
});

test('each change Change… makes is one acc takes: the clone\'s, the fallback and the reset reach what acc agents shows', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, agents: { planner: { model: 'claude-opus-5-5', effort: 'high' } } });
  const file = join(dir, '.acc', 'config.json');
  let ran = 0;
  const go = (args: string[]) => { const r = acc(dir, args); ran++; assert.equal(r.code, 0, `${args.join(' ')}: ${r.err}`); };
  go(agentsChangeArgs('planner', 'model', { ...none, model: 'haiku', effort: 'low' }, false));
  assert.match(acc(dir, ['agents']).out, /^planner {3}model haiku \(this clone\), effort low \(this clone\)/m);
  go(agentsChangeArgs('planner', 'fallback', { ...none, fallback: 'claude-sonnet-5-5' }, true));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).agents.planner.fallbackModel, 'claude-sonnet-5-5');
  go(agentsChangeArgs('planner', 'reset', none, false));
  assert.match(acc(dir, ['agents']).out, /^planner {3}model claude-opus-5-5 \(project\), effort high \(project\)/m, 'the clone\'s settings are gone, so the project\'s apply');
  go(agentsChangeArgs('planner', 'reset', none, true));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).agents.planner, undefined, 'and the project\'s, so acc\'s default applies');
  go(agentsChangeArgs('planner', 'model', { ...none, model: 'claude-sonnet-5-5' }, true));
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).agents.planner, { model: 'claude-sonnet-5-5' });
  assert.equal(ran, 5, 'every change ran');
});
