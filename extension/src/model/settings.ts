/**
 * The Settings section (GH-109): the Command Center's own choices on this machine, how agents run in each
 * project (GH-110), the limits and checks they run under (GH-111), a part for each area that will gather its
 * settings here, and, until a part is built, where its settings live today.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { autopilotDoes } from '../../../packages/core/src/autopilot.ts';
import { autoMergeOn, type ConfigPath, keyShown, UNREAD_KEYS } from '../../../packages/core/src/config.ts';
import { FROM_WORDS } from '../logic/agents.ts';
import { intervalWords, POLL_INTERVALS, POLL_KEYS } from '../logic/polls.ts';
import type { DoctorItem } from '../logic/setup.ts';
import { billingLook } from './agents.ts';
import type { LimitsModel } from './limits.ts';
import type { HomeSection, Look, ModelArea, ProjectLike } from './shared.ts';

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

// ---------------------------------------------------------------- how agents run (GH-110)

/** Where a setting is set, in words and with an icon: this clone, the project, or nobody, so a default. */
export interface SettingFrom {
  label: string;
  icon: string;
}

/** Beside FROM_WORDS' words: this clone's git config, the project's .acc/config.json, or a default. */
const FROM_ICONS: Record<string, string> = { clone: 'device-desktop', project: 'repo', acc: 'circle-outline', default: 'circle-outline' };
export const settingFrom = (from: string): SettingFrom => ({ label: FROM_WORDS[from] ?? from, icon: FROM_ICONS[from] ?? 'circle-outline' });

/** Autonomy and auto-merge are the project's alone, in its .acc/config.json: no clone sets them. */
const PROJECT: SettingFrom = { label: 'project', icon: 'repo' };

/** What builders or reviewers run with (D-036, D-086): each part, and where it's set. */
export interface AgentSetting {
  role: 'builder' | 'reviewer';
  label: string;
  icon: string;
  /** Each part in words, with where it's set, and the config key it is (GH-107). */
  parts: { key: ConfigPath; name: string; value: string; from: SettingFrom }[];
}

/** What autopilot may do on its own in a project (D-055), changed through acc (D-064). */
export interface AutonomySetting {
  key: 'autonomy';
  /** The level, with an icon: orange for one autopilot refuses. */
  look: Look;
  from: SettingFrom;
  /** What that level means, in words. */
  meaning: string;
}

/** Whether autopilot merges pull requests in a project (GH-67, D-083), changed through acc. */
export interface AutoMergeSetting {
  key: 'autopilot.autoMerge';
  look: Look;
  from: SettingFrom;
  meaning: string;
  /** Whether a person can change it here: a Salesforce project never auto-merges. */
  settable: boolean;
}

/** One project's settings for its agents, under its name: a project setting always says whose it is. */
export interface AgentRunProject {
  root: string;
  project: string;
  roles: AgentSetting[];
  autonomy: AutonomySetting | null;
  autoMerge: AutoMergeSetting | null;
}

export interface HowAgentsRun {
  projects: AgentRunProject[];
  /**
   * What this machine's agents bill (D-036), the same for every project, so said once. Per token, or not
   * checked yet, it has a way to Setup, whose check says why and how to fix it.
   */
  billing: { look: Look; link: SettingsLink | null };
}

/** Keys nothing reads yet, which How agents run shows no row for (GH-107): UNREAD_KEYS, or a test's own. */
type Unread = Partial<Record<ConfigPath, string>>;

/** Builders' and reviewers' model, effort and fallback (D-036), each part tagged with its key, and none whose key nothing reads (GH-107). */
export function agentSettings(p: ProjectLike, unread: Unread = UNREAD_KEYS): AgentSetting[] {
  if (!p.agents) return [];
  const role = (r: 'builder' | 'reviewer'): AgentSetting | null => {
    const v = p.agents![r];
    const parts = [
      { key: `agents.${r}.model` as const, name: 'Model', value: v.model ?? 'default', from: settingFrom(v.from.model) },
      { key: `agents.${r}.effort` as const, name: 'Effort', value: v.effort ?? 'default', from: settingFrom(v.from.effort) },
      ...(v.fallbackModel ? [{ key: `agents.${r}.fallbackModel` as const, name: 'Falls back to', value: v.fallbackModel, from: settingFrom(v.from.fallbackModel) }] : []),
    ].filter((x) => keyShown(x.key, unread));
    return parts.length ? { role: r, label: r === 'builder' ? 'Builders' : 'Reviewers', icon: r === 'builder' ? 'tools' : 'checklist', parts } : null;
  };
  return [role('builder'), role('reviewer')].filter((x) => x !== null);
}

/** The project's autonomy, set in .acc/config.json and changed through acc (D-064). Review says whether autopilot merges (GH-67). */
export function autonomySetting(p: ProjectLike, unread: Unread = UNREAD_KEYS): AutonomySetting | null {
  const value = p.config.autonomy;
  if (!value || !keyShown('autonomy', unread)) return null;
  const refused = 'Not built yet: autopilot refuses.';
  const levels: Record<string, { icon: string; meaning: string }> = {
    manual: { icon: 'debug-pause', meaning: 'Nothing happens on its own.' },
    review: { icon: 'rocket', meaning: `Autopilot ${autopilotDoes(autoMergeOn(p.config))}` },
    dispatch: { icon: 'warning', meaning: refused },
    full: { icon: 'warning', meaning: refused },
  };
  const level = Object.hasOwn(levels, value) ? levels[value]! : { icon: 'question', meaning: '' };
  return { key: 'autonomy', look: { label: value, icon: level.icon, tone: level.meaning === refused ? 'orange' : 'neutral' }, from: PROJECT, meaning: level.meaning };
}

/** Whether autopilot merges a reviewed, green pull request (GH-67), set in .acc/config.json and changed through acc. */
export function autoMergeSetting(p: ProjectLike, unread: Unread = UNREAD_KEYS): AutoMergeSetting | null {
  if (!p.config.autonomy || !keyShown('autopilot.autoMerge', unread)) return null;
  const key = 'autopilot.autoMerge';
  const off: Look = { label: 'off', icon: 'circle-slash', tone: 'neutral' };
  if (p.config.profile === 'salesforce') return { key, look: off, from: PROJECT, meaning: 'A Salesforce project never auto-merges: a person merges every pull request.', settable: false };
  if (!autoMergeOn(p.config)) return { key, look: off, from: PROJECT, meaning: 'Autopilot never merges a pull request: a person merges each one.', settable: true };
  const kept = p.config.environments.filter((e) => e.protected).map((e) => e.name);
  const meaning = [
    'A pull request whose review and checks passed, with nothing waiting on you, joins the merge queue, and they merge in turn: its base merged in, the full check run once, then merged once GitHub says it can.',
    kept.length ? `Never into ${kept.join(', ')}: protected.` : '',
    p.config.autonomy === 'review' ? '' : 'Autonomy is manual, so nothing merges on its own.',
  ].filter(Boolean).join(' ');
  return { key, look: { label: 'on', icon: 'git-merge', tone: 'neutral' }, from: PROJECT, meaning, settable: true };
}

/** How agents run in each onboarded project, and what they bill on this machine. */
export function howAgentsRun(projects: ProjectLike[], setup: DoctorItem[], unread: Unread = UNREAD_KEYS): HowAgentsRun {
  const billing = billingLook(setup);
  const toSetup: SettingsLink = { label: 'Open Setup', icon: 'checklist', section: 'setup' };
  return {
    projects: projects.filter((p) => p.agents).map((p) => ({ root: p.root, project: p.name, roles: agentSettings(p, unread), autonomy: autonomySetting(p, unread), autoMerge: autoMergeSetting(p, unread) })),
    billing: billing
      ? { look: billing, link: billing.tone === 'blue' ? null : toSetup }
      : { look: { label: 'Not checked yet: Setup checks it', icon: 'circle-outline', tone: 'neutral' }, link: toSetup },
  };
}

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

/** A way from a part to where its settings live today, or to what it needs first: a section. */
export interface SettingsLink {
  label: string;
  icon: string;
  section: HomeSection;
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
  /** More about it, a line each, such as how often each thing refreshes, or where a change is kept. */
  details: string[];
  /** Not built, where its settings live today; built, what it needs first, such as a project to set. */
  links: SettingsLink[];
}

export interface SettingsModel {
  kind: 'settings';
  theme: ThemeChoice;
  themes: { key: ThemeChoice; label: string; icon: string; meaning: string }[];
  /** How agents run (GH-110). */
  agents: HowAgentsRun;
  parts: SettingsPartModel[];
  /** Limits and checks (GH-111): the caps, what a change means, the heavy-check slots and each project's checks. Null until read. */
  limits: LimitsModel | null;
}

export interface SettingsInput {
  theme: ThemeChoice;
  /** The workspace's onboarded projects, whose agents' settings How agents run shows. */
  projects: ProjectLike[];
  /** Setup's checks, for what agents bill. */
  setup: DoctorItem[];
  /** Limits and checks, as read from this machine and each project (GH-111), while Settings shows. */
  limits?: LimitsModel | null;
}

/** How often each thing refreshes today, in words. */
export const refreshLines = (): string[] => POLL_KEYS.map((k) => {
  const p = POLL_INTERVALS[k];
  return `${p.label}: every ${intervalWords(p.everyMs)} while the Command Center is on screen, ${p.hiddenMs ? `every ${intervalWords(p.hiddenMs)}` : 'not at all'} while it isn't.`;
});

export function settingsModel(i: SettingsInput): SettingsModel {
  const agents = howAgentsRun(i.projects, i.setup);
  const later = (id: SettingsPart, title: string, icon: string, summary: string, today: string, links: SettingsLink[] = [], details: string[] = []): SettingsPartModel => ({ id, title, icon, summary, built: false, today, details, links });
  const parts: SettingsPartModel[] = [
    { id: 'appearance', title: 'Appearance', icon: 'color-mode', summary: 'How the Command Center\'s pages look. Kept on this machine, for every window.', built: true, today: null, details: [], links: [] },
    {
      id: 'agents', title: 'How agents run', icon: 'hubot', summary: 'What builders and reviewers run with in each project: model, effort and fallback, and what autopilot may do on its own. Each Change… asks acc to make the change.',
      built: true, today: null,
      details: agents.projects.length
        ? ['This clone\'s choice is kept in its git config, where nobody else sees it. A project\'s is kept in its .acc/config.json, for you to commit and share.']
        : ['No project in this workspace is onboarded yet. Once Setup onboards one, its builders and reviewers show here.'],
      links: agents.projects.length ? [] : [{ label: 'Open Setup', icon: 'checklist', section: 'setup' }],
    },
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
  return { kind: 'settings', theme: i.theme, themes: THEME_CHOICES.map((key) => ({ key, ...THEMES[key] })), agents, parts, limits: i.limits ?? null };
}

export const area: ModelArea = {
  // How agents run's Change… buttons run the Agents area's commands, which this section draws now (GH-110).
  commands: ['acc.settings.theme', 'acc.agents.configure', 'acc.agents.autonomy', 'acc.agents.autoMerge'],
  home: {
    // Last in the rail, after every other area's.
    order: 90,
    nav: () => ({ section: 'settings', label: 'Settings', icon: 'settings-gear', count: null, attention: false, hint: 'Appearance, how agents run, limits and checks, and where each other setting lives' }),
  },
};
