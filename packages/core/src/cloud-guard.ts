/**
 * The cloud push guard (GH-69): a PreToolUse hook committed in a repo that opted in to cloud builders, so
 * it loads in cloud sessions, where the plugin's hooks don't. It needs no acc, no ledger and no plugin: a
 * Node script the repo carries, which Claude Code runs before each Bash command. In a cloud session
 * (CLAUDE_CODE_REMOTE=true) it refuses a push to any branch but the one checked out, which must be a task
 * branch, a force push, a branch deletion, a pull request merged, opened or closed, and a deploy. Outside
 * the cloud it prints nothing: local builders have the plugin's guards (D-042), and a person on main isn't
 * a builder.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Where the guard lives in a repo, and the settings file that runs it. */
export const GUARD_PATH = '.claude/hooks/acc-push-guard.mjs';
export const SETTINGS_PATH = '.claude/settings.json';
/** The hook entry, as Claude Code's settings take it: ours is found again by its command. */
export const GUARD_COMMAND = `node ${GUARD_PATH}`;

/** The guard, as it's written into a repo. Its tests run this same text. */
export const GUARD_SCRIPT = `#!/usr/bin/env node
// acc's cloud push guard (GH-69): refuses what a cloud builder must never do. Written by acc cloud enable;
// acc cloud enable writes it again. In a cloud session (CLAUDE_CODE_REMOTE=true), before each Bash command,
// it refuses a push to any branch but the task branch checked out, a force push, a branch deleted, a pull
// request merged, opened or closed, and a deploy. Anywhere else it says nothing. It never blocks by failing:
// on anything unexpected it prints nothing, and Claude Code carries on.
import { execFileSync } from 'node:child_process';

const deny = (reason) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));

/** A command line split into its commands, and each into words: quotes kept together, separators cut. */
function commandsOf(line) {
  const out = [];
  let words = [];
  let word = '';
  let quote = null;
  let any = false;
  const end = () => { if (any) words.push(word); word = ''; any = false; };
  const next = () => { end(); if (words.length) out.push(words); words = []; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === '\\\\' && quote === '"' && i + 1 < line.length) word += line[++i];
      else word += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; any = true; continue; }
    if (c === '\\\\' && i + 1 < line.length) { word += line[++i]; any = true; continue; }
    if (/\\s/.test(c) && c !== '\\n') { end(); continue; }
    if (c === '\\n' || c === ';' || c === '|' || c === '&' || c === '(' || c === ')') { next(); continue; }
    word += c;
    any = true;
  }
  next();
  return out.map((w) => {
    let i = 0;
    while (i < w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i]) || ['nice', 'env', 'time', 'command', 'npx', 'sudo'].includes(w[i]) || (w[i - 1] === 'nice' && /^-n$|^-\\d+$/.test(w[i])) || (w[i - 2] === 'nice' && w[i - 1] === '-n'))) i++;
    return w.slice(i);
  }).filter((w) => w.length);
}

const FORCE = new Set(['-f', '--force', '--force-with-lease', '--force-if-includes', '--mirror', '--all', '--tags', '--delete', '-d', '--prune']);

/** Why a cloud builder may not run this push, given the branch it has checked out, or null. */
function pushProblem(args, branch) {
  if (!/^task\\//.test(branch)) return \`A cloud builder pushes only its task branch, and this checkout is on \${branch || 'no branch'}. Check out your task branch, task/<id>-<slug>, and push only it.\`;
  const flags = args.filter((a) => a.startsWith('-'));
  const forced = flags.find((a) => FORCE.has(a) || FORCE.has(a.split('=')[0]) || /^-[a-zA-Z]*[fd][a-zA-Z]*$/.test(a));
  if (forced) return \`Never \${forced === '-d' || forced === '--delete' ? 'delete a branch' : forced === '--all' || forced === '--mirror' || forced === '--tags' ? 'push everything' : 'force-push'} (\${forced}). Push only \${branch}, with plain commits.\`;
  const rest = args.filter((a) => !a.startsWith('-'));
  const [remote, ...refspecs] = rest;
  if (remote && remote !== 'origin') return \`Push to origin only, not \${remote}.\`;
  for (const spec of refspecs) {
    if (spec.startsWith('+')) return \`Never force-push (\${spec}). Push only \${branch}, with plain commits.\`;
    const [src, dst] = spec.includes(':') ? spec.split(':', 2) : [spec, spec];
    if (!src) return \`Never delete a branch (\${spec}).\`;
    const name = (r) => r.replace(/^refs\\/heads\\//, '');
    if (name(src) !== branch && src !== 'HEAD') return \`Push only your task branch, \${branch}, not \${src}.\`;
    if (name(dst) !== branch) return \`Push only your task branch, \${branch}, not \${dst}. A person lands it: never push \${dst}.\`;
  }
  return null;
}

/** Why a cloud builder may not run this command line, or null. */
function guard(line, branch) {
  for (const w of commandsOf(line)) {
    const [cmd, sub, ...rest] = w;
    if (cmd === 'git' && sub === 'push') return pushProblem(rest, branch);
    if (cmd === 'gh' && sub === 'pr' && ['merge', 'create', 'close', 'ready'].includes(rest[0] ?? '')) return 'Pull requests are a person\\'s: acc land opens one after review, and a person merges it. Push your task branch with an Acc-Done trailer and stop.';
    if (cmd === 'gh' && sub === 'api' && rest.some((a) => /pulls\\/\\d+\\/merge|\\/merges$/.test(a))) return 'Never merge through the API. A person merges.';
    if (cmd === 'sf' && sub === 'project' && rest[0] === 'deploy' && ['start', 'quick', 'resume'].includes(rest[1] ?? '') && !rest.includes('--dry-run')) return 'Builders validate and never deploy (D-011). A cloud session has no org anyway.';
  }
  return null;
}

/** The branch checked out in a folder, by git, or '' when there's none. */
function branchIn(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

async function main() {
  if (process.env.CLAUDE_CODE_REMOTE !== 'true') return;
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return;
  }
  if (input?.tool_name !== 'Bash') return;
  const line = String(input.tool_input?.command ?? '');
  if (!/\\b(git|gh|sf)\\b/.test(line)) return;
  const reason = guard(line, branchIn(input.cwd || process.cwd()));
  if (reason) deny(reason);
}

main().catch(() => undefined);
`;

/** Claude Code's settings file, as far as the guard touches it: the hooks block. */
interface Settings {
  hooks?: Record<string, { matcher?: string; hooks?: { type?: string; command?: string; timeout?: number }[] }[]>;
  [k: string]: unknown;
}

/** Whether a repo's settings run the guard: a PreToolUse hook with its command. */
export function guardInstalled(root: string): boolean {
  const file = join(root, SETTINGS_PATH);
  if (!existsSync(file) || !existsSync(join(root, GUARD_PATH))) return false;
  try {
    const s = JSON.parse(readFileSync(file, 'utf8')) as Settings;
    return (s.hooks?.PreToolUse ?? []).some((h) => (h.hooks ?? []).some((x) => x.command === GUARD_COMMAND));
  } catch {
    return false;
  }
}

/**
 * Writes the guard into a repo (GH-69): the script, and a PreToolUse hook in .claude/settings.json that
 * runs it on Bash. Other hooks and settings in the file are kept. Each file is written whole, to a temp
 * file then a rename. Returns what it wrote, for the person to commit.
 */
export function installGuard(root: string): { written: string[] } {
  const written: string[] = [];
  const script = join(root, GUARD_PATH);
  mkdirSync(dirname(script), { recursive: true });
  if (!existsSync(script) || readFileSync(script, 'utf8') !== GUARD_SCRIPT) {
    writeWhole(script, GUARD_SCRIPT);
    written.push(GUARD_PATH);
  }
  const file = join(root, SETTINGS_PATH);
  let settings: Settings = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8')) as Settings;
    } catch (e) {
      throw new Error(`${SETTINGS_PATH} isn't valid JSON: ${(e as Error).message}`);
    }
  }
  if (!guardInstalled(root) || !existsSync(file)) {
    const hooks = settings.hooks ?? {};
    const pre = (hooks.PreToolUse ?? []).filter((h) => !(h.hooks ?? []).some((x) => x.command === GUARD_COMMAND));
    pre.push({ matcher: 'Bash', hooks: [{ type: 'command', command: GUARD_COMMAND, timeout: 10 }] });
    settings = { ...settings, hooks: { ...hooks, PreToolUse: pre } };
    writeWhole(file, JSON.stringify(settings, null, 2) + '\n');
    written.push(SETTINGS_PATH);
  }
  return { written };
}

function writeWhole(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}
