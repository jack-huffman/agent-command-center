/**
 * The smoke run of acc on a machine as a person has it (D-209), run by CI's Windows job after the build:
 *
 * - `acc doctor --part machine`, by name through the launchers the build put in dist/, as each shell finds
 *   them: through this machine's sh (inShell) everywhere, which finds the sh launcher, `acc`; on Windows
 *   also through cmd, which finds `acc.cmd`. It runs in a folder outside any project, so Setup's machine
 *   steps for every profile run, the Salesforce CLI's too. It must check every machine step Setup has
 *   (Check this machine, T-133), and each named step must pass: on Windows that includes Git for Windows' sh. A step for a tool the
 *   runner lacks, such as Claude Code, may fail: acc ran, found a runtime, and checked the machine.
 * - Each tool, run by acc's own runner (run), the way acc's checks run them: on Windows npm and sf are .cmd
 *   shims, which only the start helper can run. sf runs niced too, as a check runs it.
 *
 * It counts what it checked, and fails on any check that didn't pass, or on none.
 *
 *   node scripts/windows-smoke.ts [--sf]     --sf: the Salesforce CLI is installed, so its step and its runs count
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../packages/core/src/exec.ts';
import { STEPS } from '../packages/core/src/onboarding/steps.ts';
import { inShell } from '../packages/core/src/shell.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const LINE = 'acc doctor --part machine --json';

interface Step { id: string; status: string; detail?: string | null }

/** Why a doctor run's result isn't a run of acc that passed each named step, or null when it is. */
export function smokeProblem(code: number | null, stdout: string, stderr: string, needed: string[], count = machineStepCount()): string | null {
  // doctor exits 1 when a step fails; anything else is acc not running at all.
  if (code !== 0 && code !== 1) return `exited ${code}: ${stderr.trim() || stdout.trim() || 'with nothing said'}`;
  let steps: Step[];
  try {
    steps = JSON.parse(stdout) as Step[];
  } catch {
    return `printed no steps: ${stderr.trim() || stdout.trim().slice(0, 300) || 'nothing'}`;
  }
  if (!Array.isArray(steps) || !steps.length) return 'printed no steps';
  // Check this machine ran every machine step (T-133): outside a project, each profile's, skipped or not.
  if (steps.length !== count) return `checked ${steps.length} machine steps, not ${count}`;
  const failed = needed.map((id) => [id, steps.find((s) => s.id === id)] as const).filter(([, s]) => s?.status !== 'pass');
  return failed.length ? failed.map(([id, s]) => `${id} didn't pass: ${s ? `${s.status}, ${s.detail ?? ''}` : 'it wasn\'t there'}`).join('; ') : null;
}

/** How many machine steps acc doctor --part machine runs outside a project, where every profile's run (T-133). */
export const machineStepCount = (): number => STEPS.filter((s) => s.part === 'machine').length;

/** The tools acc's runner must run on this machine, as Setup's steps do. */
export const toolsFor = (sf: boolean): string[] => ['git', 'node', 'npm', 'gh', ...(sf ? ['sf'] : [])];

/**
 * The doctor steps that must pass: npm with Node, and on Windows Git for Windows' sh, which every command line
 * acc runs needs (T-133). winget isn't one: a runner image may lack App Installer.
 */
export const stepsFor = (sf: boolean, platform: NodeJS.Platform = process.platform): string[] =>
  ['A1.git', ...(platform === 'win32' ? ['A1.sh'] : []), 'A1.node', 'A1.npm', 'A1.gh', ...(sf ? ['A1.sf'] : [])];

if (resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const sf = process.argv.includes('--sf');
  const outside = mkdtempSync(join(tmpdir(), 'acc-smoke-'));
  const env = { ...process.env, PATH: `${join(ROOT, 'dist')}${delimiter}${process.env.PATH ?? ''}`, NO_COLOR: '1' };
  const results: [string, string | null][] = [];

  const ways: [string, string, string[]][] = [['sh', ...inShell(LINE)]];
  if (process.platform === 'win32') ways.push(['cmd', process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', LINE]]);
  for (const [shell, cmd, args] of ways) {
    const r = run(cmd, args, { cwd: outside, env, timeoutMs: 180_000 });
    results.push([`${LINE}, through ${shell}`, smokeProblem(r.code, r.stdout, r.stderr, stepsFor(sf))]);
    if (r.stdout.trim().startsWith('[')) for (const s of JSON.parse(r.stdout) as Step[]) console.log(`    ${s.status.padEnd(6)} ${s.id}${s.detail ? `: ${s.detail.split('\n')[0]}` : ''}`);
    console.log(`    ${machineStepCount()} machine steps expected, through ${shell}`);
  }

  for (const tool of toolsFor(sf)) {
    const r = run(tool, ['--version'], { cwd: outside, timeoutMs: 120_000 });
    results.push([`${tool} --version, by acc's runner`, r.code === 0 ? null : `exited ${r.code}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`]);
  }
  if (sf) {
    const r = run('sf', ['--version'], { cwd: outside, timeoutMs: 120_000, nice: true });
    results.push(['sf --version, by acc\'s runner at lowered priority', r.code === 0 ? null : `exited ${r.code}: ${(r.stderr || r.stdout).trim().split('\n')[0]}`]);
  }

  for (const [what, problem] of results) console.log(`${problem ? '✗' : '✓'} ${what}${problem ? `: ${problem}` : ''}`);
  const failed = results.filter(([, p]) => p).length;
  console.log(`${results.length - failed} of ${results.length} checks passed.`);
  process.exit(failed || !results.length ? 1 : 0);
}
