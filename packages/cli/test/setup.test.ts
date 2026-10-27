// acc help, init, template, doctor and onboarding: setup.ts's commands, and main.ts's own help and usage.
// acc runs from its source, in throwaway repos (support.ts).
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { samePath } from '../../core/src/paths.ts';
import { recordedSource } from '../../core/src/source.ts';
import { makeRepo, tempDir } from '../../core/test/support.ts';
import { cli, REPOS_FILE, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

test('help, version and bad usage', () => {
  const dir = makeRepo();
  // The one version, the root package.json's (D-079).
  const { version } = JSON.parse(readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8')) as { version: string };
  assert.equal(acc(dir, ['--version']).out, `${version}\n`);
  assert.match(acc(dir, ['help']).out, new RegExp(`^acc ${version.replaceAll('.', '\\.')}: Agent Command Center`));
  assert.match(acc(dir, ['help']).out, /acc doctor/);
  assert.equal(acc(dir, ['nope']).code, 2);
  assert.equal(acc(dir, ['--nope']).code, 2);
});

test('init --profile generic writes a config that doctor accepts', () => {
  const dir = makeRepo();
  const r = acc(dir, ['init', '--profile', 'generic', '--project', 'Tool', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().config.environments[0].branch, 'main');
  const cfg = JSON.parse(readFileSync(join(dir, '.acc', 'config.json'), 'utf8'));
  assert.equal(cfg.project, 'Tool');
  assert.equal(acc(dir, ['init', '--profile', 'generic']).code, 1, 'refuses to overwrite without --force');
  const doctor = acc(dir, ['doctor', '--part', 'project', '--json']).json() as { id: string; status: string }[];
  assert.equal(doctor.find((d) => d.id === 'B0.config')!.status, 'pass');
});

test('init --tracker writes the tracker picked on the Connect page, narrowed to its epic, and lists the repo on this machine (GH-81)', () => {
  const dir = makeRepo();
  const tracker = { kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', board: 7, epic: 'ACME-3' };
  const dry = acc(dir, ['init', '--profile', 'generic', '--tracker', JSON.stringify(tracker), '--dry-run', '--json']);
  assert.equal(dry.code, 0, dry.err);
  assert.deepEqual(dry.json().config.trackers.map((t: Record<string, unknown>) => [t.kind, t.site, t.project, t.board, t.epics]), [['jira', 'acme.atlassian.net', 'ACME', 7, ['ACME-3']]]);
  assert.equal(existsSync(join(dir, '.acc', 'config.json')), false, 'a dry run writes nothing');
  assert.ok(!existsSync(REPOS_FILE) || !readFileSync(REPOS_FILE, 'utf8').includes(dir), 'nor lists the repo');

  const r = acc(dir, ['init', '--profile', 'generic', '--project', 'acme-portal', '--tracker', JSON.stringify({ kind: 'github', repo: null, labels: ['billing'] }), '--json']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(readFileSync(join(dir, '.acc', 'config.json'), 'utf8')).trackers, [{ kind: 'github', labels: ['billing'] }]);
  // Listed as git names the root: C:/… on Windows, where Node says C:\….
  assert.ok((JSON.parse(readFileSync(REPOS_FILE, 'utf8')) as { repos: string[] }).repos.some((r) => samePath(r, realpathSync(dir))), 'listed for the Connect page\'s "used by"');

  for (const bad of ['not json', '[1]', 'null']) {
    const refused = acc(makeRepo(), ['init', '--profile', 'generic', '--tracker', bad]);
    assert.deepEqual([refused.code, /--tracker must be one tracker as JSON/.test(refused.err)], [2, true], bad);
  }
  const unknown = acc(makeRepo(), ['init', '--profile', 'generic', '--tracker', '{"kind":"trello"}']);
  assert.equal(unknown.code, 1);
  assert.match(unknown.err, /trackers\[0\]: "kind" must be/);
  assert.match(acc(dir, ['help']).out, /\n {2}acc init \.\.\. --tracker <json> {9}One tracker, as the Connect page picks it: a Jira epic, an Azure area path or\n {40}GitHub labels\. It replaces the template's tracker and --jira-\*\n/);
});

test('init --from a team template records it, template show says what it sets, and a bad one writes nothing (GH-80)', () => {
  const team = tempDir('team-');
  const file = join(team, 'tools.json');
  writeFileSync(file, JSON.stringify({ schema: 1, name: 'ACME tools', description: 'ACME\'s small repos.', gates: { required: ['test'], commands: { test: 'npm test' } }, autonomy: 'review', agents: { max: 2 } }));
  const dir = makeRepo();

  const shown = acc(dir, ['template', 'show', file, '--json']);
  assert.equal(shown.code, 0, shown.err);
  const s = shown.json();
  assert.deepEqual([s.ok, s.name, s.description, s.commands], [true, 'ACME tools', 'ACME\'s small repos.', { test: 'npm test' }]);
  assert.ok(s.sets.includes('Required checks: test'), s.sets.join('\n'));
  assert.match(acc(dir, ['template', 'show', file]).out, /Check commands, which run on each machine that uses it:\n {2}test: npm test/);

  const r = acc(dir, ['init', '--from', file, '--profile', 'generic', '--json']);
  assert.equal(r.code, 0, r.err);
  const cfg = JSON.parse(readFileSync(join(dir, '.acc', 'config.json'), 'utf8'));
  // Recorded with ~/ when it's under the home folder (D-079), as the temp folder is on Windows; elsewhere as it is.
  assert.deepEqual([cfg.template.name, cfg.template.source], ['ACME tools', recordedSource(file)]);
  assert.ok(cfg.template.source === file || cfg.template.source.startsWith('~/'), cfg.template.source);
  assert.match(cfg.template.digest, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual([cfg.autonomy, cfg.agents.max, cfg.gates.required], ['review', 2, ['test']]);
  assert.deepEqual([r.json().fromTemplate, r.json().discovered], [['gates', 'autonomy', 'agents'], ['project', 'commitIdentity', 'environments']]);
  const preview = acc(dir, ['init', '--from', file, '--dry-run']);
  assert.match(preview.out, /From the template ACME tools: gates, autonomy, agents\nDiscovered: project, commitIdentity, environments/);
  assert.match(preview.out, /Check commands from the template, which run on this machine:\n {2}test: npm test/);
  const doctor = acc(dir, ['doctor', '--step', 'B0.template', '--json']).json() as { id: string; status: string }[];
  assert.deepEqual(doctor.map((d) => [d.id, d.status]), [['B0.template', 'pass']]);

  const bad = join(team, 'bad.json');
  writeFileSync(bad, JSON.stringify({ schema: 1, name: 'Bad', gatez: {} }));
  const fresh = makeRepo();
  const refused = acc(fresh, ['init', '--from', bad]);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /"gatez" isn't a template key/);
  assert.ok(!existsSync(join(fresh, '.acc', 'config.json')), 'nothing is written');
  const badShow = acc(fresh, ['template', 'show', bad, '--json']);
  assert.equal(badShow.code, 1);
  assert.deepEqual(badShow.json().ok, false);
  assert.match(badShow.json().errors.join('\n'), /"gatez" isn't a template key/);
  const sf = acc(fresh, ['init', '--from', file, '--profile', 'salesforce']);
  assert.equal(sf.code, 1, 'a profile the template doesn\'t set is fine; this one has none, so it needs --production-org');
  assert.match(sf.err + sf.out, /needs --production-org/);
});

test('init --from copies the rules a team template names into .acc/rules/, and --dry-run lists them and copies nothing (GH-108)', () => {
  const team = tempDir('team-');
  const rules = join(team, 'acme-apex.md');
  writeFileSync(rules, '- Every Apex class has a test class.\n');
  const file = join(team, 'tools.json');
  writeFileSync(file, JSON.stringify({ schema: 1, name: 'ACME tools', rules: [rules] }));
  const dir = makeRepo();

  const shown = acc(dir, ['template', 'show', file, '--json']).json();
  assert.deepEqual(shown.rules, [rules]);
  assert.ok(shown.sets.includes(`Rules copied into .acc/rules/: ${rules}`), shown.sets.join('\n'));

  const dry = acc(dir, ['init', '--from', file, '--profile', 'generic', '--dry-run']);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /Rules from the template, which it would copy into \.acc\/rules\/ for you to review and commit:\n {2}\.acc\/rules\/acme-apex\.md: /);
  assert.ok(!existsSync(join(dir, '.acc')), 'a dry run writes neither the config nor the rules');

  rmSync(rules);
  const unreadable = acc(dir, ['init', '--from', file, '--profile', 'generic']);
  assert.equal(unreadable.code, 1);
  assert.match(unreadable.err, /There's no rules file at/);
  assert.ok(!existsSync(join(dir, '.acc')), 'a rules file that can\'t be read writes nothing');
  writeFileSync(rules, '- Every Apex class has a test class.\n');

  const r = acc(dir, ['init', '--from', file, '--profile', 'generic', '--json']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().rules.map((x: { file: string; written: boolean }) => [x.file, x.written]), [['.acc/rules/acme-apex.md', true]]);
  assert.match(readFileSync(join(dir, '.acc', 'rules', 'acme-apex.md'), 'utf8'), /^<!-- acc-rules v1: [\s\S]*\nsource: .*acme-apex\.md\ncopied: \d{4}-\d{2}-\d{2}\nsha256: [0-9a-f]{64}\n-->\n- Every Apex class has a test class\.\n$/);
  const again = acc(dir, ['init', '--from', file, '--profile', 'generic', '--force']);
  assert.equal(again.code, 0, again.err);
  assert.match(again.out, /\.acc\/rules\/acme-apex\.md is already here, so it's kept/);
  const doctor = acc(dir, ['doctor', '--step', 'B0.rules', '--json']).json() as { status: string }[];
  assert.deepEqual(doctor.map((d) => d.status), ['pass']);
});

test('commands that need a config say how to get one', () => {
  const r = acc(makeRepo(), ['list']);
  assert.equal(r.code, 1);
  assert.match(r.err, /Run "acc init" first/);
  assert.match(acc(makeRepo(), ['list', '--json']).out, /"error":\s*"no-config"/);
});

test('doctor --step runs only the named checks, and rejects unknown ids', () => {
  const dir = repoWithConfig();
  const r = acc(dir, ['doctor', '--step', 'B0.config', '--step', 'B0.repo', '--json']).json() as { id: string }[];
  assert.deepEqual(r.map((x) => x.id).sort(), ['B0.config', 'B0.repo']);
  assert.equal(acc(dir, ['doctor', '--step', 'Z9.nope']).code, 2);
});
