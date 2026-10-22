/**
 * The planning agent's questions as data (T-113): each reply before the plan, and each reply in Talk it through,
 * carries at most three questions, each with why it matters and two or three short answers with the agent's
 * suggestion first. A single choice offers at most three answers and the person's own words, which are always
 * there (T-114). The conversation's panel asks them
 * one at a time; the person's answers go back together as one message. The reply's own words stay short.
 */

/** One of the agent's questions: the first option is its suggestion. */
export interface TalkAsk {
  question: string;
  /** Why it matters, in one line. */
  why: string;
  /** Two or three short answers, the agent's suggestion first; none for a question kept from before T-113. */
  options: string[];
}

/** The person's answer to one question: an option by its place, their own words, or null when they skipped it. */
export type TalkAnswer = { option: number } | { text: string } | null;

/** The most questions a reply asks. */
export const QUESTIONS_MAX = 3;

/** The fewest and most answers a single choice offers, before the person's own words (D-T-114). */
export const OPTIONS_MIN = 2;
export const OPTIONS_MAX = 3;

/** The longest answer in the person's own words: three of them, with their questions, fit in one message. */
export const ANSWER_MAX = 1000;

/** About how many words a reply's prose holds, as the prompts say. */
export const REPLY_WORDS = 80;

/** The questions in a reply's schema: Claude Code checks them against this (`--json-schema`). */
export const QUESTIONS_SCHEMA = {
  type: 'array',
  maxItems: QUESTIONS_MAX,
  description: `At most ${QUESTIONS_MAX} questions for the person, the ones that change the plan most, each asked on its own. Fold what you are unsure of into them. Empty when you have none`,
  items: {
    type: 'object', additionalProperties: false, required: ['question', 'why', 'options'],
    properties: {
      question: { type: 'string', description: 'The question, in one sentence' },
      why: { type: 'string', description: 'Why it matters to the plan, in one short line' },
      options: { type: 'array', minItems: OPTIONS_MIN, maxItems: OPTIONS_MAX, items: { type: 'string' }, description: `${OPTIONS_MIN} to ${OPTIONS_MAX} short answers the person can pick, a few words each. Your suggestion first. Offer the ${OPTIONS_MAX} answers that matter most, never a long list: the person writes their own if more exist` },
    },
  },
} as const;

/** What the planning agent is told about the shape of every reply, before the plan and after it. */
export const REPLY_RULES = [
  `Keep your reply's own words to at most about ${REPLY_WORDS} words. No lists of questions in it.`,
  `Ask each question as a question item, with ${OPTIONS_MIN} to ${OPTIONS_MAX} short answers, your suggestion first: the ${OPTIONS_MAX} that matter most, never a long list. If more exist, the person writes their own. At most ${QUESTIONS_MAX}, and only the ones that change the plan most.`,
  'Do not list what you are unsure of apart: fold it into your questions.',
].join('\n');

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * The questions from a reply, checked: one with no words is left out, an option with none too, and repeats; at
 * most four options and three questions. One left with fewer than two options is answered in the person's own
 * words.
 */
export function parseQuestions(v: unknown): TalkAsk[] {
  const out: TalkAsk[] = [];
  for (const q of Array.isArray(v) ? v : []) {
    const question = str(q?.question);
    if (!question) continue;
    const options = [...new Set((Array.isArray(q?.options) ? q.options : []).map(str).filter(Boolean))].slice(0, OPTIONS_MAX) as string[];
    out.push({ question, why: str(q?.why), options: options.length >= OPTIONS_MIN ? options : [] });
    if (out.length === QUESTIONS_MAX) break;
  }
  return out;
}

/** A question kept before T-113, as words alone: answered in the person's own words. */
export const askOfWords = (question: string): TalkAsk => ({ question, why: '', options: [] });

/** A turn's questions: the structured ones, else those kept as words before T-113. */
export const turnQuestions = (t: { questions?: TalkAsk[]; asks?: string[] }): TalkAsk[] => t.questions ?? (t.asks ?? []).map(askOfWords);

/**
 * The person's answers as one message (T-113), numbered as the questions were: "1. <question>" and, under it,
 * the option picked, their own words, or "(skipped)". A missing answer counts as skipped.
 */
export function answersText(questions: TalkAsk[], answers: TalkAnswer[]): string {
  return questions.map((q, i) => {
    const a = answers[i] ?? null;
    const words = a === null ? '' : 'text' in a ? a.text.trim() : q.options[a.option] ?? '';
    return `${i + 1}. ${q.question}\n   ${words || '(skipped)'}`;
  }).join('\n');
}

/** One of the agent's questions, as a line of a prompt: the question, and the answers it offered. */
export const askedLine = (q: TalkAsk): string => `  - Asked: ${q.question}${q.options.length ? ` (offered: ${q.options.join('; ')})` : ''}`;
