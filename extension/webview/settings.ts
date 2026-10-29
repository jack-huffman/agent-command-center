// The Settings section (GH-109): Appearance, How agents run (GH-110), Limits and checks (GH-111), Trackers and sign-ins
// (GH-112), Notices in Slack, GitHub accounts and the Command Center's own preferences (GH-113), and About (GH-114),
// grouped into a few named sections with a jump list (T-139). One section shows at a time, the one picked last.

import type { AgentRunProject, GithubAccountSetting, PagePreference, SettingFrom, SettingsLink, SettingsModel, SettingsPartModel, SettingsSectionModel, TrackerProject, TrackerSetting } from '../src/model/settings.ts';
import { argButton, button, el, header, icon, more, plural, segmented, settingsButton, status, whatThisMeans } from './dom.ts';
import { renderAbout } from './about.ts';
import { changesFieldValue } from './changes-field.ts';
import { renderLimits } from './limits.ts';
import { slackCardView } from './slack.ts';
import { api, go, memory, remember, type PageArea } from './state.ts';

/** A list longer than this shows its first few, and folds the rest under a count (T-139). */
export const LONG_LIST = 3;

/** Where a setting is set (this clone, the project, or a default): a hint on hover, not words on the page (T-139). */
function kept<T extends HTMLElement>(node: T, f: SettingFrom | null): T {
  if (f) node.title = `Set in: ${f.label}`;
  return node;
}

/** A long list: its first LONG_LIST items, and the rest folded under "n more". A short one is all in view. */
function longList(id: string, items: HTMLElement[], noun: string, wrap: (items: HTMLElement[]) => HTMLElement): HTMLElement[] {
  if (items.length <= LONG_LIST + 1) return [wrap(items)];
  const rest = items.slice(LONG_LIST);
  return [wrap(items.slice(0, LONG_LIST)), more(id, [el('span', '', `${rest.length} more ${noun}`)], wrap(rest))];
}

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

/** A row of How agents run: its name, what it is now, and its Change…, named for what and whose it changes. */
function row(name: string, iconName: string, value: HTMLElement, change: HTMLElement | null, changes: string): HTMLElement {
  if (change) change.setAttribute('aria-label', `Change ${changes}`);
  return el('div', 'settings-row has-change', el('span', 'settings-name', icon(iconName), el('span', 'strong', name)), el('div', 'settings-value', value), change);
}

/**
 * One project's agents, under its name (GH-110): builders' and reviewers' model, effort and fallback, its
 * autonomy (D-064) and auto-merge (D-083), each with its Change…, which asks acc. Where each is set is its hint.
 */
function agentProject(s: AgentRunProject, folded: readonly string[]): HTMLElement {
  const box = el('div', 'settings-project');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', s.project);
  box.append(el('h3', 'settings-project-name', icon('repo'), el('span', '', s.project)));
  for (const r of s.roles) {
    // A model acc no longer offers says so on a line of its own, under its value (D-128).
    const parts = el('div', 'settings-parts', ...r.parts.flatMap((p) => [el('span', 'muted', p.name), kept(el('span', 'mono strong settings-setting', p.value), p.from),
      ...(p.older ? [el('span', 'settings-older muted small', icon('history'), el('span', '', p.older))] : [])]));
    box.append(row(r.label, r.icon, parts, argButton('acc.agents.configure', 'Change…', 'edit', `${r.role}|${s.root}`), `${r.label.toLowerCase()}' model, effort or fallback, in ${s.project}`));
  }
  if (s.autonomy) {
    const value = el('div', '', el('div', 'settings-now', kept(status(s.autonomy.look), s.autonomy.from)), whatThisMeans(`autonomy:${s.root}`, s.autonomy.meaning, folded));
    box.append(row('Autonomy', 'rocket', value, argButton('acc.agents.autonomy', 'Change…', 'edit', s.root), `what autopilot may do on its own, in ${s.project}`));
  }
  if (s.autoMerge) {
    const value = el('div', '', el('div', 'settings-now', kept(status(s.autoMerge.look), s.autoMerge.from)), whatThisMeans(`auto-merge:${s.root}`, s.autoMerge.meaning, folded));
    // A Salesforce project never auto-merges, so it has no Change… (D-083): its meaning says why.
    box.append(row('Auto-merge', 'git-merge', value, s.autoMerge.settable ? argButton('acc.agents.autoMerge', 'Change…', 'edit', s.root) : null, `whether autopilot merges pull requests, in ${s.project}`));
  }
  if (s.cloud) {
    // Cloud builders (GH-69): the switch and where a plain dispatch goes; what it needs, and what GitHub enforces
    // behind the guard, each a fold that counts them (T-139), with why in full on hover.
    const c = s.cloud;
    const missing = c.needs.filter((n) => !n.ok).length;
    const needs = more(`cloud-needs:${s.root}`, [status({ label: missing ? `${missing} of ${c.needs.length} needed still missing` : `All ${c.needs.length} it needs are ready`, icon: missing ? 'warning' : 'pass', tone: missing ? 'orange' : 'blue' })],
      el('ul', 'settings-needs', ...c.needs.map((n) => el('li', `settings-need${n.ok ? ' ok' : ''}`, status({ label: n.label, icon: n.ok ? 'pass' : 'circle-large-outline', tone: n.ok ? 'blue' : 'orange' }), n.ok ? null : el('span', 'muted small', ` ${n.fix}`)))));
    const protection = c.protection.length ? more(`cloud-protection:${s.root}`, [el('span', '', `Branch protection · ${plural(c.protection.length, 'branch', 'branches')}`)],
      el('ul', 'settings-needs', ...c.protection.map((p) => Object.assign(el('li', `settings-need${p.look.tone === 'blue' ? ' ok' : ''}`, status(p.look), p.look.tone === 'blue' ? null : el('span', 'muted small', ` ${p.why}`)), { title: p.why })))) : null;
    const value = el('div', '',
      el('div', 'settings-now', kept(status(c.look), c.from), c.defaultPlace ? el('span', 'settings-place-to muted small', icon(c.defaultPlace.icon), `plain dispatch: ${c.defaultPlace.label}`) : null, c.reviewPlace ? el('span', 'settings-place-to muted small', icon(c.reviewPlace.icon), `reviews: ${c.reviewPlace.label}`) : null),
      whatThisMeans(`cloud:${s.root}`, c.meaning, folded),
      c.look.label === 'off' ? null : needs,
      protection,
      el('div', 'actions settings-tracker-actions', ...c.actions.map(settingsButton)));
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
 * One tracker (GH-112): its name with its buttons, then its place, its board, its sign-in and where a ticket's
 * changes are kept, each a row; where each is kept is its hint (T-139). Change tracker… is where changing it starts.
 */
function tracker(t: TrackerSetting): HTMLElement {
  const box = el('div', 'settings-tracker');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', t.title);
  const line = (name: string, iconName: string, value: HTMLElement, f: SettingFrom | null) =>
    el('div', 'settings-row settings-tracker-row', el('span', 'settings-name', icon(iconName), el('span', 'strong', name)), kept(el('div', 'settings-value settings-now', value), f));
  box.append(
    el('div', 'settings-tracker-head', el('h4', 'settings-tracker-name', icon(t.icon), el('span', '', t.title)), el('div', 'actions settings-tracker-actions', ...t.actions.map(settingsButton))),
    line('Place', 'location', el('span', 'settings-place', t.place), t.from),
    line('Board', 'layout', status(t.board), t.from),
    line('Sign-in', 'account', status(t.signIn), t.signInFrom),
    // Where a ticket's changes are kept (T-105): a row of its own, with its own button.
    line(t.changes.short, 'note', changesFieldValue(t.changes), t.from),
  );
  return box;
}

/** A project's trackers, under its name with their count, or that it has none yet. A long list folds the rest. */
function trackerProject(p: TrackerProject): HTMLElement {
  const box = el('div', 'settings-project');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', p.project);
  box.append(el('h3', 'settings-project-name', icon('repo'), el('span', '', p.project), p.trackers.length ? el('span', 'muted settings-count', plural(p.trackers.length, 'tracker')) : null));
  if (p.loading) box.append(el('p', 'settings-tracker-none', status({ label: 'Reading its trackers', icon: 'sync~spin', tone: 'blue' })));
  else if (!p.trackers.length) box.append(el('p', 'settings-tracker-none', status({ label: 'No tracker yet', icon: 'circle-outline', tone: 'neutral' })));
  box.append(...longList(`trackers:${p.root}`, p.trackers.map(tracker), 'trackers', (items) => el('div', 'settings-list', ...items)));
  return box;
}

/** Trackers and sign-ins (GH-112): every open project's trackers, then Connect a tracker. */
function trackersPart(m: SettingsModel): Node[] {
  return [...m.trackers.projects.map(trackerProject), ...(m.trackers.connect ? [el('div', 'actions settings-links', settingsButton(m.trackers.connect))] : [])];
}

/**
 * One project's GitHub account (GH-113), under its name: who its repo pushes as, gh's sign-in and the commit
 * identity, and Switch…, which asks acc to make the change. This clone's or the project's is its hint.
 */
function githubProject(g: GithubAccountSetting): HTMLElement {
  const box = el('div', 'settings-project settings-github');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', g.project);
  box.append(
    el('div', 'settings-tracker-head', el('h4', 'settings-project-name', icon('repo'), el('span', '', g.project)), el('div', 'actions settings-tracker-actions', ...g.actions.map(settingsButton))),
    el('div', 'settings-row settings-tracker-row', el('span', 'settings-name', icon('github'), el('span', 'strong', 'Pushes as')),
      el('div', 'settings-value', el('div', 'settings-now', kept(status(g.look), g.from)),
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
 * asking for its command with the choice, and what the one chosen means. Where VSCode keeps it is its hint.
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
    el('div', 'settings-value', kept(el('div', 'settings-now', pick), p.from), whatThisMeans(`page:${p.id}`, p.meaning, folded)));
}

/** The Command Center's own preferences (GH-113), then how often each part refreshes at the pace chosen, folded with its count. */
function pagePart(m: SettingsModel): Node[] {
  const refresh = m.page.refresh;
  return [...m.page.preferences.map((p) => preference(p, m.folded)),
    refresh.length ? more('refresh', [el('span', '', `How often each part refreshes · ${refresh.length}`)], el('ul', 'settings-details muted small', ...refresh.map((d) => el('li', '', d)))) : null]
    .filter((x): x is HTMLElement => !!x);
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

/** What a part draws, by its id. */
function partBody(p: SettingsPartModel, m: SettingsModel): Node[] {
  if (p.id === 'appearance') return [appearance(m)];
  if (p.id === 'agents') return howAgentsRun(m);
  if (p.id === 'limits') return renderLimits(m.limits);
  if (p.id === 'trackers') return trackersPart(m);
  if (p.id === 'slack') return slackPart(m);
  if (p.id === 'github') return githubPart(m);
  if (p.id === 'page') return pagePart(m);
  return renderAbout(m.about, m.folded);
}

/**
 * A part, where another page opens Settings at it: a group named for it, its data-part what a deep link names.
 * Its notes, how its settings are kept, fold under "How these are kept"; with no project yet they're its state,
 * in view beside the way to Setup.
 */
function part(p: SettingsPartModel, m: SettingsModel, headed: boolean): HTMLElement {
  const box = el('div', `settings-part${p.built ? '' : ' later'}`, headed ? el('h3', 'settings-part-name', icon(p.icon), el('span', '', p.title)) : null);
  box.id = `settings-${p.id}`;
  box.tabIndex = -1;
  box.dataset.part = `settings:${p.id}`;
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', p.title);
  if (!p.built) {
    box.append(today(p));
    return box;
  }
  box.append(...partBody(p, m));
  if (p.details.length && p.links.length) box.append(...p.details.map((d) => el('p', 'muted small settings-note', d)), el('div', 'actions settings-links', ...p.links.map(linkButton)));
  else if (p.details.length) box.append(more(`notes:${p.id}`, [el('span', '', 'How these are kept')], ...p.details.map((d) => el('p', 'muted small settings-meaning', d))));
  return box;
}

/** The section on show: the one the tab remembers, or the first. */
export const shownSection = (sections: readonly SettingsSectionModel[]): SettingsSectionModel | undefined =>
  sections.find((s) => s.id === memory().settings) ?? sections[0];

export function renderSettings(m: SettingsModel): Node[] {
  const head = header('Settings', '');
  const shown = shownSection(m.sections);
  const panels: HTMLElement[] = [];
  const links: HTMLElement[] = [];
  const picker = document.createElement('select');
  /** Shows one section and hides the rest, marks its link and the picker, and remembers it; no redraw, so a deep link's part stays the element it found. */
  const show = (id: string): void => {
    remember((x) => { x.settings = id; });
    for (const p of panels) p.hidden = p.dataset.section !== id;
    for (const a of links) {
      if (a.dataset.section === id) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
    picker.value = id;
  };
  /** A jump: its section shows, and its heading takes focus, so a screen reader starts there too. */
  const jump = (id: string): void => {
    show(id);
    panels.find((p) => p.dataset.section === id)?.querySelector<HTMLElement>('.settings-section-name')?.focus({ preventScroll: true });
  };
  for (const s of m.sections) {
    const a = el('a', 'settings-jump-link', icon(s.icon), el('span', '', s.title));
    a.setAttribute('href', `#settings-section-${s.id}`);
    a.dataset.section = s.id;
    if (s.id === shown?.id) a.setAttribute('aria-current', 'true');
    a.addEventListener('click', (e) => { (e as Event).preventDefault(); jump(s.id); });
    links.push(a);
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = s.title;
    picker.append(o);
  }
  const nav = el('nav', 'settings-jump', ...links);
  nav.setAttribute('aria-label', 'Sections of Settings');
  // Under 760 px the list at the side gives way to this picker above the section.
  picker.className = 'select-input settings-picker';
  picker.setAttribute('aria-label', 'Section of Settings');
  picker.dataset.keep = 'settings-picker';
  picker.value = shown?.id ?? '';
  picker.addEventListener('change', () => jump(picker.value));
  const byId = new Map(m.parts.map((p) => [p.id, p]));
  for (const s of m.sections) {
    const h = el('h2', 'settings-section-name', icon(s.icon), el('span', '', s.title));
    h.id = `settings-section-${s.id}`;
    h.tabIndex = -1;
    const sec = el('section', 'settings-section', h, el('p', 'muted settings-line', s.line),
      ...s.parts.flatMap((id) => { const p = byId.get(id); return p ? [part(p, m, s.headed)] : []; }));
    sec.dataset.section = s.id;
    sec.setAttribute('aria-labelledby', h.id);
    sec.hidden = s.id !== shown?.id;
    // A deep link to a part in this section while another shows (state.ts's jumpTo).
    sec.addEventListener('reveal', () => show(s.id));
    panels.push(sec);
  }
  return [head, el('div', 'settings-layout', nav, el('div', 'settings-main', el('div', 'settings-pick-section', picker), ...panels))];
}

export const area: PageArea = {
  sections: { settings: { draw: (m) => renderSettings(m.settings) } },
  views: { settings: renderSettings },
};
