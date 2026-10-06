// acc ships as two files side by side, everywhere it ships (D-077): `acc`, a small sh launcher that finds
// a runtime, and `acc.mjs`, the bundle it runs. So acc works with no Node installed.
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/** Puts the launcher and the bundle the build made in a folder together: one never ships without the other. */
export function shipCli(root, dir) {
  const dist = join(root, 'dist');
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(root, 'packages', 'cli', 'bin', 'acc'), join(dir, 'acc'));
  chmodSync(join(dir, 'acc'), 0o755);
  if (resolve(dir) !== resolve(dist)) copyFileSync(join(dist, 'acc.mjs'), join(dir, 'acc.mjs'));
  chmodSync(join(dir, 'acc.mjs'), 0o644);
}
