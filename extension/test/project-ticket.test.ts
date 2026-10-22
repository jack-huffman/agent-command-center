// A project's ticket, read through its tracker (T-110): the one reader drafting criteria and Make a plan share.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { projectTracker, readProjectTicket } from '../src/logic/project-ticket.ts';

const P = { root: '/r', name: 'r' };
const hub = { project: (root: string) => (root === P.root ? P : undefined) } as never;
const asked: unknown[] = [];
const trackers = {
  trackerFor: (_p: unknown, key: string) => (key.startsWith('ACME-') ? 1 : null),
  ticket: async (p: unknown, index: number, key: string) => { asked.push([p, index, key]); return { key } as never; },
} as never;

test('the ticket is read from the tracker that holds its key, in the project at its root', async () => {
  assert.deepEqual(projectTracker({ hub, trackers }, '/r', 'ACME-7'), { p: P, index: 1 });
  assert.deepEqual(await readProjectTicket(hub, trackers, '/r', 'ACME-7'), { key: 'ACME-7' });
  assert.deepEqual(asked, [[P, 1, 'ACME-7']]);
});

test('edge: a key no tracker holds, or a root that is no project, is refused in words, and no tracker is asked', async () => {
  asked.length = 0;
  assert.throws(() => projectTracker({ hub, trackers }, '/r', 'GH-1'), /^Error: GH-1 isn't one of the project's tickets\.$/);
  await assert.rejects(readProjectTicket(hub, trackers, '/elsewhere', 'ACME-7'), /ACME-7 isn't one of the project's tickets\./);
  assert.deepEqual(asked, []);
});
