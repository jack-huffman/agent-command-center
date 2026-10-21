// The repo's test-coverage rule (.acc/rules.md, T-10): every function, constant or class a source module
// exports is named by a test. Reviews kept finding behaviour a change added with no test that would fail
// without it (7 findings across 6 tasks). This walks every export in git's list of source modules, counts
// them, and fails on none. OLDER names the exports that predate the rule; each must still be unnamed by any
// test, so the list only shrinks.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as esbuild from 'esbuild';

const ROOT = join(import.meta.dirname, '..', '..');

/** Where the source modules are, and where the tests and their helpers are. */
const SOURCES = [':(glob)packages/*/src/**/*.ts', ':(glob)extension/src/**/*.ts', ':(glob)extension/webview/*.ts'];
const TESTS = [':(glob)packages/*/test/*.ts', ':(glob)extension/test/*.ts', ':(glob)scripts/test/*.ts'];

/** The exports that predate the rule and no test names, by module. Only ever remove one. */
export const OLDER: Record<string, string[]> = {
  'extension/src/activity.ts': ['AgentPages'],
  'extension/src/autopilot.ts': ['AutopilotHost'],
  'extension/src/identity.ts': ['RepoIdentity'],
  'extension/src/limits.ts': ['queueOf'],
  'extension/src/logic/agents.ts': ['builderName', 'askingLabel', 'CLAUDE_EXTENSION'],
  'extension/src/logic/autopilot.ts': ['queueWhy'],
  'extension/src/logic/connect.ts': ['accSetTracker'],
  'extension/src/logic/environments.ts': ['ENV_ICON', 'githubBranchUrl'],
  'extension/src/logic/notices.ts': ['endSentence', 'stoppedNotice'],
  'extension/src/logic/setup.ts': ['PUBLISHER', 'needsConfirmation', 'hasRunnableFix', 'sfOpenCommand'],
  'extension/src/logic/shared.ts': ['BOARD_LANES', 'taskNames', 'questionsWord', 'prConflicts', 'fileList', 'shortPath', 'saidLine'],
  'extension/src/logic/tasks.ts': ['whileFirst', 'failedChecksLine', 'conflictLine'],
  'extension/src/model/about.ts': ['tagVersion'],
  'extension/src/model/boards.ts': ['chip', 'BOARD_WORD'],
  'extension/src/model/cards.ts': ['canDispatch', 'AUTOPILOT_STEP', 'CARD_SAID'],
  'extension/src/model/connect.ts': ['connectValues', 'CONNECT', 'connectValue'],
  'extension/src/model/limits.ts': ['dollars'],
  'extension/src/model/overview.ts': ['mergeQueues'],
  'extension/src/model/questions.ts': ['alwaysWhat', 'questionsOf'],
  'extension/src/model/rules.ts': ['ruleTitle', 'ruleAsk'],
  'extension/src/model/settings.ts': ['opensOnWords'],
  'extension/src/model/setup.ts': ['setupStart'],
  'extension/src/model/shared.ts': ['sessionKey', 'nameOf'],
  'extension/src/model/slack.ts': ['SLACK_ACTIONS'],
  'extension/src/model/task-modal.ts': ['taskOf'],
  'extension/src/model/task-page.ts': ['ticketAnalysis', 'TICKET_ACTIONS'],
  'extension/src/model/updates.ts': ['hasTicket', 'updateCards', 'withClient'],
  'extension/src/panels.ts': ['isWebLink', 'TabTheme', 'Panels'],
  'extension/src/progress.ts': ['STEP_DOING', 'readRepoJobs', 'readSteps'],
  'extension/src/questions.ts': ['accShellCommand', 'sessionSettings', 'Questions'],
  'extension/src/run.ts': ['RUN_TIMEOUT_MS', 'accRunner'],
  'extension/src/setup.ts': ['extensionVersion'],
  'extension/src/sidebar.ts': ['Sidebar'],
  'extension/src/slack.ts': ['SLACK_STATE', 'SLACK_TIMEOUT_MS', 'SLACK_QUEUE_MAX', 'SLACK_CLAIM_DAYS', 'SLACK_TEST_TEXT', 'slackDir'],
  'extension/src/task-rows.ts': ['analysesOf', 'rowFiles', 'loadChanged'],
  'extension/src/ticket.ts': ['TicketPanels'],
  'extension/src/transcript.ts': ['shortPath'],
  'extension/webview/about.ts': ['renderAbout'],
  'extension/webview/agent-page.ts': ['renderAgent'],
  'extension/webview/analysis.ts': ['renderAnalysis'],
  'extension/webview/boards.ts': ['wheelSideways', 'dragAutoScroll', 'cardMenu', 'cardFoot', 'boardEdges'],
  'extension/webview/connect.ts': ['connectTyped', 'renderConnect'],
  'extension/webview/detail.ts': ['openDetail', 'closeDetail'],
  'extension/webview/dock.ts': ['stickToBottom', 'renderDock'],
  'extension/webview/dom.ts': ['linkTo', 'labelChip', 'menuButton', 'peekKey', 'peekable', 'clippedSpan', 'keptInput', 'keepFocus'],
  'extension/webview/landing.ts': ['runDo', 'opensKey', 'landingRow', 'showAll'],
  'extension/webview/limits.ts': ['renderLimits'],
  'extension/webview/modal.ts': ['makeModal'],
  'extension/webview/overview.ts': ['renderOverview'],
  'extension/webview/settings.ts': ['renderSettings'],
  'extension/webview/setup.ts': ['renderSetup'],
  'extension/webview/state.ts': ['setSection'],
  'extension/webview/task-page.ts': ['renderTicket'],
  'extension/webview/tasks.ts': ['renderTasks', 'KIND_ICON', 'KIND_NAME'],
  'extension/webview/theme.ts': ['applyTheme'],
  'extension/webview/updates.ts': ['onDone', 'updateKey', 'askKey', 'answerKey', 'sendUpdate', 'tellAfresh', 'tellEdits', 'updateDraft', 'forgetAnswered'],
  'packages/cli/src/commands/tasks.ts': ['cmdSet'],
  'packages/cli/src/commands/updates.ts': ['personOnlyUpdate'],
  'packages/cli/src/format.ts': ['stateLabel', 'checkLabel', 'gateLabel'],
  'packages/cli/src/main.ts': ['WORD_MAX'],
  'packages/cli/src/shared.ts': ['readFileArg', 'followingCards', 'actorFrom', 'taskIdFrom', 'stepWords', 'personOnly', 'noAgent'],
  'packages/core/src/agents.ts': ['checkModelName', 'SETTABLE_AUTONOMY', 'setAutoMerge', 'describeProfile'],
  'packages/core/src/analyze.ts': ['SIZE_MEANING', 'ANALYSIS_SCHEMA', 'ANALYST_COMMANDS'],
  'packages/core/src/autopilot-rules.ts': ['resumedByAutopilot', 'inQueueAt', 'firstLines'],
  'packages/core/src/autopilot.ts': ['AUTOPILOT_MIN_EVERY_S', 'AUTOPILOT_REVIEW_DOES', 'autopilotDoes', 'realSteps', 'startedWords'],
  'packages/core/src/cards.ts': ['cardState'],
  'packages/core/src/checks.ts': ['MAX_LOGS', 'NO_ACTIONS_LOG', 'tailText', 'readChecksReport', 'queueReportPath', 'sendBack'],
  'packages/core/src/closing.ts': ['GH_CALL_MS', 'editsTracker', 'firstLine', 'closeWords'],
  'packages/core/src/config.ts': ['PROFILES', 'ENV_TYPES', 'AUTONOMY', 'PERMISSION_MODES', 'MODEL_NAME', 'AGENT_ROLES', 'RATCHET_LIMITS', 'RATCHET_NAME', 'TEMPLATE_DIGEST', 'DEFAULT_HEAVY', 'parseEnvironments', 'environmentByBranch', 'STRAY_FILES', 'withStrayFiles'],
  'packages/core/src/deploy.ts': ['deployRecordPath'],
  'packages/core/src/dispatch.ts': ['mainCheckout', 'isClaudeWorktree', 'claudeStatePath', 'isTrusted', 'builderModel'],
  'packages/core/src/drift.ts': ['BASELINE_MANIFEST', 'environmentNamed'],
  'packages/core/src/efforts.ts': ['effortSourceWords', 'checkEffortName', 'checkEffortPick', 'modelTakes', 'effortFixWords', 'dispatchEffort'],
  'packages/core/src/exec.ts': ['ghEnv', 'isGh'],
  'packages/core/src/gates.ts': ['lastLine', 'packageDirs', 'baseFor', 'changedPaths', 'niced'],
  'packages/core/src/github.ts': ['CLONE_ACCOUNT_KEY', 'credentialHelper', 'ghAccounts'],
  'packages/core/src/held.ts': ['holdWords'],
  'packages/core/src/holding.ts': ['startingNow', 'claimHeld', 'releaseHeld'],
  'packages/core/src/hooks.ts': ['findAccRoot', 'builderFor', 'guardEdit', 'PERSON_ONLY_ACC', 'sessionStartHook', 'stopHook', 'parseEventInput'],
  'packages/core/src/init.ts': ['discoverSalesforce', 'pushingAccount', 'configureRepoAccess'],
  'packages/core/src/intake.ts': ['reconcileGithub'],
  'packages/core/src/jobs.ts': ['JOB_KINDS'],
  'packages/core/src/land.ts': ['LAND_TIMEOUT_MS', 'UPDATE_POST_TIMEOUT_MS', 'mergesWords'],
  'packages/core/src/ledger.ts': ['SOURCE_KINDS','isValidId', 'NOTE_LIMITS', 'NOTE_LABELS', 'noteGiven', 'noteProblems', 'sessionActive', 'STOPPED_GRACE_MS', 'runStartedAt', 'sentBackByAutopilot', 'SEND_BACKS', 'sendBacks', 'sentBackAt', 'inQueue'],
  'packages/core/src/limits.ts': ['MAX_AGENTS', 'DEFAULT_AGENTS', 'realLedger'],
  'packages/core/src/lock.ts': ['alive'],
  'packages/core/src/machine.ts': ['machineJsonToWrite', 'setMachineKey'],
  'packages/core/src/merge.ts': ['NO_CHECKS_GRACE_MS', 'BLOCKED_NO_CHECKS_MS', 'MERGE_METHODS'],
  'packages/core/src/names.ts': ['NAME_SEP'],
  'packages/core/src/onboarding/helpers.ts': ['versionAtLeast', 'firstVersion', 'sfJson', 'ghEnv', 'LICENSE_TO_TYPE', 'SECRET_PATTERN'],
  'packages/core/src/onboarding/steps.ts': ['PLUGIN_LIST_ARGS', 'parseClaudeList', 'GROUP_TITLES'],
  'packages/core/src/overlap.ts': ['IN_FLIGHT_STATES', 'nulPaths', 'startCandidates', 'startLook', 'sharesWords'],
  'packages/core/src/promote.ts': ['envByName', 'skipWarning'],
  'packages/core/src/questions.ts': ['questionsDir', 'ALLOWED_MODES', 'LISTENER_EVERY_MS', 'HOOK_TIMEOUT_S', 'askingUnder'],
  'packages/core/src/queue.ts': ['joinQueue', 'leaveQueue', 'holdHead', 'queueTurn'],
  'packages/core/src/ratchets.ts': ['writeFloors', 'floorsAt', 'limitOf', 'valueOf', 'isWorse', 'num', 'ratchetGate', 'relaxCounts', 'relaxedTo'],
  'packages/core/src/receipts.ts': ['ratchetOf', 'receiptPath', 'EARLIER_LIMIT', 'earlierCounts'],
  'packages/core/src/refresh.ts': ['resolvedWords', 'fetchBase', 'undoMerge'],
  'packages/core/src/resume.ts': ['listSessions', 'clipSaid'],
  'packages/core/src/review.ts': ['VERDICT_SCHEMA', 'carriedVerdict'],
  'packages/core/src/rule-suggestions.ts': ['OFFER_FINDINGS', 'OFFER_TASKS', 'RETURN_FINDINGS', 'RULE_JOIN', 'WORDING_JOIN', 'RULE_LINE_MAX', 'RULE_TITLE_MAX', 'RULE_NOTE_MAX', 'SUGGESTION_ID', 'WRITTEN_RULE_FILES', 'firstSentence', 'writtenRules', 'whereWritten', 'CHECK_ASKS', 'defaultCheck', 'draftTitle', 'sourceLine'],
  'packages/core/src/rules.ts': ['RULES_DIR', 'OWN_RULES', 'RULES_TOTAL_MAX_BYTES', 'rulesName', 'prepareImport', 'prepareImports', 'writeImport', 'reimportCommand'],
  'packages/core/src/semaphore.ts': ['heavyDir'],
  'packages/core/src/setup.ts': ['reorderedOnly'],
  'packages/core/src/source.ts': ['COPY_KINDS', 'fetchSource'],
  'packages/core/src/stray-files.ts': ['DATA_EXT', 'strayOutcome', 'strayFilesGate'],
  'packages/core/src/sync.ts': ['fetchBranches', 'conflictsOf'],
  'packages/core/src/template.ts': ['TEMPLATE_MAX_BYTES', 'TEMPLATE_AUTONOMY', 'overlayEnvironments', 'overlaySettings', 'templateTrackers', 'pickedTracker', 'trackerWords'],
  'packages/core/src/test-counts.ts': ['testsText'],
  'packages/core/src/trackers/azure.ts': ['azureWhoAmI', 'azureProjects', 'azureTeams', 'azureBoards'],
  'packages/core/src/trackers/connect.ts': ['JIRA_TOKENS', 'AZURE_SCOPE'],
  'packages/core/src/trackers/doc.ts': ['emptyDoc'],
  'packages/core/src/trackers/github.ts': ['issueRepo', 'hasPlaceLabel', 'githubOutside', 'issueNumber', 'pickProject'],
  'packages/core/src/trackers/jira.ts': ['jiraProjects', 'jiraBoards'],
  'packages/core/src/trackers/monday.ts': ['MONDAY_API', 'MONDAY_VERSION', 'mondayTokenPage', 'mondayCall', 'statusLabels', 'pickStatusColumn', 'mondayBoards', 'mondayGroups', 'mondayStatusColumns'],
  'packages/core/src/trackers/types.ts': ['isTrackerKind', 'signInLabel', 'outsideError', 'orList', 'inBatches'],
  'packages/core/src/updates.ts': ['UPDATE_STATES', 'STALE_POSTING_MS', 'UPDATE_TEXT_MAX', 'UPDATE_ID', 'EVENT_WORDS', 'ticketOf', 'isOpenUpdate'],
};

/**
 * Source with the text inside template literals blanked, its lines kept: a script a module holds in a
 * template (the cloud guard's) exports nothing of the module's. What a `${…}` holds is code and stays, and a
 * backtick inside a quoted string or a comment starts no template.
 */
export const outsideTemplates = (source: string): string => {
  let out = '';
  // The brace depth outside each `${` we're in, so its closing brace goes back to the template.
  const outer: number[] = [];
  let depth = 0;
  let inTemplate = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (inTemplate) {
      if (c === '`') {
        inTemplate = false;
        out += c;
      } else if (c === '$' && source[i + 1] === '{') {
        outer.push(depth);
        depth = 0;
        inTemplate = false;
        out += '${';
        i++;
      } else {
        // An escape is blanked with the character it escapes; a newline stays, so lines keep their numbers.
        const chars = c === '\\' ? c + (source[++i] ?? '') : c;
        out += chars.replace(/[^\n]/g, ' ');
      }
      continue;
    }
    const end = c === '\'' || c === '"' ? lineStringEnd(source, i, c)
      : c === '/' && source[i + 1] === '/' ? source.indexOf('\n', i)
      : c === '/' && source[i + 1] === '*' ? source.indexOf('*/', i + 2) + 1
      : c === '/' && (/(^|[(,=:[!&|?{};+\-*%<>~^]|\breturn)\s*$/.test(out.slice(-40)) || regexAfterClose(out)) ? regexEnd(source, i)
      : -2;
    if (end !== -2) {
      const stop = end <= 0 ? source.length : end + 1;
      out += source.slice(i, stop);
      i = stop - 1;
      continue;
    }
    if (c === '`') inTemplate = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      if (depth === 0 && outer.length) { depth = outer.pop()!; inTemplate = true; }
      else depth--;
    }
    out += c;
  }
  return out;
};

/** Where a quoted string that starts at `start` ends: its closing quote, or the end of its line. */
function lineStringEnd(source: string, start: number, quote: string): number {
  for (let i = start + 1; i < source.length; i++) {
    if (source[i] === '\\') i++;
    else if (source[i] === quote || source[i] === '\n') return i;
  }
  return source.length;
}

/**
 * Whether a `/` after this code is read as a regex although the code ends in `)` or `]`: it begins its line,
 * or the `)` closes the head of an if, while, for or with. Anywhere else after `)` or `]` it's a division.
 * A guess: a division that goes on to the next line, as `(a + b)\n  / 2`, is read as a regex. The esbuild
 * comparison below catches an export that the wrong guess hides.
 */
function regexAfterClose(out: string): boolean {
  const code = out.trimEnd();
  if (!/[)\]]$/.test(code)) return false;
  if (/\n\s*$/.test(out)) return true;
  if (!code.endsWith(')')) return false;
  let depth = 0;
  for (let i = code.length - 1; i >= 0; i--) {
    if (code[i] === ')') depth++;
    else if (code[i] === '(' && --depth === 0) return /\b(?:if|while|for|with)\s*$/.test(code.slice(0, i));
  }
  return false;
}

/** Where a regex literal that starts at `start` ends: its closing slash, past any in a [class], or the end of its line. */
function regexEnd(source: string, start: number): number {
  let inClass = false;
  for (let i = start + 1; i < source.length; i++) {
    const c = source[i];
    if (c === '\\') i++;
    else if (c === '\n') return i;
    else if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) return i;
  }
  return source.length;
}

/**
 * The functions, constants and classes a module exports, by name, each once: an overloaded function's
 * signatures are one export. A local list (`export { a, b as c }`) counts by the name it exports. Types and
 * re-exports from another module (`export { x } from …`) aren't counted.
 */
export const exportsOf = (source: string): string[] => {
  source = outsideTemplates(source);
  const declared = [...source.matchAll(/^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|let|class|abstract\s+class)\s+([\w$]+)/gm)].map((m) => m[1] ?? '');
  const listed = [...source.matchAll(/^export\s*\{([^}]*)\}\s*;?[ \t]*$/gm)]
    .flatMap((m) => (m[1] ?? '').split(',').map((x) => x.trim()).filter((x) => x && !x.startsWith('type ')).map((x) => x.split(/\s+as\s+/).pop()!.trim()));
  return [...new Set([...declared, ...listed])];
};

/**
 * The names a module exports with `export { a, b as c } from …` or `export * as ns from …`, as exportsOf
 * doesn't count these. A type-only name is left out, as esbuild leaves it out.
 */
export const reexportedNames = (source: string): string[] => {
  source = outsideTemplates(source);
  const listed = [...source.matchAll(/^export\s*\{([^}]*)\}\s*from\b/gm)]
    .flatMap((m) => (m[1] ?? '').split(',').map((x) => x.trim()).filter((x) => x && !x.startsWith('type ')).map((x) => x.split(/\s+as\s+/).pop()!.trim()));
  const spaces = [...source.matchAll(/^export\s*\*\s*as\s+([\w$]+)\s+from\b/gm)].map((m) => m[1] ?? '');
  return [...new Set([...listed, ...spaces])];
};

/**
 * The exports esbuild finds in one module: the independent answer exportsOf is held to. It compiles the
 * file (no bundling) and reads the exports of its output from the metafile, which leaves out types.
 */
export async function esbuildExportsOf(file: string): Promise<string[]> {
  const built = await esbuild.build({ entryPoints: [file], bundle: false, format: 'esm', write: false, metafile: true, outdir: 'out', logLevel: 'silent' });
  return Object.values(built.metafile.outputs).flatMap((o) => o.exports);
}

/**
 * Why exportsOf and esbuild disagree about one module, or '' when they don't. Each name exportsOf finds must
 * be in esbuild's list. A name only esbuild finds must be one the module re-exports with `export … from`; a
 * default export is "default" to esbuild, and exportsOf counts one by the name of its function or class, so
 * esbuild's "default" is matched by an `export default` statement in the source.
 */
export function exportsDisagree(source: string, found: string[], fromEsbuild: string[]): string {
  const code = outsideTemplates(source);
  const theirs = new Set(fromEsbuild);
  const named = new Set([...code.matchAll(/^export\s+default\s+(?:async\s+)?(?:function\*?|class|abstract\s+class)\s+([\w$]+)/gm)].map((m) => m[1] ?? ''));
  // A default that exportsOf names is esbuild's "default".
  const missed = found.filter((n) => !(named.has(n) ? theirs.has('default') : theirs.has(n)));
  const mine = new Set(found);
  const again = new Set(reexportedNames(source));
  const hasDefault = /^export\s+default\b/m.test(code);
  const extra = fromEsbuild.filter((n) => !mine.has(n) && !again.has(n) && !(n === 'default' && hasDefault));
  if (missed.length) return `exportsOf finds ${missed.join(', ')}, which esbuild does not`;
  if (extra.length) return `esbuild finds ${extra.join(', ')}, which exportsOf misses and no export … from names`;
  return '';
}

/**
 * Source with the comments that start a line taken out, as a comment checks nothing. One after code on its
 * line stays: telling it from a string or a glob such as `src/*.ts` needs a parser.
 */
export const uncommented = (source: string): string =>
  source.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '').replace(/^[ \t]*\/\/.*$/gm, '');

/** The whole words this code names, read once, so checking each export is a lookup, not a scan. */
export const identifiers = (code: string): Set<string> => new Set(code.match(/[\w$]+/g) ?? []);

/** Whether this code, its comments taken out, names this export as a whole word. */
export function named(name: string, code: string | Set<string>): boolean {
  return (typeof code === 'string' ? identifiers(code) : code).has(name);
}

const ls = (...globs: string[]): string[] =>
  execFileSync('git', ['ls-files', '--', ...globs], { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean).sort();
const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8');

/** Each source module's exports no test names. */
let walk: { walked: number; modules: string[]; missing: Record<string, string[]>; compared: number } | undefined;
async function unnamed(): Promise<{ walked: number; modules: string[]; missing: Record<string, string[]>; compared: number }> {
  if (walk) return walk;
  // This file names OLDER's exports, so it isn't one of the tests that names them.
  const tests = identifiers(ls(...TESTS).filter((f) => f !== 'scripts/test/coverage.test.ts').map(read).map(uncommented).join('\n'));
  const missing: Record<string, string[]> = {};
  let walked = 0;
  let compared = 0;
  const modules = ls(...SOURCES);
  for (const f of modules) {
    const source = read(f);
    const names = exportsOf(source);
    const why = exportsDisagree(source, names, await esbuildExportsOf(join(ROOT, f)));
    assert.equal(why, '', `${f}: ${why}`);
    compared++;
    walked += names.length;
    const gone = names.filter((n) => !named(n, tests));
    if (gone.length) missing[f] = gone;
  }
  walk = { walked, modules, missing, compared };
  return walk;
}

test('every export a source module has is named by a test, but the older ones OLDER names', async () => {
  const { walked, modules, missing } = await unnamed();
  // It ran: the modules on disk are the oracle for what was walked, and none walked is no check.
  const onDisk = [...readdirSync(join(ROOT, 'packages')).map((p) => `packages/${p}/src`), 'extension/src']
    .flatMap((d) => readdirSync(join(ROOT, d), { recursive: true, encoding: 'utf8' }).map((f) => `${d}/${f}`))
    .concat(readdirSync(join(ROOT, 'extension', 'webview')).map((f) => `extension/webview/${f}`))
    .filter((f) => f.endsWith('.ts')).sort();
  assert.ok(modules.length > 0, 'walked no source modules');
  assert.deepEqual(modules, onDisk, 'the modules walked should be every module on disk, at the top of src and in its folders');
  assert.ok(walked > 0, 'walked no exports');
  const fresh = Object.entries(missing).flatMap(([f, names]) => names.filter((n) => !OLDER[f]?.includes(n)).map((n) => `${f}: ${n}`));
  assert.deepEqual(fresh, [], 'no test names these: add a test that fails without each');
});

test('exportsOf finds the same exports as esbuild in every module the check walks', async () => {
  const { compared, modules } = await unnamed();
  assert.ok(compared > 0, 'compared no modules');
  assert.equal(compared, modules.length, 'every module walked should be compared');
});

test('OLDER only shrinks: each export it names still exists and is still named by no test', async () => {
  const { missing } = await unnamed();
  const files = Object.keys(OLDER);
  assert.ok(files.length > 0, 'OLDER is empty: delete it and this test');
  assert.deepEqual([...files].sort(), files, 'OLDER\'s modules should stay sorted');
  for (const f of files) {
    const names = OLDER[f] ?? [];
    assert.ok(names.length > 0, `${f} has no exports left in OLDER: take it out`);
    for (const n of names) assert.ok(missing[f]?.includes(n), `${f}: ${n} is gone or a test now names it: take it out of OLDER`);
  }
});

test('an export no test names fails the rule, and one named only in a comment doesn\'t count', () => {
  assert.deepEqual(exportsOf('export function a() {}\nexport async function b() {}\nexport const c = 1;\nexport class D {}\nexport type E = 1;\nexport interface F {}\nexport { g } from \'./g.ts\';\nconst h = 2;'), ['a', 'b', 'c', 'D']);
  assert.deepEqual(exportsOf(''), [], 'an empty module exports nothing');
  assert.deepEqual(exportsOf('export function p(a: string): string;\nexport function p(a: number): number;\nexport function p(a: unknown) { return a; }'), ['p'], 'an overloaded function is one export');
  assert.deepEqual(exportsOf('function q() {}\nconst r = 1;\nexport { q, r as s, type T };'), ['q', 's'], 'a local export list counts by the names it exports');
  assert.equal(named('nearTests', 'import { nearTests } from \'../src/gates.ts\';'), true);
  assert.equal(named('nearTests', 'assert.ok(nearTestsFor(x));'), false, 'a longer name isn\'t this one');
  assert.equal(named('nearTests', uncommented('// nearTests is checked elsewhere\n  /**\n   * nearTests\n   */\nrun();')), false, 'a comment checks nothing');
  assert.equal(named('nearTests', uncommented('const u = \'https://x\'; nearTests();')), true, 'a // inside a string isn\'t a comment');
  assert.equal(named('nearTests', uncommented('ls(\'src/*.ts\', \'test/*/x\');\nnearTests();\n/* a */')), true, 'a /* in a glob doesn\'t start a comment');
  assert.equal(named('$x', 'run($x)'), true);
});

test('an export line inside a template literal is not an export, and the edge cases around one: an escaped backtick, a ${} with braces, a backtick in a string or a comment', () => {
  const script = 'export const SCRIPT = `#!/usr/bin/env node\nexport const RECORD = \'x\';\nexport function pushProblem() { return \\`\\${RECORD}\\`; }\n`;\nexport const after = 1;';
  assert.deepEqual(exportsOf(script), ['SCRIPT', 'after'], 'the template\'s own export lines are its text, not the module\'s');
  assert.equal(outsideTemplates(script).split('\n').length, script.split('\n').length, 'lines keep their numbers');
  assert.deepEqual(exportsOf('const t = `a ${ {b: 1}.b } c\nexport const inside = 1;\n`;\nexport const outside = 2;'), ['outside'], 'braces inside a ${} close it only at the right depth');
  assert.deepEqual(exportsOf('const t = `${`\nexport const nested = 1;\n`}`;\nexport const outer = 2;'), ['outer'], 'a template inside a ${}');
  assert.deepEqual(exportsOf('const q = \'`\';\n// a ` in a comment\nexport const real = 1;'), ['real'], 'a backtick in a string or a comment starts no template');
  assert.deepEqual(exportsOf('const empty = ``;\nexport const next = 1;'), ['next'], 'an empty template');
  assert.deepEqual(exportsOf('const re = /`?([^`/]+)`?/;\nexport const afterRegex = a / b / c;\nexport const last = 1;'), ['afterRegex', 'last'], 'a backtick in a regex literal starts no template, and a division is no regex');
});

test('.acc/rules.md holds the test-coverage rule and names this check beside it', () => {
  const rules = read('.acc/rules.md');
  const rule = rules.split(/\n(?=- )/).find((r) => /coverage/i.test(r));
  assert.ok(rule, '.acc/rules.md has no test-coverage rule');
  assert.match(rule, /scripts\/test\/coverage\.test\.ts/);
  assert.match(rule, /\bOLDER\b/);
});

test('an export line after a regex that follows ) or ] still counts, and esbuild agrees', async () => {
  const afterParen = 'if (x) /`/.test(y);\nexport const a = 1;';
  // In a type, `]` ends the statement at a line break, so the next line's `/` starts a regex.
  const afterBracket = 'type M = number[]\n/`/.test(y);\nexport const c = 3;';
  const division = 'const d = (a) / 2 / (b);\nconst e = f[1] / 2;\nexport const g = `x`;';
  assert.deepEqual(exportsOf(afterParen), ['a']);
  assert.deepEqual(exportsOf(afterBracket), ['c']);
  assert.deepEqual(exportsOf(division), ['g'], 'a division after ) or ] is no regex');
  for (const [name, source] of Object.entries({ afterParen, afterBracket, division })) {
    const file = join(tmpdir(), `coverage-probe-${process.pid}-${name}.ts`);
    writeFileSync(file, source);
    try {
      assert.equal(exportsDisagree(source, exportsOf(source), await esbuildExportsOf(file)), '', name);
    } finally {
      rmSync(file);
    }
  }
});

test('the comparison with esbuild names a module where the lists differ: a name esbuild lacks, a re-export, a default, an empty module', () => {
  assert.match(exportsDisagree('export const a = 1;', ['a', 'b'], ['a']), /exportsOf finds b/);
  assert.match(exportsDisagree('export const a = 1;', ['a'], ['a', 'z']), /esbuild finds z/);
  assert.equal(exportsDisagree('export { z } from \'./z.ts\';\nexport const a = 1;', ['a'], ['a', 'z']), '', 'a re-export is only esbuild\'s');
  assert.equal(exportsDisagree('export default function f() {}', ['f'], ['default']), '', 'a default export is "default" to esbuild and its name to exportsOf');
  assert.match(exportsDisagree('const a = 1;', [], ['default']), /esbuild finds default/, 'a "default" with no export default statement is a difference');
  assert.equal(exportsDisagree('', [], []), '', 'an empty module has no differences');
  assert.deepEqual(reexportedNames('export { a, type B, c as d } from \'./x.ts\';\nexport * as ns from \'./y.ts\';\nexport * from \'./z.ts\';'), ['a', 'd', 'ns']);
  assert.deepEqual(reexportedNames('export {\n  a,\n  b,\n} from \'./x.ts\';'), ['a', 'b'], 'a list over several lines');
});
