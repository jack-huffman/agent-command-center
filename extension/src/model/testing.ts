/**
 * The ticket's Testing tab (T-161): once a builder's deploy to the ticket's development org passed, the tab says
 * where the work is, opens that org, and lists its builder's steps to test it there, each step that names one
 * component it deployed with a link to that component's page. Before that deploy, the tab says what it will hold.
 * Open <environment> is off with why where the org isn't in the settings or this machine isn't logged in to it.
 * Plain data and the message's check: no vscode import.
 */

import type { Config } from '../../../packages/core/src/config.ts';
import type { DeployTests, TaskDeploy } from '../../../packages/core/src/deploy-gate.ts';
import { shownNote, type Task } from '../../../packages/core/src/ledger.ts';
import { sfComponent } from '../../../packages/core/src/sf-metadata.ts';
import { orgOpen } from '../../../packages/core/src/sf-org-pages.ts';
import { escapeRegExp } from '../../../packages/core/src/text.ts';
import { KEY, type ModelArea, short } from './shared.ts';

/** One component the builder deployed: its name as a person reads it, where it opens, and its source path, which names it to the extension. */
export interface TestComponent {
  name: string;
  /** Where it opens, in words: "Object Manager", "Flow Builder", "Setup". */
  where: string;
  path: string;
}

/** One step to test it, in its builder's words, and the one component it names, where it names exactly one. */
export interface TestStep {
  text: string;
  link: TestComponent | null;
}

/** The work in the development org, once its builder's deploy there passed. */
export interface TestingReady {
  /** When the builder's deploy there passed. */
  at: string;
  /** Its tests, in words: "tests passed, 88% coverage", or "no Apex tests ran". */
  tests: string;
  /** Open <environment>: off with why where it can't open. */
  open: { label: string; disabled: string | null };
  /** Its builder's steps to test it (its note's --test lines), in order; empty where it gave none. */
  steps: TestStep[];
}

/** The Testing tab of a Salesforce task: its development environment, and the work there once its deploy passed. */
export interface Testing {
  task: string;
  /** The development environment's branch and name. */
  env: string;
  name: string;
  org: string | null;
  /** Null before its builder's deploy there passed: the tab says what it will hold. */
  ready: TestingReady | null;
  /** Its build is done: its builder finished, so it is in review or done. The Agent panel links to the tab then. */
  built: boolean;
}

/** The states a task is in once its builder finished: the Agent panel links to its Testing tab then. */
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
export function testComponents(paths: string[]): TestComponent[] {
  const seen = new Set<string>();
  const out: TestComponent[] = [];
  for (const path of paths) {
    const c = sfComponent(path);
    const key = c ? `${c.type}:${c.name}` : path;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c ? { name: c.name, where: orgOpen(c).where, path } : { name: path, where: 'Setup', path });
  }
  return out;
}

/** A name as a step may write it: whole, and for a part of an object ("Contact.Job_Title__c"), its own part alone. */
const spellings = (name: string): string[] => (name.includes('.') ? [name, name.slice(name.lastIndexOf('.') + 1)] : [name]);

/** Where a word appears in a text as a whole word, not inside a longer API name: each [start, end). */
function spans(text: string, word: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of text.matchAll(new RegExp(`(?<![A-Za-z0-9_])${escapeRegExp(word)}(?![A-Za-z0-9_])`, 'g'))) out.push([m.index, m.index + m[0].length]);
  return out;
}

/**
 * The one component a step names, by its API name, or null where it names none or more than one. A name found only
 * inside another's (Contact in Contact.Job_Title__c) isn't named on its own.
 */
export function stepComponent(text: string, components: readonly TestComponent[]): TestComponent | null {
  const found = components.map((c) => ({ c, at: spellings(c.name).flatMap((w) => spans(text, w)) })).filter((x) => x.at.length);
  const inside = ([s, e]: [number, number], self: TestComponent) => found.some((o) => o.c !== self && o.at.some(([os, oe]) => os <= s && e <= oe && oe - os > e - s));
  const named = found.filter((x) => x.at.some((a) => !inside(a, x.c)));
  return named.length === 1 ? named[0]!.c : null;
}

/** A deploy's tests, as the tab's one line says them. */
export function testsWords(tests: DeployTests | null): string {
  if (!tests) return 'no Apex tests ran';
  return `tests ${tests.outcome === 'pass' ? 'passed' : 'failed'}${tests.coverage ? `, ${tests.coverage} coverage` : ''}`;
}

/** The Testing tab: a Salesforce task whose environment the settings name; null for any other. */
export function testing(config: Pick<Config, 'profile' | 'environments'>, t: Pick<Task, 'id' | 'environment' | 'deploys' | 'state' | 'run'>, notHere: (branch: string) => boolean = () => false): Testing | null {
  if (config.profile !== 'salesforce') return null;
  const e = config.environments.find((x) => x.branch === t.environment);
  if (!e) return null;
  const d = passedDeploy(t);
  const components = d ? testComponents(d.paths) : [];
  return {
    task: t.id, env: e.branch, name: e.name, org: e.org,
    ready: d ? {
      at: d.at, tests: testsWords(d.tests),
      open: { label: `Open ${e.name}`, disabled: orgOff(e, notHere(e.branch)) },
      steps: (shownNote(t).note?.test ?? []).map((text) => ({ text, link: stepComponent(text, components) })),
    } : null,
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
