/**
 * An agent's session as a timeline a person can read (D-030): what it was asked, what it said, and each
 * tool it used with that tool's result. Built from Claude Code's transcript file, read as it grows.
 *
 * The transcript's format is Claude Code's own and changes between versions, so this reads it loosely:
 * a record it doesn't recognise is skipped, never an error, and the page links to the terminal when
 * nothing could be read. No vscode import, so it's testable.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

export type ToolStatus = 'running' | 'done' | 'error';

export type Entry =
  /** What the agent was asked. A long first prompt is the task's instructions, shown folded. */
  | { k: 'prompt'; id: string; at: string | null; text: string; instructions: boolean }
  | { k: 'say'; id: string; at: string | null; text: string }
  | { k: 'tool'; id: string; at: string | null; tool: string; icon: string; title: string; code: string | null; status: ToolStatus; result: string | null; more: number }
  /** Claude Code's own summary of where the session got to. */
  | { k: 'recap'; id: string; at: string | null; text: string };

export interface Transcript {
  entries: Entry[];
  /** Tool calls still waiting for their result, by tool_use id. */
  open: Map<string, number>;
  cwd: string | null;
  /** When the last record was written, for "last active". */
  lastAt: string | null;
  /** The model its latest answer came from (D-036). */
  model: string | null;
  /** Records read, and how many of them meant something here. */
  read: number;
  used: number;
}

export const emptyTranscript = (): Transcript => ({ entries: [], open: new Map(), cwd: null, lastAt: null, model: null, read: 0, used: 0 });

/** Where Claude Code keeps a session's transcript: its folder, with every other character a dash. */
export const transcriptDir = (projectsDir: string, cwd: string): string => `${projectsDir}/${cwd.replace(/[^A-Za-z0-9]/g, '-')}`;

/**
 * The folder a conversation is saved under, which is the only window Claude Code for VSCode opens it in
 * (D-041). `claude agents` can report where a background session started, the main checkout, though it
 * saved its conversation under the worktree it moved into; and the window asking may belong to another
 * repo altogether (D-046). So the file itself is found: first under the likely folders, then anywhere in
 * Claude Code's projects. The folder is the cwd the conversation recorded whose name matches its own.
 */
export function savedFolder(projectsDir: string, sessionId: string, likely: (string | null | undefined)[]): string | null {
  const file = `${sessionId}.jsonl`;
  for (const f of new Set(likely.filter((c): c is string => !!c))) if (existsSync(join(transcriptDir(projectsDir, f), file))) return f;
  let dirs: string[];
  try {
    dirs = readdirSync(projectsDir);
  } catch {
    return null;
  }
  const dir = dirs.find((d) => existsSync(join(projectsDir, d, file)));
  if (!dir) return null;
  let text: string;
  try {
    text = readFileSync(join(projectsDir, dir, file), 'utf8');
  } catch {
    return null;
  }
  for (const m of text.matchAll(/"cwd":("(?:[^"\\]|\\.)*")/g)) {
    let cwd: unknown;
    try {
      cwd = JSON.parse(m[1]!);
    } catch {
      continue;
    }
    if (typeof cwd === 'string' && transcriptDir(projectsDir, cwd) === `${projectsDir}/${dir}`) return cwd;
  }
  return null;
}

const RESULT_LINES = 40;
const RESULT_CHARS = 6000;
const INSTRUCTIONS_CHARS = 600;

/** Tools whose result is the agent's own business: a file it read, an edit's "updated". */
const QUIET_RESULTS = new Set(['Read', 'Edit', 'MultiEdit', 'Write', 'NotebookEdit', 'TodoWrite', 'EnterWorktree', 'ExitWorktree', 'TaskCreate', 'TaskUpdate']);

/** Text Claude Code puts in the user's turn that the user didn't write. */
const NOT_TYPED = /^\s*(<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|system-reminder|task-notification|user-prompt-submit-hook|bash-input|bash-stdout|bash-stderr)>|Caveat: )/;

function clip(text: string): { text: string; more: number } {
  const lines = text.replace(/\s+$/, '').split('\n');
  let shown = lines.slice(0, RESULT_LINES).join('\n');
  let more = Math.max(0, lines.length - RESULT_LINES);
  if (shown.length > RESULT_CHARS) {
    shown = shown.slice(0, RESULT_CHARS);
    more = Math.max(more, 1);
  }
  return { text: shown, more };
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => {
      const b = c as { type?: string; text?: string };
      return b?.type === 'text' && typeof b.text === 'string' ? b.text : b?.type === 'image' ? '[image]' : '';
    }).filter(Boolean).join('\n');
  }
  return '';
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** A one-line account of a tool call, in words, with the command or path it acted on. */
export function describeTool(name: string, input: Record<string, unknown>, cwd: string | null): { icon: string; title: string; code: string | null } {
  const path = (p: unknown) => {
    const s = str(p);
    if (!s) return '';
    const rel = cwd && s.startsWith(cwd) ? relative(cwd, s) : s;
    return rel && !rel.startsWith('..') ? rel : s;
  };
  switch (name) {
    case 'Bash': return { icon: 'terminal', title: str(input.description) ?? 'Ran a command', code: str(input.command) };
    case 'Read': return { icon: 'file', title: `Read ${path(input.file_path) || 'a file'}`, code: null };
    case 'Edit': case 'MultiEdit': return { icon: 'edit', title: `Edited ${path(input.file_path) || 'a file'}`, code: null };
    case 'Write': return { icon: 'new-file', title: `Wrote ${path(input.file_path) || 'a file'}`, code: null };
    case 'NotebookEdit': return { icon: 'notebook', title: `Edited ${path(input.notebook_path) || 'a notebook'}`, code: null };
    case 'Grep': return { icon: 'search', title: `Searched for ${str(input.pattern) ?? 'text'}${str(input.path) ? ` in ${path(input.path)}` : ''}`, code: null };
    case 'Glob': return { icon: 'search', title: `Looked for files matching ${str(input.pattern) ?? '…'}`, code: null };
    case 'WebFetch': return { icon: 'globe', title: `Read ${str(input.url) ?? 'a web page'}`, code: null };
    case 'WebSearch': return { icon: 'search', title: `Searched the web for ${str(input.query) ?? '…'}`, code: null };
    case 'Task': case 'Agent': return { icon: 'hubot', title: `Asked a helper agent: ${str(input.description) ?? 'a sub-task'}`, code: null };
    case 'TodoWrite': {
      const todos = Array.isArray(input.todos) ? input.todos as { content?: string; status?: string }[] : [];
      const lines = todos.map((t) => `${t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '▸' : '☐'} ${t.content ?? ''}`);
      return { icon: 'checklist', title: 'Updated its plan', code: lines.length ? lines.join('\n') : null };
    }
    case 'AskUserQuestion': {
      const qs = Array.isArray(input.questions) ? input.questions as { question?: string }[] : [];
      return { icon: 'comment-discussion', title: `Asked: ${qs.map((q) => q.question ?? '').filter(Boolean).join(' · ') || 'a question'}`, code: null };
    }
    case 'ExitPlanMode': return { icon: 'list-ordered', title: 'Proposed a plan', code: str(input.plan) };
    case 'EnterWorktree': return { icon: 'git-branch', title: `Moved into its worktree${str(input.name) ? ` ${input.name}` : ''}`, code: null };
    case 'Skill': return { icon: 'book', title: `Used the ${str(input.skill) ?? str(input.command) ?? ''} skill`.replace('  ', ' '), code: null };
    default: {
      const mcp = /^mcp__(.+?)__(.+)$/.exec(name);
      const json = JSON.stringify(input);
      const code = json && json !== '{}' ? (json.length > 300 ? `${json.slice(0, 300)}…` : json) : null;
      return mcp ? { icon: 'plug', title: `Used ${mcp[1]!.replace(/_/g, ' ')}: ${mcp[2]!.replace(/_/g, ' ')}`, code } : { icon: 'tools', title: `Used ${name}`, code };
    }
  }
}

/**
 * Adds records to a transcript's timeline. Each line of the file is one record; lines that aren't JSON,
 * and records of kinds this doesn't know, are skipped.
 */
export function foldTranscript(t: Transcript, lines: string[]): Transcript {
  for (const line of lines) {
    if (!line.trim()) continue;
    let r: Record<string, any>;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    t.read++;
    if (!r || typeof r !== 'object' || r.isSidechain) continue; // a helper agent's own turns
    const at = typeof r.timestamp === 'string' ? r.timestamp : null;
    if (at) t.lastAt = at;
    if (typeof r.cwd === 'string') t.cwd = r.cwd; // it moves into its worktree partway
    const id = typeof r.uuid === 'string' ? r.uuid : `r${t.read}`;
    const content = r.message?.content;

    if (r.type === 'system' && r.subtype === 'away_summary' && str(r.content)) {
      // Claude Code ends its recap with a hint about its own settings, which isn't news here.
      t.entries.push({ k: 'recap', id, at, text: r.content.replace(/\s*\(disable recaps in \/config\)\s*$/i, '') });
      t.used++;
    } else if (r.type === 'user' && !r.isMeta) {
      if (typeof content === 'string') {
        if (NOT_TYPED.test(content) || !content.trim()) continue;
        const first = !t.entries.some((e) => e.k === 'prompt');
        t.entries.push({ k: 'prompt', id, at, text: content, instructions: first && content.length > INSTRUCTIONS_CHARS });
        t.used++;
      } else if (Array.isArray(content)) {
        for (const [n, b] of content.entries()) {
          if (b?.type === 'text' && str(b.text) && !NOT_TYPED.test(b.text)) {
            t.entries.push({ k: 'prompt', id: `${id}:${n}`, at, text: b.text, instructions: false });
            t.used++;
          }
          if (b?.type !== 'tool_result' || typeof b.tool_use_id !== 'string') continue;
          const i = t.open.get(b.tool_use_id);
          if (i === undefined) continue;
          t.open.delete(b.tool_use_id);
          const e = t.entries[i];
          if (e?.k !== 'tool') continue;
          e.status = b.is_error ? 'error' : 'done';
          if (!QUIET_RESULTS.has(e.tool) || b.is_error) {
            const c = clip(resultText(b.content));
            e.result = c.text || null;
            e.more = c.more;
          }
          t.used++;
        }
      }
    } else if (r.type === 'assistant' && Array.isArray(content)) {
      if (typeof r.message?.model === 'string' && r.message.model !== '<synthetic>') t.model = r.message.model;
      for (const [n, b] of content.entries()) {
        if (b?.type === 'text' && str(b.text)) {
          t.entries.push({ k: 'say', id: `${id}:${n}`, at, text: b.text.trim() });
          t.used++;
        } else if (b?.type === 'tool_use' && typeof b.name === 'string') {
          const d = describeTool(b.name, b.input && typeof b.input === 'object' ? b.input : {}, t.cwd);
          t.open.set(String(b.id), t.entries.length);
          t.entries.push({ k: 'tool', id: String(b.id ?? `${id}:${n}`), at, tool: b.name, ...d, status: 'running', result: null, more: 0 });
          t.used++;
        }
      }
    }
  }
  return t;
}

/** Splits text read from a growing file into whole lines and the partial line still being written. */
export function splitLines(pending: string, chunk: string): { lines: string[]; rest: string } {
  const all = (pending + chunk).split('\n');
  const rest = all.pop() ?? '';
  return { lines: all, rest };
}

export const shortPath = (p: string): string => p.split('/').slice(-2).join('/') || basename(p);
