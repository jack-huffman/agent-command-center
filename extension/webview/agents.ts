// The Agents section: sessions by repo, each agent a card that says what it's doing (T-164), and what they bill. How agents run is in Settings (GH-110).

import type { AgentLine, AgentsModel, RepoGroup, TaskGroup, WhereView } from '../src/model/agents.ts';
import { argButton, button, el, empty, icon, menuButton, openable, pageHeader, plural, refreshButton, segmented, since, status, titled, toolbarButton, withMenu } from './dom.ts';
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
export function renderAgents(m: AgentsModel): Node[] {
  const c = m.counts;
  // How agents run is in Settings now (GH-110): Settings goes to it there.
  const settings = button('Settings', 'settings-gear', () => go('settings', HOW_AGENTS_RUN), 'ghost');
  settings.title = 'Settings: How agents run';
  settings.setAttribute('aria-label', 'Settings: How agents run');
  // Sessions whose work is over (D-095): counted apart from what needs you, and stopped together.
  const stop = m.stopFinished ? toolbarButton('acc.agents.stopFinished', `Stop finished (${m.stopFinished})`, 'debug-stop') : null;
  const summary = m.error ?? (c.sessions ? `${plural(c.sessions, 'session')}: ${c.working} working, ${c.needsYou} need${c.needsYou === 1 ? 's' : ''} you, ${c.finished} finished.` : 'No sessions on this machine.');
  // The page's own actions first, outlined as nothing here needs you (T-39); Settings goes last, as it leaves the page.
  const start = toolbarButton('acc.agent.new', 'Start a background agent', 'add', m.repos.find((r) => r.window === 'this')?.key ?? undefined);
  const out: Node[] = [pageHeader('Agents', summary, stop, start, refreshButton(), settings)];
  // Per-token billing shows here as well as in Settings: it costs money while nobody looks (D-036, D-089).
  if (m.billing?.tone === 'orange') out.push(el('div', 'setting-billing', status(m.billing)));
  if (!c.sessions) {
    out.push(empty('No Claude Code sessions are running. Background agents keep working when the terminal closes, and edit in their own worktree.'));
    return out;
  }
  // Where shows only for some agents (GH-119): the toggle only when one does.
  const wheres = m.repos.some((r) => [...r.tasks.flatMap((t) => t.agents), ...r.finished].some((a) => a.where !== null));
  out.push(...(wheres ? [whereBar(m.whereView)] : []), ...m.repos.map((r) => repoSection(r, m.whereView)));
  return out;
}

/**
 * A repo (T-164): its name and count, a quiet heading on the page's own background, then a card for each
 * agent, its other sessions, and its finished ones, folded.
 */
function repoSection(r: RepoGroup, view: WhereView): HTMLElement {
  const name = titled(el('span', 'repo-name', r.label), r.path);
  if (!r.sessions) {
    // A repo with no agents is one quiet line.
    return el('section', 'agent-repo quiet', el('h2', 'agent-repo-head', icon('repo'), name, el('span', 'muted', ' · no agents right now')));
  }
  const count = el('span', 'count', String(r.sessions));
  count.setAttribute('aria-label', plural(r.sessions, 'session'));
  const elsewhere = r.window === 'other' ? titled(el('span', 'chip window', icon('multiple-windows'), 'another window'), 'Open in another VSCode window') : null;
  const section = el('section', 'agent-repo', el('h2', 'agent-repo-head', icon(r.key === null ? 'folder-library' : 'repo'), name, count, elsewhere));
  const mine = r.tasks.filter((t) => t.key !== null);
  if (mine.length) section.append(cards(mine.flatMap((t) => t.agents.map((a) => agentCard(a, view, t)))));
  for (const t of r.tasks.filter((x) => x.key === null)) {
    // Other sessions get a heading of their own only beside tasks; alone, the repo's heading says enough.
    if (mine.length) section.append(el('h3', 'agent-others', 'Other sessions'));
    section.append(cards(t.agents.map((a) => agentCard(a, view, null))));
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
    // This repo's finished background sessions, through the same command as the header's, by the same name (D-095, T-39).
    const stopAll = r.stopFinished && r.key ? titled(argButton('acc.agents.stopFinished', 'Stop finished', 'debug-stop', r.key), `Stop ${plural(r.stopFinished, 'finished background session')} here. Transcripts and worktrees are kept.`) : null;
    section.append(el('div', 'fold-line', toggle, stopAll));
    if (open) section.append(cards(r.finished.map((a) => agentCard(a, view, null))));
  }
  return section;
}

/** Cards in a list, with space between them. */
const cards = (items: HTMLElement[]): HTMLElement => el('ul', 'agent-cards', ...items);

/**
 * An agent's card (T-164). Its first line is its task's key and title, opening the task's page where it has one
 * here; a session tied to no task goes by its own name. Its second line says what it's doing (Building, Testing),
 * then its role with interactive or background as an icon, its model and how long it has run. Its menu sits on
 * the right, with Answer, Watch and Open in Claude Code while it needs you. Where it runs goes under them, when
 * that isn't its task's own worktree. A finished agent's fold says Finished, so its card says no state.
 */
function agentCard(a: AgentLine, view: WhereView, t: TaskGroup | null): HTMLElement {
  const kind = icon(a.background ? 'server-process' : 'terminal');
  const word = a.background ? 'Background session' : 'Interactive session';
  kind.removeAttribute('aria-hidden');
  kind.setAttribute('role', 'img');
  kind.setAttribute('aria-label', word);
  kind.title = word;
  kind.classList.add('kind');
  // A finished agent has no task heading its fold, so its card names its task from its line (D-095).
  const task = t?.key ? { key: t.key, title: t.title } : a.task;
  // Its whole name on hover, its model and effort, and its whole folder.
  const tip = [a.name, a.model && a.effort ? `${a.model}, ${a.effort} effort` : a.model, a.path].filter(Boolean).join('\n');
  const head = task
    ? el('div', 'agent-task', el('span', 'tcard-key', task.key), task.title ? titled(el('span', 'task-title', task.title), task.title) : null)
    : el('div', 'agent-task', kind, el('span', 'session-name', ...slashBreaks(a.label)));
  if (task && t?.project) openable(head, { type: 'run', command: 'acc.task.show', ref: { project: t.project, task: task.key } }).title = `Open ${task.key}'s page`;
  // Its role, or for a session tied to no task its kind, opens its page, step by step (D-030).
  const who = titled(el('span', 'role', task ? a.label : word.toLowerCase()), tip);
  openable(who, { type: 'run', command: 'acc.agent.watch', ref: { session: a.key } });
  const facts = el('div', 'agent-facts',
    a.finished ? null : el('span', 'agent-doing', status(a.look)),
    el('span', 'who', task ? kind : null, who),
    // The model it runs with (D-086), short, with its full name on hover; a dash until it's known. A builder's
    // effort beside it when it isn't the model's default (D-128).
    Object.assign(el('span', 'mono muted model', el('span', 'unbroken', a.model ? shortModel(a.model) : '—'), a.model && a.effort ? ' ' : null, a.model && a.effort ? el('span', 'unbroken', `· ${a.effort}`) : null), { title: a.model ? `${a.model}${a.effort ? `, ${a.effort} effort` : ''}` : 'Not known until it first answers' }),
    Object.assign(el('span', 'nowrap muted ran', ran(a.startedAt)), { title: `Started ${since(a.startedAt)}` }));
  // Where, only when it isn't its task's own worktree: its folder, or its full path, with the full path on hover (D-090).
  const where = a.where === null ? null : view === 'path'
    ? el('div', 'where mono', icon('folder'), el('span', 'where-text', ...slashBreaks(a.path)))
    : el('div', 'where', icon('folder'), el('span', 'where-text', ...slashBreaks(a.where)));
  if (where) where.title = a.path;
  const actions = el('div', 'agent-actions', ...(a.needsYou ? needsYouButtons(a) : []), menuButton(a.name));
  const row = el('li', `agent-card${a.needsYou ? ' attention' : ''}${a.finished ? ' finished' : ''}`, el('div', 'agent-main', head, facts, where), actions);
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
 * What an agent's Where shows, Folder or Full path (GH-83), above the cards, on the right. The page switches
 * at once, and the extension remembers the choice for the window.
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
