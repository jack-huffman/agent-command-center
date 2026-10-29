/**
 * Which trackers drop their saved tickets after a sign-out (T-141, D-225): each one of the signed-out site that has
 * no sign-in now. One that still has one, its own or its site's (GH-79), keeps them. Like the rest of logic/, no
 * `vscode` import, so it can be tested with node:test.
 */
import { credInUse, type StoredCreds, trackerHost } from './connect.ts';

type SiteTracker = Parameters<typeof trackerHost>[0];

/** The trackers in `list` on `kind` and `host` whose sign-in, as `stored` reads it now, is gone. */
export async function signedOutTrackers<T extends SiteTracker>(list: readonly T[], kind: string, host: string, stored: (t: T) => Promise<StoredCreds>): Promise<T[]> {
  const out: T[] = [];
  for (const t of list) {
    if (t.kind !== kind || trackerHost(t) !== host) continue;
    if (!credInUse(await stored(t))) out.push(t);
  }
  return out;
}
