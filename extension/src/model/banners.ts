/**
 * The task page's banners above its tabs (T-168): what the page needs to draw them that a notice's words don't
 * hold. The files a task shares with others, each task's in full, so the banner can count them and list them; and
 * whether a person can answer its blocked builder from the page, with why not. A blocked banner's answer goes to
 * the builder's own session, as the Agent panel's reply does (D-060). Plain data: no vscode import, so it's testable.
 */

import type { FileShare, Task } from '../../../packages/core/src/ledger.ts';
import { sessionFor } from '../logic/agents.ts';
import type { AgentSession, TaskRow } from '../logic/shared.ts';
import { KEY, type ModelArea, short } from './shared.ts';

/** Whether a person can answer the task's blocked builder from its page, and why not when they can't. */
export interface BlockedReply {
  can: boolean;
  why: string | null;
}

/** Why an answer can't go to a builder that runs in the cloud (GH-69): its session isn't on this machine. */
export const REPLY_CLOUD = 'Its builder runs in the cloud. Answer it on its page on claude.ai.';
/** Why an answer can't go to a builder with no session recorded: there's no conversation to carry on. */
export const REPLY_NO_SESSION = 'Its builder has no conversation to carry on. Resume its builder, or dispatch it again.';

/**
 * Whether its builder's session can take an answer from the page: a local run with a session acc recorded. A cloud
 * builder's session is on claude.ai, and a task never dispatched, or one whose run has no session, has none.
 */
export function blockedReply(task: Pick<Task, 'run'>): BlockedReply {
  const run = task.run;
  if (run?.where === 'cloud') return { can: false, why: REPLY_CLOUD };
  if (!run?.sessionId) return { can: false, why: REPLY_NO_SESSION };
  return { can: true, why: null };
}

/**
 * The session a blocked banner's answer goes to: its builder's, as `claude agents` lists it, else the session acc
 * recorded for its run, in its worktree. Null where blockedReply says it can't take one.
 */
export function answerSession(task: Pick<Task, 'id' | 'run'>, root: string, sessions: AgentSession[]): AgentSession | null {
  if (!blockedReply(task).can) return null;
  const run = task.run!;
  return sessionFor(task, sessions) ?? { cwd: run.worktree ?? root, kind: 'background', startedAt: Date.now(), sessionId: run.sessionId!, name: run.name ?? task.id };
}

/** The files it shares with tasks in flight, each task's in full; none once it's done, as its card says nothing then (D-093). */
export const sharedFiles = (row: Pick<TaskRow, 'state' | 'files'>): FileShare[] => (row.state === 'done' ? [] : row.files?.shares ?? []);

/** The longest answer the page sends a builder: a person's own words, with the question it answers. */
export const ANSWER_MAX = 4000;

export type Message =
  /** A person's answer to the task's blocked builder (T-168), from the banner's choice: it goes to the builder's session. */
  | { type: 'blocked-answer'; project: string; task: string; item: number; text: string };

/** What the page hears back (T-168): the answer to `item` of the note went to the builder, or why it didn't. */
export interface BlockedAnswered { type: 'blocked-answered'; project: string; task: string; item: number; ok: boolean; error?: string }

export const area: ModelArea = {
  messages: {
    'blocked-answer': (x) => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string) && Number.isInteger(x.item) && (x.item as number) >= 0 && (x.item as number) < 100 && short(x.text, ANSWER_MAX) && !!(x.text as string).trim(),
  },
};
