import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { cloneAccount, githubIdentity, parseGhStatus, pushSetup, useGithubAccount, withCloneAccount } from '../src/github.ts';
import { GENERIC_CONFIG, gitIn, makeRepo, tempDir } from './support.ts';

const STATUS = [
  'github.com',
  '  ✓ Logged in to github.com account work-acct (keyring)',
  '  - Active account: true',
  "  - Token scopes: 'gist', 'read:org', 'repo'",
  '',
  '  ✓ Logged in to github.com account me (keyring)',
  '  - Active account: false',
  "  - Token scopes: 'read:org', 'repo', 'project'",
].join('\n');

/** A stand-in gh on PATH: two accounts logged in, and a token per account. */
function fakeGh(): NodeJS.ProcessEnv {
  const bin = join(tempDir('fake-gh-'), 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
case "$1 $2" in
  "auth status") cat >&2 <<'OUT'
${STATUS}
OUT
  ;;
  "auth token") echo "token-for-$4" ;;
esac
`);
  chmodSync(join(bin, 'gh'), 0o755);
  return { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}` };
}

const config = () => parseConfig({ ...GENERIC_CONFIG, github: { repo: 'o/r', account: 'me' } }).config!;

/** What git push would send, by asking git's credential helpers as git itself does. */
function pushCredential(dir: string, env: NodeJS.ProcessEnv): { username?: string; password?: string } {
  const r = run('git', ['credential', 'fill'], { cwd: dir, input: 'protocol=https\nhost=github.com\n\n', env: { ...env, GIT_TERMINAL_PROMPT: '0' } });
  return Object.fromEntries(r.stdout.split('\n').filter((l) => l.includes('=')).map((l) => l.split('=') as [string, string]));
}

test('gh status gives every account, which one is active, and its scopes', () => {
  assert.deepEqual(parseGhStatus(STATUS), [
    { login: 'work-acct', active: true, scopes: ['gist', 'read:org', 'repo'] },
    { login: 'me', active: false, scopes: ['read:org', 'repo', 'project'] },
  ]);
  assert.deepEqual(parseGhStatus('You are not logged into any GitHub hosts.'), []);
});

test('a clone can work as another account: git config only, and git push follows it (D-028)', () => {
  const env = fakeGh();
  const dir = makeRepo();
  const c = config();
  // Before: an old pinned helper, and the project's account.
  gitIn(dir, 'config', 'credential.helper', '!f() { echo username=me; echo password=$(gh auth token -u me); }; f');
  assert.deepEqual(pushSetup(run, dir), { kind: 'pinned', account: 'me' });
  assert.equal(githubIdentity(c, dir, run, env)!.from, 'config');

  const switched = useGithubAccount(c, dir, run, 'work-acct', env);
  assert.deepEqual([switched.account, switched.from, switched.projectAccount, switched.signedIn, switched.push, switched.pushesAs], ['work-acct', 'clone', 'me', true, 'follows', 'work-acct']);
  assert.equal(cloneAccount(run, dir), 'work-acct');
  assert.deepEqual(pushCredential(dir, env), { protocol: 'https', host: 'github.com', username: 'work-acct', password: 'token-for-work-acct' }, 'the helper asks gh for the chosen account\'s token');
  assert.equal(withCloneAccount(c, dir, run).github!.account, 'work-acct', 'every gh call and check uses it');
  assert.equal(gitIn(dir, 'status', '--porcelain'), '', 'nothing committed or in the working tree changed');

  const back = useGithubAccount(c, dir, run, null, env);
  assert.deepEqual([back.account, back.from], ['me', 'config']);
  assert.equal(cloneAccount(run, dir), null, 'back to the project\'s account removes the clone\'s choice');
  assert.equal(pushCredential(dir, env).username, 'me', 'and the same helper now gives the project\'s account');
});

test('switching refuses an account gh isn\'t logged in as, or that isn\'t a login', () => {
  const env = fakeGh();
  const dir = makeRepo();
  assert.throws(() => useGithubAccount(config(), dir, run, 'someone-else', env), /gh isn't logged in as someone-else/);
  assert.throws(() => useGithubAccount(config(), dir, run, 'not a login', env), /isn't a GitHub login/);
  assert.equal(cloneAccount(run, dir), null);
  assert.equal(githubIdentity(parseConfig(GENERIC_CONFIG).config!, dir, run, env), null, 'no GitHub in the config, no identity');
});
