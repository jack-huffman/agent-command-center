#!/usr/bin/env node
// acc's cloud push guard (GH-69): what a cloud builder must never do, refused before it runs. Written by
// acc cloud enable, which writes it again when acc's own changes; committed under .claude/hooks/ and run by
// the PreToolUse hook in .claude/settings.json on Bash, Edit, Write, MultiEdit and NotebookEdit. It needs
// no acc, no ledger and no plugin: a cloud session runs only what the repo commits.
//
// In a cloud session (CLAUDE_CODE_REMOTE=true, or CLAUDE_CODE_REMOTE_SESSION_ID set) it allows a push of
// the task's own branch alone, `git push origin <branch>` or `git push origin HEAD:<branch>`, with -u or
// --set-upstream before origin if wanted, and refuses everything else that could push: any other push,
// a push reached through git's global options, a path to git, a wrapper (timeout, env, nohup, xargs,
// eval), a shell with -c, whose inner line it guards the same way, or running a script file, a git alias
// and anything that writes one, a remote changed or added, gh api with any method but GET or a git/refs
// path or a GraphQL mutation, gh pr merge, and a deploy. The branch is the task's, from the record acc put
// in the fire's text (an Acc-Branch line), read from the session's first message in its transcript: never
// from the checkout, which a builder could switch. It also refuses an Edit, Write or Bash write under
// .claude/, where it lives, and a checkout, reset, merge or revert that would change it.
//
// It fails closed: input it can't read, or an error of its own, blocks the command (exit 2). Outside a
// cloud session it prints nothing and exits 0: local builders have the plugin's guards (D-042), and a
// person on main isn't a builder.
import { execFileSync } from 'node:child_process';
import { closeSync, openSync, readSync, realpathSync } from 'node:fs';
import { basename, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The line acc puts in the fire's text, which names the task's branch: the guard's record. */
export const RECORD = 'Acc-Branch';
/** What the task's branch looks like. */
export const BRANCH = /^task\/[A-Za-z0-9._/-]+$/;
/** Whether this is a cloud session: the documented session id, or the flag the CLI sets. */
export const inCloud = (env = process.env) => env.CLAUDE_CODE_REMOTE === 'true' || !!env.CLAUDE_CODE_REMOTE_SESSION_ID;
/** The tools the guard looks at; every other tool passes without a word. */
const TOOLS = new Set(['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

// ---------------------------------------------------------------- the command line, split

/** A command line split into its commands, and each into words: quotes kept together, separators cut. Nothing stripped. */
export function rawCommandsOf(line) {
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
      else if (c === '\\' && quote === '"' && i + 1 < line.length) word += line[++i];
      else word += c;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; any = true; continue; }
    if (c === '\\' && i + 1 < line.length) { word += line[++i]; any = true; continue; }
    if (/\s/.test(c) && c !== '\n') { end(); continue; }
    if (c === '\n' || c === ';' || c === '|' || c === '&' || c === '(' || c === ')' || c === '`') { next(); continue; }
    word += c;
    any = true;
  }
  next();
  return out;
}

/** The same, with leading environment assignments and the wrappers that don't change what runs stripped: as acc's hooks.ts commandsOf, and a test keeps the two the same. */
export function commandsOf(line) {
  return rawCommandsOf(line).map((w) => {
    let i = 0;
    while (i < w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[i]) || ['nice', 'env', 'time', 'command', 'npx', 'sudo'].includes(w[i]) || (w[i - 1] === 'nice' && /^-n$|^-\d+$/.test(w[i])) || (w[i - 2] === 'nice' && w[i - 1] === '-n'))) i++;
    return w.slice(i);
  }).filter((w) => w.length);
}

// ---------------------------------------------------------------- the record

/**
 * The task's branch from the transcript (the fire's text, in the session's first message): the first
 * Acc-Branch line in a user message before the first assistant turn. Later messages never count: a tool's
 * result comes back as a user message too, and a builder could put anything in one.
 */
export function recordOf(transcript) {
  const pattern = new RegExp(`^\\s*${RECORD}:\\s*(\\S+)\\s*$`, 'm');
  for (const raw of transcript.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry?.type === 'assistant') return null;
    if (entry?.type !== 'user') continue;
    const content = entry.message?.content;
    const texts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter((b) => b && b.type === 'text').map((b) => String(b.text ?? '')) : [];
    for (const t of texts) {
      const m = pattern.exec(t);
      if (m) return BRANCH.test(m[1]) ? m[1] : null;
    }
  }
  return null;
}

/** The first part of a file, enough for the session's first message. */
function readHead(file, bytes = 4 * 1024 * 1024) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.toString('utf8', 0, n);
  } finally {
    closeSync(fd);
  }
}

// ---------------------------------------------------------------- git

const WRAPPERS = new Set(['timeout', 'env', 'nohup', 'xargs', 'nice', 'ionice', 'sudo', 'doas', 'time', 'command', 'builtin', 'exec', 'setsid', 'stdbuf', 'unbuffer', 'chronic', 'caffeinate', 'npx']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const INTERPRETERS = new Set(['node', 'nodejs', 'deno', 'bun', 'python', 'python3', 'ruby', 'perl', 'php', 'tsx', 'ts-node']);
/** git settings a cloud builder never sets, for a command or for good: each could send a push somewhere else, or run something. */
const DANGEROUS_KEY = /^(alias|push|remote|url|credential|include|includeif)\.|^core\.(hookspath|sshcommand|gitproxy|askpass|fsmonitor|pager)$/i;
const FORCE = { '-f': 'force-push', '--force': 'force-push', '--force-with-lease': 'force-push', '--force-if-includes': 'force-push', '--mirror': 'push everything', '--all': 'push everything', '--tags': 'push tags', '--follow-tags': 'push tags', '--delete': 'delete a branch', '-d': 'delete a branch', '--prune': 'delete branches' };
/** Commands that only read, so a line of them may name the guard's files. */
const READ_ONLY = new Set(['cat', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'ls', 'wc', 'stat', 'file', 'diff', 'cmp', 'md5sum', 'shasum', 'sha256sum', 'jq', 'echo', 'printf', 'test', '[', 'true', 'false', 'find', 'tree', 'du', 'pwd', 'which', 'type']);
const GIT_READS = new Set(['diff', 'show', 'log', 'status', 'blame', 'cat-file', 'ls-files', 'ls-tree', 'grep']);
/** The guard's own files, as paths from the repo's root. */
export const GUARD_FILES = ['.claude/hooks', '.claude/settings.json'];

const name = (word) => (word ? basename(word) : '');
const allowedPush = (record) => `git push origin ${record} (or git push origin HEAD:${record}, with -u before origin if you like)`;

/** Why this push may not run, given the task's branch from the record, or null for the two allowed forms. */
export function pushProblem(args, record) {
  if (!record) return `The guard has no record of your branch: no ${RECORD} line in this session's first message. It allows no push without one. Commit your work and stop: a person collects it.`;
  const words = [...args];
  if (words[0] === '-u' || words[0] === '--set-upstream') words.shift();
  if (words.length === 2 && words[0] === 'origin' && (words[1] === record || words[1] === `HEAD:${record}`)) return null;
  const how = `Push only your task branch, plainly: ${allowedPush(record)}.`;
  const flag = words.find((a) => a.startsWith('-'));
  if (flag) {
    const short = /^-[a-zA-Z]+$/.test(flag) ? [...flag.slice(1)].map((c) => `-${c}`).find((f) => FORCE[f]) : null;
    const why = FORCE[flag] ?? FORCE[flag.split('=')[0]] ?? (short ? FORCE[short] : null);
    return `Never ${why ?? `push with ${flag}`} (${flag}). ${how}`;
  }
  const [remote, ...specs] = words;
  if (!remote) return `A bare git push could go anywhere. ${how}`;
  if (remote !== 'origin') return `Push to origin only, not ${remote}. ${how}`;
  for (const spec of specs) {
    if (spec.startsWith('+')) return `Never force-push (${spec}). ${how}`;
    const [src, dst] = spec.includes(':') ? spec.split(':', 2) : [spec, spec];
    if (!src) return `Never delete a branch (${spec}). ${how}`;
    const plain = (r) => r.replace(/^refs\/heads\//, '');
    if (plain(dst) !== record) return `Push only your task branch, ${record}, not ${plain(dst)}. A person lands it: never push ${plain(dst)}. ${how}`;
    if (plain(src) !== record && src !== 'HEAD') return `Push only your task branch, ${record}, not ${plain(src)}. ${how}`;
  }
  return `${how} Not: git push ${args.join(' ')}.`;
}

function configProblem(rest) {
  if (rest.includes('-e') || rest.includes('--edit')) return 'Never open the git config in an editor. Set user.name and user.email plainly, if that\'s what you need.';
  if (rest.some((a) => /^(--get|--get-all|--get-regexp|--get-urlmatch|-l|--list|--show-origin|--show-scope)$/.test(a))) return null;
  const key = rest.find((a) => !a.startsWith('-') && DANGEROUS_KEY.test(a));
  if (key) return `Never set ${key}: an alias, push, remote, url, credential or hook setting could make git push somewhere else, or run something. Set only user.name, user.email and the like.`;
  return null;
}

function checkoutProblem(sub, rest, record) {
  if (rest.includes('--')) return null; // files restored from the index, or the branch: not a branch switch
  if (rest.some((a) => ['-b', '-B', '-c', '-C', '--orphan', '--detach', '-t', '--track'].includes(a) || a.startsWith('--orphan=') || a.startsWith('--track='))) return `Make no new branch. Stay on your task branch${record ? `, ${record}` : ''}.`;
  const target = rest.find((a) => !a.startsWith('-'));
  if (!target) return null;
  if (!record) return `The guard has no record of your branch (no ${RECORD} line in this session's first message), so it can't let you switch to ${target}.`;
  if (target !== record) return `Stay on your task branch, ${record}. git ${sub} ${target} would leave it. To restore a file, use git checkout -- <file>.`;
  return null;
}

/** Why merging, rebasing onto, cherry-picking or reverting these refs may not run: one of them changes the guard. */
function touchProblem(sub, rest, ctx) {
  for (const ref of rest.filter((a) => !a.startsWith('-'))) {
    const args = sub === 'cherry-pick' || sub === 'revert' ? ['diff-tree', '--root', '--no-commit-id', '--name-only', '-r', ref, '--', ...GUARD_FILES] : ['diff', '--name-only', 'HEAD', ref, '--', ...GUARD_FILES];
    let out;
    try {
      out = execFileSync('git', args, { cwd: ctx.projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return `The guard couldn't read ${ref} to see whether git ${sub} would change the guard: check the ref, and fetch it first if it's origin's.`;
    }
    if (out.trim()) return `git ${sub} ${ref} would change the guard (${out.trim().split('\n').join(', ')}): a person does that. Commit what you have and block.`;
  }
  return null;
}

/** Whether `git <sub>` is an alias in this clone: an alias could stand for anything, so a cloud builder runs none. */
function isAlias(sub, ctx) {
  try {
    execFileSync('git', ['config', '--get', `alias.${sub}`], { cwd: ctx.projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return true;
  } catch (e) {
    if (e && e.status === 1) return false;
    throw new Error(`git config couldn't say whether ${sub} is an alias: ${e?.message ?? e}`);
  }
}

/** Why this git command may not run, or null. `wrapped` says a wrapper or a path led here: a push then never passes. */
export function gitProblem(args, record, ctx, wrapped) {
  let i = 0;
  const configs = [];
  // Any option before the subcommand means a push isn't plain, so it never passes; some are refused outright.
  while (i < args.length && args[i].startsWith('-')) {
    const a = args[i];
    if (a === '-c' || a === '--config-env') { configs.push(args[i + 1] ?? ''); i += 2; wrapped = true; continue; }
    if (/^-c./.test(a)) { configs.push(a.slice(2)); i++; wrapped = true; continue; }
    if (a.startsWith('--config-env=')) { configs.push(a.slice('--config-env='.length)); i++; wrapped = true; continue; }
    if (['--no-pager', '-P', '--paginate', '-p', '--literal-pathspecs', '--glob-pathspecs', '--noglob-pathspecs', '--icase-pathspecs', '--no-optional-locks', '--no-replace-objects', '--version', '--help', '-h'].includes(a)) { i++; wrapped = wrapped || !['--version', '--help', '-h'].includes(a); continue; }
    return `Run git plainly, without ${a.split('=')[0]} before the command: the guard can't tell what git ${a.split('=')[0]} would push from, or as.`;
  }
  for (const kv of configs) {
    if (DANGEROUS_KEY.test(kv.split('=')[0] ?? '')) return `Never set ${kv.split('=')[0]} for a command: an alias, push, remote, url, credential or hook setting could make git push somewhere else, or run something.`;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (!sub || sub === '--version' || sub === '--help') return null;
  if (!/^[a-z][a-z0-9-]*$/i.test(sub)) return `The guard doesn't know the git command "${sub}". Run a plain git command.`;
  if (sub === 'push') return wrapped ? `Push plainly, as its own command: ${allowedPush(record ?? '<your task branch>')}. Not through a wrapper, a path to git, or git's own options.` : pushProblem(rest, record);
  if (sub === 'send-pack' || sub === 'request-pull') return `Push only with git push: ${allowedPush(record ?? '<your task branch>')}.`;
  if (isAlias(sub, ctx)) return `git ${sub} is an alias here, and a cloud builder runs no aliases: run the command it stands for, plainly.`;
  if (sub === 'config') return configProblem(rest);
  if (sub === 'remote') {
    const verb = rest.find((a) => !a.startsWith('-'));
    if (verb && ['add', 'set-url', 'rename', 'remove', 'rm', 'set-head', 'set-branches', 'update', 'prune'].includes(verb)) return `Never change the remotes (git remote ${verb}): origin is the only remote, as it is.`;
    return null;
  }
  if (sub === 'checkout' || sub === 'switch') return checkoutProblem(sub, rest, record);
  if (sub === 'reset' && rest.includes('--hard')) return 'Don\'t reset --hard: it throws away work, and could take the guard with it. Revert or amend what you need instead.';
  if (sub === 'restore' && rest.some((a) => a === '-s' || a === '--source' || a.startsWith('--source='))) return 'Don\'t restore from another commit (--source): it could change the guard. git restore <file>, from the index, is fine.';
  if (sub === 'pull') return 'Don\'t pull: git fetch origin <branch>, then git merge origin/<branch>, so the guard can look at what comes in.';
  if (sub === 'worktree') return 'acc makes and removes worktrees. Work in this clone.';
  if (['merge', 'rebase', 'cherry-pick', 'revert'].includes(sub)) return touchProblem(sub, rest, ctx);
  return null;
}

// ---------------------------------------------------------------- gh, curl, sf

function apiProblem(rest) {
  let method = 'GET';
  let fields = false;
  let path = null;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '-X' || a === '--method') { method = String(rest[++i] ?? '').toUpperCase(); continue; }
    if (a.startsWith('--method=')) { method = a.slice('--method='.length).toUpperCase(); continue; }
    if (/^-X./.test(a)) { method = a.slice(2).toUpperCase(); continue; }
    if (['-f', '-F', '--field', '--raw-field', '--input'].includes(a)) { fields = true; i++; continue; }
    if (/^(-f|-F)./.test(a) || /^(--field|--raw-field|--input)=/.test(a)) { fields = true; continue; }
    if (['-H', '--header', '-q', '--jq', '-t', '--template', '--cache', '--hostname', '--preview'].includes(a)) { i++; continue; }
    if (!a.startsWith('-') && path === null) path = a;
  }
  if (path && /(^|\/)graphql$/.test(path)) return rest.some((a) => /\bmutation\b/i.test(a)) ? 'Never run a GraphQL mutation: it changes GitHub, and a person does that. Queries are fine.' : null;
  if (method !== 'GET') return `gh api only reads here (GET), not ${method}: a person changes GitHub. Push your task branch and stop.`;
  if (fields) return 'gh api with a field (-f, -F, --input) posts: a person changes GitHub.';
  if (path && /(^|\/)git\/refs(\/|$)/.test(path)) return 'Never touch git/refs through the API: push only your task branch, with git push.';
  if (path && /pulls\/\d+\/merge|\/merges?$/.test(path)) return 'Never merge through the API. A person merges.';
  return null;
}

function ghProblem(sub, rest) {
  if (sub === 'pr' && ['merge', 'create', 'close', 'ready', 'reopen'].includes(rest[0] ?? '')) return 'Pull requests are a person\'s: acc land opens one after review, and a person merges it. Push your task branch with an Acc-Done trailer and stop.';
  if (sub === 'api') return apiProblem(rest);
  return null;
}

function httpProblem(prog, rest, line) {
  if (!/github\.com/i.test(line)) return null;
  const writes = prog === 'wget'
    ? rest.some((a) => /^--(post-data|post-file|method|body-data|body-file)(=|$)/.test(a))
    : rest.some((a, i) => (a === '-X' || a === '--request') && String(rest[i + 1] ?? '').toUpperCase() !== 'GET') || rest.some((a) => /^(-X(?!GET$).|--request=(?!GET$)|-d.|--data|-F.|--form|-T.|--upload-file|--json)/.test(a) || ['-d', '-F', '-T'].includes(a));
  return writes ? `Never write to GitHub with ${prog}: a person changes GitHub. Push only your task branch, with git push.` : null;
}

function sfProblem(sub, rest) {
  if (sub === 'project' && rest[0] === 'deploy' && ['start', 'quick', 'resume'].includes(rest[1] ?? '') && !rest.includes('--dry-run')) return 'Builders validate and never deploy (D-011). A cloud session has no org anyway.';
  return null;
}

// ---------------------------------------------------------------- the line

/** Whether a line names the guard's files, the transcript, or anything under .claude/, where only reads may go through Bash. */
function namesGuard(line, ctx) {
  if (/(^|[^A-Za-z0-9_.-])\.claude(\/|$|[^A-Za-z0-9_.-])/.test(line) || /\bacc-push-guard\.mjs\b/.test(line)) return true;
  return !!ctx.transcript && line.includes(basename(ctx.transcript));
}

/** Drops a wrapper and its own options from the front of a command, until a program is left. Says whether it dropped anything. */
function unwrap(words) {
  let w = words;
  let wrapped = false;
  for (let n = 0; n < 12 && w.length; n++) {
    const prog = name(w[0]);
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) { w = w.slice(1); continue; }
    if (!WRAPPERS.has(prog)) return { words: w, wrapped };
    wrapped = true;
    w = w.slice(1);
    // The wrapper's own options and values: timeout's duration, nice's -n 15, env's -i or -u NAME, xargs' -I {}, stdbuf's -o0, sudo's -u NAME.
    if (prog === 'timeout') { while (w.length && w[0].startsWith('-')) w = w.slice(['-s', '-k', '--signal', '--kill-after'].includes(w[0]) ? 2 : 1); w = w.slice(1); continue; }
    while (w.length && w[0].startsWith('-')) {
      const o = w[0];
      const takesValue = ['-n', '-u', '-C', '-S', '-I', '-L', '-P', '-d', '-a', '--arg-file', '--max-args', '--max-procs', '--delimiter', '--unset', '--chdir', '-g', '-c', '-p', '-o', '-e', '-i'].includes(o) && !(prog === 'env' && o === '-i') && !(prog === 'xargs' && o === '-i');
      w = w.slice(takesValue ? 2 : 1);
    }
  }
  return { words: w, wrapped };
}

/** Why a cloud builder may not run this command line, or null. `record` is the task's branch; depth bounds shells within shells. */
export function guard(line, record, ctx, depth = 0, wrappedOuter = false) {
  if (depth > 4) return 'Shells within shells: run the command plainly.';
  const commands = rawCommandsOf(line);
  // A line of reads may name the guard's files; one that writes (a redirect, tee) may not.
  const reads = commands.every((w) => { const u = unwrap(w).words; const p = name(u[0]); return (READ_ONLY.has(p) || (p === 'git' && GIT_READS.has(u[1] ?? ''))) && !w.some((x) => /^\d*>/.test(x) || x === 'tee' || x === 'dd'); });
  if (namesGuard(line, ctx) && !reads) return 'Nothing under .claude/ is changed from Bash: the guard lives there, and so do the session\'s settings. Read them if you like; for another file under .claude/, use the Edit or Write tool.';
  for (const raw of commands) {
    const { words, wrapped } = unwrap(raw);
    const [first, ...rest] = words;
    if (!first) {
      // Assignments alone set a variable and run nothing; a wrapper alone would read commands the guard can't see.
      if (raw.length && !raw.every((w) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w))) return `${raw[0]} runs nothing by itself here: run the command plainly.`;
      continue;
    }
    // A `$` left over from `$( … )`: what's inside is read as its own command, and the `$` runs nothing.
    if (first === '$') continue;
    if (first.includes('$')) return `The guard can't tell what ${first} runs: write the program's name, plainly.`;
    const prog = name(first);
    const viaPath = first !== prog;
    if (prog === 'git') {
      const why = gitProblem(rest, record, ctx, wrapped || viaPath || wrappedOuter);
      if (why) return why;
      continue;
    }
    if (prog === 'gh') {
      const why = ghProblem(rest[0], rest.slice(1));
      if (why) return why;
      continue;
    }
    if (prog === 'sf') {
      const why = sfProblem(rest[0], rest.slice(1));
      if (why) return why;
      continue;
    }
    if (prog === 'curl' || prog === 'wget') {
      const why = httpProblem(prog, rest, line);
      if (why) return why;
      continue;
    }
    if (prog === 'eval') {
      // eval is a wrapper: what it runs is guarded, and a push through it never passes.
      const why = guard(rest.join(' '), record, ctx, depth + 1, true);
      if (why) return why;
      continue;
    }
    if (prog === 'source' || prog === '.') return 'Never run a script file (source): run its commands plainly, one by one.';
    if (SHELLS.has(prog)) {
      const at = rest.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
      if (at >= 0) {
        const inner = rest.slice(at + 1).find((a) => !a.startsWith('-'));
        if (inner === undefined) return `${prog} -c with no command runs nothing: run the command plainly.`;
        const why = guard(inner, record, ctx, depth + 1, wrappedOuter);
        if (why) return why;
        continue;
      }
      return rest.some((a) => !a.startsWith('-')) ? `Never run a script file with ${prog}: run its commands plainly, one by one, so the guard can see each.` : `A bare ${prog} reads commands the guard can't see: run the command plainly.`;
    }
    if (/\.(sh|bash|zsh|ksh)$/.test(prog)) return `Never run a script file (${prog}): run its commands plainly, one by one, so the guard can see each.`;
    if (INTERPRETERS.has(prog)) {
      const inline = rest.findIndex((a) => ['-e', '--eval', '-c', '-p', '--print', '-r', '--input-type=module'].includes(a));
      if (inline >= 0 && rest.slice(inline + 1).some((a) => /\b(git|gh|push)\b/i.test(a))) return `The guard can't see what ${prog} ${rest[inline]} does with git: run the git command plainly.`;
      continue;
    }
    if (prog === 'rm' && rest.some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === '--recursive') && rest.some((a) => ['.', './', '..', '/', '*', './*', '~', '.git'].includes(a))) return 'Never remove the whole checkout or its .git: the guard and the session\'s settings live in it.';
  }
  return null;
}

/** Why an Edit, Write, MultiEdit or NotebookEdit may not touch this file, or null: the guard's own files, anything under .claude/hooks/, and the transcript the record is read from. */
export function fileProblem(input, ctx) {
  const given = input?.file_path ?? input?.notebook_path ?? input?.path;
  if (typeof given !== 'string' || !given) return 'The guard couldn\'t see which file that would write: give its path.';
  const abs = resolve(ctx.cwd, given);
  const rel = relative(ctx.projectDir, abs);
  const under = (dir) => rel === dir || rel.startsWith(`${dir}/`);
  if (under('.claude/hooks') || rel === '.claude/settings.json') return `${rel} is the guard a cloud session runs, or its settings: a cloud builder never changes it. acc cloud enable writes it, on the Mac.`;
  if (ctx.transcript && abs === resolve(ctx.transcript)) return 'The session\'s transcript isn\'t yours to edit: the guard reads its record there.';
  return null;
}

// ---------------------------------------------------------------- the hook

const deny = (reason) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));

/** Fails closed: a block (exit 2), with the reason on stderr, which Claude Code shows. */
function block(reason) {
  process.stderr.write(`acc's cloud push guard: ${reason}\n`);
  process.exit(2);
}

async function main() {
  if (!inCloud()) return;
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  let input;
  try {
    input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return block('the hook\'s input wasn\'t JSON, so the guard couldn\'t read what would run. Nothing runs until it can.');
  }
  const tool = input?.tool_name;
  if (typeof tool !== 'string') return block('the hook\'s input named no tool.');
  if (!TOOLS.has(tool)) return;
  const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const ctx = { cwd, projectDir: process.env.CLAUDE_PROJECT_DIR || cwd, transcript: typeof input.transcript_path === 'string' ? input.transcript_path : null };
  if (tool !== 'Bash') {
    const why = fileProblem(input.tool_input, ctx);
    if (why) deny(why);
    return;
  }
  const line = input.tool_input?.command;
  if (typeof line !== 'string') return block('the Bash call carried no command string.');
  if (!/\b(git|gh|sf|curl|wget|eval|source|sh|bash|zsh|dash|ksh|fish|node|python|python3|ruby|perl|php|deno|bun|tsx|rm)\b|\.claude|\$/.test(line) && !(ctx.transcript && line.includes(basename(ctx.transcript)))) return;
  let record = null;
  if (ctx.transcript) {
    try {
      record = recordOf(readHead(ctx.transcript));
    } catch {
      record = null;
    }
  }
  const why = guard(line, record, ctx);
  if (why) deny(why);
}

/** Whether this file is the program run, not a module a test imported: by real paths, since a temp folder may be a symlink. */
function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) {
  main().catch((e) => block(`it hit an error of its own, so nothing runs: ${e?.message ?? e}`));
}
