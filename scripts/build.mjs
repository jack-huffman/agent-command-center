// Builds the CLI bundle the plugin ships (D-012), regenerates the walkthrough from core's step list
// (D-017), and bundles the extension with its own copy of the CLI and the onboarding guide.
import { build } from 'esbuild';
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cli = join(root, 'plugin', 'bin', 'acc');
const ext = join(root, 'extension');

await build({
  entryPoints: [join(root, 'packages', 'cli', 'src', 'main.ts')],
  outfile: cli,
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'none',
  logLevel: 'warning',
});
chmodSync(cli, 0o755);
console.log(`built ${cli}`);

const { generate } = await import('../extension/scripts/generate.ts');
const changed = generate();
console.log(changed.length ? `updated ${changed.length} walkthrough files` : 'walkthrough files up to date');

await build({
  entryPoints: [join(ext, 'src', 'extension.ts')],
  outfile: join(ext, 'dist', 'extension.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: true,
  legalComments: 'none',
  logLevel: 'warning',
});
mkdirSync(join(ext, 'dist', 'bin'), { recursive: true });
copyFileSync(cli, join(ext, 'dist', 'bin', 'acc'));
chmodSync(join(ext, 'dist', 'bin', 'acc'), 0o755);
copyFileSync(join(root, 'docs', 'ONBOARDING.md'), join(ext, 'dist', 'ONBOARDING.md'));
console.log(`built ${join(ext, 'dist', 'extension.js')}`);
