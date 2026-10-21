import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { parseConfig, type Config } from '../src/config.ts';
import { criteriaPath } from '../src/criteria.ts';
import { mainCheckout, setupWorktree } from '../src/dispatch.ts';
import { baseRef } from '../src/review.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { receiptsAt } from '../src/receipts.ts';
import { mutate, readLedger, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { steLint } from '../src/ste.ts';
import { listUpdates } from '../src/updates.ts';
import {
  baseEnvironment, CHECK_WORDS, DIRTY_GATE, DIRTY_SUMMARY, checkoutHead, clearVerification, findPullRequests, latestVerification, namedPr, namesKey, OWN_WORK, prWords, pruneVerifications, qaComment, qaWording,
  readPrChoice, readVerification, readVerifications, verificationPath, verificationsDir, verify, VERIFY_TIMEOUT_MS, verifyCheck, verifyFixPrompt, verifying, verifyPrompt, verifyRefusal, verifyWorktree,
  type Verification, type VerifyPr,
} from '../src/verify.ts';
import { fakeAwake, gitIn, makeRepo, tempDir } from './support.ts';

const now = () => new Date('2026-10-21T12:00:00Z');

// lint passes; org stands for a check that needs what the person hasn't named, so it can't run.
const RAW = {
  schema: 1, project: 'Acme', profile: 'generic', environments: [{ name: 'main', default: true }],
  github: { repo: 'acme/service', account: 'work' },
  gates: { required: ['lint', 'org'], commands: { lint: 'true', org: 'echo "needs an org: name one" >&2; exit 127' } },
  strayFiles: { required: false },
  agents: { reviewer: { model: 'sonnet', effort: 'medium' } },
};

/**
 * A clone with an origin on disk, a Jira task, a task acc keeps, and a task acc's builder made. On origin,
 * the developer's branch acme-7-escalate is pull request #7: one commit that adds escalate.js.
 */
function setup(raw: Record<string, unknown> = RAW) {
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw), '.gitignore': '.claude/\n' });
  const origin = tempDir('acc-origin-');
  gitIn(origin, 'init', '-q', '--bare', '-b', 'main');
  gitIn(dir, 'remote', 'add', 'origin', origin);
  gitIn(dir, 'push', '-q', 'origin', 'main');
  gitIn(dir, 'checkout', '-q', '-b', 'acme-7-escalate');
  writeFileSync(join(dir, 'escalate.js'), 'export const escalateAfterHours = 2;\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'ACME-7: escalate premium cases');
  const sha = gitIn(dir, 'rev-parse', 'HEAD');
  gitIn(dir, 'push', '-q', 'origin', 'HEAD:refs/heads/acme-7-escalate', 'HEAD:refs/pull/7/head', 'HEAD:refs/pull/8/head');
  gitIn(dir, 'checkout', '-q', 'main');
  gitIn(dir, 'branch', '-q', '-D', 'acme-7-escalate');
  const config = parseConfig(raw).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [
      { source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Escalate premium cases', brief: 'Premium cases escalate after 2 hours.' },
      { source: { kind: 'manual' }, title: 'Write the changelog', brief: 'One entry a release.' },
      { source: { kind: 'jira', key: 'ACME-9', url: 'https://acme.atlassian.net/browse/ACME-9' }, title: 'Built by acc', brief: 'acc built it.' },
    ], 'human', 'human:test', emit, now);
    l.tasks.find((t) => t.id === 'ACME-9')!.run = { branch: 'task/ACME-9-built-by-acc', worktree: join(dir, 'gone') } as never;
  });
  const manual = readLedger(paths.ledger).tasks.find((t) => t.source.kind === 'manual')!.id;
  return { dir, config, paths, sha, manual };
}

const pr = (n: number, sha: string, extra: Partial<Record<string, string>> = {}) => ({
  number: n, url: `https://github.com/acme/service/pull/${n}`, title: `ACME-7 Escalate premium cases`, headRefName: 'acme-7-escalate', baseRefName: 'main', headRefOid: sha, ...extra,
});

/** Claude Code's JSON result, as `claude -p --output-format json --json-schema` prints it. */
const result = (structured: unknown, session = 'sess-verify'): RunResult => ({
  code: 0, stderr: '', stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: session, total_cost_usd: 0.3, structured_output: structured }),
});

const PASS = {
  verdict: 'pass', summary: 'Pass. The change escalates a premium case after 2 hours.', client: 'Premium cases now escalate after 2 hours.',
  criteria: [{ text: 'A premium case escalates after 2 hours.', met: true, evidence: 'escalate.js:1 sets the hours to 2.' }],
  findings: [{ message: 'Add a test for the 2 hour limit.', must: false, file: 'escalate.js', line: 1 }],
};

/**
 * A runner that records every command: gh answers from `lists` and `views`, claude from `answers` in
 * turn, and git and the checks run for real.
 */
function runner(o: { lists?: { search: unknown[]; all: unknown[] }; views?: Record<string, unknown>; answers?: RunResult[] } = {}) {
  const calls: string[] = [];
  const prompts: string[] = [];
  const agentCalls: { args: string[]; opts?: RunOptions }[] = [];
  const r = (cmd: string, args: string[], opts?: RunOptions): RunResult => {
    calls.push([cmd, ...args].join(' '));
    if (cmd === 'gh') {
      if (args[0] === 'auth') return { code: 0, stdout: 'gho_test\n', stderr: '' };
      if (args[0] === 'pr' && args[1] === 'list') return { code: 0, stdout: JSON.stringify(args.includes('--search') ? o.lists?.search ?? [] : o.lists?.all ?? []), stderr: '' };
      if (args[0] === 'pr' && args[1] === 'view') {
        const v = o.views?.[args[2]!];
        return v ? { code: 0, stdout: JSON.stringify(v), stderr: '' } : { code: 1, stdout: '', stderr: 'GraphQL: Could not resolve to a PullRequest' };
      }
      return { code: 1, stdout: '', stderr: `no fixture for gh ${args.join(' ')}` };
    }
    if (cmd === 'claude') {
      agentCalls.push({ args, opts });
      prompts.push(String(opts?.input ?? ''));
      const answers = o.answers ?? [result(PASS)];
      return answers[Math.min(agentCalls.length - 1, answers.length - 1)]!;
    }
    return run(cmd, args, opts);
  };
  return { run: r, calls, prompts, agentCalls };
}

const deps = (r: ReturnType<typeof runner>, extra: Record<string, unknown> = {}) => ({ run: r.run, now, env: {}, uuid: () => 'fixed-uuid', awake: fakeAwake().deps, ...extra });

/** A command that writes to GitHub, a tracker or the repo's history: none may run in a verification. */
const WRITES = /^(git (push|commit|merge|rebase|tag)( |$)|git branch (?!--list)|git worktree add (?!--detach)|gh pr (create|merge|edit|comment|review|close|ready|reopen)|gh issue|gh api)/;

test('one pull request found: its head is checked out with no branch, the checks run there, and the verdict, the stored verification and a QA comment draft follow', () => {
  const { dir, config, paths, sha } = setup();
  mkdirSync(join(paths.stateDir, 'criteria'), { recursive: true });
  writeFileSync(criteriaPath(paths, 'ACME-7'), JSON.stringify({ v: 1, task: 'ACME-7', key: 'ACME-7', markdown: '### Acceptance criteria\n\n1. A Gold case escalates too.' }));
  const r = runner({ lists: { search: [pr(7, sha)], all: [pr(7, sha), pr(3, 'a'.repeat(40), { title: 'Other work', headRefName: 'acme-12-other' })] } });
  const steps: string[] = [];
  const started: string[] = [];
  const v = verify(paths, config, 'ACME-7', deps(r, {
    onStart: (_s: string, name: string, p: VerifyPr) => started.push(`${name} #${p.number}`),
    steps: { on: true, used: false, ended: false, start: (id: string) => steps.push(id), done: () => undefined, skip: () => undefined, fail: () => undefined, result: () => undefined, step: <T>(id: string, _l: string, fn: () => T) => { steps.push(id); return fn(); } },
  }), { by: 'human:tester' });

  // The pull request: found once, though both searches found it, and ACME-12's branch isn't ACME-7's.
  assert.equal(v.pr.number, 7);
  assert.equal(v.sha, sha);
  assert.deepEqual(started, ['Acme · ACME-7 Escalate premium cases · verify #7']);
  // A detached worktree at the head's commit, under the worktree root, with no branch made anywhere.
  const wt = verifyWorktree(config, mainCheckout(run, dir), 'ACME-7');
  assert.equal(wt, join(mainCheckout(run, dir), '.claude', 'worktrees', 'verify-ACME-7'));
  assert.equal(gitIn(wt, 'rev-parse', 'HEAD'), sha);
  assert.throws(() => gitIn(wt, 'symbolic-ref', '--quiet', 'HEAD'), 'no branch is checked out');
  assert.match(gitIn(dir, 'worktree', 'list', '--porcelain'), new RegExp(`worktree ${wt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\nHEAD ${sha}\\ndetached`));
  assert.equal(gitIn(dir, 'branch', '--list'), '* main', 'no local branch for the pull request');
  assert.ok(r.calls.some((c) => c === `git worktree add --detach ${wt} ${sha}`));
  // The checks ran in the worktree: one passed, and one that couldn't run is skipped with its reason.
  assert.deepEqual(v.checks, [
    { gate: 'lint', status: 'pass', summary: 'Passed.' },
    { gate: 'org', status: 'skip', summary: 'It couldn\'t run here: needs an org: name one' },
  ]);
  assert.ok(r.calls.some((c) => c.endsWith('sh -c true')));
  // D-182: receipts by sha, one for each check, as for any commit.
  const receipts = receiptsAt(repoPaths(wt, run), sha);
  assert.deepEqual(Object.keys(receipts).sort(), ['lint', 'org']);
  assert.deepEqual([receipts.lint!.status, receipts.lint!.sha], ['pass', sha]);
  // The verifier: read-only, with the reviewer's model and effort, in the worktree.
  const call = r.agentCalls[0]!;
  assert.equal(call.opts?.cwd, wt);
  assert.match(call.args.join(' '), /--permission-mode dontAsk --model sonnet --effort medium/);
  assert.match(call.args.join(' '), /--allowedTools Read Grep Glob --disallowedTools Bash Edit Write/);
  assert.equal(call.opts?.timeoutMs, VERIFY_TIMEOUT_MS);
  const prompt = r.prompts[0]!;
  assert.match(prompt, /\+export const escalateAfterHours = 2;/, 'the diff');
  assert.match(prompt, /Premium cases escalate after 2 hours\./, 'the ticket');
  assert.match(prompt, /A Gold case escalates too\./, 'the drafted criteria');
  assert.match(prompt, /- org: skip\. It couldn't run here/);
  assert.match(call.args[call.args.indexOf('--append-system-prompt') + 1]!, /A developer made this change, not an agent/);
  assert.match(call.args[call.args.indexOf('--append-system-prompt') + 1]!, /acc ste check/);
  // Stored by sha, read back, and the latest.
  assert.ok(existsSync(join(paths.stateDir, 'verifications', `ACME-7-${sha}.json`)));
  assert.deepEqual(readVerification(paths, 'ACME-7', sha), v);
  assert.deepEqual(latestVerification(paths, 'ACME-7'), v);
  assert.equal(verifying(paths, 'ACME-7'), null, 'the marker is gone');
  // The QA comment is a draft for a person to post, and the task stays where it was.
  const u = listUpdates(paths);
  assert.equal(u.length, 1);
  assert.deepEqual([u[0]!.id, u[0]!.event, u[0]!.state, u[0]!.by, u[0]!.pr?.number], [v.update, 'verify', 'draft', 'human:tester', 7]);
  assert.equal(u[0]!.text, v.comment);
  assert.match(v.comment, /^\*\*QA result: pass\.\*\* Pass\. The change escalates/);
  assert.deepEqual(v.wording, []);
  assert.equal(readLedger(paths.ledger).tasks.find((t) => t.id === 'ACME-7')!.state, 'todo');
  assert.deepEqual(steps, ['task', 'github', 'find', 'checkout', 'setup', 'checks', 'review', 'comment', 'save']);
});

test('nothing reaches the tracker or GitHub, and no commit or push runs, during a verification', () => {
  const { paths, config, sha } = setup();
  const r = runner({ lists: { search: [pr(7, sha)], all: [] } });
  verify(paths, config, 'ACME-7', deps(r), { by: 'human:tester' });
  assert.ok(r.calls.length > 10, `every command is recorded (${r.calls.length})`);
  const writes = r.calls.filter((c) => WRITES.test(c));
  assert.deepEqual(writes, []);
  // gh only signed in and read.
  assert.deepEqual([...new Set(r.calls.filter((c) => c.startsWith('gh ')).map((c) => c.split(' ').slice(0, 3).join(' ')))], ['gh auth token', 'gh pr list']);
  // The pattern catches each write it names.
  for (const w of ['git push origin x', 'git commit -m x', 'gh pr comment 7', 'gh pr merge 7', 'gh issue comment 1', 'gh api -X POST x', 'git worktree add -b x', 'git branch x']) assert.ok(WRITES.test(w), w);
});

test('no pull request found is refused, and the empty choice is kept; none is checked out (edge case)', () => {
  const { dir, paths, config } = setup();
  const r = runner({ lists: { search: [], all: [] } });
  assert.throws(() => verify(paths, config, 'ACME-7', deps(r), { by: 'human:tester' }), (e: Error & { code?: string }) => e.code === 'no-pr' && /No open pull request on acme\/service names ACME-7/.test(e.message) && /--pr <number>/.test(e.message));
  assert.deepEqual(readPrChoice(paths, 'ACME-7')?.found, []);
  assert.ok(!existsSync(verifyWorktree(config, dir, 'ACME-7')));
  assert.equal(r.agentCalls.length, 0);
  assert.equal(verifying(paths, 'ACME-7'), null, 'the marker goes with the refusal');
});

test('several pull requests found are kept to choose from; --pr names one, which clears the choice', () => {
  const { paths, config, sha } = setup();
  const two = [pr(7, sha), pr(8, sha, { title: 'ACME-7 second try', headRefName: 'acme-7-again' })];
  const r = runner({ lists: { search: two, all: two }, views: { 8: two[1] } });
  assert.throws(() => verify(paths, config, 'ACME-7', deps(r), { by: 'human:tester' }), (e: Error & { code?: string }) => e.code === 'several-prs' && /2 open pull requests/.test(e.message) && e.message.includes(prWords(findPullRequests((a) => r.run('gh', a), 'acme/service', 'ACME-7')[1]!)));
  assert.deepEqual(readPrChoice(paths, 'ACME-7')?.found.map((p) => p.number), [7, 8]);
  const v = verify(paths, config, 'ACME-7', deps(r), { pr: '8', by: 'human:tester' });
  assert.equal(v.pr.number, 8);
  assert.equal(readPrChoice(paths, 'ACME-7'), null);
  assert.ok(r.calls.some((c) => c.startsWith('gh pr view 8 -R acme/service')));
});

test('a pull request in another repo is refused, with why, before anything is fetched', () => {
  const { paths, config } = setup();
  const r = runner();
  assert.throws(() => verify(paths, config, 'ACME-7', deps(r), { pr: 'https://github.com/someone/fork/pull/7', by: 'human:tester' }), /is in someone\/fork, not acme\/service, the project's repo/);
  assert.ok(!r.calls.some((c) => c.startsWith('git fetch')));
  assert.equal(namedPr('https://github.com/ACME/Service/pull/12/files', 'acme/service'), 12, 'case and a page of it don\'t matter');
  assert.equal(namedPr('#5', 'acme/service'), 5);
  assert.throws(() => namedPr('the second one', 'acme/service'), /--pr takes a pull request's number or its GitHub link/);
});

test('a task with no ticket, one acc\'s builder made, one being verified now, a missing one and a project with no GitHub are refused (edge cases)', () => {
  const { paths, config, manual } = setup();
  const r = runner();
  assert.throws(() => verify(paths, config, manual, deps(r), { by: 'human:tester' }), /has no tracker ticket/);
  assert.throws(() => verify(paths, config, 'ACME-9', deps(r), { by: 'human:tester' }), new RegExp(`a task acc's own builder made, and ${OWN_WORK}`));
  assert.throws(() => verify(paths, config, 'NOPE-1', deps(r), { by: 'human:tester' }), (e: Error & { code?: string }) => e.code === 'no-task');
  assert.equal(verifyRefusal({ id: 'ACME-7', source: { kind: 'jira', key: 'ACME-7', url: null } }, 'ACME-7', { github: null }), 'acc finds the developer\'s pull request on GitHub, and this project has no GitHub repo.');
  mkdirSync(verificationsDir(paths), { recursive: true });
  writeFileSync(join(verificationsDir(paths), 'ACME-7.running.json'), JSON.stringify({ sessionId: 's', name: 'n', startedAt: now().toISOString(), pid: process.pid }));
  assert.throws(() => verify(paths, config, 'ACME-7', deps(r), { by: 'human:tester' }), /being verified now/);
  assert.throws(() => clearVerification(paths, config, 'ACME-7', r.run), /being verified now/);
  assert.equal(r.calls.filter((c) => c.startsWith('gh')).length, 0, 'nothing asked GitHub');
});

test('a QA comment that fails the wording check goes back to the verifier once, in the same session; the better one is kept', () => {
  const { paths, config, sha } = setup();
  const bad = { ...PASS, summary: 'Pass; the change works.' };
  const r = runner({ lists: { search: [pr(7, sha)], all: [] }, answers: [result(bad), result(PASS, 'sess-fixed')] });
  const v = verify(paths, config, 'ACME-7', deps(r), { by: 'human:tester' });
  assert.equal(r.agentCalls.length, 2);
  assert.deepEqual(r.agentCalls[1]!.args.slice(0, 3), ['-p', '--resume', 'sess-verify']);
  assert.match(r.prompts[1]!, /STE bans the semicolon/);
  assert.deepEqual(v.wording, []);
  assert.equal(v.sessionId, 'sess-fixed');
  assert.equal(v.costUsd, 0.6);
  // A fix that is worse keeps the first, with its findings.
  const worse = runner({ lists: { search: [pr(7, sha)], all: [] }, answers: [result(bad), result({ ...PASS, summary: 'Pass; it works; mostly.' })] });
  const kept = verify(paths, config, 'ACME-7', deps(worse), { by: 'human:tester' });
  assert.equal(kept.wording.length, 1);
  assert.match(kept.summary, /^Pass; the change works\.$/);
  assert.match(verifyFixPrompt(kept.wording), /Line 1: STE bans the semicolon/);
});

test('a verdict that asks for changes says so in its first line, and lists each check, criterion and finding; the comment passes the wording check', () => {
  const v: Pick<Verification, 'verdict' | 'summary' | 'pr' | 'sha' | 'checks' | 'criteria' | 'findings'> = {
    verdict: 'changes', summary: 'The change does not escalate a Gold case. Add Gold to the premium tiers.', sha: 'b'.repeat(40),
    pr: { number: 7, url: 'https://github.com/acme/service/pull/7', title: 't', head: 'h', base: 'main', sha: 'b'.repeat(40) },
    checks: [{ gate: 'lint', status: 'pass', summary: 'Passed.' }, { gate: 'validate', status: 'skip', summary: 'It couldn\'t run here: Dev has no org alias.' }, { gate: 'tests', status: 'fail', summary: '2 tests failed.' }],
    criteria: [{ text: 'A premium case escalates after 2 hours.', met: true, evidence: 'escalate.js:1' }, { text: 'A Gold case escalates too.', met: false, evidence: 'Nothing reads the Gold tier.' }],
    findings: [{ message: 'Add the Gold tier to the list.', must: true, file: 'escalate.js', line: 3 }, { message: 'Name the constant for its unit.', must: false }],
  };
  const c = qaComment(v);
  assert.equal(c.split('\n')[0], '**QA result: changes are necessary.** The change does not escalate a Gold case. Add Gold to the premium tiers.');
  assert.match(c, /Pull request: https:\/\/github\.com\/acme\/service\/pull\/7 at commit `bbbbbbb`\./);
  assert.match(c, /- `validate`: skipped\. It couldn't run here: Dev has no org alias\./);
  assert.match(c, /- `tests`: fail\. 2 tests failed\./);
  assert.match(c, /- Not met: A Gold case escalates too\. Evidence: Nothing reads the Gold tier\./);
  assert.match(c, /- Must change: Add the Gold tier to the list\. \(`escalate\.js:3`\)/);
  assert.match(c, /- Look at: Name the constant for its unit\./);
  assert.deepEqual(qaWording(c), [], steLint(c).findings.map((f) => f.message).join('; '));
  // Nothing to list says so.
  const empty = qaComment({ ...v, verdict: 'pass', checks: [], criteria: [], findings: [] });
  assert.match(empty, /- No checks ran\./);
  assert.match(empty, /- None\./);
  assert.deepEqual(qaWording(empty), []);
  assert.equal(CHECK_WORDS.error, 'skipped', 'a check that couldn\'t run is never called passed');
});

test('a check that couldn\'t run is skipped with its reason, and the others stay as they ran', () => {
  assert.deepEqual(verifyCheck({ gate: 'validate', status: 'error', summary: 'Dev has no org alias.' }), { gate: 'validate', status: 'skip', summary: 'It couldn\'t run here: Dev has no org alias.' });
  for (const status of ['pass', 'fail', 'skip', 'hold'] as const) assert.equal(verifyCheck({ gate: 'g', status, summary: 's' }).status, status);
});

test('a base that is no environment\'s is checked with no org; an environment\'s base keeps its own', () => {
  const config = parseConfig({ ...RAW, environments: [{ name: 'Dev', org: 'Acme Dev', default: true }] }).config as Config;
  assert.equal(baseEnvironment(config, { environment: 'dev' }, 'dev').org, 'Acme Dev');
  const other = baseEnvironment(config, { environment: 'dev' }, 'release-2');
  assert.deepEqual([other.branch, other.name, other.org, other.protected], ['release-2', 'release-2', null, false]);
});

test('a key is found as a whole word in a title or a branch, whatever its case, and ACME-1 is not ACME-12', () => {
  assert.ok(namesKey('ACME-7 Escalate', 'ACME-7'));
  assert.ok(namesKey('feature/acme-7-escalate', 'ACME-7'));
  assert.ok(!namesKey('ACME-12 Other', 'ACME-1'));
  assert.ok(!namesKey('XACME-7', 'ACME-7'));
  assert.ok(namesKey('Fixes #41', '#41'));
});

test('a pull request GitHub answers without its head commit is left out of what was found (edge case)', () => {
  const r = runner({ lists: { search: [{ number: 4, url: 'u', title: 'ACME-7', headRefName: 'x', baseRefName: 'main' }], all: [] } });
  assert.deepEqual(findPullRequests((a) => r.run('gh', a), 'acme/service', 'ACME-7'), []);
  const failing = (): RunResult => ({ code: 1, stdout: '', stderr: 'HTTP 401' });
  assert.throws(() => findPullRequests(failing, 'acme/service', 'ACME-7'), /GitHub didn't list the pull requests: HTTP 401/);
});

test('verifying again at a new head replaces the worktree; a branch already at its path is refused (edge case)', () => {
  const { dir, config, paths, sha } = setup();
  const r = runner({ lists: { search: [pr(7, sha)], all: [] } });
  verify(paths, config, 'ACME-7', deps(r), { by: 'human:tester' });
  const wt = verifyWorktree(config, mainCheckout(run, dir), 'ACME-7');
  // The same head: used again.
  assert.equal(checkoutHead(r.run, dir, wt, { number: 7, url: '', title: '', head: 'acme-7-escalate', base: 'main', sha }, {}), true);
  // A new head on GitHub: the worktree moves to it.
  const tmp = makeRepo();
  gitIn(tmp, 'remote', 'add', 'origin', gitIn(dir, 'remote', 'get-url', 'origin'));
  gitIn(tmp, 'fetch', '-q', 'origin', 'refs/pull/7/head');
  gitIn(tmp, 'checkout', '-q', 'FETCH_HEAD');
  writeFileSync(join(tmp, 'escalate.js'), 'export const escalateAfterHours = 3;\n');
  gitIn(tmp, 'commit', '-q', '-am', 'ACME-7: three hours');
  const next = gitIn(tmp, 'rev-parse', 'HEAD');
  gitIn(tmp, 'push', '-q', '-f', 'origin', 'HEAD:refs/pull/7/head');
  const r2 = runner({ lists: { search: [pr(7, next)], all: [] } });
  const v2 = verify(paths, config, 'ACME-7', deps(r2, { now: () => new Date('2026-10-21T13:00:00Z') }), { by: 'human:tester' });
  assert.equal(gitIn(wt, 'rev-parse', 'HEAD'), next);
  assert.equal(readVerifications(paths, 'ACME-7').length, 2);
  assert.equal(latestVerification(paths, 'ACME-7')?.sha, v2.sha);
  assert.equal(listUpdates(paths).filter((u) => u.state === 'draft').length, 1, 'the newer QA comment replaces the unposted one');
  // A head GitHub names that isn't on origin is refused.
  assert.throws(() => checkoutHead(r.run, dir, wt, { number: 7, url: '', title: '', head: 'x', base: 'main', sha: 'c'.repeat(40) }, {}), /head moved on GitHub/);
  // A branch checked out at the path is someone's work: refused.
  gitIn(wt, 'checkout', '-q', '-b', 'mine');
  assert.throws(() => checkoutHead(r.run, dir, wt, { number: 7, url: '', title: '', head: 'x', base: 'main', sha }, {}), /is on a branch/);
});

test('clearing removes the worktree, each stored verification and the choice; a task that left the board is pruned, and an empty store runs nothing', () => {
  const { dir, config, paths, sha } = setup();
  const r = runner({ lists: { search: [pr(7, sha)], all: [] } });
  const v = verify(paths, config, 'ACME-7', deps(r), { by: 'human:tester' });
  const wt = verifyWorktree(config, mainCheckout(run, dir), 'ACME-7');
  const cleared = clearVerification(paths, config, 'ACME-7', r.run);
  assert.deepEqual(cleared, { worktree: wt, removed: 1 });
  assert.ok(!existsSync(wt));
  assert.ok(!existsSync(verificationPath(paths, 'ACME-7', sha)));
  assert.equal(listUpdates(paths).find((u) => u.id === v.update)?.state, 'draft', 'the QA comment stays for the person');
  assert.deepEqual(clearVerification(paths, config, 'ACME-7', r.run), { worktree: null, removed: 0 }, 'cleared twice: nothing left');

  // Verified again, then the task leaves the board: the next prune clears it.
  verify(paths, config, 'ACME-7', deps(r), { by: 'human:tester' });
  assert.deepEqual(pruneVerifications(paths, config, r.run), [], 'still on the board');
  mutate(paths, now, (l, emit) => {
    l.tasks.splice(l.tasks.findIndex((t) => t.id === 'ACME-7'), 1);
    emit({ type: 'task.removed', task: 'ACME-7', actor: 'sync', by: 'acc intake', data: {} });
  });
  assert.equal(readLedger(paths.ledger).tasks.some((t) => t.id === 'ACME-7'), false);
  assert.deepEqual(pruneVerifications(paths, config, r.run), ['ACME-7']);
  assert.ok(!existsSync(wt));
  assert.deepEqual(readVerifications(paths, 'ACME-7'), []);
  const quiet = runner();
  const fresh = setup();
  assert.deepEqual(pruneVerifications(fresh.paths, fresh.config, quiet.run), []);
  assert.ok(quiet.calls.every((c) => !/worktree (remove|add)/.test(c)), 'no verification stored: nothing removed');
});

test('a verification that fails after the checkout removes the worktree it added, and prune finds a verify folder with no stored file (edge case)', () => {
  const { dir, config, paths, sha } = setup();
  const wt = verifyWorktree(config, mainCheckout(run, dir), 'ACME-7');
  // The verifier times out: the worktree was added, no file was stored, and nothing is left.
  const slow = runner({ lists: { search: [pr(7, sha)], all: [] }, answers: [{ code: 1, stdout: '', stderr: '', timedOut: true } as RunResult] });
  assert.throws(() => verify(paths, config, 'ACME-7', deps(slow), { by: 'human:tester' }), /didn't finish within/);
  assert.ok(slow.calls.some((c) => c.startsWith('git worktree add --detach')), 'it was added');
  assert.ok(!existsSync(wt), 'and removed');
  assert.doesNotMatch(gitIn(dir, 'worktree', 'list', '--porcelain'), /verify-ACME-7/);
  assert.equal(verifying(paths, 'ACME-7'), null);
  // A setup that fails does the same.
  const bad = setup({ ...RAW, worktrees: { setup: ['exit 3'] } });
  const badWt = verifyWorktree(bad.config, mainCheckout(run, bad.dir), 'ACME-7');
  const r2 = runner({ lists: { search: [pr(7, bad.sha)], all: [] } });
  assert.throws(() => verify(bad.paths, bad.config, 'ACME-7', deps(r2), { by: 'human:tester' }), /Setup command failed/);
  assert.ok(!existsSync(badWt));

  // An older leftover: a verify folder with no stored file, for a task that left the board.
  const left = setup();
  const gone = verifyWorktree(left.config, mainCheckout(run, left.dir), 'ACME-99');
  gitIn(left.dir, 'worktree', 'add', '-q', '--detach', gone, 'HEAD');
  assert.ok(existsSync(gone));
  assert.deepEqual(pruneVerifications(left.paths, left.config, run), ['ACME-99']);
  assert.ok(!existsSync(gone));
  const onBoard = verifyWorktree(left.config, mainCheckout(run, left.dir), 'ACME-7');
  gitIn(left.dir, 'worktree', 'add', '-q', '--detach', onBoard, 'HEAD');
  assert.deepEqual(pruneVerifications(left.paths, left.config, run), [], 'a task still on the board keeps its folder');
  assert.ok(existsSync(onBoard));
  // A folder whose name isn't a task id stops nothing, and stays.
  const odd = join(dirname(onBoard), 'verify-old copy');
  mkdirSync(odd);
  assert.deepEqual(pruneVerifications(left.paths, left.config, run), []);
  assert.ok(existsSync(odd), 'not a task id: left alone');
});

test('a worktree left dirty by setup writes no receipt, and the verification says so as a check line with its reason (edge case)', () => {
  const { dir, config, paths, sha } = setup({ ...RAW, worktrees: { setup: ['touch made-by-setup'] } });
  const r = runner({ lists: { search: [pr(7, sha)], all: [] } });
  const v = verify(paths, config, 'ACME-7', deps(r), { by: 'human:tester' });
  const wt = verifyWorktree(config, mainCheckout(run, dir), 'ACME-7');
  assert.deepEqual(v.checks.at(-1), { gate: DIRTY_GATE, status: 'skip', summary: DIRTY_SUMMARY });
  assert.deepEqual(receiptsAt(repoPaths(wt, run), sha), {}, 'no receipt, as the line says');
  const clean = setup();
  const v2 = verify(clean.paths, clean.config, 'ACME-7', deps(runner({ lists: { search: [pr(7, clean.sha)], all: [] } })), { by: 'human:tester' });
  assert.ok(!v2.checks.some((c) => c.gate === DIRTY_GATE), 'a clean worktree has no such line');
});

test('the verification\'s worktree is set up as a builder\'s is: node_modules linked and the setup commands run; a failing one stops it (edge case)', () => {
  const { dir, config, paths, sha } = setup({ ...RAW, worktrees: { setup: ['touch made-by-setup'] } });
  mkdirSync(join(dir, 'node_modules'));
  const r = runner({ lists: { search: [pr(7, sha)], all: [] } });
  verify(paths, config, 'ACME-7', deps(r), { by: 'human:tester' });
  const wt = verifyWorktree(config, mainCheckout(run, dir), 'ACME-7');
  assert.ok(existsSync(join(wt, 'made-by-setup')));
  assert.ok(existsSync(join(wt, 'node_modules')));
  const env = baseEnvironment(config, { environment: 'main' }, 'main');
  assert.throws(() => setupWorktree(r.run, { ...config, worktrees: { ...config.worktrees, setup: ['exit 3'] } }, env, dir, wt), /Setup command failed in the worktree: exit 3/);
});

test('the diff compares with origin\'s base once it is fetched, and with the local branch before (edge case)', () => {
  const { dir } = setup();
  assert.equal(baseRef(run, makeRepo(), 'main'), 'main', 'no origin: the local branch');
  gitIn(dir, 'fetch', '-q', 'origin');
  assert.equal(baseRef(run, dir, 'main'), 'origin/main');
});

test('the prompt says when no criteria were drafted, and a diff too long to include is read from the worktree (edge case)', () => {
  const base = {
    task: { id: 'ACME-7', title: 'Escalate', brief: '', source: { kind: 'jira' as const, key: 'ACME-7', url: null } },
    pr: { number: 7, url: 'https://github.com/acme/service/pull/7', title: 'ACME-7', head: 'h', base: 'main', sha: 'd'.repeat(40) },
    ticket: '', drafted: null, checks: [], diff: 'x'.repeat(200_000), stat: ' a.js | 1 +', rules: null,
  };
  const { prompt } = verifyPrompt(base);
  assert.doesNotMatch(prompt, /## Drafted acceptance criteria/);
  assert.match(prompt, /The ticket has no description beyond its title/);
  assert.match(prompt, /- none ran/);
  assert.match(prompt, /The diff is too long to include here/);
});
