/**
 * The common shape of a ticket and a board, whichever tracker they come from (D-026). The ticket page
 * and the board only see these, so adding a tracker means adding an adapter, not a view.
 */
import type { Doc } from './doc.ts';

export type TrackerKind = 'github' | 'jira' | 'azure';

export interface Person {
  /** The tracker's own id: a GitHub login, a Jira accountId. */
  id: string;
  name: string;
}

export interface Label {
  name: string;
  /** A hex colour from the tracker, without the #, or null when it has none. */
  color: string | null;
}

/** Where a status sits in its workflow, so every tracker's statuses can be drawn alike. */
export type StatusCategory = 'todo' | 'doing' | 'done';

export interface Status {
  id: string;
  name: string;
  category: StatusCategory;
}

export interface Comment {
  id: string;
  author: Person;
  created: string;
  body: Doc;
  url: string | null;
}

export interface Ticket {
  /** GH-12 for a GitHub issue, the Jira key (MSP-7), or AB-123 for an Azure work item. The same id acc's ledger uses. */
  key: string;
  kind: TrackerKind;
  url: string;
  title: string;
  /** Bug, Story, Task… Null when the tracker has no types, as GitHub issues mostly don't. */
  type: string | null;
  status: Status;
  assignees: Person[];
  reporter: Person | null;
  labels: Label[];
  priority: string | null;
  created: string;
  updated: string;
  body: Doc;
  /** The description as markdown: GitHub's own text, or Jira's converted. It becomes a builder's brief. */
  markdown: string;
  comments: Comment[];
  /** Parent, sub-tasks and links, shown as related tickets. */
  related: { key: string; title: string; relation: string; url: string | null }[];
}

/** A move a ticket can make: a Jira transition, a GitHub Project status, or closing and reopening. */
export interface Transition {
  id: string;
  name: string;
  to: Status;
}

export interface BoardColumn {
  id: string;
  name: string;
  category: StatusCategory;
  /** The statuses a card can be in to sit in this column. */
  statusIds: string[];
}

export interface BoardCard {
  key: string;
  title: string;
  url: string;
  status: Status;
  type: string | null;
  assignees: Person[];
  labels: Label[];
  priority: string | null;
  /** GitHub Projects' id for the card itself, which is what a move changes. */
  itemId?: string;
}

export interface Board {
  /** What the columns come from: a Jira board, a GitHub Project, or GitHub's open and closed. */
  source: 'jira-board' | 'github-project' | 'github-state' | 'azure-board';
  title: string;
  url: string | null;
  columns: BoardColumn[];
  cards: BoardCard[];
  /** Something to tell the person, such as how to get a fuller board. */
  notice: string | null;
  /** Where its tickets come from (D-???), such as "Jira · ACME · epic ACME-3 Premium Support". */
  place: string;
}

/** A ticket outside the tracker's place, and why, in a few words: "in project OPS", "no label billing". */
export interface Outside {
  key: string;
  why: string;
}

export interface TrackerClient {
  readonly kind: TrackerKind;
  /** "GitHub · owner/repo", "Jira · MSP" or "Azure DevOps · Project", for headings. */
  readonly title: string;
  /** Where its tickets come from (D-???), as far as it's known before the board loads: "Jira · ACME · epic ACME-3". */
  readonly place: string;
  board(): Promise<Board>;
  /** A ticket in the tracker's place. One outside it throws a TrackerError of kind 'outside' that names the place. */
  ticket(key: string): Promise<Ticket>;
  /**
   * Which of these tickets are outside the tracker's place, each with why (D-???). With `project`, only the
   * project or repo counts, not the narrower epic, labels or area path. A ticket it couldn't read is left
   * out: a failed read never counts as outside (D-048).
   */
  outside(keys: string[], opts?: { project?: boolean }): Promise<Outside[]>;
  /** The moves this ticket can make right now. */
  transitions(key: string): Promise<Transition[]>;
  transition(key: string, t: Transition, card?: BoardCard): Promise<void>;
  /**
   * Moves a card straight to a column, for trackers whose columns aren't just statuses: an Azure board
   * column can share a state with its neighbour, so the move sets the column itself.
   */
  moveToColumn?(card: BoardCard, column: BoardColumn): Promise<void>;
  comment(key: string, markdown: string): Promise<void>;
  me(): Promise<Person>;
  assignable(key: string, query: string): Promise<Person[]>;
  assign(key: string, people: Person[]): Promise<void>;
  labels(): Promise<Label[]>;
  setLabels(key: string, add: string[], remove: string[]): Promise<void>;
}

/** Runs a program with arguments, never through a shell. Async, so the editor never waits on a tracker. */
export type Exec = (cmd: string, args: string[], opts?: { input?: string; env?: NodeJS.ProcessEnv }) => Promise<{ code: number; stdout: string; stderr: string }>;

export class TrackerError extends Error {
  /** outside: the ticket is there, but not in this repo's place (D-???). */
  readonly kind: 'auth' | 'scope' | 'not-found' | 'refused' | 'network' | 'outside' | 'other';
  constructor(kind: TrackerError['kind'], message: string) {
    super(message);
    this.kind = kind;
    this.name = 'TrackerError';
  }
}

/** The error for a ticket outside the place, which names it. */
export const outsideError = (o: Outside, place: string): TrackerError =>
  new TrackerError('outside', `${o.key} isn't one of this repo's tickets, which come from ${place}: ${o.why}.`);

/** "billing", "billing or invoices", "billing, invoices or refunds". */
export const orList = (names: string[]): string => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`);

/**
 * Where a tracker's tickets come from, in words (D-???): "Jira · ACME · epic ACME-3 Premium Support",
 * "GitHub · acme/service · labels billing or invoices", "Azure DevOps · CRM · Sales · area CRM\Billing".
 * With no narrower place, just the project or repo.
 */
export function placeText(p: { kind: TrackerKind; project?: string | null; repo?: string | null; team?: string | null; epic?: string | null; epicName?: string | null; labels?: string[]; areaPath?: string | null }): string {
  if (p.kind === 'github') {
    const labels = p.labels ?? [];
    return `GitHub · ${p.repo ?? '?'}${labels.length ? ` · label${labels.length > 1 ? 's' : ''} ${orList(labels)}` : ''}`;
  }
  if (p.kind === 'jira') return `Jira · ${p.project ?? '?'}${p.epic ? ` · epic ${p.epic}${p.epicName ? ` ${p.epicName}` : ''}` : ''}`;
  return `Azure DevOps · ${p.project ?? '?'}${p.team ? ` · ${p.team}` : ''}${p.areaPath ? ` · area ${p.areaPath}` : ''}`;
}

/** Runs `fn` over the items a few at a time, so checking many tickets never floods a tracker. */
export async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/** The moves that land a card in a column: the transitions whose target status the column holds. */
export const movesInto = (transitions: Transition[], column: BoardColumn): Transition[] => transitions.filter((t) => column.statusIds.includes(t.to.id));
