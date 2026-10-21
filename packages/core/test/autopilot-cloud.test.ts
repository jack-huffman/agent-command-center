// Autopilot with cloud reviewers (T-86): its review step fires the routine where the project's setting says
// cloud and the cloud is ready, and runs the review on this Mac where a need is unmet or the setting says
// local; its rules wait on a cloud review under way as on a review here, and on one that failed, for a
// person. On the bare-origin fake GitHub cloud-support.ts makes, with T-1 cloud-built and in review.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AUTOPILOT_BY, realSteps } from '../src/autopilot.ts';
import { nextStep, taskFacts } from '../src/autopilot-rules.ts';
import { reviewInCloud } from '../src/cloud-review.ts';
import { type LedgerEvent, mutate, readLedger } from '../src/ledger.ts';
import { readVerdict } from '../src/review.ts';
import { bad, fakeRunner, gitIn, ok } from './support.ts';
import { CLOUD, CLOUD_FIXTURES, now, RAW, reviewed, task } from './cloud-support.ts';

/** The project opted in to cloud reviews: agents.cloud.review is cloud, and autopilot is on. */
const CLOUD_REVIEW = { ...RAW, agents: { max: 2, cloud: { ...CLOUD, review: 'cloud' } }, autonomy: 'review' };
/** What a reviewer on this Mac answers, as Claude Code hands it back. */
const PASSED = ok(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'sess-review', total_cost_usd: 0.1, structured_output: { verdict: 'pass', summary: 'Does the thing.', criteria: [], findings: [] } }));
const events = (file: string): LedgerEvent[] => readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as LedgerEvent);

test('autopilot\'s review step fires the routine where agents.cloud.review is cloud and the cloud is ready: the task stays in review with its cloud review on it, as the orchestrator\'s, and no reviewer runs here', () => {
  const { paths, config, follow } = reviewed(CLOUD_REVIEW);
  const calls: string[] = [];
  const steps = realSteps(paths, config, { run: fakeRunner({ ...CLOUD_FIXTURES, 'claude -p': PASSED }, calls), now, env: follow.env, accBinDir: '/acc/bin' });
  const r = steps.review('T-1');
  assert.match(r.reason, /^Reviewing [0-9a-f]{7} in the cloud: https:\/\/claude\.ai\/code\/session_01TEST\. acc sync reads its verdict from acc\/review\/T-1-[0-9a-f]+\.$/);
  assert.ok(calls.some((c) => c.startsWith('curl')), 'the routine was fired');
  assert.ok(!calls.some((c) => c.startsWith('claude -p')), 'no reviewer ran here');
  const t = task(paths);
  assert.equal(t.state, 'review');
  assert.equal(t.cloudReview?.sessionId, 'session_01TEST');
  assert.equal(t.cloudReview?.sha, gitIn(paths.root, 'rev-parse', t.run!.branch!), 'of the branch\'s head');
  assert.equal(readVerdict(paths, 'T-1', t.cloudReview!.sha), null, 'no verdict yet: acc sync reads it');
  const fired = events(paths.events).at(-1)!;
  assert.deepEqual([fired.type, fired.actor, fired.by], ['task.updated', 'orchestrator', AUTOPILOT_BY], 'the fire is autopilot\'s own');
});

test('edge case: with the setting cloud but a need unmet (no token in the keychain), autopilot\'s review runs on this Mac as before, with its verdict; with the setting local, so does it with the cloud ready, and nothing is fired', () => {
  const unmet = reviewed(CLOUD_REVIEW);
  const calls: string[] = [];
  const steps = realSteps(unmet.paths, unmet.config, { run: fakeRunner({ ...CLOUD_FIXTURES, 'security find-generic-password': bad(), 'claude -p': PASSED }, calls), now, env: unmet.follow.env, accBinDir: '/acc/bin' });
  assert.equal(steps.review('T-1').reason, 'Review passed: Does the thing.');
  assert.ok(!calls.some((c) => c.startsWith('curl')), 'nothing fired');
  assert.ok(calls.some((c) => c.startsWith('claude -p')), 'the reviewer ran here');
  const t = task(unmet.paths);
  assert.equal(t.cloudReview ?? null, null);
  assert.equal(readVerdict(unmet.paths, 'T-1', gitIn(unmet.paths.root, 'rev-parse', t.run!.branch!))!.verdict, 'pass');
  // Local by the setting (RAW's review is local): the cloud ready, the review still runs here.
  const local = reviewed();
  const calls2: string[] = [];
  assert.equal(realSteps(local.paths, local.config, { run: fakeRunner({ ...CLOUD_FIXTURES, 'claude -p': PASSED }, calls2), now, env: local.follow.env, accBinDir: '/acc/bin' }).review('T-1').reason, 'Review passed: Does the thing.');
  assert.ok(!calls2.some((c) => c.startsWith('curl')), 'nothing fired');
  assert.equal(task(local.paths).cloudReview ?? null, null);
});

test('autopilot waits on a cloud review under way, as on a review here, by its session; a failed cloud review waits for a person with why, and isn\'t a review running; cleared, the commit is reviewed', () => {
  const { paths, config, follow } = reviewed(CLOUD_REVIEW);
  const run = fakeRunner(CLOUD_FIXTURES);
  reviewInCloud(paths, config, 'T-1', { run, now, env: follow.env }, {});
  const look = () => {
    const l = readLedger(paths.ledger);
    const t = l.tasks[0]!;
    const facts = taskFacts(paths, t, run);
    return { facts, decision: nextStep(l, config, t, facts) };
  };
  const pending = look();
  assert.equal(pending.facts.reviewing, 'session_01TEST', 'the cloud session is the review running');
  assert.deepEqual(pending.decision, { step: null, outcome: 'waiting', reason: 'A review is running (session session_01TEST).' });
  // Its verdict couldn't be read: a person reviews it here, and autopilot doesn't try the same commit.
  mutate(paths, now, (l, emit) => {
    const x = l.tasks[0]!;
    x.cloudReview = { ...x.cloudReview!, failed: { at: now().toISOString(), reason: 'its cloud reviewer\'s review.json isn\'t a verdict acc can read (not JSON): review it on this Mac' } };
    emit({ type: 'task.updated', task: 'T-1', actor: 'sync', by: 'reviewer:T-1 (cloud)', data: { cloudReview: x.cloudReview } });
  });
  const failed = look();
  assert.equal(failed.facts.reviewing, null, 'a failed cloud review isn\'t a review running');
  assert.deepEqual([failed.decision.step, failed.decision.outcome], [null, 'waiting']);
  assert.match(failed.decision.reason, /^Its cloud review gave no verdict acc could take: its cloud reviewer's review\.json isn't a verdict acc can read \(not JSON\): review it on this Mac\. A person reviews it on this Mac\.$/);
  // Cleared, as a move or a verdict here clears it: the commit has no verdict, so a review is the step.
  mutate(paths, now, (l, emit) => {
    l.tasks[0]!.cloudReview = null;
    emit({ type: 'task.updated', task: 'T-1', actor: 'human', by: 'h', data: { cloudReview: null } });
  });
  const cleared = look();
  assert.equal(cleared.facts.reviewing, null);
  assert.deepEqual([cleared.decision.step, cleared.decision.outcome], ['review', null]);
});
