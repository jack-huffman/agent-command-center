// A ticket's manifest (T-101), with a real git repo and a fake sf that records every call: Salesforce's own
// generate over each changed path at the project's API version, the type and member checks batched per type,
// the org's copies compared in a scratch checkout, the org's changes from source tracking, deletions in
// their own file, and nothing reaching the branch but by a person's own command. Nothing is ever deployed.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { type Config, parseConfig } from '../src/config.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { mutate, readLedger, upsertTasks } from '../src/ledger.ts';
import {
  buildManifest, checkMembers, commitManifest, componentsOf, DESTRUCTIVE_FILE, generateManifest, manifestPath, manifestRefusal, manifestTypes, manifestXml,
  NEVER_DEPLOYED, ORG_DIFFERS, orgChanges, orgMembers, orgTypes, PACKAGE_FILE, readManifest, retrieveIntoBranch, saveManifest, sourceApiVersion, splitComponent,
  TICKET_MANIFESTS, ticketManifestDir, ticketPaths,
} from '../src/manifest.ts';
import { repoPaths } from '../src/paths.ts';
import { escapeMarkup, slackEscape } from '../src/text.ts';
import { gitIn, makeRepo, SF_CONFIG, tempDir } from './support.ts';

const now = () => new Date('2026-10-22T10:00:00Z');
const D = 'force-app/main/default';
const SFDX = JSON.stringify({ packageDirectories: [{ path: 'force-app', default: true }], sourceApiVersion: '62.0' });
const meta = (type: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<${type} xmlns="http://soap.sforce.com/2006/04/metadata"/>\n`;

interface Call { cmd: string; args: string[]; cwd: string }

/** The fake sf's mapping of a path to its component, as Salesforce's would: a field under its object, a bundle as one member. */
function componentOf(path: string): [string, string] {
  const p = path.replace(/^.*force-app\/main\/default\//, '');
  let m = /^classes\/([^/.]+)\.cls/.exec(p);
  if (m) return ['ApexClass', m[1]!];
  m = /^objects\/([^/]+)\/fields\/([^/.]+)\.field-meta\.xml$/.exec(p);
  if (m) return ['CustomField', `${m[1]}.${m[2]}`];
  m = /^lwc\/([^/]+)\//.exec(p);
  if (m) return ['LightningComponentBundle', m[1]!];
  m = /^layouts\/(.+)\.layout-meta\.xml$/.exec(p);
  if (m) return ['Layout', m[1]!];
  return ['Widget', p.replace(/^.*\/|\..*$/g, '')];
}

const sfOk = (result: unknown): RunResult => ({ code: 0, stdout: JSON.stringify({ status: 0, result }), stderr: '' });
const sfBad = (message: string): RunResult => ({ code: 1, stdout: JSON.stringify({ status: 1, message }), stderr: '' });
const flag = (args: string[], name: string): string[] => args.flatMap((a, i) => (a === name ? [args[i + 1]!] : []));

/** The org as the fake sf answers for it: the types it knows, the members it holds, its copies, and what tracking says changed. */
interface FakeOrg {
  types?: { xmlName: string; childXmlNames?: string[]; inFolder?: boolean }[];
  members?: Record<string, string[]>;
  /** File contents the org's copy holds, by project path: a retrieve writes them. */
  copies?: Record<string, string>;
  preview?: RunResult;
  typesFail?: string;
}

const ORG: FakeOrg = {
  types: [{ xmlName: 'ApexClass' }, { xmlName: 'CustomObject', childXmlNames: ['CustomField'] }, { xmlName: 'LightningComponentBundle' }, { xmlName: 'Report', inFolder: true }],
  members: { ApexClass: ['InvoiceService', 'Old'], CustomField: ['Invoice__c.Amount__c'] },
  copies: { [`${D}/classes/InvoiceService.cls`]: 'public class InvoiceService { /* changed in the org */ }\n' },
  preview: sfOk({ toRetrieve: [{ type: 'ApexClass', fullName: 'OrgOnly', state: 'Add', path: `${D}/classes/OrgOnly.cls` }, { type: 'ApexClass', fullName: 'InvoiceService', state: 'Changed' }, { type: 'Profile', fullName: 'Admin', state: 'Changed', ignored: true }], conflicts: [] }),
};

/** A runner that runs git for real and answers sf as `org` would, recording every call. */
function fakeSf(org: FakeOrg, calls: Call[]) {
  return (cmd: string, args: string[], opts: RunOptions = {}): RunResult => {
    const [c, a] = cmd === 'nice' ? [args[2]!, args.slice(3)] : [cmd, args];
    calls.push({ cmd: c, args: a, cwd: opts.cwd ?? '' });
    if (c === 'git') return run(c, a, opts);
    if (c !== 'sf') return { code: 127, stdout: '', stderr: `no ${c}` };
    const cwd = opts.cwd!;
    const sub = a.slice(0, 3).join(' ');
    if (sub === 'project generate manifest') {
      const types = new Map<string, string[]>();
      for (const p of flag(a, '--source-dir')) {
        const [t, m] = componentOf(p);
        if (!types.get(t)?.includes(m)) types.set(t, [...(types.get(t) ?? []), m]);
      }
      const post = a.includes('--type');
      const file = join(flag(a, '--output-dir')[0]!, post ? DESTRUCTIVE_FILE : PACKAGE_FILE);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, manifestXml([...types].map(([name, members]) => ({ name, members: members.sort() })), flag(a, '--api-version')[0]!));
      return sfOk({ path: file, name: post ? DESTRUCTIVE_FILE : PACKAGE_FILE });
    }
    if (sub === 'org list metadata-types') return org.typesFail ? sfBad(org.typesFail) : sfOk({ metadataObjects: org.types });
    if (sub === 'org list metadata') {
      const type = flag(a, '--metadata-type')[0]!;
      const folder = flag(a, '--folder')[0];
      return sfOk((org.members?.[type] ?? []).filter((m) => !folder || m.startsWith(`${folder}/`)).map((fullName) => ({ fullName, type })));
    }
    if (sub === 'project retrieve start') {
      const wanted = a.includes('--manifest') ? componentsOf(manifestTypes(readFileSync(flag(a, '--manifest')[0]!, 'utf8'))) : flag(a, '--metadata');
      for (const [path, text] of Object.entries(org.copies ?? {})) {
        const [t, m] = componentOf(path);
        if (!wanted.includes(`${t}:${m}`)) continue;
        mkdirSync(dirname(join(cwd, path)), { recursive: true });
        writeFileSync(join(cwd, path), text);
      }
      return sfOk({ files: [] });
    }
    if (sub === 'project retrieve preview') return org.preview ?? sfOk({ toRetrieve: [] });
    return sfBad(`the fake sf doesn't know ${a.join(' ')}`);
  };
}

/**
 * A Salesforce repo whose dev branch holds InvoiceService, Old, and Invoice__c's Amount__c and Status__c, and
 * ACME-7's branch, in its worktree: InvoiceService changed, Due_Date__c added, Old deleted, Status__c changed,
 * a widget the org doesn't know, one file of the invoiceCard bundle deleted, and a note outside the source folders.
 */
function setup(raw: Record<string, unknown> = SF_CONFIG, state: 'review' | 'running' = 'review') {
  const dir = makeRepo({
    '.acc/config.json': JSON.stringify(raw), '.gitignore': '.claude/\n', 'sfdx-project.json': SFDX,
    'manifest/environment-specific.txt': `${D}/classes/Secret.cls\n`,
    [`${D}/classes/InvoiceService.cls`]: 'public class InvoiceService {}\n', [`${D}/classes/InvoiceService.cls-meta.xml`]: meta('ApexClass'),
    [`${D}/classes/Old.cls`]: 'public class Old {}\n', [`${D}/classes/Old.cls-meta.xml`]: meta('ApexClass'),
    [`${D}/classes/Secret.cls`]: 'public class Secret {}\n',
    [`${D}/objects/Invoice__c/fields/Amount__c.field-meta.xml`]: meta('CustomField'),
    [`${D}/objects/Invoice__c/fields/Status__c.field-meta.xml`]: meta('CustomField'),
    [`${D}/lwc/invoiceCard/invoiceCard.js`]: 'export default class {}\n', [`${D}/lwc/invoiceCard/invoiceCard.css`]: ':host {}\n',
  });
  gitIn(dir, 'branch', 'dev');
  const wt = join(dir, '.claude', 'worktrees', 'ACME-7');
  gitIn(dir, 'worktree', 'add', '-q', '-b', 'task/ACME-7-invoices', wt, 'dev');
  writeFileSync(join(wt, D, 'classes/InvoiceService.cls'), 'public class InvoiceService { Decimal total; }\n');
  writeFileSync(join(wt, D, 'objects/Invoice__c/fields/Due_Date__c.field-meta.xml'), meta('CustomField'));
  writeFileSync(join(wt, D, 'objects/Invoice__c/fields/Status__c.field-meta.xml'), meta('CustomField').replace('/>', '><label>Status</label></CustomField>'));
  mkdirSync(join(wt, D, 'widgets'), { recursive: true });
  writeFileSync(join(wt, D, 'widgets/Gauge.widget-meta.xml'), meta('Widget'));
  writeFileSync(join(wt, D, 'classes/Secret.cls'), 'public class Secret { /* this org */ }\n');
  writeFileSync(join(wt, 'NOTES.md'), 'notes\n');
  rmSync(join(wt, D, 'classes/Old.cls'));
  rmSync(join(wt, D, 'classes/Old.cls-meta.xml'));
  rmSync(join(wt, D, 'lwc/invoiceCard/invoiceCard.css'));
  gitIn(wt, 'add', '-A');
  gitIn(wt, 'commit', '-q', '-m', 'ACME-7: invoices');
  const config = parseConfig(raw).config as Config;
  const paths = repoPaths(dir, run);
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.atlassian.net/browse/ACME-7' }, title: 'Invoices', brief: 'Invoices get a due date.' }], 'human', 'human:test', emit, now);
    const t = l.tasks.find((x) => x.id === 'ACME-7')!;
    t.run = { branch: 'task/ACME-7-invoices', worktree: wt } as never;
    t.state = state;
  });
  return { dir, wt, config, paths, sha: gitIn(wt, 'rev-parse', 'HEAD') };
}

const sfCalls = (calls: Call[], sub: string) => {
  const words = sub.trim().split(' ');
  return calls.filter((c) => c.cmd === 'sf' && words.every((w, i) => c.args[i] === w));
};
const noDeploy = (calls: Call[]) => assert.deepEqual(calls.filter((c) => c.cmd === 'sf' && c.args.some((a) => /deploy/.test(a))), [], 'nothing is ever deployed');

// ---------------------------------------------------------------- building it

test('the manifest is Salesforce\'s own generate over each changed path, at the project\'s API version, with deletions in their own file', () => {
  const { paths, config, wt, sha } = setup();
  const calls: Call[] = [];
  const m = buildManifest(paths, config, 'ACME-7', { run: fakeSf(ORG, calls), now });
  const generate = sfCalls(calls, 'project generate manifest');
  // One for the deletions (from the base's copies), one for the package, one for what the ticket creates.
  assert.equal(generate.length, 3);
  const pkg = generate.find((c) => !c.args.includes('--type'))!;
  assert.equal(pkg.cwd, wt, 'the branch\'s files as its worktree holds them');
  assert.deepEqual(flag(pkg.args, '--source-dir'), [`${D}/classes/InvoiceService.cls`, `${D}/lwc/invoiceCard/invoiceCard.js`, `${D}/objects/Invoice__c/fields/Due_Date__c.field-meta.xml`, `${D}/objects/Invoice__c/fields/Status__c.field-meta.xml`, `${D}/widgets/Gauge.widget-meta.xml`]);
  assert.deepEqual(flag(pkg.args, '--api-version'), ['62.0']);
  assert.deepEqual(m.types, [{ name: 'ApexClass', members: ['InvoiceService'] }, { name: 'CustomField', members: ['Invoice__c.Due_Date__c', 'Invoice__c.Status__c'] }, { name: 'LightningComponentBundle', members: ['invoiceCard'] }, { name: 'Widget', members: ['Gauge'] }]);
  assert.equal(m.package, manifestXml(m.types, '62.0'));
  // Deletions: Old in destructiveChangesPost.xml, never in package.xml; invoiceCard lost a file but stays, so it isn't one.
  const post = generate.find((c) => c.args.includes('--type'))!;
  assert.ok(post.args.includes('--type') && post.args.includes('post'));
  assert.deepEqual(flag(post.args, '--source-dir'), [`${D}/classes/Old.cls`, `${D}/classes/Old.cls-meta.xml`, `${D}/lwc/invoiceCard/invoiceCard.css`]);
  assert.ok(post.cwd.startsWith(join(paths.stateDir, 'manifests')), 'the base\'s copies, in a scratch project');
  assert.deepEqual(m.deletions, [{ name: 'ApexClass', members: ['Old'] }]);
  assert.match(m.destructive!, /<members>Old<\/members>/);
  assert.doesNotMatch(m.destructive!, /invoiceCard/);
  assert.doesNotMatch(m.package, /<members>Old<\/members>/);
  assert.deepEqual(m.created, ['CustomField:Invoice__c.Due_Date__c', 'Widget:Gauge']);
  assert.deepEqual(m.paths.leftOut, ['NOTES.md', `${D}/classes/Secret.cls`], 'outside the source folders, and environment-specific (D-016)');
  assert.deepEqual([m.sha, m.key, m.env, m.org, m.check], [sha, 'ACME-7', 'dev', 'Acme Dev', null]);
  assert.deepEqual(readManifest(paths, 'ACME-7'), m, 'kept for the page');
  assert.match(NEVER_DEPLOYED, /never deploys/);
  noDeploy(calls);
  assert.equal(existsSync(join(paths.stateDir, 'manifests', 'ACME-7-1792663200000.out')), false, 'its scratch folder goes');
});

test('each type is checked against the org\'s own list, and each member against what it holds, one call a type; an unknown type and a missing member are named', () => {
  const { paths, config } = setup();
  const calls: Call[] = [];
  const m = buildManifest(paths, config, 'ACME-7', { run: fakeSf(ORG, calls), now });
  assert.equal(sfCalls(calls, 'org list metadata-types').length, 1);
  assert.deepEqual(flag(sfCalls(calls, 'org list metadata-types')[0]!.args, '--target-org'), ['Acme Dev']);
  // One call a known type: ApexClass, CustomField and LightningComponentBundle; Widget isn't known, so it isn't listed.
  assert.deepEqual(sfCalls(calls, 'org list metadata ').map((c) => flag(c.args, '--metadata-type')[0]), ['ApexClass', 'CustomField', 'LightningComponentBundle']);
  assert.deepEqual(m.findings.map((f) => [f.kind, f.type, f.member]), [
    ['missing', 'CustomField', 'Invoice__c.Status__c'],
    ['missing', 'LightningComponentBundle', 'invoiceCard'],
    ['unknown-type', 'Widget', null],
  ], 'Due_Date__c and Gauge are the ticket\'s own: the org needn\'t hold them');
  assert.match(m.findings[0]!.why, /doesn't hold CustomField Invoice__c\.Status__c, and this ticket doesn't create it/);
  assert.match(m.findings[2]!.why, /doesn't know Widget at API version 62\.0/);
});

test('edge: a type kept in folders is listed one folder at a time, and a name the org lists %-encoded or read matches', () => {
  const calls: Call[] = [];
  const org: FakeOrg = { ...ORG, members: { Report: ['Sales/Pipeline', 'Ops/Backlog'], Layout: ['Invoice__c-Invoice (Finance) Layout'] }, types: [...ORG.types!, { xmlName: 'Layout' }] };
  const f = checkMembers(fakeSf(org, calls), '/x', 'Acme Dev', '62.0', [{ name: 'Report', members: ['Sales/Pipeline', 'Ops/Backlog', 'Ops/Gone'] }, { name: 'Layout', members: ['Invoice__c-Invoice %28Finance%29 Layout'] }], new Set());
  assert.deepEqual(sfCalls(calls, 'org list metadata ').map((c) => [flag(c.args, '--metadata-type')[0], flag(c.args, '--folder')[0]]), [['Report', 'Sales'], ['Report', 'Ops'], ['Layout', undefined]]);
  assert.deepEqual(f.map((x) => x.member), ['Ops/Gone']);
});

test('edge: an org that can\'t list its types, or a type\'s members, is a finding that says nothing was checked, never a pass', () => {
  const f = checkMembers(fakeSf({ typesFail: 'No authorization information found for Acme Dev.' }, []), '/x', 'Acme Dev', '62.0', [{ name: 'ApexClass', members: ['A'] }], new Set());
  assert.deepEqual(f.map((x) => x.kind), ['unchecked']);
  assert.match(f[0]!.why, /nothing was checked against it: No authorization information found/);
  const run = (cmd: string, args: string[]) => (args[2] === 'metadata-types' ? sfOk({ metadataObjects: [{ xmlName: 'ApexClass' }] }) : sfBad('INVALID_TYPE'));
  assert.equal(typeof orgMembers(run, '/x', 'o', '62.0', 'ApexClass'), 'string');
  assert.match(checkMembers(run, '/x', 'o', '62.0', [{ name: 'ApexClass', members: ['A'] }], new Set())[0]!.why, /couldn't list its ApexClass: INVALID_TYPE/);
  assert.equal(typeof orgTypes(run, '/x', 'o', '62.0'), 'object');
});

test('edge: an environment with no org builds the manifest unchecked, and says why', () => {
  const raw = { ...SF_CONFIG, environments: SF_CONFIG.environments.map((e) => (e.name === 'Dev' ? { ...e, org: undefined } : e)) };
  const { paths, config } = setup(raw);
  const calls: Call[] = [];
  const m = buildManifest(paths, config, 'ACME-7', { run: fakeSf(ORG, calls), now });
  assert.deepEqual([m.org, m.findings], [null, []]);
  assert.match(m.unchecked!, /Dev has no org/);
  assert.deepEqual(sfCalls(calls, 'org list'), []);
  assert.throws(() => buildManifest(paths, config, 'ACME-7', { run: fakeSf(ORG, []), now }, { check: true }), /no org to check/);
});

test('edge: a project that isn\'t Salesforce, a task with no branch, and one that isn\'t there are refused with why', () => {
  assert.match(manifestRefusal({ profile: 'generic' }, { id: 'T-1', run: null }, 'T-1')!, /isn't a Salesforce project/);
  assert.match(manifestRefusal({ profile: 'salesforce' }, { id: 'T-1', run: null }, 'T-1')!, /has no branch yet/);
  assert.equal(manifestRefusal({ profile: 'salesforce' }, undefined, 'T-9'), 'No task T-9.');
  assert.equal(manifestRefusal({ profile: 'salesforce' }, { id: 'T-1', run: { branch: 'b' } }, 'T-1'), null);
});

// ---------------------------------------------------------------- fresh from the org

test('Check against the org retrieves the ticket\'s components into a scratch checkout, never the worktree, and names each copy that differs', () => {
  const { paths, config, wt, sha } = setup();
  const calls: Call[] = [];
  const m = buildManifest(paths, config, 'ACME-7', { run: fakeSf(ORG, calls), now }, { check: true });
  const retrieve = sfCalls(calls, 'project retrieve start');
  assert.equal(retrieve.length, 1);
  assert.notEqual(retrieve[0]!.cwd, wt);
  assert.ok(retrieve[0]!.cwd.startsWith(join(paths.stateDir, 'manifests')), 'a scratch checkout under acc\'s state');
  assert.deepEqual(flag(retrieve[0]!.args, '--target-org'), ['Acme Dev']);
  assert.equal(existsSync(retrieve[0]!.cwd), false, 'removed after');
  const check = m.check!;
  assert.deepEqual([check.org, check.sha, check.differs.map((d) => `${d.type}:${d.member}`), check.same, check.other], [m.org, sha, ['ApexClass:InvoiceService'], 4, []]);
  assert.deepEqual(check.differs[0]!.files, [`${D}/classes/InvoiceService.cls`]);
  assert.match(check.differs[0]!.diff, /-public class InvoiceService \{ Decimal total; \}\n\+public class InvoiceService \{ \/\* changed in the org \*\/ \}/, 'the branch\'s side first');
  assert.match(ORG_DIFFERS, /changed in the org after the last commit/);
  // Nothing changed in the branch: no commit, and the worktree as it was.
  assert.equal(gitIn(wt, 'rev-parse', 'HEAD'), sha);
  assert.equal(gitIn(wt, 'status', '--porcelain'), '');
  assert.deepEqual(calls.filter((c) => c.cmd === 'git' && ['commit', 'add', 'push'].includes(c.args[0]!)), []);
  noDeploy(calls);
});

test('the org\'s tracked changes the branch lacks are listed, without the ticket\'s own or ignored ones; with tracking off it says it isn\'t available', () => {
  const { paths, config, wt } = setup();
  const calls: Call[] = [];
  const m = buildManifest(paths, config, 'ACME-7', { run: fakeSf(ORG, calls), now }, { check: true });
  assert.deepEqual(m.check!.changes, { available: true, items: [{ type: 'ApexClass', member: 'OrgOnly', state: 'Add', path: `${D}/classes/OrgOnly.cls` }] });
  assert.equal(sfCalls(calls, 'project retrieve preview')[0]!.cwd, wt, 'tracking is the ticket\'s worktree\'s');
  const off = orgChanges(fakeSf(ORG, calls), wt, { sourceTracking: false }, 'Acme Dev', new Set());
  assert.equal(off.available, false);
  assert.match((off as { why: string }).why, /doesn't use source tracking/);
  assert.equal(sfCalls(calls, 'project retrieve preview').length, 1, 'tracking off asks the org nothing');
  const failed = orgChanges(fakeSf({ preview: sfBad('This org doesn\'t have source tracking.') }, []), wt, {}, 'Acme Dev', new Set());
  assert.deepEqual(failed, { available: false, why: 'The org couldn\'t say what changed there: This org doesn\'t have source tracking.' });
});

test('Use the org\'s copy retrieves that one component into the ticket\'s branch as a commit, only when a person asks', () => {
  const { paths, config, wt, sha } = setup();
  const calls: Call[] = [];
  buildManifest(paths, config, 'ACME-7', { run: fakeSf(ORG, calls), now }, { check: true });
  assert.equal(gitIn(wt, 'rev-parse', 'HEAD'), sha, 'the check alone commits nothing');
  const c = retrieveIntoBranch(paths, config, 'ACME-7', 'ApexClass:InvoiceService', { run: fakeSf(ORG, calls), now });
  const r = sfCalls(calls, 'project retrieve start').at(-1)!;
  assert.deepEqual([r.cwd, flag(r.args, '--metadata'), flag(r.args, '--target-org')], [wt, ['ApexClass:InvoiceService'], ['Acme Dev']]);
  assert.deepEqual([c.files, c.message], [[`${D}/classes/InvoiceService.cls`], 'ACME-7: Use Acme Dev\'s copy of ApexClass InvoiceService']);
  assert.equal(gitIn(wt, 'log', '-1', '--format=%an %s'), 'Test Person ACME-7: Use Acme Dev\'s copy of ApexClass InvoiceService', 'by the person\'s own identity');
  assert.equal(readFileSync(join(wt, D, 'classes/InvoiceService.cls'), 'utf8'), ORG.copies![`${D}/classes/InvoiceService.cls`]);
  assert.deepEqual(readManifest(paths, 'ACME-7')!.check!.differs, [], 'the kept check drops it');
  // Add to this ticket: an org change, the same way.
  const org = { ...ORG, copies: { [`${D}/classes/OrgOnly.cls`]: 'public class OrgOnly {}\n' } };
  const add = retrieveIntoBranch(paths, config, 'ACME-7', 'ApexClass:OrgOnly', { run: fakeSf(org, calls), now });
  assert.deepEqual(add.files, [`${D}/classes/OrgOnly.cls`]);
  assert.deepEqual(readManifest(paths, 'ACME-7')!.check!.changes, { available: true, items: [] });
  noDeploy(calls);
});

test('edge: Use the org\'s copy is refused while the builder works, with uncommitted changes, for a copy that\'s the same, or a name that isn\'t Type:Member', () => {
  const busy = setup(SF_CONFIG, 'running');
  assert.throws(() => retrieveIntoBranch(busy.paths, busy.config, 'ACME-7', 'ApexClass:InvoiceService', { run: fakeSf(ORG, []), now }), /builder is working in its branch now/);
  const { paths, config, wt, sha } = setup();
  writeFileSync(join(wt, D, 'classes/InvoiceService.cls'), 'unsaved\n');
  const calls: Call[] = [];
  assert.throws(() => retrieveIntoBranch(paths, config, 'ACME-7', 'ApexClass:InvoiceService', { run: fakeSf(ORG, calls), now }), /changes that aren't committed/);
  assert.deepEqual(sfCalls(calls, 'project retrieve start'), [], 'refused before the org is asked');
  gitIn(wt, 'checkout', '--', '.');
  assert.throws(() => retrieveIntoBranch(paths, config, 'ACME-7', 'ApexClass:Old', { run: fakeSf({ copies: {} }, []), now }), /same as the branch's/);
  assert.equal(gitIn(wt, 'rev-parse', 'HEAD'), sha);
  for (const bad of ['InvoiceService', ':X', 'ApexClass:']) assert.throws(() => retrieveIntoBranch(paths, config, 'ACME-7', bad, { run: fakeSf(ORG, []), now }), /isn't a component/);
  assert.deepEqual(splitComponent('Layout:Account-Account Layout'), { type: 'Layout', member: 'Account-Account Layout' });
});

test('edge: a source file left untracked in the worktree before Use the org\'s copy stays out of its commit', () => {
  const { paths, config, wt } = setup();
  writeFileSync(join(wt, D, 'classes/Scratch.cls'), 'public class Scratch {}\n');
  const c = retrieveIntoBranch(paths, config, 'ACME-7', 'ApexClass:InvoiceService', { run: fakeSf(ORG, []), now });
  assert.deepEqual(c.files, [`${D}/classes/InvoiceService.cls`]);
  assert.doesNotMatch(gitIn(wt, 'show', '--name-only', '--format=', 'HEAD'), /Scratch\.cls/);
  assert.match(gitIn(wt, 'status', '--porcelain', '--untracked-files=all'), /\?\? .*Scratch\.cls/, 'still there, still untracked');
  assert.throws(() => retrieveIntoBranch(paths, config, 'ACME-7', 'ApexClass:Old', { run: fakeSf({ ...ORG, copies: {} }, []), now }), /same as the branch's/, 'the untracked file alone is nothing to commit');
});

test('edge: with no worktree, Use the org\'s copy works in a scratch checkout of the branch, removed after', () => {
  const { dir, paths, config, wt } = setup();
  gitIn(dir, 'worktree', 'remove', '--force', wt);
  const calls: Call[] = [];
  const c = retrieveIntoBranch(paths, config, 'ACME-7', 'ApexClass:InvoiceService', { run: fakeSf(ORG, calls), now });
  const cwd = sfCalls(calls, 'project retrieve start')[0]!.cwd;
  assert.ok(cwd.startsWith(join(paths.stateDir, 'manifests')));
  assert.equal(existsSync(cwd), false);
  assert.equal(gitIn(dir, 'log', '-1', '--format=%s', 'task/ACME-7-invoices'), c.message);
});

// ---------------------------------------------------------------- saving it

test('Add to the ticket\'s branch commits package.xml and the deletions beside it at manifest/tickets/<key>/, as the person', () => {
  const { paths, config, wt } = setup();
  const calls: Call[] = [];
  assert.throws(() => commitManifest(paths, config, 'ACME-7', { run: fakeSf(ORG, calls), now }), /no manifest yet/, 'edge: before one is built');
  const m = buildManifest(paths, config, 'ACME-7', { run: fakeSf(ORG, calls), now });
  const c = commitManifest(paths, config, 'ACME-7', { run: fakeSf(ORG, calls), now });
  assert.equal(ticketManifestDir('ACME-7'), `${TICKET_MANIFESTS}/ACME-7`);
  assert.deepEqual(c.files, [`manifest/tickets/ACME-7/${DESTRUCTIVE_FILE}`, 'manifest/tickets/ACME-7/package.xml']);
  assert.equal(readFileSync(join(wt, 'manifest/tickets/ACME-7/package.xml'), 'utf8'), m.package);
  assert.equal(readFileSync(join(wt, 'manifest/tickets/ACME-7', DESTRUCTIVE_FILE), 'utf8'), m.destructive);
  assert.equal(gitIn(wt, 'log', '-1', '--format=%an %s'), 'Test Person ACME-7: Add the ticket\'s manifest');
  assert.throws(() => commitManifest(paths, config, 'ACME-7', { run: fakeSf(ORG, calls), now }), /already holds this manifest/, 'edge: the same manifest again');
  noDeploy(calls);
});

test('save as a file writes package.xml whole, and the deletions\' file beside it only when there are deletions', () => {
  const out = tempDir('acc-save-');
  assert.deepEqual(saveManifest({ package: '<p/>', destructive: '<d/>' }, join(out, 'a', 'package.xml')), [join(out, 'a', 'package.xml'), join(out, 'a', DESTRUCTIVE_FILE)]);
  assert.equal(readFileSync(join(out, 'a', DESTRUCTIVE_FILE), 'utf8'), '<d/>');
  assert.deepEqual(saveManifest({ package: '<p/>', destructive: null }, join(out, 'b.xml')), [join(out, 'b.xml')], 'edge: no deletions, no second file');
  assert.equal(existsSync(join(out, DESTRUCTIVE_FILE)), false);
});

// ---------------------------------------------------------------- the pieces

test('a manifest reads back as Salesforce writes it, escapes and all, and the paths come from the branch', () => {
  const xml = manifestXml([{ name: 'Report', members: ['Sales/Q&A <draft>'] }, { name: 'ApexClass', members: ['A', 'B'] }, { name: 'Flow', members: [] }], '62.0');
  assert.match(xml, /<members>Sales\/Q&amp;A &lt;draft&gt;<\/members>/);
  assert.equal(escapeMarkup('Q&A <draft>'), 'Q&amp;A &lt;draft&gt;', 'the one escape text.ts exports');
  assert.equal(slackEscape, escapeMarkup);
  assert.ok(xml.indexOf('ApexClass') < xml.indexOf('Report'), 'types by name');
  assert.doesNotMatch(xml, /Flow/, 'edge: a type with no members is left out');
  assert.deepEqual(manifestTypes(xml), [{ name: 'ApexClass', members: ['A', 'B'] }, { name: 'Report', members: ['Sales/Q&A <draft>'] }]);
  assert.deepEqual(manifestTypes(''), [], 'edge: nothing to read');
  assert.deepEqual(componentsOf(manifestTypes(xml)), ['ApexClass:A', 'ApexClass:B', 'Report:Sales/Q&A <draft>']);
  const { dir, paths, config } = setup();
  const task = readLedger(paths.ledger).tasks[0]!;
  assert.ok(ticketPaths(run, dir, task, config.environments.find((e) => e.branch === 'dev')!).includes(`${D}/classes/Old.cls`));
  assert.equal(manifestPath(paths, 'ACME-7'), join(paths.stateDir, 'manifests', 'ACME-7.json'));
  mkdirSync(dirname(manifestPath(paths, 'ACME-7')), { recursive: true });
  writeFileSync(manifestPath(paths, 'ACME-7'), '{"v":2}');
  assert.equal(readManifest(paths, 'ACME-7'), null, 'edge: one this version doesn\'t read');
});

test('edge: an sfdx-project.json with no sourceApiVersion, or none at all, is refused with why; sf\'s own failure is said', () => {
  const dir = tempDir('acc-api-');
  assert.throws(() => sourceApiVersion(dir), /no sfdx-project\.json/);
  writeFileSync(join(dir, 'sfdx-project.json'), '{"packageDirectories":[]}');
  assert.throws(() => sourceApiVersion(dir), /has no sourceApiVersion/);
  writeFileSync(join(dir, 'sfdx-project.json'), SFDX);
  assert.equal(sourceApiVersion(dir), '62.0');
  assert.throws(() => generateManifest(() => sfBad('force-app/x: File or folder not found'), dir, ['force-app/x'], '62.0', join(dir, 'out')), /couldn't build the manifest: force-app\/x: File or folder not found/);
});
