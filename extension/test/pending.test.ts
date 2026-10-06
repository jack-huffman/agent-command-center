import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type DraftKeys, editFor, type Edits, keepEdits, Pending } from '../webview/pending.ts';

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

// ACME-12's task page, its updates' keys as the page keeps them.
const k = (id: string) => `update:/r#${id}`;
const mine = (key: string) => key.startsWith('update:/r#ACME-12.');
const acc = 'The change is ready for review: https://github.com/o/r/pull/38';
const typed = 'Ready for review, Dana: https://github.com/o/r/pull/38';
const draft = (id: string, text: string, replaces: string[] = []): DraftKeys => ({ key: k(id), text, replaces: replaces.map(k) });

test('an edit typed for a draft that a newer one replaced moves to the newer one, and says so (GH-46)', () => {
  const held: Edits = { drafts: { [k('ACME-12.1')]: typed, '/r#ACME-12': 'half a comment' }, bases: { [k('ACME-12.1')]: { text: acc } } };
  // Hidden through two replacements, .1 to .2 to .3: the page sees only .3, and finds the edit through it.
  const third = draft('ACME-12.3', acc, ['ACME-12.2', 'ACME-12.1']);
  assert.deepEqual(editFor(held, third), { text: typed, carried: 'kept' }, 'read through what it replaced, before anything moved');
  const kept = keepEdits(held, [third], mine)!;
  assert.deepEqual(kept, { drafts: { [k('ACME-12.3')]: typed, '/r#ACME-12': 'half a comment' }, bases: { [k('ACME-12.3')]: { text: acc, from: k('ACME-12.1') } } }, 'moved, not dropped; the comment\'s draft is left alone');
  assert.deepEqual(editFor(kept, third), { text: typed, carried: 'kept' }, 'once moved, it still says it was carried');
  assert.equal(keepEdits(kept, [third], mine), null, 'nothing more to do');

  // The newer draft words it differently: the page shows both.
  const reworded = draft('ACME-12.3', `${acc}\nThe support lead hears about each one too.`, ['ACME-12.2', 'ACME-12.1']);
  assert.deepEqual(editFor(held, reworded), { text: typed, carried: 'both' });
  assert.deepEqual(editFor(keepEdits(held, [reworded], mine)!, reworded), { text: typed, carried: 'both' });
  // One typed before edits were carried has no base: both, rather than claim nothing changed.
  assert.deepEqual(editFor({ drafts: held.drafts, bases: {} }, third), { text: typed, carried: 'both' });
  assert.deepEqual(editFor(keepEdits({ drafts: held.drafts, bases: {} }, [third], mine)!, third), { text: typed, carried: 'both' });
});

test('an edit is the box differing from acc\'s text, and one for a draft that has gone leaves nothing behind (GH-46)', () => {
  const own = draft('ACME-12.4', acc);
  assert.deepEqual(editFor({ drafts: { [k('ACME-12.4')]: typed }, bases: { [k('ACME-12.4')]: { text: acc } } }, own), { text: typed, carried: null }, 'its own edit, not carried');
  assert.equal(editFor({ drafts: { [k('ACME-12.4')]: `  ${acc}\n` }, bases: {} }, own), null, 'typed back to acc\'s text');
  assert.equal(editFor({ drafts: {}, bases: {} }, own), null);
  assert.deepEqual(editFor({ drafts: { [k('ACME-12.4')]: 'newest', [k('ACME-12.3')]: 'older' }, bases: {} }, draft('ACME-12.4', acc, ['ACME-12.3'])), { text: 'newest', carried: null }, 'a draft\'s own edit comes first');

  // .5 was posted, so nothing replaced it: its edit goes, and its base. Another task's drafts stay.
  const posted: Edits = { drafts: { [k('ACME-12.5')]: typed, [k('ACME-13.1')]: 'theirs' }, bases: { [k('ACME-12.5')]: { text: acc } } };
  assert.deepEqual(keepEdits(posted, [draft('ACME-12.6', acc)], mine), { drafts: { [k('ACME-13.1')]: 'theirs' }, bases: {} });
  // Carried before the rest are dropped: the other way round, a replaced draft's edit would be lost with them.
  const replaced: Edits = { drafts: { [k('ACME-12.6')]: typed }, bases: { [k('ACME-12.6')]: { text: acc } } };
  assert.deepEqual(keepEdits(replaced, [draft('ACME-12.7', acc, ['ACME-12.6'])], mine)?.drafts, { [k('ACME-12.7')]: typed });
});
