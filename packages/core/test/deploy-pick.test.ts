// The person's pick of where a ticket deploys (T-156): kept by acc when they open the deploy guide, the guide's
// yes for a sandbox that isn't protected, used once; never the yes for production or a protected org; and the
// security review's three refusals: a deploy where the person didn't pick, a guide that writes its own pick, and
// an expired pick. Since T-171 the pick is signed with the person's key, for its task, its environment and its
// chat: a pick any other process wrote, or one for another task, reads as no pick, with why.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import type { Environment } from '../src/config.ts';
import { DEPLOYER_DENIES, keepTypedYes, typedYesPath, YES_TTL_MS } from '../src/deploy-guide.ts';
import * as real from '../src/deploy-pick.ts';
import { deployPickPath, keepPick, PICK_SIGNED, pickStale, readPick, takeGuidedYes } from '../src/deploy-pick.ts';
import { guardDeployer } from '../src/hooks.ts';
import { NO_KEY, type Verifier } from '../src/person-key.ts';
import { personKeys, tempDir } from './support.ts';

const T0 = '2026-10-30T12:00:00.000Z';
const at = (iso: string) => () => new Date(iso);
const later = (ms: number) => () => new Date(Date.parse(T0) + ms);
const state = () => ({ stateDir: tempDir('state-') });
const env = (name: string, branch: string, over: Partial<Environment> = {}): Environment => ({ name, branch, type: 'full', org: `Acme ${name}`, default: false, protected: false, promotesTo: [], ...over });
const UAT = env('UAT', 'uat');
const PROD = env('Production', 'production', { type: 'production' });
/** A plan's yes-facing part: a sandbox that isn't protected, or production. */
const sandbox = { confirm: false, confirmName: UAT.name, to: UAT, sandbox: true };
const production = { confirm: true, confirmName: PROD.name, to: PROD };
const by = 'human:jordan';
// The person's key (T-171), and the chat the pick opens.
const keys = personKeys();
const SESSION = 'sess-1';
const { verify } = keys;
/** A pick as acc deploy --guide keeps it, signed with the person's key unless a test says whose. */
const pick = (p: { stateDir: string }, task: string, to: string, when: () => Date, signer = keys.signer) => keepPick(p, task, to, by, SESSION, when, signer);
/** A yes as the hook keeps it, in the pick's chat, for the environment, signed with the person's key. */
const typed = (p: { stateDir: string }, task: string, to: string, prompt: string, when: () => Date) => keepTypedYes(p, task, to, prompt, SESSION, when, keys.signer);
/** The pick kept for a task, as a person's command signed it. */
const kept = (p: { stateDir: string }, task: string) => readPick(p, task, verify).pick!;

test('a person\'s pick is kept whole and read back, and the guide\'s deploy to that sandbox takes it as the yes, once', () => {
  const p = state();
  assert.deepEqual(readPick(p, 'ACME-1', verify), { pick: null, why: null }, 'edge case: before anyone picked, nothing, and nothing to say');
  const made = pick(p, 'ACME-1', 'uat', at(T0));
  assert.deepEqual(made, { v: 2, task: 'ACME-1', env: 'uat', by, at: T0, session: SESSION, sig: made.sig });
  assert.match(made.sig, /^[A-Za-z0-9+/]+=*$/, 'signed');
  assert.deepEqual(readPick(p, 'ACME-1', verify), { pick: made, why: null });
  assert.deepEqual(JSON.parse(readFileSync(deployPickPath(p, 'ACME-1'), 'utf8')), made, 'the file is the record, written whole');
  assert.equal(takeGuidedYes(p, 'ACME-1', sandbox, { at: later(60_000)().toISOString() }, later(120_000), verify), 'pick', 'no name typed, and the check may be newer than the pick');
  assert.equal(kept(p, 'ACME-1').used, later(120_000)().toISOString(), 'marked used, so it is no yes again');
  assert.deepEqual([...PICK_SIGNED], ['v', 'task', 'env', 'by', 'at', 'session'], 'used is outside the signature: the guide\'s deploy sets it, and holds no key');
  assert.throws(() => takeGuidedYes(p, 'ACME-1', sandbox, null, later(180_000), verify), /^.*The person's pick was used by a deploy already\. The person hasn't typed a yes for ACME-1 in this chat/, 'a second deploy needs the typed name');
  typed(p, 'ACME-1', 'uat', 'UAT', later(180_000));
  assert.equal(takeGuidedYes(p, 'ACME-1', sandbox, null, later(200_000), verify), 'typed', 'the typed name stands in for a used pick');
  pick(p, 'ACME-1', 'production', later(300_000));
  assert.deepEqual(kept(p, 'ACME-1').env, 'production', 'a new pick replaces the old, used or not');
});

test('an expired pick is refused as the yes, and the environment\'s name typed in the chat takes over (security review)', () => {
  const p = state();
  pick(p, 'ACME-1', 'uat', at(T0));
  assert.equal(pickStale({ at: T0 }, later(YES_TTL_MS)), null, 'edge case: at the limit it still stands');
  assert.match(pickStale({ at: T0 }, later(YES_TTL_MS + 1))!, /more than 15 minutes old/);
  assert.match(pickStale({ at: T0, used: T0 }, at(T0))!, /used by a deploy already/);
  assert.throws(() => takeGuidedYes(p, 'ACME-1', sandbox, null, later(YES_TTL_MS + 1), verify), /The person's pick is more than 15 minutes old\. The person hasn't typed a yes for ACME-1 in this chat\. Ask the person to type it/);
  assert.equal(kept(p, 'ACME-1').used, undefined, 'an expired pick isn\'t marked used: it is simply no yes');
  typed(p, 'ACME-1', 'uat', 'yes', later(YES_TTL_MS + 1));
  assert.throws(() => takeGuidedYes(p, 'ACME-1', sandbox, null, later(YES_TTL_MS + 2), verify), /more than 15 minutes old\. The person typed "yes", not UAT\. Ask them to type UAT/);
  typed(p, 'ACME-1', 'uat', 'Acme UAT', later(YES_TTL_MS + 2));
  assert.equal(takeGuidedYes(p, 'ACME-1', sandbox, null, later(YES_TTL_MS + 3), verify), 'typed', 'its org\'s alias, as D-235 allows');
  assert.equal(existsSync(typedYesPath(p, 'ACME-1')), false, 'the typed yes is used up');
});

test('the guide can\'t deploy where the person didn\'t pick: another environment is refused, even with its name typed (security review)', () => {
  const p = state();
  pick(p, 'ACME-1', 'uat', at(T0));
  typed(p, 'ACME-1', 'production', 'Production', at(T0));
  assert.throws(() => takeGuidedYes(p, 'ACME-1', production, null, at(T0), verify, (b) => ({ uat: 'UAT' })[b] ?? b), /The person picked UAT for ACME-1, not Production\. The deploy guide deploys only where the person picked: acc deploy uat --task ACME-1/);
  assert.ok(existsSync(typedYesPath(p, 'ACME-1')), 'the typed yes isn\'t touched: the refusal comes before it');
  assert.equal(kept(p, 'ACME-1').used, undefined);
  assert.throws(() => takeGuidedYes(p, 'ACME-1', production, null, at(T0), verify), /picked uat for ACME-1, not Production/, 'edge case: with no names to hand, the branch');
});

test('production and a protected org keep the typed yes: the pick alone deploys nothing there, and fixes only where', () => {
  const p = state();
  pick(p, 'ACME-1', 'production', at(T0));
  const said = (fn: () => unknown): string => { try { fn(); return ''; } catch (e) { return (e as Error).message; } };
  assert.match(said(() => takeGuidedYes(p, 'ACME-1', production, null, at(T0), verify)), /^The person hasn't typed a yes for ACME-1 in this chat/, 'no lead about the pick: it was never in question');
  assert.equal(kept(p, 'ACME-1').used, undefined, 'not used: it was never the yes');
  typed(p, 'ACME-1', 'production', 'yes', at(T0));
  assert.match(said(() => takeGuidedYes(p, 'ACME-1', production, null, at(T0), verify)), /^The person typed "yes", not Production\. Ask them to type Production in the chat/);
  typed(p, 'ACME-1', 'production', 'Production', at(T0));
  assert.equal(takeGuidedYes(p, 'ACME-1', production, { at: T0 }, at(T0), verify), 'typed');
  assert.equal(kept(p, 'ACME-1').used, at(T0)().toISOString(), 'marked used once the typed name deployed, so it fixes no later deploy');
  typed(p, 'ACME-1', 'production', 'Production', at(T0));
  assert.throws(() => takeGuidedYes(p, 'ACME-1', production, { at: T0 }, at(T0), verify), /pick of Production for ACME-1 was used by a deploy already\. A person opens its deploy guide again/, 'an old pick from a closed chat sends nothing to production (review)');
  rmSync(typedYesPath(p, 'ACME-1'), { force: true });
  // A protected sandbox is production's case too: confirm is the plan's, by the settings or by what Salesforce says.
  pick(p, 'ACME-1', 'uat', at(T0));
  assert.throws(() => takeGuidedYes(p, 'ACME-1', { ...sandbox, confirm: true }, null, at(T0), verify), /hasn't typed a yes/);
});

test('edge case: no pick, a file that isn\'t acc\'s, or another task\'s pick is refused before anything else', () => {
  const p = state();
  typed(p, 'ACME-1', 'uat', 'UAT', at(T0));
  assert.throws(() => takeGuidedYes(p, 'ACME-1', sandbox, null, at(T0), verify), (e: Error) => e.message === 'No one picked where ACME-1 goes. A person opens its deploy guide with acc deploy <environment> --task ACME-1 --guide, and that pick is where it deploys.');
  mkdirSync(dirname(deployPickPath(p, 'ACME-1')), { recursive: true });
  writeFileSync(deployPickPath(p, 'ACME-1'), 'not json');
  assert.deepEqual(readPick(p, 'ACME-1', verify), { pick: null, why: null });
  // A person's signed pick for ACME-2, copied into ACME-1's file: the signature holds, and the task doesn't.
  pick(p, 'ACME-2', 'uat', at(T0));
  writeFileSync(deployPickPath(p, 'ACME-1'), readFileSync(deployPickPath(p, 'ACME-2')));
  assert.deepEqual(readPick(p, 'ACME-1', verify), { pick: null, why: 'The pick kept for ACME-1 is ACME-2\'s, not its own.' }, 'another task\'s');
  assert.throws(() => takeGuidedYes(p, 'ACME-1', sandbox, null, at(T0), verify), /The pick kept for ACME-1 is ACME-2's, not its own\. No one picked where ACME-1 goes/);
  assert.ok(existsSync(typedYesPath(p, 'ACME-1')), 'the typed yes is left: the pick is what is missing');
});

test('a pick that no person\'s key signed is no pick, with why: unsigned, another key, a changed field, or a machine with no key (T-171, security review)', () => {
  const p = state();
  const file = deployPickPath(p, 'ACME-1');
  mkdirSync(dirname(file), { recursive: true });
  // What a builder's test could write: the pick as acc keeps it, with no signature.
  const forged = { v: 2, task: 'ACME-1', env: 'uat', by, at: T0, session: SESSION };
  writeFileSync(file, JSON.stringify(forged));
  assert.deepEqual(readPick(p, 'ACME-1', verify), { pick: null, why: 'The pick kept for ACME-1 is no pick: it isn\'t signed. Only a person\'s own acc deploy --guide makes one.' });
  typed(p, 'ACME-1', 'uat', 'UAT', at(T0));
  assert.throws(() => takeGuidedYes(p, 'ACME-1', sandbox, null, at(T0), verify), /The pick kept for ACME-1 is no pick: it isn't signed\. Only a person's own acc deploy --guide makes one\. No one picked where ACME-1 goes/, 'with the name typed too: the pick is what\'s missing');
  assert.ok(existsSync(typedYesPath(p, 'ACME-1')), 'the typed yes isn\'t touched');
  // A pick from before T-171: v1, unsigned.
  writeFileSync(file, JSON.stringify({ v: 1, task: 'ACME-1', env: 'uat', by, at: T0 }));
  assert.match(readPick(p, 'ACME-1', verify).why!, /is no pick: it isn't signed\./);
  // A made-up signature, and one that isn't base64.
  writeFileSync(file, JSON.stringify({ ...forged, sig: Buffer.from('x'.repeat(64)).toString('base64') }));
  assert.match(readPick(p, 'ACME-1', verify).why!, /is no pick: it isn't signed by this machine's person key\./);
  writeFileSync(file, JSON.stringify({ ...forged, sig: '!!' }));
  assert.match(readPick(p, 'ACME-1', verify).why!, /isn't signed by this machine's person key/);
  // Signed by a key a forger made: not this machine's.
  pick(p, 'ACME-1', 'uat', at(T0), personKeys().signer);
  assert.match(readPick(p, 'ACME-1', verify).why!, /isn't signed by this machine's person key/);
  // A signed pick with one field changed: the environment (to send the deploy elsewhere), the time (to un-expire it), who, the chat.
  for (const change of [{ env: 'production' }, { at: later(60_000)().toISOString() }, { by: 'human:someone' }, { session: 'sess-2' }, { v: 3 }]) {
    pick(p, 'ACME-1', 'uat', at(T0));
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), ...change }));
    assert.match(readPick(p, 'ACME-1', verify).why!, /isn't signed by this machine's person key/, JSON.stringify(change));
  }
  // A machine with no key reads every pick as none, and says a person's command makes one.
  pick(p, 'ACME-1', 'uat', at(T0));
  const none: Verifier = { verify: () => NO_KEY };
  assert.equal(readPick(p, 'ACME-1', none).why, `The pick kept for ACME-1 is no pick: ${NO_KEY} Only a person's own acc deploy --guide makes one.`);
  assert.throws(() => takeGuidedYes(p, 'ACME-1', sandbox, null, at(T0), none), /This machine has no person key yet/);
  assert.deepEqual(readPick(p, 'ACME-1', personKeys().verify).pick, null, 'edge case: a machine with another key');
});

test('the typed yes must be the pick\'s chat\'s, and its environment\'s: a yes from another chat is no yes for this pick (T-171)', () => {
  const p = state();
  pick(p, 'ACME-1', 'production', at(T0));
  keepTypedYes(p, 'ACME-1', 'production', 'Production', 'sess-2', at(T0), keys.signer);
  assert.throws(() => takeGuidedYes(p, 'ACME-1', production, null, at(T0), verify), /The person typed it in another chat, not this one\. Ask the person to type it in the chat/);
  keepTypedYes(p, 'ACME-1', 'uat', 'Production', SESSION, at(T0), keys.signer);
  assert.throws(() => takeGuidedYes(p, 'ACME-1', production, null, at(T0), verify), /The person typed it in a chat for uat, not Production\./);
  assert.equal(kept(p, 'ACME-1').used, undefined, 'the pick stands: nothing deployed');
  typed(p, 'ACME-1', 'production', 'Production', at(T0));
  assert.equal(takeGuidedYes(p, 'ACME-1', production, null, at(T0), verify), 'typed');
});

/** deploy-pick.ts with one line changed, loaded as its own module, so a test can show the check catches it. */
async function mutant(from: string, to: string): Promise<typeof real> {
  const src = new URL('../src/deploy-pick.ts', import.meta.url);
  const text = readFileSync(src, 'utf8');
  assert.ok(text.includes(from), `the mutant's line is still in deploy-pick.ts: ${from}`);
  const changed = text.replace(from, to).replace(/from '\.\/([\w-]+\.ts)'/g, (_, f: string) => `from '${new URL(`../src/${f}`, import.meta.url).href}'`);
  const file = `${tempDir('mutant-')}/deploy-pick.ts`;
  writeFileSync(file, changed);
  return await import(pathToFileURL(file).href) as typeof real;
}

/** A guide's deploy to a sandbox on an unsigned pick is refused. What's wrong, or nothing. */
function noDeployOnUnsignedPick(m: typeof real): string[] {
  const p = state();
  mkdirSync(dirname(deployPickPath(p, 'ACME-1')), { recursive: true });
  writeFileSync(deployPickPath(p, 'ACME-1'), JSON.stringify({ v: 2, task: 'ACME-1', env: 'uat', by, at: T0, session: SESSION }));
  const wrong: string[] = [];
  try {
    const yes = m.takeGuidedYes(p, 'ACME-1', sandbox, null, at(T0), verify);
    wrong.push(`the deploy went on the forged pick as its ${yes}`);
  } catch (e) {
    if (!/is no pick: it isn't signed/.test((e as Error).message)) wrong.push(`it failed another way: ${(e as Error).message}`);
  }
  return wrong;
}

test('a mutant that accepts an unsigned pick is caught (T-171)', async () => {
  assert.deepEqual(noDeployOnUnsignedPick(real), []);
  const m = await mutant("  if (unsigned) return { pick: null, why: `The pick kept for ${task} is no pick: ${asClause(unsigned)}. Only a person's own acc deploy --guide makes one.` };\n", '');
  assert.notDeepEqual(noDeployOnUnsignedPick(m), [], 'the mutant deployed on the forged pick, and the check saw it');
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

test('an org Salesforce doesn\'t say is a sandbox keeps the typed yes, whatever the settings call it (security review)', () => {
  const p = state();
  pick(p, 'ACME-1', 'uat', at(T0));
  // A legacy instance URL reads as unknown: it could be production, so the pick is no yes there.
  const unknown = { ...sandbox, sandbox: false };
  assert.throws(() => takeGuidedYes(p, 'ACME-1', unknown, null, at(T0), verify), /^.*hasn't typed a yes for ACME-1 in this chat/);
  assert.equal(kept(p, 'ACME-1').used, undefined, 'not used: it was never the yes');
  assert.throws(() => takeGuidedYes(p, 'ACME-1', { confirm: false, confirmName: UAT.name, to: UAT }, null, at(T0), verify), /hasn't typed a yes/, 'a kept plan from before T-156 has no word on it: typed');
  typed(p, 'ACME-1', 'uat', 'UAT', at(T0));
  assert.equal(takeGuidedYes(p, 'ACME-1', unknown, { at: T0 }, at(T0), verify), 'typed');
});
