/**
 * Jira Cloud over its REST API, with the person's email and API token (D-026). A board's columns are the
 * Jira board's own columns, each mapped to the statuses it holds, and a move is a workflow transition.
 */
import { type AdfNode, fromAdf, fromMarkdown, toAdf, toMarkdown } from './doc.ts';
import {
  type Board, type BoardCard, type BoardColumn, type Label, type Person, type Status, type StatusCategory,
  type Ticket, type TrackerClient, TrackerError, type Transition,
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
  fetch?: typeof fetch;
}

interface JiraStatus { id: string; name: string; statusCategory?: { key?: string } }
interface JiraUser { accountId: string; displayName?: string }

const CATEGORY: Record<string, StatusCategory> = { new: 'todo', indeterminate: 'doing', done: 'done' };
const status = (s: JiraStatus): Status => ({ id: String(s.id), name: s.name, category: CATEGORY[s.statusCategory?.key ?? ''] ?? 'doing' });
const person = (u: JiraUser): Person => ({ id: u.accountId, name: u.displayName || 'Unknown' });

export class JiraClient implements TrackerClient {
  readonly kind = 'jira' as const;
  readonly title: string;
  private readonly o: JiraOptions;
  private readonly base: string;
  private boardIdCache: Promise<number> | null = null;

  constructor(o: JiraOptions) {
    this.o = o;
    this.base = `https://${o.site.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
    this.title = `Jira · ${o.project}`;
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
    const [config, statuses] = await Promise.all([
      this.req<{ name: string; columnConfig: { columns: { name: string; statuses: { id: string }[] }[] } }>('GET', `/rest/agile/1.0/board/${id}/configuration`),
      this.req<{ statuses: JiraStatus[] }[]>('GET', `/rest/api/3/project/${encodeURIComponent(this.o.project)}/statuses`),
    ]);
    const known = new Map<string, Status>();
    for (const type of statuses) for (const s of type.statuses) known.set(String(s.id), status(s));
    const columns: BoardColumn[] = config.columnConfig.columns.map((c, i) => {
      const ids = c.statuses.map((s) => String(s.id));
      return { id: `col-${i}`, name: c.name, category: known.get(ids[0] ?? '')?.category ?? 'doing', statusIds: ids };
    });
    type Issue = { key: string; fields: { summary: string; status: JiraStatus; assignee: JiraUser | null; issuetype?: { name: string }; priority?: { name: string } | null; labels?: string[] } };
    const cards: BoardCard[] = [];
    for (let startAt = 0; startAt < 300; startAt += 100) {
      const page = await this.req<{ issues: Issue[]; total: number }>('GET', `/rest/agile/1.0/board/${id}/issue?startAt=${startAt}&maxResults=100&fields=summary,status,assignee,issuetype,priority,labels`);
      for (const i of page.issues) {
        cards.push({
          key: i.key, title: i.fields.summary, url: `${this.base}/browse/${i.key}`, status: status(i.fields.status),
          type: i.fields.issuetype?.name ?? null, assignees: i.fields.assignee ? [person(i.fields.assignee)] : [],
          labels: (i.fields.labels ?? []).map((name): Label => ({ name, color: null })), priority: i.fields.priority?.name ?? null,
        });
      }
      if (startAt + page.issues.length >= page.total || !page.issues.length) break;
    }
    return { source: 'jira-board', title: config.name, url: `${this.base}/jira/software/projects/${encodeURIComponent(this.o.project)}/boards/${id}`, columns, cards, notice: null };
  }

  async ticket(key: string): Promise<Ticket> {
    type Link = { type: { inward: string; outward: string }; inwardIssue?: { key: string; fields: { summary: string } }; outwardIssue?: { key: string; fields: { summary: string } } };
    const i = await this.req<{ key: string; fields: {
      summary: string; description: AdfNode | null; status: JiraStatus; assignee: JiraUser | null; reporter: JiraUser | null; labels?: string[];
      priority?: { name: string } | null; issuetype?: { name: string }; created: string; updated: string;
      comment?: { comments: { id: string; author: JiraUser; created: string; body: AdfNode }[] };
      parent?: { key: string; fields: { summary: string } }; subtasks?: { key: string; fields: { summary: string } }[]; issuelinks?: Link[];
    } }>('GET', `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,description,status,assignee,reporter,labels,priority,issuetype,created,updated,comment,parent,subtasks,issuelinks`);
    const f = i.fields;
    const browse = (k: string) => `${this.base}/browse/${k}`;
    return {
      key: i.key, kind: 'jira', url: browse(i.key), title: f.summary, type: f.issuetype?.name ?? null, status: status(f.status),
      assignees: f.assignee ? [person(f.assignee)] : [], reporter: f.reporter ? person(f.reporter) : null,
      labels: (f.labels ?? []).map((name) => ({ name, color: null })), priority: f.priority?.name ?? null,
      created: f.created, updated: f.updated, body: fromAdf(f.description), markdown: toMarkdown(fromAdf(f.description)),
      comments: (f.comment?.comments ?? []).map((c) => ({ id: c.id, author: person(c.author), created: c.created, body: fromAdf(c.body), url: `${browse(i.key)}?focusedCommentId=${c.id}` })),
      related: [
        ...(f.parent ? [{ key: f.parent.key, title: f.parent.fields.summary, relation: 'parent', url: browse(f.parent.key) }] : []),
        ...(f.subtasks ?? []).map((s) => ({ key: s.key, title: s.fields.summary, relation: 'sub-task', url: browse(s.key) })),
        ...(f.issuelinks ?? []).flatMap((l) => {
          const other = l.outwardIssue ?? l.inwardIssue;
          return other ? [{ key: other.key, title: other.fields.summary, relation: l.outwardIssue ? l.type.outward : l.type.inward, url: browse(other.key) }] : [];
        }),
      ],
    };
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
