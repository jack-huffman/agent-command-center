/**
 * Join a team project's decisions (T-176): which account to clone as, asked as a single choice of at most three
 * and the person's own words (D-205), and what acc join said. No vscode import, so they're testable.
 */

/** The most accounts a single choice lists before the person's own words (D-205). */
export const ACCOUNT_OPTIONS_MAX = 3;

/** The answer that lets the person name an account in their own words. */
export const OWN_ACCOUNT = { label: '$(edit) Another account, in my own words…', own: true as const };

/** One answer to "Which account clones it?". */
export interface AccountChoice {
  label: string;
  description?: string;
  account?: string;
  own?: true;
}

/** The accounts that can read the repo, at most three, then the person's own words. One that's active comes first. */
export function accountChoices(readers: string[], active: string | null = null): AccountChoice[] {
  const ordered = active && readers.includes(active) ? [active, ...readers.filter((r) => r !== active)] : readers;
  return [
    ...ordered.slice(0, ACCOUNT_OPTIONS_MAX).map((a, i): AccountChoice => ({ label: `$(github) ${a}`, description: i === 0 ? 'Can read the repo (suggested)' : 'Can read the repo', account: a })),
    OWN_ACCOUNT,
  ];
}

/** What acc join --dry-run says it would do, or why it can't. */
export type JoinCheck = { ok: true; repo: string; readers: string[]; account: string | null; dir: string } | { ok: false; message: string };

/** What acc join (or --dry-run) printed as JSON: its answer, or its refusal in its own words. */
export function joinAnswer<T extends object>(stdout: string): ({ ok: true } & T) | { ok: false; message: string } {
  try {
    const j = JSON.parse(stdout) as T & { error?: string; message?: string };
    if (j && typeof j === 'object' && !('error' in j)) return { ok: true, ...j };
    return { ok: false, message: String(j?.message ?? 'The Command Center couldn\'t join it.') };
  } catch {
    return { ok: false, message: stdout.trim() || 'The Command Center gave no answer.' };
  }
}

/** acc join's arguments: the address, the folder and the account, with --dry-run to ask without writing. */
export const joinArgs = (address: string, o: { dir?: string; account?: string; dryRun?: boolean } = {}): string[] =>
  ['join', address.trim(), ...(o.dir ? ['--dir', o.dir] : []), ...(o.account ? ['--account', o.account] : []), ...(o.dryRun ? ['--dry-run'] : []), '--json'];

/**
 * The environments whose org B6's Do it offers a login to. In a joined project, Production is someone else's
 * (D-208, T-176): it isn't offered at all. Elsewhere every environment with an org is.
 */
export function loginEnvironments<E extends { org?: string | null; type: string }>(envs: E[], joined: boolean): E[] {
  return envs.filter((e) => e.org && e.type !== 'none' && !(joined && e.type === 'production'));
}
