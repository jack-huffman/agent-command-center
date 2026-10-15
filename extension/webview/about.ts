// Settings' About (GH-114): the versions of acc, the extension and the plugin, each with where it's read
// from, then the latest release, with its notes when it's newer, and Check now. Every button asks the
// extension: Check now reads again, and the plugin's Update is Setup's own A4 fix. The page writes nothing.

import type { AboutAction, AboutModel, AboutRow } from '../src/model/about.ts';
import type { SettingFrom } from '../src/model/settings.ts';
import { argButton, el, icon, linkTo, status, toolbarButton, whatThisMeans } from './dom.ts';

/** A button for one of About's commands, named for what it does. One that can't be used now says why. */
function aboutButton(a: AboutAction): HTMLElement {
  const b = (a.arg === null ? toolbarButton(a.command, a.label, a.icon, undefined, a.primary) : argButton(a.command, a.label, a.icon, a.arg, a.primary)) as HTMLButtonElement;
  b.setAttribute('aria-label', a.name);
  if (a.disabled) {
    b.disabled = true;
    b.title = a.disabled;
    b.setAttribute('aria-description', a.disabled);
  }
  return b;
}

const from = (f: SettingFrom): HTMLElement => el('span', 'settings-from muted small', icon(f.icon), f.label);

/** A version: its name, its state in words with an icon, where it's read from, what it means, and its fix. */
function versionRow(r: AboutRow, folded: readonly string[]): HTMLElement {
  const row = el('div', 'settings-row has-change about-row',
    el('span', 'settings-name', icon(r.icon), el('span', 'strong', r.name)),
    el('div', 'settings-value', el('div', 'settings-now', status(r.look), from(r.from)), whatThisMeans(`about:${r.key}`, r.meaning ?? '', folded)),
    r.action ? aboutButton(r.action) : null);
  row.dataset.about = r.key;
  return row;
}

export function renderAbout(m: AboutModel | null, folded: readonly string[]): Node[] {
  if (!m) return [el('p', 'settings-tracker-none', status({ label: 'Reading the versions', icon: 'sync~spin', tone: 'blue' }))];
  const r = m.release;
  const release = el('div', 'settings-row has-change about-row about-release',
    el('span', 'settings-name', icon('tag'), el('span', 'strong', 'Latest release')),
    el('div', 'settings-value',
      el('div', 'settings-now', status(r.look), r.notes ? linkTo(r.notes.url, icon('link-external'), r.notes.label) : null),
      el('p', 'muted small settings-meaning', r.when)),
    aboutButton(r.check));
  release.dataset.about = 'release';
  return [...m.rows.map((r) => versionRow(r, folded)), release];
}
