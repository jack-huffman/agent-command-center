// Bundles the CLI into one file the plugin ships as bin/acc (D-012).
import { build } from 'esbuild';
import { chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outfile = join(root, 'plugin', 'bin', 'acc');
await build({
  entryPoints: [join(root, 'packages', 'cli', 'src', 'main.ts')],
  outfile,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  logLevel: 'warning',
});
chmodSync(outfile, 0o755);
console.log(`built ${outfile}`);
