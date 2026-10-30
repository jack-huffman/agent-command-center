// The wording check on a plan (T-151): the planning agent's requirements and questions pass the Simplified Technical
// English check before acc records the plan, and a plan whose requirements fail can't be approved. The plans are made up.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { type Analysis, analyze, analyzing, readAnalysis, writeAnalysis } from '../src/analyze.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { mutate, readLedger, upsertTasks } from '../src/ledger.ts';
import { findingLine, NOTE_FIX_TRIES } from '../src/note-wording.ts';
import { repoPaths } from '../src/paths.ts';
import { approveRefusal } from '../src/plan.ts';
import { approvePlan } from '../src/plan-choices.ts';
import { planTimes } from '../src/plan-times.ts';
import { approveWording, planFixPrompt, planWording, planWordingWords, questionPlace, requirementLine } from '../src/plan-wording.ts';
import { requirementWording } from '../src/ste.ts';
import { fakeRunner, GENERIC_CONFIG, makeRepo, tempDir } from './support.ts';

const now = () => new Date('2026-10-29T12:00:00Z');

/** A repo with one task to do. */
function setup() {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG) });
  const config = parseConfig(GENERIC_CONFIG).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Escalate premium cases', brief: 'Premium cases escalate after 2 hours.' }], 'human', 'human:test', emit, now);
  });
  return { config, paths, id: readLedger(paths.ledger).tasks[0]!.id };
}

const result = (structured: unknown, session = 'sess-analyst'): RunResult => ({
  code: 0, stderr: '', stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: session, total_cost_usd: 0.5, structured_output: structured }),
});

const CLEAN = { goal: 'Premium cases reach Tier 2 in time.', criteria: ['A High premium case escalates after 2 business hours.'], assumptions: ['Business hours are the support hours.'], outOfScope: ['Standard cases.'] };
/** A criterion with a semicolon: one hard finding. */
const HARD = { ...CLEAN, criteria: ['The rule runs; it logs.'] };
const QUESTIONS = [{ id: 'q1', question: 'Should Medium cases escalate?', why: '', suggested: '' }];
const answer = (requirements: typeof CLEAN, question = 'Should Medium cases escalate?') => ({
  verdict: 'questions', summary: 'Adds an escalation rule on Case.', requirements,
  questions: [{ question, why: 'It doubles the rule entries.', suggested: 'Yes' }], findings: [],
  approach: { plan: ['Add the rule'], files: [], refactors: [], risks: [], tests: [], size: 'S' }, split: [],
});

/** A runner whose analyst answers with each answer in turn, recording each call. */
function analyst(answers: unknown[], calls: { args: string[]; input: string }[]) {
  const fake = fakeRunner({});
  return (cmd: string, args: string[], opts?: RunOptions) => {
    if (cmd !== 'claude') return fake(cmd, args, opts);
    calls.push({ args, input: String(opts?.input ?? '') });
    return result(answers[Math.min(calls.length - 1, answers.length - 1)]);
  };
}

test('planWording finds each hard finding on the requirements and the questions, with its place, and none on clean, advisory or code lines', () => {
  const found = planWording({ requirements: HARD, questions: [{ id: 'q2', question: 'Should we reach out to the client?', why: '', suggested: '' }] });
  assert.deepEqual(found.map((f) => [f.where, f.rule]), [['Criterion 1', 'semicolon'], ['Question q2', 'phrasal-verb']]);
  assert.equal(found[0]!.text, 'The rule runs; it logs.');
  assert.ok(found.every((f) => f.message), 'each finding has its fix');
  // An edge case: a plan with nothing written, a clean one, a passive (advisory), and code in backticks.
  assert.deepEqual(planWording({ requirements: { goal: '', criteria: [], assumptions: [], outOfScope: [] }, questions: [] }), []);
  assert.deepEqual(planWording({ requirements: CLEAN, questions: [{ id: 'q1', question: 'Is the rule tested by the team?', why: '', suggested: '' }] }), []);
  assert.deepEqual(planWording({ requirements: { ...CLEAN, criteria: ['The job runs `a; b` once.'] }, questions: [] }), []);
  assert.equal(questionPlace('q3'), 'Question q3');
  assert.deepEqual(requirementLine(requirementWording(HARD)[0]!).where, 'Criterion 1');
});

test('analyze sends each finding and its fix back to the planning agent in its session, and records the plan it fixed', () => {
  const { paths, config, id } = setup();
  const calls: { args: string[]; input: string }[] = [];
  const a = analyze(paths, config, id, { run: analyst([answer(HARD), answer(CLEAN)], calls), now, env: {}, uuid: () => 'fixed' });
  assert.equal(calls.length, 2, 'asked once, then once to fix');
  assert.deepEqual(calls[1]!.args.slice(0, 3), ['-p', '--resume', 'sess-analyst'], 'the fix resumes the same session');
  const wanted = planWording({ requirements: HARD, questions: QUESTIONS });
  assert.equal(calls[1]!.input, planFixPrompt(wanted));
  for (const f of wanted) assert.ok(calls[1]!.input.includes(findingLine(f)), `the agent is given ${f.where} and its fix`);
  assert.deepEqual(a.requirements.criteria, CLEAN.criteria, 'the fixed plan is the one kept');
  assert.deepEqual(readAnalysis(paths, id)?.wording, []);
  assert.equal(a.costUsd, 1, 'both answers are paid for');
});

test('an edge case: a plan that still fails after its fixes is refused, and acc records no plan and keeps the one before', () => {
  const { paths, config, id } = setup();
  // A clock that moves a second each read, so each plan has a time to record.
  let ticks = 0;
  const tick = () => new Date(now().getTime() + 1000 * ticks++);
  const before = analyze(paths, config, id, { run: analyst([answer(CLEAN)], []), now: tick, env: {} });
  const calls: { args: string[]; input: string }[] = [];
  assert.throws(() => analyze(paths, config, id, { run: analyst([answer(HARD)], calls), now: tick, env: {} }), (e: Error) => {
    assert.equal(e.message, planWordingWords(planWording({ requirements: HARD, questions: QUESTIONS }), NOTE_FIX_TRIES));
    assert.match(e.message, /after 2 fixes \(1 finding\), so acc recorded no plan\. Make a new plan:\n- Criterion 1: STE bans the semicolon/);
    return true;
  });
  assert.equal(calls.length, 1 + NOTE_FIX_TRIES, 'asked, then fixed twice');
  assert.deepEqual(readAnalysis(paths, id), before, 'the plan before is kept as it was');
  assert.equal(analyzing(paths, id), null, 'the running marker is gone');
  assert.equal(planTimes(paths).length, 1, 'the refused plan records no time');
});

test('a person can\'t approve a plan whose requirements have a hard finding: acc gives each finding and its fix', () => {
  const { paths, id } = setup();
  const plan = (requirements: typeof CLEAN, more: Partial<Analysis> = {}): Analysis => ({
    v: 1, task: id, env: 'main', base: 'abc', verdict: 'ready', summary: '', requirements, questions: [], findings: [],
    approach: { plan: [], files: [], refactors: [], risks: [], tests: [], size: 'S' }, split: [], orgs: [], sessionId: 's', at: now().toISOString(), durationMs: 1, costUsd: null, ...more,
  });
  // A plan recorded before this check, which kept no wording field: its requirements are read again.
  writeAnalysis(paths, plan(HARD));
  assert.throws(() => approvePlan(paths, id, 'human:jordan', now), (e: Error) => {
    assert.equal(e.message, approveWording({ requirements: HARD }, id));
    assert.match(e.message, /^ACME-7's requirements fail the Simplified Technical English check \(1 finding\), so the plan can't be approved\. Make a new plan with acc analyze ACME-7:\n- Criterion 1: /);
    return true;
  });
  assert.equal(readAnalysis(paths, id)?.approval, undefined, 'nothing approved');
  // Questions for the person come first; a clean plan is approved.
  assert.match(approveRefusal(plan(HARD, { questions: [{ id: 'q1', question: 'Which queue?', why: '', suggested: '' }] }), id)!, /answer q1 first/);
  assert.equal(approveWording({ requirements: CLEAN }, id), null);
  writeAnalysis(paths, plan(CLEAN));
  assert.equal(approvePlan(paths, id, 'human:jordan', now).approval?.by, 'human:jordan');
});

// ---------------------------------------------------------------- mutants: the checks above catch them

/** A module with one change, imported from a folder of its own; its imports still reach acc's modules. */
async function mutant<T>(module: string, from: string, to: string): Promise<T> {
  const src = new URL(`../src/${module}`, import.meta.url);
  const text = readFileSync(src, 'utf8');
  assert.ok(text.includes(from), `the mutant's line is still in ${module}: ${from}`);
  const changed = text.replace(from, to).replace(/from '\.\/([\w/-]+\.ts)'/g, (_, f: string) => `from '${new URL(`../src/${f}`, import.meta.url).href}'`);
  const file = join(tempDir('mutant-'), module);
  writeFileSync(file, changed);
  return await import(pathToFileURL(file).href) as T;
}

/** Whether an analyze records a plan whose analyst always answers with a hard finding. */
function hardPlanRecorded(analyzeWith: typeof analyze): boolean {
  const { paths, config, id } = setup();
  try {
    analyzeWith(paths, config, id, { run: analyst([answer(HARD)], []), now, env: {} });
  } catch {
    return false;
  }
  return readAnalysis(paths, id) !== null;
}

test('acc\'s own analyze records no plan with a hard finding', () => {
  assert.equal(hardPlanRecorded(analyze), false);
});

test('a mutant of analyze that skips the wording check, and records a hard plan, is caught', async () => {
  const m = await mutant<typeof import('../src/analyze.ts')>('analyze.ts', 'wording = planWording(parsed.analysis); wording.length;', 'wording = [] as unknown[]; wording.length;');
  assert.equal(hardPlanRecorded(m.analyze), true, 'the mutant recorded the hard plan, and the check saw it');
});

test('a mutant of the approval that lets a hard plan through is caught', async () => {
  const m = await mutant<typeof import('../src/plan.ts')>('plan.ts', 'return approveWording(a, id);', 'return null;');
  const hard = { verdict: 'ready', requirements: HARD, questions: [], decisions: [] } as unknown as Analysis;
  assert.notEqual(approveRefusal(hard, 'T-1'), null, 'acc\'s own refuses it');
  assert.equal(m.approveRefusal(hard, 'T-1'), null, 'the mutant lets it through, and the check saw it');
});
