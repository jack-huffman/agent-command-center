// The planning agent's questions as data (T-113): each with why, two to four answers with the suggestion first,
// and whether the person may answer in their own words; at most three a reply; the prompts keep the prose short;
// and the person's answers go back together as one message. Claude Code is a fake that answers as its schema asks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type Analysis, writeAnalysis } from '../src/analyze.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { mutate, readLedger, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { OPENING_SCHEMA, OPENING_SYSTEM, startPlan } from '../src/plan-opening.ts';
import { readTalk, TALK_SCHEMA, TALK_SYSTEM, talkLines, talkPlan } from '../src/plan-talk.ts';
import {
  ANSWER_MAX, answersText, askedLine, askOfWords, OPTIONS_MAX, OPTIONS_MIN, parseQuestions, QUESTIONS_MAX, QUESTIONS_SCHEMA, REPLY_RULES, REPLY_WORDS, type TalkAsk, turnQuestions,
} from '../src/talk-questions.ts';
import { fakeRunner, GENERIC_CONFIG, makeRepo } from './support.ts';

const now = () => new Date('2026-10-22T12:00:00Z');

const ROLE: TalkAsk = { question: 'Should integration users\' conversions get the role too?', why: 'Most leads come from the web form.', options: ['Yes, them too', 'No, people only'], own: true };
const KEEP: TalkAsk = { question: 'If the account has a Decision Maker already, keep it?', why: 'Two would double the report.', options: ['Keep it, add none', 'Add another', 'Replace it'], own: false };
const WHEN: TalkAsk = { question: 'From when?', why: 'Older deals were left out.', options: ['From now on', 'Backfill this year'], own: true };

/** A repo with one task to do, and, with `plan`, its plan v1. */
function setup(plan = false) {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  const config = parseConfig(GENERIC_CONFIG).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-21', url: null }, title: 'Lead conversion', brief: 'Give the role.' }], 'human', 'human:test', emit, now);
  });
  const id = readLedger(paths.ledger).tasks[0]!.id;
  if (plan) {
    writeAnalysis(paths, {
      v: 1, task: id, env: 'main', base: 'x', verdict: 'ready', summary: 'Give the role.', requirements: { goal: '', criteria: [], assumptions: [], outOfScope: [] }, questions: [], decisions: [],
      findings: [], approach: { plan: ['Add a flow'], files: [], refactors: [], risks: [], tests: [], size: 'S' }, split: [],
      orgs: [], sessionId: 'sess-plan', at: '2026-10-22T11:00:00Z', durationMs: 0, costUsd: null, version: 1,
    } as Analysis);
  }
  return { paths, config, id };
}

const result = (structured: unknown, session = 'sess'): RunResult => ({
  code: 0, stderr: '', stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: session, total_cost_usd: 0.1, structured_output: structured }),
});

/** A runner whose claude answers in turn from `answers`, recording each call; git runs for real. */
function claude(answers: RunResult[], calls: { args: string[]; opts?: RunOptions }[] = []) {
  const fake = fakeRunner({});
  return (cmd: string, args: string[], opts?: RunOptions): RunResult => {
    if (cmd !== 'claude') return fake(cmd, args, opts);
    calls.push({ args, opts });
    return answers[calls.length - 1] ?? answers.at(-1)!;
  };
}

test('both replies\' schemas ask for questions as data: why, two to four answers with the suggestion first, and own words, at most three', () => {
  assert.equal(OPENING_SCHEMA.properties.questions, QUESTIONS_SCHEMA);
  assert.equal(TALK_SCHEMA.properties.questions, QUESTIONS_SCHEMA);
  assert.equal(QUESTIONS_SCHEMA.maxItems, QUESTIONS_MAX);
  assert.equal(QUESTIONS_MAX, 3);
  const item = QUESTIONS_SCHEMA.items;
  assert.deepEqual(item.required, ['question', 'why', 'options', 'own']);
  assert.deepEqual([item.properties.options.minItems, item.properties.options.maxItems], [OPTIONS_MIN, OPTIONS_MAX]);
  assert.deepEqual([OPTIONS_MIN, OPTIONS_MAX], [2, 4]);
  assert.match(item.properties.options.description, /Your suggestion first/);
  assert.equal(item.properties.own.type, 'boolean');
});

test('the prompts keep the reply short: about 80 words, no questions in its prose, and what is unsure folded into the questions', () => {
  assert.equal(REPLY_WORDS, 80);
  for (const system of [OPENING_SYSTEM, TALK_SYSTEM]) {
    assert.ok(system.includes(REPLY_RULES), 'each prompt carries the rules');
    assert.match(system, /at most about 80 words/);
    assert.match(system, /No lists of questions in it/);
    assert.match(system, /fold it into your questions/);
    assert.match(system, /your suggestion first/);
  }
  assert.match(OPENING_SCHEMA.properties.understood.description, /At most about 80 words, and no questions/);
  assert.match(TALK_SCHEMA.properties.reply.description, /At most about 80 words, and no questions/);
});

test('edge case: questions with no words, blank or repeated answers, or too many are cut, and one left with under two answers takes own words', () => {
  const got = parseQuestions([
    { question: '  ', why: 'x', options: ['a', 'b'], own: false },
    { question: ' Q1 ', why: ' w ', options: [' a ', 'a', '', 'b', 'c', 'd', 'e'], own: false },
    { question: 'Q2', why: 'w', options: ['only'], own: false },
    { question: 'Q3', options: 'not a list' },
    { question: 'Q4', why: 'w', options: ['a', 'b'], own: true },
  ]);
  assert.deepEqual(got, [
    { question: 'Q1', why: 'w', options: ['a', 'b', 'c', 'd'], own: false },
    { question: 'Q2', why: 'w', options: [], own: true },
    { question: 'Q3', why: '', options: [], own: true },
  ]);
  assert.deepEqual(parseQuestions(undefined), [], 'a reply without the field has none');
  assert.deepEqual(parseQuestions('three'), []);
});

test('edge case: a reply kept before T-113 gives its questions as words, answered in the person\'s own words', () => {
  assert.deepEqual(askOfWords('Closed deals too?'), { question: 'Closed deals too?', why: '', options: [], own: true });
  assert.deepEqual(turnQuestions({ asks: ['A?'] }), [askOfWords('A?')]);
  assert.deepEqual(turnQuestions({ questions: [ROLE], asks: ['A?'] }), [ROLE], 'structured questions win');
  assert.deepEqual(turnQuestions({}), []);
  assert.equal(askedLine(ROLE), '  - Asked: Should integration users\' conversions get the role too? (offered: Yes, them too; No, people only)');
  assert.equal(askedLine(askOfWords('A?')), '  - Asked: A?');
});

test('the answers go as one message: each numbered with its question, an option, own words, or (skipped)', () => {
  assert.equal(answersText([ROLE, KEEP, WHEN], [{ option: 0 }, null, { text: '  Backfill from 1 January  ' }]), [
    '1. Should integration users\' conversions get the role too?', '   Yes, them too',
    '2. If the account has a Decision Maker already, keep it?', '   (skipped)',
    '3. From when?', '   Backfill from 1 January',
  ].join('\n'));
  assert.ok(ANSWER_MAX * QUESTIONS_MAX < 4000, 'three answers of the longest fit in one message');
});

test('edge case: an answer missing, blank, or naming an option the question doesn\'t have counts as skipped', () => {
  assert.equal(answersText([KEEP, WHEN, ROLE], [{ option: 7 }, { text: '   ' }]), [
    '1. If the account has a Decision Maker already, keep it?', '   (skipped)', '2. From when?', '   (skipped)', '3. Should integration users\' conversions get the role too?', '   (skipped)',
  ].join('\n'));
  assert.equal(answersText([], []), '', 'no questions, no message');
});

test('with a fake agent: the opening reply keeps its questions, and the answers go back as the person\'s one next turn, which the agent answers', () => {
  const { paths, config, id } = setup();
  const calls: { args: string[]; opts?: RunOptions }[] = [];
  const deps = { run: claude([result({ understood: 'Every conversion gets the role.', questions: [ROLE, KEEP, WHEN] }), result({ understood: 'Clear.', questions: [] })], calls), now, env: {}, uuid: () => 'sess' };
  const first = startPlan(paths, config, id, 'Reps forget the roles.', deps, 'human:me');
  assert.deepEqual(first.reply.questions, [ROLE, KEEP, WHEN]);
  assert.match(String(calls[0]!.args.join(' ')), /"options":\{"type":"array","minItems":2,"maxItems":4/, 'Claude Code checks the questions\' shape');
  const text = answersText(first.reply.questions!, [{ option: 0 }, null, { text: 'From now on, no backfill' }]);
  const second = startPlan(paths, config, id, text, deps, 'human:me');
  const turns = readTalk(paths, id).turns;
  assert.deepEqual(turns.map((t) => t.who), ['you', 'agent', 'you', 'agent'], 'the three answers are one turn');
  assert.equal(turns[2]!.text, text);
  assert.match(String(calls[1]!.opts?.input), /1\. Should integration users' conversions get the role too\?\n   Yes, them too\n2\. .+\n   \(skipped\)\n3\. From when\?\n   From now on, no backfill/);
  assert.equal(second.reply.text, 'Clear.');
});

test('with a fake agent: Talk it through keeps a reply\'s questions on its turn, says how many it asks, and the conversation\'s lines name them', () => {
  const { paths, config, id } = setup(true);
  const said: string[] = [];
  const steps = { step: <T>(_: string, __: string, f: () => T) => f(), start: () => {}, done: (_: string, s: string) => { said.push(s); }, fail: () => {}, result: () => {} };
  const r = talkPlan(paths, config, id, 'Why a flow?', null, { run: claude([result({ reply: 'A flow runs on conversion.', proposals: [], questions: [KEEP, { ...WHEN, options: ['x'] }] })]), now, env: {}, steps: steps as never }, 'human:me');
  assert.deepEqual(r.reply.questions, [KEEP, { ...WHEN, options: [], own: true }]);
  assert.deepEqual(said, ['It asks 2 questions']);
  assert.match(talkLines(readTalk(paths, id), null).join('\n'), /- You \(the planning agent\) \(v1\): A flow runs on conversion\.\n  - Asked: If the account has a Decision Maker already, keep it\? \(offered: Keep it, add none; Add another; Replace it\)\n  - Asked: From when\?/);
});
