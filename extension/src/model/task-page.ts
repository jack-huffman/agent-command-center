/**
 * A ticket's page: the ticket, acc's side of it, and its analysis.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import type { Analysis } from '../../../packages/core/src/analyze.ts';
import { type RunNote, shownNote, type Task } from '../../../packages/core/src/ledger.ts';
import type { RatchetLimit, RatchetSpec } from '../../../packages/core/src/config.ts';
import { cardFailure } from '../../../packages/core/src/cards.ts';
import { type WordingFinding, wordingMatch, wordingPlace, wordingWords } from '../../../packages/core/src/ste.ts';
import { num, ratchetLine, signed } from '../../../packages/core/src/ratchets.ts';
import { type GateStatus, ratchetOf, type Receipt } from '../../../packages/core/src/receipts.ts';
import { testsText } from '../../../packages/core/src/test-counts.ts';
import { type Doc, fromMarkdown } from '../../../packages/core/src/trackers/doc.ts';
import type { Ticket, TrackerKind } from '../../../packages/core/src/trackers/types.ts';
import type { Update } from '../../../packages/core/src/updates.ts';
import { type AnalysisAsk, questionsWord, type TaskRow, type Tone } from '../logic/shared.ts';
import { reasonInWords } from '../logic/relayed.ts';
import { conflictLine, failedChecksLine } from '../logic/tasks.ts';
import { accLook, type BoardInput, CATEGORY_LOOK, chip, type PersonChip, priorityIcon, typeIcon } from './boards.ts';
import { type Action, displayLook, KEY, type Look, type ModelArea, type Ref, short } from './shared.ts';
import { cardActions, filesLook, placeLook } from './cards.ts';
import { hasTicket, type UpdateCard, updateCards, withClient } from './updates.ts';

// ---------------------------------------------------------------- a ticket's page (D-026)

/**
 * A ratchet's numbers on the page (GH-99): from the environment's floor where the branch began to this
 * commit's. `numbers` is what the row shows beside the gate's name, "669 → 674 (+5)", and `line` says it
 * with its label, as the pull request does, "tests 669 → 674 (+5)". Null until it's measured.
 */
export interface TicketRatchet {
  label: string;
  limit: RatchetLimit;
  from: number | null;
  to: number | null;
  diff: number | null;
  numbers: string | null;
  line: string | null;
}

/**
 * A check on the task branch's latest commit, as the page is given it. waived: a person set it aside on this
 * commit (D-031). scope: where the merge queue runs the full check, whether it's one of a builder's lighter
 * checks or the full one, run once in the queue (GH-73). counts: what its tests ran, "312 run, 2 skipped" or
 * "not read", and countsNote what that was compared with (GH-100). ratchet: a number that may only get
 * better, from the environment's floor to this commit's (GH-99).
 */
export interface CheckIn {
  gate: string;
  status: GateStatus;
  summary: string;
  waived?: boolean;
  scope?: 'builder' | 'merge';
  counts?: string;
  countsNote?: string;
  ratchet?: TicketRatchet;
}

/**
 * A check as the page is given it, from its receipt on the branch's latest commit, or `unrun` when there's
 * none: what its tests ran, as the pull request says it (GH-100), and a ratchet's numbers (GH-99).
 */
export function ticketCheck(gate: string, receipt: Pick<Receipt, 'status' | 'summary' | 'waived' | 'details' | 'counts' | 'countsNote'> | null, unrun: string, scope: { scope?: 'builder' | 'merge' }, ratchet?: RatchetSpec): CheckIn {
  const counted = receipt ? { ...(testsText(receipt) ? { counts: testsText(receipt) } : {}), ...(receipt.countsNote ? { countsNote: receipt.countsNote } : {}) } : {};
  const check: CheckIn = receipt ? { gate, status: receipt.status, summary: receipt.summary, waived: !!receipt.waived, ...scope, ...counted } : { gate, status: 'skip', summary: unrun, ...scope };
  if (!ratchet) return check;
  const d = ratchetOf(receipt);
  if (!d) return { ...check, ratchet: { label: ratchet.label, limit: ratchet.limit, from: null, to: null, diff: null, numbers: null, line: null } };
  const numbers = d.base === null ? `${num(d.value)}, the first ${d.limit}` : `${num(d.base)} → ${num(d.value)} (${signed(d.diff ?? d.value - d.base)})`;
  return { ...check, ratchet: { label: d.label, limit: d.limit, from: d.base, to: d.value, diff: d.diff, numbers, line: ratchetLine(d) } };
}

/** A check as the page shows it: its look, always with words, and whether a person can waive it here. */
export interface CheckRow extends CheckIn {
  look: Look;
  waivable: boolean;
}

/**
 * The checks with their looks. A person can set aside a failing one, or one that needs them, with a reason
 * (D-031). Not a ratchet: a person relaxes its floor instead, with acc gate relax (GH-99).
 */
export const checkRows = (checks: CheckIn[], branch: string | null): CheckRow[] =>
  checks.map((c) => ({ ...c, look: checkLook(c), waivable: !!branch && !c.waived && !c.ratchet && (c.status === 'fail' || c.status === 'error' || c.status === 'hold') }));

export interface TicketAcc {
  look: Look;
  environment: string;
  waitingOn: string[];
  blocker: string | null;
  /** Every file its open pull request conflicts in with its base, in one line, or null (D-049). */
  conflicts: string | null;
  /** "Checks failed on GitHub: …", or null (D-076). Not `checks`: those are acc's own, on its commit. */
  failedChecks: string | null;
  /** Why acc couldn't move its card on its GitHub Project as it entered this state (D-126), or null. */
  cardFailed: string | null;
  /** Its files beside other tasks', each file in full (D-093), or null. */
  files: Look | null;
  agent: Look | null;
  /** The model its agent runs with (D-086). */
  model: string | null;
  /** Its builder's effort, beside its model, only when one was named and isn't the model's default (D-128). */
  effort: string | null;
  /** What its latest builder was called (D-087). Older runs have none. */
  agentName: string | null;
  /** Where its builder runs (GH-69): This Mac or Cloud, with an icon; and a cloud builder's page on claude.ai. */
  place: Look | null;
  cloudUrl: string | null;
  worktree: string | null;
  branch: string | null;
  /** acc's checks on its commit, each with how its result shows (GH-105) and whether a person can waive it. */
  checks: CheckRow[];
  /** Each move, with the state it reached as core's DISPLAY shows it (GH-105). */
  history: { at: string; from: string | null; to: string; by: string; reason: string | null; look: Look }[];
  actions: Action[];
  /**
   * Its builder's handoff note (D-106): its run's, or while a new run is under way, the last run's
   * (fromLast). Each still-open line can be drafted as a task.
   */
  note: (Pick<RunNote, 'landed' | 'moved' | 'open' | 'at' | 'ended'> & { fromLast: boolean }) | null;
  /** That the run that ended, or the last one, left no note, in words; else null. */
  noteMissing: string | null;
}

export interface TicketModel {
  kind: 'ticket';
  project: string;
  tracker: number | null;
  key: string;
  title: string;
  url: string | null;
  sourceLabel: string;
  sourceKind: TrackerKind | 'acc';
  loading: boolean;
  error: string | null;
  /** Why the ticket isn't shown: it's outside the repo's place, and names it (D-072). */
  outside: string | null;
  connect: { command: string; label: string; arg: string } | null;
  type: string | null;
  typeIcon: string;
  status: { name: string; icon: string; tone: Tone } | null;
  assignees: PersonChip[];
  reporter: PersonChip | null;
  labels: { name: string; color: string | null }[];
  priority: string | null;
  priorityIcon: string | null;
  created: string | null;
  updated: string | null;
  body: Doc;
  comments: { id: string; author: PersonChip; created: string; body: Doc; url: string | null }[];
  related: { key: string; title: string; relation: string; url: string | null }[];
  /**
   * What the page may change in the tracker. Nothing, for a task acc alone keeps. A ticket's status,
   * assignee and labels only when its tracker says "edits": true; comments always (D-066).
   */
  can: { status: boolean; assign: boolean; labels: boolean; comment: boolean };
  /** Updates acc drafted for its ticket, waiting for a person to read, edit and post (D-066). */
  updates: UpdateCard[];
  acc: TicketAcc | null;
  /** What its analysis found (D-052), gist first. Null for a ticket acc doesn't keep, or one past needing it. */
  analysis: TicketAnalysis | null;
  /** A tracker ticket acc doesn't keep yet, which "Track in acc" adds to the ledger. */
  trackable: boolean;
  /** It's being tracked now, from this page or its card (D-074). */
  tracking: boolean;
  /** Who a comment or change is made as. */
  signedInAs: string | null;
}

/** A task's analysis as its page shows it (D-052): the verdict and summary, its questions, then the rest folded. */
export interface TicketAnalysis {
  /** The task its answers are for. */
  task: string;
  look: Look;
  /** Why there isn't one yet, or what a running one is doing. */
  note: string | null;
  summary: string | null;
  size: string | null;
  at: string | null;
  /** Questions nobody has answered, to answer right there: only before the build. */
  open: AnalysisAsk[];
  /** Whether its questions can be sent to the client: its task has a ticket to post on (D-066). */
  canAsk: boolean;
  /** What a person decided, and, once it's built, what its builder assumed for the rest. */
  decided: { question: string; answer: string; assumed: boolean }[];
  /** The smaller tasks it suggests, when it's too big for one. */
  split: string[];
  goal: string | null;
  criteria: string[];
  assumptions: string[];
  outOfScope: string[];
  findings: { area: string; detail: string; source: string }[];
  plan: string[];
  refactors: { what: string; why: string }[];
  risks: string[];
  tests: string[];
  files: { path: string; change: string; why: string }[];
  /**
   * The wording check's findings on its requirements (T-12), as advice: an orange state and each finding
   * with the line it came from, and the words it caught unless they are the whole line (a dangling "and"). Null when it has none, or an analysis older than the check.
   */
  wording: { look: Look; findings: { place: string; text: string; message: string; match: string | null }[] } | null;
  actions: Action[];
}

export interface TicketInput {
  project: string;
  tracker: number | null;
  trackerTitle: string | null;
  trackerKind: TrackerKind | null;
  key: string;
  ticket: Ticket | null;
  loading: boolean;
  error: string | null;
  /** The ticket is outside the repo's place (D-072), and why. */
  outside?: string | null;
  connect: TicketModel['connect'];
  row: TaskRow | null;
  task: Task | null;
  checks: CheckIn[];
  signedInAs?: string | null;
  /** Its analysis, read whole (D-052). */
  analysis?: Analysis | null;
  /** Its tracker says "edits": true, so the page may change status, assignee and labels (D-066). */
  trackerEdits?: boolean;
  /** The project's ticket updates; the page shows its task's. */
  updates?: Update[];
  /** The project's boards, for who an update posts as, and the project's GitHub account. */
  boards?: BoardInput[];
  github?: string | null;
  /** It's being tracked now, from its page or its card (D-074). */
  tracking?: boolean;
  now?: number;
}

/** How an analysis's wording findings show (T-12): orange, with an icon and their count. None shows nothing. */
export function wordingLook(n: number): Look | null {
  const label = wordingWords(n);
  return label ? { label, icon: 'whole-word', tone: 'orange' } : null;
}

/** The wording findings as the page lists them, each with where it came from. Null when there are none. */
export function ticketWording(findings: WordingFinding[] | undefined): TicketAnalysis['wording'] {
  const look = wordingLook(findings?.length ?? 0);
  return look ? { look, findings: findings!.map((f) => ({ place: wordingPlace(f), text: f.text, message: f.message, match: wordingMatch(f) })) } : null;
}

/**
 * The Analysis section of a task's page (D-052). A task to do shows it even with none yet, to start one;
 * a task past that shows the one it was built from, if it had one.
 */
export function ticketAnalysis(row: TaskRow, a: Analysis | null, ref: Ref, updates: Update[] = []): TicketAnalysis | null {
  const todo = row.state === 'todo';
  if (!a && !row.analyzing && !todo) return null;
  const open = todo ? withClient((a?.questions ?? []).filter((q) => !q.answer).map(({ id, question, why, suggested }) => ({ id, question, why, suggested })), row.id, updates) : [];
  const look: Look = row.analyzing ? { label: 'Analyzing', icon: 'sync~spin', tone: 'blue' }
    : !a ? { label: 'Not analyzed yet', icon: 'circle-large-outline', tone: 'neutral' }
      : !todo ? { label: 'Analyzed before the build', icon: 'pass', tone: 'blue' }
        : a.verdict === 'split' ? { label: 'Too big for one task', icon: 'split-horizontal', tone: 'orange' }
          : open.length ? { label: `${questionsWord(open.length)} for you`, icon: 'question', tone: 'orange' }
            : { label: 'Ready to build', icon: 'pass', tone: 'blue' };
  const note = row.analyzing ? 'An analyst is reading the ticket and the code. It changes nothing.'
    : a ? null
      : row.analysisRequired ? 'This project wants an analysis before a task is built: what it asks for, what\'s there now, and how to build it.'
        : 'An analyst can work out what it asks for, what\'s there now, and how to build it, before an agent builds it.';
  const actions: Action[] = [];
  if (row.analyzing) actions.push({ command: 'acc.task.watchAnalysis', label: 'Watch the analysis', icon: 'pulse', ref, primary: true });
  // acc analyzes before a build, or after one is set aside: never while it's being built, nor once it's done.
  else if (!a && todo) actions.push({ command: 'acc.task.analyze', label: 'Analyze', icon: 'telescope', ref, primary: !!row.analysisRequired });
  else if (a && row.state !== 'running' && row.state !== 'done') actions.push({ command: 'acc.task.analyze', label: 'Analyze again', icon: 'refresh', ref });
  const decided = (a?.questions ?? []).flatMap((q) => (q.answer ? [{ question: q.question, answer: q.answer.text, assumed: false }] : todo ? [] : [{ question: q.question, answer: q.suggested, assumed: true }]));
  return {
    task: row.id, look, note, summary: a?.summary ?? null, size: a?.approach.size ?? null, at: a?.at ?? null, open, canAsk: hasTicket(row.source.kind), decided, split: a?.verdict === 'split' ? a.split : [],
    goal: a?.requirements.goal || null, criteria: a?.requirements.criteria ?? [], assumptions: a?.requirements.assumptions ?? [], outOfScope: a?.requirements.outOfScope ?? [],
    findings: a?.findings ?? [], plan: a?.approach.plan ?? [], refactors: a?.approach.refactors ?? [], risks: a?.approach.risks ?? [], tests: a?.approach.tests ?? [], files: a?.approach.files ?? [],
    wording: ticketWording(a?.wording), actions,
  };
}

/** A task's note as its page shows it (D-106), and what it says when its run left none. */
function ticketNote(task: Task): Pick<TicketAcc, 'note' | 'noteMissing'> {
  const { note, fromLast, missing } = shownNote(task);
  return {
    note: note ? { landed: note.landed, moved: note.moved, open: note.open, at: note.at, ended: note.ended, fromLast } : null,
    noteMissing: !missing ? null
      : fromLast ? 'Its last run left no note, so this run was told to check its branch before building on it.'
        : 'Its builder left no note when its run ended. Check its branch before trusting what\'s there.',
  };
}

/**
 * How a check's result shows (GH-105): a pass in blue, a skip or a waiver neutral, anything a person should
 * look at orange, each with its own icon and words. A hold is one that ran no tests, or skipped more than
 * before, so a person decides (GH-100).
 */
export const CHECK_LOOK: Record<GateStatus | 'waived' | 'not run', Look> = {
  pass: { label: 'pass', icon: 'pass', tone: 'blue' },
  fail: { label: 'fail', icon: 'error', tone: 'orange' },
  error: { label: 'error', icon: 'warning', tone: 'orange' },
  hold: { label: 'needs a person', icon: 'person', tone: 'orange' },
  skip: { label: 'skip', icon: 'circle-slash', tone: 'neutral' },
  'not run': { label: 'not run', icon: 'circle-slash', tone: 'neutral' },
  waived: { label: 'waived', icon: 'debug-step-over', tone: 'neutral' },
};

/** A check's look: waived, or a skip that never ran, before its status. */
export const checkLook = (c: Pick<CheckIn, 'status' | 'summary'> & Partial<CheckIn>): Look =>
  CHECK_LOOK[c.waived ? 'waived' : c.status === 'skip' && c.summary.startsWith('Not run') ? 'not run' : c.status];

export function ticketModel(i: TicketInput): TicketModel {
  const t = i.ticket;
  const live = i.tracker !== null;
  const acc: TicketAcc | null = i.row && i.task ? {
    look: accLook(i.row, true), environment: i.task.environment, waitingOn: i.row.deps, blocker: reasonInWords(i.task.blocker), conflicts: conflictLine(i.row, true), failedChecks: failedChecksLine(i.row), cardFailed: reasonInWords(cardFailure(i.task)?.replace(/[.\s]+$/, '')), files: filesLook(i.row, true),
    agent: i.row.stopped ? null : i.row.agent ?? null, model: i.row.model ?? null, effort: i.row.effort ?? null, agentName: i.task.run?.name ?? null, place: placeLook(i.row), cloudUrl: i.row.cloud?.url ?? null, worktree: i.task.run?.worktree ?? null, branch: i.task.run?.branch ?? null, checks: checkRows(i.checks, i.task.run?.branch ?? null),
    // Why it blocked or moved, whoever wrote it, in process words (GH-163).
    history: i.task.history.map((h) => ({ at: h.at, from: h.from, to: h.to, by: h.by, reason: reasonInWords(h.reason), look: displayLook(h.to) })).reverse(),
    // Its analysis has its own section, with its own buttons.
    actions: cardActions(i.row, { project: i.project, task: i.row.id }).filter((a) => !['acc.task.show', 'acc.task.openTicket', 'acc.task.analyze', 'acc.task.watchAnalysis'].includes(a.command)),
    ...ticketNote(i.task),
  } : null;
  const own = !live && i.task;
  return {
    kind: 'ticket', project: i.project, tracker: i.tracker, key: t?.key ?? i.key,
    title: t?.title ?? i.task?.title ?? i.key, url: t?.url ?? i.task?.source.url ?? null,
    sourceLabel: i.trackerTitle ?? 'Task kept by acc', sourceKind: t?.kind ?? i.trackerKind ?? 'acc',
    loading: i.loading, error: i.error, outside: i.outside ?? null, connect: i.connect,
    type: t?.type ?? null, typeIcon: typeIcon(t?.type ?? null),
    status: t ? { name: t.status.name, ...CATEGORY_LOOK[t.status.category] } : acc ? { name: acc.look.label, icon: acc.look.icon, tone: acc.look.tone } : null,
    assignees: (t?.assignees ?? []).map(chip), reporter: t?.reporter ? chip(t.reporter) : null,
    labels: t?.labels ?? (i.task?.labels ?? []).map((name) => ({ name, color: null })),
    priority: t?.priority ?? null, priorityIcon: priorityIcon(t?.priority ?? null),
    created: t?.created ?? i.task?.createdAt ?? null, updated: t?.updated ?? i.task?.updatedAt ?? null,
    body: t?.body ?? (own ? fromMarkdown(i.task!.brief) : { blocks: [] }),
    comments: (t?.comments ?? []).map((c) => ({ id: c.id, author: chip(c.author), created: c.created, body: c.body, url: c.url })),
    related: t?.related ?? (i.task?.deps ?? []).map((d) => ({ key: d, title: '', relation: 'depends on', url: null })),
    // A client's tracker is theirs: the page changes its fields only where the tracker opts in (D-066).
    can: { status: !!t && !!i.trackerEdits, assign: !!t && !!i.trackerEdits, labels: !!t && !!i.trackerEdits, comment: !!t },
    updates: i.task ? updateCards(i.project, (i.updates ?? []).filter((u) => u.task === i.task!.id), i.github ?? null, i.boards ?? [], () => i.tracker, i.now) : [],
    acc, analysis: i.row && i.task ? ticketAnalysis(i.row, i.analysis ?? null, { project: i.project, task: i.row.id }, i.updates ?? []) : null,
    trackable: !!t && !i.task, tracking: !!i.tracking, signedInAs: i.signedInAs ?? null,
  };
}

/** task: draft a task from one of its note's still-open lines (D-106), which a person confirms. */
export const TICKET_ACTIONS = ['comment', 'status', 'assign', 'labels', 'track', 'refresh', 'waive', 'task'] as const;
export type TicketAction = (typeof TICKET_ACTIONS)[number];

/**
 * Why a ticket page refuses an action, or null. Status, assignee and labels change only where the
 * tracker says "edits": true, even when a page sends them anyway; comments always may (D-066).
 */
export function ticketActionRefusal(action: string, edits: boolean): string | null {
  if (edits || !['status', 'assign', 'labels'].includes(action)) return null;
  return 'This tracker\'s tickets are read-only here. Set "edits": true on it in the project\'s settings to change status, assignee and labels. On GitHub, a refresh from GitHub then also closes a task\'s issue when its work merges.';
}

export type Message =
  /** Open a ticket's page. tracker is null for a task acc alone keeps. */
  | { type: 'ticket'; project: string; tracker: number | null; key: string }
  | { type: 'ticket-action'; action: TicketAction; text?: string }
  /** A person's answer to one of a task's analysis's questions (D-052). acc records it; the page never writes it. */
  | { type: 'analysis-answer'; project: string; task: string; question: string; text: string };

export const area: ModelArea = {
  messages: {
    ticket: (x) => short(x.project, 4096) && short(x.key, 100) && KEY.test(x.key as string) && (x.tracker === null || Number.isInteger(x.tracker)),
    'ticket-action': (x) => (TICKET_ACTIONS as readonly string[]).includes(x.action as string) && (x.text === undefined || (typeof x.text === 'string' && x.text.length <= 65_536)),
    'analysis-answer': (x) => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string) && typeof x.question === 'string' && /^q\d{1,3}$/.test(x.question) && short(x.text, 4000) && !!(x.text as string).trim(),
  },
};
