// Setting up and using the Command Center without access to Production (D-T-125): B0.config's Do it asks
// which org is Production, or which My Domain's logged-in sandboxes to use, and the Environments page knows
// when this machine isn't logged in to Production.
import { listedOrgs, PRODUCTION_NOT_HERE, sandboxAliases } from '../../../packages/core/src/sf-discovery.ts';
import { parseOrgUrl } from '../../../packages/core/src/onboarding/helpers.ts';
import type { DoctorItem } from './setup.ts';

/** The answer beside the Production orgs: a person with no access to Production still sets up the project. */
export const NO_PRODUCTION = { label: '$(circle-slash) I don\'t have access to Production', description: 'Find the environments from the sandboxes you\'re logged in to' };

/** The answer that logs in to a Production org this machine hasn't got yet. */
export const LOGIN_PRODUCTION = { label: '$(add) Log in to another Production org…' };

/** One My Domain with logged-in sandboxes: its name, and its sandboxes' names as their URLs give them. */
export interface SandboxDomain {
  domain: string;
  sandboxes: string[];
}

/** Each My Domain that has a logged-in sandbox, from `sf org list --json`, sorted by name. None when sf failed. */
export function sandboxDomains(sfOrgList: unknown): SandboxDomain[] {
  const orgs = listedOrgs((sfOrgList ?? {}) as { status?: number; result?: Record<string, unknown> });
  const domains = new Set<string>();
  for (const o of orgs) {
    const u = parseOrgUrl(o.instanceUrl ?? '');
    if (u.kind === 'sandbox' && o.alias) domains.add(u.domain);
  }
  return [...domains].sort().map((domain) => ({ domain, sandboxes: [...sandboxAliases(orgs, domain).keys()].sort() }));
}

/** A My Domain as the question lists it: its name, and the sandboxes acc init would find there. */
export const domainItem = (d: SandboxDomain): { label: string; description: string; domain: string } =>
  ({ label: `$(cloud) ${d.domain}`, description: `${d.sandboxes.length} sandbox${d.sandboxes.length === 1 ? '' : 'es'}: ${d.sandboxes.join(', ')}`, domain: d.domain });

/** One answer to "Which org is Production?": a logged-in Production org, logging in to another, or no access. */
export interface ProductionChoice {
  label: string;
  description?: string;
  org?: string;
}

/**
 * The question's answers: each logged-in Production org to pick from, then its own two answers, logging in
 * to another and no access (D-205: the orgs are things to pick from, as the Connect page's boards are).
 */
export const productionChoices = (orgs: string[]): ProductionChoice[] => [...orgs.map((org) => ({ label: org, org })), LOGIN_PRODUCTION, NO_PRODUCTION];

/** What follows an answer: acc init with that org, a login, the My Domain question, or nothing when backed out. */
export type ProductionNext =
  | { kind: 'org'; productionOrg: string }
  | { kind: 'login-production' }
  | { kind: 'login-sandbox' }
  | { kind: 'ask-domain'; domains: SandboxDomain[] }
  | { kind: 'cancel' };

/**
 * After "Which org is Production?": an org goes to acc init; no access asks which My Domain's logged-in
 * sandboxes to use or, with no sandbox logged in, offers the sandbox login. Backed out, nothing happens.
 */
export function productionNext(pick: ProductionChoice | undefined, sfOrgList: unknown): ProductionNext {
  if (!pick) return { kind: 'cancel' };
  if (pick === LOGIN_PRODUCTION) return { kind: 'login-production' };
  if (pick !== NO_PRODUCTION) return pick.org ? { kind: 'org', productionOrg: pick.org } : { kind: 'cancel' };
  const domains = sandboxDomains(sfOrgList);
  return domains.length ? { kind: 'ask-domain', domains } : { kind: 'login-sandbox' };
}

/** A team template asks the Production question only when the project it starts is a Salesforce one. */
export const asksProduction = (shown: string | null | undefined, picked: string | undefined): boolean => (shown ?? picked) === 'salesforce';

/**
 * Whether this machine is known not to be logged in to a project's Production (D-T-125): the last Setup
 * check, run in `setupRoot`, said so on B6.org-match's line for Production's branch. Before that check, or
 * for another project than the one it ran in, it isn't known.
 */
export function productionNotHere(items: DoctorItem[], setupRoot: string | null | undefined, projectFor: (path: string) => { root: string } | undefined): (root: string, branch: string) => boolean {
  const match = items.find((i) => i.id === 'B6.org-match');
  const checked = setupRoot ? projectFor(setupRoot)?.root : undefined;
  return (root, branch) => !!match && checked === root && match.detail.includes(`${branch}: ${PRODUCTION_NOT_HERE}`);
}
