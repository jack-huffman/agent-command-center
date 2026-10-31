import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { NOTE_STE_RULE } from '../src/agent-notes.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { NOTE_FIX_TRIES } from '../src/note-wording.ts';
import { renderPacket } from '../src/packet.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { runGates, waiveGates } from '../src/gates.ts';
import { mutate, readLedger, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import type { Receipt } from '../src/receipts.ts';
import { checkLine, DUPLICATE_HELPER, latestVerdict, parseReview, readVerdict, review, reviewing, reviewPrompt } from '../src/review.ts';
import { rulesText } from '../src/rules.ts';
import { NO_COUNTS } from '../src/test-counts.ts';
import { fakeAwake, fakeRunner, GENERIC_CONFIG, gitIn, makeRepo } from './support.ts';

const NOW = '2026-10-02T12:00:00Z';
const now = () => new Date(NOW);
// Its tasks add files at the root; stray-files has its own tests (GH-103).
const RAW = { ...GENERIC_CONFIG, gates: { required: ['test'], commands: { test: 'true' } }, strayFiles: { required: false } };

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
  assert.match(calls[0]!, /--permission-mode dontAsk --model claude-opus-5-5 --effort medium/, 'no model chosen: the Command Center\'s default for a reviewer, Opus 5.5 at medium (D-086, T-163)');
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

test('edge case: the branch moves while a local review runs, and a cloud review fired on the new head outlives the older verdict', () => {
  const { dir, paths, config, sha } = setup();
  let moved = '';
  const cloud = (at: string) => mutate(paths, now, (l, emit) => {
    l.tasks[0]!.cloudReview = { sessionId: 's', url: 'u', firedAt: NOW, sha: at, branch: `acc/review/T-1-${at}` };
    emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'h', data: {} });
  });
  const pass = result({ verdict: 'pass', summary: 'ok', criteria: [], findings: [] });
  // While the reviewer reads sha, the builder commits again and autopilot fires a cloud review on the new head.
  const runner = fakeRunner({ claude: () => {
    writeFileSync(join(dir, 'more.js'), 'x\n');
    gitIn(dir, 'add', '-A');
    gitIn(dir, 'commit', '-q', '-m', 'more');
    moved = gitIn(dir, 'rev-parse', 'HEAD').trim();
    cloud(moved);
    return pass;
  } });
  const r = review(paths, config, 'T-1', { run: runner, now, env: {} });
  assert.equal(r.verdict.sha, sha, 'the verdict is for the commit reviewed');
  assert.notEqual(moved, sha);
  assert.equal(readLedger(paths.ledger).tasks[0]!.cloudReview?.sha, moved, 'the newer cloud review still runs');
  // With the head unmoved, a local verdict for the head ends a cloud review of an older commit, as before.
  waiveGates(paths, config, { sha: moved, env: config.environments[0]!, gates: ['test'], reason: 'a test', by: 'human:t', now });
  cloud(sha);
  review(paths, config, 'T-1', { run: fakeRunner({ claude: pass }), now, env: {} });
  assert.equal(readLedger(paths.ledger).tasks[0]!.cloudReview, null, 'a verdict for the head ends it');
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

test('the reviewer is told to judge each criterion and skip style, and Salesforce\'s own checks come first among its rules (GH-108)', () => {
  const base = { task: { id: 'T-1', title: 'x' } as never, envName: 'Dev', envBranch: 'dev', sha: 'abcdef1234', packet: 'p', diff: 'd', stat: 's', checks: [], rules: null };
  const dir = makeRepo();
  const sf = reviewPrompt({ ...base, config: { profile: 'salesforce' } as never, rules: rulesText(dir, 'salesforce') });
  assert.match(sf.system, /acceptance criterion/);
  assert.match(sf.system, /Skip formatting/);
  assert.ok(!sf.system.includes('bulk-safe'), 'the profile\'s rules are said once, among the rules, not again here');
  assert.match(sf.prompt, /## Rules\n\n.*this repo's own rules win over the others\.\n\n### Every project's rules\n\n- Put new behaviour in its own file\.[^#]*\n\n### The Salesforce profile's rules\n\n- Apex is bulk-safe/);
  const generic = reviewPrompt({ ...base, config: { profile: 'generic' } as never, rules: rulesText(dir, 'generic') });
  assert.ok(!generic.system.includes('Apex') && !generic.prompt.includes('Apex'), 'the core stays project-agnostic');
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

test('in every profile, the reviewer looks for a new helper that duplicates an existing one, and names both (GH-104)', () => {
  const base = { task: { id: 'T-1', title: 'x' } as never, envName: 'Dev', envBranch: 'dev', sha: 'abcdef1234', packet: 'p', diff: 'd', stat: 's', checks: [], rules: null };
  for (const profile of ['generic', 'salesforce'] as const) {
    const { system } = reviewPrompt({ ...base, config: { profile } as never });
    assert.ok(system.includes(`\n- ${DUPLICATE_HELPER}\n`), profile);
    assert.match(system, /helper that does what an existing one already does\? Search for one/, profile);
    assert.match(system, /name both in the finding's message, each as file:line/, profile);
    assert.match(system, /exported, the finding must be fixed \(must: true\): use it instead\. A near-copy of a local, unexported one is must: false/, profile);
  }
  // The plugin's reviewer says the same.
  const md = readFileSync(join(import.meta.dirname, '..', '..', '..', 'plugin', 'agents', 'reviewer.md'), 'utf8');
  assert.match(md, /- Does it add a helper that does what an existing one already does\? .* each as file:line\. When the existing one is exported, it must be fixed/);
  assert.match(md, /- In every project, also: new behaviour is in its own file, registered with one line .* temp file then a rename\./);
});

test('the reviewer reads the builder\'s note as its own account, to check against the diff, or that it left none (D-106)', () => {
  const base = { envName: 'Dev', envBranch: 'dev', sha: 'abcdef1234', packet: 'p', diff: 'd', stat: 's', checks: ['- test: pass. ok'], rules: null, config: { profile: 'generic' } as never };
  const note = { landed: ['sum(a, b) adds'], moved: ['1 test added'], open: ['sum of three numbers'], at: '2026-10-01T12:00:00Z', by: 'builder:T-1', ended: 'review' as const };
  const r = reviewPrompt({ ...base, task: { id: 'T-1', title: 'x', run: { note } } as never });
  assert.match(r.system, /The builder's note is its own account of what landed, which numbers moved and what's still open\. Check it against the diff rather than trust it/);
  assert.match(r.prompt, /- test: pass\. ok\n\n## The builder's note\n\nWhat the builder said as it finished, in its own words\. Check it against the diff\.\n\n\*\*What landed\*\*\n\n- sum\(a, b\) adds\n\n\*\*Numbers that moved\*\*\n\n- 1 test added\n\n\*\*Still open\*\*\n\n- sum of three numbers\n/);
  assert.match(reviewPrompt({ ...base, task: { id: 'T-1', title: 'x', run: {} } as never }).prompt, /## The builder's note\n\nThe builder left no note\.\n/);
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

test('a review whose words fail the wording check is asked again in its session with each fix, and the fixed one is kept (T-149)', () => {
  const { paths, config, sha } = setup();
  const calls: { args: string; input: string }[] = [];
  const answers = [
    result({ verdict: 'changes', summary: 'sum has no test; add one.', criteria: [], findings: [{ message: 'Kick off a test for sum.', must: true }] }, { total_cost_usd: 0.4 }),
    result({ verdict: 'changes', summary: 'sum has no test. Add one.', criteria: [], findings: [{ message: 'Add a test for sum.', must: true }] }, { total_cost_usd: 0.1 }),
  ];
  const fake = fakeRunner({ claude: () => answers[calls.length - 1]! });
  const runner = (cmd: string, args: string[], opts?: RunOptions): RunResult => {
    if (cmd === 'claude') calls.push({ args: args.join(' '), input: String(opts?.input) });
    return fake(cmd, args, opts);
  };
  const r = review(paths, config, 'T-1', { run: runner, now, env: {}, uuid: () => 'fixed-uuid' });
  assert.equal(calls.length, 2);
  assert.ok(calls[1]!.args.startsWith('-p --resume sess-review --permission-mode dontAsk'), calls[1]!.args.slice(0, 80));
  assert.ok(calls[1]!.input.includes('- Summary: STE bans the semicolon (Rule 8.1). Split into separate sentences. [;]'), calls[1]!.input);
  assert.ok(calls[1]!.input.includes('- Finding 1: Soft phrasal verb.'), calls[1]!.input);
  assert.equal(r.verdict.summary, 'sum has no test. Add one.');
  assert.equal(readVerdict(paths, 'T-1', sha)?.findings[0]?.message, 'Add a test for sum.');
  assert.equal(readVerdict(paths, 'T-1', sha)?.costUsd, 0.5, 'both answers are paid for');
  assert.equal(r.moved, 'rework');
});

test('edge case: a review that still fails the wording check after its fixes is refused, and nothing is kept or moved (T-149)', () => {
  const { paths, config, sha } = setup();
  let asked = 0;
  const runner = fakeRunner({ claude: () => {
    asked++;
    return result({ verdict: 'changes', summary: 'sum has no test; add one.', criteria: [], findings: [] });
  } });
  assert.throws(() => review(paths, config, 'T-1', { run: runner, now, env: {} }), (e: Error) => /still fails the Simplified Technical English check after 2 fixes, so acc kept no verdict/.test(e.message) && e.message.includes('- Summary: STE bans the semicolon'));
  assert.equal(asked, 1 + NOTE_FIX_TRIES, 'the first answer and each fix');
  assert.equal(readVerdict(paths, 'T-1', sha), null, 'no verdict kept');
  assert.equal(readLedger(paths.ledger).tasks[0]!.state, 'review', 'the task stays in review');
  assert.equal(reviewing(paths, 'T-1'), null, 'the running marker is gone');
});

test('the reviewer is told to write its summary and findings in Simplified Technical English, here and in the plugin (T-149)', () => {
  const { paths, config } = setup();
  const t = readLedger(paths.ledger).tasks[0]!;
  const { system } = reviewPrompt({ task: t, config, envName: 'dev', envBranch: 'main', sha: 'abcdef1234', packet: '# packet', diff: '', stat: '', checks: [], rules: null });
  assert.ok(system.includes(NOTE_STE_RULE), 'the headless reviewer');
  const md = readFileSync(join(import.meta.dirname, '..', '..', '..', 'plugin', 'agents', 'reviewer.md'), 'utf8');
  assert.match(md, /Write the summary and each finding for the person who reads them, in Simplified Technical English \(ASD-STE100\)/);
});
