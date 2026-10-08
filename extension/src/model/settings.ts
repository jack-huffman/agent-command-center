/**
 * The Settings section (GH-109): the Command Center's own choices on this machine, a part for each area
 * that will gather its settings here, and, until a part is built, where its settings live today.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { intervalWords, POLL_INTERVALS, POLL_KEYS } from '../logic/polls.ts';
import { AGENT_SETTINGS } from './agents.ts';
import type { LimitsModel } from './limits.ts';
import type { HomeSection, ModelArea } from './shared.ts';

// ---------------------------------------------------------------- the theme

/** The Command Center's theme (GH-109): VSCode's own, or Light or Dark whatever VSCode's is. */
export const THEME_CHOICES = ['vscode', 'light', 'dark'] as const;
export type ThemeChoice = (typeof THEME_CHOICES)[number];

/**
 * Where it's kept: a VSCode setting of machine scope, which Settings Sync leaves alone, so it stays on this
 * machine, and every window hears when it changes.
 */
export const THEME_SETTING = { section: 'agentCommandCenter', key: 'theme' } as const;

/** A theme as the setting holds it. Anything else, or nothing, is Match VSCode. */
export const themeChoice = (v: unknown): ThemeChoice => ((THEME_CHOICES as readonly unknown[]).includes(v) ? (v as ThemeChoice) : 'vscode');

export const THEMES: Record<ThemeChoice, { label: string; icon: string; meaning: string }> = {
  vscode: { label: 'Match VSCode', icon: 'vscode', meaning: 'The Command Center follows VSCode\'s theme, whatever it is: light, dark or high contrast.' },
  light: { label: 'Light', icon: 'circle-large-outline', meaning: 'The Command Center, task pages and agent pages are light, whatever VSCode\'s theme is. VSCode keeps its own.' },
  dark: { label: 'Dark', icon: 'circle-large-filled', meaning: 'The Command Center, task pages and agent pages are dark, whatever VSCode\'s theme is. VSCode keeps its own.' },
};

// ---------------------------------------------------------------- the parts

/**
 * Settings' parts, in the order their tasks come: Appearance (GH-109), How agents run (GH-110), Limits and
 * checks (GH-111), Trackers and sign-ins (GH-112), Notices in Slack, GitHub accounts and the page's own
 * preferences (GH-113), and About (GH-114). Each has a heading another page can open Settings at, with
 * show('settings', settingsKey(part)).
 */
export const SETTINGS_PARTS = ['appearance', 'agents', 'limits', 'trackers', 'slack', 'github', 'page', 'about'] as const;
export type SettingsPart = (typeof SETTINGS_PARTS)[number];

/** What opens Settings at a part, from another page: its heading's key. */
export const settingsKey = (part: SettingsPart): string => `settings:${part}`;

/** A way from a part to where its settings live today: a section, and a part of it to open. */
export interface SettingsLink {
  label: string;
  icon: string;
  section: HomeSection;
  /** A part of that section to open as well, as the page remembers it, such as Agents' How agents run. */
  open?: string;
}

export interface SettingsPartModel {
  id: SettingsPart;
  title: string;
  icon: string;
  /** What it holds, in a line. */
  summary: string;
  /** Its settings are here. Until they are, today says where they live, and links go there. */
  built: boolean;
  today: string | null;
  /** More about today, a line each, such as how often each thing refreshes. */
  details: string[];
  links: SettingsLink[];
}

export interface SettingsModel {
  kind: 'settings';
  theme: ThemeChoice;
  themes: { key: ThemeChoice; label: string; icon: string; meaning: string }[];
  parts: SettingsPartModel[];
  /** Limits and checks (GH-111): the caps, what a change means, the heavy-check slots and each project's checks. Null until read. */
  limits: LimitsModel | null;
}

export interface SettingsInput {
  theme: ThemeChoice;
  /** Agents shows How agents run behind its Settings button: there's an onboarded project. */
  agentSettings: boolean;
  /** Limits and checks, as read from this machine and each project (GH-111). */
  limits?: LimitsModel | null;
}

/** How often each thing refreshes today, in words. */
export const refreshLines = (): string[] => POLL_KEYS.map((k) => {
  const p = POLL_INTERVALS[k];
  return `${p.label}: every ${intervalWords(p.everyMs)} while the Command Center is on screen, ${p.hiddenMs ? `every ${intervalWords(p.hiddenMs)}` : 'not at all'} while it isn't.`;
});

export function settingsModel(i: SettingsInput): SettingsModel {
  const later = (id: SettingsPart, title: string, icon: string, summary: string, today: string, links: SettingsLink[] = [], details: string[] = []): SettingsPartModel => ({ id, title, icon, summary, built: false, today, details, links });
  const parts: SettingsPartModel[] = [
    { id: 'appearance', title: 'Appearance', icon: 'color-mode', summary: 'How the Command Center\'s pages look. Kept on this machine, for every window.', built: true, today: null, details: [], links: [] },
    later('agents', 'How agents run', 'hubot', 'What builders and reviewers run with: model, effort and fallback, and what autopilot may do on its own.',
      i.agentSettings ? 'On Agents for now, behind its Settings button.' : 'On Agents for now, behind its Settings button, once this workspace has an onboarded project.',
      i.agentSettings ? [{ label: 'Open How agents run', icon: 'settings-gear', section: 'agents', open: AGENT_SETTINGS }] : []),
    { id: 'limits', title: 'Limits and checks', icon: 'dashboard', summary: 'How many builders run at once, this project\'s cap and this machine\'s total, what a change means, the heavy checks this machine runs at once, and the checks a task must pass. Each change goes through acc.', built: true, today: null, details: [], links: [] },
    later('trackers', 'Trackers and sign-ins', 'issues', 'Each project\'s trackers, their place and board, and the account each signs in as.',
      'On Tasks for now, on each tracker\'s board: its sign-in, its place, and connecting another.', [{ label: 'Open Tasks', icon: 'project', section: 'tasks' }]),
    later('slack', 'Notices in Slack', 'bell', 'Whether acc\'s notices go to Slack, and which.',
      'On Environments for now, in its Notices in Slack card.', [{ label: 'Open Environments', icon: 'server-environment', section: 'environments' }]),
    later('github', 'GitHub accounts', 'github', 'The GitHub account each project\'s repo pushes as.',
      'On Environments for now, in each project\'s account card, and at the foot of the rail.', [{ label: 'Open Environments', icon: 'server-environment', section: 'environments' }]),
    later('page', 'The Command Center', 'window', 'Which section it opens on, how Agents shows where sessions run, and how often it refreshes.',
      'Not a choice yet. It opens where you left it, and Agents\' Where view switches above its table. It refreshes:', [{ label: 'Open Agents', icon: 'hubot', section: 'agents' }], refreshLines()),
    later('about', 'About', 'info', 'The versions of acc, the extension and the plugin, and whether a newer release is out.',
      'On Setup for now: its checklist checks the acc plugin in Claude Code.', [{ label: 'Open Setup', icon: 'checklist', section: 'setup' }]),
  ];
  return { kind: 'settings', theme: i.theme, themes: THEME_CHOICES.map((key) => ({ key, ...THEMES[key] })), parts, limits: i.limits ?? null };
}

export const area: ModelArea = {
  commands: ['acc.settings.theme'],
  home: {
    // Last in the rail, after every other area's.
    order: 90,
    nav: () => ({ section: 'settings', label: 'Settings', icon: 'settings-gear', count: null, attention: false, hint: 'Appearance, limits and checks, and where each other setting lives' }),
  },
};
