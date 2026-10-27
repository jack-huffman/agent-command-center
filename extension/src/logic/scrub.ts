/**
 * Report a problem's scrub (T-118): what the Command Center attaches to a report leaves the machine only after
 * the person sees it, and before it shows, every detail of their client work in it is replaced with a
 * placeholder. The project's and home folder's paths become <project> and ~; the words the project's settings
 * hold (its name, GitHub repo and account, commit name and email, each environment's org, each tracker's site,
 * project and board) become what they are; then any email, URL's host, ticket key, service site and
 * token-shaped word left. Pure: no vscode import, so it's tested.
 */

import type { Config } from '../../../packages/core/src/config.ts';
import { tokenLike } from '../../../packages/core/src/names.ts';
import { SECRET_PATTERN } from '../../../packages/core/src/onboarding/helpers.ts';
import { escapeRegExp } from '../../../packages/core/src/text.ts';

/** What a detail becomes, by what it was. */
export const PLACEHOLDER = {
  project: '<project>', home: '~', name: '<name>', repo: '<repo>', user: '<user>', email: '<email>', org: '<org>',
  site: '<site>', host: '<host>', ticket: '<ticket>', token: '<token>',
} as const;
export type ScrubKind = keyof typeof PLACEHOLDER;

/** One literal to replace, from the project's settings or the machine, with what it becomes. */
export interface ScrubWord { text: string; kind: ScrubKind }

/** What the scrub knows of this machine and its projects. */
export interface ScrubContext {
  home: string;
  /** Each project's root: the whole workspace's, not only the active folder's. */
  roots: string[];
  words: ScrubWord[];
}

/** A word this short is too common to replace as a literal: "dev", "uat", "a". */
const SHORTEST = 3;

/**
 * The literals a project's settings hold that name its client: its name, its GitHub repo and account, its
 * commit identity, each environment's org (an alias or a username), and each tracker's site, project, repo,
 * organization, account, workspace, channel and team.
 */
export function configWords(c: Pick<Config, 'project' | 'github' | 'commitIdentity' | 'environments' | 'trackers'>): ScrubWord[] {
  const out: ScrubWord[] = [{ text: c.project, kind: 'name' }];
  if (c.github) out.push({ text: c.github.repo, kind: 'repo' }, { text: c.github.account, kind: 'user' }, ...c.github.repo.split('/').map((text): ScrubWord => ({ text, kind: 'name' })));
  if (c.commitIdentity) out.push({ text: c.commitIdentity.email, kind: 'email' }, { text: c.commitIdentity.name, kind: 'user' });
  for (const e of c.environments) if (e.org) out.push({ text: e.org, kind: 'org' });
  for (const t of c.trackers) {
    if (t.site) out.push({ text: t.site, kind: 'site' });
    if (t.repo) out.push({ text: t.repo, kind: 'repo' });
    for (const text of [t.project, t.organization, t.account, t.workspace, t.channel, t.team]) if (text) out.push({ text, kind: 'name' });
  }
  return out;
}

/** The scrub's context: this machine's home and user, and every project's root and settings. */
export function scrubContext(home: string, user: string | null, projects: { root: string; config: Parameters<typeof configWords>[0] }[]): ScrubContext {
  return { home, roots: projects.map((p) => p.root), words: [...projects.flatMap((p) => configWords(p.config)), ...(user ? [{ text: user, kind: 'user' as const }] : [])] };
}

/** The services whose sites name a client: a Jira site, a Salesforce org's, monday's, Slack's, Azure DevOps'. */
const SITES = /\b[\w-]+(?:\.[\w-]+)*\.(?:atlassian\.net|jira\.com|(?:my\.)?salesforce\.com|force\.com|salesforce-setup\.com|monday\.com|slack\.com|visualstudio\.com)\b/gi;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
/** A URL's host, and any user and port with it: the path after it stays, so the error still reads. */
const URL_HOST = /\b([a-z][a-z0-9+.-]*:\/\/)(?:[^\s/@]+@)?[^\s/:?#<>]+(?::\d+)?/gi;
const TICKET = /\b[A-Z][A-Z0-9_]{1,9}-\d+\b/g;
/** Ticket-shaped words that are standards, not tickets. */
const NOT_TICKETS = new Set(['UTF-8', 'UTF-16', 'UTF-32', 'ISO-8601', 'SHA-1', 'SHA-256', 'SHA-512', 'X-1']);
/** Credentials by shape: the repo's own secret scan's (POSIX, put in JavaScript's terms), and a name followed by its value. */
const SECRETS = new RegExp(SECRET_PATTERN.replace(/\[:space:\]/g, '\\s'), 'g');
const NAMED_SECRET = /\b(token|secret|password|passwd|api[_-]?key|authorization|bearer)(\s*[=:]\s*|\s+)(?!<)[^\s"',;]+/gi;
/** A host a network error names with no URL around it, as Node and gh say it: the error word stays. */
const NET_ERROR_HOST = /\b(ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ECONNRESET|EAI_AGAIN|getaddrinfo|resolve host:?|connect to)(\s+)(?:[\w-]+(?:\.[\w-]+)+|\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?/gi;
/** A bare host name ending in a common or an internal domain, where no path or address holds it. */
const BARE_HOST = /(?<![\w/<@.-])(?:[\w-]+\.)+(?:com|net|org|io|co|internal|local|corp|lan|intra|example|cloud)(?::\d+)?(?![\w-]|\.\w)/gi;
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/g;
/** A Salesforce session id: its org's id, a !, then the rest. */
const SESSION_ID = /\b00D[A-Za-z0-9]{12,15}![\w.]{20,}/g;

/** How many of each kind of detail the scrub replaced. */
export type Scrubbed = Partial<Record<ScrubKind, number>>;

/** The text with every detail of client work replaced, and how many of each kind were. */
export function scrub(text: string, ctx: ScrubContext): { text: string; replaced: Scrubbed } {
  const replaced: Scrubbed = {};
  const count = (kind: ScrubKind, n = 1) => { replaced[kind] = (replaced[kind] ?? 0) + n; };
  const swap = (s: string, re: RegExp, kind: ScrubKind, put: (m: string, ...g: string[]) => string = () => PLACEHOLDER[kind]) => s.replace(re, (m: string, ...g: string[]) => {
    const to = put(m, ...g);
    if (to !== m) count(kind);
    return to;
  });
  let s = text;
  // Paths first, the deepest first, so a project inside the home folder is <project>, not ~/…, and a word in a path is the path's.
  const paths: ScrubWord[] = [...ctx.roots.map((text) => ({ text, kind: 'project' as const })), { text: ctx.home, kind: 'home' as const }].filter((p) => p.text.length > 1);
  for (const p of paths.sort((a, b) => b.text.length - a.text.length)) s = swap(s, new RegExp(`${escapeRegExp(p.text.replace(/\/+$/, ''))}(?![\\w.-])`, 'g'), p.kind);
  // Credentials before the words around them, so a token whose value holds a name is still replaced whole.
  s = swap(s, SECRETS, 'token');
  s = swap(s, SESSION_ID, 'token');
  s = swap(s, NAMED_SECRET, 'token', (_m, name, sep) => `${name}${sep}${PLACEHOLDER.token}`);
  // The settings' own words, the longest first, so an org username is replaced whole before its email's part.
  const words = [...new Map(ctx.words.filter((w) => w.text.trim().length >= SHORTEST).map((w) => [w.text.toLowerCase(), w])).values()];
  for (const w of words.sort((a, b) => b.text.length - a.text.length)) s = swap(s, new RegExp(`(?<![\\w<-])${escapeRegExp(w.text)}(?![\\w>-])`, 'gi'), w.kind);
  s = swap(s, URL_HOST, 'host', (_m, scheme) => `${scheme}${PLACEHOLDER.host}`);
  s = swap(s, EMAIL, 'email');
  s = swap(s, SITES, 'site');
  s = swap(s, NET_ERROR_HOST, 'host', (_m, word, sp) => `${word}${sp}${PLACEHOLDER.host}`);
  s = swap(s, BARE_HOST, 'host');
  s = swap(s, IPV4, 'host');
  s = swap(s, TICKET, 'ticket', (m) => (NOT_TICKETS.has(m) ? m : PLACEHOLDER.ticket));
  // Any word left that looks like a token: a secret's prefix, or 20 characters or more mixing letters and digits.
  s = swap(s, /[A-Za-z0-9_+=-]{20,}|\b(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_|sk-|xox|AKIA|eyJ)[A-Za-z0-9_.+=-]+/g, 'token', (m) => (tokenLike(m) ? PLACEHOLDER.token : m));
  return { text: s, replaced };
}

/** What the scrub replaced, in a line for the page: "Replaced 2 paths, an email and a ticket key". Null when nothing was. */
export function scrubbedLine(r: Scrubbed): string | null {
  const NAMES: Record<ScrubKind, [string, string]> = {
    project: ['a project path', 'project paths'], home: ['a home folder path', 'home folder paths'], name: ['a name', 'names'], repo: ['a repo', 'repos'],
    user: ['a username', 'usernames'], email: ['an email address', 'email addresses'], org: ['an org', 'orgs'], site: ['a site', 'sites'],
    host: ['a web address', 'web addresses'], ticket: ['a ticket key', 'ticket keys'], token: ['something shaped like a token', 'things shaped like tokens'],
  };
  const parts = (Object.keys(NAMES) as ScrubKind[]).filter((k) => replaced(r, k)).map((k) => (r[k] === 1 ? NAMES[k][0] : `${r[k]} ${NAMES[k][1]}`));
  if (!parts.length) return null;
  return `Replaced ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]} with placeholders.`;
}

const replaced = (r: Scrubbed, k: ScrubKind): boolean => (r[k] ?? 0) > 0;
