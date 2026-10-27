import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseConfig, type Config } from '../src/config.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { repoPaths } from '../src/paths.ts';
import { buildBaseline, draftLists, environmentsSection, parseManifest, README_END, README_START, readmePlaces, seedBranches, unionManifests, writeReadme } from '../src/setup.ts';
import { gitIn, makeRepo, ok, SF_CONFIG, tempDir } from './support.ts';

const now = () => new Date('2026-10-02T12:00:00Z');
const config = (over: Record<string, unknown> = {}): Config => {
  const r = parseConfig({ ...SF_CONFIG, ...over });
  assert.deepEqual(r.errors, []);
  return r.config!;
};
const write = (dir: string, rel: string, text: string) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true });
  writeFileSync(join(dir, rel), text);
};
const manifest = (types: Record<string, string[]>, version = '62.0') =>
  `<?xml version="1.0"?><Package xmlns="http://soap.sforce.com/2006/04/metadata">${Object.entries(types).map(([t, ms]) => `<types>${ms.map((m) => `<members>${m}</members>`).join('')}<name>${t}</name></types>`).join('')}<version>${version}</version></Package>`;

/** sf as these steps call it: generate manifest writes <name>.xml; retrieve writes the org's files. */
function fakeSf(byName: Record<string, string>, orgFiles: Record<string, Record<string, string>> = {}, calls: string[] = []) {
  return (cmd: string, args: string[], opts?: RunOptions): RunResult => {
    if (cmd === 'git') return run(cmd, args, opts);
    const a = cmd === 'nice' ? args.slice(3) : args;
    calls.push(a.join(' '));
    if (a[0] === 'project' && a[1] === 'generate') {
      const out = a[a.indexOf('--output-dir') + 1]!;
      const name = a[a.indexOf('--name') + 1]!;
      writeFileSync(join(out, `${name}.xml`), byName[name] ?? manifest({}));
      return ok(JSON.stringify({ status: 0 }));
    }
    if (a[0] === 'project' && a[1] === 'retrieve') {
      const org = a[a.indexOf('--target-org') + 1]!;
      if (!orgFiles[org]) return { code: 1, stdout: JSON.stringify({ status: 1, message: `No authorization information found for ${org}.` }), stderr: '' };
      for (const [f, text] of Object.entries(orgFiles[org]!)) write(opts!.cwd!, f, text);
      return ok(JSON.stringify({ status: 0, result: { files: [] } }));
    }
    // An org with files is logged in; Production's is checked before its branch is made (D-208).
    if (a[0] === 'org' && a[1] === 'display') {
      const org = a[a.indexOf('-o') + 1]!;
      return orgFiles[org] ? ok(JSON.stringify({ status: 0, result: { instanceUrl: 'https://acme.my.salesforce.com' } })) : { code: 1, stdout: JSON.stringify({ status: 1, message: `No authorization information found for ${org}.` }), stderr: '' };
    }
    return { code: 127, stdout: '', stderr: `no fake for ${a.join(' ')}` };
  };
}

test('B5: the baseline manifest is the union of every branch\'s components, sorted, at the newest API version', () => {
  const xml = unionManifests([manifest({ ApexClass: ['B', 'A'], Flow: ['Intake'] }, '61.0'), manifest({ ApexClass: ['C', 'A'], CustomObject: ['Case'] }, '62.0')]);
  const m = parseManifest(xml);
  assert.deepEqual([...m.types.keys()], ['ApexClass', 'CustomObject', 'Flow']);
  assert.deepEqual([...m.types.get('ApexClass')!], ['A', 'B', 'C']);
  assert.equal(m.version, '62.0');
  assert.match(unionManifests([manifest({ Report: ['Folder/R&D'] })]), /<members>Folder\/R&amp;D<\/members>/);
});

test('B5: acc setup baseline lists each environment branch\'s source and writes one manifest', () => {
  const dir = makeRepo({ 'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app' }] }), 'force-app/main/default/classes/A.cls': 'x' });
  gitIn(dir, 'branch', '-M', 'production');
  gitIn(dir, 'branch', 'uat');
  const r = buildBaseline(repoPaths(dir, run), config(), { run: fakeSf({ production: manifest({ ApexClass: ['A'] }), uat: manifest({ ApexClass: ['A', 'UatOnly'] }) }), now });
  assert.deepEqual([r.from, r.types, r.members], [['production', 'uat'], 1, 2]);
  assert.match(readFileSync(join(dir, 'manifest/baseline-package.xml'), 'utf8'), /UatOnly/);
});

test('B6: missing branches are made, production first from this checkout, each sandbox cleared and retrieved from its own org', () => {
  const dir = makeRepo({ 'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app' }] }), 'manifest/baseline-package.xml': manifest({ ApexClass: ['A'] }), 'force-app/main/default/classes/Local.cls': 'local' });
  const calls: string[] = [];
  const sf = fakeSf({}, {
    'Acme Production': { 'force-app/main/default/classes/A.cls': 'prod' },
    'Acme UAT': { 'force-app/main/default/classes/A.cls': 'uat' },
  }, calls);
  const r = seedBranches(repoPaths(dir, run), config(), { run: sf, now, slots: { dir: tempDir('slots-') } });
  assert.deepEqual(r.map((b) => [b.branch, b.status]), [['production', 'made'], ['uat', 'made'], ['dev', 'failed']]);
  assert.match(r[2]!.note, /retrieve from Acme Dev failed: No authorization/);
  assert.notEqual(run('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/dev'], { cwd: dir }).code, 0, 'a branch whose retrieve failed is taken out again');
  assert.equal(gitIn(dir, 'show', 'uat:force-app/main/default/classes/A.cls'), 'uat');
  assert.equal(run('git', ['show', 'uat:force-app/main/default/classes/Local.cls'], { cwd: dir }).code !== 0, true, 'a sandbox starts from a cleared source folder');
  assert.match(gitIn(dir, 'log', '-1', '--format=%s', 'uat'), /^Baseline: UAT org metadata, retrieved 2026-10-02$/);
  assert.ok(calls.every((c) => c.startsWith('project retrieve start --manifest manifest/baseline-package.xml') || c === 'org display -o Acme Production --json'), 'only reads the orgs');
  // Once Dev is logged in, a second run makes only what's still missing.
  const loggedIn = fakeSf({}, { 'Acme Dev': { 'force-app/main/default/classes/A.cls': 'dev' } });
  assert.deepEqual(seedBranches(repoPaths(dir, run), config(), { run: loggedIn, now, slots: { dir: tempDir('slots-') } }).map((b) => [b.branch, b.status]), [['dev', 'made']]);
});

test('B9: the lists are drafted from how each sandbox differs from production, and a list you have is never overwritten', () => {
  const dir = makeRepo({
    'sfdx-project.json': JSON.stringify({ packageDirectories: [{ path: 'force-app' }] }), 'force-app/main/default/classes/A.cls': 'a',
    'force-app/main/default/objects/Case/Case.object-meta.xml': '<a>1</a>\n<b>2</b>\n',
    'force-app/main/default/objects/Lead/Lead.object-meta.xml': '<a>1</a>\n',
  });
  gitIn(dir, 'branch', '-M', 'production');
  gitIn(dir, 'checkout', '-q', '-b', 'uat');
  write(dir, 'force-app/main/default/objects/Case/Case.object-meta.xml', '<b>2</b>\n<a>1</a>\n');
  write(dir, 'force-app/main/default/objects/Lead/Lead.object-meta.xml', '<a>1</a>\n<c>new</c>\n');
  write(dir, 'force-app/main/default/namedCredentials/Api.namedCredential-meta.xml', 'uat');
  write(dir, 'force-app/main/default/contentassets/Logo.asset-meta.xml', 'uat');
  write(dir, 'force-app/main/default/classes/A.cls', 'changed in uat');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'uat');
  gitIn(dir, 'checkout', '-q', 'production');
  const paths = repoPaths(dir, run);
  const r = draftLists(paths, config(), { run, now });
  assert.deepEqual(r.environmentSpecific.entries, ['force-app/main/default/namedCredentials/Api.namedCredential-meta.xml']);
  assert.deepEqual(r.knownDrift.entries, ['force-app/main/default/contentassets/Logo.asset-meta.xml', 'force-app/main/default/objects/Case/Case.object-meta.xml'], 'a logo, and a file that is only reordered');
  assert.deepEqual(r.unexplained, [{ branch: 'uat', files: ['force-app/main/default/classes/A.cls', 'force-app/main/default/objects/Lead/Lead.object-meta.xml'] }], 'a real change to an object is not noise');
  assert.equal(readFileSync(join(dir, 'manifest/environment-specific.txt'), 'utf8'), 'force-app/main/default/namedCredentials/Api.namedCredential-meta.xml\n', 'one path a line, no blank lines');
  writeFileSync(join(dir, 'manifest/known-drift.txt'), '# mine\nforce-app/main/default/contentassets\n');
  const again = draftLists(paths, config(), { run, now });
  assert.deepEqual([again.knownDrift.written, again.knownDrift.entries], [false, ['force-app/main/default/objects/Case/Case.object-meta.xml']], 'contentassets is already listed as a folder');
  assert.equal(readFileSync(join(dir, 'manifest/known-drift.txt'), 'utf8'), '# mine\nforce-app/main/default/contentassets\n');
});

test('B10: the README names where the tickets come from, by key with a link, for a Jira epic, an Azure area path and GitHub labels (GH-81)', () => {
  const generic = (trackers: unknown[], github: unknown = { repo: 'acme/service', account: 'jordan-kim' }) => {
    const r = parseConfig({ schema: 1, project: 'acme-portal', profile: 'generic', github, environments: [{ name: 'main', default: true }], trackers });
    assert.deepEqual(r.errors, []);
    return r.config!;
  };
  const cases: [unknown, string, string[]][] = [
    [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', epic: 'ACME-3' }, 'Jira epic [ACME-3](https://acme.atlassian.net/browse/ACME-3)', ['https://acme.atlassian.net/browse/ACME-3']],
    [{ kind: 'azure', organization: 'acme', project: 'CRM Online', areaPath: 'CRM Online\\Billing' }, 'Azure DevOps area path `CRM Online\\Billing` in [CRM Online](https://dev.azure.com/acme/CRM%20Online)', ['CRM Online\\Billing', 'https://dev.azure.com/acme/CRM%20Online']],
    [{ kind: 'github', labels: ['billing', 'good first issue'] }, 'GitHub labels [billing](https://github.com/acme/service/issues?q=is%3Aissue%20label%3A%22billing%22) or [good first issue](https://github.com/acme/service/issues?q=is%3Aissue%20label%3A%22good%20first%20issue%22)', ['https://github.com/acme/service/issues?q=is%3Aissue%20label%3A%22billing%22', 'https://github.com/acme/service/issues?q=is%3Aissue%20label%3A%22good%20first%20issue%22']],
    [{ kind: 'monday', account: 'acme', board: 1234, group: 'topics' }, 'monday.com group `topics` on [board 1234](https://acme.monday.com/boards/1234)', ['topics', 'https://acme.monday.com/boards/1234']],
  ];
  let checked = 0;
  for (const [t, line, needs] of cases) {
    const c = generic([t]);
    assert.deepEqual(readmePlaces(c).map((p) => [p.line, p.needs]), [[line, needs]]);
    assert.ok(environmentsSection(c).includes(`**Its tickets come from** ${line}.`), environmentsSection(c));
    assert.ok(!/Premium|Renewals/.test(environmentsSection(c)), 'the key, never the epic\'s name');
    checked++;
  }
  assert.equal(checked, 4);
  assert.deepEqual(readmePlaces(generic([{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME' }, { kind: 'github' }])), [], 'a whole project or repo is no place');
  assert.ok(!environmentsSection(generic([])).includes('tickets come from'));
  assert.equal(readmePlaces(generic([{ kind: 'github', labels: ['billing'] }], null))[0]!.line, 'GitHub label `billing` in this repo', 'no repo to link');
});

test('B10: the README gets its environments section between markers, written once and updated in place after', () => {
  const dir = makeRepo({ 'README.md': '# Acme\n\nIntro.\n' });
  const paths = repoPaths(dir, run);
  const c = config();
  assert.deepEqual(writeReadme(paths, c), { file: join(paths.root, 'README.md'), created: false, replaced: false });
  const first = readFileSync(join(dir, 'README.md'), 'utf8');
  assert.match(first, /^# Acme\n\nIntro\.\n\n<!-- acc:environments -->/);
  assert.match(first, /\| Production \| `production` \| Acme Production \| production \| protected: changes arrive only by promotion \|/);
  assert.match(first, /\| Dev \| `dev` \| Acme Dev \| developer \| day-to-day work; promotes to `uat` or `production` \|/);
  assert.match(first, /\*\*How changes move:\*\* `dev` → `uat` → `production`, or `dev` → `production`\./);
  writeFileSync(join(dir, 'README.md'), first.replace('Intro.', 'Intro, edited.') + '\nAfter.\n');
  assert.equal(writeReadme(paths, config({ project: 'Acme' })).replaced, true);
  const second = readFileSync(join(dir, 'README.md'), 'utf8');
  assert.equal(second.split(README_START).length, 2, 'one section, not two');
  assert.match(second, /Intro, edited\./);
  assert.match(second, /After\.\n$/);
  assert.ok(environmentsSection(c).endsWith(README_END));
  const fresh = makeRepo();
  rmSync(join(fresh, 'README.md'));
  assert.equal(writeReadme(repoPaths(fresh, run), c).created, true);
  assert.match(readFileSync(join(fresh, 'README.md'), 'utf8'), /^# Acme\n\n<!-- acc:environments -->/);
});
