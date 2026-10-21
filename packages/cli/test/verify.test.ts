// acc verify, verify show and verify clear (T-84): a developer's pull request for a tracked ticket is checked
// out with no branch, checked, reviewed and given a QA comment to post. acc runs from its source, with a
// fake gh and claude that record what they're asked, and a real origin on disk.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gitIn, tempDir } from '../../core/test/support.ts';
import { cli, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

const CONFIG = {
  schema: 1, project: 'Tool', profile: 'generic', environments: [{ name: 'main', default: true }],
  github: { repo: 'acme/service', account: 'work' },
  gates: { required: ['lint'], commands: { lint: 'true' } }, strayFiles: { required: false },
};

const ANSWER = {
  verdict: 'changes', summary: 'A Gold case does not escalate. Add Gold to the premium tiers.', client: 'Gold cases escalate too.',
  criteria: [{ text: 'A premium case escalates after 2 hours.', met: true, evidence: 'escalate.js:1' }],
  findings: [{ message: 'Add Gold to the premium tiers.', must: true, file: 'escalate.js', line: 1 }],
};

/**
 * A repo with a Jira task and a task acc keeps, an origin whose pull request #7 adds escalate.js, and a gh
 * and claude on PATH. gh answers `found` for both lists, and writes nothing.
 */
function verifyRepo(found: 'one' | 'none' | 'two' = 'one') {
  const dir = repoWithConfig(CONFIG);
  writeFileSync(join(dir, '.gitignore'), '.claude/\n.fakebin/\n.answer.json\n.gh*\n.claude-*\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'ignore');
  const origin = tempDir('acc-origin-');
  gitIn(origin, 'init', '-q', '--bare', '-b', 'main');
  gitIn(dir, 'remote', 'add', 'origin', origin);
  gitIn(dir, 'push', '-q', 'origin', 'main');
  gitIn(dir, 'checkout', '-q', '-b', 'acme-7-escalate');
  writeFileSync(join(dir, 'escalate.js'), 'export const escalateAfterHours = 2;\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'ACME-7: escalate');
  const sha = gitIn(dir, 'rev-parse', 'HEAD');
  gitIn(dir, 'push', '-q', 'origin', 'HEAD:refs/pull/7/head', 'HEAD:refs/pull/8/head');
  gitIn(dir, 'checkout', '-q', 'main');
  gitIn(dir, 'branch', '-q', '-D', 'acme-7-escalate');
  const items = [
    { source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Escalate premium cases', brief: 'Premium cases escalate after 2 hours.' },
    { source: { kind: 'manual' }, title: 'Write the changelog' },
  ];
  assert.equal(acc(dir, ['import'], JSON.stringify(items)).code, 0);
  const pr = (n: number) => ({ number: n, url: `https://github.com/acme/service/pull/${n}`, title: `ACME-7 try ${n}`, headRefName: `acme-7-try-${n}`, baseRefName: 'main', headRefOid: sha });
  const list = found === 'one' ? [pr(7)] : found === 'two' ? [pr(7), pr(8)] : [];
  writeFileSync(join(dir, '.gh-list.json'), JSON.stringify(list));
  writeFileSync(join(dir, '.gh-view-8.json'), JSON.stringify(pr(8)));
  writeFileSync(join(dir, '.answer.json'), JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'sess-verify', total_cost_usd: 0.2, structured_output: ANSWER }));
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), [
    '#!/bin/sh',
    `echo "$@" >> "${dir}/.gh-args"`,
    'case "$1 $2" in',
    '  "auth token") echo gho_test ;;',
    `  "pr list") cat "${dir}/.gh-list.json" ;;`,
    `  "pr view") cat "${dir}/.gh-view-$3.json" ;;`,
    '  *) echo "no fixture" >&2; exit 1 ;;',
    'esac',
    '',
  ].join('\n'));
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\necho "$@" >> "${dir}/.claude-args"\ncat > "${dir}/.claude-prompt"\ncat "${dir}/.answer.json"\n`);
  chmodSync(join(bin, 'gh'), 0o755);
  chmodSync(join(bin, 'claude'), 0o755);
  return { dir, sha, env: { PATH: `${bin}:${process.env.PATH}` }, store: join(dir, '.git', 'acc', 'verifications'), wt: join(gitIn(dir, 'rev-parse', '--show-toplevel'), '.claude', 'worktrees', 'verify-ACME-7') };
}

const ghArgs = (dir: string): string[] => (existsSync(join(dir, '.gh-args')) ? readFileSync(join(dir, '.gh-args'), 'utf8').trim().split('\n') : []);

test('acc verify --json verifies the one pull request found, keeps the result, drafts the QA comment, and leaves the task where it was', () => {
  const { dir, sha, env, store, wt } = verifyRepo();
  const r = acc(dir, ['verify', 'acme-7', '--json'], undefined, env);
  assert.equal(r.code, 0, r.err);
  const v = r.json();
  assert.deepEqual([v.task, v.pr.number, v.sha, v.verdict], ['ACME-7', 7, sha, 'changes']);
  assert.deepEqual(v.checks, [{ gate: 'lint', status: 'pass', summary: 'Passed.' }]);
  assert.equal(r.err, '', '--json says nothing more');
  assert.ok(existsSync(join(store, `ACME-7-${sha}.json`)));
  assert.equal(gitIn(wt, 'rev-parse', 'HEAD'), sha);
  assert.match(readFileSync(join(dir, '.claude-prompt'), 'utf8'), /Premium cases escalate after 2 hours/);
  assert.match(readFileSync(join(dir, '.claude-args'), 'utf8'), /--allowedTools Read Grep Glob --disallowedTools Bash Edit Write/);
  // The QA comment is an update draft, and nothing went to GitHub but a sign-in and two lists.
  const updates = JSON.parse(acc(dir, ['updates', '--json']).out);
  const u = (Array.isArray(updates) ? updates : updates.updates).find((x: { id: string }) => x.id === v.update);
  assert.deepEqual([u.event, u.state], ['verify', 'draft']);
  assert.match(u.text, /^\*\*QA result: changes are necessary\.\*\* A Gold case does not escalate/);
  assert.deepEqual(ghArgs(dir).map((a) => a.split(' ').slice(0, 2).join(' ')), ['auth token', 'pr list', 'pr list']);
  const task = JSON.parse(acc(dir, ['show', 'ACME-7', '--json']).out);
  assert.equal((task.task ?? task).state, 'todo');
  // acc verify show reads it back.
  assert.deepEqual(JSON.parse(acc(dir, ['verify', 'show', 'ACME-7', '--json']).out), v);
});

test('acc verify says in words what it found, what it ran and that nothing is posted', () => {
  const { dir, env } = verifyRepo();
  const r = acc(dir, ['verify', 'ACME-7'], undefined, env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^ACME-7: changes needed\. A Gold case does not escalate/);
  assert.match(r.out, /Pull request #7 ACME-7 try 7 \(acme-7-try-7 into main\)/);
  assert.match(r.out, /✓ pass +lint: Passed\./);
  assert.match(r.out, /! must change Add Gold to the premium tiers\. \(escalate\.js:1\)/);
  assert.match(r.out, /The QA comment is drafted as ACME-7\.1\. Edit it and post it: nothing is on ACME-7 or GitHub yet\./);
  assert.match(r.err, /Verifying #7 for ACME-7\. The verifier reads and changes nothing/);
});

test('acc verify with several found is refused and acc verify show lists them; --pr names one (edge case)', () => {
  const { dir, env } = verifyRepo('two');
  const r = acc(dir, ['verify', 'ACME-7', '--json'], undefined, env);
  assert.equal(r.code, 1);
  assert.deepEqual([r.json().error, /2 open pull requests on acme\/service name ACME-7/.test(r.json().message)], ['several-prs', true]);
  const shown = acc(dir, ['verify', 'show', 'ACME-7', '--json']);
  assert.equal(shown.code, 0, shown.err);
  assert.deepEqual(shown.json().choice.found.map((p: { number: number }) => p.number), [7, 8]);
  assert.match(acc(dir, ['verify', 'show', 'ACME-7']).out, /2 open pull requests name ACME-7\. Name one: acc verify ACME-7 --pr <number>\.\n {2}#7 ACME-7 try 7/);
  const named = acc(dir, ['verify', 'ACME-7', '--pr', '8', '--json'], undefined, env);
  assert.equal(named.code, 0, named.err);
  assert.equal(named.json().pr.number, 8);
});

test('acc verify with none found is refused with how to name one, and show says so (edge case)', () => {
  const { dir, env, wt } = verifyRepo('none');
  const r = acc(dir, ['verify', 'ACME-7', '--json'], undefined, env);
  assert.equal(r.code, 1);
  assert.equal(r.json().error, 'no-pr');
  assert.match(acc(dir, ['verify', 'show', 'ACME-7']).out, /No open pull request names ACME-7/);
  assert.ok(!existsSync(wt));
});

test('acc verify clear removes the worktree and what was kept, and says when there is nothing (edge case)', () => {
  const { dir, env, store, wt } = verifyRepo();
  assert.equal(acc(dir, ['verify', 'ACME-7', '--json'], undefined, env).code, 0);
  const r = acc(dir, ['verify', 'clear', 'ACME-7', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().removed, 1);
  assert.ok(!existsSync(wt));
  assert.deepEqual(readdirSync(store).filter((f) => f.endsWith('.json')), []);
  assert.match(acc(dir, ['verify', 'clear', 'ACME-7']).out, /ACME-7 has no verification to clear\./);
  const show = acc(dir, ['verify', 'show', 'ACME-7', '--json']);
  assert.equal(show.code, 1);
  assert.equal(show.json().error, 'no-verification');
});

test('acc verify refuses a task with no ticket, an agent, another repo\'s pull request, a blank --pr and a missing id (edge cases)', () => {
  const { dir, env } = verifyRepo();
  const manual = acc(dir, ['verify', 'T-1', '--json'], undefined, env);
  assert.equal(manual.code, 1);
  assert.match(manual.json().message, /has no tracker ticket/);
  for (const role of ['builder', 'reviewer', 'analyst']) {
    for (const args of [['verify', 'ACME-7'], ['verify', 'clear', 'ACME-7']]) {
      const r = acc(dir, [...args, '--json'], undefined, { ...env, ACC_ROLE: role, ACC_TASK: 'ACME-7' });
      assert.equal(r.code, 1, `${role} ${args.join(' ')}`);
      assert.match(r.json().message, /can't (verify a developer's pull request|clear a verification)\. A person does that\./);
    }
  }
  const fork = acc(dir, ['verify', 'ACME-7', '--pr', 'https://github.com/someone/fork/pull/7', '--json'], undefined, env);
  assert.equal(fork.code, 1);
  assert.match(fork.json().message, /is in someone\/fork, not acme\/service/);
  assert.match(acc(dir, ['verify', 'ACME-7', '--pr', ' ', '--json'], undefined, env).json().message, /--pr takes a pull request's number/);
  const long = acc(dir, ['verify', 'clear', 'X'.repeat(102_400), '--json']);
  assert.deepEqual([long.code, long.json().error], [2, 'usage'], 'edge: an id too long for a file name');
  assert.match(acc(dir, ['verify']).err, /acc verify <id>/);
  assert.match(acc(dir, ['verify', 'show']).err, /acc verify <id>/);
  assert.match(acc(dir, ['verify', 'ACME-7', 'extra']).err, /acc verify <id>/);
  assert.equal(ghArgs(dir).filter((a) => !a.startsWith('auth')).length, 0, 'no refused run asked GitHub for pull requests');
});
