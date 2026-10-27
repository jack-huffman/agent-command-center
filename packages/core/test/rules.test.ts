// Shared rules (GH-108): copied into the repo with where they came from, read only from the repo's own
// files, in one fixed order, and updated only when a person chooses.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { test } from 'node:test';
import { analysisPrompt } from '../src/analyze.ts';
import { parseConfig } from '../src/config.ts';
import { dispatch } from '../src/dispatch.ts';
import { run, type RunOptions, type RunResult } from '../src/exec.ts';
import { emptyLedger, moveTask, mutate, noGateHooks, upsertTasks } from '../src/ledger.ts';
import { renderPacket } from '../src/packet.ts';
import { repoPaths } from '../src/paths.ts';
import { reviewPrompt } from '../src/review.ts';
import {
  BASE_RULES, importedRules, importRules, parseRulesFile, PROFILE_RULES, renderHeader, RULES_ORDER, rulesDiff, rulesDigest, rulesStatus, rulesText, templateRulesProblem, withoutHeader,
} from '../src/rules.ts';
import { bad, fakeRunner, GENERIC_CONFIG, gitIn, launchedSessions, makeRepo, ok, SF_CONFIG, tempDir } from './support.ts';

const ACME = '# ACME rules\n\n- Every Apex class has a test class named <Class>Test.\n- Name custom fields in PascalCase, with no underscores but __c.\n';
const now = () => new Date(2026, 9, 7, 9, 30);

/** A team's rules file on this machine, outside the repo. */
function teamFile(text = ACME, name = 'acme-salesforce.md'): string {
  const file = join(tempDir('team-'), name);
  writeFileSync(file, text);
  return file;
}

const status = (repo: string) => git(repo, 'status', '--porcelain', '--untracked-files=all');
const git = (dir: string, ...a: string[]) => gitIn(dir, ...a);

// ---------------------------------------------------------------- importing

test('a path is copied into .acc/rules/ under its own name, after a header naming where it came from, and nothing else changes', () => {
  const repo = makeRepo();
  const home = dirname(dirname(teamFile()));
  const file = teamFile();
  const r = importRules(run, repo, file, { home, now });
  assert.equal(r.written, true);
  assert.equal(r.file, '.acc/rules/acme-salesforce.md');
  assert.equal(status(repo), '?? .acc/rules/acme-salesforce.md', 'one new file; a person commits it');
  const text = readFileSync(join(repo, r.file), 'utf8');
  const parsed = parseRulesFile(text);
  assert.equal(parsed.problem, null);
  assert.equal(parsed.body, ACME, 'the source\'s text follows the header unchanged');
  assert.deepEqual(parsed.header, { source: `~/${file.slice(home.length + 1).split(sep).join('/')}`, commit: null, copied: '2026-10-07', sha256: rulesDigest(ACME) }, 'a home path is written ~/…, never in full (D-079)');
  assert.ok(!text.includes(home), 'no home path in the committed file');
  assert.equal(text, renderHeader(parsed.header!) + ACME, 'the header round-trips');
  assert.match(text.split('\n')[0]!, /^<!-- acc-rules v1: .*acc rules diff/);
});

test('--name names the copy, one already there is replaced only with force, and a dry run writes nothing', () => {
  const repo = makeRepo();
  const file = teamFile();
  const dry = importRules(run, repo, file, { name: 'ACME.md', dryRun: true, now });
  assert.deepEqual([dry.written, dry.file, dry.replaces], [false, '.acc/rules/acme.md', null]);
  assert.equal(status(repo), '', 'a dry run writes nothing');
  assert.throws(() => importRules(run, repo, file, { name: '../escape', now }), /can't be a rules file's name/);

  importRules(run, repo, file, { name: 'acme', now });
  writeFileSync(file, `${ACME}- A third rule.\n`);
  assert.throws(() => importRules(run, repo, file, { name: 'acme', now }), /\.acc\/rules\/acme\.md is already here, copied from .* on 2026-10-07\. To replace it .* add --force/);
  const preview = importRules(run, repo, file, { name: 'acme', dryRun: true, now });
  assert.equal(preview.replaces?.edited, false, 'a dry run says what it would replace');
  assert.equal(parseRulesFile(readFileSync(join(repo, '.acc/rules/acme.md'), 'utf8')).body, ACME, 'neither changed it');
  importRules(run, repo, file, { name: 'acme', force: true, now });
  assert.equal(parseRulesFile(readFileSync(join(repo, '.acc/rules/acme.md'), 'utf8')).body, `${ACME}- A third rule.\n`);
});

test('a GitHub file is read as the repo\'s account, never gh auth switch, and its header names the commit that last changed it', () => {
  const repo = makeRepo();
  const sha = 'c0ffee'.padEnd(40, '0');
  const calls: string[] = [];
  const runner = fakeRunner({
    'gh auth token -u acme-dev': ok('tok-acme\n'),
    'gh api repos/acme/acc-rules/contents/salesforce.md?ref=main': (o?: RunOptions) => (o?.env?.GH_TOKEN === 'tok-acme' ? ok(ACME) : bad('HTTP 401')),
    'gh api repos/acme/acc-rules/commits?path=salesforce.md&sha=main&per_page=1': (o?: RunOptions) => (o?.env?.GH_TOKEN === 'tok-acme' ? ok(`${sha}\n`) : bad('HTTP 401')),
  }, calls);
  const source = 'https://github.com/acme/acc-rules/blob/main/salesforce.md';
  const r = importRules(runner, repo, source, { account: 'acme-dev', now });
  assert.equal(r.file, '.acc/rules/salesforce.md');
  assert.deepEqual(parseRulesFile(readFileSync(join(repo, r.file), 'utf8')).header, { source, commit: sha, copied: '2026-10-07', sha256: rulesDigest(ACME) });
  assert.ok(calls.includes('gh api repos/acme/acc-rules/commits?path=salesforce.md&sha=main&per_page=1 --jq .[0].sha'));
  assert.ok(!calls.some((c) => c.startsWith('gh auth switch')), 'never gh auth switch (D-007)');
});

test('<git-url>#<path> is read from a shallow clone, with -- before the URL, and its header names the clone\'s commit', () => {
  const team = makeRepo({ 'rules/acme.md': ACME });
  const bare = join(tempDir('team-'), 'acc-rules.git');
  gitIn(team, 'clone', '-q', '--bare', team, bare);
  const repo = makeRepo();
  const calls: string[] = [];
  const r = importRules(fakeRunner({}, calls), repo, `${bare}#rules/acme.md`, { now });
  const header = parseRulesFile(readFileSync(join(repo, r.file), 'utf8')).header!;
  assert.deepEqual([r.file, header.source, header.commit], ['.acc/rules/acme.md', `${bare}#rules/acme.md`, gitIn(team, 'rev-parse', 'HEAD')]);
  assert.ok(calls.find((c) => c.startsWith('git clone'))!.includes(` -- ${bare} `), 'git reads the URL as a URL, never as an option');
});

test('import refuses what templates refuse, plus an empty file, and a total too big to send with every packet', () => {
  const repo = makeRepo();
  const calls: string[] = [];
  const runner = fakeRunner({}, calls);
  assert.throws(() => importRules(runner, repo, 'http://git.example.com/acme/r.git#acme.md'), /Use https:\/\/: acc doesn't fetch a rules file over plain http/);
  assert.throws(() => importRules(runner, repo, 'https://jordan:tok@github.com/acme/acc-rules/blob/main/x.md'), /Take the sign-in out of the URL: .*the copy's header/);
  assert.throws(() => importRules(runner, repo, '--upload-pack=touch owned#x.md'), /A rules file's source can't start with "-"/);
  assert.throws(() => importRules(runner, repo, 'https://example.com/acme.md'), /acc fetches a rules file only with gh or git/);
  assert.throws(() => importRules(runner, repo, teamFile('x'.repeat(65 * 1024))), /over 64 KB, too big for a rules file/);
  assert.throws(() => importRules(runner, repo, teamFile('\n  \n')), /is empty/);
  assert.deepEqual(calls, [], 'nothing was fetched');
  importRules(run, repo, teamFile('a'.repeat(60 * 1024), 'one.md'));
  importRules(run, repo, teamFile('b'.repeat(60 * 1024), 'two.md'));
  assert.throws(() => importRules(run, repo, teamFile('c'.repeat(20 * 1024), 'three.md')), /would come to 141 KB, over the 128 KB every packet, review and analysis can carry/);
  assert.equal(importedRules(repo).length, 2);
});

test('a header is read strictly: anything acc doesn\'t write is a problem, and a file with none is rules kept here', () => {
  const h = { source: 'https://github.com/acme/acc-rules/blob/main/x.md', commit: null, copied: '2026-10-07', sha256: rulesDigest('x') };
  const good = renderHeader(h) + 'x';
  assert.deepEqual(parseRulesFile(good).header, h);
  assert.deepEqual(parseRulesFile('# Just rules\n'), { header: null, problem: null, body: '# Just rules\n' });
  const broken = {
    'no end': good.replace('-->', ''),
    'extra key': good.replace('copied:', 'token: x\ncopied:'),
    'twice': good.replace('copied:', 'source: other\ncopied:'),
    'bad date': good.replace('2026-10-07', 'yesterday'),
    'bad digest': good.replace(h.sha256, 'abc'),
    'bad commit': good.replace('copied:', 'commit: main\ncopied:'),
  };
  for (const [what, text] of Object.entries(broken)) {
    const p = parseRulesFile(text);
    assert.equal(p.header, null, what);
    assert.match(p.problem!, /^Its header can't be read: /, what);
  }
});

test('a template\'s rules are a URL or a path from / or ~/: a relative path means a different file on each machine', () => {
  assert.equal(templateRulesProblem('https://github.com/acme/acc-rules/blob/main/salesforce.md'), null);
  assert.equal(templateRulesProblem('git@github.com:acme/acc-rules.git#salesforce.md'), null);
  assert.equal(templateRulesProblem('~/team/acme.md'), null);
  assert.equal(templateRulesProblem('/srv/team/acme.md'), null);
  assert.match(templateRulesProblem('team/acme.md')!, /relative path, which would mean a different file on each machine/);
  assert.match(templateRulesProblem('http://example.com/r.git#x.md')!, /Use https/);
});

test('docs/RULES.md\'s ACME sample copies in, and its header is the one acc writes', () => {
  const md = readFileSync(join(import.meta.dirname, '..', '..', '..', 'docs', 'RULES.md'), 'utf8');
  const [sample = '', copy = ''] = [...md.matchAll(/```markdown\n([\s\S]*?)```/g)].map((m) => m[1]!);
  assert.ok(sample.startsWith('# ACME Salesforce rules') && copy, 'docs/RULES.md has the sample, then its copy');
  const repo = makeRepo();
  const r = importRules(run, repo, teamFile(sample, 'salesforce.md'), { now });
  const written = readFileSync(join(repo, r.file), 'utf8');
  assert.equal(copy.split('\n')[0], written.split('\n')[0], 'the doc shows the header\'s first line as acc writes it');
  assert.deepEqual(copy.split('\n').slice(1, 5).map((l) => l.split(':')[0]), ['source', 'commit', 'copied', 'sha256'], 'and its keys, in order');
  assert.ok(rulesText(repo, 'salesforce')!.includes(sample.trim()));
});

// ---------------------------------------------------------------- the order

/** A Salesforce repo with the profile's rules, one copy and its own .acc/rules.md. */
function rulesRepo(raw: unknown = SF_CONFIG): { repo: string; config: ReturnType<typeof parseConfig>['config'] & {} } {
  const repo = makeRepo({ '.acc/config.json': JSON.stringify(raw), '.acc/rules.md': '- In this repo, triggers call a handler class; ACME\'s naming rule doesn\'t apply to tests.\n' });
  importRules(run, repo, teamFile(), { name: 'acme', now });
  importRules(run, repo, teamFile('- Log with ACME_Logger.\n'), { name: 'acme-logging', now });
  return { repo, config: parseConfig(raw).config! };
}

test('the packet has one Rules section: the profile\'s, then each copy by file name, then the repo\'s own, which win', () => {
  const { repo, config } = rulesRepo();
  const rules = rulesText(repo, config.profile)!;
  const l = emptyLedger();
  upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Add a field', brief: 'b' }], 'human', 'h', () => {}, now);
  const packet = renderPacket({ task: l.tasks[0]!, config, env: config.environments.find((e) => e.default)!, worktree: '/w', branch: 'b', rules, environmentSpecific: [] });
  const order = [
    '## Rules', RULES_ORDER, '### The Salesforce profile\'s rules', `- ${PROFILE_RULES.salesforce[0]}`,
    // By file name: acme-logging.md sorts before acme.md.
    '### Copied in from ', '(`.acc/rules/acme-logging.md`)', '- Log with ACME_Logger.',
    '(`.acc/rules/acme.md`)', '- Every Apex class has a test class',
    '### This repo\'s own rules (`.acc/rules.md`)', 'triggers call a handler class',
  ];
  const at = order.map((s) => packet.indexOf(s));
  assert.ok(at.every((i) => i >= 0), order.filter((_, i) => at[i]! < 0).join(' | '));
  assert.deepEqual([...at].sort((a, b) => a - b), at, 'in this order');
  assert.match(packet, /this repo's own rules win over the others/);
  assert.equal(packet.split('## Rules').length, 2, 'one Rules section');
  assert.ok(!packet.includes('acc-rules v1'), 'the header isn\'t sent to agents');

  // The reviewer and the analyst get the same text in the same order.
  const task = l.tasks[0]!;
  const review = reviewPrompt({ task, config, envName: 'Dev', envBranch: 'dev', sha: 'abcdef1', packet: 'p', diff: 'd', stat: 's', checks: [], rules });
  const analysis = analysisPrompt({ task, config, env: config.environments[0]!, root: repo, checkedOut: null, orgs: [], rules, previous: null });
  assert.ok(review.prompt.includes(`## Rules\n\n${rules}\n`));
  assert.ok(analysis.prompt.includes(`## Rules\n\n${rules}\n`));

  const generic = rulesText(rulesRepo(GENERIC_CONFIG).repo, 'generic')!;
  assert.ok(!generic.includes('profile\'s rules\n') && !generic.includes('Apex is') && generic.startsWith(RULES_ORDER), 'a generic project has no profile rules');
  // Every project's rules come before the profile's, in every profile (GH-104).
  assert.ok(rules.indexOf('### Every project\'s rules') < rules.indexOf('### The Salesforce profile\'s rules'));
  assert.equal(rulesText(makeRepo(), 'generic'), [RULES_ORDER, '', '### Every project\'s rules', '', ...BASE_RULES.map((r) => `- ${r}`)].join('\n'), 'with nothing else, every project\'s rules');
});

test('a source that moves changes nothing for the repo: the packet is the same, and dispatch reads no source', () => {
  const file = teamFile();
  const repo = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(GENERIC_CONFIG), '.gitignore': '.claude/worktrees/\n' }));
  importRules(run, repo, file, { name: 'acme', now });
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'Copy in ACME\'s rules');
  const config = parseConfig(GENERIC_CONFIG).config!;
  const paths = repoPaths(repo, run);
  mutate(paths, now, (l, emit) => { upsertTasks(l, config, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Write the changelog' }], 'human', 'human:test', emit, now); });
  const home = tempDir('home-');
  writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: { [repo]: { hasTrustDialogAccepted: true } } }));
  const calls: string[] = [];
  const runner = fakeRunner({ 'claude --bg': ok('backgrounded'), 'claude agents --json': launchedSessions(calls) }, calls);
  const deps = { run: runner, now, accBinDir: '/acc/bin', env: { HOME: home, PATH: '/usr/bin' }, findSessionMs: 0 };
  const go = () => dispatch(paths, config, 'T-1', deps, { actor: 'human', by: 'human:test' });
  const packetOf = () => readFileSync(join(paths.packets, 'T-1.md'), 'utf8');

  go();
  const first = packetOf();
  assert.ok(first.includes('- Every Apex class has a test class'), 'the worktree\'s committed copy is in the packet');
  renameSync(file, `${file}.moved`);
  moveTask(paths, config, 'T-1', { to: 'todo', actor: 'human', by: 'human:test', force: true, reason: 'again' }, noGateHooks, now);
  calls.length = 0;
  go();
  // The second run is also told the first left no note (D-106); the rest, rules and all, is the same.
  const again = packetOf();
  assert.ok(again.includes('## Your last run left no note'));
  assert.equal(again.replace(/## Your last run left no note\n\n[^\n]*\n\n/, ''), first, 'byte for byte the same');
  const reads = calls.filter((c) => !c.startsWith('claude '));
  assert.ok(!reads.some((c) => c.startsWith('gh ') || c.includes(dirname(file))), reads.join('\n'));

  const st = rulesStatus(runner, repo);
  assert.deepEqual(st.map((s) => [s.state, s.reason]), [['not-here', `It came from ${st[0]!.source}, which isn't on this machine.`]]);
  assert.equal(status(repo), '', 'and nothing in the repo changed');
});

// ---------------------------------------------------------------- updates are shown, never applied

test('a changed source is shown with its difference, and the copy stays as it was until a person imports it again', () => {
  const file = teamFile();
  const repo = makeRepo();
  importRules(run, repo, file, { name: 'acme', now });
  const copy = join(repo, '.acc/rules/acme.md');
  const before = readFileSync(copy, 'utf8');
  assert.deepEqual(rulesStatus(run, repo).map((s) => [s.name, s.state, s.edited]), [['acme', 'unchanged', false]]);

  // An edit made here isn't a change at the source.
  writeFileSync(copy, `${before}- This repo also logs every callout.\n`);
  assert.deepEqual(rulesStatus(run, repo).map((s) => [s.state, s.edited]), [['unchanged', true]]);
  writeFileSync(copy, before);

  writeFileSync(file, ACME.replace('PascalCase', 'camelCase'));
  assert.deepEqual(rulesStatus(run, repo).map((s) => s.state), ['changed']);
  const [d] = rulesDiff(run, repo, 'acme');
  assert.equal(d!.state, 'changed');
  assert.match(d!.diff!, /^--- \.acc\/rules\/acme\.md \(this repo's copy\)\n\+\+\+ .* \(the source now\)\n@@ /);
  assert.match(d!.diff!, /\n-- Name custom fields in PascalCase/);
  assert.match(d!.diff!, /\n\+- Name custom fields in camelCase/);
  assert.equal(readFileSync(copy, 'utf8'), before, 'checking and diffing never write');
  assert.throws(() => rulesDiff(run, repo, 'nope'), /There's no \.acc\/rules\/nope\.md/);
});

test('an unreachable source is noted, a header\'s bad source never reaches git, and nothing changes', () => {
  const repo = makeRepo();
  const source = 'https://github.com/acme/acc-rules/blob/main/salesforce.md';
  mkdirSync(join(repo, '.acc/rules'), { recursive: true });
  writeFileSync(join(repo, '.acc/rules/salesforce.md'), renderHeader({ source, commit: null, copied: '2026-10-01', sha256: rulesDigest(ACME) }) + ACME);
  writeFileSync(join(repo, '.acc/rules/evil.md'), renderHeader({ source: '--upload-pack=touch acc-owned#x.md', commit: null, copied: '2026-10-01', sha256: rulesDigest('x') }) + 'x');
  const calls: string[] = [];
  const down = (r: RunResult) => fakeRunner({ 'gh api repos/acme/acc-rules/contents/salesforce.md?ref=main': r }, calls);
  const st = rulesStatus(down({ code: 1, stdout: '', stderr: 'HTTP 502: Server Error' }), repo);
  assert.deepEqual(st.map((s) => s.state), ['bad-header', 'unreachable']);
  assert.match(st[0]!.reason!, /can't start with "-"/);
  assert.match(st[1]!.reason!, /Couldn't read https:\/\/github\.com\/acme\/acc-rules\/blob\/main\/salesforce\.md as gh's active account: HTTP 502/);
  assert.ok(!calls.some((c) => c.startsWith('git clone')), calls.join('\n'));
  assert.ok(!existsSync(join(repo, 'acc-owned')));
  assert.equal(rulesText(repo, 'generic')!.includes(ACME.trim()), true, 'the copy still reaches agents');
});

test('the copies share one wait: one not reached in time is unchecked, not read', () => {
  const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const repo = makeRepo();
  mkdirSync(join(repo, '.acc/rules'), { recursive: true });
  for (const n of ['a', 'b']) writeFileSync(join(repo, `.acc/rules/${n}.md`), renderHeader({ source: `https://github.com/acme/acc-rules/blob/main/${n}.md`, commit: null, copied: '2026-10-01', sha256: rulesDigest(n) }) + n);
  const calls: string[] = [];
  const slow = fakeRunner({ 'gh api repos/acme/acc-rules/contents/a.md?ref=main': () => { sleep(150); return ok('a'); } }, calls);
  const st = rulesStatus(slow, repo, { timeoutMs: 100 });
  assert.deepEqual(st.map((s) => s.state), ['unchanged', 'unchecked']);
  assert.ok(!calls.some((c) => c.includes('b.md')), 'b was never asked for');
  rmSync(join(repo, '.acc/rules'), { recursive: true });
  assert.deepEqual(rulesStatus(slow, repo), []);
});

test('no acc header reaches agents: a copy whose header can\'t be read is named so, and one imported from another project\'s copy loses its header', () => {
  const repo = makeRepo();
  mkdirSync(join(repo, '.acc/rules'), { recursive: true });
  const h = { source: 'https://github.com/acme/acc-rules/blob/main/x.md', commit: null, copied: '2026-10-07', sha256: rulesDigest('- Keep it tidy.\n') };
  // A broken header: a key acc doesn't write.
  writeFileSync(join(repo, '.acc/rules/broken.md'), renderHeader(h).replace('copied:', 'token: x\ncopied:') + '- Keep it tidy.\n');
  const text = rulesText(repo, 'generic')!;
  assert.match(text, /### Copied in, but its header can't be read \(`\.acc\/rules\/broken\.md`\)\n\n- Keep it tidy\./);
  assert.ok(!text.includes('<!-- acc-rules'), text);
  // Another project's copy, copied in again: its header is in the body.
  assert.equal(withoutHeader(renderHeader(h) + '- Keep it tidy.\n'), '- Keep it tidy.\n');
  assert.equal(withoutHeader('# Just rules\n'), '# Just rules\n');
  assert.equal(withoutHeader('<!-- acc-rules v1: with no end\n- A rule.\n'), '- A rule.\n', 'an unclosed header loses its first line');
});

test('acc rules diff <name> reads only that copy\'s source', () => {
  const repo = makeRepo();
  mkdirSync(join(repo, '.acc/rules'), { recursive: true });
  for (const n of ['a', 'b']) writeFileSync(join(repo, `.acc/rules/${n}.md`), renderHeader({ source: `https://github.com/acme/acc-rules/blob/main/${n}.md`, commit: null, copied: '2026-10-01', sha256: rulesDigest(n) }) + n);
  const calls: string[] = [];
  const st = rulesStatus(fakeRunner({}, calls), repo, {}, 'a');
  assert.deepEqual(st.map((s) => s.name), ['a']);
  assert.ok(!calls.some((c) => c.includes('b.md')), calls.join('\n'));
  assert.throws(() => rulesDiff(fakeRunner({}, []), repo, 'c'), /There's no \.acc\/rules\/c\.md/);
});
