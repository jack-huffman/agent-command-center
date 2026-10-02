/**
 * The plugin's hooks (D-042, DESIGN section 13): guards and reminders for builder sessions, in Claude
 * Code's own hook events. Each one returns at once outside a repo that has opted in with
 * .acc/config.json, and does nothing for a session that isn't a builder. None of them blocks by failing:
 * on anything unexpected it prints nothing, and Claude Code carries on as it would without acc.
 */
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { loadConfig } from './config.ts';
import type { Runner } from './exec.ts';
import { readList } from './gates.ts';
import { mutate, readLedger, type Task } from './ledger.ts';
import { repoPaths } from './paths.ts';

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
  if (envSpecific.some((p) => rel === p || rel.startsWith(`${p.replace(/\/+$/, '')}/`))) {
    return `${rel} is environment-specific (D-016): every org keeps its own version, and no task changes it. Leave it, and mention in your summary what it should say.`;
  }
  return null;
}

// ---------------------------------------------------------------- PreToolUse: Bash

/** A command line split into its commands, and each into words, as far as matters for these rules. */
export function commandsOf(line: string): string[][] {
  const out: string[][] = [];
  let words: string[] = [];
  let word = '';
  let quote: '"' | "'" | null = null;
  let any = false;
  const end = () => { if (any) words.push(word); word = ''; any = false; };
  const next = () => { end(); if (words.length) out.push(words); words = []; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\' && quote === '"' && i + 1 < line.length) word += line[++i];
      else word += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; any = true; continue; }
    if (c === '\\' && i + 1 < line.length) { word += line[++i]; any = true; continue; }
    if (/\s/.test(c) && c !== '\n') { end(); continue; }
    if (c === '\n' || c === ';' || c === '|' || c === '&' || c === '(' || c === ')') { next(); continue; }
    word += c;
    any = true;
  }
  next();
  // Leading environment assignments and wrappers don't change what runs.
  return out.map((w) => {
    let i = 0;
    while (i < w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i]!) || ['nice', 'env', 'time', 'command', 'npx'].includes(w[i]!) || (w[i - 1] === 'nice' && /^-n$|^-\d+$/.test(w[i]!)) || (w[i - 2] === 'nice' && w[i - 1] === '-n'))) i++;
    return w.slice(i);
  }).filter((w) => w.length);
}

const CLOSING = /\b(close[sd]?|fix(e[sd])?|resolve[sd]?)\b[\s:]+(#\d+|[A-Z][A-Z0-9_]*-\d+|https?:\/\/)/i;
const PERSON_ONLY_ACC = new Set(['set', 'dispatch', 'land', 'review', 'promote', 'deploy', 'init', 'cleanup', 'agents', 'setup']);

/** Why a builder may not run this, or null. Belt and braces with the builder's deny list (D-012). */
export function guardBash(b: Builder, line: string): string | null {
  for (const w of commandsOf(line)) {
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
    if (cmd === 'sf' && sub === 'project' && rest[0] === 'deploy') {
      const verb = rest[1];
      if (verb === 'quick' || verb === 'resume' || (verb === 'start' && !rest.includes('--dry-run'))) return 'Builders validate and never deploy (D-011). Use acc gate run validate, which is a check-only deploy.';
    }
    if (cmd === 'sf' && sub === 'org' && rest[0] === 'delete') return 'Builders never delete an org.';
    if (cmd === 'acc' && sub && (PERSON_ONLY_ACC.has(sub) || (sub === 'gate' && rest[0] === 'waive'))) {
      return `acc ${sub}${sub === 'gate' ? ' waive' : ''} is a person's. A builder finishes with acc done, or acc block "<what you need>".`;
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
}

const deny = (reason: string) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });

/** PreToolUse: a builder's edit or command that breaks a rule is refused, with what to do instead. */
export function preToolUseHook(input: EventInput, ctx: HookContext): Record<string, unknown> | null {
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
    return reason ? deny(reason) : null;
  }
  return null;
}

/** The few lines a builder needs again after its context was compacted or the session resumed. */
export function shortPacket(task: Task, gates: string[]): string {
  return [
    `You are the builder for ${task.id}: ${task.title}.`,
    `Work only in ${task.run?.worktree}, on ${task.run?.branch}.`,
    `Finish line: commit everything, run exactly \`acc gate run\`${gates.length ? ` (${gates.join(', ')})` : ''}, then run exactly \`acc done\`. If you're stuck, run \`acc block "<what you need>"\` and stop.`,
    'Never push, merge, open a pull request or deploy.',
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
  try {
    gates = loadConfig(join(b.root, '.acc', 'config.json')).config.gates.required;
  } catch {
    gates = [];
  }
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: shortPacket(b.task, gates) } };
}

/**
 * Stop: a builder that stops with its task still running is reminded of the finish line, once a
 * session. Claude Code's stop_hook_active means it's already continuing because of a stop hook.
 */
export function stopHook(input: EventInput, ctx: HookContext): Record<string, unknown> | null {
  if (input.stop_hook_active) return null;
  const b = builderFor(ctx);
  if (!b || b.task.state !== 'running') return null;
  const paths = repoPaths(b.root, ctx.run);
  const mark = join(paths.stateDir, 'hooks', `${(input.session_id ?? 'session').replace(/[^A-Za-z0-9-]/g, '')}.reminded`);
  if (existsSync(mark)) return null;
  try {
    mkdirSync(dirname(mark), { recursive: true });
    writeFileSync(mark, ctx.now().toISOString());
  } catch {
    return null; // no way to remember: better no reminder than one on every stop
  }
  return {
    decision: 'block',
    reason: `${b.task.id} is still running. If the work is done: commit everything, run exactly \`acc gate run\`, then \`acc done\`. If you can't finish it, run \`acc block "<what you need>"\` and stop. If you are still working, carry on.`,
  };
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

