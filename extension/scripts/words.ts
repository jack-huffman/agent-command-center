/**
 * The screenshot run's words check (GH-163). The Command Center speaks to people in the processes they run
 * (Run the checks, Finish the task) and names files by what they are (the project's settings), never by
 * acc's command lines or its paths. Each drawing gathers every string a person can read on it, shown or
 * folded away: its text, and each element's title, aria-label, placeholder and alt. One that names an acc
 * command, npm run, a path under .acc/, a docs/ page or the packet is a finding, unless it sits in a region
 * the page marks as work data (`data-work`), whose words are the work's own. WORK_DATA names each region,
 * with why; `extension/test/words.test.ts` pins where the page marks each one.
 *
 * Like the geometry checks, the page gathers and judgeWords() decides, with no browser, so its rules are
 * unit-tested. A drawing that gathered no words fails: a page that drew nothing can't pass.
 */
import { AREAS } from '../../packages/cli/src/commands/index.ts';

/** acc's commands, from its own registry: the words that, after "acc ", make a command line. */
export const ACC_COMMANDS: readonly string[] = AREAS.flatMap((a) => Object.keys(a.commands)).sort();

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What a person-facing string may not hold, each by name. */
export const WORD_RULES: readonly { name: string; pattern: RegExp }[] = [
  { name: 'an acc command', pattern: new RegExp(`\\bacc (?:${ACC_COMMANDS.map(escape).join('|')})\\b`) },
  { name: 'npm run', pattern: /\bnpm run\b/ },
  { name: 'a path under .acc/', pattern: /\.acc\/\S*/ },
  { name: 'a docs/ page', pattern: /\bdocs\/[\w.-]+\.md\b/ },
  { name: 'the packet', pattern: /\bpackets?\b/i },
];

/**
 * The regions whose words are the work's own, and stay as they are (GH-163). The page marks each with
 * data-work="<name>"; text inside one is gathered and counted, never judged.
 */
export const WORK_DATA: readonly { name: string; reason: string }[] = [
  { name: 'files', reason: 'The files a task changes or shares with another, that its analysis names, or where a review finding is: their paths are the work itself, and a task that changes .acc/config.json changed that file.' },
  { name: 'branch', reason: 'A branch, worktree or ref as git names it, which a person copies, compares or looks up.' },
  { name: 'transcript', reason: 'What an agent ran or asks to run, and its transcript: the commands a builder ran are what it did. A reason acc relays (a stopped builder\'s last words among them) is put in process words, whoever wrote it (D-132).' },
  { name: 'output', reason: 'What a check or a command printed, as it printed it: CLI output stays literal, in a terminal or in the output panel.' },
  { name: 'agent-text', reason: 'Text written for agents, who read it literally: a rule\'s line for the project\'s rules, a draft task\'s brief for its builder.' },
];

/** A string a drawing gathered: where it is, what it says, and the work-data region it sits in, if any. */
export interface GeoSaid { what: string; text: string; work: string | null }

/** One finding of the words check. */
export interface WordFinding { what: string; detail: string }

export interface WordsVerdict {
  examined: number;
  findings: WordFinding[];
  /** How many strings each work-data region held, by its name. */
  held: Record<string, number>;
}

const quote = (s: string): string => `"${s.length > 80 ? `${s.slice(0, 79)}…` : s}"`;

/**
 * Judges the strings one drawing gathered. Each outside work data that breaks a rule is a finding, naming
 * the rule and what matched; a region the page marks with a name WORK_DATA doesn't know is a finding too.
 */
export function judgeWords(said: readonly GeoSaid[], rules = WORD_RULES, regions = WORK_DATA): WordsVerdict {
  const known = new Set(regions.map((r) => r.name));
  const held: Record<string, number> = Object.fromEntries(regions.map((r) => [r.name, 0]));
  const findings: WordFinding[] = [];
  const unknown = new Set<string>();
  for (const s of said) {
    if (s.work !== null) {
      if (known.has(s.work)) held[s.work]!++;
      else if (!unknown.has(s.work)) { unknown.add(s.work); findings.push({ what: s.what, detail: `is marked as work data "${s.work}", which WORK_DATA doesn't name` }); }
      continue;
    }
    for (const r of rules) {
      const m = r.pattern.exec(s.text);
      if (m) findings.push({ what: s.what, detail: `${quote(s.text)} names ${r.name}: ${m[0]}` });
    }
  }
  return { examined: said.length, findings, held };
}

/**
 * The page's side, run inside collectGeometry: every text node in the body but scripts and styles, and each
 * element's title, aria-label, placeholder and alt, with the data-work region it sits in. `what` and
 * `words` are the collector's own.
 */
export const COLLECT_WORDS = `
  const said = [];
  const region = (e) => { const w = e.closest('[data-work]'); return w ? w.getAttribute('data-work') : null; };
  const every = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = every.nextNode(); n; n = every.nextNode()) {
    const e = n.parentElement;
    const t = words(n.textContent);
    if (!e || !t || e.closest('script, style')) continue;
    said.push({ what: what(e), text: t, work: region(e) });
  }
  for (const e of document.body.querySelectorAll('[title], [aria-label], [placeholder], [alt]')) {
    for (const a of ['title', 'aria-label', 'placeholder', 'alt']) {
      const t = words(e.getAttribute(a));
      if (t) said.push({ what: what(e) + '[' + a + ']', text: t, work: region(e) });
    }
  }`;
