import assert from 'node:assert/strict';
import { test } from 'node:test';
import { actionsJob, checksSection, type ChecksReport, fetchLog, LOG_TAIL_BYTES, LOG_TAIL_LINES, readChecks, tailLog } from '../src/checks.ts';
import { AccError, type RunResult } from '../src/exec.ts';
import { bad, fakeRunner, ok } from './support.ts';

const HEAD = 'a'.repeat(40);
const ENV = { GH_TOKEN: 'gho_token' };
const job = (n: number) => `https://github.com/acme/tool/actions/runs/9/job/${n}`;
const check = (name: string, bucket: string, more: Record<string, unknown> = {}) => ({ name, bucket, workflow: 'CI', link: job(name.length), state: bucket.toUpperCase(), ...more });
const view = ok(JSON.stringify({ headRefOid: HEAD }));
const listed = (checks: unknown[], code = 0): RunResult => ({ code, stdout: JSON.stringify(checks), stderr: '' });

test('a pull request\'s checks: fail is a failure; pending waits; cancelled, skipped and passed aren\'t failures (D-076)', () => {
  const calls: string[] = [];
  const run = fakeRunner({
    'gh pr view': view,
    'gh pr checks 42 -R acme/tool --required': listed([
      check('build', 'fail', { state: 'FAILURE' }), check('lint', 'fail', { state: 'TIMED_OUT' }), check('deploy-preview', 'cancel', { state: 'CANCELLED' }),
      check('docs', 'skipping', { state: 'SKIPPED' }), check('e2e', 'pending', { state: 'IN_PROGRESS' }), check('unit', 'pass', { state: 'SUCCESS' }),
      { name: 'ci/jenkins', bucket: 'fail', workflow: '', link: 'https://jenkins.acme.example/job/77', state: 'FAILURE' },
    ], 8),
  }, calls);
  const r = readChecks(run, 'acme/tool', 42, ENV);
  assert.equal(r.sha, HEAD, 'the pull request\'s head on GitHub');
  assert.equal(r.required, true);
  assert.deepEqual(r.failed.map((c) => [c.name, c.job]), [['build', { repo: 'acme/tool', id: '5' }], ['lint', { repo: 'acme/tool', id: '4' }], ['ci/jenkins', null]], 'a check that isn\'t an Actions job has no log to read');
  assert.deepEqual(r.pending, ['e2e']);
  // gh exits 8 while checks are pending: its JSON is read whatever the exit code.
  assert.deepEqual(calls, ['gh pr view 42 -R acme/tool --json headRefOid', 'gh pr checks 42 -R acme/tool --required --json name,bucket,link,workflow,state']);
});

test('a base branch that requires no checks: every check on the commit counts; none at all is nothing to do (D-076)', () => {
  const calls: string[] = [];
  const none = bad('no required checks reported on the \'task/T-1\' branch');
  const all = readChecks(fakeRunner({ 'gh pr view': view, 'gh pr checks 42 -R acme/tool --required': none, 'gh pr checks 42 -R acme/tool --json': listed([check('test', 'fail')]) }, calls), 'acme/tool', 42, ENV);
  assert.deepEqual([all.required, all.failed.map((c) => c.name)], [false, ['test']]);
  assert.equal(calls.at(-1), 'gh pr checks 42 -R acme/tool --json name,bucket,link,workflow,state', 'asked again without --required');

  const empty = readChecks(fakeRunner({ 'gh pr view': view, 'gh pr checks': bad('no checks reported on the \'task/T-1\' branch') }), 'acme/tool', 42, ENV);
  assert.deepEqual([empty.failed, empty.pending], [[], []]);

  // Anything else gh says is named, not taken for no checks.
  assert.throws(() => readChecks(fakeRunner({ 'gh pr view': view, 'gh pr checks': bad('unknown flag: --json') }), 'acme/tool', 42, ENV),
    (e: AccError) => e.code === 'checks' && e.message === 'gh couldn\'t read pull request #42\'s checks: unknown flag: --json');
  assert.throws(() => readChecks(fakeRunner({ 'gh pr view': bad('HTTP 401: Bad credentials') }), 'acme/tool', 42, ENV), /gh couldn't read pull request #42: HTTP 401: Bad credentials/);
});

test('an Actions job\'s link names its repo and job; any other link has none', () => {
  assert.deepEqual(actionsJob('https://github.com/acme/tool/actions/runs/123/job/456'), { repo: 'acme/tool', id: '456' });
  assert.deepEqual(actionsJob('https://github.com/acme/tool/actions/runs/123/job/456?pr=7'), { repo: 'acme/tool', id: '456' });
  assert.deepEqual(actionsJob('https://ghe.acme.example/acme/tool/actions/runs/1/job/2'), { repo: 'ghe.acme.example/acme/tool', id: '2' });
  assert.equal(actionsJob('https://jenkins.acme.example/job/77'), null);
  assert.equal(actionsJob('https://github.com/acme/tool/runs/456'), null, 'a check run page, not a job');
  assert.equal(actionsJob(''), null);
});

test('a log\'s end: colour codes, gh\'s job and step names and GitHub\'s timestamps go; 100 lines and 10 KB at most', () => {
  const line = (n: number) => `build\tRun npm test\t2026-10-06T09:00:${String(n % 60).padStart(2, '0')}.1234567Z \x1b[31mline ${n}\x1b[0m`;
  const text = ['build\tSet up job\t﻿2026-10-06T09:00:00.0000000Z Current runner version', ...Array.from({ length: 150 }, (_, i) => line(i + 1)), '', ''].join('\r\n');
  const tail = tailLog(text);
  const lines = tail.split('\n');
  assert.equal(lines.length, LOG_TAIL_LINES);
  assert.deepEqual([lines[0], lines.at(-1)], ['line 51', 'line 150'], 'the last 100, with nothing but what the job printed');
  assert.ok(!/\x1b|\t|\d{4}-\d{2}-\d{2}T/.test(tail));
  assert.equal(tailLog('build\tSet up job\t﻿2026-10-06T09:00:00.0000000Z Current runner version'), 'Current runner version');

  const wide = Array.from({ length: 60 }, (_, i) => `${i} ${'x'.repeat(400)}`).join('\n');
  const capped = tailLog(wide);
  assert.ok(Buffer.byteLength(capped) <= LOG_TAIL_BYTES, '10 KB at most');
  assert.ok(capped.endsWith(`59 ${'x'.repeat(400)}`) && capped.split('\n').every((l) => /^\d+ x+$/.test(l)), 'whole lines, from the end');
  const one = tailLog('y'.repeat(LOG_TAIL_BYTES * 2) + 'END');
  assert.ok(one.endsWith('END') && Buffer.byteLength(one) <= LOG_TAIL_BYTES, 'one line longer than that keeps its end');
  assert.equal(tailLog('plain text, no prefix'), 'plain text, no prefix');
});

test('a failed job\'s log: its failed steps, else all of it; one gh can\'t fetch is named, never made up', () => {
  const calls: string[] = [];
  const j = { repo: 'acme/tool', id: '456' };
  assert.deepEqual(fetchLog(fakeRunner({ 'gh run view --job 456 --log-failed': ok('build\tRun npm test\t2026-10-06T09:00:00Z 1 failing\n') }, calls), j, ENV), { log: '1 failing' });
  assert.deepEqual(calls, ['gh run view --job 456 --log-failed -R acme/tool']);
  // A job that timed out has no failed step.
  assert.deepEqual(fetchLog(fakeRunner({ 'gh run view --job 456 --log-failed': ok(''), 'gh run view --job 456 --log': ok('build\tRun\t2026-10-06T09:00:00Z The job running on runner X has exceeded the maximum execution time\n') }), j, ENV),
    { log: 'The job running on runner X has exceeded the maximum execution time' });
  assert.deepEqual(fetchLog(fakeRunner({ 'gh run view': bad('failed to get run log: log not found\nmore detail') }), j, ENV), { error: 'failed to get run log: log not found' });
  assert.deepEqual(fetchLog(fakeRunner({ 'gh run view': ok('') }), j, ENV), { error: 'GitHub gave an empty log.' });
});

test('the builder\'s packet section: each check, its link and its log\'s end, or why there\'s none (D-076)', () => {
  const report: ChecksReport = {
    v: 1, task: 'T-1', sha: HEAD, pr: { number: 42, url: 'https://github.com/acme/tool/pull/42' }, required: true, at: '2026-10-06T09:00:00.000Z',
    checks: [
      { name: 'build', workflow: 'CI', link: job(5), log: 'npm ERR! ```oops```\n1 failing', noLog: null },
      { name: 'lint', workflow: 'CI', link: job(4), log: null, noLog: 'failed to get run log: log not found' },
      { name: 'ci/jenkins', workflow: '', link: 'https://jenkins.acme.example/job/77', log: null, noLog: 'GitHub keeps no log for it: it isn\'t a GitHub Actions job.' },
    ],
  };
  const text = checksSection(report).join('\n');
  for (const must of [
    '## What GitHub\'s checks said', 'pull request #42', 'checks its base branch requires failed on GitHub on aaaaaaa: build, lint, ci/jenkins',
    '### build (CI)', `Link: ${job(5)}`, '````text\nnpm ERR! ```oops```\n1 failing\n````',
    '### lint (CI)', 'Couldn\'t fetch its log: failed to get run log: log not found.',
    '### ci/jenkins\n', 'Couldn\'t fetch its log: GitHub keeps no log for it: it isn\'t a GitHub Actions job.',
    'run `acc gate run`, then `acc done`', 'run `acc block "<what you found>"` and stop',
  ]) assert.ok(text.includes(must), must);
  assert.deepEqual(checksSection(null), []);
  assert.deepEqual(checksSection({ ...report, checks: [] }), []);
  assert.match(checksSection({ ...report, required: false }).join('\n'), /and its checks failed on GitHub/);
});
