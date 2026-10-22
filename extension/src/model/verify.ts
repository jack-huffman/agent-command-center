/**
 * Verify the developer's work on a task's page (T-84): a TA checks a tracked ticket that someone else
 * built. The section shows the pull request acc found, or the ones to choose from, each check with its
 * icon and label, each criterion met or not, the findings, and "Open the QA comment", which goes to the
 * comment's update draft in the page's Activity, to edit and post. It's off, with why, for a task acc's own
 * builder made, a task with no tracker ticket, a project with no GitHub repo, and while one runs. Plain data
 * and the messages' checks: no vscode import, so it's testable.
 */

import type { Task } from '../../../packages/core/src/ledger.ts';
import { plural } from '../../../packages/core/src/text.ts';
import type { Update } from '../../../packages/core/src/updates.ts';
import { OWN_WORK, prWords, type PrChoice, type Verification, verifyRefusal } from '../../../packages/core/src/verify.ts';
import { CRITERION_LOOK } from './dock-review.ts';
import { KEY, type Look, type ModelArea, short } from './shared.ts';
import { CHECK_LOOK, REVIEW_LOOK } from './task-page.ts';

/** What tells a page how its Verify, its choice of pull request, or its Clear went. */
export const VERIFY_DONE = 'verify-done';

/** How the section shows: not verified yet, under way, a pull request to choose, or the verdict. */
export const VERIFY_LOOK: Record<'none' | 'running' | 'choose' | 'off' | 'pass' | 'changes', Look> = {
  none: { label: 'Not verified yet', icon: 'circle-large-outline', tone: 'neutral' },
  running: { label: 'Verifying', icon: 'sync~spin', tone: 'blue' },
  choose: { label: 'Choose its pull request', icon: 'git-pull-request', tone: 'orange' },
  off: { label: 'Off', icon: 'circle-slash', tone: 'neutral' },
  pass: REVIEW_LOOK.pass,
  changes: REVIEW_LOOK.changes,
};

/** A button of the section: its label, and why it's off, or null when it's on. */
export interface VerifyButton {
  label: string;
  disabled: string | null;
}

/** A pull request acc found, as the choice lists it: Verify this one sends its number. */
export interface VerifyChoice {
  number: number;
  url: string;
  words: string;
}

/** The task page's Verify the developer's work section. */
export interface TicketVerify {
  task: string;
  look: Look;
  /** What the section says before a verification, while one runs, or why it's off. */
  note: string | null;
  /** The pull request verified, as words and its link. Null before the first. */
  pr: { number: number; url: string; words: string; sha: string } | null;
  at: string | null;
  /** The verifier's sentences: pass, or what needs to change. */
  summary: string | null;
  /** The pull requests to choose from, when acc found several; empty when it found none. Null when there's no choice to make. */
  choice: VerifyChoice[] | null;
  checks: { gate: string; look: Look; summary: string }[];
  criteria: { text: string; evidence: string; look: Look }[];
  findings: { message: string; place: string | null; look: Look }[];
  /** The QA comment's wording findings that stayed after the verifier's fix: orange, with their count. */
  wording: Look | null;
  verify: VerifyButton;
  /** Open the QA comment: the update draft it goes to, or why it can't. Null before the first verification. */
  comment: (VerifyButton & { update: string | null }) | null;
  /** Clear the verification: its worktree and what it kept. Null with nothing to clear. */
  clear: VerifyButton | null;
}

export interface VerifyIn {
  task: Pick<Task, 'id' | 'source' | 'run'>;
  /** The project's GitHub repo, where acc looks for the pull request. Null with none. */
  github: string | null;
  verification: Verification | null;
  choice: PrChoice | null;
  verifying: boolean;
  /** The task's updates, so Open the QA comment knows whether its draft still waits. */
  updates: Pick<Update, 'id' | 'state'>[];
}


/** Why Open the QA comment can't go to its draft, or null: there must be one, and it must still wait for a person. */
export function commentRefusal(v: Pick<Verification, 'update' | 'key'>, updates: Pick<Update, 'id' | 'state'>[]): string | null {
  if (!v.update) return `${v.key} can't take an update, so there is no QA comment.`;
  const u = updates.find((x) => x.id === v.update);
  if (!u) return 'Its draft is gone. Verify again for a new one.';
  if (u.state === 'posted') return 'You posted it.';
  if (u.state === 'discarded') return 'You discarded it. Verify again for a new one.';
  return null;
}

/**
 * The section for a task's page: off with why for a task acc's builder made, one with no tracker ticket,
 * or a project with no GitHub repo; otherwise the latest verification, the choice of pull request, or how
 * to start. While one runs, its buttons are off.
 */
export function ticketVerify(i: VerifyIn): TicketVerify {
  const id = i.task.id;
  const why = verifyRefusal(i.task, id, { github: i.github });
  const off = (note: string): TicketVerify => ({
    task: id, look: VERIFY_LOOK.off, note, pr: null, at: null, summary: null, choice: null, checks: [], criteria: [], findings: [], wording: null,
    verify: { label: 'Verify the developer\'s work', disabled: note }, comment: null, clear: null,
  });
  if (why) return off(i.task.run ? `${OWN_WORK}: this task's review is in its Agent panel.` : why);
  const v = i.verification;
  const busy = i.verifying ? 'It\'s verifying now' : null;
  const choosing = !i.verifying && !!i.choice;
  const look = i.verifying ? VERIFY_LOOK.running : choosing ? VERIFY_LOOK.choose : v ? VERIFY_LOOK[v.verdict] : VERIFY_LOOK.none;
  const note = i.verifying ? 'The Command Center checks out the pull request with no branch, runs the checks there, and an agent reviews it. Nothing is posted or pushed.'
    : choosing ? (i.choice!.found.length ? `${plural(i.choice!.found.length, 'open pull request')} name ${i.task.source.key}. Choose the one to verify.` : `No open pull request on ${i.github} names ${i.task.source.key} in its title or its branch.`)
      : v ? null : 'The Command Center finds the pull request that names this ticket, runs the checks on it, and an agent reviews it against the criteria. You get a QA comment to edit and post.';
  return {
    task: id, look, note,
    pr: v ? { number: v.pr.number, url: v.pr.url, words: prWords(v.pr), sha: v.sha.slice(0, 7) } : null,
    at: v?.at ?? null, summary: v?.summary ?? null,
    choice: choosing ? i.choice!.found.map((p) => ({ number: p.number, url: p.url, words: prWords(p) })) : null,
    checks: (v?.checks ?? []).map((c) => ({ gate: c.gate, look: CHECK_LOOK[c.status], summary: c.summary })),
    criteria: (v?.criteria ?? []).map((c) => ({ text: c.text, evidence: c.evidence, look: c.met ? CRITERION_LOOK.met : CRITERION_LOOK.unmet })),
    findings: (v?.findings ?? []).map((f) => ({ message: f.message, place: f.file ? `${f.file}${f.line ? `:${f.line}` : ''}` : null, look: f.must ? REVIEW_LOOK.must : REVIEW_LOOK.worth })),
    wording: v?.wording.length ? { label: `Wording: ${plural(v.wording.length, 'finding')}`, icon: 'whole-word', tone: 'orange' } : null,
    verify: { label: v ? 'Verify again' : choosing ? 'Look again' : 'Verify the developer\'s work', disabled: busy },
    comment: v ? { label: 'Open the QA comment', update: v.update, disabled: busy ?? commentRefusal(v, i.updates) } : null,
    clear: v || choosing ? { label: 'Clear', disabled: busy } : null,
  };
}

/** The ways a page asks: verify (with the pull request a person chose, or none), or clear. */
export const VERIFY_ACTIONS = ['verify-run', 'verify-clear'] as const;

export type Message =
  /** A task page's Verify the developer's work, Verify again, Look again, or Verify this one with its number (T-84). */
  | { type: 'verify-run'; project: string; task: string; pr?: number }
  /** A task page's Clear: the verification's worktree and what it kept (T-84). */
  | { type: 'verify-clear'; project: string; task: string };

const forTask = (x: Record<string, unknown>): boolean => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string);

export const area: ModelArea = {
  messages: {
    'verify-run': (x) => forTask(x) && (x.pr === undefined || (Number.isInteger(x.pr) && (x.pr as number) > 0)),
    'verify-clear': forTask,
  },
};
