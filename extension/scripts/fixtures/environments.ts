/** Environments' GitHub identity card (D-028). */
import type { IdentityCard } from '../../src/model/environments.ts';

/** This clone works as another account than the project's, and that account lacks Projects access. */
export function sampleIdentity(): IdentityCard {
  return {
    account: 'jordan-kim', initials: 'JK', from: 'clone', projectAccount: 'acme-bot', signedIn: true, scopes: ['repo', 'read:org', 'workflow'], projects: false,
    problem: null, pushesAs: 'jordan-kim', commit: 'Jordan Kim <jordan@acme.example>', profile: 'https://github.com/jordan-kim', others: 2,
  };
}
