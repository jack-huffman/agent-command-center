/**
 * Jira Cloud over its REST API, with the person's email and API token (D-026). A board's columns are the
 * Jira board's own columns, each mapped to the statuses it holds, and a move is a workflow transition.
 */
import { type AdfNode, adfUnkept, fromAdf, fromMarkdown, toAdf, toMarkdown, unkeptRefusal } from './doc.ts';
import { isEmail, typeKindOf } from './normal.ts';
import {
  type Board, type BoardCard, type BoardColumn, inBatches, type Label, type Outside, outsideError, type Person, placeText, type PriorityLevel, type Related, type Sprint,
  type Status, type StatusCategory, type Ticket, type TicketText, type TrackerClient, TrackerError, type Transition,
} from './types.ts';

export interface JiraOptions {
  /** example.atlassian.net */
  site: string;
  /** The project key, such as MSP. */
  project: string;
  email: string;
  token: string;
  /** A board id. By default, the project's first board. */
  board?: number | null;
  /** An epic's key: only its child tickets and their sub-tasks count (D-072). By default, the whole project. */
  epic?: string | null;
  /** "active" for the board's open sprints, or a sprint's id: only its tickets count, with or without an epic (T-78). By default, the whole board. */
  sprint?: 'active' | number | null;
  fetch?: typeof fetch;
}

/** A sprint as Jira's agile API gives it. */
interface JiraSprint { id: number; name: string; state: string; startDate?: string; endDate?: string }
const sprintOf = (s: JiraSprint): Sprint => ({
  id: s.id, name: s.name, state: s.state === 'active' || s.state === 'future' ? s.state : 'closed', start: s.startDate ?? null, end: s.endDate ?? null,
});

interface JiraStatus { id: string; name: string; statusCategory?: { key?: string } }
interface JiraUser { accountId: string; displayName?: string; emailAddress?: string }
/** What says where an issue sits: its project, its parent, and whether it's a sub-task. */
interface Placed { key: string; fields: { project?: { key: string }; parent?: { key: string }; issuetype?: { subtask?: boolean } } }
type BoardIssue = { key: string; fields: Placed['fields'] & { summary: string; status: JiraStatus; assignee: JiraUser | null; issuetype?: { name: string; subtask?: boolean }; priority?: { name: string } | null; labels?: string[] } };

const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-\d+$/;
/** The most cards a board shows. */
const MAX_CARDS = 300;
const jqlString = (s: string): string => `"${s.replace(/["\\]/g, '\\$&')}"`;
/** The project an issue is in: its own field, or else its key's. */
const projectOf = (i: Placed): string => (i.fields.project?.key ?? i.key.replace(/-\d+$/, '')).toUpperCase();

/** The board's notice when it follows the active sprint and none is open (T-78). */
export const NO_ACTIVE_SPRINT = 'This board has no active sprint, so it shows no tickets. When the next sprint starts, its tickets show here. To see the whole board or another sprint, use Change, above it.';

const CATEGORY: Record<string, StatusCategory> = { new: 'todo', indeterminate: 'doing', done: 'done' };
const status = (s: JiraStatus): Status => ({ id: String(s.id), name: s.name, category: CATEGORY[s.statusCategory?.key ?? ''] ?? 'doing' });
const person = (u: JiraUser): Person => ({ id: u.accountId, name: u.displayName || 'Unknown', ...(isEmail(u.emailAddress) ? { email: u.emailAddress.trim() } : {}) });
/** Jira's five standard priorities by level (T-90). A priority a site named itself has no level. */
export const JIRA_PRIORITY: Record<string, PriorityLevel> = { highest: 1, high: 2, medium: 3, low: 4, lowest: 5 };
const priorityOf = (p: { name: string } | null | undefined): { priority: string | null; priorityLevel: PriorityLevel | null } => ({
  priority: p?.name ?? null, priorityLevel: (p && JIRA_PRIORITY[p.name.trim().toLowerCase()]) ?? null,
});
/** What a linked issue, a parent or a sub-task carries with it. Each field may be left out. */
interface Linked { key: string; fields: { summary: string; status?: JiraStatus; issuetype?: { name: string; subtask?: boolean } } }
const related = (i: Linked, relation: string, url: string): Related => ({
  key: i.key, title: i.fields.summary, relation, url, status: i.fields.status ? status(i.fields.status) : null, typeKind: typeKindOf(i.fields.issuetype?.name, !!i.fields.issuetype?.subtask),
});

export class JiraClient implements TrackerClient {
  readonly kind = 'jira' as const;
  readonly title: string;
  readonly place: string;
  private readonly o: JiraOptions;
  private readonly base: string;
  private readonly epic: string | null;
  private readonly sprint: 'active' | number | null;
  private boardIdCache: Promise<number> | null = null;
  private sprintsCache: Promise<Sprint[]> | null = null;

  constructor(o: JiraOptions) {
    this.o = o;
    this.base = `https://${o.site.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
    this.title = `Jira · ${o.project}`;
    this.epic = o.epic ? o.epic.trim().toUpperCase() : null;
    this.sprint = o.sprint ?? null;
    this.place = placeText({ kind: 'jira', project: o.project, epic: this.epic, sprint: this.sprint });
  }

  /**
   * The JQL that holds the board's cards to the place (D-072): the project, and with an epic, its child
   * tickets. Their sub-tasks come from a second query, of the children's own keys. With a sprint (T-78),
   * only that sprint's tickets: the named one, or the active one. `open` is the board's open sprints, once
   * known, so another board's active sprint never counts; until then, Jira's own openSprints().
   */
  placeJql(open?: number[]): string {
    if (this.epic && !ISSUE_KEY.test(this.epic)) throw new TrackerError('other', `"${this.o.epic}" isn't a Jira epic's key, such as ACME-3.`);
    return `project = ${jqlString(this.o.project)}${this.epic ? ` AND parent = ${this.epic}` : ''}${this.sprintJql(open)}`;
  }

  /** The sprint's part of the JQL, or nothing for the whole board. */
  private sprintJql(open?: number[]): string {
    if (this.sprint === null) return '';
    if (this.sprint !== 'active') {
      if (!Number.isSafeInteger(this.sprint) || this.sprint < 1) throw new TrackerError('other', `"${this.sprint}" isn't a Jira sprint's id, such as 42.`);
      return ` AND sprint = ${this.sprint}`;
    }
    return open?.length ? ` AND sprint in (${open.join(', ')})` : ' AND sprint in openSprints()';
  }

  /**
   * The sprints the board is held to (T-78): its active ones, or the one it names. Read once per client; a
   * failed read is tried again next time. A named sprint Jira doesn't have says so, as a missing epic does.
   */
  private sprints(): Promise<Sprint[]> {
    this.sprintsCache ??= (async () => {
      if (this.sprint === 'active') {
        const id = await this.boardId();
        const r = await this.req<{ values: JiraSprint[] }>('GET', `/rest/agile/1.0/board/${id}/sprint?state=active&maxResults=50`);
        return r.values.map(sprintOf);
      }
      try {
        return [sprintOf(await this.req<JiraSprint>('GET', `/rest/agile/1.0/sprint/${encodeURIComponent(String(this.sprint))}`))];
      } catch (e) {
        if (e instanceof TrackerError && e.kind === 'not-found') throw new TrackerError('not-found', `Sprint ${this.sprint} isn't in Jira, or this sign-in can't see it. Pick another with the board's Change.`);
        throw e;
      }
    })();
    const read = this.sprintsCache;
    read.catch(() => {
      if (this.sprintsCache === read) this.sprintsCache = null;
    });
    return read;
  }

  /** What a ticket outside the sprint is outside of: "the active sprint", or "sprint Sprint 12". */
  private sprintWords(found: Sprint[]): string {
    return this.sprint === 'active' ? 'the active sprint' : `sprint ${found[0]?.name ?? this.sprint}`;
  }

  /** Why a ticket in the project and epic is still outside the sprint (T-78), or null when it's in it or no sprint is set. */
  private async outsideSprint(key: string): Promise<string | null> {
    if (this.sprint === null) return null;
    const found = await this.sprints();
    if (this.sprint === 'active' && !found.length) return 'its board has no active sprint';
    const jql = `key = ${key.toUpperCase()}${this.sprintJql(found.map((s) => s.id))}`;
    const r = await this.req<{ issues: { key: string }[] }>('GET', `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=key&maxResults=1`);
    return r.issues.length ? null : `it isn't in ${this.sprintWords(found)}`;
  }

  /**
   * Why an issue is outside the place, or null when it's in it (D-072). `asked` is the key that was asked
   * for: a moved issue comes back under its new key. With `projectOnly`, the epic and the sprint don't count.
   */
  private async whyOutside(i: Placed, asked: string, projectOnly: boolean): Promise<string | null> {
    const project = projectOf(i);
    if (project !== this.o.project.toUpperCase()) return i.key.toUpperCase() !== asked.toUpperCase() ? `it moved to ${i.key}, in project ${project}` : `it's in project ${project}`;
    if (projectOnly) return null;
    if (!this.epic) return this.outsideSprint(i.key);
    if (i.key.toUpperCase() === this.epic) return 'it\'s the epic itself, and only the tickets in it count';
    const parent = i.fields.parent?.key?.toUpperCase();
    if (parent === this.epic) return this.outsideSprint(i.key);
    // A sub-task counts when its parent is one of the epic's tickets.
    if (parent && i.fields.issuetype?.subtask !== false) {
      const up = await this.req<Placed>('GET', `/rest/api/3/issue/${encodeURIComponent(parent)}?fields=parent`);
      if (up.fields.parent?.key?.toUpperCase() === this.epic) return this.outsideSprint(i.key);
    }
    return `it isn't in epic ${this.epic}`;
  }

  private async req<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
    const f = this.o.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.o.email}:${this.o.token}`).toString('base64')}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      throw new TrackerError('network', `Couldn't reach ${this.base}: ${(e as Error).message}`);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.ok) return json as T;
    const j = (json ?? {}) as { errorMessages?: string[]; errors?: Record<string, string>; message?: string };
    const why = [...(j.errorMessages ?? []), ...Object.values(j.errors ?? {}), j.message].filter(Boolean).join(' ') || `HTTP ${res.status}`;
    if (res.status === 401) throw new TrackerError('auth', `Jira refused the email and API token for ${this.o.site}. Connect again with a new token.`);
    if (res.status === 403) throw new TrackerError('refused', `Jira said no: ${why}`);
    if (res.status === 404) throw new TrackerError('not-found', why);
    throw new TrackerError('other', why);
  }

  private boardId(): Promise<number> {
    this.boardIdCache ??= (async () => {
      if (this.o.board != null) return this.o.board;
      const r = await this.req<{ values: { id: number; name: string; type: string }[] }>('GET', `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(this.o.project)}&maxResults=50`);
      const b = r.values[0];
      if (!b) throw new TrackerError('not-found', `${this.o.project} has no Jira board. Make one, or set "board" on the tracker in .acc/config.json.`);
      return b.id;
    })();
    return this.boardIdCache;
  }

  async board(): Promise<Board> {
    const id = await this.boardId();
    const [config, statuses, epicName, sprints] = await Promise.all([
      this.req<{ name: string; columnConfig: { columns: { name: string; statuses: { id: string }[] }[] } }>('GET', `/rest/agile/1.0/board/${id}/configuration`),
      this.req<{ statuses: JiraStatus[] }[]>('GET', `/rest/api/3/project/${encodeURIComponent(this.o.project)}/statuses`),
      this.epic ? this.epicName() : Promise.resolve(null),
      this.sprint !== null ? this.sprints() : Promise.resolve(null),
    ]);
    // Following the active sprint with none open (T-78): no cards, rather than the whole board.
    const noSprint = this.sprint === 'active' && !sprints?.length;
    const open = sprints?.map((s) => s.id);
    const jql = this.placeJql(open);
    const known = new Map<string, Status>();
    for (const type of statuses) for (const s of type.statuses) known.set(String(s.id), status(s));
    const columns: BoardColumn[] = config.columnConfig.columns.map((c, i) => {
      const ids = c.statuses.map((s) => String(s.id));
      return { id: `col-${i}`, name: c.name, category: known.get(ids[0] ?? '')?.category ?? 'doing', statusIds: ids };
    });
    // The board's own filter, held to the place: a filter that spans other projects shows only this one's (D-072).
    const project = this.o.project.toUpperCase();
    let issues = noSprint ? [] : (await this.boardIssues(id, jql, MAX_CARDS)).filter((i) => projectOf(i) === project);
    if (this.epic && !noSprint) {
      const children = issues.filter((i) => i.fields.parent?.key?.toUpperCase() === this.epic);
      const keys = children.map((i) => i.key.toUpperCase());
      const subtasks: BoardIssue[] = [];
      for (let k = 0; k < keys.length && children.length + subtasks.length < MAX_CARDS; k += 50) {
        const some = keys.slice(k, k + 50);
        const page = await this.boardIssues(id, `project = ${jqlString(this.o.project)} AND parent in (${some.join(', ')})${this.sprintJql(open)}`, MAX_CARDS - children.length - subtasks.length);
        subtasks.push(...page.filter((i) => projectOf(i) === project && some.includes(i.fields.parent?.key?.toUpperCase() ?? '')));
      }
      issues = [...children, ...subtasks];
    }
    const cards: BoardCard[] = issues.map((i) => ({
      key: i.key, title: i.fields.summary, url: `${this.base}/browse/${i.key}`, status: status(i.fields.status),
      type: i.fields.issuetype?.name ?? null, typeKind: typeKindOf(i.fields.issuetype?.name, !!i.fields.issuetype?.subtask), assignees: i.fields.assignee ? [person(i.fields.assignee)] : [],
      labels: (i.fields.labels ?? []).map((name): Label => ({ name, color: null })), ...priorityOf(i.fields.priority),
    }));
    // The board's filter and the place both apply, so a filter that leaves the epic's tickets out shows nothing.
    const notice = noSprint
      ? NO_ACTIVE_SPRINT
      : this.epic && !cards.length
        ? `No ticket in epic ${this.epic} is on this board. Its own filter may leave them out: widen the filter in Jira, or pick another board with Change, above it.`
        : null;
    return {
      source: 'jira-board', title: config.name, url: `${this.base}/jira/software/projects/${encodeURIComponent(this.o.project)}/boards/${id}`, columns, cards, notice,
      place: placeText({ kind: 'jira', project: this.o.project, epic: this.epic, epicName, sprint: this.sprint, sprints }),
      ...(sprints ? { sprints } : {}),
    };
  }

  /** The board's issues that a JQL query picks out, up to `max`. */
  private async boardIssues(id: number, jql: string, max: number): Promise<BoardIssue[]> {
    const out: BoardIssue[] = [];
    for (let startAt = 0; startAt < max; startAt += 100) {
      const page = await this.req<{ issues: BoardIssue[]; total: number }>('GET', `/rest/agile/1.0/board/${id}/issue?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=${Math.min(100, max - startAt)}&fields=summary,status,assignee,issuetype,priority,labels,project,parent`);
      out.push(...page.issues);
      if (startAt + page.issues.length >= page.total || !page.issues.length) break;
    }
    return out;
  }

  /** The epic's own summary, for saying where the board's tickets come from. */
  private async epicName(): Promise<string | null> {
    try {
      return (await this.req<{ fields: { summary?: string } }>('GET', `/rest/api/3/issue/${encodeURIComponent(this.epic!)}?fields=summary`)).fields.summary ?? null;
    } catch (e) {
      if (e instanceof TrackerError && e.kind === 'not-found') throw new TrackerError('not-found', `Epic ${this.epic} isn't in Jira, or this sign-in can't see it. Pick another with the board's Change.`);
      throw e;
    }
  }

  async ticket(key: string): Promise<Ticket> {
    type Link = { type: { inward: string; outward: string }; inwardIssue?: Linked; outwardIssue?: Linked };
    const i = await this.req<{ key: string; fields: {
      summary: string; description: AdfNode | null; status: JiraStatus; assignee: JiraUser | null; reporter: JiraUser | null; labels?: string[];
      priority?: { name: string } | null; issuetype?: { name: string; subtask?: boolean }; created: string; updated: string;
      comment?: { comments: { id: string; author: JiraUser; created: string; body: AdfNode }[] };
      parent?: Linked; subtasks?: Linked[]; issuelinks?: Link[];
      project?: { key: string };
    } }>('GET', `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,status,assignee,reporter,labels,priority,issuetype,created,updated,comment,parent,subtasks,issuelinks,project`);
    const why = await this.whyOutside(i, key, false);
    if (why) throw outsideError({ key: key.toUpperCase(), why }, this.place);
    const f = i.fields;
    const browse = (k: string) => `${this.base}/browse/${k}`;
    return {
      key: i.key, kind: 'jira', url: browse(i.key), title: f.summary, type: f.issuetype?.name ?? null, typeKind: typeKindOf(f.issuetype?.name, !!f.issuetype?.subtask), status: status(f.status),
      assignees: f.assignee ? [person(f.assignee)] : [], reporter: f.reporter ? person(f.reporter) : null,
      labels: (f.labels ?? []).map((name) => ({ name, color: null })), ...priorityOf(f.priority),
      created: f.created, updated: f.updated, body: fromAdf(f.description), markdown: toMarkdown(fromAdf(f.description)), unkept: adfUnkept(f.description),
      comments: (f.comment?.comments ?? []).map((c) => ({ id: c.id, author: person(c.author), created: c.created, body: fromAdf(c.body), url: `${browse(i.key)}?focusedCommentId=${c.id}` })),
      related: [
        ...(f.parent ? [related(f.parent, 'parent', browse(f.parent.key))] : []),
        ...(f.subtasks ?? []).map((s) => related(s, 'sub-task', browse(s.key))),
        ...(f.issuelinks ?? []).flatMap((l) => {
          const other = l.outwardIssue ?? l.inwardIssue;
          return other ? [related(other, l.outwardIssue ? l.type.outward : l.type.inward, browse(other.key))] : [];
        }),
      ],
    };
  }

  async outside(keys: string[], opts: { project?: boolean } = {}): Promise<Outside[]> {
    const found = await inBatches(keys, 5, async (key): Promise<Outside | null> => {
      try {
        const i = await this.req<Placed>('GET', `/rest/api/3/issue/${encodeURIComponent(key)}?fields=project,parent,issuetype`);
        const why = await this.whyOutside(i, key, !!opts.project);
        return why ? { key, why } : null;
      } catch {
        return null; // it couldn't be read, which never counts as outside (D-048)
      }
    });
    return found.filter((o): o is Outside => !!o);
  }

  async stillOpen(keys: string[]): Promise<string[]> {
    const found = await inBatches(keys, 5, async (key): Promise<string | null> => {
      try {
        const i = await this.req<{ key: string; fields: { status: JiraStatus } }>('GET', `/rest/api/3/issue/${encodeURIComponent(key)}?fields=status`);
        return status(i.fields.status).category === 'done' ? null : key;
      } catch {
        return null; // it couldn't be read, so it isn't counted
      }
    });
    return found.filter((k): k is string => !!k);
  }

  async transitions(key: string): Promise<Transition[]> {
    const r = await this.req<{ transitions: { id: string; name: string; to: JiraStatus }[] }>('GET', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`);
    return r.transitions.map((t) => ({ id: String(t.id), name: t.name, to: status(t.to) }));
  }

  async transition(key: string, t: Transition): Promise<void> {
    await this.req('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, { transition: { id: t.id } });
  }

  async comment(key: string, markdown: string): Promise<void> {
    if (!markdown.trim()) throw new TrackerError('refused', 'The comment is empty.');
    await this.req('POST', `/rest/api/3/issue/${encodeURIComponent(key)}/comment`, { body: toAdf(fromMarkdown(markdown)) });
  }

  /**
   * The summary and the description, the description as ADF, as a comment goes. An empty description clears
   * it. A description that holds what Markdown can't (mentions, attachments, panels…) is refused, with what,
   * and nothing is written, since writing it back would drop them from the ticket.
   */
  async setText(key: string, text: TicketText): Promise<void> {
    const fields: Record<string, unknown> = {};
    if (text.title !== undefined) {
      if (!text.title.trim()) throw new TrackerError('refused', 'A ticket needs a title.');
      fields.summary = text.title.trim();
    }
    if (text.markdown !== undefined) {
      const now = await this.req<{ fields: { description: AdfNode | null } }>('GET', `/rest/api/3/issue/${encodeURIComponent(key)}?fields=description`);
      const unkept = adfUnkept(now.fields.description);
      if (unkept.length) throw new TrackerError('refused', unkeptRefusal(unkept));
      fields.description = text.markdown.trim() ? toAdf(fromMarkdown(text.markdown)) : null;
    }
    if (!Object.keys(fields).length) return;
    await this.req('PUT', `/rest/api/3/issue/${encodeURIComponent(key)}`, { fields });
  }

  async me(): Promise<Person> {
    return person(await this.req<JiraUser>('GET', '/rest/api/3/myself'));
  }

  async assignable(key: string, query: string): Promise<Person[]> {
    const r = await this.req<JiraUser[]>('GET', `/rest/api/3/user/assignable/search?issueKey=${encodeURIComponent(key)}&query=${encodeURIComponent(query)}&maxResults=20`);
    return r.map(person);
  }

  /** Jira has one assignee: the first person, or nobody. */
  async assign(key: string, people: Person[]): Promise<void> {
    await this.req('PUT', `/rest/api/3/issue/${encodeURIComponent(key)}/assignee`, { accountId: people[0]?.id ?? null });
  }

  async labels(): Promise<Label[]> {
    const r = await this.req<{ values: string[] }>('GET', '/rest/api/3/label?maxResults=1000');
    return r.values.map((name) => ({ name, color: null }));
  }

  async setLabels(key: string, add: string[], remove: string[]): Promise<void> {
    const bad = add.filter((l) => /\s/.test(l));
    if (bad.length) throw new TrackerError('refused', `Jira labels can't contain spaces: ${bad.join(', ')}.`);
    if (!add.length && !remove.length) return;
    await this.req('PUT', `/rest/api/3/issue/${encodeURIComponent(key)}`, { update: { labels: [...add.map((l) => ({ add: l })), ...remove.map((l) => ({ remove: l }))] } });
  }
}

/** The site's projects and a project's boards, for setting up a tracker from VSCode. */
export async function jiraProjects(site: string, email: string, token: string, f: typeof fetch = fetch): Promise<{ key: string; name: string }[]> {
  const c = new JiraClient({ site, project: '', email, token, fetch: f }) as unknown as { req<T>(m: string, p: string): Promise<T> };
  const r = await c.req<{ values: { key: string; name: string }[] }>('GET', '/rest/api/3/project/search?maxResults=100&orderBy=name');
  return r.values.map((v) => ({ key: v.key, name: v.name }));
}

/** A project's open epics, newest first, for picking where a repo's tickets come from (D-072). */
export async function jiraEpics(site: string, project: string, email: string, token: string, f: typeof fetch = fetch): Promise<{ key: string; name: string }[]> {
  const c = new JiraClient({ site, project, email, token, fetch: f }) as unknown as { req<T>(m: string, p: string): Promise<T> };
  const jql = `project = ${jqlString(project)} AND issuetype = Epic AND statusCategory != Done ORDER BY created DESC`;
  const r = await c.req<{ issues: { key: string; fields: { summary?: string } }[] }>('GET', `/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&fields=summary&maxResults=100`);
  return r.issues.map((i) => ({ key: i.key, name: i.fields.summary ?? '' }));
}

export async function jiraBoards(site: string, project: string, email: string, token: string, f: typeof fetch = fetch): Promise<{ id: number; name: string; type: string }[]> {
  const c = new JiraClient({ site, project, email, token, fetch: f }) as unknown as { req<T>(m: string, p: string): Promise<T> };
  const r = await c.req<{ values: { id: number; name: string; type: string }[] }>('GET', `/rest/agile/1.0/board?projectKeyOrId=${encodeURIComponent(project)}&maxResults=50`);
  return r.values;
}

/**
 * A board's open and future sprints (T-78), open ones first, for picking which one a tracker follows. With
 * no board picked, the project's first board, as the Tasks tab shows. A board that has no sprints, such as
 * a kanban board, is null: Jira refuses the question with a 400. A scrum board between sprints has an empty list.
 */
export async function jiraSprints(site: string, project: string, board: number | null, email: string, token: string, f: typeof fetch = fetch): Promise<Sprint[] | null> {
  const c = new JiraClient({ site, project, email, token, board, fetch: f }) as unknown as { req<T>(m: string, p: string): Promise<T>; boardId(): Promise<number> };
  const id = await c.boardId();
  try {
    const r = await c.req<{ values: JiraSprint[] }>('GET', `/rest/agile/1.0/board/${id}/sprint?state=active,future&maxResults=50`);
    const all = r.values.map(sprintOf);
    return [...all.filter((s) => s.state === 'active'), ...all.filter((s) => s.state !== 'active')];
  } catch (e) {
    if (e instanceof TrackerError && e.kind === 'other') return null;
    throw e;
  }
}
