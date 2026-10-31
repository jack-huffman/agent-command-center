/**
 * Try it in the org (T-161): once a builder's deploy to the ticket's development org passed, the ticket opens that
 * org, opens each component it deployed at its own page there, and shows how to test it, in its builder's own
 * words. Open <environment> is off with why where the org isn't in the settings or this machine isn't logged in to
 * it. Plain data and the message's check: no vscode import.
 */

import type { Config } from '../../../packages/core/src/config.ts';
import type { TaskDeploy } from '../../../packages/core/src/deploy-gate.ts';
import { shownNote, type Task } from '../../../packages/core/src/ledger.ts';
import { sfComponent } from '../../../packages/core/src/sf-metadata.ts';
import { orgOpen } from '../../../packages/core/src/sf-org-pages.ts';
import { KEY, type ModelArea, short } from './shared.ts';

/** One component the builder deployed: its type and name as a person reads them, where it opens, and its source path, which names it to the extension. */
export interface TryComponent {
  label: string;
  name: string;
  /** Where it opens, in words: "Object Manager", "Flow Builder", "Setup". */
  where: string;
  path: string;
}

/** The development org, as the ticket offers it once its builder's deploy there passed. */
export interface TryIt {
  task: string;
  /** The development environment's branch and name: the row it is drawn on. */
  env: string;
  name: string;
  org: string | null;
  /** When the builder's deploy there passed. */
  at: string;
  /** Open <environment>: off with why where it can't open. */
  open: { label: string; disabled: string | null };
  /** Each component it deployed, once, in the order deployed. */
  components: TryComponent[];
  /** How to test it, in its builder's own words (its note's --test lines); empty where it gave none. */
  howTo: string[];
  /** Its build is done: its builder finished, so it is in review or done. The Agent panel shows it then. */
  built: boolean;
}

/** The states a task is in once its builder finished: the Agent panel offers its org then. */
export const BUILT_STATES: readonly string[] = ['review', 'done'];

/** Why an org can't open from here, or null: none in the settings, or this machine isn't logged in to it, as the last Setup check said. */
export function orgOff(e: { name: string; org: string | null }, notHere: boolean): string | null {
  if (!e.org) return `${e.name} has no org in the project's settings.`;
  if (notHere) return `This machine isn't logged in to ${e.org}. Log in to it from Setup.`;
  return null;
}

/**
 * The builder's deploy that passed to the ticket's own environment: its latest by its builder (a person's deploy
 * names who said yes), whose tests didn't fail. Null where there's none.
 */
export function passedDeploy(t: Pick<Task, 'environment' | 'deploys'>): TaskDeploy | null {
  const own = (t.deploys ?? []).filter((d) => d.env === t.environment && !d.by).sort((a, b) => a.at.localeCompare(b.at)).at(-1);
  return own && own.tests?.outcome !== 'fail' ? own : null;
}

/** Each component a deploy's paths make, once, in the order deployed: a path the profile can't name opens Setup, as itself. */
export function tryComponents(paths: string[]): TryComponent[] {
  const seen = new Set<string>();
  const out: TryComponent[] = [];
  for (const path of paths) {
    const c = sfComponent(path);
    const key = c ? `${c.type}:${c.name}` : path;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c ? { label: c.label, name: c.name, where: orgOpen(c).where, path } : { label: 'File', name: path, where: 'Setup', path });
  }
  return out;
}

/** Try it in the org: a Salesforce task whose builder's deploy to its environment passed; null for any other. */
export function tryIt(config: Pick<Config, 'profile' | 'environments'>, t: Pick<Task, 'id' | 'environment' | 'deploys' | 'state' | 'run'>, notHere: (branch: string) => boolean = () => false): TryIt | null {
  if (config.profile !== 'salesforce') return null;
  const d = passedDeploy(t);
  const e = config.environments.find((x) => x.branch === t.environment);
  if (!d || !e) return null;
  return {
    task: t.id, env: e.branch, name: e.name, org: e.org, at: d.at,
    open: { label: `Open ${e.name}`, disabled: orgOff(e, notHere(e.branch)) },
    components: tryComponents(d.paths),
    howTo: shownNote(t).note?.test ?? [],
    built: BUILT_STATES.includes(t.state),
  };
}

export type Message =
  /** Open <environment>, or one component at its own page there (`path`, one of the components the builder deployed). */
  | { type: 'org-open'; project: string; task: string; path?: string };

export const area: ModelArea = {
  messages: {
    'org-open': (x) => short(x.project, 4096) && short(x.task, 100) && KEY.test(x.task as string) && (x.path === undefined || short(x.path, 4096)),
  },
};
