// The context pack (T-169): everything acc knows about a ticket, a part each, cut to a set size with a line
// that says what was cut. Each part has a test here; the read from a repo, and the talk that gives the pack on
// each turn, are tested at the end.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';
import { type Analysis, analysisPath, writeAnalysis } from '../src/analyze.ts';
import { parseConfig, type Config } from '../src/config.ts';
import type { TaskDeploy } from '../src/deploy-gate.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { mutate, readLedger, type Task, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { lastSession, openInClaude, readTalk, talkPlan } from '../src/plan-talk.ts';
import { changedPathsOf } from '../src/field-drafts.ts';
import { descriptionOnly, type PlanTicket, writePlanTicket } from '../src/plan-ticket.ts';
import { type Receipt, writeReceipt } from '../src/receipts.ts';
import { reviewPath, type Verdict } from '../src/review.ts';
import { cutPart, type PackIn, PACK_HEADS, PACK_LIMITS, PACK_PARTS, packParts, readTicketPack, ticketPack } from '../src/ticket-context.ts';
import { fakeRunner, GENERIC_CONFIG, makeRepo, SF_CONFIG } from './support.ts';

const now = () => new Date('2026-10-31T12:00:00Z');

const TASK: Task = {
  id: 'ACME-7', title: 'Track stage history', brief: 'Keep each stage change.', source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' },
  environment: 'main', deps: [], labels: [], state: 'review', blocker: null, run: null, pr: null, history: [], createdAt: '2026-10-20T09:00:00Z', updatedAt: '2026-10-30T09:00:00Z',
};

const TICKET: PlanTicket = {
  key: 'ACME-7', title: 'Track stage history', url: null, markdown: 'Keep each stage change for two years.', comments: [{ author: 'Kelsey', created: '2026-10-21T10:00:00Z', markdown: 'Closed deals too, please.' }],
  related: [], attachments: [], changes: null, omitted: 0, full: true, why: null,
};

const PLAN = {
  v: 1, task: 'ACME-7', env: 'main', base: 'x', verdict: 'ready', summary: 'Keep each stage change in a custom object.',
  requirements: { goal: 'Keep stage history for two years.', criteria: ['The history object keeps each stage change.'], assumptions: [], outOfScope: ['Old deals.'] },
  questions: [{ id: 'q1', question: 'Closed deals too?', why: '', suggested: 'Yes', askOf: 'you', answer: { text: 'Yes', by: 'human:me', at: '2026-10-22T10:00:00Z' } }],
  decisions: [{ id: 'd1', title: 'Where history is kept', why: 'Reports read it', options: [{ id: 'a', name: 'Field history', means: 'Track the field', pros: [], cons: ['18 months only'], effort: 'S', risks: [], touches: [] }, { id: 'b', name: 'Custom object', means: '', pros: [], cons: [], effort: 'M', risks: [], touches: [] }], recommended: 'b', because: 'Two years', choice: { option: 'b', by: 'human:me', at: '2026-10-22T10:00:00Z' } }],
  findings: [], approach: { plan: ['Add the object', 'Add the trigger'], files: [], refactors: [], risks: ['Data volume'], tests: [], size: 'M' }, split: [],
  orgs: [], sessionId: 'sess-plan', at: '2026-10-22T11:00:00Z', durationMs: 0, costUsd: null, version: 2, approval: { version: 2, by: 'human:me', at: '2026-10-22T12:00:00Z' },
} as unknown as Analysis;

const DEPLOY: TaskDeploy = {
  env: 'main', org: 'acme-dev', sha: 'abcdef1234567890', at: '2026-10-29T10:00:00Z', jobId: '0Af', paths: ['force-app/main/default/classes/StageHistory.cls'],
  components: ['Apex Class: StageHistory'], verified: 1, tests: { names: ['StageHistoryTest'], outcome: 'pass', ran: 2, failed: 0, coverage: '91%' } as TaskDeploy['tests'],
};

const RECEIPT = (gate: string, status: Receipt['status'], summary: string): Receipt => ({
  gate, sha: 'abcdef1234567890', env: 'main', status, startedAt: '', finishedAt: '', durationMs: 0, summary, command: null, log: null,
});

const VERDICT: Verdict = {
  v: 1, task: 'ACME-7', sha: 'abcdef1234567890', env: 'main', verdict: 'changes', summary: 'One criterion is not met.',
  criteria: [{ text: 'The history object keeps each stage change.', met: false, evidence: 'No test covers a reopened deal' }],
  findings: [{ message: 'The trigger skips reopened deals.', must: true, file: 'force-app/main/default/triggers/Stage.trigger', line: 12 }, { message: 'Name the test for its case.', must: false }],
  sessionId: 's', at: '2026-10-30T10:00:00Z', durationMs: 0, costUsd: null,
};

/** A ticket in review on Salesforce with something in every part. */
const FULL: PackIn = {
  task: {
    ...TASK, state: 'blocked', blocker: 'Waiting on the client: Keep closed deals?', deploys: [DEPLOY], notes: 'Use the existing trigger handler.',
    run: { branch: 'task/ACME-7', note: { landed: ['The history object and its trigger'], moved: ['tests: 2 added'], open: ['Reopened deals'], at: '2026-10-29T11:00:00Z', by: 'builder:ACME-7', ended: 'review' } },
    history: [
      { at: '2026-10-20T09:00:00Z', actor: 'human', by: 'human:me', from: null, to: 'todo', reason: null },
      { at: '2026-10-23T09:00:00Z', actor: 'human', by: 'human:me', from: 'todo', to: 'running', reason: 'dispatched' },
      { at: '2026-10-30T09:00:00Z', actor: 'builder', by: 'builder:ACME-7', from: 'running', to: 'blocked', reason: 'Waiting on the client: Keep closed deals?' },
    ],
  },
  ticket: TICKET, analysis: PLAN, profile: 'salesforce',
  changed: ['force-app/main/default/classes/StageHistory.cls', 'force-app/main/default/classes/StageHistory.cls-meta.xml', 'force-app/main/default/objects/Stage_History__c/Stage_History__c.object-meta.xml'],
  checks: [RECEIPT('tests', 'pass', '2 tests passed'), RECEIPT('deploy', 'fail', 'The org refused StageHistory')],
  review: VERDICT,
};

/** A part's text under its heading in the pack. */
const part = (pack: string, p: (typeof PACK_PARTS)[number]): string => {
  const start = pack.indexOf(`## ${PACK_HEADS[p]}\n`);
  assert.ok(start >= 0, `the pack has ${PACK_HEADS[p]}`);
  const next = PACK_PARTS.slice(PACK_PARTS.indexOf(p) + 1).map((q) => pack.indexOf(`## ${PACK_HEADS[q]}\n`)).find((i) => i > start) ?? pack.length;
  return pack.slice(start, next);
};

test('the pack heads with the ticket\'s key, title, state, link and pull request, then every part in order', () => {
  const pack = ticketPack({ ...FULL, task: { ...FULL.task, pr: { number: 9, url: 'https://github.com/acme/repo/pull/9', state: 'open' } } });
  assert.match(pack, /^# Everything acc knows about ACME-7: Track stage history\n\nIts state is blocked\. Its ticket: https:\/\/acme\.atlassian\.net\/browse\/ACME-7\. Its pull request: https:\/\/github\.com\/acme\/repo\/pull\/9 \(open\)\./);
  const at = PACK_PARTS.map((p) => pack.indexOf(`## ${PACK_HEADS[p]}\n`));
  assert.equal(at.length, 9);
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'the parts come in their order');
  assert.ok(at.every((i) => i > 0), 'every part is there');
});

test('the ticket part: its text and its comments with author and date, each heading under the part\'s', () => {
  const t = part(ticketPack(FULL), 'ticket');
  assert.match(t, /### The ticket\n\nKeep each stage change for two years\./);
  assert.match(t, /#### Kelsey, 2026-10-21\n\nClosed deals too, please\./);
  // Edge case: a ticket the plan never read gives its description alone, and says why there are no comments.
  const only = part(ticketPack({ ...FULL, ticket: descriptionOnly(TASK, 'This task isn\'t from a tracker, so it has no comments.') }), 'ticket');
  assert.match(only, /Keep each stage change\./);
  assert.match(only, /The comments were not read: This task isn't from a tracker/);
});

test('the plan part: its version and approval, summary, goal, criteria, each choice with what was chosen, questions, steps and risks', () => {
  const p = part(ticketPack(FULL), 'plan');
  assert.match(p, /Version 2, approved by human:me\./);
  assert.match(p, /Keep each stage change in a custom object\./);
  assert.match(p, /\*\*Goal:\*\* Keep stage history for two years\./);
  assert.match(p, /\*\*Acceptance criteria\*\*\n\n- The history object keeps each stage change\./);
  assert.match(p, /\*\*Out of scope\*\*\n\n- Old deals\./);
  assert.match(p, /\*\*Choice d1\. Where history is kept\*\*\n\nReports read it\n\n- a\) \*\*Field history\*\* \(effort S\): Track the field Cons: 18 months only\.\n- b\) \*\*Custom object\*\* \(effort M\) \[recommended\]: \n\nRecommends Custom object: Two years\nChosen: \*\*Custom object\*\*, by human:me\./);
  assert.match(p, /q1\. Closed deals too\? Answered: Yes/);
  assert.match(p, /s1\. Add the object\n- s2\. Add the trigger/);
  assert.match(p, /r1\. Data volume/);
  // Edge case: before there is a plan, the part says so.
  assert.match(part(ticketPack({ ...FULL, analysis: null }), 'plan'), /There is no plan yet\./);
});

test('the metadata part lists what the work changed as the Changes tab does: each component by its type, once', () => {
  const c = part(ticketPack(FULL), 'changed');
  assert.match(c, /\*\*Apex Class\*\*\n\n- StageHistory\n/);
  assert.match(c, /\*\*Custom Object\*\*\n\n- Stage_History__c\n/);
  assert.equal(c.match(/- StageHistory\n/g)?.length, 1, 'the class and its meta file are one component');
  assert.doesNotMatch(c, /As of /, 'no drafted-on date');
  // Edge case: before there is work, nothing changed.
  assert.match(part(ticketPack({ ...FULL, changed: [] }), 'changed'), /Nothing changed yet\./);
  // Outside Salesforce, by folder.
  assert.match(part(ticketPack({ ...FULL, profile: 'generic', changed: ['src/app.ts'] }), 'changed'), /\*\*src\*\*\n\n- app\.ts/);
});

test('mutant: a pack that leaves the metadata changed out fails here (the talk\'s own test below checks its prompt holds it)', () => {
  const pack = ticketPack(FULL);
  // Each changed component's name is in the pack, under the changed part and nowhere else in its place.
  for (const name of ['StageHistory', 'Stage_History__c']) assert.match(part(pack, 'changed'), new RegExp(`- ${name}\\n`), `${name} is in the pack`);
  assert.ok(packParts(FULL).changed.some((l) => l === '- StageHistory'), 'the part itself holds it, before it is cut');
});

test('the deployed part: each org\'s latest deploy, its commit, components and tests, from acc\'s record', () => {
  const older: TaskDeploy = { ...DEPLOY, sha: '0000000011111111', at: '2026-10-28T10:00:00Z' };
  const d = part(ticketPack({ ...FULL, task: { ...FULL.task, deploys: [older, DEPLOY] } }), 'deployed');
  assert.match(d, /- acme-dev \(main\), 2026-10-29T10:00:00Z: commit abcdef12, 1 component, 1 listed in the org; 2 tests passed in the org, 91% coverage\. Components: Apex Class: StageHistory\./);
  assert.doesNotMatch(d, /00000000/, 'only the latest deploy to an org');
  // Edge case: no deploy is recorded.
  assert.match(part(ticketPack({ ...FULL, task: { ...FULL.task, deploys: [] } }), 'deployed'), /acc has no record of a deploy\./);
});

test('the checks part: each check on its latest commit with its result, in order; edge case: none run says so', () => {
  const c = part(ticketPack(FULL), 'checks');
  assert.match(c, /- deploy: fail\. The org refused StageHistory\n- tests: pass\. 2 tests passed/);
  assert.match(part(ticketPack({ ...FULL, checks: [] }), 'checks'), /No checks were run on its latest commit\./);
});

test('the review part: its verdict, summary, each criterion met or not, and each finding with where it is; edge case: none yet', () => {
  const r = part(ticketPack(FULL), 'review');
  assert.match(r, /Changes asked on commit abcdef12, 2026-10-30T10:00:00Z\. One criterion is not met\./);
  assert.match(r, /- Criterion not met: The history object keeps each stage change\. \(No test covers a reopened deal\)/);
  assert.match(r, /- Must fix in force-app\/main\/default\/triggers\/Stage\.trigger:12: The trigger skips reopened deals\./);
  assert.match(r, /- Worth a look: Name the test for its case\./);
  assert.match(part(ticketPack({ ...FULL, review: null }), 'review'), /It has not been reviewed\./);
  assert.match(part(ticketPack({ ...FULL, review: { ...VERDICT, verdict: 'pass', findings: [] } }), 'review'), /Passed on commit[^]*- No findings\./);
});

test('the blocked part: why it is blocked and what it asks; edge cases: a ticket that isn\'t blocked, and a block with no reason', () => {
  assert.match(part(ticketPack(FULL), 'blocked'), /Waiting on the client: Keep closed deals\?/);
  assert.match(part(ticketPack({ ...FULL, task: { ...FULL.task, state: 'review', blocker: null } }), 'blocked'), /It is not blocked\. Its state is review\./);
  assert.match(part(ticketPack({ ...FULL, task: { ...FULL.task, blocker: null } }), 'blocked'), /It is blocked, and no reason was given\./);
});

test('the notes part: what a person wrote for its builder, its builder\'s note and the run before\'s; edge case: none left', () => {
  const n = part(ticketPack({ ...FULL, task: { ...FULL.task, run: { ...FULL.task.run!, before: { landed: [], moved: [], open: ['Nothing yet'], at: '2026-10-25T10:00:00Z', by: 'builder:ACME-7', ended: 'blocked' } } } }), 'notes');
  assert.match(n, /\*\*What a person wrote for its builder\*\*\n\nUse the existing trigger handler\./);
  assert.match(n, /\*\*Its builder's note\*\*, by builder:ACME-7 at 2026-10-29T11:00:00Z, as its run went to review:/);
  assert.match(n, /- The history object and its trigger/);
  assert.match(n, /\*\*The run before left this note\*\*, by builder:ACME-7 at 2026-10-25T10:00:00Z, as its run was blocked:/);
  assert.match(part(ticketPack({ ...FULL, task: { ...FULL.task, notes: undefined, run: null } }), 'notes'), /Its builder has left no note\./);
});

test('the history part: each move with when, from and to, by whom and why; edge case: no history yet', () => {
  const h = part(ticketPack(FULL), 'history');
  assert.match(h, /- 2026-10-20T09:00:00Z: added to todo, by human:me\n- 2026-10-23T09:00:00Z: todo to running, by human:me: dispatched\n/);
  assert.match(part(ticketPack({ ...FULL, task: { ...FULL.task, history: [] } }), 'history'), /No history yet\./);
});

test('a part over its set size is cut, with a line that says what was cut; the history keeps its newest lines', () => {
  const lines = Array.from({ length: 50 }, (_, i) => `line ${i} ${'x'.repeat(30)}`);
  const start = cutPart(lines, 400, 'the plan');
  assert.ok(start.join('\n').length < 400 + 200);
  assert.equal(start[0], lines[0], 'the first lines are kept');
  assert.match(start.at(-1)!, /^_Cut: the plan ran to \d+ characters, more than the 400 this pack keeps, so its last \d+ lines are left out\._$/);
  const end = cutPart(lines, 400, 'the history', 'end');
  assert.equal(end.at(-1), lines.at(-1), 'the newest line is kept');
  assert.match(end[0]!, /so its oldest \d+ lines are left out/);
  // Edge case: a part within its size is as it was, with no line.
  assert.deepEqual(cutPart(['a', 'b'], 400, 'x'), ['a', 'b']);
  // In the pack: a long ticket is cut to its size.
  const long = ticketPack({ ...FULL, ticket: { ...TICKET, markdown: Array.from({ length: 2000 }, (_, i) => `Paragraph ${i}.`).join('\n') } });
  assert.match(part(long, 'ticket'), /_Cut: the ticket and its comments ran to \d+ characters, more than the 16000 this pack keeps/);
  assert.ok(part(long, 'ticket').length < PACK_LIMITS.ticket + 400);
  const many = ticketPack({ ...FULL, task: { ...FULL.task, history: Array.from({ length: 200 }, (_, i) => ({ at: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z`, actor: 'human' as const, by: 'human:me', from: 'todo' as const, to: 'running' as const, reason: `move ${i}` })) } });
  assert.match(part(many, 'history'), /_Cut: the ticket's history[^\n]*oldest/);
  assert.match(part(many, 'history'), /move 199/, 'the newest move is kept');
});

// ---------------------------------------------------------------- read from a repo, and given on each turn

/** A repo with ACME-7 in review on Salesforce: a plan, its ticket, a branch that changed a class, a check and a review. */
function repo(raw: Record<string, unknown> = SF_CONFIG) {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw) });
  const config = parseConfig(raw).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Track stage history', brief: 'Keep each stage change.' }], 'human', 'human:test', emit, now);
  });
  const id = readLedger(paths.ledger).tasks[0]!.id;
  writeAnalysis(paths, { ...PLAN, task: id });
  writePlanTicket(paths, id, TICKET);
  // The task's environment's branch, which its branch left.
  const env = readLedger(paths.ledger).tasks[0]!.environment;
  if (env !== 'main') run('git', ['branch', env], { cwd: dir });
  run('git', ['checkout', '-q', '-b', 'task/ACME-7'], { cwd: dir });
  mkdirSync(`${dir}/force-app/main/default/classes`, { recursive: true });
  writeFileSync(`${dir}/force-app/main/default/classes/StageHistory.cls`, 'public class StageHistory {}\n');
  run('git', ['add', '-A'], { cwd: dir });
  run('git', ['commit', '-q', '-m', 'work'], { cwd: dir });
  const sha = run('git', ['rev-parse', 'HEAD'], { cwd: dir }).stdout.trim();
  run('git', ['checkout', '-q', 'main'], { cwd: dir });
  mutate(paths, now, (l, emit) => {
    const t = l.tasks[0]!;
    t.state = 'review';
    t.run = { branch: 'task/ACME-7' };
    t.deploys = [{ ...DEPLOY, sha }];
    emit({ type: 'task.moved', task: id, actor: 'human', by: 'test', data: {} });
  });
  writeReceipt(paths, { ...RECEIPT('tests', 'pass', '2 tests passed'), sha });
  mkdirSync(paths.reviews, { recursive: true });
  writeFileSync(reviewPath(paths, id, sha), JSON.stringify({ ...VERDICT, task: id, sha }));
  return { dir, paths, config, id, sha };
}

const reply = (structured: unknown, session = 'sess-talk'): RunResult => ({
  code: 0, stderr: '', stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: session, total_cost_usd: 0.1, structured_output: structured }),
});

function claudeSays(says: RunResult, calls: { args: string[]; opts?: RunOptions }[]) {
  const fake = fakeRunner({});
  return (cmd: string, args: string[], opts?: RunOptions): RunResult => {
    if (cmd !== 'claude') return fake(cmd, args, opts);
    calls.push({ args, opts });
    return says;
  };
}

test('readTicketPack reads every part from what acc holds: the kept ticket, the plan, the branch\'s changes, the deploy, the checks on its head and the review', () => {
  const { paths, config, id, sha } = repo();
  const pack = readTicketPack(paths, config, id, run)!;
  assert.deepEqual(changedPathsOf(paths, run, readLedger(paths.ledger).tasks[0]!), ['force-app/main/default/classes/StageHistory.cls'], 'in flight, its branch\'s paths, as the Changes tab reads them');
  assert.match(part(pack, 'ticket'), /Closed deals too, please\./);
  assert.match(part(pack, 'plan'), /Version 2, approved by human:me/);
  assert.match(part(pack, 'changed'), /\*\*Apex Class\*\*\n\n- StageHistory/);
  assert.match(part(pack, 'deployed'), new RegExp(`commit ${sha.slice(0, 8)}`));
  assert.match(part(pack, 'checks'), /- tests: pass\. 2 tests passed/);
  assert.match(part(pack, 'review'), /The trigger skips reopened deals\./);
  assert.match(part(pack, 'blocked'), /It is not blocked\. Its state is review\./);
  // Edge case: a task acc doesn't keep has no pack.
  assert.equal(readTicketPack(paths, config, 'NONE-1', run), null);
});

test('past the build, a message gives the agent the whole pack read-only on the planner\'s model, and proposes nothing', () => {
  const { paths, config, id } = repo();
  const calls: { args: string[]; opts?: RunOptions }[] = [];
  const says = { reply: 'The trigger skips reopened deals, as the review found.', proposals: [{ kind: 'note', decision: '', option: '', question: '', text: 'Cover reopened deals', why: 'The review' }], questions: [] };
  const r = talkPlan(paths, config, id, 'What did the review find?', null, { run: claudeSays(reply(says), calls), now, env: {}, accCommand: 'acc' }, 'human:me');
  const input = String(calls[0]!.opts?.input);
  for (const p of PACK_PARTS) assert.match(input, new RegExp(`## ${PACK_HEADS[p].replace(/'/g, '\'')}\\n`), `the turn gives ${PACK_HEADS[p]}`);
  assert.match(input, /- StageHistory/, 'the metadata changed is in the turn');
  assert.match(input, /# The person says\n\nWhat did the review find\?/);
  assert.match(input, /propose nothing/);
  const line = calls[0]!.args.join(' ');
  assert.ok(line.startsWith('-p --resume sess-plan --permission-mode dontAsk --model '), 'the plan\'s own session, on the planner\'s model');
  assert.match(line, /--disallowedTools Edit Write NotebookEdit WebFetch WebSearch/, 'it changes nothing');
  assert.equal(calls[0]!.opts?.env?.ACC_ROLE, 'analyst', 'the analyst\'s guard');
  assert.deepEqual(r.reply.proposals, [], 'past the build, a proposal is left out: the plan is settled');
  assert.equal(r.reply.text, says.reply);
});

test('edge case: a ticket built with no plan starts a session of its own for its conversation, and the next message resumes it', () => {
  const { paths, config, id } = repo(GENERIC_CONFIG);
  rmSync(analysisPath(paths, id));
  const calls: { args: string[]; opts?: RunOptions }[] = [];
  const deps = { run: claudeSays(reply({ reply: 'It changed one class.', proposals: [], questions: [] }, 'sess-new'), calls), now, env: {}, uuid: () => 'uuid-1' };
  talkPlan(paths, config, id, 'What changed?', null, deps, 'human:me');
  assert.match(calls[0]!.args.join(' '), /^-p --session-id uuid-1 --name Tool · ACME-7 Track stage history · analysis --permission-mode dontAsk/);
  assert.match(String(calls[0]!.opts?.input), /There is no plan yet\./);
  assert.equal(lastSession(readTalk(paths, id)), 'sess-new');
  talkPlan(paths, config, id, 'And the review?', null, deps, 'human:me');
  assert.match(calls[1]!.args.join(' '), /^-p --resume sess-new /);
  assert.equal(lastSession({ v: 1, task: id, turns: [] }), null, 'before the first reply, none');
  assert.deepEqual(readTalk(paths, id).turns.map((t) => [t.who, t.version]), [['you', 0], ['agent', 0], ['you', 0], ['agent', 0]]);
  // A reference names a part of a plan, so with none it is refused.
  assert.throws(() => talkPlan(paths, config, id, 'Why?', 'd1', deps, 'human:me'), /has no d1/);
});

test('Open in Claude Code past the build gives the session the same pack, and records nothing', () => {
  const { paths, config, id } = repo();
  const launch = openInClaude(paths, config, id, 'human:me', now, () => 'cc-1', run);
  const brief = (readTicketPack(paths, config, id, run) ?? '').split('\n')[0]!;
  const written = readFileSync(launch.brief, 'utf8');
  assert.ok(written.startsWith(brief), 'the brief starts with the pack');
  for (const p of PACK_PARTS) assert.ok(written.includes(`## ${PACK_HEADS[p]}\n`), `the brief gives ${PACK_HEADS[p]}`);
  assert.match(written, /- StageHistory/);
  assert.match(written, /The plan is settled, or there is none yet, so record nothing/);
  assert.doesNotMatch(written, /acc plan note/, 'no way to record');
  assert.match(launch.args[0]!, /and change nothing\.$/);
});
