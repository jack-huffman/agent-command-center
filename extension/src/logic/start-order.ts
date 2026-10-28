/** The profile a project starts with (T-133). */
export type StartProfile = 'salesforce' | 'generic';

/** What starting a project does, in the order it runs: the extension's own quick picks and acc's, as functions. */
export interface StartSteps<C> {
  /** A team template, read and confirmed, with its profile: this calls no Salesforce CLI. Undefined when the person backed out. */
  template: () => Promise<C | undefined>;
  /** The profile a template's choice starts with. */
  profileOf: (choice: C) => StartProfile;
  /** Check this machine for the profile, then run go now, or later on Go on anyway. */
  check: (profile: StartProfile, go: () => Promise<void>) => Promise<void>;
  /** The rest of the choice for a profile picked from the list, such as Production's org: this may call the Salesforce CLI. */
  choose: (profile: StartProfile) => Promise<C | undefined>;
  /** The rest of a template's choice once the machine is checked, such as Production's org: this may call the Salesforce CLI. Undefined when the person backed out. */
  complete: (choice: C) => Promise<C | undefined>;
  /** Start the project with the choice. */
  start: (choice: C) => unknown;
}

/**
 * Start a project with this machine checked as soon as its profile is known (T-133). For Salesforce, the org
 * is picked only after the check, so a machine with no Salesforce CLI sees the machine's list, not an empty
 * org list. A template is read first, since it says the profile; its Production org is picked after the check.
 */
export async function startInOrder<C>(kind: StartProfile | 'template', s: StartSteps<C>): Promise<void> {
  if (kind === 'template') {
    const choice = await s.template();
    if (!choice) return;
    return s.check(s.profileOf(choice), async () => {
      const full = await s.complete(choice);
      if (full) await s.start(full);
    });
  }
  return s.check(kind, async () => {
    const choice = await s.choose(kind);
    if (choice) await s.start(choice);
  });
}
