/**
 * Talk it through, on a task's page (T-98): the person's messages to the planning agent and its replies, each
 * with who and when, what a message is about quoted, each change a reply proposes with Use this, and what a
 * Claude Code session opened on the plan recorded. Send, Make a new plan and Open in Claude Code, each off
 * with why when they can't be used. Plain data and the messages' checks: no vscode import.
 */

import type { Analysis } from '../../../packages/core/src/analyze.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import { CHANGE_APPROVED } from '../../../packages/core/src/plan-choices.ts';
import { isOpening, OPENING_ASK } from '../../../packages/core/src/plan-opening.ts';
import { ANSWER_APPROVED, NOTE_APPROVED, type PlanTalk, proposalStale, proposalWords, TALK_MAX, type TalkProposal, type TalkQuote, type TalkTurn, type TalkWho } from '../../../packages/core/src/plan-talk.ts';
import { planVersion } from '../../../packages/core/src/plan.ts';
import { ANSWER_MAX, OPTIONS_MAX, QUESTIONS_MAX, turnQuestions } from '../../../packages/core/src/talk-questions.ts';
import { byName } from './plan.ts';
import { type Action, KEY, type Look, type ModelArea, type Ref, short } from './shared.ts';

/** What tells a page how Send, Use this or Open in Claude Code went. */
export const TALK_DONE = 'talk-done';

/** Who said it, as the page names them, with an icon. */
export const TALK_WHO: Record<TalkWho, { name: string; icon: string }> = {
  you: { name: 'You', icon: 'account' },
  agent: { name: 'Planning agent', icon: 'hubot' },
  'claude-code': { name: 'Claude Code', icon: 'terminal' },
  plan: { name: 'The plan', icon: 'history' },
};

/** How the section shows: nothing said yet, the agent working on a reply, or a conversation. */
export const TALK_LOOK: Record<'none' | 'running' | 'said', Look> = {
  none: { label: 'Not started', icon: 'comment-discussion', tone: 'neutral' },
  running: { label: 'The planning agent is replying', icon: 'sync~spin', tone: 'blue' },
  said: { label: 'Talked through', icon: 'comment-discussion', tone: 'blue' },
};

/** What the section says first: what talking does, and that nothing changes without the person. */
export const TALK_NOTE = 'Ask the planning agent why, push back on an option, or suggest another. It answers from the code and the org, and changes nothing: a change it proposes goes into the plan only when you use it.';

/** A reply's proposal on the page: what it would record, why, and Use this, or who used it. */
export interface TicketProposal {
  id: string;
  words: string;
  why: string;
  used: { by: string; at: string } | null;
  /** Use this: null once used, or past the build; off with why while it can't be used. */
  use: { disabled: string | null } | null;
  /** What the page asks first when using it changes an approved plan, or null. */
  ask: string | null;
  /** The plan's version it was made on, when that's older than the plan now: Use this refuses it, and the page offers to ask again. */
  from: number | null;
}

export interface TicketTurn {
  id: string;
  who: TalkWho;
  name: string;
  icon: string;
  /** The person, by name; null for the agent or the plan. */
  by: string | null;
  at: string;
  version: number;
  text: string;
  about: TalkQuote | null;
  proposals: TicketProposal[];
  /** For a Claude Code session: what it recorded. */
  recorded: string[];
  /** For a person's message the agent didn't answer: why. */
  failed: string | null;
  /** A Claude Code session that's open now. */
  open: boolean;
  /** Said before there was a plan (T-111): the page shows "Before the plan" for its version. */
  before: boolean;
  /** Its words run past about REPLY_LINES lines (T-113): the page folds them, with Show more. */
  long: boolean;
}

/** One of the agent's questions, as the panel asks it (T-113): its answers (at most OPTIONS_MAX), the suggestion first. Own words always go (D-T-114). */
export interface TicketQuestion {
  question: string;
  why: string;
  options: { label: string; suggested: boolean }[];
}

/** About how many lines of a reply show before it folds (T-113), and how many characters a line holds, as the panel's width reads. */
export const REPLY_LINES = 8;
const LINE_CHARS = 80;

/** Whether words run past about REPLY_LINES lines: a line each, and a long one wraps. */
export const longText = (text: string): boolean =>
  text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / LINE_CHARS)), 0) > REPLY_LINES;

/** What is under way for a plan being made from the conversation (T-111): its ticket being read, then the plan. */
export type Making = 'reading' | 'planning';

/** What the conversation says while a plan is made from it (T-111). */
export const MAKING_WORDS: Record<Making, string> = {
  reading: 'Reading the ticket, its comments too, before the plan.',
  planning: 'Making the plan from this conversation. Its steps show in the output panel.',
};

/** A task's conversation with its planning agent: in its own panel (T-111), and as one line on the task page. */
export interface TicketTalk {
  task: string;
  /** Before there is a plan, the opening conversation; once there is one, Talk it through (T-111). */
  stage: 'opening' | 'plan';
  look: Look;
  note: string;
  /** What it asks first, until something is said before the plan (T-111); else null. */
  ask: string | null;
  turns: TicketTurn[];
  /** The task page's one line (T-111): "Conversation · 12 messages", with when the last was said; null with nothing said. */
  line: { words: string; at: string } | null;
  /** Send, and Discuss on the plan: null past the build; off with why while a message can't go. */
  send: { disabled: string | null } | null;
  /** A reply is on its way: the page shows the agent working. */
  running: boolean;
  /** Make a new plan, as the plan section's: made again with the conversation. Null with nothing said, or past the build. */
  newPlan: Action | null;
  /** Open in Claude Code: null past the build; off with why while it can't. */
  claude: { disabled: string | null } | null;
  /** Draft the plan (T-111): the plan made with the conversation, before there is one; off with why while it can't. */
  draft: { disabled: string | null } | null;
  /** Skip to the plan (T-111): the plan made from the ticket alone, as before; off with why while it can't. */
  skip: { disabled: string | null } | null;
  /** A plan being made from it (T-111): its ticket being read, then the plan. */
  making: { phase: Making; words: string } | null;
  /**
   * The agent's questions waiting for the person (T-113): its last reply's, while nothing was said after it and
   * the plan is the version it asked about; `optionsMax` is the most answers a question lists before own words, and `answerMax` the longest own-words answer the box takes (D-T-114). Null with none, or past the build.
   */
  questions: { turn: string; items: TicketQuestion[]; optionsMax: number; answerMax: number } | null;
  /**
   * How many turns fold under "Earlier in this conversation" (T-113): all before the person's last message, so the
   * latest exchange shows; 0 when there's nothing earlier.
   */
  earlier: number;
}

export interface TalkIn {
  task: Pick<Task, 'id' | 'state'>;
  analysis: Analysis | null;
  analyzing: boolean;
  talk: PlanTalk;
  running: boolean;
  /** The Claude Code sessions opened from this window that are still open. */
  open: string[];
  ref: Ref;
  /** A plan being made from this window (T-111): its ticket being read, or the plan. */
  making?: Making | null;
}

/** The task page's words for a conversation (T-111): "Conversation · 1 message", "Conversation · 12 messages". */
export const conversationWords = (messages: number): string => `Conversation · ${messages} message${messages === 1 ? '' : 's'}`;

/** What the opening conversation says first, under its question (T-111). */
export const OPENING_NOTE = 'Say it in your own words. The planning agent reads the ticket, says what it understood, and asks a few questions, one at a time, before it makes the plan.';

/**
 * Why a proposal can't be used now, or null: it was made on an older version, whose choices the new one may
 * number differently, or the plan has changed under it since.
 */
function stale(p: TalkProposal, from: number, a: Analysis): string | null {
  if (from !== planVersion(a)) return proposalStale(from, planVersion(a));
  const d = a.decisions?.find((x) => x.id === p.decision);
  if ((p.kind === 'choose' || p.kind === 'own') && !d) return 'The plan has no such choice any more.';
  if (p.kind === 'choose' && !d!.options.some((o) => o.name === p.option)) return `${p.option} isn't an option in the plan any more.`;
  if (p.kind === 'answer' && !a.questions.some((q) => q.id === p.question)) return 'The plan has no such question any more.';
  return null;
}

/** What using a proposal asks first on an approved plan, in acc's words, or null when it changes nothing. */
function askFirst(p: TalkProposal, a: Analysis): string | null {
  if (!a.approval) return null;
  if (p.kind === 'note') return NOTE_APPROVED;
  if (p.kind === 'answer') return ANSWER_APPROVED;
  const d = a.decisions?.find((x) => x.id === p.decision);
  const same = p.kind === 'choose' ? d?.choice?.option === d?.options.find((o) => o.name === p.option)?.id : d?.choice?.option === null && d.choice.text === p.text;
  return same ? null : CHANGE_APPROVED;
}

/** A turn's words, and what a reply kept before T-113 was unsure of, under them. */
const words = (t: TalkTurn): string => (t.unsure?.length ? `${t.text}\n\nNot sure yet:\n${t.unsure.map((u) => `- ${u}`).join('\n')}` : t.text);

/** The questions the agent's last reply asks, while they wait for the person; else null. */
function openQuestions(i: TalkIn, todo: boolean): TicketTalk['questions'] {
  const last = i.talk.turns.at(-1);
  const items = last?.who === 'agent' ? turnQuestions(last) : [];
  const version = i.analysis ? planVersion(i.analysis) : 0;
  if (!todo || !last || !items.length || last.version !== version) return null;
  return { turn: last.id, items: items.map((q) => ({ question: q.question, why: q.why, options: q.options.slice(0, OPTIONS_MAX).map((label, k) => ({ label, suggested: k === 0 })) })), optionsMax: OPTIONS_MAX, answerMax: ANSWER_MAX };
}

/** The turns before the person's last message, which fold (T-113); with no message of theirs, all but the last. */
function earlierTurns(t: PlanTalk): number {
  const last = t.turns.map((x) => x.who).lastIndexOf('you');
  return last >= 0 ? last : Math.max(0, t.turns.length - 1);
}

/** Each turn as the page shows it, with its proposals' Use this; before there is a plan, it has none. */
function ticketTurns(i: TalkIn, todo: boolean, busy: string | null): TicketTurn[] {
  const a = i.analysis;
  return i.talk.turns.map((t) => ({
    id: t.id, who: t.who, ...TALK_WHO[t.who], by: t.who === 'you' || t.who === 'claude-code' ? byName(t.by) : null, at: t.at, version: t.version, text: words(t), about: t.about ?? null,
    proposals: a ? (t.proposals ?? []).map((p) => ({
      id: p.id, words: proposalWords(p, a), why: p.why, used: p.used ? { by: byName(p.used.by), at: p.used.at } : null,
      use: p.used || !todo ? null : { disabled: stale(p, t.version, a) ?? busy },
      ask: p.used ? null : askFirst(p, a),
      from: !p.used && t.version !== planVersion(a) ? t.version : null,
    })) : [],
    recorded: t.recorded ?? [], failed: t.failed ?? null, open: t.who === 'claude-code' && !!t.sessionId && i.open.includes(t.sessionId),
    before: isOpening(t), long: longText(words(t)),
  }));
}

/**
 * A task's conversation with its planning agent. Before there is a plan, the opening conversation (T-111): its
 * question first, Send, Draft the plan and Skip to the plan. With a plan, Talk it through (T-98): Send, Make a
 * new plan and Open in Claude Code. Each is only before the build. Null past the build with nothing said.
 */
export function ticketTalk(i: TalkIn): TicketTalk | null {
  const a = i.analysis;
  const todo = i.task.state === 'todo';
  if (!a && !todo && !i.talk.turns.length) return null;
  const making = i.making ?? (i.analyzing ? 'planning' : null);
  const busy = making ? 'Its plan is being made. Wait for it to finish.' : i.running ? 'Wait for the planning agent\'s reply.' : null;
  const said = i.talk.turns.some((t) => t.who === 'you' || t.who === 'claude-code');
  const messages = i.talk.turns.filter((t) => t.who !== 'plan').length;
  const last = i.talk.turns.at(-1);
  const opening = !a;
  const before = i.talk.turns.some((t) => t.who === 'you' && isOpening(t));
  return {
    task: i.task.id,
    stage: opening ? 'opening' : 'plan',
    look: i.running ? TALK_LOOK.running : i.talk.turns.length ? TALK_LOOK.said : TALK_LOOK.none,
    note: opening ? OPENING_NOTE : TALK_NOTE,
    ask: opening && !before ? OPENING_ASK : null,
    turns: ticketTurns(i, todo, busy),
    line: messages && last ? { words: conversationWords(messages), at: last.at } : null,
    send: todo ? { disabled: busy } : null,
    running: i.running,
    newPlan: !opening && todo && said ? { command: 'acc.task.analyze', label: 'Make a new plan', icon: 'refresh', ref: i.ref, ...(busy ? { disabled: busy } : {}) } : null,
    claude: !opening && todo ? { disabled: i.analyzing ? 'Its plan is being made. Wait for it to finish.' : null } : null,
    draft: opening && todo ? { disabled: busy ?? (before ? null : 'Say what you\'re thinking first, or skip to the plan.') } : null,
    skip: opening && todo ? { disabled: busy } : null,
    making: making ? { phase: making, words: MAKING_WORDS[making] } : null,
    questions: openQuestions(i, todo),
    earlier: earlierTurns(i.talk),
  };
}

/** A reference to a part of the plan a message can be about: a choice, an option, a step, a risk or a question. */
export const TALK_REF = /^(d\d{1,3}(\.[a-z])?|[srq]\d{1,3})$/;

export type Message =
  /** A person's message to the planning agent (T-98), about a part of the plan when `about` names one. */
  | { type: 'talk-send'; project: string; task: string; text: string; about?: string }
  /** Use this: a reply's proposal, recorded as the person's (T-98). `yes` when it changes an approved plan. */
  | { type: 'talk-use'; project: string; task: string; turn: string; proposal: string; yes?: true }
  /** Open in Claude Code (T-98): the plan, in plan mode, in the project's main checkout. */
  | { type: 'talk-claude'; project: string; task: string }
  /** The person's answers to a reply's questions (T-113), together: an option by its place, own words, or null for skipped. */
  | { type: 'talk-answers'; project: string; task: string; turn: string; answers: TalkAnswerIn[] };

/** One answer as the page sends it. */
export type TalkAnswerIn = { option: number } | { text: string } | null;

/** An answer the page may send: skipped, one of at most OPTIONS_MAX options, or own words no longer than ANSWER_MAX. */
const answerOk = (a: unknown): boolean => a === null || (typeof a === 'object' && !Array.isArray(a) && (
  Object.keys(a).join() === 'option' ? Number.isInteger((a as { option: unknown }).option) && (a as { option: number }).option >= 0 && (a as { option: number }).option < OPTIONS_MAX
    : Object.keys(a).join() === 'text' && short((a as { text: unknown }).text, ANSWER_MAX)));

const forTask = (x: Record<string, unknown>): boolean => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string);

export const area: ModelArea = {
  messages: {
    'talk-send': (x) => forTask(x) && short(x.text, TALK_MAX) && !!(x.text as string).trim() && (x.about === undefined || (typeof x.about === 'string' && TALK_REF.test(x.about))),
    'talk-use': (x) => forTask(x) && typeof x.turn === 'string' && /^t\d{1,5}$/.test(x.turn) && typeof x.proposal === 'string' && /^p\d{1,3}$/.test(x.proposal) && (x.yes === undefined || x.yes === true),
    'talk-claude': forTask,
    'talk-answers': (x) => forTask(x) && typeof x.turn === 'string' && /^t\d{1,5}$/.test(x.turn) && Array.isArray(x.answers) && x.answers.length >= 1 && x.answers.length <= QUESTIONS_MAX && x.answers.every(answerOk),
  },
};
