// acc ste check (T-12): the wording check on files or on stdin. acc runs from its source (support.ts).
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { tempDir } from '../../core/test/support.ts';
import { cli } from './support.ts';

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
