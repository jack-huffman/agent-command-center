// Settings' guide (T-40): a link to each part under the page's title, and which explanations fold away
// under "What this means". Nothing here touches the page, so tests read it as the page does.

import type { SettingsModel, SettingsPartModel } from '../src/model/settings.ts';

/** The longest explanation a row keeps in view, in characters, when it is one sentence. */
export const SHORT_MEANING = 90;

/** What Billing's row says under its state; the page draws it, and settingsMeanings lists it. */
export const BILLING_MEANING = 'This machine\'s, for every project. Agents shows it too while it\'s per token.';

/** True when an explanation goes into a closed "What this means": more than one sentence, or a long one. */
export const foldsMeaning = (text: string): boolean => text.length > SHORT_MEANING || /[.!?]\s+\S/.test(text.trim());

/** Where the tab remembers an explanation as opened. */
export const meaningKey = (id: string): string => `settings-meaning:${id}`;

/** A link of the guide: the part's title and icon, and the heading it opens (data-part, as settingsKey makes it). */
export interface GuideLink { id: string; label: string; icon: string; part: string }

/** A link for each part of Settings, in the page's order. */
export const settingsGuide = (parts: SettingsPartModel[]): GuideLink[] => parts.map((p) => ({ id: p.id, label: p.title, icon: p.icon, part: `settings:${p.id}` }));

/**
 * Every row's explanation the page draws, in its order, under the id it remembers it by: the theme's, each
 * project's autonomy, auto-merge and cloud builders, Billing, each preference, and each version in About.
 * An empty one isn't drawn.
 */
export function settingsMeanings(m: SettingsModel): { id: string; text: string }[] {
  const theme = m.themes.find((t) => t.key === m.theme) ?? m.themes[0];
  const out = [
    { id: 'theme', text: theme?.meaning ?? '' },
    ...m.agents.projects.flatMap((s) => [
      { id: `autonomy:${s.root}`, text: s.autonomy?.meaning ?? '' },
      { id: `auto-merge:${s.root}`, text: s.autoMerge?.meaning ?? '' },
      { id: `cloud:${s.root}`, text: s.cloud?.meaning ?? '' },
    ]),
    { id: 'billing', text: BILLING_MEANING },
    ...m.page.preferences.map((p) => ({ id: `page:${p.id}`, text: p.meaning })),
    ...(m.about?.rows ?? []).map((r) => ({ id: `about:${r.key}`, text: r.meaning ?? '' })),
  ];
  return out.filter((x) => x.text);
}
