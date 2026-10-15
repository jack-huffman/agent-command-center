// The Command Center's rail: its mark, the sections with their counts, and the GitHub accounts.

import type { HomeSection } from '../src/model/shared.ts';
import type { HomeModel } from '../src/model/home.ts';
import { el, icon } from './dom.ts';
import { paletteButton } from './palette.ts';
import { api, go } from './state.ts';

// The page draws a new rail on each render: only the latest one listens for fonts.
let stopWatching: () => void = () => {};

function logo(): HTMLElement {
  const wrap = el('span', 'brand-mark');
  for (const theme of ['dark', 'light'] as const) {
    const src = document.body.dataset[theme === 'dark' ? 'logoDark' : 'logoLight'];
    if (!src) continue;
    const img = document.createElement('img');
    img.src = src;
    img.alt = '';
    img.className = `logo-${theme}`;
    wrap.append(img);
  }
  return wrap;
}

export function renderNav(m: HomeModel, current: HomeSection): HTMLElement {
  const list = el('div', 'nav-list');
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-orientation', 'vertical');
  for (const n of m.nav) {
    const on = n.section === current;
    const b = el('button', `nav-item${on ? ' on' : ''}`, icon(n.icon), el('span', 'nav-label', n.label),
      n.count !== null ? el('span', `nav-count${n.attention ? ' attention' : ''}`, String(n.count)) : n.attention ? el('span', 'nav-count attention', icon('warning')) : null) as HTMLButtonElement;
    b.type = 'button';
    b.title = n.hint;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(on));
    b.setAttribute('aria-label', `${n.label}: ${n.hint}`);
    b.tabIndex = on ? 0 : -1;
    b.addEventListener('click', () => go(n.section));
    list.append(b);
  }
  // Arrow keys move between sections, as in any tab list.
  list.addEventListener('keydown', (e) => {
    const items = [...list.querySelectorAll<HTMLButtonElement>('.nav-item')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : null;
    if (next === null || i < 0) return;
    e.preventDefault();
    const target = items[(next + items.length) % items.length]!;
    target.focus();
    target.click();
  });
  const people = m.overview.projects.filter((p) => p.account).map((p) => {
    const b = el('button', 'rail-account', icon('github'), el('span', 'rail-account-name', p.account!), m.overview.projects.length > 1 ? el('span', 'muted small', p.name) : null) as HTMLButtonElement;
    b.type = 'button';
    b.title = `${p.name} works as ${p.account} on GitHub. Switch account`;
    b.addEventListener('click', () => api.postMessage({ type: 'toolbar', command: 'acc.github.switch', arg: p.root }));
    return b;
  });
  const rail = el('nav', 'rail', el('div', 'brand', logo(), el('div', 'brand-text', el('span', 'brand-name', 'Command Center'),
    el('span', 'muted small', m.overview.projects.map((p) => p.name).join(', ') || 'No project yet'))), paletteButton(), list, el('div', 'rail-foot', ...people));
  // Once laid out, and again when the fonts already loading are done.
  requestAnimationFrame(() => showSelected(rail));
  void document.fonts.ready.then(() => showSelected(rail));
  // And again when the icon font arrives, which widens every tab: fonts.ready resolves before it starts (T-24).
  stopWatching();
  stopWatching = showOnFontLoad(document.fonts, () => showSelected(rail));
  return rail;
}

/**
 * Under 820 px the rail is a strip that scrolls sideways, and a later section's tab starts out past its
 * edge: the selected one is scrolled into the strip's view, and the page itself never moves (GH-105).
 */
function showSelected(rail: HTMLElement): void {
  const on = rail.querySelector<HTMLElement>('.nav-item.on');
  if (!on || rail.scrollWidth <= rail.clientWidth) return;
  const r = rail.getBoundingClientRect();
  const t = on.getBoundingClientRect();
  if (t.right > r.right) rail.scrollLeft += t.right - r.right + 12;
  else if (t.left < r.left) rail.scrollLeft -= r.left - t.left + 12;
}

// ---------------------------------------------------------------- a late font (T-24)

/** What the rail needs of document.fonts: the event that says a font finished loading. */
export interface FontEvents {
  addEventListener: (type: 'loadingdone', fn: () => void) => void;
  removeEventListener: (type: 'loadingdone', fn: () => void) => void;
}

/**
 * Calls show each time a font finishes loading, and returns what stops it. document.fonts.ready resolves
 * before the icon font starts to load (nothing has asked for it yet), so the tabs widen after it and the
 * selected tab can end up past the strip's edge. loadingdone is used rather than fonts.load('codicon'): it
 * needs no font name, and also covers a font that is asked for later than the rail's first frame.
 */
export function showOnFontLoad(fonts: FontEvents, show: () => void): () => void {
  fonts.addEventListener('loadingdone', show);
  return () => fonts.removeEventListener('loadingdone', show);
}
