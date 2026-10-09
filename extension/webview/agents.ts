// The Agents section: sessions by repo, then by task (GH-119), and what they bill. How agents run is in Settings (GH-110).

import type { AgentLine, AgentsModel, RepoGroup, TaskGroup, WhereView } from '../src/model/agents.ts';
import { argButton, button, el, empty, header, icon, menuButton, openable, plural, segmented, since, span, status, titled, toolbarButton, withMenu, wrap } from './dom.ts';
import { answerHere } from './progress.ts';
import { api, go, memory, type PageArea, remember, state } from './state.ts';

/** A model's name short enough for a table cell: claude-opus-5-5 is opus-5-5, and a dated snapshot drops its date. */
const shortModel = (m: string): string => m.replace(/^claude-/, '').replace(/-\d{8}(?=\[|$)/, '');

/** How long an agent has run, in a few characters: 4 min, 3 h, 2 days. */
function ran(ms: number): string {
  const m = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

/**
 * A folder or a path that wraps between its words and after each slash, never inside a name or a key, so
 * `ACME-12` never splits at its hyphen (GH-83).
 */
function slashBreaks(text: string): Node[] {
  const out: Node[] = [];
  text.split(' ').forEach((word, w) => {
    if (w) out.push(document.createTextNode(' '));
    word.split('/').forEach((part, i, all) => {
      const last = i === all.length - 1;
      out.push(el('span', 'unbroken', last ? part : `${part}/`));
      if (!last) out.push(document.createElement('wbr'));
    });
  });
  return out;
}

/** Settings' How agents run, by its heading: model/settings.ts's settingsKey('agents'), which a test pins. */
const HOW_AGENTS_RUN = 'settings:agents';
/** Where's views, as Settings names them: model/settings.ts's WHERE_WORDS, in its order, which a test pins. */
const WHERE_WORDS: Record<WhereView, { label: string; icon: string }> = {
  folder: { label: 'Folder', icon: 'folder' },
  path: { label: 'Full path', icon: 'list-tree' },
};
/** Agent, State, Model, Running, and the actions. */
const COLUMNS = 5;

export function renderAgents(m: AgentsModel): Node[] {
  const c = m.counts;
  // How agents run is in Settings now (GH-110): Settings goes to it there.
  const settings = button('Settings', 'settings-gear', () => go('settings', HOW_AGENTS_RUN), 'ghost');
  settings.title = 'Settings: How agents run';
  settings.setAttribute('aria-label', 'Settings: How agents run');
  // Sessions whose work is over (D-095): counted apart from what needs you, and stopped together.
  const stop = m.stopFinished ? toolbarButton('acc.agents.stopFinished', `Stop finished (${m.stopFinished})`, 'debug-stop') : null;
  const summary = m.error ?? (c.sessions ? `${plural(c.sessions, 'session')}: ${c.working} working, ${c.needsYou} need${c.needsYou === 1 ? 's' : ''} you, ${c.finished} finished.` : 'No sessions on this machine.');
  const out: Node[] = [header('Agents', summary, settings, stop, toolbarButton('acc.agent.new', 'Start a background agent', 'add', m.repos.find((r) => r.window === 'this')?.key ?? undefined, true))];
  // Per-token billing shows here as well as in Settings: it costs money while nobody looks (D-036, D-089).
  if (m.billing?.tone === 'orange') out.push(el('div', 'setting-billing', status(m.billing)));
  if (!c.sessions) {
    out.push(empty('No Claude Code sessions are running. Background agents keep working when the terminal closes, and edit in their own worktree.'));
    return out;
  }
  // One table, a heading row for each repo, so the columns line up all the way down.
  const table = el('table', 'grid agents-grid');
  table.append(el('thead', '', el('tr', '', ...[['Agent', 'wide'], ['State', ''], ['Model', 'model'], ['Running', 'ran'], ['', '']].map(([h, cls]) => el('th', cls!, h!)))));
  for (const r of m.repos) table.append(repoBody(r, m.whereView));
  // Where shows only for some agents (GH-119): the toggle only when one does.
  const wheres = m.repos.some((r) => [...r.tasks.flatMap((t) => t.agents), ...r.finished].some((a) => a.where !== null));
  out.push(...(wheres ? [whereBar(m.whereView)] : []), wrap(table));
  return out;
}

/** A repo: its heading, its tasks with their agents, its other sessions, and its finished ones, folded. */
function repoBody(r: RepoGroup, view: WhereView): HTMLElement {
  const body = el('tbody', 'repo');
  const name = titled(el('span', 'repo-name', r.label), r.path);
  if (!r.sessions) {
    // A repo with no agents is one quiet line.
    body.append(el('tr', 'group quiet', span(el('th', '', icon('repo'), name, el('span', 'muted', ' · no agents right now')), COLUMNS)));
    return body;
  }
  const count = el('span', 'count', String(r.sessions));
  count.setAttribute('aria-label', plural(r.sessions, 'session'));
  const elsewhere = r.window === 'other' ? titled(el('span', 'chip window', icon('multiple-windows'), 'another window'), 'Open in another VSCode window') : null;
  body.append(el('tr', 'group', span(el('th', '', icon(r.key === null ? 'folder-library' : 'repo'), name, count, elsewhere), COLUMNS)));
  // Other sessions get a line of their own only beside tasks; alone, the repo's heading says enough.
  const tasks = r.tasks.some((t) => t.key !== null);
  for (const t of r.tasks) {
    if (t.key !== null) body.append(taskRow(t, t.key));
    else if (tasks) body.append(el('tr', 'task others', span(el('td', 'muted', 'Other sessions'), COLUMNS)));
    for (const a of t.agents) body.append(agentRow(a, view));
  }
  if (r.finished.length) {
    const key = `agents-finished:${r.key}`;
    const open = memory().opened.includes(key);
    const toggle = button(`Finished (${r.finished.length})`, open ? 'chevron-down' : 'chevron-right', () => {
      remember((x) => { x.opened = open ? x.opened.filter((y) => y !== key) : [...new Set([...x.opened, key])]; });
      if (state.last) state.draw(state.last);
    }, 'ghost fold-toggle');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.dataset.keep = key;
    toggle.insertBefore(icon('check'), toggle.lastChild);
    // Stop all: this repo's finished background sessions, through the same command as the header's (D-095).
    const stopAll = r.stopFinished && r.key ? titled(argButton('acc.agents.stopFinished', 'Stop all', 'debug-stop', r.key), `Stop ${plural(r.stopFinished, 'finished background session')} here. Transcripts and worktrees are kept.`) : null;
    body.append(el('tr', 'fold', span(el('td', '', el('div', 'fold-line', toggle, stopAll)), COLUMNS)));
    if (open) for (const a of r.finished) body.append(agentRow(a, view));
  }
  return body;
}

/** A task's line: its key and title, opening its page where it has one here. */
function taskRow(t: TaskGroup, key: string): HTMLElement {
  const k = el('span', 'tcard-key', key);
  const line = el('div', 'task-line', k, t.title ? titled(el('span', 'task-title', t.title), t.title) : null);
  const cell = el('td', '', line);
  if (t.project) openable(line, { type: 'run', command: 'acc.task.show', ref: { project: t.project, task: key } }).title = `Open ${key}'s page`;
  return el('tr', 'task', span(cell, COLUMNS));
}

/**
 * An agent's line: its role, or an untied session's name; interactive or background as an icon; where it
 * runs when that isn't its task's own worktree; its state; its model; how long it has run; and its menu,
 * with Answer, Watch and Open in Claude Code beside it while it needs you.
 */
function agentRow(a: AgentLine, view: WhereView): HTMLElement {
  const kind = icon(a.background ? 'server-process' : 'terminal');
  const word = a.background ? 'Background session' : 'Interactive session';
  kind.removeAttribute('aria-hidden');
  kind.setAttribute('role', 'img');
  kind.setAttribute('aria-label', word);
  kind.title = word;
  kind.classList.add('kind');
  // A finished agent has no task line above it, so its line names its task (D-095).
  const said = a.finished && a.task
    ? el('span', 'agent-label', el('span', 'tcard-key', a.task.key), a.task.title ? el('span', 'task-title', a.task.title) : null, el('span', 'role', `· ${a.label}`))
    : el('span', 'agent-label', a.task ? el('span', 'role', a.label) : el('span', 'session-name', ...slashBreaks(a.label)));
  // Its whole name on hover, its model where a narrow tab has no room for that column, and its whole folder.
  said.title = [a.name, a.model && a.effort ? `${a.model}, ${a.effort} effort` : a.model, a.path].filter(Boolean).join('\n');
  openable(said, { type: 'run', command: 'acc.agent.watch', ref: { session: a.key } });
  // Where, only when it isn't its task's own worktree: its folder, or its full path, with the full path on hover (D-090).
  const where = a.where === null ? null : view === 'path'
    ? el('span', 'where mono', icon('folder'), el('span', 'where-text', ...slashBreaks(a.path)))
    : el('span', 'where', icon('folder'), el('span', 'where-text', ...slashBreaks(a.where)));
  if (where) where.title = a.path;
  // Its icon stays beside its name; Where wraps below them when there's no room beside.
  const who = el('td', 'agent', el('div', 'agent-cell', el('span', 'who', kind, said), where));
  // A finished agent's state is its fold's heading: its name takes the State column too.
  const cells = a.finished ? [span(who, 2)] : [who, el('td', 'state', status(a.look))];
  const row = el('tr', `agent${a.needsYou ? ' attention' : ''}${a.finished ? ' finished' : ''}`, ...cells,
    // The model it runs with (D-086), short, with its full name on hover; a dash until it's known. A builder's
    // effort beside it when it isn't the model's default (D-128).
    Object.assign(el('td', 'nowrap mono muted model', a.model ? shortModel(a.model) : '—', a.model && a.effort ? ` · ${a.effort}` : ''), { title: a.model ? `${a.model}${a.effort ? `, ${a.effort} effort` : ''}` : 'Not known until it first answers' }),
    Object.assign(el('td', 'nowrap muted ran', ran(a.startedAt)), { title: `Started ${since(a.startedAt)}` }),
    el('td', 'actions', ...(a.needsYou ? needsYouButtons(a) : []), menuButton(a.name)));
  return withMenu(row, 'agent', { session: a.key }, { agentBackground: a.background });
}

/** What an agent that needs you offers on its line: Answer, Watch, and Open in Claude Code (or Attach). */
function needsYouButtons(a: AgentLine): HTMLElement[] {
  const b = (label: string, iconName: string, tip: string, onClick: () => void, cls: string) => {
    const x = button(label, iconName, onClick, `small line-btn ${cls}`);
    // Its words stay its name when a narrow tab shows only its icon.
    x.lastChild!.replaceWith(el('span', 'btn-text', label));
    x.title = tip;
    x.setAttribute('aria-label', label);
    return x;
  };
  const run = (command: string) => () => api.postMessage({ type: 'run', command, ref: { session: a.key } });
  return [
    // Its question's card, in Needs you on the Overview, as In progress's Answer finds it (GH-76).
    ...(a.question ? [b('Answer', 'bell', 'Go to its question in Needs you, on the Overview, and answer it there', () => { go('overview'); answerHere(a.question!); }, 'primary')] : []),
    b('Watch', 'pulse', 'Follow what it does, step by step, on its page', run('acc.agent.watch'), 'ghost'),
    ...(a.conversation ? [b('Open in Claude Code', 'comment-discussion', 'Open its conversation in a Claude Code tab', run('acc.agent.openInClaude'), 'ghost')]
      : a.background ? [b('Attach', 'terminal', 'Attach a terminal to it', run('acc.agent.attach'), 'ghost')] : []),
  ];
}

/**
 * What an agent's Where shows, Folder or Full path (GH-83), above the table, on the right: in a heading it
 * would widen a column, so a narrow tab would scroll it out of view. The page switches at once, and the
 * extension remembers the choice for the window.
 */
function whereBar(view: WhereView): HTMLElement {
  const pick = segmented('Where shows', (Object.keys(WHERE_WORDS) as WhereView[]).map((w) => ({ key: w, ...WHERE_WORDS[w], on: view === w })), (key) => {
    const v = key as WhereView;
    if (state.last?.kind === 'home') state.last = { ...state.last, agents: { ...state.last.agents, whereView: v } };
    else if (state.last?.kind === 'agents') state.last = { ...state.last, whereView: v };
    if (state.last) state.draw(state.last);
    api.postMessage({ type: 'agents-where', view: v });
  });
  pick.classList.add('where-view');
  pick.querySelectorAll('button').forEach((b, i) => { b.dataset.keep = `where-view:${i}`; });
  return el('div', 'where-bar', el('span', 'where-label', 'Where shows'), pick);
}

export const area: PageArea = {
  sections: { agents: { draw: (m) => renderAgents(m.agents) } },
  views: { agents: renderAgents },
};
