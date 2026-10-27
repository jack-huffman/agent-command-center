/**
 * The unit tests on Windows (D-209): the files npm test runs, but for what WINDOWS_SKIPS names, each with
 * why. An entry is a whole file, or one test in a file, which that test skips through skipOnWindows. CI's
 * Windows job runs this; it prints what it skipped, with the count, before it runs the rest, so nothing
 * stops running there without a word. A listed file that's gone fails the run, and
 * scripts/test/windows-tests.test.ts fails when the list grows past its size on main: it only shrinks, as
 * the tests are made to run on Windows too.
 *
 *   node scripts/windows-tests.ts
 */
import { spawnSync } from 'node:child_process';
import { existsSync, globSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { testGlobs } from './test-globs.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export interface WindowsSkip {
  /** The test file, from the repo's root. */
  file: string;
  /** One test in it, by its name, where the rest of the file runs on Windows. */
  test?: string;
  why: string;
}

const STAND_INS = 'It stands in programs with #!/bin/sh scripts that the extension or the launcher starts by path, not through standIn\'s .cmd (packages/core/test/stand-in.ts).';
const KEYCHAIN = 'It reads the routine\'s token from a stand-in macOS keychain, and acc keeps no token on Windows yet (cloudTokenUnavailable).';
const SIGNALS = 'It sends the run a POSIX signal and checks what its handler did. Windows has no signals: a process sent one is ended outright, with no handler run.';

/** The test files, and single tests, that can't run on Windows yet. An entry comes off as it's made to run there. */
export const WINDOWS_SKIPS: readonly WindowsSkip[] = [
  { file: 'packages/cli/test/launcher.test.ts', why: 'It runs the sh launcher with stand-in runtimes, which are #!/bin/sh scripts. CI\'s Windows job runs the launchers themselves, acc.cmd and acc, in scripts/windows-smoke.ts.' },
  { file: 'packages/cli/test/junk.test.ts', why: 'It stops process groups, which Windows doesn\'t have.' },
  { file: 'packages/core/test/cloud-guard.test.ts', why: `${STAND_INS} Its git hooks are sh scripts too.` },
  { file: 'packages/core/test/cloud.test.ts', why: KEYCHAIN },
  { file: 'packages/core/test/autopilot-cloud.test.ts', why: KEYCHAIN },
  { file: 'packages/core/test/cloud-review.test.ts', why: KEYCHAIN },
  { file: 'extension/test/activate.test.ts', why: STAND_INS },
  { file: 'extension/test/browser.test.ts', why: `${STAND_INS} It also reads the headless shell's Mac and Linux folders.` },
  { file: 'extension/test/run-view.test.ts', why: STAND_INS },
  { file: 'scripts/test/packaging.test.ts', why: 'The release reads the .vsix with /usr/bin/unzip, which Windows doesn\'t have.' },
  { file: 'packages/core/test/temp-root.test.ts', test: 'a process ended by SIGTERM still leaves nothing in the temp directory', why: SIGNALS },
  { file: 'packages/core/test/temp-root.test.ts', test: 'a process with its own SIGTERM listener is ended by that listener, reached once, and leaves nothing behind', why: SIGNALS },
  { file: 'extension/test/stops.test.ts', test: 'a run that ends by SIGTERM stops every fake browser it started, and each one\'s helper, leaving none running', why: SIGNALS },
  { file: 'extension/test/stops.test.ts', test: 'a run that ends by SIGINT stops every fake browser it started, and each one\'s helper, leaving none running', why: SIGNALS },
  { file: 'packages/core/test/exec.test.ts', test: 'edge case: a gh run asked for lowered priority isn\'t lowered, so its timeout stops gh itself, not a script around it', why: 'It reads gh\'s pid from sh\'s $$, and Git\'s sh on Windows numbers its processes apart from Windows\' own pids.' },
];

/**
 * The skip a test listed by its own name gets: on Windows, its entry's reason, so node:test reports why;
 * elsewhere it runs. A test that asks for a skip the list doesn't hold fails at once, so a skip is never
 * made outside the list.
 *
 *   test(NAME, { skip: skipOnWindows('extension/test/stops.test.ts', NAME) }, ...)
 */
export function skipOnWindows(file: string, test: string, platform: NodeJS.Platform = process.platform, skips: readonly WindowsSkip[] = WINDOWS_SKIPS): string | false {
  const entry = skips.find((k) => k.file === file && k.test === test);
  if (!entry) throw new Error(`${file} asks to skip "${test}" on Windows, and WINDOWS_SKIPS (scripts/windows-tests.ts) doesn't name it with why.`);
  return platform === 'win32' ? entry.why : false;
}

/** What runs on Windows: every file npm test runs but the skipped ones, and any listed file that isn't there. */
export function windowsSelection(root = ROOT, skips: readonly WindowsSkip[] = WINDOWS_SKIPS): { run: string[]; skipped: WindowsSkip[]; missing: string[] } {
  const all = testGlobs(root).flatMap((g) => globSync(g, { cwd: root })).map((f) => f.replaceAll('\\', '/')).sort();
  const listed = new Set(skips.filter((s) => !s.test).map((s) => s.file));
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
  const files = s.skipped.filter((k) => !k.test);
  console.log(`Skipped on Windows: ${s.skipped.length} (${files.length} test files, ${s.skipped.length - files.length} single tests); ${s.run.length} files run.`);
  for (const k of s.skipped) console.log(`  ${k.file}${k.test ? ` (${k.test})` : ''}: ${k.why}`);
  // The same flags npm test runs with.
  const r = spawnSync(process.execPath, ['--no-warnings', '--import', './scripts/compile-cache.ts', '--test', '--test-timeout=300000', '--test-reporter=spec', ...s.run], { cwd: ROOT, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
