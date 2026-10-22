// A plan starts with a conversation (T-111): the person's opening words and the planning agent's first answer,
// read-only, before the plan; the plan made from them in the same session; Skip to the plan as today; and Talk
// it through resuming that one session after. Claude Code is a fake that answers as its schema asks.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { type Analysis, analyze, readAnalysis, writeAnalysis } from '../src/analyze.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { mutate, readLedger, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import {
  isOpening, OPENING_ASK, OPENING_QUESTIONS_MAX, OPENING_SCHEMA, OPENING_SYSTEM, OPENING_VERSION, openingPrompt, openingSection, openingSession, openingTurns,
  parseOpeningReply, planningSession, startPlan,
} from '../src/plan-opening.ts';
import { parsePlanTicket } from '../src/plan-ticket.ts';
import { readTalk, talkingPath, talkLines, talkPlan, talkSection, talkSession, writeTalk } from '../src/plan-talk.ts';
import { fakeRunner, GENERIC_CONFIG, makeRepo, SF_CONFIG } from './support.ts';

const now = () => new Date('2026-10-22T12:00:00Z');

/** A repo with one task to do, from Jira, and no plan yet. */
function setup(raw: Record<string, unknown> = GENERIC_CONFIG) {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw) });
  const config = parseConfig(raw).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Track stage history', brief: 'Keep each stage change.' }], 'human', 'human:test', emit, now);
  });
  const id = readLedger(paths.ledger).tasks[0]!.id;
  return { dir, paths, config, id };
}

/** Claude Code's JSON result, as `claude -p --output-format json --json-schema` prints it. */
const result = (structured: unknown, session: string): RunResult => ({
  code: 0, stderr: '', stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: session, total_cost_usd: 0.1, structured_output: structured }),
});

const FIRST = {
  understood: 'You want each stage change kept for two years, for the pipeline report.',
  questions: [
    { question: 'Two years, or for ever?', why: 'It decides where history is kept.', options: ['Two years', 'For ever'], own: true },
    { question: 'Closed deals too?', why: 'Closed deals double the rows.', options: ['Open deals only', 'Closed deals too'], own: false },
  ],
};

/** The plan the analyst answers with, as its schema asks: one choice whose why names what the person said. */
const PLAN = {
  verdict: 'ready', summary: 'A custom object keeps each change.', requirements: { goal: '', criteria: [], assumptions: [], outOfScope: [] }, questions: [], findings: [], split: [],
  decisions: [{ title: 'Where history is kept', why: 'You said: two years, for the pipeline report.', options: [
    { id: '', name: 'Field history', means: '', pros: [], cons: ['18 months only'], effort: 'S', risks: [], touches: [] },
    { id: '', name: 'Custom object', means: '', pros: [], cons: ['More to build'], effort: 'M', risks: [], touches: [] },
  ], recommended: 'Custom object', because: 'You said: two years.' }],
  approach: { plan: ['Make Stage_History__c'], files: [], refactors: [], risks: [], tests: [], size: 'M' },
};

/** A runner whose claude answers in turn from `answers`, recording each call; git runs for real. */
function claude(answers: RunResult[], calls: { args: string[]; opts?: RunOptions }[] = []) {
  const fake = fakeRunner({});
  return (cmd: string, args: string[], opts?: RunOptions): RunResult => {
    if (cmd !== 'claude') return fake(cmd, args, opts);
    calls.push({ args, opts });
    return answers[calls.length - 1] ?? answers.at(-1)!;
  };
}

const TICKET = JSON.stringify({
  key: 'ACME-7', title: 'Track stage history', url: null, markdown: 'Keep each stage change.',
  comments: [{ author: 'Kelsey', created: '2026-10-20T09:00:00Z', markdown: 'Two years of history, please.' }], related: [],
});

test('the opening message starts a new session read-only, with the whole ticket, and the agent\'s first answer is kept before the plan', () => {
  const { paths, config, id } = setup(SF_CONFIG);
  const calls: { args: string[]; opts?: RunOptions }[] = [];
  const task = readLedger(paths.ledger).tasks[0]!;
  const r = startPlan(paths, config, id, 'Keep it for the pipeline report, two years at least.', { run: claude([result(FIRST, 'sess-open')], calls), now, env: {}, accCommand: 'acc', uuid: () => 'sess-open' }, 'human:me', parsePlanTicket(TICKET, task));
  const line = calls[0]!.args.join(' ');
  assert.ok(line.startsWith('-p --session-id sess-open --name '), line.slice(0, 80));
  assert.match(line, /--disallowedTools Edit Write NotebookEdit WebFetch WebSearch/, 'read-only');
  assert.match(line, /--settings .*acc hook pre-tool-use/, 'acc\'s hook checks every command');
  assert.match(line, /--json-schema .*"understood"/);
  assert.equal(calls[0]!.opts?.env?.ACC_ROLE, 'analyst');
  const input = String(calls[0]!.opts?.input);
  assert.match(input, /### Kelsey, 2026-10-20\n\nTwo years of history, please\./, 'the whole ticket, comments included (T-110)');
  assert.ok(input.includes(`# ${OPENING_ASK}\n\nKeep it for the pipeline report, two years at least.`), 'the person\'s words, under the question asked');
  assert.deepEqual([r.turn.who, r.turn.version, r.reply.who, r.reply.version, r.reply.text, r.reply.sessionId], ['you', OPENING_VERSION, 'agent', OPENING_VERSION, FIRST.understood, 'sess-open']);
  assert.deepEqual([r.reply.questions, r.reply.unsure, r.reply.asks], [FIRST.questions, undefined, undefined], 'its questions as data, and nothing listed apart');
  assert.equal(readAnalysis(paths, id), null, 'no plan is made');
  assert.deepEqual(openingTurns(readTalk(paths, id)).map((t) => t.id), ['t1', 't2']);
  assert.equal(isOpening(r.reply), true);
});

test('an answer to the agent\'s questions resumes the same session, without the ticket again', () => {
  const { paths, config, id } = setup();
  const calls: { args: string[]; opts?: RunOptions }[] = [];
  const deps = { run: claude([result(FIRST, 'sess-open'), result({ understood: 'Two years, open and closed.', questions: [] }, 'sess-open')], calls), now, env: {}, uuid: () => 'sess-open' };
  startPlan(paths, config, id, 'Two years.', deps, 'human:me');
  const r = startPlan(paths, config, id, 'Closed deals too.', deps, 'human:me');
  assert.ok(calls[1]!.args.join(' ').startsWith('-p --resume sess-open --permission-mode dontAsk'), calls[1]!.args.join(' ').slice(0, 80));
  assert.ok(!String(calls[1]!.opts?.input).includes('## The ticket'), 'the session holds the ticket already');
  assert.match(String(calls[1]!.opts?.input), /# The person says\n\nClosed deals too\./);
  assert.deepEqual(r.reply.questions, []);
  assert.equal(openingSession(readTalk(paths, id)), 'sess-open');
});

test('Draft the plan resumes the opening\'s session, and its prompt holds what the person said first, for the plan to name', () => {
  const { paths, config, id } = setup();
  startPlan(paths, config, id, 'Keep it for the pipeline report, two years at least.', { run: claude([result(FIRST, 'sess-open')]), now, env: {}, uuid: () => 'sess-open' }, 'human:me');
  const calls: { args: string[]; opts?: RunOptions }[] = [];
  const a = analyze(paths, config, id, { run: claude([result(PLAN, 'sess-open')], calls), now, env: {}, uuid: () => 'sess-new' });
  const line = calls[0]!.args.join(' ');
  assert.ok(line.startsWith('-p --resume sess-open --permission-mode dontAsk'), 'one session from the start');
  assert.ok(!line.includes('sess-new'));
  const input = String(calls[0]!.opts?.input);
  assert.match(input, /## What the person said before the plan\n\n- The person: Keep it for the pipeline report, two years at least\.\n- You \(the planning agent\): You want each stage change/);
  assert.match(input, /  - Asked: Two years, or for ever\? \(offered: Two years; For ever\)\n  - Asked: Closed deals too\?/);
  assert.match(input, /starting "You said: " with their words/, 'the plan names what it took from it');
  assert.ok(!input.includes('## What the person and the planning agent said about the plan'), 'the opening isn\'t given twice');
  assert.equal(a.sessionId, 'sess-open');
  assert.match(a.decisions![0]!.because, /^You said: /);
  const last = readTalk(paths, id).turns.at(-1)!;
  assert.deepEqual([last.who, last.text, last.version], ['plan', 'Made v1 from this conversation.', 1]);
});

test('Skip to the plan makes it as today: a new session, from the ticket alone, with nothing said first', () => {
  const { paths, config, id } = setup();
  const calls: { args: string[]; opts?: RunOptions }[] = [];
  analyze(paths, config, id, { run: claude([result(PLAN, 'sess-new')], calls), now, env: {}, uuid: () => 'sess-new' });
  assert.ok(calls[0]!.args.join(' ').startsWith('-p --session-id sess-new --name '));
  assert.ok(!String(calls[0]!.opts?.input).includes('What the person said before the plan'));
  assert.deepEqual(readTalk(paths, id).turns, [], 'the conversation says nothing');
});

test('edge case: Skip to the plan after something was said leaves it out, starts a new session, and doesn\'t say it was made from it', () => {
  const { paths, config, id } = setup();
  startPlan(paths, config, id, 'Two years.', { run: claude([result(FIRST, 'sess-open')]), now, env: {}, uuid: () => 'sess-open' }, 'human:me');
  const calls: { args: string[]; opts?: RunOptions }[] = [];
  analyze(paths, config, id, { run: claude([result(PLAN, 'sess-new')], calls), now, env: {}, uuid: () => 'sess-new' }, { skipOpening: true });
  assert.ok(calls[0]!.args.join(' ').startsWith('-p --session-id sess-new '));
  assert.ok(!String(calls[0]!.opts?.input).includes('What the person said before the plan'));
  assert.ok(!readTalk(paths, id).turns.some((t) => t.who === 'plan'));
});

test('Talk it through after the plan resumes the same planning session, and a later version keeps what was said first', () => {
  const { paths, config, id } = setup();
  startPlan(paths, config, id, 'Two years.', { run: claude([result(FIRST, 'sess-open')]), now, env: {}, uuid: () => 'sess-open' }, 'human:me');
  const a = analyze(paths, config, id, { run: claude([result(PLAN, 'sess-open')]), now, env: {} });
  const calls: { args: string[]; opts?: RunOptions }[] = [];
  talkPlan(paths, config, id, 'Why a custom object?', null, { run: claude([result({ reply: 'Two years, as you said.', proposals: [], questions: [] }, 'sess-open')], calls), now, env: {} }, 'human:me');
  assert.ok(calls[0]!.args.join(' ').startsWith('-p --resume sess-open '), 'the talk resumes it too');
  assert.equal(talkSession(a, readTalk(paths, id)), 'sess-open');
  // The next version resumes the newest of the session's replies, holds the opening once and the talk once.
  const later = new Date('2026-10-22T13:00:00Z');
  const t = readTalk(paths, id);
  t.turns.at(-1)!.at = later.toISOString();
  t.turns.at(-1)!.sessionId = 'sess-later';
  writeTalk(paths, t);
  assert.equal(planningSession(readTalk(paths, id), a), 'sess-later');
  const section = talkSection(paths, id, a).join('\n');
  assert.match(section, /The person \(v1\): Why a custom object\?/);
  assert.ok(!section.includes('Two years.'), 'the opening has its own section');
  assert.match(talkLines(readTalk(paths, id), a).join('\n'), /The person \(before the plan\): Two years\./, 'Claude Code\'s brief says when it was said');
});

test('edge case: a task with a plan, a reply under way, an empty message or one too long is refused, and a failed answer keeps what was said', () => {
  const { paths, config, id } = setup();
  const deps = { run: claude([{ code: 1, stdout: '', stderr: 'boom' }]), now, env: {} };
  assert.throws(() => startPlan(paths, config, id, '  ', deps, 'human:me'), /Say what you want to do/);
  assert.throws(() => startPlan(paths, config, id, 'x'.repeat(4001), deps, 'human:me'), /longer than 4000/);
  mkdirSync(paths.analyses, { recursive: true });
  writeFileSync(talkingPath(paths, id), JSON.stringify({ pid: process.pid, startedAt: now().toISOString() }));
  assert.throws(() => startPlan(paths, config, id, 'Hi', deps, 'human:me'), /still answering/);
  writeFileSync(talkingPath(paths, id), JSON.stringify({ pid: 999_999_999, startedAt: now().toISOString() }));
  assert.throws(() => startPlan(paths, config, id, 'Two years.', deps, 'human:me'), /gave no reply/, 'a dead process\'s marker doesn\'t hold it up');
  const kept = readTalk(paths, id).turns;
  assert.deepEqual(kept.map((t) => [t.who, t.text, !!t.failed]), [['you', 'Two years.', true]], 'what was said is kept, with why no answer came');
  assert.equal(openingSession(readTalk(paths, id)), null, 'no answer, no session yet');
  writeAnalysis(paths, { ...(PLAN as unknown as Analysis), v: 1, task: id, env: 'main', base: 'x', orgs: [], sessionId: 's', at: now().toISOString(), durationMs: 0, costUsd: null, version: 1 });
  assert.throws(() => startPlan(paths, config, id, 'Hi', deps, 'human:me'), /has a plan already/);
});

test('edge case: the reply\'s questions are cut to three, blanks are dropped, and one that isn\'t JSON says what came back', () => {
  const q = (question: string) => ({ question, why: 'w', options: ['a', 'b'], own: false });
  const r = parseOpeningReply(result({ understood: ' It. ', questions: [q('1'), q(' '), q('2'), q('3'), q('4')] }, 's').stdout);
  assert.deepEqual([r.understood, r.questions.map((x) => x.question), r.sessionId], ['It.', ['1', '2', '3'], 's']);
  assert.equal(OPENING_QUESTIONS_MAX, 3);
  assert.equal(OPENING_SCHEMA.properties.questions.maxItems, 3);
  assert.deepEqual(OPENING_SCHEMA.required, ['understood', 'questions'], 'nothing unsure listed apart');
  assert.throws(() => parseOpeningReply('nope'), /no reply Claude Code could read: nope/);
  assert.throws(() => parseOpeningReply(result({ understood: '', questions: [] }, 's').stdout), /didn't reply/);
  assert.match(OPENING_SYSTEM, /at most about 80 words/);
  assert.match(OPENING_SYSTEM, /can't change anything/);
});

test('edge case: a reply kept before T-113 still gives its questions and what it was unsure of to the plan', () => {
  const t = { v: 1 as const, task: 'ACME-7', turns: [
    { id: 't1', who: 'you' as const, by: 'human:me', at: '2026-10-22T11:00:00Z', version: 0, text: 'Two years.' },
    { id: 't2', who: 'agent' as const, by: 'analyst:ACME-7', at: '2026-10-22T11:01:00Z', version: 0, text: 'Got it.', unsure: ['Closed deals'], asks: ['Closed deals too?'] },
  ] };
  assert.deepEqual(openingSection(t).slice(2, 6), ['- The person: Two years.', '- You (the planning agent): Got it.', '  - Unsure: Closed deals', '  - Asked: Closed deals too?']);
});

test('edge case: before anything is said there is no opening section and no planning session; the prompt without a ticket is the person\'s words', () => {
  const empty = { v: 1 as const, task: 'ACME-7', turns: [] };
  assert.deepEqual(openingSection(empty), []);
  assert.equal(planningSession(empty, { sessionId: 'p', at: '2026-10-22T11:00:00Z' }), null, 'a plan made without one keeps today\'s way');
  assert.equal(openingPrompt({ id: 'ACME-7', title: 'T' }, ' Hi ', null), '# The person says\n\nHi\n\nAnswer them: what you understood, briefly, and your questions, if any.');
});
