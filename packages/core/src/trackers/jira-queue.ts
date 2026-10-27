/**
 * Jira Service Management queues as boards (T-128): a service desk's queue, such as "Unassigned issues", is a
 * board a project holds, its tickets the ones the queue's own JQL picks out. Each API is named with the
 * Atlassian page that documents it, read on 2026-10-27:
 *
 * - Get queues, GET /rest/servicedeskapi/servicedesk/{serviceDeskId}/queue?includeCount=true: each queue's id,
 *   name, jql and issueCount. "Permissions required: service desk's Agent."
 *   https://developer.atlassian.com/cloud/jira/service-desk/rest/api-group-servicedesk/#api-rest-servicedeskapi-servicedesk-servicedeskid-queue-get
 * - Get service desk by id, GET /rest/servicedeskapi/servicedesk/{serviceDeskId}: its projectName.
 *   https://developer.atlassian.com/cloud/jira/service-desk/rest/api-group-servicedesk/#api-rest-servicedeskapi-servicedesk-servicedeskid-get
 * - A {serviceDeskId} can be a project identifier, such as projectKey:ABC ("Project identifiers").
 *   https://developer.atlassian.com/cloud/jira/service-desk/rest/intro/
 * - Create request comment, POST /rest/servicedeskapi/request/{issueIdOrKey}/comment with { body, public }:
 *   "public: Indicates whether the comment is public (true) or private/internal (false)."
 *   https://developer.atlassian.com/cloud/jira/service-desk/rest/api-group-request/#api-rest-servicedeskapi-request-issueidorkey-comment-post
 *   Jira's own Add comment can't make one internal: its Comment.jsdPublic is read-only, and says to use
 *   Create request comment for that. https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-comments/#api-rest-api-3-issue-issueidorkey-comment-post
 * - Get project, GET /rest/api/3/project/{projectIdOrKey}: projectTypeKey, "service_desk" for a service desk.
 *   https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/#api-rest-api-3-project-projectidorkey-get
 * - Search for issues using JQL, GET /rest/api/3/search/jql: issues, nextPageToken and isLast.
 *   https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-get
 */
import { plural } from '../text.ts';
import { type BoardColumn, orList, type Status, type StatusCategory, TrackerError } from './types.ts';

/** A service desk's queue: its id, its name, the JQL that picks its tickets, and how many it holds, when asked. */
export interface JiraQueue {
  id: number;
  name: string;
  jql: string;
  count: number | null;
}

/** A Jira request, as JiraClient makes it. */
export type JiraReq = <T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => Promise<T>;

/** The service desk of a project, by its key: the queue API takes a project identifier for {serviceDeskId}. */
export const serviceDeskId = (project: string): string => `projectKey:${encodeURIComponent(project)}`;

/** Jira's project type for a service desk, from Get project's projectTypeKey. */
export const SERVICE_DESK_TYPE = 'service_desk';

/** Whether a project is a service desk, from its projectTypeKey. */
export async function isServiceDesk(req: JiraReq, project: string): Promise<boolean> {
  const p = await req<{ projectTypeKey?: string }>('GET', `/rest/api/3/project/${encodeURIComponent(project)}`);
  return p.projectTypeKey === SERVICE_DESK_TYPE;
}

/** What a person who isn't one of the service desk's agents is told (T-128): only an agent can read its queues. */
export const noAgentWords = (project: string): string =>
  `Only a Jira Service Management agent can see the ${project} service desk's queues, and this sign-in isn't one. Ask the service desk's admin to add you as an agent, or take its epics instead.`;

/**
 * The service desk's queues, each with how many tickets it holds, or null when the project isn't a service
 * desk. A sign-in that isn't an agent's is refused in plain words: Jira answers 403 to anyone else.
 */
export async function jiraQueues(req: JiraReq, project: string, counts = true): Promise<JiraQueue[] | null> {
  if (!(await isServiceDesk(req, project))) return null;
  const out: JiraQueue[] = [];
  try {
    for (let start = 0; ; start += 50) {
      const page = await req<{ values: { id: string | number; name: string; jql: string; issueCount?: number }[]; isLastPage?: boolean }>(
        'GET', `/rest/servicedeskapi/servicedesk/${serviceDeskId(project)}/queue?start=${start}&limit=50${counts ? '&includeCount=true' : ''}`,
      );
      out.push(...page.values.map((q) => ({ id: Number(q.id), name: q.name, jql: q.jql, count: typeof q.issueCount === 'number' ? q.issueCount : null })));
      if (page.isLastPage !== false || !page.values.length) break;
    }
  } catch (e) {
    if (e instanceof TrackerError && (e.kind === 'refused' || e.kind === 'auth')) throw new TrackerError('refused', noAgentWords(project));
    throw e;
  }
  return out;
}

/** The service desk's name (its projectName), or null when it can't be read. */
export async function serviceDeskName(req: JiraReq, project: string): Promise<string | null> {
  try {
    return (await req<{ projectName?: string }>('GET', `/rest/servicedeskapi/servicedesk/${serviceDeskId(project)}`)).projectName ?? null;
  } catch {
    return null; // the board still shows without it: the place names the project instead
  }
}

/** A queue's card on the Connect page: how many tickets it holds, when Jira said. */
export const queueDetail = (q: JiraQueue): string | undefined => (q.count === null ? undefined : plural(q.count, 'ticket'));

/**
 * A queue's JQL and its ORDER BY, split where ORDER BY starts outside quotes. The filter goes inside other JQL,
 * as the place check's `key = X AND (filter)`, where an ORDER BY can't be.
 */
export function splitJql(jql: string): { filter: string; order: string | null } {
  let quote: string | null = null;
  let at = -1;
  for (let i = 0; i < jql.length; i++) {
    const c = jql[i]!;
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === '\'') quote = c;
    else if (/^order\s+by\b/i.test(jql.slice(i)) && (i === 0 || /\s/.test(jql[i - 1]!))) at = i;
  }
  return at < 0 ? { filter: jql.trim(), order: null } : { filter: jql.slice(0, at).trim(), order: jql.slice(at).trim() };
}

/** The queues' filters as one JQL clause: a ticket in any of them. Each in brackets, so its own ORs stay its own. */
export function queuesJql(queues: Pick<JiraQueue, 'jql'>[]): string {
  const parts = queues.map((q) => splitJql(q.jql).filter).filter(Boolean).map((f) => `(${f})`);
  return parts.length ? `(${parts.join(' OR ')})` : '';
}

/** "queue Unassigned issues", or "queues Unassigned issues or Waiting for support". */
export const queueWords = (names: string[]): string => `queue${names.length > 1 ? 's' : ''} ${orList(names)}`;

const ORDER: Record<StatusCategory, number> = { todo: 0, doing: 1, done: 2 };

/**
 * A board's columns from its tickets' statuses (T-128), as a board with no columns of its own has them: one
 * column a status, in the order of their category (To do, In progress, Done), and within one, as first seen.
 */
export function statusColumns(statuses: Status[]): BoardColumn[] {
  const seen = new Map<string, Status>();
  for (const s of statuses) if (!seen.has(s.id)) seen.set(s.id, s);
  return [...seen.values()]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => ORDER[a.s.category] - ORDER[b.s.category] || a.i - b.i)
    .map(({ s }) => ({ id: `status-${s.id}`, name: s.name, category: s.category, statusIds: [s.id] }));
}
