import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig, type Config } from '../src/config.ts';
import { renderPacket } from '../src/packet.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { runGates, waiveGates } from '../src/gates.ts';
import { mutate, readLedger, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import type { Receipt } from '../src/receipts.ts';
import { checkLine, latestVerdict, parseReview, readVerdict, review, reviewing, reviewPrompt } from '../src/review.ts';
import { NO_COUNTS } from '../src/test-counts.ts';
import { fakeAwake, fakeRunner, GENERIC_CONFIG, gitIn, makeRepo } from './support.ts';

const NOW = '2026-10-02T12:00:00Z';
const now = () => new Date(NOW);
const RAW = { ...GENERIC_CONFIG, gates: { required: ['test'], commands: { test: 'true' } } };

/** A repo with one task in review on a branch with a commit, its checks passed. */
function setup(state = 'review') {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(RAW), '.acc/rules.md': 'Every function has a test.' });
  const config = parseConfig(RAW).config as Config;
  const base = gitIn(dir, 'branch', '--show-current').trim();
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-1-add-sum');
  writeFileSync(join(dir, 'sum.js'), 'export const sum = (a, b) => a + b;\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'T-1: add sum');
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Add a sum function', brief: '- sum(a, b) returns a + b\n- it has a test' }], 'human', 'human:test', emit, now);
    const t = l.tasks[0]!;
    t.state = state as never;
    t.environment = base;
    t.run = { branch: 'task/T-1-add-sum', worktree: dir };
  });
  runGates(paths, config, config.environments[0]!, [], [], { run, now, slots: { dir: join(dir, '.git', 'slots') } });
  return { dir, config, paths, sha: gitIn(dir, 'rev-parse', 'HEAD').trim() };
}

/** Claude Code's JSON result, as `claude -p --output-format json --json-schema` prints it. */
const result = (structured: unknown, extra: Record<string, unknown> = {}): RunResult => ({
  code: 0, stderr: '', stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'sess-review', total_cost_usd: 0.42, structured_output: structured, ...extra }),
});

test('a passing review is kept for its commit, and the task stays in review, ready to land', () => {
  const { paths, config, sha } = setup();
  let call: { args: string[]; opts?: RunOptions } | null = null;
  const fake = fakeRunner({ claude: (opts) => { call = { args: [], opts }; return result({ verdict: 'pass', summary: 'Adds sum with a test.', criteria: [{ text: 'sum returns a + b', met: true, evidence: 'sum.js:1' }], findings: [] }); } });
  const calls: string[] = [];
  const marks: (string | undefined)[] = [];
  const runner = (cmd: string, args: string[], opts?: RunOptions) => {
    if (cmd === 'claude') { calls.push(args.join(' ')); marks.push(reviewing(paths, 'T-1')?.name); }
    return fake(cmd, args, opts);
  };
  const started: string[] = [];
  const r = review(paths, config, 'T-1', { run: runner, now, env: {}, uuid: () => 'fixed-uuid', onStart: (_s, _sha, name) => started.push(name) });
  assert.equal(r.verdict.verdict, 'pass');
  assert.equal(r.moved, null);
  assert.equal(readLedger(paths.ledger).tasks[0]!.state, 'review');
  assert.deepEqual(readVerdict(paths, 'T-1', sha)?.criteria[0], { text: 'sum returns a + b', met: true, evidence: 'sum.js:1' });
  assert.equal(readVerdict(paths, 'T-1', sha)?.sessionId, 'sess-review');
  // Named for its project, task and role (D-087): in Claude Code, while it runs, and on its verdict.
  const name = 'Tool · T-1 Add a sum function · review';
  assert.deepEqual(started, [name]);
  assert.deepEqual(marks, [name]);
  assert.equal(readVerdict(paths, 'T-1', sha)?.name, name);
  // Read-only by construction, and the long prompt goes on stdin.
  assert.ok(calls[0]!.startsWith(`-p --session-id fixed-uuid --name ${name} --permission-mode dontAsk`), calls[0]!.slice(0, 120));
  assert.match(calls[0]!, /--allowedTools Read Grep Glob --disallowedTools Bash Edit Write/);
  assert.match(calls[0]!, /--permission-mode dontAsk --model claude-opus-5-5 /, 'no model chosen: acc\'s default (D-086)');
  assert.ok(!calls[0]!.includes('--effort'), 'no effort chosen: Claude Code\'s default');
  const lighter = review(paths, { ...config, agents: { ...config.agents, reviewer: { model: 'sonnet', effort: 'medium', fallbackModel: null } } }, 'T-1', { run: runner, now, env: {} });
  assert.equal(lighter.verdict.verdict, 'pass');
  assert.match(calls[1]!, /--permission-mode dontAsk --model sonnet --effort medium/);
  const input = String(call!.opts?.input);
  assert.match(input, /# Review T-1: Add a sum function/);
  assert.match(input, /- test: pass/);
  assert.match(input, /Every function has a test\./, 'the project\'s rules');
  assert.match(input, /\+export const sum/, 'the diff');
  assert.equal(call!.opts?.env?.ACC_ROLE, 'reviewer');
  assert.equal(reviewing(paths, 'T-1'), null, 'the running marker is gone');
});

test('a review that asks for changes sends the task to rework, and the next run is told what to fix', () => {
  const { paths, config } = setup();
  const runner = fakeRunner({ claude: result({
    verdict: 'changes', summary: 'sum has no test.',
    criteria: [{ text: 'it has a test', met: false, evidence: 'no test file' }],
    findings: [{ message: 'Add a test for sum.', must: true, file: 'sum.js', line: 1, rule: 'Every function has a test.' }, { message: 'Consider JSDoc.', must: false }],
  }) });
  const r = review(paths, config, 'T-1', { run: runner, now, env: {} });
  assert.equal(r.moved, 'rework');
  const t = readLedger(paths.ledger).tasks[0]!;
  assert.equal(t.state, 'rework');
  assert.match(t.history.at(-1)!.reason!, /Review asked for changes: sum has no test\./);
  assert.equal(t.history.at(-1)!.actor, 'reviewer');
  const packet = renderPacket({ task: t, config, env: config.environments[0]!, worktree: '/w', branch: 'b', rules: null, environmentSpecific: [], review: latestVerdict(paths, 'T-1') });
  assert.match(packet, /## What the review asked for/);
  assert.match(packet, /`sum\.js:1`: Add a test for sum\. \(rule: Every function has a test\.\)/);
  assert.match(packet, /Not met yet: it has a test\. no test file/);
  assert.ok(!packet.includes('Consider JSDoc'), 'only what must be fixed');
});

test('a review needs the task in review with its checks settled; a waived check counts as settled', () => {
  const running = setup('running');
  assert.throws(() => review(running.paths, running.config, 'T-1', { run: fakeRunner({}), now, env: {} }), /T-1 is running/);
  const { dir, paths, config } = setup();
  writeFileSync(join(dir, 'more.js'), 'x\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'more');
  assert.throws(() => review(paths, config, 'T-1', { run: fakeRunner({}), now, env: {} }), /checks aren't settled .*: test/);
  waiveGates(paths, config, { sha: gitIn(dir, 'rev-parse', 'HEAD').trim(), env: config.environments[0]!, gates: ['test'], reason: 'a test', by: 'human:t', now });
  const r = review(paths, config, 'T-1', { run: fakeRunner({ claude: result({ verdict: 'pass', summary: 'ok', criteria: [], findings: [] }) }), now, env: {} });
  assert.equal(r.verdict.verdict, 'pass');
});

test('a reviewer stopped at its timeout says it timed out, not that Claude Code didn\'t start, and leaves the task in review', () => {
  const { paths, config, sha } = setup();
  const timedOut = fakeRunner({ claude: { code: 127, stdout: '', stderr: "claude didn't finish within 45 minutes, so acc stopped it.", timedOut: true } });
  assert.throws(() => review(paths, config, 'T-1', { run: timedOut, now, env: {} }), (e: Error) => {
    assert.match(e.message, /^The review didn't finish within 45 minutes, so acc stopped it\.$/);
    assert.doesNotMatch(e.message, /didn't start/);
    return true;
  });
  assert.equal(readLedger(paths.ledger).tasks[0]!.state, 'review');
  assert.equal(reviewing(paths, 'T-1'), null, 'the running marker is gone');
  assert.equal(readVerdict(paths, 'T-1', sha), null, 'no verdict');
  // A claude that isn't there still says so.
  const missing = fakeRunner({ claude: { code: 127, stdout: '', stderr: 'spawnSync claude ENOENT' } });
  assert.throws(() => review(paths, config, 'T-1', { run: missing, now, env: {} }), /Claude Code didn't start: spawnSync claude ENOENT/);
});

test('the verdict is read strictly: a pass with something that must be fixed is changes, and no verdict is an error', () => {
  assert.equal(parseReview(result({ verdict: 'pass', summary: 's', criteria: [], findings: [{ message: 'm', must: true }] }).stdout).verdict.verdict, 'changes');
  assert.throws(() => parseReview('not json'), /no result/);
  assert.throws(() => parseReview(result(null, { subtype: 'error_max_turns', is_error: true }).stdout), /didn't finish with a verdict \(error_max_turns\)/);
  const { verdict } = parseReview(result({ verdict: 'pass', summary: 's', criteria: [{ text: 't', met: 'yes' }], findings: [{ message: 'm', must: false, line: 'x' }] }).stdout);
  assert.deepEqual([verdict.criteria[0]!.met, 'line' in verdict.findings[0]!], [false, false], 'only well-formed values are kept');
});

test('the reviewer is told to judge each criterion and skip style, with the profile\'s own checks for Salesforce', () => {
  const base = { task: { id: 'T-1', title: 'x' } as never, envName: 'Dev', envBranch: 'dev', sha: 'abcdef1234', packet: 'p', diff: 'd', stat: 's', checks: [], rules: null };
  const sf = reviewPrompt({ ...base, config: { profile: 'salesforce' } as never });
  assert.match(sf.system, /acceptance criterion/);
  assert.match(sf.system, /Skip formatting/);
  assert.match(sf.system, /bulk-safe/);
  assert.ok(!reviewPrompt({ ...base, config: { profile: 'generic' } as never }).system.includes('Apex'), 'the core stays project-agnostic');
  assert.match(reviewPrompt({ ...base, config: { profile: 'generic' } as never, diff: 'x'.repeat(200_000) }).prompt, /too long to include/);
});

test('the reviewer is told a newly added skip, only or todo is a must-fix finding unless the task asks for it, and reads what each check\'s tests ran (GH-100)', () => {
  const base = { task: { id: 'T-1', title: 'x' } as never, envName: 'Dev', envBranch: 'dev', sha: 'abcdef1234', packet: 'p', diff: 'd', stat: 's', rules: null };
  for (const profile of ['generic', 'salesforce']) {
    const { system } = reviewPrompt({ ...base, checks: [], config: { profile } as never });
    assert.match(system, /^- Did it add a skip, only or todo to a test \(it\.skip, xit, describe\.skip, test\.only, fit, it\.todo, \{ skip: true \}, t\.skip\(\), t\.todo\(\)\)\? Each is a finding with must: true, unless the task asks for it/m, profile);
  }
  const at = { sha: 'a'.repeat(40), env: 'main', startedAt: NOW, finishedAt: NOW, durationMs: 1, log: null };
  const counted: Receipt = { ...at, gate: 'check', status: 'hold', summary: '3 skipped, up from 1 on bbbbbbb: slow sync newly skipped.', command: 'npm run check', counts: { run: 312, passed: 312, failed: 0, skipped: 3, todo: 0, skippedNames: ['a', 'b', 'slow sync'], runner: 'node:test' }, countsNote: 'Compared with 1 skipped on bbbbbbb, the nearest earlier count on main. Newly skipped: slow sync.' };
  const unread: Receipt = { ...at, gate: 'test', status: 'pass', summary: 'Passed.', command: 'make test', countsNote: NO_COUNTS };
  const plain: Receipt = { ...at, gate: 'lint', status: 'pass', summary: 'Passed.', command: 'eslint .' };
  assert.deepEqual([counted, unread, plain].map(checkLine), [
    '- check: hold. 3 skipped, up from 1 on bbbbbbb: slow sync newly skipped. Tests: 312 run, 3 skipped. Compared with 1 skipped on bbbbbbb, the nearest earlier count on main. Newly skipped: slow sync.',
    `- test: pass. Passed. Tests: not read. ${NO_COUNTS}`,
    '- lint: pass. Passed.',
  ]);
  const { prompt } = reviewPrompt({ ...base, checks: [counted].map(checkLine), config: { profile: 'generic' } as never });
  assert.match(prompt, /## The checks on this commit\n\n- check: hold\. .* Tests: 312 run, 3 skipped\./);
});

test('the Mac stays awake while the reviewer runs, for acc\'s own process, and not after, even when it times out (D-067)', () => {
  const { paths, config } = setup();
  const awake = fakeAwake();
  const timedOut = fakeRunner({ claude: () => {
    assert.deepEqual(awake.spawned, [['caffeinate', '-i', '-w', String(process.pid)]], 'held while the reviewer runs');
    assert.deepEqual(awake.killed, []);
    return { code: 127, stdout: '', stderr: "claude didn't finish within 45 minutes, so acc stopped it.", timedOut: true };
  } });
  assert.throws(() => review(paths, config, 'T-1', { run: timedOut, now, env: {}, awake: awake.deps }), /didn't finish within 45 minutes/);
  assert.equal(awake.killed.length, 1, 'released');
});
