/**
 * What a test check ran (GH-100): the counts its runner reported, read from its output. node:test's spec
 * and TAP reporters, Jest, and Apex in a check-only deploy. Output acc can't read gives no counts, never a
 * guess: a check that ran nothing must not look like one that passed.
 */

/** run is the tests that ran to a result, passed or failed. Skipped and todo didn't, so they're apart. */
export interface TestCounts {
  run: number;
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  /** The tests the runner said it skipped, by name, where it says them. Absent when it doesn't. */
  skippedNames?: string[];
  /** Which runner's summary they came from: node:test, jest or apex, joined when there are several. */
  runner: string;
}

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const linesOf = (text: string): string[] => text.replace(ANSI, '').replace(/\r/g, '').split('\n');

/** node:test's summary keys, as its spec reporter prints them (ℹ tests 7) and its TAP reporter (# tests 7). */
const NODE_KEYS = ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo', 'duration_ms'];
const NODE_LINE = { spec: /^ℹ ([a-z_]+) (\d+(?:\.\d+)?)$/, tap: /^# ([a-z_]+) (\d+(?:\.\d+)?)$/ };

/**
 * Every complete node:test summary in the output: a run of unindented lines from `tests` on, holding at
 * least tests, pass, fail, skipped and todo. A line a test prints, such as `ℹ tests 99` on its own, is no
 * block; TAP prints a test's own output behind `# `, so it can't be one there either.
 */
function nodeBlocks(lines: string[]): Omit<TestCounts, 'skippedNames' | 'runner'>[] {
  const out: Omit<TestCounts, 'skippedNames' | 'runner'>[] = [];
  for (const re of Object.values(NODE_LINE)) {
    for (let i = 0; i < lines.length; i++) {
      if (re.exec(lines[i]!)?.[1] !== 'tests') continue;
      const block = new Map<string, number>();
      let j = i;
      for (; j < lines.length; j++) {
        const m = re.exec(lines[j]!);
        if (!m || !NODE_KEYS.includes(m[1]!) || block.has(m[1]!)) break;
        block.set(m[1]!, Number(m[2]));
      }
      i = j - 1;
      if (!['tests', 'pass', 'fail', 'skipped', 'todo'].every((k) => block.has(k))) continue;
      // node counts a cancelled test apart; it ran and didn't pass, so it's a failure here.
      const failed = block.get('fail')! + (block.get('cancelled') ?? 0);
      out.push({ run: block.get('pass')! + failed, passed: block.get('pass')!, failed, skipped: block.get('skipped')!, todo: block.get('todo')! });
    }
  }
  return out;
}

/** The tests node:test said it skipped: `﹣ name (1ms) # SKIP` in spec, `ok 3 - name # SKIP` in TAP. */
function nodeSkipped(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    const spec = /^\s*﹣ (.*?)(?: \(\d+(?:\.\d+)?ms\))? # .*$/.exec(l);
    if (spec) out.push(spec[1]!);
    const tap = /^\s*ok \d+ - (.*?) # SKIP\b/i.exec(l);
    if (tap) out.push(tap[1]!.replace(/\\#/g, '#').replace(/\\\\/g, '\\'));
  }
  return out;
}

/**
 * Every Jest summary: an unindented `Tests:` line straight after `Test Suites:`, which Jest always prints
 * together. A test's console output is indented under it, so a `Tests:` line a test prints isn't one. Jest
 * that finds no tests says `No tests found` instead.
 */
function jestBlocks(lines: string[]): Omit<TestCounts, 'skippedNames' | 'runner'>[] {
  const out: Omit<TestCounts, 'skippedNames' | 'runner'>[] = [];
  lines.forEach((l, i) => {
    if (/^No tests found\b/.test(l)) out.push({ run: 0, passed: 0, failed: 0, skipped: 0, todo: 0 });
    const m = /^Tests:\s+(.*)$/.exec(l);
    if (!m || !/^Test Suites:/.test(lines[i - 1] ?? '')) return;
    if (!/\d+ total\b/.test(m[1]!)) return;
    const n = (word: string) => Number(new RegExp(`(\\d+) ${word}\\b`).exec(m[1]!)?.[1] ?? 0);
    out.push({ run: n('passed') + n('failed'), passed: n('passed'), failed: n('failed'), skipped: n('skipped'), todo: n('todo') });
  });
  return out;
}

/** The tests Jest said it skipped, where it lists each (one test file, or --verbose): `○ skipped name`. */
const jestSkipped = (lines: string[]): string[] => lines.map((l) => /^\s+○ skipped (.+)$/.exec(l)?.[1]).filter((n): n is string => !!n);

const add = (a: Omit<TestCounts, 'skippedNames' | 'runner'>, b: Omit<TestCounts, 'skippedNames' | 'runner'>) => ({
  run: a.run + b.run, passed: a.passed + b.passed, failed: a.failed + b.failed, skipped: a.skipped + b.skipped, todo: a.todo + b.todo,
});

/**
 * The counts in a command's output, or null when it holds no summary acc can read. A command that runs its
 * tests in parts prints a summary for each, so every complete one counts, once. The skipped tests' names
 * come with them where the runner prints them.
 */
export function readTestCounts(stdout: string, stderr = ''): TestCounts | null {
  const lines = linesOf(`${stdout}\n${stderr}`);
  const found: { runner: string; blocks: Omit<TestCounts, 'skippedNames' | 'runner'>[]; names: string[] }[] = [
    { runner: 'node:test', blocks: nodeBlocks(lines), names: nodeSkipped(lines) },
    { runner: 'jest', blocks: jestBlocks(lines), names: jestSkipped(lines) },
  ].filter((f) => f.blocks.length);
  if (!found.length) return null;
  const total = found.flatMap((f) => f.blocks).reduce(add);
  const names = found.flatMap((f) => f.names);
  return { ...total, ...(names.length ? { skippedNames: names } : {}), runner: found.map((f) => f.runner).join(', ') };
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v) : null);

/**
 * Apex's counts from a deploy's result (`sf project deploy start --json`): its runTestResult's numTestsRun
 * and numFailures, which the Metadata API gives as strings. Apex has no skip or todo. Null when it ran none
 * by request (NoTestRun) or the result doesn't say.
 */
export function apexCounts(result: { numberTestsTotal?: unknown; numberTestErrors?: unknown; details?: { runTestResult?: { numTestsRun?: unknown; numFailures?: unknown } } } | undefined): TestCounts | null {
  const rtr = result?.details?.runTestResult;
  const run = num(rtr?.numTestsRun) ?? num(result?.numberTestsTotal);
  const failed = num(rtr?.numFailures) ?? num(result?.numberTestErrors);
  if (run === null || failed === null) return null;
  return { run, passed: Math.max(run - failed, 0), failed, skipped: 0, todo: 0, runner: 'apex' };
}

/** What a test check whose output holds no summary acc can read says, rather than guess. */
export const NO_COUNTS = 'No test summary acc can read in its output, so it can\'t say how many tests ran.';

/** The counts in a few words: "312 run, 2 skipped", with failed and todo only when there are some. */
export function countsLine(c: Pick<TestCounts, 'run' | 'failed' | 'skipped' | 'todo'>): string {
  return [`${c.run} run`, ...(c.failed ? [`${c.failed} failed`] : []), `${c.skipped} skipped`, ...(c.todo ? [`${c.todo} todo`] : [])].join(', ');
}

/** What a check's tests ran, for a table or a list: its counts, "not read" where acc couldn't tell, or nothing for a check that runs none. */
export const testsText = (r: { counts?: TestCounts; countsNote?: string }): string => (r.counts ? countsLine(r.counts) : r.countsNote === NO_COUNTS ? 'not read' : '');

/**
 * The tests skipped now that weren't before, by name, where both say: a name skipped twice now and once
 * before is new once. Empty when either doesn't name them, unless the earlier one skipped none.
 */
export function newlySkipped(now: Pick<TestCounts, 'skippedNames'>, before: Pick<TestCounts, 'skipped' | 'skippedNames'>): string[] {
  const was = before.skippedNames ?? (before.skipped === 0 ? [] : null);
  if (!now.skippedNames || !was) return [];
  const left = new Map<string, number>();
  for (const n of was) left.set(n, (left.get(n) ?? 0) + 1);
  return now.skippedNames.filter((n) => {
    const k = left.get(n) ?? 0;
    if (k) left.set(n, k - 1);
    return !k;
  });
}
