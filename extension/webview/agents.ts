// The Agents section: sessions by where they run, and what they bill. How agents run is in Settings (GH-110).

import type { AgentsModel, WhereView } from '../src/model/agents.ts';
import { button, el, empty, header, icon, menuButton, openable, plural, segmented, since, span, status, titled, toolbarButton, withMenu, wrap } from './dom.ts';
import { api, go, type PageArea, state } from './state.ts';

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

/** Settings' How agents run, by its heading: model/settings.ts's settingsKey('agents'), which a test pins. */
const HOW_AGENTS_RUN = 'settings:agents';

export function renderAgents(m: AgentsModel): Node[] {
  const all = m.places.flatMap((p) => p.agents);
  const needs = all.filter((a) => a.needsYou).length;
  // Sessions whose work is over (D-095): counted apart from what needs you, and stopped together.
  const finished = all.filter((a) => a.finished).length;
  // How agents run is in Settings now (GH-110): Settings goes to it there.
  const settings = button('Settings', 'settings-gear', () => go('settings', HOW_AGENTS_RUN), 'ghost');
  settings.title = 'Settings: How agents run';
  settings.setAttribute('aria-label', 'Settings: How agents run');
  const stop = m.stopFinished ? toolbarButton('acc.agents.stopFinished', `Stop finished sessions (${m.stopFinished})`, 'debug-stop') : null;
  const out: Node[] = [header('Agents', m.error ?? `${plural(all.length, 'session')} on this machine${needs ? `, ${needs} need${needs === 1 ? 's' : ''} you` : ''}${finished ? `, ${finished} finished` : ''}.`, settings, stop, toolbarButton('acc.agent.new', 'Start a background agent', 'add', m.places.find((p) => p.root)?.root ?? undefined, true))];
  // Per-token billing shows here as well as in Settings: it costs money while nobody looks (D-036, D-089).
  if (m.billing?.tone === 'orange') out.push(el('div', 'setting-billing', status(m.billing)));
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
