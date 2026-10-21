import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { parseConfig, type Config } from '../src/config.ts';
import {
  CRITERIA_COMMENTS_MAX, CRITERIA_HEADING, CRITERIA_PARTS, CRITERIA_SCHEMA, CRITERIA_TEXT_MAX, CRITERIA_TIMEOUT_MS, criteriaDir, criteriaFixPrompt, criteriaMarkdown, criteriaPath, criteriaPrompt, criteriaRefusal,
  criteriaSection, type CriteriaTicket, criteriaTicket, criteriaUpdate, criteriaWording, draftCriteria, drafting, parseCriteria, parseCriteriaTicket, readCriteria, taskTicket, withCriteria,
} from '../src/criteria.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { mutate, readLedger, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { fromMarkdown } from '../src/trackers/doc.ts';
import { listUpdates } from '../src/updates.ts';
import { fakeAwake, makeRepo } from './support.ts';

const now = () => new Date('2026-10-20T12:00:00Z');

const CONFIG = { schema: 1, project: 'Acme', profile: 'generic', environments: [{ name: 'main', default: true }], agents: { reviewer: { model: 'sonnet', effort: 'medium' } } };

/** A repo with a Jira task and a task acc keeps itself. */
function setup() {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(CONFIG) });
  const config = parseConfig(CONFIG).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [
      { source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Escalate premium cases', brief: 'Premium cases escalate after 2 hours.' },
      { source: { kind: 'manual' }, title: 'Write the changelog', brief: 'One entry a release.' },
    ], 'human', 'human:test', emit, now);
  });
  const tasks = readLedger(paths.ledger).tasks;
  return { dir, config, paths, id: tasks.find((t) => t.source.kind === 'jira')!.id, manual: tasks.find((t) => t.source.kind === 'manual')!.id };
}

const TICKET: CriteriaTicket = {
  key: 'ACME-7', title: 'Escalate premium cases', url: 'https://acme.atlassian.net/browse/ACME-7', markdown: 'Premium cases escalate after 2 hours.',
  comments: [{ author: 'Dana Reyes', created: '2026-10-18T09:00:00Z', markdown: 'Only business hours count.' }],
  related: [{ key: 'ACME-3', title: 'Premium Support', relation: 'parent' }],
  full: true,
};

/** Claude Code's JSON result, as `claude -p --output-format json --json-schema` prints it. */
const result = (structured: unknown, session = 'sess-criteria'): RunResult => ({
  code: 0, stderr: '', stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: session, total_cost_usd: 0.4, structured_output: structured }),
});

const ANSWER = {
  criteria: ['A premium case escalates 2 business hours after it opens.'],
  steps: ['Open a premium case at 09:00.', 'Wait until 11:00. The case shows Tier 2.'],
  edgeCases: ['A case opens on a Saturday. The clock starts on Monday at 09:00.'],
  questions: ['Do public holidays count as business hours?'],
};

/** A fake agent: its answers in turn, each call recorded. Anything but claude fails the test. */
function agent(answers: RunResult[]) {
  const calls: { args: string[]; opts?: RunOptions }[] = [];
  const runner = (cmd: string, args: string[], opts?: RunOptions): RunResult => {
    assert.equal(cmd, 'claude', `only the agent runs, not ${cmd} ${args.join(' ')}`);
    calls.push({ args, opts });
    const a = answers[Math.min(calls.length - 1, answers.length - 1)];
    return a!;
  };
  return { calls, runner };
}

test('the drafter\'s prompt holds the ticket, each comment and each related ticket, and says the draft must pass the wording check', () => {
  const { system, prompt } = criteriaPrompt({ task: { id: 'ACME-7', title: 'Escalate premium cases' }, ticket: TICKET, root: '/repo', rules: '- Keep it small.' });
  assert.match(prompt, /# Draft acceptance criteria for ACME-7: Escalate premium cases/);
  assert.match(prompt, /Premium cases escalate after 2 hours\./, 'the description');
  assert.match(prompt, /### Dana Reyes, 2026-10-18T09:00:00Z\n\nOnly business hours count\./, 'each comment, with its author');
  assert.match(prompt, /- parent: ACME-3 Premium Support/, 'each related ticket');
  assert.match(prompt, /## The project's rules\n\n- Keep it small\./);
  assert.match(system, /acc ste check/);
  assert.match(system, /Simplified Technical English \(ASD-STE100\), Strict mode/);
  assert.match(system, /Do not use a semicolon/);
  assert.match(system, /can't change anything, run commands, or post anything/);
  assert.match(system, /open question/);
});

test('a prompt for a ticket with no comments or related tickets says so, and one drafted from the task alone says they were not read (edge case)', () => {
  const bare = criteriaPrompt({ task: { id: 'ACME-7', title: 'x' }, ticket: { ...TICKET, comments: [], related: [], markdown: '' }, root: '/r', rules: null }).prompt;
  assert.match(bare, /_No comments\._/);
  assert.match(bare, /_None\._/);
  assert.match(bare, /no description beyond its title/);
  assert.doesNotMatch(bare, /project's rules/);
  const alone = criteriaPrompt({ task: { id: 'ACME-7', title: 'x' }, ticket: taskTicket({ id: 'ACME-7', title: 'x', brief: 'b', source: { kind: 'jira', key: 'ACME-7', url: null } }), root: '/r', rules: null }).prompt;
  assert.match(alone, /The comments were not read/);
  assert.match(alone, /The related tickets were not read/);
  assert.match(alone, /Task: ACME-7/, 'with no link, the task');
});

test('the answer is parsed into its parts, and junk, an error or a draft with no criteria says what came back (edge cases)', () => {
  const p = parseCriteria(result({ ...ANSWER, edgeCases: ['  ', 7, ' A cleared choice. '] }).stdout);
  assert.deepEqual(p.draft.edgeCases, ['A cleared choice.'], 'blank and non-text items are dropped, and each is trimmed');
  assert.equal(p.sessionId, 'sess-criteria');
  assert.equal(p.costUsd, 0.4);
  assert.throws(() => parseCriteria('not json'), /gave no result Claude Code could read: not json/);
  assert.throws(() => parseCriteria(''), /\(nothing\)/);
  assert.throws(() => parseCriteria(JSON.stringify({ is_error: true, subtype: 'error_max_turns', result: 'ran out' })), /didn't finish \(error_max_turns\): ran out/);
  assert.throws(() => parseCriteria(result({ ...ANSWER, criteria: [] }).stdout), /held no acceptance criteria/);
  assert.deepEqual(Object.keys(CRITERIA_SCHEMA.properties), ['criteria', 'steps', 'edgeCases', 'questions']);
});

test('the draft is Markdown under a sub-heading a part, numbered where order counts, and a part with nothing is left out', () => {
  assert.equal(criteriaMarkdown(ANSWER), [
    `### ${CRITERIA_PARTS.criteria}`, '', '1. A premium case escalates 2 business hours after it opens.', '',
    `### ${CRITERIA_PARTS.steps}`, '', '1. Open a premium case at 09:00.', '2. Wait until 11:00. The case shows Tier 2.', '',
    `### ${CRITERIA_PARTS.edgeCases}`, '', '- A case opens on a Saturday. The clock starts on Monday at 09:00.', '',
    `### ${CRITERIA_PARTS.questions}`, '', '- Do public holidays count as business hours?',
  ].join('\n'));
  assert.doesNotMatch(criteriaMarkdown({ ...ANSWER, questions: [] }), /Open questions/);
  assert.deepEqual(criteriaWording(criteriaSection(criteriaMarkdown(ANSWER))), [], 'its headings pass the wording check');
});

test('the draft goes below the current description under its own heading, or alone in an empty one (edge case)', () => {
  assert.equal(withCriteria('Premium cases escalate.\n\n', '### A\n\n1. x'), `Premium cases escalate.\n\n## ${CRITERIA_HEADING}\n\n### A\n\n1. x`);
  assert.equal(withCriteria('  ', '### A'), `## ${CRITERIA_HEADING}\n\n### A`);
});

test('a draft runs one read-only agent with the reviewer\'s model and effort, is kept with the task, and nothing reaches the tracker', () => {
  const { paths, config, id } = setup();
  const fake = agent([result(ANSWER)]);
  let marked: string | undefined;
  const runner = (cmd: string, args: string[], opts?: RunOptions) => { marked = drafting(paths, id)?.name; return fake.runner(cmd, args, opts); };
  const started: string[] = [];
  const d = draftCriteria(paths, config, id, TICKET, { run: runner, now, env: { PATH: '/bin' }, uuid: () => 'fixed', onStart: (_s, n) => started.push(n) });
  assert.equal(fake.calls.length, 1, 'one run: the draft passed the wording check');
  const args = fake.calls[0]!.args;
  assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 4), ['--model', 'sonnet', '--effort', 'medium']);
  assert.deepEqual(args.slice(args.indexOf('--allowedTools'), args.indexOf('--disallowedTools')), ['--allowedTools', 'Read', 'Grep', 'Glob']);
  assert.ok(args.includes('Bash') && args.includes('Write') && args.includes('Edit'), 'every tool that changes something is refused');
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(args[args.indexOf('--session-id') + 1], 'fixed');
  assert.match(String(fake.calls[0]!.opts?.input), /Only business hours count/, 'its prompt holds the comments');
  assert.equal(fake.calls[0]!.opts?.env?.ACC_ROLE, 'reviewer');
  assert.equal(fake.calls[0]!.opts?.timeoutMs, CRITERIA_TIMEOUT_MS);
  assert.equal(fake.calls[0]!.opts?.cwd, paths.root);
  assert.deepEqual(started, ['Acme · ACME-7 Escalate premium cases · criteria']);
  assert.equal(marked, started[0], 'it shows as drafting while the agent runs');
  assert.equal(drafting(paths, id), null, 'and not after');
  assert.deepEqual(readCriteria(paths, id), d);
  assert.deepEqual(d.read, { comments: 1, related: 1, full: true });
  assert.equal(d.markdown, criteriaMarkdown(ANSWER));
  assert.deepEqual(d.wording, []);
  // Nothing reaches the tracker: no update is drafted, and the agent was the only thing run.
  assert.deepEqual(listUpdates(paths), []);
});

test('a draft that fails the wording check goes back once in the same session with each finding, and the fixed one is kept', () => {
  const { paths, config, id } = setup();
  const bad = { ...ANSWER, criteria: ['A premium case escalates; a standard case does not.'] };
  const fake = agent([result(bad, 'sess-a'), result(ANSWER, 'sess-a')]);
  const d = draftCriteria(paths, config, id, TICKET, { run: fake.runner, now, env: {} });
  assert.equal(fake.calls.length, 2);
  const again = fake.calls[1]!;
  assert.equal(again.args[again.args.indexOf('--resume') + 1], 'sess-a');
  assert.match(String(again.opts?.input), /acc ste check found these problems/);
  assert.match(String(again.opts?.input), /semicolon/);
  assert.deepEqual(d.criteria, ANSWER.criteria);
  assert.deepEqual(d.wording, []);
  assert.equal(d.costUsd, 0.8, 'both runs count');
});

test('a draft whose fix still fails keeps the findings with it, and a fix that is worse keeps the first (edge cases)', () => {
  const { paths, config, id } = setup();
  const bad = { ...ANSWER, criteria: ['A premium case escalates; a standard case does not.'] };
  const worse = { ...ANSWER, criteria: ['One; two; three.'] };
  const kept = draftCriteria(paths, config, id, TICKET, { run: agent([result(bad), result(bad)]).runner, now, env: {} });
  assert.deepEqual(kept.wording.map((f) => f.rule), ['semicolon']);
  const first = draftCriteria(paths, config, id, TICKET, { run: agent([result(bad), result(worse)]).runner, now, env: {} });
  assert.deepEqual(first.criteria, bad.criteria);
  assert.equal(first.wording.length, 1);
});

test('without a ticket file the agent drafts from the task as acc keeps it, and says the comments were not read (edge case)', () => {
  const { paths, config, id } = setup();
  const fake = agent([result(ANSWER)]);
  const d = draftCriteria(paths, config, id, null, { run: fake.runner, now, env: {} });
  assert.deepEqual(d.read, { comments: 0, related: 0, full: false });
  assert.match(String(fake.calls[0]!.opts?.input), /Premium cases escalate after 2 hours/);
  assert.match(String(fake.calls[0]!.opts?.input), /The comments were not read/);
});

test('a task with no tracker, a task that is not there, and a ticket file for another ticket are refused before any agent runs', () => {
  const { paths, config, id, manual } = setup();
  const none = agent([]);
  assert.throws(() => draftCriteria(paths, config, manual, TICKET, { run: none.runner, now, env: {} }), /has no ticket\. Its sheet holds its brief/);
  assert.throws(() => draftCriteria(paths, config, 'ACME-99', TICKET, { run: none.runner, now, env: {} }), /No task ACME-99/);
  assert.throws(() => draftCriteria(paths, config, id, { ...TICKET, key: 'ACME-8' }, { run: none.runner, now, env: {} }), /for ACME-8, not ACME-7/);
  assert.equal(none.calls.length, 0);
  assert.equal(criteriaRefusal(undefined, 'X-1'), 'No task X-1.');
  assert.throws(() => criteriaPath(paths, '../x'), /isn't a task id/);
});

test('an agent that does not start, or that answers junk, keeps no draft and leaves no draft under way, and the Mac is let sleep (edge cases)', () => {
  const { paths, config, id } = setup();
  const awake = fakeAwake();
  assert.throws(() => draftCriteria(paths, config, id, TICKET, { run: agent([{ code: 127, stdout: '', stderr: 'spawnSync claude ENOENT' }]).runner, now, env: {}, awake: awake.deps }), /Claude Code didn't start/);
  assert.equal(awake.killed.length, 1);
  assert.throws(() => draftCriteria(paths, config, id, TICKET, { run: agent([{ code: 0, stdout: 'junk', stderr: '' }]).runner, now, env: {} }), /gave no result/);
  assert.throws(() => draftCriteria(paths, config, id, TICKET, { run: agent([{ code: 1, stdout: '', stderr: '', timedOut: true }]).runner, now, env: {} }), /didn't finish within 20 minutes/);
  assert.equal(readCriteria(paths, id), null);
  assert.equal(drafting(paths, id), null);
  assert.ok(existsSync(criteriaDir(paths)));
});

test('the draft becomes an update draft only when a person asks, and a newer one replaces it while unposted; with no draft it is refused (edge case)', () => {
  const { paths, config, id, manual } = setup();
  assert.throws(() => criteriaUpdate(paths, id, 'human:jordan', now), /no drafted acceptance criteria yet/);
  assert.throws(() => criteriaUpdate(paths, manual, 'human:jordan', now), /has no ticket/);
  draftCriteria(paths, config, id, TICKET, { run: agent([result(ANSWER)]).runner, now, env: {} });
  assert.deepEqual(listUpdates(paths), [], 'drafting writes no update');
  const u = criteriaUpdate(paths, id, 'human:jordan', now);
  assert.deepEqual([u.event, u.state, u.key, u.tracker, u.by], ['criteria', 'draft', 'ACME-7', 'jira', 'human:jordan']);
  assert.equal(u.text, criteriaSection(criteriaMarkdown(ANSWER)));
  const next = criteriaUpdate(paths, id, 'human:jordan', now);
  assert.deepEqual(listUpdates(paths).map((x) => [x.id, x.replaces]), [[next.id, [u.id]]]);
});

test('a tracker\'s ticket is read with its newest comments as Markdown, and a long description is cut (edge case)', () => {
  const person = { id: 'u1', name: 'Dana Reyes' };
  const comments = Array.from({ length: CRITERIA_COMMENTS_MAX + 5 }, (_, n) => ({ id: String(n), author: person, created: `c${n}`, body: fromMarkdown(`**Note ${n}**`), url: null }));
  const t = criteriaTicket({ key: 'ACME-7', title: 't', url: 'u', markdown: 'x'.repeat(CRITERIA_TEXT_MAX + 10), comments, related: [{ key: 'ACME-3', title: 'P', relation: 'parent', url: null }] });
  assert.equal(t.comments.length, CRITERIA_COMMENTS_MAX);
  assert.deepEqual(t.comments.at(-1), { author: 'Dana Reyes', created: `c${CRITERIA_COMMENTS_MAX + 4}`, markdown: `**Note ${CRITERIA_COMMENTS_MAX + 4}**` });
  assert.match(t.markdown, /cut at 30000 characters/);
  assert.deepEqual(t.related, [{ key: 'ACME-3', title: 'P', relation: 'parent' }]);
  assert.equal(t.full, true);
});

test('a ticket file is read as the Command Center writes it, and one that is not JSON or lacks a part is refused (edge cases)', () => {
  assert.deepEqual(parseCriteriaTicket(JSON.stringify({ ...TICKET, full: undefined })), TICKET);
  assert.deepEqual(parseCriteriaTicket(JSON.stringify({ ...TICKET, url: 3, comments: [{ markdown: 'm' }, { x: 1 }], related: [{ key: 'K' }] })), {
    ...TICKET, url: null, comments: [{ author: 'Someone', created: '', markdown: 'm' }], related: [{ key: 'K', title: '', relation: 'related' }],
  });
  assert.throws(() => parseCriteriaTicket('nope'), /isn't JSON/);
  assert.throws(() => parseCriteriaTicket(JSON.stringify({ key: 'K' })), /needs a key, a title/);
  assert.throws(() => parseCriteriaTicket('null'), /needs a key/);
});

test('the wording fix names each finding\'s line', () => {
  const f = criteriaWording('One; two.');
  assert.equal(criteriaFixPrompt(f).split('\n').at(-1), `- Line 1: ${f[0]!.message} [;]`);
});
