// Builds the CLI bundle the plugin ships (D-012), regenerates the walkthrough from core's step list
// (D-017), and bundles the extension with its own copy of the CLI and the onboarding guide.
//
// acc ships as two files side by side, everywhere it ships (D-???): `acc`, a small sh launcher that finds
// a runtime, and `acc.mjs`, the bundle it runs. So acc works with no Node installed.
import { build } from 'esbuild';
import { chmodSync, copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The CLI builds into dist/, which git ignores. The plugin's tracked copy, plugin/bin/, is refreshed only
// for a release (--release, as npm run package does), so a branch's checks never change it and pull
// requests don't conflict over a generated file (D-042).
const release = process.argv.includes('--release');
const dist = join(root, 'dist');
const ext = join(root, 'extension');

await build({
  entryPoints: [join(root, 'packages', 'cli', 'src', 'main.ts')],
  outfile: join(dist, 'acc.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  legalComments: 'none',
  logLevel: 'warning',
});

/** Puts the launcher and the bundle in a folder together: one never ships without the other. */
function shipCli(dir) {
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(root, 'packages', 'cli', 'bin', 'acc'), join(dir, 'acc'));
  chmodSync(join(dir, 'acc'), 0o755);
  if (dir !== dist) copyFileSync(join(dist, 'acc.mjs'), join(dir, 'acc.mjs'));
  chmodSync(join(dir, 'acc.mjs'), 0o644);
}
shipCli(dist);
console.log(`built ${join(dist, 'acc')}`);
if (release) {
  shipCli(join(root, 'plugin', 'bin'));
  console.log(`released ${join(root, 'plugin', 'bin')}`);
}

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
shipCli(join(ext, 'dist', 'bin'));
copyFileSync(join(root, 'docs', 'ONBOARDING.md'), join(ext, 'dist', 'ONBOARDING.md'));

// The editor tabs: a browser bundle, its styles, and VSCode's own icon font.
await build({
  entryPoints: [join(ext, 'webview', 'main.ts')],
  outfile: join(ext, 'dist', 'webview', 'main.js'),
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'iife',
  legalComments: 'none',
  logLevel: 'warning',
});
mkdirSync(join(ext, 'dist', 'webview', 'codicons'), { recursive: true });
copyFileSync(join(ext, 'webview', 'styles.css'), join(ext, 'dist', 'webview', 'styles.css'));
for (const f of ['codicon.css', 'codicon.ttf']) copyFileSync(join(root, 'node_modules', '@vscode', 'codicons', 'dist', f), join(ext, 'dist', 'webview', 'codicons', f));
// Editor tabs show their icon as a plain image, so currentColor comes out black. Give them a fixed
// colour per theme: white on dark tab bars, dark grey on light ones.
const icon = readFileSync(join(ext, 'media', 'acc.svg'), 'utf8');
mkdirSync(join(ext, 'dist', 'media'), { recursive: true });
for (const [theme, colour] of [['dark', '#ffffff'], ['light', '#424242']]) {
  writeFileSync(join(ext, 'dist', 'media', `acc-${theme}.svg`), icon.replaceAll('currentColor', colour));
  // The Command Center page shows the same mark, so it ships with the page too.
  writeFileSync(join(ext, 'dist', 'webview', `acc-${theme}.svg`), icon.replaceAll('currentColor', colour));
}
console.log(`built ${join(ext, 'dist', 'extension.js')}`);
