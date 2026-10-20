// History in full (D-037), as the Overview's History detail shows it (GH-160): every answer, move, step
// autopilot took and command acc ran, newest first, with filters. Each day's entries sit under a line with the
// day's name, and the page loads them a page at a time, asking the extension for the next as a person
// scrolls near the end (D-170).

import type { HistoryItem } from '../src/model/history.ts';
import type { HistoryFilter, HistoryPage, HistoryReply } from '../src/model/history-pages.ts';
import { button, type Child, el, icon, linkTo, work } from './dom.ts';
import { clock, dayName, dayNumber } from './days.ts';
import { afterOf, historyKind, type Loaded, startFrom, withNewer, withPage } from './history-store.ts';
import { api, memory, type PageArea, remember, state } from './state.ts';

/** History filters: everything, or one kind. Remembered for the tab. Autopilot's steps (D-064) and a person's edits (T-74) are Tasks. */
const HISTORY_KINDS = [['all', 'All', 'list-flat'], ['answer', 'Your answers', 'comment-discussion'], ['move', 'Tasks', 'project'], ['run', 'Commands', 'terminal']] as const;

/** The entries loaded so far, for the filter that shows. */
let loaded: Loaded | null = null;
/** The entry History was last asked to open at, so the pages up to it are asked for once. */
let sought: string | null = null;
/** Watches the end of the list, to ask for the next page as it comes near the view. */
let watcher: IntersectionObserver | null = null;

/** Asks the extension for the filter's next page, or the pages up to entry `upTo`. */
function ask(upTo?: string): void {
  if (!loaded) return;
  loaded = { ...loaded, waiting: true };
  const after = afterOf(loaded);
  api.postMessage({ type: 'history-more', filter: loaded.filter, ...(after ? { after } : {}), ...(upTo ? { upTo } : {}) });
}

/** What a row shows: its look, its task's key, its line of text, and what opens under it. */
function rowParts(it: HistoryItem, where: string | null): { look: { label: string; icon: string; tone: string }; key: string | null; text: string; body: Child[] } {
  const place = where ? el('div', 'muted small', where) : null;
  switch (it.kind) {
    case 'move':
      return { look: it.look, key: it.task, text: it.title, body: [el('div', 'muted small', `${it.from ?? 'new'} → `, el('strong', '', it.to), ` · by ${it.by.replace(/^human:/, '')}`), place] };
    case 'edit':
      // A person's edit (T-74): which fields it changed, and who.
      return { look: it.look, key: it.task, text: it.title, body: [el('div', 'muted small', `Edited its ${it.fields} · by ${it.by.replace(/^human:/, '')}`), place] };
    case 'autopilot':
      // A step autopilot took (D-064): what it did, with why under it and its pull request a click away.
      return {
        look: it.look, key: it.task, text: it.title,
        body: [it.detail ? el('div', 'history-detail', it.detail) : null, it.url ? linkTo(it.url, icon('git-pull-request'), ' Open its pull request') : null, place],
      };
    case 'answer': {
      // What it asked and what you decided on the row; the full command and your words open below it.
      const d = it.decision;
      return {
        look: d.look, key: it.who, text: d.asked,
        body: [
          d.code ? work(el('pre', 'q-code', d.code), 'transcript') : null,
          d.detail ? el('div', 'history-detail', d.detail) : null,
          place,
          button('Watch', 'pulse', () => api.postMessage({ type: 'run', command: 'acc.agent.watch', ref: { session: it.session } }), 'ghost small'),
        ],
      };
    }
    case 'run':
      return { look: it.look, key: null, text: it.label, body: [work(el('div', 'history-run-out', el('div', 'mono muted small', `$ ${it.command}`), it.lines.length ? el('pre', 'tool-pre history-out', it.lines.join('\n')) : null), 'output')] };
  }
}

/** One entry's row: its state's icon and label, its task's key, one line of text and its time; a click opens its detail. */
function row(it: HistoryItem, manyProjects: boolean, target: string | undefined): HTMLElement {
  const where = manyProjects && 'project' in it && it.project ? it.project : null;
  const p = rowParts(it, where);
  const text = el('span', 'history-text', p.text);
  text.title = p.text;
  const label = el('span', `history-label tone-${p.look.tone}`, p.look.label);
  label.title = p.look.label;
  const time = el('time', 'history-time muted small', clock(it.at));
  time.setAttribute('datetime', it.at);
  time.title = new Date(it.at).toLocaleString();
  const summary = el('summary', 'history-row',
    el('span', `feed-icon tone-${p.look.tone}`, icon(p.look.icon, p.look.tone)),
    el('span', 'history-main', el('span', 'history-top', p.key ? el('span', 'tcard-key', p.key) : null, text), label),
    time);
  const details = el('details', 'history-item', summary, el('div', 'history-body', ...p.body)) as HTMLDetailsElement;
  const li = el('li', `history-${it.kind}`, details);
  li.dataset.id = it.id;
  if (it.id === target) {
    li.dataset.at = '';
    details.open = true;
  }
  return li;
}

/** The entries under a line for each day, in the person's time zone; each day's name is a heading. */
function days(items: HistoryItem[], manyProjects: boolean, target: string | undefined): HTMLElement[] {
  const now = Date.now();
  const out: HTMLElement[] = [];
  let day: number | null = null;
  let feed: HTMLElement | null = null;
  for (const it of items) {
    const n = dayNumber(Date.parse(it.at));
    if (n !== day || !feed) {
      day = n;
      const name = dayName(it.at, now);
      feed = el('ol', 'feed history-feed');
      feed.setAttribute('aria-label', name);
      out.push(el('section', 'history-day', el('h3', 'history-day-name', el('span', '', name)), feed));
    }
    feed.append(row(it, manyProjects, target));
  }
  return out;
}

/**
 * Everything that happened, newest first (D-037): your answers to agents' questions, task moves, the steps
 * autopilot took, and the commands acc ran. The model sends the first page and each filter's count; the rest
 * come a page at a time (D-170). Opened at an entry, that entry shows, its details open, whatever the filter,
 * with the pages up to it asked for when it isn't loaded.
 */
export function renderHistory(first: HistoryPage, manyProjects: boolean, at?: string): HTMLElement {
  const kept = memory().history ?? 'all';
  const known = at === undefined ? undefined : [...(loaded?.items ?? []), ...first.items].find((i) => i.id === at);
  const filter: HistoryFilter = at !== undefined && kept !== 'all' && (!known || historyKind(known) !== kept) ? 'all' : kept;
  const fresh = !loaded || loaded.filter !== filter;
  loaded = fresh ? startFrom(first, filter) : withNewer(loaded!, first);
  // Another filter than All starts with its own first page, asked for once.
  if (fresh && loaded.waiting) ask();
  // Opened at an entry not loaded yet: the pages up to it, asked for once.
  else if (at !== undefined && sought !== at && !loaded.waiting && loaded.more && !loaded.items.some((i) => i.id === at)) {
    sought = at;
    ask(at);
  }
  const counts = loaded.counts;
  const filters = el('div', 'segmented history-filters');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Show');
  for (const [k, label, ic] of HISTORY_KINDS) {
    const n = counts[k];
    const b = el('button', `seg${filter === k ? ' on' : ''}`, icon(ic), label, n ? el('span', 'count', String(n)) : null) as HTMLButtonElement;
    b.type = 'button';
    b.setAttribute('aria-pressed', String(filter === k));
    b.addEventListener('click', () => { remember((m) => { m.history = k; }); if (state.last) state.draw(state.last); });
    filters.append(b);
  }
  const box = el('div', 'history', el('div', 'history-head', filters));
  watcher?.disconnect();
  watcher = null;
  if (!loaded.items.length && !loaded.waiting) {
    box.append(el('p', 'muted quiet', filter === 'answer' ? 'When you answer an agent, it\'s kept here.' : filter === 'run' ? 'Commands acc runs for you are kept here.' : 'What agents and tasks do shows up here.'));
    return box;
  }
  box.append(...days(loaded.items, manyProjects, at));
  // The list's end: "Loading…" while a page is on its way, "That's everything" once there's no more, and
  // otherwise a quiet line that asks for the next page as it comes near the view.
  const end = el('p', 'muted small history-end', loaded.waiting ? 'Loading…' : loaded.more ? '' : 'That\'s everything');
  end.setAttribute('role', 'status');
  box.append(end);
  if (loaded.more && !loaded.waiting) {
    queueMicrotask(() => {
      if (!end.isConnected || typeof IntersectionObserver === 'undefined') return;
      watcher = new IntersectionObserver((seen) => {
        if (!seen.some((s) => s.isIntersecting) || !loaded?.more || loaded.waiting) return;
        watcher?.disconnect();
        ask();
        end.textContent = 'Loading…';
      }, { root: end.closest('.task-modal-body'), rootMargin: '0px 0px 240px 0px' });
      watcher.observe(end);
    });
  }
  return box;
}

export const area: PageArea = {
  receive: {
    // A page the extension sent: added at the end, and drawn; the entry it was asked up to is brought into view.
    'history-page': (msg) => {
      const r = msg as unknown as HistoryReply;
      const next = loaded ? withPage(loaded, r) : null;
      if (!next) return;
      loaded = next;
      if (state.last) state.draw(state.last);
      if (r.upTo && r.found) document.querySelector<HTMLElement>('.history [data-at]')?.scrollIntoView({ block: 'center' });
    },
  },
};
