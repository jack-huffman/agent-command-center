// The helpers several core files shared (T-15): one input from each old call site.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunResult } from '../src/exec.ts';
import { firstLine, isObj, sentence } from '../src/text.ts';

const ran = (stdout: string, stderr = '', code = 0): RunResult => ({ stdout, stderr, code }) as RunResult;

test('isObj takes a plain object and refuses null, an array and a scalar (config, template, ratchets)', () => {
  assert.equal(isObj({ repo: 'a/b' }), true, 'config: a gates block');
  assert.equal(isObj({}), true, 'template: an empty object is still an object');
  assert.equal(isObj({ command: 'x' }), true, 'ratchets: a ratchet spec');
  assert.equal(isObj(null), false);
  assert.equal(isObj(['a']), false);
  assert.equal(isObj('text'), false);
  assert.equal(isObj(undefined), false);
});

test('firstLine says the first line of stderr, else stdout, else the exit code, with nothing said (checks, merge)', () => {
  assert.equal(firstLine(ran('', 'gh: not found\nmore')), 'gh: not found', 'checks: stderr wins');
  assert.equal(firstLine(ran('  one\ntwo  ')), 'one', 'merge: stdout trimmed, first line only');
  assert.equal(firstLine(ran('', '', 3)), 'exit 3', 'nothing said');
  assert.equal(firstLine(ran('\n\n', ' \n', 1)), 'exit 1', 'only blank space said');
});

test('sentence ends the text with a full stop unless it ends in . ! or ?, and empty text stays empty (checks, updates, rule-suggestions)', () => {
  assert.equal(sentence('  The check failed  '), 'The check failed.', 'checks: trimmed and stopped');
  assert.equal(sentence('Opened the pull request!'), 'Opened the pull request!', 'updates: already ends in !');
  assert.equal(sentence('Why?'), 'Why?');
  assert.equal(sentence('Done.'), 'Done.', 'rule-suggestions: already ends in .');
  assert.equal(sentence(''), '');
  assert.equal(sentence('   '), '');
});
