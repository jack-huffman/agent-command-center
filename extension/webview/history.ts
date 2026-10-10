// History in full (D-037), as the Overview's History detail shows it (GH-160): every answer, move, step
// autopilot took and command acc ran, newest first, with filters.

import type { HistoryItem } from '../src/model/history.ts';
import { button, el, icon, linkTo, status, when } from './dom.ts';
import { api, memory, remember, state } from './state.ts';

/** History filters: everything, or one kind. Remembered for the tab. Autopilot's steps are Tasks (D-064). */
const HISTORY_KINDS = [['all', 'All', 'list-flat'], ['answer', 'Your answers', 'comment-discussion'], ['move', 'Tasks', 'project'], ['run', 'Commands', 'terminal']] as const;
const historyKind = (i: HistoryItem): string => (i.kind === 'autopilot' ? 'move' : i.kind);

/**
 * Everything that happened, newest first (D-037): your answers to agents' questions, task moves, the steps
 * autopilot took, and the commands acc ran. An answered question leaves this record behind. Opened at an
 * item, that item shows, its details open, whatever the filter.
 */
export function renderHistory(items: HistoryItem[], manyProjects: boolean, at?: number): HTMLElement {
  const target = at === undefined ? undefined : items[at];
  const kept = memory().history ?? 'all';
  const kind = target && kept !== 'all' && historyKind(target) !== kept ? 'all' : kept;
  const filters = el('div', 'segmented history-filters');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Show');
  for (const [k, label, ic] of HISTORY_KINDS) {
    const n = k === 'all' ? items.length : items.filter((i) => historyKind(i) === k).length;
    const b = el('button', `seg${kind === k ? ' on' : ''}`, icon(ic), label, n ? el('span', 'count', String(n)) : null) as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('aria-pressed', String(kind === k));
    b.addEventListener('click', () => { remember((m) => { m.history = k; }); if (state.last) state.draw(state.last); });
    filters.append(b);
  }
  const box = el('div', 'history', el('div', 'history-head', filters));
  const shown = items.filter((i) => kind === 'all' || historyKind(i) === kind);
  if (!shown.length) {
    box.append(el('p', 'muted quiet', kind === 'answer' ? 'When you answer an agent, it\'s kept here.' : kind === 'run' ? 'Commands acc runs for you are kept here.' : 'What agents and tasks do shows up here.'));
    return box;
  }
  const feed = el('ol', 'feed history-feed');
  feed.setAttribute('aria-label', 'History, newest first');
  const where = (project: string) => (manyProjects && project ? ` · ${project}` : '');
  for (const it of shown) {
    let li: HTMLElement;
    if (it.kind === 'move') {
      li = el('li', '', el('span', 'feed-dot'), el('div', '',
        el('div', '', el('span', 'tcard-key', it.task), ' ', el('span', '', it.title)),
        el('div', 'muted small', when(it.at), ` · ${it.from ?? 'new'} → `, el('strong', '', it.to), ` · ${it.by.replace(/^human:/, '')}${where(it.project)}`)));
    } else if (it.kind === 'autopilot') {
      // A step autopilot took (D-064): its icon, and what it did in words, with its pull request a click away.
      const what = it.url ? linkTo(it.url, it.look.label) : el('span', '', it.look.label);
      li = el('li', 'history-autopilot', el('span', `feed-icon tone-${it.look.tone}`, icon(it.look.icon)), el('div', 'history-step',
        el('div', '', el('span', 'tcard-key', it.task), ' ', el('span', '', it.title)),
        el('div', 'muted small', when(it.at), ' · ', el('strong', `tone-${it.look.tone}`, what), where(it.project)),
        it.detail ? el('div', 'muted small history-note', it.detail) : null));
    } else if (it.kind === 'answer') {
      const d = it.decision;
      // What it asked and what you decided, on the line itself; the full command and your words open below.
      const summary = el('summary', '', el('div', 'history-line', el('strong', '', it.who), el('span', '', ` ${d.asked}`), d.code ? el('code', 'tool-code', d.code.split('\n')[0]!) : null),
        el('div', 'muted small history-meta', when(it.at), where(it.project), el('span', 'sep', '·'), status(d.look)));
      const body = el('div', 'history-body',
        d.code ? el('pre', 'q-code', d.code) : null,
        d.detail ? el('div', 'history-detail', d.detail) : null,
        button('Watch', 'pulse', () => api.postMessage({ type: 'run', command: 'acc.agent.watch', ref: { session: it.session } }), 'ghost small'));
      li = el('li', 'history-answer', el('span', `feed-icon tone-${d.look.tone}`, icon(d.icon)), el('details', 'history-item', summary, body));
    } else {
      const summary = el('summary', '', el('span', '', el('strong', '', it.label)), el('div', 'muted small', when(it.at), ' · ', status(it.look)));
      li = el('li', 'history-run', el('span', `feed-icon tone-${it.look.tone}`, icon('terminal')), el('details', 'history-item', summary,
        el('div', 'history-body', el('div', 'mono muted small', `$ ${it.command}`), it.lines.length ? el('pre', 'tool-pre history-out', it.lines.join('\n')) : null)));
    }
    if (it === target) {
      li.dataset.at = '';
      const d = li.querySelector('details');
      if (d) (d as HTMLDetailsElement).open = true;
    }
    feed.append(li);
  }
  box.append(feed);
  return box;
}
