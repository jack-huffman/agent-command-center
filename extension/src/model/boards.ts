/**
 * Tracker boards on the Tasks section: each tracker's own columns and cards, with acc's side of each.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import type { StatusCategory, TrackerKind } from '../../../packages/core/src/trackers/types.ts';
import { conflictLine, failedChecksLine, waitsForFiles, whileFirst } from '../logic/tasks.ts';
import { taskNames, type TaskRow, type Tone } from '../logic/shared.ts';
import { signInScope } from '../logic/connect.ts';
import { type Action, displayLook, KEY, type Look, LOOK, type ModelArea, short } from './shared.ts';
import { analysisLook, autopilotLook, CARD_SAID, cardActions, closedPrLook, filesLook, stoppedLook } from './cards.ts';

// ---------------------------------------------------------------- tracker boards (D-026)

/** Blue while a ticket is moving; to-do and done stay neutral, so orange keeps meaning a person is needed. */
/** A tracker's status by its category (GH-105): an icon beside the tracker's own name for it, and its tone, as acc's own states show. */
export const CATEGORY_LOOK: Record<StatusCategory, { icon: string; tone: Tone }> = { todo: { icon: 'circle-outline', tone: 'neutral' }, doing: { icon: 'sync', tone: 'blue' }, done: { icon: 'check', tone: 'neutral' } };

export interface PersonChip {
  name: string;
  initials: string;
}

export const initials = (name: string): string => name.replace(/[^\p{L}\p{N}\s.-]/gu, '').split(/[\s.-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?';
export const chip = (p: { name: string }): PersonChip => ({ name: p.name, initials: initials(p.name) });

/** A codicon for each kind of ticket, so a bug reads as a bug at a glance. */
export function typeIcon(type: string | null): string {
  const t = (type ?? '').toLowerCase();
  if (t.includes('bug') || t.includes('defect')) return 'bug';
  if (t.includes('epic')) return 'zap';
  if (t.includes('story')) return 'bookmark';
  if (t.includes('sub')) return 'list-tree';
  if (t.includes('task')) return 'tasklist';
  if (t.includes('improve') || t.includes('feature')) return 'lightbulb';
  if (t.includes('backlog item') || t.includes('requirement')) return 'bookmark';
  if (t.includes('test')) return 'beaker';
  return 'issues';
}

export function priorityIcon(priority: string | null): string | null {
  const p = (priority ?? '').toLowerCase();
  if (!p) return null;
  if (/highest|blocker|critical|urgent/.test(p)) return 'chevron-up';
  if (/high/.test(p)) return 'arrow-up';
  if (/lowest|trivial/.test(p)) return 'chevron-down';
  if (/low|minor/.test(p)) return 'arrow-down';
  return null; // medium, normal: the ordinary case needs no mark
}

/** What the extension knows about one tracker's board (see trackers.ts). */
export interface BoardInput {
  index: number;
  kind: TrackerKind;
  title: string;
  board: { source: string; title: string; url: string | null; notice: string | null; columns: { id: string; name: string; category: StatusCategory; statusIds: string[] }[]; cards: { key: string; title: string; url: string; status: { id: string; name: string }; type: string | null; assignees: { name: string }[]; labels: { name: string; color: string | null }[]; priority: string | null }[] } | null;
  error: string | null;
  connect: { command: string; label: string; arg: string } | null;
  loading: boolean;
  /** Who the board acts as: the GitHub account, the Jira email, the Microsoft account. */
  signedInAs?: string | null;
  /** Where a Jira, Azure DevOps or monday.com sign-in is kept (GH-79): for every project on its host, or this one only. */
  signInScope?: { shared: boolean; host: string } | null;
  /** Where its tickets come from (D-072), such as "Jira · ACME · epic ACME-3 Premium Support". */
  place?: string | null;
  /** Tasks whose tickets left the place after work on them started, each named (D-072). */
  left?: string[];
  /** Its cards being tracked, or whose last Track didn't go, by key (D-074). */
  tracking?: Record<string, { busy: boolean; error: string | null }>;
}

export interface TrackerCard {
  key: string;
  title: string;
  type: string | null;
  typeIcon: string;
  priority: string | null;
  priorityIcon: string | null;
  labels: { name: string; color: string | null }[];
  assignees: PersonChip[];
  status: string;
  /** The task acc keeps for this ticket, when there is one: where it is, its next step, why its pull request won't merge, and its checks that failed on GitHub. */
  acc: { look: Look; needsYou: boolean; action: Action | null; conflicts: string | null; failedChecks: string | null } | null;
  /**
   * Track, for a ticket acc doesn't keep yet (D-074): ready, on its way, or why the last try didn't go.
   * Null once acc keeps it, and in a done column, where there's nothing left to build.
   */
  track: { busy: boolean; error: string | null } | null;
}

export interface TrackerColumn {
  id: string;
  name: string;
  icon: string;
  tone: Tone;
  done: boolean;
  cards: TrackerCard[];
}

export interface TrackerBoard {
  index: number;
  kind: TrackerKind;
  title: string;
  source: string | null;
  url: string | null;
  notice: string | null;
  error: string | null;
  connect: { command: string; label: string; arg: string } | null;
  loading: boolean;
  signedInAs: string | null;
  /**
   * Who it's signed in as and where that sign-in is kept (GH-79), drawn under its place: "Signed in as
   * jordan@acme.example, for every project on acme.atlassian.net". Null for GitHub, which says who in its title.
   */
  signIn: Look | null;
  /** Where its tickets come from (D-072), drawn under its name. */
  place: string | null;
  /**
   * Tasks whose tickets left the place after work on them started (D-072). They're off this board, but
   * still on the agent board, for a person to finish or set aside.
   */
  left: string[];
  columns: TrackerColumn[];
}

/**
 * The agent's side of a ticket: acc's own state, or what the agent, or its analysis (D-052), is doing
 * about it. `full` is the task page's: a stopped agent's last words in full, not clipped as on a card.
 */
export function accLook(row: TaskRow, full = false): Look {
  if (row.autopilot && row.display === 'needs-you') return autopilotLook(row)!;
  const closed = closedPrLook(row);
  if (closed) return closed;
  const stopped = stoppedLook(row, full ? Infinity : CARD_SAID);
  if (stopped) return stopped;
  if (row.agent && row.display === 'needs-you') return row.agent;
  const analysis = analysisLook(row);
  if (analysis && (row.display === 'needs-you' || row.analyzing)) return analysis;
  // A task a person dispatched waits for others' files, or its start failed (D-093), in a few words: the
  // card's note and the page's notice name the files. The page's State names what goes first, since its
  // notice may fold that away under Show all.
  const files = row.files?.held ? filesLook(row) : null;
  if (files && row.files!.held!.failed) return { ...files, label: row.files!.held!.byAutopilot ? 'Needs you: autopilot couldn\'t start it' : 'Needs you: its start failed' };
  if (files && waitsForFiles(row)) return { ...files, label: `Waits for ${taskNames(row.files!.shares.map((s) => `${s.task}'s`))} files${full ? whileFirst(row.files!.first, true) : ''}` };
  if (files) return files;
  return displayLook(row.display);
}

/** The steps a tracker's card offers for its task: start it, its analysis (D-052), or watch its agent. */
const NEXT_STEPS = ['acc.task.dispatch', 'acc.task.dispatchAnyway', 'acc.task.analyze', 'acc.task.watchAnalysis', 'acc.task.show', 'acc.task.watch', 'acc.task.openInClaude', 'acc.task.resume'];

export function trackerBoard(b: BoardInput, rows: TaskRow[], root: string): TrackerBoard {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const columns: TrackerColumn[] = (b.board?.columns ?? []).map((c) => ({
    id: c.id, name: c.name, ...CATEGORY_LOOK[c.category], done: c.category === 'done',
    cards: (b.board?.cards ?? []).filter((card) => c.statusIds.includes(card.status.id)).map((card): TrackerCard => {
      const row = byId.get(card.key);
      const next = row ? cardActions(row, { project: root, task: row.id }).find((a) => a.primary && NEXT_STEPS.includes(a.command)) ?? null : null;
      const tracking = b.tracking?.[card.key];
      return {
        key: card.key, title: card.title, type: card.type, typeIcon: typeIcon(card.type), priority: card.priority, priorityIcon: priorityIcon(card.priority),
        labels: card.labels, assignees: card.assignees.map(chip), status: card.status.name,
        acc: row ? { look: accLook(row), needsYou: row.display === 'needs-you', action: next, conflicts: conflictLine(row), failedChecks: failedChecksLine(row) } : null,
        track: row || c.category === 'done' ? null : { busy: !!tracking?.busy, error: tracking?.error ?? null },
      };
    }),
  }));
  return {
    index: b.index, kind: b.kind, title: b.board?.title ?? b.title, source: b.board?.source ?? null, url: b.board?.url ?? null,
    notice: b.board?.notice ?? null, error: b.error, connect: b.connect, loading: b.loading, signedInAs: b.signedInAs ?? null,
    signIn: b.signedInAs && b.signInScope ? LOOK(`Signed in as ${b.signedInAs}, ${signInScope(b.signInScope.shared, b.signInScope.host)}`, b.signInScope.shared ? 'globe' : 'repo', 'blue') : null,
    place: b.place ?? null, left: b.left ?? [], columns,
  };
}

export type Message =
  /** A card dropped on another column of a tracker board. */
  | { type: 'move'; project: string; tracker: number; key: string; to: string }
  /** Track on a tracker board's card: acc keeps the ticket as a task (D-074). */
  | { type: 'track'; project: string; tracker: number; key: string };

export const area: ModelArea = {
  commands: [
    'acc.trackers.signIn', 'acc.trackers.refresh', 'acc.trackers.add',
  ],
  home: {
    order: 14,
    attention({ i, attention }, p) {
      for (const b of i.boards(p.root)) {
        if (b.error && b.connect) attention.push({ key: `b:${p.root}:${b.index}`, look: LOOK('Not signed in', 'plug', 'orange'), title: b.title, detail: `${p.name} · ${b.error}`, project: p.name, actions: [], extra: { command: b.connect.command, label: b.connect.label, icon: 'plug', arg: b.connect.arg } });
      }
    },
  },
  messages: {
    move: (x) => short(x.project, 4096) && short(x.key, 100) && KEY.test(x.key as string) && Number.isInteger(x.tracker) && typeof x.to === 'string' && x.to.length <= 200,
    track: (x) => short(x.project, 4096) && short(x.key, 100) && KEY.test(x.key as string) && Number.isInteger(x.tracker),
  },
};
