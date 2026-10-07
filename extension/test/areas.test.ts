// Each area of the extension registers itself in its own module (D-???): the page's messages come from the
// area that sends them, none twice, and each area adds its part of the Command Center page in its own turn.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AREAS as MODEL_AREAS } from '../src/model/areas.ts';
import { isFromWebview, MESSAGE_TYPES } from '../src/model/messages.ts';

test('the page\'s messages: each from the area that sends it, none taken by two, and nothing else let in', () => {
  const declared = MODEL_AREAS.flatMap((a) => Object.keys(a.messages ?? {}));
  assert.equal(new Set(declared).size, declared.length, 'no message in two areas');
  assert.deepEqual([...MESSAGE_TYPES].sort(), [...declared].sort());
  for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'nope']) assert.equal(isFromWebview({ type }), false, type);
  assert.equal(isFromWebview({ type: 'ready' }), true);
});

test('the Command Center page: each area adds its part in a turn of its own', () => {
  const orders = MODEL_AREAS.flatMap((a) => (a.home ? [a.home.order] : []));
  assert.equal(new Set(orders).size, orders.length, 'no two areas share a turn');
  assert.ok(orders.length >= 8);
});
