/**
 * The Command Center's words for acc's processes (GH-163). A person runs the checks, finishes a task, opens
 * its pull request: they don't type `acc gate run`. PROCESSES names each of acc's commands, as the CLI's
 * own registry lists them, in the words a person reads; it's the only place the extension maps a command
 * to words. FILES does the same for the files a person is told about: the project's settings, not
 * `.acc/config.json`.
 *
 * Text the extension writes uses these names. Text that comes from acc itself (a refusal, a Setup step's
 * detail, the reason a hook gave) passes through inProcessWords() on its way to a person, which rewrites
 * each command and path it knows. What stays literal, by design, is the page's work data (words.ts in the
 * screenshot scripts) and text written for agents.
 *
 * Like the rest of logic/, no `vscode` import: the page, the models and node:test all read it.
 */

import { escapeRegExp, inConfigWords } from './config-words.ts';
import { upper } from '../../webview/upper.ts';

export interface Process {
  /** acc's commands this process is, as the CLI names them: a command, or a command and its subcommand. */
  acc: readonly string[];
  /** What a person calls it: the words on its button where a button does it, a verb first. */
  name: string;
  /** The name with what it's done to, where a mention names it: {arg} is the environment or task. */
  named?: string;
  /** The acc.* command that does it from VSCode, where there is one; processes.test.ts checks it's declared. */
  command?: string;
}

/** Every acc process, in the order acc's help lists them. extension/test/processes.test.ts checks it covers every command. */
export const PROCESSES: readonly Process[] = [
  // Setup
  { acc: ['doctor'], name: 'Check the setup', command: 'acc.doctor' },
  { acc: ['onboard'], name: 'Walk through the setup' },
  { acc: ['setup'], name: 'Set up the environments' },
  { acc: ['setup baseline'], name: 'Write the baseline manifest' },
  { acc: ['setup branches'], name: 'Make the environment branches' },
  { acc: ['setup lists'], name: 'Draft the drift lists' },
  { acc: ['setup readme'], name: 'Write the README\'s environments table' },
  { acc: ['init'], name: 'Set up this project' },
  { acc: ['template', 'template show'], name: 'Read a team template' },
  { acc: ['rules import'], name: 'Import the team\'s rules', command: 'acc.importRules' },
  { acc: ['rules', 'rules list'], name: 'List the copied-in rules' },
  { acc: ['rules diff'], name: 'Compare the rules with their source' },
  { acc: ['rules suggested'], name: 'See the suggested rules' },
  { acc: ['rules accept'], name: 'Accept a suggested rule' },
  { acc: ['rules dismiss'], name: 'Dismiss a suggested rule' },
  { acc: ['ste', 'ste check'], name: 'Check the wording' },
  { acc: ['trackers', 'trackers set'], name: 'Connect a tracker', command: 'acc.trackers.add' },
  { acc: ['tracking'], name: 'Change whether the project uses source tracking', command: 'acc.settings.sourceTracking' },
  // Tasks
  { acc: ['add'], name: 'Add a task', command: 'acc.task.add' },
  { acc: ['edit'], name: 'Edit the task', named: 'Edit {arg}', command: 'acc.task.edit' },
  { acc: ['import'], name: 'Import tickets' },
  { acc: ['intake', 'intake github', 'intake jira', 'intake azure', 'intake monday', 'intake slack'], name: 'Bring in tickets', command: 'acc.task.intake' },
  { acc: ['status'], name: 'Count the tasks' },
  { acc: ['list'], name: 'List the tasks' },
  { acc: ['ready'], name: 'List the ready tasks' },
  { acc: ['show'], name: 'Show the task', named: 'Show {arg}', command: 'acc.task.show' },
  { acc: ['set'], name: 'Move the task', named: 'Move {arg}', command: 'acc.task.move' },
  { acc: ['tidy'], name: 'See the tidy-up' },
  { acc: ['tidy add'], name: 'Draft a tidy-up', command: 'acc.tidy.draft' },
  { acc: ['tidy skip'], name: 'Skip the tidy-up', command: 'acc.tidy.skip' },
  // Agents
  { acc: ['dispatch'], name: 'Dispatch to an agent', named: 'Dispatch {arg} to an agent', command: 'acc.task.dispatch' },
  { acc: ['done'], name: 'Finish the task' },
  { acc: ['block'], name: 'Mark it blocked', command: 'acc.task.block' },
  { acc: ['resume'], name: 'Resume its builder', named: 'Resume {arg}\'s builder', command: 'acc.task.resume' },
  { acc: ['collect'], name: 'Collect its work from the cloud', named: 'Collect {arg}\'s work from the cloud', command: 'acc.task.collect' },
  { acc: ['cleanup'], name: 'Clean up its worktree', named: 'Clean up {arg}\'s worktree', command: 'acc.task.cleanup' },
  { acc: ['agents', 'agents show'], name: 'See what agents run with' },
  { acc: ['agents set'], name: 'Change what agents run with', command: 'acc.agents.configure' },
  { acc: ['agents autonomy'], name: 'Change what autopilot may do', command: 'acc.agents.autonomy' },
  { acc: ['agents auto-merge'], name: 'Change whether autopilot merges', command: 'acc.agents.autoMerge' },
  { acc: ['agents max'], name: 'Change how many builders run at once', command: 'acc.settings.agentsMax' },
  { acc: ['machine'], name: 'See this machine\'s limits' },
  { acc: ['machine heavy-slots'], name: 'Change how many heavy checks run at once', command: 'acc.settings.heavySlots' },
  { acc: ['machine agents'], name: 'Change how many builders this machine runs', command: 'acc.settings.machineAgents' },
  { acc: ['analyze'], name: 'Analyze before the build', named: 'Analyze {arg} before the build', command: 'acc.task.analyze' },
  { acc: ['analysis'], name: 'See the analysis' },
  { acc: ['analysis answer'], name: 'Answer its questions' },
  { acc: ['draft', 'draft criteria'], name: 'Draft acceptance criteria', named: 'Draft {arg}\'s acceptance criteria' },
  { acc: ['draft show'], name: 'See the drafted acceptance criteria' },
  { acc: ['draft update'], name: 'Open the draft as an update' },
  { acc: ['verify'], name: 'Verify the developer\'s pull request', named: 'Verify {arg}\'s pull request' },
  { acc: ['verify show'], name: 'See the verification' },
  { acc: ['verify clear'], name: 'Clear the verification' },
  { acc: ['review'], name: 'Review with an agent', named: 'Review {arg} with an agent', command: 'acc.task.review' },
  { acc: ['land'], name: 'Open its pull request', named: 'Open {arg}\'s pull request', command: 'acc.task.land' },
  { acc: ['autopilot'], name: 'Run autopilot', command: 'acc.autopilot.toggle' },
  { acc: ['sync'], name: 'Refresh from GitHub' },
  // Cloud builders (GH-69)
  { acc: ['cloud', 'cloud status'], name: 'See the cloud builders\' setup' },
  { acc: ['cloud enable'], name: 'Turn cloud builders on', command: 'acc.cloud.enable' },
  { acc: ['cloud disable'], name: 'Turn cloud builders off', command: 'acc.cloud.disable' },
  { acc: ['cloud token'], name: 'Keep the routine\'s token', command: 'acc.cloud.token' },
  // Ticket updates
  { acc: ['updates', 'update'], name: 'See the update drafts' },
  { acc: ['update post', 'update posting', 'update posted', 'update release'], name: 'Post the update' },
  { acc: ['update discard'], name: 'Discard the update' },
  { acc: ['update ask'], name: 'Ask the client' },
  // Environments
  { acc: ['promote'], name: 'Promote', named: 'Promote {arg}', command: 'acc.env.promote' },
  { acc: ['deploy'], name: 'Deploy', named: 'Deploy to {arg}', command: 'acc.env.deploy' },
  { acc: ['hook', 'hook session-start', 'hook pre-tool-use', 'hook stop'], name: 'Keep builders on their task' },
  { acc: ['hook permission'], name: 'Ask you before an agent runs a command' },
  // GitHub
  { acc: ['github', 'github status'], name: 'Check the GitHub account' },
  { acc: ['github use'], name: 'Switch this repo\'s GitHub account', command: 'acc.github.switch' },
  // Checks
  { acc: ['gate run'], name: 'Run the checks' },
  { acc: ['gate', 'gate list'], name: 'See the checks' },
  { acc: ['gate waive'], name: 'Set checks aside' },
  { acc: ['gate relax'], name: 'Relax a floor' },
  { acc: ['gate required'], name: 'Change the required checks', command: 'acc.settings.requiredGates' },
  { acc: ['gate builder'], name: 'Change builders\' lighter checks', command: 'acc.settings.builderGates' },
  { acc: ['drift'], name: 'Check the org for drift', named: 'Check {arg}\'s org for drift' },
];

/** The process for an acc command, as words: "gate run", or "done". */
export function processOf(acc: string): Process | undefined {
  return PROCESSES.find((p) => p.acc.includes(acc));
}

/** A process's name, by its acc command: the one place the extension's own text gets it. */
export function processName(acc: string): string {
  const p = processOf(acc);
  if (!p) throw new Error(`No process is named for acc ${acc}.`);
  return p.name;
}

/** A file a person is told about, by what it is. */
export interface NamedFile {
  /** How acc and its messages write it. */
  path: string;
  /** What it is, as a person reads it in a sentence: "the project's settings". */
  name: string;
  /** What it is after "no", "a" or "each": "There's no project settings file yet." */
  noun: string;
}

/** Each file, by what it is (GH-163). */
export const FILES: readonly NamedFile[] = [
  { path: '~/.acc/machine.json', name: 'this machine\'s settings', noun: 'machine settings file' },
  { path: '.acc/config.json', name: 'the project\'s settings', noun: 'project settings file' },
  { path: '.acc/rules.md', name: 'the project\'s rules', noun: 'project rules file' },
  { path: '.acc/floors.json', name: 'the project\'s floors', noun: 'floors file' },
  { path: 'docs/FIRST-RUN.md', name: 'the first-run checklist', noun: 'first-run checklist' },
  { path: 'docs/ONBOARDING.md', name: 'the onboarding guide', noun: 'onboarding guide' },
];

/** A file's name, by its path: the one place the extension's own text gets it. */
export function fileName(path: string): string {
  const f = FILES.find((x) => x.path === path);
  if (!f) throw new Error(`No name for ${path}.`);
  return f.name;
}

const lower = (s: string): string => s.charAt(0).toLowerCase() + s.slice(1);

/** acc's commands, longest first, so "gate run" is found before "gate". */
const FORMS = PROCESSES.flatMap((p) => p.acc.map((a) => ({ a, p, at: new RegExp(`^${escapeRegExp(a)}(?![\\w-])`) }))).sort((x, y) => y.a.length - x.a.length);
/** English that can follow a command line, and is never one of its arguments. */
const ENGLISH = new Set(['a', 'after', 'again', 'an', 'and', 'any', 'as', 'at', 'before', 'but', 'by', 'first', 'for', 'from', 'if', 'in', 'instead', 'is', 'it', 'its', 'later', 'now', 'on', 'once', 'or', 'so', 'that', 'the', 'then', 'to', 'until', 'when', 'with']);
const FLAG = /^--[\w-]+(?:=\S+)?$/;
const KEY = /^[A-Z][A-Z0-9]*-\d+$/;
const PLACEHOLDER = /^(?:<[^>]+>|\[[^\]]*\]|"[^"]*"|'[^']*')$/;
const PLAIN = /^[\w.@/~:+-]+$/;
/** A verb after a file that becomes a plural name, as it reads after one. */
const AGREE: Record<string, string> = { has: 'have', is: 'are', was: 'were', names: 'name', sets: 'set', says: 'say', holds: 'hold', lists: 'list', keeps: 'keep', needs: 'need', gives: 'give', doesn: 'don' };

/**
 * The words after a command in running text that are its own: flags and their values, placeholders, quoted
 * values and task keys, up to the first that reads as English or ends a sentence. A plain word that ends
 * the sentence, as in "acc deploy qa.", is what it's done to (`thing`).
 */
function argsAfter(text: string): { args: string[]; length: number; thing: string | null } {
  const args: string[] = [];
  let at = 0;
  let afterFlag = false;
  let thing: string | null = null;
  for (;;) {
    const t = /^ ("[^"]*"|'[^']*'|<[^>]*>|\S+)/.exec(text.slice(at));
    if (!t) break;
    const raw = t[1]!;
    const word = raw.replace(/[.,;:!?)]+$/, '');
    const ends = word !== raw || at + t[0].length === text.length;
    // A plain word is the command's after a flag, or when a flag follows it, as "acc gate relax tests --to 10".
    const next = /^ (\S+)/.exec(text.slice(at + t[0].length))?.[1] ?? '';
    const plain = PLAIN.test(word) && !ENGLISH.has(word);
    const own = FLAG.test(word) || KEY.test(word) || PLACEHOLDER.test(word) || (plain && (afterFlag || (word === raw && FLAG.test(next))));
    const last = !own && !afterFlag && ends && PLAIN.test(word) && !ENGLISH.has(word) && /^[a-z0-9]/.test(word);
    if (!own && !last) break;
    args.push(word);
    if (last) thing = word;
    at += 1 + word.length;
    afterFlag = FLAG.test(word) && !word.includes('=');
    if (ends) break;
  }
  return { args, length: at, thing };
}

/**
 * A message from acc, in the Command Center's words (GH-163): each acc command it names becomes its
 * process, and each file its name. "Run acc gate run first." reads "Run the checks first."; "acc done
 * refuses" reads '"Finish the task" refuses'; "in .acc/config.json" reads "in the project's settings".
 * Text with none of them comes back as it was, and "acc" followed by anything but a command stays.
 */
export function inProcessWords(input: string): string {
  // A setting is told by what it is, not the key acc reads it under (GH-168); config-words.ts is that table.
  const text = inConfigWords(input);
  let out = '';
  let from = 0;
  for (const m of text.matchAll(/(\b[Rr]un )?(`?)\bacc (?=[a-z])/g)) {
    if (m.index < from) continue;
    let at = m.index + m[0].length;
    const form = FORMS.find((f) => f.at.test(text.slice(at)));
    if (!form) continue;
    at += form.a.length;
    let args: string[];
    let thing: string | null;
    if (m[2]) {
      // In backticks, the whole command line is the command's.
      const close = text.indexOf('`', at);
      const end = close < 0 ? text.length : close;
      args = text.slice(at, end).trim().split(/\s+/).filter(Boolean);
      thing = args.find((a) => !FLAG.test(a) && !PLACEHOLDER.test(a)) ?? null;
      at = close < 0 ? end : close + 1;
    } else {
      const a = argsAfter(text.slice(at));
      args = a.args;
      thing = a.thing;
      at += a.length;
    }
    const p = form.p;
    const what = args.find((a) => KEY.test(a)) ?? thing;
    const name = p.named && what ? p.named.replace('{arg}', what) : p.name;
    out += text.slice(from, m.index) + (m[1] ? (m[1].startsWith('R') ? upper(name) : lower(name)) : `"${name}"`);
    from = at;
  }
  out += text.slice(from);
  for (const f of FILES) {
    const path = escapeRegExp(f.path);
    const bare = f.name.replace(/^(?:the project's|this machine's|the) /, '');
    // "its .acc/config.json", "Acme's .acc/config.json": its settings, Acme's settings.
    out = out.replace(new RegExp(String.raw`(\b(?:its|[\w-]+'s)) \`?${path}\`?`, 'g'), (_m, owner: string) => `${owner} ${bare}`);
    // "no .acc/config.json", "a .acc/config.json": no project settings file.
    out = out.replace(new RegExp(String.raw`\b(no|any|each|every|a|an) \`?${path}\`?`, 'g'), (_m, det: string) => `${det === 'an' ? 'a' : det} ${f.noun}`);
    // "the .acc/config.json": the project's settings. A name that's plural takes its verb with it:
    // ".acc/config.json names the checks" reads "the project's settings name the checks".
    const plural = /(?:settings|rules|floors|instructions)$/.test(f.name);
    out = out.replace(new RegExp(String.raw`(?:\bthe )?\`?${path}\`?(?: (${Object.keys(AGREE).join('|')})\b)?`, 'g'), (_m, verb: string | undefined) => (verb ? `${f.name} ${plural ? AGREE[verb] : verb}` : f.name));
  }
  // A copied-in rules file, or the folder that holds them.
  out = out.replace(/`?\.acc\/rules\/([\w.-]+)\.md`?/g, (_m, n: string) => `the rules file ${n}`);
  out = out.replace(/`?\.acc\/rules\/?`?/g, 'the project\'s rules folder');
  // Any other file under .acc/, by whose it is.
  out = out.replace(/`?~\/\.acc\/[\w./-]*`?/g, 'this machine\'s acc files');
  out = out.replace(/`?\.acc\/[\w./-]*`?/g, 'the project\'s acc files');
  // Any other docs page, by its name: docs/RULES.md is the rules guide.
  out = out.replace(/`?\bdocs\/([\w-]+)\.md`?/g, (_m, n: string) => `the ${n.toLowerCase().replace(/-/g, ' ')} guide`);
  // A project's script, and the builder's instructions.
  out = out.replace(/`npm run ([\w:.-]+)[^`]*`|\bnpm run ([\w:.-]+)/g, (_m, a: string | undefined, b: string | undefined) => `the project's ${a ?? b} script`);
  // The GitHub command lines acc's messages carry, as what each does (GH-168).
  out = out.replace(/\b([Rr])un:? `?gh auth login`?/g, (_m, r: string) => (r === 'R' ? 'Sign in to GitHub' : 'sign in to GitHub'));
  out = out.replace(/`?gh auth login`?(?:   # as [\w-]+)?/g, 'sign in to GitHub');
  out = out.replace(/\b[Rr]un `?gh auth switch -u ([\w-]+)`?/g, 'switch GitHub\'s active account to $1');
  out = out.replace(/(Projects)(?:: | with )`?gh auth refresh -h github\.com -s project`?/g, '$1');
  out = out.replace(/`?gh auth refresh -h github\.com -s project`?/g, 'give it access to Projects');
  out = out.replace(/\b(its|their) packets?\b/g, (_m, d: string) => `${d} instructions`);
  out = out.replace(/\b(?:[Tt]he |[Aa] )?packets\b/g, 'builders\' instructions');
  out = out.replace(/\b(?:[Tt]he |[Aa] )?packet\b/g, 'the builder\'s instructions');
  // A message that started with a path still starts with a capital.
  return /^[a-z]/.test(out) && !/^[a-z]/.test(input) ? upper(out) : out;
}

/**
 * What an acc command line does, as its process: "acc rules diff acme" is "Compare the rules with their
 * source", "acc drift qa" is "Check qa's org for drift". A dry run or a plan says it only previews. Null
 * for a line that isn't one of acc's, such as `brew install gh`, which a person may still be shown to copy.
 */
export function processLine(line: string): string | null {
  const t = line.trim();
  if (!/^acc [a-z]/.test(t)) return null;
  const said = inProcessWords(`\`${t}\``);
  if (!/^"[^"]+"$/.test(said)) return null;
  return `${said.slice(1, -1)}${/\s--(dry-run|plan)\b/.test(t) ? ', as a preview that changes nothing' : ''}`;
}

/**
 * What another tool's command line does, as a process (GH-168): `claude plugin install acc@…` is "Install the
 * acc plugin in Claude Code". Setup shows what Do it does in these words and keeps the line itself behind
 * "Show the command", for someone who runs it by hand. A line none of these names comes back null, and the
 * page shows it as it always has: extension/test/config-words.test.ts runs each line Setup's steps give.
 */
const TOOL_LINES: readonly { line: RegExp; does: string }[] = [
  { line: /^claude plugin marketplace update\b.*&& claude plugin update\b/, does: 'Update the acc plugin in Claude Code' },
  { line: /^claude plugin (?:marketplace add\b.*&& claude plugin )?install\b/, does: 'Install the acc plugin in Claude Code' },
  { line: /^claude plugin enable\b/, does: 'Turn on the acc plugin in Claude Code' },
  { line: /^claude update$/, does: 'Update Claude Code' },
  { line: /^claude auth login$/, does: 'Sign in to Claude Code with your claude.ai account' },
  { line: /^claude(?:\s+#.*)?$/, does: 'Open Claude Code in this folder, to trust it' },
  { line: /^brew install --cask claude-code$/, does: 'Install Claude Code' },
  { line: /^brew install git$/, does: 'Install git' },
  { line: /^brew install node$/, does: 'Install Node' },
  { line: /^brew install gh$/, does: 'Install the GitHub command line' },
  { line: /^npm install -g @salesforce\/cli$/, does: 'Install the Salesforce command line' },
  { line: /^sf plugins install code-analyzer$/, does: 'Install the Salesforce code analyzer' },
  { line: /^gh auth login\b/, does: 'Sign in to GitHub as this repo\'s account' },
  { line: /^gh repo edit\b.*--default-branch\b/, does: 'Set the repo\'s default branch on GitHub' },
  { line: /^git config user\.name\b.*&& git config user\.email\b/, does: 'Set the name and email on this repo\'s commits' },
  { line: /^git config user\.(?:name|email)\b/, does: 'Set the name or email on this repo\'s commits' },
  { line: /^git config credential\.helper\b/, does: 'Make git push as this repo\'s GitHub account' },
  { line: /^printf\b.*>> \.gitignore$/, does: 'Add the missing lines to the repo\'s ignore list' },
  { line: /^git rm\b/, does: 'Stop tracking those files in git, and keep them on disk' },
  { line: /^(?:cd "[^"]*" && )?npm install$/, does: 'Install the project\'s tools' },
  { line: /^sf org login web\b/, does: 'Log in to the org' },
  { line: /^sf org enable tracking\b/, does: 'Turn on source tracking in the org' },
  { line: /^sf config set target-org\b/, does: 'Make this org the default for the repo' },
];

/** What another tool's command line does, as a process; null for a line that isn't one of these, or isn't a command. */
export function toolLineDoes(line: string): string | null {
  const t = line.trim();
  return TOOL_LINES.find((l) => l.line.test(t))?.does ?? null;
}

