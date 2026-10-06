/**
 * Azure Boards over Azure DevOps' REST API (D-027). A board's columns are the team's Kanban columns,
 * each mapping every work item type to a state; a move sets the board column and that state together.
 * Sign-in comes from outside, as a function returning the Authorization header: a Microsoft account's
 * token or a personal access token, kept for one repo only.
 */
import { type Doc, fromHtml, fromMarkdown, toHtml, toMarkdown } from './doc.ts';
import {
  type Board, type BoardCard, type BoardColumn, type Label, type Outside, outsideError, type Person, placeText, type Status, type StatusCategory,
  type Ticket, type TrackerClient, TrackerError, type Transition,
} from './types.ts';

export interface AzureOptions {
  /** The organization, as in dev.azure.com/<organization>. */
  organization: string;
  project: string;
  /** The team whose board to show. By default, the project's default team. */
  team?: string | null;
  /** A board name, such as Stories or Backlog items. By default, the team's requirements board. */
  board?: string | null;
  /** The key prefix for work items, such as AB for AB-123. */
  prefix?: string;
  /** Only work items under this area path count (D-???), such as CRM\Billing. By default, the team's own areas. */
  areaPath?: string | null;
  /** Returns the Authorization header for each call: "Bearer …" or "Basic …". */
  auth: () => Promise<string>;
  fetch?: typeof fetch;
}

const API = 'api-version=7.1';
const COMMENTS_API = 'api-version=7.1-preview.4';

/** Azure's state categories, placed in a workflow for drawing. */
const STATE_CATEGORY: Record<string, StatusCategory> = { Proposed: 'todo', InProgress: 'doing', Resolved: 'doing', Completed: 'done', Removed: 'done' };
const COLUMN_CATEGORY: Record<string, StatusCategory> = { incoming: 'todo', inProgress: 'doing', outgoing: 'done' };
const PRIORITY: Record<number, string> = { 1: 'Highest (1)', 2: 'High (2)', 3: 'Medium (3)', 4: 'Low (4)' };

interface Identity { displayName?: string; uniqueName?: string; id?: string }
const person = (i: Identity | null | undefined): Person | null => (i?.displayName || i?.uniqueName ? { id: i.uniqueName ?? i.id ?? '', name: i.displayName || i.uniqueName! } : null);
const tags = (s: unknown): Label[] => (typeof s === 'string' ? s.split(';').map((t) => t.trim()).filter(Boolean).map((name) => ({ name, color: null })) : []);
const quote = (s: string): string => `'${s.replace(/'/g, "''")}'`;
/** Whether an area path is the place's, or under it. Azure's paths ignore case. */
const under = (path: string, area: string): boolean => {
  const p = path.toLowerCase();
  const a = area.toLowerCase().replace(/\\+$/, '');
  return p === a || p.startsWith(`${a}\\`);
};

interface AzureColumn { id: string; name: string; columnType: string; stateMappings: Record<string, string> }

/** The tenant that owns an organization, from the header Azure DevOps sends even without signing in. */
export async function tenantOf(organization: string, f: typeof fetch = fetch): Promise<string | null> {
  try {
    const r = await f(`https://dev.azure.com/${encodeURIComponent(organization)}/_apis/connectionData`, { method: 'HEAD' });
    const t = r.headers.get('x-vss-resourcetenant');
    return t && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

export class AzureClient implements TrackerClient {
  readonly kind = 'azure' as const;
  readonly title: string;
  readonly place: string;
  readonly prefix: string;
  private readonly o: AzureOptions;
  private readonly base: string;
  private readonly area: string | null;
  private boardCache: Promise<{ team: string; id: string; name: string; columns: AzureColumn[]; columnField: string }> | null = null;
  private readonly statesCache = new Map<string, Promise<Status[]>>();

  constructor(o: AzureOptions) {
    this.o = o;
    this.prefix = (o.prefix ?? 'AB').toUpperCase();
    this.base = `https://dev.azure.com/${encodeURIComponent(o.organization)}`;
    this.title = `Azure DevOps · ${o.project}`;
    this.area = o.areaPath?.trim() || null;
    this.place = placeText({ kind: 'azure', project: o.project, team: o.team, areaPath: this.area });
  }

  /**
   * Why a work item is outside the place, or null (D-???). Work item ids are the whole organization's, so
   * one from another project can be asked for by id. With `projectOnly`, the area path doesn't count.
   */
  private whyOutside(f: Record<string, unknown>, projectOnly: boolean): string | null {
    const project = String(f['System.TeamProject'] ?? '');
    if (project && project.toLowerCase() !== this.o.project.toLowerCase()) return `it's in project ${project}`;
    const area = String(f['System.AreaPath'] ?? '');
    if (projectOnly || !this.area || !area || under(area, this.area)) return null;
    return `its area ${area} isn't under ${this.area}`;
  }

  private get proj(): string { return encodeURIComponent(this.o.project); }

  idOf(key: string): number {
    const m = new RegExp(`^(?:${this.prefix}-|#)?(\\d+)$`, 'i').exec(key.trim());
    if (!m) throw new TrackerError('not-found', `${key} isn't a work item key (${this.prefix}-<id>).`);
    return Number(m[1]);
  }

  private keyOf(id: number): string { return `${this.prefix}-${id}`; }
  private urlOf(id: number): string { return `${this.base}/${this.proj}/_workitems/edit/${id}`; }

  private async req<T>(method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown, contentType = 'application/json'): Promise<T> {
    const f = this.o.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(url.startsWith('http') ? url : `${this.base}${url}`, {
        method,
        headers: { Authorization: await this.o.auth(), Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': contentType } : {}), 'X-TFS-FedAuthRedirect': 'Suppress' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      if (e instanceof TrackerError) throw e;
      throw new TrackerError('network', `Couldn't reach ${this.base}: ${(e as Error).message}`);
    }
    const text = await res.text();
    // A refused sign-in can come back as a sign-in page (203 or 302), not a 401.
    const html = /^\s*</.test(text) || (res.headers.get('content-type') ?? '').includes('text/html');
    if (res.status === 401 || res.status === 203 || (res.ok && html)) throw new TrackerError('auth', `Azure DevOps (${this.o.organization}) didn't accept this repo's sign-in. Sign in again.`);
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (res.ok) return json as T;
    const why = (json as { message?: string } | null)?.message ?? `HTTP ${res.status}`;
    if (res.status === 403) throw new TrackerError('refused', `Azure DevOps said no: ${why}`);
    if (res.status === 404) throw new TrackerError('not-found', why);
    throw new TrackerError('other', why);
  }

  private patch(id: number, ops: { op: 'add' | 'remove' | 'replace'; path: string; value?: unknown }[]): Promise<unknown> {
    return this.req('PATCH', `/${this.proj}/_apis/wit/workitems/${id}?${API}`, ops, 'application/json-patch+json');
  }

  /** The team's board: its columns, and the field that records which column a card is in. */
  private boardInfo() {
    this.boardCache ??= (async () => {
      const team = this.o.team ?? (await this.req<{ defaultTeam?: { name: string } }>('GET', `/_apis/projects/${this.proj}?${API}`)).defaultTeam?.name;
      if (!team) throw new TrackerError('not-found', `${this.o.project} has no default team. Set "team" on the tracker in .acc/config.json.`);
      const t = encodeURIComponent(team);
      const boards = (await this.req<{ value: { id: string; name: string }[] }>('GET', `/${this.proj}/${t}/_apis/work/boards?${API}`)).value;
      const want = this.o.board?.toLowerCase();
      const pick = (want ? boards.find((b) => b.name.toLowerCase() === want) : undefined)
        ?? boards.find((b) => /stories|backlog items|requirements|issues/i.test(b.name)) ?? boards[boards.length - 1];
      if (!pick) throw new TrackerError('not-found', `The ${team} team has no boards.`);
      if (want && pick.name.toLowerCase() !== want) throw new TrackerError('not-found', `The ${team} team has no board called ${this.o.board}. It has: ${boards.map((b) => b.name).join(', ')}.`);
      const b = await this.req<{ columns: AzureColumn[]; fields?: { columnField?: { referenceName: string } } }>('GET', `/${this.proj}/${t}/_apis/work/boards/${encodeURIComponent(pick.id)}?${API}`);
      return { team, id: pick.id, name: pick.name, columns: b.columns, columnField: b.fields?.columnField?.referenceName ?? 'System.BoardColumn' };
    })();
    this.boardCache.catch(() => { this.boardCache = null; });
    return this.boardCache;
  }

  async board(): Promise<Board> {
    const b = await this.boardInfo();
    const t = encodeURIComponent(b.team);
    const columns: BoardColumn[] = b.columns.map((c) => ({ id: c.name, name: c.name, category: COLUMN_CATEGORY[c.columnType] ?? 'doing', statusIds: [c.name] }));
    const types = [...new Set(b.columns.flatMap((c) => Object.keys(c.stateMappings)))];
    const doneStates = [...new Set(b.columns.filter((c) => c.columnType === 'outgoing').flatMap((c) => Object.values(c.stateMappings)))];
    const area = await this.req<{ field?: { referenceName: string }; values: { value: string; includeChildren: boolean }[] }>('GET', `/${this.proj}/${t}/_apis/work/teamsettings/teamfieldvalues?${API}`);
    const areaField = area.field?.referenceName ?? 'System.AreaPath';
    const areas = area.values.map((v) => `[${areaField}] ${v.includeChildren ? 'UNDER' : '='} ${quote(v.value)}`).join(' OR ');
    // The board's own rule: the team's work items of the board's types; finished ones only from the last 30 days.
    const query = [
      'SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project',
      types.length ? `AND [System.WorkItemType] IN (${types.map(quote).join(', ')})` : '',
      areas ? `AND (${areas})` : '',
      // The place: only work items under its area path (D-???).
      this.area ? `AND [System.AreaPath] UNDER ${quote(this.area)}` : '',
      "AND [System.State] <> 'Removed'",
      doneStates.length ? `AND ([System.State] NOT IN (${doneStates.map(quote).join(', ')}) OR [System.ChangedDate] >= @Today - 30)` : '',
      'ORDER BY [Microsoft.VSTS.Common.StackRank] ASC, [System.ChangedDate] DESC',
    ].filter(Boolean).join(' ');
    const ids = (await this.req<{ workItems: { id: number }[] }>('POST', `/${this.proj}/${t}/_apis/wit/wiql?${API}&$top=300`, { query })).workItems.map((w) => w.id);
    const fields = ['System.Id', 'System.Title', 'System.State', 'System.WorkItemType', 'System.AssignedTo', 'System.Tags', 'Microsoft.VSTS.Common.Priority', b.columnField];
    const items: { id: number; fields: Record<string, unknown> }[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      items.push(...(await this.req<{ value: typeof items }>('POST', `/${this.proj}/_apis/wit/workitemsbatch?${API}`, { ids: ids.slice(i, i + 200), fields })).value);
    }
    const cards: BoardCard[] = [];
    for (const it of items) {
      const f = it.fields;
      const type = String(f['System.WorkItemType'] ?? '');
      const state = String(f['System.State'] ?? '');
      // The board column the card is in: its own record of it, or else the column its state maps to.
      const recorded = typeof f[b.columnField] === 'string' ? (f[b.columnField] as string) : null;
      const col = b.columns.find((c) => c.name === recorded && c.stateMappings[type] === state) ?? b.columns.find((c) => c.stateMappings[type] === state);
      if (!col) continue;
      const assignee = person(f['System.AssignedTo'] as Identity);
      cards.push({
        key: this.keyOf(it.id), title: String(f['System.Title'] ?? ''), url: this.urlOf(it.id),
        status: { id: col.name, name: state, category: COLUMN_CATEGORY[col.columnType] ?? 'doing' },
        type, assignees: assignee ? [assignee] : [], labels: tags(f['System.Tags']),
        priority: PRIORITY[Number(f['Microsoft.VSTS.Common.Priority'])] ?? null,
      });
    }
    return {
      source: 'azure-board', title: `${b.name} · ${b.team}`, url: `${this.base}/${this.proj}/_boards/board/t/${encodeURIComponent(b.team)}/${encodeURIComponent(b.name)}`, columns, cards,
      notice: this.area && !cards.length ? `No work item under ${this.area} is on this board. The team's own areas may leave it out: pick another team or area with Add a tracker.` : null,
      place: placeText({ kind: 'azure', project: this.o.project, team: b.team, areaPath: this.area }),
    };
  }

  /** Moves a card to a column: the column field, and the state the column maps the card's type to. */
  async moveToColumn(card: BoardCard, column: BoardColumn): Promise<void> {
    const b = await this.boardInfo();
    const col = b.columns.find((c) => c.name === column.id);
    const type = card.type ?? '';
    const state = col?.stateMappings[type];
    if (!col || !state) throw new TrackerError('refused', `The ${column.name} column doesn't take ${type || 'this kind of'} work items.`);
    await this.patch(this.idOf(card.key), [
      { op: 'add', path: `/fields/${b.columnField}`, value: col.name },
      ...(state !== card.status.name ? [{ op: 'add' as const, path: '/fields/System.State', value: state }] : []),
    ]);
  }

  private states(type: string): Promise<Status[]> {
    let s = this.statesCache.get(type);
    if (!s) {
      s = this.req<{ value: { name: string; category: string }[] }>('GET', `/${this.proj}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states?${API}`)
        .then((r) => r.value.map((x) => ({ id: x.name, name: x.name, category: STATE_CATEGORY[x.category] ?? 'doing' })));
      this.statesCache.set(type, s);
      s.catch(() => this.statesCache.delete(type));
    }
    return s;
  }

  async ticket(key: string): Promise<Ticket> {
    const id = this.idOf(key);
    const w = await this.req<{ id: number; fields: Record<string, unknown>; relations?: { rel: string; url: string; attributes?: { name?: string } }[]; multilineFieldsFormat?: Record<string, string> }>('GET', `/${this.proj}/_apis/wit/workitems/${id}?$expand=relations&${API}`);
    const f = w.fields;
    const why = this.whyOutside(f, false);
    if (why) throw outsideError({ key: this.keyOf(id), why }, this.place);
    const type = String(f['System.WorkItemType'] ?? '');
    const states = await this.states(type).catch(() => [] as Status[]);
    const stateName = String(f['System.State'] ?? '');
    const rich = (field: string): Doc => {
      const v = f[field];
      if (typeof v !== 'string' || !v.trim()) return { blocks: [] };
      return (w.multilineFieldsFormat?.[field] ?? '').toLowerCase() === 'markdown' ? fromMarkdown(v) : fromHtml(v);
    };
    // A work item's text lives in several fields; they're shown in order, each under its own heading.
    const sections: [string, string][] = [['Repro steps', 'Microsoft.VSTS.TCM.ReproSteps'], ['Acceptance criteria', 'Microsoft.VSTS.Common.AcceptanceCriteria']];
    const body: Doc = { blocks: [...rich('System.Description').blocks] };
    for (const [label, field] of sections) {
      const d = rich(field);
      if (d.blocks.length) body.blocks.push({ t: 'h', level: 2, c: [{ t: 'text', text: label }] }, ...d.blocks);
    }
    const comments = await this.req<{ comments: { id: number; text: string; format?: string; createdBy: Identity; createdDate: string }[] }>('GET', `/${this.proj}/_apis/wit/workItems/${id}/comments?${COMMENTS_API}&order=asc&$top=200`).catch(() => ({ comments: [] }));
    const REL: Record<string, string> = {
      'System.LinkTypes.Hierarchy-Reverse': 'parent', 'System.LinkTypes.Hierarchy-Forward': 'child', 'System.LinkTypes.Related': 'related',
      'System.LinkTypes.Dependency-Forward': 'successor', 'System.LinkTypes.Dependency-Reverse': 'predecessor', 'System.LinkTypes.Duplicate-Forward': 'duplicate', 'System.LinkTypes.Duplicate-Reverse': 'duplicate of',
    };
    const links = (w.relations ?? []).flatMap((r) => {
      const n = /\/workItems\/(\d+)$/i.exec(r.url);
      return REL[r.rel] && n ? [{ id: Number(n[1]), relation: REL[r.rel]! }] : [];
    });
    const titles = new Map<number, string>();
    if (links.length) {
      const got = await this.req<{ value: { id: number; fields: Record<string, unknown> }[] }>('POST', `/${this.proj}/_apis/wit/workitemsbatch?${API}`, { ids: links.map((l) => l.id), fields: ['System.Id', 'System.Title'] }).catch(() => ({ value: [] }));
      for (const g of got.value) titles.set(g.id, String(g.fields['System.Title'] ?? ''));
    }
    const priority = PRIORITY[Number(f['Microsoft.VSTS.Common.Priority'])] ?? null;
    return {
      key: this.keyOf(id), kind: 'azure', url: this.urlOf(id), title: String(f['System.Title'] ?? ''), type: type || null,
      status: states.find((s) => s.name === stateName) ?? { id: stateName, name: stateName, category: 'doing' },
      assignees: [person(f['System.AssignedTo'] as Identity)].filter((p): p is Person => !!p),
      reporter: person(f['System.CreatedBy'] as Identity), labels: tags(f['System.Tags']), priority,
      created: String(f['System.CreatedDate'] ?? ''), updated: String(f['System.ChangedDate'] ?? ''),
      body, markdown: toMarkdown(body),
      comments: comments.comments.map((c) => ({
        id: String(c.id), author: person(c.createdBy) ?? { id: '', name: 'Someone' }, created: c.createdDate,
        body: (c.format ?? '').toLowerCase() === 'markdown' ? fromMarkdown(c.text) : fromHtml(c.text), url: `${this.urlOf(id)}#${c.id}`,
      })),
      related: links.map((l) => ({ key: this.keyOf(l.id), title: titles.get(l.id) ?? '', relation: l.relation, url: this.urlOf(l.id) })),
    };
  }

  /** One batch call for all of them, from the organization, so a work item moved to another project still answers. */
  async outside(keys: string[], opts: { project?: boolean } = {}): Promise<Outside[]> {
    const ids = new Map<number, string>();
    for (const key of keys) {
      try {
        ids.set(this.idOf(key), key);
      } catch {
        // not a work item key: nothing to say about it
      }
    }
    const out: Outside[] = [];
    const list = [...ids.keys()];
    for (let i = 0; i < list.length; i += 200) {
      let got: { value: ({ id: number; fields: Record<string, unknown> } | null)[] };
      try {
        // Omit: a deleted work item comes back as null rather than failing the rest.
        got = await this.req('POST', `/_apis/wit/workitemsbatch?${API}`, { ids: list.slice(i, i + 200), fields: ['System.Id', 'System.TeamProject', 'System.AreaPath'], errorPolicy: 'omit' });
      } catch {
        continue; // it couldn't be read, which never counts as outside (D-048)
      }
      for (const w of got.value) {
        const why = w ? this.whyOutside(w.fields, !!opts.project) : null;
        if (w && why) out.push({ key: ids.get(w.id) ?? this.keyOf(w.id), why });
      }
    }
    return out;
  }

  /** Every state the work item's type has, other than where it is and Removed. */
  async transitions(key: string): Promise<Transition[]> {
    const w = await this.req<{ fields: Record<string, unknown> }>('GET', `/${this.proj}/_apis/wit/workitems/${this.idOf(key)}?fields=System.State,System.WorkItemType&${API}`);
    const now = String(w.fields['System.State']);
    return (await this.states(String(w.fields['System.WorkItemType'])))
      .filter((s) => s.name !== now && s.name !== 'Removed')
      .map((s) => ({ id: s.name, name: s.name, to: s }));
  }

  async transition(key: string, t: Transition): Promise<void> {
    await this.patch(this.idOf(key), [{ op: 'add', path: '/fields/System.State', value: t.to.name }]);
  }

  async comment(key: string, markdown: string): Promise<void> {
    if (!markdown.trim()) throw new TrackerError('refused', 'The comment is empty.');
    await this.req('POST', `/${this.proj}/_apis/wit/workItems/${this.idOf(key)}/comments?${COMMENTS_API}`, { text: toHtml(fromMarkdown(markdown)) });
  }

  async me(): Promise<Person> {
    const c = await this.req<{ authenticatedUser: { id: string; providerDisplayName?: string; properties?: { Account?: { $value?: string } } } }>('GET', '/_apis/connectionData');
    const u = c.authenticatedUser;
    return { id: u.properties?.Account?.$value ?? u.id, name: u.providerDisplayName ?? u.properties?.Account?.$value ?? 'You' };
  }

  async assignable(_key: string, query: string): Promise<Person[]> {
    const b = await this.boardInfo();
    const r = await this.req<{ value: { identity: Identity }[] }>('GET', `/_apis/projects/${this.proj}/teams/${encodeURIComponent(b.team)}/members?${API}&$top=500`);
    const q = query.toLowerCase();
    return r.value.map((m) => person(m.identity)).filter((p): p is Person => !!p && (p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)));
  }

  /** A work item has one assignee: the first person, or nobody. */
  async assign(key: string, people: Person[]): Promise<void> {
    await this.patch(this.idOf(key), [{ op: 'add', path: '/fields/System.AssignedTo', value: people[0]?.id ?? '' }]);
  }

  async labels(): Promise<Label[]> {
    const r = await this.req<{ value: { name: string }[] }>('GET', `/${this.proj}/_apis/wit/tags?api-version=7.1-preview.1`);
    return r.value.map((t) => ({ name: t.name, color: null }));
  }

  /** Tags are one field, so the whole list is written back. */
  async setLabels(key: string, add: string[], remove: string[]): Promise<void> {
    if (!add.length && !remove.length) return;
    const id = this.idOf(key);
    const w = await this.req<{ fields: Record<string, unknown> }>('GET', `/${this.proj}/_apis/wit/workitems/${id}?fields=System.Tags&${API}`);
    const now = tags(w.fields['System.Tags']).map((l) => l.name);
    const next = [...now.filter((n) => !remove.includes(n)), ...add.filter((a) => !now.includes(a))];
    await this.patch(id, [{ op: 'add', path: '/fields/System.Tags', value: next.join('; ') }]);
  }
}

/** For the sign-in check: who a header belongs to, without needing a project. */
export async function azureWhoAmI(organization: string, auth: string, f: typeof fetch = fetch): Promise<Person> {
  return new AzureClient({ organization, project: '_', auth: async () => auth, fetch: f }).me();
}

/** A plain GET for setting up a tracker, before there's a project to make a client for. */
async function get<T>(url: string, auth: string, f: typeof fetch): Promise<T> {
  let r: Response;
  try {
    r = await f(url, { headers: { Authorization: auth, Accept: 'application/json', 'X-TFS-FedAuthRedirect': 'Suppress' } });
  } catch (e) {
    throw new TrackerError('network', `Couldn't reach Azure DevOps: ${(e as Error).message}`);
  }
  const text = await r.text();
  if (r.status === 401 || r.status === 203 || /^\s*</.test(text)) throw new TrackerError('auth', 'Azure DevOps didn\'t accept this sign-in.');
  if (!r.ok) throw new TrackerError(r.status === 404 ? 'not-found' : 'other', `Azure DevOps answered HTTP ${r.status}.`);
  return JSON.parse(text) as T;
}

const byName = (v: { name: string }[]): string[] => v.map((x) => x.name).sort((a, b) => a.localeCompare(b));

/** The organization's projects, for setting up a tracker from VSCode. */
export async function azureProjects(organization: string, auth: string, f: typeof fetch = fetch): Promise<string[]> {
  return byName((await get<{ value: { name: string }[] }>(`https://dev.azure.com/${encodeURIComponent(organization)}/_apis/projects?${API}&$top=500`, auth, f)).value);
}

/** A project's teams, default team first. */
export async function azureTeams(organization: string, project: string, auth: string, f: typeof fetch = fetch): Promise<string[]> {
  const org = `https://dev.azure.com/${encodeURIComponent(organization)}`;
  const [teams, proj] = await Promise.all([
    get<{ value: { name: string }[] }>(`${org}/_apis/projects/${encodeURIComponent(project)}/teams?${API}&$top=500`, auth, f),
    get<{ defaultTeam?: { name: string } }>(`${org}/_apis/projects/${encodeURIComponent(project)}?${API}`, auth, f),
  ]);
  const names = byName(teams.value);
  const d = proj.defaultTeam?.name;
  return d ? [d, ...names.filter((n) => n !== d)] : names;
}

/**
 * The area paths a team's board covers, each followed by the ones under it, for picking where a repo's
 * work items come from (D-???). A team whose board isn't by area path gets the project's whole tree.
 */
export async function azureAreas(organization: string, project: string, team: string, auth: string, f: typeof fetch = fetch): Promise<string[]> {
  const proj = `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}`;
  type Node = { name: string; children?: Node[] };
  const [teamAreas, root] = await Promise.all([
    get<{ field?: { referenceName: string }; values: { value: string; includeChildren: boolean }[] }>(`${proj}/${encodeURIComponent(team)}/_apis/work/teamsettings/teamfieldvalues?${API}`, auth, f),
    get<Node>(`${proj}/_apis/wit/classificationnodes/Areas?$depth=10&${API}`, auth, f),
  ]);
  const paths = new Map<string, string[]>();
  const walk = (n: Node, path: string): string[] => {
    const below = (n.children ?? []).flatMap((c) => walk(c, `${path}\\${c.name}`));
    paths.set(path.toLowerCase(), below);
    return [path, ...below];
  };
  const all = walk(root, root.name);
  if ((teamAreas.field?.referenceName ?? 'System.AreaPath') !== 'System.AreaPath' || !teamAreas.values.length) return all;
  const out: string[] = [];
  for (const v of teamAreas.values) out.push(v.value, ...(v.includeChildren ? paths.get(v.value.toLowerCase()) ?? [] : []));
  return [...new Set(out)];
}

/** A team's boards, in backlog order (Epics, Features, then stories or backlog items). */
export async function azureBoards(organization: string, project: string, team: string, auth: string, f: typeof fetch = fetch): Promise<string[]> {
  return (await get<{ value: { name: string }[] }>(`https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/${encodeURIComponent(team)}/_apis/work/boards?${API}`, auth, f)).value.map((b) => b.name);
}
