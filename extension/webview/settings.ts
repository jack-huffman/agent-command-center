// The Settings section (GH-109): Appearance, then a part for each area that will gather its settings here,
// each saying where its settings live until then, with a way there.

import type { SettingsLink, SettingsModel, SettingsPartModel } from '../src/model/settings.ts';
import { button, el, header, icon, segmented } from './dom.ts';
import { renderLimits } from './limits.ts';
import { api, go, type PageArea, remember } from './state.ts';

/** The theme: Match VSCode, Light or Dark. The extension keeps the pick, and every open page follows it. */
function appearance(m: SettingsModel): HTMLElement {
  const now = m.themes.find((t) => t.key === m.theme) ?? m.themes[0]!;
  const pick = segmented('Theme', m.themes.map((t) => ({ key: t.key, label: t.label, icon: t.icon, on: t.key === m.theme })),
    (key) => api.postMessage({ type: 'toolbar', command: 'acc.settings.theme', arg: key }));
  pick.querySelectorAll('button').forEach((b, i) => { b.dataset.keep = `settings-theme:${i}`; });
  return el('div', 'settings-row', el('span', 'settings-name', icon('color-mode'), el('span', 'strong', 'Theme')),
    el('div', 'settings-value', pick, el('p', 'muted small settings-meaning', now.meaning)));
}

/** A way to where a part's settings live today: its section, with the part of it opened. */
function linkButton(l: SettingsLink): HTMLElement {
  return button(l.label, l.icon, () => {
    if (l.open) { const part = l.open; remember((x) => { if (!x.opened.includes(part)) x.opened = [...x.opened, part]; }); }
    go(l.section);
  });
}

/** A part not built here yet: where its settings live today, and a way there. */
function today(p: SettingsPartModel): HTMLElement {
  return el('div', 'settings-today',
    el('p', '', el('span', 'status tone-neutral', icon('info'), 'Not here yet. '), p.today ?? ''),
    p.details.length ? el('ul', 'settings-details muted', ...p.details.map((d) => el('li', '', d))) : null,
    p.links.length ? el('div', 'actions', ...p.links.map(linkButton)) : null);
}

export function renderSettings(m: SettingsModel): Node[] {
  const out: Node[] = [header('Settings', 'How the Command Center looks on this machine, and the limits and checks agents run under. Each part below gathers an area\'s settings; until it does, it says where they are.')];
  for (const p of m.parts) {
    // Its heading is where another page opens Settings at this part.
    const h = el('h2', '', icon(p.icon), p.title);
    h.id = `settings-${p.id}`;
    h.tabIndex = -1;
    h.dataset.part = `settings:${p.id}`;
    const part = el('section', `block settings-part${p.built ? '' : ' later'}`, h, el('p', 'muted settings-summary', p.summary));
    part.setAttribute('aria-labelledby', h.id);
    if (p.id === 'appearance') part.append(appearance(m));
    if (p.id === 'limits') part.append(...renderLimits(m.limits));
    if (!p.built) part.append(today(p));
    out.push(part);
  }
  return out;
}

export const area: PageArea = {
  sections: { settings: { draw: (m) => renderSettings(m.settings) } },
  views: { settings: renderSettings },
};
