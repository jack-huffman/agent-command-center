import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANALYSIS_SCHEMA, analysisPrompt, analysisProblems, analysisSection, analyze, type Analysis, answerAnalysis, parseAnalysis, parseDecisions, readAnalysis } from '../src/analyze.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { mutate, readLedger, type Task, upsertTasks } from '../src/ledger.ts';
import { renderPacket } from '../src/packet.ts';
import { repoPaths } from '../src/paths.ts';
import { approvePlan, choosePlan } from '../src/plan-choices.ts';
import { approvalOf, approvedPlanLines, approvedVersion, approveRefusal, askOf, choiceName, lapse, lapsedWords, nextVersion, planChanges, planChoicesSection, planProblems, planVersion, questionsForYou, recommendedName, unchosen } from '../src/plan.ts';
import { reviewPrompt } from '../src/review.ts';
import { fakeRunner, makeRepo, SF_CONFIG } from './support.ts';

const now = () => new Date('2026-10-22T12:00:00Z');

/** A Salesforce repo, where a plan is required, with one task to do. */
function setup() {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(SF_CONFIG) });
  const config = parseConfig(SF_CONFIG).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-16', url: 'https://acme.atlassian.net/browse/ACME-16' }, title: 'Track opportunity stage history', brief: 'Sales managers see how deals moved.' }], 'human', 'human:test', emit, now);
  });
  return { config, paths, id: readLedger(paths.ledger).tasks[0]!.id };
}

const option = (name: string, effort = 'S') => ({ name, means: `${name} for Stage`, pros: [`${name} is quick`], cons: [`${name} has a limit`], effort, risks: [`${name} risk`], touches: [`objects/Opportunity/${name}`] });

const HISTORY = {
  title: 'Where the stage history is kept', why: 'Decides how far back reports go.',
  options: [option('Field history tracking'), option('A custom object', 'M')], recommended: 'Field history tracking', because: 'Nothing to build, and 8 tracked fields are free.',
};
const BACKFILL = { title: 'Where existing data comes from', why: 'Old deals have no history.', options: [option('No backfill'), option('Backfill from the audit export', 'L')], recommended: 'No backfill', because: 'The ticket asks from now on.' };

const ANSWER = {
  verdict: 'questions', summary: 'Track Stage history and report on it.',
  requirements: { goal: 'Sales managers see each stage change.', criteria: ['A report lists each stage change'], assumptions: [], outOfScope: [] },
  questions: [
    { question: 'Should the report include closed deals?', why: 'Doubles the rows.', suggested: 'Yes', askOf: 'you' },
    { question: 'Which managers read the report?', why: 'Sets the folder sharing.', suggested: 'Sales Managers', askOf: 'author' },
  ],
  decisions: [HISTORY, BACKFILL],
  findings: [], approach: { plan: ['Track StageName', 'Add the report'], files: [], refactors: [], risks: [], tests: ['Run the report'], size: 'S' }, split: [],
};

const result = (structured: unknown): RunResult => ({ code: 0, stderr: '', stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'sess', total_cost_usd: 0.5, structured_output: structured }) });
const analyst = (answer: unknown) => (cmd: string, args: string[], opts?: RunOptions) => (cmd === 'claude' ? result(answer) : fakeRunner({})(cmd, args, opts));

test('the schema asks for design choices with two or three options, and who can answer each question (T-97)', () => {
  const s = ANALYSIS_SCHEMA as any;
  assert.ok(s.required.includes('decisions'));
  const d = s.properties.decisions.items;
  assert.deepEqual(d.required, ['title', 'why', 'options', 'recommended', 'because']);
  assert.equal(d.properties.options.minItems, 2);
  assert.equal(d.properties.options.maxItems, 3);
  assert.deepEqual(d.properties.options.items.required, ['name', 'means', 'pros', 'cons', 'effort', 'risks', 'touches']);
  assert.deepEqual(d.properties.options.items.properties.effort.enum, ['S', 'M', 'L']);
  assert.deepEqual(s.properties.questions.items.properties.askOf.enum, ['you', 'author']);
  const { system } = analysisPrompt({ task: { id: 'T-1', title: 't', brief: '', source: { kind: 'manual' } } as unknown as Task, config: SF_CONFIG as unknown as Config, env: { name: 'Dev', branch: 'dev' } as never, root: '/r', checkedOut: null, orgs: [], rules: null, previous: null });
  assert.match(system, /Name every design choice a reviewer would want a person to make/);
  assert.match(system, /Never hide a choice inside the approach/);
  assert.match(system, /honest cons for each option, the one you recommend too/);
  assert.match(system, /A small task may have no decisions/);
  assert.match(system, /author \(who wrote the ticket, such as a client\)/);
});

test('decisions parse with ids and their recommendation; a question without askOf is for you', () => {
  const a = parseAnalysis(result({ ...ANSWER, questions: [{ question: 'Q?', why: '', suggested: '' }, ANSWER.questions[1]] }).stdout).analysis;
  assert.deepEqual(a.decisions!.map((d) => [d.id, d.recommended, d.options.map((o) => o.id)]), [['d1', 'a', ['a', 'b']], ['d2', 'a', ['a', 'b']]]);
  assert.deepEqual(a.decisions![0]!.options[1], { id: 'b', name: 'A custom object', means: 'A custom object for Stage', pros: ['A custom object is quick'], cons: ['A custom object has a limit'], effort: 'M', risks: ['A custom object risk'], touches: ['objects/Opportunity/A custom object'] });
  assert.deepEqual(a.questions.map(askOf), ['you', 'author']);
  // An older answer, with no decisions at all, has none.
  assert.deepEqual(parseAnalysis(result({ ...ANSWER, decisions: undefined }).stdout).analysis.decisions, []);
  // The recommendation matches its option's name whatever the case.
  assert.equal(parseDecisions([{ ...HISTORY, recommended: 'a CUSTOM object' }])[0]!.recommended, 'b');
});

test('a recommendation that names no option is refused, and so is a choice with one option or four', () => {
  assert.throws(() => parseAnalysis(result({ ...ANSWER, decisions: [{ ...HISTORY, recommended: 'Big Object' }] }).stdout), /recommends "Big Object" for the choice "Where the stage history is kept", which isn't one of its options: Field history tracking, A custom object\./);
  assert.throws(() => parseDecisions([{ ...HISTORY, recommended: '' }]), /recommends ""/);
  assert.throws(() => parseDecisions([{ ...HISTORY, options: [option('Only')], recommended: 'Only' }]), /gave the choice "Where the stage history is kept" 1 option\. A choice has two or three\./);
  assert.throws(() => parseDecisions([{ ...HISTORY, options: ['a', 'b', 'c', 'd'].map((n) => option(n)), recommended: 'a' }]), /4 options/);
});

test('each analysis is a version, kept; choices and answers carry over where the choice still exists, and an approval lapses (T-97)', () => {
  const { config, paths, id } = setup();
  const v1 = analyze(paths, config, id, { run: analyst(ANSWER), now, env: {} });
  assert.equal(planVersion(v1), 1);
  assert.equal(v1.earlier, undefined, 'the first version has none before it');
  assert.equal(v1.changes, undefined, 'nor any changes');
  answerAnalysis(paths, id, 'q1', 'No, open deals only', 'human:me', now);
  choosePlan(paths, id, 'd1', { option: 'b' }, 'human:me', now);
  choosePlan(paths, id, 'd2', { text: 'Backfill the last 90 days only' }, 'human:me', now);
  const approved = approvePlan(paths, id, 'human:me', now);
  assert.deepEqual(approved.approval, { version: 1, by: 'human:me', at: now().toISOString() });
  // v2 drops the custom object, so that choice can't carry; the own option does, its choice still there.
  const v2Answer = { ...ANSWER, decisions: [{ ...HISTORY, options: [option('Field history tracking'), option('Big Object', 'L')] }, BACKFILL], approach: { ...ANSWER.approach, plan: ['Track StageName'] } };
  const v2 = analyze(paths, config, id, { run: analyst(v2Answer), now, env: {} });
  assert.equal(planVersion(v2), 2);
  assert.equal(v2.earlier!.length, 1);
  assert.equal(v2.earlier![0]!.decisions![0]!.choice?.option, 'b', 'v1 is kept as it was, with its choices');
  assert.deepEqual(v2.earlier![0]!.approval, approved.approval, 'and its approval');
  assert.equal(v2.decisions![0]!.choice, undefined, 'the chosen option is gone');
  assert.deepEqual(v2.decisions![1]!.choice, { option: null, text: 'Backfill the last 90 days only', by: 'human:me', at: now().toISOString() });
  assert.equal(v2.questions[0]!.answer?.text, 'No, open deals only', 'an answer carries over');
  assert.equal(v2.approval, undefined);
  assert.deepEqual(v2.lapsed, approved.approval);
  assert.deepEqual(v2.changes, ['Where the stage history is kept: the options changed', 'Where the stage history is kept: A custom object isn\'t an option any more, so it needs choosing again', 'The approach changed']);
  assert.deepEqual(analysisProblems(paths, config, readLedger(paths.ledger).tasks[0]!), [
    '1 choice in ACME-16\'s plan isn\'t made: d1. Where the stage history is kept. Choose with acc plan choose ACME-16 <choice> <option>.',
    'ACME-16\'s plan v2 is new since v1 was approved: approve it again with acc plan approve ACME-16.',
  ]);
  // A third version keeps the option chosen by name, and v1 and v2 both.
  choosePlan(paths, id, 'd1', { option: 'Big Object' }, 'human:me', now);
  const v3 = analyze(paths, config, id, { run: analyst({ ...v2Answer, decisions: [{ ...v2Answer.decisions[0], options: [option('Big Object'), option('Field history tracking')] }, BACKFILL] }), now, env: {} });
  assert.deepEqual([planVersion(v3), v3.earlier!.map(planVersion)], [3, [1, 2]]);
  assert.equal(v3.decisions![0]!.choice?.option, 'a', 'the same option, at its new place');
  assert.equal(readAnalysis(paths, id)?.version, 3);
});

test('the prompt for a new version names the choices a person made, so the analyst keeps them', () => {
  const previous = { questions: [], decisions: parseDecisions([HISTORY]).map((d) => ({ ...d, choice: { option: 'b', by: 'human:me', at: '' } })) } as unknown as Analysis;
  const { prompt } = analysisPrompt({ task: { id: 'T-1', title: 't', brief: '', source: { kind: 'manual' } } as unknown as Task, config: SF_CONFIG as unknown as Config, env: { name: 'Dev', branch: 'dev' } as never, root: '/r', checkedOut: null, orgs: [], rules: null, previous });
  assert.match(prompt, /## What a person already chose\n\n- Where the stage history is kept: \*\*A custom object\*\*/);
  // Before any choice, there's no such section.
  assert.doesNotMatch(analysisPrompt({ task: { id: 'T-1', title: 't', brief: '', source: { kind: 'manual' } } as unknown as Task, config: SF_CONFIG as unknown as Config, env: { name: 'Dev', branch: 'dev' } as never, root: '/r', checkedOut: null, orgs: [], rules: null, previous: { ...previous, decisions: parseDecisions([HISTORY]) } }).prompt, /already chose/);
});

test('the build gate names each reason: questions for you, choices, approval; a question for the author holds nothing', () => {
  const a = { ...parseAnalysis(result(ANSWER).stdout).analysis, questions: parseAnalysis(result(ANSWER).stdout).analysis.questions } as Analysis;
  assert.deepEqual(questionsForYou(a).map((q) => q.id), ['q1'], 'q2 is for the ticket\'s author');
  assert.deepEqual(unchosen(a).map((d) => d.id), ['d1', 'd2']);
  const reasons = planProblems(a, 'T-1');
  assert.equal(reasons.length, 3);
  assert.match(reasons[0]!, /^1 question from T-1's analysis is unanswered: q1\. Should the report include closed deals\?/);
  assert.match(reasons[1]!, /^2 choices in T-1's plan aren't made: d1\. Where the stage history is kept\. d2\. Where existing data comes from\./);
  assert.equal(reasons[2], 'T-1\'s plan v1 isn\'t approved: a person approves it with acc plan approve T-1.');
  assert.equal(approveRefusal(a, 'T-1'), 'T-1\'s plan isn\'t ready to approve: answer q1, and choose d1, d2 first.');
  assert.equal(approveRefusal({ ...a, verdict: 'split' }, 'T-1'), 'T-1\'s analysis says it\'s too big for one task. Split it rather than approve it.');
  // Everything settled and approved: nothing holds it.
  a.questions[0]!.answer = { text: 'Yes', by: 'human:me', at: '' };
  for (const d of a.decisions!) d.choice = { option: d.recommended, by: 'human:me', at: '' };
  assert.equal(approveRefusal(a, 'T-1'), null);
  a.approval = approvalOf(a, 'human:me', 'now');
  assert.deepEqual(planProblems(a, 'T-1'), []);
  assert.equal(lapsedWords(a), null);
  // A change after the approval undoes it, and says so.
  lapse(a);
  assert.equal(a.approval, undefined);
  assert.equal(lapsedWords(a), 'v1 changed since it was approved');
  assert.deepEqual(planProblems(a, 'T-1'), ['T-1\'s plan v1 changed since it was approved: approve it again with acc plan approve T-1.']);
  // A plan with no approval to undo is left as it was.
  const none = { ...a, lapsed: undefined } as Analysis;
  lapse(none);
  assert.equal(none.lapsed, undefined);
});

test('a project that wants no plan builds as before, and an analysis older than plans reads as v1 for you', () => {
  const generic = parseConfig({ ...SF_CONFIG, profile: 'generic' }).config as Config;
  assert.deepEqual(analysisProblems({ analyses: '/nowhere' } as never, { ...generic, analysis: { required: false } }, { id: 'T-1', state: 'todo' } as Task), []);
  const old = { questions: [{ id: 'q1', question: 'Q?', why: '', suggested: '' }] } as unknown as Analysis;
  assert.equal(planVersion(old), 1);
  assert.equal(askOf(old.questions[0]!), 'you');
  assert.deepEqual(unchosen(old), []);
});

test('what changed names new and dropped choices and questions, a new recommendation, and says when nothing did', () => {
  const base = parseAnalysis(result(ANSWER).stdout).analysis as Analysis;
  assert.deepEqual(planChanges(base, base), ['Nothing changed in the choices, the questions or the approach']);
  const after = { ...base, verdict: 'split', decisions: [{ ...base.decisions![0]!, recommended: 'b' }, ...parseDecisions([{ ...BACKFILL, title: 'Who sees it' }])], questions: [base.questions[0]!, { id: 'q3', question: 'New?', why: '', suggested: '' }], approach: { ...base.approach, size: 'M' } } as Analysis;
  assert.deepEqual(planChanges(base, after), [
    'Where the stage history is kept: now recommends A custom object, not Field history tracking',
    'New choice: Who sees it',
    'No longer a choice: Where existing data comes from',
    'New question: New?',
    'No longer asked: Which managers read the report?',
    'Size M, not S',
    'It now says the task is too big for one',
  ]);
  // The first version has nothing before it.
  assert.equal(nextVersion(null, base).version, 1);
});

test('the builder is given the approved plan: its version, each choice, and to stop and ask before another choice', () => {
  const { config, paths, id } = setup();
  analyze(paths, config, id, { run: analyst(ANSWER), now, env: {} });
  answerAnalysis(paths, id, 'q1', 'Yes', 'human:me', now);
  choosePlan(paths, id, 'd1', { option: 'a' }, 'human:me', now);
  // Not approved yet: it says so, and names the recommendation for a choice nobody made.
  const before = analysisSection(readAnalysis(paths, id)).join('\n');
  assert.match(before, /^## The plan\n\nVersion 1\. A person hasn't approved it\./);
  assert.match(before, /- Where existing data comes from: nobody chose\. The plan recommends \*\*No backfill\*\*: The ticket asks from now on\./);
  choosePlan(paths, id, 'd2', { text: 'Backfill 90 days' }, 'human:me', now);
  approvePlan(paths, id, 'human:me', now);
  const a = readAnalysis(paths, id)!;
  const md = analysisSection(a).join('\n');
  assert.match(md, /^## The approved plan\n\nVersion 1, approved by human:me at 2026-10-22T12:00:00\.000Z\./);
  assert.match(md, /If the work needs a different choice from one made here, or meets a design decision this plan doesn't cover, stop: run acc block with the question, and never decide it yourself\./);
  assert.match(md, /\*\*The choices\*\*\n\n- Where the stage history is kept: \*\*Field history tracking\*\*: Field history tracking for Stage \(chosen by human:me\)\n- Where existing data comes from: \*\*Something else\*\*: Backfill 90 days \(chosen by human:me\)/);
  assert.match(md, /\*\*Decided by a person\*\*\n\n- Should the report include closed deals\? \*\*Yes\*\*\n- Which managers read the report\? Nobody answered; assume: Sales Managers/);
  assert.match(md, /\*\*The approach\*\*\n\n1\. Track StageName\n2\. Add the report/);
  const task = readLedger(paths.ledger).tasks[0]!;
  const packet = renderPacket({ task, config, env: config.environments[2]!, worktree: '/w', branch: 'b', rules: null, environmentSpecific: [], analysis: a });
  assert.ok(packet.includes('## The approved plan'));
  assert.deepEqual(approvedPlanLines({ ...a, decisions: [] }).filter((l) => l.startsWith('**')), [], 'a plan with no choices lists none');
});

test('the reviewer checks the change against the approved choices, and a departure is a must-fix finding', () => {
  const a = parseAnalysis(result(ANSWER).stdout).analysis as Analysis;
  a.decisions![0]!.choice = { option: 'b', by: 'human:me', at: '' };
  const base = { task: { id: 'T-1', title: 't' } as Task, config: { profile: 'salesforce' } as never, envName: 'Dev', envBranch: 'dev', sha: 'abcdef1', packet: 'p', diff: '', stat: '', checks: [], rules: null };
  const unapproved = reviewPrompt({ ...base, plan: { ...a, version: 1 } });
  assert.match(unapproved.system, /Does it keep to the plan's choices, where you are given them\? A departure from a choice a person made is a finding with must: true\./);
  assert.match(unapproved.prompt, /## The plan's choices \(v1, not approved\)/);
  const approved = { ...a, version: 2, approval: { version: 2, by: 'human:me', at: '' } } as Analysis;
  const p = reviewPrompt({ ...base, plan: approved }).prompt;
  assert.match(p, /## The approved plan's choices \(v2\)\n\nA person made these choices before the build\. Check the change keeps to each\. A departure from one, or a design decision the builder made alone that the plan doesn't cover, is a finding with must: true\.\n\n- Where the stage history is kept: \*\*A custom object\*\*/);
  assert.doesNotMatch(p, /Where existing data comes from/, 'a choice nobody made isn\'t named');
  // A newer version not approved yet: the reviewer holds the build to the approved one before it.
  const v3 = { ...a, version: 3, decisions: [], earlier: [approved] } as Analysis;
  assert.equal(approvedVersion(v3), approved);
  assert.match(planChoicesSection(v3).join('\n'), /\(v2\)/);
  // No plan, or none of its choices made: no section.
  assert.deepEqual(planChoicesSection(null), []);
  assert.deepEqual(planChoicesSection(parseAnalysis(result(ANSWER).stdout).analysis as Analysis), []);
  assert.doesNotMatch(reviewPrompt(base).prompt, /plan's choices/);
});

test('a choice reads as its option\'s name or the person\'s words, and the recommendation as its option\'s name', () => {
  const [d] = parseDecisions([HISTORY]);
  assert.equal(choiceName(d!), '', 'none made');
  assert.equal(recommendedName(d!), 'Field history tracking');
  assert.equal(choiceName({ ...d!, choice: { option: 'b', by: '', at: '' } }), 'A custom object');
  assert.equal(choiceName({ ...d!, choice: { option: null, text: 'Mine', by: '', at: '' } }), 'Mine');
});
