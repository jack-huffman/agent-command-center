import { appendFileSync, chmodSync, linkSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { alive } from './lock.ts';

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

export type Answer =
  | { decision: 'allow'; always?: boolean; answers?: Record<string, string> }
  | { decision: 'deny'; message?: string }
  /** Hand the question back to Claude Code's own prompt, to answer with `claude attach`. */
  | { decision: 'terminal' };

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
  | 'allowed' | 'allowed-for-session' | 'denied' | 'answered'
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
}

const HISTORY_MAX_BYTES = 2 * 1024 * 1024;

/** Appends a record. When the file grows past its limit, the older half is dropped. */
export function appendHistory(dir: string, rec: HistoryRecord): void {
  ensureDir(dir);
  const file = join(dir, 'history.jsonl');
  appendFileSync(file, JSON.stringify(rec) + '\n', { mode: 0o600 });
  try {
    if (statSync(file).size > HISTORY_MAX_BYTES) {
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
      writePrivateText(file, lines.slice(Math.floor(lines.length / 2)).join('\n') + '\n');
    }
  } catch {
    // trimming is best effort; the record is written
  }
}

function writePrivateText(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}

/** The newest records, newest last. Lines that don't read are skipped. */
export function questionHistory(dir: string, limit = 500): HistoryRecord[] {
  let text = '';
  try {
    text = readFileSync(join(dir, 'history.jsonl'), 'utf8');
  } catch {
    return [];
  }
  const out: HistoryRecord[] = [];
  for (const line of text.split('\n').filter(Boolean).slice(-limit)) {
    try {
      const r = JSON.parse(line) as HistoryRecord;
      if (r?.v === 1 && typeof r.id === 'string' && typeof r.outcome === 'string') out.push(r);
    } catch {
      // a torn line from a crash: skip it
    }
  }
  return out;
}

const outcomeOf = (q: Question, a: Answer): QuestionOutcome =>
  a.decision === 'terminal' ? 'terminal' : a.decision === 'deny' ? 'denied' : q.tool === 'AskUserQuestion' ? 'answered' : a.always ? 'allowed-for-session' : 'allowed';

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
  if (x.decision === 'deny') return x.message === undefined || (typeof x.message === 'string' && x.message.length <= 4000);
  if (x.decision !== 'allow') return false;
  if (x.always !== undefined && typeof x.always !== 'boolean') return false;
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
      });
    } catch {
      // the history is for showing; the answer matters more
    }
  };
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
  } else if (q.tool === 'AskUserQuestion') {
    decision = { behavior: 'allow', updatedInput: { ...q.input, answers: a.answers ?? {} } };
  } else {
    decision = { behavior: 'allow' };
    // "Don't ask again" lasts for this session only, whatever Claude Code offered to save it to.
    if (a.always && q.suggestions.length) decision.updatedPermissions = q.suggestions.map((s) => ({ ...(s as object), destination: 'session' }));
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
