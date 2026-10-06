import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pending } from '../webview/pending.ts';

type What = 'answer' | 'post' | 'discard' | 'ask';

test('a reply the page waits for shows as on its way until acc replies, and only once at a time (D-059)', () => {
  const p = new Pending<What>();
  assert.equal(p.start('update:/r#ACME-1.2', 'post'), true);
  assert.equal(p.start('update:/r#ACME-1.2', 'discard'), false, 'a second click while it\'s on its way sends nothing');
  assert.equal(p.what('update:/r#ACME-1.2'), 'post');
  assert.equal(p.start('analysis:/r#ACME-1:q1', 'answer'), true, 'each key waits on its own');
  assert.equal(p.what('analysis:/r#ACME-1:q1'), 'answer');
  assert.equal(p.what('update:/r#ACME-1.3'), undefined);

  // A refusal says why and is ready to try again; it says what it was for, so the page words it.
  assert.equal(p.settle('update:/r#ACME-1.2', 'It wasn\'t posted: sign in to Jira first.'), 'post');
  assert.equal(p.what('update:/r#ACME-1.2'), undefined);
  assert.equal(p.error('update:/r#ACME-1.2'), 'It wasn\'t posted: sign in to Jira first.');
  // Trying again drops the old error at once.
  assert.equal(p.start('update:/r#ACME-1.2', 'post'), true);
  assert.equal(p.error('update:/r#ACME-1.2'), undefined);
  // Done: nothing left to show.
  assert.equal(p.settle('update:/r#ACME-1.2', null), 'post');
  assert.deepEqual([p.what('update:/r#ACME-1.2'), p.error('update:/r#ACME-1.2')], [undefined, undefined]);
  // A reply to nothing on its way still records a refusal, as an update's always did.
  assert.equal(p.settle('ask:/r#ACME-1:q2', 'It wasn\'t drafted: acc didn\'t say why.'), undefined);
  assert.equal(p.error('ask:/r#ACME-1:q2'), 'It wasn\'t drafted: acc didn\'t say why.');
});

test('whatever leaves the page leaves no "Sending…" and no old error behind', () => {
  const p = new Pending<What>();
  p.start('analysis:/r#ACME-1:q1', 'answer');
  p.start('update:/r#ACME-1.2', 'discard');
  p.start('ask:/r#ACME-1:q2', 'ask');
  p.settle('ask:/r#ACME-1:q2', 'It wasn\'t drafted: no.');
  p.start('update:/r#ACME-1.3', 'post');
  p.settle('update:/r#ACME-1.3', 'It wasn\'t posted: no.');
  p.forget(new Set(['update:/r#ACME-1.2', 'ask:/r#ACME-1:q2']));
  assert.equal(p.what('analysis:/r#ACME-1:q1'), undefined, 'its question was answered');
  assert.equal(p.what('update:/r#ACME-1.2'), 'discard', 'still on the page: still on its way');
  assert.equal(p.error('ask:/r#ACME-1:q2'), 'It wasn\'t drafted: no.');
  assert.equal(p.error('update:/r#ACME-1.3'), undefined, 'a newer draft replaced it');
  assert.equal(p.start('analysis:/r#ACME-1:q1', 'answer'), true);
});
