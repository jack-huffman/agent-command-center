// A Slack task's drafts (T-30): only merged, deployed and the client's questions; a Jira task's don't change.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Task } from '../src/ledger.ts';
import { draftUpdate, listUpdates, SLACK_UPDATE_EVENTS, UPDATE_EVENTS } from '../src/updates.ts';
import { tempDir } from './support.ts';

const now = () => new Date('2026-10-05T12:00:00Z');
const store = () => ({ updates: join(tempDir(), 'acc', 'updates') });
const slack: Pick<Task, 'id' | 'source'> = { id: 'T-9', source: { kind: 'slack', key: 'SL-1696512345123456', url: null } };
const jira: Pick<Task, 'id' | 'source'> = { id: 'ACME-12', source: { kind: 'jira', key: 'ACME-12', url: null } };
const input = (event: (typeof UPDATE_EVENTS)[number]) => ({ event, env: 'Dev', pr: { number: 38, url: 'https://github.com/acme/service/pull/38' }, question: 'q1', text: 'x' });
const got = (task: Pick<Task, 'id' | 'source'>) => UPDATE_EVENTS.map((e) => draftUpdate(store(), task, input(e), 'acc land', now)?.event ?? null);

test('a Slack task drafts at merged, deployed, blocked, question, drafted criteria (T-81) and a QA comment (T-84) only, never its changes field (T-105), and a Jira task at every event as before', () => {
  assert.deepEqual(got(slack), [null, null, 'merged', null, null, 'deployed', 'blocked', 'question', 'criteria', 'verify', null]);
  assert.deepEqual(got(jira), [...UPDATE_EVENTS]);
  assert.deepEqual([...SLACK_UPDATE_EVENTS], ['merged', 'deployed', 'blocked', 'question', 'criteria', 'verify']);
});

test('the edge case of a skipped event for a Slack task: it writes no file', () => {
  const paths = store();
  for (const e of ['pr-opened', 'pr-updated', 'promotion-opened', 'promoted'] as const) assert.equal(draftUpdate(paths, slack, input(e), 'acc land', now), null);
  assert.deepEqual(listUpdates(paths), []);
});
