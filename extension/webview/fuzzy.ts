// The command palette's search (T-52): a fuzzy match of what's typed against each item's words, and the
// results it shows, in groups. Pure: no page state, so node:test loads it (palette.test.ts).

import type { PaletteItem, PaletteKind } from '../src/model/palette.ts';

/** A match: how good it is, and where in the words each typed character fell. */
export interface Match { score: number; at: number[] }

/** What a matched character adds: itself, more at the start of a word, more again right after the last one. */
export const SCORE = { char: 1, wordStart: 6, run: 8 } as const;

/** The start of a word: the first character, one after a space or a sign, or a capital after a small letter. */
const startsWord = (text: string, i: number): boolean => {
  if (i === 0) return true;
  const prev = text[i - 1]!;
  const cur = text[i]!;
  if (!/[\p{L}\p{N}]/u.test(prev)) return true;
  return /\p{Ll}/u.test(prev) && /\p{Lu}/u.test(cur);
};

/**
 * Each character of the query, in order, anywhere in the text, whatever the case; spaces in the query are
 * left out. Of every way the characters can fall, the best: a character at the start of a word scores above
 * one inside a word, and a run of them above the same characters scattered. Nearer the front, and a shorter
 * text, win a tie. Null when the query doesn't match, or is empty.
 */
export function fuzzyMatch(query: string, text: string): Match | null {
  const q = [...query.toLowerCase().replace(/\s+/g, '')];
  const t = text.toLowerCase();
  const n = t.length;
  if (!q.length || q.length > n) return null;
  const none = -Infinity;
  // best[i][j]: the best score with the query's i-th character at the text's j-th; from[i][j], where the one before it fell.
  const best: number[][] = [];
  const from: number[][] = [];
  for (let i = 0; i < q.length; i++) {
    const row = new Array<number>(n).fill(none);
    const back = new Array<number>(n).fill(-1);
    // The best of the row before, up to two places back, as j moves on: a gap of one or more.
    let gapBest = none;
    let gapAt = -1;
    for (let j = i; j < n; j++) {
      if (i > 0 && j >= 2 && best[i - 1]![j - 2]! > gapBest) { gapBest = best[i - 1]![j - 2]!; gapAt = j - 2; }
      if (t[j] !== q[i]) continue;
      const own = SCORE.char + (startsWord(text, j) ? SCORE.wordStart : 0);
      if (i === 0) { row[j] = own; continue; }
      const after = best[i - 1]![j - 1]!;
      const run = after === none ? none : after + own + SCORE.run;
      const gap = gapBest === none ? none : gapBest + own;
      if (run === none && gap === none) continue;
      if (run >= gap) { row[j] = run; back[j] = j - 1; } else { row[j] = gap; back[j] = gapAt; }
    }
    best.push(row);
    from.push(back);
  }
  const last = best[q.length - 1]!;
  let end = -1;
  for (let j = 0; j < n; j++) if (last[j]! > none && (end < 0 || last[j]! > last[end]!)) end = j;
  if (end < 0) return null;
  const at: number[] = [];
  for (let i = q.length - 1, j = end; i >= 0; j = from[i]![j]!, i--) at.unshift(j);
  return { score: last[end]! - at[0]! / 100 - n / 10_000, at };
}

/** Each kind's word beside a result, and its group's heading, in the order a tie between groups goes. */
export const PALETTE_KINDS: Record<PaletteKind, { word: string; heading: string }> = {
  section: { word: 'Section', heading: 'Sections' },
  setting: { word: 'Part', heading: 'Settings' },
  task: { word: 'Task', heading: 'Tasks' },
  agent: { word: 'Agent', heading: 'Agents' },
  action: { word: 'Action', heading: 'Actions' },
};
const KIND_ORDER = Object.keys(PALETTE_KINDS) as PaletteKind[];

/** The most results that show; a line under them counts the rest. */
export const SHOWN = 12;
/** How many items run last show when nothing is typed. */
export const RECENTS = 8;

/** A result: its item, and where its words matched, to draw those characters in bold. */
export interface Shown { item: PaletteItem; at: number[] }
export interface ResultGroup { key: string; heading: string; items: Shown[] }
export interface Results { groups: ResultGroup[]; /** Every item that matched. */ total: number; /** How many matched and don't show. */ more: number }

/**
 * What the palette shows for a query. Typed, the best SHOWN matches, in groups by kind, the group with the
 * best match first and the best first in each. Empty, the last RECENTS items run that are still on the page,
 * newest first, then the sections not among them.
 */
export function paletteResults(items: PaletteItem[], query: string, recent: readonly string[] = []): Results {
  if (!query.trim()) {
    const byId = new Map(items.map((i) => [i.id, i]));
    const ran = recent.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])).slice(0, RECENTS);
    const sections = items.filter((i) => i.kind === 'section' && !ran.includes(i));
    const groups = [
      ...(ran.length ? [{ key: 'recent', heading: 'Recent', items: ran.map((item) => ({ item, at: [] })) }] : []),
      ...(sections.length ? [{ key: 'section', heading: PALETTE_KINDS.section.heading, items: sections.map((item) => ({ item, at: [] })) }] : []),
    ];
    const total = ran.length + sections.length;
    return { groups, total, more: 0 };
  }
  const found = items.flatMap((item, i) => {
    const m = fuzzyMatch(query, item.words);
    return m ? [{ item, at: m.at, score: m.score, i }] : [];
  });
  const rank = (a: (typeof found)[number], b: (typeof found)[number]) => b.score - a.score || KIND_ORDER.indexOf(a.item.kind) - KIND_ORDER.indexOf(b.item.kind) || a.i - b.i;
  const top = [...found].sort(rank).slice(0, SHOWN);
  const groups: ResultGroup[] = [];
  for (const f of top) {
    let g = groups.find((x) => x.key === f.item.kind);
    if (!g) groups.push(g = { key: f.item.kind, heading: PALETTE_KINDS[f.item.kind].heading, items: [] });
    g.items.push({ item: f.item, at: f.at });
  }
  return { groups, total: found.length, more: found.length - top.length };
}

/**
 * Splits a text into its plain and matched parts, for drawing the matched ones in bold: `from` is where the
 * text starts in the item's words, and the parts after it are as long as the text.
 */
export function boldParts(text: string, at: readonly number[], from = 0): { text: string; bold: boolean }[] {
  const on = new Set(at.map((x) => x - from).filter((x) => x >= 0 && x < text.length));
  const out: { text: string; bold: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const bold = on.has(i);
    const last = out.at(-1);
    if (last && last.bold === bold) last.text += text[i];
    else out.push({ text: text[i]!, bold });
  }
  return out;
}

/** Where an item's hint starts in its words, when its words go on with it after the title (a task's key, Settings), else null. */
export const hintAt = (item: Pick<PaletteItem, 'title' | 'hint' | 'words'>): number | null =>
  item.hint && item.words.startsWith(`${item.title} ${item.hint}`) ? item.title.length + 1 : null;
