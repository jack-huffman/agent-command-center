/**
 * Environments: their icons, and a branch on GitHub.
 * Like the rest of logic/, no `vscode` import, so it can be tested with node:test.
 */

export const ENV_ICON: Record<string, string> = {
  production: 'shield', full: 'server-environment', partial: 'server-environment', developer: 'beaker', developer_pro: 'beaker', none: 'git-branch',
};

export const githubBranchUrl = (repo: string, branch: string): string => `https://github.com/${repo}/tree/${encodeURIComponent(branch)}`;

/** An environment type in plain words, for a card's chip: "partial" reads "Partial copy sandbox". */
const ENV_TYPE_WORDS: Record<string, string> = {
  production: 'Production', full: 'Full copy sandbox', partial: 'Partial copy sandbox', developer: 'Developer sandbox', developer_pro: 'Developer Pro sandbox', none: 'Branch',
};

export const envTypeWords = (type: string): string => ENV_TYPE_WORDS[type] ?? type.replace(/_/g, ' ');

// Environments in promotion order, dev first and production last: core's, since acc's pipeline command lists
// them the same way (T-157). Kept here by name for the pages and tests that read it from logic/.
export { inPromotionOrder } from '../../../packages/core/src/pipeline.ts';

