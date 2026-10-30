/**
 * The plugin's hooks (D-042, DESIGN section 13): guards and reminders for builder sessions, in Claude
 * Code's own hook events. Each one returns at once outside a repo that has opted in with
 * .acc/config.json, and does nothing for a session that isn't a builder. None of them blocks by failing:
 * on anything unexpected it prints nothing, and Claude Code carries on as it would without acc.
 */
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { commandsOf, expands, rawCommandsOf, stripLeading } from './command-words.ts';
import { builderGatesFor, fullGates, loadConfig, requiredGates } from './config.ts';
import { deploysByHand, isSalesforceCli } from './deploy-commands.ts';
import { deployerTask, keepTypedYes } from './deploy-guide.ts';
import type { Runner } from './exec.ts';
import { readList } from './gates.ts';
import { NOTE_RULE } from './agent-notes.ts';
import { DONE_COMMAND, mutate, readLedger, type Task } from './ledger.ts';
import { repoPaths } from './paths.ts';
import { ANALYST_COMMANDS } from './analyze.ts';
import { noteRecordWrites } from './record-hooks.ts';
import { teamNotice } from './team.ts';

/** The repo folder with .acc/config.json at or above `cwd`, found without running git. */
export function findAccRoot(cwd: string): string | null {
  let dir = resolve(cwd);
  for (;;) {
    if (existsSync(join(dir, '.acc', 'config.json'))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const real = (p: string): string => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
const under = (path: string, root: string): boolean => {
  const r = relative(real(root), real(path));
  return r === '' || (!r.startsWith('..') && !r.startsWith(sep) && !/^[A-Za-z]:/.test(r));
};

export interface HookContext {
  cwd: string;
  env: NodeJS.ProcessEnv;
  run: Runner;
  now: () => Date;
}

export interface Builder {
  task: Task;
  worktree: string;
  /** The checkout acc's state is read from. */
  root: string;
}

/**
 * The builder this session is, if it's one: by the task its environment names (ACC_ROLE=builder), or
 * by its folder being a running task's worktree, for a session started some other way.
 */
export function builderFor(ctx: HookContext): Builder | null {
  const root = findAccRoot(ctx.cwd);
  if (!root) return null;
  let tasks: Task[];
  try {
    tasks = readLedger(repoPaths(root, ctx.run).ledger).tasks;
  } catch {
    return null;
  }
  const byEnv = ctx.env.ACC_ROLE === 'builder' && ctx.env.ACC_TASK ? tasks.find((t) => t.id === ctx.env.ACC_TASK) : undefined;
  const byFolder = tasks.find((t) => t.run?.worktree && (t.state === 'running' || t.state === 'rework') && under(ctx.cwd, t.run.worktree));
  const task = byEnv ?? byFolder;
  if (!task?.run?.worktree) return null;
  return { task, worktree: task.run.worktree, root };
}

// ---------------------------------------------------------------- PreToolUse: edits

export function guardEdit(b: Builder, filePath: string, envSpecific: string[]): string | null {
  if (!filePath) return null;
  const abs = resolve(b.worktree, filePath);
  if (!under(abs, b.worktree)) return `You're the builder for ${b.task.id}, and your only workspace is ${b.worktree}. ${filePath} is outside it. Make the change in your worktree, or say what you need with acc block.`;
  const rel = relative(real(b.worktree), real(abs)).split(sep).join('/');
  // The worktree's link to its git directory, or the directory itself (D-022): repointed, its commits would go elsewhere.
  if (rel === '.git' || rel.startsWith('.git/')) {
    return `${rel} is git's own, which git and acc keep; a builder never edits it. Use git's commands for what you need, and say with acc block if they aren't enough.`;
  }
  // The project's settings are a person's (D-206): a deploy reads where it goes from the main checkout, never from here.
  if (rel === '.acc' || rel.startsWith('.acc/')) {
    return `${rel} is the project's settings, which a person changes; acc writes the files under .acc/ itself, such as the floors a check raises. Leave it, and say in your note, or with acc block, what should change.`;
  }
  if (envSpecific.some((p) => rel === p || rel.startsWith(`${p.replace(/\/+$/, '')}/`))) {
    return `${rel} is environment-specific (D-016): every org keeps its own version, and no task changes it. Leave it, and mention in your summary what it should say.`;
  }
  return null;
}

// ---------------------------------------------------------------- PreToolUse: Bash

const CLOSING = /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\b[\s:]+(#\d+|[A-Z][A-Z0-9_]*-\d+|https?:\/\/)/i;
/**
 * acc's commands that are a person's, by name, or by name and subcommand where the rest of the command is a
 * builder's: acc gate run and list are, but not waiving a check or changing which checks run (GH-111), and
 * acc rules list is, but not copying rules in (GH-108), and acc github status is, but not switching the account a
 * clone pushes as (GH-113).
 */
export const PERSON_ONLY_ACC = new Set(['set', 'dispatch', 'land', 'review', 'autopilot', 'analyze', 'promote', 'deploy', 'init', 'cleanup', 'agents', 'setup', 'update', 'updates', 'resume', 'machine', 'collect', 'cloud', 'gate waive', 'gate relax', 'gate required', 'gate builder', 'rules import', 'trackers set', 'tidy add', 'tidy skip', 'rules accept', 'rules dismiss', 'github use', 'change step', 'hook']);

/** Whether a command word is acc: by its name, or its path, as the packet says to use when acc isn't found. */
const isAcc = (cmd: string | undefined): boolean => !!cmd && cmd.split('/').pop() === 'acc';

/**
 * An environment variable that changes which acc, sf or git runs, or where it goes (D-206): PATH picks
 * another program by the name; SF_* and SFDX_* point sf at another org or login; GIT_* points git at
 * another repository or runs a program for it; NODE_OPTIONS loads code into acc before it runs.
 */
const STEERING = /^(PATH|HOME|SF_\w*|SFDX_\w*|GIT_\w*|NODE_OPTIONS)$/;
/** The programs an assignment steers: acc, by name or path; sf and sfdx; git. */
const steered = (cmd: string | undefined): string | null => (isAcc(cmd) ? 'acc' : isSalesforceCli(cmd) ? cmd.split('/').pop()! : cmd === 'git' ? 'git' : null);
/** The names the assignments among a command's own words set: `export PATH=/x`, or `PATH=/x` alone. */
const assignedIn = (args: string[]): string[] => args.map((a) => /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(a)?.[1]).filter((n): n is string => !!n);

/**
 * Why a builder may not run this line for what its environment assignments set, or null (D-206): acc,
 * sf or git behind a PATH, SF_*, SFDX_*, GIT_* or NODE_OPTIONS assignment, which the hook can't follow,
 * and the same assigned, or exported, on its own for a later command on the line.
 */
function guardAssignments(raw: string[][]): string | null {
  const steers = (names: string[]) => names.filter((n) => STEERING.test(n));
  const programs = [...new Set(raw.map((w) => steered(stripLeading(w).words[0])).filter((p): p is string => !!p))];
  for (const w of raw) {
    const { assigned, words } = stripLeading(w);
    const [cmd, ...rest] = words;
    const program = steered(cmd);
    const before = steers(assigned);
    if (program && before.length) {
      return `Run ${program} plainly, without ${before[0]}= before it: an assignment of PATH, SF_*, GIT_* or NODE_OPTIONS changes which program runs, or where it goes, and acc can't see that. Run the command on its own, as it's written in your instructions.`;
    }
    // Set for the rest of the line: an assignment alone, or an export, with acc, sf or git after it.
    const kept = !cmd ? before : ['export', 'declare', 'typeset'].includes(cmd ?? '') ? steers(assignedIn(rest)) : [];
    if (kept.length && programs.length) {
      return `Don't set ${kept[0]} on a line that runs ${programs.join(', ')}: an assignment of PATH, SF_*, GIT_* or NODE_OPTIONS changes which program runs, or where it goes, and acc can't see that. Run the command on its own, as it's written in your instructions.`;
    }
  }
  return null;
}

/** Why a builder may not run this, or null. Belt and braces with the builder's deny list (D-012). */
export function guardBash(b: Builder, line: string): string | null {
  const raw = rawCommandsOf(line);
  const commands = raw.map((w) => stripLeading(w).words).filter((w) => w.length);
  const steeredBy = guardAssignments(raw);
  if (steeredBy) return steeredBy;
  const ending = commands.find(([cmd, sub]) => isAcc(cmd) && (sub === 'done' || sub === 'block'));
  if (ending && expands(line)) {
    // The command it was, quoted back: a block stays a block, so a stuck builder isn't steered into finishing.
    const again = ending[1] === 'block' ? (ending.includes('--client') ? 'acc block --client "<your question for the client>"' : 'acc block "<what you need>"') : DONE_COMMAND;
    return `The shell would run or expand a backtick or $ in that before acc saw your words. Write it again without them, in double quotes, all on one line: ${again}`;
  }
  for (const w of commands) {
    const [cmd, sub, ...rest] = w;
    const args = [sub, ...rest].filter((x): x is string => !!x);
    if (cmd === 'git') {
      if (sub === 'push') return 'Builders never push. Finish with acc done: a person lands your branch with acc land, which pushes it and opens the pull request.';
      if (args.includes('--no-verify') || (sub === 'commit' && args.includes('-n'))) return 'Don\'t skip the repo\'s git hooks (--no-verify). If a hook fails, fix what it found.';
      if (sub === 'commit') {
        const message = args.filter((a, i) => args[i - 1] === '-m' || args[i - 1] === '--message' || a.startsWith('--message=')).join('\n');
        if (CLOSING.test(message)) return 'Don\'t close the ticket from a commit message ("fixes", "closes" or "resolves"): a person closes it. Refer to it plainly, as refs #12.';
      }
      if (sub === 'switch' || (sub === 'checkout' && !args.includes('--') && args.some((a) => !a.startsWith('-')))) return `Stay on your branch, ${b.task.run?.branch ?? 'the task\'s branch'}, in your worktree. To restore a file, use git checkout -- <file>.`;
      if (sub === 'worktree') return 'acc makes and removes worktrees. Work in the one you have.';
      if (sub === 'reset' && args.includes('--hard')) return 'Don\'t reset --hard: it throws away work. Revert or amend what you need instead.';
    }
    if (cmd === 'gh' && sub === 'pr' && ['merge', 'create', 'close'].includes(rest[0] ?? '')) return 'Pull requests are a person\'s: acc land opens one after review, and a person merges it.';
    if ((cmd === 'gh' && sub === 'release' && ['create', 'upload', 'edit', 'delete'].includes(rest[0] ?? ''))
      || (cmd === 'npm' && (sub === 'run' || sub === 'run-script') && rest[0] === 'release')
      || (cmd === 'node' && args.some((a) => a.endsWith('scripts/release.mjs')))) return 'Releases are a person\'s: they run npm run release on main, after the merge. Finish with acc done.';
    // Every form of a hand deploy, sf's and sfdx's alike (D-206); a check-only one is validate's own.
    const form = deploysByHand(w);
    if (form) return `Builders never deploy by hand (D-011, D-206): ${form} is refused. acc gate run validate checks without saving, and acc gate run deploy deploys your change to the build org, checks it's there and runs its tests. Never to a protected org.`;
    if (cmd === 'sf' && sub === 'org' && rest[0] === 'delete') return 'Builders never delete an org.';
    // A command is a person's by its name, or by its name and subcommand, such as acc rules import (GH-108)
    // or acc tidy add (GH-104), and accepting or dismissing a suggested rule (GH-102); acc tidy alone, and
    // listing rules, their differences and the suggestions, only read.
    const two = `${sub} ${rest[0] ?? ''}`;
    if (isAcc(cmd) && sub && (PERSON_ONLY_ACC.has(sub) || PERSON_ONLY_ACC.has(two))) {
      return `acc ${PERSON_ONLY_ACC.has(sub) ? sub : two} is a person's. A builder finishes with acc done, or acc block "<what you need>".`;
    }
    // Closing the issues of tasks already done is a person's tidy (D-082); a plain acc sync isn't.
    if (isAcc(cmd) && sub === 'sync' && rest.some((a) => a === '--close-done' || a.startsWith('--close-done='))) {
      return 'acc sync --close-done is a person\'s: it closes GitHub issues. A builder finishes with acc done, or acc block "<what you need>".';
    }
  }
  return null;
}

/**
 * Why the analyst may not run this, or null (D-052). It reads, and only reads: the commands acc allows it,
 * each checked word by word, so `sf data query … && sf data delete …` stops at the second.
 */
export function guardAnalyst(line: string): string | null {
  const allowed = [...ANALYST_COMMANDS.any, ...ANALYST_COMMANDS.salesforce].map((c) => c.split(' '));
  for (const w of commandsOf(line)) {
    if (!allowed.some((a) => a.every((word, i) => w[i] === word))) {
      return `The analyst only reads: ${w.slice(0, 3).join(' ')} isn't one of its commands. Use git log, show, diff or grep, or the read-only sf commands (org display, data query, sobject describe, org list metadata, limits, project retrieve start).`;
    }
    if (w[0] === 'sf' && w[1] === 'project' && w.includes('--output-dir') && w.some((x) => x.startsWith('/') || x.startsWith('..'))) {
      return 'Retrieve into your working folder, the scratch project, without --output-dir.';
    }
  }
  return null;
}

// ---------------------------------------------------------------- PreToolUse: a deploy guide

/** The acc commands a deploy guide runs: it reads, deploys its own ticket and marks the steps it walks through. */
export const DEPLOYER_ACC = ['show', 'list', 'deploy', 'change', 'ticket', 'board', 'ste', 'doctor'] as const;
/** The git commands a deploy guide runs: each only reads. */
export const DEPLOYER_GIT = ['log', 'show', 'diff', 'status', 'rev-parse', 'ls-files', 'blame', 'describe', 'shortlog'] as const;
/**
 * sf's commands a deploy guide runs: the analyst's reads but a retrieve, which writes the project's files, and
 * the runbook's own steps in the org, a permission set assigned and a record made, changed or deleted. Anything
 * else of sf is refused, as `sf api request` can deploy and `sf org` can delete or repoint an org (third review).
 */
export const DEPLOYER_SF = [
  ...ANALYST_COMMANDS.salesforce.filter((c) => c !== 'sf project retrieve start'),
  'sf org assign permset', 'sf org assign permsetlicense', 'sf data create record', 'sf data update record', 'sf data delete record',
] as const;
/** The only variables a guide's command may name, each as a whole word: what its chat was opened with. */
const GUIDE_VARS = ['${ACC_DEPLOY_TO}', '$ACC_DEPLOY_TO', '${ACC_TASK}', '$ACC_TASK'];
/** A character a guide's command may hold outside quotes. */
const PLAIN = /[A-Za-z0-9_\-.\/:=,@%+]/;

/**
 * A deploy guide's command line read strictly (T-154): its commands and their words, or why it can't be read.
 * Only plain words, 'single quotes', and "double quotes" with no $, backtick or backslash; commands joined by
 * && or ; and nothing else. GUIDE_VARS stand as they are. Anything a shell would expand, redirect, glob, pipe or
 * run in the background is refused, rather than read past: an allowlist, as a guard that reads the shell can
 * always be gone round (the review's finding).
 */
export function guideCommands(line: string): { commands: string[][] } | { why: string } {
  const commands: string[][] = [];
  let words: string[] = [];
  let word: string | null = null;
  const endWord = () => { if (word !== null) words.push(word); word = null; };
  const endCommand = () => { endWord(); if (words.length) commands.push(words); words = []; };
  // A variable stands only as a whole word: $ACC_TASKZ is another, unset, variable, and zsh's $ACC_TASK:s@…@…@ rewrites it.
  const wholeVar = (at: number, ends: string): string | undefined => GUIDE_VARS.find((x) => line.startsWith(x, at) && ends.includes(line[at + x.length] ?? ' '));
  for (let i = 0; i < line.length;) {
    const v: string | undefined = word === null ? wholeVar(i, ' \t;&') : undefined;
    if (v) { word = v; i += v.length; continue; }
    const c = line[i]!;
    if (c === ' ' || c === '\t') { endWord(); i++; continue; }
    if (c === ';') { endCommand(); i++; continue; }
    if (c === '&' && line[i + 1] === '&') { endCommand(); i += 2; continue; }
    if (c === "'") {
      const close = line.indexOf("'", i + 1);
      if (close < 0) return { why: 'a quote that doesn\'t close' };
      word = (word ?? '') + line.slice(i + 1, close);
      i = close + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let text = '';
      // A variable in double quotes is the quote's whole text, and the quote a whole word: "$ACC_TASK".
      const u: string | undefined = word === null ? wholeVar(j, '"') : undefined;
      if (u && ' \t;&'.includes(line[j + u.length + 1] ?? ' ')) { word = u; i = j + u.length + 1; continue; }
      while (j < line.length && line[j] !== '"') {
        if ('$`\\'.includes(line[j]!)) return { why: `${line[j]} inside double quotes` };
        text += line[j];
        j++;
      }
      if (j >= line.length) return { why: 'a quote that doesn\'t close' };
      word = (word ?? '') + text;
      i = j + 1;
      continue;
    }
    if (!PLAIN.test(c)) return { why: c === '\n' ? 'more than one line' : `"${c}" outside quotes` };
    word = (word ?? '') + c;
    i++;
  }
  endCommand();
  return { commands };
}

/** The task a word names, where it's the guide's own: the id, or $ACC_TASK as the skill writes it. */
const namesTask = (word: string | undefined, task: string): boolean => !!word && (['$ACC_TASK', '${ACC_TASK}'].includes(word) || word.toUpperCase() === task);

/**
 * Why a deploy guide's command is refused, or null (T-154). An allowlist: each command is acc, sf or git, named
 * as itself, in a line guideCommands reads. acc: show, list, deploy of its own ticket with no name typed, change
 * list and change step of its own ticket, ticket, board, ste and doctor. sf: anything but a deploy, its project's
 * files, plugins, aliases and settings, or a file written. git: what reads. Nothing touches acc's own state or
 * hooks, where the person's yes is kept. The guide's settings deny the same in Claude Code itself
 * (DEPLOYER_DENIES), and ask the person before each command.
 */
export function guardDeployer(task: string, line: string): string | null {
  const read = guideCommands(line);
  if ('why' in read) return `The deploy guide runs plain commands only, each acc, sf or git, joined by && or ;. This line has ${read.why}. Run each command on its own, with nothing for the shell to expand.`;
  for (const w of read.commands) {
    if (w.some((x) => /deploy-yes|user-prompt-submit|\.git[\\/]+acc\b|ACC_ROLE/.test(x))) return 'acc\'s own state and hooks, the person\'s yes among them, are acc\'s: the deploy guide never reads, writes or runs them.';
    const [first, sub = ''] = w;
    if (first === 'sf' || first === 'sfdx') {
      const hand = deploysByHand(w);
      if (hand) return `The deploy guide never deploys by hand (${hand}): acc deploy --task ${task} does, with the person's yes from the chat.`;
      const known = DEPLOYER_SF.find((c) => c.split(' ').every((x, k) => w[k] === x));
      if (!known) return `The deploy guide runs these of sf: ${DEPLOYER_SF.join(', ')}. ${w.slice(0, 3).join(' ')} isn't one: make it a step by hand, and say exactly how.`;
      if (w.some((x) => /^--(output-dir|output-file|flags-dir)\b/.test(x))) return 'The deploy guide writes no file and reads no flags from one: run it without --output-dir, --output-file or --flags-dir.';
      if (known.startsWith('sf data ') && known.endsWith(' record') && w.some((x) => /^(--use-tooling-api|-t)$/.test(x))) return 'The deploy guide changes records, never metadata through the Tooling API: that is a deploy, and acc deploy\'s.';
      continue;
    }
    if (first === 'git') {
      if (!(DEPLOYER_GIT as readonly string[]).includes(sub)) return `The deploy guide's git only reads: ${DEPLOYER_GIT.map((g) => `git ${g}`).join(', ')}.`;
      if (w.some((x) => /^--(output|ext-diff|textconv|exec)\b/.test(x))) return 'The deploy guide\'s git only reads, and writes no file.';
      continue;
    }
    if (first !== 'acc') return `The deploy guide runs acc, sf and git only, each named as itself: ${first} isn't one. Tell the person what you need.`;
    if (!(DEPLOYER_ACC as readonly string[]).includes(sub)) return `The deploy guide runs ${DEPLOYER_ACC.map((c) => `acc ${c}`).join(', ')}. acc ${sub} is a person's: tell them what you need.`;
    if (sub === 'change' && !['list', 'step'].includes(w[2] ?? '')) return 'The deploy guide lists a ticket\'s changes outside git and marks their steps: acc change list, or acc change step. It records none.';
    if (sub === 'change' && w[2] === 'step' && !namesTask(w[3], task)) return `The deploy guide marks ${task}'s steps alone.`;
    if (sub === 'deploy') {
      const i = w.findIndex((x) => x === '--task' || x.startsWith('--task='));
      const flag = i < 0 ? '' : w[i]!;
      const id = i < 0 ? undefined : flag.startsWith('--task=') ? flag.slice('--task='.length) : w[i + 1];
      if (!namesTask(id, task)) return `The deploy guide deploys ${task} alone: acc deploy --task ${task}.`;
      if (w.some((x) => /^--(confirm-production|confirm-name|deploy-check)(=|$)/.test(x))) return 'The deploy guide never types the org\'s name: the person types it in the chat, and acc deploy reads it from there.';
    }
  }
  return null;
}

// ---------------------------------------------------------------- the events

export interface EventInput {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  source?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  stop_hook_active?: boolean;
  /** UserPromptSubmit: what the person typed. */
  prompt?: string;
}

const deny = (reason: string) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

/** PreToolUse: a builder's edit or command that breaks a rule is refused, with what to do instead. */
export function preToolUseHook(input: EventInput, ctx: HookContext): Record<string, unknown> | null {
  const guide = deployerTask(ctx.env);
  if (guide) {
    const tool = input.tool_name ?? '';
    if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) return deny('The deploy guide changes no file: a change to the code is a task of its own. Tell the person what you found.');
    if (tool === 'Bash') {
      const reason = guardDeployer(guide.toUpperCase(), String(input.tool_input?.command ?? ''));
      return reason ? deny(reason) : null;
    }
    return null;
  }
  if (ctx.env.ACC_ROLE === 'analyst') {
    const tool = input.tool_name ?? '';
    if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) return deny('The analyst changes nothing. Put what you would change in the approach.');
    if (tool === 'Bash') {
      const reason = guardAnalyst(String(input.tool_input?.command ?? ''));
      return reason ? deny(reason) : null;
    }
    return null;
  }
  const b = builderFor(ctx);
  if (!b) return null;
  const tool = input.tool_name ?? '';
  const t = input.tool_input ?? {};
  if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
    let list: string[] = [];
    try {
      list = readList(b.worktree, loadConfig(join(b.worktree, '.acc', 'config.json')).config.environmentSpecific);
    } catch {
      list = [];
    }
    const reason = guardEdit(b, String(t.file_path ?? t.notebook_path ?? ''), list);
    return reason ? deny(reason) : null;
  }
  if (tool === 'Bash') {
    const reason = guardBash(b, String(t.command ?? ''));
    // A command it lets through that can write records is noted, for acc done to ask after (T-100).
    if (!reason) noteRecordWrites(b, String(t.command ?? ''), ctx);
    return reason ? deny(reason) : null;
  }
  return null;
}

/**
 * PostToolUse: a running builder is told, once a merge, when a teammate's work that shares files with its
 * own merged into its environment's branch (T-103), with what it shares and that acc refresh takes it in.
 */
export function postToolUseHook(_input: EventInput, ctx: HookContext): Record<string, unknown> | null {
  const b = builderFor(ctx);
  if (!b || b.task.state !== 'running') return null;
  try {
    const paths = repoPaths(b.root, ctx.run);
    const config = loadConfig(paths.config).config;
    const said = teamNotice(paths, config, readLedger(paths.ledger), ctx.run, b.task.id);
    return said ? { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: said } } : null;
  } catch {
    return null; // a notice is a help: without one the builder carries on, and acc team still says it
  }
}

/**
 * The few lines a builder needs again after its context was compacted or the session resumed. `full` is
 * the full check, named where the builder's gates are the lighter ones and the merge queue runs it (GH-73).
 */
export function shortPacket(task: Task, gates: string[], full: string[] = []): string {
  return [
    `You are the builder for ${task.id}: ${task.title}.`,
    `Work only in ${task.run?.worktree}, on ${task.run?.branch}.`,
    `Finish line: commit everything, run exactly \`acc gate run\`${gates.length ? ` (${gates.join(', ')})` : ''}, then finish with your note, all on one line: \`${DONE_COMMAND}\`. Give a flag again for each further line; use double quotes, with no backticks or $ inside. If you're stuck, run \`acc block "<what you need>"\` and stop.`,
    ...(full.length ? [`The full check (${full.join(', ')}) runs once, in the merge queue, before the merge.`] : []),
    'Never push, merge a pull request, or open one. Never deploy except through `acc gate run deploy` (a Salesforce task\'s own deploy to its build org), and never to a protected org.',
    // How a note to a person reads (T-146): a headline, a bullet per thing, API names as code.
    NOTE_RULE,
    // Every project's rules (GH-104), which keep parallel work mergeable, in one line.
    'Rules: put new behaviour in its own file, registered with one line where a list names every area; if another task\'s change breaks your build, `acc block` with the reason and don\'t edit its files; write a manifest or config file whole, to a temp file then a rename.',
    // Its team (T-103): what the other builders change now, and taking in a teammate's merge early.
    'Your team: `acc team` says what the other tasks in flight change; run it before you change a file the team shares. `acc refresh` takes in what merged since your branch left.',
    `Your full instructions: acc show ${task.id}.`,
  ].join('\n');
}

/**
 * SessionStart: links the session to its task, so the page can show and open it; on a resume or a
 * compaction, gives the builder its short instructions again.
 */
export function sessionStartHook(input: EventInput, ctx: HookContext): Record<string, unknown> | null {
  const b = builderFor(ctx);
  if (!b) return null;
  const id = input.session_id;
  if (id && b.task.run && b.task.run.sessionId !== id) {
    try {
      mutate(repoPaths(b.root, ctx.run), ctx.now, (l, emit) => {
        const t = l.tasks.find((x) => x.id === b.task.id);
        if (!t?.run || t.run.sessionId === id) return;
        t.run.sessionId = id;
        emit({ type: 'task.updated', task: t.id, actor: 'builder', by: `builder:${t.id}`, data: { sessionId: id } });
      });
    } catch {
      // linking is a convenience; the session still runs
    }
  }
  if (input.source !== 'resume' && input.source !== 'compact') return null;
  let gates: string[] = [];
  let full: string[] = [];
  try {
    const config = loadConfig(join(b.root, '.acc', 'config.json')).config;
    // A builder's checks: the lighter ones where the merge queue runs the full one (GH-73).
    gates = requiredGates(config, b.task.environment, 'builder');
    full = builderGatesFor(config, b.task.environment) ? fullGates(config).filter((g) => !gates.includes(g)) : [];
  } catch {
    gates = [];
  }
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: shortPacket(b.task, gates, full) } };
}

/** Where the Stop hook remembers it reminded a session. A resume clears it, so the resumed turn is reminded too (D-067). */
export const remindedPath = (stateDir: string, sessionId: string | undefined): string =>
  join(stateDir, 'hooks', `${(sessionId ?? 'session').replace(/[^A-Za-z0-9-]/g, '')}.reminded`);

/**
 * Stop: a builder that stops with its task still running is reminded of the finish line, once a
 * session. Claude Code's stop_hook_active means it's already continuing because of a stop hook.
 */
export function stopHook(input: EventInput, ctx: HookContext): Record<string, unknown> | null {
  if (input.stop_hook_active) return null;
  const b = builderFor(ctx);
  if (!b || b.task.state !== 'running') return null;
  const paths = repoPaths(b.root, ctx.run);
  const mark = remindedPath(paths.stateDir, input.session_id);
  if (existsSync(mark)) return null;
  try {
    mkdirSync(dirname(mark), { recursive: true });
    writeFileSync(mark, ctx.now().toISOString());
  } catch {
    return null; // no way to remember: better no reminder than one on every stop
  }
  return {
    decision: 'block',
    reason: `${b.task.id} is still running. If the work is done: commit everything, run exactly \`acc gate run\`, then finish with your note, all on one line: \`${DONE_COMMAND}\`. If you can't finish it, run \`acc block "<what you need>"\` and stop. If you are still working, carry on.`,
  };
}

/**
 * UserPromptSubmit: in a deploy guide's chat, each message the person sends is kept as their latest, for acc
 * deploy to read as their yes (T-154). It fires only on what the person types, never on the agent's words.
 */
export function userPromptSubmitHook(input: EventInput, ctx: HookContext): Record<string, unknown> | null {
  const task = deployerTask(ctx.env);
  const root = task ? findAccRoot(ctx.cwd) : null;
  if (!task || !root) return null;
  keepTypedYes(repoPaths(root, ctx.run), task.toUpperCase(), input.prompt ?? '', input.session_id ?? null, ctx.now);
  return null;
}

/** Reads the hook's input, for tests and the CLI alike. */
export function parseEventInput(text: string): EventInput | null {
  try {
    const x = JSON.parse(text) as EventInput;
    return x && typeof x === 'object' ? x : null;
  } catch {
    return null;
  }
}

