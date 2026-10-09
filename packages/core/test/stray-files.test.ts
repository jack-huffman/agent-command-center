// The stray-files check (GH-103): a change that adds logs, temp files, new root files, big files or, in
// Salesforce, data exports fails, naming each file and the fix. Only what the change adds counts.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type Config, parseConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { type GateRun, gatesFor, runGates } from '../src/gates.ts';
import { repoPaths } from '../src/paths.ts';
import { readReceipt } from '../src/receipts.ts';
import { findStrayFiles, MAX_FILE_BYTES } from '../src/stray-files.ts';
import { GENERIC_CONFIG, gitIn, makeRepo, SF_CONFIG, tempDir } from './support.ts';

const now = () => new Date('2026-10-07T12:00:00Z');
const parsed = (raw: Record<string, unknown>): Config => {
  const r = parseConfig(raw);
  assert.deepEqual(r.errors, []);
  return r.config!;
};

/**
 * A repo on `main` (or `dev`, for Salesforce) holding `before`, with a task branch that commits `after`.
 * The branch's own .acc/config.json is `raw`, so its allowances are the checked commit's.
 */
function branch(raw: Record<string, unknown>, after: Record<string, string | Buffer>, before: Record<string, string | Buffer> = {}): { dir: string; config: Config } {
  const config = parsed(raw);
  const base = config.environments.find((e) => e.default)!.branch;
  const dir = makeRepo({ 'docs/README.md': 'docs\n', '.acc/config.json': JSON.stringify(raw) });
  const put = (files: Record<string, string | Buffer>) => {
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(dir, rel, '..'), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    gitIn(dir, 'add', '-A', '-f');
    gitIn(dir, 'commit', '-q', '--allow-empty', '-m', 'change');
  };
  put(before);
  if (base !== 'main') gitIn(dir, 'branch', '-m', base);
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-1-thing');
  put(after);
  return { dir, config };
}

const check = (dir: string, config: Config): GateRun['results'][number] => {
  const env = config.environments.find((e) => e.default)!;
  return runGates(repoPaths(dir, run), config, env, ['stray-files'], [], { run, now, slots: { dir: tempDir('slots-') } }).results[0]!;
};
const files = (r: { details?: Record<string, unknown> }) => (r.details?.files as { path: string; rule: string }[]).map((f) => `${f.path} ${f.rule}`);

test('it\'s built in for both profiles, not heavy, and a command of its name replaces it', () => {
  for (const raw of [GENERIC_CONFIG, SF_CONFIG]) {
    const g = gatesFor(parsed(raw)).find((x) => x.name === 'stray-files')!;
    assert.ok(g, `${raw.profile} has stray-files`);
    assert.equal(g.heavy, false);
  }
  const replaced = gatesFor(parsed({ ...GENERIC_CONFIG, gates: { commands: { 'stray-files': 'true' } } })).filter((g) => g.name === 'stray-files');
  assert.deepEqual(replaced.map((g) => g.about), ['true']);
});

test('logs, temp files, merge leftovers and .DS_Store fail at any depth, each named with its rule and the fix', () => {
  const { dir, config } = branch(GENERIC_CONFIG, { 'docs/fb-test.log': 'x', 'out/x.tmp': 'x', 'src/a.orig': 'x', 'src/b.REJ': 'x', 'sub/.DS_Store': 'x', 'src/ok.ts': 'x' });
  const r = check(dir, config);
  assert.equal(r.status, 'fail');
  assert.deepEqual(files(r).sort(), ['docs/fb-test.log scratch', 'out/x.tmp scratch', 'src/a.orig scratch', 'src/b.REJ scratch', 'sub/.DS_Store scratch']);
  for (const p of ['docs/fb-test.log', 'out/x.tmp', 'src/a.orig', 'src/b.REJ', 'sub/.DS_Store']) assert.ok(r.summary.includes(p), p);
  assert.match(r.summary, /git rm --cached .*docs\/fb-test\.log/);
  assert.match(r.summary, /add it to \.gitignore/);
  assert.match(r.summary, /"strayFiles\.allow" in \.acc\/config\.json/);
  assert.equal(readReceipt(repoPaths(dir, run), gitIn(dir, 'rev-parse', 'HEAD'), 'stray-files')!.status, 'fail', 'recorded');
});

test('a new file at the root fails; one in a folder, or a new top-level folder, doesn\'t', () => {
  const { dir, config } = branch(GENERIC_CONFIG, { 'notes.md': 'x', 'docs/notes.md': 'x', 'newdir/a.md': 'x' });
  const r = check(dir, config);
  assert.deepEqual(files(r), ['notes.md root']);
  assert.match(r.summary, /notes\.md \(a new file at the repo root\)/);
});

test('a file over 1 MB, as committed, fails; one of exactly 1 MB passes', () => {
  const { dir, config } = branch(GENERIC_CONFIG, { 'assets/big.bin': Buffer.alloc(MAX_FILE_BYTES + 1), 'assets/edge.bin': Buffer.alloc(MAX_FILE_BYTES) });
  const r = check(dir, config);
  assert.deepEqual(files(r), ['assets/big.bin size']);
  assert.match(r.summary, /over 1 MB/);
});

test('Salesforce: data files fail outside the folders strayFiles.data lists; a generic project lets them be', () => {
  const after = { 'exports/accounts.csv': 'a,b', 'x.XLSX': 'x', 'force-app/y.xls': 'x', 'mail/z.eml': 'x', 'data/samples/ok.csv': 'a' };
  const sf = branch({ ...SF_CONFIG, strayFiles: { data: ['data/samples'] } }, after);
  const r = check(sf.dir, sf.config);
  assert.deepEqual(files(r).sort(), ['exports/accounts.csv data', 'force-app/y.xls data', 'mail/z.eml data', 'x.XLSX data']);
  assert.match(r.summary, /"strayFiles\.data"/);
  const generic = branch(GENERIC_CONFIG, { 'exports/accounts.csv': 'a,b' });
  assert.equal(check(generic.dir, generic.config).status, 'pass');
});

test('strayFiles.allow lets a path or a folder through every rule, read from the checked commit\'s own config', () => {
  const raw = { ...GENERIC_CONFIG, strayFiles: { allow: ['LICENSE', 'fixtures'] } };
  const { dir } = branch(GENERIC_CONFIG, { '.acc/config.json': JSON.stringify(raw), LICENSE: 'MIT', 'fixtures/run.log': 'x', 'fixtures/big.bin': Buffer.alloc(MAX_FILE_BYTES + 1) });
  // The caller's config, as the merge queue's would be, doesn't list them: the commit's does.
  const r = check(dir, parsed(GENERIC_CONFIG));
  assert.equal(r.status, 'pass', r.summary);
  assert.equal(r.summary, 'Checked 3 added files: none is a log or temp file, a new root file or a file over 1 MB.');
});

test('a file already on the environment\'s branch never counts, modified or not', () => {
  const { dir, config } = branch(GENERIC_CONFIG, { 'keep.log': 'changed', 'assets/big.bin': Buffer.alloc(2 * MAX_FILE_BYTES, 1), 'src/new.ts': 'x' }, { 'keep.log': 'old', 'assets/big.bin': Buffer.alloc(2 * MAX_FILE_BYTES) });
  const r = check(dir, config);
  assert.equal(r.status, 'pass', r.summary);
  assert.match(r.summary, /^Checked 1 added file: /);
});

test('a change that adds nothing skips; a generic repo with no branch to compare with is an error, not a pass', () => {
  const { dir, config } = branch(GENERIC_CONFIG, { 'docs/README.md': 'changed\n' });
  const r = check(dir, config);
  assert.equal(r.status, 'skip');
  assert.equal(r.summary, 'This change adds no files.');
  const lone = makeRepo({ 'debug.log': 'x' });
  gitIn(lone, 'branch', '-m', 'trunk');
  const e = check(lone, parsed(GENERIC_CONFIG));
  assert.equal(e.status, 'error');
  assert.match(e.summary, /no main or origin\/main branch.*stray-files checks only the files a change adds/);
});

test('the rules alone: the first rule a file breaks, allowances, and data folders only for data', () => {
  const rules = { profile: 'salesforce' as const, allow: ['keep/'], data: ['data'] };
  assert.deepEqual(findStrayFiles([
    { path: 'a.csv', bytes: 1 }, { path: 'data/big.csv', bytes: MAX_FILE_BYTES + 1 }, { path: 'data/x.log', bytes: 1 },
    { path: 'keep/x.log', bytes: MAX_FILE_BYTES + 1 }, { path: 'dataset/a.csv', bytes: 1 }, { path: 'ok/a.ts', bytes: 1 },
  ], rules), [
    { path: 'a.csv', rule: 'data' }, { path: 'data/big.csv', rule: 'size' }, { path: 'data/x.log', rule: 'scratch' }, { path: 'dataset/a.csv', rule: 'data' },
  ]);
});
