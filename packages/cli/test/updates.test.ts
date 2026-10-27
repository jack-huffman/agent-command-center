// acc update and acc block --client: ticket updates a person reviews before posting (updates.ts, D-066).
// acc runs from its source, in throwaway repos (support.ts).
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GENERIC_CONFIG } from '../../core/test/support.ts';
import { cli, repoWithConfig } from './support.ts';
import { standIn } from '../../core/test/stand-in.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

// ---------------------------------------------------------------- ticket updates (D-066)

/** A repo with GH-3 (a GitHub issue) and ACME-7 (a Jira ticket) running, and a gh that records what it posts. */
function ticketsRepo() {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, github: { repo: 'o/r', account: 'me' } });
  const items = [
    { source: { kind: 'github', key: '#3', url: 'https://github.com/o/r/issues/3' }, title: 'Fix login' },
    { source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Escalate premium cases' },
  ];
  assert.equal(acc(dir, ['import'], JSON.stringify(items)).code, 0);
  for (const id of ['GH-3', 'ACME-7']) assert.equal(acc(dir, ['set', id, 'running']).code, 0);
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  standIn(join(bin, 'gh'), `#!/bin/sh
case "$1 $2" in
  "auth token") [ "$4" = "me" ] && echo tok-me || exit 1 ;;
  "issue comment") [ "$GH_TOKEN" = "tok-me" ] || { echo "wrong account" >&2; exit 1; }; echo "$1 $2 $3 $4 $5 $6" > "${dir}/gh-args"; cat "$7" > "${dir}/gh-body"; echo https://github.com/o/r/issues/3#issuecomment-1 ;;
  *) exit 1 ;;
esac
`);
  chmodSync(join(bin, 'gh'), 0o755);
  return { dir, env: { PATH: `${bin}${delimiter}${process.env.PATH}` }, updates: join(dir, '.git', 'acc', 'updates') };
}

test('acc block --client blocks and drafts an update with the question; a plain block stays internal', () => {
  const { dir, updates } = ticketsRepo();
  const builder = { ACC_ROLE: 'builder', ACC_TASK: 'GH-3' };
  const r = acc(dir, ['block', '--client', 'Should Gold customers count as Premium?', '--json'], undefined, builder);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual([r.json().task.state, r.json().task.blocker], ['blocked', 'Waiting on the client: Should Gold customers count as Premium?']);
  assert.deepEqual([r.json().update.id, r.json().update.event, r.json().update.by, r.json().update.text], ['GH-3.1', 'blocked', 'builder:GH-3', 'We need your input before we can go on:\nShould Gold customers count as Premium?']);
  assert.match(acc(dir, ['help']).out, /acc block \[<id>\] --client "<question>"/);

  const plain = acc(dir, ['block', 'ACME-7', 'the sandbox is down', '--json'], undefined, { ACC_ROLE: 'builder', ACC_TASK: 'ACME-7' });
  assert.equal(plain.code, 0, plain.err);
  assert.equal(plain.json().update, undefined);
  assert.deepEqual(readdirSync(updates), ['GH-3.1.json'], 'only the client\'s question is drafted');
  assert.equal(acc(dir, ['set', 'ACME-7', 'running', '--client', 'Why?']).code, 2, '--client goes only with blocking');
  assert.equal(acc(dir, ['set', 'ACME-7', 'blocked', '--client', 'Which queue?']).code, 1, 'a blocked task can\'t be blocked again');

  // A task's id with only --client after it is the task, not the reason.
  const named = ticketsRepo();
  const p = acc(named.dir, ['block', 'ACME-7', '--client', 'Which queue should Gold cases go to?', '--json']);
  assert.equal(p.code, 0, p.err);
  assert.deepEqual([p.json().task.id, p.json().task.blocker, p.json().update.key], ['ACME-7', 'Waiting on the client: Which queue should Gold cases go to?', 'ACME-7']);
});

test('acc updates lists the drafts; a person posts a GitHub one with their edits, as the repo\'s account, and discards another', () => {
  const { dir, env } = ticketsRepo();
  assert.equal(acc(dir, ['set', 'GH-3', 'blocked', '--client', 'Which browsers must it support?']).code, 0);
  assert.equal(acc(dir, ['set', 'ACME-7', 'blocked', '--client', 'Which queue should Gold cases go to?']).code, 0);
  const listed = acc(dir, ['updates', '--json']);
  assert.equal(listed.code, 0, listed.err);
  assert.deepEqual(listed.json().map((u: { id: string; state: string; key: string }) => [u.id, u.state, u.key]), [['GH-3.1', 'draft', '#3'], ['ACME-7.1', 'draft', 'ACME-7']]);
  assert.match(acc(dir, ['updates']).out, /GH-3\.1 +draft {2}GitHub #3: a question for the client[\s\S]*Which browsers must it support\?/);

  // Edited before it goes: the edited text is what's posted, through gh as the repo's account.
  const edited = join(dir, 'edited.md');
  writeFileSync(edited, 'Quick question before we go on: which browsers must the login page support?\n');
  const posted = acc(dir, ['update', 'post', 'GH-3.1', '--text-file', edited, '--json'], undefined, env);
  assert.equal(posted.code, 0, posted.err);
  assert.equal(readFileSync(join(dir, 'gh-args'), 'utf8').trim(), `issue comment 3 -R o/r --body-file`);
  assert.equal(readFileSync(join(dir, 'gh-body'), 'utf8'), 'Quick question before we go on: which browsers must the login page support?\n');
  const u = posted.json();
  assert.deepEqual([u.state, u.posted.text, u.posted.url, u.posted.by], ['posted', 'Quick question before we go on: which browsers must the login page support?', 'https://github.com/o/r/issues/3#issuecomment-1', `human:${process.env.USER ?? 'unknown'}`]);
  const again = acc(dir, ['update', 'post', 'GH-3.1'], undefined, env);
  assert.equal(again.code, 1);
  assert.match(again.err, /GH-3\.1 was posted by/);

  // Jira posts as you through the Command Center's sign-in, never from here.
  const jira = acc(dir, ['update', 'post', 'ACME-7.1'], undefined, env);
  assert.equal(jira.code, 1);
  assert.match(jira.err, /ACME-7\.1 is for Jira ticket ACME-7\. acc posts only on GitHub: post it from the Command Center/);
  const discarded = acc(dir, ['update', 'discard', 'acme-7.1', '--json']);
  assert.equal(discarded.code, 0, discarded.err);
  assert.equal(discarded.json().state, 'discarded');
  assert.deepEqual(acc(dir, ['updates', '--json']).json(), [], 'nothing waits');
  assert.deepEqual(acc(dir, ['updates', '--all', '--task', 'ACME-7', '--json']).json().map((x: { id: string; state: string }) => [x.id, x.state]), [['ACME-7.1', 'discarded']]);
  assert.match(acc(dir, ['updates']).out, /No drafts waiting/);
  assert.equal(acc(dir, ['update', 'post', 'GH-9.1']).code, 1);
  assert.equal(acc(dir, ['update', 'frob', 'GH-3.1']).code, 2);
});

test('a GitHub draft isn\'t posted on an issue now in another repo: it stays a draft, to discard (D-072)', () => {
  const { dir } = ticketsRepo();
  assert.equal(acc(dir, ['set', 'GH-3', 'blocked', '--client', 'Which browsers must it support?']).code, 0);
  const bin = join(dir, '.movedbin');
  mkdirSync(bin);
  standIn(join(bin, 'gh'), `#!/bin/sh
case "$1 $2" in
  "auth token") echo tok-me ;;
  "issue view") echo '{"url": "https://github.com/other/repo/issues/9"}' ;;
  "issue comment") touch "${dir}/commented" ;;
  *) exit 1 ;;
esac
`);
  chmodSync(join(bin, 'gh'), 0o755);
  const r = acc(dir, ['update', 'post', 'GH-3.1'], undefined, { PATH: `${bin}${delimiter}${process.env.PATH}` });
  assert.equal(r.code, 1);
  assert.match(r.err, /#3 is in other\/repo now, not this repo's o\/r, so GH-3\.1 isn't posted\. Discard it if it no longer applies: acc update discard GH-3\.1/);
  assert.ok(!existsSync(join(dir, 'commented')), 'nothing was posted');
  assert.equal(acc(dir, ['updates', '--json']).json()[0].state, 'draft', 'it waits, unclaimed');
});

test('only a person reads, posts or discards a ticket\'s updates: never a builder, reviewer, analyst or autopilot', () => {
  const { dir, env } = ticketsRepo();
  assert.equal(acc(dir, ['set', 'GH-3', 'blocked', '--client', 'Which browsers?']).code, 0);
  for (const args of [['updates'], ['update', 'post', 'GH-3.1'], ['update', 'discard', 'GH-3.1'], ['update', 'ask', 'GH-3', 'q1'], ['update', 'posting', 'GH-3.1']]) {
    for (const role of ['builder', 'reviewer', 'analyst']) {
      const r = acc(dir, args, undefined, { ...env, ACC_ROLE: role, ACC_TASK: 'GH-3' });
      assert.equal(r.code, 1, `${role}: ${args.join(' ')}`);
      assert.match(r.err, new RegExp(`An? ${role} can't`), `${role}: ${args.join(' ')}`);
    }
    const autopilot = acc(dir, [...args, '--as', 'orchestrator', '--by', 'orchestrator:autopilot'], undefined, env);
    assert.equal(autopilot.code, 1, args.join(' '));
    assert.match(autopilot.err, /Only a person can/);
  }
  assert.equal(JSON.parse(readFileSync(join(dir, '.git', 'acc', 'updates', 'GH-3.1.json'), 'utf8')).state, 'draft', 'still a draft');
});

test('acc update ask drafts one of the analysis\'s questions for the client, and the Command Center\'s steps claim, record and release a post', () => {
  const { dir } = ticketsRepo();
  mkdirSync(join(dir, '.git', 'acc', 'analyses'), { recursive: true });
  writeFileSync(join(dir, '.git', 'acc', 'analyses', 'ACME-7.json'), JSON.stringify({ v: 1, task: 'ACME-7', questions: [{ id: 'q1', question: 'Should Gold customers count as Premium?', why: 'Changes the rule', suggested: 'No' }] }));
  const asked = acc(dir, ['update', 'ask', 'ACME-7', '1', '--json']);
  assert.equal(asked.code, 0, asked.err);
  assert.deepEqual([asked.json().id, asked.json().event, asked.json().question, asked.json().text], ['ACME-7.1', 'question', 'q1', 'Before we start, a question for you:\nShould Gold customers count as Premium?']);
  assert.equal(acc(dir, ['update', 'ask', 'ACME-7', 'q9']).code, 2);
  assert.match(acc(dir, ['update', 'ask', 'GH-3', 'q1']).err, /hasn't been analyzed/);

  // Jira: the Command Center claims it, posts as you, then records what went out, or puts it back.
  assert.equal(acc(dir, ['update', 'posting', 'ACME-7.1', '--json']).json().state, 'posting');
  assert.match(acc(dir, ['update', 'posting', 'ACME-7.1']).err, /is being posted/);
  const released = acc(dir, ['update', 'release', 'ACME-7.1', '--reason', 'Jira said 401', '--json']).json();
  assert.deepEqual([released.state, released.failed.reason], ['draft', 'Jira said 401']);
  acc(dir, ['update', 'posting', 'ACME-7.1']);
  const text = join(dir, 'text.md');
  writeFileSync(text, 'Is Gold the same as Premium for this?');
  const posted = acc(dir, ['update', 'posted', 'ACME-7.1', '--text-file', text, '--url', 'https://acme.atlassian.net/browse/ACME-7?focusedCommentId=1', '--json']).json();
  assert.deepEqual([posted.state, posted.posted.text, posted.posted.url], ['posted', 'Is Gold the same as Premium for this?', 'https://acme.atlassian.net/browse/ACME-7?focusedCommentId=1']);
});
