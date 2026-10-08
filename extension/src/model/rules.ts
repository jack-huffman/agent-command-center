/**
 * Rules suggested by review findings that keep coming back (GH-102), under Needs you: the drafted line, the
 * counts, and a link to each review it came from. A person accepts one, which opens a draft of the task it
 * adds, or dismisses it. They're never counted in the badge: nothing is waiting on them.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { CHECK_ASKS, type CheckAsk, defaultCheck, draftTitle, RULE_LINE_MAX, RULE_NOTE_MAX, RULE_TITLE_MAX, SUGGESTION_ID, type Suggestion } from '../../../packages/core/src/rule-suggestions.ts';
import { KEY, type Look, LOOK, type ModelArea, short } from './shared.ts';

/** One review a suggestion came from, as a link that opens its reviewer's session. */
export interface RuleSourceLink {
  task: string;
  sha: string;
  /** The review's day: 2026-10-05. */
  date: string;
  /** Where the finding was: a file, and its line. */
  where: string | null;
  message: string;
  must: boolean;
  /** false: a later review of the same task said it again on the same file, so it isn't counted again. */
  counted: boolean;
}

/** A suggested rule or check, as the Overview shows it. */
export interface RuleCard {
  project: string;
  id: string;
  kind: Suggestion['kind'];
  look: Look;
  /** The drafted line, or for a check, the rule already written. */
  line: string;
  /** Where it's already written, for a check: CLAUDE.md, a decision. */
  written: string | null;
  /** It came back after a person accepted or dismissed it. */
  again: Suggestion['again'];
  findings: number;
  tasks: number;
  must: number;
  /** What the draft asks for to begin with, and whether it can ask for no check: a rule already written can't. */
  check: CheckAsk;
  /** The drafted task's title for the line as acc drafted it. */
  title: string;
  sources: RuleSourceLink[];
}

export const RULE_LOOK: Record<Suggestion['kind'], Look> = {
  rule: LOOK('Rule suggested', 'law', 'neutral'),
  check: LOOK('Check suggested', 'beaker', 'neutral'),
};

/** A suggestion as its card. */
export function ruleCard(root: string, s: Suggestion): RuleCard {
  return {
    project: root, id: s.id, kind: s.kind, look: RULE_LOOK[s.kind], line: s.line, written: s.written, again: s.again,
    findings: s.findings, tasks: s.tasks, must: s.must, check: defaultCheck(s), title: draftTitle(s, s.line),
    sources: s.sources.map((x) => ({
      task: x.task, sha: x.sha, date: x.at.slice(0, 10), where: x.file ? `${x.file}${x.line ? `:${x.line}` : ''}` : null, message: x.message, must: x.must, counted: x.counted,
    })),
  };
}

/** The card's title: short, since a row's title is cut to one line. */
export function ruleTitle(c: Pick<RuleCard, 'kind' | 'again'>): string {
  if (c.kind === 'check') return c.again ? 'A rule you accepted keeps coming back' : 'A written rule keeps being broken';
  return c.again ? 'A finding you dismissed came back' : 'A review finding keeps coming back';
}

/** What it asks for, in full, on the row's second line, which wraps. */
export function ruleAsk(c: Pick<RuleCard, 'kind' | 'written'>): string {
  if (c.kind === 'rule') return 'Add it as a rule?';
  return c.written ? `Already a rule (${c.written}). It keeps coming back: add a check` : 'Accepted as a rule, and it keeps coming back: add a check';
}


export type Message =
  /**
   * A person confirmed the drafted task, as edited (GH-102): acc adds it and records the suggestion as
   * accepted. Or set it aside. The page never writes either.
   */
  | { type: 'rule-accept'; project: string; id: string; line: string; title: string; check: CheckAsk; note?: string }
  | { type: 'rule-dismiss'; project: string; id: string }
  /** Opens the reviewer's session of the review a finding came from. */
  | { type: 'rule-open-review'; project: string; task: string; sha: string };

const SHA = /^[0-9a-f]{7,40}$/;
const text = (v: unknown, max: number): boolean => typeof v === 'string' && !!v.trim() && v.length <= max;

export const area: ModelArea = {
  home: {
    order: 50,
    attention(c, p) {
      // Neutral, after the orange items, and never in the badge (GH-102): nothing is waiting on a suggestion.
      for (const s of c.hub.suggestions?.(p.root) ?? []) {
        const card = ruleCard(p.root, s);
        c.attention.push({
          key: `rule:${p.root}:${s.id}`, look: card.look, title: ruleTitle(card), detail: `${p.name} · ${ruleAsk(card)}`, project: p.name, actions: [], rule: card,
        });
      }
    },
  },
  messages: {
    'rule-accept': (x) => short(x.project, 4096) && typeof x.id === 'string' && SUGGESTION_ID.test(x.id) && text(x.line, RULE_LINE_MAX) && text(x.title, RULE_TITLE_MAX)
      && CHECK_ASKS.includes(x.check as CheckAsk) && (x.note === undefined || (typeof x.note === 'string' && x.note.length <= RULE_NOTE_MAX)),
    'rule-dismiss': (x) => short(x.project, 4096) && typeof x.id === 'string' && SUGGESTION_ID.test(x.id),
    'rule-open-review': (x) => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string) && typeof x.sha === 'string' && SHA.test(x.sha),
  },
};
