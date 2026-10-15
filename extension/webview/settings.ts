// The Settings section (GH-109): Appearance, How agents run (GH-110), Limits and checks (GH-111), Trackers and sign-ins
// (GH-112), Notices in Slack, GitHub accounts and the Command Center's own preferences (GH-113), and About (GH-114).

import type { AgentRunProject, GithubAccountSetting, PagePreference, SettingFrom, SettingsAction, SettingsLink, SettingsModel, SettingsPartModel, TrackerProject, TrackerSetting } from '../src/model/settings.ts';
import { argButton, button, el, header, icon, segmented, status, toolbarButton, whatThisMeans } from './dom.ts';
import { renderAbout } from './about.ts';
import { renderLimits } from './limits.ts';
import { slackCardView } from './slack.ts';
import { api, go, jumpTo, type PageArea } from './state.ts';

/** The theme: Match VSCode, Light or Dark. The extension keeps the pick, and every open page follows it. */
function appearance(m: SettingsModel): HTMLElement {
  const now = m.themes.find((t) => t.key === m.theme) ?? m.themes[0]!;
  const pick = segmented('Theme', m.themes.map((t) => ({ key: t.key, label: t.label, icon: t.icon, on: t.key === m.theme })),
    (key) => api.postMessage({ type: 'toolbar', command: 'acc.settings.theme', arg: key }));
  pick.querySelectorAll('button').forEach((b, i) => { b.dataset.keep = `settings-theme:${i}`; });
  return el('div', 'settings-row', el('span', 'settings-name', icon('color-mode'), el('span', 'strong', 'Theme')),
    el('div', 'settings-value', pick, whatThisMeans('theme', now.meaning, m.folded)));
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
function agentProject(s: AgentRunProject, folded: readonly string[]): HTMLElement {
  const box = el('div', 'settings-project');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', s.project);
  box.append(el('h3', 'settings-project-name', icon('repo'), el('span', '', s.project)));
  for (const r of s.roles) {
    // A model acc no longer offers says so on a line of its own, under its value (D-128).
    const parts = el('div', 'settings-parts', ...r.parts.flatMap((p) => [el('span', 'muted', p.name), el('span', 'mono strong settings-setting', p.value), from(p.from),
      ...(p.older ? [el('span', 'settings-older muted small', icon('history'), el('span', '', p.older))] : [])]));
    box.append(row(r.label, r.icon, parts, argButton('acc.agents.configure', 'Change…', 'edit', `${r.role}|${s.root}`), `${r.label.toLowerCase()}' model, effort or fallback, in ${s.project}`));
  }
  if (s.autonomy) {
    const value = el('div', '', el('div', 'settings-now', status(s.autonomy.look), from(s.autonomy.from)), whatThisMeans(`autonomy:${s.root}`, s.autonomy.meaning, folded));
    box.append(row('Autonomy', 'rocket', value, argButton('acc.agents.autonomy', 'Change…', 'edit', s.root), `what autopilot may do on its own, in ${s.project}`));
  }
  if (s.autoMerge) {
    const value = el('div', '', el('div', 'settings-now', status(s.autoMerge.look), from(s.autoMerge.from)), whatThisMeans(`auto-merge:${s.root}`, s.autoMerge.meaning, folded));
    // A Salesforce project never auto-merges, so it has no Change… (D-083): its meaning says why.
    box.append(row('Auto-merge', 'git-merge', value, s.autoMerge.settable ? argButton('acc.agents.autoMerge', 'Change…', 'edit', s.root) : null, `whether autopilot merges pull requests, in ${s.project}`));
  }
  if (s.cloud) {
    // Cloud builders (GH-69): the switch, its meaning, what it needs and what's missing, and where a plain dispatch goes.
    const c = s.cloud;
    const needs = el('ul', 'settings-needs', ...c.needs.map((n) => el('li', `settings-need${n.ok ? ' ok' : ''}`, status({ label: n.label, icon: n.ok ? 'pass' : 'circle-large-outline', tone: n.ok ? 'blue' : 'orange' }), n.ok ? null : el('span', 'muted small', ` ${n.fix}`))));
    // What GitHub enforces behind the guard, a row per environment branch, with why in full on hover (GH-69).
    const protection = c.protection.length ? el('ul', 'settings-needs', ...c.protection.map((p) => Object.assign(el('li', `settings-need${p.look.tone === 'blue' ? ' ok' : ''}`, status(p.look), p.look.tone === 'blue' ? null : el('span', 'muted small', ` ${p.why}`)), { title: p.why }))) : null;
    const value = el('div', '',
      el('div', 'settings-now', status(c.look), from(c.from), c.defaultPlace ? el('span', 'settings-from muted small', icon(c.defaultPlace.icon), `plain dispatch: ${c.defaultPlace.label}`) : null),
      whatThisMeans(`cloud:${s.root}`, c.meaning, folded),
      c.look.label === 'off' ? null : needs,
      protection,
      el('div', 'actions settings-tracker-actions', ...c.actions.map(trackerButton)));
    box.append(row('Cloud builders', 'cloud', value, null, `cloud builders, in ${s.project}`));
  }
  return box;
}

/** How agents run (GH-110): each onboarded project's, then what this machine's agents bill (D-036). */
function howAgentsRun(m: SettingsModel): Node[] {
  const b = m.agents.billing;
  const billing = el('div', 'settings-row has-change settings-billing',
    el('span', 'settings-name', icon('credit-card'), el('span', 'strong', 'Billing')),
    el('div', 'settings-value', el('div', 'settings-state', status(b.look)), whatThisMeans('billing', b.meaning, m.folded)),
    b.link ? linkButton(b.link) : null);
  return [...m.agents.projects.map((s) => agentProject(s, m.folded)), billing];
}

/**
 * A button of Settings' (GH-112, GH-113): one of the commands the page may ask for, with what it's for, named
 * for what it does and to whose. One that can't be used now is disabled, and says why.
 */
function trackerButton(a: SettingsAction): HTMLElement {
  const b = (a.arg === null ? toolbarButton(a.command, a.label, a.icon, undefined, a.primary) : argButton(a.command, a.label, a.icon, a.arg, a.primary)) as HTMLButtonElement;
  b.setAttribute('aria-label', a.name);
  if (a.disabled) {
    b.disabled = true;
    b.title = a.disabled;
    b.setAttribute('aria-description', a.disabled);
  }
  return b;
}

/**
 * One tracker (GH-112): its kind and name with its buttons, then its place, its board and its sign-in, each
 * with where it's kept: the project's .acc/config.json, or VSCode on this machine.
 */
function tracker(t: TrackerSetting): HTMLElement {
  const box = el('div', 'settings-tracker');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', t.title);
  const line = (name: string, iconName: string, value: HTMLElement, f: SettingFrom) =>
    el('div', 'settings-row settings-tracker-row', el('span', 'settings-name', icon(iconName), el('span', 'strong', name)), el('div', 'settings-value settings-now', value, from(f)));
  box.append(
    el('div', 'settings-tracker-head', el('h4', 'settings-tracker-name', icon(t.icon), el('span', '', t.title)), el('div', 'actions settings-tracker-actions', ...t.actions.map(trackerButton))),
    line('Place', 'location', el('span', 'settings-place', t.place), t.from),
    line('Board', 'layout', status(t.board), t.from),
    line('Sign-in', 'account', status(t.signIn), t.signInFrom),
  );
  return box;
}

/** A project's trackers, under its name, or that it has none yet. */
function trackerProject(p: TrackerProject): HTMLElement {
  const box = el('div', 'settings-project');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', p.project);
  box.append(el('h3', 'settings-project-name', icon('repo'), el('span', '', p.project)));
  if (p.loading) box.append(el('p', 'settings-tracker-none', status({ label: 'Reading its trackers', icon: 'sync~spin', tone: 'blue' })));
  else if (!p.trackers.length) box.append(el('p', 'settings-tracker-none', status({ label: 'No tracker yet', icon: 'circle-outline', tone: 'neutral' })));
  box.append(...p.trackers.map(tracker));
  return box;
}

/** Trackers and sign-ins (GH-112): every open project's trackers, then Connect a tracker. */
function trackersPart(m: SettingsModel): Node[] {
  return [...m.trackers.projects.map(trackerProject), ...(m.trackers.connect ? [el('div', 'actions settings-links', trackerButton(m.trackers.connect))] : [])];
}

/**
 * One project's GitHub account (GH-113), under its name: who its repo pushes as, from this clone or the
 * project, gh's sign-in and the commit identity, and Switch…, which asks acc to make the change.
 */
function githubProject(g: GithubAccountSetting): HTMLElement {
  const box = el('div', 'settings-project settings-github');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', g.project);
  box.append(
    el('div', 'settings-tracker-head', el('h3', 'settings-project-name', icon('repo'), el('span', '', g.project)), el('div', 'actions settings-tracker-actions', ...g.actions.map(trackerButton))),
    el('div', 'settings-row settings-tracker-row', el('span', 'settings-name', icon('github'), el('span', 'strong', 'Pushes as')),
      el('div', 'settings-value', el('div', 'settings-now', status(g.look), g.from ? from(g.from) : null),
        g.repo ? el('p', 'muted small settings-meaning mono', g.repo) : null,
        ...g.lines.map((l) => el('div', 'settings-state', status(l))))),
  );
  return box;
}

/** GitHub accounts (GH-113): every open project's, each under its name. */
function githubPart(m: SettingsModel): Node[] {
  return m.github.projects.map(githubProject);
}

/**
 * One of the Command Center's own preferences (GH-113): a few choices side by side, or many as a list, each
 * asking for its command with the choice; what the one chosen means; and where VSCode keeps it.
 */
function preference(p: PagePreference, folded: readonly string[]): HTMLElement {
  let pick: HTMLElement;
  if (p.control === 'segmented') {
    pick = segmented(p.name, p.choices, (key) => api.postMessage({ type: 'toolbar', command: p.command, arg: key }));
    pick.querySelectorAll('button').forEach((b, i) => { b.dataset.keep = `settings-${p.id}:${i}`; });
  } else {
    const select = document.createElement('select');
    select.className = 'select-input settings-select';
    select.id = `settings-${p.id}`;
    select.dataset.keep = `settings-${p.id}`;
    select.setAttribute('aria-label', p.name);
    for (const c of p.choices) {
      const o = document.createElement('option');
      o.value = c.key;
      o.textContent = c.label;
      select.append(o);
    }
    select.value = p.choices.find((c) => c.on)?.key ?? '';
    select.addEventListener('change', () => api.postMessage({ type: 'toolbar', command: p.command, arg: select.value }));
    // An option can't hold an icon, so the one chosen shows it before the list, which says its label.
    const on = p.choices.find((c) => c.on);
    const mark = on ? icon(on.icon) : null;
    pick = el('div', 'settings-pick', mark ? el('span', 'settings-chosen', mark) : null, select);
  }
  return el('div', 'settings-row', el('span', 'settings-name', icon(p.icon), el('span', 'strong', p.name)),
    el('div', 'settings-value', el('div', 'settings-now', pick, from(p.from)), whatThisMeans(`page:${p.id}`, p.meaning, folded)));
}

/** The Command Center's own preferences (GH-113), then how often each part refreshes at the pace chosen. */
function pagePart(m: SettingsModel): Node[] {
  return [...m.page.preferences.map((p) => preference(p, m.folded)), el('ul', 'settings-details settings-refresh muted small', ...m.page.refresh.map((d) => el('li', '', d)))];
}

/** Notices in Slack (GH-58), moved here from Environments (GH-113): the card it had there. */
function slackPart(m: SettingsModel): Node[] {
  return m.slack ? [slackCardView(m.slack)] : [];
}

/** A part not built here yet: where its settings live today, and a way there. */
function today(p: SettingsPartModel): HTMLElement {
  return el('div', 'settings-today',
    el('p', '', el('span', 'status tone-neutral', icon('info'), 'Not here yet. '), p.today ?? ''),
    p.details.length ? el('ul', 'settings-details muted', ...p.details.map((d) => el('li', '', d))) : null,
    p.links.length ? el('div', 'actions', ...p.links.map(linkButton)) : null);
}

/**
 * The guide under the title (T-40): a link to each part, which scrolls to its heading and focuses it, as a
 * link from another page does. On a narrow tab the row wraps.
 */
function guide(m: SettingsModel): HTMLElement {
  const nav = el('nav', 'settings-guide', ...m.guide.map((g) => {
    const a = el('a', 'settings-guide-link', icon(g.icon), el('span', '', g.label)) as HTMLAnchorElement;
    a.href = `#settings-${g.id}`;
    a.dataset.guide = g.part;
    a.addEventListener('click', (e) => { e.preventDefault(); jumpTo(g.part); });
    return a;
  }));
  nav.setAttribute('aria-label', 'Parts of Settings');
  return nav;
}

export function renderSettings(m: SettingsModel): Node[] {
  const head = header('Settings', '');
  head.querySelector('.summary')!.replaceWith(guide(m));
  const out: Node[] = [head];
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
    if (p.id === 'limits') part.append(...renderLimits(m.limits));
    if (p.id === 'trackers') part.append(...trackersPart(m));
    if (p.id === 'slack') part.append(...slackPart(m));
    if (p.id === 'github') part.append(...githubPart(m));
    if (p.id === 'page') part.append(...pagePart(m));
    if (p.id === 'about') part.append(...renderAbout(m.about, m.folded));
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
