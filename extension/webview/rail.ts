// The Command Center's rail: its mark, the sections with their counts, and the GitHub accounts.

import type { HomeSection } from '../src/model/shared.ts';
import type { HomeModel } from '../src/model/home.ts';
import { el, icon, wrap } from './dom.ts';
import { api, go } from './state.ts';

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
  return el('nav', 'rail', el('div', 'brand', logo(), el('div', 'brand-text', el('span', 'brand-name', 'Command Center'),
    el('span', 'muted small', m.overview.projects.map((p) => p.name).join(', ') || 'No project yet'))), list, el('div', 'rail-foot', ...people));
}
