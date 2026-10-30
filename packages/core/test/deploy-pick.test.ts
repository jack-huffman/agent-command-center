// The person's pick of where a ticket deploys (T-156): kept by acc when they open the deploy guide, the guide's
// yes for a sandbox that isn't protected, used once; never the yes for production or a protected org; and the
// security review's three refusals: a deploy where the person didn't pick, a guide that writes its own pick, and
// an expired pick.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'node:test';
import type { Environment } from '../src/config.ts';
import { DEPLOYER_DENIES, keepTypedYes, typedYesPath, YES_TTL_MS } from '../src/deploy-guide.ts';
import { deployPickPath, keepPick, pickStale, readPick, takeGuidedYes } from '../src/deploy-pick.ts';
import { guardDeployer } from '../src/hooks.ts';
import { tempDir } from './support.ts';

const T0 = '2026-10-30T12:00:00.000Z';
const at = (iso: string) => () => new Date(iso);
const later = (ms: number) => () => new Date(Date.parse(T0) + ms);
const state = () => ({ stateDir: tempDir('state-') });
const env = (name: string, branch: string, over: Partial<Environment> = {}): Environment => ({ name, branch, type: 'full', org: `Acme ${name}`, default: false, protected: false, promotesTo: [], ...over });
const UAT = env('UAT', 'uat');
const PROD = env('Production', 'production', { type: 'production' });
/** A plan's yes-facing part: a sandbox that isn't protected, or production. */
const sandbox = { confirm: false, confirmName: UAT.name, to: UAT };
const production = { confirm: true, confirmName: PROD.name, to: PROD };
const by = 'human:jordan';

test('a person\'s pick is kept whole and read back, and the guide\'s deploy to that sandbox takes it as the yes, once', () => {
  const p = state();
  assert.equal(readPick(p, 'ACME-1'), null, 'edge case: before anyone picked, nothing');
  const pick = keepPick(p, 'ACME-1', 'uat', by, at(T0));
  assert.deepEqual(pick, { v: 1, task: 'ACME-1', env: 'uat', by, at: T0 });
  assert.deepEqual(readPick(p, 'ACME-1'), pick);
  assert.deepEqual(JSON.parse(readFileSync(deployPickPath(p, 'ACME-1'), 'utf8')), pick, 'the file is the record, written whole');
  assert.equal(takeGuidedYes(p, 'ACME-1', sandbox, { at: later(60_000)().toISOString() }, later(120_000)), 'pick', 'no name typed, and the check may be newer than the pick');
  assert.equal(readPick(p, 'ACME-1')!.used, later(120_000)().toISOString(), 'marked used, so it is no yes again');
  assert.throws(() => takeGuidedYes(p, 'ACME-1', sandbox, null, later(180_000)), /^.*The person's pick was used by a deploy already\. The person hasn't typed a yes for ACME-1 in this chat/, 'a second deploy needs the typed name');
  keepTypedYes(p, 'ACME-1', 'UAT', null, later(180_000));
  assert.equal(takeGuidedYes(p, 'ACME-1', sandbox, null, later(200_000)), 'typed', 'the typed name stands in for a used pick');
  keepPick(p, 'ACME-1', 'production', by, later(300_000));
  assert.deepEqual(readPick(p, 'ACME-1')!.env, 'production', 'a new pick replaces the old, used or not');
});

test('an expired pick is refused as the yes, and the environment\'s name typed in the chat takes over (security review)', () => {
  const p = state();
  keepPick(p, 'ACME-1', 'uat', by, at(T0));
  assert.equal(pickStale({ at: T0 }, later(YES_TTL_MS)), null, 'edge case: at the limit it still stands');
  assert.match(pickStale({ at: T0 }, later(YES_TTL_MS + 1))!, /more than 15 minutes old/);
  assert.match(pickStale({ at: T0, used: T0 }, at(T0))!, /used by a deploy already/);
  assert.throws(() => takeGuidedYes(p, 'ACME-1', sandbox, null, later(YES_TTL_MS + 1)), /The person's pick is more than 15 minutes old\. The person hasn't typed a yes for ACME-1 in this chat\. Ask the person to type it/);
  assert.equal(readPick(p, 'ACME-1')!.used, undefined, 'an expired pick isn\'t marked used: it is simply no yes');
  keepTypedYes(p, 'ACME-1', 'yes', null, later(YES_TTL_MS + 1));
  assert.throws(() => takeGuidedYes(p, 'ACME-1', sandbox, null, later(YES_TTL_MS + 2)), /more than 15 minutes old\. The person typed "yes", not UAT\. Ask them to type UAT/);
  keepTypedYes(p, 'ACME-1', 'Acme UAT', null, later(YES_TTL_MS + 2));
  assert.equal(takeGuidedYes(p, 'ACME-1', sandbox, null, later(YES_TTL_MS + 3)), 'typed', 'its org\'s alias, as D-235 allows');
  assert.equal(existsSync(typedYesPath(p, 'ACME-1')), false, 'the typed yes is used up');
});

test('the guide can\'t deploy where the person didn\'t pick: another environment is refused, even with its name typed (security review)', () => {
  const p = state();
  keepPick(p, 'ACME-1', 'uat', by, at(T0));
  keepTypedYes(p, 'ACME-1', 'Production', null, at(T0));
  assert.throws(() => takeGuidedYes(p, 'ACME-1', production, null, at(T0), (b) => ({ uat: 'UAT' })[b] ?? b), /The person picked UAT for ACME-1, not Production\. The deploy guide deploys only where the person picked: acc deploy uat --task ACME-1/);
  assert.ok(existsSync(typedYesPath(p, 'ACME-1')), 'the typed yes isn\'t touched: the refusal comes before it');
  assert.equal(readPick(p, 'ACME-1')!.used, undefined);
  assert.throws(() => takeGuidedYes(p, 'ACME-1', production, null, at(T0)), /picked uat for ACME-1, not Production/, 'edge case: with no names to hand, the branch');
});

test('production and a protected org keep the typed yes: the pick alone deploys nothing there, and fixes only where', () => {
  const p = state();
  keepPick(p, 'ACME-1', 'production', by, at(T0));
  const said = (fn: () => unknown): string => { try { fn(); return ''; } catch (e) { return (e as Error).message; } };
  assert.match(said(() => takeGuidedYes(p, 'ACME-1', production, null, at(T0))), /^The person hasn't typed a yes for ACME-1 in this chat/, 'no lead about the pick: it was never in question');
  assert.equal(readPick(p, 'ACME-1')!.used, undefined, 'not used: it was never the yes');
  keepTypedYes(p, 'ACME-1', 'yes', null, at(T0));
  assert.match(said(() => takeGuidedYes(p, 'ACME-1', production, null, at(T0))), /^The person typed "yes", not Production\. Ask them to type Production in the chat/);
  keepTypedYes(p, 'ACME-1', 'Production', null, at(T0));
  assert.equal(takeGuidedYes(p, 'ACME-1', production, { at: T0 }, at(T0)), 'typed');
  assert.equal(readPick(p, 'ACME-1')!.used, at(T0)().toISOString(), 'marked used once the typed name deployed, so it fixes no later deploy');
  keepTypedYes(p, 'ACME-1', 'Production', null, at(T0));
  assert.throws(() => takeGuidedYes(p, 'ACME-1', production, { at: T0 }, at(T0)), /pick of Production for ACME-1 was used by a deploy already\. A person opens its deploy guide again/, 'an old pick from a closed chat sends nothing to production (review)');
  rmSync(typedYesPath(p, 'ACME-1'), { force: true });
  // A protected sandbox is production's case too: confirm is the plan's, by the settings or by what Salesforce says.
  keepPick(p, 'ACME-1', 'uat', by, at(T0));
  assert.throws(() => takeGuidedYes(p, 'ACME-1', { ...sandbox, confirm: true }, null, at(T0)), /hasn't typed a yes/);
});

test('edge case: no pick, a file that isn\'t acc\'s, or another task\'s pick is refused before anything else', () => {
  const p = state();
  keepTypedYes(p, 'ACME-1', 'UAT', null, at(T0));
  assert.throws(() => takeGuidedYes(p, 'ACME-1', sandbox, null, at(T0)), /No one picked where ACME-1 goes\. A person opens its deploy guide with acc deploy <environment> --task ACME-1 --guide/);
  mkdirSync(dirname(deployPickPath(p, 'ACME-1')), { recursive: true });
  writeFileSync(deployPickPath(p, 'ACME-1'), 'not json');
  assert.equal(readPick(p, 'ACME-1'), null);
  writeFileSync(deployPickPath(p, 'ACME-1'), JSON.stringify({ v: 1, task: 'ACME-2', env: 'uat', by, at: T0 }));
  assert.equal(readPick(p, 'ACME-1'), null, 'another task\'s');
  writeFileSync(deployPickPath(p, 'ACME-1'), JSON.stringify({ v: 2, task: 'ACME-1', env: 'uat', by, at: T0 }));
  assert.throws(() => takeGuidedYes(p, 'ACME-1', sandbox, null, at(T0)), /No one picked/);
  assert.ok(existsSync(typedYesPath(p, 'ACME-1')), 'the typed yes is left: the pick is what is missing');
});

test('the guide can\'t write or name its own pick: the guard refuses the word, --guide, and Claude Code denies every edit (security review)', () => {
  for (const line of [
    'cat .git/acc/deploy-picks/ACME-1.json',
    'git show HEAD:.git/acc/deploy-picks/ACME-1.json',
    'git log -1 --output=.git/acc/deploy-picks/ACME-1.json',
    'acc deploy uat --task ACME-1 --guide',
    'acc deploy --task=ACME-1 --guide',
    'acc deploy production --task ACME-1 --guide=true',
    "printf '{}' > .git/acc/deploy-picks/ACME-1.json",
    'acc show deploy-picks',
  ]) assert.ok(guardDeployer('ACME-1', line), `refused: ${line}`);
  assert.match(guardDeployer('ACME-1', 'acc deploy uat --task ACME-1 --guide')!, /never picks where a ticket goes or opens a guide/);
  assert.match(guardDeployer('ACME-1', 'cat .git/acc/deploy-picks/ACME-1.json')!, /the person's yes and their pick among them/);
  assert.equal(guardDeployer('ACME-1', 'acc deploy uat --task ACME-1 --yes 0AfX'), null, 'the deploy itself, on the pick, is allowed');
  for (const d of ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash(acc hook*)']) assert.ok(DEPLOYER_DENIES.includes(d), d);
});
