// A ticket's title and description written from acc (T-80): Jira and GitHub write them, as their recorded
// requests show; Azure DevOps, monday.com and Slack refuse, with why, and send nothing.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AzureClient } from '../src/trackers/azure.ts';
import { GithubClient } from '../src/trackers/github.ts';
import { JiraClient } from '../src/trackers/jira.ts';
import { MondayClient } from '../src/trackers/monday.ts';
import { SlackClient } from '../src/trackers/slack.ts';
import { type Exec, TEXT_TRACKERS, textRefusal, textRefused, type TrackerClient, TRACKER_KINDS, TrackerError } from '../src/trackers/types.ts';

/** A stand-in for Jira Cloud that records each request and answers 204, as Jira's edit does. */
function jiraRecorder() {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ method: init.method ?? 'GET', path: url.replace('https://acme.atlassian.net', ''), body: init.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  return { jira: new JiraClient({ site: 'acme.atlassian.net', project: 'MSP', email: 'me@acme.co', token: 'tok', fetch: f }), calls };
}

/** A stand-in gh that records each command and what went on its stdin. */
function ghRecorder(code = 0) {
  const calls: { args: string[]; input?: string }[] = [];
  const exec: Exec = async (_cmd, args, opts) => {
    calls.push({ args, input: opts?.input });
    return code ? { code, stdout: '', stderr: 'HTTP 422: Validation Failed' } : { code: 0, stdout: '', stderr: '' };
  };
  return { gh: new GithubClient({ repo: 'o/r', token: 'tok', account: 'me', exec }), calls };
}

test('Jira writes the summary and the description as ADF in one edit, and only the fields given', async () => {
  const { jira, calls } = jiraRecorder();
  await jira.setText('MSP-1', { title: '  Login page  ', markdown: 'As a **user**\n\n- one' });
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0]!.method, calls[0]!.path], ['PUT', '/rest/api/3/issue/MSP-1']);
  const fields = (calls[0]!.body as { fields: { summary: string; description: { type: string; content: { type: string }[] } } }).fields;
  assert.equal(fields.summary, 'Login page');
  assert.equal(fields.description.type, 'doc', 'the description goes as ADF, as a comment does');
  assert.deepEqual(fields.description.content.map((n) => n.type), ['paragraph', 'bulletList']);
  await jira.setText('MSP-1', { title: 'Only the title' });
  assert.deepEqual(calls.at(-1)!.body, { fields: { summary: 'Only the title' } }, 'a description left out stays as it is');
  await jira.setText('MSP-1', { markdown: '  ' });
  assert.deepEqual(calls.at(-1)!.body, { fields: { description: null } }, 'an empty description clears it');
});

test('Jira edge cases: nothing given sends nothing, and an empty title is refused before any request', async () => {
  const { jira, calls } = jiraRecorder();
  await jira.setText('MSP-1', {});
  await assert.rejects(jira.setText('MSP-1', { title: ' ' }), (e: unknown) => e instanceof TrackerError && e.kind === 'refused' && /needs a title/.test(e.message));
  assert.equal(calls.length, 0);
});

test('GitHub edits the title as one argument and the body on stdin, never as an argument', async () => {
  const { gh, calls } = ghRecorder();
  await gh.setText('GH-9', { title: '-starts with a dash', markdown: '--body is text' });
  assert.deepEqual(calls[0]!.args, ['issue', 'edit', '9', '-R', 'o/r', '--title=-starts with a dash', '--body-file', '-']);
  assert.equal(calls[0]!.input, '--body is text');
  await gh.setText('GH-9', { markdown: '' });
  assert.deepEqual([calls.at(-1)!.args, calls.at(-1)!.input], [['issue', 'edit', '9', '-R', 'o/r', '--body-file', '-'], ''], 'an empty body clears it');
  await gh.setText('GH-9', { title: 'Only the title' });
  assert.deepEqual([calls.at(-1)!.args, calls.at(-1)!.input], [['issue', 'edit', '9', '-R', 'o/r', '--title=Only the title'], undefined]);
});

test('GitHub edge cases: nothing given runs nothing, an empty title is refused, and a failed edit throws gh\'s reason', async () => {
  const { gh, calls } = ghRecorder();
  await gh.setText('GH-9', {});
  await assert.rejects(gh.setText('GH-9', { title: '' }), /needs a title/);
  assert.equal(calls.length, 0);
  await assert.rejects(ghRecorder(1).gh.setText('GH-9', { title: 'x' }), /Validation Failed/);
});

test('Azure DevOps, monday.com and Slack refuse to write ticket text, with why, and send nothing', async () => {
  let sent = 0;
  const f = (async () => { sent++; return new Response('{}'); }) as unknown as typeof fetch;
  const clients: TrackerClient[] = [
    new AzureClient({ organization: 'acme', project: 'CRM', auth: async () => 'Bearer tok', fetch: f }),
    new MondayClient({ account: 'acme', board: 111, token: 'tok', fetch: f }),
    new SlackClient({ workspace: 'acme', channel: 'C0123ABCD', token: 'xoxb-test', fetch: f }),
  ];
  for (const c of clients) {
    await assert.rejects(c.setText('X-1', { title: 'New' }), (e: unknown) => e instanceof TrackerError && e.kind === 'refused' && e.message === textRefusal(c.kind));
  }
  assert.equal(sent, 0);
  assert.equal(clients.length, 3);
});

test('textRefusal: null for Jira and GitHub, a reason that names the tracker for every other kind', () => {
  const refused = TRACKER_KINDS.filter((k) => textRefusal(k));
  assert.deepEqual(TRACKER_KINDS.filter((k) => !textRefusal(k)), [...TEXT_TRACKERS]);
  assert.deepEqual(refused, ['azure', 'monday', 'slack']);
  assert.match(textRefusal('azure')!, /Azure DevOps ticket's title or description/);
  assert.equal(textRefused('slack').kind, 'refused');
});
