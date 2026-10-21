/**
 * GitHub Issues through `gh`, signed in as the repo's own account (D-007). A board's columns come from
 * the GitHub Project the issues are on; with no Project, or no access to it, they're Open and Closed.
 */
import { ghEnv } from '../exec.ts';
import { fromMarkdown } from './doc.ts';
import { typeKindOf } from './normal.ts';
import {
  type Board, type BoardCard, type BoardColumn, type Exec, inBatches, type Label, orList, type Outside, outsideError, type Person, placeText, type Status, type StatusCategory,
  type Ticket, type TicketText, type TrackerClient, TrackerError, type Transition,
} from './types.ts';

export interface GithubOptions {
  /** owner/name */
  repo: string;
  /** A token for the repo's account, from `gh auth token -u <account>`. */
  token: string;
  /** The account's login, for messages. */
  account: string;
  exec: Exec;
  /** A GitHub Project number to take columns from. By default, the repo's first open Project with a Status field. */
  project?: number | null;
  /** Only issues with one of these labels count (D-072). By default, every issue in the repo. */
  labels?: string[];
}

/** The owner/name of the repo an issue's link points into, or null. */
export const issueRepo = (url: string | null | undefined): string | null => (url ? /github\.com\/([\w.-]+\/[\w.-]+)\/issues\/\d+/i.exec(url)?.[1] ?? null : null);

/** Whether an issue has one of these labels; any issue does when there are none. GitHub's labels ignore case, so this does too. */
export function hasPlaceLabel(issue: { labels?: { name: string }[] }, labels: string[]): boolean {
  if (!labels.length) return true;
  const want = new Set(labels.map((l) => l.toLowerCase()));
  return (issue.labels ?? []).some((l) => want.has(l.name.toLowerCase()));
}

/**
 * Why an issue is outside a repo's place, or null (D-072): it moved to another repo, or has none of the
 * place's labels. A moved issue's link names its new repo. With `projectOnly`, the labels don't count.
 */
export function githubOutside(issue: { url?: string | null; labels?: { name: string }[] }, repo: string, labels: string[], projectOnly = false): string | null {
  const now = issueRepo(issue.url);
  if (now && now.toLowerCase() !== repo.toLowerCase()) return `it moved to ${now}`;
  if (projectOnly || hasPlaceLabel(issue, labels)) return null;
  return labels.length === 1 ? `it has no label ${labels[0]}` : `it has none of the labels ${orList(labels)}`;
}

const OPEN: Status = { id: 'OPEN', name: 'Open', category: 'todo' };
const CLOSED: Status = { id: 'CLOSED', name: 'Closed', category: 'done' };

/**
 * An issue's open or closed state as GitHub words it (T-90): closed as not planned keeps those words and its
 * reason, closed as completed its reason. Its id stays OPEN or CLOSED, which the board's columns hold.
 */
export function issueState(state: string | null | undefined, reason: string | null | undefined): Status {
  if (state === 'OPEN') return OPEN;
  if (reason === 'NOT_PLANNED') return { ...CLOSED, name: 'Closed as not planned', reason: 'not-planned' };
  return reason === 'COMPLETED' ? { ...CLOSED, reason: 'completed' } : CLOSED;
}

/** Whether gh refused to give an issue's type (T-90): an older gh, or GitHub Enterprise Server, doesn't know the field. */
const noIssueType = (e: unknown): boolean => e instanceof TrackerError && /issueType/.test(e.message);

/** GitHub Projects' statuses are free text; this places them in a workflow for drawing. */
export function categoryOf(name: string): StatusCategory {
  if (/done|closed|complete|shipped|released|merged|resolved/i.test(name)) return 'done';
  if (/to ?do|backlog|new|triage|ready|open|icebox|planned|not started/i.test(name)) return 'todo';
  return 'doing';
}

export const issueNumber = (key: string): number => {
  const m = /^(?:GH-|#)?(\d+)$/i.exec(key.trim());
  if (!m) throw new TrackerError('not-found', `${key} isn't a GitHub issue key (GH-<number>).`);
  return Number(m[1]);
};

interface ProjectInfo { id: string; number: number; title: string; url: string; fieldId: string; options: { id: string; name: string }[] }

/** A repo's Project as GitHub lists it, with its Status field when it has one. */
export interface ProjectNode { id: string; number: number; closed: boolean; field: { id: string; options: { id: string; name: string }[] } | null }

/**
 * The Project a board's columns come from, and a task's card moves on (GH-146): the one numbered `board`,
 * else the repo's first open Project with a Status field. Null when there's none.
 */
export function pickProject<P extends ProjectNode>(nodes: P[], board: number | null | undefined): P | null {
  const all = nodes.filter((p) => p.field?.options?.length);
  return (board != null ? all.find((x) => x.number === board) : all.find((x) => !x.closed)) ?? null;
}

const PROJECTS_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    projectsV2(first: 10) { nodes { id number title url closed
      field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } } } }
  }
}`;

/** A Project's items, with each issue's type where GitHub has issue types (T-90). */
const itemsQuery = (types: boolean): string => `query($id: ID!, $after: String) {
  node(id: $id) { ... on ProjectV2 { items(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id
      fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { optionId name } }
      content { __typename ... on Issue { number title url state${types ? ' issueType { name }' : ''} repository { nameWithOwner }
        assignees(first: 5) { nodes { login name } } labels(first: 50) { nodes { name color } } } } } } } }
}`;

const ISSUE_ITEMS_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) {
    projectItems(first: 10) { nodes { id project { id }
      fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { optionId name } } } } } }
}`;

interface GhPerson { login: string; name?: string | null }
const person = (p: GhPerson): Person => ({ id: p.login, name: p.name || p.login });
const label = (l: { name: string; color?: string | null }): Label => ({ name: l.name, color: l.color ? l.color.replace(/^#/, '') : null });

export class GithubClient implements TrackerClient {
  readonly kind = 'github' as const;
  readonly title: string;
  readonly place: string;
  private readonly o: GithubOptions;
  private readonly labelNames: string[];
  private projectCache: Promise<ProjectInfo | null> | null = null;
  /** Whether Projects could be read; false when the token lacks the scope. */
  private projectsReadable = true;
  /** Whether gh and GitHub give issues' types (T-90); false once either refused the field, so it isn't asked for again. */
  private issueTypes = true;

  constructor(o: GithubOptions) {
    this.o = o;
    this.title = `GitHub · ${o.repo}`;
    this.labelNames = o.labels ?? [];
    this.place = placeText({ kind: 'github', repo: o.repo, labels: this.labelNames });
  }

  private get owner(): string { return this.o.repo.split('/')[0]!; }
  private get name(): string { return this.o.repo.split('/')[1]!; }

  private async gh(args: string[], input?: string): Promise<string> {
    const r = await this.o.exec('gh', args, { input, env: ghEnv({ ...process.env, GH_TOKEN: this.o.token, NO_COLOR: '1' }) });
    if (r.code === 0) return r.stdout;
    const msg = (r.stderr || r.stdout).trim();
    if (r.code === 127) throw new TrackerError('other', 'The GitHub CLI (gh) isn\'t installed.');
    if (/missing required scopes|INSUFFICIENT_SCOPES|scope/i.test(msg)) throw new TrackerError('scope', msg.split('\n')[0]!);
    if (/HTTP 401|authentication|bad credentials/i.test(msg)) throw new TrackerError('auth', `GitHub refused ${this.o.account}'s login. Run: gh auth login`);
    if (/Could not resolve|not found|HTTP 404/i.test(msg)) throw new TrackerError('not-found', msg.split('\n')[0]!);
    throw new TrackerError('other', msg.split('\n')[0] || `gh exited with ${r.code}.`);
  }

  private async graphql<T>(query: string, vars: Record<string, string | number | null>): Promise<T> {
    const args = ['api', 'graphql', '-f', `query=${query}`];
    for (const [k, v] of Object.entries(vars)) if (v !== null) args.push(typeof v === 'number' ? '-F' : '-f', `${k}=${v}`);
    const out = JSON.parse(await this.gh(args)) as { data?: T; errors?: { message: string; type?: string }[] };
    if (out.errors?.length) {
      const e = out.errors[0]!;
      throw new TrackerError(/scope/i.test(e.message) || e.type === 'INSUFFICIENT_SCOPES' ? 'scope' : 'other', e.message);
    }
    return out.data as T;
  }

  /**
   * gh's JSON for an issue command, with its type while gh gives one (T-90). A gh that doesn't know the
   * field is asked again without it, and never asked for it again.
   */
  private async issueJson(args: string[], fields: string): Promise<string> {
    if (this.issueTypes) {
      try {
        return await this.gh([...args, '--json', `${fields},issueType`]);
      } catch (e) {
        if (!noIssueType(e)) throw e;
        this.issueTypes = false;
      }
    }
    return this.gh([...args, '--json', fields]);
  }

  /** The Project the board's columns come from, or null when there's none or it can't be read. */
  private project(): Promise<ProjectInfo | null> {
    this.projectCache ??= (async () => {
      try {
        const d = await this.graphql<{ repository: { projectsV2: { nodes: (Omit<ProjectInfo, 'fieldId' | 'options'> & ProjectNode)[] } } }>(PROJECTS_QUERY, { owner: this.owner, name: this.name });
        const p = pickProject(d.repository.projectsV2.nodes, this.o.project);
        return p ? { id: p.id, number: p.number, title: p.title, url: p.url, fieldId: p.field!.id, options: p.field!.options } : null;
      } catch (e) {
        if (e instanceof TrackerError && e.kind === 'scope') {
          this.projectsReadable = false;
          return null;
        }
        throw e;
      }
    })();
    return this.projectCache;
  }

  async board(): Promise<Board> {
    const p = await this.project();
    if (p) return this.projectBoard(p);
    const [open, closed] = await Promise.all([this.issues('open', 200), this.issues('closed', 30)]);
    const cards = [...open, ...closed].map((i): BoardCard => ({
      key: `GH-${i.number}`, title: i.title, url: i.url, status: issueState(i.state, i.stateReason),
      type: i.issueType?.name ?? null, typeKind: typeKindOf(i.issueType?.name), assignees: i.assignees.map(person), labels: i.labels.map(label), priority: null, priorityLevel: null,
    }));
    return {
      source: 'github-state', title: `Issues · ${this.o.repo}`, url: `https://github.com/${this.o.repo}/issues`,
      columns: [{ id: OPEN.id, name: 'Open', category: 'todo', statusIds: [OPEN.id] }, { id: CLOSED.id, name: 'Closed', category: 'done', statusIds: [CLOSED.id] }],
      cards,
      notice: this.projectsReadable
        ? 'These issues aren\'t on a GitHub Project, so the columns are Open and Closed. Add them to a Project with a Status field to use its columns.'
        // gh refreshes only its active account, so the commands say to switch to this one first, and back.
        : `To use your GitHub Project's columns, give ${this.o.account} access to Projects. gh refreshes only its active account, so run gh auth switch -u ${this.o.account}, then gh auth refresh -h github.com -s project and sign in as ${this.o.account}, then switch back to the account you use.`,
      place: this.place,
    };
  }

  /**
   * The repo's open or closed issues, held to the place's labels (D-072). `gh issue list --label` wants
   * every label it's given, so an issue with any one of them takes a list per label, merged.
   */
  private async issues(state: 'open' | 'closed', limit: number) {
    type Issue = { number: number; title: string; url: string; state: string; stateReason?: string | null; issueType?: { name: string } | null; assignees: GhPerson[]; labels: { name: string; color: string }[] };
    const runs = this.labelNames.length ? this.labelNames.map((l) => ['--label', l]) : [[]];
    const lists = await Promise.all(runs.map(async (only) => JSON.parse(await this.issueJson(['issue', 'list', '-R', this.o.repo, '--state', state, '--limit', String(limit), ...only], 'number,title,url,state,assignees,labels,stateReason')) as Issue[]));
    if (lists.length === 1) return lists[0]!;
    const byNumber = new Map<number, Issue>();
    for (const i of lists.flat()) if (!byNumber.has(i.number)) byNumber.set(i.number, i);
    return [...byNumber.values()].sort((a, b) => b.number - a.number).slice(0, limit);
  }

  private async projectBoard(p: ProjectInfo): Promise<Board> {
    type Item = { id: string; fieldValueByName: { optionId: string; name: string } | null; content: { __typename: string; number?: number; title?: string; url?: string; state?: string; issueType?: { name: string } | null; repository?: { nameWithOwner: string }; assignees?: { nodes: GhPerson[] }; labels?: { nodes: { name: string; color: string }[] } } | null };
    type Page = { node: { items: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Item[] } } };
    const items: Item[] = [];
    let after: string | null = null;
    for (let page = 0; page < 5; page++) {
      // GitHub without issue types refuses the field: that page is asked again without it.
      const d: Page = await this.graphql<Page>(itemsQuery(this.issueTypes), { id: p.id, after }).catch((e: unknown) => {
        if (!this.issueTypes || !noIssueType(e)) throw e;
        this.issueTypes = false;
        return this.graphql<Page>(itemsQuery(false), { id: p.id, after });
      });
      items.push(...d.node.items.nodes);
      if (!d.node.items.pageInfo.hasNextPage) break;
      after = d.node.items.pageInfo.endCursor;
    }
    const columns: BoardColumn[] = p.options.map((o) => ({ id: o.id, name: o.name, category: categoryOf(o.name), statusIds: [o.id] }));
    const cards: BoardCard[] = items
      .filter((i) => i.content?.__typename === 'Issue' && i.content.repository?.nameWithOwner.toLowerCase() === this.o.repo.toLowerCase()
        && hasPlaceLabel({ labels: i.content.labels?.nodes }, this.labelNames))
      .map((i) => {
        const c = i.content!;
        const v = i.fieldValueByName;
        return {
          key: `GH-${c.number}`, title: c.title!, url: c.url!, itemId: i.id,
          status: v ? { id: v.optionId, name: v.name, category: categoryOf(v.name) } : { id: '', name: 'No status', category: 'todo' },
          type: c.issueType?.name ?? null, typeKind: typeKindOf(c.issueType?.name), assignees: (c.assignees?.nodes ?? []).map(person), labels: (c.labels?.nodes ?? []).map(label), priority: null, priorityLevel: null,
        };
      });
    if (cards.some((c) => c.status.id === '')) columns.unshift({ id: '', name: 'No status', category: 'todo', statusIds: [''] });
    return { source: 'github-project', title: p.title, url: p.url, columns, cards, notice: null, place: this.place };
  }

  async ticket(key: string): Promise<Ticket> {
    const n = issueNumber(key);
    const raw = JSON.parse(await this.issueJson(['issue', 'view', String(n), '-R', this.o.repo], 'number,title,body,state,stateReason,author,assignees,labels,comments,createdAt,updatedAt,url,milestone'));
    const why = githubOutside(raw, this.o.repo, this.labelNames);
    if (why) throw outsideError({ key: `GH-${n}`, why }, this.place);
    const md = { issueUrl: (x: number) => `https://github.com/${this.o.repo}/issues/${x}`, userUrl: (u: string) => `https://github.com/${u}` };
    const item = await this.issueItem(n).catch(() => null);
    const status: Status = item?.status ?? issueState(raw.state, raw.stateReason);
    const type: string | null = raw.issueType?.name ?? null;
    return {
      key: `GH-${n}`, kind: 'github', url: raw.url, title: raw.title, type, typeKind: typeKindOf(type), status,
      assignees: (raw.assignees ?? []).map(person), reporter: raw.author ? person(raw.author) : null,
      labels: (raw.labels ?? []).map(label), priority: null, priorityLevel: null,
      created: raw.createdAt, updated: raw.updatedAt,
      body: fromMarkdown(raw.body, md),
      markdown: raw.body ?? '',
      comments: (raw.comments ?? []).map((c: { id: string; author: GhPerson | null; body: string; createdAt: string; url?: string }) => ({
        id: c.id, author: c.author ? person(c.author) : { id: 'ghost', name: 'ghost' }, created: c.createdAt, body: fromMarkdown(c.body, md), url: c.url ?? null,
      })),
      related: raw.milestone?.title ? [{ key: raw.milestone.title, title: 'Milestone', relation: 'milestone', url: null, status: null, typeKind: null }] : [],
    };
  }

  async outside(keys: string[], opts: { project?: boolean } = {}): Promise<Outside[]> {
    const found = await inBatches(keys, 5, async (key): Promise<Outside | null> => {
      try {
        const raw = JSON.parse(await this.gh(['issue', 'view', String(issueNumber(key)), '-R', this.o.repo, '--json', 'number,url,labels'])) as { url: string; labels?: { name: string }[] };
        const why = githubOutside(raw, this.o.repo, this.labelNames, !!opts.project);
        return why ? { key, why } : null;
      } catch {
        return null; // it couldn't be read, which never counts as outside (D-048)
      }
    });
    return found.filter((o): o is Outside => !!o);
  }

  /** The issue's card on the board's Project, with its status there, when it has one. */
  private async issueItem(n: number): Promise<{ id: string; status: Status | null } | null> {
    const p = await this.project();
    if (!p) return null;
    const d = await this.graphql<{ repository: { issue: { projectItems: { nodes: { id: string; project: { id: string }; fieldValueByName: { optionId: string; name: string } | null }[] } } } }>(ISSUE_ITEMS_QUERY, { owner: this.owner, name: this.name, number: n });
    const it = d.repository.issue.projectItems.nodes.find((x) => x.project.id === p.id);
    if (!it) return null;
    const v = it.fieldValueByName;
    return { id: it.id, status: v ? { id: v.optionId, name: v.name, category: categoryOf(v.name) } : null };
  }

  async transitions(key: string): Promise<Transition[]> {
    const n = issueNumber(key);
    const state = JSON.parse(await this.gh(['issue', 'view', String(n), '-R', this.o.repo, '--json', 'state'])).state as string;
    const out: Transition[] = [];
    const p = await this.project();
    if (p && (await this.issueItem(n).catch(() => null))) {
      for (const o of p.options) out.push({ id: `status:${o.id}`, name: o.name, to: { id: o.id, name: o.name, category: categoryOf(o.name) } });
    }
    if (state === 'OPEN') out.push({ id: 'close', name: 'Close as completed', to: CLOSED }, { id: 'close-not-planned', name: 'Close as not planned', to: CLOSED });
    else out.push({ id: 'reopen', name: 'Reopen', to: OPEN });
    return out;
  }

  async transition(key: string, t: Transition, card?: BoardCard): Promise<void> {
    const n = String(issueNumber(key));
    if (t.id === 'close') { await this.gh(['issue', 'close', n, '-R', this.o.repo, '--reason', 'completed']); return; }
    if (t.id === 'close-not-planned') { await this.gh(['issue', 'close', n, '-R', this.o.repo, '--reason', 'not planned']); return; }
    if (t.id === 'reopen') { await this.gh(['issue', 'reopen', n, '-R', this.o.repo]); return; }
    if (t.id.startsWith('status:')) {
      const p = await this.project();
      const itemId = card?.itemId ?? (await this.issueItem(Number(n)))?.id;
      if (!p || !itemId) throw new TrackerError('not-found', `${key} isn't on the board's GitHub Project.`);
      await this.gh(['project', 'item-edit', '--id', itemId, '--project-id', p.id, '--field-id', p.fieldId, '--single-select-option-id', t.id.slice('status:'.length)]);
      return;
    }
    throw new TrackerError('refused', `GitHub has no move called ${t.name}.`);
  }

  async comment(key: string, markdown: string): Promise<void> {
    if (!markdown.trim()) throw new TrackerError('refused', 'The comment is empty.');
    await this.gh(['issue', 'comment', String(issueNumber(key)), '-R', this.o.repo, '--body-file', '-'], markdown);
  }

  /** The title as an argument, the body on stdin, as a comment's goes, so neither is read as a flag. */
  async setText(key: string, text: TicketText): Promise<void> {
    if (text.title !== undefined && !text.title.trim()) throw new TrackerError('refused', 'An issue needs a title.');
    if (text.title === undefined && text.markdown === undefined) return;
    await this.gh(['issue', 'edit', String(issueNumber(key)), '-R', this.o.repo, ...(text.title !== undefined ? [`--title=${text.title.trim()}`] : []), ...(text.markdown !== undefined ? ['--body-file', '-'] : [])], text.markdown);
  }

  async me(): Promise<Person> {
    const u = JSON.parse(await this.gh(['api', 'user'])) as GhPerson;
    return person(u);
  }

  async assignable(_key: string, query: string): Promise<Person[]> {
    const logins = (await this.gh(['api', `repos/${this.o.repo}/assignees`, '--paginate', '--jq', '.[].login'])).split('\n').filter(Boolean);
    const q = query.toLowerCase();
    return logins.filter((l) => l.toLowerCase().includes(q)).map((l) => ({ id: l, name: l }));
  }

  async assign(key: string, people: Person[]): Promise<void> {
    const n = String(issueNumber(key));
    const now = (JSON.parse(await this.gh(['issue', 'view', n, '-R', this.o.repo, '--json', 'assignees'])).assignees as GhPerson[]).map((a) => a.login);
    const want = people.map((p) => p.id);
    const add = want.filter((w) => !now.includes(w));
    const remove = now.filter((x) => !want.includes(x));
    if (!add.length && !remove.length) return;
    await this.gh(['issue', 'edit', n, '-R', this.o.repo, ...(add.length ? ['--add-assignee', add.join(',')] : []), ...(remove.length ? ['--remove-assignee', remove.join(',')] : [])]);
  }

  async labels(): Promise<Label[]> {
    return (JSON.parse(await this.gh(['label', 'list', '-R', this.o.repo, '--limit', '200', '--json', 'name,color'])) as { name: string; color: string }[]).map(label);
  }

  async setLabels(key: string, add: string[], remove: string[]): Promise<void> {
    if (!add.length && !remove.length) return;
    await this.gh(['issue', 'edit', String(issueNumber(key)), '-R', this.o.repo, ...(add.length ? ['--add-label', add.join(',')] : []), ...(remove.length ? ['--remove-label', remove.join(',')] : [])]);
  }
}
