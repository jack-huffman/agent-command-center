// Where a ticket may still go (T-156): every environment along promotesTo after where it is, the usual way
// first; never where it is, its own development environment, or the project's default one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Environment, parseConfig } from '../src/config.ts';
import { aheadWords, environmentsAhead } from '../src/ticket-path.ts';
import { SF_CONFIG } from './support.ts';

const env = (name: string, branch: string, promotesTo: string[], over: Partial<Environment> = {}): Environment => ({ name, branch, type: 'full', org: null, default: false, protected: false, promotesTo, ...over });
const names = (xs: Environment[]) => xs.map((e) => e.branch);

test('every environment ahead on the path is a choice, not only the next step, the usual way first', () => {
  const c = parseConfig(SF_CONFIG).config!;
  const [production, uat, dev] = c.environments;
  assert.deepEqual(names(environmentsAhead(c, dev!, ['dev'])), ['uat', 'production'], 'dev promotes to both');
  assert.deepEqual(names(environmentsAhead(c, uat!, ['dev'])), ['production']);
  assert.deepEqual(names(environmentsAhead(c, production!, ['dev'])), [], 'the end of the path');
  // A chain, where production is two steps away: still a choice.
  const chain = { environments: [env('Production', 'production', [], { type: 'production' }), env('UAT', 'uat', ['production']), env('Dev', 'dev', ['uat'], { default: true })] };
  assert.deepEqual(names(environmentsAhead(chain, chain.environments[2]!, ['dev'])), ['uat', 'production']);
  assert.equal(aheadWords(environmentsAhead(chain, chain.environments[2]!)), 'UAT, Production');
  assert.equal(aheadWords([]), 'nowhere');
});

test('edge case: a path that loops back, a branch the settings don\'t have, and the development environment are never a choice', () => {
  const loop = { environments: [env('Production', 'production', ['uat', 'dev'], { type: 'production' }), env('UAT', 'uat', ['production', 'gone']), env('Dev', 'dev', ['uat'], { default: true }), env('Build', 'build', ['uat'])] };
  const [, uat, , build] = loop.environments;
  assert.deepEqual(names(environmentsAhead(loop, uat!, ['build'])), ['production'], 'production loops to uat (where it is) and dev (the default): neither is ahead, and gone isn\'t in the settings');
  assert.deepEqual(names(environmentsAhead(loop, build!, ['build'])), ['uat', 'production'], 'a ticket from a second development environment: its own is never a choice, even when the path leads back');
  assert.deepEqual(names(environmentsAhead(loop, uat!)), ['production'], 'with nothing named as never, the default environment is still left out');
});
