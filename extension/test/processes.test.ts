// The Command Center's words for acc's processes (GH-163): every command acc has gets a plain name in one
// table, and a message from acc reaches a person in those words, with no command or path left in it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { AREAS } from '../../packages/cli/src/commands/index.ts';
import { entryPointsOf } from '../../packages/cli/src/main.ts';
import { FILES, fileName, inProcessWords, processLine, processName, processOf, PROCESSES } from '../src/logic/processes.ts';
import { WORD_RULES } from '../scripts/words.ts';

const root = join(import.meta.dirname, '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { contributes: { commands: { command: string; title: string }[] } };
/** What the screenshot run's words check would find in a string, by rule. */
const breaks = (s: string): string[] => WORD_RULES.filter((r) => r.pattern.test(s)).map((r) => r.name);

test('every command acc has, and each of its subcommands, has a process name, from the CLI\'s own registry', () => {
  const entries = entryPointsOf(AREAS).map((e) => e.join(' '));
  assert.ok(entries.length >= 70, `${entries.length} commands`);
  const unnamed = entries.filter((e) => !processOf(e));
  assert.deepEqual(unnamed, [], 'each has a row in PROCESSES');
  const listed = PROCESSES.flatMap((p) => p.acc);
  assert.deepEqual(listed.filter((a) => !entries.includes(a)), [], 'and the table names no command acc doesn\'t have');
  assert.equal(new Set(listed).size, listed.length, 'each command is in one row');
});

test('no name is empty, a command line, a path, or another process\'s name', () => {
  const names = PROCESSES.map((p) => p.name);
  for (const p of PROCESSES) {
    assert.ok(p.name.trim().length > 0, `${p.acc[0]} has a name`);
    assert.match(p.name, /^[A-Z]/, `${p.name} starts with a capital, a verb first`);
    assert.deepEqual(breaks(p.name), [], `${p.name} is no command or path`);
    assert.ok(!/--|`|<|>/.test(p.name), `${p.name} has no flag, backtick or placeholder`);
    assert.ok(!p.acc.some((a) => p.name.toLowerCase() === `acc ${a}` || (a.includes(' ') && p.name.toLowerCase() === a)), `${p.name} isn't its command again`);
    if (p.named) assert.ok(p.named.includes('{arg}') && breaks(p.named).length === 0, `${p.named} says where its argument goes`);
  }
  assert.equal(new Set(names).size, names.length, `no two processes share a name: ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`);
});

test('the names the ticket asks for, and a process\'s button is a command the extension declares', () => {
  const asked: Record<string, string> = {
    'gate run': 'Run the checks', done: 'Finish the task', block: 'Mark it blocked', land: 'Open its pull request', sync: 'Refresh from GitHub',
    promote: 'Promote', intake: 'Bring in tickets', doctor: 'Check the setup', init: 'Set up this project', 'rules import': 'Import the team\'s rules',
  };
  for (const [acc, name] of Object.entries(asked)) assert.equal(processName(acc), name);
  assert.equal(processOf('deploy')?.named, 'Deploy to {arg}');
  const declared = new Set(manifest.contributes.commands.map((c) => c.command));
  for (const p of PROCESSES) if (p.command) assert.ok(declared.has(p.command), `${p.name}'s ${p.command} is declared in package.json`);
  assert.ok(PROCESSES.filter((p) => p.command).length >= 20, 'most processes a person starts have a button');
  assert.throws(() => processName('nonsense'), /No process is named for acc nonsense/, 'an unknown command fails loudly, not with empty words');
});

test('each file a person is told about has a name, and none is a path', () => {
  for (const f of FILES) {
    assert.ok(f.name.length > 0 && breaks(f.name).length === 0, `${f.path} is named "${f.name}"`);
    assert.ok(breaks(f.path).length > 0, `${f.path} is one the words check would find`);
  }
  assert.equal(fileName('.acc/config.json'), 'the project\'s settings');
  assert.equal(fileName('.acc/rules.md'), 'the project\'s rules');
  assert.equal(fileName('docs/FIRST-RUN.md'), 'the first-run checklist');
  assert.throws(() => fileName('.acc/nothing.json'));
});

/**
 * Messages acc writes for a person: its refusals, its Setup steps' words, the reasons its hooks give, as
 * core and the CLI write them today. Each must reach the page with no command or path left in it.
 */
const FROM_CORE: [string, string][] = [
  ['Checks haven\'t passed on abc1234: run acc gate run, then acc done.', 'Checks haven\'t passed on abc1234: run the checks, then "Finish the task".'],
  ['Run acc gate run first.', 'Run the checks first.'],
  ['Builders never push; acc land does that.', 'Builders never push; "Open its pull request" does that.'],
  ['Pull requests are a person\'s: acc land opens one after review, and a person merges it.', 'Pull requests are a person\'s: "Open its pull request" opens one after review, and a person merges it.'],
  ['acc done waits for every required check to pass, and a check whose tool is missing can only report an error.', '"Finish the task" waits for every required check to pass, and a check whose tool is missing can only report an error.'],
  ['No step B99. Run acc doctor to see them all.', 'No step B99. Check the setup to see them all.'],
  ['It was picked for ACME-1: pick another with acc dispatch ACME-1 --effort <level>, or drop it with acc dispatch ACME-1 --effort default.', 'It was picked for ACME-1: pick another with "Dispatch ACME-1 to an agent", or drop it with "Dispatch ACME-1 to an agent".'],
  ['Each step is a pull request (`acc promote`), and a deploy after it merges (`acc deploy`).', 'Each step is a pull request ("Promote"), and a deploy after it merges ("Deploy").'],
  ['Run `acc deploy qa --plan` to see what it would do.', 'Deploy to qa to see what it would do.'],
  ['It merged, so deploy it: acc deploy qa.', 'It merged, so deploy it: "Deploy to qa".'],
  ['acc deploy deploys Salesforce source to an org; this project is generic.', '"Deploy" deploys Salesforce source to an org; this project is generic.'],
  ['`.acc/config.json` names the environments, GitHub account and checks.', 'The project\'s settings name the environments, GitHub account and checks.'],
  ['There\'s no .acc/config.json yet.', 'There\'s no project settings file yet.'],
  ['Set in Acme Service\'s .acc/config.json, for everyone on the repo.', 'Set in Acme Service\'s settings, for everyone on the repo.'],
  ['Kept in ~/.acc/machine.json, for every repo.', 'Kept in this machine\'s settings, for every repo.'],
  ['.acc/rules/acme-salesforce.md has changed at the source since it was copied in.', 'The rules file acme-salesforce has changed at the source since it was copied in.'],
  ['A team\'s shared rules are copied into .acc/rules/, each with where it came from.', 'A team\'s shared rules are copied into the project\'s rules folder, each with where it came from.'],
  ['See docs/FIRST-RUN.md, then docs/RULES.md.', 'See the first-run checklist, then the rules guide.'],
  ['Its builder stopped before acc done or acc block.', 'Its builder stopped before "Finish the task" or "Mark it blocked".'],
  ['The packet says what to do.', 'The builder\'s instructions says what to do.'],
  ['ACME-4 is waiting: acc sync moves it to done once its pull request merges.', 'ACME-4 is waiting: "Refresh from GitHub" moves it to done once its pull request merges.'],
  ['Relax it with acc gate relax tests --to 1100 --reason "<why>" --task ACME-9, as a person.', 'Relax it with "Relax a floor", as a person.'],
  ['Run npm run lint, then commit.', 'Run the project\'s lint script, then commit.'],
];

test('a sample of acc\'s own messages reach a person in process words, with no command or path left in them', () => {
  assert.ok(FROM_CORE.length >= 20, `${FROM_CORE.length} messages`);
  for (const [from, to] of FROM_CORE) {
    assert.ok(breaks(from).length > 0, `the sample names a command or a path: ${from}`);
    const got = inProcessWords(from);
    assert.deepEqual(breaks(got), [], `nothing survives: ${got}`);
    assert.equal(got, to);
  }
});

test('edge cases: text with no command comes back as it was, acc as a name stays, and an empty message is empty', () => {
  for (const s of ['', 'acc keeps the board.', 'acc\'s default is two.', 'Nothing to do.', 'The account is acme-bot.', 'git push origin HEAD']) assert.equal(inProcessWords(s), s);
  assert.equal(inProcessWords('acc nonsense here'), 'acc nonsense here', 'a word that isn\'t one of acc\'s commands');
  assert.equal(inProcessWords('acc done'), '"Finish the task"', 'a command alone');
  assert.equal(inProcessWords('acc review ACME-12'), '"Review ACME-12 with an agent"', 'a task\'s key is what it\'s done to');
});

test('a command line Setup runs reads as its process; a dry run says it changes nothing, and another tool\'s line isn\'t acc\'s', () => {
  assert.equal(processLine('acc rules diff acme'), 'Compare the rules with their source');
  assert.equal(processLine('acc drift qa'), 'Check qa\'s org for drift');
  assert.equal(processLine('acc init --force'), 'Set up this project');
  assert.equal(processLine('acc init --from \'~/acme/tools.json\' --profile generic --dry-run'), 'Set up this project, as a preview that changes nothing');
  assert.equal(processLine('acc setup baseline'), 'Write the baseline manifest');
  for (const other of ['brew install gh', 'claude plugin install acc@agent-command-center --scope user', 'acc nonsense', '', 'gh auth login']) assert.equal(processLine(other), null, other);
});
