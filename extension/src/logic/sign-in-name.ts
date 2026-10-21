/**
 * Who a tracker's sign-in is, by name, for "Commenting as" and the board's sign-in line (T-90). Plain logic,
 * no vscode import, so it's testable.
 */
import type { Person, TrackerKind } from '../../../packages/core/src/trackers/types.ts';

/** The trackers whose client names a sign-in: Slack its app (T-32), Azure DevOps the person, where a token's words would say only "a personal access token". */
export const NAMED_SIGN_INS: readonly TrackerKind[] = ['slack', 'azure'];

/** Each client's answer, once it's asked. A client is made once per sign-in, so this asks once per sign-in. */
const asked = new WeakMap<object, Promise<string | null>>();

/**
 * The sign-in's name from its client's me(), asked once per client. Null for a tracker that doesn't name
 * its sign-in, a client that can't start, or a me() that fails: the caller keeps the sign-in's own words
 * then. A failed me() isn't kept, so the next load asks again.
 */
export async function signInName(kind: TrackerKind, client: () => Promise<{ me(): Promise<Person> }>): Promise<string | null> {
  if (!NAMED_SIGN_INS.includes(kind)) return null;
  const c = await client().catch(() => null);
  if (!c) return null;
  let name = asked.get(c);
  if (!name) {
    name = Promise.resolve().then(() => c.me()).then((m) => m.name || null, () => null);
    asked.set(c, name);
    void name.then((n) => {
      if (n === null) asked.delete(c);
    });
  }
  return name;
}
