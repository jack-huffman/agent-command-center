// Writes the walkthroughs into package.json and one page per step into media/steps, from core's
// step list (D-017). `--check` reports whether the committed files are out of date, without writing.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STEPS } from '../../packages/core/src/onboarding/steps.ts';
import { buildWalkthroughs, mediaPath, stepMedia } from '../src/logic.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function expectedFiles(): Map<string, string> {
  const files = new Map<string, string>();
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  manifest.contributes.walkthroughs = buildWalkthroughs(STEPS);
  files.set('package.json', JSON.stringify(manifest, null, 2) + '\n');
  for (const s of STEPS) files.set(mediaPath(s.id), stepMedia(s));
  return files;
}

export function staleFiles(): string[] {
  const want = expectedFiles();
  const stale = [...want].filter(([rel, text]) => !existsSync(join(root, rel)) || readFileSync(join(root, rel), 'utf8') !== text).map(([rel]) => rel);
  const dir = join(root, 'media', 'steps');
  const extra = existsSync(dir) ? readdirSync(dir).map((f) => `media/steps/${f}`).filter((rel) => !want.has(rel)) : [];
  return [...stale, ...extra];
}

export function generate(): string[] {
  const changed = staleFiles();
  const want = expectedFiles();
  mkdirSync(join(root, 'media', 'steps'), { recursive: true });
  for (const rel of changed) {
    const text = want.get(rel);
    if (text === undefined) rmSync(join(root, rel));
    else writeFileSync(join(root, rel), text);
  }
  return changed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--check')) {
    const stale = staleFiles();
    if (stale.length) {
      console.error(`Out of date: ${stale.join(', ')}. Run npm run build.`);
      process.exit(1);
    }
    console.log('walkthrough files are up to date');
  } else {
    const changed = generate();
    console.log(changed.length ? `updated ${changed.length} walkthrough files` : 'walkthrough files already up to date');
  }
}
