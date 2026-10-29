/**
 * An agent's note to a person (T-146, D-T-146): a short headline, then one bullet per thing, a question's
 * options as a, b, c with the one it recommends marked, and API names in backticks. acc block refuses a note
 * that is one long paragraph (shapeProblems), wraps the API names it can recognise as it records one
 * (codeNames), and the Command Center draws any note, old or new, as a headline and its bullets where its
 * shape allows (noteShape). Nothing recorded is rewritten: an old note is shaped only as it's drawn.
 *
 * Pure: the CLI, the ledger, the extension's models and node:test all call it.
 */

import { NOTE_LIMITS } from './ledger.ts';

/** The longest a note's headline may be, with everything else in bullets under it: past this, acc block refuses it. */
export const NOTE_HEADLINE_MAX = 200;

/** The most options a question in a note offers (D-205): a person picks from at most three. */
export const NOTE_OPTIONS_MAX = 3;

/** One option of a thing in a note: its letter, its words, and whether the agent recommends it. */
export interface NoteOption { label: string; text: string; recommended: boolean }

/** One thing in a note: a problem or a question, with its options where it offers some. */
export interface NoteItem { text: string; options: NoteOption[] }

/** A note as a headline and its bullets. */
export interface NoteShape { headline: string; items: NoteItem[] }

/** How a builder writes a note with more than one thing in it, word for word wherever it's told. */
export const BLOCK_SHAPE = 'acc block "<headline: one short sentence>" --item "<first thing>" --item "<next thing>"';

/** What acc block says, and the packet tells, about a note's shape. */
export const NOTE_SHAPE_WORDS = `Write a short headline, one sentence, then a bullet for each thing: ${BLOCK_SHAPE}. Give a question's options in its item as a) … b) … c) …, at most three, and mark the one you recommend with (recommended).`;

/** A note given as a headline and its items, as markdown: the headline, then a "- " line for each. */
export function composeNote(headline: string, items: readonly string[] = []): string {
  const one = (s: string) => s.replace(/\s+/g, ' ').trim();
  return [one(headline), ...items.map(one).filter(Boolean).map((i) => `- ${i}`)].filter(Boolean).join('\n');
}

// ---------------------------------------------------------------- API names as code

/** File extensions a bare name is a file by: code, config and Salesforce metadata. */
const EXTENSIONS = 'ts|tsx|js|mjs|cjs|jsx|json|jsonc|md|mdx|xml|cls|trigger|page|component|cmp|html|css|scss|yml|yaml|toml|sh|ps1|py|txt|csv|sql|soql|apex|object|flexipage|permissionset|permissionsetgroup|profile|layout|field|report|reportType|dashboard|flow|app|tab|labels|lock';

/** Branch prefixes a name with one slash is a branch by. */
const BRANCH = /^(?:task|feature|feat|fix|bugfix|hotfix|release|chore|origin|upstream)\/[\w./-]+$/;

/** Whether a word, with its punctuation off, names something an agent should put in backticks. */
export function isApiName(w: string): boolean {
  if (!w || /:\/\//.test(w) || /^www\./i.test(w) || w.includes('@') || w.includes('`')) return false;
  // A custom field, object or metadata type: Region__c, Account.Region__c, Rollout_Setting__mdt.
  if (/^[A-Za-z][\w.]*__[A-Za-z]\w*$/.test(w)) return true;
  // A developer name with underscores: Sales_Ops_Access, ACC_ROLE. An emphasis such as _this_ starts with one.
  if (/^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)+(?:\.[A-Za-z]\w*)*$/.test(w)) return true;
  // A field on an object by its API name: Account.Name, Opportunity.StageName.
  if (/^[A-Z][A-Za-z0-9]*\.[A-Z][A-Za-z0-9]+$/.test(w)) return true;
  // A path or a branch, which holds a letter: force-app/main/default, ./run.sh, task/T-9-x. Not and/or, nor a date.
  if (/^(?:~|\.{1,2})?\/?[\w.+-]+(?:\/[\w.+-]*)+$/.test(w) && /[A-Za-z]/.test(w)) {
    const slashes = (w.match(/\//g) ?? []).length;
    if (slashes >= 2 || /^(?:~|\.{1,2})\//.test(w) || BRANCH.test(w) || new RegExp(`\\.(?:${EXTENSIONS})$`).test(w)) return true;
  }
  // A file by name: package.json, Region__c.field-meta.xml, Plan_Page.flexipage-meta.xml. Not Node.js.
  if (new RegExp(`^[\\w.-]*\\w\\.(?:${EXTENSIONS})(?:-meta\\.xml)?$`).test(w) && !/^[A-Z][a-z]+\.js$/.test(w)) return true;
  return false;
}

/** A command line acc can tell: git's, npm's, npx's and the Salesforce CLI's, up to its flags. */
const COMMAND = /(?<![\w`/-])(?:git (?:push|pull|fetch|merge|rebase|checkout|switch|status|log|diff|commit|add|reset|stash|cherry-pick|branch|worktree|revert)|npm (?:run [\w:.-]+|test|install|ci)|npx [\w@/.:-]+|sf (?:project|org|apex|data|package|sobject|config|alias|plugins|agent|flow)(?: [a-z][\w-]*){1,2})(?![\w`-])/g;

/** A code span, closed by as many backticks as opened it, as inline.ts and markdown read one. */
const CODE_SPAN = /(`+)(?!`)[\s\S]*?[^`]\1(?!`)/g;

/** A word's leading and trailing punctuation, which stays outside its backticks. */
const WORD = /^([("'\[“‘]*)([\s\S]*?)([)"'\]”’.,;:!?]*)$/;

/** Wraps each API name in a stretch of text with no code span in it. */
function wrapWords(s: string): string {
  return s.split(/(\s+)/).map((tok) => {
    if (!tok.trim()) return tok;
    const [, lead = '', core = '', tail = ''] = WORD.exec(tok) ?? [];
    return isApiName(core) ? `${lead}\`${core}\`${tail}` : tok;
  }).join('');
}

/** Wraps each command, then each API name, in a stretch of text with no code span in it. */
function wrapPlain(s: string): string {
  let out = '';
  let last = 0;
  for (const m of s.matchAll(COMMAND)) {
    out += wrapWords(s.slice(last, m.index)) + `\`${m[0]}\``;
    last = m.index + m[0].length;
  }
  return out + wrapWords(s.slice(last));
}

/**
 * The text with every API name acc can recognise in backticks: a custom field or object, a developer name with
 * underscores, a file path, a branch, a command. What's already in backticks, a link and an ordinary word stay
 * as they are. acc does this as it records an agent's note, and the Command Center as it draws an older one.
 */
export function codeNames(text: string): string;
export function codeNames(text: string | null): string | null;
export function codeNames(text: string | null): string | null {
  if (!text) return text;
  let out = '';
  let last = 0;
  for (const m of text.matchAll(CODE_SPAN)) {
    out += wrapPlain(text.slice(last, m.index)) + m[0];
    last = m.index + m[0].length;
  }
  return out + wrapPlain(text.slice(last));
}

// ---------------------------------------------------------------- a note's shape

/** A markdown bullet: "- ", "* ", "• ", or "1. " / "1) ", at the start of a line. */
const BULLET = /^\s{0,3}(?:[-*•]|\d{1,2}[.)])\s+/;

/** An option on a line of its own: "a) ", "(a) ", "a. ", or a sub-bullet "- a) ". */
const OPTION_LINE = /^\s*(?:[-*•]\s+)?\(?([a-z])[.)]\s+/;

/** The sentences of a stretch of text, each with its full stop. A stop inside a name, as in Node.js, doesn't end one. */
const sentences = (s: string): string[] => s.split(/(?<=[.!?])\s+(?=[A-Z(`"“])/).map((x) => x.trim()).filter(Boolean);

/** Words that join one option to the next, and the stop before the next, which aren't the option's own. */
const tidy = (s: string): string => s.replace(/\s+/g, ' ').trim().replace(/[\s,;]*(?:\b(?:or|and))?[\s,;]*$/i, '').trim();

/**
 * The markers in a stretch of text, in order from the first: (1) (2) (3), or 1. 2. 3., or 1) 2) 3). The longer
 * run wins; fewer than two is no run.
 */
function numbered(s: string): { at: number; end: number }[] {
  const run = (re: RegExp) => {
    const out: { at: number; end: number }[] = [];
    for (const m of s.matchAll(re)) {
      if (Number(m[2]) !== out.length + 1) continue;
      const at = m.index + m[1]!.length;
      out.push({ at, end: m.index + m[0].length });
    }
    return out.length >= 2 ? out : [];
  };
  const paren = run(/(^|[\s:;,.—–-])\((\d{1,2})\)\s*/g);
  const plain = run(/(^|[\s:;,—–])(\d{1,2})[.)]\s+/g);
  return paren.length >= plain.length ? paren : plain;
}

/** Inline options in an item's text: a) b) c), or (a) (b) (c), in order from a; fewer than two is none. */
function inlineOptions(s: string): { text: string; options: NoteOption[] } {
  const marks: { at: number; end: number; label: string }[] = [];
  for (const m of s.matchAll(/(^|[\s:;,—–-])\(?([a-z])\)\s*/g)) {
    const label = m[2]!;
    if (label.charCodeAt(0) - 97 !== marks.length) continue;
    marks.push({ at: m.index + m[1]!.length, end: m.index + m[0].length, label });
  }
  if (marks.length < 2) return { text: s.trim(), options: [] };
  const options = marks.map((x, i) => option(x.label, s.slice(x.end, marks[i + 1]?.at ?? s.length)));
  return { text: tidy(s.slice(0, marks[0]!.at)), options };
}

const option = (label: string, text: string): NoteOption => ({ label, text: tidy(text), recommended: /\brecommend(?:ed)?\b|\(recommended\)/i.test(text) });

/** An item's options, with the one its words recommend marked: "I recommend b", "Recommended: (a)". */
function marked(item: NoteItem): NoteItem {
  if (item.options.some((o) => o.recommended)) return item;
  const said = /\brecommend(?:ed|s|ation)?:?\s*(?:option\s+)?\(?([a-z])\)?(?![\w])/i.exec([item.text, ...item.options.map((o) => o.text)].join(' '));
  if (!said) return item;
  const pick = said[1]!.toLowerCase();
  return { ...item, options: item.options.map((o) => (o.label === pick ? { ...o, recommended: true } : o)) };
}

/** One item from its text, with its options split out where it gives them inline. */
const itemOf = (text: string, options: NoteOption[] = []): NoteItem => marked(options.length ? { text: tidy(text), options } : inlineOptions(text));

/** A note written as markdown bullets: the lines before them are its headline, each bullet a thing, its option lines its options. */
function bulleted(lines: string[]): NoteShape {
  const head: string[] = [];
  const items: { text: string[]; options: NoteOption[] }[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cur = items.at(-1);
    const opt = OPTION_LINE.exec(line);
    // An option line belongs to the item above it, in order from a; an indented "- a)" or a bare "a)".
    if (cur && opt && opt[1]!.charCodeAt(0) - 97 === cur.options.length) {
      cur.options.push(option(opt[1]!, line.slice(opt[0].length)));
    } else if (BULLET.test(line) && (!/^\s/.test(line) || !cur)) {
      items.push({ text: [line.replace(BULLET, '')], options: [] });
    } else if (cur?.options.length) {
      // A line under an option carries it on.
      const last = cur.options.at(-1)!;
      cur.options[cur.options.length - 1] = option(last.label, `${last.text} ${line.trim()}`);
    } else if (cur) cur.text.push(line.trim());
    else head.push(line.trim());
  }
  const all = items.map((i) => itemOf(i.text.join(' '), i.options));
  if (head.length) return { headline: head.join(' '), items: all };
  // No line before the bullets: the first is the headline.
  const [first, ...rest] = all;
  return { headline: first!.text, items: [...(first!.options.length ? [{ text: '', options: first!.options }] : []), ...rest] };
}

/**
 * A stretch of text before a note's first thing, as its headline: its first sentence, with a short lead-in
 * such as "Three problems:" kept on it. Anything longer after it is a thing of its own.
 */
function headOf(pre: string): { headline: string; rest: string | null } {
  const [first = '', ...more] = sentences(pre);
  const rest = more.join(' ').trim();
  if (!rest) return { headline: first, rest: null };
  if (rest.length <= 40 && /:$/.test(rest)) return { headline: `${first} ${rest}`, rest: null };
  return { headline: first, rest };
}

/**
 * A note as a headline and its bullets, or null where it has no such shape. A note written as markdown bullets
 * reads as it was written. One recorded as a paragraph is split where it says so: its first sentence is the
 * headline, inline (1) (2) (3) or 1. 2. 3. markers start its things, and a) b) c) its options. A paragraph
 * with no markers has no shape, and stays a paragraph.
 */
export function noteShape(text: string | null | undefined): NoteShape | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  const lines = t.split(/\r?\n/);
  if (lines.some((l) => BULLET.test(l) && !/^\s/.test(l))) return bulleted(lines);
  const para = lines.map((l) => l.trim()).filter(Boolean).join(' ');
  const marks = numbered(para);
  if (marks.length) {
    const { headline, rest } = headOf(para.slice(0, marks[0]!.at).trim());
    const items = marks.map((m, i) => itemOf(para.slice(m.end, marks[i + 1]?.at ?? para.length)));
    if (!headline) return { headline: items[0]!.text, items: items.slice(1) };
    return { headline, items: [...(rest ? [itemOf(rest)] : []), ...items] };
  }
  const opts = inlineOptions(para);
  if (opts.options.length) {
    const { headline, rest } = headOf(opts.text);
    return { headline: headline || opts.text, items: [marked({ text: headline ? rest ?? '' : '', options: opts.options })] };
  }
  return null;
}

/** A note's headline: its shape's, or, for a paragraph, its first sentence. What a notice carries. */
export function noteHeadline(text: string | null | undefined): string {
  const shape = noteShape(text);
  if (shape) return shape.headline;
  const one = (text ?? '').replace(/\s+/g, ' ').trim();
  return sentences(one)[0] ?? one;
}

/**
 * What's wrong with a note an agent gives a person: a headline past NOTE_HEADLINE_MAX (a paragraph with nothing
 * in bullets), a thing past the longest a note's line may be, or a question with more than three options. Each
 * says how to fix it. None for a note that's fine.
 */
export function shapeProblems(text: string): string[] {
  const lines = text.trim().split(/\r?\n/);
  const first = lines.findIndex((l) => BULLET.test(l) && !/^\s/.test(l));
  const head = (first < 0 ? lines : lines.slice(0, first)).map((l) => l.trim()).filter(Boolean).join(' ');
  const p: string[] = [];
  if (head.length > NOTE_HEADLINE_MAX) {
    p.push(`The note is one long paragraph (${head.length} characters; a headline takes at most ${NOTE_HEADLINE_MAX}). Nobody reads a wall of text. ${NOTE_SHAPE_WORDS}`);
  }
  const shape = first < 0 ? null : noteShape(text);
  for (const [i, item] of (shape?.items ?? []).entries()) {
    const n = i + 1;
    const long = [item.text, ...item.options.map((o) => o.text)].join(' ').length;
    if (long > NOTE_LIMITS.chars) p.push(`Thing ${n} is ${long} characters; one takes at most ${NOTE_LIMITS.chars}. Split it into more --item lines, or say it shorter.`);
    if (item.options.length > NOTE_OPTIONS_MAX) p.push(`Thing ${n} gives ${item.options.length} options; a person picks from at most ${NOTE_OPTIONS_MAX}. Keep the ${NOTE_OPTIONS_MAX} that matter, and mark the one you recommend.`);
  }
  return p;
}
