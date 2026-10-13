/**
 * The wording check (T-12): the structural rules of ASD-STE100 Simplified Technical English, ported from
 * the copied skill's `scripts/ste-lint.py` (plugin/skills/ste100/SOURCE.md names the commit). It checks
 * only the rules that need no dictionary: semicolons, sentence length, phrasal verbs, nominalization,
 * marketing adjectives, synonym rotation, a list item that ends on "and" or "or", passive voice and
 * compound tenses. The last two are advisory; the rest are hard. Like the Python, it never flags a hedge
 * (may, might, could): confidence is content, and a "may have failed" is no present perfect.
 *
 * The Python linter stays beside the tests as an oracle (packages/core/test/fixtures/ste100/), and
 * packages/core/test/ste.test.ts runs both on the same texts. Python's `\b` and `\w` are Unicode-aware and
 * count columns in code points, so this port builds its patterns to match and counts columns the same way.
 */

export type SteLevel = 'hard' | 'advisory';

export type SteRule =
  | 'semicolon' | 'phrasal-verb' | 'marketing-adjective' | 'nominalization' | 'passive-voice' | 'present-perfect'
  | 'long-sentence' | 'synonym-rotation' | 'dangling-conjunction';

export interface SteFinding {
  file: string;
  /** 1-based, as the Python counts lines. */
  line: number;
  /** 1-based, in code points. */
  col: number;
  rule: SteRule;
  level: SteLevel;
  match: string;
  message: string;
}

/** A word character as Python's Unicode `\w` reads one. */
const W = '[\\p{L}\\p{N}_]';
/** Python's `\b`: between a word character and anything else. */
const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;

/** A pattern written as the Python wrote it, with `\b` and `\w` read the Unicode way. */
function py(source: string, flags = ''): RegExp {
  return new RegExp(source.replace(/\\b/g, B).replace(/\\w/g, W), `u${flags}`);
}

/** A string's length in code points, as Python's len() counts it. */
const cpLen = (s: string): number => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

/** Python's str.split() with no arguments: runs of whitespace, none at either end. */
const words = (s: string): string[] => s.split(/\s+/u).filter(Boolean);

/** Python's str.splitlines(): every line break it knows, and no empty line after a final break. */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/u);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// Irregular past participles used by the present-perfect heuristic.
const IRREGULAR_PARTICIPLES = 'given|taken|made|done|found|seen|known|shown|written|built|sent|set|run|read|kept|held|left|put|cut|hit|let|shut|split|spread|begun|become|come|gone|got|gotten|lost|met|paid|said|sold|told|thought|brought|bought|caught|taught|won|worn|torn|born|drawn|grown|thrown|flown|driven|risen|chosen|broken|spoken|frozen|hidden|ridden|forgotten|fallen|eaten|beaten|understood|stood|struck|stuck|swung|hung|led|fed|bled|fled|sped|bound|wound|dug|spun|slid|bit|lit|quit';
// The passive heuristic's shorter list: perfects also take intransitive verbs.
const PASSIVE_PARTICIPLES = 'given|taken|made|done|found|seen|known|shown|written|built|sent|set|run|read|kept|held|left|put';
/** A modal just before a match: "may have failed" is a hedge, not a present perfect. */
const MODAL_PERFECT_PREFIX = py("\\b(?:may|might|could|should|would|must|can|will|shall)(?:\\s+not|n['’]t)?\\s+$", 'i');

interface Rule { id: SteRule; level: SteLevel; pattern: RegExp; message: string }

/** The pattern rules, in the Python's order. */
export const STE_RULES: readonly Rule[] = [
  { id: 'semicolon', level: 'hard', pattern: py(';', 'g'), message: 'STE bans the semicolon (Rule 8.1). Split into separate sentences.' },
  {
    id: 'phrasal-verb', level: 'hard',
    pattern: py('\\b(spin(?:ning|s)? up|spun up|reach(?:ing|es|ed)? out|div(?:e|es|ing|ed) into|dove into|kick(?:ing|s|ed)? off|circl(?:e|es|ing|ed) back|touch(?:ing|es|ed)? base)\\b', 'gi'),
    message: 'Soft phrasal verb. Use the single plain verb (start, contact, read, begin).',
  },
  {
    id: 'marketing-adjective', level: 'hard',
    pattern: py('\\b(seamless(?:ly)?|robust(?:ly)?|cutting-edge|effortless(?:ly)?|blazing[- ]fast|world-class|state-of-the-art|game-chang(?:ing|er))\\b', 'gi'),
    message: 'Marketing adjective. Delete, or replace with the measurement that earns the claim.',
  },
  {
    id: 'nominalization', level: 'hard',
    pattern: py('\\b(perform|performs|performed|conduct|conducts|conducted|carry out|carries out|carried out)\\s+(?:a|an|the)\\s+\\w+(?:tion|sion|ment|ance|ence|ysis)\\b', 'gi'),
    message: 'Action frozen into a noun. Use the verb (analyze, not perform an analysis of).',
  },
  {
    id: 'passive-voice', level: 'advisory',
    pattern: py(`\\b(is|are|was|were|been|being)\\s+(\\w+ed|${PASSIVE_PARTICIPLES})\\b(?!\\s+(?:to|for|by)\\s+\\w+ing)`, 'gi'),
    message: 'Possible passive voice. Name the actor and use an active verb, unless the actor is unknown or irrelevant.',
  },
  {
    id: 'present-perfect', level: 'advisory',
    // A modal and a perfect infinitive ("may have failed") is a hedge, which this never flags.
    pattern: py(`(?<!\\bmay )(?<!\\bmight )(?<!\\bcould )(?<!\\bshould )(?<!\\bwould )(?<!\\bmust )\\b(has|have|had)\\s+(?:been\\s+)?(?:\\w+(?:ed|en)|${IRREGULAR_PARTICIPLES})\\b`, 'gi'),
    message: 'Compound tense. Use simple past/present unless current relevance is the point (then keep and flag).',
  },
];

/**
 * One word, one meaning: verbs commonly rotated for the same action. Only groups whose members are truly
 * interchangeable: error, fault and failure are distinct things and stay out.
 */
export const SYNONYM_GROUPS: readonly (readonly string[])[] = [
  ['check', 'verify', 'confirm', 'validate'],
  ['delete', 'remove', 'erase'],
  ['start', 'launch', 'begin', 'initiate'],
  ['stop', 'halt', 'terminate'],
  ['show', 'display'],
  ['use', 'utilize', 'employ'],
  ['fix', 'repair', 'correct'],
  ['send', 'transmit'],
  ['get', 'retrieve', 'fetch', 'obtain'],
  ['change', 'modify', 'alter'],
];

/** The cap for a description. An instruction's is 20, which needs context this check doesn't have. */
export const STE_MAX_WORDS = 25;

const CODE_FENCE = /^(```|~~~)/u;
const INLINE_CODE = /`[^`]*`/gu;
const LIST_ITEM_START = /^( {0,3})([-*+]|[0-9]+[.)])( +)(.*)$/u;
const CONJUNCTION_END = py('\\b(?:and|or)\\s*$', 'i');
const TABLE_SEPARATOR_CELL = /^:?-{3,}:?$/u;
const SENTENCE_BREAK = /(?<=[.!?])\s+/u;

const wordRes = new Map<string, RegExp>();
const wordRe = (base: string): RegExp => {
  let re = wordRes.get(base);
  if (!re) wordRes.set(base, (re = py(`\\b${base}(?:s|es|ed|d|ing)?\\b`, 'i')));
  return re;
};

const leadingSpaces = (line: string): number => line.length - line.replace(/^ +/, '').length;

function isListContinuation(line: string, contentIndent: number): boolean {
  if (!line.trim()) return true;
  if (LIST_ITEM_START.test(line)) return false;
  return leadingSpaces(line) >= contentIndent;
}

/**
 * A table row's trimmed cells, each with its 0-based column in code points, or null when the line isn't
 * one. A pipe must separate at least two cells; an escaped pipe stays in its cell.
 */
function splitTableRow(line: string): [string, number][] | null {
  const lead = line.length - line.trimStart().length;
  const right = line.trimEnd().length;
  let content = right > lead ? line.slice(lead, right) : '';
  if (!content.includes('|')) return null;
  let left = cpLen(line.slice(0, lead));
  if (content.startsWith('|')) {
    content = content.slice(1);
    left += 1;
  }
  if (content.endsWith('|')) content = content.slice(0, -1);
  const raw = content.split(/(?<!\\)\|/u);
  if (raw.length < 2) return null;
  const cells: [string, number][] = [];
  let column = left;
  for (const cell of raw) {
    const leading = cell.length - cell.trimStart().length;
    cells.push([cell.trim(), column + cpLen(cell.slice(0, leading))]);
    column += cpLen(cell) + 1;
  }
  return cells;
}

/**
 * Ordinary Markdown table rows, by line index, mapped to their cells. The separator row anchors a table,
 * so prose with a pipe in it is no table. A row with another number of cells ends the table.
 */
function tableCells(lines: string[]): Map<number, [string, number][]> {
  const cells = new Map<number, [string, number][]>();
  let index = 1;
  while (index < lines.length) {
    const separator = splitTableRow(lines[index]!);
    const header = splitTableRow(lines[index - 1]!);
    if (!separator || !header || separator.length !== header.length || !separator.every(([c]) => TABLE_SEPARATOR_CELL.test(c))) {
      index++;
      continue;
    }
    cells.set(index - 1, header);
    cells.set(index, []);
    index++;
    while (index < lines.length) {
      const row = splitTableRow(lines[index]!);
      if (!row || row.length !== separator.length) break;
      cells.set(index, row);
      index++;
    }
  }
  return cells;
}

/** List items whose last meaningful line ends on "and" or "or". Code fences and inline code don't count. */
function danglingConjunctions(text: string, file: string): SteFinding[] {
  const lines = splitLines(text);
  const found: SteFinding[] = [];
  let inFence = false;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (CODE_FENCE.test(line.trim())) {
      inFence = !inFence;
      index++;
      continue;
    }
    if (inFence) {
      index++;
      continue;
    }
    const start = LIST_ITEM_START.exec(line);
    if (!start) {
      index++;
      continue;
    }
    const [, indent, marker, gap, body] = start as unknown as [string, string, string, string, string];
    const contentIndent = indent.length + marker.length + gap.length;
    const item: [number, string][] = [[index, body]];
    let next = index + 1;
    let itemFence = false;
    while (next < lines.length) {
      const candidate = lines[next]!;
      // A fence's delimiters only change state: they aren't lines of the item.
      if (CODE_FENCE.test(candidate.trim())) {
        itemFence = !itemFence;
        next++;
        continue;
      }
      if (itemFence) {
        next++;
        continue;
      }
      if (!isListContinuation(candidate, contentIndent)) break;
      item.push([next, candidate]);
      next++;
    }
    // Inline code stays as a neutral word, so "Combine `left` and `right`" doesn't end on "and".
    const meaningful = item.map(([i, l]) => [i, l.replace(INLINE_CODE, ' CODE ').trim()] as [number, string]).filter(([, l]) => l);
    const last = meaningful[meaningful.length - 1];
    if (last && CONJUNCTION_END.test(last[1])) {
      const [endIndex, endLine] = last;
      let line1: number;
      let col: number;
      if (endIndex === index) {
        line1 = index + 1;
        col = indent.length + 1;
      } else {
        const raw = item.find(([i]) => i === endIndex)![1];
        const masked = raw.replace(INLINE_CODE, (m) => ' '.repeat(cpLen(m)));
        const at = CONJUNCTION_END.exec(masked);
        line1 = endIndex + 1;
        col = at ? cpLen(masked.slice(0, at.index)) + 1 : 1;
      }
      found.push({
        file, line: line1, col, rule: 'dangling-conjunction', level: 'hard', match: endLine,
        message: 'List item ends with a coordinating conjunction. Complete the item or join it with the next item.',
      });
    }
    index = next;
  }
  return found;
}

/** Python's tuple order for a synonym's first place: line, column, then the words. */
const placeOrder = (a: [number, number, string, string], b: [number, number, string, string]): number =>
  a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : a[3] < b[3] ? -1 : a[3] > b[3] ? 1 : 0);

/** Every finding in a text, by line and column, and how many words it holds. */
export function steLint(text: string, file = '<stdin>'): { findings: SteFinding[]; words: number } {
  const findings: SteFinding[] = [];
  let total = 0;
  let inFence = false;
  const lines = splitLines(text);
  const table = tableCells(lines);
  // Where each synonym group's member first shows: "group:base" to [line, col, match].
  const seen = new Map<string, [number, number, string]>();
  lines.forEach((raw, i) => {
    const lineNo = i + 1;
    if (CODE_FENCE.test(raw.trim())) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    for (const [segment, column] of table.get(i) ?? [[raw, 0] as [string, number]]) {
      const line = segment.replace(INLINE_CODE, '');
      total += words(line).length;
      const col = (at: number) => column + cpLen(line.slice(0, at)) + 1;
      for (const r of STE_RULES) {
        for (const m of line.matchAll(r.pattern)) {
          if (r.id === 'present-perfect' && MODAL_PERFECT_PREFIX.test(line.slice(0, m.index))) continue;
          findings.push({ file, line: lineNo, col: col(m.index!), rule: r.id, level: r.level, match: m[0], message: r.message });
        }
      }
      SYNONYM_GROUPS.forEach((group, g) => {
        for (const base of group) {
          if (seen.has(`${g}:${base}`)) continue;
          const m = wordRe(base).exec(line);
          if (m) seen.set(`${g}:${base}`, [lineNo, col(m.index), m[0]]);
        }
      });
      for (const sentence of line.split(SENTENCE_BREAK)) {
        const n = words(sentence).length;
        if (n > STE_MAX_WORDS) {
          findings.push({ file, line: lineNo, col: column + 1, rule: 'long-sentence', level: 'hard', match: `${n} words`, message: `Sentence has ${n} words (cap ${STE_MAX_WORDS}). Split it.` });
        }
      }
    }
  });
  // Synonym rotation: each member after the first, at its first place, naming the first as the keeper.
  SYNONYM_GROUPS.forEach((group, g) => {
    const present = group.filter((b) => seen.has(`${g}:${b}`)).map((b) => [...seen.get(`${g}:${b}`)!, b] as [number, number, string, string]).sort(placeOrder);
    if (present.length < 2) return;
    const keeper = present[0]![3];
    for (const [line, col, match, base] of present.slice(1)) {
      findings.push({ file, line, col, rule: 'synonym-rotation', level: 'hard', match, message: `'${base}' and '${keeper}' name the same action. Pick one and use it every time.` });
    }
  });
  findings.push(...danglingConjunctions(text, file));
  // Array sort is stable, as Python's is, so findings at one place keep the order they were found in.
  findings.sort((a, b) => a.line - b.line || a.col - b.col);
  return { findings, words: total };
}

/** A finding as the Python prints it: file:line:col rule: message [match]. */
export const steLine = (f: SteFinding): string => `${f.file}:${f.line}:${f.col} ${f.rule}: ${f.message} [${f.match}]`;

// ---------------------------------------------------------------- the analysis's requirements

/** The parts of an analysis's requirements that are written in STE, in the order the page shows them. */
export const REQUIREMENT_PARTS = ['goal', 'criteria', 'assumptions', 'outOfScope'] as const;
export type RequirementPart = (typeof REQUIREMENT_PARTS)[number];

/** A hard wording finding on one requirement line: which line it came from, and what the check said. */
export interface WordingFinding {
  part: RequirementPart;
  /** Its place in that part's list, from 0. The goal is 0. */
  index: number;
  /** The requirement line as the analyst wrote it. */
  text: string;
  rule: SteRule;
  match: string;
  message: string;
}

/**
 * The hard findings on each requirement line (T-12). Each line is checked on its own, so a synonym in one
 * criterion never counts against another. Advisory findings are left out: they're often right to keep.
 */
export function requirementWording(r: { goal: string; criteria: string[]; assumptions: string[]; outOfScope: string[] }): WordingFinding[] {
  const lines: [RequirementPart, number, string][] = [
    ...(r.goal.trim() ? [['goal', 0, r.goal] as [RequirementPart, number, string]] : []),
    ...(['criteria', 'assumptions', 'outOfScope'] as const).flatMap((part) => r[part].map((text, i) => [part, i, text] as [RequirementPart, number, string])),
  ];
  // A criterion, an assumption or an out-of-scope item is a list item, so one that ends on "and" is caught.
  return lines.flatMap(([part, index, text]) => steLint(part === 'goal' ? text : `- ${text}`).findings.filter((f) => f.level === 'hard')
    .map((f) => ({ part, index, text, rule: f.rule, match: f.match, message: f.message })));
}

/** "Wording: 2 findings", or nothing when there are none. */
export const wordingWords = (n: number): string | null => (n ? `Wording: ${n} finding${n === 1 ? '' : 's'}` : null);

/** What each part of the requirements is called where a person reads a finding. */
export const PART_WORDS: Record<RequirementPart, string> = { goal: 'Goal', criteria: 'Criterion', assumptions: 'Assumption', outOfScope: 'Out of scope' };

/** Where a finding came from, as a person reads it: "Goal", or "Criterion 2", counted from 1. */
export const wordingPlace = (f: Pick<WordingFinding, 'part' | 'index'>): string => (f.part === 'goal' ? PART_WORDS.goal : `${PART_WORDS[f.part]} ${f.index + 1}`);
