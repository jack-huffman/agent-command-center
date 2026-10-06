// npm run package (D-079): the version and its CHANGELOG entry, then npm run check, then the .vsix, then a
// scan of the .vsix and the plugin for the packager's personal data. plugin/bin is refreshed last, only
// when the scan is clean (D-042).
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { defaultTermDeps, packageRelease, personalTerms, ROOT } from './packaging.ts';
import { shipCli } from './ship-cli.mjs';

const step = (cmd, args, cwd = ROOT) => spawnSync(cmd, args, { cwd, stdio: 'inherit' }).status === 0;

const r = packageRelease({
  root: ROOT,
  log: (line) => console.log(line),
  check: () => step('npm', ['run', 'check']),
  vsce: (out) => step(join(ROOT, 'node_modules', '.bin', 'vsce'), ['package', '--no-dependencies', '--skip-license', '-o', out], join(ROOT, 'extension')),
  shipPlugin: () => shipCli(ROOT, join(ROOT, 'plugin', 'bin')),
  terms: () => personalTerms(defaultTermDeps(ROOT)),
});
if (!r.ok) {
  for (const p of r.problems) console.error(p);
  process.exit(1);
}
console.log(`Packaged ${relative(ROOT, r.vsix)}, and refreshed plugin/bin. On main, commit plugin/bin and push, then npm run release.`);
