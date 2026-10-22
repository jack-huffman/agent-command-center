// The Command Center speaks in processes, not acc's commands or its paths (GH-163). The screenshot run's
// words check reads every page it draws; these tests pin its rules, how far each kind of work data reaches,
// and the words that never reach a drawing: notices, the status bar, quick picks and the walkthrough.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { STEPS } from '../../packages/core/src/onboarding/steps.ts';
import { stepDescription, stepMedia, WALKTHROUGHS } from '../src/logic/setup.ts';
import { ACC_COMMANDS, type GeoSaid, judgeWords, RETIRED, WORD_RULES, WORK_DATA } from '../scripts/words.ts';

const root = join(import.meta.dirname, '..');
const said = (text: string, work: string | null = null): GeoSaid => ({ what: 'p.note', text, work });
const rulesHit = (s: string): string[] => WORD_RULES.filter((r) => r.pattern.test(s)).map((r) => r.name);
/** The rules about names (T-96): acc by name, and a retired word. A line of code may name acc's own things, so these judge its strings alone. */
const NAMING = WORD_RULES.filter((r) => r.name === 'acc by name' || r.name === 'a retired word');
/** The rules a line of code is held to whole: a command, a path, a key. */
const codeHit = (s: string): string[] => WORD_RULES.filter((r) => !NAMING.includes(r) && r.pattern.test(s)).map((r) => r.name);

test('each rule finds what it names, and a process\'s words pass', () => {
  const v = judgeWords([
    said('Run acc gate run first.'), said('Run npm run lint.'), said('Set in .acc/config.json.'), said('Kept in ~/.acc/machine.json.'),
    said('See docs/FIRST-RUN.md.'), said('The packet says so.'),
    said('Run the checks, then finish the task.'), said('The project\'s settings name it.'),
  ]);
  assert.equal(v.examined, 8, 'it counts what it read');
  assert.deepEqual(v.findings.map((f) => f.detail.replace(/^"[^"]*" names /, '')), [
    'an acc command: acc gate', 'acc by name: acc', 'npm run: npm run', 'a path under .acc/: .acc/config.json.', 'a path under .acc/: .acc/machine.json.', 'a docs/ page: docs/FIRST-RUN.md', 'the packet: packet',
  ]);
});

test('edge cases: acc as a name is acc by name alone, a word that isn\'t acc\'s command is no command, and an empty drawing examines nothing', () => {
  assert.ok(ACC_COMMANDS.includes('gate') && ACC_COMMANDS.includes('done') && ACC_COMMANDS.length >= 35, 'from the CLI\'s own registry');
  for (const name of ['acc keeps the board.', 'acc\'s default is two.', 'acc drafted it.']) assert.deepEqual(rulesHit(name), ['acc by name'], name);
  for (const ok of ['Agent Command Center', 'a .acc file', 'The Command Center keeps the board.']) assert.deepEqual(rulesHit(ok), [], ok);
  for (const bad of ['acc done', 'acc sync moves it', '`acc rules diff acme`', 'acc deploy qa']) assert.deepEqual(rulesHit(bad), ['an acc command', 'acc by name'], bad);
  assert.deepEqual(judgeWords([]), { examined: 0, findings: [], held: Object.fromEntries(WORK_DATA.map((w) => [w.name, 0])) });
});

test('acc by name is a finding, whole word and any case, but not acc\'s ids, paths, plugin or file names (T-96)', () => {
  const rule = WORD_RULES.find((r) => r.name === 'acc by name')!;
  for (const bad of ['acc', 'Track in acc', 'Task kept by acc', 'acc finds the pull request', 'The versions of ACC.', 'Acc\'s notices', 'this acc (0.44.0)']) assert.ok(rule.pattern.test(bad), bad);
  for (const ok of ['acc.task.dispatch', '.acc/config.json', '~/.acc/machine.json', 'acc@agent-command-center', 'acc-push-guard.mjs', 'accept', 'accounts', 'Agent Command Center', 'macc']) assert.ok(!rule.pattern.test(ok), ok);
  const v = judgeWords([said('Task kept by acc'), said('Task kept by the Command Center'), said('acc done', 'transcript')]);
  assert.deepEqual(v.findings.map((f) => f.detail), ['"Task kept by acc" names acc by name: acc'], 'outside work data alone');
});

test('each retired word is a finding as a label, and the words that took its place pass (T-96)', () => {
  const rule = WORD_RULES.find((r) => r.name === 'a retired word')!;
  assert.deepEqual([...RETIRED].sort(), ['Agent board', 'Analyze', 'Dispatch', 'Land', 'Rework', 'Track', 'Track in acc', 'Waive']);
  for (const word of RETIRED) {
    assert.ok(rule.pattern.test(word), `${word} alone, as on a button`);
    assert.ok(rule.pattern.test(`${word} T-12`), `${word} with what it's done to`);
  }
  for (const bad of ['Dispatch anyway', 'Waive…', 'It\'s on the agent board.', 'Land: push and open the pull request']) assert.ok(rule.pattern.test(bad), bad);
  // Words that hold a retired one, and its lower case in running prose, aren't labels.
  for (const ok of ['Add to my work', 'My work', 'Make a plan', 'Build it', 'Open pull request', 'Sent back', 'Accept anyway', 'Tracker boards', 'Landing page', 'Tracking…', 'Dispatched', 'the land of', 'source tracking', 'Analyzer']) assert.ok(!rule.pattern.test(ok), ok);
  const v = judgeWords([said('Track'), said('Add to my work'), said('Rework', 'output')]);
  assert.deepEqual(v.findings.map((f) => f.detail), ['"Track" names a retired word: Track'], 'outside work data alone');
});

test('a rule taken away lets its word through: each new rule is what finds it (T-96)', () => {
  for (const [name, text] of [['acc by name', 'Task kept by acc'], ['a retired word', 'Dispatch']] as const) {
    assert.equal(judgeWords([said(text)]).findings.length, 1, `${text} is found`);
    assert.deepEqual(judgeWords([said(text)], WORD_RULES.filter((r) => r.name !== name)).findings, [], `without ${name}, ${text} passes`);
  }
});

test('work data is counted, never judged; a region WORK_DATA doesn\'t name is a finding', () => {
  const v = judgeWords([said('acc gate run static', 'transcript'), said('npm run lint -- --fix', 'transcript'), said('.acc/config.json', 'files'), said('acc done', 'notes')]);
  assert.equal(v.examined, 4);
  assert.deepEqual(v.held, { files: 1, branch: 0, transcript: 2, output: 0, 'agent-text': 0 });
  assert.deepEqual(v.findings, [{ what: 'p.note', detail: 'is marked as work data "notes", which WORK_DATA doesn\'t name' }]);
  for (const w of WORK_DATA) assert.ok(w.reason.length > 40, `${w.name} says why it stays literal`);
});

/** Every page module, and the lines in each that mark an element as work data, by kind. */
function marks(): Record<string, Record<string, number>> {
  const dir = join(root, 'webview');
  const out: Record<string, Record<string, number>> = {};
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts'))) {
    for (const line of readFileSync(join(dir, f), 'utf8').split('\n')) {
      if (!line.includes('work(')) continue;
      for (const m of line.matchAll(/, '([a-z-]+)'\)/g)) {
        const kind = m[1]!;
        if (!WORK_DATA.some((w) => w.name === kind) && !['transcript', 'files', 'branch', 'output', 'agent-text'].includes(kind)) continue;
        (out[f] ??= {})[kind] = (out[f]![kind] ?? 0) + 1;
      }
    }
  }
  return out;
}

/**
 * How far each kind of work data reaches (GH-163): the page marks only these, in only these places. A new
 * mark, or one gone, fails here first, so widening what stays literal is a change someone sees.
 */
const MARKS: Record<string, Record<string, number>> = {
  'agent-page.ts': { transcript: 4, output: 1, 'agent-text': 1 },
  'boards.ts': { branch: 1 },
  // A ticket's changes section (T-99): its planned and changed paths, which are the project's own.
  'changes.ts': { files: 2 },
  // Dispatch anyway's sheet: the files the task shares with work in flight (D-168).
  'dispatch-sheet.ts': { files: 1 },
  'dock-review.ts': { transcript: 6 },
  'dock.ts': { output: 3, files: 1 },
  'environments.ts': { branch: 1 },
  'history.ts': { transcript: 1, output: 1 },
  'questions.ts': { transcript: 1 },
  'record-changes.ts': { output: 1 },
  'review.ts': { files: 2, transcript: 2 },
  'rules.ts': { files: 1, transcript: 1, 'agent-text': 1 },
  'run-steps.ts': { output: 1 },
  'run-view.ts': { output: 1 },
  'setup.ts': { output: 1 },
  'task-page.ts': { files: 2, branch: 2, output: 1, transcript: 1 },
  // Verify the developer's work (T-84): the pull request's branches and commit, each check's own words, what the verifier wrote, and a finding's file.
  'verify.ts': { 'agent-text': 4, branch: 3, files: 1, output: 2 },
  'worktrees.ts': { branch: 1 },
};

test('work data is marked only where MARKS says, each kind WORK_DATA names is marked somewhere, and the page\'s kinds are WORK_DATA\'s', () => {
  assert.deepEqual(marks(), MARKS);
  const used = new Set(Object.values(MARKS).flatMap((k) => Object.keys(k)));
  assert.deepEqual([...used].sort(), WORK_DATA.map((w) => w.name).sort());
  const dom = readFileSync(join(root, 'webview', 'dom.ts'), 'utf8');
  const union = /export type WorkData = ([^;]+);/.exec(dom)![1]!.split('|').map((s) => s.trim().replace(/'/g, '')).sort();
  assert.deepEqual(union, WORK_DATA.map((w) => w.name).sort(), 'dom.ts\'s WorkData is WORK_DATA');
});

/** Every source file of the extension and its page, by path. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/**
 * The lines in the extension's code that may name a command or a path, each with why (GH-163): they run
 * a command, read or watch a file, or write the extension's own log, and no person reads them as words.
 * Each must still match a line, so the list only shrinks.
 */
const LITERAL: { name: string; file: RegExp; line: RegExp; reason: string }[] = [
  { name: 'the vocabulary itself', file: /^src\/logic\/(processes|config-words)\.ts$/, line: /./, reason: 'PROCESSES and FILES are where a command or a path becomes words, CONFIG_WORDS is where a config key does, and the translators read them there.' },
  { name: 'a line that sorts a command by what it needs', file: /^src\/logic\/runs\.ts$/, line: /needsTerminal = /, reason: 'The pattern tells which commands need a terminal to type into, so Do it opens one: it matches command lines and no person reads it.' },
  { name: 'a setting looked up by its key', file: /^src\/model\/settings\.ts$/, line: /autopilot\.autoMerge|agents\.cloud\.routine/, reason: 'The key the code finds a setting by, and checks acc still reads: what the page shows is the setting\'s own label.' },
  { name: 'a name looked up by its path', file: /^src\//, line: /\bfileName\('/, reason: 'The vocabulary is asked for a file\'s name by the path it\'s kept under; the person reads the name it gives.' },
  { name: 'a command line run in a terminal or the output panel', file: /^src\/(setup|tasks|autopilot|logic\/setup)\.ts$/, line: /runCommand\('acc |this\.send\(|'acc init', \.\.\.initArgs|\['acc rules import'|accCommand\} autopilot|\$\{acc\} (review|analyze)/, reason: 'What runs is the CLI itself, which a terminal and the output panel show as it runs: CLI output stays literal.' },
  { name: 'a file the extension reads or watches', file: /^src\/(extension|setup|tasks|logic\/setup)\.ts$/, line: /RelativePattern\(folder, '\.acc\/config\.json'\)|const files = '\{\.acc\/config\.json|featuredFor: \['sfdx-project\.json', '\.acc\/config\.json'\]|'packets', `\$\{n\.task\.id\}\.md`/, reason: 'A path the code opens or watches, or VSCode matches a folder against, which no person reads.' },
  { name: 'who acc records made a change', file: /^webview\/task-page\.ts$/, line: /\^acc sync\/\.test\(h\.by\)|by === 'acc sync'/, reason: 'A change\'s author as acc records it, matched so the page can say it in words: a refresh from GitHub reads "GitHub".' },
  { name: 'the extension\'s own log', file: /^src\/(extension|tasks|setup|trackers|sidebar)\.ts$/, line: /log\.(warn|info|error)\(|setup\.log\.warn\(/, reason: 'The Output panel\'s log records what the extension ran and what acc said, word for word, to diagnose a problem.' },
];

/** A line of code with its comments taken away: whole comment lines go, and a trailing // comment. */
const code = (line: string): string => (/^\s*(\/\/|\*|\/\*)/.test(line) ? '' : line.replace(/\s\/\/\s.*$/, ''));

test('no notice, quick pick, status bar or page string in the extension\'s code names a command or a path, but the named exceptions', () => {
  const files = [...sources(join(root, 'src')), ...sources(join(root, 'webview'))];
  assert.ok(files.length >= 100, `${files.length} files`);
  let lines = 0;
  const found: string[] = [];
  const used: Record<string, number> = Object.fromEntries(LITERAL.map((l) => [l.name, 0]));
  for (const f of files) {
    const rel = relative(root, f);
    for (const [i, raw] of readFileSync(f, 'utf8').split('\n').entries()) {
      const c = code(raw);
      if (!c.trim()) continue;
      lines++;
      if (!codeHit(c).length) continue;
      const ok = LITERAL.find((l) => l.file.test(rel) && l.line.test(c));
      if (ok) used[ok.name]!++;
      else found.push(`${rel}:${i + 1}: ${c.trim().slice(0, 140)}`);
    }
  }
  assert.ok(lines > 10000, `it read ${lines} lines of code`);
  assert.deepEqual(found, [], 'each names a process or a file by what it is, or is a named exception');
  for (const l of LITERAL) {
    assert.ok(used[l.name]! > 0, `${l.name} still matches a line: take it off LITERAL if not`);
    assert.ok(l.reason.length > 40, `${l.name} says why`);
  }
});

test('the walkthrough speaks in processes too: each step\'s page and description, and each walkthrough\'s title', () => {
  assert.ok(STEPS.length >= 30, `${STEPS.length} steps`);
  for (const s of STEPS) {
    for (const [what, text] of [['page', stepMedia(s)], ['description', stepDescription(s)]] as const) {
      // Another tool's command, shown to copy in a bash block, is that tool's line, not acc's.
      const words = text.replace(/```bash\n[\s\S]*?```/g, '');
      assert.deepEqual(rulesHit(words), [], `${s.id}'s ${what}: ${words.slice(0, 200)}`);
    }
    if (s.fix?.command?.startsWith('acc ')) assert.ok(!stepMedia(s).includes(s.fix.command), `${s.id}'s page names its process, not ${s.fix.command}`);
  }
  for (const w of Object.values(WALKTHROUGHS)) assert.deepEqual(rulesHit(`${w.title} ${w.description}`), []);
});

test('the commands and settings VSCode lists name no command or path', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { contributes: { commands: { title: string }[]; configuration: { properties: Record<string, { description?: string; markdownDescription?: string }> } } };
  const titles = manifest.contributes.commands.map((c) => c.title);
  assert.ok(titles.length >= 80);
  assert.deepEqual(titles.filter((t) => rulesHit(t).length), []);
  const settings = Object.entries(manifest.contributes.configuration.properties).map(([k, p]) => `${k}: ${p.description ?? ''} ${p.markdownDescription ?? ''}`);
  assert.ok(settings.length > 0);
  assert.deepEqual(settings.filter((s) => rulesHit(s).length), []);
});

/**
 * The strings in the extension's code that may say acc by name, or a retired word, each with why (T-96): they
 * run a command or name acc's own thing, and no person reads them as words. Each must still match a line.
 */
const NAMED: { name: string; file: RegExp; line: RegExp; reason: string }[] = [
  { name: 'the vocabulary itself', file: /^(src\/logic\/processes|webview\/plain-words)\.ts$/, line: /./, reason: 'processes.ts is where acc and its commands become words, and plain-words.ts says which words the Command Center retired: the translators read them there.' },
  { name: 'a command line run in a terminal or the output panel', file: /^src\/(setup|tasks|environments|sidebar|extension|logic\/setup)\.ts$/, line: /runCommand\('acc |this\.send\(|'acc init'|'acc rules import'|accCommand \?\? 'acc'|name = 'acc'|name: 'acc', cwd/, reason: 'What runs is the CLI itself, which a terminal and the output panel show as it runs: CLI output stays literal.' },
  { name: 'who acc records made a change', file: /^webview\/task-page\.ts$/, line: /\^acc sync\/\.test\(h\.by\)|by === 'acc sync'/, reason: 'A change\'s author as acc records it, matched so the page can say it in words: a refresh from GitHub reads "GitHub".' },
];

/** Every string literal on a line of code, quotes taken off. */
const literals = (line: string): string[] => [...line.matchAll(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0].slice(1, -1));
/** A string that names acc or a retired word: words with a space, since a lone 'acc' is a key the code looks things up by, never words. */
const namesHit = (s: string): string[] => {
  // A value put in, as ${acc}, and a key compared in one, as === 'acc', are the code's: the words around them are what a person reads.
  const words = s.replace(/\$\{[\w.]+\}/g, '').replace(/(['"])acc\1/g, '');
  return NAMING.filter((r) => r.pattern.test(words) && (r.name !== 'acc by name' || /\S\s+\S/.test(words))).map((r) => r.name);
};

test('no string in the extension\'s code says acc by name or a retired word, but the named exceptions: notices, quick picks and the status bar too (T-96)', () => {
  const files = [...sources(join(root, 'src')), ...sources(join(root, 'webview'))];
  let strings = 0;
  const found: string[] = [];
  const used: Record<string, number> = Object.fromEntries(NAMED.map((l) => [l.name, 0]));
  for (const f of files) {
    const rel = relative(root, f);
    for (const [i, raw] of readFileSync(f, 'utf8').split('\n').entries()) {
      const c = code(raw);
      if (!c.trim() || LITERAL.some((l) => l.name === 'the extension\'s own log' && l.file.test(rel) && l.line.test(c))) continue;
      for (const s of literals(c)) {
        strings++;
        if (!namesHit(s).length) continue;
        const ok = NAMED.find((l) => l.file.test(rel) && l.line.test(c));
        if (ok) used[ok.name]!++;
        else found.push(`${rel}:${i + 1}: ${s.slice(0, 140)}`);
      }
    }
  }
  assert.ok(strings > 10000, `it read ${strings} strings`);
  assert.deepEqual(found, [], 'each says the Command Center, or the new words, or is a named exception');
  for (const l of NAMED) {
    assert.ok(used[l.name]! > 0, `${l.name} still matches a line: take it off NAMED if not`);
    assert.ok(l.reason.length > 40, `${l.name} says why`);
  }
});
