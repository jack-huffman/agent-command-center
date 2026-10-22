/**
 * Talk it through, on a task's page (T-98): the person's messages to the planning agent and its replies, each
 * with who and when, what a message is about quoted, each change a reply proposes with Use this, and what a
 * Claude Code session opened on the plan recorded. Send, Make a new version and Open in Claude Code, each off
 * with why when they can't be used. Plain data and the messages' checks: no vscode import.
 */

import type { Analysis } from '../../../packages/core/src/analyze.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import { CHANGE_APPROVED } from '../../../packages/core/src/plan-choices.ts';
import { ANSWER_APPROVED, NOTE_APPROVED, type PlanTalk, proposalWords, TALK_MAX, type TalkProposal, type TalkQuote, type TalkWho } from '../../../packages/core/src/plan-talk.ts';
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
}

/** The task page's Talk it through section. */
export interface TicketTalk {
  task: string;
  look: Look;
  note: string;
  turns: TicketTurn[];
  /** Send, and Discuss on the plan: null past the build; off with why while a message can't go. */
  send: { disabled: string | null } | null;
  /** A reply is on its way: the page shows the agent working. */
  running: boolean;
  /** Make a new version: the plan made again with the conversation. Null with nothing said, or past the build. */
  newVersion: Action | null;
  /** Open in Claude Code: null past the build; off with why while it can't. */
  claude: { disabled: string | null } | null;
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
}

/** Why a proposal can't be used now, or null: the plan has changed under it since. */
function stale(p: TalkProposal, a: Analysis): string | null {
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

/**
 * The section for a task with a plan: its conversation, and Send, Make a new version and Open in Claude Code,
 * which are only before the build. Null with no plan to talk about.
 */
export function ticketTalk(i: TalkIn): TicketTalk | null {
  const a = i.analysis;
  if (!a) return null;
  const todo = i.task.state === 'todo';
  const busy = i.analyzing ? 'Its plan is being made. Wait for it to finish.' : i.running ? 'Wait for the planning agent\'s reply.' : null;
  const said = i.talk.turns.some((t) => t.who === 'you' || t.who === 'claude-code');
  return {
    task: i.task.id,
    look: i.running ? TALK_LOOK.running : i.talk.turns.length ? TALK_LOOK.said : TALK_LOOK.none,
    note: TALK_NOTE,
    turns: i.talk.turns.map((t) => ({
      id: t.id, who: t.who, ...TALK_WHO[t.who], by: t.who === 'you' || t.who === 'claude-code' ? byName(t.by) : null, at: t.at, version: t.version, text: t.text, about: t.about ?? null,
      proposals: (t.proposals ?? []).map((p) => ({
        id: p.id, words: proposalWords(p, a), why: p.why, used: p.used ? { by: byName(p.used.by), at: p.used.at } : null,
        use: p.used || !todo ? null : { disabled: busy ?? stale(p, a) },
        ask: p.used ? null : askFirst(p, a),
      })),
      recorded: t.recorded ?? [], failed: t.failed ?? null, open: t.who === 'claude-code' && !!t.sessionId && i.open.includes(t.sessionId),
    })),
    send: todo ? { disabled: busy } : null,
    running: i.running,
    newVersion: todo && said ? { command: 'acc.task.analyze', label: 'Make a new version', icon: 'refresh', ref: i.ref, ...(busy ? { disabled: busy } : {}) } : null,
    claude: todo ? { disabled: i.analyzing ? 'Its plan is being made. Wait for it to finish.' : null } : null,
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
  | { type: 'talk-claude'; project: string; task: string };

const forTask = (x: Record<string, unknown>): boolean => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string);

export const area: ModelArea = {
  messages: {
    'talk-send': (x) => forTask(x) && short(x.text, TALK_MAX) && !!(x.text as string).trim() && (x.about === undefined || (typeof x.about === 'string' && TALK_REF.test(x.about))),
    'talk-use': (x) => forTask(x) && typeof x.turn === 'string' && /^t\d{1,5}$/.test(x.turn) && typeof x.proposal === 'string' && /^p\d{1,3}$/.test(x.proposal) && (x.yes === undefined || x.yes === true),
    'talk-claude': forTask,
  },
};
