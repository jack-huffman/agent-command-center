/**
 * The Environments section: the repo's GitHub identity, promotion paths, and a card per environment.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import type { GithubIdentity } from '../../../packages/core/src/github.ts';
import { ENV_ICON, envTypeWords, inPromotionOrder } from '../logic/environments.ts';
import type { Action, HubLike, ModelArea, Ref } from './shared.ts';
import { promotionPaths } from '../../../packages/core/src/promote.ts';
import { settingsKey } from './settings.ts';

export { promotionPaths };

/** Why Production's org controls are disabled on a machine that isn't logged in to it (D-T-125). */
export const PRODUCTION_AWAY = 'This machine isn\'t logged in to Production. Someone with access to Production opens and deploys it.';

// ---------------------------------------------------------------- the repo's GitHub identity (D-028)

/** How the repo's GitHub identity reads at a glance: what's wrong, if anything, in words (never colour alone). */
export interface IdentityLook {
  ok: boolean;
  problem: string | null;
  scopes: string[];
  /** GitHub Projects access, which a Project's board needs. */
  projects: boolean;
}

export function lookOf(id: GithubIdentity): IdentityLook {
  const scopes = id.accounts?.find((a) => a.login.toLowerCase() === id.account.toLowerCase())?.scopes ?? [];
  const problem = !id.accounts ? 'gh isn\'t installed'
    : !id.signedIn ? `gh isn't signed in as ${id.account}`
      : id.pushesAs && id.pushesAs.toLowerCase() !== id.account.toLowerCase() ? `git push would use ${id.pushesAs}`
        : null;
  return { ok: !problem, problem, scopes, projects: scopes.includes('project') || scopes.includes('read:project') };
}

export interface IdentityCard {
  account: string;
  initials: string;
  from: 'clone' | 'config';
  projectAccount: string;
  signedIn: boolean;
  scopes: string[];
  projects: boolean;
  problem: string | null;
  pushesAs: string | null;
  commit: string | null;
  profile: string;
  /** How many other accounts gh is logged in to, to switch to. */
  others: number;
}

// ---------------------------------------------------------------- environments

export interface EnvCard {
  name: string;
  branch: string;
  type: string;
  /** The type in plain words, such as "Partial copy sandbox". */
  typeWords: string;
  icon: string;
  org: string | null;
  badges: string[];
  current: boolean;
  promotesTo: string[];
  actions: Action[];
}

export interface EnvironmentsModel {
  kind: 'environments';
  projects: { name: string; root: string; github: string | null; identity: IdentityCard | null; envs: EnvCard[]; paths: string[][] }[];
  /**
   * acc's notices in Slack moved to Settings (GH-113): under This machine, Environments says so, with a way
   * there, the part's heading.
   */
  slackMoved: { label: string; icon: string; section: 'settings'; part: string };
}

/**
 * notHere: whether this machine is known not to be logged in to a project's Production, whose branch is
 * given (productionNotHere, from the last Setup check). Not known, its org controls stay on.
 */
export function environmentsModel(hub: HubLike, identity: (root: string) => IdentityCard | null = () => null, notHere: (root: string, branch: string) => boolean = () => false): EnvironmentsModel {
  return {
    kind: 'environments',
    slackMoved: { label: 'Open Notices in Slack', icon: 'settings-gear', section: 'settings', part: settingsKey('slack') },
    projects: hub.projects.map((p) => ({
      name: p.name, root: p.root,
      github: p.config.github ? `${p.config.github.repo} as ${p.config.github.account}` : null,
      identity: identity(p.root),
      paths: promotionPaths(p.config.environments),
      envs: inPromotionOrder(p.config.environments).map((e) => {
        const ref: Ref = { project: p.root, env: e.branch };
        const actions: Action[] = [];
        // Production with no org here, or one the last Setup check found isn't logged in (D-T-125): its org
        // controls are off and say why, rather than fail when used.
        const away = p.config.profile === 'salesforce' && e.type === 'production' && (!e.org || notHere(p.root, e.branch)) ? PRODUCTION_AWAY : undefined;
        if (e.org || away) actions.push({ command: 'acc.env.openOrg', label: 'Open org', icon: 'globe', ref, ...(away ? { disabled: away } : {}) });
        if (p.config.github) actions.push({ command: 'acc.env.openGithub', label: 'GitHub', icon: 'github', ref });
        if (p.branch !== e.branch) actions.push({ command: 'acc.env.compare', label: 'Compare', icon: 'diff', ref });
        // A person moves work between environments (D-034): a pull request onward, then a deploy after it merges.
        if (e.promotesTo.length && p.config.github) actions.push({ command: 'acc.env.promote', label: 'Promote…', icon: 'git-merge', ref });
        if (p.config.profile === 'salesforce' && (e.org || away)) actions.push({ command: 'acc.env.deploy', label: 'Deploy…', icon: 'cloud-upload', ref, ...(away ? { disabled: away } : {}) });
        const current = p.branch === e.branch;
        const badges = [e.default ? 'default' : '', e.protected ? 'protected' : '', current ? 'checked out' : ''].filter(Boolean);
        return { name: e.name, branch: e.branch, type: e.type, typeWords: envTypeWords(e.type), icon: ENV_ICON[e.type] ?? 'git-branch', org: e.org, badges, current, promotesTo: e.promotesTo, actions };
      }),
    })),
  };
}

export const area: ModelArea = {
  commands: [
    'acc.env.openOrg', 'acc.env.openGithub', 'acc.env.compare', 'acc.env.promote', 'acc.env.deploy', 'acc.github.switch', 'acc.github.signIn',
  ],
  home: {
    order: 40,
    // Slack's badge moved to Settings with its card (GH-113): a GitHub account that's wrong still needs you here.
    nav: ({ hub, i }) => ({ section: 'environments', label: 'Environments', icon: 'server-environment', count: null, attention: hub.projects.some((p) => !!i.identity(p.root)?.problem), hint: 'Branches, orgs and your GitHub account' }),
  },
};
