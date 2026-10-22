// acc plan talk, use, note and claude (T-98): a person talks a plan through with its planning agent, uses what
// it proposes, notes the plan, and opens it in Claude Code. acc runs from its source, in throwaway repos.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GENERIC_CONFIG } from '../../core/test/support.ts';
import { recordedHere, TALK_HELP, TALK_SUBCOMMANDS, talkCommand } from '../src/commands/plan-talk.ts';
import { cli, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

const option = (id: string, name: string) => ({ id, name, means: '', pros: [], cons: [], effort: 'S', risks: [], touches: [] });

/** A repo with ACME-7 to do, its plan, and a claude that replies with a proposal to choose Custom object. */
function talkRepo() {
  const dir = repoWithConfig(GENERIC_CONFIG);
  assert.equal(acc(dir, ['import'], JSON.stringify([{ source: { kind: 'jira', key: 'ACME-7' }, title: 'Track stage history' }])).code, 0);
  const store = join(dir, '.git', 'acc', 'analyses');
  mkdirSync(store, { recursive: true });
  writeFileSync(join(store, 'ACME-7.json'), JSON.stringify({
    v: 1, task: 'ACME-7', env: 'main', base: 'x', verdict: 'ready', summary: 'Track Stage.', requirements: { goal: '', criteria: [], assumptions: [], outOfScope: [] },
    questions: [{ id: 'q1', question: 'Closed deals too?', why: '', suggested: 'Yes', askOf: 'you' }],
    decisions: [{ id: 'd1', title: 'Where history is kept', why: '', options: [option('a', 'Field history'), option('b', 'Custom object')], recommended: 'a', because: '' }],
    findings: [], approach: { plan: ['Turn on tracking'], files: [], refactors: [], risks: [], tests: [], size: 'S' }, split: [], orgs: [], sessionId: 'sess-plan', at: '2026-10-22T10:00:00Z', durationMs: 0, costUsd: null,
  }));
  writeFileSync(join(dir, '.answer.json'), JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, session_id: 'sess-talk', total_cost_usd: 0.1,
    structured_output: { reply: 'Field history keeps 18 months.', proposals: [{ kind: 'choose', decision: 'd1', option: 'Custom object', question: '', text: '', why: 'Two years of reports' }] },
  }));
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\necho "$@" >> "${dir}/.claude-args"\ncat > "${dir}/.claude-prompt"\ncat "${dir}/.answer.json"\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  return { dir, store, env: { PATH: `${bin}:${process.env.PATH}`, USER: 'jordan' } };
}

const talk = (store: string) => JSON.parse(readFileSync(join(store, 'ACME-7.talk.json'), 'utf8'));
const plan = (store: string) => JSON.parse(readFileSync(join(store, 'ACME-7.json'), 'utf8'));

test('acc plan talk resumes the plan\'s session and prints the reply, and acc plan use records its proposal as the person\'s choice', () => {
  const { dir, store, env } = talkRepo();
  const r = acc(dir, ['plan', 'talk', 'acme-7', 'Why', 'not', 'an', 'object?', '--about', 'd1.b'], undefined, env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Field history keeps 18 months\./);
  assert.match(r.out, /t2\.p1 Choose Custom object for Where history is kept: Two years of reports\. Use it with acc plan use ACME-7 t2 p1\./);
  assert.match(readFileSync(join(dir, '.claude-args'), 'utf8'), /^-p --resume sess-plan --permission-mode dontAsk /);
  assert.match(readFileSync(join(dir, '.claude-prompt'), 'utf8'), /About option d1\.b: "Where history is kept: Custom object"\n\nWhy not an object\?/);
  assert.deepEqual(talk(store).turns.map((t: { who: string; by: string }) => `${t.who} ${t.by}`), ['you human:jordan', 'agent analyst:ACME-7']);
  assert.equal(plan(store).decisions[0].choice, undefined, 'a reply changes nothing');
  const used = acc(dir, ['plan', 'use', 'ACME-7', 't2', 'p1', '--json'], undefined, env);
  assert.equal(used.code, 0, used.err);
  assert.equal(used.json().changed, true);
  assert.deepEqual({ ...plan(store).decisions[0].choice, at: '' }, { option: 'b', by: 'human:jordan', at: '' });
  assert.match(acc(dir, ['plan', 'use', 'ACME-7', 't2', 'p1'], undefined, env).out, /already says so: Choose Custom object.+Nothing changed\./);
});

test('edge cases: acc plan note is refused on an approved plan without --yes, a talk with no message, and an agent may not talk, use, note or open a plan', () => {
  const { dir, store, env } = talkRepo();
  assert.equal(acc(dir, ['plan', 'note', 'ACME-7', 'Name', 'it', 'Stage_History__c'], undefined, env).code, 0);
  assert.deepEqual(plan(store).notes.map((n: { text: string }) => n.text), ['Name it Stage_History__c']);
  assert.equal(acc(dir, ['analysis', 'answer', 'ACME-7', 'q1', 'Yes'], undefined, env).code, 0);
  assert.equal(acc(dir, ['plan', 'choose', 'ACME-7', 'd1', 'a'], undefined, env).code, 0);
  assert.equal(acc(dir, ['plan', 'approve', 'ACME-7'], undefined, env).code, 0);
  const refused = acc(dir, ['plan', 'note', 'ACME-7', 'Another'], undefined, env);
  assert.equal(refused.code, 1);
  assert.match(refused.out + refused.err, /This plan is approved\. A note changes it.+--yes/);
  assert.equal(acc(dir, ['plan', 'note', 'ACME-7', 'Another', '--yes'], undefined, env).code, 0);
  assert.equal(plan(store).approval, undefined, 'the yes undoes the approval');
  for (const role of ['analyst', 'builder', 'reviewer']) {
    for (const args of [['talk', 'ACME-7', 'Hi'], ['use', 'ACME-7', 't2', 'p1'], ['note', 'ACME-7', 'x'], ['claude', 'ACME-7']]) {
      const r = acc(dir, ['plan', ...args], undefined, { ...env, ACC_ROLE: role });
      assert.equal(r.code, 1, `${role} ${args[0]}`);
      assert.match(r.out + r.err, /can't .+ A person does that\./);
    }
  }
  assert.match(acc(dir, ['plan', 'talk', 'ACME-7'], undefined, env).err, /acc plan talk <id> "<message>"/, 'a message is needed');
});

test('edge cases: a word acc plan doesn\'t take for its talk is none of these, and a record outside a Claude Code session lands nowhere', () => {
  const { dir } = talkRepo();
  assert.equal(talkCommand({ json: false }, ['choose', 'ACME-7']), undefined);
  const was = process.env.ACC_PLAN_TALK;
  delete process.env.ACC_PLAN_TALK;
  try {
    assert.equal(recordedHere(dir, 'ACME-7', 'x'), false);
  } finally {
    if (was !== undefined) process.env.ACC_PLAN_TALK = was;
  }
});

test('acc plan claude gives Claude Code\'s plan-mode launch, and what that session records shows on its turn', () => {
  const { dir, store, env } = talkRepo();
  const r = acc(dir, ['plan', 'claude', 'ACME-7', '--json'], undefined, env);
  assert.equal(r.code, 0, r.err);
  const launch = r.json();
  // The prompt first, so --allowedTools can't swallow it as a tool.
  assert.match(launch.args[0], /^Read .+ first\./);
  assert.deepEqual(launch.args.slice(1, 3), ['--permission-mode', 'plan']);
  assert.match(readFileSync(launch.brief, 'utf8'), /## Recording to the plan/);
  // Its acc runs carry the session: a choice, an answer and a note each land on its turn.
  const inSession = { ...env, ...launch.env };
  assert.equal(acc(dir, ['plan', 'choose', 'ACME-7', 'd1', 'b'], undefined, inSession).code, 0);
  assert.equal(acc(dir, ['analysis', 'answer', 'ACME-7', 'q1', 'Only open ones'], undefined, inSession).code, 0);
  assert.equal(acc(dir, ['plan', 'note', 'ACME-7', 'Keep two years'], undefined, inSession).code, 0);
  // Outside the session, nothing lands on it.
  assert.equal(acc(dir, ['plan', 'note', 'ACME-7', 'From elsewhere'], undefined, env).code, 0);
  const turn = talk(store).turns.find((t: { who: string }) => t.who === 'claude-code');
  assert.deepEqual(turn.recorded, ['Chose Custom object for Where history is kept', 'Answered Closed deals too?: Only open ones', 'Note on the plan: Keep two years']);
  assert.match(acc(dir, ['plan', 'claude', 'ACME-7'], undefined, env).out, /^Run this in .+, with ACC_PLAN_TALK=ACME-7:/);
  assert.deepEqual([...TALK_SUBCOMMANDS], ['start', 'talk', 'use', 'note', 'claude']);
  assert.match(TALK_HELP, /acc plan talk <id>/);
});
