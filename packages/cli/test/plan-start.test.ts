// acc plan start (T-111): a plan starts with a conversation. The person says what they're thinking, the
// planning agent answers what it understood, and acc analyze then resumes that session; --skip-opening doesn't.
// acc runs from its source, in throwaway repos, with a fake claude.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GENERIC_CONFIG } from '../../core/test/support.ts';
import { TALK_HELP, TALK_SUBCOMMANDS } from '../src/commands/plan-talk.ts';
import { cli, repoWithConfig } from './support.ts';
import { standIn } from '../../core/test/stand-in.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

/** A repo with ACME-7 to do and no plan, and a claude that answers with `answer`, keeping its arguments and prompt. */
function openRepo() {
  const dir = repoWithConfig(GENERIC_CONFIG);
  assert.equal(acc(dir, ['import'], JSON.stringify([{ source: { kind: 'jira', key: 'ACME-7' }, title: 'Track stage history' }])).code, 0);
  const answer = (structured: unknown) => writeFileSync(join(dir, '.answer.json'), JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'sess-open', total_cost_usd: 0.1, structured_output: structured }));
  answer({ understood: 'You want two years of stage history.', questions: [{ question: 'Closed deals too?', why: 'They double the rows.', options: ['Open only', 'Closed too'], own: false }] });
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  standIn(join(bin, 'claude'), `#!/bin/sh\necho "$@" >> "${dir}/.claude-args"\ncat > "${dir}/.claude-prompt"\ncat "${dir}/.answer.json"\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  return { dir, answer, store: join(dir, '.git', 'acc', 'analyses'), env: { PATH: `${bin}${delimiter}${process.env.PATH}`, USER: 'jordan' } };
}

/** Each call's arguments, from its -p: the system prompt they carry spans lines. */
const args = (dir: string): string[] => readFileSync(join(dir, '.claude-args'), 'utf8').split('\n').filter((l) => l.startsWith('-p '));

test('acc plan start prints what the agent understood and its questions, and acc analyze then resumes that session with what was said', () => {
  const { dir, answer, store, env } = openRepo();
  const ticket = join(dir, '.ticket.json');
  writeFileSync(ticket, JSON.stringify({ key: 'ACME-7', title: 'Track stage history', markdown: 'Keep it.', comments: [{ author: 'Kelsey', created: '2026-10-20', markdown: 'Two years.' }], related: [] }));
  const r = acc(dir, ['plan', 'start', 'acme-7', '--message=Two years, for the report.', '--ticket', ticket], undefined, env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /What do you want to do here, and what are you thinking\?\nYou want two years of stage history\./);
  assert.match(r.out, /  1\. Closed deals too\?\n     a\) Open only \(suggested\)\n     b\) Closed too/, 'each question with its answers, the suggestion first');
  assert.match(args(dir)[0]!, /^-p --session-id \S+ --name .+--json-schema .+"understood"/);
  assert.match(readFileSync(join(dir, '.claude-prompt'), 'utf8'), /### Kelsey, 2026-10-20\n\nTwo years\./, 'the whole ticket the Command Center read');
  const talk = JSON.parse(readFileSync(join(store, 'ACME-7.talk.json'), 'utf8'));
  assert.deepEqual(talk.turns.map((t: { who: string; version: number }) => `${t.who} v${t.version}`), ['you v0', 'agent v0']);
  answer({ verdict: 'ready', summary: 'Keep it.', requirements: { goal: '', criteria: [], assumptions: [], outOfScope: [] }, questions: [], decisions: [], findings: [], approach: { plan: [], files: [], refactors: [], risks: [], tests: [], size: 'S' }, split: [] });
  const a = acc(dir, ['analyze', 'ACME-7'], undefined, env);
  assert.equal(a.code, 0, a.err);
  assert.match(args(dir)[1]!, /^-p --resume sess-open --permission-mode dontAsk /, 'one session from the start');
  assert.match(readFileSync(join(dir, '.claude-prompt'), 'utf8'), /## What the person said before the plan\n\n- The person: Two years, for the report\./);
});

test('edge cases: acc analyze --skip-opening plans as today; acc plan start with no message, or once there is a plan, is refused; an agent may not start one', () => {
  const { dir, answer, env } = openRepo();
  assert.equal(acc(dir, ['plan', 'start', 'ACME-7'], undefined, env).code, 2, 'no message');
  assert.equal(acc(dir, ['plan', 'start', 'ACME-7', 'Hi'], undefined, env).code, 0);
  answer({ verdict: 'ready', summary: 'Keep it.', requirements: { goal: '', criteria: [], assumptions: [], outOfScope: [] }, questions: [], decisions: [], findings: [], approach: { plan: [], files: [], refactors: [], risks: [], tests: [], size: 'S' }, split: [] });
  assert.equal(acc(dir, ['analyze', 'ACME-7', '--skip-opening'], undefined, env).code, 0);
  assert.match(args(dir)[1]!, /^-p --session-id /, 'a new session');
  assert.ok(!readFileSync(join(dir, '.claude-prompt'), 'utf8').includes('What the person said before the plan'));
  const again = acc(dir, ['plan', 'start', 'ACME-7', 'Hi', '--json'], undefined, env);
  assert.notEqual(again.code, 0);
  assert.match(again.out + again.err, /has a plan already/);
  const agent = acc(dir, ['plan', 'start', 'ACME-7', 'Hi'], undefined, { ...env, ACC_ROLE: 'builder', ACC_TASK: 'ACME-7' });
  assert.notEqual(agent.code, 0, 'only a person starts a plan');
  assert.ok(TALK_SUBCOMMANDS.includes('start'));
  assert.match(TALK_HELP, /acc plan start <id> "<message>"/);
});
