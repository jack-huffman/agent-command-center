// The pinned headless shell (T-68): where it's kept, how npm run browser gets it from a zip whose SHA-256
// must match the pin, and how the gate tells it from another browser. Downloads come from a local zip.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { tempDir } from '../../packages/core/test/support.ts';
import { browserOf, CFT_BASE, fetchTo, getShell, isPinnedShell, type Pin, PIN, pinnedShell, sha256Of, SHELL_PLATFORMS, shellCache, shellPath, shellPlatform, zipUrl } from '../scripts/browser.ts';

/** A zip laid out as Chrome for Testing's is, under <base>/<version>/<platform>/, and a pin holding its hash. */
function served(platform: 'mac-arm64' = 'mac-arm64'): { base: string; pin: Pin; zip: string } {
  const root = tempDir();
  const inside = join(root, 'src', `chrome-headless-shell-${platform}`);
  mkdirSync(inside, { recursive: true });
  writeFileSync(join(inside, 'chrome-headless-shell'), '#!/bin/sh\necho "Google Chrome for Testing 9.8.7.6"\n');
  chmodSync(join(inside, 'chrome-headless-shell'), 0o755);
  const dir = join(root, 'served', '9.8.7.6', platform);
  mkdirSync(dir, { recursive: true });
  const zip = join(dir, `chrome-headless-shell-${platform}.zip`);
  const r = spawnSync('zip', ['-q', '-r', zip, `chrome-headless-shell-${platform}`], { cwd: join(root, 'src') });
  assert.equal(r.status, 0, 'zip made the test zip');
  const hash = sha256Of(zip);
  return { base: pathToFileURL(join(root, 'served')).href, pin: { name: 'chrome-headless-shell', version: '9.8.7.6', sha256: { 'mac-arm64': hash, 'mac-x64': '0'.repeat(64), linux64: '0'.repeat(64) } }, zip };
}

test('the pin names a version and a 64-digit SHA-256 for each platform, and each zip\'s address is Chrome for Testing\'s', () => {
  assert.equal(PIN.name, 'chrome-headless-shell');
  assert.match(PIN.version, /^\d+\.\d+\.\d+\.\d+$/);
  assert.deepEqual(Object.keys(PIN.sha256).sort(), [...SHELL_PLATFORMS].sort());
  for (const p of SHELL_PLATFORMS) assert.match(PIN.sha256[p], /^[0-9a-f]{64}$/, p);
  assert.equal(PIN.sha256['mac-arm64'], '7f111980bcb41e908d0fa3e969a625e7777ff683c1fc43fd7759d05ec3ffe52b', 'the zip the merger checked on 2026-10-16');
  assert.equal(zipUrl(PIN, 'linux64'), `${CFT_BASE}/${PIN.version}/linux64/chrome-headless-shell-linux64.zip`);
});

test('the platform names: macOS on Apple silicon and Intel, Linux, and none for a platform the pin doesn\'t cover', () => {
  assert.equal(shellPlatform('darwin', 'arm64'), 'mac-arm64');
  assert.equal(shellPlatform('darwin', 'x64'), 'mac-x64');
  assert.equal(shellPlatform('linux', 'x64'), 'linux64');
  assert.equal(shellPlatform('win32', 'x64'), null);
  assert.equal(shellPlatform('linux', 'arm64'), null);
});

test('the cache is under Library/Caches on macOS, else XDG_CACHE_HOME, else ~/.cache when it is unset', () => {
  assert.equal(shellCache({}, 'darwin', '/Users/a'), '/Users/a/Library/Caches/acc/chrome-headless-shell');
  assert.equal(shellCache({ XDG_CACHE_HOME: '/x' }, 'linux', '/home/a'), '/x/acc/chrome-headless-shell');
  assert.equal(shellCache({}, 'linux', '/home/a'), '/home/a/.cache/acc/chrome-headless-shell');
  assert.equal(shellPath(PIN, 'mac-arm64', '/c'), `/c/${PIN.version}/chrome-headless-shell-mac-arm64/chrome-headless-shell`);
});

test('pinnedShell finds the pinned version\'s binary, and none when it is missing or the platform has no pin', () => {
  const at = shellPath(PIN, 'mac-x64', '/c');
  assert.equal(pinnedShell((p) => p === at, '/c', 'mac-x64'), at);
  assert.equal(pinnedShell(() => false, '/c', 'mac-x64'), null);
  assert.equal(pinnedShell(() => true, '/c', null), null);
});

test('a zip whose SHA-256 matches the pin is unpacked into the cache, and the zip is not kept', async () => {
  const { base, pin } = served();
  const cache = tempDir();
  const got = await getShell({ pin, platform: 'mac-arm64', cache, base });
  assert.equal(got.status, 'got', got.line);
  assert.equal(got.path, shellPath(pin, 'mac-arm64', cache));
  assert.ok(existsSync(got.path));
  assert.deepEqual(readdirSync(join(cache, '9.8.7.6')), ['chrome-headless-shell-mac-arm64'], 'no zip and no half-unpacked folder left beside it');
  assert.match(got.line, /^Got chrome-headless-shell 9\.8\.7\.6 for mac-arm64, its SHA-256 checked/);
  assert.deepEqual(browserOf(got.path), { name: 'chrome-headless-shell', version: '9.8.7.6' }, 'the binary says its version');
});

test('a zip whose SHA-256 differs is refused: it is deleted and nothing is unpacked', async () => {
  const { base, pin } = served();
  const cache = tempDir();
  const wrong = { ...pin, sha256: { ...pin.sha256, 'mac-arm64': 'e'.repeat(64) } };
  const got = await getShell({ pin: wrong, platform: 'mac-arm64', cache, base });
  assert.equal(got.status, 'refused');
  assert.match(got.line, /^Refused .*: its SHA-256 is [0-9a-f]{64}, not the pinned e{64}\. The zip is deleted and nothing was unpacked\.$/);
  assert.deepEqual(readdirSync(join(cache, '9.8.7.6')), [], 'no zip, no shell');
  assert.ok(!existsSync(got.path));
});

test('with the pinned version already there, it does nothing: no download at all', async () => {
  const { base, pin } = served();
  const cache = tempDir();
  await getShell({ pin, platform: 'mac-arm64', cache, base });
  let fetched = 0;
  const again = await getShell({ pin, platform: 'mac-arm64', cache, base, fetch: async (u, f) => { fetched++; await fetchTo(u, f); } });
  assert.equal(again.status, 'there');
  assert.equal(fetched, 0);
  assert.match(again.line, /is already in/);
});

test('a zip that can\'t be fetched fails, and nothing is unpacked', async () => {
  const { pin } = served();
  const cache = tempDir();
  await assert.rejects(getShell({ pin, platform: 'mac-arm64', cache, base: pathToFileURL(join(tempDir(), 'none')).href }));
  assert.ok(!existsSync(shellPath(pin, 'mac-arm64', cache)));
});

test('only the pinned shell at the pinned version counts as it: not the Chrome app, another version, or no browser named', () => {
  assert.equal(isPinnedShell({ name: PIN.name, version: PIN.version }), true);
  assert.equal(isPinnedShell({ name: 'Google Chrome', version: PIN.version }), false);
  assert.equal(isPinnedShell({ name: PIN.name, version: '1.2.3.4' }), false);
  assert.equal(isPinnedShell(undefined), false);
});

test('a browser that says no version is named with an empty one, so the gate never takes it for the pin', () => {
  assert.deepEqual(browserOf('/usr/bin/true'), { name: 'true', version: '' });
});
