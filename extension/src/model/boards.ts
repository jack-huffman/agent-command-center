/**
 * Tracker boards on the Tasks section: each tracker's own columns and cards, with acc's side of each.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import type { StatusCategory, TrackerKind } from '../../../packages/core/src/trackers/types.ts';
import { conflictLine, failedChecksLine, waitsForFiles, whileFirst } from '../logic/tasks.ts';
import { taskNames, type TaskRow, type Tone } from '../logic/shared.ts';
import { signInScope } from '../logic/connect.ts';
import { inProcessWords } from '../logic/processes.ts';
import { movedOut } from '../logic/moved-out.ts';
import { exampleLink, type PasteState, pasteHint, type SlackPlace } from '../logic/slack-link.ts';
import { type Action, displayLook, KEY, type Look, LOOK, type ModelArea, short } from './shared.ts';
import { analysisLook, autopilotLook, CARD_SAID, cardActions, closedPrLook, cloudReviewLook, filesLook, stoppedLook } from './cards.ts';

// ---------------------------------------------------------------- tracker boards (D-026)

/**
 * A tracker's status by its category (GH-105): an icon beside the tracker's own name for it, and its tone, as acc's own states show.
 * Blue while a ticket is moving; to-do and done stay neutral, so orange keeps meaning a person is needed.
 */
export const CATEGORY_LOOK: Record<StatusCategory, { icon: string; tone: Tone }> = { todo: { icon: 'circle-outline', tone: 'neutral' }, doing: { icon: 'sync', tone: 'blue' }, done: { icon: 'check', tone: 'neutral' } };

/** A tracker's column that holds work waiting on someone, by its name: under way to the tracker, but not moving. */
const WAITING = /\b(block|blocked|stuck|on hold|waiting|impeded)\b/i;

/** A column's look: orange and blocked when its name says the work waits, else its category's. */
export function columnLook(name: string, category: StatusCategory): { icon: string; tone: Tone } {
  return category !== 'done' && WAITING.test(name) ? { icon: 'circle-slash', tone: 'orange' } : CATEGORY_LOOK[category];
}

/** A person a board's filter knows (T-79): the key it matches on, and the name it shows. */
export interface Who {
  key: string;
  name: string;
}

/** A person's key on a board: the tracker's id for them, else their name. */
export const whoKey = (p: { id?: string; name: string }): Who => ({ key: p.id ?? p.name, name: p.name });

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
  board: { source: string; title: string; url: string | null; notice: string | null; columns: { id: string; name: string; category: StatusCategory; statusIds: string[] }[]; cards: { key: string; title: string; url: string; status: { id: string; name: string }; type: string | null; assignees: { id?: string; name: string }[]; labels: { name: string; color: string | null }[]; priority: string | null }[] } | null;
  error: string | null;
  connect: { command: string; label: string; arg: string } | null;
  loading: boolean;
  /** Who the board acts as: the GitHub account, the Jira email, the Microsoft account. */
  signedInAs?: string | null;
  /** The tracker's own account for it (T-79), which a card's assignee is matched against for Mine: its id, else its name. Null when the tracker can't say. */
  me?: { id?: string; name: string } | null;
  /** Where a Jira, Azure DevOps or monday.com sign-in is kept (GH-79): for every project on its host, or this one only. */
  signInScope?: { shared: boolean; host: string } | null;
  /** Where its tickets come from (D-072), such as "Jira · ACME · epic ACME-3 Premium Support". */
  place?: string | null;
  /** Tasks whose tickets left the place after work on them started, each named (D-072). */
  left?: string[];
  /** Its cards being tracked, or whose last Track didn't go, by key (D-074). */
  tracking?: Record<string, { busy: boolean; error: string | null }>;
  /** A Slack tracker's box for a thread's link (T-31): its channel, and its Track's state. */
  paste?: (SlackPlace & PasteState) | null;
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
  /** Who has it, as the board's person filter reads it (T-79): each assignee's key and name. Empty when nobody has it. */
  people: Who[];
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
  /** Its name on the Tasks tab's board switch: BOARD_WORD for its kind, such as "GitHub board", else its title. */
  tab: string;
  source: string | null;
  url: string | null;
  notice: string | null;
  error: string | null;
  connect: { command: string; label: string; arg: string } | null;
  loading: boolean;
  signedInAs: string | null;
  /** The key of the person Mine means on this board (T-79), or null when the tracker can't say who that is. */
  me: string | null;
  /**
   * Who it's signed in as and where that sign-in is kept (GH-79), drawn under its place: "Signed in as
   * jordan@acme.example, for every project on acme.atlassian.net". Null for GitHub, which says who in its title.
   */
  signIn: Look | null;
  /**
   * Where its tickets come from (D-072), drawn under its name, or null when it says nothing the name doesn't,
   * as a whole repo's issues under "Issues · <repo>".
   */
  place: string | null;
  /**
   * Tasks whose tickets left the place after work on them started (D-072). They're off this board, but
   * still on the agent board, for a person to finish or set aside.
   */
  left: string[];
  /** The warning for `left` in plain words, "Moved out of epic ACME-3 after work started: ACME-18.", or null (T-42). */
  movedOut: string | null;
  /** The hover title of its Change button: what Change does, then who it's signed in as when known (T-42). */
  changeTitle: string;
  columns: TrackerColumn[];
  /**
   * A Slack tracker's box for a thread's link, in place of a board (T-31): which channel the thread must be
   * in, an example link, the link last sent, and its Track: on its way, why the last one didn't go, or the key it tracked. Null
   * for every other tracker, and while the board shows why it can't be read, such as no sign-in.
   */
  paste: { hint: string; example: string; link: string | null; busy: boolean; error: string | null; tracked: string | null } | null;
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
  // Its review runs in the cloud (T-86): reviewing, or needing you with why.
  const cloudReview = cloudReviewLook(row);
  if (cloudReview) return cloudReview;
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

/**
 * Whether a place narrows its board, and so is worth a line: labels, an epic, a group or an area, past the
 * tracker's own repo, project or account, and not already in the board's title. A whole repo or project
 * says nothing the board's heading and Open in doesn't.
 */
export function placeAdds(place: string, title: string): boolean {
  const parts = place.split(' · ').slice(1);
  if (!parts.length) return true;
  return parts.length > 1 && parts.slice(1).some((part) => !title.includes(part));
}

/** What a tracker's board is called on the Tasks tab's switch, beside the Agent board: by its kind, never its title. */
export const BOARD_WORD: Record<TrackerKind, string> = { github: 'GitHub board', jira: 'Jira board', azure: 'Azure DevOps board', monday: 'monday.com board', slack: 'Slack thread' };

/** Change's title: the sign-in moved here from its own row, "Signed in as jordan@acme.example, for every project on acme.atlassian.net." (T-42). */
export function changeTitle(signIn: Look | null, signedInAs: string | null): string {
  const who = signIn?.label ?? (signedInAs ? `Signed in as ${signedInAs}` : null);
  return `Change where its tickets come from, its board, or its sign-in.${who ? ` ${who.replace(/\.$/, '')}.` : ''}`;
}

export function trackerBoard(b: BoardInput, rows: TaskRow[], root: string): TrackerBoard {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const columns: TrackerColumn[] = (b.board?.columns ?? []).map((c) => ({
    id: c.id, name: c.name, ...columnLook(c.name, c.category), done: c.category === 'done',
    cards: (b.board?.cards ?? []).filter((card) => c.statusIds.includes(card.status.id)).map((card): TrackerCard => {
      const row = byId.get(card.key);
      const next = row ? cardActions(row, { project: root, task: row.id }).find((a) => a.primary && NEXT_STEPS.includes(a.command)) ?? null : null;
      const tracking = b.tracking?.[card.key];
      return {
        key: card.key, title: card.title, type: card.type, typeIcon: typeIcon(card.type), priority: card.priority, priorityIcon: priorityIcon(card.priority),
        labels: card.labels, assignees: card.assignees.map(chip), people: card.assignees.map(whoKey), status: card.status.name,
        acc: row ? { look: accLook(row), needsYou: row.display === 'needs-you', action: next, conflicts: conflictLine(row), failedChecks: failedChecksLine(row) } : null,
        track: row || c.category === 'done' ? null : { busy: !!tracking?.busy, error: tracking?.error ?? null },
      };
    }),
  }));
  const title = b.board?.title ?? b.title;
  const signIn = b.signedInAs && b.signInScope ? LOOK(`Signed in as ${b.signedInAs}, ${signInScope(b.signInScope.shared, b.signInScope.host)}`, b.signInScope.shared ? 'globe' : 'repo', 'blue') : null;
  return {
    index: b.index, kind: b.kind, title, tab: BOARD_WORD[b.kind] ?? title, source: b.board?.source ?? null, url: b.board?.url ?? null,
    notice: b.board?.notice ? inProcessWords(b.board.notice) : null, error: b.error, connect: b.connect, loading: b.loading, signedInAs: b.signedInAs ?? null, me: b.me ? whoKey(b.me).key : null,
    signIn,
    place: b.place && placeAdds(b.place, title) ? b.place : null, left: b.left ?? [], movedOut: movedOut(b.place ?? null, b.left ?? []), columns,
    changeTitle: changeTitle(signIn, b.signedInAs ?? null),
    paste: b.paste && !b.error ? { hint: pasteHint(b.paste), example: exampleLink(b.paste), link: b.paste.link, busy: b.paste.busy, error: b.paste.error ? inProcessWords(b.paste.error) : null, tracked: b.paste.tracked } : null,
  };
}

export type Message =
  /** A card dropped on another column of a tracker board. */
  | { type: 'move'; project: string; tracker: number; key: string; to: string }
  /** Track on a tracker board's card: acc keeps the ticket as a task (D-074). */
  | { type: 'track'; project: string; tracker: number; key: string }
  /** Track from a Slack tracker's box: the thread a pasted link names (T-31). */
  | { type: 'track-link'; project: string; tracker: number; link: string };

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
    'track-link': (x) => short(x.project, 4096) && short(x.link, 2000) && Number.isInteger(x.tracker),
  },
};
