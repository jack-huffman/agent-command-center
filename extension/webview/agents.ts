// The Agents section: sessions by where they run, and how agents run.

import type { AgentsModel, WhereView } from '../src/model/agents.ts';
import { argButton, button, el, empty, header, icon, menuButton, openable, plural, segmented, since, span, status, titled, toolbarButton, withMenu, wrap } from './dom.ts';
import { api, memory, type PageArea, remember, state, view } from './state.ts';

/** A model's name short enough for a table cell: claude-opus-5-5 is opus-5-5, and a dated snapshot drops its date. */
const shortModel = (m: string): string => m.replace(/^claude-/, '').replace(/-\d{8}(?=\[|$)/, '');

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

/** Where the Agents page remembers How agents run is open: model.ts's AGENT_SETTINGS, which the extension opens. */
const AGENT_SETTINGS = 'agents:settings';

export function renderAgents(m: AgentsModel): Node[] {
  const all = m.places.flatMap((p) => p.agents);
  const needs = all.filter((a) => a.needsYou).length;
  // Sessions whose work is over (D-095): counted apart from what needs you, and stopped together.
  const finished = all.filter((a) => a.finished).length;
  // How agents run is behind Settings, closed until you open it, and remembered for the tab.
  const open = memory().opened.includes(AGENT_SETTINGS);
  const settings = m.settings.length ? button(open ? 'Hide settings' : 'Settings', 'settings-gear', () => {
    remember((x) => { x.opened = open ? x.opened.filter((y) => y !== AGENT_SETTINGS) : [...x.opened, AGENT_SETTINGS]; });
    if (state.last) state.draw(state.last);
  }, 'ghost') : null;
  settings?.setAttribute('aria-expanded', String(open));
  const stop = m.stopFinished ? toolbarButton('acc.agents.stopFinished', `Stop finished sessions (${m.stopFinished})`, 'debug-stop') : null;
  const out: Node[] = [header('Agents', m.error ?? `${plural(all.length, 'session')} on this machine${needs ? `, ${needs} need${needs === 1 ? 's' : ''} you` : ''}${finished ? `, ${finished} finished` : ''}.`, settings, stop, toolbarButton('acc.agent.new', 'Start a background agent', 'add', m.places.find((p) => p.root)?.root ?? undefined, true))];
  // Closed, a billing problem still shows: per-token billing costs money while you're not looking (D-036).
  if (!open) for (const s of m.settings) if (s.billing?.tone === 'orange') out.push(el('div', 'setting-billing', status(s.billing)));
  // What builders and reviewers run with, and what they bill (D-036).
  for (const s of open ? m.settings : []) {
    const box = el('section', 'agent-settings', el('h2', '', icon('settings-gear'), m.settings.length > 1 ? `How agents run · ${s.project}` : 'How agents run'));
    for (const r of s.roles) {
      box.append(el('div', 'setting-row',
        el('span', 'setting-name', icon(r.icon), el('span', 'strong', r.label)),
        el('span', 'setting-parts', ...r.parts.map((p) => el('span', 'setting-part', el('span', 'muted', `${p.name} `), el('span', 'mono strong', p.value), el('span', 'muted small', ` · ${p.from}`)))),
        argButton('acc.agents.configure', 'Change…', 'edit', `${r.role}|${s.root}`)));
    }
    // What autopilot may do on its own (D-055), set for the project through acc (D-064).
    if (s.autonomy) {
      box.append(el('div', 'setting-row',
        el('span', 'setting-name', icon('rocket'), el('span', 'strong', 'Autonomy')),
        el('span', 'setting-parts', el('span', 'setting-part', el('span', 'mono strong', s.autonomy.value), el('span', 'muted small', ` · ${s.autonomy.from}`)),
          s.autonomy.meaning ? el('span', 'setting-meaning muted small', s.autonomy.meaning) : null),
        argButton('acc.agents.autonomy', 'Change…', 'edit', s.root)));
    }
    // Whether autopilot merges a reviewed, green pull request (GH-67), set for the project through acc.
    if (s.autoMerge) {
      box.append(el('div', 'setting-row',
        el('span', 'setting-name', icon(s.autoMerge.value === 'on' ? 'git-merge' : 'circle-slash'), el('span', 'strong', 'Auto-merge')),
        el('span', 'setting-parts', el('span', 'setting-part', el('span', 'mono strong', s.autoMerge.value), el('span', 'muted small', ` · ${s.autoMerge.from}`)),
          el('span', 'setting-meaning muted small', s.autoMerge.meaning)),
        s.autoMerge.settable ? argButton('acc.agents.autoMerge', 'Change…', 'edit', s.root) : el('span', '')));
    }
    if (s.billing) box.append(el('div', 'setting-billing', status(s.billing)));
    out.push(box);
  }
  if (!all.length) {
    out.push(empty('No Claude Code sessions are running. Background agents keep working when the terminal closes, and edit in their own worktree.'));
    return out;
  }
  // One table with a heading row per place, so the columns line up all the way down.
  const table = el('table', 'grid');
  // The session's name takes the room left over: it says what each agent works on (D-087).
  table.append(el('thead', '', el('tr', '', ...[['Session', 'wide'], ['State', ''], ['Model', 'model'], ['Kind', 'kind'], ['Where', ''], ['Started', 'started'], ['', '']].map(([h, c]) => el('th', c!, h!)))));
  for (const place of m.places) {
    if (!place.agents.length && !place.root) continue;
    const body = el('tbody');
    body.append(el('tr', 'group', span(el('th', '', icon(place.root ? 'repo' : 'device-desktop'), place.label, el('span', 'count', String(place.agents.length))), 7)));
    if (!place.agents.length) body.append(el('tr', 'none', span(el('td', 'muted', 'No agent sessions in this project right now.'), 7)));
    for (const a of place.agents) {
      // Its folder in context, or its full path, wrapped rather than clipped, as the names are: its own
      // folder comes last, and that's the part a clip would lose. The full path on hover in both (GH-83).
      const where = m.whereView === 'path' ? el('td', 'mono where-path', ...slashBreaks(a.path)) : el('td', 'where-folder', ...slashBreaks(a.where));
      where.title = a.path;
      const row = el('tr', a.needsYou ? 'attention' : '',
        // Its whole name, wrapped: the part that says what it works on comes last (D-087).
        openable(titled(el('td', 'strong agent-name', a.name), a.name), { type: 'run', command: 'acc.agent.watch', ref: { session: a.key } }), el('td', 'nowrap', status(a.look)),
        // The model it runs with (D-086), as plain text, short, with its full name on hover; a dash until it's known.
        Object.assign(el('td', 'nowrap mono muted model', a.model ? shortModel(a.model) : '—'), { title: a.model ?? 'Not known until it first answers' }), el('td', 'nowrap muted kind', a.kind), where, el('td', 'nowrap muted started', since(a.startedAt)),
        el('td', 'actions', menuButton(a.name)));
      body.append(withMenu(row, 'agent', { session: a.key }, { agentBackground: a.background }));
    }
    table.append(body);
  }
  out.push(whereBar(m.whereView), wrap(table));
  return out;
}

/**
 * What the Where column shows, Folder or Full path (GH-83), just above its heading. In the heading it would
 * widen the column, so a narrow tab would scroll it out of view. The page switches at once, and the
 * extension remembers the choice for the window.
 */
function whereBar(view: WhereView): HTMLElement {
  const pick = segmented('Where shows', [
    { key: 'folder', label: 'Folder', icon: 'folder', on: view === 'folder' },
    { key: 'path', label: 'Full path', icon: 'list-tree', on: view === 'path' },
  ], (key) => {
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
