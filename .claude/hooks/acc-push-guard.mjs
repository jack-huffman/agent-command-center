#!/usr/bin/env node
// acc's cloud push guard (GH-69): what a cloud builder must never do, refused before it runs. Written by
// acc cloud enable, which writes it again when acc's own changes; committed under .claude/hooks/ beside
// acc-pre-push, and run by the hooks in .claude/settings.json: PreToolUse on Bash, Edit, Write, MultiEdit
// and NotebookEdit, and SessionStart (--session-start) to install the git pre-push hook. It needs no acc,
// no ledger and no plugin: a cloud session runs only what the repo commits.
//
// Two lines of defence, in a cloud session (CLAUDE_CODE_REMOTE=true, or CLAUDE_CODE_REMOTE_SESSION_ID set):
//
// 1. Before a command runs, this script reads it. Only `git push origin <branch>` and `git push origin
//    HEAD:<branch>` pass, with -u or --set-upstream before origin if wanted, where <branch> is the task's
//    from the record acc put in the fire's text (an Acc-Branch line, with an Acc-Role line that says
//    builder or reviewer), read from the session's first message in its transcript: never from the
//    checkout, which a builder could switch. A record missing either line, or malformed, allows no push and
//    no checkout. A reviewer (T-86: Acc-Role: reviewer, with an Acc-Verdict line naming
//    acc/review/<task>-<sha>) may push that verdict branch alone, never the task branch; from Bash it runs
//    git only (reads, fetch, checkout of the task branch, add and commit of review.json, the push), and
//    Edit, Write and MultiEdit may touch review.json alone. Everything else that could
//    push is refused: any other push; a push reached through git's global options, a path to git, a
//    wrapper (timeout, env, nohup, xargs, eval, exec), an assignment of GIT_*, HOME, PATH, XDG_*, LD_*,
//    EDITOR or VISUAL, a program that runs another from its arguments (find -exec, npm exec, watch, flock,
//    script, parallel), a shell with -c, whose inner line is guarded the same way, or a script file; `git`
//    followed by `push` or `send-pack` anywhere else in a command's words, or with a substitution's
//    placeholder where the branch would be; an alias, git's or the shell's, and hash -p; --no-verify with
//    any program; git clone and git init; core.hooksPath set by any means; a git config key off a short
//    allow-list (user.name, user.email, commit.gpgsign and the like: core.editor, diff.external, filter.*,
//    sequence.editor and gpg.program run code); a remote changed; gh off its allow-list (pr view|list|diff|checks, issue view,
//    run view|list, api with GET, auth status); curl or wget writing to GitHub; a deploy. It also refuses
//    what could change the guard or its hooks: from Bash, a write anywhere under .claude/ or .git/ (globs
//    and symlinks resolved; reads pass); from Edit, Write, MultiEdit or NotebookEdit, the hooks, any
//    .claude/settings*.json and anything under .git/; `git checkout <ref> -- <paths>`, `git apply`, `git
//    am` and `patch` where they would touch .claude/ or .git/; a checkout, reset, merge, rebase,
//    cherry-pick or revert that would change the guard's files.
//
// 2. The push itself. A git pre-push hook, acc-pre-push beside this file, is installed into the clone's
//    .git/hooks/ when the session starts and again before any push passes. It reads the refs git is about
//    to update and refuses any update other than refs/heads/<branch>, a deletion, and one that isn't a
//    fast-forward, however git was invoked: a wrapper, an alias, a renamed or copied binary, a script in any
//    language. The branch is in .git/acc-task-branch, written here from the record. --no-verify and
//    core.hooksPath would switch it off, which is why the first line refuses them.
//
// It fails closed: input it can't read, or an error of its own, blocks the command (exit 2), and the hook
// entry runs it as `node … || exit 2`, so a guard that can't load denies too. Outside a cloud session it
// prints nothing and exits 0: local builders have the plugin's guards (D-042), and a person on main isn't
// a builder.
import { execFileSync } from 'node:child_process';
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The line acc puts in the fire's text, which names the task's branch: the guard's record. */
export const RECORD = 'Acc-Branch';
/** The line beside it that says the session's role, builder or reviewer (T-86), and for a reviewer the branch its verdict goes to. */
export const ROLE = 'Acc-Role';
export const VERDICT = 'Acc-Verdict';
/** What the task's branch looks like, and a reviewer's verdict branch (T-86). */
export const BRANCH = /^task\/[A-Za-z0-9._/-]+$/;
export const VERDICT_BRANCH = /^acc\/review\/[A-Za-z0-9._-]+-[0-9a-f]{7,64}$/;
/** The one file a reviewer writes, commits and pushes (T-86), at the root of the clone. */
export const VERDICT_FILE = 'review.json';
/** Whether this is a cloud session: the documented session id, or the flag the CLI sets. */
export const inCloud = (env = process.env) => env.CLAUDE_CODE_REMOTE === 'true' || !!env.CLAUDE_CODE_REMOTE_SESSION_ID;
/** The tools the guard looks at; every other tool passes without a word. */
const TOOLS = new Set(['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
/** The git pre-push hook beside this file, and the record it reads, in the clone's git dir. */
export const PRE_PUSH = 'acc-pre-push';
export const PRE_PUSH_RECORD = 'acc-task-branch';

// ---------------------------------------------------------------- the command line, split

/** What a `$( )` or backtick pair leaves in the word it stood in: it names nothing the guard allows. */
export const SUBSTITUTED = '$(...)';

/**
 * A command line split into its commands, and each into words: quotes kept together, separators cut, a
 * `$( )` or backtick read as its own command even inside double quotes (only single quotes are literal), a
 * heredoc's body skipped. The command around a substitution stays whole, with SUBSTITUTED where the
 * substitution stood, so `git push origin "task/x$(echo :main)"` reads as a push of `task/x$(...)`, never
 * of `task/x`; the substitution's own commands come first. Nothing stripped. acc's hooks.ts commandsOf splits the same way, and a test keeps
 * the two the same.
 */
export function rawCommandsOf(line) {
  const out = [];
  let words = [];
  let word = '';
  let quote = null;
  let any = false;
  // What to go back to when a `$( )` or a backtick pair closes: the command it opened in, its word so far
  // with SUBSTITUTED added, and the quote it opened inside, if any. A `(` alone opens a group, which cuts.
  const stack = [];
  // Heredoc terminators still to skip, in order; a `<<` alone takes the next word as its terminator.
  const heredocs = [];
  let delimiterNext = false;
  const end = () => {
    if (any) {
      if (delimiterNext) { heredocs.push(word.replace(/^['"]|['"]$/g, '')); delimiterNext = false; }
      else if (word === '<<' || word === '<<-') delimiterNext = true;
      else if (/^<<-?./.test(word)) heredocs.push(word.replace(/^<<-?/, '').replace(/^['"]|['"]$/g, ''));
      words.push(word);
    }
    word = '';
    any = false;
  };
  const next = () => { end(); if (words.length) out.push(words); words = []; };
  const open = (back, tick) => { stack.push({ group: false, back, tick, words, word: word + SUBSTITUTED }); words = []; word = ''; any = false; quote = null; };
  const close = (top) => { next(); words = top.words; word = top.word; any = true; quote = top.back; };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote === "'") {
      if (c === "'") quote = null;
      else { word += c; any = true; }
      continue;
    }
    if (quote === '"') {
      if (c === '"') { quote = null; continue; }
      if (c === '\\' && i + 1 < line.length) { word += line[++i]; any = true; continue; }
      if (c === '`') { open('"', true); continue; }
      if (c === '$' && line[i + 1] === '(') { open('"', false); i++; continue; }
      word += c;
      any = true;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; any = true; continue; }
    if (c === '\\' && i + 1 < line.length) { word += line[++i]; any = true; continue; }
    if (c === '`') {
      const top = stack[stack.length - 1];
      if (top && !top.group && top.tick) { stack.pop(); close(top); }
      else open(null, true);
      continue;
    }
    if (c === '$' && line[i + 1] === '(') { open(null, false); i++; continue; }
    if (c === '(') { next(); stack.push({ group: true }); continue; }
    if (c === ')') {
      const top = stack.pop();
      if (top && !top.group) close(top);
      else next();
      continue;
    }
    if (c === '\n') {
      next();
      // A heredoc's body is the command's input, not commands: skip to its terminator line.
      while (heredocs.length && i < line.length) {
        const term = heredocs.shift();
        let j = i + 1;
        for (;;) {
          const nl = line.indexOf('\n', j);
          const l = nl < 0 ? line.slice(j) : line.slice(j, nl);
          if (l.replace(/^\t+/, '') === term || nl < 0) { i = nl < 0 ? line.length : nl; break; }
          j = nl + 1;
        }
      }
      continue;
    }
    if (/\s/.test(c)) { end(); continue; }
    if (c === ';' || c === '|' || c === '&') { next(); continue; }
    word += c;
    any = true;
  }
  // A substitution left open at the end still leaves its command whole: the shell would refuse the line.
  for (let top = stack.pop(); top; top = stack.pop()) if (!top.group) close(top);
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
 * The record from the transcript (the fire's text, in the session's first message): the Acc-Branch, Acc-Role
 * and, for a reviewer, Acc-Verdict lines in a user message before the first assistant turn. Later messages
 * never count: a tool's result comes back as a user message too, and a builder could put anything in one.
 * Null, which allows no push and no checkout, when the branch line is missing or isn't a task branch, the
 * role line is missing or says neither builder nor reviewer, or a reviewer's verdict line is missing or
 * isn't a verdict branch (T-86).
 */
export function recordsOf(transcript) {
  const line = (key) => new RegExp(`^\\s*${key}:\\s*(\\S+)\\s*$`, 'm');
  for (const raw of transcript.split('\n')) {
    const l = raw.trim();
    if (!l.startsWith('{')) continue;
    let entry;
    try { entry = JSON.parse(l); } catch { continue; }
    if (entry?.type === 'assistant') return null;
    if (entry?.type !== 'user') continue;
    const content = entry.message?.content;
    const texts = typeof content === 'string' ? [content] : Array.isArray(content) ? content.filter((b) => b && b.type === 'text').map((b) => String(b.text ?? '')) : [];
    for (const t of texts) {
      const branch = line(RECORD).exec(t);
      if (!branch) continue;
      if (!BRANCH.test(branch[1])) return null;
      const role = line(ROLE).exec(t)?.[1] ?? null;
      if (role !== 'builder' && role !== 'reviewer') return null;
      const verdict = line(VERDICT).exec(t)?.[1] ?? null;
      if (role === 'reviewer' && !(verdict && VERDICT_BRANCH.test(verdict))) return null;
      return { branch: branch[1], role, verdict: role === 'reviewer' ? verdict : null };
    }
  }
  return null;
}

/** The task's branch from the transcript, or null: the record's branch, with the same rules. */
export function recordOf(transcript) {
  return recordsOf(transcript)?.branch ?? null;
}

/** The one branch this session may push (T-86): a builder its task branch, a reviewer its verdict branch. */
export const pushableOf = (record, ctx) => (ctx.role === 'reviewer' ? ctx.verdict : record);

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

// ---------------------------------------------------------------- paths

const name = (word) => (word ? basename(word) : '');

/** A path with its symlinks resolved, down to its deepest part that exists: a link made first can't hide where a write lands. */
function realDeep(p) {
  let cur = p;
  const rest = [];
  while (!existsSync(cur)) {
    rest.unshift(basename(cur));
    const up = dirname(cur);
    if (up === cur) return p;
    cur = up;
  }
  try {
    return join(realpathSync(cur), ...rest);
  } catch {
    return p;
  }
}

const realOf = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

/** Whether `path` is `dir` or inside it. */
function within(path, dir) {
  const r = relative(dir, path);
  return r === '' || (!r.startsWith('..') && !r.startsWith('/'));
}

/** The segments of an absolute path that are the guard's or git's: `.claude/hooks/…`, `.claude/settings*.json`, `.git/…`. */
const GUARD_SEGMENT = /(^|\/)\.claude\/(hooks(\/|$)|settings[^/]*\.json$)/;
const GIT_SEGMENT = /(^|\/)\.git(\/|$)/;

/** The clone's git dir, resolved, or null where git can't say. */
function gitDirOf(ctx) {
  try {
    return realOf(execFileSync('git', ['rev-parse', '--absolute-git-dir'], { cwd: ctx.projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
  } catch {
    return null;
  }
}

/** Whether a file, by its path from cwd, is one the guard keeps: resolved through symlinks, as the write would land. */
function isGuarded(given, ctx, what) {
  const abs = resolve(ctx.cwd, given);
  const root = realOf(ctx.projectDir);
  for (const p of [abs, realDeep(abs)]) {
    const rel = within(p, root) ? relative(root, p) : null;
    if (rel !== null && (GUARD_SEGMENT.test(`/${rel}`) || GIT_SEGMENT.test(`/${rel}`))) return true;
    if (what === 'any' && rel !== null && (rel === '.claude' || rel.startsWith('.claude/'))) return true;
    // Settings or hooks of any .claude folder, the home's among them, and any .git: the session's own.
    if (GUARD_SEGMENT.test(p) || GIT_SEGMENT.test(p)) return true;
    const gitDir = ctx.gitDir === undefined ? (ctx.gitDir = gitDirOf(ctx)) : ctx.gitDir;
    if (gitDir && within(p, gitDir)) return true;
    if (ctx.transcript && p === resolve(ctx.transcript)) return true;
  }
  return false;
}

/** The entries a glob names, in its folder: `.cl*` names .claude. A dot pattern matches dot entries, as the shell does. */
function globbed(word, ctx) {
  const dir = dirname(word);
  const pat = basename(word);
  if (/[*?[]/.test(dir)) return [word.replace(/[*?[].*$/, '')];
  let entries;
  try {
    entries = readdirSync(resolve(ctx.cwd, dir));
  } catch {
    return [];
  }
  const re = new RegExp(`^${pat.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*+/g, '[^/]*').replace(/\?/g, '[^/]')}$`);
  return entries.filter((e) => (pat.startsWith('.') || !e.startsWith('.')) && re.test(e)).map((e) => join(dir, e));
}

// ---------------------------------------------------------------- git

const WRAPPERS = new Set(['timeout', 'env', 'nohup', 'xargs', 'nice', 'ionice', 'sudo', 'doas', 'time', 'command', 'builtin', 'exec', 'setsid', 'stdbuf', 'unbuffer', 'chronic', 'caffeinate', 'npx']);
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish']);
const INTERPRETERS = new Set(['node', 'nodejs', 'deno', 'bun', 'python', 'python3', 'ruby', 'perl', 'php', 'tsx', 'ts-node']);
/** An assignment that changes what git is, where it looks, or what runs for it: a command after one isn't plain. */
const SENSITIVE_VAR = /^(GIT_|XDG_|LD_|DYLD_)|^(HOME|PATH|EDITOR|VISUAL|SHELL|BASH_ENV|ENV)$/;
/** git settings a cloud builder may set, for a command or for good: identity and the like, none of which runs code or sends a push elsewhere. */
const CONFIG_ALLOWED = /^(user\.(name|email)|commit\.gpgsign|tag\.gpgsign|core\.(autocrlf|safecrlf|filemode|ignorecase|quotepath|symlinks|longpaths|precomposeunicode)|init\.defaultbranch|pull\.(rebase|ff)|merge\.(ff|conflictstyle)|rebase\.(autostash|autosquash|updaterefs)|rerere\.(enabled|autoupdate)|fetch\.prune|log\.date|diff\.(renames|algorithm|colormoved)|status\.(showuntrackedfiles|branch|short)|branch\.(autosetuprebase|autosetupmerge)|advice\.[a-z]+|color\.[a-z.]+|column\.[a-z]+|safe\.directory)$/i;
const FORCE = { '-f': 'force-push', '--force': 'force-push', '--force-with-lease': 'force-push', '--force-if-includes': 'force-push', '--mirror': 'push everything', '--all': 'push everything', '--tags': 'push tags', '--follow-tags': 'push tags', '--delete': 'delete a branch', '-d': 'delete a branch', '--prune': 'delete branches' };
/** Commands that only read, so a line of them may name the guard's files; find isn't one (-delete, -exec). */
const READ_ONLY = new Set(['cat', 'head', 'tail', 'less', 'more', 'grep', 'rg', 'ls', 'wc', 'stat', 'file', 'diff', 'cmp', 'md5sum', 'shasum', 'sha256sum', 'jq', 'echo', 'printf', 'test', '[', 'true', 'false', 'tree', 'du', 'pwd', 'which', 'type', 'sort', 'uniq', 'cut', 'tr', 'basename', 'dirname', 'realpath', 'readlink', 'date']);
const GIT_READS = new Set(['diff', 'show', 'log', 'status', 'blame', 'cat-file', 'ls-files', 'ls-tree', 'grep', 'rev-parse', 'branch', 'remote', 'config']);
/** The programs the guard reads on their own; found later in another program's words, they're guarded as what it runs. */
const HANDLED = new Set(['git', 'gh', 'sf', 'curl', 'wget', 'eval', 'source', 'patch', ...SHELLS, ...INTERPRETERS]);
/** The guard's own files, as paths from the repo's root. */
export const GUARD_FILES = ['.claude/hooks', '.claude/settings.json'];

const allowedPush = (record, role) => (role === 'reviewer' ? `git push origin HEAD:${record}` : `git push origin ${record} (or git push origin HEAD:${record}, with -u before origin if you like)`);

/** Why this push may not run, given the branch this session may push, or null for the allowed forms. A reviewer's is its verdict branch (T-86). */
export function pushProblem(args, record, role = 'builder') {
  if (!record) return `The guard has no record of your branch: no ${RECORD} and ${ROLE} lines${role === 'reviewer' ? ` (and ${VERDICT})` : ''} in this session's first message. It allows no push without them. Commit your work and stop: a person collects it.`;
  const words = [...args];
  if (words[0] === '-u' || words[0] === '--set-upstream') words.shift();
  if (words.length === 2 && words[0] === 'origin' && (words[1] === record || words[1] === `HEAD:${record}`)) return null;
  const kind = role === 'reviewer' ? 'verdict' : 'task';
  const how = `Push only your ${kind} branch, plainly: ${allowedPush(record, role)}.`;
  const redirect = words.find((a) => /^\d*[<>]/.test(a));
  if (redirect) return `Push plainly, with nothing after the branch (not ${redirect}). ${how}`;
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
    if (plain(dst) !== record) return `Push only your ${kind} branch, ${record}, not ${plain(dst)}. ${role === 'reviewer' ? 'acc reads it' : 'A person lands it'}: never push ${plain(dst)}. ${how}`;
    if (plain(src) !== record && src !== 'HEAD') return `Push only your ${kind} branch, ${record}, not ${plain(src)}. ${how}`;
  }
  return `${how} Not: git push ${args.join(' ')}.`;
}

/** Why a git setting may not be set, or null: off the allow-list, it could run code or send a push elsewhere. */
function keyProblem(key, how) {
  if (/hookspath/i.test(key)) return `Never set core.hooksPath${how}: the clone's pre-push hook is the guard's last line, and it wouldn't run.`;
  if (!CONFIG_ALLOWED.test(key)) return `Never set ${key}${how}: only user.name, user.email, commit.gpgsign and the like may be set here. An alias, push, remote, url, credential, hook, editor, filter or program setting could make git push somewhere else, or run something.`;
  return null;
}

const CONFIG_VALUED = new Set(['-f', '--file', '--blob', '--default', '--type', '-t', '--get-color', '--get-colorbool', '--worktree-path']);
/** Whether `git config` with these words only reads. */
const configReads = (rest) => !rest.includes('-e') && !rest.includes('--edit') && rest[0] !== 'edit' && (rest.some((a) => /^(--get|--get-all|--get-regexp|--get-urlmatch|-l|--list|--show-origin|--show-scope)$/.test(a)) || rest[0] === 'get' || rest[0] === 'list');
function configProblem(rest) {
  if (rest.includes('-e') || rest.includes('--edit') || rest[0] === 'edit') return 'Never open the git config in an editor. Set user.name and user.email plainly, if that\'s what you need.';
  if (configReads(rest)) return null;
  const words = ['set', 'unset', 'rename-section', 'remove-section', 'unset-all', 'replace-all', 'add'].includes(rest[0] ?? '') ? rest.slice(1) : rest;
  let key = null;
  for (let i = 0; i < words.length; i++) {
    const a = words[i];
    if (a.startsWith('-')) { if (CONFIG_VALUED.has(a)) i++; continue; }
    key = a;
    break;
  }
  if (!key) return null;
  return keyProblem(key, '');
}

/** Why `git checkout <ref> -- <paths>` may not run: the paths reach the guard's files, and the ref's differ from HEAD's. */
function restoreProblem(sub, before, paths, ctx) {
  const ref = before.find((a) => !a.startsWith('-'));
  if (!ref) return null;
  const reaches = paths.some((p) => {
    if (p.startsWith(':') || /[*?[]/.test(p)) return true;
    const rel = relative(realOf(ctx.projectDir), realDeep(resolve(ctx.cwd, p)));
    return rel === '' || rel === '.' || rel.startsWith('..') || rel === '.claude' || rel.startsWith('.claude/') || GIT_SEGMENT.test(`/${rel}`);
  });
  return reaches ? touchProblem(sub, [ref], ctx) : null;
}

function checkoutProblem(sub, rest, record, ctx) {
  const at = rest.indexOf('--');
  if (at >= 0) return restoreProblem(sub, rest.slice(0, at), rest.slice(at + 1), ctx);
  if (rest.some((a) => ['-b', '-B', '-c', '-C', '--orphan', '--detach', '-t', '--track'].includes(a) || a.startsWith('--orphan=') || a.startsWith('--track='))) return `Make no new branch. Stay on your task branch${record ? `, ${record}` : ''}.`;
  const target = rest.find((a) => !a.startsWith('-'));
  if (!target) return null;
  if (!record) return `The guard has no record of your branch (no ${RECORD} line in this session's first message), so it can't let you switch to ${target}.`;
  if (target !== record) return `Stay on your task branch, ${record}. git ${sub} ${target} would leave it. To restore a file, use git checkout -- <file>.`;
  return null;
}

/** Why merging, rebasing onto, cherry-picking, reverting or restoring from these refs may not run: one of them changes the guard. */
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

/** A patch's headers that name the guard's folders, however many path parts a -p strips. */
const PATCH_NAMES = /^(?:diff --git a\/|\+\+\+ (?:b\/)?|--- (?:a\/)?|rename (?:to|from) |copy (?:to|from) )(?:\.\/)?(?:[^\s/]+\/)*\.(?:claude|git)(?:\/|\s|$)/m;
const APPLY_DRY = new Set(['--check', '--numstat', '--stat', '--summary', '--dry-run', '--show-current-patch']);

/** Why `git apply`, `git am` or `patch` may not run: it reads from a pipe the guard can't see, or its patch would touch .claude/ or .git/. */
function patchProblem(what, rest, ctx, raw) {
  if (rest.some((a) => APPLY_DRY.has(a))) return null;
  if (what === 'git am' && rest.some((a) => ['--abort', '--continue', '--skip', '--quit', '--resolved', '-r'].includes(a))) return null;
  const files = [];
  if (what === 'patch') {
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '-i' || rest[i] === '--input') files.push(rest[++i]);
      else if (rest[i].startsWith('--input=')) files.push(rest[i].slice('--input='.length));
      else if (/^-i./.test(rest[i])) files.push(rest[i].slice(2));
    }
  } else {
    files.push(...rest.filter((a) => !a.startsWith('-')));
  }
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '<' && raw[i + 1]) files.push(raw[i + 1]);
    else if (/^<[^<]/.test(raw[i])) files.push(raw[i].slice(1));
  }
  if (!files.filter(Boolean).length) return `The guard can't see what ${what} would change from a pipe, or from nothing: write the patch to a file and name it (${what} <file>).`;
  for (const f of files.filter(Boolean)) {
    let text;
    try {
      text = readFileSync(resolve(ctx.cwd, f), 'utf8');
    } catch {
      return `The guard couldn't read ${f} to see what ${what} would change. Write the patch to a file it can read.`;
    }
    if (PATCH_NAMES.test(text)) return `${what} ${f} would change .claude/ or .git/, where the guard and its hooks live: a person does that. Leave them out of the patch.`;
  }
  if (what === 'git apply') {
    // The surest list, from git itself: --numstat applies nothing.
    let out;
    try {
      out = execFileSync('git', ['apply', '--numstat', ...rest], { cwd: ctx.cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return `The guard couldn't read the patch to see what git apply would change (git apply --numstat failed): fix the patch first.`;
    }
    for (const l of out.split('\n')) {
      const path = l.split('\t')[2];
      if (path && /(^|[\s/{"])\.(claude|git)(\/|$)/.test(path)) return `git apply would change ${path.trim()}, where the guard and its hooks live: a person does that.`;
    }
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

/** Why this git command may not run, or null. `wrapped` says a wrapper, an assignment or a path led here: a push then never passes. */
export function gitProblem(args, record, ctx, wrapped, raw) {
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
    const why = keyProblem(kv.split('=')[0] ?? '', ' for a command');
    if (why) return why;
  }
  const sub = args[i];
  const rest = args.slice(i + 1);
  if (!sub || sub === '--version' || sub === '--help') return null;
  if (!/^[a-z][a-z0-9-]*$/i.test(sub)) return `The guard doesn't know the git command "${sub}". Run a plain git command.`;
  if (rest.includes('--no-verify') || (sub === 'commit' && rest.some((a) => /^-[a-zA-Z]*n[a-zA-Z]*$/.test(a)))) return 'Never skip the repo\'s git hooks (--no-verify): the clone\'s pre-push hook is the guard\'s last line. If a hook fails, fix what it found.';
  if (sub === 'clone' || sub === 'init') return `Work in this clone: a repo from git ${sub} has none of the guard's hooks, so nothing would check a push from it.`;
  if (sub === 'push') {
    const target = pushableOf(record, ctx);
    if (wrapped) return `Push plainly, as its own command: ${allowedPush(target ?? '<your branch>', ctx.role)}. Not through a wrapper, an assignment, a path to git, or git's own options.`;
    const why = pushProblem(rest, target, ctx.role ?? 'builder');
    // A push the guard allows: noted for the hook, which installs the pre-push hook before it lets it run.
    if (!why) ctx.pushes = true;
    return why;
  }
  if (sub === 'send-pack' || sub === 'request-pull') return `Push only with git push: ${allowedPush(pushableOf(record, ctx) ?? '<your branch>', ctx.role)}.`;
  if (isAlias(sub, ctx)) return `git ${sub} is an alias here, and a cloud builder runs no aliases: run the command it stands for, plainly.`;
  if (sub === 'config') return configProblem(rest);
  if (sub === 'remote') {
    const verb = rest.find((a) => !a.startsWith('-'));
    if (verb && ['add', 'set-url', 'rename', 'remove', 'rm', 'set-head', 'set-branches', 'update', 'prune'].includes(verb)) return `Never change the remotes (git remote ${verb}): origin is the only remote, as it is.`;
    return null;
  }
  if (sub === 'checkout' || sub === 'switch') return checkoutProblem(sub, rest, record, ctx);
  if (sub === 'reset' && rest.some((a) => ['--hard', '--merge', '--keep'].includes(a))) return 'Don\'t reset --hard, --merge or --keep: it throws away work, and could take the guard with it. Revert or amend what you need instead.';
  if (sub === 'restore' && rest.some((a) => a === '-s' || a === '--source' || a.startsWith('--source='))) return 'Don\'t restore from another commit (--source): it could change the guard. git restore <file>, from the index, is fine.';
  if (sub === 'pull') return 'Don\'t pull: git fetch origin <branch>, then git merge origin/<branch>, so the guard can look at what comes in.';
  if (sub === 'worktree') return 'acc makes and removes worktrees. Work in this clone.';
  if (['update-index', 'read-tree', 'checkout-index'].includes(sub)) return `Don't write the index or the tree with git ${sub}: it could put another guard in place. Use git add, git checkout -- <file> and git restore.`;
  if (sub === 'apply' || sub === 'am') return patchProblem(`git ${sub}`, rest, ctx, raw);
  if (['merge', 'rebase', 'cherry-pick', 'revert'].includes(sub)) return touchProblem(sub, rest, ctx);
  return null;
}

// ---------------------------------------------------------------- the pre-push hook

/** The clone's path for one of git's own files: `.git/hooks`, `.git/acc-task-branch`. */
function gitPath(ctx, what) {
  return resolve(ctx.projectDir, execFileSync('git', ['rev-parse', '--git-path', what], { cwd: ctx.projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
}

function writeIfChanged(file, text, mode) {
  let current = null;
  try { current = readFileSync(file, 'utf8'); } catch { current = null; }
  if (current !== text) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, text);
    renameSync(tmp, file);
  }
  if (mode !== undefined) chmodSync(file, mode);
}

/**
 * Installs the pre-push hook into the clone's .git/hooks/, from acc-pre-push beside this file, and writes
 * the record it reads. Returns why it couldn't, or null. core.hooksPath set anywhere means git wouldn't run
 * it, and that's refused rather than worked around.
 */
export function installPrePush(ctx, record) {
  const source = join(ctx.guardDir ?? join(ctx.projectDir, '.claude', 'hooks'), PRE_PUSH);
  let script;
  try {
    script = readFileSync(source, 'utf8');
  } catch {
    return `The pre-push hook's script isn't beside the guard (${PRE_PUSH}): acc cloud enable writes it, on the Mac, and it's committed with the guard. No push until it is.`;
  }
  let hooksPath = '';
  try {
    hooksPath = execFileSync('git', ['config', '--get', 'core.hooksPath'], { cwd: ctx.projectDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (e) {
    if (!(e && e.status === 1)) throw new Error(`git config couldn't say whether core.hooksPath is set: ${e?.message ?? e}`);
  }
  if (hooksPath) return `core.hooksPath is set (${hooksPath}), so the clone's pre-push hook wouldn't run: no push until a person unsets it.`;
  writeIfChanged(join(gitPath(ctx, 'hooks'), 'pre-push'), script, 0o755);
  if (record) writeIfChanged(gitPath(ctx, PRE_PUSH_RECORD), `${record}\n`);
  return null;
}

/** Before a plain push passes: the hook in place and the record written, or the push waits. */
function prePushProblem(ctx, record) {
  try {
    return installPrePush(ctx, record);
  } catch (e) {
    return `The guard couldn't install the clone's pre-push hook, so no push runs: ${e?.message ?? e}`;
  }
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
  if (path && /(^|\/)graphql$/.test(path)) return 'gh api graphql posts, and GitHub\'s proxy refuses it in a cloud session anyway: read with gh api <path> (GET), or gh pr view.';
  if (method !== 'GET') return `gh api only reads here (GET), not ${method}: a person changes GitHub. Push your task branch and stop.`;
  if (fields) return 'gh api with a field (-f, -F, --input) posts: a person changes GitHub.';
  if (path && /(^|\/)git\/refs(\/|$)/.test(path)) return 'Never touch git/refs through the API: push only your task branch, with git push.';
  if (path && /pulls\/\d+\/merge|\/merges?$/.test(path)) return 'Never merge through the API. A person merges.';
  return null;
}

/** gh, by allow-list: what a builder reads. Everything else is a person's. */
const GH_ALLOWED = { pr: ['view', 'list', 'diff', 'checks'], issue: ['view'], run: ['view', 'list'], auth: ['status'] };
function ghProblem(sub, rest) {
  if (!sub || sub === '--version' || sub === 'version' || sub === 'help' || sub === '--help') return null;
  if (sub === 'api') return apiProblem(rest);
  const verb = rest.find((a) => !a.startsWith('-')) ?? '';
  if ((GH_ALLOWED[sub] ?? []).includes(verb)) return null;
  const how = 'A cloud builder reads with gh pr view|list|diff|checks, gh issue view, gh run view|list, gh api <path> (GET) and gh auth status, and changes nothing on GitHub';
  if (sub === 'pr' && ['merge', 'create', 'close', 'ready', 'reopen'].includes(verb)) return `Pull requests are a person's: acc land opens one after review, and a person merges it. Push your task branch with an Acc-Done trailer and stop. ${how}.`;
  return `gh ${sub}${verb ? ` ${verb}` : ''} isn't one of a cloud builder's commands: ${how}. A person does the rest.`;
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

const isAssignment = (w) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w);
const isRedirect = (w) => /^\d*>>?$/.test(w) || /^\d*>>?./.test(w) || w === '&>' || w === '>|';

/** Whether a command only reads: a reader, or git reading, with no redirect, tee or dd. */
function isRead(raw) {
  const u = unwrap(raw).words;
  const p = name(u[0]);
  return (READ_ONLY.has(p) || (p === 'git' && GIT_READS.has(u[1] ?? '') && !(u[1] === 'config' && !configReads(u.slice(2))) && !(u[1] === 'remote' && u.length > 2 && u[2] !== '-v' && u[2] !== 'show' && u[2] !== 'get-url'))) && !raw.some((x) => isRedirect(x) || x === 'tee' || x === 'dd');
}

/**
 * Why a line may not name the guard's files, git's, the transcript, or anything under .claude/: only reads
 * may. By the words as written, and by where each path would land once globs and symlinks are resolved.
 */
function namesGuard(line, commands, ctx) {
  const says = (what) => `Nothing under ${what} is changed from Bash: the guard, its hooks and the session's settings live there. Read them if you like; for another file under .claude/, use the Edit or Write tool.`;
  if (/(^|[^A-Za-z0-9_.-])\.git(\/|$|[^A-Za-z0-9_.-])/.test(line)) return says('.git/');
  if (/(^|[^A-Za-z0-9_.-])\.claude(\/|$|[^A-Za-z0-9_.-])/.test(line) || /\bacc-push-guard\.mjs\b|\bacc-pre-push\b|\bacc-task-branch\b/.test(line)) return says('.claude/');
  if (ctx.transcript && line.includes(basename(ctx.transcript))) return says('.claude/');
  for (const words of commands) {
    // Every word but the program and its flags: a bare name lands somewhere too, when the shell's cwd is inside .claude/ or .git/.
    for (const w of words.slice(1)) {
      const word = w.replace(/^\d*>>?/, '').replace(/^&>/, '');
      if (!word || word.startsWith('-') || isAssignment(word)) continue;
      const paths = /[*?[]/.test(word) ? globbed(word, ctx) : [word];
      for (const p of paths) if (isGuarded(p, ctx, 'any')) return says(/\.git(\/|$)/.test(realDeep(resolve(ctx.cwd, p))) ? '.git/' : '.claude/');
    }
  }
  return null;
}

/** Drops a wrapper and its own options from the front of a command, until a program is left. Says whether it dropped anything that makes the command less than plain. */
function unwrap(words) {
  let w = words;
  let wrapped = false;
  for (let n = 0; n < 12 && w.length; n++) {
    const prog = name(w[0]);
    if (isAssignment(w[0])) {
      // An assignment that changes what git is, where it looks or what runs for it makes a push less than plain.
      if (SENSITIVE_VAR.test(w[0].split('=')[0])) wrapped = true;
      w = w.slice(1);
      continue;
    }
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

/** The git commands a reviewer may run (T-86), besides the reads: what fetches and checks out the task branch, and what commits and pushes review.json. */
const REVIEWER_GIT = new Set([...GIT_READS, 'fetch', 'merge-base', 'rev-list', 'describe', 'name-rev', 'shortlog', 'for-each-ref', 'show-ref', 'checkout', 'switch', 'add', 'commit', 'push']);
const REVIEWER_HOW = `A cloud reviewer runs only git from Bash, plainly: reads (git diff, git log, git show, git status, git blame), git fetch, git checkout of the branch it reviews, git add ${VERDICT_FILE}, git commit -m, and git push origin HEAD:<its verdict branch>. It reads files with Read, Grep and Glob, and writes ${VERDICT_FILE} with the Write tool.`;

/** Why a reviewer may not run this command, or null: anything but plain git, a git command off its list, an add of anything but review.json, or a commit that would take more than the index. */
function reviewerProblem(prog, rest, wrapped, viaPath) {
  if (prog !== 'git') return `${prog} isn't a command a cloud reviewer runs. ${REVIEWER_HOW}`;
  if (wrapped || viaPath) return `Run git plainly, not through a wrapper, an assignment or a path. ${REVIEWER_HOW}`;
  const sub = rest.find((a) => !a.startsWith('-'));
  if (!sub) return null;
  if (!REVIEWER_GIT.has(sub)) return `git ${sub} isn't a command a cloud reviewer runs. ${REVIEWER_HOW}`;
  const after = rest.slice(rest.indexOf(sub) + 1);
  if (sub === 'add') {
    const files = after.filter((a) => a !== '--');
    if (files.some((a) => a.startsWith('-')) || files.length !== 1 || (files[0] !== VERDICT_FILE && files[0] !== `./${VERDICT_FILE}`)) return `A cloud reviewer stages ${VERDICT_FILE} alone: git add ${VERDICT_FILE}. Not: git add ${after.join(' ')}.`;
  }
  if (sub === 'commit') {
    for (let i = 0; i < after.length; i++) {
      const a = after[i];
      if (a === '-m' || a === '--message') { i++; continue; }
      if (/^(-m.|--message=)/.test(a) || ['--amend', '--no-edit', '-q', '--quiet', '--allow-empty'].includes(a)) continue;
      return `A cloud reviewer commits what git add ${VERDICT_FILE} staged, with a message: git commit -m "<message>". Not ${a}.`;
    }
  }
  return null;
}

/** Why one command of a line may not run, or null. */
function commandProblem(given, record, ctx, depth, wrappedOuter, line) {
  const raw = given.filter((w) => w !== '');
  const { words, wrapped } = unwrap(raw);
  const [first, ...rest] = words;
  if (!first) {
    // Assignments alone set a variable and run nothing, unless they change what git is or where it looks,
    // which the session's shell would keep; a wrapper alone would read commands the guard can't see.
    if (raw.length && !raw.every(isAssignment)) return `${raw[0]} runs nothing by itself here: run the command plainly.`;
    const sensitive = raw.find((w) => SENSITIVE_VAR.test(w.split('=')[0]));
    if (sensitive) return `Never set ${sensitive.split('=')[0]} in the session: it changes what git is, where it looks, or what runs for it.`;
    return null;
  }
  // A `$` left over from an older splitter's `$( … )`: what's inside is read as its own command.
  if (first === '$') return null;
  // --no-verify with any program: npm, a script runner or a wrapper could pass it on to git.
  if (raw.some((w) => w === '--no-verify' || w.startsWith('--no-verify='))) return 'Never skip the repo\'s git hooks (--no-verify), with any program: the clone\'s pre-push hook is the guard\'s last line. If a hook fails, fix what it found.';
  if (first.includes('$')) return `The guard can't tell what ${first} runs: write the program's name, plainly.`;
  for (let i = 0; i < raw.length; i++) {
    if ((isRedirect(raw[i]) && (raw[i].length > (/^\d*>>?/.exec(raw[i])?.[0].length ?? 0) ? raw[i] : raw[i + 1] ?? '').includes('$')) || (['tee', 'cp', 'mv', 'ln', 'dd', 'install', 'rsync'].includes(name(first)) && i > 0 && raw[i].includes('$'))) return `The guard can't tell where ${raw[i]} writes: name the file plainly.`;
  }
  const prog = name(first);
  const viaPath = first !== prog;
  const wrap = wrapped || viaPath || wrappedOuter;
  // A reviewer (T-86) runs git alone, from a short list; what passes here is then read as any git command is.
  if (ctx.role === 'reviewer') {
    const why = reviewerProblem(prog, rest, wrapped || wrappedOuter, viaPath);
    if (why) return why;
  }
  // What would change the program a later command's name runs: an alias, or hash -p.
  if (prog === 'alias') return 'A cloud builder defines no shell aliases: an alias could make git, or any command, run something the guard never sees. Run the command plainly.';
  if (prog === 'hash' && rest.some((a) => /^-[a-zA-Z]*p/.test(a))) return 'Never point a command\'s name at another program (hash -p): the guard reads names, so run the program by its own.';
  if (prog === 'export' || prog === 'declare' || prog === 'typeset' || prog === 'setenv') {
    const sensitive = rest.find((w) => SENSITIVE_VAR.test(w.split('=')[0]));
    if (sensitive) return `Never set ${sensitive.split('=')[0]} in the session: it changes what git is, where it looks, or what runs for it.`;
    return null;
  }
  if (prog === 'git') return gitProblem(rest, record, ctx, wrap, raw);
  if (prog === 'gh') return ghProblem(rest[0], rest.slice(1));
  if (prog === 'sf') return sfProblem(rest[0], rest.slice(1));
  if (prog === 'curl' || prog === 'wget') return httpProblem(prog, rest, line);
  // eval is a wrapper: what it runs is guarded, and a push through it never passes.
  if (prog === 'eval') return guard(rest.join(' '), record, ctx, depth + 1, true);
  if (prog === 'source' || prog === '.') return 'Never run a script file (source): run its commands plainly, one by one.';
  if (SHELLS.has(prog)) {
    const at = rest.findIndex((a) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(a));
    if (at >= 0) {
      const inner = rest.slice(at + 1).find((a) => !a.startsWith('-'));
      if (inner === undefined) return `${prog} -c with no command runs nothing: run the command plainly.`;
      return guard(inner, record, ctx, depth + 1, wrap);
    }
    return rest.some((a) => !a.startsWith('-')) ? `Never run a script file with ${prog}: run its commands plainly, one by one, so the guard can see each.` : `A bare ${prog} reads commands the guard can't see: run the command plainly.`;
  }
  if (/\.(sh|bash|zsh|ksh)$/.test(prog)) return `Never run a script file (${prog}): run its commands plainly, one by one, so the guard can see each.`;
  if (INTERPRETERS.has(prog)) {
    const inline = rest.findIndex((a) => ['-e', '--eval', '-c', '-p', '--print', '-r', '--input-type=module'].includes(a));
    if (inline >= 0 && rest.slice(inline + 1).some((a) => /\b(git|gh|push)\b/i.test(a))) return `The guard can't see what ${prog} ${rest[inline]} does with git: run the git command plainly.`;
    return null;
  }
  if (prog === 'patch') return patchProblem('patch', rest, ctx, raw);
  if (prog === 'rm' && rest.some((a) => /^-[a-zA-Z]*[rR]/.test(a) || a === '--recursive') && rest.some((a) => ['.', './', '..', '/', '*', './*', '~', '.git'].includes(a))) return 'Never remove the whole checkout or its .git: the guard and the session\'s settings live in it.';
  // A program that runs another from its arguments (find -exec, npm exec, watch, flock, script, parallel,
  // make): what it would run is guarded as if wrapped, so a push through it never passes. Readers aside.
  if (!READ_ONLY.has(prog)) {
    for (let j = 1; j < words.length; j++) {
      const w = words[j];
      const tokens = w.split(/\s+/).filter(Boolean);
      if (!tokens.length || !HANDLED.has(name(tokens[0]))) continue;
      const why = tokens.length > 1 ? guard(w, record, ctx, depth + 1, true) : commandProblem(words.slice(j), record, ctx, depth + 1, true, line);
      if (why) return why;
    }
  }
  return null;
}

/**
 * Why a cloud builder may not run this command line, or null. `record` is the task's branch; depth bounds
 * shells within shells. It reads the line and writes no file: a push it allows sets ctx.pushes, and the hook
 * installs the pre-push hook before that push runs.
 */
export function guard(line, record, ctx, depth = 0, wrappedOuter = false) {
  if (depth > 4) return 'Shells within shells: run the command plainly.';
  const commands = rawCommandsOf(line);
  // A line of reads may name the guard's files; one that writes (a redirect, tee) may not.
  const reads = commands.every(isRead);
  if (!reads) {
    const named = namesGuard(line, commands, ctx);
    if (named) return named;
    if (/hookspath/i.test(line)) return 'Never set core.hooksPath, by any means: the clone\'s pre-push hook is the guard\'s last line, and it wouldn\'t run.';
  }
  for (const raw of commands) {
    const why = commandProblem(raw, record, ctx, depth, wrappedOuter, line);
    if (why) return why;
  }
  // The backstop: git followed by push or send-pack anywhere else in a command's words, however it got there.
  for (const raw of commands) {
    const u = unwrap(raw).words;
    for (let i = 1; i < u.length - 1; i++) {
      if (name(u[i]) === 'git' && (u[i + 1] === 'push' || u[i + 1] === 'send-pack')) return `Push plainly, as its own command: ${allowedPush(record ?? '<your task branch>')}. Not through ${u[0]}.`;
    }
  }
  return null;
}

/** Why an Edit, Write, MultiEdit or NotebookEdit may not touch this file, or null: the guard's own files, any .claude/ settings or hooks, anything under .git/, and the transcript the record is read from, each resolved through symlinks. */
export function fileProblem(input, ctx, tool = 'Edit') {
  const given = input?.file_path ?? input?.notebook_path ?? input?.path;
  if (typeof given !== 'string' || !given) return 'The guard couldn\'t see which file that would write: give its path.';
  const abs = resolve(ctx.cwd, given);
  if (ctx.transcript && (abs === resolve(ctx.transcript) || realDeep(abs) === realOf(ctx.transcript))) return 'The session\'s transcript isn\'t yours to edit: the guard reads its record there.';
  if (isGuarded(given, ctx, 'own')) return `${relative(ctx.projectDir, realDeep(abs)) || given} is the guard a cloud session runs, its hooks, its settings or git's own files: a cloud builder never changes them. acc cloud enable writes the guard, on the Mac.`;
  // A reviewer (T-86) writes its verdict alone, at the root of the clone, and never edits the code it reviews.
  if (ctx.role === 'reviewer') {
    if (tool === 'NotebookEdit') return `A cloud reviewer edits no notebook: it writes ${VERDICT_FILE} alone, with the Write tool.`;
    const target = realDeep(abs);
    if (target !== join(realOf(ctx.projectDir), VERDICT_FILE)) return `A cloud reviewer changes nothing but ${VERDICT_FILE}, at the root of the clone: never ${relative(ctx.projectDir, target) || given}. Its verdict is the file; the code stays as the builder left it.`;
  }
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
  const cwd = typeof input?.cwd === 'string' && input.cwd ? input.cwd : process.cwd();
  const ctx = { cwd, pushes: false, projectDir: process.env.CLAUDE_PROJECT_DIR || cwd, transcript: typeof input?.transcript_path === 'string' ? input.transcript_path : null, guardDir: dirname(fileURLToPath(import.meta.url)), role: null, verdict: null };
  let record = null;
  if (ctx.transcript) {
    try {
      const records = recordsOf(readHead(ctx.transcript));
      record = records?.branch ?? null;
      ctx.role = records?.role ?? null;
      ctx.verdict = records?.verdict ?? null;
    } catch {
      record = null;
    }
  }
  // The branch the pre-push hook lets through: a builder's task branch, a reviewer's verdict branch (T-86).
  const pushable = pushableOf(record, ctx);
  // The session starting: the pre-push hook goes into the clone now, and the record with it if the fire's
  // text is already in the transcript; the first command writes it otherwise.
  if (process.argv[2] === '--session-start') {
    const why = installPrePush(ctx, pushable);
    if (why) return block(`the clone's pre-push hook isn't installed: ${why}`);
    return;
  }
  const tool = input?.tool_name;
  if (typeof tool !== 'string') return block('the hook\'s input named no tool.');
  if (!TOOLS.has(tool)) return;
  // Kept current on every call, so the record is in place before any push; a push insists on it.
  try { installPrePush(ctx, pushable); } catch { /* the push path says why */ }
  if (tool !== 'Bash') {
    const why = fileProblem(input.tool_input, ctx, tool);
    if (why) deny(why);
    return;
  }
  const line = input.tool_input?.command;
  if (typeof line !== 'string') return block('the Bash call carried no command string.');
  const why = guard(line, record, ctx);
  if (why) return deny(why);
  // A push the guard allowed: the pre-push hook in place and the record written, or the push waits.
  if (ctx.pushes) {
    const hookWhy = prePushProblem(ctx, pushable);
    if (hookWhy) deny(hookWhy);
  }
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
