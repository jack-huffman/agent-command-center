// Every way into acc, called with junk (GH-106): no arguments, empty strings, a wrong type where a number or
// id belongs, a long string, an unknown id, and paths outside the repo, as arguments, as every option its
// group declares, and on stdin. The list comes from acc's registry (entryPointsOf), so a new command or
// subcommand is covered without anyone adding it here. Each call must succeed, or fail in one short line
// with exit 1 or 2, inside the time limit, and nothing outside its throwaway repo may change.
//
// It runs the built acc (dist/acc.mjs), as people do: npm run check builds first, and so does the near-tests
// gate. A 1 MB string can't be an argument (macOS caps the arguments and environment at 1 MiB together), so
// it goes on stdin and in files, and arguments get 100 KB (D-???).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { ParseArgsOptionsConfig } from 'node:util';
import { AREAS } from '../src/commands/index.ts';
import { commandsOf, entryPointsOf, MESSAGE_MAX } from '../src/main.ts';
import type { CommandArea } from '../src/shared.ts';
import { changes, GENERIC_CONFIG, makeRepo, snapshot, tempDir } from '../../core/test/support.ts';

const ACC = fileURLToPath(new URL('../../../dist/acc.mjs', import.meta.url));
const COMMANDS_DIR = fileURLToPath(new URL('../src/commands/', import.meta.url));
/** How long one call may take, and how many run at once. */
const LIMIT_MS = 20_000;
const AT_ONCE = 3;
/** The longest line a failure may print: main.ts cuts its message, with its mark in front. */
const LONGEST_LINE = MESSAGE_MAX + 2;
const MB = 1024 * 1024;
const LONG_ARG = 'x'.repeat(100 * 1024);

// ---------------------------------------------------------------- the verdict

interface CallResult {
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  json: boolean;
  /** How long it took, in milliseconds. */
  ms?: number;
}

const lines = (s: string): string[] => s.split('\n').filter((l) => l.trim() !== '');
const isJson = (s: string): boolean => {
  try {
    JSON.parse(s);
    return true;
  } catch {
    return false;
  }
};

/** What's wrong with how a call ended: nothing, when it succeeded or failed in one short line. */
function judge(r: CallResult): string[] {
  const why: string[] = [];
  if (r.timedOut) why.push(`didn't finish within ${LIMIT_MS / 1000}s`);
  else if (r.signal) why.push(`was killed by ${r.signal}`);
  else if (r.code !== 0 && r.code !== 1 && r.code !== 2) why.push(`exited ${r.code}: only 0, 1 and 2 are acc's own answers, and 3 is an error it didn't expect`);
  if ([...lines(r.stdout), ...lines(r.stderr)].some((l) => /^\s+at /.test(l))) why.push('printed a stack trace');
  if (r.code !== 0 && !r.timedOut) {
    const err = lines(r.stderr);
    if (err.length > 1) why.push(`failed with ${err.length} lines on stderr, not one`);
    if (err.some((l) => l.length > LONGEST_LINE)) why.push(`failed with a line over ${LONGEST_LINE} characters`);
  }
  if (r.json && r.stdout.trim() && !isJson(r.stdout) && !lines(r.stdout).every(isJson)) why.push('printed something that isn\'t JSON, with --json');
  if (r.json && r.code !== 0 && !r.timedOut && r.stdout.trim()) {
    const m = (() => {
      try {
        return (JSON.parse(lines(r.stdout).at(-1)!) as { message?: unknown }).message;
      } catch {
        return undefined;
      }
    })();
    if (typeof m === 'string' && m.length > LONGEST_LINE) why.push(`failed with a message over ${LONGEST_LINE} characters, with --json`);
  }
  return why;
}

// ---------------------------------------------------------------- the sandbox

/**
 * A folder holding everything a call can reach: home/ (HOME, with Claude Code's state in it), tmp/
 * (TMPDIR), state/ (acc's machine files), bin/ (fake gh, claude and sf, first on PATH), OUTSIDE/ (files
 * outside the repo: a sentinel, a 1 MB file, and bait a ../ id would reach), template/ (the repo every
 * call gets a fresh copy of) and repos/ (those copies). OUTSIDE is in capitals because acc upper-cases ids.
 */
function sandbox() {
  const root = realpathSync(tempDir('acc-junk-'));
  const at = (...p: string[]) => join(root, ...p);
  for (const d of ['home/.claude', 'tmp', 'state/heavy', 'state/questions', 'state/slack', 'bin', 'log', 'OUTSIDE/folder', 'repos']) mkdirSync(at(d), { recursive: true });
  writeFileSync(at('home', '.claude.json'), '{"projects":{}}\n');
  writeFileSync(at('home', '.claude', 'settings.json'), '{}\n');
  writeFileSync(at('OUTSIDE', 'sentinel.txt'), 'acc must never change this file.\n');
  writeFileSync(at('OUTSIDE', 'big.txt'), 'x'.repeat(MB));
  // What a path built from "../../../../../OUTSIDE/X" reaches from inside a copy's .git/acc/analyses.
  const dotdot = '../../../../../OUTSIDE/X';
  writeFileSync(at('OUTSIDE', 'X.json'), JSON.stringify({ v: 1, task: dotdot, verdict: 'questions', questions: [{ id: 'q1', text: 'Bait?', options: [] }] }));
  writeFileSync(at('OUTSIDE', 'X.running.json'), '{}');
  // Every program acc might start that isn't git: it logs what it was asked, and fails at once.
  for (const name of ['gh', 'claude', 'sf', 'code', 'open', 'osascript', 'caffeinate', 'security', 'pbcopy']) {
    writeFileSync(at('bin', name), `#!/bin/sh\necho "${name} $*" | head -c 300 >> '${at('log', 'calls.log')}'\necho >> '${at('log', 'calls.log')}'\nexit 1\n`);
    chmodSync(at('bin', name), 0o755);
  }
  // The repo: a generic project with a GitHub section and one task, whose autopilot stays manual.
  const made = makeRepo({ '.acc/config.json': JSON.stringify({ ...GENERIC_CONFIG, github: { repo: 'acme-co/tool', account: 'fake-account' }, trackers: [{ kind: 'github' }], autonomy: 'manual' }) });
  cpSync(made, at('template'), { recursive: true });
  rmSync(made, { recursive: true, force: true });
  const env: NodeJS.ProcessEnv = {
    PATH: [at('bin'), dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':'),
    HOME: at('home'),
    USER: 'junk',
    TMPDIR: at('tmp'),
    LANG: 'en_US.UTF-8',
    NO_COLOR: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    CLAUDE_CONFIG_DIR: at('home', '.claude'),
    ACC_HEAVY_DIR: at('state', 'heavy'),
    ACC_MACHINE_FILE: at('state', 'machine.json'),
    ACC_QUESTIONS_DIR: at('state', 'questions'),
    ACC_RUNTIME_FILE: at('state', 'runtime'),
    ACC_SLACK_DIR: at('state', 'slack'),
  };
  return { root, at, env, dotdot };
}

type Sandbox = ReturnType<typeof sandbox>;

/** The folders no call may change: everything but its own repo, tmp/, state/ and the fakes' log. */
const guarded = (s: Sandbox) => ['home', 'OUTSIDE', 'template', 'bin'].map((d) => s.at(d));
const snapAll = (s: Sandbox) => new Map(guarded(s).flatMap((d) => [...snapshot(d)].map(([p, v]) => [`${relative(s.root, d)}/${p}`, v] as const)));

// ---------------------------------------------------------------- the junk

interface Case { name: string; args: string[]; stdin: string; json: boolean }

const JUNK_STDIN = ['', 'x'.repeat(MB), '{}', 'null', '[{"title":5,"deps":"ZZ-99999"}]', JSON.stringify(Array.from({ length: 1024 }, () => 'y'.repeat(1000)))];

/** Every string option the group declares, apart from those every command takes. */
const stringOptions = (o: ParseArgsOptionsConfig | undefined): string[] => Object.entries(o ?? {}).filter(([, d]) => d.type === 'string').map(([n]) => n);

function casesFor(s: Sandbox, words: string[], options: string[]): Case[] {
  const out = s.at('OUTSIDE');
  const positional: [string, string[]][] = [
    ['no arguments', []],
    ['empty strings', ['', '', '']],
    ['a wrong type', ['abc', 'NaN', '1e400']],
    ['numbers out of range', ['0', '99999999999999999999', '3.5']],
    ['a 100 KB string', [LONG_ARG]],
    ['an unknown id', ['ZZ-99999', 'q1', 'ZZ-99999']],
    ['paths outside the repo', [out, join(out, 'big.txt'), join(out, 'missing')]],
    ['../ paths out of the repo', [s.dotdot, 'q1', s.dotdot]],
    ['--as and --by junk', ['ZZ-99999', '--as', 'NaN', '--by', LONG_ARG]],
  ];
  // Every option at once, so a call stays under macOS's limit on arguments.
  const each = options.length ? Math.floor(Math.min(100 * 1024, (600 * 1024) / options.length)) : 0;
  const optionCases: [string, (name: string) => string][] = [
    ['every option empty', () => ''],
    ['every option a wrong type', () => 'NaN'],
    ['every option a long string', () => 'x'.repeat(each)],
    ['every option a 1 MB file outside the repo', () => join(out, 'big.txt')],
    ['every option a folder', () => out],
    ['every option a missing ../ path', () => '../../../../../OUTSIDE/missing.json'],
  ];
  const all: [string, string[]][] = [
    ...positional,
    ...(options.length ? optionCases.map(([name, v]): [string, string[]] => [name, ['ZZ-99999', ...options.flatMap((o) => [`--${o}`, v(o)])]]) : []),
  ];
  return all.map(([name, args], i) => ({ name, args: [...words, ...args, ...(i % 2 ? ['--json'] : [])], stdin: JUNK_STDIN[i % JUNK_STDIN.length]!, json: i % 2 === 1 }));
}

let copies = 0;

/** One call, in a fresh copy of the repo, killed with its children when it runs over. */
function call(s: Sandbox, c: Case): Promise<CallResult> {
  const cwd = s.at('repos', String(copies++));
  cpSync(s.at('template'), cwd, { recursive: true });
  const t0 = Date.now();
  return new Promise((done) => {
    const child = spawn(process.execPath, ['--no-warnings', ACC, ...c.args], { cwd, env: s.env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    const keep = (into: Buffer[]) => (b: Buffer) => { size += b.length; if (size < 4 * MB) into.push(b); };
    child.stdout.on('data', keep(out));
    child.stderr.on('data', keep(err));
    child.stdin.on('error', () => {});
    child.stdin.end(c.stdin);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* gone already */ }
    }, LIMIT_MS);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* none left */ }
      rmSync(cwd, { recursive: true, force: true });
      done({ code, signal, timedOut, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8'), json: c.json, ms: Date.now() - t0 });
    });
  });
}

async function pool<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await f(items[i]!);
    }
  }));
  return results;
}

const clip = (s: string) => (s.length > 200 ? `${s.slice(0, 200)}…` : s).replace(/\n/g, '⏎');
const shown = (args: string[]) => args.map((a) => (a.length > 40 ? `<${a.length} chars>` : a === '' ? "''" : a)).join(' ');

// ---------------------------------------------------------------- the tests

test('the verdict fails each way a call can go wrong, and passes a plain refusal', () => {
  const ok: CallResult = { code: 1, signal: null, timedOut: false, stdout: '', stderr: '✗ No task ZZ-99999.\n', json: false };
  assert.deepEqual(judge(ok), []);
  assert.deepEqual(judge({ ...ok, code: 0, stderr: 'step one\nstep two\n' }), [], 'a success may say what it did, on any number of lines');
  assert.deepEqual(judge({ ...ok, code: 2 }), []);
  const fails = (r: Partial<CallResult>, why: RegExp) => assert.ok(judge({ ...ok, ...r }).some((w) => why.test(w)), `${JSON.stringify(r).slice(0, 80)} fails with ${why}`);
  fails({ code: 3 }, /exited 3/);
  fails({ code: null, timedOut: true }, /didn't finish/);
  fails({ code: null, signal: 'SIGSEGV' }, /killed by SIGSEGV/);
  fails({ stderr: '✗ one\n✗ two\n' }, /2 lines/);
  fails({ code: 0, stderr: 'TypeError: x\n    at f (main.ts:1:1)\n' }, /stack trace/);
  fails({ stderr: `✗ No task ${'x'.repeat(LONGEST_LINE)}\n` }, new RegExp(`over ${LONGEST_LINE} characters`));
  fails({ json: true, stdout: 'not json\n', stderr: '' }, /isn't JSON/);
  fails({ json: true, stdout: JSON.stringify({ error: 'usage', message: 'x'.repeat(LONGEST_LINE + 1) }), stderr: '' }, /message over/);
  assert.deepEqual(judge({ ...ok, json: true, code: 0, stdout: '{\n  "a": 1\n}\n', stderr: '' }), [], 'pretty JSON is JSON');
  assert.deepEqual(judge({ ...ok, json: true, code: 0, stdout: '{"pass":1}\n{"pass":2}\n', stderr: '' }), [], 'a line a pass is JSON');
});

test('the snapshot sees a file added, changed or removed', () => {
  const dir = tempDir('acc-junk-snap-');
  writeFileSync(join(dir, 'a'), 'one');
  mkdirSync(join(dir, 'sub'));
  writeFileSync(join(dir, 'sub', 'b'), 'two');
  const before = snapshot(dir);
  assert.deepEqual(changes(before, snapshot(dir)), []);
  writeFileSync(join(dir, 'a'), 'One');
  writeFileSync(join(dir, 'sub', 'c'), '');
  rmSync(join(dir, 'sub', 'b'));
  assert.deepEqual(changes(before, snapshot(dir)).sort(), ['added sub/c', 'changed a', 'removed sub/b']);
});

test('every subcommand a command compares a word to is in the registry', async () => {
  // A command's word that isn't declared would never be called with junk.
  const modules = readdirSync(COMMANDS_DIR).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
  let checked = 0;
  for (const f of modules) {
    const { area } = (await import(join(COMMANDS_DIR, f))) as { area?: CommandArea };
    if (!area) continue;
    checked++;
    const src = readFileSync(join(COMMANDS_DIR, f), 'utf8');
    const compared = new Set([...src.matchAll(/\b(?:sub|what|rest\[0\])\s*[!=]==\s*'([a-z-]+)'/g)].map((m) => m[1]!));
    const declared = new Set(Object.values(area.subcommands ?? {}).flat());
    for (const w of compared) assert.ok(declared.has(w), `${f} compares a subcommand to '${w}', so it belongs in its area's subcommands`);
  }
  assert.equal(checked, AREAS.length, 'every group was read');
});

test('every acc command and subcommand survives junk arguments, options and stdin (GH-106)', { timeout: 30 * 60_000 }, async (t) => {
  assert.ok(existsSync(ACC), `${ACC} is missing: run npm run build first`);
  const s = sandbox();
  // The template's one task, added by the acc under test.
  const add = await new Promise<number | null>((r) => spawn(process.execPath, ['--no-warnings', ACC, 'add', 'A real task'], { cwd: s.at('template'), env: s.env, stdio: 'ignore' }).on('close', r));
  assert.equal(add, 0, 'the template repo has its task');
  const entries = entryPointsOf(AREAS);
  const commands = commandsOf(AREAS);
  const subcommands = AREAS.reduce((n, a) => n + Object.values(a.subcommands ?? {}).reduce((m, l) => m + l.length, 0), 0);
  const started = Date.now();
  let before = snapAll(s);
  const failures: string[] = [];
  let calls = 0;
  const slow: [string, number][] = [];
  const reached = new Set<string>();
  for (const words of entries) {
    const area = AREAS.find((a) => Object.hasOwn(a.commands, words[0]!))!;
    // A command that takes a subcommand first gets its junk there; its options are tried on each subcommand.
    const takesSub = words.length === 1 && !!area.subcommands?.[words[0]!];
    const cases = casesFor(s, words, takesSub ? [] : stringOptions(area.options));
    assert.ok(cases.length > 0, `acc ${words.join(' ')} has junk to get`);
    const results = await pool(cases, AT_ONCE, (c) => call(s, c));
    calls += results.length;
    slow.push([words.join(' '), results.reduce((n, r) => n + (r.ms ?? 0), 0)]);
    reached.add(words.join(' '));
    results.forEach((r, i) => {
      const why = judge(r);
      if (why.length) failures.push(`acc ${shown(cases[i]!.args)} (${cases[i]!.name}): ${why.join('; ')}. stderr: ${clip(r.stderr)} stdout: ${clip(r.stdout)}`);
    });
    const moved = changes(before, snapAll(s));
    if (moved.length) {
      failures.push(`acc ${words.join(' ')} wrote outside its repo: ${moved.join(', ')}`);
      before = snapAll(s);
    }
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  t.diagnostic(`${commands.size} commands, ${subcommands} subcommands, ${calls} calls, ${seconds}s`);
  t.diagnostic(`slowest: ${slow.sort((a, b) => b[1] - a[1]).slice(0, 8).map(([w, ms]) => `${w} ${(ms / 1000).toFixed(1)}s`).join(', ')}`);
  assert.deepEqual(failures, [], `${failures.length} of ${calls} calls failed:\n${failures.join('\n')}`);
  // Nothing drops out silently: every command and every subcommand the registry holds was called.
  assert.equal(reached.size, commands.size + subcommands, 'every command and subcommand was called');
  assert.ok(commands.size >= 35 && subcommands >= 33, `the registry holds ${commands.size} commands and ${subcommands} subcommands`);
  assert.ok(calls >= entries.length * 9, `${calls} calls`);
  rmSync(s.root, { recursive: true, force: true });
});
