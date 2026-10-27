// B0.config's Do it without access to Production (D-T-125): the My Domains of the sandboxes this person is
// logged in to, one of which a new Salesforce project's environments come from.
import { listedOrgs, sandboxAliases } from '../../../packages/core/src/sf-discovery.ts';
import { parseOrgUrl } from '../../../packages/core/src/onboarding/helpers.ts';

/** The answer beside the Production orgs: a person with no access to Production still sets up the project. */
export const NO_PRODUCTION = { label: '$(circle-slash) I don\'t have access to Production', description: 'Find the environments from the sandboxes you\'re logged in to' };

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
