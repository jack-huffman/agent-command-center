// acc block's note (T-146): a headline and a bullet per thing, refused as a wall of text from an agent, with
// its API names recorded as code. acc runs from its source, in throwaway repos (support.ts). The fields and
// paths are made up.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BLOCK_SHAPE, NOTE_HEADLINE_MAX } from '../../core/src/index.ts';
import { cli, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

const WALL = 'Plan v2 contradicts itself, so nothing can land without a person\'s choice. (1) The plan keeps the region on Account, but the criteria name Territory_Region__c on Opportunity: which is right? a) keep Region__c b) add Territory_Region__c. (2) The record page Deal_Record_Page is named twice; which layout wins? a) sales b) service. (3) The permission set Sales_Ops_Access is left out of the plan.';

/** A repo with T-1 running, and the builder's environment for it. */
function running() {
  const dir = repoWithConfig();
  assert.equal(acc(dir, ['add', 'Regions on deals']).code, 0);
  assert.equal(acc(dir, ['set', 'T-1', 'running']).code, 0);
  return { dir, builder: { ACC_ROLE: 'builder', ACC_TASK: 'T-1' } };
}

test('acc block refuses a builder\'s wall of text, saying how to split it, and the task stays running', () => {
  const { dir, builder } = running();
  const r = acc(dir, ['block', WALL], undefined, builder);
  assert.equal(r.code, 1, r.out);
  assert.ok(r.err.includes(`one long paragraph (${WALL.length} characters; a headline takes at most ${NOTE_HEADLINE_MAX})`), r.err);
  assert.ok(r.err.includes(BLOCK_SHAPE), 'it names the shape that splits it');
  assert.match(r.err, /a\) … b\) … c\) …, at most three, and mark the one you recommend with \(recommended\)/);
  assert.equal(JSON.parse(readFileSync(join(dir, '.git', 'acc', 'ledger.json'), 'utf8')).tasks[0].state, 'running');
});

test('acc block takes a headline and an --item per thing, and records API names as code', () => {
  const { dir, builder } = running();
  const r = acc(dir, ['block', 'Plan v2 contradicts itself.', '--item', 'Which field holds the region? a) Region__c (recommended) b) a new Territory_Region__c', '--item', 'The page Deal_Record_Page is named twice in force-app/main/default.', '--json'], undefined, builder);
  assert.equal(r.code, 0, r.err);
  const want = 'Plan v2 contradicts itself.\n- Which field holds the region? a) `Region__c` (recommended) b) a new `Territory_Region__c`\n- The page `Deal_Record_Page` is named twice in `force-app/main/default`.';
  const task = r.json().task;
  assert.equal(task.blocker, want);
  assert.equal(task.history.at(-1).reason, want);
});

test('acc block takes markdown bullets as they are, and a builder\'s note lines get their API names as code', () => {
  const { dir, builder } = running();
  // Its builder's run, as a dispatch leaves it, to keep the note in.
  const file = join(dir, '.git', 'acc', 'ledger.json');
  const l = JSON.parse(readFileSync(file, 'utf8'));
  l.tasks[0].run = { bgId: 'bg9', sessionId: 'sess-9', worktree: dir, branch: 'main', startedAt: '2026-10-29T09:00:00.000Z' };
  writeFileSync(file, JSON.stringify(l));
  const note = 'Two things block it.\n- The field Region__c is missing\n- Which layout? a) sales b) service';
  const r = acc(dir, ['block', note, '--landed', 'Added Region__c to the page', '--moved', 'none', '--open', 'none', '--json'], undefined, builder);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().task.blocker, 'Two things block it.\n- The field `Region__c` is missing\n- Which layout? a) sales b) service');
  assert.deepEqual(r.json().task.run.note.landed, ['Added `Region__c` to the page']);
});

test('a person\'s block is never refused nor rewritten: a long reason is kept as typed', () => {
  const { dir } = running();
  const r = acc(dir, ['block', 'T-1', WALL, '--json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().task.blocker, WALL, 'no backticks added');
});

test('--item with no headline is refused with the shape to use, and --client takes items as its question\'s bullets', () => {
  const { dir, builder } = running();
  const bare = acc(dir, ['block', '--item', 'just a thing'], undefined, builder);
  assert.equal(bare.code, 2);
  assert.ok(bare.err.includes(`--item adds a bullet under a headline: ${BLOCK_SHAPE}`), bare.err);
  const c = acc(dir, ['block', '--client', 'Which queue should Gold cases go to?', '--item', 'Today they go to Support_Tier_2.', '--json'], undefined, builder);
  assert.equal(c.code, 0, c.err);
  assert.equal(c.json().task.blocker, 'Waiting on the client: Which queue should Gold cases go to?\n- Today they go to `Support_Tier_2`.');
});

test('a client\'s question is held to the headline limit by its own length, not with the prefix acc adds', () => {
  const { dir, builder } = running();
  // Short sentences, so it passes the wording check (T-149) and only its length is in question.
  const question = `${'Gold cases arrive each day. '.repeat(6)}Which queue takes them?`;
  assert.ok(question.length <= NOTE_HEADLINE_MAX);
  assert.ok(question.length + 'Waiting on the client: '.length > NOTE_HEADLINE_MAX, 'with the prefix it would be past the limit');
  const fits = acc(dir, ['block', '--client', question, '--json'], undefined, builder);
  assert.equal(fits.code, 0, fits.err);
  const { dir: d2, builder: b2 } = running();
  const long = acc(d2, ['block', '--client', `${question} ${question}`], undefined, b2);
  assert.equal(long.code, 1, long.out);
  assert.equal(long.err.match(/one long paragraph/g)?.length, 1, 'one refusal, counted on the question alone');
});
