import assert from 'node:assert/strict';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type Analysis, analysisPath, analysisSection, analystDir, analystEnv, analystFlags, analyze, readAnalysis, writeAnalysis } from '../src/analyze.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { mutate, readLedger, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { approvePlan, CHANGE_APPROVED } from '../src/plan-choices.ts';
import {
  addTurn, ANSWER_APPROVED, briefPath, claudeBrief, NOTE_APPROVED, notePlan, openInClaude, parseTalkReply, proposalStale, proposalWords, quoteOf, readTalk, recordInSession, TALK_MAX,
  TALK_SCHEMA, TALK_SESSION_VAR, TALK_SYSTEM, talking, talkLines, talkPath, talkPlan, talkPrompt, talkSection, talkSession, useProposal, versionTurn, writeTalk,
} from '../src/plan-talk.ts';
import { fakeRunner, GENERIC_CONFIG, makeRepo, SF_CONFIG } from './support.ts';

const now = () => new Date('2026-10-22T12:00:00Z');

const option = (id: string, name: string, means = '') => ({ id, name, means, pros: [], cons: ['Costs a field'], effort: 'S' as const, risks: [], touches: [] });

/** A repo with one task to do and its plan, v1: a question for you, one choice of two options, two steps and a risk. */
function setup(raw: Record<string, unknown> = GENERIC_CONFIG, extra: Partial<Analysis> = {}) {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw) });
  const config = parseConfig(raw).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Track stage history', brief: 'Keep each stage change.' }], 'human', 'human:test', emit, now);
  });
  const id = readLedger(paths.ledger).tasks[0]!.id;
  writeAnalysis(paths, {
    v: 1, task: id, env: 'main', base: 'x', verdict: 'questions', summary: 'Keep each stage change.', requirements: { goal: '', criteria: [], assumptions: [], outOfScope: [] },
    questions: [{ id: 'q1', question: 'Closed deals too?', why: '', suggested: 'Yes', askOf: 'you' }],
    decisions: [{ id: 'd1', title: 'Where history is kept', why: 'Reports read it', options: [option('a', 'Field history', 'Track the field'), option('b', 'Custom object')], recommended: 'a', because: 'Less to build' }],
    findings: [], approach: { plan: ['Turn on tracking', 'Add a report'], files: [], refactors: [], risks: ['History is kept 18 months'], tests: [], size: 'S' }, split: [],
    orgs: [], sessionId: 'sess-plan', name: 'Acme · ACME-7 Track stage history · analysis', at: '2026-10-22T11:00:00Z', durationMs: 0, costUsd: null, version: 1, ...extra,
  });
  return { dir, paths, config, id };
}

/** Claude Code's JSON result for a reply, as `claude -p --output-format json --json-schema` prints it. */
const reply = (structured: unknown, session = 'sess-talk'): RunResult => ({
  code: 0, stderr: '', stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: session, total_cost_usd: 0.2, structured_output: structured }),
});

const SAYS = {
  reply: 'Field history keeps 18 months only (Opportunity: FieldHistoryArchive). A custom object keeps it all.',
  proposals: [
    { kind: 'choose', decision: 'd1', option: 'Custom object', question: '', text: '', why: 'Reports need two years' },
    { kind: 'note', decision: '', option: '', question: '', text: 'Step 2: the report reads the custom object', why: 'It follows the choice' },
  ],
};

/** A runner whose claude answers with `says`, recording each call; git runs for real. */
function claudeSays(says: RunResult | ((n: number) => RunResult), calls: { args: string[]; opts?: RunOptions }[] = []) {
  const fake = fakeRunner({});
  return (cmd: string, args: string[], opts?: RunOptions): RunResult => {
    if (cmd !== 'claude') return fake(cmd, args, opts);
    calls.push({ args, opts });
    return typeof says === 'function' ? says(calls.length) : says;
  };
}

test('a message resumes the plan\'s own session read-only, with the analyst\'s tools and hook, and the reply is kept', () => {
  const { paths, config, id } = setup(SF_CONFIG);
  const calls: { args: string[]; opts?: RunOptions }[] = [];
  const r = talkPlan(paths, config, id, 'Why not a custom object?', 'd1.b', { run: claudeSays(reply(SAYS), calls), now, env: { PATH: '/bin' }, accCommand: 'acc' }, 'human:me');
  const line = calls[0]!.args.join(' ');
  assert.ok(line.startsWith('-p --resume sess-plan --permission-mode dontAsk --model '), line.slice(0, 120));
  assert.match(line, /--disallowedTools Edit Write NotebookEdit WebFetch WebSearch/);
  assert.match(line, /Bash\(sf data query:\*\)/, 'on Salesforce, its org reads');
  assert.ok(!/Bash\(sf project deploy/.test(line), 'no writes');
  assert.match(line, /--settings .*acc hook pre-tool-use/, 'acc\'s hook checks every command');
  assert.match(line, /--json-schema .*"proposals"/);
  assert.equal(calls[0]!.opts?.env?.ACC_ROLE, 'analyst', 'the hook reads it as the analyst');
  assert.match(String(calls[0]!.opts?.cwd), /analyses.+\.work$/, 'the plan\'s own scratch project, where its session was saved');
  const input = String(calls[0]!.opts?.input);
  assert.match(input, /About option d1\.b: "Where history is kept: Custom object"/);
  assert.match(input, /Why not a custom object\?/);
  assert.match(input, /d1\. Where history is kept: options a\) Field history, b\) Custom object; recommends Field history; not chosen yet/);
  assert.deepEqual([r.turn.who, r.turn.text, r.turn.about?.kind, r.reply.who, r.reply.sessionId], ['you', 'Why not a custom object?', 'option', 'agent', 'sess-talk']);
  assert.deepEqual(readTalk(paths, id).turns.map((t) => `${t.id} ${t.who}`), ['t1 you', 't2 agent']);
  assert.equal(talking(paths, id), null, 'the running marker is gone');
  // The next message carries on the agent's own session.
  talkPlan(paths, config, id, 'And the report?', null, { run: claudeSays(reply(SAYS), calls), now, env: {} }, 'human:me');
  assert.ok(calls[1]!.args.join(' ').startsWith('-p --resume sess-talk '));
  assert.equal(readAnalysis(paths, id)!.decisions![0]!.choice, undefined, 'a reply changes nothing in the plan');
});

test('a reply\'s proposals are read against the plan, and one naming what the plan lacks is left out', () => {
  const { paths, id } = setup();
  const a = readAnalysis(paths, id)!;
  const p = parseTalkReply(reply({
    reply: 'Here.',
    proposals: [
      ...SAYS.proposals,
      { kind: 'own', decision: 'D1', option: '', question: '', text: 'Both: tracking now, an object later', why: '' },
      { kind: 'answer', decision: '', option: '', question: 'q1', text: 'Yes, all of them', why: '' },
      { kind: 'choose', decision: 'd9', option: 'Custom object', question: '', text: '', why: 'no such choice' },
      { kind: 'choose', decision: 'd1', option: 'Big table', question: '', text: '', why: 'no such option' },
      { kind: 'answer', decision: '', option: '', question: 'q7', text: 'x', why: 'no such question' },
      { kind: 'note', decision: '', option: '', question: '', text: '   ', why: 'no words' },
      { kind: 'deploy', decision: '', option: '', question: '', text: 'x', why: 'not a kind' },
    ],
  }).stdout, a);
  assert.deepEqual(p.proposals.map((x) => `${x.id} ${x.kind} ${x.decision ?? x.question ?? ''} ${x.option ?? x.text}`), [
    'p1 choose d1 Custom object', 'p2 note  Step 2: the report reads the custom object', 'p3 own d1 Both: tracking now, an object later', 'p4 answer q1 Yes, all of them',
  ]);
  assert.deepEqual(p.proposals.map((x) => proposalWords(x, a)), [
    'Choose Custom object for Where history is kept', 'Note on the plan: Step 2: the report reads the custom object',
    'For Where history is kept, something else: Both: tracking now, an object later', 'Answer Closed deals too?: Yes, all of them',
  ]);
  assert.deepEqual([p.sessionId, p.costUsd], ['sess-talk', 0.2]);
  assert.throws(() => parseTalkReply('not json', a), /no reply Claude Code could read/);
  assert.throws(() => parseTalkReply(JSON.stringify({ is_error: true, subtype: 'error_max_turns', result: 'ran out' }), a), /didn't reply \(error_max_turns\)/);
  assert.throws(() => parseTalkReply(reply({ reply: '  ', proposals: [] }).stdout, a), /didn't reply/, 'an empty reply isn\'t one');
  assert.deepEqual(TALK_SCHEMA.required, ['reply', 'proposals', 'questions']);
  assert.deepEqual(p.questions, [], 'a reply with no questions has none');
  assert.match(TALK_SYSTEM, /Never say a change is made/);
});

test('Use this records a choice as the person\'s, once, and on an approved plan only with their yes', () => {
  const { paths, config, id } = setup();
  talkPlan(paths, config, id, 'Why not a custom object?', 'd1', { run: claudeSays(reply(SAYS)), now, env: {} }, 'human:me');
  const used = useProposal(paths, id, 't2', 'p1', 'human:me', now);
  assert.equal(used.changed, true);
  assert.equal(used.line, 'Choose Custom object for Where history is kept');
  assert.deepEqual(readAnalysis(paths, id)!.decisions![0]!.choice, { option: 'b', by: 'human:me', at: now().toISOString() }, 'recorded as the person\'s choice');
  assert.deepEqual(readTalk(paths, id).turns[1]!.proposals![0]!.used, { by: 'human:me', at: now().toISOString() });
  assert.equal(useProposal(paths, id, 't2', 'p1', 'human:me', now).changed, false, 'used twice changes nothing');
  // An approved plan: the note changes it, so it asks first, in acc's words.
  writeAnalysis(paths, { ...readAnalysis(paths, id)!, questions: [] });
  approvePlan(paths, id, 'human:me', now);
  assert.throws(() => useProposal(paths, id, 't2', 'p2', 'human:me', now), new RegExp(NOTE_APPROVED.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.ok(readAnalysis(paths, id)!.approval, 'refused, the approval holds');
  assert.equal(readTalk(paths, id).turns[1]!.proposals![1]!.used, undefined, 'and it isn\'t marked used');
  const noted = useProposal(paths, id, 't2', 'p2', 'human:me', now, true);
  assert.deepEqual(noted.plan.notes?.map((n) => n.text), ['Step 2: the report reads the custom object']);
  assert.equal(noted.plan.approval, undefined, 'a note undoes the approval');
  assert.throws(() => useProposal(paths, id, 't1', 'p1', 'human:me', now), /has no proposal t1\.p1/, 'the person\'s own turn proposes nothing');
  assert.throws(() => useProposal(paths, id, 't2', 'p9', 'human:me', now), /has no proposal t2\.p9/);
  assert.match(CHANGE_APPROVED, /undoes the approval/);
  assert.match(ANSWER_APPROVED, /An answer changes it/);
});

test('a new version takes the conversation and the notes, keeps them, and the conversation says what changed', () => {
  const { paths, config, id } = setup();
  const calls: { args: string[]; opts?: RunOptions }[] = [];
  talkPlan(paths, config, id, 'Why not a custom object?', 'd1', { run: claudeSays(reply(SAYS)), now, env: {} }, 'human:me');
  useProposal(paths, id, 't2', 'p1', 'human:me', now);
  notePlan(paths, id, 'Name it Stage_History__c', 'human:me', now);
  // The analyst's answer, as its schema asks: the same choice, its options named, the approach changed.
  const fresh = {
    verdict: 'ready', summary: 'A custom object keeps each change.', requirements: { goal: '', criteria: [], assumptions: [], outOfScope: [] }, questions: [], findings: [], split: [],
    decisions: [{ title: 'Where history is kept', why: '', options: [option('', 'Field history'), option('', 'Custom object')], recommended: 'Custom object', because: 'The person needs two years' }],
    approach: { plan: ['Make Stage_History__c', 'Add a report'], files: [], refactors: [], risks: [], tests: [], size: 'M' },
  };
  const v2 = analyze(paths, config, id, { run: claudeSays(reply(fresh, 'sess-v2'), calls), now, env: {} });
  const input = String(calls[0]!.opts?.input);
  assert.match(input, /## What the person and the planning agent said about the plan/);
  assert.match(input, /The person \(v1\), about choice d1 "Where history is kept": Why not a custom object\?/);
  assert.match(input, /Proposed: Choose Custom object for Where history is kept \(the person used it\)/);
  assert.match(input, /## The person's notes on the plan\n\n- Name it Stage_History__c/);
  assert.equal(v2.version, 2);
  assert.deepEqual(v2.notes?.map((n) => n.text), ['Name it Stage_History__c'], 'the notes stay the person\'s');
  assert.equal(v2.decisions![0]!.choice?.option, 'b', 'the choice used carries over');
  const last = readTalk(paths, id).turns.at(-1)!;
  assert.deepEqual([last.who, last.text, last.version], ['plan', 'Made v2 from this conversation.', 2]);
  assert.ok(last.recorded?.includes('The approach changed'), 'it says what changed');
  // The builder is given the notes with the choices.
  assert.match(analysisSection(v2).join('\n'), /\*\*The person's notes on the plan\*\*\n\n- Name it Stage_History__c/);
  // The next message resumes the new version's session.
  assert.equal(talkSession(v2, readTalk(paths, id)), 'sess-v2');
});

test('edge case: a proposal made on an older version is refused by Use this, says why and asks again, and the plan is as it was', () => {
  const { paths, config, id } = setup();
  talkPlan(paths, config, id, 'Why not a custom object?', 'd1', { run: claudeSays(reply(SAYS)), now, env: {} }, 'human:me');
  // v2 numbers its options the other way round, so v1's "Custom object" would land on another option by number.
  const v1 = readAnalysis(paths, id)!;
  writeAnalysis(paths, { ...v1, version: 2, decisions: [{ ...v1.decisions![0]!, options: [option('a', 'Custom object'), option('b', 'Field history')] }] });
  assert.equal(proposalStale(1, 2), 'This was proposed on v1, and the plan is now v2. Ask the planning agent again about v2.');
  assert.throws(() => useProposal(paths, id, 't2', 'p1', 'human:me', now), (e: Error) => e.message === proposalStale(1, 2));
  assert.throws(() => useProposal(paths, id, 't2', 'p2', 'human:me', now, true), /proposed on v1/, 'a yes doesn\'t get past it');
  const after = readAnalysis(paths, id)!;
  assert.deepEqual([after.decisions![0]!.choice, after.notes], [undefined, undefined], 'nothing was recorded');
  assert.equal(readTalk(paths, id).turns[1]!.proposals!.some((p) => p.used), false, 'and neither proposal reads as used');
});

test('nothing is written to the project or the ticket: only the state folder changes', () => {
  const { dir, paths, config, id } = setup();
  const before = readLedger(paths.ledger).tasks[0]!;
  const calls: string[] = [];
  const fake = fakeRunner({}, calls);
  const runner = (cmd: string, args: string[], opts?: RunOptions) => (cmd === 'claude' ? (calls.push('claude'), reply(SAYS)) : fake(cmd, args, opts));
  talkPlan(paths, config, id, 'Why?', 's2', { run: runner, now, env: {} }, 'human:me');
  useProposal(paths, id, 't2', 'p1', 'human:me', now);
  notePlan(paths, id, 'A note', 'human:me', now);
  openInClaude(paths, config, id, 'human:me', now, () => 'cc-1');
  assert.equal(run('git', ['status', '--porcelain'], { cwd: dir }).stdout, '', 'the checkout is as it was');
  const after = readLedger(paths.ledger).tasks[0]!;
  assert.deepEqual([after.title, after.brief, after.source, after.state], [before.title, before.brief, before.source, before.state], 'the ticket is as it was');
  assert.deepEqual(calls.filter((c) => !c.startsWith('git ')), ['claude'], 'no tracker is asked, and nothing else runs');
  assert.ok(talkPath(paths, id).startsWith(paths.analyses) && briefPath(paths, id).startsWith(paths.analyses), 'the conversation and the brief live with the plan');
});

test('edge cases: a failed reply keeps the message with why; a talk is refused with no plan, a plan being made, a built task, empty or long words, or an unknown reference', () => {
  const { paths, config, id } = setup();
  const failing = fakeRunner({ claude: { code: 1, stdout: JSON.stringify({ is_error: true, subtype: 'error_during_execution', result: 'boom' }), stderr: '' } });
  assert.throws(() => talkPlan(paths, config, id, 'Why?', null, { run: failing, now, env: {} }, 'human:me'), /didn't reply \(error_during_execution\): boom/);
  const t = readTalk(paths, id);
  assert.deepEqual(t.turns.map((x) => [x.who, x.failed]), [['you', 'The planning agent didn\'t reply (error_during_execution): boom']], 'what was asked stays, with why no reply came');
  const timedOut = fakeRunner({ claude: { code: 127, stdout: '', stderr: 'x', timedOut: true } });
  assert.throws(() => talkPlan(paths, config, id, 'Why?', null, { run: timedOut, now, env: {} }, 'human:me'), /didn't reply within 20 minutes/);
  const ok = { run: claudeSays(reply(SAYS)), now, env: {} };
  assert.throws(() => talkPlan(paths, config, id, '   ', null, ok, 'human:me'), /Say something/);
  assert.throws(() => talkPlan(paths, config, id, 'x'.repeat(TALK_MAX + 1), null, ok, 'human:me'), /longer than 4000/);
  assert.throws(() => talkPlan(paths, config, id, 'Why?', 'd7', ok, 'human:me'), /has no d7\. Name a choice/);
  assert.throws(() => talkPlan(paths, config, 'T-99', 'Why?', null, ok, 'human:me'), /No task T-99/);
  const none = setup();
  writeTalk(none.paths, { v: 1, task: none.id, turns: [] });
  rmSync(analysisPath(none.paths, none.id));
  assert.throws(() => talkPlan(none.paths, none.config, none.id, 'Why?', null, ok, 'human:me'), /has no plan yet/);
  // A plan being made: its marker names a live process, this one.
  const marker = join(paths.analyses, `${id}.running.json`);
  writeFileSync(marker, JSON.stringify({ sessionId: 's', startedAt: '', pid: process.pid }));
  assert.throws(() => talkPlan(paths, config, id, 'Why?', null, ok, 'human:me'), /plan is being made/);
  rmSync(marker);
  mutate(paths, now, (l, emit) => { l.tasks[0]!.state = 'running'; emit({ type: 'task.moved', task: id, actor: 'human', by: 'test', data: {} }); });
  assert.throws(() => talkPlan(paths, config, id, 'Why?', null, ok, 'human:me'), /isn't waiting to be built/);
  assert.throws(() => useProposal(paths, id, 't1', 'p1', 'human:me', now), /has no proposal/);
  assert.deepEqual(readTalk(setup().paths, 'NONE-1').turns, [], 'no conversation yet is an empty one');
});

test('a reference quotes a choice, an option, a step, a risk or a question, and nothing for one the plan lacks', () => {
  const { paths, id } = setup();
  const a = readAnalysis(paths, id)!;
  assert.deepEqual(['d1', 'D1.B', 's2', 'r1', 'q1'].map((r) => quoteOf(a, r)), [
    { ref: 'd1', kind: 'choice', text: 'Where history is kept' },
    { ref: 'd1.b', kind: 'option', text: 'Where history is kept: Custom object' },
    { ref: 's2', kind: 'step', text: 'Add a report' },
    { ref: 'r1', kind: 'risk', text: 'History is kept 18 months' },
    { ref: 'q1', kind: 'question', text: 'Closed deals too?' },
  ]);
  assert.deepEqual(['d2', 'd1.c', 's3', 'r2', 'q2', 'x1', ''].map((r) => quoteOf(a, r)), [null, null, null, null, null, null, null]);
  assert.match(talkPrompt(a, ' Why? ', null), /^# The person says\n\nWhy\?\n/);
});

test('Open in Claude Code: plan mode in the main checkout, the brief holds the ticket, the plan and the conversation, and what it records shows on its turn', () => {
  const { paths, config, id } = setup();
  talkPlan(paths, config, id, 'Why not a custom object?', 'd1', { run: claudeSays(reply(SAYS)), now, env: {} }, 'human:me');
  const launch = openInClaude(paths, config, id, 'human:me', now, () => 'cc-1');
  assert.equal(launch.cwd, paths.root);
  // The prompt comes first, so --allowedTools, which takes every argument up to the next flag, can't take it as a tool.
  assert.match(launch.args[0]!, new RegExp(`^Read ${launch.brief.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} first`));
  assert.deepEqual(launch.args.slice(1, 7), ['--permission-mode', 'plan', '--session-id', 'cc-1', '--name', 'Tool · ACME-7 Track stage history · plan']);
  // Only reading is allowed in advance: Claude Code asks the person before each command that records to the plan.
  const allowed = launch.args.slice(launch.args.indexOf('--allowedTools') + 1);
  assert.deepEqual(allowed, ['Read', 'Grep', 'Glob'], 'only reads, and nothing after them for the list to swallow');
  assert.equal(launch.args.filter((x) => /acc (plan|analysis)/.test(x) && x !== launch.args[0]).length, 0, 'no acc command is allowed in advance');
  assert.deepEqual(launch.env, { [TALK_SESSION_VAR]: `${id}:cc-1` });
  const brief = readFileSync(launch.brief, 'utf8');
  assert.doesNotMatch(brief, /In Claude Code/, "written before the session's own turn");
  assert.match(claudeBrief(paths, id), /- In Claude Code \(v1\): Opened the plan in Claude Code\./);
  assert.match(brief, /# ACME-7: Track stage history/);
  assert.match(brief, /Keep each stage change\./);
  assert.match(brief, /### d1\. Where history is kept/);
  assert.match(brief, /a\) \*\*Field history\*\* \(effort S\) \[recommended\]: Track the field Cons: Costs a field\./);
  assert.match(brief, /## The conversation so far\n\n- The person \(v1\), about choice d1/);
  assert.match(brief, /acc plan note ACME-7/);
  assert.match(brief, /None of these is allowed in advance: Claude Code asks the person before each one runs/);
  // What the session records lands on its own turn; another session's, or none, records nothing.
  assert.equal(recordInSession(paths, id, `${id}:cc-1`, 'Chose Custom object for Where history is kept'), true);
  assert.equal(recordInSession(paths, id, `${id}:other`, 'x'), false);
  assert.equal(recordInSession(paths, id, 'OTHER-1:cc-1', 'x'), false);
  assert.equal(recordInSession(paths, id, undefined, 'x'), false);
  const turn = readTalk(paths, id).turns.find((x) => x.who === 'claude-code')!;
  assert.deepEqual([turn.text, turn.sessionId, turn.recorded], ['Opened the plan in Claude Code.', 'cc-1', ['Chose Custom object for Where history is kept']]);
  assert.match(talkLines(readTalk(paths, id), null).join('\n'), /In Claude Code \(v1\): Opened the plan in Claude Code\.\n {2}- Recorded: Chose Custom object/);
});

test('a talk runs with exactly the flags, folder and environment a plan is made with; edge case: a generic project reads from the repo, with no org reads', () => {
  const { paths, config, id } = setup(SF_CONFIG);
  const calls: { args: string[]; opts?: RunOptions }[] = [];
  talkPlan(paths, config, id, 'Why?', null, { run: claudeSays(reply(SAYS), calls), now, env: { PATH: '/bin' }, accCommand: 'acc' }, 'human:me');
  const cwd = analystDir(paths, config, id, true);
  assert.equal(calls[0]!.opts?.cwd, cwd, 'the same folder, kept');
  assert.ok(calls[0]!.args.join('\u0000').endsWith(analystFlags(paths, config, cwd, 'acc').join('\u0000')), 'the same tools and hook');
  assert.deepEqual(calls[0]!.opts?.env, analystEnv(config, { PATH: '/bin' }, id));
  const generic = setup();
  assert.equal(analystDir(generic.paths, generic.config, generic.id), generic.paths.root);
  const flags = analystFlags(generic.paths, generic.config, generic.paths.root);
  assert.ok(!flags.includes('--add-dir') && !flags.includes('--settings') && !flags.some((f) => f.startsWith('Bash(sf ')), 'no hook without acc, no org reads');
  assert.equal(analystEnv(generic.config, {}, generic.id).ACC_ROLE, 'analyst');
});

test('a note is refused on an approved plan without a yes, and empty or long; a version with no conversation adds no turn', () => {
  const { paths, id } = setup(GENERIC_CONFIG, { questions: [], decisions: [] });
  approvePlan(paths, id, 'human:me', now);
  assert.throws(() => notePlan(paths, id, 'x', 'human:me', now), /This plan is approved\. A note changes it.+--yes/);
  assert.throws(() => notePlan(paths, id, '  ', 'human:me', now, true), /Give the note in words/);
  assert.throws(() => notePlan(paths, id, 'x'.repeat(TALK_MAX + 1), 'human:me', now, true), /longer than 4000/);
  assert.throws(() => notePlan(paths, 'T-99', 'x', 'human:me', now), /T-99 has no plan yet/);
  versionTurn(paths, readAnalysis(paths, id)!, 'analyst');
  assert.deepEqual(readTalk(paths, id).turns, [], 'no conversation, so nothing to say a version was made from');
  assert.deepEqual(talkSection(paths, id, readAnalysis(paths, id)), [], 'and a new version\'s prompt gains nothing');
  addTurn(paths, id, { who: 'you', by: 'human:me', at: '', version: 1, text: 'Hi' });
  assert.equal(talkSection(paths, id, readAnalysis(paths, id))[0], '## What the person and the planning agent said about the plan');
});

test('while a reply comes, its marker names the session it answers in, so its steps can be read (T-131); an older marker without one still reads', () => {
  const { paths, config, id } = setup();
  let seen: ReturnType<typeof talking> = null;
  const says = claudeSays(reply(SAYS));
  talkPlan(paths, config, id, 'Why not a custom object?', null, { run: (cmd, args, opts) => { if (cmd === 'claude') seen = talking(paths, id); return says(cmd, args, opts); }, now, env: {} }, 'human:me');
  assert.deepEqual([seen!.sessionId, seen!.startedAt, seen!.pid], ['sess-plan', now().toISOString(), process.pid], 'the plan\'s own session, resumed');
  assert.equal(talking(paths, id), null, 'gone once it replied');
  writeFileSync(join(paths.analyses, `${id}.talking.json`), JSON.stringify({ pid: process.pid, startedAt: now().toISOString() }));
  assert.equal(talking(paths, id)?.sessionId, undefined, 'an older acc\'s marker has none, and is still a reply under way');
});

test('edge case: with a planner and a reviewer on different models, Talk it through runs on the planning agent\'s model and effort, not the reviewer\'s (T-163)', () => {
  const raw = { ...GENERIC_CONFIG, agents: { planner: { model: 'sonnet', effort: 'medium' }, reviewer: { model: 'haiku', effort: 'high' } } };
  const { paths, config, id } = setup(raw);
  const calls: { args: string[]; opts?: RunOptions }[] = [];
  talkPlan(paths, config, id, 'Why not a custom object?', 'd1.b', { run: claudeSays(reply(SAYS), calls), now, env: {} }, 'human:me');
  assert.equal(calls.length, 1);
  const args = calls[0]!.args;
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 4), ['--model', 'sonnet', '--effort', 'medium']);
  assert.ok(!args.includes('haiku'), 'the reviewer\'s model is not used');
});
