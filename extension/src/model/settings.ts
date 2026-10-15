/**
 * The Settings section (GH-109): the Command Center's own choices on this machine, how agents run in each
 * project (GH-110), the limits and checks they run under (GH-111), a part for each area that will gather its
 * settings here, and, until a part is built, where its settings live today.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import { autopilotDoes } from '../../../packages/core/src/autopilot.ts';
import { autoMergeOn, type ConfigPath, keyShown, UNREAD_KEYS } from '../../../packages/core/src/config.ts';
import { BUILDER_PLACE_LOOK, type CloudNeed, cloudOffered, cloudReason } from '../../../packages/core/src/cloud.ts';
import type { Protection } from '../../../packages/core/src/protection.ts';
import { describe } from '../../../packages/core/src/trackers/connect.ts';
import type { TrackerKind } from '../../../packages/core/src/trackers/types.ts';
import { FROM_WORDS, OLDER_MODELS } from '../logic/agents.ts';
import { signInScope } from '../logic/connect.ts';
import { intervalWords, type Pace, PACE_WORDS, PACES, POLL_INTERVALS, POLL_KEYS, pollEvery } from '../logic/polls.ts';
import type { DoctorItem } from '../logic/setup.ts';
import type { SlackCard } from '../slack.ts';
import { billingLook, WHERE_VIEWS, type WhereView } from './agents.ts';
import type { BoardInput } from './boards.ts';
import type { IdentityCard } from './environments.ts';
import type { AboutModel } from './about.ts';
import type { LimitsModel } from './limits.ts';
import { HOME_SECTIONS, type HomeSection, type Look, LOOK, type ModelArea, type ProjectLike, VIEW_TITLES } from './shared.ts';

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
  /**
   * Each part in words, with where it's set, and the config key it is (GH-107). A model acc no longer
   * offers says so (D-128): it still runs.
   */
  parts: { key: ConfigPath; name: string; value: string; from: SettingFrom; older?: string }[];
}

/** What Settings says of a model acc no longer offers (D-128), or nothing. */
export function olderModelWords(model: string | null): string | undefined {
  const o = OLDER_MODELS.find((m) => m.name === model);
  return o ? `${o.about} is an older model. It still runs; acc now offers ${o.instead} in its place.` : undefined;
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

/**
 * Cloud builders for a project (GH-69): the switch, a person's choice, what it needs and what's still
 * missing, and where a plain dispatch goes. Never on by default.
 */
export interface CloudSetting {
  key: 'agents.cloud.routine';
  /** On or off, with an icon; orange while it's on but something it needs is missing. */
  look: Look;
  from: SettingFrom;
  meaning: string;
  /** Each need from the config: the repo on GitHub, the opt-in, the routine. The token and sign-in are Setup's checks. */
  needs: { label: string; ok: boolean; fix: string }[];
  /** Where a plain dispatch goes, with an icon, while it's on. */
  defaultPlace: Look | null;
  /**
   * What GitHub enforces on each environment branch, while it's on (GH-69): a row per branch, orange where
   * nothing is enforced, since a push the guard didn't catch would then be caught after the fact, not
   * prevented. Empty until read.
   */
  protection: { branch: string; look: Look; why: string }[];
  /** The buttons: turn on or off, the routine prompt, the token, the default. Disabled, each says why. */
  actions: SettingsAction[];
}

/** How a branch's protection shows (GH-69): enforced in blue, anything else in orange, each with an icon. */
export function protectionLook(p: Pick<Protection, 'branch' | 'state'>): Look {
  if (p.state === 'enforced') return { label: `${p.branch}: GitHub enforces its rules`, icon: 'shield', tone: 'blue' };
  if (p.state === 'none') return { label: `${p.branch}: no protection or ruleset`, icon: 'warning', tone: 'orange' };
  if (p.state === 'unavailable') return { label: `${p.branch}: protection isn't on this plan`, icon: 'warning', tone: 'orange' };
  return { label: `${p.branch}: protection not known`, icon: 'question', tone: 'orange' };
}

/** One project's settings for its agents, under its name: a project setting always says whose it is. */
export interface AgentRunProject {
  root: string;
  project: string;
  roles: AgentSetting[];
  autonomy: AutonomySetting | null;
  autoMerge: AutoMergeSetting | null;
  cloud: CloudSetting | null;
}

export interface HowAgentsRun {
  projects: AgentRunProject[];
  /**
   * What this machine's agents bill (D-036), the same for every project, so said once. Per token, or not
   * checked yet, it has a way to Setup, whose check says why and how to fix it. Its meaning is under its state.
   */
  billing: { look: Look; link: SettingsLink | null; meaning: string };
}

/** Keys nothing reads yet, which How agents run shows no row for (GH-107): UNREAD_KEYS, or a test's own. */
type Unread = Partial<Record<ConfigPath, string>>;

/** Builders' and reviewers' model, effort and fallback (D-036), each part tagged with its key, and none whose key nothing reads (GH-107). */
export function agentSettings(p: ProjectLike, unread: Unread = UNREAD_KEYS): AgentSetting[] {
  if (!p.agents) return [];
  const role = (r: 'builder' | 'reviewer'): AgentSetting | null => {
    const v = p.agents![r];
    const parts = [
      { key: `agents.${r}.model` as const, name: 'Model', value: v.model ?? 'default', from: settingFrom(v.from.model), older: olderModelWords(v.model) },
      { key: `agents.${r}.effort` as const, name: 'Effort', value: v.effort ?? 'default', from: settingFrom(v.from.effort) },
      ...(v.fallbackModel ? [{ key: `agents.${r}.fallbackModel` as const, name: 'Falls back to', value: v.fallbackModel, from: settingFrom(v.from.fallbackModel), older: olderModelWords(v.fallbackModel) }] : []),
    ].map(({ older, ...x }) => (older ? { ...x, older } : x)).filter((x) => keyShown(x.key, unread));
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

/** Cloud builders (GH-69): off unless the project opted in, with what it still needs and the buttons to change it. */
export function cloudSetting(p: ProjectLike, unread: Unread = UNREAD_KEYS, protection: Protection[] | null = null): CloudSetting | null {
  if (!keyShown('agents.cloud.routine', unread)) return null;
  const cloud = p.config.agents?.cloud ?? null;
  const needs: CloudNeed[] = cloudOffered({ github: p.config.github, agents: { cloud } });
  const reason = cloudReason(needs);
  const github = !!p.config.github;
  const on = !!cloud;
  const look: Look = !on ? { label: 'off', icon: 'circle-slash', tone: 'neutral' } : reason ? { label: 'on, not ready', icon: 'warning', tone: 'orange' } : { label: 'on', icon: 'cloud', tone: 'blue' };
  const meaning = !on
    ? github ? 'A local builder is the default everywhere. Turn this on to offer Dispatch to the cloud for each task: a Claude Code cloud session the project\'s routine starts, followed through its branch on GitHub.' : 'Cloud builders need the repo on GitHub: a cloud session clones it from there and pushes its branch back.'
    : `Each task can go to the cloud, from Dispatch to the cloud on its card, or stay on this Mac. ${reason ? `${reason}.` : 'Setup checks the routine\'s token, the claude.ai sign-in and the push guard.'} Checks that need an org login run on this Mac when acc collects the branch; where GitHub enforces no protection on a branch, a push past the guard would be caught then, after the fact.`;
  const action = (command: string, label: string, icon: string, name: string, primary = false, disabled: string | null = null): SettingsAction => ({ command, label, icon, arg: p.root, name, primary, disabled });
  const actions: SettingsAction[] = !on
    ? [action('acc.cloud.enable', 'Turn on…', 'cloud', `Turn on cloud builders for ${p.name}`, false, github ? null : 'Cloud builders need the repo on GitHub')]
    : [
      action('acc.cloud.routine', 'Routine prompt', 'clippy', `Copy the routine prompt for ${p.name}`),
      action('acc.cloud.enable', cloud?.routine ? 'Change routine…' : 'Add the routine…', 'edit', `${cloud?.routine ? 'Change routine' : 'Add the routine'}: give acc ${p.name}'s routine`, !cloud?.routine),
      action('acc.cloud.token', 'Token…', 'key', `Token: keep the routine's token for ${p.name}`),
      action('acc.cloud.default', 'Default…', 'arrow-swap', `Default: choose where ${p.name}'s builders go`),
      action('acc.cloud.disable', 'Turn off', 'circle-slash', `Turn off cloud builders for ${p.name}`),
    ];
  return {
    key: 'agents.cloud.routine', look, from: PROJECT, meaning, needs: needs.map((n) => ({ label: n.label, ok: n.ok, fix: n.fix })),
    defaultPlace: cloud ? { ...BUILDER_PLACE_LOOK[cloud.default], tone: 'neutral' } : null,
    protection: on ? (protection ?? []).map((x) => ({ branch: x.branch, look: protectionLook(x), why: x.why })) : [],
    actions,
  };
}

/** What Billing's row says under its state. */
export const BILLING_MEANING = 'This machine\'s, for every project. Agents shows it too while it\'s per token.';

/** How agents run in each onboarded project, and what they bill on this machine. */
export function howAgentsRun(projects: ProjectLike[], setup: DoctorItem[], unread: Unread = UNREAD_KEYS, protection: (root: string) => Protection[] | null = () => null): HowAgentsRun {
  const billing = billingLook(setup);
  const toSetup: SettingsLink = { label: 'Open Setup', icon: 'checklist', section: 'setup' };
  return {
    projects: projects.filter((p) => p.agents).map((p) => ({ root: p.root, project: p.name, roles: agentSettings(p, unread), autonomy: autonomySetting(p, unread), autoMerge: autoMergeSetting(p, unread), cloud: cloudSetting(p, unread, protection(p.root)) })),
    billing: billing
      ? { look: billing, link: billing.tone === 'blue' ? null : toSetup, meaning: BILLING_MEANING }
      : { look: { label: 'Not checked yet: Setup checks it', icon: 'circle-outline', tone: 'neutral' }, link: toSetup, meaning: BILLING_MEANING },
  };
}

// ---------------------------------------------------------------- trackers and sign-ins (GH-112)

/**
 * Where a sign-in is kept: VSCode's secret storage on this machine, never a file (D-027, D-091). GitHub's is
 * gh's own login, which gh keeps (D-007).
 */
export const SIGN_IN_KEPT: SettingFrom = { label: 'VSCode on this machine', icon: 'key' };
export const GH_SIGN_IN_KEPT: SettingFrom = { label: 'gh on this machine', icon: 'terminal' };

/** A button in Settings: one of the commands the page may ask for, with what it's for. Disabled, it says why. */
export interface SettingsAction {
  command: string;
  label: string;
  icon: string;
  /** What it's for, as the command takes it, or null for none. */
  arg: string | null;
  /** What it does, to whose, for a screen reader. */
  name: string;
  primary: boolean;
  /** Why it can't be used now, or null. */
  disabled: string | null;
}

/**
 * A tracker's button: one of the commands the page may ask for, with the tracker it's for. Disabled, it
 * says why. The extension does the rest: the Connect page for a sign-in or a place, which asks acc to write
 * the config, and VSCode's secret storage for a sign-out (D-064).
 */
export interface TrackerAction extends SettingsAction {
  command: 'acc.trackers.signIn' | 'acc.trackers.signOut' | 'acc.trackers.add';
  /** The tracker, as each command takes it: `{"root": …, "index": …}`. Null for Connect a tracker, which needs none. */
  arg: string | null;
}

/** One tracker as Settings lists it (GH-112): its kind, place and board (D-072), and its sign-in (D-091). */
export interface TrackerSetting {
  index: number;
  kind: TrackerKind;
  /** Its kind in words, with its icon: Jira, GitHub Issues, Azure DevOps, monday.com. */
  name: string;
  icon: string;
  /** "Jira · ACME". */
  title: string;
  /** Where its tickets come from, such as "Jira · ACME · epic ACME-3 Premium Support". */
  place: string;
  /** Its board by name, once read, or why not yet. */
  board: Look;
  /** Who it signs in as, and for every project on its site or this project only, or why it isn't signed in. */
  signIn: Look;
  /** Where its place and board are set (the project's .acc/config.json), and where its sign-in is kept. */
  from: SettingFrom;
  signInFrom: SettingFrom;
  actions: TrackerAction[];
}

/** One project's trackers, under its name. */
export interface TrackerProject {
  root: string;
  project: string;
  trackers: TrackerSetting[];
  /** Its config names trackers that haven't been read yet. */
  loading: boolean;
}

export interface TrackersAndSignIns {
  projects: TrackerProject[];
  /** Connect a tracker: the Connect page, which asks for the project when there are several. Null with none. */
  connect: TrackerAction | null;
}

const kindOf = (kind: TrackerKind): { name: string; icon: string } => {
  const d = describe(kind);
  return { name: d?.name ?? kind, icon: d?.icon ?? 'issues' };
};

/**
 * A tracker, from what its board knows (GH-112). A Jira, Azure DevOps or monday.com sign-in is blue, with
 * a globe when every project on its site shares it and a repo when it's this project's only (D-091), or
 * orange when there's none or its tracker refused it. GitHub signs in through gh as the project's account
 * (D-007): it has no sign-in or sign-out here, only its place.
 */
export function trackerSetting(b: BoardInput, p: { root: string; name: string }): TrackerSetting {
  const arg = JSON.stringify({ root: p.root, index: b.index });
  const whose = `${b.title}, in ${p.name}`;
  const scope = b.signInScope ? signInScope(b.signInScope.shared, b.signInScope.host) : 'for this project';
  // A board that can't be read for want of a sign-in says so with a Sign in button (D-073): its sign-in failed.
  const refused = !!b.error && !!b.connect;
  // GitHub's error is its sign-in's only when it's about gh's account, or the project naming none; an outage
  // or a repo it can't read is the board's.
  const ghAccount = b.kind === 'github' && !!b.error && (!!b.connect || /\bgh\b.*\b(log(ged)? ?in|auth)|"github" section|GitHub repo and account/i.test(b.error));
  const signIn: Look = b.kind === 'github'
    ? ghAccount ? LOOK(b.error!, 'warning', 'orange')
      : b.signedInAs ? LOOK(`Signs in through gh as ${b.signedInAs}, the project's GitHub account`, 'github', 'blue')
        : LOOK('No GitHub account: the project\'s settings name none', 'warning', 'orange')
    // Its credentials not read yet: checking, not a warning that flashes while the page loads.
    : !b.signedInAs && b.loading ? LOOK('Checking its sign-in', 'sync~spin', 'blue')
    : !b.signedInAs ? LOOK('Not signed in', 'plug', 'orange')
      : refused ? LOOK(`Signed in as ${b.signedInAs}, ${scope}, but it didn't work: ${b.error}`, 'warning', 'orange')
        : LOOK(`Signed in as ${b.signedInAs}, ${scope}`, b.signInScope?.shared ? 'globe' : 'repo', 'blue');
  // The sign-in's line says what's wrong with it; the board's doesn't say it twice.
  const board: Look = b.board ? LOOK(b.board.title, 'project', 'neutral')
    : b.loading ? LOOK('Reading it', 'sync~spin', 'blue')
      : b.error && signIn.tone === 'orange' ? LOOK(refused && b.signedInAs ? 'Shows once its sign-in works' : 'Shows once it\'s signed in', 'circle-outline', 'neutral')
        : b.error ? LOOK(`Couldn't read it: ${b.error}`, 'warning', 'orange')
          : LOOK('Not read yet', 'circle-outline', 'neutral');
  const fix = signIn.tone === 'orange';
  const actions: TrackerAction[] = [
    ...(b.kind === 'github' ? [] : [
      { command: 'acc.trackers.signIn' as const, label: b.signedInAs ? 'Sign in again' : 'Sign in', icon: 'sign-in', arg, name: `${b.signedInAs ? 'Sign in again to' : 'Sign in to'} ${whose}`, primary: fix, disabled: null },
      { command: 'acc.trackers.signOut' as const, label: 'Sign out', icon: 'sign-out', arg, name: `Sign out of ${whose}`, primary: false, disabled: b.signedInAs ? null : 'It isn\'t signed in, so there\'s nothing to sign out of.' },
    ]),
    { command: 'acc.trackers.add', label: 'Change place…', icon: 'edit', arg, name: `Change place: where ${whose} gets its tickets, and its board`, primary: false, disabled: null },
  ];
  return { index: b.index, kind: b.kind, ...kindOf(b.kind), title: b.title, place: b.place ?? b.title, board, signIn, from: PROJECT, signInFrom: b.kind === 'github' ? GH_SIGN_IN_KEPT : SIGN_IN_KEPT, actions };
}

/** Every open project's trackers, under its name, and Connect a tracker (GH-112). */
export function trackersAndSignIns(projects: ProjectLike[], boards: (root: string) => BoardInput[]): TrackersAndSignIns {
  return {
    projects: projects.map((p) => {
      const list = boards(p.root);
      return { root: p.root, project: p.name, trackers: list.map((b) => trackerSetting(b, { root: p.root, name: p.name })), loading: !list.length && !!p.config.trackers?.length };
    }),
    connect: projects.length ? { command: 'acc.trackers.add', label: 'Connect a tracker…', icon: 'add', arg: null, name: 'Connect a tracker to a project', primary: false, disabled: null } : null,
  };
}

// ---------------------------------------------------------------- GitHub accounts (GH-113)

/** The account each repo pushes as: this clone's choice, in its git config, or the project's, in .acc/config.json (D-028). A clone's words are FROM_WORDS'. */
const CLONE = settingFrom('clone');

/** One project's GitHub account, under its name: who it pushes as, whether that works, and where it's chosen. */
export interface GithubAccountSetting {
  root: string;
  project: string;
  /** owner/name, or null when its .acc/config.json names no GitHub repo. */
  repo: string | null;
  /** The account, with an icon: blue when gh and git push agree, orange with what's wrong, or why there's none. */
  look: Look;
  /** This clone or the project, once read. */
  from: SettingFrom | null;
  /** Each a line: whose the project's account is when this clone chose another, gh's sign-in, and the commit identity. */
  lines: Look[];
  actions: SettingsAction[];
}

export interface GithubAccounts {
  projects: GithubAccountSetting[];
}

/**
 * A project's GitHub account (GH-113), from the identity Environments' card shows. Switch runs
 * acc.github.switch for it, which picks among gh's accounts and asks acc github use to make the change in this
 * clone's git config: nothing committed changes, and a builder can never make it (D-028).
 */
export function githubAccount(p: ProjectLike, id: IdentityCard | null): GithubAccountSetting {
  const base = { root: p.root, project: p.name, repo: p.config.github?.repo ?? null };
  const switchTo = (disabled: string | null, primary = false): SettingsAction => ({ command: 'acc.github.switch', label: 'Switch…', icon: 'arrow-swap', arg: p.root, name: `Switch the GitHub account ${p.name} pushes as, in this clone`, primary, disabled });
  if (!p.config.github) {
    return { ...base, look: LOOK('No GitHub repo: the project\'s settings name none', 'circle-slash', 'neutral'), from: null, lines: [], actions: [switchTo('It names no GitHub repo, so there\'s no account to switch.')] };
  }
  if (!id) return { ...base, look: LOOK(`Checking which account it pushes as: the project's is ${p.config.github.account}`, 'sync~spin', 'blue'), from: null, lines: [], actions: [switchTo(null)] };
  const lines: Look[] = [];
  if (id.from === 'clone') lines.push(LOOK(`The project's account is ${id.projectAccount}. Switch… goes back to it.`, 'repo', 'neutral'));
  // Not signed in is the account's own line: it isn't said twice.
  if (id.signedIn) lines.push(LOOK(`gh is signed in as ${id.account}${id.projects ? '' : ', without GitHub Projects access'}`, 'pass', 'blue'));
  lines.push(id.commit ? LOOK(`Commits as ${id.commit}`, 'git-commit', 'neutral') : LOOK('No commit identity set for this repo', 'warning', 'orange'));
  const actions = [switchTo(null, !!id.problem && id.signedIn)];
  if (!id.signedIn || !id.projects) actions.push({ command: 'acc.github.signIn', label: id.signedIn ? 'Add Projects access' : 'Sign in', icon: 'github', arg: id.account, name: `${id.signedIn ? 'Add Projects access on GitHub for' : 'Sign in to GitHub as'} ${id.account}, for ${p.name}`, primary: !id.signedIn, disabled: null });
  return {
    ...base,
    // Its row is named Pushes as, so the account stands alone, or with what's wrong.
    look: id.problem ? LOOK(`${id.account}, but ${id.problem}`, 'warning', 'orange') : LOOK(id.account, 'github', 'blue'),
    from: id.from === 'clone' ? CLONE : PROJECT, lines, actions,
  };
}

export function githubAccounts(projects: ProjectLike[], identity: (root: string) => IdentityCard | null): GithubAccounts {
  return { projects: projects.map((p) => githubAccount(p, identity(p.root))) };
}

// ---------------------------------------------------------------- the Command Center's own preferences (GH-113)

/** The section the Command Center opens on: where it was left (the default), or always one named section. */
export type OpensOn = 'left' | HomeSection;
export const OPENS_ON_CHOICES: readonly OpensOn[] = ['left', ...HOME_SECTIONS];
export const opensOnChoice = (v: unknown): OpensOn => ((OPENS_ON_CHOICES as readonly unknown[]).includes(v) ? (v as OpensOn) : 'left');

const SECTION_WORDS: Record<HomeSection, { label: string; icon: string }> = {
  overview: { label: 'Overview', icon: 'home' }, tasks: { label: VIEW_TITLES.tasks, icon: 'tasklist' }, agents: { label: VIEW_TITLES.agents, icon: 'hubot' },
  worktrees: { label: VIEW_TITLES.worktrees, icon: 'list-tree' }, environments: { label: VIEW_TITLES.environments, icon: 'server-environment' },
  setup: { label: VIEW_TITLES.setup, icon: 'checklist' }, settings: { label: VIEW_TITLES.settings, icon: 'settings-gear' },
};
export const opensOnWords = (o: OpensOn): { label: string; icon: string } => (o === 'left' ? { label: 'Where I left it', icon: 'history' } : SECTION_WORDS[o]);

export const WHERE_WORDS: Record<WhereView, { label: string; icon: string; meaning: string }> = {
  folder: { label: 'Folder', icon: 'folder', meaning: 'Agents names each session\'s folder in context: its project and worktree, or its repo (D-090).' },
  path: { label: 'Full path', icon: 'list-tree', meaning: 'Agents shows each session\'s whole folder, with ~ for your home folder.' },
};

/** A preference's choices. Few show side by side; many, as a list. */
export interface PreferenceChoice {
  key: string;
  label: string;
  icon: string;
  on: boolean;
}

/** One of the Command Center's own preferences: its choices, what the one chosen means, and where it's kept. */
export interface PagePreference {
  id: 'opensOn' | 'where' | 'pace';
  name: string;
  icon: string;
  /** The command the page asks for with a choice's key; asked with none, it offers the choices itself. */
  command: 'acc.settings.opensOn' | 'acc.settings.where' | 'acc.settings.pace';
  control: 'segmented' | 'list';
  choices: PreferenceChoice[];
  meaning: string;
  from: SettingFrom;
}

/** Kept by VSCode for this window: its workspaceState, which no other window shares. */
export const WINDOW_KEPT: SettingFrom = { label: 'this window', icon: 'window' };
/** Kept by VSCode for this machine: a setting of machine scope, which Settings Sync leaves alone (D-101). */
export const MACHINE_KEPT: SettingFrom = { label: 'VSCode on this machine', icon: 'device-desktop' };

export interface PagePreferences {
  preferences: PagePreference[];
  /** How often each part refreshes at the pace chosen, a line each. */
  refresh: string[];
}

/** How often each thing refreshes at a pace, in words: on screen at the pace, hidden as it always is. */
export const refreshLines = (pace: Pace = 'normal'): string[] => POLL_KEYS.map((k) => {
  const shown = pollEvery(k, true, pace)!;
  const hidden = pollEvery(k, false, pace);
  return `${POLL_INTERVALS[k].label}: every ${intervalWords(shown)} while the Command Center is on screen, ${hidden ? `every ${intervalWords(hidden)}` : 'not at all'} while it isn't.`;
});

/** The section it opens on and the Where view, for this window; the refresh pace, for this machine (GH-113). */
export function pagePreferences(i: { opensOn: OpensOn; whereView: WhereView; pace: Pace }): PagePreferences {
  const opens = opensOnWords(i.opensOn);
  return {
    preferences: [
      {
        id: 'opensOn', name: 'Opens on', icon: 'home', command: 'acc.settings.opensOn', control: 'list',
        choices: OPENS_ON_CHOICES.map((o) => ({ key: o, ...opensOnWords(o), on: o === i.opensOn })),
        meaning: i.opensOn === 'left' ? 'Opened from its icon in the activity bar, the Command Center shows the section you left it at. A link to a section still opens that section.'
          : `Opened from its icon in the activity bar, the Command Center shows ${opens.label}, wherever you left it. A link to a section still opens that section.`,
        from: WINDOW_KEPT,
      },
      {
        id: 'where', name: 'Agents\' Where', icon: 'folder', command: 'acc.settings.where', control: 'segmented',
        choices: WHERE_VIEWS.map((w) => ({ key: w, label: WHERE_WORDS[w].label, icon: WHERE_WORDS[w].icon, on: w === i.whereView })),
        meaning: `${WHERE_WORDS[i.whereView].meaning} The toggle above Agents' table changes it too.`, from: WINDOW_KEPT,
      },
      {
        id: 'pace', name: 'Refresh pace', icon: 'sync', command: 'acc.settings.pace', control: 'segmented',
        choices: PACES.map((p) => ({ key: p, label: PACE_WORDS[p].label, icon: PACE_WORDS[p].icon, on: p === i.pace })),
        meaning: `${PACE_WORDS[i.pace].meaning} Hidden, it refreshes as it always does, and agents' questions and autopilot are never slowed.`, from: MACHINE_KEPT,
      },
    ],
    refresh: refreshLines(i.pace),
  };
}

// ---------------------------------------------------------------- the parts

/**
 * Settings' parts, in the order their tasks come: Appearance (GH-109), How agents run (GH-110), Limits and
 * checks (GH-111), Trackers and sign-ins (GH-112), Notices in Slack, GitHub accounts and the page's own
 * preferences (GH-113), and About (GH-114), built here. Each has a heading another page can open Settings at, with
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
  /** Trackers and sign-ins (GH-112). */
  trackers: TrackersAndSignIns;
  parts: SettingsPartModel[];
  /** Limits and checks (GH-111): the caps, what a change means, the heavy-check slots and each project's checks. Null until read. */
  limits: LimitsModel | null;
  /** Notices in Slack (GH-58), moved here from Environments (GH-113). Never the webhook: only its last four characters. */
  slack: SlackCard | null;
  /** GitHub accounts (GH-113). */
  github: GithubAccounts;
  /** The Command Center's own preferences (GH-113). */
  page: PagePreferences;
  /** About (GH-114): the versions of acc, the extension and the plugin, and the latest release. Null until the extension reads them. */
  about: AboutModel | null;
  /** The guide under the page's title (T-40): a link to each part. */
  guide: GuideLink[];
  /** The ids of the rows' explanations that fold under "What this means" (T-40), as settingsMeanings names them. */
  folded: string[];
}

// ---------------------------------------------------------------- the guide and What this means (T-40)

/** The longest explanation a row keeps in view, in characters, when it is one sentence. */
export const SHORT_MEANING = 90;

/** True when an explanation goes into a closed "What this means": more than one sentence, or a long one. */
export const foldsMeaning = (text: string): boolean => text.length > SHORT_MEANING || /[.!?]\s+\S/.test(text.trim());

/** Where the page's tab remembers an explanation as opened (the page builds the same key). */
export const meaningKey = (id: string): string => `settings-meaning:${id}`;

/** A link of the guide: the part's title and icon, and the heading it opens, by its settingsKey. */
export interface GuideLink { id: SettingsPart; label: string; icon: string; part: string }

/** A link for each part of Settings, in the page's order. */
export const settingsGuide = (parts: SettingsPartModel[]): GuideLink[] => parts.map((p) => ({ id: p.id, label: p.title, icon: p.icon, part: settingsKey(p.id) }));

/**
 * Every row's explanation the page draws, in its order, under the id it remembers it by: the theme's, each
 * project's autonomy, auto-merge and cloud builders, Billing, each preference, and each version in About.
 * An empty one isn't drawn.
 */
export function settingsMeanings(m: Pick<SettingsModel, 'theme' | 'themes' | 'agents' | 'page' | 'about'>): { id: string; text: string }[] {
  const theme = m.themes.find((t) => t.key === m.theme) ?? m.themes[0];
  const out = [
    { id: 'theme', text: theme?.meaning ?? '' },
    ...m.agents.projects.flatMap((s) => [
      { id: `autonomy:${s.root}`, text: s.autonomy?.meaning ?? '' },
      { id: `auto-merge:${s.root}`, text: s.autoMerge?.meaning ?? '' },
      { id: `cloud:${s.root}`, text: s.cloud?.meaning ?? '' },
    ]),
    { id: 'billing', text: m.agents.billing.meaning },
    ...m.page.preferences.map((p) => ({ id: `page:${p.id}`, text: p.meaning })),
    ...(m.about?.rows ?? []).map((r) => ({ id: `about:${r.key}`, text: r.meaning ?? '' })),
  ];
  return out.filter((x) => x.text);
}

export interface SettingsInput {
  /** The Slack card, for this machine (GH-58). */
  slack?: SlackCard | null;
  /** Each project's GitHub identity, once read (D-028). None unless given. */
  identity?: (root: string) => IdentityCard | null;
  /** This window's choices and this machine's pace (GH-113). The defaults unless given. */
  opensOn?: OpensOn;
  whereView?: WhereView;
  pace?: Pace;
  theme: ThemeChoice;
  /** The workspace's onboarded projects, whose agents' settings How agents run shows. */
  projects: ProjectLike[];
  /** Setup's checks, for what agents bill. */
  setup: DoctorItem[];
  /** What each project's tracker boards know: place, board and sign-in (GH-112). None unless given. */
  boards?: (root: string) => BoardInput[];
  /** Limits and checks, as read from this machine and each project (GH-111), while Settings shows. */
  limits?: LimitsModel | null;
  /** About, from what the extension has read (GH-114). */
  about?: AboutModel | null;
  /** What GitHub enforces on each environment branch of a project that opted in to cloud builders (GH-69), once read. None unless given. */
  cloudProtection?: (root: string) => Protection[] | null;
}

export function settingsModel(i: SettingsInput): SettingsModel {
  const agents = howAgentsRun(i.projects, i.setup, UNREAD_KEYS, i.cloudProtection ?? (() => null));
  const trackers = trackersAndSignIns(i.projects, i.boards ?? (() => []));
  const github = githubAccounts(i.projects, i.identity ?? (() => null));
  const page = pagePreferences({ opensOn: i.opensOn ?? 'left', whereView: i.whereView ?? 'folder', pace: i.pace ?? 'normal' });
  const later = (id: SettingsPart, title: string, icon: string, summary: string, today: string, links: SettingsLink[] = [], details: string[] = []): SettingsPartModel => ({ id, title, icon, summary, built: false, today, details, links });
  const parts: SettingsPartModel[] = [
    { id: 'appearance', title: 'Appearance', icon: 'color-mode', summary: 'How the Command Center\'s pages look. Kept on this machine, for every window.', built: true, today: null, details: [], links: [] },
    {
      id: 'agents', title: 'How agents run', icon: 'hubot', summary: 'What builders and reviewers run with in each project: model, effort and fallback, and what autopilot may do on its own. Each Change… asks acc to make the change.',
      built: true, today: null,
      details: agents.projects.length
        ? ['This clone\'s choice is kept in its git config, where nobody else sees it. A project\'s is kept in the project\'s settings, for you to commit and share.']
        : ['No project in this workspace is onboarded yet. Once Setup onboards one, its builders and reviewers show here.'],
      links: agents.projects.length ? [] : [{ label: 'Open Setup', icon: 'checklist', section: 'setup' }],
    },
    { id: 'limits', title: 'Limits and checks', icon: 'dashboard', summary: 'How many builders run at once, this project\'s cap and this machine\'s total, what a change means, the heavy checks this machine runs at once, and the checks a task must pass. Each change goes through acc.', built: true, today: null, details: [], links: [] },
    {
      id: 'trackers', title: 'Trackers and sign-ins', icon: 'issues',
      summary: 'Each project\'s trackers: where their tickets come from, the board, and the account each signs in as, for that project only or for every project on its site.',
      built: true, today: null,
      details: trackers.projects.length
        ? ['A tracker\'s place and board are kept in its project\'s settings: Change place… and Connect a tracker ask acc to write them, for you to commit. A Jira, Azure DevOps or monday.com sign-in stays in VSCode on this machine, never in a file; GitHub\'s is gh\'s.']
        : ['No project in this workspace is onboarded yet. Once Setup onboards one, its trackers show here.'],
      links: trackers.projects.length ? [] : [{ label: 'Open Setup', icon: 'checklist', section: 'setup' }],
    },
    {
      id: 'slack', title: 'Notices in Slack', icon: 'bell', built: true, today: null, links: [],
      summary: 'Whether acc\'s notices go to Slack from this machine, and which: one incoming webhook for every project open here.',
      details: [],
    },
    {
      id: 'github', title: 'GitHub accounts', icon: 'github', built: true, today: null,
      summary: 'The GitHub account each project\'s repo pushes as from this clone. Switch… picks another account gh is signed in to, or goes back to the project\'s.',
      details: github.projects.length
        ? ['Switch… makes the change in this clone\'s git config: nobody else sees it, nothing committed changes, and no agent may make it. The project\'s account is in the project\'s settings.']
        : ['No project in this workspace is onboarded yet. Once Setup onboards one, the account its repo pushes as shows here.'],
      links: github.projects.length ? [] : [{ label: 'Open Setup', icon: 'checklist', section: 'setup' }],
    },
    {
      id: 'page', title: 'The Command Center', icon: 'window', built: true, today: null, links: [], details: [],
      summary: 'Which section it opens on, how Agents shows where sessions run, and how often it refreshes. VSCode keeps each, for this window or this machine.',
    },
    {
      id: 'about', title: 'About', icon: 'info', summary: 'The versions of acc, the extension and the plugin, read fresh each time Settings shows, and whether a newer release is out.',
      built: true, today: null,
      details: ['A newer release installs as the README says, from its page. The plugin updates as Setup\'s A4 does: this page changes nothing itself.'],
      links: [],
    },
  ];
  const drawn = { theme: i.theme, themes: THEME_CHOICES.map((key) => ({ key, ...THEMES[key] })), agents, page, about: i.about ?? null };
  const folded = settingsMeanings(drawn).filter((x) => foldsMeaning(x.text)).map((x) => x.id);
  return { kind: 'settings', ...drawn, trackers, parts, limits: i.limits ?? null, slack: i.slack ?? null, github, guide: settingsGuide(parts), folded };
}

export const area: ModelArea = {
  // How agents run's Change… buttons run the Agents area's commands, which this section draws now (GH-110).
  // A tracker's Sign out is drawn only here (GH-112); its Sign in and Change place are the boards' too.
  // GitHub accounts' Switch… and Sign in are Environments' commands, which its account cards draw too (GH-113).
  commands: ['acc.settings.theme', 'acc.agents.configure', 'acc.agents.autonomy', 'acc.agents.autoMerge', 'acc.trackers.signOut', 'acc.settings.opensOn', 'acc.settings.where', 'acc.settings.pace', 'acc.cloud.enable', 'acc.cloud.disable', 'acc.cloud.token', 'acc.cloud.default', 'acc.cloud.routine'],
  home: {
    // Last in the rail, after every other area's.
    order: 90,
    // Slack paused because it refused a message needs you (GH-58): its badge came with it (GH-113).
    nav: ({ i }) => ({
      section: 'settings', label: 'Settings', icon: 'settings-gear', count: null, attention: i.slack?.state === 'paused',
      hint: i.slack?.state === 'paused' ? 'Notices to Slack are paused' : 'Appearance, agents, limits, trackers, Slack, GitHub accounts, the Command Center\'s own preferences and the versions',
    }),
  },
};
