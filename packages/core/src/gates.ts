/**
 * Gates: named checks whose results are kept as receipts tied to a commit (DESIGN section 9, D-024).
 * A builder runs them with `acc gate run`; `acc done` accepts the task once every required gate has
 * passed, or didn't apply, on the branch's latest commit. Gates check. They never deploy (D-011).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { type Config, type Environment, requiredGates } from './config.ts';
import { AccError, parseJsonOutput, type RunResult, type Runner, sfEnv } from './exec.ts';
import type { Ledger, Task } from './ledger.ts';
import type { RepoPaths } from './paths.ts';
import { carriesOver, FLOORS_FILE, floorsAt, judgeRatchet, type RatchetFloors, ratchetGate, readFloors, readRelaxed, withRaises, writeFloors } from './ratchets.ts';
import { type GateStatus, ratchetOf, readReceipt, type Receipt, receiptsAt, writeReceipt } from './receipts.ts';
import { type SlotOptions, withSlot } from './semaphore.ts';

export interface Changes {
  /** The commit the branch grew from: its merge base with the environment's branch. */
  base: string;
  /** Files added or changed since then, minus environment-specific ones. */
  files: string[];
  /** Files deleted since then. A rename counts as a deletion. */
  deleted: string[];
  /** Environment-specific files the branch touched, which a task must never do (D-016). */
  envSpecific: string[];
}

/** An Apex test class a builder names for validate, with why it covers the change. */
export interface ApexTest {
  name: string;
  reason: string;
}

export interface GateInput {
  root: string;
  config: Config;
  env: Environment;
  changes: Changes;
  tests: ApexTest[];
  /** A folder for files a gate writes, such as Code Analyzer's results. */
  scratch: string;
  /** The tests near what the branch changed (nearTests), worked out when a gate asks. */
  near: () => string[];
  /** What a ratchet is held to (GH-99), read when one asks: the floors here and where the branch began, or why they couldn't be. */
  floors?: () => RatchetFloors | { problem: string };
}

export interface Outcome {
  status: GateStatus;
  summary: string;
  details?: Record<string, unknown>;
}

/** What a gate will do: decide without running anything, or run a command and read its result. */
export type Plan = { outcome: Outcome } | { cmd: string; args: string[]; read?: (r: RunResult) => Outcome; env?: Record<string, string> };

export interface Gate {
  name: string;
  heavy: boolean;
  /** What it checks, in a few words, for `acc gate list`. */
  about: string;
  plan(input: GateInput): Plan;
}

const pass = (summary: string, details?: Record<string, unknown>): Outcome => ({ status: 'pass', summary, details });
const fail = (summary: string, details?: Record<string, unknown>): Outcome => ({ status: 'fail', summary, details });
const error = (summary: string): Outcome => ({ status: 'error', summary });
const skip = (summary: string): Outcome => ({ status: 'skip', summary });
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;
const listOf = (items: string[], max = 3): string => items.slice(0, max).join(', ') + (items.length > max ? ` and ${items.length - max} more` : '');

/** The last line of output that says something, as a one-line summary. */
export function lastLine(text: string): string {
  const lines = text.replace(/\x1b\[[0-9;]*m/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  const line = lines.at(-1) ?? '';
  return line.length > 200 ? `${line.slice(0, 197)}…` : line;
}

/** A command as you'd type it, so a logged line can be pasted back into a shell. */
export const shellLine = (cmd: string, args: string[]): string => [cmd, ...args].map((a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(' ');

const exitRead = (r: RunResult): Outcome => (r.code === 0 ? pass('Passed.') : r.code === 127 ? error(lastLine(r.stderr) || 'The command wasn\'t found.') : fail(lastLine(r.stdout + '\n' + r.stderr) || `Exited with ${r.code}.`));

// ---------------------------------------------------------------- the gates

/**
 * The environment a check runs in: acc's own, without a builder's identity, so a check gives the same
 * answer inside a builder as outside one (D-044). GH-13's builder found tests that ran acc, saw its
 * ACC_TASK and failed. A heavy check's own heavy work is part of it: it gets a slot folder of its own,
 * so it never waits for the slot its check holds. GH-12's check did, until it was stopped. What a branch
 * changed and the tests near it come from this run only, never from a check running acc's own tests.
 */
export function checkEnv(env: NodeJS.ProcessEnv = process.env, heavyDir?: string): NodeJS.ProcessEnv {
  const { ACC_ROLE: _role, ACC_TASK: _task, ACC_CHANGED: _changed, ACC_NEAR_TESTS: _near, ...rest } = env;
  return heavyDir ? { ...rest, ACC_HEAVY_DIR: heavyDir } : rest;
}

/**
 * A gate from `gates.commands`, run by the shell in the checkout. It's told what the branch changed, and the
 * tests near those changes, one path a line (GH-73): `ACC_CHANGED` and `ACC_NEAR_TESTS`, so a builder's
 * lighter check can run only those. Every command gate is told both (GH-117): acc can't tell whether
 * `npm run test:near` reads the list, and a script given none would run nothing and pass. The list is
 * worked out once a run, reading each file once.
 */
function commandGate(name: string, command: string, heavy: boolean): Gate {
  return {
    name, heavy, about: command,
    plan: ({ changes, near }) => ({
      cmd: 'sh', args: ['-c', command], read: exitRead,
      env: { ACC_CHANGED: changes.files.join('\n'), ACC_NEAR_TESTS: near().join('\n') },
    }),
  };
}

// ---------------------------------------------------------------- the tests near a change (GH-73)

/** A test file, by the usual names: foo.test.ts, foo.spec.js, foo_test.go, test_foo.py. */
const TEST_FILE = /(^|\/)(test_[^/]+\.\w+|[^/]+[._](test|spec)\.\w+)$/;
const isTest = (path: string): boolean => TEST_FILE.test(path);

/**
 * The folder a source file's package starts in: up to its src, lib or app folder, else the nearest folder
 * above it with a package.json (extension/webview/main.ts is extension's), else its own folder.
 */
function packageOf(path: string, tracked: Set<string>): string {
  const parts = path.split('/');
  const at = parts.findIndex((p, i) => i < parts.length - 1 && ['src', 'lib', 'app'].includes(p));
  if (at >= 0) return parts.slice(0, at).join('/');
  for (let n = parts.length - 1; n >= 0; n--) if (tracked.has([...parts.slice(0, n), 'package.json'].join('/'))) return parts.slice(0, n).join('/');
  return parts.slice(0, -1).join('/');
}

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Code an import can name. The folder rule (GH-95) only follows these. */
const CODE = /\.[cm]?[jt]sx?$/;
const withoutExt = (path: string): string => path.replace(CODE, '');

/**
 * The tests near what a branch changed (GH-73): the test files it changed, and, for each other file it
 * changed, the tests in the same package named for it (merge.ts → merge.test.ts, test_merge.py) or that
 * import it by name.
 *
 * A file a folder's index gathers is also near the tests of that index and of what loads it (GH-95), as
 * the tests that run packages/cli/src/main.ts test every module in its commands/ folder. An index is a
 * file that imports the changed file and most of the other code in its folder; what loads it is any other
 * code in the package that imports it by its path. An index named index has as its own tests those named
 * for it or that load it by its path or its folder's (GH-117), not any that quotes a path ending in index.
 *
 * `tracked` is every file in the checkout; `read` gives a file's text, and is asked once a file. Paths
 * are the repo's, sorted, each once.
 */
export function nearTests(changed: string[], tracked: string[], read: (path: string) => string | null): string[] {
  const files = new Set(tracked);
  const texts = new Map<string, string>();
  const text = (f: string): string => {
    if (!texts.has(f)) texts.set(f, read(f) ?? '');
    return texts.get(f)!;
  };
  // The paths a file names relative to itself, without their extension: './commands/index.ts', '../src/main.ts'.
  const relative = new Map<string, Set<string>>();
  const pathsIn = (f: string): Set<string> => {
    if (!relative.has(f)) relative.set(f, new Set([...text(f).matchAll(/['"`](\.\.?\/[^'"`\n]*)['"`]/g)].map((m) => withoutExt(posix.join(posix.dirname(f), m[1]!)))));
    return relative.get(f)!;
  };
  const tests = tracked.filter(isTest);
  const code = tracked.filter((f) => CODE.test(f) && !isTest(f));
  const folderOf = (f: string): string => posix.dirname(f);
  // A file imports an index by its path, or by its folder's when it's named index: './commands'.
  const importsIndex = (f: string, index: string): boolean => pathsIn(f).has(withoutExt(index)) || (/^index\./.test(posix.basename(index)) && pathsIn(f).has(folderOf(index)));

  /** The tests in a file's package named for it, or that `loads` says load it: by default, any importing it by name. */
  const nearOne = (f: string, loads?: (t: string) => boolean): string[] => {
    const base = f.split('/').at(-1)!;
    const stem = base.replace(/\.[^.]+$/, '');
    if (!stem || stem === base) return [];
    const pkg = packageOf(f, files);
    const named = new RegExp(`(^|/)(${escape(stem)}[._](test|spec)\\.\\w+|test_${escape(stem)}\\.\\w+)$`);
    // An import or require that names the file: '../src/merge.ts', './merge', "pkg/merge.js".
    const imports = new RegExp(`['"\`][^'"\`\\n]*\\/${escape(stem)}(\\.[cm]?[jt]sx?)?['"\`]`);
    return tests.filter((t) => (!pkg || t.startsWith(`${pkg}/`)) && (named.test(t) || (loads ? loads(t) : imports.test(text(t)))));
  };
  // A file named index is named for its folder, and many folders have one, so its tests are those that load it
  // by its path or its folder's (GH-117): a test that quotes 'packages/cli/src/commands/index.ts' isn't near
  // every module core's index gathers. Any other index's name is its own, and its tests may load its build
  // instead, as activate.test.ts loads dist/extension.js, so they're found by name.
  const nearIndex = (index: string): string[] => (/^index\./.test(posix.basename(index)) ? nearOne(index, (t) => importsIndex(t, index)) : nearOne(index));

  /** The indexes that gather a file: code in its folder that imports it and more than half the rest. */
  const indexesOf = (f: string): string[] => {
    if (!CODE.test(f)) return [];
    const folder = code.filter((c) => folderOf(c) === folderOf(f));
    return folder.filter((i) => {
      if (i === f || !pathsIn(i).has(withoutExt(f))) return false;
      const others = folder.filter((c) => c !== i);
      const gathered = others.filter((c) => pathsIn(i).has(withoutExt(c))).length;
      return gathered >= 2 && gathered * 2 > others.length;
    });
  };

  const out = new Set(changed.filter((f) => isTest(f) && files.has(f)));
  for (const f of changed.filter((x) => !isTest(x))) {
    for (const t of nearOne(f)) out.add(t);
    const pkg = packageOf(f, files);
    for (const index of indexesOf(f)) {
      const loaders = code.filter((c) => c !== index && (!pkg || c.startsWith(`${pkg}/`)) && importsIndex(c, index));
      for (const t of [...nearIndex(index), ...loaders.flatMap((g) => nearOne(g))]) out.add(t);
    }
  }
  return [...out].sort();
}

/** The repo's own copy of a Node tool. Worktrees share the main checkout's node_modules (dispatch links it). */
const nodeBin = (root: string, name: string): string => join(root, 'node_modules', '.bin', name);
const missingTool = (root: string, name: string): Outcome => error(`${name} isn't installed in this repo. Run npm install in the main checkout, then try again.`);

/** Salesforce source folders, from sfdx-project.json. */
export function packageDirs(root: string): string[] {
  try {
    const p = JSON.parse(readFileSync(join(root, 'sfdx-project.json'), 'utf8')) as { packageDirectories?: { path?: string }[] };
    const dirs = (p.packageDirectories ?? []).map((d) => d.path?.replace(/\/+$/, '')).filter((d): d is string => !!d);
    return dirs.length ? dirs : ['force-app'];
  } catch {
    return ['force-app'];
  }
}
export const under = (files: string[], dirs: string[]): string[] => files.filter((f) => dirs.some((d) => f === d || f.startsWith(`${d}/`)));

/** Code people write: Apex, and LWC's JavaScript, HTML and CSS. Metadata XML is Salesforce's to lay out (D-025). */
const FORMATTED = /(\.(cls|trigger)$)|((^|\/)lwc\/.+\.(js|html|css)$)/;
const COMPONENT_JS = /(^|\/)(lwc|aura)\/.+\.js$/;
const LWC = /(^|\/)lwc\//;
const APEX = /\.(cls|trigger)(-meta\.xml)?$/;

const format: Gate = {
  name: 'format', heavy: false, about: 'prettier --check on changed Apex and LWC code',
  plan({ root, changes }) {
    const files = changes.files.filter((f) => FORMATTED.test(f));
    if (!files.length) return { outcome: skip('No Apex or LWC code has changed.') };
    const bin = nodeBin(root, 'prettier');
    if (!existsSync(bin)) return { outcome: missingTool(root, 'prettier') };
    return {
      cmd: bin, args: ['--check', ...files],
      read(r) {
        if (r.code === 0) return pass(`${plural(files.length, 'changed file')} formatted.`);
        const bad = (r.stdout + '\n' + r.stderr).split('\n').map((l) => /^\[warn\] (.+)$/.exec(l.trim())?.[1]).filter((f): f is string => !!f && files.includes(f));
        if (r.code === 1 && bad.length) return fail(`${plural(bad.length, 'file')} need formatting: ${listOf(bad)}. Fix with: npx prettier --write ${bad.join(' ')}`);
        return error(lastLine(r.stderr || r.stdout) || `prettier exited with ${r.code}.`);
      },
    };
  },
};

const lint: Gate = {
  name: 'lint', heavy: false, about: 'ESLint on changed LWC and Aura JavaScript',
  plan({ root, changes }) {
    const files = changes.files.filter((f) => COMPONENT_JS.test(f));
    if (!files.length) return { outcome: skip('No LWC or Aura JavaScript has changed.') };
    const bin = nodeBin(root, 'eslint');
    if (!existsSync(bin)) return { outcome: missingTool(root, 'eslint') };
    return {
      cmd: bin, args: files,
      read: (r) => (r.code === 0 ? pass(`${plural(files.length, 'file')} lint clean.`) : r.code === 1 ? fail(lastLine(r.stdout) || 'ESLint found problems.') : error(lastLine(r.stderr || r.stdout))),
    };
  },
};

const lwcTests: Gate = {
  name: 'lwc-tests', heavy: true, about: 'Jest tests related to changed LWC',
  plan({ root, changes }) {
    const files = changes.files.filter((f) => LWC.test(f));
    if (!files.length) return { outcome: skip('No LWC has changed.') };
    const bin = nodeBin(root, 'sfdx-lwc-jest');
    if (!existsSync(bin)) return { outcome: missingTool(root, 'sfdx-lwc-jest') };
    return {
      cmd: bin, args: ['--', '--findRelatedTests', ...files, '--passWithNoTests'],
      read: (r) => (r.code === 0 ? pass(lastLine(r.stderr.split('\n').filter((l) => /^Tests:/.test(l.trim())).join('\n')) || 'Related tests passed.') : fail(lastLine(r.stderr.split('\n').filter((l) => /^Tests:/.test(l.trim())).join('\n')) || 'Related tests failed.')),
    };
  },
};

interface AnalyzerViolation { rule?: string; severity?: number; message?: string; locations?: { file?: string; startLine?: number }[]; primaryLocationIndex?: number }

/** Reads Code Analyzer's results file: the violations at the failing severity or worse. */
export function readAnalyzer(file: string, severity: number, root: string): { worst: string[]; total: number } | null {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as { violations?: AnalyzerViolation[] };
    const all = j.violations ?? [];
    const worst = all.filter((v) => (v.severity ?? 5) <= severity).map((v) => {
      const at = v.locations?.[v.primaryLocationIndex ?? 0];
      const where = at?.file ? `${at.file.startsWith(root) ? at.file.slice(root.length + 1) : at.file}${at.startLine ? `:${at.startLine}` : ''}` : '';
      return `${where} ${v.rule ?? 'rule'} (sev ${v.severity}): ${(v.message ?? '').trim()}`.trim();
    });
    return { worst, total: all.length };
  } catch {
    return null;
  }
}

const staticGate: Gate = {
  name: 'static', heavy: true, about: 'Salesforce Code Analyzer on changed source',
  plan({ root, config, changes, scratch }) {
    const files = under(changes.files, packageDirs(root));
    if (!files.length) return { outcome: skip('No Salesforce source has changed.') };
    const severity = config.gates.severity;
    const results = join(scratch, 'code-analyzer.json');
    return {
      cmd: 'sf',
      args: ['code-analyzer', 'run', '--workspace', '.', ...files.flatMap((f) => ['--target', f]), '--severity-threshold', String(severity), '--view', 'table', '--output-file', results],
      read(r) {
        const found = readAnalyzer(results, severity, root);
        if (!found) return error(lastLine(r.stderr || r.stdout) || `Code Analyzer exited with ${r.code} and wrote no results.`);
        if (found.worst.length) return fail(`${plural(found.worst.length, 'violation')} at severity ${severity} or worse: ${listOf(found.worst, 2)}`, { violations: found.worst });
        if (r.code !== 0) return error(lastLine(r.stderr || r.stdout) || `Code Analyzer exited with ${r.code}.`);
        return pass(`No violations at severity ${severity} or worse${found.total ? ` (${plural(found.total, 'milder one')})` : ''}.`);
      },
    };
  },
};

/**
 * The command validate runs: a check-only deploy (D-024). `deploy validate` won't take NoTestRun, so
 * this is `deploy start --dry-run`, which saves nothing. The runner refuses it without --dry-run.
 */
export function validateArgs(org: string, source: string[], tests: ApexTest[]): string[] {
  return [
    'project', 'deploy', 'start', '--dry-run', '--target-org', org, '--wait', '60', '--ignore-conflicts', '--json',
    ...source.flatMap((f) => ['--source-dir', f]),
    '--test-level', tests.length ? 'RunSpecifiedTests' : 'NoTestRun',
    ...tests.flatMap((t) => ['--tests', t.name]),
  ];
}

const asList = <T>(x: T | T[] | undefined | null): T[] => (x == null ? [] : Array.isArray(x) ? x : [x]);

interface DeployResult {
  id?: string; success?: boolean; status?: string; numberComponentsTotal?: number; numberTestsCompleted?: number;
  details?: { componentFailures?: unknown; runTestResult?: { failures?: unknown } };
}

/** Reads `sf project deploy start --json`, which reports on stdout whether or not the deploy worked. */
export function readDeploy(r: RunResult, org: string, tests: ApexTest[], sourceCount: number): Outcome {
  let j: { status?: number; message?: string; result?: DeployResult; data?: DeployResult };
  try {
    j = parseJsonOutput(r.stdout);
  } catch {
    return error(lastLine(r.stderr || r.stdout) || `sf exited with ${r.code} and printed no JSON.`);
  }
  const res = j.result ?? j.data;
  if (!res?.id) return error(j.message?.trim() || lastLine(r.stderr) || 'sf returned no deploy result.');
  const details = { jobId: res.id, org, testLevel: tests.length ? 'RunSpecifiedTests' : 'NoTestRun', tests };
  const n = res.numberComponentsTotal ?? sourceCount;
  if (res.success) {
    const ran = tests.length ? `, ${plural(res.numberTestsCompleted ?? 0, 'test')} passed` : '';
    return pass(`Validated ${plural(n, 'component')} against ${org}${ran}. Nothing was saved (job ${res.id}).`, details);
  }
  const problems = [
    ...asList(res.details?.componentFailures as { fileName?: string; fullName?: string; lineNumber?: number; problem?: string }[]).map((f) => `${f.fileName ?? f.fullName ?? '?'}${f.lineNumber ? `:${f.lineNumber}` : ''}: ${f.problem ?? 'failed'}`),
    ...asList(res.details?.runTestResult?.failures as { name?: string; methodName?: string; message?: string }[]).map((f) => `${f.name}.${f.methodName}: ${f.message}`),
  ];
  return fail(problems.length ? `${plural(problems.length, 'problem')}: ${listOf(problems, 2)}` : (j.message?.trim() || `The validation ${res.status ?? 'failed'}.`), { ...details, problems });
}

const validate: Gate = {
  name: 'validate', heavy: true, about: 'a check-only deploy of changed source to the environment\'s org',
  plan({ root, env, changes, tests }) {
    if (!env.org) return { outcome: error(`${env.name} has no org alias in .acc/config.json.`) };
    if (env.protected) return { outcome: error(`${env.name} is protected. Tasks are checked against their own environment, never a protected one.`) };
    if (changes.envSpecific.length) {
      return { outcome: fail(`This branch changes environment-specific files, which differ by design in every org and are never part of a task (D-016): ${listOf(changes.envSpecific)}. Undo those changes.`) };
    }
    if (changes.deleted.length) {
      return { outcome: fail(`Deletions (and renames) go to a person for now: ${listOf(changes.deleted)}. Restore them, or block the task and say what should be deleted.`) };
    }
    const source = under(changes.files, packageDirs(root));
    if (!source.length) return { outcome: skip('No Salesforce source has changed.') };
    const apex = source.filter((f) => APEX.test(f));
    if (apex.length && !tests.length) {
      return { outcome: fail(`Apex changed (${listOf(apex)}). Name the test classes that cover it: acc gate run validate --test <TestClass>="<why it covers the change>"`) };
    }
    return { cmd: 'sf', args: validateArgs(env.org, source, tests), read: (r) => readDeploy(r, env.org!, tests, source.length) };
  },
};

const SALESFORCE_GATES = [format, lint, staticGate, lwcTests, validate];

/**
 * The project's gates: the profile's built-ins, then `gates.commands`, which can replace a built-in by name,
 * then `gates.ratchets` (GH-99), whose names are their own.
 */
export function gatesFor(config: Config): Gate[] {
  const heavy = (name: string) => config.gates.heavy.includes(name);
  const builtIn = config.profile === 'salesforce' ? SALESFORCE_GATES.map((g) => ({ ...g, heavy: heavy(g.name) })) : [];
  const custom = Object.entries(config.gates.commands).map(([name, cmd]) => commandGate(name, cmd, heavy(name)));
  const ratchets = Object.entries(config.gates.ratchets ?? {}).map(([name, spec]) => ratchetGate(name, spec, heavy(name)));
  return [...builtIn.filter((g) => !config.gates.commands[g.name]), ...custom, ...ratchets];
}

/**
 * The tests a commit's checks named, so a commit made from it, such as a refresh's merge (D-058), is
 * checked with the same. On Salesforce, the Apex tests its validate ran (D-003); other profiles name none.
 */
export function priorTests(paths: RepoPaths, config: Pick<Config, 'profile'>, sha: string): ApexTest[] {
  if (config.profile !== 'salesforce') return [];
  const tests = readReceipt(paths, sha, 'validate')?.details?.tests;
  return Array.isArray(tests) ? tests.filter((t): t is ApexTest => typeof t?.name === 'string' && typeof t?.reason === 'string') : [];
}

// ---------------------------------------------------------------- what changed

/** Paths listed in an environment-specific or known-drift file: one per line, `#` for comments. */
export function readList(root: string, rel: string | null): string[] {
  if (!rel) return [];
  try {
    return readFileSync(join(root, rel), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  } catch {
    return [];
  }
}

/** Whether a path is a listed one, or inside a listed folder. */
export const listed = (path: string, list: string[]): boolean => list.some((p) => path === p || path.startsWith(`${p.replace(/\/+$/, '')}/`));

const git = (run: Runner, root: string, args: string[]): RunResult => run('git', args, { cwd: root });

/**
 * The merge base of `head` with the environment's branch: the remote copy if there is one, else the local
 * branch. `head` is the checkout's own HEAD, or another task's branch (D-093).
 */
export function baseFor(run: Runner, root: string, env: Pick<Environment, 'branch'>, head = 'HEAD'): string {
  for (const ref of [`origin/${env.branch}`, env.branch]) {
    if (git(run, root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).code !== 0) continue;
    const mb = git(run, root, ['merge-base', head, ref]);
    if (mb.code === 0 && mb.stdout.trim()) return mb.stdout.trim();
  }
  throw new AccError('no-base', `There's no ${env.branch} or origin/${env.branch} branch here to compare with.`);
}

/**
 * Each path changed since `base`, with its status: up to `head`, or without one, in the working tree of
 * `cwd`, committed or not. A rename is its old path deleted and its new one added, so both count.
 */
export function changedPaths(run: Runner, cwd: string, base: string, head?: string): { status: string; path: string }[] {
  const r = git(run, cwd, ['diff', '--name-status', '--no-renames', '-z', base, ...(head ? [head] : [])]);
  if (r.code !== 0) throw new AccError('git', `git diff failed: ${lastLine(r.stderr)}`);
  const parts = r.stdout.split('\0').filter(Boolean);
  const out: { status: string; path: string }[] = [];
  for (let i = 0; i + 1 < parts.length; i += 2) out.push({ status: parts[i]!, path: parts[i + 1]! });
  return out;
}

/** Committed changes since the branch left its environment's branch (D-024). */
export function changesFor(run: Runner, root: string, config: Config, env: Environment): Changes {
  const base = baseFor(run, root, env);
  const specific = readList(root, config.environmentSpecific);
  const files: string[] = [];
  const deleted: string[] = [];
  const envSpecific: string[] = [];
  for (const { status, path } of changedPaths(run, root, base, 'HEAD')) {
    if (listed(path, specific)) envSpecific.push(path);
    else if (status.startsWith('D')) deleted.push(path);
    else files.push(path);
  }
  return { base, files, deleted, envSpecific };
}

// ---------------------------------------------------------------- what to check against

/**
 * The environment a checkout is checked against: the named one, else the task's (by id, or by the
 * branch it's on), else the environment whose branch is checked out, else the only one there is.
 */
export function gateTarget(config: Config, ledger: Ledger, branch: string | null, opts: { env?: string; task?: string }): { env: Environment; task: Task | null } {
  const byName = (name: string) => config.environments.find((e) => e.branch === name.toLowerCase() || e.name.toLowerCase() === name.toLowerCase());
  const taskById = opts.task ? ledger.tasks.find((t) => t.id === opts.task!.toUpperCase()) : undefined;
  if (opts.task && !taskById) throw new AccError('no-task', `No task ${opts.task}.`);
  const task = taskById ?? (branch ? ledger.tasks.find((t) => t.run?.branch === branch) : undefined) ?? null;
  if (opts.env) {
    const env = byName(opts.env);
    if (!env) throw new AccError('usage', `No environment "${opts.env}". The config has: ${config.environments.map((e) => e.branch).join(', ')}.`);
    return { env, task };
  }
  const env = (task && byName(task.environment)) || (branch && byName(branch)) || (config.environments.length === 1 ? config.environments[0] : undefined);
  if (!env) throw new AccError('usage', `This branch${branch ? ` (${branch})` : ''} isn't a task's or an environment's. Name the environment to check against: --env <${config.environments.map((e) => e.branch).join('|')}>`);
  return { env, task };
}

// ---------------------------------------------------------------- running them

export interface GateResult extends Outcome {
  gate: string;
  /** Whether a receipt was written. Not with uncommitted changes, since it couldn't name what it checked. */
  recorded: boolean;
  receipt: Receipt;
}

export interface GateRunDeps {
  run: Runner;
  now: () => Date;
  slots?: SlotOptions;
  /** The task the checks are for, named on the heavy-check slot each heavy gate holds or waits for (D-092). */
  task?: string;
  /** Told before each gate starts, and when a heavy gate has to wait for the machine's slot. */
  onStart?: (gate: Gate) => void;
  onWait?: (gate: Gate) => void;
  /**
   * Whether a ratchet that beats its floor writes the new floor in this checkout (GH-99): only acc gate run,
   * in a task's own worktree on its branch, and then only with nothing uncommitted. Never a refresh's or
   * the merge queue's check, whose worktree must stay clean.
   */
  raise?: boolean;
}

export interface GateRun {
  sha: string;
  env: Environment;
  dirty: boolean;
  changes: Changes | null;
  results: GateResult[];
  /** The floors this run wrote in `.acc/floors.json`, for the builder to commit (GH-99). */
  raised: { gate: string; label: string; from: number | null; to: number }[];
}

/** A deploy that isn't check-only never runs from a gate (D-011, D-024). */
export function assertCheckOnly(cmd: string, args: string[]): void {
  const i = args.indexOf('deploy');
  if (/(^|\/)sf$/.test(cmd) && i >= 0 && args[i + 1] !== 'validate' && !args.includes('--dry-run')) {
    throw new AccError('refused', `A gate tried to run a real deploy (${[cmd, ...args.slice(0, 4)].join(' ')} …). Gates only validate.`);
  }
}

/** Every gate runs under nice, so checks don't make the machine stutter. */
export const niced = (cmd: string, args: string[]): [string, string[]] => (process.platform === 'win32' ? [cmd, args] : ['nice', ['-n', '15', cmd, ...args]]);

/**
 * Runs gates in a checkout and records a receipt for each on its current commit. With no names it
 * runs the required gates, a builder's where the merge queue runs the full ones (GH-73), or every gate
 * when none is required.
 */
export function runGates(paths: RepoPaths, config: Config, env: Environment, names: string[], tests: ApexTest[], deps: GateRunDeps): GateRun {
  const root = paths.root;
  const all = gatesFor(config);
  const required = requiredGates(config, env.branch, 'builder');
  const wanted = names.length ? names : required.length ? required : all.map((g) => g.name);
  const unknownNames = wanted.filter((n) => !all.some((g) => g.name === n));
  if (unknownNames.length) {
    const known = all.map((g) => g.name).join(', ') || 'none yet';
    throw new AccError('usage', `No gate ${unknownNames.join(', ')}. This project's gates: ${known}.${config.profile === 'generic' ? ' Add commands under "gates.commands" in .acc/config.json.' : ''}`);
  }
  const head = git(deps.run, root, ['rev-parse', 'HEAD']);
  if (head.code !== 0) throw new AccError('git', 'This checkout has no commit to check yet.');
  const sha = head.stdout.trim();
  const dirty = git(deps.run, root, ['status', '--porcelain']).stdout.trim() !== '';
  let changes: Changes | null = null;
  try {
    changes = changesFor(deps.run, root, config, env);
  } catch (e) {
    if (config.profile === 'salesforce') throw e;
  }
  let near: string[] | null = null;
  const input: GateInput = {
    root, config, env, tests,
    changes: changes ?? { base: sha, files: [], deleted: [], envSpecific: [] },
    scratch: join(paths.logs, 'gates', sha),
    near: () => (near ??= nearTests(input.changes.files, git(deps.run, root, ['ls-files', '-z']).stdout.split('\0').filter(Boolean), (f) => {
      try {
        return readFileSync(join(root, f), 'utf8');
      } catch {
        return null;
      }
    })),
  };
  // What a ratchet is held to (GH-99): this commit's floors, the environment's where the branch began, and
  // the ones people relaxed. A better number is written as the new floor only where the caller allows it.
  let floors: RatchetFloors | { problem: string } | null = null;
  input.floors = () => (floors ??= (() => {
    try {
      return { head: floorsAt(deps.run, root, sha), base: floorsAt(deps.run, root, input.changes.base), relaxed: readRelaxed(paths.relaxed), raise: !!deps.raise && !dirty };
    } catch (e) {
      return { problem: (e as Error).message };
    }
  })());
  mkdirSync(input.scratch, { recursive: true });
  const carryFrom = carriedFrom(paths, config, deps.run, sha);

  const results: GateResult[] = [];
  for (const name of wanted) {
    const gate = all.find((g) => g.name === name)!;
    // A person waived it on this commit (D-031): that stands until there's a new commit.
    const kept = readReceipt(paths, sha, gate.name);
    if (kept?.waived) {
      results.push({ status: 'skip', summary: kept.summary, gate: gate.name, recorded: true, receipt: kept });
      continue;
    }
    // This commit only records the floors acc raised on the one before, which measured them (GH-99).
    const carried = carryFrom ? carryReceipt(paths, config, input, gate.name, carryFrom, sha) : null;
    if (carried) {
      if (!dirty) writeReceipt(paths, carried);
      results.push({ status: carried.status, summary: carried.summary, ...(carried.details ? { details: carried.details } : {}), gate: gate.name, recorded: !dirty, receipt: carried });
      continue;
    }
    deps.onStart?.(gate);
    const started = deps.now();
    const plan = gate.plan(input);
    let outcome: Outcome;
    let command: string | null = null;
    let log: string | null = null;
    if ('outcome' in plan) {
      outcome = plan.outcome;
    } else {
      assertCheckOnly(plan.cmd, plan.args);
      command = shellLine(plan.cmd, plan.args);
      const [cmd, args] = niced(plan.cmd, plan.args);
      // sf gets a plain environment, so its --json output stays parseable whatever shell ran acc.
      const exec = () => deps.run(cmd, args, { cwd: root, timeoutMs: (gate.heavy ? 90 : 20) * 60_000, env: plan.cmd === 'sf' ? sfEnv() : { ...checkEnv(process.env, gate.heavy ? join(input.scratch, 'heavy') : undefined), ...plan.env } });
      // The slot says what it's for: the Command Center shows which task each heavy check runs for (D-092).
      const owner = { what: gate.name, ...(deps.task ? { task: deps.task } : {}), project: config.project, cwd: root };
      const r = gate.heavy ? withSlot(exec, { owner, ...deps.slots, onWait: () => deps.onWait?.(gate) }) : exec();
      log = join(input.scratch, `${gate.name}.log`);
      writeFileSync(log, `$ ${command}\n# exit ${r.code}\n\n${r.stdout}${r.stderr ? `\n--- stderr ---\n${r.stderr}` : ''}`);
      outcome = (plan.read ?? exitRead)(r);
    }
    const finished = deps.now();
    const receipt: Receipt = {
      gate: gate.name, sha, env: env.branch, status: outcome.status,
      startedAt: started.toISOString(), finishedAt: finished.toISOString(), durationMs: finished.getTime() - started.getTime(),
      summary: outcome.summary, command, log, ...(outcome.details ? { details: outcome.details } : {}),
    };
    if (!dirty) writeReceipt(paths, receipt);
    results.push({ ...outcome, gate: gate.name, recorded: !dirty, receipt });
  }
  // The floors the ratchets beat, written once every gate has run, for the builder to commit (GH-99).
  const raised = results.flatMap((r) => {
    const d = ratchetOf(r.receipt);
    return d?.raised ? [{ gate: r.gate, label: d.label, limit: d.limit, from: d.raised.from, to: d.raised.to }] : [];
  });
  if (raised.length) writeFloors(paths.floors, withRaises(readFloors(paths.floors), raised));
  return { sha, env, dirty, changes, results, raised: raised.map(({ limit: _limit, ...r }) => r) };
}

/**
 * The commit a commit's checks carry over from (GH-99): its only parent, when all it changes is
 * `.acc/floors.json`, setting each ratchet it changes to what that parent's receipt measured and acc raised.
 * So committing a raise doesn't run every check again. Null when anything else differs.
 */
function carriedFrom(paths: RepoPaths, config: Config, run: Runner, sha: string): string | null {
  if (!Object.keys(config.gates.ratchets ?? {}).length) return null;
  const parents = git(run, paths.root, ['rev-list', '--parents', '-n', '1', sha]).stdout.trim().split(/\s+/).slice(1);
  if (parents.length !== 1) return null;
  const parent = parents[0]!;
  const diff = git(run, paths.root, ['diff', '--name-only', '--no-renames', parent, sha]);
  if (diff.code !== 0 || diff.stdout.trim() !== FLOORS_FILE) return null;
  try {
    return carriesOver(floorsAt(run, paths.root, parent), floorsAt(run, paths.root, sha), receiptsAt(paths, parent)) ? parent : null;
  } catch {
    return null;
  }
}

/**
 * A gate's receipt on the parent, carried to this commit: only one that passed, or didn't apply, and that
 * no person waived, since a waiver is for its own commit (D-031). A ratchet is judged again, against this
 * commit's floors, with the number its parent measured. Null when there's nothing to carry.
 */
function carryReceipt(paths: RepoPaths, config: Config, input: GateInput, gate: string, from: string, sha: string): Receipt | null {
  const before = readReceipt(paths, from, gate);
  if (!before || before.waived || (before.status !== 'pass' && before.status !== 'skip')) return null;
  const { details: _details, ...rest } = before;
  const spec = config.gates.ratchets?.[gate];
  if (!spec) return { ...before, sha, carried: { from } };
  const measured = ratchetOf(before);
  const floors = input.floors?.();
  if (!measured || !floors || 'problem' in floors) return null;
  const outcome = judgeRatchet(gate, spec, measured.value, { ...floors, raise: false }, input.env.branch);
  if (outcome.status !== 'pass') return null;
  return { ...rest, sha, status: outcome.status, summary: outcome.summary, ...(outcome.details ? { details: outcome.details } : {}), carried: { from } };
}

// ---------------------------------------------------------------- waiving (D-031)

export interface WaiveRequest {
  sha: string;
  env: Environment;
  gates: string[];
  reason: string;
  by: string;
  now: () => Date;
}

/**
 * A person sets gates aside on one commit, with a reason (D-031). The waiver is the gate's receipt on
 * that commit: a skip, which satisfies a required gate, that says who waived it, why, and what it had
 * been. It holds for that commit only. A gate that passes has nothing to waive.
 */
export function waiveGates(paths: RepoPaths, config: Config, req: WaiveRequest): Receipt[] {
  const all = gatesFor(config);
  const reason = req.reason.trim();
  if (!reason) throw new AccError('usage', 'Say why it\'s waived: acc gate waive <gate> --reason "<why>". The reason is kept with the commit\'s checks.');
  if (!req.gates.length) throw new AccError('usage', `Name the gates to waive. This project's gates: ${all.map((g) => g.name).join(', ') || 'none'}.`);
  const unknown = req.gates.filter((n) => !all.some((g) => g.name === n));
  if (unknown.length) throw new AccError('usage', `No gate ${unknown.join(', ')}. This project's gates: ${all.map((g) => g.name).join(', ')}.`);
  // Waived and merged, a ratchet's number would sit below its floor, and fail every task after it (GH-99).
  const ratchet = req.gates.find((n) => config.gates.ratchets?.[n]);
  if (ratchet) throw new AccError('refused', `${ratchet} is a ratchet: waived, its number could merge below its floor and fail every task after it. A person relaxes the floor instead: acc gate relax ${ratchet} --to <n> --reason "<why>".`);
  const at = req.now().toISOString();
  const out: Receipt[] = [];
  for (const gate of [...new Set(req.gates)]) {
    const before = readReceipt(paths, req.sha, gate);
    if (before?.status === 'pass') throw new AccError('refused', `${gate} already passes on ${req.sha.slice(0, 7)}, so there's nothing to waive.`);
    const was = before?.waived ? before.waived.was : before?.status ?? null;
    const wasSummary = before?.waived ? before.waived.wasSummary : before?.summary ?? null;
    const receipt: Receipt = {
      gate, sha: req.sha, env: req.env.branch, status: 'skip', startedAt: at, finishedAt: at, durationMs: 0,
      summary: `Waived by ${req.by.replace(/^human:/, '')}: ${reason}`, command: null, log: before?.log ?? null,
      ...(before?.details ? { details: before.details } : {}),
      waived: { by: req.by, reason, at, was, wasSummary },
    };
    writeReceipt(paths, receipt);
    out.push(receipt);
  }
  return out;
}
