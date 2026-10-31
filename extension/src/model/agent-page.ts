/**
 * An agent's page: its timeline, its question, and replying to it.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { type Doc, fromMarkdown } from '../../../packages/core/src/trackers/doc.ts';
import { agentLook, sessionFor } from '../logic/agents.ts';
import { sessionDoing } from '../logic/doing.ts';
import type { AgentSession, Tone } from '../logic/shared.ts';
import type { Entry } from '../transcript.ts';
import { sessionFolders } from './agents.ts';
import { type Decision, decisionOf } from './history.ts';
import { type QuestionCard, questionCards } from './questions.ts';
import { type Action, type HubLike, type Look, type ModelArea, nameOf, type Ref, sessionKey } from './shared.ts';

// ---------------------------------------------------------------- an agent's page (D-030)

export type EntryView =
  /** Your decision on one of its questions (D-037), in the timeline where it happened. */
  | { k: 'decision'; id: string; at: string | null; decision: Decision }
  | { k: 'prompt'; id: string; at: string | null; body: Doc; instructions: boolean }
  | { k: 'say'; id: string; at: string | null; body: Doc }
  | { k: 'recap'; id: string; at: string | null; text: string }
  | Extract<Entry, { k: 'tool' }>;

export interface AgentModel {
  kind: 'agent';
  key: string;
  name: string;
  /** The task it works on, when it's a builder. */
  task: { id: string; title: string; project: string } | null;
  look: Look;
  /** False once Claude Code no longer lists the session. */
  live: boolean;
  background: boolean;
  /** Its folder in context, as its Agents row says it, and the whole folder for the hover (GH-83). */
  where: string;
  path: string;
  startedAt: number | null;
  lastAt: string | null;
  model: string | null;
  entries: EntryView[];
  /** Earlier entries left off the page. */
  hidden: number;
  /** Whether a transcript was found and read. */
  readable: boolean;
  questions: QuestionCard[];
  actions: Action[];
  /** Whether you can write to it from its page (D-060), and what the box says. Null with nothing to resume. */
  reply: { can: boolean; hint: string } | null;
}

export interface AgentInput {
  hub: HubLike;
  key: string;
  /** The session as last seen, for a page whose session has since gone from `claude agents`. */
  seen: AgentSession | null;
  entries: Entry[];
  readable: boolean;
  lastAt: string | null;
  /** The model its latest answer came from, from the transcript. */
  model?: string | null;
  limit?: number;
  /** A session Claude Code doesn't list but that's still working, such as a review (D-032). */
  active?: boolean;
  /** A message you sent from its page is still being answered. */
  replying?: boolean;
}

export function agentModel(i: AgentInput): AgentModel {
  const { hub } = i;
  const live = hub.agents.find((s) => sessionKey(s) === i.key || s.id === i.key) ?? null;
  const s = live ?? i.seen;
  const project = s ? hub.projectFor(s.cwd) : undefined;
  // The task it builds, found as the task finds its builder: never by a name alone (D-087).
  const row = project && s ? hub.taskRows(project.root).find((r) => sessionFor(r, [s]) === s) : undefined;
  const tie = s && live ? hub.tieFor?.(s) : null;
  // What it's doing (T-164), as the Agents page says it.
  const look = s && live ? agentLook(s, hub.askingFor?.(s), tie, sessionDoing(s, tie?.role, hub.stepOf?.bind(hub))) : i.active ? { label: 'Working', icon: 'sync~spin', tone: 'blue' as Tone, needsYou: false } : { label: 'Ended', icon: 'circle-slash', tone: 'neutral' as Tone, needsYou: false };
  const limit = i.limit ?? 400;
  const views = i.entries.slice(-limit).map((e): EntryView => (e.k === 'prompt' ? { k: 'prompt', id: e.id, at: e.at, body: fromMarkdown(e.text), instructions: e.instructions }
    : e.k === 'say' ? { k: 'say', id: e.id, at: e.at, body: fromMarkdown(e.text) } : e));
  // Each decision goes in after the last step before you made it, so the timeline reads as it happened.
  const decisions = (s?.sessionId ? (hub.answers ?? []).filter((h) => h.sessionId === s.sessionId) : []).map(decisionOf).sort((a, b) => a.at - b.at);
  const shown: EntryView[] = [];
  let next = 0;
  for (const v of views) {
    const t = v.at ? Date.parse(v.at) : NaN;
    while (next < decisions.length && Number.isFinite(t) && decisions[next]!.at <= t) { const d = decisions[next++]!; shown.push({ k: 'decision', id: `d:${d.id}`, at: new Date(d.at).toISOString(), decision: d }); }
    shown.push(v);
  }
  while (next < decisions.length) { const d = decisions[next++]!; shown.push({ k: 'decision', id: `d:${d.id}`, at: new Date(d.at).toISOString(), decision: d }); }
  const key = s ? sessionKey(s) : i.key;
  const ref: Ref = { session: key };
  const actions: Action[] = [];
  if (s?.sessionId) actions.push({ command: 'acc.agent.openInClaude', label: 'Open in Claude Code', icon: 'comment-discussion', ref });
  if (live?.id) actions.push({ command: 'acc.agent.attach', label: 'Attach in terminal', icon: 'terminal', ref });
  if (s) actions.push({ command: 'acc.agent.openFolder', label: 'Open its folder', icon: 'empty-window', ref });
  if (live?.id && live.pid) actions.push({ command: 'acc.agent.stop', label: 'Stop', icon: 'debug-stop', ref, danger: true });
  const folder = s ? sessionFolders(hub, [s.cwd]).get(s.cwd) : undefined;
  return {
    kind: 'agent', key, name: s ? nameOf(hub, s) : key.slice(0, 8), task: row && project ? { id: row.id, title: row.title, project: project.root } : null,
    look: { label: look.label, icon: look.icon, tone: look.tone }, live: !!live || !!i.active, background: !!s?.id, where: folder?.label ?? '', path: folder?.full ?? '', startedAt: s?.startedAt ?? null, lastAt: i.lastAt, model: i.model ?? null,
    entries: shown, hidden: Math.max(0, i.entries.length - views.length), readable: i.readable || decisions.length > 0,
    questions: s?.sessionId ? questionCards(hub).filter((q) => q.sessionId === s.sessionId) : [],
    actions,
    reply: s?.sessionId && (i.readable || !!live) ? replyState(live, questionCards(hub).some((q) => q.sessionId === s.sessionId), !!i.replying, !!i.active) : null,
  };
}

/**
 * Whether you can write to an agent from its page (D-060): not while it works, waits on a question, or is
 * open somewhere else, since one conversation can't run in two places. A background agent that's idle is
 * stopped first, and carries on from the page in its own folder.
 */
export function replyState(live: AgentSession | null, asking: boolean, replying: boolean, active: boolean): { can: boolean; hint: string } {
  if (replying || active) return { can: false, hint: 'It\'s answering. You can write again when it stops.' };
  if (asking) return { can: false, hint: 'Answer its question above first.' };
  if (live?.pid && live.kind !== 'background') return { can: false, hint: 'It\'s open in a terminal or a Claude Code tab. Write to it there.' };
  if (live?.pid && (live.state === 'working' || live.status === 'busy')) return { can: false, hint: 'It\'s working. You can write to it when it stops.' };
  if (live?.pid && live.id) return { can: true, hint: 'Sending stops its background session, and it carries on here, in its own folder.' };
  return { can: true, hint: 'It carries on in its own folder, with its own rules. ⌘Enter sends.' };
}

export type Message =
  | { type: 'agent-reply'; text: string };

export const area: ModelArea = {
  messages: {
    'agent-reply': (x) => typeof x.text === 'string' && x.text.trim().length > 0 && x.text.length <= 65_536,
  },
};
