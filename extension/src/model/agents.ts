/**
 * The Agents section: sessions by where they run, and how agents run.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { autopilotDoes } from '../../../packages/core/src/autopilot.ts';
import { autoMergeOn } from '../../../packages/core/src/config.ts';
import { agentLook, finishedSession, FROM_WORDS, stopFinishedPlan } from '../logic/agents.ts';
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

export interface AgentSetting {
  role: 'builder' | 'reviewer';
  label: string;
  icon: string;
  /** Each part in words, with where it's set. */
  parts: { name: string; value: string; from: string }[];
}

/** What autopilot may do on its own in a project (D-055), as the Agents section shows it. */
export interface AutonomySetting {
  value: string;
  from: string;
  /** What that level means, in words. */
  meaning: string;
}

/** Whether autopilot merges pull requests in a project (GH-67), as the Agents section shows it. */
export interface AutoMergeSetting {
  value: 'on' | 'off';
  from: string;
  meaning: string;
  /** Whether a person can change it here: a Salesforce project never auto-merges. */
  settable: boolean;
}

/** The key under which the Agents page remembers How agents run is open; the webview keeps the same. */
export const AGENT_SETTINGS = 'agents:settings';

export interface AgentsModel {
  kind: 'agents';
  error: string | null;
  places: { label: string; root: string | null; agents: AgentRow[] }[];
  /** What the Where column shows, remembered for the window (GH-83). */
  whereView: WhereView;
  /** How many finished background sessions Stop finished sessions would stop (D-095). */
  stopFinished: number;
  /** Each project's agent settings, what autopilot may do there, whether it merges, and what its agents bill (D-036). */
  settings: { root: string; project: string; roles: AgentSetting[]; autonomy: AutonomySetting | null; autoMerge: AutoMergeSetting | null; billing: Look | null }[];
}

/** The project's autonomy, set in .acc/config.json and changed through acc (D-064). Review says whether autopilot merges (GH-67). */
export function autonomySetting(p: ProjectLike): AutonomySetting | null {
  const value = p.config.autonomy;
  const meaning: Record<string, string> = {
    manual: 'Nothing happens on its own.',
    review: `Autopilot ${autopilotDoes(autoMergeOn(p.config))}`,
    dispatch: 'Not built yet: autopilot refuses.',
    full: 'Not built yet: autopilot refuses.',
  };
  return value ? { value, from: 'project', meaning: meaning[value] ?? '' } : null;
}

/** Whether autopilot merges a reviewed, green pull request (GH-67), set in .acc/config.json and changed through acc. */
export function autoMergeSetting(p: ProjectLike): AutoMergeSetting | null {
  if (!p.config.autonomy) return null;
  if (p.config.profile === 'salesforce') return { value: 'off', from: 'project', meaning: 'A Salesforce project never auto-merges: a person merges every pull request.', settable: false };
  if (!autoMergeOn(p.config)) return { value: 'off', from: 'project', meaning: 'Autopilot never merges a pull request: a person merges each one.', settable: true };
  const kept = p.config.environments.filter((e) => e.protected).map((e) => e.name);
  const meaning = [
    'A pull request whose review and checks passed, with nothing waiting on you, joins the merge queue, and they merge in turn: its base merged in, the full check run once, then merged once GitHub says it can.',
    kept.length ? `Never into ${kept.join(', ')}: protected.` : '',
    p.config.autonomy === 'review' ? '' : 'Autonomy is manual, so nothing merges on its own.',
  ].filter(Boolean).join(' ');
  return { value: 'on', from: 'project', meaning, settable: true };
}

export function agentSettings(p: ProjectLike): AgentSetting[] {
  if (!p.agents) return [];
  const role = (r: 'builder' | 'reviewer'): AgentSetting => {
    const v = p.agents![r];
    return {
      role: r, label: r === 'builder' ? 'Builders' : 'Reviewers', icon: r === 'builder' ? 'tools' : 'checklist',
      parts: [
        { name: 'Model', value: v.model ?? 'default', from: FROM_WORDS[v.from.model] ?? v.from.model },
        { name: 'Effort', value: v.effort ?? 'default', from: FROM_WORDS[v.from.effort] ?? v.from.effort },
        ...(v.fallbackModel ? [{ name: 'Falls back to', value: v.fallbackModel, from: FROM_WORDS[v.from.fallbackModel] ?? v.from.fallbackModel }] : []),
      ],
    };
  };
  return [role('builder'), role('reviewer')];
}

/** What the billing check says, as a line in the Agents settings. Null until that check has run. */
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
  const billing = billingLook(setupItems);
  const settings = hub.projects.filter((p) => p.agents).map((p) => ({ root: p.root, project: p.name, roles: agentSettings(p), autonomy: autonomySetting(p), autoMerge: autoMergeSetting(p), billing }));
  return { kind: 'agents', error: hub.agentsError, places, whereView, stopFinished: stopFinishedPlan(hub.agents, tieOf, askingOf).length, settings };
}

export type Message =
  /** The Agents tab's Where column switched between folder and full path, remembered for the window (GH-83). */
  | { type: 'agents-where'; view: WhereView };

export const area: ModelArea = {
  commands: [
    'acc.agent.new', 'acc.agent.attach', 'acc.agent.logs', 'acc.agent.stop', 'acc.agents.stopFinished', 'acc.agent.openFolder', 'acc.agent.watch', 'acc.agent.openInClaude', 'acc.agents.configure', 'acc.agents.autonomy', 'acc.agents.autoMerge',
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
