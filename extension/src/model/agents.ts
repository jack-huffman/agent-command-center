/**
 * The Agents section: sessions by where they run, and what they bill. How agents run is in Settings (GH-110).
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { agentLook, finishedSession, stopFinishedPlan } from '../logic/agents.ts';
import { type AgentSession, isUnder, tildePath } from '../logic/shared.ts';
import type { DoctorItem } from '../logic/setup.ts';
import { lookOf } from './environments.ts';
import { type HubLike, type Look, type ModelArea, nameOf, type ProjectLike, sessionKey } from './shared.ts';

// ---------------------------------------------------------------- agents

/** Where a session runs, as acc shows it wherever it shows one (GH-83). */
export interface SessionFolder {
  /** The whole path, with ~ for the home folder: what hovering shows, and the Full path view. */
  full: string;
  /** The folder in context: `Acme Service › worktree ACME-12`, `clients/Acme Service`, `scratch`, `~`. */
  label: string;
  /**
   * In a project open in this window, the label without the project, which its heading names already:
   * `main checkout`, `worktree ACME-12`, `force-app/main`. Null for a session elsewhere.
   */
  inProject: string | null;
}

const lastPart = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;
const inWorktree = (id: string, rest = ''): string => [`worktree ${id}`, rest].filter(Boolean).join(' › ');

/** Where in a project a folder is: its main checkout, a worktree, or a folder inside either. */
function placeIn(p: ProjectLike, path: string): string {
  const within = (root: string) => path.slice(root.length + 1);
  const tree = p.worktrees.filter((w) => !w.main && isUnder(path, w.path)).sort((a, b) => b.path.length - a.path.length)[0];
  if (tree) return inWorktree(lastPart(tree.path), within(tree.path));
  if (!isUnder(path, p.root)) return lastPart(path);
  const wt = /^\.claude\/worktrees\/([^/]+)(?:\/(.+))?$/.exec(within(p.root));
  return wt ? inWorktree(wt[1]!, wt[2]) : within(p.root) || 'main checkout';
}

/**
 * Each session's folder in context, by its cwd: the one place acc works it out, for the Agents tab, an
 * agent's page, its Needs you card, and the In progress section (GH-76) (GH-83).
 *
 * A session in a project open in this window is placed in it: its main checkout, a worktree, or a folder
 * inside either. Elsewhere it's named by its repo, the nearest folder up holding .git, then the path inside
 * it; a builder's worktree, under .claude/worktrees/, reads as its repo's from the path alone. Outside any
 * repo, it's its folder's own name, or ~. Two different folders elsewhere that name sessions the same, such
 * as two repos called Acme Service, each add their parent folders until they differ, for every session in
 * them. `extra` adds folders no listed session has, such as an ended session's, to tell apart with the rest.
 */
export function sessionFolders(hub: HubLike, extra: string[] = []): Map<string, SessionFolder> {
  const home = hub.home;
  const out = new Map<string, SessionFolder>();
  // Elsewhere: the folder that names it (its repo, or itself), and what follows it.
  const drafts: { cwd: string; full: string; base: string; rest: string[] }[] = [];
  for (const cwd of new Set([...hub.agents.map((s) => s.cwd), ...extra])) {
    const path = cwd.length > 1 ? cwd.replace(/\/+$/, '') : cwd;
    const full = tildePath(path, home);
    const p = hub.projectFor(path);
    if (p) {
      const inProject = placeIn(p, path);
      out.set(cwd, { full, label: `${p.name} › ${inProject}`, inProject });
      continue;
    }
    const wt = /^(.+)\/\.claude\/worktrees\/([^/]+)(?:\/(.+))?$/.exec(path);
    const found = wt ? null : hub.repoFor?.(path) ?? null;
    const repo = wt ? wt[1]! : found && isUnder(path, found) ? found : null;
    const rest = wt ? [inWorktree(wt[2]!, wt[3])] : repo && repo !== path ? [path.slice(repo.length + 1)] : [];
    drafts.push({ cwd, full, base: repo ?? path, rest });
  }
  // Each base folder by its last parts, ~ for home: Acme Service, then clients/Acme Service, a parent more
  // each round for those that still read the same as another.
  const parts = (base: string) => tildePath(base, home).split('/');
  const depth = new Map(drafts.map((d) => [d.base, 1]));
  const named = (base: string) => parts(base).slice(-depth.get(base)!).join('/') || '/';
  for (let more = true; more;) {
    more = false;
    const by = new Map<string, string[]>();
    for (const base of depth.keys()) by.set(named(base), [...(by.get(named(base)) ?? []), base]);
    for (const same of by.values()) {
      if (same.length < 2) continue;
      for (const base of same) if (depth.get(base)! < parts(base).length) { depth.set(base, depth.get(base)! + 1); more = true; }
    }
  }
  for (const d of drafts) out.set(d.cwd, { full: d.full, label: [named(d.base), ...d.rest].join(' › '), inProject: null });
  return out;
}

/** The Agents tab's Where column: each session's folder in context, or its full path (GH-83). */
export const WHERE_VIEWS = ['folder', 'path'] as const;
export type WhereView = (typeof WHERE_VIEWS)[number];

export interface AgentRow {
  key: string;
  /** Background sessions can be attached to, logged and stopped from here; interactive ones can't. */
  background: boolean;
  name: string;
  look: Look;
  needsYou: boolean;
  /** Its work is over (D-095): its task is done or has a later run, or its review or analysis is recorded. */
  finished: boolean;
  kind: string;
  /** Its folder in context, without the project its group names (GH-83). */
  where: string;
  /** Its whole folder, with ~ for the home folder: the Full path view, and the hover in both. */
  path: string;
  startedAt: number;
  /** The model it runs with (D-086), or null when that isn't known yet. */
  model: string | null;
}

export interface AgentsModel {
  kind: 'agents';
  error: string | null;
  places: { label: string; root: string | null; agents: AgentRow[] }[];
  /** What the Where column shows, remembered for the window (GH-83). */
  whereView: WhereView;
  /** How many finished background sessions Stop finished sessions would stop (D-095). */
  stopFinished: number;
  /**
   * What this machine's agents bill (D-036). How agents run is in Settings now (GH-110), but per-token
   * billing costs money while nobody looks, so Agents says so too.
   */
  billing: Look | null;
}

/** What the billing check says, on Agents and in Settings' How agents run. Null until that check has run. */
export function billingLook(items: DoctorItem[]): Look | null {
  const i = items.find((x) => x.id === 'A1.claude-billing');
  if (!i || i.status === 'skip') return null;
  return i.status === 'pass' ? { label: 'Agents use your Claude subscription', icon: 'pass', tone: 'blue' } : { label: `Per-token billing: ${i.detail}`, icon: 'warning', tone: 'orange' };
}

export function agentsModel(hub: HubLike, setupItems: DoctorItem[] = [], whereView: WhereView = 'folder'): AgentsModel {
  const tieOf = (s: AgentSession) => hub.tieFor?.(s) ?? null;
  const askingOf = (s: AgentSession) => hub.askingFor?.(s) ?? null;
  const lookOf = (s: AgentSession) => agentLook(s, askingOf(s), tieOf(s));
  const folders = sessionFolders(hub);
  const rowFor = (s: AgentSession): AgentRow => {
    const look = lookOf(s);
    const key = sessionKey(s);
    const f = folders.get(s.cwd)!;
    return { key, background: !!s.id, name: nameOf(hub, s), look: { label: look.label, icon: look.icon, tone: look.tone }, needsYou: look.needsYou, finished: finishedSession(s, tieOf(s), askingOf(s)), kind: s.kind, where: f.inProject ?? f.label, path: f.full, startedAt: s.startedAt, model: hub.modelFor?.(s) ?? null };
  };
  const sorted = [...hub.agents].sort((a, b) => Number(lookOf(b).needsYou) - Number(lookOf(a).needsYou) || b.startedAt - a.startedAt);
  const places = hub.projects.map((p) => ({ label: p.name, root: p.root as string | null, agents: sorted.filter((s) => hub.projectFor(s.cwd) === p).map(rowFor) }));
  const elsewhere = sorted.filter((s) => !hub.projectFor(s.cwd));
  if (elsewhere.length) places.push({ label: 'Elsewhere on this machine', root: null, agents: elsewhere.map(rowFor) });
  return { kind: 'agents', error: hub.agentsError, places, whereView, stopFinished: stopFinishedPlan(hub.agents, tieOf, askingOf).length, billing: billingLook(setupItems) };
}

export type Message =
  /** The Agents tab's Where column switched between folder and full path, remembered for the window (GH-83). */
  | { type: 'agents-where'; view: WhereView };

export const area: ModelArea = {
  commands: [
    'acc.agent.new', 'acc.agent.attach', 'acc.agent.logs', 'acc.agent.stop', 'acc.agents.stopFinished', 'acc.agent.openFolder', 'acc.agent.watch', 'acc.agent.openInClaude',
  ],
  home: {
    order: 20,
    after({ hub, attention, linked, asked }) {
      const folders = sessionFolders(hub);
      for (const s of hub.agents) {
        // A finished session needs nobody, though Claude Code lists it waiting (D-095).
        const look = agentLook(s, null, hub.tieFor?.(s));
        if (!look.needsYou || (s.id && linked.has(s.id)) || (s.sessionId && asked.has(s.sessionId))) continue;
        const key = sessionKey(s);
        // Its folder in context, after its project as the other cards have it; the whole folder on hover (GH-83).
        const p = hub.projectFor(s.cwd);
        const f = folders.get(s.cwd)!;
        attention.push({
          key: `a:${key}`, look: { label: look.label, icon: look.icon, tone: look.tone }, title: nameOf(hub, s), detail: p && f.inProject ? `${p.name} · ${f.inProject}` : f.label, tip: f.full, project: p?.name ?? '',
          actions: [
            // Its conversation in Claude Code when its session id is known; attaching a terminal otherwise.
            ...(s.sessionId ? [{ command: 'acc.agent.openInClaude', label: 'Open in Claude Code', icon: 'comment-discussion', ref: { session: key }, primary: true }]
              : s.id ? [{ command: 'acc.agent.attach', label: 'Attach', icon: 'terminal', ref: { session: key }, primary: true }] : []),
            { command: 'acc.agent.watch', label: 'Watch', icon: 'pulse', ref: { session: key } },
          ],
        });
      }
    },
    stats({ hub }) {
      // An agent waiting on a question reads as busy to Claude Code, but it's waiting on you.
      const working = hub.agents.filter((s) => (s.kind === 'background' ? s.state === 'working' : s.status === 'busy') && !hub.askingFor?.(s)).length;
      return [
      { order: 30, tile: { label: 'Agents working', value: String(working), icon: 'hubot', tone: working ? 'blue' : 'neutral', section: 'agents', hint: 'Sessions busy right now' } },
      ];
    },
    nav({ agents }) {
      const needsAgents = agents.places.reduce((n, pl) => n + pl.agents.filter((a) => a.needsYou).length, 0);
      const sessions = agents.places.reduce((n, pl) => n + pl.agents.length, 0);
      return { section: 'agents', label: 'Agents', icon: 'hubot', count: needsAgents || sessions || null, attention: needsAgents > 0, hint: needsAgents ? `${needsAgents} waiting on you` : `${sessions} session${sessions === 1 ? '' : 's'}` };
    },
  },
  messages: {
    'agents-where': (x) => (WHERE_VIEWS as readonly string[]).includes(x.view as string),
  },
};
