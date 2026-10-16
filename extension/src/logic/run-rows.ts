/**
 * A run's output as rows, for the output panel (T-64): each line a success, a warning, an error, a count of
 * progress or a note, its URLs and file paths found. Like the rest of logic/, no `vscode` import, so it can be
 * tested with node:test.
 */

import { posix } from 'node:path';
import { CONTROL } from './runs.ts';

// ---------------------------------------------------------------- a run's output as rows (T-64)

export const ROW_KINDS = ['success', 'warning', 'error', 'progress', 'note'] as const;
export type RowKind = (typeof ROW_KINDS)[number];

/**
 * A piece of a row: words, a URL, or a file path. A path in the run's folder opens: `opens` is it relative to
 * that folder. One outside it, or with no folder to read it against, is null.
 */
export type RowPart = { text: string } | { url: string } | { path: string; line: number | null; opens: string | null };

export interface RunRow {
  kind: RowKind;
  /** The line in words: its colour codes and spinner gone, and the tick, cross or "npm ERR!" it starts with, which the row's mark says. */
  text: string;
  parts: RowPart[];
  /** How many times in a row the line came: more than 1 for a spinner's line, or one printed again. */
  count: number;
  /** A count of progress: how far along, from 0 to 1, and as written ("3/10", "45%"). Null for other rows. */
  progress: { done: number; label: string } | null;
}

/** The most rows the panel shows; the rest are counted in one line. */
export const MAX_ROWS = 200;

/** A spinner's frame at the start of a line: a braille dot or a quarter circle. */
const SPINNER = /^[⠀-⣿◐-◓◴-◷]\s*/;
/** A tick, a cross or a warning sign a line starts with. */
const MARK = /^(?:✓|✔|√|☑|✅|✗|✖|×|⨯|❌|⚠️?)\s*/;
/** A warning's or an error's word for itself at the start of its line: "npm ERR!", "npm WARN", "Error:", "warning:". */
const LEVEL = /^(?:npm\s+(?:err!|warn|error|notice)|err!|(?:error|warning|warn|fatal)(?![\w-]))!?:?\s+/i;
/** A count of nothing gone wrong, which isn't a failure: "0 errors", "no warnings". */
const NONE_WRONG = /\b(?:0|no|zero|without)\s+(?:errors?|failures?|failed|failing|warnings?)\b/gi;
const ERROR = /^(?:✗|✖|×|⨯|❌)|\b(?:error|errors|err!|fatal|failed|failure|failing|exception|panic|cannot|can't|couldn't|unable to|denied|refused)(?=$|[\s:.,;!)])/i;
const WARNING = /^(?:⚠|!\s)|\b(?:warn|warning|warnings|deprecated|deprecation)\b/i;
const SUCCESS = /^(?:✓|✔|√|☑|✅)|\b(?:done|passed|succeeded|success|successful|successfully|deployed|ok|complete|completed|finished)\b/i;
const FRACTION = /(?:^|[\s([])(\d{1,7})\s?\/\s?(\d{1,7})(?=$|[\s)\],:;.])/;
const PERCENT = /(?:^|[\s([])(\d{1,3}(?:\.\d+)?)\s?%(?=$|[\s)\],:;.])/;
const URL = /\bhttps?:\/\/[^\s<>"'`]+/g;
/** A path: folders and a file with an extension that starts with a letter, so "@3.6.0" and "1/2.5" aren't one; then its line. */
const PATH = /(?<=^|[\s("'`=])((?:~|\.{1,2})?\/?(?:[\w.@+-]+\/)+[\w.@+-]*[\w-]\.[A-Za-z][A-Za-z0-9]{0,9})(?::(\d+)(?::\d+)?)?(?=$|[\s)"'`,;]|[.:](?:\s|$))/g;

/** How far along a line says it is, or null when it counts nothing. */
function progressOf(text: string): RunRow['progress'] {
  const f = FRACTION.exec(text);
  if (f) {
    const done = Number(f[1]);
    const of = Number(f[2]);
    if (of > 0 && done <= of) return { done: done / of, label: `${done}/${of}` };
  }
  const p = PERCENT.exec(text);
  if (p && Number(p[1]) <= 100) return { done: Number(p[1]) / 100, label: `${p[1]}%` };
  return null;
}

/** What kind of row a line is. A count that has reached its end and says it worked is a success. */
function kindOf(text: string, progress: RunRow['progress']): RowKind {
  const said = text.replace(NONE_WRONG, '');
  if (ERROR.test(said)) return 'error';
  if (WARNING.test(said)) return 'warning';
  if (progress && !(progress.done === 1 && SUCCESS.test(said))) return 'progress';
  return SUCCESS.test(said) ? 'success' : 'note';
}

/**
 * A path, relative to the run's folder when it's in it: a relative one that doesn't climb out, or an
 * absolute one under the folder. Null for one in a home folder, outside, or with no folder.
 */
export function inFolder(path: string, root: string | null): string | null {
  if (!root || path.startsWith('~')) return null;
  const base = root.replace(/\/+$/, '');
  const rel = path.startsWith('/') ? (path.startsWith(`${base}/`) ? path.slice(base.length + 1) : null) : path;
  if (rel === null) return null;
  const clean = posix.normalize(rel);
  return clean === '..' || clean.startsWith('../') || clean.startsWith('/') ? null : clean;
}

/** A line's words, URLs and paths, in order. A URL's closing full stop or bracket is the sentence's, not the URL's. */
export function partsOf(text: string, root: string | null): RowPart[] {
  const out: RowPart[] = [];
  const words = (s: string) => { if (s) out.push({ text: s }); };
  const paths = (s: string) => {
    let at = 0;
    for (const m of s.matchAll(PATH)) {
      words(s.slice(at, m.index));
      out.push({ path: m[1]!, line: m[2] ? Number(m[2]) : null, opens: inFolder(m[1]!, root) });
      at = m.index! + m[0].length;
    }
    words(s.slice(at));
  };
  let at = 0;
  for (const m of text.matchAll(URL)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, '');
    paths(text.slice(at, m.index));
    out.push({ url });
    at = m.index! + url.length;
  }
  paths(text.slice(at));
  return out;
}

/** A line as the panel compares it with the one before: a count of progress by its words alone, so 3/10 then 4/10 is one row. */
const sameAs = (r: RunRow): string => (r.kind === 'progress' ? `p:${r.text.replace(/\d+(?:\.\d+)?/g, '#')}` : `${r.kind}:${r.text}`);

/**
 * A run's output as rows: colour codes and blank lines go, a spinner's frame goes, a line that repeats is
 * one row with a count, and a count of progress that moves on is one row at its latest. root is the folder
 * the run ran in, which a path must be in to open. Only the last `max` rows are kept; `hidden` counts the rest.
 */
export function runRows(lines: readonly string[], root: string | null, max = MAX_ROWS): { rows: RunRow[]; hidden: number } {
  const rows: RunRow[] = [];
  for (const raw of lines) {
    const line = raw.replace(CONTROL, '').replace(/[\r\t]/g, ' ').replace(SPINNER, '').trim();
    // A tick or a cross the line starts with says its kind, and the row's icon then says it instead; so does
    // a warning's or an error's own word for it ("npm ERR!", "Warning:"), which the row's label says.
    const marked = line.replace(MARK, '');
    const progress = progressOf(marked);
    const kind = kindOf(line, progress);
    const text = kind === 'warning' || kind === 'error' ? marked.replace(LEVEL, '') || marked : marked;
    if (!text) continue;
    const row: RunRow = { kind, text, parts: partsOf(text, root), count: 1, progress };
    const last = rows.at(-1);
    if (last && sameAs(last) === sameAs(row)) {
      if (row.kind === 'progress') rows[rows.length - 1] = row;
      else last.count++;
      continue;
    }
    rows.push(row);
  }
  const hidden = Math.max(0, rows.length - max);
  return { rows: hidden ? rows.slice(hidden) : rows, hidden };
}

/** An exit code in words, for a run that failed: what the common ones mean, the number after. */
export function exitWords(code: number | null): string {
  if (code === null) return 'It ended without an exit code, so something stopped it from outside.';
  const said: Record<number, string> = {
    1: 'It reported an error',
    2: 'It was given something it couldn\'t use',
    126: 'It couldn\'t be started',
    127: 'Its command wasn\'t found',
    130: 'It was interrupted',
    137: 'It was killed, which often means it ran out of memory',
    143: 'It was told to stop',
  };
  return `${said[code] ?? 'It ended with an error'} (exit code ${code}).`;
}
