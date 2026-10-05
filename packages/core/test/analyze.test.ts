import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { analysisProblems, analysisSection, analyze, analyzing, answerAnalysis, openQuestions, parseAnalysis, readAnalysis } from '../src/analyze.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { dispatch, renderPacket } from '../src/dispatch.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { guardAnalyst, preToolUseHook } from '../src/hooks.ts';
import { mutate, readLedger, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { fakeRunner, GENERIC_CONFIG, makeRepo, SF_CONFIG } from './support.ts';

const now = () => new Date('2026-10-05T12:00:00Z');

/** A repo with one task to do, under the config given. */
function setup(raw: Record<string, unknown> = GENERIC_CONFIG, files: Record<string, string> = {}) {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw), ...files });
  const config = parseConfig(raw).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Escalate premium cases', brief: 'Premium cases escalate after 2 hours.' }], 'human', 'human:test', emit, now);
  });
  return { dir, config, paths, id: readLedger(paths.ledger).tasks[0]!.id };
}

/** Claude Code's JSON result, as `claude -p --output-format json --json-schema` prints it. */
const result = (structured: unknown): RunResult => ({
  code: 0, stderr: '', stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'sess-analyst', total_cost_usd: 0.9, structured_output: structured }),
});

const ANSWER = {
  verdict: 'questions',
  summary: 'Adds an escalation rule on Case. A before-save flow already sets the tier.',
  requirements: { goal: 'Premium cases reach Tier 2 in time.', criteria: ['A High premium case escalates after 2 business hours'], assumptions: ['Business hours are the Premium Support schedule'], outOfScope: ['Standard tier'] },
  questions: [{ question: 'Should Medium premium cases escalate too?', why: 'It doubles the rule entries.', suggested: 'Yes, after 8 hours' }],
  findings: [{ area: 'Case', detail: 'Case_Set_Tier, a before-save flow, sets Tier__c.', source: 'Acme Dev: FlowDefinitionView' }],
  approach: { plan: ['Add the escalation rule', 'Add a test'], files: [{ path: 'force-app/main/default/escalationRules/Case.escalationRules-meta.xml', change: 'update', why: 'the new rule entry' }], refactors: [{ what: 'Move tier logic into the flow', why: 'one place sets it' }], risks: ['Escalation runs as the default case owner'], tests: ['A test case passes 2 hours'], size: 'M' },
  split: [],
};

test('an analysis comes back read-only, with its questions numbered, and is kept for the task (D-052)', () => {
  const { paths, config, id } = setup(SF_CONFIG, { 'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '62.0' }) });
  let call: { args: string[]; opts?: RunOptions } | null = null;
  const fake = fakeRunner({});
  const runner = (cmd: string, args: string[], opts?: RunOptions) => {
    if (cmd === 'claude') { call = { args, opts }; return result(ANSWER); }
    return fake(cmd, args, opts);
  };
  const a = analyze(paths, config, id, { run: runner, now, env: { PATH: '/bin' }, accCommand: 'acc', uuid: () => 'fixed' });
  assert.equal(a.verdict, 'questions');
  assert.deepEqual(a.questions.map((q) => q.id), ['q1']);
  assert.deepEqual(a.orgs, ['Acme Production', 'Acme UAT', 'Acme Dev'], 'it may read every listed org');
  assert.deepEqual(readAnalysis(paths, id)?.findings[0]?.area, 'Case');
  const line = call!.args.join(' ');
  assert.match(line, /^-p --session-id fixed --permission-mode dontAsk/);
  assert.match(line, /Bash\(sf data query:\*\)/);
  assert.match(line, /Bash\(sf project retrieve start:\*\)/);
  assert.ok(!/Bash\(sf project deploy/.test(line) && !/Bash\(sf apex run/.test(line), 'no writes are allowed');
  assert.match(line, /--disallowedTools Edit Write NotebookEdit WebFetch WebSearch/);
  assert.match(line, /--settings .*acc hook pre-tool-use/, 'its hook checks every command as well');
  assert.match(line, new RegExp(`--add-dir ${paths.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), 'it reads the repo from a scratch project');
  assert.equal(call!.opts?.env?.ACC_ROLE, 'analyst');
  assert.ok(existsSync(join(String(call!.opts?.cwd), 'sfdx-project.json')) && String(call!.opts?.cwd).includes(join('acc', 'analyses')), 'retrieves land in a scratch project, never the repo');
  const input = String(call!.opts?.input);
  assert.match(input, /# Analyze ACME-7: Escalate premium cases/);
  assert.match(input, /`Acme Dev`: Dev \(developer\)/);
  assert.equal(analyzing(paths, id), null, 'the running marker is gone');
  assert.equal(readLedger(paths.ledger).tasks[0]!.state, 'todo', 'an analysis moves nothing');
});

test('answers make it ready; a re-analysis keeps them; a ready verdict with questions isn\'t ready', () => {
  const { paths, config, id } = setup(SF_CONFIG);
  const runner = (cmd: string, args: string[], opts?: RunOptions) => (cmd === 'claude' ? result(ANSWER) : fakeRunner({})(cmd, args, opts));
  analyze(paths, config, id, { run: runner, now, env: {} });
  assert.deepEqual(analysisProblems(paths, config, readLedger(paths.ledger).tasks[0]!).length, 1, 'held for its question');
  assert.throws(() => answerAnalysis(paths, id, 'q9', 'x', 'human:me', now), /has no question q9/);
  const answered = answerAnalysis(paths, id, '1', 'Yes, after 8 business hours', 'human:me', now);
  assert.equal(answered.verdict, 'ready');
  assert.deepEqual(openQuestions(answered), []);
  assert.deepEqual(analysisProblems(paths, config, readLedger(paths.ledger).tasks[0]!), []);
  // Asked again, the same question keeps its answer.
  const again = analyze(paths, config, id, { run: runner, now, env: {} });
  assert.equal(again.verdict, 'ready');
  assert.equal(again.questions[0]!.answer?.text, 'Yes, after 8 business hours');
  assert.equal(parseAnalysis(result({ ...ANSWER, verdict: 'ready' }).stdout).analysis.verdict, 'questions');
  assert.throws(() => parseAnalysis('not json'), /no result Claude Code could read/);
  assert.throws(() => parseAnalysis(JSON.stringify({ is_error: true, subtype: 'error_max_turns', result: 'ran out' })), /didn't finish \(error_max_turns\)/);
});

test('an analyst stopped at its timeout says it timed out, not that Claude Code didn\'t start, and keeps nothing', () => {
  const { paths, config, id } = setup();
  const timedOut = fakeRunner({ claude: { code: 127, stdout: '', stderr: "claude didn't finish within 45 minutes, so acc stopped it.", timedOut: true } });
  assert.throws(() => analyze(paths, config, id, { run: timedOut, now, env: {} }), (e: Error) => {
    assert.match(e.message, /^The analysis didn't finish within 45 minutes, so acc stopped it\.$/);
    assert.doesNotMatch(e.message, /didn't start/);
    return true;
  });
  assert.equal(analyzing(paths, id), null, 'the running marker is gone');
  assert.equal(readAnalysis(paths, id), null, 'no analysis');
  // A claude that isn't there still says so.
  const missing = fakeRunner({ claude: { code: 127, stdout: '', stderr: 'spawnSync claude ENOENT' } });
  assert.throws(() => analyze(paths, config, id, { run: missing, now, env: {} }), /Claude Code didn't start: spawnSync claude ENOENT/);
});

test('Salesforce tasks wait for their analysis; generic ones don\'t; a person can go without (D-052)', () => {
  const sf = setup(SF_CONFIG);
  const task = readLedger(sf.paths.ledger).tasks[0]!;
  assert.match(analysisProblems(sf.paths, sf.config, task)[0]!, /hasn't been analyzed.*acc analyze ACME-7/);
  const deps = { run: fakeRunner({}), now, accBinDir: '/acc/bin', env: { HOME: '/nowhere' } };
  assert.throws(() => dispatch(sf.paths, sf.config, task.id, deps, { actor: 'human', by: 'human:me' }), /hasn't been analyzed/);
  assert.throws(() => dispatch(sf.paths, sf.config, task.id, deps, { actor: 'orchestrator', by: 'o', withoutAnalysis: true }), /hasn't been analyzed/, 'only a person goes without');
  assert.throws(() => dispatch(sf.paths, sf.config, task.id, deps, { actor: 'human', by: 'human:me', withoutAnalysis: true }), (e: Error) => !/analyzed/.test(e.message), 'a person gets past the gate');
  const split = { ...ANSWER, verdict: 'split', questions: [], split: ['The rule', 'The dashboards'] };
  analyze(sf.paths, sf.config, task.id, { run: (c, a, o) => (c === 'claude' ? result(split) : fakeRunner({})(c, a, o)), now, env: {} });
  assert.match(analysisProblems(sf.paths, sf.config, task)[0]!, /too big for one task\. Split it into: The rule; The dashboards/);
  const generic = setup();
  assert.deepEqual(analysisProblems(generic.paths, generic.config, readLedger(generic.paths.ledger).tasks[0]!), [], 'optional for a generic project');
  const strict = setup({ ...GENERIC_CONFIG, analysis: { required: true } });
  assert.equal(analysisProblems(strict.paths, strict.config, readLedger(strict.paths.ledger).tasks[0]!).length, 1, 'unless it asks for one');
  assert.deepEqual(parseConfig({ ...GENERIC_CONFIG, analysis: { required: 'yes' } }).errors, ['"analysis.required" must be true or false.']);
});

test('the builder is given the analysis and the answers', () => {
  const { paths, config, id } = setup(SF_CONFIG);
  analyze(paths, config, id, { run: (c, a, o) => (c === 'claude' ? result(ANSWER) : fakeRunner({})(c, a, o)), now, env: {} });
  answerAnalysis(paths, id, 'q1', 'Yes, after 8 business hours', 'human:me', now);
  const a = readAnalysis(paths, id);
  const md = analysisSection(a).join('\n');
  assert.match(md, /## What the analysis found/);
  assert.match(md, /Should Medium premium cases escalate too\? \*\*Yes, after 8 business hours\*\*/);
  assert.match(md, /Case: Case_Set_Tier, a before-save flow, sets Tier__c\. \(Acme Dev: FlowDefinitionView\)/);
  assert.match(md, /\*\*Refactors first\*\*\n\n- Move tier logic into the flow: one place sets it/);
  const task = readLedger(paths.ledger).tasks[0]!;
  const packet = renderPacket({ task, config, env: config.environments[2]!, worktree: '/w', branch: 'b', rules: null, environmentSpecific: [], analysis: a });
  assert.ok(packet.indexOf('## What the analysis found') > packet.indexOf('## The task') && packet.indexOf('## What the analysis found') < packet.indexOf('## Where you are'));
  assert.deepEqual(analysisSection(null), []);
  assert.ok(!readFileSync(join(paths.analyses, `${id}.json`), 'utf8').includes('"answer": null'));
});

test('the analyst reads, and only reads: every command is checked, through chains and wrappers', () => {
  assert.equal(guardAnalyst('sf data query --query "SELECT Id FROM Case LIMIT 5" --target-org "Acme Dev" --json'), null);
  assert.equal(guardAnalyst('sf data query -q "SELECT Name FROM ApexTrigger" --use-tooling-api -o "Acme Dev"'), null);
  assert.equal(guardAnalyst('git log --oneline -5 && git show HEAD:force-app/x.cls'), null);
  assert.equal(guardAnalyst('sf project retrieve start --metadata Flow:Case_Set_Tier --target-org "Acme Dev"'), null);
  assert.match(guardAnalyst('sf data query -q "SELECT Id FROM Case" && sf data delete record --sobject Case --record-id 500x')!, /only reads: sf data delete/);
  assert.match(guardAnalyst('sf apex run --file x.apex')!, /only reads/);
  assert.match(guardAnalyst('sf project deploy start --dry-run')!, /only reads/);
  assert.match(guardAnalyst('rm -rf force-app')!, /only reads/);
  assert.match(guardAnalyst('sf project retrieve start --metadata ApexClass:X --output-dir ../repo/force-app')!, /without --output-dir/);
  const ctx = { cwd: '/x', env: { ACC_ROLE: 'analyst' }, run, now };
  assert.match(String((preToolUseHook({ tool_name: 'Write', tool_input: { file_path: '/x/a' } }, ctx) as any)?.hookSpecificOutput?.permissionDecisionReason), /changes nothing/);
  assert.equal(preToolUseHook({ tool_name: 'Bash', tool_input: { command: 'sf sobject describe --sobject Case' } }, ctx), null);
  assert.equal((preToolUseHook({ tool_name: 'Bash', tool_input: { command: 'sf org delete sandbox' } }, ctx) as any)?.hookSpecificOutput?.permissionDecision, 'deny');
});
