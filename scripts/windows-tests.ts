/**
 * The unit tests on Windows (D-T-123): the files npm test runs, but for the ones WINDOWS_SKIPS names, each
 * with why. CI's Windows job runs this; it prints what it skipped, with the count, before it runs the rest,
 * so no file stops running there without a word. A listed file that's gone fails the run, and
 * scripts/test/windows-tests.test.ts fails when the list grows past its size on main: it only shrinks, as
 * the tests are made to run on Windows too.
 *
 *   node scripts/windows-tests.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, globSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export interface WindowsSkip {
  /** The test file, from the repo's root. */
  file: string;
  why: string;
}

const STAND_INS = 'It stands in programs with #!/bin/sh scripts made executable, which Windows can\'t start.';
const KEYCHAIN = 'It reads the routine\'s token from a stand-in macOS keychain, and acc keeps no token on Windows yet (cloudTokenUnavailable).';

/** The test files that can't run on Windows yet. A file comes off as it's made to run there. */
export const WINDOWS_SKIPS: readonly WindowsSkip[] = [
  { file: 'packages/cli/test/launcher.test.ts', why: 'It runs the sh launcher with stand-in runtimes, which are #!/bin/sh scripts. CI\'s Windows job runs the launchers themselves, acc.cmd and acc, in scripts/windows-smoke.ts.' },
  { file: 'packages/cli/test/agents.test.ts', why: STAND_INS },
  { file: 'packages/cli/test/analyze-ticket.test.ts', why: STAND_INS },
  { file: 'packages/cli/test/cards.test.ts', why: STAND_INS },
  { file: 'packages/cli/test/draft.test.ts', why: STAND_INS },
  { file: 'packages/cli/test/junk.test.ts', why: `${STAND_INS} It also stops process groups, which Windows doesn't have.` },
  { file: 'packages/cli/test/manifest.test.ts', why: STAND_INS },
  { file: 'packages/cli/test/pipeline.test.ts', why: STAND_INS },
  { file: 'packages/cli/test/plan-start.test.ts', why: STAND_INS },
  { file: 'packages/cli/test/plan-talk.test.ts', why: STAND_INS },
  { file: 'packages/cli/test/steps.test.ts', why: STAND_INS },
  { file: 'packages/cli/test/tasks.test.ts', why: STAND_INS },
  { file: 'packages/cli/test/updates.test.ts', why: STAND_INS },
  { file: 'packages/cli/test/verify.test.ts', why: STAND_INS },
  { file: 'packages/core/test/cloud-guard.test.ts', why: `${STAND_INS} Its git hooks are sh scripts too.` },
  { file: 'packages/core/test/cloud.test.ts', why: STAND_INS },
  { file: 'packages/core/test/autopilot-cloud.test.ts', why: KEYCHAIN },
  { file: 'packages/core/test/cloud-review.test.ts', why: KEYCHAIN },
  { file: 'packages/core/test/exec.test.ts', why: STAND_INS },
  { file: 'packages/core/test/github.test.ts', why: STAND_INS },
  { file: 'extension/test/activate.test.ts', why: STAND_INS },
  { file: 'extension/test/browser.test.ts', why: `${STAND_INS} It also reads the headless shell's Mac and Linux folders.` },
  { file: 'extension/test/run-view.test.ts', why: STAND_INS },
  { file: 'extension/test/unseen-behaviour.test.ts', why: STAND_INS },
  { file: 'scripts/test/packaging.test.ts', why: `${STAND_INS} The release reads the .vsix with /usr/bin/unzip.` },
];

/** The globs npm test passes to node --test: the quoted arguments of package.json's test script. */
export function testGlobs(root = ROOT): string[] {
  const script = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: { test?: string } }).scripts?.test ?? '';
  return [...script.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

/** What runs on Windows: every file npm test runs but the skipped ones, and any listed file that isn't there. */
export function windowsSelection(root = ROOT, skips: readonly WindowsSkip[] = WINDOWS_SKIPS): { run: string[]; skipped: WindowsSkip[]; missing: string[] } {
  const all = testGlobs(root).flatMap((g) => globSync(g, { cwd: root })).map((f) => f.replaceAll('\\', '/')).sort();
  const listed = new Set(skips.map((s) => s.file));
  return {
    run: all.filter((f) => !listed.has(f)),
    skipped: skips.filter((s) => all.includes(s.file)),
    missing: skips.filter((s) => !existsSync(join(root, s.file))).map((s) => s.file),
  };
}

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const s = windowsSelection();
  if (s.missing.length) {
    console.error(`WINDOWS_SKIPS (scripts/windows-tests.ts) names files that aren't there: ${s.missing.join(', ')}. Take them off the list.`);
    process.exit(1);
  }
  if (!s.run.length) {
    console.error('No test files to run on Windows.');
    process.exit(1);
  }
  console.log(`Skipped on Windows: ${s.skipped.length} test files, ${s.run.length} run.`);
  for (const k of s.skipped) console.log(`  ${k.file}: ${k.why}`);
  // The same flags npm test runs with.
  const r = spawnSync(process.execPath, ['--no-warnings', '--import', './scripts/compile-cache.ts', '--test', '--test-timeout=300000', '--test-reporter=spec', ...s.run], { cwd: ROOT, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
