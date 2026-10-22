// A ticket's manifest from the real Salesforce CLI (T-101): the fixture project's object and two fields, flow,
// Apex class, LWC bundle, layout with a space and encoded characters in its name, and custom metadata
// record, added on a ticket's branch, come out of `sf project generate manifest` as the pinned file does.
// The fixture and the expected file are pinned by their hashes. Where sf isn't on the machine, the case is
// skipped with its reason, and counted; ACC_REAL_SF=1 turns it on anyway, so a missing sf or fixture fails.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { type Config, parseConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { mutate, upsertTasks } from '../src/ledger.ts';
import { buildManifest, manifestTypes, manifestXml } from '../src/manifest.ts';
import { repoPaths } from '../src/paths.ts';
import { gitIn, makeRepo, SF_CONFIG } from './support.ts';

const FIXTURE = join(import.meta.dirname, 'fixtures', 'manifest');
const EXPECTED = join(import.meta.dirname, 'fixtures', 'manifest-expected.xml');
/** sha256 of each fixture file's path and bytes, in path order: a changed fixture fails here before it fails below. */
const FIXTURE_SHA = '7bfa179a9ce868e8ad9f3802f1f936dd72c604e7de13d03d313c484ac4c2b9aa';
const EXPECTED_SHA = '5256324d11d2c290c2b6d75dd04033195ce60c3b883f70f4b0484b1788febf12';

const sha = (text: string | Buffer): string => createHash('sha256').update(text).digest('hex');

/** The fixture's files, by path from its root, sorted. A fixture that's missing or empty is an error, never a skip. */
function fixtureFiles(dir: string): string[] {
  if (!existsSync(dir)) throw new Error(`The manifest fixture is missing: ${dir}.`);
  const walk = (d: string): string[] => readdirSync(d).filter((f) => f !== '.DS_Store').flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [relative(dir, join(d, f))]));
  const files = walk(dir).sort();
  if (!files.length) throw new Error(`The manifest fixture is empty: ${dir}.`);
  return files;
}

const treeSha = (dir: string): string => sha(fixtureFiles(dir).map((f) => `${f}\0${sha(readFileSync(join(dir, f)))}`).join('\n'));

/** Whether the real-sf case runs, and why not: sf on the machine, unless ACC_REAL_SF says. */
function realSf(): { on: boolean; why: string | null } {
  if (process.env.ACC_REAL_SF === '1') return { on: true, why: null };
  if (process.env.ACC_REAL_SF === '0') return { on: false, why: 'ACC_REAL_SF=0 turns the real-sf case off: 1 case not run' };
  return run('sf', ['--version'], { timeoutMs: 60_000 }).code === 0 ? { on: true, why: null } : { on: false, why: 'sf isn\'t on this machine: 1 real-sf case not run' };
}

const REAL = realSf();

test('the fixture and the expected manifest are the pinned ones', () => {
  assert.equal(fixtureFiles(FIXTURE).length, 12);
  assert.equal(treeSha(FIXTURE), FIXTURE_SHA);
  assert.equal(sha(readFileSync(EXPECTED)), EXPECTED_SHA);
  // sf's own file is the oracle for acc's writer: read and written back, it's the same bytes.
  assert.equal(manifestXml(manifestTypes(readFileSync(EXPECTED, 'utf8')), '62.0'), readFileSync(EXPECTED, 'utf8'));
});

test('edge: a missing or empty fixture fails, so switched on, the real case can\'t pass without it', () => {
  assert.throws(() => fixtureFiles(join(FIXTURE, 'not-here')), /fixture is missing/);
  assert.throws(() => fixtureFiles(join(FIXTURE, 'force-app', 'main', 'default', 'lwc', 'invoiceCard', 'missing')), /fixture is missing/);
});

test('real sf: a ticket that adds the fixture\'s components gets the pinned package.xml', { skip: REAL.why ?? false, timeout: 300_000 }, () => {
  const files = fixtureFiles(FIXTURE);
  const raw = { ...SF_CONFIG, environments: SF_CONFIG.environments.map((e) => (e.name === 'Dev' ? { ...e, org: undefined } : e)) };
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw), '.gitignore': '.claude/\n.sf/\n.sfdx/\n', 'sfdx-project.json': readFileSync(join(FIXTURE, 'sfdx-project.json'), 'utf8') });
  gitIn(dir, 'branch', 'dev');
  gitIn(dir, 'checkout', '-q', '-b', 'task/ACME-7-invoices', 'dev');
  cpSync(join(FIXTURE, 'force-app'), join(dir, 'force-app'), { recursive: true });
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'ACME-7: invoices');
  gitIn(dir, 'checkout', '-q', 'main');
  const config = parseConfig(raw).config as Config;
  const paths = repoPaths(dir, run);
  const now = () => new Date('2026-10-22T10:00:00Z');
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Invoices', brief: 'b' }], 'human', 'human:test', emit, now);
    l.tasks[0]!.run = { branch: 'task/ACME-7-invoices' } as never;
  });
  const m = buildManifest(paths, config, 'ACME-7', { run, now });
  assert.equal(m.paths.changed.length, files.length - 1, 'every source file but sfdx-project.json, which the base holds');
  assert.equal(m.package, readFileSync(EXPECTED, 'utf8'));
  assert.deepEqual([m.destructive, m.created.length, m.apiVersion], [null, 8, '62.0']);
});
