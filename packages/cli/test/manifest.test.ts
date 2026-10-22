// acc manifest, manifest show, manifest retrieve and manifest commit (T-101): acc runs from its source, in a
// Salesforce repo whose task ACME-7 has a branch, with a fake sf on PATH that records every call. It never deploys.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gitIn, SF_CONFIG, tempDir } from '../../core/test/support.ts';
import { cli, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));
const D = 'force-app/main/default';

/** The fake sf: Apex classes only, an org that holds InvoiceService, whose copy of it differs, and tracking that lists OrgOnly. */
const FAKE_SF = `
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
const a = process.argv.slice(2);
appendFileSync(process.env.FAKE_SF_LOG, JSON.stringify({ args: a, cwd: process.cwd() }) + '\\n');
const flag = (n) => a.flatMap((x, i) => (x === n ? [a[i + 1]] : []));
const say = (result) => console.log(JSON.stringify({ status: 0, result }));
const sub = a.slice(0, 3).join(' ');
const xml = (names, v) => '<?xml version="1.0" encoding="UTF-8"?>\\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\\n' + (names.length ? '    <types>\\n' + names.map((n) => '        <members>' + n + '</members>\\n').join('') + '        <name>ApexClass</name>\\n    </types>\\n' : '') + '    <version>' + v + '</version>\\n</Package>\\n';
if (sub === 'project generate manifest') {
  const names = [...new Set(flag('--source-dir').map((p) => p.replace(/^.*\\//, '').replace(/\\..*$/, '')))].sort();
  const file = join(flag('--output-dir')[0], a.includes('--type') ? 'destructiveChangesPost.xml' : 'package.xml');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, xml(names, flag('--api-version')[0]));
  say({ path: file });
} else if (sub === 'org list metadata-types') say({ metadataObjects: [{ xmlName: 'ApexClass' }] });
else if (sub === 'org list metadata') say([{ fullName: 'InvoiceService', type: 'ApexClass' }]);
else if (sub === 'project retrieve start') {
  const wanted = a.includes('--manifest') ? [...readFileSync(flag('--manifest')[0], 'utf8').matchAll(/<members>([^<]*)</g)].map((m) => m[1]) : flag('--metadata').map((c) => c.split(':')[1]);
  for (const n of wanted) writeFileSync(join('${D}', 'classes', n + '.cls'), 'public class ' + n + ' { /* the org */ }\\n');
  say({ files: [] });
} else if (sub === 'project retrieve preview') say({ toRetrieve: [{ type: 'ApexClass', fullName: 'OrgOnly', state: 'Add' }] });
else { console.log(JSON.stringify({ status: 1, message: 'the fake sf does not know ' + a.join(' ') })); process.exit(1); }
`;

/** A Salesforce repo whose dev branch has InvoiceService and Old, and ACME-7's branch, which changes the one and deletes the other. */
function manifestRepo(raw: Record<string, unknown> = SF_CONFIG) {
  const dir = repoWithConfig(raw);
  mkdirSync(join(dir, D, 'classes'), { recursive: true });
  writeFileSync(join(dir, '.gitignore'), '.claude/\n.fakebin/\n');
  writeFileSync(join(dir, 'sfdx-project.json'), JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '62.0' }));
  writeFileSync(join(dir, D, 'classes/InvoiceService.cls'), 'public class InvoiceService {}\n');
  writeFileSync(join(dir, D, 'classes/Old.cls'), 'public class Old {}\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'source');
  gitIn(dir, 'branch', 'dev');
  gitIn(dir, 'checkout', '-q', '-b', 'task/ACME-7-invoices', 'dev');
  writeFileSync(join(dir, D, 'classes/InvoiceService.cls'), 'public class InvoiceService { Decimal total; }\n');
  rmSync(join(dir, D, 'classes/Old.cls'));
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'ACME-7: invoices');
  gitIn(dir, 'checkout', '-q', 'main');
  assert.equal(acc(dir, ['import'], JSON.stringify([{ source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Invoices', environment: 'dev' }])).err, '');
  const ledger = join(dir, '.git', 'acc', 'ledger.json');
  const l = JSON.parse(readFileSync(ledger, 'utf8'));
  l.tasks[0].run = { branch: 'task/ACME-7-invoices' };
  l.tasks[0].state = 'review';
  writeFileSync(ledger, JSON.stringify(l));
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  const script = join(tempDir('acc-fake-sf-'), 'sf.mjs');
  writeFileSync(script, FAKE_SF);
  writeFileSync(join(bin, 'sf'), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  chmodSync(join(bin, 'sf'), 0o755);
  const log = join(tempDir('acc-sf-log-'), 'calls.jsonl');
  return { dir, log, env: { PATH: `${bin}:${process.env.PATH}`, FAKE_SF_LOG: log } };
}

const sfCalls = (log: string): { args: string[]; cwd: string }[] => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

test('acc manifest --json builds it with sf, checks it against the org, keeps deletions apart, and never deploys', () => {
  const { dir, log, env } = manifestRepo();
  const r = acc(dir, ['manifest', 'acme-7', '--json'], undefined, env);
  assert.equal(r.code, 0, r.err);
  const m = r.json();
  assert.deepEqual([m.task, m.types, m.deletions, m.findings, m.check], ['ACME-7', [{ name: 'ApexClass', members: ['InvoiceService'] }], [{ name: 'ApexClass', members: ['Old'] }], [], null]);
  const calls = sfCalls(log);
  assert.ok(calls.some((c) => c.args.join(' ').startsWith('project generate manifest --source-dir force-app/main/default/classes/InvoiceService.cls --api-version 62.0')));
  assert.deepEqual(calls.filter((c) => c.args.some((x) => /deploy/.test(x))), []);
  // Read back as a person reads it.
  const shown = acc(dir, ['manifest', 'show', 'ACME-7'], undefined, env);
  assert.match(shown.out, /ACME-7's manifest: 1 component from task\/ACME-7-invoices/);
  assert.match(shown.out, /Deleted, in destructiveChangesPost\.xml:\n {2}ApexClass\n {4}Old/);
  assert.match(shown.out, /never deploys them/);
});

test('acc manifest --check --out compares the org\'s copies, lists the org\'s changes, and writes both files', () => {
  const { dir, env } = manifestRepo();
  const file = join(tempDir('acc-out-'), 'ACME-7', 'package.xml');
  const r = acc(dir, ['manifest', 'ACME-7', '--check', '--out', file], undefined, env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Checked against Acme Dev: 0 the same as the branch, 1 that differ\./);
  assert.match(r.out, /ApexClass InvoiceService: The org's copy differs from this ticket's branch/);
  assert.match(r.out, /Add ApexClass:OrgOnly/);
  assert.match(readFileSync(file, 'utf8'), /<members>InvoiceService<\/members>/);
  assert.match(readFileSync(join(file, '..', 'destructiveChangesPost.xml'), 'utf8'), /<members>Old<\/members>/);
  assert.equal(gitIn(dir, 'log', '-1', '--format=%s', 'task/ACME-7-invoices'), 'ACME-7: invoices', 'the check commits nothing');
});

test('acc manifest retrieve and commit change the branch as the person, and a builder can do neither', () => {
  const { dir, env } = manifestRepo();
  assert.equal(acc(dir, ['manifest', 'ACME-7'], undefined, env).code, 0);
  for (const args of [['manifest', 'retrieve', 'ACME-7', 'ApexClass:InvoiceService'], ['manifest', 'commit', 'ACME-7']]) {
    const r = acc(dir, args, undefined, { ...env, ACC_ROLE: 'builder' });
    assert.equal(r.code, 1, args.join(' '));
    assert.match(r.err, /A builder can't .* A person does that/);
  }
  const got = acc(dir, ['manifest', 'retrieve', 'ACME-7', 'ApexClass:InvoiceService', '--json'], undefined, env);
  assert.equal(got.code, 0, got.err);
  assert.equal(got.json().message, 'ACME-7: Use Acme Dev\'s copy of ApexClass InvoiceService');
  const c = acc(dir, ['manifest', 'commit', 'ACME-7'], undefined, env);
  assert.equal(c.code, 0, c.err);
  assert.equal(gitIn(dir, 'log', '-1', '--format=%s', 'task/ACME-7-invoices'), 'ACME-7: Add the ticket\'s manifest');
  assert.equal(gitIn(dir, 'show', 'task/ACME-7-invoices:manifest/tickets/ACME-7/destructiveChangesPost.xml').includes('<members>Old</members>'), true);
});

test('edge: usage, a task with no manifest yet, a project that isn\'t Salesforce, and an empty --out are refused with why', () => {
  const { dir, env } = manifestRepo();
  for (const args of [['manifest'], ['manifest', 'show'], ['manifest', 'retrieve', 'ACME-7'], ['manifest', 'a', 'b']]) {
    assert.match(acc(dir, args, undefined, env).err, /acc manifest <id>/, args.join(' '));
  }
  assert.match(acc(dir, ['manifest', 'show', 'ACME-7'], undefined, env).err, /has no manifest yet/);
  assert.match(acc(dir, ['manifest', 'ACME-7', '--out', ' '], undefined, env).err, /--out takes the file/);
  const generic = repoWithConfig();
  assert.match(acc(generic, ['manifest', 'T-1']).err, /isn't a Salesforce project/);
});
