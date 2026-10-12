// Every key .acc/config.json may hold, and every setting the extension contributes, is read by code and
// described for a person, and code reads no key or setting that isn't one (GH-107). A setting that does
// nothing is worse than a missing one.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { CONFIG_KEYS, UNREAD_KEYS, VALIDATOR_ONLY } from '../../packages/core/src/config.ts';
import { tempDir } from '../../packages/core/test/support.ts';
import { checkSettings, type Finding, NOT_READS, RAW_READS, READ_IN, ROOT, say, type SettingsInputs, sources } from '../settings.ts';

test('every config key and extension setting is read by code and described, and code reads none that isn\'t one', () => {
  const { findings, counted } = checkSettings();
  assert.deepEqual(findings.map(say), []);
  // It checked something: every key, the reads, DESIGN §4's rows, both settings, a read at each raw place.
  assert.ok(counted.keys >= 50, `${counted.keys} config keys`);
  assert.equal(counted.keys, CONFIG_KEYS.length);
  assert.equal(counted.reads, CONFIG_KEYS.length - Object.keys(UNREAD_KEYS).length - Object.keys(VALIDATOR_ONLY).length);
  assert.ok(counted.rows >= 20, `${counted.rows} rows in DESIGN §4's Field table`);
  assert.ok(counted.settings >= 2, `${counted.settings} contributed settings`);
  assert.ok(counted.settingReads >= 2, `${counted.settingReads} settings read`);
  assert.ok(counted.rawReads >= RAW_READS.length, `${counted.rawReads} raw reads`);
});

test('the exceptions are pinned: two keys only the validator reads, the unread list says why, and NOT_READS reaches only config.ts\'s validator and writers', () => {
  assert.deepEqual(Object.keys(VALIDATOR_ONLY).sort(), ['environments[].branch', 'schema'], 'a key nothing else reads goes on UNREAD_KEYS, with the ticket that will read it');
  for (const [k, why] of Object.entries({ ...UNREAD_KEYS, ...VALIDATOR_ONLY })) {
    assert.ok((CONFIG_KEYS as readonly string[]).includes(k), `${k} is a key parseConfig knows`);
    assert.ok(why!.trim().length > 10, `${k} says why`);
  }
  for (const [k, files] of Object.entries(READ_IN)) assert.ok(files!.length, `${k} names a file`);

  assert.deepEqual(Object.keys(NOT_READS).sort(), ['packages/core/src/config.ts', 'scripts/settings.ts']);
  const config = sources(ROOT).files.find((s) => s.file === 'packages/core/src/config.ts')!;
  const text = config.code.join('\n');
  // The validator's and the writers' mentions are gone; the helpers that act on a key are still there.
  for (const gone of ['export function parseConfig', 'unknownKeys(raw)', 'export function writeConfig', 'export function withTracker', 'export const CONFIG_KEYS']) assert.ok(!text.includes(gone), gone);
  for (const kept of ['export const autoMergeOn', 'export function defaultEnvironment', 'export function keyPrefix', 'export function requiredGates']) assert.ok(text.includes(kept), kept);
  assert.ok(!sources(ROOT).files.some((s) => s.file === 'scripts/settings.ts' || s.file.includes('/test/')), 'not this check, nor the tests');
});

// ---------------------------------------------------------------- each finding, on a repo of its own

const roots: string[] = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });

const DESIGN = (...rows: string[]) => `# Design\n\n## 4. Config\n\n| Field | Meaning |\n|---|---|\n${rows.join('\n')}\n\nAfter the table.\n\n## 5. Tasks\n\n| Field | Meaning |\n|---|---|\n| \`trackers\` | Not §4's |\n`;
const PACKAGE = (...names: string[]) => JSON.stringify({ contributes: { configuration: { properties: Object.fromEntries(names.map((n) => [`agentCommandCenter.${n}`, { type: 'boolean' }])) } } });
const GET = (name: string) => `export const on = () => vscode.workspace.getConfiguration('agentCommandCenter').get<boolean>('${name}', true);\n`;

/** A repo where gates.severity and trackers[].team are read and described, and the setting quiet is read and named. */
const CLEAN: Record<string, string> = {
  'docs/DESIGN.md': DESIGN('| `gates` | Checks. `severity` is the level that fails |', '| `trackers` | Where tickets come from. An Azure one may name a `team` |'),
  'README.md': '# Tool\n\n## Settings\n\n- `agentCommandCenter.quiet`: say less.\n',
  'extension/package.json': PACKAGE('quiet'),
  'extension/src/notices.ts': GET('quiet'),
  'packages/core/src/gates.ts': 'export const level = (config: Config) => config.gates.severity;\n',
  'extension/src/trackers.ts': 'export const team = (t: Tracker) => t.team;\n',
};

function check(files: Record<string, string | null>, over: Partial<SettingsInputs> = {}): Finding[] {
  const root = tempDir('acc-settings-');
  roots.push(root);
  for (const [f, text] of Object.entries({ ...CLEAN, ...files })) {
    if (text === null) continue;
    mkdirSync(dirname(join(root, f)), { recursive: true });
    writeFileSync(join(root, f), text);
  }
  return checkSettings({
    root, keys: ['gates.severity', 'trackers[].team'], unread: {}, validatorOnly: {}, readIn: { 'trackers[].team': ['extension/src/trackers.ts'] }, rawReads: [], notReads: {}, ...over,
  }).findings;
}

test('a repo where every key and setting is read and described has nothing to say', () => {
  assert.deepEqual(check({}).map(say), []);
});

test('a key nothing reads is named, with where it was looked for and the three ways to fix it', () => {
  const [f, ...rest] = check({ 'packages/core/src/gates.ts': 'export const level = 2;\n' });
  assert.equal(rest.length, 0);
  assert.equal(f!.key, 'gates.severity');
  assert.equal(f!.missing, 'read');
  assert.match(say(f!), /^gates\.severity has no read: no `gates\.severity` in packages\/\*\/src, extension\/src, extension\/webview, scripts, outside the tests and config\.ts's validator\. Read it, take it out of Config and CONFIG_KEYS, or list it in UNREAD_KEYS \(packages\/core\/src\/config\.ts\) with the ticket or decision that will read it\./);
});

test('a comment, a message, a test or the validator naming a key doesn\'t read it', () => {
  const unread = (files: Record<string, string | null>, over: Partial<SettingsInputs> = {}) => check({ 'packages/core/src/gates.ts': null, ...files }, over).map((f) => `${f.key} ${f.missing}`);
  assert.deepEqual(unread({ 'packages/core/src/a.ts': '// config.gates.severity is the level\n/**\n * config.gates.severity\n */\n' }), ['gates.severity read']);
  assert.deepEqual(unread({ 'packages/core/src/a.ts': 'throw new Error(\'"gates.severity" must be 1 to 5\');\n' }), ['gates.severity read']);
  assert.deepEqual(unread({ 'packages/core/test/a.test.ts': 'assert.equal(config.gates.severity, 2);\n', 'scripts/test/b.test.ts': 'config.gates.severity;\n' }), ['gates.severity read']);
  const validator = 'export function parseConfig(raw) {\n  const g = raw.gates;\n  return { severity: config.gates.severity };\n}\n';
  assert.deepEqual(unread({ 'packages/core/src/config.ts': validator }, { notReads: { 'packages/core/src/config.ts': ['parseConfig'] } }), ['gates.severity read']);
  assert.deepEqual(unread({ 'packages/core/src/config.ts': `${validator}export const level = (config) => config.gates.severity;\n` }, { notReads: { 'packages/core/src/config.ts': ['parseConfig'] } }), [], 'a helper beside the validator does read it');
  assert.deepEqual(unread({ 'extension/webview/page.ts': 'show(model.config.gates?.severity);\n' }), [], 'nor does gates?.severity, in the webview');
});

test('a key read through a variable is found only in the files READ_IN names, and a stale pointer says so', () => {
  const [moved] = check({ 'extension/src/trackers.ts': 'export const none = 1;\n', 'extension/src/boards.ts': 'export const team = (t: Tracker) => t.team;\n' });
  assert.equal(moved!.key, 'trackers[].team');
  assert.match(say(moved!), /^trackers\[\]\.team has no read: no `\.team` in extension\/src\/trackers\.ts\. .*point READ_IN in scripts\/settings\.ts at the file that reads it now\.$/);
  const [gone] = check({ 'extension/src/trackers.ts': null });
  assert.match(say(gone!), /no `\.team` in extension\/src\/trackers\.ts \(extension\/src\/trackers\.ts isn't there\)/);
  const [none] = check({}, { readIn: {} });
  assert.match(say(none!), /^trackers\[\]\.team has no read found: it's read through a variable, and READ_IN in scripts\/settings\.ts names no file that reads it\./);
});

test('a READ_IN entry that pins the read counts only a read of the config, not the same name on something else', () => {
  const pinned = { readIn: { 'trackers[].team': [{ file: 'extension/src/trackers.ts', via: /\bt\.team\b/g }] } };
  const issueOnly = { 'extension/src/trackers.ts': 'export const team = (issue: Issue) => issue.team;\n' };
  assert.deepEqual(check({}, pinned), [], 't.team reads it, and a global pattern is tested a line at a time all the same');
  assert.deepEqual(check(issueOnly), [], 'unpinned, any .team counts');
  const [other, ...rest] = check(issueOnly, pinned);
  assert.equal(rest.length, 0);
  assert.ok(say(other!).startsWith('trackers[].team has no read: no /\\bt\\.team\\b/g in extension/src/trackers.ts. '), say(other!));

  // The real entries, on the real files with the config's read taken out: an issue's labels, or another
  // .name, isn't a read of trackers[].labels or environments[].name.
  for (const [key, file, read, unrelated] of [
    ['trackers[].labels', 'packages/core/src/intake.ts', /\btracker\?\.labels\b/g, /\bi\.labels\b/],
    ['environments[].name', 'packages/core/src/packet.ts', /\benv\.name\b/g, /\btask\.name\b/],
  ] as const) {
    const real = `${readFileSync(join(ROOT, file), 'utf8')}export const shown = (task: { name: string }) => task.name;\n`;
    const without = real.replace(read, 'undefined');
    assert.notEqual(without, real, `${file} reads ${key}`);
    assert.match(without, unrelated, `${file} still reads .${key.split('.').pop()} off something else`);
    const unreadIn = (text: string) => check({ [file]: text }, { keys: [key], readIn: { [key]: READ_IN[key]! } }).filter((f) => f.missing === 'read').map((f) => f.key);
    assert.deepEqual(unreadIn(real), [], `${key} is read in ${file}`);
    assert.deepEqual(unreadIn(without), [key], `only ${read.source} reads ${key}`);
  }
});

test('a key DESIGN §4 doesn\'t describe is named, with the row to add or the parent row to extend', () => {
  const [inParent] = check({ 'docs/DESIGN.md': DESIGN('| `gates` | Checks |', '| `trackers` | Where tickets come from. An Azure one may name a `team` |') });
  assert.equal(inParent!.missing, 'design');
  assert.equal(say(inParent!), 'gates.severity isn\'t described in docs/DESIGN.md §4. Name `severity` in backticks in its `gates` row, or add a row | `gates.severity` | what it does |.');
  const [noRow] = check({ 'docs/DESIGN.md': DESIGN('| `trackers` | Where tickets come from. An Azure one may name a `team` |') });
  assert.equal(say(noRow!), 'gates.severity isn\'t described in docs/DESIGN.md §4. Add a row | `gates.severity` | what it does | to the Field table.');
  // Its own row, or a parent row naming its whole path, describe it too; another section's table and §4's example don't.
  assert.deepEqual(check({ 'docs/DESIGN.md': DESIGN('| `gates.severity` | The level |', '| `trackers` | An Azure one names a `team` |') }), []);
  assert.deepEqual(check({ 'docs/DESIGN.md': DESIGN('| `gates` | `gates.severity` is the level |', '| `trackers` | An Azure one names a `team` |') }), []);
  assert.deepEqual(check({ 'docs/DESIGN.md': DESIGN('| `gates` | `severity` is the level |') }).map((f) => `${f.key} ${f.missing}`), ['trackers[].team design']);
});

test('a contributed setting nothing reads, or the README doesn\'t name, is named with its fix', () => {
  const findings = check({ 'extension/package.json': PACKAGE('quiet', 'loud') }).map(say);
  assert.deepEqual(findings, [
    'agentCommandCenter.loud is contributed in extension/package.json, but nothing in extension/src reads it with getConfiguration(\'agentCommandCenter\').get(\'loud\'). Read it, or take it out of contributes.configuration in extension/package.json: VSCode\'s Settings can\'t hide one that does nothing.',
    'agentCommandCenter.loud isn\'t described in README.md. Say what `agentCommandCenter.loud` does in README.md\'s Settings part.',
  ]);
  // Read only in a test, or only in extension/README.md, isn't enough.
  const elsewhere = check({ 'extension/src/notices.ts': '', 'extension/test/notices.test.ts': GET('quiet'), 'README.md': '# Tool\n', 'extension/README.md': '`agentCommandCenter.quiet`\n' });
  assert.deepEqual(elsewhere.map((f) => `${f.key} ${f.missing}`), ['agentCommandCenter.quiet read', 'agentCommandCenter.quiet readme']);
});

test('code that reads a setting the extension doesn\'t contribute is named, where it reads it', () => {
  const findings = check({ 'extension/src/panels.ts': `${GET('wide')}vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('agentCommandCenter.tall'));\n` });
  assert.deepEqual(findings.map(say), [
    'agentCommandCenter.wide is read in extension/src/panels.ts:1, but extension/package.json doesn\'t contribute it. Add it to contributes.configuration in extension/package.json, with a description, or stop reading it.',
    'agentCommandCenter.tall is read in extension/src/panels.ts:2, but extension/package.json doesn\'t contribute it. Add it to contributes.configuration in extension/package.json, with a description, or stop reading it.',
  ]);
});

test('a key on the unread list that something reads fails, so it comes off the list', () => {
  const findings = check({}, { unread: { 'gates.severity': 'GH-1 will read it.' } });
  assert.deepEqual(findings.map(say), ['gates.severity is read in packages/core/src/gates.ts:1; take it off the unread list. Take it out of UNREAD_KEYS in packages/core/src/config.ts: something reads it now.']);
  assert.equal(findings[0]!.missing, 'listed');
  // Unread and listed, it passes; listed but pointed at, the pointer is stale.
  assert.deepEqual(check({ 'packages/core/src/gates.ts': null }, { unread: { 'gates.severity': 'GH-1 will read it.' } }), []);
  assert.deepEqual(check({ 'packages/core/src/gates.ts': null }, { validatorOnly: { 'gates.severity': 'Checked, never used.' } }), [], 'a validator-only key needs no read');
  const pointed = check({ 'extension/src/trackers.ts': null }, { unread: { 'trackers[].team': 'GH-1 will read it.' } });
  assert.deepEqual(pointed.map((f) => `${f.key} ${f.missing}`), ['trackers[].team listed']);
  assert.match(say(pointed[0]!), /^trackers\[\]\.team is listed as not read, but READ_IN points at extension\/src\/trackers\.ts\./);
});

test('a listed key read through a variable, in a file READ_IN names for its siblings, fails the list too', () => {
  const keys = ['gates.severity', 'trackers[].team', 'agents.builder.model', 'agents.builder.fallbackModel'];
  const docs = DESIGN('| `gates` | `severity` |', '| `trackers` | `team` |', '| `agents` | A role\'s `model` and `fallbackModel` |');
  const over = { keys, readIn: { 'trackers[].team': ['extension/src/trackers.ts'], 'agents.builder.model': ['packages/core/src/agents.ts'] }, unread: { 'agents.builder.fallbackModel': 'GH-1 will read it.' } };
  const agents = (files: Record<string, string>) => check({ 'docs/DESIGN.md': docs, ...files }, over);
  assert.deepEqual(agents({ 'packages/core/src/agents.ts': 'export const flags = (p?: Profile) => [p?.model];\n' }), []);
  assert.deepEqual(agents({ 'packages/core/src/agents.ts': 'export const flags = (p?: Profile) => [p?.model, p?.fallbackModel];\n' }).map(say), [
    'agents.builder.fallbackModel is read in packages/core/src/agents.ts:1; take it off the unread list. Take it out of UNREAD_KEYS in packages/core/src/config.ts: something reads it now.',
  ]);
  // Away from its siblings' files, .fallbackModel on a variable isn't its read; builder.fallbackModel is, anywhere.
  const elsewhere = (text: string) => agents({ 'packages/core/src/agents.ts': 'export const flags = (p?: Profile) => [p?.model];\n', 'packages/core/src/other.ts': text }).map((f) => `${f.key} ${f.missing}`);
  assert.deepEqual(elsewhere('export const f = (x: Profile) => x.fallbackModel;\n'), []);
  assert.deepEqual(elsewhere('export const f = (agents: Agents) => agents.builder?.fallbackModel;\n'), ['agents.builder.fallbackModel listed']);

  // On the repo: agentArgs reads p?.fallbackModel for every role, so listing the builder's fails.
  const key = 'agents.builder.fallbackModel';
  const readIn = Object.fromEntries(Object.entries(READ_IN).filter(([k]) => k !== key));
  const real = checkSettings({ unread: { [key]: 'GH-1 will read it.' }, readIn }).findings;
  assert.deepEqual(real.map((f) => `${f.key} ${f.missing}`), [`${key} listed`]);
  assert.match(say(real[0]!), /^agents\.builder\.fallbackModel is read in packages\/core\/src\/agents\.ts:\d+; take it off the unread list\./);
});

test('a raw read of .acc/config.json that names a key parseConfig doesn\'t know is named, and a raw-read place that finds no read fails', () => {
  const rawReads = [{ file: 'scripts/packaging.ts', why: 'release', reads: [{ pattern: /\bfield\(config, '(\w+)', '(\w+)'\)/g, keys: (m: RegExpMatchArray) => [`${m[1]}.${m[2]}`] }] }];
  const keys = ['gates.severity', 'trackers[].team', 'github.repo'];
  const docs = DESIGN('| `gates` | `severity` |', '| `trackers` | `team` |', '| `github.repo` | The repo |');
  const text = 'const repo = field(config, \'github\', \'repo\');\nconst who = field(config, \'github\', \'login\');\n';
  const findings = check({ 'scripts/packaging.ts': text, 'docs/DESIGN.md': docs, 'packages/core/src/land.ts': 'export const repo = (config: Config) => config.github?.repo;\n' }, { keys, rawReads });
  assert.deepEqual(findings.map(say), ['github.login is read raw in scripts/packaging.ts:2, but parseConfig doesn\'t know it. Add it to Config and CONFIG_KEYS in packages/core/src/config.ts, or stop reading it.']);
  // A level that holds keys, such as github or trackers, is known too.
  const levels = check({ 'scripts/packaging.ts': 'const raw = JSON.parse(text);\nraw.trackers = [];\n' }, { rawReads: [{ file: 'scripts/packaging.ts', why: 'x', reads: [{ pattern: /\braw\.(\w+)/g, keys: (m) => [m[1]!] }] }] });
  assert.deepEqual(levels, []);
  const empty = check({ 'scripts/packaging.ts': 'export {};\n' }, { rawReads });
  assert.deepEqual(empty.map(say), ['scripts/packaging.ts is on RAW_READS, but no read of .acc/config.json is found there. Point RAW_READS in scripts/settings.ts at where the config is read raw now, or take the place off.']);
  assert.equal(empty[0]!.missing, 'pointer');
});

test('the intake skill\'s raw reads of the tracker\'s place are pinned, so a renamed key it still names fails', () => {
  const skill = RAW_READS.find((r) => r.file === 'plugin/skills/intake/SKILL.md');
  assert.ok(skill, 'the intake skill is on RAW_READS');
  const text = readFileSync(join(ROOT, skill.file), 'utf8');
  const named = skill.reads.flatMap(({ pattern, keys }) => [...text.matchAll(pattern)].flatMap(keys));
  for (const k of ['trackers[].repo', 'trackers[].labels']) assert.ok(named.includes(k), `the skill reads ${k}`);

  // The real skill on a repo of its own: as written, every key it reads is known; with `repo` renamed, that
  // line is named; gone, the place fails.
  const raw = (files: Record<string, string | null>) => check(files, { keys: CONFIG_KEYS, rawReads: [skill] }).filter((f) => f.missing === 'known' || f.missing === 'pointer').map(say);
  assert.deepEqual(raw({ [skill.file]: text }), []);
  const renamed = text.replace('tracker\'s `repo`', 'tracker\'s `repository`');
  assert.notEqual(renamed, text);
  const line = renamed.split('\n').findIndex((l) => l.includes('`repository`')) + 1;
  assert.deepEqual(raw({ [skill.file]: renamed }), [`trackers[].repository is read raw in ${skill.file}:${line}, but parseConfig doesn't know it. Add it to Config and CONFIG_KEYS in packages/core/src/config.ts, or stop reading it.`]);
  assert.deepEqual(raw({}), [`${skill.file} is on RAW_READS, but no read of .acc/config.json is found there (it isn't there). Point RAW_READS in scripts/settings.ts at where the config is read raw now, or take the place off.`]);
});

test('a NOT_READS declaration that isn\'t there fails, so the list can\'t outlive what it names', () => {
  const findings = check({ 'packages/core/src/config.ts': 'export function parseConfig() {}\n' }, { notReads: { 'packages/core/src/config.ts': ['parseConfig', 'parseConfigs'], 'packages/core/src/gone.ts': ['x'] } });
  assert.deepEqual(findings.map(say), [
    'parseConfigs in packages/core/src/config.ts is on NOT_READS, but isn\'t there. Take it off NOT_READS in scripts/settings.ts, or name the declaration as it\'s called now.',
    'packages/core/src/gone.ts is on NOT_READS, but isn\'t there. Take it off NOT_READS in scripts/settings.ts, or name the declaration as it\'s called now.',
  ]);
});
