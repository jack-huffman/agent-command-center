// acc ships as three files side by side, everywhere it ships (D-077): `acc`, a small sh launcher that finds
// a runtime, `acc.cmd`, the same launcher for cmd and PowerShell on Windows (D-T-123), and `acc.mjs`, the
// bundle they run. So acc works with no Node installed, and resolves by name in every shell.
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Puts the launchers and the bundle the build made in a folder together: one never ships without the others. */
export function shipCli(root, dir) {
  const dist = join(root, 'dist');
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(root, 'packages', 'cli', 'bin', 'acc'), join(dir, 'acc'));
  chmodSync(join(dir, 'acc'), 0o755);
  copyFileSync(join(root, 'packages', 'cli', 'bin', 'acc.cmd'), join(dir, 'acc.cmd'));
  if (resolve(dir) !== resolve(dist)) copyFileSync(join(dist, 'acc.mjs'), join(dir, 'acc.mjs'));
  chmodSync(join(dir, 'acc.mjs'), 0o644);
}
