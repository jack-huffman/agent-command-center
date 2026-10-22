import assert from 'node:assert/strict';
import { test } from 'node:test';
import { run } from '../src/exec.ts';
import { CI_STEPS, requireChecksFix } from '../src/onboarding/ci-steps.ts';
import { makeContext } from '../src/onboarding/helpers.ts';
import { STEPS } from '../src/onboarding/steps.ts';
import { requiredChecks } from '../src/protection.ts';
import { bad, fakeRunner, GENERIC_CONFIG, makeRepo, ok } from './support.ts';

const page = (status: number, body: unknown) => ok(`HTTP/2.0 ${status} X\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(body)}`);
const UPGRADE = page(403, { message: 'Upgrade to GitHub Pro or make this repository public to enable this feature.' });
const NOT_PROTECTED = page(404, { message: 'Branch not protected' });
const PROTECTION = 'gh api repos/acme/tool/branches/main/protection';
const RULES = 'gh api repos/acme/tool/rules/branches/main';
const at = (fixtures: Record<string, ReturnType<typeof ok>>) => requiredChecks(fakeRunner(fixtures), 'acme/tool', 'main', {});

test('the checks GitHub requires on a branch: from protection and rulesets; edge cases: none, not offered on the plan, and gh failing (T-108)', () => {
  const both = at({ [PROTECTION]: page(200, { required_status_checks: { contexts: ['check'], checks: [{ context: 'lint' }, { context: 'check' }] } }), [RULES]: page(200, [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'e2e' }] } }, { type: 'deletion' }]) });
  assert.deepEqual([both.state, both.checks, both.protection, both.statusChecks], ['read', ['check', 'lint', 'e2e'], 'branch', true]);
  assert.equal(both.why, 'GitHub requires check, lint, e2e before a pull request merges into main.');
  const noChecks = at({ [PROTECTION]: page(200, { required_pull_request_reviews: {} }), [RULES]: page(200, []) });
  assert.deepEqual([noChecks.checks, noChecks.protection, noChecks.statusChecks, noChecks.why], [[], 'branch', false, 'GitHub requires no checks before a pull request merges into main.']);
  const none = at({ [PROTECTION]: NOT_PROTECTED, [RULES]: page(200, []) });
  assert.deepEqual([none.state, none.checks, none.protection], ['read', [], 'none']);
  const ruleset = at({ [PROTECTION]: NOT_PROTECTED, [RULES]: page(200, [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'check' }] } }]) });
  assert.deepEqual([ruleset.checks, ruleset.protection], [['check'], 'none']);
  const free = at({ [PROTECTION]: UPGRADE });
  assert.deepEqual([free.state, free.why], ['unavailable', 'GitHub doesn\'t offer required checks on acme/tool: a private repo on the free plan.']);
  assert.equal(at({ [PROTECTION]: NOT_PROTECTED, [RULES]: UPGRADE }).state, 'read', 'rulesets not offered: protection alone says');
  assert.match(at({ 'gh api': bad('connection refused') }).why, /^gh couldn't read main's protection: connection refused\.$/);
  assert.match(at({ [PROTECTION]: NOT_PROTECTED, [RULES]: page(500, { message: 'Server Error' }) }).why, /^gh couldn't read main's rulesets: Server Error\.$/);
});

test('the fix: added to protection\'s required checks, else protection requiring only them; edge case: protection without required checks has no command (T-108)', () => {
  const token = 'GH_TOKEN="$(gh auth token -u acme-bot)" gh api';
  assert.equal(requireChecksFix('acme/tool', 'acme-bot', 'main', ['check'], { protection: 'branch', statusChecks: true }), `${token} -X POST repos/acme/tool/branches/main/protection/required_status_checks/contexts -f 'contexts[]=check'`);
  assert.equal(requireChecksFix('acme/tool', 'acme-bot', 'main', ['check', 'lint'], { protection: 'none', statusChecks: false }),
    `${token} -X PUT repos/acme/tool/branches/main/protection -F 'required_status_checks[strict]=false' -f 'required_status_checks[contexts][]=check' -f 'required_status_checks[contexts][]=lint' -F enforce_admins=false -F required_pull_request_reviews=null -F restrictions=null`);
  assert.equal(requireChecksFix('acme/tool', 'acme-bot', 'main', ['check'], { protection: 'branch', statusChecks: false }), '', 'replacing it would drop its other rules');
});

test('Setup\'s step is registered after the floors\' merge driver, and says whether GitHub requires the named checks; edge cases: none named, gh not signed in, the free plan (T-108)', () => {
  const step = CI_STEPS[0]!;
  const ids = STEPS.map((s) => s.id);
  assert.equal(ids.indexOf(step.id), ids.indexOf('B10.merge-floors') + 1);
  const repo = (github: unknown) => makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, github }) });
  const named = repo({ repo: 'acme/tool', account: 'acme-bot', checks: ['check'] });
  const check = (dir: string, fixtures: Record<string, ReturnType<typeof ok>>, calls: string[] = []) => step.check(makeContext(dir, fakeRunner({ 'gh auth token -u acme-bot': ok('ghs_x\n'), ...fixtures }, calls)));
  assert.deepEqual(step.check(makeContext(repo(null), run)).status, 'skip');
  assert.match(step.check(makeContext(repo({ repo: 'acme/tool', account: 'acme-bot' }), run)).detail, /name no GitHub checks/);
  const signedOut = step.check(makeContext(named, fakeRunner({})));
  assert.deepEqual([signedOut.status, signedOut.detail], ['unknown', 'gh isn\'t signed in as acme-bot, so whether GitHub requires the "check" check isn\'t known.']);
  const calls: string[] = [];
  const passed = check(named, { [PROTECTION]: page(200, { required_status_checks: { contexts: ['check'] } }), [RULES]: page(200, []) }, calls);
  assert.deepEqual([passed.status, passed.detail], ['pass', 'GitHub requires the "check" check before a pull request merges into main.']);
  assert.ok(calls.every((c) => !/-X (PUT|POST|PATCH)/.test(c)), 'it only reads');
  const missing = check(named, { [PROTECTION]: NOT_PROTECTED, [RULES]: page(200, []) });
  assert.equal(missing.status, 'fail');
  assert.equal(missing.detail, 'GitHub doesn\'t require the "check" check before a pull request merges into main. Autopilot waits for it all the same; a person merging doesn\'t have to.');
  assert.equal(missing.fix, requireChecksFix('acme/tool', 'acme-bot', 'main', ['check'], { protection: 'none', statusChecks: false }));
  const byHand = check(named, { [PROTECTION]: page(200, {}), [RULES]: page(200, []) });
  assert.deepEqual([byHand.status, byHand.fix], ['fail', undefined]);
  assert.match(byHand.detail, /tick Require status checks to pass, and add check\.$/);
  const free = check(named, { [PROTECTION]: UPGRADE });
  assert.deepEqual([free.status, free.detail], ['skip', 'GitHub doesn\'t offer required checks on acme/tool: a private repo on the free plan. Autopilot still waits for the "check" check itself before it merges.']);
  assert.equal(check(named, { 'gh api': bad('connection refused') }).status, 'unknown');
});
