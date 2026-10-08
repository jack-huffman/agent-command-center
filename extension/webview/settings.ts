// The Settings section (GH-109): Appearance, How agents run (GH-110), then a part for each area that will
// gather its settings here, each saying where its settings live until then, with a way there.

import type { AgentRunProject, SettingFrom, SettingsLink, SettingsModel, SettingsPartModel } from '../src/model/settings.ts';
import { argButton, button, el, header, icon, segmented, status } from './dom.ts';
import { api, go, type PageArea } from './state.ts';

/** The theme: Match VSCode, Light or Dark. The extension keeps the pick, and every open page follows it. */
function appearance(m: SettingsModel): HTMLElement {
  const now = m.themes.find((t) => t.key === m.theme) ?? m.themes[0]!;
  const pick = segmented('Theme', m.themes.map((t) => ({ key: t.key, label: t.label, icon: t.icon, on: t.key === m.theme })),
    (key) => api.postMessage({ type: 'toolbar', command: 'acc.settings.theme', arg: key }));
  pick.querySelectorAll('button').forEach((b, i) => { b.dataset.keep = `settings-theme:${i}`; });
  return el('div', 'settings-row', el('span', 'settings-name', icon('color-mode'), el('span', 'strong', 'Theme')),
    el('div', 'settings-value', pick, el('p', 'muted small settings-meaning', now.meaning)));
}

/** A way to where a part's settings live today, or to what it needs first: its section. */
function linkButton(l: SettingsLink): HTMLElement {
  return button(l.label, l.icon, () => go(l.section));
}

/** Where a setting is set, with an icon: this clone, the project, or a default. */
const from = (f: SettingFrom): HTMLElement => el('span', 'settings-from muted small', icon(f.icon), f.label);

/** A row of How agents run: its name, what it is now, and its Change…, named for what and whose it changes. */
function row(name: string, iconName: string, value: HTMLElement, change: HTMLElement | null, changes: string): HTMLElement {
  if (change) change.setAttribute('aria-label', `Change ${changes}`);
  return el('div', 'settings-row has-change', el('span', 'settings-name', icon(iconName), el('span', 'strong', name)), el('div', 'settings-value', value), change);
}

/**
 * One project's agents, under its name (GH-110): builders' and reviewers' model, effort and fallback, its
 * autonomy (D-064) and auto-merge (D-083), each with where it's set and its Change…, which asks acc.
 */
function agentProject(s: AgentRunProject): HTMLElement {
  const box = el('div', 'settings-project');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', s.project);
  box.append(el('h3', 'settings-project-name', icon('repo'), el('span', '', s.project)));
  for (const r of s.roles) {
    const parts = el('div', 'settings-parts', ...r.parts.flatMap((p) => [el('span', 'muted', p.name), el('span', 'mono strong settings-setting', p.value), from(p.from)]));
    box.append(row(r.label, r.icon, parts, argButton('acc.agents.configure', 'Change…', 'edit', `${r.role}|${s.root}`), `${r.label.toLowerCase()}' model, effort or fallback, in ${s.project}`));
  }
  if (s.autonomy) {
    const value = el('div', '', el('div', 'settings-now', status(s.autonomy.look), from(s.autonomy.from)), s.autonomy.meaning ? el('p', 'muted small settings-meaning', s.autonomy.meaning) : null);
    box.append(row('Autonomy', 'rocket', value, argButton('acc.agents.autonomy', 'Change…', 'edit', s.root), `what autopilot may do on its own, in ${s.project}`));
  }
  if (s.autoMerge) {
    const value = el('div', '', el('div', 'settings-now', status(s.autoMerge.look), from(s.autoMerge.from)), el('p', 'muted small settings-meaning', s.autoMerge.meaning));
    // A Salesforce project never auto-merges, so it has no Change… (D-083): its meaning says why.
    box.append(row('Auto-merge', 'git-merge', value, s.autoMerge.settable ? argButton('acc.agents.autoMerge', 'Change…', 'edit', s.root) : null, `whether autopilot merges pull requests, in ${s.project}`));
  }
  return box;
}

/** How agents run (GH-110): each onboarded project's, then what this machine's agents bill (D-036). */
function howAgentsRun(m: SettingsModel): Node[] {
  const b = m.agents.billing;
  const billing = el('div', 'settings-row has-change settings-billing',
    el('span', 'settings-name', icon('credit-card'), el('span', 'strong', 'Billing')),
    el('div', 'settings-value', el('div', 'settings-state', status(b.look)), el('p', 'muted small settings-meaning', 'This machine\'s, for every project. Agents shows it too while it\'s per token.')),
    b.link ? linkButton(b.link) : null);
  return [...m.agents.projects.map(agentProject), billing];
}

/** A part not built here yet: where its settings live today, and a way there. */
function today(p: SettingsPartModel): HTMLElement {
  return el('div', 'settings-today',
    el('p', '', el('span', 'status tone-neutral', icon('info'), 'Not here yet. '), p.today ?? ''),
    p.details.length ? el('ul', 'settings-details muted', ...p.details.map((d) => el('li', '', d))) : null,
    p.links.length ? el('div', 'actions', ...p.links.map(linkButton)) : null);
}

export function renderSettings(m: SettingsModel): Node[] {
  const out: Node[] = [header('Settings', 'How the Command Center looks on this machine, and how agents run in each project. Each part below gathers an area\'s settings; until it does, it says where they are.')];
  for (const p of m.parts) {
    // Its heading is where another page opens Settings at this part.
    const h = el('h2', '', icon(p.icon), p.title);
    h.id = `settings-${p.id}`;
    h.tabIndex = -1;
    h.dataset.part = `settings:${p.id}`;
    const part = el('section', `block settings-part${p.built ? '' : ' later'}`, h, el('p', 'muted settings-summary', p.summary));
    part.setAttribute('aria-labelledby', h.id);
    if (p.id === 'appearance') part.append(appearance(m));
    if (p.id === 'agents') part.append(...howAgentsRun(m));
    if (p.built && p.details.length) part.append(...p.details.map((d) => el('p', 'muted small settings-note', d)));
    if (p.built && p.links.length) part.append(el('div', 'actions settings-links', ...p.links.map(linkButton)));
    if (!p.built) part.append(today(p));
    out.push(part);
  }
  return out;
}

export const area: PageArea = {
  sections: { settings: { draw: (m) => renderSettings(m.settings) } },
  views: { settings: renderSettings },
};
