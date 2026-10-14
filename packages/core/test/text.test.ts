// The helpers several core files shared (T-15): one input from each old call site.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RunResult } from '../src/exec.ts';
import { clip, firstSaid, isObj, plural, sentence } from '../src/text.ts';

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

test('firstSaid says the first line of stderr, else stdout, else the exit code, with nothing said (checks, merge)', () => {
  assert.equal(firstSaid(ran('', 'gh: not found\nmore')), 'gh: not found', 'checks: stderr wins');
  assert.equal(firstSaid(ran('  one\ntwo  ')), 'one', 'merge: stdout trimmed, first line only');
  assert.equal(firstSaid(ran('', '', 3)), 'exit 3', 'nothing said');
  assert.equal(firstSaid(ran('\n\n', ' \n', 1)), 'exit 1', 'only blank space said');
});

test('sentence ends the text with a full stop unless it ends in . ! or ?, and empty text stays empty (checks, updates, rule-suggestions)', () => {
  assert.equal(sentence('  The check failed  '), 'The check failed.', 'checks: trimmed and stopped');
  assert.equal(sentence('Opened the pull request!'), 'Opened the pull request!', 'updates: already ends in !');
  assert.equal(sentence('Why?'), 'Why?');
  assert.equal(sentence('Done.'), 'Done.', 'rule-suggestions: already ends in .');
  assert.equal(sentence(''), '');
  assert.equal(sentence('   '), '');
});

test('clip leaves short text alone and cuts long text to max with an ellipsis (progress, rule suggestions)', () => {
  assert.equal(clip('short', 90), 'short', 'progress: under the limit');
  assert.equal(clip('abcde', 5), 'abcde', 'edge case: exactly the limit is not cut');
  assert.equal(clip('abcdefgh', 5), 'abcd…', 'rule suggestions: cut to max characters in all');
  assert.equal(clip('ab   cdefgh', 5), 'ab…', 'edge case: spaces before the cut are trimmed');
  assert.equal(clip('', 5), '', 'edge case: empty text stays empty');
});

test('plural says one for 1 and the many form for any other count, 0 included (progress, gates)', () => {
  assert.equal(plural(1, 'file'), '1 file');
  assert.equal(plural(2, 'changed file'), '2 changed files', 'gates: a noun phrase');
  assert.equal(plural(0, 'task'), '0 tasks', 'edge case: zero takes the many form');
  assert.equal(plural(2, 'merged task', 'merged tasks!'), '2 merged tasks!', 'a third argument sets the many form');
  assert.equal(plural(1, 'core', 'cores'), '1 core');
});
