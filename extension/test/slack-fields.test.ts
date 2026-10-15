// A Slack task's page has no status, assignee or label control, and says why (T-50): the page model read
// through the real SlackClient, against a stand-in Slack.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SLACK_API, SlackClient } from '../../packages/core/src/trackers/slack.ts';
import { ticketModel } from '../src/model/task-page.ts';

const KEY = 'SL-1696512345123456';
const ROUTES: Record<string, unknown> = {
  'auth.test': { ok: true, url: 'https://acme.slack.com/', team: 'Acme', user: 'acc-bot', team_id: 'T01', user_id: 'U0BOT' },
  'conversations.replies': { ok: true, has_more: false, messages: [{ ts: '1696512345.123456', user: 'U01', text: 'The export drops the last row' }] },
  'users.info': { ok: true, user: { id: 'U01', name: 'jkim', real_name: 'Jordan Kim', profile: { display_name: 'Jordan', real_name: 'Jordan Kim', email: 'jordan.kim@example.com' } } },
  'chat.getPermalink': { ok: true, permalink: 'https://acme.slack.com/archives/C0123ABCD/p1696512345123456' },
};
const slackFetch = (async (input: string | URL) => {
  const method = new URL(String(input)).pathname.replace('/api/', '');
  assert.ok(String(input).startsWith(`${SLACK_API}/`));
  return new Response(JSON.stringify(ROUTES[method] ?? { ok: false, error: 'unknown_method' }), { status: 200 });
}) as unknown as typeof fetch;

test('a Slack task page, through the real SlackClient, has no status, assignee or label control and three muted lines naming the Slack tracker, as the page names every tracker (T-50)', async () => {
  const client = new SlackClient({ workspace: 'acme', channel: 'C0123ABCD', token: 'xoxb-test', fetch: slackFetch });
  assert.deepEqual(client.fields, [], 'an empty list is a tracker with none, not a tracker that never said');
  const ticket = await client.ticket(KEY);
  const page = ticketModel({ project: '/r', tracker: 0, trackerTitle: client.title, trackerKind: 'slack', key: KEY, loading: false, error: null, connect: null, checks: [], row: null, task: null, ticket, trackerEdits: true, trackerFields: client.fields });
  assert.deepEqual([page.can.status, page.can.assign, page.can.labels], [false, false, false]);
  assert.equal(page.can.comment, true, 'a reply in the thread stays');
  assert.deepEqual(page.lacks.map((l) => l.line), ['Slack · acme has no statuses.', 'Slack · acme has no people to assign.', 'Slack · acme has no labels.']);
});
