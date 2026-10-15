/**
 * The Agents section: sessions by repo, then by task (GH-119), and what they bill. How agents run is in Settings (GH-110).
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { sessionsOf, type SessionTie } from '../../../packages/core/src/ledger.ts';
import { agentLook, finishedSession, ownsSession, stopFinishedPlan } from '../logic/agents.ts';
import { effortShown } from '../logic/efforts.ts';
import { type AgentSession, isUnder, tildePath } from '../logic/shared.ts';
import type { DoctorItem } from '../logic/setup.ts';
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
  /**
   * The repo it's in, by the same rule (GH-119): a project open here, by its config's name; else its repo's
   * folder, named as its label names it. Null outside any repo.
   */
  repo: { path: string; name: string; project: boolean } | null;
  /** The label without its repo: `main checkout`, `worktree ACME-12`, `force-app/main`; outside any repo, the label. */
  inRepo: string;
  /** The worktree it's in, by its folder's name (`ACME-12`), and the folder inside it, if any (`force-app`). */
  worktree: { name: string; rest: string } | null;
}

type Tree = { name: string; rest: string } | null;

const lastPart = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;
const inWorktree = (id: string, rest = ''): string => [`worktree ${id}`, rest].filter(Boolean).join(' › ');
/** A place in a repo in words: a worktree and the folder inside it, else the folder inside the repo, else its main checkout. */
const placeWords = (tree: Tree, rest: string): string => (tree ? inWorktree(tree.name, tree.rest) : rest || 'main checkout');

/** Where in a project a folder is: a worktree, by its folder's name, and the rest of the path inside it or the project. */
function placeIn(p: ProjectLike, path: string): { tree: Tree; rest: string } {
  const within = (root: string) => path.slice(root.length + 1);
  const tree = p.worktrees.filter((w) => !w.main && isUnder(path, w.path)).sort((a, b) => b.path.length - a.path.length)[0];
  if (tree) return { tree: { name: lastPart(tree.path), rest: within(tree.path) }, rest: '' };
  if (!isUnder(path, p.root)) return { tree: null, rest: lastPart(path) };
  const wt = /^\.claude\/worktrees\/([^/]+)(?:\/(.+))?$/.exec(within(p.root));
  return wt ? { tree: { name: wt[1]!, rest: wt[2] ?? '' }, rest: '' } : { tree: null, rest: within(p.root) };
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
 * The same rule gives each session the repo the Agents page groups it under (GH-119).
 */
export function sessionFolders(hub: HubLike, extra: string[] = []): Map<string, SessionFolder> {
  const home = hub.home;
  const out = new Map<string, SessionFolder>();
  // Elsewhere: the folder that names it (its repo, or itself), and what follows it.
  const drafts: { cwd: string; full: string; base: string; repo: boolean; tree: Tree; rest: string }[] = [];
  for (const cwd of new Set([...hub.agents.map((s) => s.cwd), ...extra])) {
    const path = cwd.length > 1 ? cwd.replace(/\/+$/, '') : cwd;
    const full = tildePath(path, home);
    const p = hub.projectFor(path);
    if (p) {
      const place = placeIn(p, path);
      const inProject = placeWords(place.tree, place.rest);
      out.set(cwd, { full, label: `${p.name} › ${inProject}`, inProject, repo: { path: p.root, name: p.name, project: true }, inRepo: inProject, worktree: place.tree });
      continue;
    }
    const wt = /^(.+)\/\.claude\/worktrees\/([^/]+)(?:\/(.+))?$/.exec(path);
    const found = wt ? null : hub.repoFor?.(path) ?? null;
    const repo = wt ? wt[1]! : found && isUnder(path, found) ? found : null;
    const tree = wt ? { name: wt[2]!, rest: wt[3] ?? '' } : null;
    drafts.push({ cwd, full, base: repo ?? path, repo: !!repo, tree, rest: !wt && repo && repo !== path ? path.slice(repo.length + 1) : '' });
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
  for (const d of drafts) {
    const label = [named(d.base), d.tree ? inWorktree(d.tree.name, d.tree.rest) : d.rest].filter(Boolean).join(' › ');
    out.set(d.cwd, { full: d.full, label, inProject: null, repo: d.repo ? { path: d.base, name: named(d.base), project: false } : null, inRepo: d.repo ? placeWords(d.tree, d.rest) : label, worktree: d.tree });
  }
  return out;
}

/** What an agent's Where shows: its folder in context, or its full path (GH-83). */
export const WHERE_VIEWS = ['folder', 'path'] as const;
export type WhereView = (typeof WHERE_VIEWS)[number];

/** One agent's line under its task (GH-119). */
export interface AgentLine {
  key: string;
  /** Background sessions can be attached to, logged and stopped from here; interactive ones can't. */
  background: boolean;
  /** Interactive or background: an icon, with its word on hover. */
  kind: string;
  /** Its whole name (D-087): its line's hover, and its menu's label. */
  name: string;
  /**
   * What its line calls it: its role on its task, builder, builder 2, review or analysis (D-087), since its
   * task's line names the task and its repo's heading the project. A session tied to no task, by its own name.
   */
  label: string;
  /** Its task: what a line no task line heads names, as a finished session's does, in its repo's Finished. */
  task: { key: string; title: string | null } | null;
  look: Look;
  needsYou: boolean;
  /** Its work is over (D-095): its task is done or has a later run, or its review or analysis is recorded. */
  finished: boolean;
  /** Busy at its work, for the header's count. */
  working: boolean;
  /**
   * Where it runs, only when that isn't its task's own worktree: `main checkout`, `force-app/main`, the
   * folder inside its worktree, or an untied session's folder. Null in its task's own worktree (GH-119).
   */
  where: string | null;
  /** Its whole folder, with ~ for the home folder: the Full path view, and the hover on its Where. */
  path: string;
  startedAt: number;
  /** The model it runs with (D-086), or null when that isn't known yet. */
  model: string | null;
  /** A builder's effort, beside its model, only when one was named and isn't the model's default (D-128). */
  effort: string | null;
  /** A question it waits on in the Command Center (D-030), which Answer goes to. */
  question: string | null;
  /** Whether Open in Claude Code can open its conversation: Claude Code gave it a session id (D-040). */
  conversation: boolean;
}

/** A task, with its agents beneath it. A key of null is the repo's other sessions: those tied to no task. */
export interface TaskGroup {
  key: string | null;
  title: string | null;
  /** The project open here whose page for the task its line opens; null for a task elsewhere, with no page here. */
  project: string | null;
  needsYou: boolean;
  agents: AgentLine[];
}

/** A repo and its agents, by task (GH-119). */
export interface RepoGroup {
  /** A project's root here, a repo's folder elsewhere; null for Other folders, the sessions in no repo. */
  key: string | null;
  label: string;
  /** Its folder, with ~ for home: its heading's hover. */
  path: string | null;
  /** Open in this window, in another window, or neither, as far as acc can tell. */
  window: 'this' | 'other' | null;
  sessions: number;
  needsYou: number;
  /** Its tasks, those with an agent that needs you first, then its other sessions; never a finished session. */
  tasks: TaskGroup[];
  /** Its sessions whose work is over (D-095), newest first: one Finished group, closed by default. */
  finished: AgentLine[];
  /** How many of them Stop finished would stop: background sessions Claude Code still holds (D-095). */
  stopFinished: number;
}

export interface AgentsModel {
  kind: 'agents';
  error: string | null;
  /** This window's projects, then every other repo on the machine by name, then Other folders (GH-119). */
  repos: RepoGroup[];
  /** The header's summary: every session, and how many are working, need you, and finished. */
  counts: { sessions: number; working: number; needsYou: number; finished: number };
  /** What Where shows, remembered for the window (GH-83). */
  whereView: WhereView;
  /** How many finished background sessions Stop finished would stop (D-095). */
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

/** A role as its line says it (D-087): builder, builder 2, review or analysis. */
function roleWords(role: SessionTie['role'], n: number | undefined, name: string): string {
  if (role !== 'builder') return role;
  // A run that recorded no count may still be named for it.
  const named = / · builder (\d+)$/.exec(name)?.[1];
  const count = n ?? (named ? Number(named) : undefined);
  return count && count > 1 ? `builder ${count}` : 'builder';
}

/**
 * The Agents page (GH-119): each repo a heading, this window's projects first, then every other repo on the
 * machine by name, then Other folders. Under each, its tasks, each with its agents beneath it, and its
 * finished sessions folded away. No line says what a heading above it says: an agent goes by its role, and
 * its Where shows only when it isn't in its task's own worktree.
 */
export function agentsModel(hub: HubLike, setupItems: DoctorItem[] = [], whereView: WhereView = 'folder'): AgentsModel {
  const tieOf = (s: AgentSession) => hub.tieFor?.(s) ?? null;
  const askingOf = (s: AgentSession) => hub.askingFor?.(s) ?? null;
  const folders = sessionFolders(hub);
  const lineFor = (s: AgentSession) => {
    const tie = tieOf(s);
    const look = agentLook(s, askingOf(s), tie);
    const f = folders.get(s.cwd)!;
    const p = hub.projectFor(s.cwd);
    const rows = p ? hub.taskRows(p.root) : [];
    // Its task by the ledger (D-095); with no tie, the task whose agent acc calls it (D-087).
    const row = tie ? rows.find((r) => r.id === tie.task) : rows.find((r) => ownsSession(r, s));
    const task = tie?.task ?? row?.id ?? null;
    const name = nameOf(hub, s);
    const sid = s.sessionId;
    const role = tie?.role ?? (sid && row?.reviewing?.sessionId === sid ? 'review' : sid && row?.analyzing?.sessionId === sid ? 'analysis' : 'builder');
    const label = task ? roleWords(role, tie?.n, name) : name;
    // In its task's own worktree, Where would only say the task again: it shows the folder inside it, if any.
    const ownTree = !!task && f.worktree?.name.toUpperCase() === task.toUpperCase();
    const own = ownTree || (!!task && !!row?.run?.worktree && isUnder(s.cwd, row.run.worktree));
    const place = own ? (ownTree ? f.worktree!.rest : '') || null : f.inRepo;
    const title = row?.title ?? tie?.title ?? null;
    const model = hub.modelFor?.(s) ?? null;
    // The effort its task's run started its builder with: a review or analysis runs with the reviewer's own.
    const effort = role === 'builder' && row && sessionsOf(row, [s]).length ? effortShown(model, row.run?.effort) : null;
    const line: AgentLine = {
      key: sessionKey(s), background: !!s.id, kind: s.kind, name, label, task: task ? { key: task, title } : null,
      look: { label: look.label, icon: look.icon, tone: look.tone }, needsYou: look.needsYou, finished: finishedSession(s, tie, askingOf(s)), working: !!look.working,
      // A session named for its folder, as Claude Code names some, doesn't say it twice.
      where: place === label || place === `worktree ${label}` ? null : place,
      path: f.full, startedAt: s.startedAt, model, effort,
      question: sid ? hub.questions?.find((q) => q.sessionId === sid)?.id ?? null : null, conversation: !!sid,
    };
    return { line, task, title, project: p && row ? p.root : null };
  };
  const newest = (a: { startedAt: number }, b: { startedAt: number }) => b.startedAt - a.startedAt;
  // A task's newest agent, whichever sorts first under it.
  const latest = (t: { agents: AgentLine[] }) => Math.max(...t.agents.map((x) => x.startedAt));
  const needsFirst = (a: AgentLine, b: AgentLine) => Number(b.needsYou) - Number(a.needsYou) || newest(a, b);
  // A window that shows the repo, or a folder or worktree in it, has it open (D-030's listener files).
  const elsewhereOpen = (path: string) => (hub.otherWindows ?? []).some((r) => isUnder(r, path));
  const group = (key: string | null, label: string, path: string | null, window: RepoGroup['window']): RepoGroup => ({ key, label, path, window, sessions: 0, needsYou: 0, tasks: [], finished: [], stopFinished: 0 });
  const repos = new Map<string | null, RepoGroup>(hub.projects.map((p) => [p.root, group(p.root, p.name, tildePath(p.root, hub.home), 'this')]));
  const stoppable = new Set(stopFinishedPlan(hub.agents, tieOf, askingOf));
  for (const s of hub.agents) {
    const r = folders.get(s.cwd)!.repo;
    const key = r?.path ?? null;
    let repo = repos.get(key);
    if (!repo) repos.set(key, repo = r ? group(key, r.name, tildePath(r.path, hub.home), elsewhereOpen(r.path) ? 'other' : null) : group(null, 'Other folders', null, null));
    const { line, task, title, project } = lineFor(s);
    repo.sessions++;
    if (line.needsYou) repo.needsYou++;
    if (stoppable.has(s)) repo.stopFinished++;
    if (line.finished) { repo.finished.push(line); continue; }
    let t = repo.tasks.find((x) => x.key === task);
    if (!t) repo.tasks.push(t = { key: task, title, project, needsYou: false, agents: [] });
    t.agents.push(line);
    t.needsYou ||= line.needsYou;
  }
  const here = hub.projects.map((p) => repos.get(p.root)!);
  const others = [...repos.values()].filter((r) => r.window !== 'this' && r.key !== null).sort((a, b) => a.label.localeCompare(b.label));
  const loose = repos.get(null);
  const all = [...here, ...others, ...(loose ? [loose] : [])];
  for (const r of all) {
    for (const t of r.tasks) t.agents.sort(needsFirst);
    // Needs you first; then tasks before the sessions tied to none; then the newest agent first.
    r.tasks.sort((a, b) => Number(b.needsYou) - Number(a.needsYou) || Number(a.key === null) - Number(b.key === null) || latest(b) - latest(a));
    r.finished.sort(newest);
  }
  const lines = all.flatMap((r) => [...r.tasks.flatMap((t) => t.agents), ...r.finished]);
  const counts = { sessions: lines.length, working: lines.filter((a) => a.working).length, needsYou: lines.filter((a) => a.needsYou).length, finished: lines.filter((a) => a.finished).length };
  return { kind: 'agents', error: hub.agentsError, repos: all, counts, whereView, stopFinished: stoppable.size, billing: billingLook(setupItems) };
}

export type Message =
  /** An agent's Where switched between folder and full path, remembered for the window (GH-83). */
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
          // Its ⋯ menu on the Overview is the one its row has on Agents (GH-160).
          menu: { section: 'agent', ref: { session: key }, flags: { agentBackground: s.kind === 'background' } },
        });
      }
    },
    nav({ agents }) {
      const needsAgents = agents.counts.needsYou;
      const sessions = agents.counts.sessions;
      return { section: 'agents', label: 'Agents', icon: 'hubot', count: needsAgents || sessions || null, attention: needsAgents > 0, hint: needsAgents ? `${needsAgents} waiting on you` : `${sessions} session${sessions === 1 ? '' : 's'}` };
    },
  },
  messages: {
    'agents-where': (x) => (WHERE_VIEWS as readonly string[]).includes(x.view as string),
  },
};
