/**
 * GitHub Issues through `gh`, signed in as the repo's own account (D-007). A board's columns come from
 * the GitHub Project the issues are on; with no Project, or no access to it, they're Open and Closed.
 */
import { fromMarkdown } from './doc.ts';
import {
  type Board, type BoardCard, type BoardColumn, type Exec, type Label, type Person, type Status, type StatusCategory,
  type Ticket, type TrackerClient, TrackerError, type Transition,
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
}

const OPEN: Status = { id: 'OPEN', name: 'Open', category: 'todo' };
const CLOSED: Status = { id: 'CLOSED', name: 'Closed', category: 'done' };

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

const PROJECTS_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    projectsV2(first: 10) { nodes { id number title url closed
      field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name } } } } }
  }
}`;

const ITEMS_QUERY = `query($id: ID!, $after: String) {
  node(id: $id) { ... on ProjectV2 { items(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { id
      fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { optionId name } }
      content { __typename ... on Issue { number title url state repository { nameWithOwner }
        assignees(first: 5) { nodes { login name } } labels(first: 10) { nodes { name color } } } } } } } }
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
  private readonly o: GithubOptions;
  private projectCache: Promise<ProjectInfo | null> | null = null;
  /** Whether Projects could be read; false when the token lacks the scope. */
  private projectsReadable = true;

  constructor(o: GithubOptions) {
    this.o = o;
    this.title = `GitHub · ${o.repo}`;
  }

  private get owner(): string { return this.o.repo.split('/')[0]!; }
  private get name(): string { return this.o.repo.split('/')[1]!; }

  private async gh(args: string[], input?: string): Promise<string> {
    const r = await this.o.exec('gh', args, { input, env: { ...process.env, GH_TOKEN: this.o.token, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } });
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

  /** The Project the board's columns come from, or null when there's none or it can't be read. */
  private project(): Promise<ProjectInfo | null> {
    this.projectCache ??= (async () => {
      try {
        const d = await this.graphql<{ repository: { projectsV2: { nodes: (Omit<ProjectInfo, 'fieldId' | 'options'> & { closed: boolean; field: { id: string; options: { id: string; name: string }[] } | null })[] } } }>(PROJECTS_QUERY, { owner: this.owner, name: this.name });
        const all = d.repository.projectsV2.nodes.filter((p) => p.field?.options?.length);
        const p = this.o.project != null ? all.find((x) => x.number === this.o.project) : all.find((x) => !x.closed);
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
    const fields = 'number,title,url,state,assignees,labels';
    const [open, closed] = await Promise.all([
      this.gh(['issue', 'list', '-R', this.o.repo, '--state', 'open', '--limit', '200', '--json', fields]),
      this.gh(['issue', 'list', '-R', this.o.repo, '--state', 'closed', '--limit', '30', '--json', fields]),
    ]);
    const cards = [...JSON.parse(open), ...JSON.parse(closed)].map((i: { number: number; title: string; url: string; state: string; assignees: GhPerson[]; labels: { name: string; color: string }[] }): BoardCard => ({
      key: `GH-${i.number}`, title: i.title, url: i.url, status: i.state === 'OPEN' ? OPEN : CLOSED,
      type: null, assignees: i.assignees.map(person), labels: i.labels.map(label), priority: null,
    }));
    return {
      source: 'github-state', title: `Issues · ${this.o.repo}`, url: `https://github.com/${this.o.repo}/issues`,
      columns: [{ id: OPEN.id, name: 'Open', category: 'todo', statusIds: [OPEN.id] }, { id: CLOSED.id, name: 'Closed', category: 'done', statusIds: [CLOSED.id] }],
      cards,
      notice: this.projectsReadable
        ? 'These issues aren\'t on a GitHub Project, so the columns are Open and Closed. Add them to a Project with a Status field to use its columns.'
        : `To use your GitHub Project's columns, give ${this.o.account} access to Projects: gh auth refresh -s project (while ${this.o.account} is the active account).`,
    };
  }

  private async projectBoard(p: ProjectInfo): Promise<Board> {
    type Item = { id: string; fieldValueByName: { optionId: string; name: string } | null; content: { __typename: string; number?: number; title?: string; url?: string; state?: string; repository?: { nameWithOwner: string }; assignees?: { nodes: GhPerson[] }; labels?: { nodes: { name: string; color: string }[] } } | null };
    const items: Item[] = [];
    let after: string | null = null;
    for (let page = 0; page < 5; page++) {
      const d: { node: { items: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Item[] } } } = await this.graphql(ITEMS_QUERY, { id: p.id, after });
      items.push(...d.node.items.nodes);
      if (!d.node.items.pageInfo.hasNextPage) break;
      after = d.node.items.pageInfo.endCursor;
    }
    const columns: BoardColumn[] = p.options.map((o) => ({ id: o.id, name: o.name, category: categoryOf(o.name), statusIds: [o.id] }));
    const cards: BoardCard[] = items
      .filter((i) => i.content?.__typename === 'Issue' && i.content.repository?.nameWithOwner.toLowerCase() === this.o.repo.toLowerCase())
      .map((i) => {
        const c = i.content!;
        const v = i.fieldValueByName;
        return {
          key: `GH-${c.number}`, title: c.title!, url: c.url!, itemId: i.id,
          status: v ? { id: v.optionId, name: v.name, category: categoryOf(v.name) } : { id: '', name: 'No status', category: 'todo' },
          type: null, assignees: (c.assignees?.nodes ?? []).map(person), labels: (c.labels?.nodes ?? []).map(label), priority: null,
        };
      });
    if (cards.some((c) => c.status.id === '')) columns.unshift({ id: '', name: 'No status', category: 'todo', statusIds: [''] });
    return { source: 'github-project', title: p.title, url: p.url, columns, cards, notice: null };
  }

  async ticket(key: string): Promise<Ticket> {
    const n = issueNumber(key);
    const raw = JSON.parse(await this.gh(['issue', 'view', String(n), '-R', this.o.repo, '--json', 'number,title,body,state,stateReason,author,assignees,labels,comments,createdAt,updatedAt,url,milestone']));
    const md = { issueUrl: (x: number) => `https://github.com/${this.o.repo}/issues/${x}`, userUrl: (u: string) => `https://github.com/${u}` };
    const item = await this.issueItem(n).catch(() => null);
    const closed = raw.state !== 'OPEN';
    const status: Status = item?.status ?? (closed ? { ...CLOSED, name: raw.stateReason === 'NOT_PLANNED' ? 'Closed as not planned' : 'Closed' } : OPEN);
    return {
      key: `GH-${n}`, kind: 'github', url: raw.url, title: raw.title, type: null, status,
      assignees: (raw.assignees ?? []).map(person), reporter: raw.author ? person(raw.author) : null,
      labels: (raw.labels ?? []).map(label), priority: null,
      created: raw.createdAt, updated: raw.updatedAt,
      body: fromMarkdown(raw.body, md),
      markdown: raw.body ?? '',
      comments: (raw.comments ?? []).map((c: { id: string; author: GhPerson | null; body: string; createdAt: string; url?: string }) => ({
        id: c.id, author: c.author ? person(c.author) : { id: 'ghost', name: 'ghost' }, created: c.createdAt, body: fromMarkdown(c.body, md), url: c.url ?? null,
      })),
      related: raw.milestone?.title ? [{ key: raw.milestone.title, title: 'Milestone', relation: 'milestone', url: null }] : [],
    };
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
