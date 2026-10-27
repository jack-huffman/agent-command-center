// acc analyze --ticket (T-110): the whole ticket, as the Command Center read it, reaches the planning agent, and the
// plan keeps what it read. acc runs from its source, with a fake claude.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GENERIC_CONFIG } from '../../core/test/support.ts';
import { cli, repoWithConfig } from './support.ts';
import { standIn } from '../../core/test/stand-in.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

const ANSWER = {
  verdict: 'ready', summary: 'Send back 77 contacts by Wednesday (Kelsey, 2026-10-20).',
  requirements: { goal: 'The team sends back 77 contacts.', criteria: ['The team sends back 77 contacts.'], assumptions: [], outOfScope: [] },
  questions: [], decisions: [], findings: [], approach: { plan: ['Send them'], files: [], refactors: [], risks: [], tests: [], size: 'S' }, split: [],
};

/** A repo with a Jira task, and a claude that answers ANSWER, keeping its prompt. */
function planRepo() {
  const dir = repoWithConfig(GENERIC_CONFIG);
  assert.equal(acc(dir, ['import'], JSON.stringify([{ source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Send back the contacts', brief: 'Return the 70 contacts by Friday.' }])).code, 0);
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  writeFileSync(join(dir, '.answer.json'), JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'sess-plan', total_cost_usd: 0.1, structured_output: ANSWER }));
  standIn(join(bin, 'claude'), `#!/bin/sh\ncat > "${dir}/.claude-prompt"\ncat "${dir}/.answer.json"\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  return { dir, env: { PATH: `${bin}${delimiter}${process.env.PATH}` } };
}

test('acc analyze --ticket gives the planning agent every comment, and the plan keeps how many it read and the newest', () => {
  const { dir, env } = planRepo();
  writeFileSync(join(dir, '.ticket.json'), JSON.stringify({
    key: 'ACME-7', title: 'Send back the contacts', url: null, markdown: 'Return the 70 contacts by Friday.',
    comments: [{ author: 'Kelsey', created: '2026-10-20T15:30:00Z', markdown: 'Kelsey and Mike will send back the 77 contacts by Wednesday.' }],
    related: [{ key: 'ACME-3', title: 'Contacts clean-up', relation: 'parent', state: 'In Progress' }], attachments: [], changes: null,
  }));
  const r = acc(dir, ['analyze', 'ACME-7', '--ticket', join(dir, '.ticket.json'), '--json'], undefined, env);
  assert.equal(r.code, 0, r.err);
  const a = JSON.parse(r.out);
  assert.deepEqual(a.ticket, { full: true, why: null, comments: 1, omitted: 0, newest: { author: 'Kelsey', created: '2026-10-20T15:30:00Z' }, related: 1, attachments: 0, changes: null });
  const prompt = readFileSync(join(dir, '.claude-prompt'), 'utf8');
  assert.match(prompt, /### Kelsey, 2026-10-20\n\nKelsey and Mike will send back the 77 contacts by Wednesday\./);
  assert.match(prompt, /- parent: ACME-3 Contacts clean-up \(In Progress\)/);
  // The person reads what it read.
  assert.match(acc(dir, ['analysis', 'ACME-7']).out, /This plan read the ticket, its 1 comment and 1 related ticket\. The newest comment it read is Kelsey's, 2026-10-20\./);
});

test('edge: without --ticket, or with a ticket that couldn\'t be read, the plan reads the description and says why; a bad file stops it first', () => {
  const { dir, env } = planRepo();
  const plain = JSON.parse(acc(dir, ['analyze', 'ACME-7', '--json'], undefined, env).out);
  assert.equal(plain.ticket.full, false);
  assert.match(plain.ticket.why, /wasn't read from its tracker/);
  writeFileSync(join(dir, '.unread.json'), JSON.stringify({ key: 'ACME-7', unread: 'Jira said the sign-in has expired.' }));
  const unread = JSON.parse(acc(dir, ['analyze', 'ACME-7', '--ticket', join(dir, '.unread.json'), '--json'], undefined, env).out);
  assert.equal(unread.ticket.why, 'Jira said the sign-in has expired.');
  assert.match(readFileSync(join(dir, '.claude-prompt'), 'utf8'), /_The comments were not read: Jira said the sign-in has expired\./);
  writeFileSync(join(dir, '.bad.json'), '{');
  const bad = acc(dir, ['analyze', 'ACME-7', '--ticket', join(dir, '.bad.json'), '--json'], undefined, env);
  assert.notEqual(bad.code, 0);
  assert.match(JSON.parse(bad.out).message, /isn't JSON/);
});
