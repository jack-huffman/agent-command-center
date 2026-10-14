// Posting a Slack task's draft (T-30): through the client's comment, as the app from its sign-in.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { postClaimed } from '../src/logic/post-update.ts';
import type { BoardInput } from '../src/model/boards.ts';
import { updatePoster } from '../src/model/updates.ts';

const ACC_OK = { code: 0, stdout: '{}', stderr: '' };
const says = (r: { stdout: string; stderr: string }) => r.stderr || r.stdout;

test('a Slack draft posts through the client\'s comment, in the thread, and the claim comes first', async () => {
  const calls: string[] = [];
  const acc = async (args: string[]) => { calls.push(`acc ${args.slice(0, 3).join(' ')}`); return ACC_OK; };
  const client = { comment: async (key: string, text: string) => { calls.push(`comment ${key} ${text}`); } };
  const r = await postClaimed(client, acc, '/r', 'SL-1696512345123456', 'T-9.1', 'Merged into Dev.', [], says);
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(calls, ['acc update posting T-9.1', 'comment SL-1696512345123456 Merged into Dev.']);
});

test('a failed post to the thread releases the claim with the reason, and a refused claim posts nothing (the edge case of a failure)', async () => {
  const calls: string[][] = [];
  const acc = async (args: string[]) => { calls.push(args); return ACC_OK; };
  const failing = { comment: async () => { throw new Error('Slack: not_in_channel.'); } };
  const r = await postClaimed(failing, acc, '/r', 'SL-1', 'T-9.1', 'hi', [], says);
  assert.deepEqual(r, { ok: false, error: 'Slack: not_in_channel.' });
  assert.deepEqual(calls.at(-1), ['update', 'release', 'T-9.1', '--reason=Slack: not_in_channel.', '--json']);
  const sent: string[] = [];
  const refused = await postClaimed({ comment: async (_k, t) => { sent.push(t); } }, async () => ({ code: 1, stdout: '', stderr: 'already posted' }), '/r', 'SL-1', 'T-9.1', 'hi', [], says);
  assert.deepEqual([refused, sent], [{ ok: false, error: 'already posted' }, []]);
});

test('a Slack draft posts as the app from its sign-in, and waits for one without it (the edge case of no sign-in)', () => {
  const board = (signedInAs: string | null) => ({ index: 0, kind: 'slack', signedInAs } as unknown as BoardInput);
  assert.deepEqual(updatePoster('slack', 0, '/r', null, [board('acc-bot')]), { postAs: 'acc-bot', blocked: null, signIn: null });
  const waiting = updatePoster('slack', 0, '/r', null, [board(null)]);
  assert.equal(waiting.postAs, null);
  assert.equal(waiting.blocked, 'Sign in to Slack first.');
  assert.ok(waiting.signIn);
});
