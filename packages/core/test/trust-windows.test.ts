// Claude Code's trust, read on Windows (D-T-123): git names a folder C:/Users/…, Node C:\Users\…, and
// ~/.claude.json keys it in Claude Code's own spelling, so on Windows each spelling of one folder is the
// same folder. A Mac reads the key as it did, exactly.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { isTrusted, windowsPathKey } from '../src/dispatch.ts';
import { tempDir } from './support.ts';

/** A Claude config folder whose ~/.claude.json holds these projects, and the env that reads it. */
const configWith = (projects: Record<string, { hasTrustDialogAccepted?: boolean }>): NodeJS.ProcessEnv => {
  const dir = tempDir('claude-config-');
  writeFileSync(join(dir, '.claude.json'), JSON.stringify({ projects }));
  return { CLAUDE_CONFIG_DIR: dir };
};

test('on Windows a folder git names with forward slashes is trusted under Claude Code\'s backslash key, and the other way round', () => {
  const back = configWith({ 'C:\\Users\\jordan\\acme': { hasTrustDialogAccepted: true } });
  assert.equal(isTrusted('C:/Users/jordan/acme', back, 'win32'), true);
  const forward = configWith({ 'C:/Users/jordan/acme': { hasTrustDialogAccepted: true } });
  assert.equal(isTrusted('C:\\Users\\jordan\\acme', forward, 'win32'), true);
  assert.equal(isTrusted('c:/users/JORDAN/Acme/', forward, 'win32'), true, 'Windows compares paths without case, and a trailing slash is the same folder');
});

test('edge case: on Windows a folder not accepted, another folder, or no config at all is not trusted', () => {
  assert.equal(isTrusted('C:/Users/jordan/acme', configWith({ 'C:\\Users\\jordan\\acme': { hasTrustDialogAccepted: false } }), 'win32'), false);
  assert.equal(isTrusted('C:/Users/jordan/acme', configWith({ 'C:\\Users\\jordan\\acme-two': { hasTrustDialogAccepted: true } }), 'win32'), false);
  assert.equal(isTrusted('C:/Users/jordan/acme', { CLAUDE_CONFIG_DIR: join(tempDir('none-'), 'missing') }, 'win32'), false);
});

test('a Mac reads the key exactly as before: another case or slash is another folder', () => {
  const env = configWith({ '/Users/jordan/acme': { hasTrustDialogAccepted: true } });
  assert.equal(isTrusted('/Users/jordan/acme', env, 'darwin'), true);
  assert.equal(isTrusted('/Users/jordan/Acme', env, 'darwin'), false);
});

test('windowsPathKey makes one spelling of a Windows path', () => {
  assert.equal(windowsPathKey('C:\\Users\\Jordan\\'), 'c:/users/jordan');
  assert.equal(windowsPathKey('c:/users/jordan'), 'c:/users/jordan');
});
