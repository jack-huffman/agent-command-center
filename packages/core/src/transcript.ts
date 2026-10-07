import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Finding an agent's conversation, and the last thing it said (D-046, D-067). Claude Code keeps each
 * session's transcript as `<config dir>/projects/<folder, every other character a dash>/<session>.jsonl`.
 * Its format is Claude Code's own and changes between versions, so it's read loosely: a line that isn't
 * understood is skipped, never an error.
 */

/** Claude Code's projects folder, where it saves conversations: under CLAUDE_CONFIG_DIR when that's set. */
export function claudeProjectsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR ? join(env.CLAUDE_CONFIG_DIR, 'projects') : join(env.HOME || homedir(), '.claude', 'projects');
}

/** Where Claude Code keeps a session's transcript: its folder, with every other character a dash. */
export const transcriptDir = (projectsDir: string, cwd: string): string => `${projectsDir}/${cwd.replace(/[^A-Za-z0-9]/g, '-')}`;

/** The folder in Claude Code's projects holding a session's transcript: under a likely folder first, then any. */
function savedDir(projectsDir: string, file: string, likely: (string | null | undefined)[]): { dir: string; folder: string | null } | null {
  for (const f of new Set(likely.filter((c): c is string => !!c))) {
    const dir = transcriptDir(projectsDir, f);
    if (existsSync(join(dir, file))) return { dir, folder: f };
  }
  let dirs: string[];
  try {
    dirs = readdirSync(projectsDir);
  } catch {
    return null;
  }
  const dir = dirs.find((d) => existsSync(join(projectsDir, d, file)));
  return dir ? { dir: `${projectsDir}/${dir}`, folder: null } : null;
}

/** A session's transcript file, or null when this machine has none. */
export function transcriptFile(projectsDir: string, sessionId: string, likely: (string | null | undefined)[]): string | null {
  const file = `${sessionId}.jsonl`;
  const found = savedDir(projectsDir, file, likely);
  return found ? join(found.dir, file) : null;
}

/**
 * The folder a conversation is saved under, which is the only window Claude Code for VSCode opens it in
 * (D-041), and the folder it resumes in (D-060). `claude agents` can report where a background session
 * started, the main checkout, though it saved its conversation under the worktree it moved into; and the
 * window asking may belong to another repo altogether (D-046). So the file itself is found: first under
 * the likely folders, then anywhere in Claude Code's projects. The folder is the cwd the conversation
 * recorded whose name matches its own.
 */
export function savedFolder(projectsDir: string, sessionId: string, likely: (string | null | undefined)[]): string | null {
  const file = `${sessionId}.jsonl`;
  const found = savedDir(projectsDir, file, likely);
  if (!found) return null;
  if (found.folder) return found.folder;
  let text: string;
  try {
    text = readFileSync(join(found.dir, file), 'utf8');
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
    if (typeof cwd === 'string' && transcriptDir(projectsDir, cwd) === found.dir) return cwd;
  }
  return null;
}

/** How much of a transcript's end is read for the last thing its agent said: they run to megabytes. */
const TAIL_BYTES = 256 * 1024;

/** The agent's own turns at the end of a transcript, newest first: only its last 256 KB is read. */
function* assistantTurns(file: string): Generator<Record<string, any>> {
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch {
    return;
  }
  let text: string;
  try {
    const size = statSync(file).size;
    const from = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - from);
    readSync(fd, buf, 0, buf.length, from);
    text = buf.toString('utf8');
    // The first line read may be cut in two.
    if (from > 0) text = text.slice(text.indexOf('\n') + 1);
  } catch {
    return;
  } finally {
    closeSync(fd);
  }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (!line.includes('"assistant"')) continue;
    let r: Record<string, any>;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    // A helper agent's turns aren't its own.
    if (r?.type === 'assistant' && !r.isSidechain) yield r;
  }
}

/**
 * The newest text the agent wrote in a transcript, or null. Claude Code's own messages count, such as
 * "API Error: Your computer went to sleep mid-response." (a synthetic record, `isApiErrorMessage`).
 * Only the file's last 256 KB is read; a helper agent's turns are skipped.
 */
export function lastSaidIn(file: string): string | null {
  for (const r of assistantTurns(file)) {
    if (!Array.isArray(r.message?.content)) continue;
    const said = (r.message.content as { type?: string; text?: unknown }[])
      .filter((b) => b?.type === 'text' && typeof b.text === 'string' && b.text.trim())
      .map((b) => (b.text as string).trim());
    if (said.length) return said[said.length - 1]!;
  }
  return null;
}

/**
 * The model the agent's latest answer came from (D-086), or null when the end of its transcript has none.
 * Claude Code's own messages, such as an API error, name no real model (`<synthetic>`), so they're skipped.
 */
export function lastModelIn(file: string): string | null {
  for (const r of assistantTurns(file)) {
    const model = r.message?.model;
    if (typeof model === 'string' && model && model !== '<synthetic>') return model;
  }
  return null;
}

/** The last thing a session's agent said, found by its transcript, or null when there's none to read. */
export function lastSaid(projectsDir: string, sessionId: string, likely: (string | null | undefined)[]): string | null {
  const file = transcriptFile(projectsDir, sessionId, likely);
  return file ? lastSaidIn(file) : null;
}
