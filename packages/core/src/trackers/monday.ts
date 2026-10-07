/**
 * monday.com boards over its GraphQL API, with a personal API token kept for one repo only (D-027). A
 * board is the tracker, as a Jira project is; a group on it can be the repo's place (D-072). The board's
 * columns are one status column's labels, in monday's order, and its items are the cards. Item ids are the
 * whole account's, so every read is held to the board, and to the group when there is one. Everything a
 * call carries goes as a GraphQL variable, never into the query's text.
 */
import { type Doc, fromHtml, fromMarkdown, toHtml, toMarkdown } from './doc.ts';
import {
  type Board, type BoardCard, type BoardColumn, type Comment, type Label, type Outside, outsideError, type Person, placeText, type Status,
  type Ticket, type TrackerClient, TrackerError, type Transition,
} from './types.ts';

export const MONDAY_API = 'https://api.monday.com/v2';
/** The API version every call asks for, so monday never changes a shape under us (D-085). */
export const MONDAY_VERSION = '2026-10';
/** Where a person makes their personal API token: the Developer Center's My access tokens. */
export const mondayTokenPage = (account: string): string => `https://${account}.monday.com/apps/manage/tokens`;

export interface MondayOptions {
  /** The account, as in acme.monday.com. */
  account: string;
  /** The board's id: which tracker this is. */
  board: number | string;
  /** Only the board's items in this group count (D-072). By default, the whole board. */
  group?: string | null;
  /** The status column whose labels are the columns. By default, the one called Status, or the first. */
  statusColumn?: string | null;
  /** The key prefix for items, such as MON for MON-123. */
  prefix?: string;
  token: string;
  fetch?: typeof fetch;
}

/** A status label, as the board's column settings give it. */
interface MondayLabel { id: string; name: string; position: number; done: boolean; deactivated: boolean }
interface MondayColumn { id: string; title: string; type: string; settings?: unknown }
interface MondayGroup { id: string; title: string }
interface BoardMeta { id: string; name: string; columns: MondayColumn[]; groups: MondayGroup[] }
interface MondayPerson { id: string; name: string }
interface MondayUpdate { id: string; body: string; created_at: string; creator: MondayPerson | null; replies?: MondayUpdate[] }
interface ColumnValue { id: string; type?: string; text?: string | null; column?: { title: string }; index?: number | null; label?: string | null; is_done?: boolean | null; persons_and_teams?: { id: string | number; kind: string }[] | null }
interface CardItem { id: string; name: string; group?: { id: string } | null; column_values: ColumnValue[] }
interface PlacedItem { id: string; board: { id: string; name: string } | null; group: { id: string; title: string } | null }
interface FullItem extends PlacedItem {
  name: string; state?: string; url?: string | null; created_at: string; updated_at: string; creator: MondayPerson | null;
  column_values: ColumnValue[]; updates: MondayUpdate[]; subitems?: { id: string; name: string; url?: string | null }[] | null; parent_item?: { id: string; name: string; url?: string | null } | null;
}

/** Items per page, as items_page allows at most. */
const PAGE = 500;
/** The most cards a board shows. */
const MAX_CARDS = 2000;
/** Items read by id at once, as items(ids:) allows at most. */
const BATCH = 100;
const NO_STATUS = 'none';
const NO_LABELS = 'monday.com items have no labels.';

/** What a card needs from each item: its group, its status, and its people. Constant text: what varies is a variable. */
const CARD_FIELDS = 'id name group { id } column_values(ids: $cols) { id ... on StatusValue { index } ... on PeopleValue { persons_and_teams { id kind } } }';
const PLACED_FIELDS = 'id board { id name } group { id title }';

const RATE_CODES = /complexity|rate.?limit|concurrency|budget/i;

/**
 * One GraphQL call. A refused token is 'auth'; a rate or complexity limit says how long to wait, and
 * isn't tried again here, since a board reloads on its own.
 */
export async function mondayCall<T>(token: string, query: string, variables: Record<string, unknown>, f: typeof fetch = fetch): Promise<T> {
  let res: Response;
  try {
    res = await f(MONDAY_API, {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json', Accept: 'application/json', 'API-Version': MONDAY_VERSION },
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new TrackerError('network', `Couldn't reach monday.com: ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: { data?: T; errors?: { message?: string; extensions?: { code?: string; status_code?: number; retry_in_seconds?: number; error_data?: { retry_in_seconds?: number } } }[]; error_message?: string } | null = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  const err = json?.errors?.[0];
  const code = err?.extensions?.code ?? '';
  const status = err?.extensions?.status_code ?? res.status;
  const why = err?.message ?? json?.error_message ?? `HTTP ${res.status}`;
  if (status === 401 || /^unauthorized$/i.test(code)) throw new TrackerError('auth', 'monday.com didn\'t accept this repo\'s API token. Sign in again.');
  if (res.status === 429 || RATE_CODES.test(code)) {
    const wait = err?.extensions?.retry_in_seconds ?? err?.extensions?.error_data?.retry_in_seconds ?? Number(res.headers.get('retry-after') ?? NaN);
    throw new TrackerError('other', `monday.com's rate limit for this account was reached${Number.isFinite(wait) && wait > 0 ? `: it takes requests again in ${Math.ceil(wait)} seconds` : ''}. The board tries again when it next reloads.`);
  }
  if (err) {
    if (status === 403 || /unauthorized|access_denied|permission/i.test(code)) throw new TrackerError('refused', `monday.com said no: ${why}`);
    if (/notfound|invalid(board|item)id/i.test(code)) throw new TrackerError('not-found', why);
    throw new TrackerError('other', `monday.com: ${why}`);
  }
  if (!res.ok || !json?.data) throw new TrackerError('other', `monday.com answered HTTP ${res.status}.`);
  return json.data;
}

/** A JSON value monday may send as text, as it does a column's settings in some versions. */
const parsed = (v: unknown): Record<string, unknown> => {
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
};

/**
 * A status column's labels, in monday's order. The settings list each label with its id (what a change
 * sends), its position, and whether it's done or switched off. Settings in the older shape, a map of id
 * to name beside positions and done colours, are read too.
 */
export function statusLabels(settings: unknown): MondayLabel[] {
  const s = parsed(settings);
  const out: MondayLabel[] = [];
  if (Array.isArray(s.labels)) {
    for (const l of s.labels as { id?: number | string; label?: string; index?: number; is_done?: boolean; is_deactivated?: boolean }[]) {
      if (l?.id === undefined || l.id === null) continue;
      out.push({ id: String(l.id), name: String(l.label ?? ''), position: Number(l.index ?? l.id), done: !!l.is_done, deactivated: !!l.is_deactivated });
    }
  } else if (s.labels && typeof s.labels === 'object') {
    const positions = parsed(s.labels_positions_v2);
    const done = Array.isArray(s.done_colors) ? (s.done_colors as unknown[]).map(String) : [];
    const off = Array.isArray(s.deactivated_labels) ? (s.deactivated_labels as unknown[]).map(String) : [];
    for (const [id, name] of Object.entries(s.labels as Record<string, unknown>)) {
      out.push({ id, name: String(name ?? ''), position: Number(positions[id] ?? id), done: done.includes(id), deactivated: off.includes(id) });
    }
  }
  // A label with no name is monday's blank: a card on it has no status.
  return out.filter((l) => l.name.trim()).sort((a, b) => a.position - b.position);
}

/** The status column that makes the columns: the one named, else the one called Status, else the first. */
export function pickStatusColumn<C extends { id: string; title: string; type?: string }>(columns: C[], named: string | null | undefined): C | null {
  const status = columns.filter((c) => !c.type || c.type === 'status');
  if (named) return status.find((c) => c.id === named) ?? null;
  return status.find((c) => c.title.trim().toLowerCase() === 'status') ?? status[0] ?? null;
}

const statusOf = (labels: MondayLabel[], id: string | null): Status => {
  if (id === null) return { id: NO_STATUS, name: 'No status', category: 'todo' };
  const l = labels.find((x) => x.id === id);
  return { id, name: l?.name ?? `Label ${id}`, category: l?.done ? 'done' : 'doing' };
};

/** monday's long text, which is plain: paragraphs between blank lines, with its line breaks kept. */
const plainDoc = (text: string): Doc => ({
  blocks: text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => ({
    t: 'p' as const, c: p.split('\n').flatMap((line, i) => (i ? [{ t: 'br' as const }, { t: 'text' as const, text: line }] : [{ t: 'text' as const, text: line }])),
  })),
});

const labelIndex = (v: ColumnValue | undefined): string | null => (v && v.index !== undefined && v.index !== null ? String(v.index) : null);
const personIds = (v: ColumnValue | undefined): string[] => (v?.persons_and_teams ?? []).filter((p) => p.kind === 'person').map((p) => String(p.id));

export class MondayClient implements TrackerClient {
  readonly kind = 'monday' as const;
  readonly title: string;
  readonly place: string;
  readonly prefix: string;
  private readonly o: MondayOptions;
  private readonly boardId: string;
  private readonly group: string | null;
  /** The board's last read: its columns and groups. Read again with every board, since labels change. */
  private metaCache: Promise<BoardMeta> | null = null;

  constructor(o: MondayOptions) {
    this.o = o;
    this.prefix = (o.prefix ?? 'MON').toUpperCase();
    this.boardId = String(o.board);
    this.group = o.group?.trim() || null;
    this.title = `monday.com · ${o.account}`;
    this.place = placeText({ kind: 'monday', account: o.account, board: this.boardId, group: this.group });
  }

  private call<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    return mondayCall<T>(this.o.token, query, variables, this.o.fetch ?? fetch);
  }

  idOf(key: string): string {
    const m = new RegExp(`^(?:${this.prefix}-|#)?(\\d+)$`, 'i').exec(key.trim());
    if (!m) throw new TrackerError('not-found', `${key} isn't a monday.com item key (${this.prefix}-<id>).`);
    return m[1]!;
  }

  private keyOf(id: string): string { return `${this.prefix}-${id}`; }
  private get boardUrl(): string { return `https://${this.o.account}.monday.com/boards/${this.boardId}`; }
  private urlOf(id: string): string { return `${this.boardUrl}/pulses/${id}`; }

  private meta(fresh = false): Promise<BoardMeta> {
    if (fresh || !this.metaCache) {
      const p = this.call<{ boards: BoardMeta[] }>(
        'query ($board: [ID!]) { boards(ids: $board) { id name columns(types: [status, people]) { id title type settings } groups { id title } } }',
        { board: [this.boardId] },
      ).then((d) => {
        const b = d.boards?.[0];
        if (!b) throw new TrackerError('not-found', `monday.com has no board ${this.boardId} that this token can see. It may have been archived or deleted.`);
        return b;
      });
      this.metaCache = p;
      p.catch(() => { if (this.metaCache === p) this.metaCache = null; });
    }
    return this.metaCache;
  }

  /** The status column and its labels, or why the board can't be drawn. */
  private status(m: BoardMeta): { column: MondayColumn; labels: MondayLabel[] } {
    const column = pickStatusColumn(m.columns, this.o.statusColumn);
    if (!column) {
      throw new TrackerError('not-found', this.o.statusColumn
        ? `${m.name} has no status column ${this.o.statusColumn} any more. Pick its status column again with Change.`
        : `${m.name} has no status column, so its items have no columns to go in. Add one in monday.com, or pick another board.`);
    }
    return { column, labels: statusLabels(column.settings) };
  }

  private peopleColumn(m: BoardMeta): MondayColumn {
    const c = m.columns.find((x) => x.type === 'people');
    if (!c) throw new TrackerError('refused', `${m.name} has no People column, so there's no one to assign. Add one in monday.com to assign people from here.`);
    return c;
  }

  /** People's names, by id, for the ids a People column holds. One that can't be read is Someone. */
  private async names(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const want = [...new Set(ids)];
    for (let i = 0; i < want.length; i += BATCH) {
      const batch = want.slice(i, i + BATCH);
      const got = await this.call<{ users: MondayPerson[] }>('query ($ids: [ID!], $limit: Int) { users(ids: $ids, limit: $limit) { id name } }', { ids: batch, limit: batch.length }).catch(() => ({ users: [] }));
      for (const u of got.users ?? []) out.set(String(u.id), u.name);
    }
    return out;
  }

  /**
   * Why an item is outside the place, or null (D-072). Item ids are the account's, so one from another
   * board can be asked for by id. With `projectOnly`, only the board counts, not the group.
   */
  private whyOutside(i: PlacedItem, projectOnly: boolean): string | null {
    if (i.board && String(i.board.id) !== this.boardId) return `it's on board ${i.board.name}`;
    if (projectOnly || !this.group || !i.group || i.group.id === this.group) return null;
    return `it's in group ${i.group.title}`;
  }

  async board(): Promise<Board> {
    const m = await this.meta(true);
    const { column, labels } = this.status(m);
    const people = m.columns.find((c) => c.type === 'people');
    const cols = [column.id, ...(people ? [people.id] : [])];
    const group = this.group ? m.groups.find((g) => g.id === this.group) ?? null : null;
    // The place: only the group's items are asked for, when there is one (D-072).
    const first = this.group
      ? (await this.call<{ boards: { groups: { items_page: { cursor: string | null; items: CardItem[] } }[] }[] }>(
        `query ($board: [ID!], $group: [String], $cols: [String!], $limit: Int!) { boards(ids: $board) { groups(ids: $group) { items_page(limit: $limit) { cursor items { ${CARD_FIELDS} } } } } }`,
        { board: [this.boardId], group: [this.group], cols, limit: PAGE },
      )).boards?.[0]?.groups?.[0]?.items_page
      : (await this.call<{ boards: { items_page: { cursor: string | null; items: CardItem[] } }[] }>(
        `query ($board: [ID!], $cols: [String!], $limit: Int!) { boards(ids: $board) { items_page(limit: $limit) { cursor items { ${CARD_FIELDS} } } } }`,
        { board: [this.boardId], cols, limit: PAGE },
      )).boards?.[0]?.items_page;
    const items: CardItem[] = [...(first?.items ?? [])];
    let cursor = first?.cursor ?? null;
    while (cursor && items.length < MAX_CARDS) {
      const next = (await this.call<{ next_items_page: { cursor: string | null; items: CardItem[] } }>(
        `query ($cursor: String!, $cols: [String!], $limit: Int!) { next_items_page(cursor: $cursor, limit: $limit) { cursor items { ${CARD_FIELDS} } } }`,
        { cursor, cols, limit: PAGE },
      )).next_items_page;
      items.push(...(next?.items ?? []));
      cursor = next?.cursor ?? null;
    }
    const shown = items.slice(0, MAX_CARDS);
    const value = (it: CardItem, id: string | undefined) => (id ? it.column_values.find((v) => v.id === id) : undefined);
    const names = await this.names(shown.flatMap((it) => personIds(value(it, people?.id))));
    const cards: BoardCard[] = shown.map((it) => {
      const index = labelIndex(value(it, column.id));
      return {
        key: this.keyOf(String(it.id)), title: it.name, url: this.urlOf(String(it.id)),
        // A card on a label the column no longer names (its blank) has no status.
        status: statusOf(labels, index !== null && !labels.some((l) => l.id === index) ? null : index),
        type: null, assignees: personIds(value(it, people?.id)).map((id) => ({ id, name: names.get(id) ?? 'Someone' })), labels: [], priority: null,
      };
    });
    const on = new Set(cards.map((c) => c.status.id));
    const columns: BoardColumn[] = [
      // No status comes first, and only when a card has none.
      ...(on.has(NO_STATUS) ? [{ id: NO_STATUS, name: 'No status', category: 'todo' as const, statusIds: [NO_STATUS] }] : []),
      // Switched-off labels get a column only while a card is on one.
      ...labels.filter((l) => !l.deactivated || on.has(l.id)).map((l) => ({ id: l.id, name: l.name, category: l.done ? 'done' as const : 'doing' as const, statusIds: [l.id] })),
    ];
    const notice = this.group && !group ? `The group ${this.group} isn't on ${m.name} any more, so no items show. Pick another with Change, above it.`
      : cursor || items.length > MAX_CARDS ? `Showing the first ${MAX_CARDS} items.` : null;
    return {
      source: 'monday-board', title: group ? `${m.name} · ${group.title}` : m.name, url: this.boardUrl, columns, cards, notice,
      place: placeText({ kind: 'monday', account: this.o.account, board: this.boardId, boardName: m.name, group: this.group, groupName: group?.title ?? null }),
    };
  }

  async ticket(key: string): Promise<Ticket> {
    const id = this.idOf(key);
    const got = await this.call<{ items: FullItem[] }>(
      `query ($ids: [ID!]) { items(ids: $ids) { ${PLACED_FIELDS} name state url created_at updated_at creator { id name }
        column_values { id type text column { title } ... on StatusValue { index label is_done } ... on PeopleValue { persons_and_teams { id kind } } }
        updates(limit: 100) { id body created_at creator { id name } replies { id body created_at creator { id name } } }
        subitems { id name url } parent_item { id name url } } }`,
      { ids: [id] },
    );
    const it = got.items?.[0];
    if (!it) throw new TrackerError('not-found', `${this.keyOf(id)} isn't an item this token can see in monday.com.`);
    const why = this.whyOutside(it, false);
    if (why) throw outsideError({ key: this.keyOf(id), why }, this.place);
    const values = it.column_values ?? [];
    const statusColumn = pickStatusColumn(values.map((v) => ({ id: v.id, title: v.column?.title ?? '', type: v.type })), this.o.statusColumn);
    const sv = statusColumn ? values.find((v) => v.id === statusColumn.id) : undefined;
    const index = labelIndex(sv);
    const status: Status = index === null || !sv?.label ? statusOf([], null) : { id: index, name: sv.label, category: sv.is_done ? 'done' : 'doing' };
    const peopleValue = values.find((v) => v.type === 'people');
    const names = await this.names(personIds(peopleValue));
    // Oldest first, each update followed by its replies.
    const updates = [...(it.updates ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
    const comment = (u: MondayUpdate): Comment => ({
      id: String(u.id), author: u.creator ? { id: String(u.creator.id), name: u.creator.name } : { id: '', name: 'Someone' }, created: u.created_at,
      body: fromHtml(u.body), url: `${it.url ?? this.urlOf(id)}/posts/${u.id}`,
    });
    const comments = updates.flatMap((u) => [comment(u), ...[...(u.replies ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at)).map(comment)]);
    // An item has no description: its long-text columns are, each under its title, or else its first update.
    const body: Doc = { blocks: [] };
    for (const v of values.filter((x) => x.type === 'long_text' && x.text?.trim())) {
      body.blocks.push({ t: 'h', level: 2, c: [{ t: 'text', text: v.column?.title || v.id }] }, ...plainDoc(v.text!).blocks);
    }
    if (!body.blocks.length && updates[0]) body.blocks.push(...fromHtml(updates[0].body).blocks);
    return {
      key: this.keyOf(id), kind: 'monday', url: it.url ?? this.urlOf(id), title: it.name, type: null, status,
      assignees: personIds(peopleValue).map((p) => ({ id: p, name: names.get(p) ?? 'Someone' })),
      reporter: it.creator ? { id: String(it.creator.id), name: it.creator.name } : null, labels: [], priority: null,
      created: it.created_at, updated: it.updated_at, body, markdown: toMarkdown(body), comments,
      related: [
        ...(it.parent_item ? [{ key: this.keyOf(String(it.parent_item.id)), title: it.parent_item.name, relation: 'parent', url: it.parent_item.url ?? null }] : []),
        ...(it.subitems ?? []).map((s) => ({ key: this.keyOf(String(s.id)), title: s.name, relation: 'sub-item', url: s.url ?? null })),
      ],
    };
  }

  /** Read by id from the account, a hundred at a time, so an item moved to another board still answers. */
  async outside(keys: string[], opts: { project?: boolean } = {}): Promise<Outside[]> {
    const ids = new Map<string, string>();
    for (const key of keys) {
      try {
        ids.set(this.idOf(key), key);
      } catch {
        // not an item key: nothing to say about it
      }
    }
    const out: Outside[] = [];
    const list = [...ids.keys()];
    for (let i = 0; i < list.length; i += BATCH) {
      const batch = list.slice(i, i + BATCH);
      let got: { items: PlacedItem[] };
      try {
        got = await this.call(`query ($ids: [ID!], $limit: Int) { items(ids: $ids, limit: $limit) { ${PLACED_FIELDS} } }`, { ids: batch, limit: batch.length });
      } catch {
        continue; // it couldn't be read, which never counts as outside (D-048)
      }
      // One it can't see or that's gone doesn't come back, and isn't outside.
      for (const it of got.items ?? []) {
        const why = this.whyOutside(it, !!opts.project);
        if (why) out.push({ key: ids.get(String(it.id)) ?? this.keyOf(String(it.id)), why });
      }
    }
    return out;
  }

  /** Every label of the status column but the one it's on. */
  async transitions(key: string): Promise<Transition[]> {
    const id = this.idOf(key);
    const { column, labels } = this.status(await this.meta());
    const got = await this.call<{ items: { column_values: ColumnValue[] }[] }>('query ($ids: [ID!], $cols: [String!]) { items(ids: $ids) { column_values(ids: $cols) { id ... on StatusValue { index } } } }', { ids: [id], cols: [column.id] });
    const now = labelIndex(got.items?.[0]?.column_values?.find((v) => v.id === column.id));
    return labels.filter((l) => !l.deactivated && l.id !== now).map((l) => ({ id: l.id, name: l.name, to: statusOf(labels, l.id) }));
  }

  /** Sets the status column to the label: its id, as monday's changes take it. */
  async transition(key: string, t: Transition): Promise<void> {
    const { column } = this.status(await this.meta());
    await this.change(key, column.id, { index: Number(t.id) });
  }

  private async change(key: string, column: string, value: unknown): Promise<void> {
    await this.call('mutation ($board: ID!, $item: ID!, $column: String!, $value: JSON!) { change_column_value(board_id: $board, item_id: $item, column_id: $column, value: $value) { id } }', {
      board: this.boardId, item: this.idOf(key), column, value: JSON.stringify(value),
    });
  }

  /** An update on the item, as HTML with every word escaped. */
  async comment(key: string, markdown: string): Promise<void> {
    if (!markdown.trim()) throw new TrackerError('refused', 'The comment is empty.');
    await this.call('mutation ($item: ID!, $body: String!) { create_update(item_id: $item, body: $body) { id } }', { item: this.idOf(key), body: toHtml(fromMarkdown(markdown)) });
  }

  async me(): Promise<Person> {
    const d = await this.call<{ me: MondayPerson }>('query { me { id name } }');
    return { id: String(d.me.id), name: d.me.name };
  }

  /** The board's subscribers: the people on it. */
  async assignable(_key: string, query: string): Promise<Person[]> {
    const m = await this.meta();
    this.peopleColumn(m);
    const d = await this.call<{ boards: { subscribers: MondayPerson[] }[] }>('query ($board: [ID!]) { boards(ids: $board) { subscribers { id name } } }', { board: [this.boardId] });
    const q = query.toLowerCase();
    return (d.boards?.[0]?.subscribers ?? []).map((p) => ({ id: String(p.id), name: p.name })).filter((p) => p.name.toLowerCase().includes(q));
  }

  /** Sets the board's first People column to these people, or to nobody. */
  async assign(key: string, people: Person[]): Promise<void> {
    const column = this.peopleColumn(await this.meta());
    await this.change(key, column.id, { personsAndTeams: people.map((p) => ({ id: Number(p.id), kind: 'person' })) });
  }

  async labels(): Promise<Label[]> {
    throw new TrackerError('refused', NO_LABELS);
  }

  async setLabels(): Promise<void> {
    throw new TrackerError('refused', NO_LABELS);
  }
}

// ---------------------------------------------------------------- for the Connect page (GH-51)

/** Who a token belongs to, and which account. */
export async function mondayMe(token: string, f: typeof fetch = fetch): Promise<Person & { account: string }> {
  const d = await mondayCall<{ me: MondayPerson & { account?: { slug?: string } } }>(token, 'query { me { id name account { slug } } }', {}, f);
  return { id: String(d.me.id), name: d.me.name, account: (d.me.account?.slug ?? '').toLowerCase() };
}

/**
 * The boards a token can see, by workspace then name. Sub-item boards, documents, and archived or deleted
 * boards aren't trackers, so they're left out.
 */
export async function mondayBoards(token: string, f: typeof fetch = fetch): Promise<{ id: string; name: string; workspace: string }[]> {
  const out: { id: string; name: string; workspace: string }[] = [];
  const limit = 100;
  for (let page = 1; page <= 20; page++) {
    const d = await mondayCall<{ boards: { id: string; name: string; type?: string; state?: string; workspace?: { name: string } | null }[] }>(
      token, 'query ($limit: Int, $page: Int) { boards(limit: $limit, page: $page, state: active) { id name type state workspace { name } } }', { limit, page }, f,
    );
    const got = d.boards ?? [];
    for (const b of got) if ((b.type ?? 'board') === 'board' && (b.state ?? 'active') === 'active') out.push({ id: String(b.id), name: b.name, workspace: b.workspace?.name ?? 'Main workspace' });
    if (got.length < limit) break;
  }
  return out.sort((a, b) => a.workspace.localeCompare(b.workspace) || a.name.localeCompare(b.name));
}

/** A board's groups, in its order, leaving out archived and deleted ones. */
export async function mondayGroups(board: string, token: string, f: typeof fetch = fetch): Promise<MondayGroup[]> {
  const d = await mondayCall<{ boards: { groups: (MondayGroup & { archived?: boolean | null; deleted?: boolean | null })[] }[] }>(
    token, 'query ($board: [ID!]) { boards(ids: $board) { groups { id title archived deleted } } }', { board: [board] }, f,
  );
  return (d.boards?.[0]?.groups ?? []).filter((g) => !g.archived && !g.deleted).map((g) => ({ id: g.id, title: g.title }));
}

/** A board's status columns, each with its labels, and the one the board uses unless told otherwise. */
export async function mondayStatusColumns(board: string, token: string, f: typeof fetch = fetch): Promise<{ id: string; title: string; labels: string[]; usual: boolean }[]> {
  const d = await mondayCall<{ boards: { name: string; columns: MondayColumn[] }[] }>(token, 'query ($board: [ID!]) { boards(ids: $board) { name columns(types: [status]) { id title type settings } } }', { board: [board] }, f);
  const b = d.boards?.[0];
  if (!b) throw new TrackerError('not-found', 'That board isn\'t one this token can see.');
  const usual = pickStatusColumn(b.columns, null);
  if (!usual) throw new TrackerError('not-found', `${b.name} has no status column, so its items have no columns to go in. Add one in monday.com, or pick another board.`);
  return b.columns.map((c) => ({ id: c.id, title: c.title, labels: statusLabels(c.settings).filter((l) => !l.deactivated).map((l) => l.name), usual: c.id === usual.id }));
}
