/**
 * Environments: their icons, and a branch on GitHub.
 * Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */

export const ENV_ICON: Record<string, string> = {
  production: 'shield', full: 'server-environment', partial: 'server-environment', developer: 'beaker', developer_pro: 'beaker', none: 'git-branch',
};

export const githubBranchUrl = (repo: string, branch: string): string => `https://github.com/${repo}/tree/${encodeURIComponent(branch)}`;
