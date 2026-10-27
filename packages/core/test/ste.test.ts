// The wording check (T-12): the TypeScript port of the copied skill's ste-lint.py. The first tests port each
// assertion of the Python's selftest(). The oracle test runs the Python, kept here as a fixture, and the port
// on the same texts and compares every finding.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { analysisPrompt, analysisProblems, parseAnalysis, STE_STRICT } from '../src/analyze.ts';
import { parseConfig, type Config } from '../src/config.ts';
import type { Task } from '../src/ledger.ts';
import { PART_WORDS, REQUIREMENT_PARTS, requirementWording, SYNONYM_GROUPS, splitLines, STE_MAX_WORDS, STE_RULES, type SteFinding, steLine, steLint, wordingPlace, wordingWords } from '../src/ste.ts';
import { GENERIC_CONFIG, tempDir } from './support.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const ORACLE = join(import.meta.dirname, 'fixtures', 'ste100', 'ste-lint.py');

const lint = (text: string, file?: string) => steLint(text, file);
const rules = (text: string): string[] => lint(text).findings.map((f) => f.rule);
const of = (text: string, rule: string): SteFinding[] => lint(text).findings.filter((f) => f.rule === rule);

// ---------------------------------------------------------------- the Python's selftest(), assertion by assertion

test('selftest: each pattern rule fires on the sample, and a hedge never does', () => {
  const found = new Set(rules('The panel is removed; spin up the job. Perform an analysis of the seamless log. We have received the report.'));
  for (const expected of ['semicolon', 'phrasal-verb', 'nominalization', 'marketing-adjective', 'passive-voice', 'present-perfect']) assert.ok(found.has(expected), expected);
  // Hedges are never flagged, a modal and a perfect infinitive included.
  assert.deepEqual(lint('The request may have failed. It could be a timeout. The disk might have filled.').findings, []);
});

test('selftest: irregular participles make a present perfect, but never after a modal, negated or spaced however', () => {
  assert.equal(of('The task has run. The job has set the flag. We have begun.', 'present-perfect').length, 3);
  assert.equal(of('The job may have run.', 'present-perfect').length, 0);
  for (const modal of ['may', 'might', 'could', 'should', 'would', 'must']) {
    for (const gap of [' ', '  ', '\t', ' not ']) assert.equal(of(`The task ${modal}${gap}have run.`, 'present-perfect').length, 0, `${modal}${JSON.stringify(gap)}`);
  }
  assert.equal(of('The task couldn\'t have run. The task MAY NOT HAVE RUN.', 'present-perfect').length, 0);
  const text = 'The task has run. We have begun. The flag is set.';
  assert.equal(of(text, 'present-perfect').length, 2);
  assert.ok(of(text, 'passive-voice').length > 0);
  assert.equal(of('The task is gone.', 'passive-voice').length, 0, '"is gone" is no passive');
});

test('selftest: code blocks are skipped, so a semicolon in one is no finding', () => {
  assert.deepEqual(lint('```\nx = a; y = b\n```').findings, []);
});

test('selftest: dangling conjunctions on every list marker, in either case, with trailing spaces', () => {
  const dangling = of('- Confirm the target and\n* Record the result OR  \n+ Close the panel\n1. Start the task and\n2) Stop the task OR', 'dangling-conjunction');
  assert.equal(dangling.length, 4);
  assert.deepEqual(dangling.map((f) => f.line), [1, 2, 4, 5]);
  assert.deepEqual(dangling.map((f) => f.col), [1, 1, 1, 1]);
  assert.ok(dangling.every((f) => f.level === 'hard'));
});

test('selftest: continuation lines, four-space code, quotes and fences are no dangling conjunction', () => {
  assert.equal(of('  - Confirm the target and\n    record the result.', 'dangling-conjunction').length, 0);
  const own = of('- Confirm the target\n  and', 'dangling-conjunction');
  assert.equal(own.length, 1);
  assert.equal(own[0]!.line, 2);
  assert.equal(own[0]!.col, 3);
  assert.equal(of('    - code and', 'dangling-conjunction').length, 0);
  assert.equal(of('> - Confirm the target and\n> - Record the result or', 'dangling-conjunction').length, 0);
  const fenced = of('- Do this and\n~~~\ncode and\n~~~', 'dangling-conjunction');
  assert.equal(fenced.length, 1);
  assert.equal(fenced[0]!.line, 1);
  assert.equal(of('```text\n- code and\n```', 'dangling-conjunction').length, 0);
});

test('selftest: one- and three-space markers, tabs, wide ordered markers, punctuation, blank lines and nesting', () => {
  assert.equal(of(' - Start the task and\n   record the result.', 'dangling-conjunction').length, 0);
  assert.equal(of('-  Start the task and\n   record the result.', 'dangling-conjunction').length, 0);
  assert.equal(of('-\tStart the task and', 'dangling-conjunction').length, 0, 'a tab after the marker is no list item');
  const three = lint('   - Start the task and', 'fixture.md').findings.filter((f) => f.rule === 'dangling-conjunction');
  assert.equal(three.length, 1);
  assert.equal(three[0]!.col, 4);
  assert.equal(three[0]!.file, 'fixture.md');
  assert.ok(three[0]!.match.endsWith('and'));
  assert.match(three[0]!.message, /Complete the item/);
  assert.equal(of('100. Start the task and\n  unrelated text', 'dangling-conjunction').length, 1);
  assert.equal(of('- Start the task and.\n- Stop the task or,', 'dangling-conjunction').length, 0);
  assert.equal(of('- Start the task and\n\n  record the result.', 'dangling-conjunction').length, 0);
  assert.deepEqual(of('- Parent item and\n  - Nested item or', 'dangling-conjunction').map((f) => f.line), [1, 2]);
});

test('selftest: prose, inline code and fenced code never end a list item on a conjunction', () => {
  assert.equal(of('The process may include steps and', 'dangling-conjunction').length, 0);
  assert.equal(of('- Use `and` as a label', 'dangling-conjunction').length, 0);
  assert.equal(of('- Combine `left` and `right`', 'dangling-conjunction').length, 0);
  assert.equal(of('~~~\n- code and\n~~~', 'dangling-conjunction').length, 0);
});

test('selftest: a sentence over the cap is long, and a table cell is checked on its own', () => {
  assert.ok(of(`${'word '.repeat(30).trim()}.`, 'long-sentence').length > 0);
  const short = `${Array.from({ length: 24 }, (_, i) => `term${i + 1}`).join(' ')}.`;
  for (const table of [`| Label | Detail |\n| --- | --- |\n| Clear | ${short} |`, `Label | Detail\n--- | ---\nClear | ${short}`]) {
    const r = lint(table);
    assert.equal(r.findings.filter((f) => f.rule === 'long-sentence').length, 0, 'table syntax is layout, not prose');
    assert.equal(r.words, 27);
  }
  const long = `${Array.from({ length: 26 }, (_, i) => `term${i + 1}`).join(' ')}.`;
  const found = of(`| Label | Detail |\n| --- | --- |\n| Clear | ${long} |`, 'long-sentence');
  assert.equal(found.length, 1);
  assert.equal(found[0]!.match, '26 words');
});

test('selftest: synonym rotation flags the second word and names the first as the keeper, and none for one word', () => {
  const rot = of('Check the config file. Then verify the output. Verify twice.', 'synonym-rotation');
  assert.equal(rot.length, 1);
  assert.match(rot[0]!.message, /'verify' and 'check'/);
  assert.equal(of('Check the config. Check the output.', 'synonym-rotation').length, 0);
});

test('selftest: each finding names its file', () => {
  assert.equal(lint('a; b', 'x.md').findings[0]!.file, 'x.md');
  assert.equal(lint('a; b').findings[0]!.file, '<stdin>', 'stdin when no file is named');
});

// ---------------------------------------------------------------- the port's own edges

test('an empty text has no findings and no words', () => {
  assert.deepEqual(lint(''), { findings: [], words: 0 });
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('a\r\nb c\n'), ['a', 'b', 'c'], 'every line break Python knows, and no empty line after the last');
});

test('the rules, the groups and the cap hold what the Python holds, and a finding prints as the Python prints it', () => {
  assert.deepEqual(STE_RULES.map((r) => [r.id, r.level]), [
    ['semicolon', 'hard'], ['phrasal-verb', 'hard'], ['marketing-adjective', 'hard'], ['nominalization', 'hard'], ['passive-voice', 'advisory'], ['present-perfect', 'advisory'],
  ]);
  assert.equal(SYNONYM_GROUPS.length, 10);
  assert.equal(STE_MAX_WORDS, 25);
  assert.equal(steLine(lint('a; b', 'x.md').findings[0]!), 'x.md:1:2 semicolon: STE bans the semicolon (Rule 8.1). Split into separate sentences. [;]');
});

test('columns count code points, as Python does, so an emoji before a semicolon counts once', () => {
  assert.equal(lint('😀 a; b').findings[0]!.col, 4);
  assert.equal(of('Ünïcödé wörds; are words.', 'semicolon')[0]!.col, 14);
});

// ---------------------------------------------------------------- the oracle

/** Texts both linters read: the selftest's samples, the port's edges, and every Markdown file of the plugin and the docs. */
function oracleTexts(): [string, string][] {
  const samples = [
    'The panel is removed; spin up the job. Perform an analysis of the seamless log. We have received the report.',
    'The request may have failed. It could be a timeout. The disk might have filled.',
    'The task has run. The job has set the flag. We have begun.',
    'The task couldn\'t have run. The task MAY NOT HAVE RUN. The task is gone.',
    '- Confirm the target and\n* Record the result OR  \n+ Close the panel\n1. Start the task and\n2) Stop the task OR',
    '- Confirm the target\n  and\n   - Start the task and\n100. Start the task and\n  unrelated text\n- Parent item and\n  - Nested item or',
    '- Do this and\n~~~\ncode and\n~~~\n- Combine `left` and `right`\n- Use `and` as a label',
    `| Label | Detail |\n| --- | --- |\n| Clear | ${'term '.repeat(30)}. |\n\nLabel | Detail\n--- | ---\nA; b | c \\| d`,
    'Check the config file. Then verify the output. Verify twice. Remove it, then delete it, then erase it.',
    '😀 a; b. Ünïcödé wörds; are words. Wir haben überprüft; dass es läuft.\r\nA second line a third; one.',
    'They are reaching out to kick off the robust, cutting-edge, blazing fast rollout. It was conducted the assessment. Carried out the inspection.',
    '',
  ];
  const md = (dir: string): string[] => readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(ROOT, dir, f);
    // Forward slashes on every system: each name below is made from them.
    const rel = relative(ROOT, p).replaceAll('\\', '/');
    return statSync(p).isDirectory() ? md(rel) : f.endsWith('.md') ? [rel] : [];
  });
  const files = [...md('plugin'), ...md('docs').filter((f) => !f.startsWith('docs/research')), '.acc/rules.md', 'README.md', 'CLAUDE.md'];
  return [...samples.map((s, i): [string, string] => [`sample-${i}.md`, s]), ...files.map((f): [string, string] => [f.replaceAll('/', '__'), readFileSync(join(ROOT, f), 'utf8')])];
}

test('the port finds what the Python oracle finds on every text, and the run fails without python3 or with no texts', () => {
  const version = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  assert.ok(!version.error && version.status === 0, `python3 isn't available, so the wording check's oracle can't run: install Python 3. (${version.error?.message ?? version.stderr})`);
  const texts = oracleTexts();
  assert.ok(texts.length > 0, 'no texts to compare');
  const dir = tempDir('ste-oracle-');
  for (const [name, text] of texts) writeFileSync(join(dir, name), text);
  // -I: the oracle reads no module from the folder it runs in, nor from the environment.
  const r = spawnSync('python3', ['-I', ORACLE, '--json', ...texts.map(([name]) => name)], { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  assert.ok(r.status === 0 || r.status === 1, `the oracle failed: ${r.stderr}`);
  const python = JSON.parse(r.stdout) as { violations: (Omit<SteFinding, 'level'> & { level: string })[]; words: number };
  const ours = texts.flatMap(([name, text]) => steLint(text, name).findings);
  const shape = (f: { file: string; line: number; col: number; rule: string; level: string; match: string; message: string }) => ({ ...f, level: f.level === 'advisory-free' ? 'hard' : f.level });
  assert.ok(python.violations.length > 100, `the oracle found only ${python.violations.length} findings: the texts are too thin to compare`);
  // The first text whose findings differ, named, so a doc edit elsewhere that reaches a corner the port gets
  // wrong says which file to look at.
  const key = (f: { file: string; line: number; rule: string }) => `${f.file}:${f.line} ${f.rule}`;
  const differs = texts.map(([name]) => name).find((name) => JSON.stringify(ours.filter((f) => f.file === name).map(key)) !== JSON.stringify(python.violations.filter((f) => f.file === name).map(key)));
  assert.equal(differs, undefined, `the port and the oracle first differ on ${differs?.replaceAll('__', '/')}`);
  // The rule and the line of each finding, then the rest of it.
  assert.deepEqual(ours.map(key), python.violations.map(key));
  assert.deepEqual(ours.map(shape), python.violations.map(shape));
  assert.equal(texts.reduce((n, [name, text]) => n + steLint(text, name).words, 0), python.words);
});

test('the oracle is the copied commit\'s ste-lint.py, unchanged, and its own selftest passes', () => {
  const sha = createHash('sha256').update(readFileSync(ORACLE)).digest('hex');
  assert.match(readFileSync(join(ROOT, 'plugin', 'skills', 'ste100', 'SOURCE.md'), 'utf8'), new RegExp(`ste-lint\\.py[^\\n]*${sha}`), 'SOURCE.md records the oracle\'s hash');
  const r = spawnSync('python3', ['-I', ORACLE, '--selftest'], { encoding: 'utf8' });
  assert.equal(r.stdout.trim(), 'selftest OK', r.stderr);
});

// ---------------------------------------------------------------- the analysis's requirements

const config = parseConfig(GENERIC_CONFIG).config as Config;

test('requirementWording records each hard finding with its line, and none for clean, empty or advisory-only lines', () => {
  const w = requirementWording({
    goal: 'Partners sign in to the new site; they see their deals.',
    criteria: ['The report lists each stage change.', 'Spin up the job and', ''],
    assumptions: ['The report was written by the admin.'],
    outOfScope: ['A seamless sign-in.'],
  });
  // A criterion is a list item, so one that ends on "and" dangles; the goal is a sentence.
  assert.deepEqual(w.map((f) => [f.part, f.index, f.rule]), [['goal', 0, 'semicolon'], ['criteria', 1, 'dangling-conjunction'], ['criteria', 1, 'phrasal-verb'], ['outOfScope', 0, 'marketing-adjective']]);
  assert.equal(w[2]!.text, 'Spin up the job and', 'the line it came from');
  assert.equal(w[2]!.match, 'Spin up');
  assert.deepEqual(requirementWording({ goal: 'Start the job and', criteria: [], assumptions: [], outOfScope: [] }), [], 'a goal is no list item');
  assert.deepEqual(requirementWording({ goal: '', criteria: [], assumptions: [], outOfScope: [] }), [], 'nothing to check');
  assert.deepEqual(REQUIREMENT_PARTS, ['goal', 'criteria', 'assumptions', 'outOfScope']);
});

test('each requirement line is checked on its own, so a synonym in another criterion is no rotation', () => {
  assert.deepEqual(requirementWording({ goal: '', criteria: ['Check the file.', 'Verify the output.'], assumptions: [], outOfScope: [] }), []);
});

test('wordingWords counts the findings, and says nothing for none', () => {
  assert.equal(wordingWords(0), null);
  assert.equal(wordingWords(1), 'Wording: 1 finding');
  assert.equal(wordingWords(2), 'Wording: 2 findings');
});

test('wordingPlace names the goal alone and counts the other parts from 1, in PART_WORDS\'s words', () => {
  assert.equal(wordingPlace({ part: 'goal', index: 0 }), 'Goal');
  assert.equal(wordingPlace({ part: 'criteria', index: 1 }), 'Criterion 2');
  assert.equal(wordingPlace({ part: 'outOfScope', index: 0 }), 'Out of scope 1');
  assert.deepEqual(Object.keys(PART_WORDS), [...REQUIREMENT_PARTS]);
});

test('acc records the wording of each requirement line as it reads an analysis, and none for clean lines', () => {
  const answer = (requirements: unknown) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 's', structured_output: { verdict: 'ready', summary: 'S.', requirements, questions: [], findings: [], approach: { plan: [], files: [], refactors: [], risks: [], tests: [], size: 'S' }, split: [] } });
  const dirty = parseAnalysis(answer({ goal: 'Kick off the sync.', criteria: ['The sync runs; it logs.'], assumptions: [], outOfScope: [] })).analysis;
  assert.deepEqual(dirty.wording!.map((f) => [f.part, f.index, f.rule, f.text]), [['goal', 0, 'phrasal-verb', 'Kick off the sync.'], ['criteria', 0, 'semicolon', 'The sync runs; it logs.']]);
  const clean = parseAnalysis(answer({ goal: 'The sync starts each hour.', criteria: ['The sync writes one log line.'], assumptions: [], outOfScope: [] })).analysis;
  assert.deepEqual(clean.wording, []);
});

test('a wording finding never holds a dispatch: it is advice for a person', () => {
  const task = { id: 'T-1', state: 'todo' } as Task;
  const wanting = { ...config, analysis: { required: true } } as Config;
  const paths = { analyses: tempDir('ste-analyses-') } as Parameters<typeof analysisProblems>[0];
  const a = parseAnalysis(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 's', structured_output: { verdict: 'ready', summary: 'S.', requirements: { goal: 'Spin up the job; then stop.', criteria: [], assumptions: [], outOfScope: [] }, questions: [], findings: [], approach: { plan: [], files: [], refactors: [], risks: [], tests: [], size: 'S' }, split: [] } })).analysis;
  writeFileSync(join(paths.analyses, 'T-1.json'), JSON.stringify({ v: 1, task: 'T-1', env: 'main', base: 'x', orgs: [], sessionId: 's', at: '', durationMs: 0, costUsd: null, ...a, approval: { version: 1, by: 'human:me', at: '' } }));
  assert.equal(a.wording!.length, 2);
  assert.deepEqual(analysisProblems(paths, wanting, task), []);
});

test('the analyst\'s prompt holds the STE Strict rules in full, so no skill needs installing', () => {
  const { system } = analysisPrompt({ task: { id: 'T-1', title: 't', brief: '', source: { kind: 'manual' } } as unknown as Task, config, env: config.environments[0]!, root: '/r', checkedOut: null, orgs: [], rules: null, previous: null });
  for (const line of STE_STRICT) assert.ok(system.includes(line), line);
  assert.match(system, /the goal, each acceptance criterion, each assumption and each out-of-scope item in Simplified Technical English \(ASD-STE100\), Strict mode/);
  for (const rule of ['active voice', 'semicolon', 'present perfect', 'phrasal verbs', 'one word for one thing', 'marketing adjectives', '3 nouns', '"and" or "or"', 'no more than 20 words']) assert.ok(system.includes(rule), rule);
  assert.doesNotMatch(system, /ste100|SKILL\.md|ste-lint/, 'it names no skill to load');
});

test('.acc/rules.md holds the STE rule and names packages/core/test/ste.test.ts as its check', () => {
  const md = readFileSync(join(ROOT, '.acc', 'rules.md'), 'utf8');
  const rule = md.split(/\n(?=- )/).map((r) => r.replace(/\s*\n\s*/g, ' ')).find((r) => r.includes('STE Strict mode'));
  assert.ok(rule, '.acc/rules.md has no STE rule');
  assert.match(rule, /Checked by `packages\/core\/test\/ste\.test\.ts`/);
  // The check: the analyst is told the rules, and acc checks each requirement line it reads back.
  assert.ok(STE_STRICT.length > 0);
  assert.equal(requirementWording({ goal: 'Spin up the job.', criteria: [], assumptions: [], outOfScope: [] }).length, 1);
});
