/**
 * The Command Center's words for the project's settings (GH-168), beside processes.ts's words for acc's
 * commands and files. A person is told what a setting is, "its required checks", never the key acc reads it
 * under, "gates.required". CONFIG_WORDS names every key acc's config schema knows (CONFIG_KEYS), and tsc
 * refuses a key without a name or a name for a key that's gone; extension/test/config-words.test.ts checks each
 * name reads as words. The words check (extension/scripts/words.ts) fails on a dotted key outside work data.
 *
 * Each name reads after "its" or "the" in a sentence: "this project differs on its required checks, its
 * builder limit". inConfigWords() puts them in text that came from acc, and processes.ts's inProcessWords()
 * calls it, so every message on its way to a person goes through it.
 *
 * Like the rest of logic/, no `vscode` import.
 */
import { CONFIG_KEYS } from '../../../packages/core/src/config.ts';
import { escapeRegExp } from '../../../packages/core/src/text.ts';

export { escapeRegExp };

type ConfigKey = (typeof CONFIG_KEYS)[number];

/** Each key acc reads from the project's settings, by what it is. */
export const CONFIG_WORDS: Record<ConfigKey, string> = {
  schema: 'the settings format',
  project: 'its name',
  profile: 'its kind of project',
  'github.repo': 'its GitHub repository',
  'github.account': 'its GitHub account',
  'github.checks': 'the GitHub checks autopilot waits for',
  'commitIdentity.name': 'the name on its commits',
  'commitIdentity.email': 'the email on its commits',
  'environments[].name': 'an environment\'s name',
  'environments[].branch': 'an environment\'s branch',
  'environments[].type': 'an environment\'s type',
  'environments[].org': 'an environment\'s org',
  'environments[].default': 'its default environment',
  'environments[].protected': 'an environment\'s protection',
  'environments[].promotesTo': 'where an environment promotes to',
  environmentSpecific: 'its environment-specific files',
  knownDrift: 'its known differences between environments',
  'trackers[].kind': 'a tracker\'s kind',
  'trackers[].site': 'a tracker\'s site',
  'trackers[].project': 'a tracker\'s project',
  'trackers[].repo': 'a tracker\'s repository',
  'trackers[].organization': 'a tracker\'s organization',
  'trackers[].account': 'a tracker\'s account',
  'trackers[].workspace': 'a tracker\'s Slack workspace',
  'trackers[].channel': 'a tracker\'s Slack channel',
  'trackers[].reaction': 'the reaction that puts a Slack message on the board',
  'trackers[].doneReaction': 'the reaction that marks a Slack message done',
  'trackers[].team': 'a tracker\'s team',
  'trackers[].name': 'a board\'s name',
  'trackers[].board': 'a tracker\'s board',
  'trackers[].statusColumn': 'a tracker\'s status column',
  'trackers[].prefix': 'a tracker\'s ticket prefix',
  'trackers[].skipLabels': 'the labels a tracker skips',
  'trackers[].epics': 'a tracker\'s epics',
  'trackers[].sprint': 'a tracker\'s sprint',
  'trackers[].queue': 'a tracker\'s queue',
  'trackers[].labels': 'a tracker\'s labels',
  'trackers[].areaPath': 'a tracker\'s area',
  'trackers[].group': 'a tracker\'s group',
  'trackers[].edits': 'what the Command Center may change on a tracker',
  'trackers[].statusFor': 'how a tracker\'s statuses map to tasks',
  'trackers[].changesField.id': 'the field a tracker keeps a ticket\'s changes in',
  'trackers[].changesField.name': 'the name of the field a tracker keeps a ticket\'s changes in',
  'trackers[].changesField.format': 'how that field keeps its text',
  'agents.max': 'its builder limit',
  'agents.permissionMode': 'what builders may do without asking',
  'agents.builder.model': 'the builders\' model',
  'agents.builder.effort': 'the builders\' effort',
  'agents.builder.fallbackModel': 'the builders\' fallback model',
  'agents.planner.model': 'the planning agent\'s model',
  'agents.planner.effort': 'the planning agent\'s effort',
  'agents.planner.fallbackModel': 'the planning agent\'s fallback model',
  'agents.reviewer.model': 'the reviewer\'s model',
  'agents.reviewer.effort': 'the reviewer\'s effort',
  'agents.reviewer.fallbackModel': 'the reviewer\'s fallback model',
  'agents.cloud.routine': 'its cloud routine',
  'agents.cloud.default': 'where its builders go by default',
  'agents.cloud.quietMinutes': 'how long a cloud builder may be quiet',
  'agents.cloud.max': 'its cloud builder limit',
  'agents.cloud.review': 'where its reviews run',
  autonomy: 'what autopilot may do',
  'worktrees.root': 'where its worktrees are kept',
  'worktrees.setup': 'how a worktree is set up',
  'gates.required': 'its required checks',
  'gates.commands': 'its checks\' commands',
  'gates.heavy': 'its heavy checks',
  'gates.severity': 'how strictly its checks judge',
  'gates.builder': 'the lighter checks builders run',
  'gates.tests': 'its tests check',
  'gates.ratchets': 'its floors',
  'gates.nearIndexes': 'the files that gather a folder for its nearby tests',
  'secretScan.paths': 'where the secret scan looks',
  'secretScan.exclude': 'what the secret scan skips',
  'strayFiles.required': 'whether stray files are checked',
  'strayFiles.allow': 'the stray files it allows',
  'strayFiles.data': 'the data files it allows',
  'analysis.required': 'when a task needs an analysis',
  sourceTracking: 'whether it uses source tracking',
  'autopilot.appendOnly': 'whether autopilot only adds tasks',
  'autopilot.autoMerge': 'whether autopilot merges',
  'dispatch.shared': 'the files tasks may share',
  'tools[].title': 'a tool\'s name',
  'tools[].why': 'why its checks need a tool',
  'tools[].check': 'how a tool is looked for',
  'tools[].fix': 'how a tool is set up',
  'tidy.every': 'how often it asks for a tidy-up',
  'template.name': 'its team template\'s name',
  'template.source': 'where its team template is kept',
  'template.digest': 'the team template as it was copied in',
};

/** The keys that are dotted paths, the ones a person could mistake for code. */
export const DOTTED_KEYS: readonly ConfigKey[] = CONFIG_KEYS.filter((k) => k.includes('.'));

/** Text as a regular expression that matches it literally. */
const alternatives = [...DOTTED_KEYS].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|');
/** A dotted key in text, in backticks or quotes or bare, never after a dot (config.gates.required is code) or inside a word. */
const KEY = String.raw`[\`"]?(?<![\w.-])(${alternatives})(?![\w-])[\`"]?`;
/** A key in parentheses, alone or followed by more: "(agents.max)" and "(agents.max, acc's default)". */
const PAREN = new RegExp(String.raw`( ?)\(${KEY}(, [^)]*)?\)`, 'g');

/**
 * Text from acc with its dotted config keys put in words: "differs on gates.required, agents.max" reads
 * "differs on its required checks, its builder limit". A key in parentheses only says where the setting is
 * kept, which the sentence already names, so it's dropped: "its cap is 2 (agents.max)." reads "its cap is 2."
 * Text with no dotted key comes back as it was.
 */
export function inConfigWords(text: string): string {
  const named = text.replace(PAREN, (_m, space: string, _key: string, rest: string | undefined) => (rest ? `${space}(${rest.slice(2)})` : ''));
  return named.replace(new RegExp(KEY, 'g'), (_m, key: string) => CONFIG_WORDS[key as ConfigKey]);
}
