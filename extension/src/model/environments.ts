/**
 * The Environments section: the repo's GitHub identity (D-028), promotion paths, and a card per environment.
 * Plain data, posted to the webview and rendered there with text only. No vscode import, so it's testable.
 */

import type { GithubIdentity } from '../../../packages/core/src/github.ts';
import { ENV_ICON } from '../logic/environments.ts';
import type { SlackCard } from '../slack.ts';
import type { Action, HubLike, ModelArea, Ref } from './shared.ts';
import { promotionPaths } from '../../../packages/core/src/promote.ts';

export { promotionPaths };

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
  /** acc's notices in Slack, for this machine (GH-58). Never the webhook: only its last four characters. */
  slack: SlackCard | null;
}

export function environmentsModel(hub: HubLike, identity: (root: string) => IdentityCard | null = () => null, slack: SlackCard | null = null): EnvironmentsModel {
  return {
    kind: 'environments',
    slack,
    projects: hub.projects.map((p) => ({
      name: p.name, root: p.root,
      github: p.config.github ? `${p.config.github.repo} as ${p.config.github.account}` : null,
      identity: identity(p.root),
      paths: promotionPaths(p.config.environments),
      envs: p.config.environments.map((e) => {
        const ref: Ref = { project: p.root, env: e.branch };
        const actions: Action[] = [];
        if (e.org) actions.push({ command: 'acc.env.openOrg', label: 'Open org', icon: 'globe', ref, primary: true });
        if (p.config.github) actions.push({ command: 'acc.env.openGithub', label: 'GitHub', icon: 'github', ref });
        if (p.branch !== e.branch) actions.push({ command: 'acc.env.compare', label: 'Compare', icon: 'diff', ref });
        // A person moves work between environments (D-034): a pull request onward, then a deploy after it merges.
        if (e.promotesTo.length && p.config.github) actions.push({ command: 'acc.env.promote', label: 'Promote…', icon: 'git-merge', ref });
        if (p.config.profile === 'salesforce' && e.org) actions.push({ command: 'acc.env.deploy', label: 'Deploy…', icon: 'cloud-upload', ref });
        const current = p.branch === e.branch;
        const badges = [e.default ? 'default' : '', e.protected ? 'protected' : '', current ? 'checked out' : ''].filter(Boolean);
        return { name: e.name, branch: e.branch, type: e.type, icon: ENV_ICON[e.type] ?? 'git-branch', org: e.org, badges, current, promotesTo: e.promotesTo, actions };
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
    nav({ hub, i }) {
        // Slack paused because it refused a message needs you too (GH-58).
      return { section: 'environments', label: 'Environments', icon: 'server-environment', count: null, attention: hub.projects.some((p) => !!i.identity(p.root)?.problem) || i.slack?.state === 'paused', hint: i.slack?.state === 'paused' ? 'Notices to Slack are paused' : 'Branches, orgs, your GitHub account and Slack' };
    },
  },
};
