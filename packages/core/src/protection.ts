/**
 * What GitHub enforces on a branch (GH-69): branch protection, or a ruleset that applies to it, read
 * through gh api. A cloud builder's pushes are refused by the repo's committed guard, and GitHub's rules
 * are the line behind it: where GitHub enforces nothing, a push that got past the guard would be caught
 * by acc's next sync, after the fact, rather than prevented. acc warns, and never refuses, on that: the
 * author decided so, since a private repo on GitHub's free plan can't have protection at all.
 */
import type { Runner } from './exec.ts';
import { ghToken } from './land.ts';

export type ProtectionState = 'enforced' | 'none' | 'unavailable' | 'unknown';

export interface Protection {
  branch: string;
  state: ProtectionState;
  /** What was found, in words: the rules, or why nothing could be read. */
  why: string;
}

const GH_TIMEOUT_MS = 30_000;

/** One gh api read: the status, the body, and the first line of an error. */
function read(run: Runner, path: string, env: NodeJS.ProcessEnv): { status: number; body: string; error: string } {
  const r = run('gh', ['api', path, '--include'], { env, timeoutMs: GH_TIMEOUT_MS });
  // --include puts the status line and headers before the body, with a blank line between.
  const m = /^HTTP\/[\d.]+ (\d{3})/.exec(r.stdout);
  const status = m ? Number(m[1]) : r.code === 0 ? 200 : 0;
  const body = r.stdout.includes('\r\n\r\n') ? r.stdout.slice(r.stdout.indexOf('\r\n\r\n') + 4) : r.stdout.includes('\n\n') ? r.stdout.slice(r.stdout.indexOf('\n\n') + 2) : r.stdout;
  return { status, body, error: (r.stderr || '').trim().split('\n')[0] ?? '' };
}

const message = (body: string): string => {
  try {
    const j = JSON.parse(body) as { message?: unknown };
    return typeof j.message === 'string' ? j.message : '';
  } catch {
    return '';
  }
};

/** GitHub's 403 on a plan that doesn't offer protection or rulesets: a private repo on the free plan. */
const upgrade = (r: { status: number; body: string }): boolean => r.status === 403 && /upgrade to github pro|make this repository public/i.test(message(r.body));

/**
 * Whether GitHub enforces protection or a ruleset on a branch of the repo. `enforced` names what; `none`
 * means GitHub answered and nothing applies; `unavailable` means the plan doesn't offer it (a private repo
 * on the free plan: GitHub answers 403, "Upgrade to GitHub Pro"); `unknown` means gh couldn't say.
 */
export function branchProtection(run: Runner, repo: string, branch: string, env: NodeJS.ProcessEnv): Protection {
  const protection = read(run, `repos/${repo}/branches/${encodeURIComponent(branch)}/protection`, env);
  if (protection.status === 200) {
    const rules: string[] = [];
    try {
      const p = JSON.parse(protection.body) as Record<string, unknown>;
      if (p.required_pull_request_reviews) rules.push('a pull request with reviews');
      if (p.required_status_checks) rules.push('passing checks');
      if ((p.enforce_admins as { enabled?: boolean } | undefined)?.enabled) rules.push('no admin bypass');
      if (p.restrictions) rules.push('who may push');
      if ((p.allow_force_pushes as { enabled?: boolean } | undefined)?.enabled === false) rules.push('no force pushes');
      if ((p.allow_deletions as { enabled?: boolean } | undefined)?.enabled === false) rules.push('no deletion');
    } catch {
      // protected, whatever the rules
    }
    return { branch, state: 'enforced', why: `GitHub protects ${branch}${rules.length ? `: ${rules.join(', ')}` : ''}.` };
  }
  if (upgrade(protection)) return { branch, state: 'unavailable', why: `GitHub doesn't offer branch protection or rulesets on ${repo}: a private repo on the free plan. A push the guard didn't catch would be caught by the Command Center's next sync, after the fact, not prevented.` };
  if (protection.status !== 404) return { branch, state: 'unknown', why: `gh couldn't read ${branch}'s protection: ${message(protection.body) || protection.error || `HTTP ${protection.status || '?'}`}.` };
  const rules = read(run, `repos/${repo}/rules/branches/${encodeURIComponent(branch)}`, env);
  if (rules.status === 200) {
    let applied: { type?: string }[] = [];
    try {
      applied = JSON.parse(rules.body) as { type?: string }[];
    } catch {
      applied = [];
    }
    if (Array.isArray(applied) && applied.length) return { branch, state: 'enforced', why: `A ruleset applies to ${branch}: ${[...new Set(applied.map((r) => String(r.type ?? 'rule').replace(/_/g, ' ')))].join(', ')}.` };
    return { branch, state: 'none', why: `GitHub enforces no protection and no ruleset on ${branch}: a push the guard didn't catch would be caught by the Command Center's next sync, after the fact, not prevented. Add protection or a ruleset on GitHub to prevent it.` };
  }
  if (upgrade(rules)) return { branch, state: 'unavailable', why: `GitHub doesn't offer branch protection or rulesets on ${repo}: a private repo on the free plan. A push the guard didn't catch would be caught by the Command Center's next sync, after the fact, not prevented.` };
  return { branch, state: 'unknown', why: `gh couldn't read ${branch}'s rulesets: ${message(rules.body) || rules.error || `HTTP ${rules.status || '?'}`}.` };
}

/** The checks GitHub requires before a pull request merges into a branch (T-108), and how it requires them. */
export interface RequiredChecks {
  /** read: GitHub answered; unavailable: the plan doesn't offer it; unknown: gh couldn't say. */
  state: 'read' | 'unavailable' | 'unknown';
  /** The checks' names, from branch protection and any ruleset that applies. */
  checks: string[];
  /** branch: branch protection is on, and requires checks or not (statusChecks). none: no branch protection. */
  protection: 'branch' | 'none';
  statusChecks: boolean;
  why: string;
}

/**
 * Which checks GitHub requires before anything merges into a branch: branch protection's required status
 * checks, and those of each ruleset that applies. Only reads; a person changes either on GitHub.
 */
export function requiredChecks(run: Runner, repo: string, branch: string, env: NodeJS.ProcessEnv): RequiredChecks {
  const out: RequiredChecks = { state: 'read', checks: [], protection: 'none', statusChecks: false, why: '' };
  const protection = read(run, `repos/${repo}/branches/${encodeURIComponent(branch)}/protection`, env);
  if (upgrade(protection)) return { ...out, state: 'unavailable', why: `GitHub doesn't offer required checks on ${repo}: a private repo on the free plan.` };
  if (protection.status === 200) {
    out.protection = 'branch';
    try {
      const s = (JSON.parse(protection.body) as { required_status_checks?: { contexts?: unknown[]; checks?: { context?: unknown }[] } }).required_status_checks;
      if (s) {
        out.statusChecks = true;
        out.checks.push(...(s.contexts ?? []).filter((c): c is string => typeof c === 'string'), ...(s.checks ?? []).map((c) => c.context).filter((c): c is string => typeof c === 'string'));
      }
    } catch {
      // protected, with no checks read
    }
  } else if (protection.status !== 404) return { ...out, state: 'unknown', why: `gh couldn't read ${branch}'s protection: ${message(protection.body) || protection.error || `HTTP ${protection.status || '?'}`}.` };
  const rules = read(run, `repos/${repo}/rules/branches/${encodeURIComponent(branch)}`, env);
  if (rules.status === 200) {
    try {
      const applied = JSON.parse(rules.body) as { type?: string; parameters?: { required_status_checks?: { context?: unknown }[] } }[];
      for (const r of Array.isArray(applied) ? applied : []) if (r.type === 'required_status_checks') out.checks.push(...(r.parameters?.required_status_checks ?? []).map((c) => c.context).filter((c): c is string => typeof c === 'string'));
    } catch {
      // no ruleset read
    }
  } else if (!upgrade(rules) && rules.status !== 404) return { ...out, state: 'unknown', why: `gh couldn't read ${branch}'s rulesets: ${message(rules.body) || rules.error || `HTTP ${rules.status || '?'}`}.` };
  out.checks = [...new Set(out.checks)];
  out.why = out.checks.length ? `GitHub requires ${out.checks.join(', ')} before a pull request merges into ${branch}.` : `GitHub requires no checks before a pull request merges into ${branch}.`;
  return out;
}

/**
 * Each environment branch's protection, as the repo's account (D-007). gh not signed in as it, or offline,
 * gives `unknown` for each, with why, and never throws: this is a warning's source, not a gate.
 */
export function environmentProtection(run: Runner, repo: string, account: string, branches: string[], env: NodeJS.ProcessEnv): Protection[] {
  let ghEnv: NodeJS.ProcessEnv;
  try {
    ghEnv = { ...env, GH_TOKEN: ghToken(run, account) };
  } catch (e) {
    return branches.map((branch) => ({ branch, state: 'unknown' as const, why: `gh couldn't read ${branch}'s protection: ${(e as Error).message}` }));
  }
  return branches.map((branch) => branchProtection(run, repo, branch, ghEnv));
}

/** The warning a dispatch or Settings shows, one line per branch GitHub doesn't enforce, or none. `unknown` warns too: nothing vouches. */
export function protectionWarnings(found: Protection[]): string[] {
  return found.filter((p) => p.state !== 'enforced').map((p) => (p.state === 'unknown' ? `${p.why} Whether a push the guard didn't catch would be prevented isn't known.` : p.why));
}
