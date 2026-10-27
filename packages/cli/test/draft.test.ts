// acc draft criteria, show and update (T-81): a read-only agent drafts a ticket's acceptance criteria, kept
// with the task, and only a person makes it an update. acc runs from its source, with a fake claude.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GENERIC_CONFIG } from '../../core/test/support.ts';
import { cli, repoWithConfig } from './support.ts';
import { standIn } from '../../core/test/stand-in.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

const ANSWER = {
  criteria: ['A premium case escalates 2 business hours after it opens.'],
  steps: ['Open a premium case at 09:00.', 'Wait until 11:00. The case shows Tier 2.'],
  edgeCases: ['A case opens on a Saturday. The clock starts on Monday at 09:00.'],
  questions: ['Do public holidays count as business hours?'],
};

/** A repo with a Jira task and a task acc keeps, and a claude that answers `answer`, keeping its arguments and its prompt. */
function draftRepo(answer: unknown = ANSWER) {
  const dir = repoWithConfig(GENERIC_CONFIG);
  const items = [
    { source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Escalate premium cases', brief: 'Premium cases escalate after 2 hours.' },
    { source: { kind: 'manual' }, title: 'Write the changelog' },
  ];
  assert.equal(acc(dir, ['import'], JSON.stringify(items)).code, 0);
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  writeFileSync(join(dir, '.answer.json'), JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'sess-criteria', total_cost_usd: 0.1, structured_output: answer }));
  standIn(join(bin, 'claude'), `#!/bin/sh\necho "$@" >> "${dir}/.claude-args"\ncat > "${dir}/.claude-prompt"\ncat "${dir}/.answer.json"\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  return { dir, env: { PATH: `${bin}${delimiter}${process.env.PATH}` }, updates: join(dir, '.git', 'acc', 'updates') };
}

const TICKET = {
  key: 'ACME-7', title: 'Escalate premium cases', url: 'https://acme.atlassian.net/browse/ACME-7', markdown: 'Premium cases escalate after 2 hours.',
  comments: [{ author: 'Dana Reyes', created: '2026-10-18', markdown: 'Only business hours count.' }], related: [{ key: 'ACME-3', title: 'Premium Support', relation: 'parent' }],
};

test('acc draft criteria --json drafts from the ticket file, keeps the draft with the task, and drafts no update', () => {
  const { dir, env, updates } = draftRepo();
  writeFileSync(join(dir, '.ticket.json'), JSON.stringify(TICKET));
  const r = acc(dir, ['draft', 'criteria', 'acme-7', '--ticket', join(dir, '.ticket.json'), '--json'], undefined, env);
  assert.equal(r.code, 0, r.err);
  const d = JSON.parse(r.out);
  assert.equal(d.task, 'ACME-7');
  assert.deepEqual(d.criteria, ANSWER.criteria);
  assert.match(d.markdown, /### Acceptance criteria\n\n1\. A premium case escalates/);
  assert.deepEqual(d.read, { comments: 1, related: 1, full: true });
  assert.deepEqual(d.wording, []);
  assert.equal(r.err, '', '--json says nothing more');
  const prompt = readFileSync(join(dir, '.claude-prompt'), 'utf8');
  assert.match(prompt, /Only business hours count/);
  assert.match(prompt, /parent: ACME-3 Premium Support/);
  assert.match(readFileSync(join(dir, '.claude-args'), 'utf8'), /--allowedTools Read Grep Glob --disallowedTools Bash Edit Write/);
  assert.ok(existsSync(join(dir, '.git', 'acc', 'criteria', 'ACME-7.json')), 'kept with the task');
  assert.ok(!existsSync(updates) || readdirSync(updates).filter((f) => f.endsWith('.json')).length === 0, 'no update until a person asks');
  // acc draft show reads it back.
  const shown = acc(dir, ['draft', 'show', 'ACME-7', '--json']);
  assert.deepEqual(JSON.parse(shown.out), d);
});

test('acc draft criteria without a ticket file drafts from the description, and says in words what it read and what comes next', () => {
  const { dir, env } = draftRepo();
  const r = acc(dir, ['draft', 'criteria', 'ACME-7'], undefined, env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /### Test steps\n\n1\. Open a premium case at 09:00\./);
  assert.match(r.out, /Drafted from the task's description only: its comments were not read/);
  assert.match(r.out, /Nothing is on ACME-7 yet/);
  assert.match(r.err, /Drafting ACME-7's acceptance criteria\. The drafter reads and changes nothing/);
  assert.match(readFileSync(join(dir, '.claude-prompt'), 'utf8'), /The comments were not read/);
});

test('acc draft update makes the draft an update draft for a person to post; before a draft it is refused (edge case)', () => {
  const { dir, env, updates } = draftRepo();
  const before = acc(dir, ['draft', 'update', 'ACME-7', '--json']);
  assert.equal(before.code, 1);
  assert.match(JSON.parse(before.out).message, /no drafted acceptance criteria yet/);
  assert.equal(acc(dir, ['draft', 'criteria', 'ACME-7', '--json'], undefined, env).code, 0);
  const r = acc(dir, ['draft', 'update', 'ACME-7', '--json']);
  assert.equal(r.code, 0, r.err);
  const u = JSON.parse(r.out);
  assert.deepEqual([u.event, u.state, u.key], ['criteria', 'draft', 'ACME-7']);
  assert.match(u.text, /^## Drafted acceptance criteria\n\n### Acceptance criteria/);
  assert.deepEqual(readdirSync(updates).filter((f) => f.endsWith('.json')), [`${u.id}.json`]);
  assert.match(acc(dir, ['draft', 'update', 'ACME-7']).out, /nothing is posted yet/);
});

test('acc draft refuses a task with no tracker, an agent, junk from the drafter, a bad ticket file and a missing id (edge cases)', () => {
  const { dir, env } = draftRepo();
  const manual = acc(dir, ['draft', 'criteria', 'T-1', '--json'], undefined, env);
  assert.equal(manual.code, 1);
  assert.match(JSON.parse(manual.out).message, /has no ticket/);
  for (const role of ['builder', 'reviewer', 'analyst']) {
    const r = acc(dir, ['draft', 'criteria', 'ACME-7', '--json'], undefined, { ...env, ACC_ROLE: role, ACC_TASK: 'ACME-7' });
    assert.equal(r.code, 1, role);
    assert.match(JSON.parse(r.out).message, /can't draft a ticket's acceptance criteria/);
  }
  writeFileSync(join(dir, '.bad.json'), '{"key":"ACME-7"}');
  assert.match(JSON.parse(acc(dir, ['draft', 'criteria', 'ACME-7', '--ticket', join(dir, '.bad.json'), '--json'], undefined, env).out).message, /needs a key, a title/);
  assert.match(acc(dir, ['draft', 'criteria']).err, /acc draft criteria <id>/);
  assert.match(acc(dir, ['draft', 'nope', 'ACME-7']).err, /acc draft criteria <id>/);
  assert.match(JSON.parse(acc(dir, ['draft', 'show', 'ACME-7', '--json']).out).message, /no drafted acceptance criteria yet/);
  const junk = draftRepo({ criteria: [] });
  const r = acc(junk.dir, ['draft', 'criteria', 'ACME-7', '--json'], undefined, junk.env);
  assert.equal(r.code, 1);
  assert.match(JSON.parse(r.out).message, /held no acceptance criteria/);
  assert.ok(!existsSync(join(junk.dir, '.git', 'acc', 'criteria', 'ACME-7.json')), 'no draft is kept');
});
