// acc ste check (T-12): the wording check on files or on stdin, and the wording findings acc show and acc
// analysis list. acc runs from its source, in throwaway repos (support.ts).
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { repoPaths, requirementWording, run } from '../../core/src/index.ts';
import { tempDir } from '../../core/test/support.ts';
import { cli, repoWithConfig, UNCHECKED } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

test('ste check reads stdin, prints each finding as the Python did, and exits 1 on a hard one', () => {
  const dir = tempDir('ste-cli-');
  const r = acc(dir, ['ste', 'check'], 'The panel is removed; spin up the job.\n');
  assert.equal(r.code, 1, r.err);
  assert.deepEqual(r.out.split('\n').slice(0, 3), [
    '<stdin>:1:11 passive-voice: Possible passive voice. Name the actor and use an active verb, unless the actor is unknown or irrelevant. [is removed]',
    '<stdin>:1:21 semicolon: STE bans the semicolon (Rule 8.1). Split into separate sentences. [;]',
    '<stdin>:1:23 phrasal-verb: Soft phrasal verb. Use the single plain verb (start, contact, read, begin). [spin up]',
  ]);
  assert.match(r.out, /3 findings \(2 hard, 1 advisory\) in 8 words\./);
});

test('ste check exits 0 on advisory findings only, and on a hedge, which it never flags', () => {
  const dir = tempDir('ste-cli-');
  const advisory = acc(dir, ['ste', 'check'], 'We have received the report.\n');
  assert.equal(advisory.code, 0, advisory.out);
  assert.match(advisory.out, /present-perfect/);
  const hedge = acc(dir, ['ste', 'check', '--json'], 'The request may have failed.\n');
  assert.equal(hedge.code, 0);
  assert.deepEqual(hedge.json(), { findings: [], count: 0, hard: 0, words: 5 });
});

test('ste check reads each file named, by its name, and a file that can\'t be read is a usage error', () => {
  const dir = tempDir('ste-cli-');
  writeFileSync(join(dir, 'a.md'), '- Start the task and\n');
  writeFileSync(join(dir, 'b.md'), 'Kick off the sync.\n');
  const r = acc(dir, ['ste', 'check', 'a.md', 'b.md', '--json']);
  assert.equal(r.code, 1);
  assert.deepEqual((r.json().findings as { file: string; rule: string }[]).map((f) => `${f.file} ${f.rule}`), ['a.md dangling-conjunction', 'b.md phrasal-verb']);
  const gone = acc(dir, ['ste', 'check', 'missing.md']);
  assert.equal(gone.code, 2);
  assert.match(gone.err, /Can't read missing\.md: there's no such file\./);
  const wrong = acc(dir, ['ste', 'lint']);
  assert.equal(wrong.code, 2);
  assert.match(wrong.err, /acc ste check \[<file>\.\.\.\]/);
});

test('ste check on an empty stdin finds nothing and exits 0', () => {
  const r = acc(tempDir('ste-cli-'), ['ste', 'check'], '');
  assert.equal(r.code, 0);
  assert.match(r.out, /^0 findings \(0 hard, 0 advisory\) in 0 words\./);
});

/** A repo with task T-1 to do, and an analysis of it whose requirements are as given, as acc records them. */
function analyzed(requirements: { goal: string; criteria: string[]; assumptions: string[]; outOfScope: string[] }): string {
  const dir = repoWithConfig(UNCHECKED);
  assert.equal(acc(dir, ['add', 'First thing']).code, 0);
  const { analyses } = repoPaths(dir, run);
  mkdirSync(analyses, { recursive: true });
  writeFileSync(join(analyses, 'T-1.json'), JSON.stringify({
    v: 1, task: 'T-1', env: 'main', base: 'abc', verdict: 'ready', summary: 'S.', requirements, questions: [], findings: [],
    approach: { plan: [], files: [], refactors: [], risks: [], tests: [], size: 'S' }, split: [], orgs: [], sessionId: 's', at: '2026-10-13T00:00:00Z', durationMs: 1, costUsd: null,
    wording: requirementWording(requirements),
  }));
  return dir;
}

test('show and analysis list each wording finding with the requirement it came from, as advice in orange words', () => {
  const dir = analyzed({ goal: 'Kick off the sync.', criteria: ['The sync runs; it logs.'], assumptions: [], outOfScope: [] });
  const show = acc(dir, ['show', 'T-1']);
  assert.equal(show.code, 0, show.err);
  assert.match(show.out, /! Wording: 2 findings in its analysis's requirements\. They're advice: they never hold a dispatch\.\n {2}Goal: Soft phrasal verb\.[^\n]*\[Kick off\]\n {4}Kick off the sync\.\n {2}Criterion 1: STE bans the semicolon[^\n]*\[;\]\n {4}The sync runs; it logs\./);
  assert.deepEqual((acc(dir, ['show', 'T-1', '--json']).json().wording as { part: string; rule: string }[]).map((f) => `${f.part} ${f.rule}`), ['goal phrasal-verb', 'criteria semicolon']);
  const analysis = acc(dir, ['analysis', 'T-1']);
  assert.match(analysis.out, /! Wording: 2 findings\n {2}- Goal: Soft phrasal verb[^\n]*\n {2}- Criterion 1: STE bans the semicolon/);
});

test('show says nothing of wording for clean requirements, nor for a task with no analysis', () => {
  const clean = analyzed({ goal: 'The sync starts each hour.', criteria: ['The sync writes one log line.'], assumptions: [], outOfScope: [] });
  assert.doesNotMatch(acc(clean, ['show', 'T-1']).out, /Wording/);
  assert.doesNotMatch(acc(clean, ['analysis', 'T-1']).out, /Wording/);
  const none = repoWithConfig(UNCHECKED);
  assert.equal(acc(none, ['add', 'First thing']).code, 0);
  const r = acc(none, ['show', 'T-1', '--json']);
  assert.deepEqual(r.json().wording, []);
});
