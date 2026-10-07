import { chmodSync, closeSync, fstatSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { alive, withLock } from './lock.ts';

/**
 * What an agent asks a person (D-030): a permission prompt, or a question it put with AskUserQuestion.
 * Claude Code's PermissionRequest hook runs `acc hook permission`, which leaves the question here and
 * waits for the Command Center to answer it. With no Command Center open for that folder, the hook
 * steps aside at once and Claude Code asks in its own prompt, as it would without acc.
 *
 * One machine-wide folder, like the heavy-check slots, so every repo, worktree and window shares it:
 *   <id>.json             a question, written by the hook that waits for it
 *   <id>.answer.json      its answer, written once by whoever answers first
 *   listeners/<pid>.json  a window that shows questions for these folders, refreshed while it's open
 *   history.jsonl         how each question ended, so the page can show the conversation (D-037)
 *   history.trimmed       the size the history's last trim left it at (D-043)
 *   history.lock/         held while a record is appended and the history trimmed (D-050)
 */
export const questionsDir = (env: NodeJS.ProcessEnv = process.env): string => env.ACC_QUESTIONS_DIR || join(homedir(), '.acc', 'questions');

/** What Claude Code sends the hook on stdin. Fields acc doesn't use are left out. */
export interface HookInput {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  transcript_path?: string;
  tool_name: string;
  tool_input: Record<string, unknown>;
  permission_suggestions?: unknown[];
}

export interface Question {
  v: 1;
  id: string;
  /** The hook process waiting for the answer. A question whose process is gone is stale. */
  pid: number;
  at: number;
  sessionId: string;
  cwd: string;
  transcript: string | null;
  tool: string;
  input: Record<string, unknown>;
  /** The "don't ask again" rules Claude Code offers. acc applies them to this session only. */
  suggestions: unknown[];
}

/**
 * Every answer Claude Code's own prompt offers (D-038). Allow: once; always, for the session or the
 * project; with the permission mode switched (auto, or accept edits after a plan); or with the
 * command edited first. Deny: with what to do instead, or stopping the agent's turn.
 */
export type Answer =
  | { decision: 'allow'; always?: boolean; scope?: 'session' | 'project'; mode?: AllowedMode; command?: string; answers?: Record<string, string> }
  | { decision: 'deny'; message?: string; stop?: boolean }
  /** Hand the question back to Claude Code's own prompt, to answer with `claude attach`. */
  | { decision: 'terminal' };

/** Modes an answer may switch a session to. Never bypassPermissions. */
export const ALLOWED_MODES = ['auto', 'acceptEdits', 'default'] as const;
export type AllowedMode = (typeof ALLOWED_MODES)[number];

export interface Listener {
  pid: number;
  at: number;
  roots: string[];
}

/** A window refreshes its listener file this often; one older than LISTENER_STALE_MS has gone. */
export const LISTENER_EVERY_MS = 15_000;
const LISTENER_STALE_MS = 45_000;
/** Claude Code kills a hook after its timeout (an hour, as acc sets it), so the hook gives up first. */
export const HOOK_TIMEOUT_S = 3600;
const MAX_WAIT_MS = (HOOK_TIMEOUT_S - 120) * 1000;

const isUnder = (path: string, root: string): boolean => path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Writes a whole file or nothing, readable only by this user: a reader never sees half of it. */
function writePrivate(file: string, data: unknown): void {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  renameSync(tmp, file);
}

function ensureDir(dir: string): void {
  mkdirSync(join(dir, 'listeners'), { recursive: true, mode: 0o700 });
  try {
    chmodSync(dir, 0o700);
  } catch {
    // not ours to change; the files inside are still private
  }
}

// ---------------------------------------------------------------- what happened to each question (D-037)

/** How a question ended. Written by the hook, which is the one place that knows. */
export type QuestionOutcome =
  | 'allowed' | 'allowed-for-session' | 'allowed-for-project' | 'allowed-edited' | 'allowed-auto-mode' | 'allowed-accept-edits'
  | 'denied' | 'denied-stopped' | 'answered'
  /** Handed back to Claude Code's own prompt: chosen, no window listening, the window closed, or the wait ran out. */
  | 'terminal' | 'no-window' | 'window-closed' | 'timed-out'
  /** The session stopped waiting: it was stopped, or answered in its own prompt. */
  | 'stopped';

export interface HistoryRecord {
  v: 1;
  id: string;
  sessionId: string;
  cwd: string;
  tool: string;
  input: Record<string, unknown>;
  askedAt: number;
  endedAt: number;
  outcome: QuestionOutcome;
  answers?: Record<string, string>;
  message?: string;
  /** The command that ran instead, when you edited it. */
  command?: string;
}

/** The history keeps its newest 1,000 records, and no more than 2 MB of them (D-043). */
const HISTORY_KEEP = 1000;
const HISTORY_MAX_BYTES = 2 * 1024 * 1024;
/** An append reads only the history's last byte. It's read whole, to be trimmed, once it has grown this many bytes since its last trim. */
export const HISTORY_TRIM_EVERY_BYTES = 64 * 1024;

/**
 * An append and its trim hold this lock, so a trim can't rename its copy over a record appended after it
 * read the file (D-050). Both take milliseconds; a waiter breaks a lock held past `staleMs` before it gives up.
 */
const HISTORY_LOCK = { timeoutMs: 10_000, staleMs: 5_000 };

/**
 * Appends a record. Once the file has grown `trimEvery` bytes past the size its last trim left, it's cut
 * back to its newest records, so between trims it holds only a few more than it keeps.
 */
export function appendHistory(dir: string, rec: HistoryRecord, trimEvery = HISTORY_TRIM_EVERY_BYTES): void {
  ensureDir(dir);
  const file = join(dir, 'history.jsonl');
  withLock(join(dir, 'history.lock'), () => {
    appendLine(file, JSON.stringify(rec));
    try {
      const size = statSync(file).size;
      if (size > trimmedSize(dir, size) + trimEvery) writePrivateText(join(dir, 'history.trimmed'), `${trimHistory(file)}\n`);
    } catch {
      // trimming is best effort; the record is written
    }
  }, HISTORY_LOCK);
}

/**
 * Appends a line in one write. A last line torn by a crash has no newline, so one goes first, or the
 * record would join it and neither would read. Only the file's last byte is read to tell.
 */
function appendLine(file: string, line: string): void {
  const fd = openSync(file, 'a+', 0o600);
  try {
    const { size } = fstatSync(fd);
    const last = Buffer.alloc(1);
    const torn = size > 0 && readSync(fd, last, 0, 1, size - 1) === 1 && last[0] !== 0x0a;
    writeSync(fd, `${torn ? '\n' : ''}${line}\n`);
  } finally {
    closeSync(fd);
  }
}

/**
 * The size the last trim left the history at. Missing, unreadable, or more than the file holds now (it
 * was deleted or replaced since), it counts as 0.
 */
function trimmedSize(dir: string, size: number): number {
  try {
    const n = Number(readFileSync(join(dir, 'history.trimmed'), 'utf8'));
    return Number.isSafeInteger(n) && n >= 0 && n <= size ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Keeps the newest records that read, up to the limits, and returns the size it leaves the file at.
 * Lines that don't read are dropped.
 */
function trimHistory(file: string): number {
  const data = readFileSync(file);
  const lines = data.toString('utf8').split('\n').filter(Boolean);
  const kept: string[] = [];
  let bytes = 0;
  for (let i = lines.length - 1; i >= 0 && kept.length < HISTORY_KEEP; i--) {
    const line = lines[i]!;
    if (!readRecord(line)) continue;
    bytes += Buffer.byteLength(line) + 1;
    if (bytes > HISTORY_MAX_BYTES && kept.length) break;
    kept.push(line);
  }
  if (kept.length === lines.length) return data.length;
  const text = kept.reverse().map((l) => `${l}\n`).join('');
  writePrivateText(file, text);
  return Buffer.byteLength(text);
}

function writePrivateText(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}

/** A line of the history, or null when it doesn't read: a torn line from a crash, or one half-written. */
function readRecord(line: string): HistoryRecord | null {
  try {
    const r = JSON.parse(line) as HistoryRecord;
    return r?.v === 1 && typeof r.id === 'string' && typeof r.outcome === 'string' ? r : null;
  } catch {
    return null;
  }
}

/** The newest records, newest last. Lines that don't read are skipped. */
export function questionHistory(dir: string, limit = 500): HistoryRecord[] {
  let text = '';
  try {
    text = readFileSync(join(dir, 'history.jsonl'), 'utf8');
  } catch {
    return [];
  }
  return text.split('\n').filter(Boolean).slice(-limit).flatMap((line) => readRecord(line) ?? []);
}

// ---------------------------------------------------------------- an edited command (D-038)

/**
 * An edited command isn't slipped in silently: the agent is told to run your version, and your version
 * is approved for when it does, once, within ten minutes, for that session only.
 */
const PREAPPROVAL_MS = 10 * 60_000;
const preapprovalFile = (dir: string, sessionId: string) => join(dir, 'approved', `${sessionId.replace(/[^A-Za-z0-9-]/g, '')}.json`);

export function preapprove(dir: string, sessionId: string, command: string, now = Date.now()): void {
  mkdirSync(join(dir, 'approved'), { recursive: true, mode: 0o700 });
  writePrivate(preapprovalFile(dir, sessionId), { command, until: now + PREAPPROVAL_MS });
}

/** Whether this exact command was approved for this session; using the approval uses it up. */
export function takePreapproval(dir: string, sessionId: string, command: string, now = Date.now()): boolean {
  const file = preapprovalFile(dir, sessionId);
  const p = readJson(file) as { command?: string; until?: number } | null;
  if (!p || p.command !== command || typeof p.until !== 'number' || now > p.until) return false;
  rmSync(file, { force: true });
  return true;
}

export const editedMessage = (command: string): string =>
  `The user edited this command in the Command Center. Run exactly this instead, as it is, and carry on:\n\n\`\`\`\n${command}\n\`\`\``;

function outcomeOf(q: Question, a: Answer): QuestionOutcome {
  if (a.decision === 'terminal') return 'terminal';
  if (a.decision === 'deny') return a.stop ? 'denied-stopped' : 'denied';
  if (q.tool === 'AskUserQuestion') return 'answered';
  if (a.command && q.tool === 'Bash') return 'allowed-edited';
  if (a.mode === 'auto') return 'allowed-auto-mode';
  if (a.mode === 'acceptEdits') return 'allowed-accept-edits';
  if (a.always) return a.scope === 'project' ? 'allowed-for-project' : 'allowed-for-session';
  return 'allowed';
}

// ---------------------------------------------------------------- windows that listen

/** Says this window shows questions for these folders. Called again every LISTENER_EVERY_MS. */
export function listen(dir: string, roots: string[], pid = process.pid, now = Date.now()): void {
  ensureDir(dir);
  writePrivate(join(dir, 'listeners', `${pid}.json`), { pid, at: now, roots } satisfies Listener);
}

export function stopListening(dir: string, pid = process.pid): void {
  rmSync(join(dir, 'listeners', `${pid}.json`), { force: true });
}

export function listeners(dir: string, now = Date.now()): Listener[] {
  let names: string[] = [];
  try {
    names = readdirSync(join(dir, 'listeners')).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  return names.flatMap((n) => {
    const l = readJson(join(dir, 'listeners', n)) as Listener | null;
    const ok = !!l && Number.isInteger(l.pid) && typeof l.at === 'number' && Array.isArray(l.roots) && now - l.at < LISTENER_STALE_MS && alive(l.pid);
    return ok ? [l] : [];
  });
}

/** Whether a window open now would show a question asked in this folder. */
export const covered = (ls: Listener[], cwd: string): boolean => ls.some((l) => l.roots.some((r) => typeof r === 'string' && isUnder(cwd, r)));

/** Whether this machine has ever had a Command Center listening: no history is kept before then. */
function existsQuestionsDir(dir: string): boolean {
  try {
    return statSync(join(dir, 'listeners')).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- the hook's side

export function parseHookInput(text: string): HookInput | null {
  let x: Record<string, unknown> | null = null;
  try {
    x = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!x || typeof x !== 'object') return null;
  const str = (v: unknown) => typeof v === 'string' && v.length > 0;
  if (!str(x.session_id) || !str(x.cwd) || !str(x.tool_name) || !x.tool_input || typeof x.tool_input !== 'object') return null;
  return {
    hook_event_name: String(x.hook_event_name ?? ''), session_id: x.session_id as string, cwd: x.cwd as string,
    transcript_path: str(x.transcript_path) ? x.transcript_path as string : undefined,
    tool_name: x.tool_name as string, tool_input: x.tool_input as Record<string, unknown>,
    permission_suggestions: Array.isArray(x.permission_suggestions) ? x.permission_suggestions : [],
  };
}

export function isAnswer(a: unknown): a is Answer {
  const x = a as Record<string, unknown> | null;
  if (!x || typeof x !== 'object') return false;
  if (x.decision === 'terminal') return true;
  if (x.decision === 'deny') return (x.message === undefined || (typeof x.message === 'string' && x.message.length <= 4000)) && (x.stop === undefined || typeof x.stop === 'boolean');
  if (x.decision !== 'allow') return false;
  if (x.always !== undefined && typeof x.always !== 'boolean') return false;
  if (x.scope !== undefined && x.scope !== 'session' && x.scope !== 'project') return false;
  if (x.mode !== undefined && !(ALLOWED_MODES as readonly unknown[]).includes(x.mode)) return false;
  if (x.command !== undefined && !(typeof x.command === 'string' && x.command.trim().length > 0 && x.command.length <= 20_000)) return false;
  if (x.answers === undefined) return true;
  const answers = x.answers as Record<string, unknown>;
  return !!answers && typeof answers === 'object' && Object.values(answers).every((v) => typeof v === 'string' && v.length <= 4000);
}

export interface AskOptions {
  dir?: string;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  pollMs?: number;
  maxWaitMs?: number;
  pid?: number;
  /** Set when the hook is told to stop, so it cleans up and steps aside. */
  signal?: AbortSignal;
}

/**
 * Leaves the question for the Command Center and waits for its answer. Null means "let Claude Code ask
 * in its own prompt": no window shows this folder, the window closed, the wait ran out, or the person
 * chose to answer in the terminal.
 */
export async function ask(input: HookInput, opts: AskOptions = {}): Promise<{ question: Question; answer: Answer } | null> {
  const dir = opts.dir ?? questionsDir();
  const now = opts.now ?? Date.now;
  const wait = opts.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const pollMs = opts.pollMs ?? 300;
  const maxWaitMs = opts.maxWaitMs ?? MAX_WAIT_MS;
  const record = (q: Pick<Question, 'id' | 'at'>, outcome: QuestionOutcome, a?: Answer) => {
    try {
      appendHistory(dir, {
        v: 1, id: q.id, sessionId: input.session_id, cwd: input.cwd, tool: input.tool_name, input: input.tool_input, askedAt: q.at, endedAt: now(), outcome,
        ...(a?.decision === 'allow' && a.answers ? { answers: a.answers } : {}), ...(a?.decision === 'deny' && a.message ? { message: a.message } : {}),
        ...(a?.decision === 'allow' && a.command && input.tool_name === 'Bash' ? { command: a.command } : {}),
      });
    } catch {
      // the history is for showing; the answer matters more
    }
  };
  // The agent running the command you edited: approved already.
  if (input.tool_name === 'Bash' && takePreapproval(dir, input.session_id, String(input.tool_input.command ?? ''), now())) {
    const id = `${now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const q: Question = { v: 1, id, pid: opts.pid ?? process.pid, at: now(), sessionId: input.session_id, cwd: input.cwd, transcript: input.transcript_path ?? null, tool: input.tool_name, input: input.tool_input, suggestions: [] };
    return { question: q, answer: { decision: 'allow' } };
  }
  if (!covered(listeners(dir, now()), input.cwd)) {
    // Asked in its own terminal, with no window listening: noted, so the page can say so.
    if (listeners(dir, now()).length || existsQuestionsDir(dir)) record({ id: `${now().toString(36)}-${randomBytes(4).toString('hex')}`, at: now() }, 'no-window');
    return null;
  }
  ensureDir(dir);
  const question: Question = {
    v: 1, id: `${now().toString(36)}-${randomBytes(4).toString('hex')}`, pid: opts.pid ?? process.pid, at: now(),
    sessionId: input.session_id, cwd: input.cwd, transcript: input.transcript_path ?? null,
    tool: input.tool_name, input: input.tool_input, suggestions: input.permission_suggestions ?? [],
  };
  const file = join(dir, `${question.id}.json`);
  const answerFile = join(dir, `${question.id}.answer.json`);
  writePrivate(file, question);
  const started = now();
  try {
    for (let i = 0; ; i++) {
      const a = readJson(answerFile);
      if (isAnswer(a)) {
        record(question, outcomeOf(question, a), a);
        if (a.decision === 'allow' && a.command && question.tool === 'Bash') preapprove(dir, question.sessionId, a.command, now());
        return a.decision === 'terminal' ? null : { question, answer: a };
      }
      if (opts.signal?.aborted) { record(question, 'stopped'); return null; }
      if (now() - started > maxWaitMs) { record(question, 'timed-out'); return null; }
      // Every few seconds: is a window still showing it? If the last one closed, step aside.
      if (i % 10 === 9 && !covered(listeners(dir, now()), input.cwd)) { record(question, 'window-closed'); return null; }
      await wait(pollMs);
    }
  } finally {
    rmSync(file, { force: true });
    rmSync(answerFile, { force: true });
  }
}

/** What the hook prints for Claude Code. Null prints nothing, which leaves the decision to Claude Code. */
export function hookOutput(q: Question, a: Answer): Record<string, unknown> | null {
  if (a.decision === 'terminal') return null;
  let decision: Record<string, unknown>;
  if (a.decision === 'deny') {
    decision = { behavior: 'deny', message: a.message?.trim() ? `The user said no, from the Command Center: ${a.message.trim()}` : 'The user said no, from the Command Center.' };
    // Stop: the agent's turn ends here and it waits, as Esc does in Claude Code's own prompt.
    if (a.stop) decision.interrupt = true;
  } else if (q.tool === 'AskUserQuestion') {
    decision = { behavior: 'allow', updatedInput: { ...q.input, answers: a.answers ?? {} } };
  } else {
    // An edited command (Claude Code's "Tab to amend"): the agent is told to run yours, which is approved.
    if (a.command && q.tool === 'Bash') return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: editedMessage(a.command) } } };
    decision = { behavior: 'allow' };
    const updates: unknown[] = [];
    // "Always allow" is what Claude Code offered, kept for the session or saved to the project's local settings.
    if (a.always && q.suggestions.length) updates.push(...q.suggestions.map((s) => ({ ...(s as object), destination: a.scope === 'project' ? 'localSettings' : 'session' })));
    if (a.mode) updates.push({ type: 'setMode', mode: a.mode, destination: 'session' });
    if (updates.length) decision.updatedPermissions = updates;
  }
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
}

/** The hooks a session needs so its questions come to the Command Center. `command` runs acc's hook. */
export function permissionHook(command: string): Record<string, unknown> {
  return { PermissionRequest: [{ matcher: '*', hooks: [{ type: 'command', command: `${command} hook permission`, timeout: HOOK_TIMEOUT_S }] }] };
}

// ---------------------------------------------------------------- the Command Center's side

/** Questions still waiting, oldest first. A question whose hook has gone is removed. */
export function pendingQuestions(dir: string): Question[] {
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json') && !n.endsWith('.answer.json'));
  } catch {
    return [];
  }
  const out: Question[] = [];
  for (const n of names) {
    const q = readJson(join(dir, n)) as Question | null;
    if (!q || q.v !== 1 || typeof q.id !== 'string' || `${q.id}.json` !== n || !Number.isInteger(q.pid)) continue;
    if (!alive(q.pid)) {
      rmSync(join(dir, n), { force: true });
      rmSync(join(dir, `${q.id}.answer.json`), { force: true });
      continue;
    }
    out.push(q);
  }
  return out.sort((a, b) => a.at - b.at);
}

/** Whether one of these questions comes from an agent working in a folder, or under it. */
export const askingUnder = (questions: Pick<Question, 'cwd'>[], dir: string): boolean =>
  questions.some((q) => q.cwd === dir || q.cwd.startsWith(dir.endsWith('/') ? dir : `${dir}/`));

/**
 * Answers a question, once. False when it was already answered (another window got there first) or
 * isn't waiting any more.
 */
export function answerQuestion(dir: string, id: string, answer: Answer): boolean {
  if (!/^[a-z0-9]+-[0-9a-f]{8}$/.test(id) || !isAnswer(answer)) return false;
  const q = readJson(join(dir, `${id}.json`)) as Question | null;
  if (!q || !alive(q.pid)) return false;
  const tmp = join(dir, `${id}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  writeFileSync(tmp, JSON.stringify(answer), { mode: 0o600 });
  try {
    linkSync(tmp, join(dir, `${id}.answer.json`)); // fails if an answer is already there
    return true;
  } catch {
    return false;
  } finally {
    rmSync(tmp, { force: true });
  }
}
