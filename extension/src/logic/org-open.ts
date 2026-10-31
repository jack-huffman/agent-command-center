/**
 * Opening a ticket's development org from the ticket (T-161): whether this machine is known not to be logged in to
 * an environment's org, by the last Setup check, and how an open runs: a component whose page needs its id asks
 * the org for it first, then `sf org open --path` opens the page. Like the rest of logic/, no `vscode` import.
 */

import type { Config } from '../../../packages/core/src/config.ts';
import type { Task } from '../../../packages/core/src/ledger.ts';
import { PRODUCTION_NOT_HERE } from '../../../packages/core/src/sf-discovery.ts';
import { sfComponent } from '../../../packages/core/src/sf-metadata.ts';
import { idFrom, idQueryArgs, lookedUp, orgOpen, orgOpenArgs, SETUP_HOME } from '../../../packages/core/src/sf-org-pages.ts';
import { tryIt } from '../model/try-it.ts';
import type { DoctorItem } from './setup.ts';

/**
 * Whether this machine is known not to be logged in to an environment's org: the last Setup check, run in this
 * project, said so on B6.org-match's line, by the org's alias, or for Production by its branch (D-208). Before that
 * check, or for another project, it isn't known, and the org stays on.
 */
export function orgNotHere(items: DoctorItem[], setupRoot: string | null | undefined, projectFor: (path: string) => { root: string } | undefined): (root: string, env: { branch: string; org: string | null }) => boolean {
  const match = items.find((i) => i.id === 'B6.org-match');
  const checked = setupRoot ? projectFor(setupRoot)?.root : undefined;
  return (root, env) => !!match && checked === root
    && ((!!env.org && match.detail.includes(`"${env.org}" isn't logged in`)) || match.detail.includes(`${env.branch}: ${PRODUCTION_NOT_HERE}`));
}

/** What an open does: the org, and the page now or a lookup first. Or why it can't, in words. */
export type OpenPlan =
  | { ok: true; org: string; title: string; open: ReturnType<typeof orgOpen> | null }
  | { ok: false; why: string };

/**
 * The open a page asked for, checked against the ticket as it is now: its builder's deploy to its environment
 * passed, the org is there, and a component's path is one that deploy made. No path opens the org's home.
 */
export function openPlan(config: Pick<Config, 'profile' | 'environments'>, t: Task, path: string | undefined, notHere: (branch: string) => boolean): OpenPlan {
  const x = tryIt(config, t, notHere);
  if (!x) return { ok: false, why: `${t.id} has no deploy by its builder to its environment that passed.` };
  if (x.open.disabled || !x.org) return { ok: false, why: x.open.disabled ?? `${x.name} has no org in the project's settings.` };
  if (path === undefined) return { ok: true, org: x.org, title: x.open.label, open: null };
  const c = x.components.find((y) => y.path === path);
  if (!c) return { ok: false, why: `${path} isn't one of the components ${t.id}'s builder deployed.` };
  const sf = sfComponent(path);
  return { ok: true, org: x.org, title: `Open ${c.name} in ${x.name}`, open: sf ? orgOpen(sf) : { kind: 'page', page: SETUP_HOME, where: 'Setup' } };
}

/** How sf ran: its exit code and what it said. */
export interface SfRun {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs an open: asks the org for the component's id where its page needs one, then opens the page, or the type's
 * list where the org had none. Returns what went wrong in words, or null when the browser opened.
 */
export async function runOpen(sf: (args: string[]) => Promise<SfRun>, plan: Extract<OpenPlan, { ok: true }>): Promise<string | null> {
  let page: string | undefined;
  if (plan.open?.kind === 'page') page = plan.open.page;
  else if (plan.open?.kind === 'lookup') page = lookedUp(plan.open, idFrom((await sf(idQueryArgs(plan.org, plan.open))).stdout));
  const r = await sf(orgOpenArgs(plan.org, page));
  if (r.code === 0) return null;
  const said = (r.stderr || r.stdout).trim().split('\n').find((l) => l.trim()) ?? `sf exited with ${r.code}`;
  return `${plan.org} didn't open: ${said}`;
}
