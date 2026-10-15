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

/**
 * Environments in promotion order, dev first and production last. An environment sits after everything that
 * promotes into it (the longest way in). Ties, and environments on no path, keep the config's order, after the ones on a path.
 */
export function inPromotionOrder<E extends { branch: string; promotesTo: string[] }>(envs: E[]): E[] {
  const depth = new Map<string, number>();
  const walk = (branch: string, d: number, seen: string[]) => {
    if ((depth.get(branch) ?? -1) >= d) return;
    depth.set(branch, d);
    for (const next of envs.find((e) => e.branch === branch)?.promotesTo ?? []) if (!seen.includes(next)) walk(next, d + 1, [...seen, next]);
  };
  const into = new Set(envs.flatMap((e) => e.promotesTo));
  for (const e of envs) if (e.promotesTo.length && !into.has(e.branch)) walk(e.branch, 0, [e.branch]);
  const rank = (e: E) => depth.get(e.branch) ?? Infinity;
  return envs.map((e, i) => ({ e, i })).sort((a, b) => (rank(a.e) === rank(b.e) ? a.i - b.i : rank(a.e) < rank(b.e) ? -1 : 1)).map((x) => x.e);
}

