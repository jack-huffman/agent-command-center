// The person's key (T-171): a record under acc's state that stands for a person's word (a deploy pick, a typed
// yes, a relaxed floor) is signed with a key kept in the system's own secret store, and read as no record when
// it isn't. Here: the store on each system, the key's two halves, who may sign, what a signature covers, and that
// no agent's environment holds the key.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { analystEnv } from '../src/analyze.ts';
import { parseConfig, type Config } from '../src/config.ts';
import { run, type RunOptions } from '../src/exec.ts';
import { runGates } from '../src/gates.ts';
import { mutate, upsertTasks } from '../src/ledger.ts';
import { builderSettings } from '../src/packet.ts';
import { repoPaths } from '../src/paths.ts';
import { review } from '../src/review.ts';
import {
  asClause, canonical, DPAPI_READ, DPAPI_WRITE, dpapiStore, folderStore, keychainStore, NEVER_SIGN, newKeyPair, NO_KEY, PERSON_KEY_SERVICE, PERSON_STORE_ENV, personKeyFolder, personStore, type PersonStore, PRIVATE_ITEM, PUBLIC_ITEM, signedBody, signingKey, verifier,
} from '../src/person-key.ts';
import { resumeCommand } from '../src/resume.ts';
import { fakeRunner, GENERIC_CONFIG, gitIn, makeRepo, ok, personKeys, SF_CONFIG, tempDir } from './support.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const body = { v: 2, task: 'ACME-1', env: 'uat' };

/** A store's round trip: an item written is read back as written, replaced whole, and gone once deleted. */
function roundTrip(store: PersonStore): void {
  assert.equal(store.read('private'), null, 'edge case: nothing yet reads as none');
  store.write('private', 'first-value');
  assert.equal(store.read('private'), 'first-value');
  store.write('private', 'second value, with spaces and "quotes"');
  assert.equal(store.read('private'), 'second value, with spaces and "quotes"', 'replaced whole');
  assert.equal(store.read('public'), null, 'another item is another item');
  assert.equal(store.delete('private'), true);
  assert.equal(store.read('private'), null);
  assert.equal(store.delete('private'), false, 'edge case: deleting what is gone says so');
}

test('a folder store keeps each item in a file of its own that only its owner reads, written whole', () => {
  const dir = join(tempDir('folder-store-'), 'store');
  const s = folderStore(dir);
  assert.deepEqual([s.kind, s.where], ['folder', dir]);
  roundTrip(s);
  s.write('private', 'x');
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'private')).mode & 0o777, 0o600, 'owner alone');
  assert.deepEqual(readFileSync(join(dir, 'private'), 'utf8'), 'x\n');
  assert.equal(existsSync(join(dir, `private.${process.pid}.tmp`)), false, 'the temp file is renamed into place');
  assert.equal(folderStore(dir, 'file').kind, 'file', 'a system with no secret store says so');
});

test('this system\'s own store keeps the key and gives it back: the keychain on a Mac, DPAPI on Windows, a file elsewhere (runs the real store, under a test\'s own name)', () => {
  const home = tempDir('person-home-');
  const service = `${PERSON_KEY_SERVICE}-test-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const s = personStore({ LOCALAPPDATA: join(home, 'Local'), XDG_CONFIG_HOME: join(home, 'config') }, run, process.platform, { home, service });
  assert.equal(s.kind, process.platform === 'darwin' ? 'keychain' : process.platform === 'win32' ? 'dpapi' : 'file');
  try {
    roundTrip(s);
    if (process.platform === 'win32') {
      s.write('private', 'secret');
      const blob = readFileSync(join(home, 'Local', 'acc', PERSON_KEY_SERVICE, service, 'private.dpapi'));
      assert.equal(blob.includes('secret'), false, 'the file is encrypted: the value isn\'t in it');
      assert.equal(s.read('private'), 'secret');
    }
    if (process.platform === 'darwin') {
      s.write('private', 'secret');
      assert.equal(execFileSync('security', ['find-generic-password', '-s', service, '-a', 'private', '-w'], { encoding: 'utf8' }).trim(), 'secret', 'kept as a generic password under the service');
    }
  } finally {
    s.delete('private');
    s.delete('public');
  }
});

test('the keychain store speaks to security as the cloud token does: the value on stdin, never on a command line, and reads with -w', () => {
  const calls: string[] = [];
  const items: Record<string, string> = {};
  const runner = fakeRunner({
    security: (o) => {
      const line = o?.input ?? '';
      if (line) {
        const m = /^add-generic-password -U -s "([^"]+)" -a "([^"]+)" -w "((?:[^"\\]|\\.)*)"\n$/.exec(line);
        assert.ok(m, `one add command on stdin: ${JSON.stringify(line)}`);
        items[m![2]!] = m![3]!.replace(/\\(["\\])/g, '$1');
        return ok();
      }
      return ok();
    },
  }, calls);
  const s = keychainStore(runner, {}, 'acc-test');
  assert.equal(s.kind, 'keychain');
  assert.match(s.where, /keychain, as acc-test/);
  s.write('private', 'va"lue');
  assert.deepEqual(items, { private: 'va"lue' }, 'quotes are escaped for security');
  assert.deepEqual(calls, ['security -i'], 'the value is on stdin: the command line names no item and no value');
  s.read('private');
  assert.equal(calls[1], 'security find-generic-password -s acc-test -a private -w');
  s.delete('public');
  assert.equal(calls[2], 'security delete-generic-password -s acc-test -a public');
  assert.equal(keychainStore(fakeRunner({ security: ok('   \n') }), {}).read('private'), null, 'edge case: an empty answer is no item');
  assert.throws(() => keychainStore(fakeRunner({ security: { code: 1, stdout: '', stderr: 'security: SecKeychainAddGeneric failed' } }), {}).write('private', 'x'), /The keychain wouldn't keep the person's key: security: SecKeychainAddGeneric failed/);
});

test('the DPAPI store runs PowerShell with the file and the value in its environment, never on its command line, and renames the encrypted file into place', () => {
  const dir = join(tempDir('dpapi-'), 'store');
  const calls: { args: string[]; env: NodeJS.ProcessEnv }[] = [];
  const runner = fakeRunner({
    powershell: (o) => {
      calls.push({ args: [], env: o?.env ?? {} });
      const file = o!.env!.ACC_STORE_FILE!;
      if (o!.env!.ACC_STORE_VALUE !== undefined) { writeFileSync(file, `enc:${o!.env!.ACC_STORE_VALUE}`); return ok(); }
      return ok(readFileSync(file, 'utf8').replace(/^enc:/, ''));
    },
  });
  const s = dpapiStore(runner, { PATH: '/bin' }, dir);
  assert.equal(s.kind, 'dpapi');
  assert.match(s.where, /encrypted for this Windows account by DPAPI/);
  s.write('private', 'secret');
  assert.equal(calls[0]!.env.ACC_STORE_VALUE, 'secret');
  assert.match(calls[0]!.env.ACC_STORE_FILE!, /private\.dpapi\.\d+\.tmp$/, 'PowerShell writes the temp file beside the item');
  assert.equal(calls[0]!.env.PATH, '/bin', 'the caller\'s environment, and the two names');
  assert.equal(readFileSync(join(dir, 'private.dpapi'), 'utf8'), 'enc:secret', 'renamed into place');
  assert.equal(s.read('private'), 'secret');
  assert.equal(calls[1]!.env.ACC_STORE_VALUE, undefined, 'a read hands over no value');
  assert.equal(s.read('public'), null, 'edge case: no file, no PowerShell run');
  assert.equal(calls.length, 2);
  assert.ok(DPAPI_WRITE.includes("'CurrentUser'") && DPAPI_READ.includes("'CurrentUser'"), 'the user\'s scope: another account can\'t decrypt it');
  assert.ok(DPAPI_WRITE.includes('$env:ACC_STORE_VALUE') && DPAPI_READ.includes('$env:ACC_STORE_FILE'));
  assert.throws(() => dpapiStore(fakeRunner({ powershell: { code: 1, stdout: '', stderr: 'Add-Type : no' } }), {}, dir).write('x', 'y'), /Windows wouldn't keep the person's key: Add-Type : no/);
});

test('which store a system gets: the folder ACC_PERSON_STORE names first, else the keychain, DPAPI under LOCALAPPDATA, or a file under the config folder', () => {
  const r = fakeRunner({});
  assert.deepEqual([personStore({ [PERSON_STORE_ENV]: '/tmp/s' }, r, 'darwin').kind, personStore({ [PERSON_STORE_ENV]: '/tmp/s' }, r, 'win32').where], ['folder', '/tmp/s'], 'tests and CI');
  assert.equal(personStore({ [PERSON_STORE_ENV]: '  ' }, r, 'darwin').kind, 'keychain', 'edge case: a blank name is none');
  assert.equal(personStore({}, r, 'win32', { home: 'C:\\Users\\me' }).where, `${join('C:\\Users\\me', 'AppData', 'Local', 'acc', PERSON_KEY_SERVICE)}, encrypted for this Windows account by DPAPI`);
  assert.equal(personStore({ LOCALAPPDATA: 'D:\\Local' }, r, 'win32').where, `${join('D:\\Local', 'acc', PERSON_KEY_SERVICE)}, encrypted for this Windows account by DPAPI`);
  assert.deepEqual([personStore({}, r, 'linux', { home: '/home/me' }).kind, personStore({}, r, 'linux', { home: '/home/me' }).where], ['file', '/home/me/.config/acc/acc-person-key']);
  assert.equal(personKeyFolder('linux', { XDG_CONFIG_HOME: '/xdg' }), '/xdg/acc/acc-person-key');
  assert.equal(PERSON_STORE_ENV, 'ACC_PERSON_STORE');
});

test('a person\'s command makes the key pair once, in the store\'s two items, and signs with it; the hook signs with the key that is there and never makes one', () => {
  const store = folderStore(tempDir('key-'));
  assert.throws(() => signingKey(store, { ACC_ROLE: 'deployer' }, { create: false }), (e: Error) => e.message === NO_KEY, 'the guide chat\'s hook, on a machine with no key');
  assert.equal(store.read(PRIVATE_ITEM), null, 'and made none');
  const person = signingKey(store, {}, { create: true });
  const priv = store.read(PRIVATE_ITEM)!;
  const pub = store.read(PUBLIC_ITEM)!;
  assert.ok(priv && pub && priv !== pub, 'two halves');
  assert.equal(signingKey(store, {}, { create: true }) && store.read(PRIVATE_ITEM), priv, 'made once');
  const sig = person.sign('deploy-pick', body);
  assert.equal(verifier(store).verify('deploy-pick', body, sig), null, 'the person\'s');
  const hook = signingKey(store, { ACC_ROLE: 'deployer', ACC_TASK: 'ACME-1' }, { create: false });
  assert.equal(verifier(store).verify('typed-yes', body, hook.sign('typed-yes', body)), null, 'the hook signs with the same key');
  // A store half written (the public item lost): a person's command puts it back; the hook doesn't.
  store.delete(PUBLIC_ITEM);
  assert.equal(verifier(store).verify('deploy-pick', body, sig), NO_KEY, 'edge case: no public half reads as no key');
  signingKey(store, { ACC_ROLE: 'deployer' }, { create: false });
  assert.equal(store.read(PUBLIC_ITEM), null);
  signingKey(store, {}, { create: true });
  assert.equal(store.read(PUBLIC_ITEM), pub, 'put back from the private half');
  const pair = newKeyPair();
  assert.ok(pair.private.length > 40 && pair.public.length > 20);
});

test('a builder, a reviewer and an analyst never sign, whatever store they hold; a person and the guide chat\'s hook do', () => {
  const store = personKeys().store;
  for (const role of NEVER_SIGN) assert.throws(() => signingKey(store, { ACC_ROLE: role }, { create: true }), new RegExp(`^.*${role === 'analyst' ? 'An' : 'A'} ${role} never signs the person's word\\.`), role);
  assert.deepEqual([...NEVER_SIGN].sort(), ['analyst', 'builder', 'reviewer']);
  assert.ok(signingKey(store, {}, { create: false }).sign('relax', body), 'a person');
  assert.ok(signingKey(store, { ACC_ROLE: 'deployer' }, { create: false }).sign('typed-yes', body), 'the hook');
  assert.ok(signingKey(store, { ACC_ROLE: '' }, { create: false }).sign('relax', body), 'edge case: a role set to nothing is a person\'s shell');
});

test('a signature covers the record\'s kind and its fields in order: a signed pick is no signed yes, and a changed field, a missing one or another key fails', () => {
  const keys = personKeys();
  const sig = keys.signer.sign('deploy-pick', body);
  assert.equal(keys.verify.verify('deploy-pick', body, sig), null);
  assert.equal(keys.verify.verify('typed-yes', body, sig), 'it isn\'t signed by this machine\'s person key', 'another kind');
  assert.equal(keys.verify.verify('deploy-pick', { ...body, env: 'production' }, sig), 'it isn\'t signed by this machine\'s person key', 'a changed field');
  assert.equal(keys.verify.verify('deploy-pick', { v: 2, env: 'uat', task: 'ACME-1' }, sig), 'it isn\'t signed by this machine\'s person key', 'the fields in another order are other bytes');
  assert.equal(keys.verify.verify('deploy-pick', body, undefined), 'it isn\'t signed');
  assert.equal(keys.verify.verify('deploy-pick', body, ''), 'it isn\'t signed', 'edge case: an empty signature is none');
  assert.equal(keys.verify.verify('deploy-pick', body, 42), 'it isn\'t signed', 'edge case: not a string');
  assert.equal(keys.verify.verify('deploy-pick', body, 'AAAA'), 'it isn\'t signed by this machine\'s person key', 'edge case: too short to be a signature fails, and doesn\'t throw');
  assert.equal(personKeys().verify.verify('deploy-pick', body, sig), 'it isn\'t signed by this machine\'s person key', 'another machine\'s key');
  assert.equal(canonical('relax', { a: 1 }).toString(), 'acc relax\n{"a":1}');
  assert.deepEqual(signedBody({ b: 2, a: 1, sig: 'x', used: 'y' }, ['a', 'b']), { a: 1, b: 2 }, 'the named fields, in the order named, and nothing else');
  assert.equal(JSON.stringify(signedBody({ b: 2, a: 1 }, ['a', 'b'])), '{"a":1,"b":2}');
  assert.deepEqual([asClause('No key.'), asClause('it isn\'t signed')], ['No key', 'it isn\'t signed']);
  const broken = folderStore(tempDir('broken-'));
  broken.write(PUBLIC_ITEM, 'not a key');
  assert.equal(verifier(broken).verify('deploy-pick', body, sig), NO_KEY, 'edge case: a public item that isn\'t a key reads as no key');
});

/** The environment a reviewer is started with: a repo with one task in review, its check passed, and claude a fake that keeps what it was given. */
function reviewerEnv(outer: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const raw = { ...GENERIC_CONFIG, gates: { required: ['test'], commands: { test: 'true' } }, strayFiles: { required: false } };
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw) });
  const config = parseConfig(raw).config as Config;
  const base = gitIn(dir, 'branch', '--show-current').trim();
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-1-a');
  writeFileSync(join(dir, 'a.js'), 'export const a = 1;\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'T-1: a');
  const paths = repoPaths(dir, run);
  const now = () => new Date('2026-11-01T12:00:00Z');
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'A thing', brief: '- a is 1' }], 'human', 'human:test', emit, now);
    const t = l.tasks[0]!;
    t.state = 'review' as never;
    t.environment = base;
    t.run = { branch: 'task/T-1-a', worktree: dir };
  });
  runGates(paths, config, config.environments[0]!, [], [], { run, now, slots: { dir: join(dir, '.git', 'slots') } });
  let given: RunOptions | undefined;
  const pass = JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 's', structured_output: { verdict: 'pass', summary: 'Adds a.', criteria: [], findings: [] } });
  review(paths, config, 'T-1', { run: fakeRunner({ claude: (opts) => { given = opts; return ok(pass); } }), now, env: outer });
  assert.ok(given, 'the reviewer was started');
  return given!.env as Record<string, string | undefined>;
}

test('no builder, reviewer, analyst or deploy guide holds the key in its environment, and only a person\'s command and the guide chat\'s hook read the private half', () => {
  const keys = personKeys();
  const priv = keys.store.read(PRIVATE_ITEM)!;
  const c = parseConfig(GENERIC_CONFIG).config!;
  const sf = parseConfig(SF_CONFIG).config!;
  const task = { id: 'T-1', title: 'A thing', state: 'running', environment: 'main', deps: [], run: { branch: 'task/T-1' } } as never;
  // The outer environment a person's acc runs in, with the store named as tests and CI name it: nothing in it is the key.
  const outer = { PATH: '/bin', [PERSON_STORE_ENV]: keys.dir };
  const envs: Record<string, Record<string, string | undefined>> = {
    builder: (builderSettings(task, c, '/acc/bin', '/usr/bin') as { env: Record<string, string> }).env,
    resumed: resumeCommand(task, c, { sessionId: 's', message: 'Carry on.', accBinDir: '/acc/bin', basePath: '/usr/bin' }).env,
    reviewer: reviewerEnv(outer),
    analyst: analystEnv(sf, outer, 'T-1') as Record<string, string | undefined>,
  };
  // The deploy guide's environment is pinned whole in task-deploy.test.ts: ACC_ROLE, ACC_TASK and ACC_DEPLOY_TO alone.
  for (const [who, env] of Object.entries(envs)) {
    for (const [k, v] of Object.entries(env)) {
      assert.ok(!/KEY|SECRET|SIGN/i.test(k), `${who}'s environment names ${k}`);
      assert.ok(v !== priv && !(v && v.includes(priv)), `${who}'s environment holds the key in ${k}`);
    }
  }
  assert.ok(Object.keys(envs.builder!).every((k) => ['ACC_TASK', 'ACC_ROLE', 'PATH'].includes(k)), `a builder's environment is its task, its role and its PATH: ${Object.keys(envs.builder!).join(', ')}`);
  assert.deepEqual(Object.keys(envs.resumed!), ['ACC_ROLE', 'ACC_TASK']);
  assert.deepEqual(envs.reviewer, { ...outer, ACC_ROLE: 'reviewer', ACC_TASK: 'T-1' }, 'a reviewer\'s environment is the outer one, its role and its task: the store\'s name, never the key, and it has no shell to read the store with');
  // Who reads the private half: the modules a person's command runs, and the hook. A launch that handed the key on would have to name one of these.
  const sources = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ':(glob)packages/*/src/**/*.ts', ':(glob)extension/src/**/*.ts'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  assert.ok(sources.length > 100, `sources: ${sources.length}`);
  const signers = sources.filter((f) => /\bsigningKey\(/.test(readFileSync(join(ROOT, f), 'utf8')) && !f.endsWith('person-key.ts'));
  assert.deepEqual(signers.sort(), ['packages/cli/src/commands/checks.ts', 'packages/cli/src/commands/environments.ts', 'packages/core/src/hooks.ts'], 'acc gate relax, acc deploy --guide, and the UserPromptSubmit hook');
  const readers = sources.filter((f) => /PRIVATE_ITEM/.test(readFileSync(join(ROOT, f), 'utf8')));
  assert.deepEqual(readers, ['packages/core/src/person-key.ts'], 'the private item is read in one module');
  const inEnv = sources.filter((f) => !f.endsWith('person-key.ts') && /ACC_PERSON_KEY|PRIVATE_ITEM|newKeyPair/.test(readFileSync(join(ROOT, f), 'utf8')));
  assert.deepEqual(inEnv, [], 'no other module makes a key or names its private half, so none can hand it on');
});
