/**
 * Connect and trackers: sign-ins kept for a project or a whole site, and tracking a tracker's
 * ticket as a task.
 * Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { TaskInput } from '../../../packages/core/src/ledger.ts';
import { isObj } from '../../../packages/core/src/text.ts';
import type { Ticket } from '../../../packages/core/src/trackers/types.ts';
import type { Pending } from '../../webview/pending.ts';
import { inProcessWords } from './processes.ts';
import { ticketKey } from './shared.ts';

/**
 * Which of a repo's tasks to ask a Jira or Azure DevOps tracker about once its board has loaded (D-072):
 * unfinished ones from that tracker (its kind, and a key it owns) that the board didn't show.
 */
export function placeCandidates(tasks: { id: string; state: string; source: { kind: string } }[], board: { kind: string; index: number; cards: { key: string }[] }, trackerOf: (key: string) => number | null): string[] {
  const shown = new Set(board.cards.map((c) => c.key.toUpperCase()));
  return tasks.filter((t) => t.source.kind === board.kind && t.state !== 'done' && !shown.has(t.id.toUpperCase()) && trackerOf(t.id) === board.index).map((t) => t.id);
}

/**
 * The keys a tracker says have left the repo's place, of those asked about. A read that fails says none
 * have: a task is never removed for an error (D-048). A key it wasn't asked about is never taken from it.
 */
export async function outsideKeys<T extends { key: string }>(keys: string[], read: (keys: string[]) => Promise<T[]>): Promise<T[]> {
  if (!keys.length) return [];
  const asked = new Set(keys.map((k) => k.toUpperCase()));
  try {
    return (await read(keys)).filter((o) => asked.has(o.key.toUpperCase()));
  } catch {
    return [];
  }
}

/** Accepts a pasted URL as well as a bare name. It lives with the trackers' descriptions now (GH-51). */
export { parseHost } from '../../../packages/core/src/trackers/connect.ts';

/**
 * Which repo a tracker sign-in belongs to (D-027): its GitHub repo when it has one, so every clone and
 * worktree shares it, or else its git directory.
 */
export const repoKey = (p: { config: { github: { repo: string } | null }; ledgerPath: string }): string =>
  p.config.github ? `github:${p.config.github.repo.toLowerCase()}` : `git:${dirname(dirname(p.ledgerPath))}`;

/** Where VSCode keeps one repo's sign-in to one tracker host: acc.cred:github:acme/service:jira:acme.atlassian.net. */
export const credKey = (p: Parameters<typeof repoKey>[0], kind: string, host: string): string => `acc.cred:${repoKey(p)}:${kind}:${host}`;

/**
 * Where VSCode keeps a sign-in shared by every repo on this machine that uses one site (GH-79): a Jira site,
 * an Azure DevOps organization or a monday.com account. acc.cred:site:jira:acme.atlassian.net. No repo key
 * starts with site:, so the two never meet.
 */
export const siteCredKey = (kind: string, host: string): string => `acc.cred:site:${kind}:${host}`;

/** The tracker and host a sign-in's key is for, a repo's or a site's: its last two parts. */
export function credSite(key: string): { kind: string; host: string } | null {
  if (!key.startsWith('acc.cred:')) return null;
  const parts = key.slice('acc.cred:'.length).split(':');
  return parts.length >= 3 ? { kind: parts[parts.length - 2]!, host: parts[parts.length - 1]! } : null;
}

/** What VSCode keeps for one repo and one tracker host (GH-79). */
export interface StoredCreds {
  /** The repo's own key: its sign-in, a "this project only" sign-out, or nothing. */
  own: Record<string, unknown> | 'signed-out' | null;
  /** The sign-in for every project on the site. */
  site: Record<string, unknown> | null;
}

type SecretGet = (key: string) => PromiseLike<string | undefined> | string | undefined;

const parseCred = (raw: string | undefined): Record<string, unknown> | null => {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as unknown;
    return isObj(c) ? c : null;
  } catch {
    return null;
  }
};

/** Reads a repo's own key and its site's for one tracker host. One that can't be read is none. */
export async function readCreds(get: SecretGet, p: Parameters<typeof repoKey>[0], kind: string, host: string): Promise<StoredCreds> {
  const h = host.toLowerCase();
  const own = parseCred(await get(credKey(p, kind, h)));
  return { own: own?.signedOut === true ? 'signed-out' : own, site: parseCred(await get(siteCredKey(kind, h))) };
}

/**
 * The sign-in a repo uses (GH-79): its own first, so a repo that needs another account keeps one, then the
 * one for every project on the site. A "this project only" sign-out stops there. A sign-in kept before
 * GH-79 is the repo's own, read as it always was.
 */
export function credInUse(c: StoredCreds): { cred: Record<string, unknown>; shared: boolean } | null {
  if (c.own === 'signed-out') return null;
  if (c.own) return { cred: c.own, shared: false };
  return c.site ? { cred: c.site, shared: true } : null;
}

/** What to keep and take out of VSCode's secret storage. Only acc.cred: keys, never another site's. */
export interface CredWrites {
  store: [key: string, value: string][];
  delete: string[];
}

/**
 * Keeping a sign-in (GH-79): for every project on its site, or for this repo only (D-027). Shared, the repo's
 * own key goes, a sign-in or a sign-out, or the repo would go on ignoring the sign-in just chosen. For this
 * repo, the site's stays for every other project.
 */
export function credWrites(p: Parameters<typeof repoKey>[0], kind: string, host: string, cred: Record<string, unknown>, shared: boolean): CredWrites {
  const h = host.toLowerCase();
  return shared
    ? { store: [[siteCredKey(kind, h), JSON.stringify(cred)]], delete: [credKey(p, kind, h)] }
    : { store: [[credKey(p, kind, h), JSON.stringify(cred)]], delete: [] };
}

/**
 * Signing out (GH-79). `every`: the sign-in for every project on the site goes; repos that keep their own
 * keep it. `this`: the repo stops using the shared one, which stays for the rest, by a sign-out under its
 * own key that holds no secret. `own`: the repo's own sign-in goes, and it uses the site's again if there is one.
 */
export function signOutWrites(p: Parameters<typeof repoKey>[0], kind: string, host: string, choice: 'every' | 'this' | 'own'): CredWrites {
  const h = host.toLowerCase();
  if (choice === 'every') return { store: [], delete: [siteCredKey(kind, h)] };
  if (choice === 'this') return { store: [[credKey(p, kind, h), JSON.stringify({ kind, signedOut: true })]], delete: [] };
  return { store: [], delete: [credKey(p, kind, h)] };
}

/** The two answers signing out of a site's sign-in offers (GH-79). VSCode's modal adds Cancel. */
export const signOutAnswers = (host: string): { every: string; only: string } => ({ every: `Every project on ${host.toLowerCase()}`, only: 'This project only' });

/** A tracker's host: a Jira site, an Azure organization, a monday.com account or a Slack workspace, the part a sign-in is for (GH-79). */
export const trackerHost = (t: { kind: string; site?: string | null; organization?: string | null; account?: string | null; workspace?: string | null }): string =>
  (t.kind === 'jira' ? t.site ?? '' : t.kind === 'monday' ? t.account ?? '' : t.kind === 'slack' ? t.workspace ?? '' : t.organization ?? '').replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();

/**
 * The projects whose boards reload when a sign-in changes (GH-79): the one it changed in, and, for a sign-in
 * kept for a site, every open project with a tracker of that kind on that host, which it serves.
 */
export function reloadRoots(root: string | null, site: { kind: string; host: string } | undefined, projects: { root: string; trackers: Parameters<typeof trackerHost>[0][] }[]): string[] {
  const roots = new Set(root ? [root] : []);
  if (site) {
    const host = site.host.toLowerCase();
    for (const p of projects) if (p.trackers.some((t) => t.kind === site.kind && trackerHost(t) === host)) roots.add(p.root);
  }
  return [...roots];
}

/**
 * How signing out goes (GH-79), and what it writes. A repo's own sign-in goes with no question, since no
 * other repo uses it, and the repo falls back to the site's if there is one. The site's asks: every project
 * on the site, or this one only. Null, with nothing to write, when the repo isn't signed in or the question
 * is cancelled.
 */
export async function signOutPlan(
  c: StoredCreds, p: Parameters<typeof repoKey>[0], kind: string, host: string,
  ask: (answers: { every: string; only: string }) => PromiseLike<string | undefined>,
): Promise<{ choice: 'every' | 'this' | 'own'; writes: CredWrites } | null> {
  const using = credInUse(c);
  if (!using) return null;
  let choice: 'every' | 'this' | 'own' = 'own';
  if (using.shared) {
    const answers = signOutAnswers(host);
    const pick = await ask(answers);
    if (pick === answers.every) choice = 'every';
    else if (pick === answers.only) choice = 'this';
    else return null;
  }
  return { choice, writes: signOutWrites(p, kind, host, choice) };
}

/** "for every project on acme.atlassian.net", or "for this project only": where the sign-in in use is kept. */
export const signInScope = (shared: boolean, host: string): string => (shared ? `for every project on ${host}` : 'for this project only');

/**
 * `acc import --json` with these tasks, through a file that's removed after. --json is what accRefusal
 * reads acc's reasons from (D-074).
 */
export async function accImport(acc: (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>, root: string, input: TaskInput[]): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'acc-track-'));
  try {
    const file = join(dir, 'task.json');
    writeFileSync(file, JSON.stringify(input));
    return await acc(['import', '--file', file, '--json'], root);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The Connect page's Save (GH-112): `acc trackers set --json` with the tracker, through a file that's
 * removed after, so acc writes .acc/config.json and the Command Center never does (D-064). In place of the
 * one at `index`, or added: with `add` (Add a board, T-127) always as another board, never in place of one
 * for the same project. Throws acc's reason when it refuses.
 */
export async function accSetTracker(acc: AccRun, root: string, index: number | null, record: Record<string, unknown>, add = false): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'acc-tracker-'));
  try {
    const file = join(dir, 'tracker.json');
    writeFileSync(file, JSON.stringify(record));
    const why = accRefusal(await acc(['trackers', 'set', '--file', file, ...(index === null ? (add ? ['--new'] : []) : ['--index', String(index)]), '--json'], root));
    if (why !== null) throw new Error(why);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Asks acc to take the tracker at `index` out of the repo's .acc/config.json (T-127), naming its kind, so a list
 * that changed since is refused. Its tasks stay in the ledger, on My work. Throws acc's reason when it refuses.
 */
export async function accRemoveTracker(acc: AccRun, root: string, index: number, kind: string): Promise<void> {
  const why = accRefusal(await acc(['trackers', 'remove', '--index', String(index), '--kind', kind, '--json'], root));
  if (why !== null) throw new Error(why);
}

/** What a saved board's message offers (T-127): the Connect page again, to add another board to the project. */
export const ADD_ANOTHER = 'Add another board';

/** Add a board's argument for acc.trackers.add (T-127): the project, and that Save adds another board. */
export const addAnother = (root: string): string => JSON.stringify({ root, add: true });

/**
 * Remove's question (T-127), naming the board and its project, what it does and doesn't do, its button, and
 * what's said once it's done. Settings' Remove and the Connect page's ask the same.
 */
export function removeAsk(name: string, project: string): { message: string; detail: string; go: string; done: string } {
  return {
    message: `Remove ${name} from ${project}?`,
    detail: 'Its tickets leave the Tasks tab, and the Command Center takes it out of the project\'s settings, for you to commit. The tasks you added from it stay on My work. Nothing changes in the tracker, and its sign-in stays for its other boards.',
    go: 'Remove board',
    done: `${name} is removed from ${project}'s settings. Its tasks stay on My work. Commit the settings on each environment's branch, so every checkout shows the same boards.`,
  };
}

type AccRun = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;

/** What `acc import` takes for a tracker's ticket: its title, description and label names. The ticket isn't changed (D-066). */
export function trackInput(t: Pick<Ticket, 'kind' | 'key' | 'url' | 'title' | 'markdown' | 'labels'>): TaskInput[] {
  return [{
    source: { kind: t.kind, key: t.kind === 'github' ? `#${t.key.replace(/^GH-/i, '')}` : t.key, url: t.url },
    title: t.title, brief: t.markdown, labels: t.labels.map((l) => l.name),
  }];
}

/**
 * Why acc refused, in its own words, from its --json output: the first item `acc import` couldn't take, or
 * the error it stopped on. Null when it took everything.
 */
export function accRefusal(r: { code: number; stdout: string; stderr: string }): string | null {
  if (r.code === 0) return null;
  type Said = { errors?: unknown; message?: unknown } | null;
  let said: Said = null;
  try { said = JSON.parse(r.stdout) as Said; } catch { /* plain text */ }
  const first = Array.isArray(said?.errors) ? said.errors.find((e): e is string => typeof e === 'string' && !!e.trim()) : undefined;
  if (first) return inProcessWords(first);
  if (typeof said?.message === 'string' && said.message.trim()) return inProcessWords(said.message);
  return inProcessWords((r.stderr || r.stdout).trim().split('\n')[0] ?? '') || `the Command Center stopped with code ${r.code}`;
}

/** Track's reply: done, why not, or that this ticket is already on its way and nothing more was started. */
export type TrackReply = { ok: true } | { ok: false; error: string } | { ok: false; already: true };

/** A ticket's Track, as a card shows it: on its way, or why the last one didn't go (D-074). */
export interface TrackState { busy: boolean; error: string | null }

/** What a board's cards show of their Track: only the ones on their way, or with a reason to show. */
export function cardTracking(cards: { key: string }[], state: (key: string) => TrackState): Record<string, TrackState> {
  return Object.fromEntries(cards.map((c) => [c.key, state(c.key)] as const).filter(([, t]) => t.busy || t.error));
}

/**
 * The Tracks a window keeps after its boards load (D-074): every one on its way, and every card a board
 * still shows, as `<root>#<KEY>`. A refusal for a card no board shows any more is let go.
 */
export function liveTrackKeys(inFlight: string[], boards: Iterable<readonly [string, readonly { board: { cards: readonly { key: string }[] } | null }[]]>): Set<string> {
  const live = new Set(inFlight);
  for (const [root, states] of boards) for (const s of states) for (const c of s.board?.cards ?? []) live.add(ticketKey(root, c.key));
  return live;
}

/** What tracking a ticket does, passed in so it's tested without a tracker or acc. */
export interface TrackSteps {
  /** The ticket, read again from its tracker: one outside the repo's place throws, naming it (D-072). */
  read: () => Promise<Ticket>;
  /** `acc import --json` with these tasks. */
  importTasks: (input: TaskInput[]) => Promise<{ code: number; stdout: string; stderr: string }>;
  /** acc's tasks read again, so the new one shows before Tracking… goes. */
  reload: () => Promise<void>;
  /** Its tracking started or settled, so the pages redraw. */
  changed?: () => void;
}

/**
 * Track, from a ticket's card or its page: one way for both (D-074). A key already on its way starts
 * nothing. Otherwise the ticket is read, imported with its title, description and labels, and acc's tasks
 * reloaded, then the key settles: cleared, or keeping why it didn't go until the next try.
 */
export async function trackTicket(key: string, pending: Pick<Pending<'track'>, 'start' | 'settle'>, steps: TrackSteps): Promise<TrackReply> {
  if (!pending.start(key, 'track')) return { ok: false, already: true };
  steps.changed?.();
  let error: string | null;
  try {
    error = accRefusal(await steps.importTasks(trackInput(await steps.read())));
    // It's tracked even if the reload fails: the next one shows it.
    if (error === null) await steps.reload().catch(() => undefined);
  } catch (e) {
    error = (e as Error).message || 'It couldn\'t be read or tracked.';
  }
  pending.settle(key, error);
  steps.changed?.();
  return error === null ? { ok: true } : { ok: false, error };
}
