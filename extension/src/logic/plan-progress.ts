/**
 * What the planning agent is doing while a plan is made, a reply comes, or Draft the plan runs (T-131). It's read
 * from the agent's own session transcript, a small part at a time from where the last read ended, and only while
 * the conversation's panel or the task's page is on show. Each tool it uses becomes plain words; what the agent
 * wrote (a path, a search) is kept apart as work data, and a command line is never kept, only what it does.
 *
 * The transcript's format is Claude Code's own (transcript.ts reads it the same loose way): a line that isn't
 * understood is skipped, never an error. Like the rest of logic/, no `vscode` import, so it's tested with node:test.
 */
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { basename, isAbsolute, relative } from 'node:path';
import { type PlanProgress, planProgress } from '../model/plan-progress.ts';
import { processLine } from './processes.ts';

/** Making a plan (Make a plan, Draft the plan, Skip to the plan), or a reply in the conversation. */
export type PlanJobKind = 'plan' | 'reply';

export type StepKind = 'ticket' | 'message' | 'read' | 'search' | 'find' | 'command' | 'web' | 'write' | 'helper' | 'other';

/** One thing the planning agent did, in plain words, with what it did it to as work data. */
export interface PlanStep {
  kind: StepKind;
  icon: string;
  /** What it does, in plain words: "Reading", "Searching the code for", "Reading the project's history". */
  words: string;
  /** What the agent wrote that it acts on: a path in the repo, a search's text, a web page. Null when none. */
  data: string | null;
  /** When it began, by the transcript's clock. */
  at: number;
}

/** What each analyst command does, in plain words: the reads analyze.ts's ANALYST_COMMANDS lets it run. */
const COMMAND_WORDS: readonly [RegExp, string][] = [
  [/^git log\b/, 'Reading the project\'s history'],
  [/^git show\b/, 'Reading an earlier change'],
  [/^git diff\b/, 'Comparing versions of the code'],
  [/^git grep\b/, 'Searching the code'],
  [/^git ls-files\b/, 'Listing the project\'s files'],
  [/^sf org display\b/, 'Reading the org\'s details'],
  [/^sf org list metadata/, 'Listing the org\'s metadata'],
  [/^sf data query\b/, 'Querying the org\'s records'],
  [/^sf sobject (describe|list)\b/, 'Reading the org\'s objects'],
  [/^sf limits\b/, 'Reading the org\'s limits'],
  [/^sf project retrieve\b/, 'Fetching metadata from the org'],
  [/^sf apex (list|get) log\b/, 'Reading the org\'s debug logs'],
];

/**
 * What a command does, in plain words, never the line itself: one of the analyst's reads, one of acc's own as its
 * process (D-132), or "Running a command". A `cd …` before it, or an environment setting, doesn't change what it does.
 */
export function commandWords(line: string): string {
  const t = line.trim().replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, '').replace(/^(?:[A-Z_][A-Z0-9_]*=\S*\s+)+/, '');
  const known = COMMAND_WORDS.find(([re]) => re.test(t));
  if (known) return known[1];
  const process = processLine(t.split(/\s*(?:&&|\|\||;|\|)\s*/)[0] ?? '');
  return process ? `Running "${process}"` : 'Running a command';
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A path as the repo names it: relative to the first root it's under, or its file name when it's under none. */
export function repoPath(p: string, roots: readonly string[]): string {
  if (!isAbsolute(p)) return p;
  for (const r of roots) {
    const rel = relative(r, p);
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel;
  }
  return basename(p);
}

/**
 * One tool call as a step: what it does in plain words, and what it acts on as work data. A tool this doesn't
 * know is "Using a tool", with nothing of the agent's shown. The tool a JSON answer is written with is the plan,
 * or for a reply, the reply.
 */
export function stepOf(name: string, input: Record<string, unknown>, roots: readonly string[], job: PlanJobKind): Omit<PlanStep, 'at'> {
  const path = (p: unknown) => { const s = str(p); return s ? repoPath(s, roots) : null; };
  switch (name) {
    case 'Read': { const d = path(input.file_path); return { kind: 'read', icon: 'file', words: d ? 'Reading' : 'Reading a file', data: d }; }
    case 'Grep': { const d = str(input.pattern); return { kind: 'search', icon: 'search', words: d ? 'Searching the code for' : 'Searching the code', data: d }; }
    case 'Glob': { const d = str(input.pattern); return { kind: 'find', icon: 'files', words: d ? 'Looking for files named' : 'Looking for files', data: d }; }
    case 'Bash': return { kind: 'command', icon: 'terminal', words: commandWords(str(input.command) ?? ''), data: null };
    case 'WebFetch': return { kind: 'web', icon: 'globe', words: 'Reading a web page', data: str(input.url) };
    case 'WebSearch': { const d = str(input.query); return { kind: 'web', icon: 'globe', words: d ? 'Searching the web for' : 'Searching the web', data: d }; }
    case 'StructuredOutput': return { kind: 'write', icon: 'edit', words: job === 'plan' ? 'Writing the plan' : 'Writing its reply', data: null };
    case 'Task': case 'Agent': return { kind: 'helper', icon: 'hubot', words: 'Asking a helper agent', data: null };
    default: return { kind: 'other', icon: 'tools', words: 'Using a tool', data: null };
  }
}

/** A transcript followed from where the last read ended: its steps since the job began, and when it last moved. */
export interface PlanFeed {
  /** The byte the next read starts at. */
  offset: number;
  /** Inside a line longer than a read, such as a large tool result: it's passed over to its end, unread. */
  skipping: boolean;
  steps: PlanStep[];
  /** When the transcript last moved since the job began: a step, its result, or the agent's words. */
  movedAt: number | null;
  /** When the job began: a resumed session's earlier records are older, and aren't this job's. */
  since: number;
  roots: readonly string[];
  job: PlanJobKind;
}

/** A clock's difference allowed between the job's start and its first record: Claude Code's clock is the same machine's. */
const SINCE_SLACK_MS = 5_000;

export const newFeed = (since: number, roots: readonly string[], job: PlanJobKind): PlanFeed => ({ offset: 0, skipping: false, steps: [], movedAt: null, since, roots, job });

/**
 * Adds a transcript's whole lines to a feed. A line that isn't JSON, a record from before the job began, and a
 * helper agent's own tool calls add no step; a helper's records still count as the transcript moving.
 */
export function feedLines(feed: PlanFeed, lines: readonly string[]): PlanFeed {
  for (const line of lines) {
    if (!line.trim()) continue;
    let r: Record<string, any>;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    const at = typeof r?.timestamp === 'string' ? Date.parse(r.timestamp) : NaN;
    if (!Number.isFinite(at) || at < feed.since - SINCE_SLACK_MS) continue;
    if (r.type !== 'assistant' && r.type !== 'user') continue;
    feed.movedAt = Math.max(feed.movedAt ?? 0, at);
    if (r.type !== 'assistant' || r.isSidechain || !Array.isArray(r.message?.content)) continue;
    const roots = typeof r.cwd === 'string' ? [...feed.roots, r.cwd] : feed.roots;
    for (const b of r.message.content as { type?: string; name?: unknown; input?: unknown }[]) {
      if (b?.type !== 'tool_use' || typeof b.name !== 'string') continue;
      feed.steps.push({ ...stepOf(b.name, b.input && typeof b.input === 'object' ? b.input as Record<string, unknown> : {}, roots, feed.job), at });
    }
  }
  return feed;
}

/** How much of a transcript one read takes: a resumed session's earlier turns are passed over in a few reads. */
export const READ_BYTES = 512 * 1024;

/**
 * Reads what the transcript gained since the last read, at most `max` bytes, and adds its whole lines to the feed.
 * A line cut by the read's end (or by a write still under way) waits for the next read, from its start. A line longer
 * than `max` is passed over. A file that shrank was started again, so it's read from its start. Returns the bytes
 * the read moved past; 0 when there was nothing new, nothing whole, or the file can't be read.
 */
export function readFeed(feed: PlanFeed, file: string, max = READ_BYTES): number {
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch {
    return 0;
  }
  try {
    const size = fstatSync(fd).size;
    if (size < feed.offset) Object.assign(feed, { offset: 0, skipping: false, steps: [], movedAt: null });
    const n = Math.min(max, size - feed.offset);
    if (n <= 0) return 0;
    const buf = Buffer.alloc(n);
    readSync(fd, buf, 0, n, feed.offset);
    // The end of a line too long to read is passed over first.
    const from = feed.skipping ? buf.indexOf(0x0a) + 1 : 0;
    if (feed.skipping && from === 0) { feed.offset += n; return n; }
    feed.skipping = false;
    const nl = buf.lastIndexOf(0x0a);
    if (nl < from) {
      // No whole line: a full read from a line's start is inside a line longer than a read; else the line waits for its end.
      if (n < max || from > 0) { feed.offset += from; return from; }
      feed.skipping = true;
      feed.offset += n;
      return n;
    }
    // Only whole lines are read: one cut by the read's end, even inside a character, waits for the next.
    feedLines(feed, buf.subarray(from, nl + 1).toString('utf8').split('\n'));
    feed.offset += nl + 1;
    return nl + 1;
  } catch {
    return 0;
  } finally {
    closeSync(fd);
  }
}

/** A job under way for a task, as the extension finds it: making a plan, or a reply, and where to read its steps. */
export interface PlanJob {
  kind: PlanJobKind;
  /** Before the planning agent starts, the Command Center reads the ticket (T-110): there's no session yet. */
  phase: 'reading' | 'working';
  /** Its session, once acc has started it. */
  sessionId: string | null;
  startedAt: number;
  /** The folders its paths are relative to: the project, and on Salesforce the analyst's scratch project. */
  roots: string[];
  /** Whether Watch its session can open its session: it has one, and this window can watch. */
  watch: boolean;
  /** Whether Stop can stop it: this window's own run, which acc.job.stop ends. */
  stop: boolean;
}

/** What the plan's progress needs from the extension, passed in so it's tested without VS Code. */
export interface PlanWatchHost {
  /** The tasks whose conversation panel or page is on show now, by project. */
  shown(): { root: string; id: string }[];
  /** The job under way for a task, or null. */
  job(root: string, id: string): PlanJob | null;
  /** A session's transcript file, or null while there's none to read. */
  file(sessionId: string, roots: readonly string[]): string | null;
  /** How long the project's plans usually take, or null when it has too few recorded. */
  typical(root: string): number | null;
  /** Tells the task's panel and page its progress. */
  tell(root: string, id: string, progress: PlanProgress): void;
  /** A job on show ended: its panel and page redraw without it. */
  ended(root: string, id: string): void;
  now(): number;
}

/** How long a transcript not found is left before it's looked for again: finding it may read every project's folder. */
const LOOK_AGAIN_MS = 5_000;

interface Followed { key: string; feed: PlanFeed; file: string | null; lookedAt: number }

/**
 * Follows each job on show: once a tick, about each second, each task on show with a job under way reads what its
 * transcript gained and is told its progress. A task not on show isn't read at all; a job that ended is dropped.
 */
export class PlanWatch {
  private readonly host: PlanWatchHost;
  private readonly followed = new Map<string, Followed>();

  constructor(host: PlanWatchHost) {
    this.host = host;
  }

  /** One tick: reads each job on show and tells its progress. Returns how many tasks were told. */
  tick(): number {
    let told = 0;
    const shown = new Set<string>();
    for (const { root, id } of this.host.shown()) {
      const k = `${root}#${id}`;
      if (shown.has(k)) continue;
      shown.add(k);
      const p = this.progress(root, id);
      if (p) {
        this.host.tell(root, id, p);
        told++;
      } else if (this.followed.delete(k)) this.host.ended(root, id);
    }
    // A task no longer on show is read again from where it was, if its job is the same one.
    for (const k of this.followed.keys()) if (!shown.has(k)) this.followed.delete(k);
    return told;
  }

  /** The task's progress now, its transcript read up to date first; null with no job under way. */
  progress(root: string, id: string): PlanProgress | null {
    const job = this.host.job(root, id);
    const k = `${root}#${id}`;
    if (!job) return null;
    const now = this.host.now();
    const key = `${job.kind}:${job.sessionId ?? ''}:${job.startedAt}`;
    let f = this.followed.get(k);
    if (!f || f.key !== key) {
      f = { key, feed: newFeed(job.startedAt, job.roots, job.kind), file: null, lookedAt: 0 };
      this.followed.set(k, f);
    }
    if (job.sessionId && !f.file && now - f.lookedAt >= LOOK_AGAIN_MS) {
      f.lookedAt = now;
      f.file = this.host.file(job.sessionId, job.roots);
    }
    if (f.file) readFeed(f.feed, f.file);
    return planProgress({
      job: job.kind, phase: job.phase, startedAt: job.startedAt, steps: f.feed.steps, movedAt: f.feed.movedAt, found: !!f.file, now,
      typicalMs: job.kind === 'plan' ? this.host.typical(root) : null, watch: job.watch, stop: job.stop,
    });
  }
}
