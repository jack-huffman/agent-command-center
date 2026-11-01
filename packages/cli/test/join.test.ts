// acc join (T-176): a person's command, which refuses an address it can't read with a reason and makes no folder.
// acc runs from its source, with a stand-in gh on PATH (support.ts).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { fakeBin, tempDir } from '../../core/test/support.ts';
import { cli } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));
const ADDRESS = 'https://github.com/acme-co/acme-salesforce';

/** A stand-in gh, first on PATH: only PATH, so the tests' own ACC_ROLE stays as cli() sets it. */
const onPath = (script: string): NodeJS.ProcessEnv => ({ PATH: fakeBin('gh', script).PATH });

/** gh signed in as jordan-kim, who can't read the repo. */
const NO_READER = onPath(`case "$1 $2" in
  "auth status") echo "github.com"; echo "  ✓ Logged in to github.com account jordan-kim (keyring)"; exit 0;;
  "auth token") echo tok-jordan; exit 0;;
  "api repos/acme-co/acme-salesforce") echo "HTTP 404: Not Found" >&2; exit 1;;
esac
exit 1
`);

/** gh signed in as two accounts that can both read it. */
const TWO_READERS = onPath(`case "$1 $2" in
  "auth status") echo "github.com"; echo "  ✓ Logged in to github.com account jordan-kim (keyring)"; echo "  ✓ Logged in to github.com account acme-bot (keyring)"; exit 0;;
  "auth token") echo "tok-$4"; exit 0;;
  "api repos/acme-co/acme-salesforce") echo acme-co/acme-salesforce; exit 0;;
esac
exit 1
`);

test('acc join refuses an address no account can read, with a reason, and makes no folder', () => {
  const dir = join(tempDir('join-cli-'), 'acme-salesforce');
  const r = acc(tempDir('cwd-'), ['join', ADDRESS, '--dir', dir, '--json'], undefined, NO_READER);
  assert.equal(r.code, 1, r.err);
  assert.deepEqual(r.json(), { error: 'refused', message: 'No GitHub account signed in on this machine can read acme-co/acme-salesforce. Ask for access to it, sign in to gh as an account that has it, then try again. No folder was made.' });
  assert.equal(existsSync(dir), false);
});

test('acc join with no address, or one that isn\'t GitHub\'s, is refused as usage', () => {
  assert.equal(acc(tempDir('cwd-'), ['join'], undefined, NO_READER).code, 2);
  const r = acc(tempDir('cwd-'), ['join', 'https://gitlab.com/a/b'], undefined, NO_READER);
  assert.equal(r.code, 2);
  assert.match(r.err, /isn't a GitHub repo's address/);
});

test('acc join --dry-run names every account that can read it and the folder, writing nothing; without --account the join refuses', () => {
  const dir = join(tempDir('join-cli-'), 'acme-salesforce');
  const r = acc(tempDir('cwd-'), ['join', ADDRESS, '--dir', dir, '--dry-run', '--json'], undefined, TWO_READERS);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json(), { repo: 'acme-co/acme-salesforce', readers: ['jordan-kim', 'acme-bot'], account: null, dir });
  const go = acc(tempDir('cwd-'), ['join', ADDRESS, '--dir', dir, '--json'], undefined, TWO_READERS);
  assert.equal(go.code, 1);
  assert.equal(go.json().error, 'choose');
  assert.equal(existsSync(dir), false);
});

test('joining is a person\'s: a builder, a reviewer and an analyst are refused, and make no folder', () => {
  const dir = join(tempDir('join-cli-'), 'acme-salesforce');
  let ran = 0;
  for (const role of ['builder', 'reviewer', 'analyst']) {
    const r = acc(tempDir('cwd-'), ['join', ADDRESS, '--dir', dir], undefined, { ...TWO_READERS, ACC_ROLE: role, ACC_TASK: 'T-1' });
    assert.equal(r.code, 1);
    assert.match(r.err, /can't join a project\. A person does that\./);
    ran++;
  }
  assert.equal(ran, 3);
  assert.equal(existsSync(dir), false);
});
