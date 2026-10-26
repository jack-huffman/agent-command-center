/**
 * The common shape of a ticket and a board, whichever tracker they come from (D-026). The ticket page
 * and the board only see these, so adding a tracker means adding an adapter, not a view.
 */
import type { Doc } from './doc.ts';

/** Every tracker acc reads. The config, the ledger, updates and the Command Center all take their kinds from here. */
export const TRACKER_KINDS = ['github', 'jira', 'azure', 'monday', 'slack'] as const;
export type TrackerKind = (typeof TRACKER_KINDS)[number];

export const isTrackerKind = (v: unknown): v is TrackerKind => (TRACKER_KINDS as readonly unknown[]).includes(v);

const TRACKER_NAMES: Record<TrackerKind, string> = { github: 'GitHub', jira: 'Jira', azure: 'Azure DevOps', monday: 'monday.com', slack: 'Slack' };

/** A tracker's name, for words a person reads: GitHub, Jira, Azure DevOps, monday.com, Slack. */
export const trackerName = (kind: TrackerKind): string => TRACKER_NAMES[kind];

/** What a button that signs in to a tracker says. */
export const signInLabel = (kind: TrackerKind): string => `Sign in to ${trackerName(kind)}`;

export interface Person {
  /** The tracker's own id: a GitHub login, a Jira accountId. */
  id: string;
  name: string;
  /** Their email address, where the tracker gives one: Azure DevOps' uniqueName, Jira's emailAddress (T-90). Left out when it gives none. */
  email?: string;
}

/** How urgent a ticket is, 1 the highest and 5 the lowest, whatever the tracker calls it (T-90). */
export type PriorityLevel = 1 | 2 | 3 | 4 | 5;

/** What kind of work a ticket is, whatever the tracker calls its type (T-90): Azure's User Story and Jira's Story are both a story. */
export const TYPE_KINDS = ['bug', 'story', 'task', 'subtask', 'feature', 'epic', 'test', 'issue', 'other'] as const;
export type TypeKind = (typeof TYPE_KINDS)[number];

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
  /**
   * Why a done status is done (T-90): completed, or closed without the work, as GitHub's not planned and Azure's
   * Removed are. Left out, or null, where the tracker doesn't say.
   */
  reason?: 'completed' | 'not-planned' | null;
}

export interface Comment {
  id: string;
  author: Person;
  created: string;
  body: Doc;
  url: string | null;
}

export interface Ticket {
  /**
   * GH-12 for a GitHub issue, the Jira key (MSP-7), AB-123 for an Azure work item, MON-123 for a monday.com item, or
   * SL-1696512345123456 for a Slack thread. The same id acc's ledger uses.
   */
  key: string;
  kind: TrackerKind;
  url: string;
  title: string;
  /** Bug, Story, Task… Null when the tracker has no types, as GitHub issues mostly don't. */
  type: string | null;
  /** The type's kind (T-90): 'other' for a type no tracker table names, null when there's no type. */
  typeKind: TypeKind | null;
  /** The type's own colour from the tracker (T-95), a hex without the # as a label's, or null where it gives none. */
  typeColor: string | null;
  status: Status;
  assignees: Person[];
  reporter: Person | null;
  labels: Label[];
  priority: string | null;
  /** The priority's level (T-90), or null when the tracker has none or a name it can't place. */
  priorityLevel: PriorityLevel | null;
  created: string;
  updated: string;
  body: Doc;
  /** The description as markdown: GitHub's own text, or Jira's converted. It becomes a builder's brief. */
  markdown: string;
  /**
   * What the description holds that its markdown can't, by name, such as Jira's mentions and attachments:
   * acc doesn't write the description back while there's any (T-80). Not set: nothing.
   */
  unkept?: string[];
  comments: Comment[];
  /** Parent, sub-tasks and links, shown as related tickets, each with its status and kind where the tracker says (T-90). */
  related: Related[];
}

/** A ticket related to another: its parent, a sub-task or a link. Status and kind are null where the tracker doesn't say. */
export interface Related {
  key: string;
  title: string;
  relation: string;
  url: string | null;
  status: Status | null;
  typeKind: TypeKind | null;
  /** Its type's colour from the tracker (T-95), or null. */
  typeColor: string | null;
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
  typeKind: TypeKind | null;
  /** Its type's colour from the tracker (T-95), or null. */
  typeColor: string | null;
  assignees: Person[];
  labels: Label[];
  priority: string | null;
  priorityLevel: PriorityLevel | null;
  /** GitHub Projects' id for the card itself, which is what a move changes. */
  itemId?: string;
  /** The whole title, where `title` is cut short, as a Slack message's long first line is (T-85). */
  fullTitle?: string;
}

export interface Board {
  /**
   * What the columns come from: a Jira board, a GitHub Project, GitHub's open and closed, a monday.com board's
   * status column, or a Slack channel's messages marked with a reaction, Open and Done (T-85).
   */
  source: 'jira-board' | 'github-project' | 'github-state' | 'azure-board' | 'monday-board' | 'slack';
  title: string;
  url: string | null;
  columns: BoardColumn[];
  cards: BoardCard[];
  /** Something to tell the person, such as how to get a fuller board. */
  notice: string | null;
  /** Where its tickets come from (D-072), such as "Jira · ACME · epic ACME-3 Premium Support". */
  place: string;
  /**
   * The sprints its tickets come from (T-78): a Jira board's open sprints, or the one sprint it names. Empty
   * when it follows the active sprint and none is open. Left out when the board isn't held to a sprint.
   */
  sprints?: Sprint[];
}

/** A Jira sprint (T-78): its id, its name, and its dates, which a future sprint may not have yet. */
export interface Sprint {
  id: number;
  name: string;
  state: 'active' | 'future' | 'closed';
  start: string | null;
  end: string | null;
}

/** A ticket outside the tracker's place, and why, in a few words: "in project OPS", "no label billing". */
export interface Outside {
  key: string;
  why: string;
}

/** The fields of a ticket that a tracker may lack: a Slack thread has no status, no people to assign and no labels (T-23). */
export const TRACKER_FIELDS = ['status', 'assignee', 'labels'] as const;
export type TrackerField = (typeof TRACKER_FIELDS)[number];

/** The words for a field a tracker lacks: "has no statuses". */
export const FIELD_LACKS: Record<TrackerField, string> = { status: 'statuses', assignee: 'people to assign', labels: 'labels' };

/** Whether the tracker has the field. A tracker that does not set `fields` has all three. */
export const trackerHasField = (client: { fields?: readonly TrackerField[] }, field: TrackerField): boolean => !client.fields || client.fields.includes(field);

/** What setText writes to a ticket: its title, its description as Markdown, or both. A field left out stays as it is. */
export interface TicketText {
  title?: string;
  markdown?: string;
}

/** The trackers whose ticket text acc can write (T-80): a Jira issue's summary and description, a GitHub issue's title and body. */
export const TEXT_TRACKERS: readonly TrackerKind[] = ['github', 'jira'];

/** Why acc can't write a tracker's ticket text, or null where it can. In plain words, with no command in them (D-132). */
export const textRefusal = (kind: TrackerKind): string | null =>
  (TEXT_TRACKERS.includes(kind) ? null : `acc can't change a ${trackerName(kind)} ticket's title or description yet: change them in ${trackerName(kind)}, and intake brings them in.`);

/** The error a tracker that can't write its ticket text throws from setText. */
export const textRefused = (kind: TrackerKind): TrackerError => new TrackerError('refused', textRefusal(kind) ?? `${trackerName(kind)} refused the text.`);

/**
 * How a ticket field keeps its text (T-105): Markdown (a GitHub issue's description), HTML (an Azure DevOps
 * HTML field), ADF (a Jira long-text field) or plain text (a Jira or Azure DevOps text field, a monday.com long-text column).
 */
export const FIELD_FORMATS = ['markdown', 'html', 'adf', 'plain'] as const;
export type FieldFormat = (typeof FIELD_FORMATS)[number];

/** A ticket field that holds text (T-105): the tracker's own id for it, its name as the tracker shows it, and how it keeps text. */
export interface TextField {
  id: string;
  name: string;
  format: FieldFormat;
}

export interface TrackerClient {
  readonly kind: TrackerKind;
  /** Which of status, assignee and labels the tracker has. Not set: all three. */
  readonly fields?: readonly TrackerField[];
  /** "GitHub · owner/repo", "Jira · MSP", "Azure DevOps · Project" or "monday.com · acme", for headings. */
  readonly title: string;
  /** Where its tickets come from (D-072), as far as it's known before the board loads: "Jira · ACME · epic ACME-3". */
  readonly place: string;
  board(): Promise<Board>;
  /** A ticket in the tracker's place. One outside it throws a TrackerError of kind 'outside' that names the place. */
  ticket(key: string): Promise<Ticket>;
  /**
   * Which of these tickets are outside the tracker's place, each with why (D-072). With `project`, only the
   * project or repo counts, not the narrower epic, labels or area path. A ticket it couldn't read is left
   * out: a failed read never counts as outside (D-048).
   */
  outside(keys: string[], opts?: { project?: boolean }): Promise<Outside[]>;
  /**
   * Which of these tickets aren't done yet (T-78), for counting the ones a finished sprint sent back to the
   * backlog. Only a tracker with sprints has it. A ticket it couldn't read is left out.
   */
  stillOpen?(keys: string[]): Promise<string[]>;
  /** The moves this ticket can make right now. */
  transitions(key: string): Promise<Transition[]>;
  transition(key: string, t: Transition, card?: BoardCard): Promise<void>;
  /**
   * Moves a card straight to a column, for trackers whose columns aren't just statuses: an Azure board
   * column can share a state with its neighbour, so the move sets the column itself.
   */
  moveToColumn?(card: BoardCard, column: BoardColumn): Promise<void>;
  comment(key: string, markdown: string): Promise<void>;
  /**
   * Writes a ticket's title, its description, or both (T-80): only what's given. Jira and GitHub write it;
   * Azure DevOps, monday.com and Slack refuse it with a TrackerError of kind 'refused' that says why.
   */
  setText(key: string, text: TicketText): Promise<void>;
  /**
   * The ticket fields that hold text, where a ticket's changes can be kept (T-105): Jira's text and long-text
   * custom fields, Azure DevOps' string and HTML fields on the board's work item types, monday.com's long-text
   * columns, and GitHub's section of the description. Slack has none, so it has no such method.
   */
  textFields?(): Promise<TextField[]>;
  /** A field's text on a ticket, as Markdown (T-105): '' when it's empty. */
  readField?(key: string, field: TextField): Promise<string>;
  /** Writes a field's text, given as Markdown, in the field's own format (T-105). Only a person's save calls it. */
  writeField?(key: string, field: TextField, markdown: string): Promise<void>;
  me(): Promise<Person>;
  assignable(key: string, query: string): Promise<Person[]>;
  assign(key: string, people: Person[]): Promise<void>;
  labels(): Promise<Label[]>;
  setLabels(key: string, add: string[], remove: string[]): Promise<void>;
}

/** Runs a program with arguments, never through a shell. Async, so the editor never waits on a tracker. */
export type Exec = (cmd: string, args: string[], opts?: { input?: string; env?: NodeJS.ProcessEnv }) => Promise<{ code: number; stdout: string; stderr: string }>;

export class TrackerError extends Error {
  /** outside: the ticket is there, but not in this repo's place (D-072). */
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

/** "epic ACME-3", or with several "epics ACME-3 or ACME-7": the one wording a Jira place, an outside reason and an empty board use (T-107). */
export const epicWords = (epics: string[]): string => `epic${epics.length > 1 ? 's' : ''} ${orList(epics)}`;

/**
 * Where a tracker's tickets come from, in words (D-072): "Jira · ACME · epic ACME-3 Premium Support", or with
 * several epics "Jira · ACME · epics ACME-3 Premium Support or ACME-7 Renewals" (T-107),
 * "GitHub · acme/service · labels billing or invoices", "Azure DevOps · CRM · Sales · area CRM\Billing",
 * "monday.com · acme · Client work · group Topics", "Slack · acme · channel C0123ABCD". With no narrower place, just
 * the project, repo or board. A monday.com board and group are named by id until the board has loaded and said
 * their names.
 */
export function placeText(p: {
  kind: TrackerKind; project?: string | null; repo?: string | null; team?: string | null; labels?: string[]; areaPath?: string | null;
  /** A Jira tracker's epics (T-107), and once the board has loaded, each one's name, in their order. */
  epics?: string[]; epicNames?: (string | null)[];
  /** A Jira board's sprint (T-78): "active" or an id, from the config, and once the board has loaded, the sprints it found. */
  sprint?: 'active' | number | null; sprints?: Sprint[] | null;
  account?: string | null; board?: string | number | null; boardName?: string | null; group?: string | null; groupName?: string | null;
  workspace?: string | null; channel?: string | null;
}): string {
  if (p.kind === 'slack') return `Slack · ${p.workspace ?? '?'} · channel ${p.channel ?? '?'}`;
  if (p.kind === 'monday') return `monday.com · ${p.account ?? '?'} · ${p.boardName ?? `board ${p.board ?? '?'}`}${p.group ? ` · group ${p.groupName ?? p.group}` : ''}`;
  if (p.kind === 'github') {
    const labels = p.labels ?? [];
    return `GitHub · ${p.repo ?? '?'}${labels.length ? ` · label${labels.length > 1 ? 's' : ''} ${orList(labels)}` : ''}`;
  }
  if (p.kind === 'jira') {
    const epics = (p.epics ?? []).map((e, i) => (p.epicNames?.[i] ? `${e} ${p.epicNames[i]}` : e));
    return `Jira · ${p.project ?? '?'}${epics.length ? ` · ${epicWords(epics)}` : ''}${p.sprint ? ` · ${sprintPlace(p.sprint, p.sprints ?? null)}` : ''}`;
  }
  return `Azure DevOps · ${p.project ?? '?'}${p.team ? ` · ${p.team}` : ''}${p.areaPath ? ` · area ${p.areaPath}` : ''}`;
}

const DAY = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** A sprint's dates in words: "6 Oct to 19 Oct". Null when it has none yet, as a future sprint may not. */
export function sprintDates(s: Pick<Sprint, 'start' | 'end'>): string | null {
  const day = (iso: string | null) => (iso && !Number.isNaN(Date.parse(iso)) ? DAY.format(new Date(iso)) : null);
  const [a, b] = [day(s.start), day(s.end)];
  return a && b ? `${a} to ${b}` : a ? `from ${a}` : b ? `to ${b}` : null;
}

/**
 * The sprint part of a Jira place (T-78), once the board has found it: "active sprint Sprint 12 (6 Oct to
 * 19 Oct)" when it follows the active one, or "sprint Sprint 12 (6 Oct to 19 Oct)" for a named one. Before
 * then, "the active sprint" or "sprint 42"; and "no active sprint" when it follows the active one and none is
 * open.
 */
export function sprintPlace(sprint: 'active' | number, found: Sprint[] | null): string {
  if (!found) return sprint === 'active' ? 'the active sprint' : `sprint ${sprint}`;
  if (!found.length) return sprint === 'active' ? 'no active sprint' : `sprint ${sprint}`;
  const word = sprint === 'active' ? `active sprint${found.length > 1 ? 's' : ''}` : 'sprint';
  return `${word} ${found.map((s) => `${s.name}${sprintDates(s) ? ` (${sprintDates(s)})` : ''}`).join(' and ')}`;
}

/** Runs `fn` over the items a few at a time, so checking many tickets never floods a tracker. */
export async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/** The moves that land a card in a column: the transitions whose target status the column holds. */
export const movesInto = (transitions: Transition[], column: BoardColumn): Transition[] => transitions.filter((t) => column.statusIds.includes(t.to.id));
