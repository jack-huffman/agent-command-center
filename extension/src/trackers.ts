import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { type Tracker, trackerForKey } from '../../packages/core/src/config.ts';
import { ghEnv, isGh } from '../../packages/core/src/exec.ts';
import type { IntakeResult } from '../../packages/core/src/intake.ts';
import { readSprints, sprintTracker } from '../../packages/core/src/sprints.ts';
import { AzureClient } from '../../packages/core/src/trackers/azure.ts';
import { AZURE_SCOPE, describe, type SignIn } from '../../packages/core/src/trackers/connect.ts';
import { GithubClient } from '../../packages/core/src/trackers/github.ts';
import { JiraClient } from '../../packages/core/src/trackers/jira.ts';
import { MondayClient } from '../../packages/core/src/trackers/monday.ts';
import { SLACK_PREFIX, SlackClient } from '../../packages/core/src/trackers/slack.ts';
import { type Board, type Exec, movesInto, placeText, signInLabel, type Ticket, type TrackerClient, TrackerError, trackerName, type Transition } from '../../packages/core/src/trackers/types.ts';
import { Pending } from '../webview/pending.ts';
import type { Hub, Project } from './hub.ts';
import { accImport, accSetTracker, cardTracking, credInUse, credSite, credWrites, type CredWrites, liveTrackKeys, outsideKeys, placeCandidates, readCreds, reloadRoots, repoKey, signOutPlan, type StoredCreds, trackerHost, type TrackReply, type TrackState, trackTicket } from './logic/connect.ts';
import { inProcessWords } from './logic/processes.ts';
import { credWho, signedInWho } from './logic/sign-in-name.ts';
import { lookAtSprint, sprintLine } from './logic/sprint-change.ts';
import { NO_PASTE, type PasteState, type SlackPlace, trackLink } from './logic/slack-link.ts';
import { readBoardCache, writeBoardCache } from './logic/board-cache.ts';
import { stateOf } from './logic/shared.ts';
import { runFile } from './run.ts';
import type { ExtensionArea } from './area.ts';

type AccRun = (args: string[], cwd: string) => Promise<{ code: number; stdout: string; stderr: string }>;
/** What a sign-in is kept by (D-027): an open project, or one being started on the Connect page (GH-81). */
type SignInProject = Parameters<typeof repoKey>[0];

/** A ticket's Track (D-074): on its way, and why its last try didn't go. */
export type { TrackState };

/** What the board shows for one tracker: its board, or why there isn't one yet. */
export interface BoardState extends Loaded {
  /** Its cards being tracked, or whose last Track didn't go, by key (D-074). */
  tracking: Record<string, TrackState>;
  /** A Slack tracker's box for a thread's link (T-31), in place of a board: its channel, and its Track's state. Null for the rest. */
  paste: (SlackPlace & PasteState) | null;
}

interface Loaded {
  index: number;
  kind: Tracker['kind'];
  title: string;
  /** Where its tickets come from (D-072): the config's, until the board says it with the epic's name. */
  place: string;
  /** Tasks whose tickets left the place after work on them started, each named for a person (D-072). */
  left: string[];
  board: Board | null;
  error: string | null;
  /** A button that fixes the error, such as Sign in to Azure DevOps. */
  connect: { command: string; label: string; arg: string } | null;
  loading: boolean;
  /** Who the board acts as. */
  signedInAs: string | null;
  /** The tracker's own account for the person signed in (T-79), which Mine on the board matches cards to. Null until its board loads, and when the tracker can't say. */
  me?: { id: string; name: string } | null;
  /** Where its sign-in is kept (GH-79): for every project on its host, or this one only. Null for GitHub, and when it has none. */
  signInScope: { shared: boolean; host: string } | null;
  /** Why a Slack tracker's board is off, and how to turn it on (T-85): it names no reaction. Null when it has a board. */
  off?: string | null;
}

/** Runs gh and friends with an argument list, feeding stdin when asked: comments travel that way, never as arguments. gh runs as acc's runner runs it (D-051). */
export const exec: Exec = (cmd, args, opts) => new Promise((resolve) => {
  const env = opts?.env ?? process.env;
  const child = execFile(cmd, args, { env: isGh(cmd) ? ghEnv(env) : env, timeout: 60_000, killSignal: isGh(cmd) ? 'SIGKILL' : 'SIGTERM', maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
    const raw = (err as { code?: unknown } | null)?.code;
    resolve({ code: err ? (typeof raw === 'number' ? raw : raw === 'ENOENT' ? 127 : 1) : 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') || (err && !stdout ? String(err.message) : '') });
  });
  if (opts?.input !== undefined) child.stdin?.end(opts.input);
});

const azureScopes = (tenant: string | null): string[] => [AZURE_SCOPE, ...(tenant ? [`VSCODE_TENANT:${tenant}`] : [])];
const b64 = (s: string) => Buffer.from(s).toString('base64');

/** A sign-in as the Connect page keeps it (GH-51). One kept before then has no method: Jira's is its token. */
type JiraCred = { kind: 'jira'; method?: 'token'; email: string; token: string };
type AzureCred = { kind: 'azure'; method: 'microsoft'; account: vscode.AuthenticationSessionAccountInformation; tenant: string | null } | { kind: 'azure'; method: 'pat'; token: string };
type MondayCred = { kind: 'monday'; method: 'token'; token: string };
/** A Slack app's bot token (T-29). */
type SlackCred = { kind: 'slack'; method: 'token'; token: string };
type Cred = JiraCred | AzureCred | MondayCred | SlackCred;

const hostOf = trackerHost;

/**
 * The trackers each repo names in .acc/config.json, with their clients and boards. A sign-in is a repo's
 * own (D-027) or shared by every project on this machine that uses its site (GH-79), and a repo's own wins,
 * so one that needs another account keeps it. It never changes a ticket on its own: every write here starts
 * from a person's click (D-026).
 */
export class Trackers implements vscode.Disposable {
  private readonly clients = new Map<string, Promise<TrackerClient>>();
  private readonly boards = new Map<string, Loaded[]>();
  private readonly emitter = new vscode.EventEmitter<string>();
  /** Fires with a project root when its boards change. */
  readonly onDidChange = this.emitter.event;
  /** Tickets being tracked, and why each one's last try didn't go, by `${root}#${KEY}` (D-074). */
  private readonly tracking = new Pending<'track'>();
  /** Each Slack tracker's box for a thread's link (T-31), by `${root}#${index}`: its last Track's state. */
  private readonly pastes = new Map<string, PasteState>();
  private readonly trackEmitter = new vscode.EventEmitter<string>();
  /** Fires with a project root when one of its tickets starts or stops being tracked, so its pages say so. */
  readonly onDidTrack = this.trackEmitter.event;
  private readonly secrets: vscode.SecretStorage;
  private readonly hub: Hub;
  private readonly log: vscode.LogOutputChannel;
  private readonly acc: AccRun | null;
  /** Sign-in keys this window wrote, and when, so their change events don't reload twice. */
  private readonly wrote = new Map<string, number>();
  private readonly watch: vscode.Disposable;
  /** Told when a Jira board's sprint changed (T-78): the Overview's Since you last looked says it, once. */
  onSprint: ((root: string, text: string) => void) | null = null;
  /** The sprint changes this window has told, by tracker and sprint, so two loads at once tell one once. */
  private readonly sprintsTold = new Set<string>();

  constructor(secrets: vscode.SecretStorage, hub: Hub, log: vscode.LogOutputChannel, acc: AccRun | null = null) {
    this.secrets = secrets;
    this.hub = hub;
    this.log = log;
    this.acc = acc;
    // A sign-in changed in another window: a shared one serves projects open here too (GH-79).
    this.watch = secrets.onDidChange((e) => {
      const site = credSite(e.key);
      const at = this.wrote.get(e.key);
      this.wrote.delete(e.key);
      if (site && !(at && Date.now() - at < 10_000)) void this.reload(null, site);
    });
  }

  dispose(): void {
    this.watch.dispose();
    this.emitter.dispose();
    this.trackEmitter.dispose();
  }

  /** A project's trackers. A GitHub tracker with no repo uses the project's own repo. */
  trackers(p: Project): Tracker[] {
    return p.config.trackers.map((t) => (t.kind === 'github' && !t.repo && p.config.github ? { ...t, repo: p.config.github.repo } : t));
  }

  title(t: Tracker): string {
    return t.kind === 'github' ? `GitHub · ${t.repo ?? '?'}` : t.kind === 'monday' ? `monday.com · ${t.account}` : t.kind === 'slack' ? `Slack · ${t.workspace}` : `${trackerName(t.kind)} · ${t.project}`;
  }

  /** Where a tracker's tickets come from, as its config says (D-072). */
  place(t: Tracker): string {
    return placeText({ kind: t.kind, project: t.project, repo: t.repo, team: t.team, epic: t.epic, sprint: t.sprint, labels: t.labels, areaPath: t.areaPath, account: t.account, board: t.board, group: t.group, workspace: t.workspace, channel: t.channel });
  }

  /**
   * Which repo a sign-in belongs to: its GitHub repo when it has one, so every clone and worktree shares
   * it, or else its git directory.
   */
  repoKey(p: Project): string {
    return repoKey(p);
  }

  /** What VSCode keeps for this repo and a tracker's host: its own key and the site's (GH-79). */
  private stored(p: SignInProject, kind: string, host: string): Promise<StoredCreds> {
    return readCreds((k) => this.secrets.get(k), p, kind, host);
  }

  /** The sign-in a tracker uses here, its own or its site's (GH-79), and which. */
  private async credFor(p: Project, t: Tracker): Promise<{ cred: Cred; shared: boolean } | null> {
    return credInUse(await this.stored(p, t.kind, hostOf(t))) as { cred: Cred; shared: boolean } | null;
  }

  private async cred(p: Project, t: Tracker): Promise<Cred | null> {
    return (await this.credFor(p, t))?.cred ?? null;
  }

  private async apply(w: CredWrites): Promise<void> {
    for (const [key, value] of w.store) {
      this.wrote.set(key, Date.now());
      await this.secrets.store(key, value);
    }
    for (const key of w.delete) {
      this.wrote.set(key, Date.now());
      await this.secrets.delete(key);
    }
  }

  /** Who a tracker acts as for this repo: the GitHub account, the Jira email, the Microsoft account, the Slack app, or a token. */
  async signedInAs(p: Project, index: number): Promise<string | null> {
    return (await this.signedInFor(p, index))?.who ?? null;
  }

  /** Who a tracker acts as, and for a Jira, Azure DevOps, monday.com or Slack tracker where its sign-in is kept (GH-79). */
  async signedInFor(p: Project, index: number): Promise<{ who: string; scope: { shared: boolean; host: string } | null } | null> {
    const t = this.trackers(p)[index];
    if (!t) return null;
    if (t.kind === 'github') return p.config.github?.account ? { who: p.config.github.account, scope: null } : null;
    const c = await this.credFor(p, t);
    if (!c) return null;
    // A Slack reply posts as the app, so it says the app's name, as the Connect page does; an Azure DevOps sign-in says the
    // person's name (T-90). A client that can't say leaves the sign-in's own words.
    return { who: await signedInWho(t.kind, c.cred, () => this.client(p, index)), scope: { shared: c.shared, host: hostOf(t) } };
  }

  /** The trackers this repo names but hasn't signed in to yet. GitHub signs in through gh, so it's never listed. */
  async missingSignIns(p: Project): Promise<string[]> {
    const out: string[] = [];
    for (const t of this.trackers(p)) if (t.kind !== 'github' && !(await this.cred(p, t))) out.push(this.title(t));
    return out;
  }

  /** Which tracker a ticket key belongs to: GH-12 to GitHub, AB-123 to Azure, MON-123 to monday.com, MSP-7 to the Jira project MSP. */
  trackerFor(p: Project, key: string): number | null {
    return trackerForKey(this.trackers(p), key);
  }

  boardStates(root: string): BoardState[] {
    const p = this.hub.project(root);
    // A fresh window draws each tracker's last board at once, refreshing, and never another tracker's place first.
    if (p && !this.boards.has(root) && this.trackers(p).length) this.seed(p);
    return (this.boards.get(root) ?? []).map((s) => {
      const t = p ? this.trackers(p)[s.index] : undefined;
      return {
        ...s,
        tracking: cardTracking(s.board?.cards ?? [], (key) => this.trackState(root, key)),
        paste: t?.kind === 'slack' ? { workspace: t.workspace, channel: t.channel, prefix: t.prefix, ...(this.pastes.get(`${root}#${s.index}`) ?? NO_PASTE) } : null,
      };
    });
  }

  /** Whether a ticket is being tracked now, and why its last Track didn't go (D-074). */
  trackState(root: string, key: string): TrackState {
    const k = `${root}#${key.toUpperCase()}`;
    return { busy: !!this.tracking.what(k), error: this.tracking.error(k) ?? null };
  }

  client(p: Project, index: number): Promise<TrackerClient> {
    const t = this.trackers(p)[index];
    if (!t) return Promise.reject(new TrackerError('not-found', 'That tracker is no longer in the project\'s settings.'));
    // The account is part of the key: switching it (D-028) must never reuse the old one's client.
    const key = `${p.root}#${index}#${JSON.stringify(t)}#${p.config.github?.account ?? ''}`;
    let c = this.clients.get(key);
    if (!c) {
      c = this.makeClient(p, t);
      this.clients.set(key, c);
      c.catch(() => this.clients.delete(key)); // a failed sign-in is tried again next time
    }
    return c;
  }

  private async makeClient(p: Project, t: Tracker): Promise<TrackerClient> {
    if (t.kind === 'github') {
      const account = p.config.github?.account;
      if (!t.repo || !account) throw new TrackerError('other', 'A GitHub tracker needs the project\'s GitHub repo and account, in its settings.');
      return new GithubClient({ repo: t.repo, token: await this.ghToken(p.root, account), account, exec, project: typeof t.board === 'number' ? t.board : null, labels: t.labels });
    }
    const found = await this.credFor(p, t);
    const c = found?.cred ?? null;
    if (t.kind === 'slack') {
      if (!c || c.kind !== 'slack') throw new TrackerError('auth', `Sign in to Slack (${t.workspace}) for this repo to read its channel's threads.`);
      return new SlackClient({ workspace: t.workspace!, channel: t.channel!, prefix: t.prefix ?? SLACK_PREFIX, token: c.token, reaction: t.reaction, doneReaction: t.doneReaction });
    }
    if (t.kind === 'jira') {
      if (!c || c.kind !== 'jira') throw new TrackerError('auth', `Sign in to Jira (${t.site}) for this repo to see its board and tickets.`);
      return new JiraClient({ site: t.site!, project: t.project!, email: c.email, token: c.token, board: typeof t.board === 'number' ? t.board : null, epic: t.epic, sprint: t.sprint });
    }
    if (t.kind === 'monday') {
      if (!c || c.kind !== 'monday') throw new TrackerError('auth', `Sign in to monday.com (${t.account}) for this repo to see its board and items.`);
      return new MondayClient({ account: t.account!, board: t.board!, group: t.group, statusColumn: t.statusColumn, prefix: t.prefix ?? 'MON', token: c.token });
    }
    if (!c || c.kind !== 'azure') throw new TrackerError('auth', `Sign in to Azure DevOps (${t.organization}) for this repo to see its board and work items.`);
    return new AzureClient({
      organization: t.organization!, project: t.project!, team: t.team, board: typeof t.board === 'string' ? t.board : null, prefix: t.prefix ?? 'AB', areaPath: t.areaPath,
      auth: c.method === 'pat' ? async () => `Basic ${b64(`:${c.token}`)}` : async () => {
        const s = await vscode.authentication.getSession('microsoft', azureScopes(c.tenant), { account: c.account, silent: true });
        if (!s) throw new TrackerError('auth', `The Microsoft sign-in ${found!.shared ? `every project on ${hostOf(t)}` : 'this repo'} uses (${c.account.label}) has ended. Sign in to Azure DevOps again.`);
        return `Bearer ${s.accessToken}`;
      },
    });
  }

  private signInButton(p: Project, index: number, t: Tracker): BoardState['connect'] {
    return t.kind === 'github' ? null : { command: 'acc.trackers.signIn', label: signInLabel(t.kind), arg: JSON.stringify({ root: p.root, index }) };
  }

  /**
   * A project's boards before their first load in this window: each tracker's last board from the repo's cache,
   * or none yet, all loading. Nothing is asked of a tracker here, and nothing fires: the caller is drawing.
   */
  private seed(p: Project): Loaded[] {
    const list = this.trackers(p);
    let cached: ReturnType<typeof readBoardCache> = [];
    try {
      cached = readBoardCache(stateOf(p), list);
    } catch (e) {
      this.log.warn(`[trackers] couldn't read the last boards: ${(e as Error).message}`);
    }
    const states: Loaded[] = list.map((t, index) => ({
      index, kind: t.kind, title: this.title(t), place: cached[index]?.board.place ?? this.place(t), left: [], board: cached[index]?.board ?? null,
      error: null, connect: null, loading: true, signedInAs: null, signInScope: null, me: cached[index]?.me ?? null, off: null,
    }));
    this.boards.set(p.root, states);
    return states;
  }

  /** Loads every board, or just one project's. Boards load side by side; each shows its own error. */
  async loadBoards(root?: string): Promise<void> {
    const projects = this.hub.projects.filter((p) => !root || p.root === root);
    await Promise.all(projects.map(async (p) => {
      const list = this.trackers(p);
      if (!list.length) {
        this.boards.delete(p.root);
        // Its last Track's reason goes with its boards, as any other project's does (D-074).
        this.forgetTracking();
        this.emitter.fire(p.root);
        return;
      }
      const prev = this.boards.get(p.root) ?? this.seed(p);
      const states: Loaded[] = await Promise.all(list.map(async (t, index) => {
        const as = await this.signedInFor(p, index);
        return {
          // The last board's place, with its epic's name, until this load says otherwise: no flicker every refresh.
          index, kind: t.kind, title: this.title(t), place: prev[index]?.board?.place ?? this.place(t), left: prev[index]?.left ?? [], board: prev[index]?.board ?? null,
          error: null, connect: null, loading: true, signedInAs: as?.who ?? null, signInScope: as?.scope ?? null, me: prev[index]?.me ?? null, off: null,
        };
      }));
      this.boards.set(p.root, states);
      this.emitter.fire(p.root);
      await Promise.all(states.map(async (s) => {
        try {
          const client = await this.client(p, s.index);
          // A Slack channel names its messages' reaction for a board (T-85). Without one, its client refuses with
          // why and how to turn it on, which the box for a thread's link shows above itself, never as an error.
          if (s.kind === 'slack' && !list[s.index]!.reaction) {
            s.board = null;
            s.off = await client.board().then(() => null, (e: Error) => inProcessWords(e.message));
            return;
          }
          s.board = await client.board();
          // Who Mine means (T-79). A tracker that can't say leaves Mine off, with its reason, rather than failing the board.
          // A Slack board's cards are people's messages, and its client is the app, so Mine has nobody to mean there.
          s.me = s.kind === 'slack' ? null : await Promise.resolve().then(() => client.me()).catch(() => null);
          s.place = s.board.place;
          s.error = null;
          await this.followPlace(p, s, client);
        } catch (e) {
          s.error = inProcessWords((e as Error).message);
          if (e instanceof TrackerError && e.kind === 'auth') s.connect = this.signInButton(p, s.index, list[s.index]!);
          this.log.warn(`[trackers] ${s.title}: ${s.error}`);
        } finally {
          s.loading = false;
        }
      }));
      // The boards that loaded are kept in the repo's state folder for the next window; one that failed keeps its last.
      try {
        writeBoardCache(stateOf(p), list, states.map((s) => (s.board && !s.error ? { board: s.board, me: s.me ?? null } : null)), new Date());
      } catch (e) {
        this.log.warn(`[trackers] couldn't keep the boards: ${(e as Error).message}`);
      }
      this.forgetTracking();
      this.emitter.fire(p.root);
    }));
  }

  /** A card no board shows any more leaves its last Track's reason behind. One still on its way finishes first. */
  private forgetTracking(): void {
    this.tracking.forget(liveTrackKeys(this.tracking.inFlight(), this.boards));
  }

  /**
   * After a Jira, Azure DevOps or monday.com board loads, asks its tracker about this repo's unfinished tasks from it
   * that the board doesn't show (D-072). acc intake removes the ones outside the place that never started,
   * and names the rest: those stay on the agent board, and this board says so. Only the Command Center
   * signs in to these trackers (D-066). A failed read never counts as outside (D-048), and nothing here
   * changes a ticket. A Jira board held to a sprint (T-78) also hands acc the sprint it shows, when that's
   * new, and a change of sprint is told once, after acc has kept it.
   */
  private async followPlace(p: Project, s: Loaded, client: TrackerClient): Promise<void> {
    if (s.kind === 'github' || !s.board || !this.acc) return;
    const keys = placeCandidates(this.hub.ledger(p.root)?.tasks ?? [], { kind: s.kind, index: s.index, cards: s.board.cards }, (key) => this.trackerFor(p, key));
    const outside = await outsideKeys(keys, (k) => client.outside(k));
    const t = this.trackers(p)[s.index];
    const tracker = t?.kind === 'jira' && t.sprint !== null ? sprintTracker(t) : null;
    const sprint = tracker ? await lookAtSprint(readSprints(stateOf(p))[tracker], s.board, client, new Date()) : null;
    if (!outside.length && !sprint?.moved) {
      s.left = [];
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), 'acc-place-'));
    try {
      const file = join(dir, 'outside.json');
      writeFileSync(file, JSON.stringify({ outside, ...(tracker && sprint?.moved ? { sprint: { tracker, seen: sprint.seen } } : {}) }));
      const r = await this.acc(['intake', s.kind, '--file', file, '--json'], p.root);
      if (r.code !== 0) throw new Error(inProcessWords((r.stderr || r.stdout).trim().split('\n')[0] ?? '') || 'acc said nothing.');
      const res = JSON.parse(r.stdout) as IntakeResult;
      s.left = res.leftAlone.map((l) => l.note);
      const line = sprint ? sprintLine(sprint, res.leftAlone) : null;
      const told = `${p.root}#${tracker}#${sprint?.seen.sprints.map((x) => x.id).join(',')}`;
      if (line && !this.sprintsTold.has(told)) {
        this.sprintsTold.add(told);
        this.onSprint?.(p.root, line);
      }

      if (res.removed.length) {
        this.log.info(`[trackers] ${s.title}: ${res.removed.join(', ')} left this repo's place before work started, so acc took them off the board.`);
        await this.hub.loadTasks(true);
      }
    } catch (e) {
      this.log.warn(`[trackers] ${s.title}: couldn't follow tickets that left the place: ${(e as Error).message}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  async ticket(p: Project, index: number, key: string): Promise<Ticket> {
    return (await this.client(p, index)).ticket(key);
  }

  /**
   * Adds a ticket to acc's ledger, from its card or its page (D-074), so an agent can be dispatched to it.
   * It's read again, so one that has left the repo's place is refused, naming the place (D-072), then
   * `acc import` gets its title, description and labels. Nothing here changes the ticket (D-066). A second
   * Track for a ticket already on its way starts nothing.
   */
  track(p: Project, index: number, key: string): Promise<TrackReply> {
    const k = key.toUpperCase();
    const changed = () => {
      this.emitter.fire(p.root);
      this.trackEmitter.fire(p.root);
    };
    return trackTicket(`${p.root}#${k}`, this.tracking, {
      // A window that can't run acc says so before it asks the tracker anything.
      read: async () => {
        if (!this.acc) throw new Error('This window can\'t run acc.');
        return this.ticket(p, index, k);
      },
      importTasks: async (input) => {
        if (!this.acc) throw new Error('This window can\'t run acc.');
        return accImport(this.acc, p.root, input);
      },
      reload: () => this.hub.loadTasks(true),
      changed,
    });
  }

  /**
   * Track from a Slack tracker's box (T-31): the link is read before Track upper-cases it, so its case never
   * matters, and one from another workspace or channel is refused, naming it. Track then reads the thread
   * and gives it to acc; a second Track of one thread changes its task's text, never adding a second.
   */
  trackLink(p: Project, index: number, link: string): Promise<TrackReply> {
    const t = this.trackers(p)[index];
    const id = `${p.root}#${index}`;
    if (t?.kind !== 'slack') return Promise.resolve({ ok: false, error: 'That tracker isn\'t a Slack channel.' });
    return trackLink(link, t, (key) => this.track(p, index, key), (state) => {
      this.pastes.set(id, state);
      this.emitter.fire(p.root);
    });
  }

  /**
   * Moves a card to a column the way the tracker would. Azure sets the column itself; elsewhere it's a
   * transition whose target the column holds, picked by the person when there are several.
   */
  async move(p: Project, index: number, key: string, columnId: string): Promise<boolean> {
    const state = this.boardStates(p.root)[index];
    const column = state?.board?.columns.find((c) => c.id === columnId);
    const card = state?.board?.cards.find((c) => c.key === key);
    if (!state?.board || !column || !card) return false;
    if (column.statusIds.includes(card.status.id)) return false;
    const client = await this.client(p, index);
    if (client.moveToColumn) {
      await client.moveToColumn(card, column);
      return true;
    }
    const moves = movesInto(await client.transitions(key), column);
    let pick: Transition | undefined = moves[0];
    if (moves.length > 1) {
      const chosen = await vscode.window.showQuickPick(moves.map((m) => ({ label: m.name, description: `→ ${m.to.name}`, m })), { title: `Move ${key} to ${column.name}`, placeHolder: 'The workflow has more than one way there' });
      pick = chosen?.m;
    }
    if (!pick) {
      if (!moves.length) void vscode.window.showWarningMessage(`${state.kind === 'jira' ? 'Jira\'s workflow' : trackerName(state.kind)} has no move from ${card.status.name} to ${column.name} for ${key}. Open the ticket to see where it can go.`);
      return false;
    }
    await client.transition(key, pick, card);
    return true;
  }


  // ------------------------------------------------------------ signing in: a repo's own, or every project's on a site

  /**
   * One of the trackers that takes a sign-in: the one named, the only one, or the one a person picks.
   * Null when no project here has one.
   */
  async pickTracker(arg: unknown, title: string): Promise<{ p: Project; index: number; t: Tracker } | null> {
    if (typeof arg === 'string') {
      try {
        const { root, index } = JSON.parse(arg) as { root: string; index: number };
        const p = this.hub.project(root);
        const t = p && this.trackers(p)[index];
        if (p && t) return { p, index, t };
      } catch {
        // fall through to asking
      }
    }
    const choices = this.hub.projects.flatMap((p) => this.trackers(p).map((t, index) => ({ p, index, t }))).filter((c) => c.t.kind !== 'github');
    if (choices.length <= 1) return choices[0] ?? null;
    const pick = await vscode.window.showQuickPick(choices.map((c) => ({ label: this.title(c.t), description: c.p.name, detail: hostOf(c.t), c })), { title });
    return pick?.c ?? null;
  }

  /**
   * Signs a repo out of a tracker (GH-79). A shared sign-in asks: every project on its site, or this one
   * only. A repo's own sign-in goes without asking, since no other repo uses it, and the repo uses its
   * site's again if there is one. Neither touches another site's sign-in.
   */
  async signOut(arg?: unknown): Promise<void> {
    const chosen = await this.pickTracker(arg, 'Sign out of which tracker?');
    if (!chosen) {
      void vscode.window.showInformationMessage('No project here has a Jira, Azure DevOps, monday.com or Slack tracker to sign out of.');
      return;
    }
    const { p, t } = chosen;
    const host = hostOf(t);
    const was = await this.stored(p, t.kind, host);
    const using = credInUse(was) as { cred: Cred; shared: boolean } | null;
    if (!using) {
      void vscode.window.showInformationMessage(`${p.name} isn't signed in to ${this.title(t)}.`);
      return;
    }
    const c = using.cred;
    const plan = await signOutPlan(was, p, t.kind, host, ({ every, only }) => vscode.window.showWarningMessage(`Sign out of ${trackerName(t.kind)} on ${host}?`, {
      modal: true,
      detail: `${p.name} uses the sign-in for every project on ${host} (${credWho(c)}). Sign out every project on ${host}, or only ${p.name}, which leaves the rest signed in. Projects with a sign-in of their own keep it.`,
    }, every, only));
    if (!plan) return;
    const { choice } = plan;
    await this.apply(plan.writes);
    const msAccount = c.kind === 'azure' && c.method === 'microsoft' && choice !== 'this' ? ` Your Microsoft account (${c.account.label}) stays signed in to VSCode; manage it under Accounts.` : '';
    const site = was.site as Cred | null;
    void vscode.window.showInformationMessage(
      choice === 'every' ? `Every project on ${host} is signed out of ${trackerName(t.kind)}. Projects with a sign-in of their own keep it.${msAccount}`
        : choice === 'this' ? `${p.name} is signed out of ${this.title(t)}. Other projects on ${host} still use the sign-in for every project there (${credWho(c)}).`
          : site ? `${p.name} now uses the sign-in for every project on ${host} (${credWho(site)}). To sign it out here too, sign out again and choose This project only.${msAccount}`
            : `${p.name} is signed out of ${this.title(t)}.${msAccount}`,
    );
    await this.reload(p.root, { kind: t.kind, host });
  }

  // ------------------------------------------------------------ for the Connect page (GH-51)

  /**
   * The sign-in this repo uses for a host, its own or its site's (GH-79), ready for the Connect page's checks
   * and lists, or null. A Microsoft sign-in is asked for silently; one that has ended says so.
   */
  async storedSignIn(p: SignInProject, kind: string, host: string): Promise<{ signIn: SignIn; shared: boolean } | null> {
    const found = credInUse(await this.stored(p, kind, host));
    if (!found) return null;
    const { cred: c, shared } = found;
    if (c.method === 'microsoft') {
      const account = c.account as vscode.AuthenticationSessionAccountInformation;
      const s = await vscode.authentication.getSession('microsoft', azureScopes((c.tenant as string | null) ?? null), { account, silent: true });
      if (!s) throw new TrackerError('auth', `The Microsoft sign-in ${shared ? `every project on ${host.toLowerCase()}` : 'this repo'} used (${account.label}) has ended. Sign in again.`);
      return { signIn: { method: 'microsoft', fields: {}, header: `Bearer ${s.accessToken}`, gh: null }, shared };
    }
    // A Jira sign-in from before GH-51 didn't say its method: it's the only one Jira has.
    const method = typeof c.method === 'string' ? c.method : describe(kind)?.methods.find((m) => m.via === 'fields')?.id ?? '';
    const fields = Object.fromEntries(Object.entries(c).filter(([k, v]) => k !== 'kind' && k !== 'method' && typeof v === 'string')) as Record<string, string>;
    return { signIn: { method, fields, header: null, gh: null }, shared };
  }

  /** Whether this repo keeps its own key for a host: a sign-in, or a "this project only" sign-out (GH-79). */
  async ownSignIn(p: SignInProject, kind: string, host: string): Promise<boolean> {
    return (await this.stored(p, kind, host)).own !== null;
  }

  /**
   * Keeps a sign-in for every project on its site, or for this repo only (GH-79, D-027), where the boards read
   * it. A project being started has the keys it will have once acc init writes it (GH-81).
   */
  async storeSignIn(p: SignInProject, kind: string, host: string, cred: Record<string, unknown>, shared: boolean): Promise<void> {
    await this.apply(credWrites(p, kind, host, cred, shared));
  }

  /** The repo's git user.email, which a Jira sign-in usually is. */
  async gitEmail(root: string): Promise<string | null> {
    const r = await runFile('git', ['config', 'user.email'], root, process.env, undefined, 10_000);
    return r.code === 0 && r.stdout.trim() ? r.stdout.trim() : null;
  }

  /** A token for the project's GitHub account, from gh (D-007). */
  async ghToken(root: string, account: string): Promise<string> {
    const tok = await runFile('gh', ['auth', 'token', '-u', account], root, process.env, undefined, 20_000);
    if (tok.code === 127) throw new TrackerError('other', 'The GitHub CLI (gh) isn\'t installed.');
    if (tok.code !== 0 || !tok.stdout.trim()) throw new TrackerError('auth', `gh isn't logged in as ${account}. Sign in to GitHub from Setup.`);
    return tok.stdout.trim();
  }

  /**
   * VSCode's Microsoft sign-in, in the tenant that owns the host. It asks which account rather than reusing
   * whichever another repo picked (clearSessionPreference). VSCode draws that chooser itself.
   */
  async microsoft(host: string, spec: { scope: string; tenant: (host: string) => Promise<string | null> }): Promise<{ header: string; cred: Record<string, unknown> }> {
    const tenant = await spec.tenant(host);
    const s = await vscode.authentication.getSession('microsoft', [spec.scope, ...(tenant ? [`VSCODE_TENANT:${tenant}`] : [])], { createIfNone: true, clearSessionPreference: true });
    return { header: `Bearer ${s.accessToken}`, cred: { account: s.account, tenant } };
  }

  /**
   * Asks acc to write a tracker to the repo's own config (GH-112): in place of the one at `index`, or added,
   * replacing one for the same project. Keys it doesn't name are kept, and those it names as null are taken
   * out (D-072). The Command Center never writes the file itself (D-064). Throws acc's reason.
   */
  async write(root: string, index: number | null, record: Record<string, unknown>): Promise<void> {
    if (!this.acc) throw new Error('This window can\'t run acc.');
    await accSetTracker(this.acc, root, index, record);
  }

  /**
   * A sign-in changed: every client starts again, and the project's boards reload. With a site, so do those
   * of every open project with a tracker on it, which a shared sign-in serves (GH-79).
   */
  async reload(root: string | null, site?: { kind: string; host: string }): Promise<void> {
    this.clients.clear();
    const roots = reloadRoots(root, site, this.hub.projects.map((p) => ({ root: p.root, trackers: this.trackers(p) })));
    await Promise.all(roots.map((r) => this.loadBoards(r)));
  }
}

export const area: ExtensionArea = {
  register({ reg, hub, setup, trackers, connect, panels, receive }) {
    /** Opens the Connect page over the section that's showing, which its Back returns to. */
    const openConnect = async (o: { root?: string; kind?: string; index?: number; signIn?: boolean }) => {
      if (!(await connect.open({ ...o, from: panels.current() }))) {
        void vscode.window.showInformationMessage('Onboard this project first: Agent Command Center: Onboard this project.');
        return;
      }
      panels.show();
    };
    // From a project's button its root comes along, and from the Jira button the kind too; a board's Change
    // sends its tracker as JSON. Setup's buttons send a step or an item instead, whose kind isn't a tracker's.
    reg('acc.trackers.add', (n?: unknown) => {
      let a = n as { root?: unknown; kind?: unknown; index?: unknown } | undefined;
      if (typeof n === 'string') try { a = JSON.parse(n); } catch { a = undefined; }
      return openConnect({
        root: typeof a?.root === 'string' ? a.root : undefined, kind: typeof a?.kind === 'string' && describe(a.kind) ? a.kind : undefined,
        index: Number.isInteger(a?.index) ? a!.index as number : undefined,
      });
    });
    // Every Sign in to Jira or Azure DevOps opens that tracker on the Connect page, at its sign-in.
    reg('acc.trackers.signIn', async (arg?: unknown) => {
      const chosen = await trackers.pickTracker(arg, 'Sign in to which tracker?');
      await openConnect(chosen ? { root: chosen.p.root, index: chosen.index, signIn: true } : {});
    });
    reg('acc.trackers.signOut', async (arg?: unknown) => { await trackers.signOut(arg); await setup.recheck('B14.tickets'); });
    // Setup's "From a Jira epic…" (GH-81): the Connect page, over Setup, for a folder with no config yet.
    setup.useStarter(async (start) => {
      await connect.open({ start, from: 'setup' });
      panels.show('setup');
    });
    // B14: acc doctor sees the config; only the extension can see this repo's sign-ins.
    setup.setOverlay(async (items, cwd) => {
      const p = hub.project(cwd) ?? hub.projectFor(cwd);
      if (!p) return items;
      const missing = await trackers.missingSignIns(p);
      return items.map((i) => (i.id === 'B14.tickets' && i.status === 'pass' && missing.length
        ? { ...i, status: 'fail', detail: `${i.detail} This repo isn't signed in to ${missing.join(' or ')} yet.`, fix: 'acc.trackers.signIn' }
        : i));
    });
    reg('acc.trackers.refresh', () => trackers.loadBoards());
    // A card dropped on another column of a tracker board moves the real ticket. Track on a tracker board's
    // card (D-074): the card itself is the reply, Tracking…, then acc's task or why not.
    const move = async (root: string, tracker: number, key: string, to: string) => {
      const p = hub.project(root);
      if (!p) return;
      try {
        if (await trackers.move(p, tracker, key, to)) await trackers.loadBoards(root);
        else panels.post(); // put the card back where it was
      } catch (e) {
        void vscode.window.showErrorMessage(`Couldn't move ${key}: ${(e as Error).message}`);
        panels.post();
      }
    };
    const track = async (root: string, tracker: number, key: string) => {
      const p = hub.project(root);
      if (p) await trackers.track(p, tracker, key);
    };
    receive('move', (m) => { if (hub.project(m.project)) void move(m.project, m.tracker, m.key, m.to); });
    receive('track-link', (m) => {
      const p = hub.project(m.project);
      if (p) void trackers.trackLink(p, m.tracker, m.link);
      else panels.post(); // the box stops saying Tracking…
    });
    receive('track', (m) => {
      if (hub.project(m.project)) void track(m.project, m.tracker, m.key);
      else panels.post(); // the card stops saying Tracking…
    });
  },
};
