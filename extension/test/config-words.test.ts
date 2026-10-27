// Setup and the settings speak in processes too (GH-168): no claude or gh command line and no dotted config key
// reaches a person outside work data. These tests pin the words for each config key, how the words reach text
// from acc, what another tool's command line is named as, and the words check's three new rules.
import assert from 'node:assert/strict';
import test from 'node:test';
import { CONFIG_KEYS } from '../../packages/core/src/config.ts';
import { BREW_INSTALL, INSTALL_LINES, INSTALL_SYSTEMS, installCommand } from '../../packages/core/src/onboarding/install-lines.ts';
import { STEPS } from '../../packages/core/src/onboarding/steps.ts';
import { CONFIG_WORDS, DOTTED_KEYS, escapeRegExp, inConfigWords } from '../src/logic/config-words.ts';
import { inProcessWords, toolLineDoes } from '../src/logic/processes.ts';
import { setupModel } from '../src/model/setup.ts';
import { type GeoSaid, judgeWords, WORD_RULES } from '../scripts/words.ts';
import { sampleSetup } from '../scripts/fixtures/setup.ts';

const said = (text: string, work: string | null = null): GeoSaid => ({ what: 'p.note', text, work });
const rulesHit = (s: string): string[] => WORD_RULES.filter((r) => r.pattern.test(s)).map((r) => r.name);

test('every config key acc\'s schema knows has a name, and a name belongs to a key that is still there', () => {
  assert.ok(CONFIG_KEYS.length >= 60, `${CONFIG_KEYS.length} keys`);
  assert.deepEqual(Object.keys(CONFIG_WORDS).sort(), [...CONFIG_KEYS].sort());
  const named = new Map<string, string>();
  for (const key of CONFIG_KEYS) {
    const words = CONFIG_WORDS[key];
    assert.ok(/^[A-Za-z][A-Za-z' -]+[A-Za-z]$/.test(words), `${key}: "${words}" is words`);
    assert.deepEqual(rulesHit(words), [], `${key}'s name names no command, path or key`);
    assert.ok(!named.has(words), `${key} and ${named.get(words)} share the name "${words}"`);
    named.set(words, key);
  }
  assert.equal(CONFIG_WORDS['gates.required'], 'its required checks');
  assert.equal(CONFIG_WORDS['agents.max'], 'its builder limit');
});

test('the keys a team template can differ on have names: each agent role\'s settings too', () => {
  for (const role of ['builder', 'reviewer']) {
    for (const k of ['model', 'effort', 'fallbackModel']) assert.ok(`agents.${role}.${k}` in CONFIG_WORDS, `agents.${role}.${k}`);
  }
  for (const k of ['profile', 'gates.required', 'gates.commands', 'gates.heavy', 'gates.severity', 'autonomy', 'agents.max']) assert.ok(k in CONFIG_WORDS, k);
});

test('the words check finds each of the schema\'s dotted keys, and only those', () => {
  for (const k of DOTTED_KEYS) assert.deepEqual(rulesHit(`set in ${k}.`), ['a config key'], k);
  assert.ok(DOTTED_KEYS.includes('gates.required') && DOTTED_KEYS.includes('agents.max') && DOTTED_KEYS.includes('trackers[].kind'));
  assert.ok(!DOTTED_KEYS.includes('profile' as never) && !DOTTED_KEYS.includes('autonomy' as never), 'a word with no dot is just a word');
});

test('acc\'s text reaches a person with each key in words, and a key in brackets said only where it is kept is dropped', () => {
  assert.equal(
    inConfigWords('ACME tools has changed since this project was made from it, and this project differs on gates.required, agents.max. The fix previews what it would write.'),
    'ACME tools has changed since this project was made from it, and this project differs on its required checks, its builder limit. The fix previews what it would write.',
  );
  assert.equal(inConfigWords('6 tasks are running in this project, and its cap is 6 (agents.max).'), '6 tasks are running in this project, and its cap is 6.');
  assert.equal(inConfigWords('This project runs at most 2 at once (agents.max, the Command Center\'s default: .acc/config.json sets none).'), 'This project runs at most 2 at once (the Command Center\'s default: .acc/config.json sets none).');
  assert.equal(inConfigWords('Give each one under "gates.commands", or `gates.ratchets` for a number.'), 'Give each one under its checks\' commands, or its floors for a number.');
  assert.equal(inProcessWords('No gates. List them under "gates.commands" in .acc/config.json.'), 'No gates. List them under its checks\' commands in the project\'s settings.');
});

test('the GitHub commands in acc\'s messages become what they do, and sign-in is said as signing in', () => {
  assert.equal(
    inProcessWords('To use your GitHub Project\'s columns, give jordan-kim access to Projects. gh refreshes only its active account, so run gh auth switch -u jordan-kim, then gh auth refresh -h github.com -s project and sign in as jordan-kim, then switch back to the account you use.'),
    'To use your GitHub Project\'s columns, give jordan-kim access to Projects. gh refreshes only its active account, so switch GitHub\'s active account to jordan-kim, then give it access to Projects and sign in as jordan-kim, then switch back to the account you use.',
  );
  assert.equal(inProcessWords('gh couldn\'t read the Project: give jordan-kim access to Projects with gh auth refresh -h github.com -s project.'), 'gh couldn\'t read the Project: give jordan-kim access to Projects.');
  assert.equal(inProcessWords('Give the account access to Projects: gh auth refresh -h github.com -s project'), 'Give the account access to Projects');
  assert.equal(inProcessWords('gh isn\'t logged in as jordan-kim. Run: gh auth login'), 'gh isn\'t logged in as jordan-kim. Sign in to GitHub');
  assert.equal(inProcessWords('Sign in from Setup, or run gh auth login.'), 'Sign in from Setup, or sign in to GitHub.');
  assert.equal(inProcessWords('Each repo uses its own GitHub account, asked for by name each time.'), 'Each repo uses its own GitHub account, asked for by name each time.');
});

test('edge cases: code that reads a key, a word with no dot, a longer name that starts like a key, and an empty message are left as they were', () => {
  for (const s of ['', 'The profile is salesforce.', 'p.config.gates.required', 'config.agents.max', 'gates.requiredFoo', 'my-gates.required', 'Nothing to say.']) assert.equal(inConfigWords(s), s, s);
  assert.equal(inConfigWords('agents.builder.model'), 'the builders\' model', 'the longest key that matches is the one named');
  assert.equal(inConfigWords('agents.max, agents.max'), 'its builder limit, its builder limit', 'each one, not just the first');
});

test('another tool\'s command line is named by what it does, for each line the steps can give', () => {
  const lines: [string, string][] = [
    ['claude plugin marketplace add https://github.com/jack-huffman/agent-command-center && claude plugin install acc@agent-command-center --scope user', "Install the Command Center's Claude Code plugin"],
    ['claude plugin install acc@agent-command-center --scope user', "Install the Command Center's Claude Code plugin"],
    ['claude plugin marketplace update agent-command-center && claude plugin update acc@agent-command-center --scope user', "Update the Command Center's Claude Code plugin"],
    ['claude plugin enable acc@agent-command-center --scope user', "Turn on the Command Center's Claude Code plugin"],
    ['claude update', 'Update Claude Code'],
    ['claude   # then accept the trust prompt and type /exit', 'Open Claude Code in this folder, to trust it'],
    ['brew install --cask claude-code', 'Install Claude Code'],
    ['irm https://claude.ai/install.ps1 | iex', 'Install Claude Code'],
    ['curl -fsSL https://claude.ai/install.sh | bash', 'Install Claude Code'],
    ['winget install --id Git.Git -e', 'Install git'],
    ['winget install --id OpenJS.NodeJS.LTS -e', 'Install Node'],
    ['winget install --id GitHub.cli -e', 'Install the GitHub command line'],
    ['sudo apt-get install git', 'Install git'],
    ['gh auth login   # as jordan-kim', 'Sign in to GitHub as this repo\'s account'],
    ['gh repo edit acme/service --default-branch dev', 'Set the repo\'s default branch on GitHub'],
    ['git config user.name "A" && git config user.email "a@example.com"', 'Set the name and email on this repo\'s commits'],
    ['cd "/work/acme" && npm install', 'Install the project\'s tools'],
    // The same lines as Do it builds them on Windows, where PowerShell 5.1 has no && (T-124).
    ['claude plugin marketplace add https://github.com/jack-huffman/agent-command-center; if ($?) { claude plugin install acc@agent-command-center --scope user }', "Install the Command Center's Claude Code plugin"],
    ['claude plugin marketplace update agent-command-center; if ($?) { claude plugin update acc@agent-command-center --scope user }', "Update the Command Center's Claude Code plugin"],
    ["git config user.name 'A'; if ($?) { git config user.email a@example.com }", 'Set the name and email on this repo\'s commits'],
    ["cd '/work/acme'; if ($?) { npm install }", 'Install the project\'s tools'],
    ['winget install --id Git.Git -e', 'Install git'],
    ['sf org login web --alias "dev" --instance-url https://acme.my.salesforce.com', 'Log in to the org'],
  ];
  for (const [line, does] of lines) assert.equal(toolLineDoes(line), does, line);
  // Each line of the install table, and Homebrew's installer, is named without being typed here: the words come from the table (T-124).
  let fromTable = 0;
  for (const tool of Object.keys(INSTALL_LINES) as (keyof typeof INSTALL_LINES)[]) {
    for (const system of INSTALL_SYSTEMS) {
      const c = installCommand(tool, system);
      if (c) { fromTable++; assert.notEqual(toolLineDoes(c), null, `${tool} on ${system}`); }
    }
  }
  assert.ok(fromTable >= 10, `${fromTable} table lines checked`);
  assert.equal(toolLineDoes(BREW_INSTALL), 'Install Homebrew');
  // Every command a step carries as its fix, whatever the check works out, is named.
  const fixed = STEPS.flatMap((s) => (s.fix?.command && !s.fix.command.startsWith('acc ') ? [s.fix.command] : []));
  assert.ok(fixed.length >= 8, `${fixed.length} commands`);
  for (const c of fixed) assert.notEqual(toolLineDoes(c), null, `${c} has words`);
});

test('edge cases: advice that isn\'t a command, an acc line and an empty line have no tool words', () => {
  for (const s of ['', 'acc init --force', 'Remove them, rotate the credential, and rewrite history if it was pushed.', 'claude plugin frobnicate']) assert.equal(toolLineDoes(s), null, s);
});

test('a setup step the page names as a process keeps its command line to show on request, and advice with no process stays shown', () => {
  const m = setupModel(sampleSetup().items, new Set());
  const rows = m.parts.flatMap((p) => p.steps);
  const plugin = rows.find((r) => r.id === 'A4.plugin')!;
  assert.equal(plugin.does, "Install the Command Center's Claude Code plugin");
  assert.ok(plugin.fix?.startsWith('claude plugin marketplace add'), 'the line is kept for "Show the command"');
  const template = rows.find((r) => r.id === 'B0.template')!;
  assert.match(template.detail, /differs on its required checks, its builder limit\./);
  assert.equal(template.fix, null, 'acc\'s own line is a process, never shown');
  assert.equal(template.does, 'Set up this project, as a preview that changes nothing');
  for (const r of rows) assert.deepEqual(rulesHit(`${r.title} ${r.detail} ${r.why} ${r.does ?? ''}`), [], `${r.id} says nothing a person can't read`);
});

test('the words check also fails on a claude command, a gh command and a dotted config key, outside work data', () => {
  const v = judgeWords([
    said('claude plugin install acc@agent-command-center --scope user'), said('Run gh auth login first.'), said('differs on gates.required'), said('limit set by trackers[].kind'),
    said('Update gh pr list'), said('claude mcp add'),
  ]);
  assert.deepEqual(v.findings.map((f) => f.detail.replace(/^"[^"]*" names /, '')), [
    'a claude command: claude plugin', 'a gh command: gh auth', 'a config key: gates.required', 'a config key: trackers[].kind', 'a gh command: gh pr', 'a claude command: claude mcp',
  ]);
  const inWork = judgeWords([said('claude plugin install acc@agent-command-center --scope user', 'output'), said('gh auth login', 'transcript'), said('gates.required', 'files')]);
  assert.deepEqual(inWork.findings, [], 'work data is counted, never judged');
  assert.deepEqual([inWork.held.output, inWork.held.transcript, inWork.held.files], [1, 1, 1]);
});

test('edge cases: Claude Code as a name, claude or gh on their own, a command to install them, and code that reads a key pass the words check', () => {
  for (const ok of ['Claude Code is installed.', 'claude isn\'t installed.', 'claude 2.1.0 has no --bg.', 'gh isn\'t installed.', 'gh can act as jordan-kim', 'brew install gh', 'config.gates.required', 'profile', "Install the Command Center's Claude Code plugin"]) {
    assert.deepEqual(rulesHit(ok), [], ok);
  }
  for (const bad of ['claude plugin list --json', 'claude update', 'gh auth token -u x', 'gh repo edit acme/x', '"gates.commands"', 'agents.permissionMode']) assert.equal(rulesHit(bad).length, 1, bad);
});

test('escapeRegExp matches text literally, every special character included, and an empty string matches only an empty one', () => {
  for (const t of ['gates.required', 'a+b*c?', '(x)[y]{z}', '^$|\\', 'acc@agent-command-center']) assert.ok(new RegExp(`^${escapeRegExp(t)}$`).test(t), t);
  assert.equal(new RegExp(`^${escapeRegExp('gates.required')}$`).test('gatesXrequired'), false, 'a dot is a dot');
  assert.equal(new RegExp(`^${escapeRegExp('')}$`).test(''), true);
});
