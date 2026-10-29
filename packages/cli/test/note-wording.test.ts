// The wording check on an agent's notes at the command line (T-149): acc block, its question for the client and
// acc done refuse a builder's note that fails the Simplified Technical English check, record nothing, and give
// each finding with its fix. A person's words are never checked. acc runs from its source, in throwaway repos
// (support.ts). The notes and names are made up.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cli, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

/** A repo with T-1 running in a builder's run, and the builder's environment for it. */
function running() {
  const dir = repoWithConfig();
  assert.equal(acc(dir, ['add', 'Regions on deals']).code, 0);
  assert.equal(acc(dir, ['set', 'T-1', 'running']).code, 0);
  const file = join(dir, '.git', 'acc', 'ledger.json');
  const l = JSON.parse(readFileSync(file, 'utf8'));
  l.tasks[0].run = { bgId: 'bg9', sessionId: 'sess-9', worktree: dir, branch: 'main', startedAt: '2026-10-29T09:00:00.000Z' };
  writeFileSync(file, JSON.stringify(l));
  return { dir, builder: { ACC_ROLE: 'builder', ACC_TASK: 'T-1' } };
}

/** T-1 as the ledger holds it: acc recorded nothing while its state and history are as they were. */
const t1 = (dir: string) => JSON.parse(readFileSync(join(dir, '.git', 'acc', 'ledger.json'), 'utf8')).tasks[0];

test('acc block refuses a builder\'s blocked note that fails the wording check, gives each fix, and records nothing', () => {
  const { dir, builder } = running();
  const before = t1(dir).history.length;
  const r = acc(dir, ['block', 'The test fails; the field is new.', '--item', 'Kick off the import again.'], undefined, builder);
  assert.equal(r.code, 1, r.out);
  assert.match(r.err, /\(2 findings\), so acc recorded nothing\. Write the note again with each fix/);
  assert.ok(r.err.includes('- Headline: STE bans the semicolon (Rule 8.1). Split into separate sentences. [;]'), r.err);
  assert.ok(r.err.includes('- Thing 1: Soft phrasal verb. Use the single plain verb (start, contact, read, begin). [Kick off]'), r.err);
  assert.equal(t1(dir).state, 'running');
  assert.equal(t1(dir).history.length, before, 'no move in its history');
  assert.equal(t1(dir).blocker ?? null, null);
  // Written again with the fixes, it's recorded.
  const fixed = acc(dir, ['block', 'The test fails. The field is new.', '--item', 'Start the import again.', '--json'], undefined, builder);
  assert.equal(fixed.code, 0, fixed.err);
  assert.equal(fixed.json().task.state, 'blocked');
});

test('a question with its options, and a question for the client, are checked line by line', () => {
  const { dir, builder } = running();
  const q = acc(dir, ['block', 'Which field holds the region?', '--item', `a) Region__c (recommended) b) a new field that the team adds to the page for the sales reps in each of the three regions of the company`], undefined, builder);
  assert.equal(q.code, 1, q.out);
  assert.match(q.err, /- Thing 1: Sentence has \d+ words \(cap 25\)\. Split it\./);
  const c = acc(dir, ['block', '--client', 'Can you reach out to the team about the queue?'], undefined, builder);
  assert.equal(c.code, 1, c.out);
  assert.match(c.err, /- The question for the client, headline: Soft phrasal verb\./);
  assert.equal(t1(dir).state, 'running');
});

test('edge case: a note that is a wall of text and fails the wording check says both at once', () => {
  const { dir, builder } = running();
  const wall = `${'The plan names a field that the page does not show. '.repeat(4)}It fails; nobody can land it.`;
  const r = acc(dir, ['block', wall], undefined, builder);
  assert.equal(r.code, 1, r.out);
  assert.match(r.err, /one long paragraph/);
  assert.match(r.err, /- Headline: STE bans the semicolon/);
});

test('text in backticks and the API names acc codes are left alone', () => {
  const { dir, builder } = running();
  const r = acc(dir, ['block', 'The gate stops.', '--item', 'scripts/check/verify.ts sets Check_Verify__c, then fails.', '--json'], undefined, builder);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().task.blocker, 'The gate stops.\n- `scripts/check/verify.ts` sets `Check_Verify__c`, then fails.');
});

test('acc done refuses a builder\'s finish note that fails the wording check, before anything else is checked', () => {
  const { dir, builder } = running();
  const r = acc(dir, ['done', '--landed', 'It adds the field; the page shows it.', '--moved', 'none', '--open', 'Circle back to the import.'], undefined, builder);
  assert.equal(r.code, 1, r.out);
  assert.ok(r.err.includes('- What landed 1: STE bans the semicolon'), r.err);
  assert.ok(r.err.includes('- Still open 1: Soft phrasal verb.'), r.err);
  assert.equal(t1(dir).state, 'running');
  assert.equal(t1(dir).run.note ?? null, null, 'no note kept');
  // A plain note gets past the wording check: what stops it now is its checks, which haven't run.
  const plain = acc(dir, ['done', '--landed', 'It adds the field.', '--moved', 'none', '--open', 'none'], undefined, builder);
  assert.doesNotMatch(plain.err, /Simplified Technical English/);
});

test('a person\'s block and a person\'s note are never checked', () => {
  const { dir } = running();
  const r = acc(dir, ['block', 'T-1', 'It fails; kick off the import again.', '--landed', 'Part of it; the rest waits.', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().task.blocker, 'It fails; kick off the import again.');
});
