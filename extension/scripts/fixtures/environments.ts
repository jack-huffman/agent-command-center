/** Environments' GitHub identity card (D-028). */
import type { IdentityCard } from '../../src/model/environments.ts';

/**
 * Each project's identity for Settings' GitHub accounts (GH-113): the sample project as below, this clone's
 * choice; the portal, the project's own account, which gh isn't signed in as, so git push would fail.
 */
export function sampleIdentities(root: string): IdentityCard {
  if (!root.endsWith('acme-portal')) return sampleIdentity();
  return {
    account: 'jordan-kim', initials: 'JK', from: 'config', projectAccount: 'jordan-kim', signedIn: false, scopes: [], projects: false,
    problem: 'gh isn\'t signed in as jordan-kim', pushesAs: 'jordan-kim', commit: null, profile: 'https://github.com/jordan-kim', others: 1,
  };
}

/** This clone works as another account than the project's, and that account lacks Projects access. */
export function sampleIdentity(): IdentityCard {
  return {
    account: 'jordan-kim', initials: 'JK', from: 'clone', projectAccount: 'acme-bot', signedIn: true, scopes: ['repo', 'read:org', 'workflow'], projects: false,
    problem: null, pushesAs: 'jordan-kim', commit: 'Jordan Kim <jordan@acme.example>', profile: 'https://github.com/jordan-kim', others: 2,
  };
}
