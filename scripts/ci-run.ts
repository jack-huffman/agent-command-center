/**
 * The CI run's own check (T-108): what GitHub's Linux runner ran and skipped, read from the logs of the full
 * check and the screenshot run, as the run's summary on GitHub. A test that needs what CI doesn't have,
 * such as the sf CLI, skips itself there with its reason, and CI_SKIPS names each one. A skip that isn't
 * on the list fails the run, so nothing quietly stops running; so does a listed one that ran, which the
 * list no longer needs, and a log with no test summary in it.
 *
 *   node scripts/ci-run.ts <check log> [<screenshot log>]
 *
 * It prints the summary, and appends it to $GITHUB_STEP_SUMMARY when GitHub sets that.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countsLine, newlySkipped, readTestCounts, type TestCounts } from '../packages/core/src/test-counts.ts';

/** A test CI skips: its name as node:test prints it, and why CI can't run it. */
export interface CiSkip { name: string; why: string }

/** Each test that skips itself on GitHub's runner and runs on the author's Mac. */
export const CI_SKIPS: readonly CiSkip[] = [
  { name: 'real sf: a ticket that adds the fixture\'s components gets the pinned package.xml', why: 'The runner has no Salesforce CLI (sf); the Mac does. packages/core/test/manifest-sf.test.ts skips it where sf is missing.' },
];

/** What fails the run: no counts, a failed test, a skip CI_SKIPS doesn't name, one it names that ran, or a skip with no name. */
export function skipProblems(counts: TestCounts | null, allowed: readonly CiSkip[] = CI_SKIPS): string[] {
  if (!counts) return ['The check\'s log holds no test summary, so what ran is unknown.'];
  const out: string[] = [];
  if (!counts.run) out.push('The check ran no tests.');
  if (counts.failed) out.push(`${counts.failed} test${counts.failed === 1 ? '' : 's'} failed.`);
  const names = counts.skippedNames ?? [];
  if (names.length !== counts.skipped) out.push(`${counts.skipped} skipped, but ${names.length} named: a skip with no name can't be checked against the list.`);
  for (const n of newlySkipped(counts, { skipped: allowed.length, skippedNames: allowed.map((s) => s.name) })) out.push(`"${n}" skipped on CI, and CI_SKIPS (scripts/ci-run.ts) doesn't name it: run it, or list it with why.`);
  for (const s of allowed) if (!names.includes(s.name)) out.push(`"${s.name}" ran on CI: take it off CI_SKIPS.`);
  return out;
}

/** The screenshot run's own summary lines: what its geometry examined, the floors it was held to, and its behaviour cases. */
export function screenshotLines(log: string): string[] {
  return log.split('\n').filter((l) => /^Geometry of \d+ drawings|^A CI run: held to|^Behaviour:|^Mutants:|^Raised the CI's own/.test(l));
}

/** The run's summary, in Markdown, as GitHub shows it on the run's page. */
export function ciSummary(counts: TestCounts | null, problems: string[], screenshots: string[] | null, allowed: readonly CiSkip[] = CI_SKIPS): string {
  const lines = ['## The full check on GitHub\'s Linux runner', ''];
  lines.push(counts ? `Tests: ${countsLine(counts)}.` : 'Tests: no summary in the log.', '');
  const skipped = counts?.skippedNames ?? [];
  if (skipped.length) {
    lines.push('Skipped here, and run on the Mac:', '');
    for (const n of skipped) lines.push(`- ${n}: ${allowed.find((s) => s.name === n)?.why ?? 'not on CI_SKIPS'}`);
    lines.push('');
  }
  if (screenshots) lines.push('## The screenshot run', '', ...(screenshots.length ? screenshots.map((l) => `- ${l}`) : ['- It printed no summary.']), '');
  lines.push(problems.length ? `**Failed:** ${problems.length} problem${problems.length === 1 ? '' : 's'}.` : '**Passed.**', '', ...problems.map((p) => `- ${p}`));
  return `${lines.join('\n')}\n`;
}

function main(argv: string[]): number {
  const [checkLog, shotLog] = argv;
  if (!checkLog) { console.error('Usage: node scripts/ci-run.ts <check log> [<screenshot log>]'); return 1; }
  const counts = existsSync(checkLog) ? readTestCounts(readFileSync(checkLog, 'utf8')) : null;
  const problems = skipProblems(counts);
  const shots = shotLog ? (existsSync(shotLog) ? screenshotLines(readFileSync(shotLog, 'utf8')) : []) : null;
  if (shots && !shots.some((l) => l.startsWith('Geometry of'))) problems.push('The screenshot run\'s log holds no geometry summary, so what it examined is unknown.');
  const summary = ciSummary(counts, problems, shots);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  return problems.length ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
