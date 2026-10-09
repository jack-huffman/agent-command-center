/**
 * Findings that keep coming back (GH-102). Every reviewer verdict in the clone is kept, so acc can see when
 * the same finding turns up in task after task. It groups the findings by the rule they cite, or by close
 * wording where they cite none, and offers a group that keeps coming back as a rule for `.acc/rules.md`,
 * or, when the rule is already written, as a check: a lint, a test or a gate. Rules only written in prose
 * decay; the offer is the first step on the path to a check.
 *
 * Working out the offers only reads. A person accepts one, which adds a task that a person confirmed, or
 * dismisses it; each writes one record here, and nothing else. acc never writes `.acc/rules.md`: the task
 * it adds does, and its pull request changes `.acc/`, which a person merges.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from './config.ts';
import { AccError } from './exec.ts';
import { type Actor, mutate, type TaskInput, upsertTasks } from './ledger.ts';
import { withLock } from './lock.ts';
import type { RepoPaths } from './paths.ts';
import { readVerdicts } from './review.ts';
import { importedRules, OWN_RULES, withoutHeader } from './rules.ts';

/** A group is offered once it has this many findings, counted once per task and file… */
export const OFFER_FINDINGS = 3;
/** …across at least this many tasks. */
export const OFFER_TASKS = 2;
/** A dismissed or accepted suggestion comes back once this many more findings join it. */
export const RETURN_FINDINGS = 3;
/** How close two cited rules' words must be to be the same rule, as the share of words they have in common. */
export const RULE_JOIN = 0.6;
/** How close two uncited findings' words must be to be the same finding. */
export const WORDING_JOIN = 0.5;

/** The longest drafted line, title and note a person can send. */
export const RULE_LINE_MAX = 300;
export const RULE_TITLE_MAX = 200;
export const RULE_NOTE_MAX = 4000;

/** A suggestion's id: r- for a group by the rule cited, w- for one by wording, then six hex digits. */
export const SUGGESTION_ID = /^[rw]-[0-9a-f]{6}$/;

/** The files in the repo whose lines are rules already written. */
export const WRITTEN_RULE_FILES = [OWN_RULES, 'CLAUDE.md', 'AGENTS.md'] as const;

// ---------------------------------------------------------------- the findings

/** One reviewer finding, with the verdict it came from. */
export interface ReviewFinding {
  /** `<task>@<sha7>#<n>`: the verdict's task and commit, and the finding's place in it. */
  id: string;
  task: string;
  sha: string;
  /** When the review gave its verdict. */
  at: string;
  /** The reviewer's session, so its review can be read again, and what it was called. */
  sessionId: string;
  name: string | null;
  message: string;
  must: boolean;
  file: string | null;
  line: number | null;
  rule: string | null;
  kind: string | null;
}

/** Every finding in every verdict the clone keeps, oldest first, for any environment and any task state. */
export function readFindings(paths: Pick<RepoPaths, 'reviews'>): ReviewFinding[] {
  return readVerdicts(paths).flatMap((v) => v.findings.flatMap((f, i) => (typeof f?.message !== 'string' ? [] : [{
    id: `${v.task}@${v.sha.slice(0, 7)}#${i + 1}`, task: v.task, sha: v.sha, at: v.at, sessionId: typeof v.sessionId === 'string' ? v.sessionId : '', name: v.name ?? null,
    message: f.message, must: f.must === true, file: typeof f.file === 'string' && f.file ? f.file : null, line: Number.isInteger(f.line) ? f.line! : null,
    rule: typeof f.rule === 'string' && f.rule.trim() ? f.rule.trim() : null, kind: typeof f.kind === 'string' && f.kind.trim() ? f.kind.trim() : null,
  }])));
}

// ---------------------------------------------------------------- keys

const STOP = new Set(('a an the to of in on at for and or but nor is are was were be been it its this that these those with as by from into onto '
  + 'not no do does did any each every all when where which what who whom than then so if only one there their they them we you your our '
  + 'has have had can could should would will may might must also just more most less still yet very about over under before after').split(' '));

/** A word without a plural s, so "rules" and "rule" are one word. */
const stem = (w: string): string => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** The words that carry a text's meaning, lower-cased, each once, in order. */
export function words(text: string): string[] {
  const out = text.toLowerCase().replace(/[’'`"]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
  return [...new Set(out)];
}

/** The share of words two texts have in common: 1 is the same words, 0 none. */
export function overlap(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const s = new Set(a);
  const both = b.filter((w) => s.has(w)).length;
  return both / (a.length + b.length - both);
}

/** Where a cited rule says it's written, from its own words: "CLAUDE.md: …", "… (CLAUDE.md)". */
const SOURCE_TAG = /(~\/\.claude\/CLAUDE\.md|\.acc\/rules\.md|\bCLAUDE\.md|\bAGENTS\.md)/i;
/** What a cite starts with that names its source, not the rule. */
const LEAD_TAG = /^\s*(?:~\/\.claude\/CLAUDE\.md|\.acc\/rules\.md|CLAUDE\.md|AGENTS\.md|task(?: acceptance criterion| criterion)?|decided by a person(?: \(Q\d+\))?|rule)\s*:\s*/i;
const DECISION = /^\s*(D-\d{3,})\b/;

export interface RuleHead {
  /** The decision a cite names first, such as D-072: its id is its key. */
  decision: string | null;
  /** The rule itself, without where it's written, what it's for, or a second rule joined on. */
  text: string;
  /** Where the cite says the rule is written: CLAUDE.md, ~/.claude/CLAUDE.md, AGENTS.md, .acc/rules.md. */
  source: string | null;
}

/**
 * A cited rule's head: the rule as one plain sentence, however the reviewer wrote it. "CLAUDE.md: Look at UI
 * changes before shipping them (npm run build, …)" and "Look at UI changes before shipping them (CLAUDE.md)"
 * give the same head. A cite that joins two rules with ';' keeps the first.
 */
export function ruleHead(rule: string): RuleHead {
  const source = SOURCE_TAG.exec(rule)?.[1] ?? null;
  const decision = DECISION.exec(rule)?.[1] ?? null;
  let t = rule;
  for (let i = 0; i < 3 && LEAD_TAG.test(t); i++) t = t.replace(LEAD_TAG, '');
  t = t.replace(/\([^()]*\)/g, ' ').split(/[:;]\s|[:;]$|\.\s|\s[–—]\s/)[0]!.replace(/\s+/g, ' ').trim().replace(/[.,;:\s]+$/, '');
  const text = t ? t[0]!.toUpperCase() + t.slice(1) : '';
  return { decision, text, source: source ? (source.startsWith('~') ? '~/.claude/CLAUDE.md' : source.toLowerCase() === 'claude.md' ? 'CLAUDE.md' : source.toLowerCase() === 'agents.md' ? 'AGENTS.md' : OWN_RULES) : null };
}

/** A finding's first sentence. */
export function firstSentence(text: string): string {
  return text.trim().split(/(?<=[.!?])\s+(?=[A-Z`'"(\d])/)[0]!.trim();
}

/** A word that names a thing rather than says something: a path, a file, an identifier, a ticket, a number. */
const NAMES_A_THING = /[/\\]|\.[a-z]{1,5}\b|[a-z][A-Z]|_|\d|^[A-Z]{2,}-\d|^--?[a-z]/;

/** What an uncited finding says, without the paths, identifiers and numbers that differ from one task to the next. */
export function wordingText(f: Pick<ReviewFinding, 'message' | 'kind'>): string {
  if (f.kind) return f.kind;
  return firstSentence(f.message).replace(/`[^`]*`/g, ' ').split(/\s+/).filter((w) => w && !NAMES_A_THING.test(w.replace(/^[('"]+|[)'",.:;!?]+$/g, ''))).join(' ');
}

export type GroupedBy = 'rule' | 'wording';

export interface FindingKey {
  by: GroupedBy;
  /** A decision's id, which groups by itself. */
  decision: string | null;
  text: string;
  words: string[];
}

/** How a finding is grouped: by the rule it cites, or by its wording where it cites none. Null when it says nothing to group by. */
export function findingKey(f: Pick<ReviewFinding, 'rule' | 'message' | 'kind'>): FindingKey | null {
  if (f.rule) {
    const h = ruleHead(f.rule);
    const w = words(h.text);
    if (h.decision) return { by: 'rule', decision: h.decision, text: h.decision, words: [h.decision.toLowerCase()] };
    if (w.length) return { by: 'rule', decision: null, text: h.text, words: w };
  }
  const text = wordingText(f);
  const w = words(text);
  return w.length ? { by: 'wording', decision: null, text, words: w } : null;
}

// ---------------------------------------------------------------- groups

export interface FindingGroup {
  id: string;
  by: GroupedBy;
  /** The first finding's key, which each later one is compared with. */
  key: FindingKey;
  /** Every finding in it, oldest first. */
  findings: ReviewFinding[];
  /** The findings it counts: once per task and file, the first of each. */
  counted: ReviewFinding[];
  /** Each place it came back: `<task>|<file>`. */
  places: string[];
  tasks: string[];
  /** How many of its places had a finding that had to be fixed before merging. */
  must: number;
}

const placeOf = (f: Pick<ReviewFinding, 'task' | 'file'>): string => `${f.task}|${f.file ?? ''}`;
const hex = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 6);

/**
 * Groups every finding, oldest first: each joins the group whose first finding it's closest to, by the rule
 * they cite or by wording where it cites none, or starts its own. A later review of the same task that repeats
 * a finding on the same file is the same place, so it's counted once.
 */
export function groupFindings(findings: ReviewFinding[]): FindingGroup[] {
  const groups: FindingGroup[] = [];
  const sorted = [...findings].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  for (const f of sorted) {
    const k = findingKey(f);
    if (!k) continue;
    let best: FindingGroup | null = null;
    let score = 0;
    for (const g of groups) {
      if (g.by !== k.by || !!g.key.decision !== !!k.decision) continue;
      const s = k.decision ? (g.key.decision === k.decision ? 1 : 0) : overlap(g.key.words, k.words);
      if (s > score && s >= (k.by === 'rule' ? RULE_JOIN : WORDING_JOIN)) { best = g; score = s; }
    }
    if (!best) {
      best = { id: `${k.by === 'rule' ? 'r' : 'w'}-${hex(`${k.by}:${k.decision ?? k.words.join(' ')}`)}`, by: k.by, key: k, findings: [], counted: [], places: [], tasks: [], must: 0 };
      groups.push(best);
    }
    best.findings.push(f);
  }
  for (const g of groups) {
    const must = new Set<string>();
    for (const f of g.findings) {
      const p = placeOf(f);
      if (f.must) must.add(p);
      if (g.places.includes(p)) continue;
      g.places.push(p);
      g.counted.push(f);
      if (!g.tasks.includes(f.task)) g.tasks.push(f.task);
    }
    g.must = must.size;
  }
  return groups;
}

// ---------------------------------------------------------------- rules already written

export interface WrittenRule {
  /** The file it's in, from the repo's root. */
  file: string;
  text: string;
  words: string[];
}

/** Each rule in a file: a bullet or a paragraph, with its wrapped lines joined, then each sentence of it. */
function rulesIn(text: string, file: string): WrittenRule[] {
  const items: string[] = [];
  let cur = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const starts = /^([-*+]|\d+\.)\s+/.test(line) || /^#/.test(line);
    if (!line || starts) { if (cur) items.push(cur); cur = line.startsWith('#') ? '' : line.replace(/^([-*+]|\d+\.)\s+/, ''); continue; }
    cur = cur ? `${cur} ${line}` : line;
  }
  if (cur) items.push(cur);
  return items.flatMap((item) => item.replace(/\*\*/g, '').split(/(?<=\.)\s+(?=[A-Z])/).map((s) => {
    const h = ruleHead(s).text;
    return { file, text: h, words: words(h) };
  })).filter((r) => r.words.length);
}

/**
 * The rules the repo already has written down, with where: .acc/rules.md, the copies in .acc/rules/, and
 * CLAUDE.md and AGENTS.md at its root. Read from `root` only.
 */
export function writtenRules(root: string): WrittenRule[] {
  const read = (f: string): string => {
    try {
      return readFileSync(join(root, f), 'utf8');
    } catch {
      return '';
    }
  };
  return [
    ...WRITTEN_RULE_FILES.flatMap((f) => rulesIn(read(f), f)),
    ...importedRules(root).flatMap((c) => rulesIn(withoutHeader(c.body), c.file)),
  ];
}

/** Where a rule is already written: a decision, a file in the repo, or the file its cite names. Null when nowhere. */
export function whereWritten(g: Pick<FindingGroup, 'key' | 'findings'>, written: WrittenRule[]): string | null {
  if (g.key.decision) return g.key.decision;
  if (g.key.by !== 'rule') return null;
  const w = g.key.words;
  const hit = written.find((r) => overlap(w, r.words) >= RULE_JOIN || (w.length >= 3 && w.every((x) => r.words.includes(x))));
  if (hit) return hit.file;
  for (const f of g.findings) {
    const s = f.rule ? ruleHead(f.rule).source : null;
    if (s) return s;
  }
  return null;
}

// ---------------------------------------------------------------- what a person did

export type SuggestionOutcome = 'accepted' | 'dismissed';

export interface SuggestionRecord {
  v: 1;
  /** The suggestion's id when it was acted on. A group's id can move as it grows, so it's matched by its findings. */
  id: string;
  outcome: SuggestionOutcome;
  at: string;
  by: string;
  kind: SuggestionKind;
  head: string;
  /** Every finding the group had. */
  findings: string[];
  /** Each place it had come back by then: `<task>|<file>`. */
  places: string[];
  /** The task accepting it added. */
  task?: string;
}

/** What a person did with each suggestion, oldest first. */
export function readSuggestionRecords(paths: Pick<RepoPaths, 'suggestions'>): SuggestionRecord[] {
  let names: string[];
  try {
    names = readdirSync(paths.suggestions).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out: SuggestionRecord[] = [];
  for (const n of names) {
    try {
      const r = JSON.parse(readFileSync(join(paths.suggestions, n), 'utf8')) as SuggestionRecord;
      if (r?.v === 1 && Array.isArray(r.findings) && Array.isArray(r.places) && (r.outcome === 'accepted' || r.outcome === 'dismissed')) out.push(r);
    } catch {
      // unreadable: as if it weren't there
    }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

// ---------------------------------------------------------------- suggestions

export type SuggestionKind = 'rule' | 'check';
export type CheckKind = 'lint' | 'test' | 'gate';
/** What the drafted task asks for: a lint, a test or a gate, any of them, or no check. */
export type CheckAsk = CheckKind | 'any' | 'none';
export const CHECK_ASKS: readonly CheckAsk[] = ['lint', 'test', 'gate', 'any', 'none'];

/** One finding a suggestion came from, and the review it was in. */
export interface SuggestionSource {
  finding: string;
  task: string;
  sha: string;
  /** When its review gave its verdict. */
  at: string;
  /** The reviewer's session, which opens its review again, and its name. */
  sessionId: string;
  name: string | null;
  /** The finding's first sentence. */
  message: string;
  must: boolean;
  file: string | null;
  line: number | null;
  /** false: a later review of the same task said it again on the same file, so it isn't counted again. */
  counted: boolean;
}

export interface Suggestion {
  id: string;
  /** rule: add a line to .acc/rules.md. check: it's already a rule, and it keeps coming back, so add a check. */
  kind: SuggestionKind;
  by: GroupedBy;
  /** The rule as the reviews cite it, or what the findings say where none cites one. */
  head: string;
  /** The drafted line for .acc/rules.md, or for a check, the rule already written. A person edits it. */
  line: string;
  /** Where it's already written: a decision (D-072), CLAUDE.md, .acc/rules.md… Null when nowhere. */
  written: string | null;
  /** It came back after a person accepted or dismissed it: how they did, and when. */
  again: { outcome: SuggestionOutcome; at: string; by: string; task: string | null } | null;
  /** Counted once per task and file. */
  findings: number;
  tasks: number;
  /** How many of those had to be fixed before merging. */
  must: number;
  /** What the words suggest could check it, which sets the drafted task's check to begin with. */
  hint: CheckKind | null;
  sources: SuggestionSource[];
}

/** A suggestion a person dismissed or accepted, and how many more findings it needs to come back. */
export interface HiddenSuggestion extends Suggestion {
  hidden: { outcome: SuggestionOutcome; at: string; by: string; more: number };
}

/** What a rule's words suggest could check it. Only a hint: the builder of the drafted task picks the check. */
export function checkHint(text: string): CheckKind | null {
  const t = text.toLowerCase();
  if (/\b(lint|eslint|literals?|hard-?cod\w*|imports?|naming|format\w*|colou?rs?)\b/.test(t)) return 'lint';
  if (/\b(tests?|tested|testing|asserts?|fixtures?|cover\w*|cases?)\b/.test(t)) return 'test';
  if (/\b(gates?|checks?|checked|screenshots?|builds?|ci|ratchets?|floors?|ship\w*|merg\w*|land\w*)\b/.test(t)) return 'gate';
  return null;
}

const sentence = (t: string): string => {
  const s = t.trim();
  return s && !/[.!?]$/.test(s) ? `${s}.` : s;
};

/**
 * The suggestions to show: each group with 3 or more findings across 2 or more tasks. One a person dismissed
 * or accepted stays hidden until 3 more findings join it; one accepted as a rule that comes back is offered as
 * a check. With `all`, the hidden ones too, each saying why. It only reads.
 */
export function suggestRules(paths: Pick<RepoPaths, 'root' | 'reviews' | 'suggestions'>, opts: { all?: boolean } = {}): (Suggestion | HiddenSuggestion)[] {
  const groups = groupFindings(readFindings(paths)).filter((g) => g.counted.length >= OFFER_FINDINGS && g.tasks.length >= OFFER_TASKS);
  if (!groups.length) return [];
  const records = readSuggestionRecords(paths);
  const written = writtenRules(paths.root);
  const out: (Suggestion | HiddenSuggestion)[] = [];
  for (const g of groups) {
    const ids = new Set(g.findings.map((f) => f.id));
    const mine = records.filter((r) => r.findings.some((f) => ids.has(f)));
    const seen = new Set(mine.flatMap((r) => r.places));
    const more = g.places.filter((p) => !seen.has(p)).length;
    const last = mine.at(-1) ?? null;
    const where = whereWritten(g, written);
    const accepted = mine.some((r) => r.outcome === 'accepted');
    const kind: SuggestionKind = where || accepted ? 'check' : 'rule';
    const lead = g.findings[0]!;
    // A decision's group takes its words from the first cite that has some beyond the decision's id.
    const said = g.key.decision ? g.findings.map((f) => (f.rule ? ruleHead(f.rule.replace(DECISION, '').replace(/^\s*[:;,-]\s*/, '')).text : '')).find(Boolean) : null;
    const head = g.key.decision ? said || g.key.decision : g.key.by === 'rule' ? g.key.text : lead.kind ?? firstSentence(lead.message);
    const line = sentence(g.key.decision && head !== g.key.decision ? `${head} (${g.key.decision})` : head);
    const counted = new Set(g.counted.map((f) => f.id));
    const s: Suggestion = {
      id: g.id, kind, by: g.by, head, line, written: where,
      again: last ? { outcome: last.outcome, at: last.at, by: last.by, task: last.task ?? null } : null,
      findings: g.counted.length, tasks: g.tasks.length, must: g.must, hint: checkHint(head),
      sources: g.findings.map((f) => ({
        finding: f.id, task: f.task, sha: f.sha, at: f.at, sessionId: f.sessionId, name: f.name, message: firstSentence(f.message), must: f.must, file: f.file, line: f.line, counted: counted.has(f.id),
      })),
    };
    if (!last || more >= RETURN_FINDINGS) out.push(s);
    else if (opts.all) out.push({ ...s, again: null, hidden: { outcome: last.outcome, at: last.at, by: last.by, more: RETURN_FINDINGS - more } });
  }
  // The most counted first, then the most tasks.
  return out.sort((a, b) => b.findings - a.findings || b.tasks - a.tasks || a.id.localeCompare(b.id));
}

// ---------------------------------------------------------------- the drafted task

/** What a person changed in the draft before Confirm. */
export interface RuleEdits {
  line?: string;
  title?: string;
  check?: CheckAsk;
  /** More for the builder, after the rule. */
  note?: string;
}

/** The check the drafted task asks for to begin with: the hint, or for a rule already written, any check. */
export const defaultCheck = (s: Pick<Suggestion, 'kind' | 'hint'>): CheckAsk => s.hint ?? (s.kind === 'check' ? 'any' : 'none');

const CHECK_WORDS: Record<Exclude<CheckAsk, 'none'>, string> = { lint: 'lint', test: 'test', gate: 'gate', any: 'lint, test or gate' };

const clip = (t: string, n: number): string => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

export const draftTitle = (s: Pick<Suggestion, 'kind'>, line: string): string => clip(s.kind === 'check' ? `Add a check for the rule: ${line.replace(/\.$/, '')}` : `Add the rule: ${line.replace(/\.$/, '')}`, 120);

/** Where a source's finding was: its review, its file and line, and its first sentence. */
export const sourceLine = (x: SuggestionSource): string =>
  `${x.task}, review of ${x.sha.slice(0, 7)} on ${x.at.slice(0, 10)}${x.file ? `, ${x.file}${x.line ? `:${x.line}` : ''}` : ''}${x.must ? ' (must fix)' : ''}: ${x.message}${x.sessionId ? ` Reviewer session ${x.sessionId}.` : ''}`;

/**
 * The task accepting a suggestion adds: a manual task in To do, whose brief holds the rule's line, a check
 * when asked for, and each finding it came from. A rule already written asks only for its check.
 */
export function draftRuleTask(s: Suggestion, e: RuleEdits = {}): TaskInput {
  const line = sentence((e.line ?? s.line).replace(/\s+/g, ' '));
  const check = e.check ?? defaultCheck(s);
  if (!line) throw new AccError('usage', 'The rule\'s line is empty.');
  if (line.length > RULE_LINE_MAX) throw new AccError('usage', `The rule's line is ${line.length} characters, more than ${RULE_LINE_MAX}.`);
  if (!CHECK_ASKS.includes(check)) throw new AccError('usage', `--check is lint, test, gate, any or none, not "${check}".`);
  if (s.kind === 'check' && check === 'none') throw new AccError('usage', `${s.id} is already a rule (${s.written ?? 'accepted before'}), so its task is the check: lint, test, gate or any.`);
  const title = (e.title ?? draftTitle(s, line)).replace(/\s+/g, ' ').trim();
  if (!title) throw new AccError('usage', 'The task needs a title.');
  if (title.length > RULE_TITLE_MAX) throw new AccError('usage', `The title is ${title.length} characters, more than ${RULE_TITLE_MAX}.`);
  const note = (e.note ?? '').trim();
  if (note.length > RULE_NOTE_MAX) throw new AccError('usage', `The note is ${note.length} characters, more than ${RULE_NOTE_MAX}.`);
  const counts = `${s.findings} findings across ${s.tasks} tasks${s.must ? `, ${s.must} of them must-fix` : ''}`;
  const already = s.written ? `It's already a rule (${s.written})` : 'It was accepted as a rule before';
  const brief = [
    `A review finding keeps coming back: ${counts}. acc suggested this from the clone's reviews, and a person accepted it.`,
    '',
    '## The rule',
    '',
    s.kind === 'check' ? `${already}, and the reviews keep finding it broken, so it needs a check:` : 'Add this line to `.acc/rules.md`, which every builder, reviewer and analyst reads:',
    '',
    `> ${line}`,
    '',
    '## Acceptance criteria',
    '',
    ...(s.kind === 'rule' ? ['- [ ] `.acc/rules.md` has the line above, worded as the team wants it.'] : []),
    ...(check !== 'none' ? [
      `- [ ] A ${CHECK_WORDS[check]} checks the rule and fails when it's broken, and it proves it ran: it counts what it checked and fails on none.`,
      `- [ ] ${s.kind === 'rule' || !s.written || /^D-\d/.test(s.written) ? '`.acc/rules.md`' : `\`${s.written}\``} names that check beside the rule.`,
    ] : []),
    ...(note ? ['', '## Notes', '', note] : []),
    '',
    '## Where it came from',
    '',
    'Each review keeps its reviewer\'s session, which the Command Center opens.',
    '',
    ...s.sources.map((x) => `- ${sourceLine(x)}${x.counted ? '' : ' Said again in a later review of the same task and file, so not counted again.'}`),
  ].join('\n');
  return { source: { kind: 'manual', key: null }, title, brief };
}

// ---------------------------------------------------------------- accepting and dismissing

const lockOf = (paths: Pick<RepoPaths, 'suggestions'>): string => `${paths.suggestions}.lock`;

function offered(paths: Pick<RepoPaths, 'root' | 'reviews' | 'suggestions'>, id: string): Suggestion {
  const s = suggestRules(paths).find((x) => x.id === id);
  if (!s) throw new AccError('no-suggestion', `No rule is suggested as ${id} now. acc rules suggested lists them.`);
  return s;
}

function record(paths: Pick<RepoPaths, 'suggestions'>, s: Suggestion, outcome: SuggestionOutcome, by: string, now: () => Date, task?: string): SuggestionRecord {
  const r: SuggestionRecord = {
    v: 1, id: s.id, outcome, at: now().toISOString(), by, kind: s.kind, head: s.head,
    findings: s.sources.map((x) => x.finding), places: [...new Set(s.sources.map(placeOf))], ...(task ? { task } : {}),
  };
  mkdirSync(paths.suggestions, { recursive: true });
  const n = readdirSync(paths.suggestions).filter((x) => x.startsWith(`${s.id}.`) && x.endsWith('.json')).length + 1;
  const file = join(paths.suggestions, `${s.id}.${n}.json`);
  writeFileSync(`${file}.tmp`, JSON.stringify(r, null, 2) + '\n');
  renameSync(`${file}.tmp`, file);
  return r;
}

/** A person sets a suggestion aside: it stays hidden until 3 more findings join it. */
export function dismissSuggestion(paths: Pick<RepoPaths, 'root' | 'reviews' | 'suggestions'>, id: string, by: string, now: () => Date): SuggestionRecord {
  return withLock(lockOf(paths), () => record(paths, offered(paths, id), 'dismissed', by, now));
}

/**
 * A person confirmed the drafted task: acc adds it, a manual task in To do, and records the suggestion as
 * accepted. It never writes .acc/rules.md: the task does, and a person merges it.
 */
export function acceptSuggestion(paths: RepoPaths, config: Config, id: string, edits: RuleEdits, actor: Actor, by: string, now: () => Date): { record: SuggestionRecord; task: string; input: TaskInput } {
  if (actor !== 'human') throw new AccError('refused', 'Only a person can accept a suggested rule.');
  return withLock(lockOf(paths), () => {
    const s = offered(paths, id);
    const input = draftRuleTask(s, edits);
    const res = mutate(paths, now, (l, emit) => upsertTasks(l, config, [input], actor, by, emit, now));
    if (res.errors.length || res.added.length !== 1) throw new AccError('refused', `The task wasn't added: ${res.errors.join(' ') || 'acc added none.'}`);
    const task = res.added[0]!;
    return { record: record(paths, s, 'accepted', by, now, task), task, input };
  });
}
