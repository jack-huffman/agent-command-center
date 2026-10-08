// Settings' Limits and checks (GH-111), VS Code's side: what the part reads, from this machine and each
// project, and its commands. Each asks with a quick pick, or takes the value − or + sent, and runs acc,
// which changes only its own key: the page never writes a file (D-064). VS Code's API comes from the parts
// activate() hands every area, so a test can drive the commands with a stand-in (D-099).

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type * as vscode from 'vscode';
import { autoMergeFor, type Config } from '../../packages/core/src/config.ts';
import { gatesFor } from '../../packages/core/src/gates.ts';
import { builders, type Ledger } from '../../packages/core/src/ledger.ts';
import { agentsMaxSet, machineAgents, machineRepos, MAX_AGENTS, MAX_MACHINE_AGENTS, realLedger, recentWork } from '../../packages/core/src/limits.ts';
import { heavySlots, type HeavyState, machineFile, MAX_HEAVY_SLOTS } from '../../packages/core/src/semaphore.ts';
import type { ExtensionArea } from './area.ts';
import type { LimitsFacts } from './model/limits.ts';
import type { RunResult } from './run.ts';

/** A project as the part reads it: the hub's, with its config, ledger and builder's model. */
export interface LimitsProject {
  name: string;
  root: string;
  config: Config;
  ledgerPath: string;
  agents: { builder: { model: string; from: { model: string } } };
}

/** Where a path is under the home folder, as ~/… */
const tilde = (p: string, home: string): string => (p === home || p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);

/** The environments whose pull requests go through the merge queue (D-096). */
export const queueOf = (config: Config): string[] => config.environments.filter((e) => autoMergeFor(config, e.branch)).map((e) => e.name);

/**
 * What Settings' Limits and checks shows: this machine's heavy-check slots and its total across every repo,
 * with how many builders run on it now; and each project's cap, checks, builder's model and recent work. All
 * reads: small files, and every repo's ledger acc noted on this machine.
 */
export function readLimits(projects: LimitsProject[], ledgerOf: (root: string) => Ledger | undefined, heavy: HeavyState | null, env: NodeJS.ProcessEnv = process.env, home = homedir()): LimitsFacts {
  const file = machineFile(env);
  let saved: { heavySlots?: unknown } = {};
  try { saved = JSON.parse(readFileSync(file, 'utf8')) as { heavySlots?: unknown }; } catch { /* none yet */ }
  const fromEnv = Math.floor(Number(env.ACC_HEAVY_SLOTS)) >= 1;
  const slotsFrom = fromEnv ? 'env' : Math.floor(Number(saved.heavySlots)) >= 1 ? 'machine' : 'default';
  // Builders on this machine: each open project's repo from its ledger, then every other repo acc noted.
  const counted = new Set<string>();
  let running = 0;
  let repos = 0;
  for (const p of projects) {
    const key = realLedger(p.ledgerPath);
    if (counted.has(key)) continue;
    counted.add(key);
    const n = builders(ledgerOf(p.root) ?? { tasks: [] }, '');
    running += n;
    if (n) repos++;
  }
  for (const r of machineRepos(env)) {
    if (counted.has(r.ledger)) continue;
    counted.add(r.ledger);
    running += r.running;
    if (r.running) repos++;
  }
  // A repo's recent work is told once, by its first project, though two projects share it.
  const told = new Set<string>();
  return {
    machine: {
      slots: heavySlots(env), slotsFrom, inUse: heavy?.held.length ?? 0, waiting: heavy?.waiting.length ?? 0,
      total: machineAgents(env), running, repos, file: tilde(file, home),
    },
    projects: projects.map((p) => {
      const ledger = ledgerOf(p.root) ?? { schema: 1, seq: 0, tasks: [] };
      const state = dirname(p.ledgerPath);
      const first = !told.has(p.ledgerPath);
      told.add(p.ledgerPath);
      return {
        name: p.name, root: p.root, repo: p.ledgerPath,
        max: p.config.agents.max, maxFrom: agentsMaxSet(join(p.root, '.acc', 'config.json')) ? 'project' : 'acc',
        running: builders(ledger, ''),
        required: p.config.gates.required, builder: p.config.gates.builder?.length ? p.config.gates.builder : null,
        gates: gatesFor(p.config).map((g) => ({ name: g.name, about: g.about })),
        queue: queueOf(p.config),
        model: p.agents.builder.model, modelFrom: p.agents.builder.from.model,
        recent: first ? recentWork({ reviews: join(state, 'reviews'), analyses: join(state, 'analyses') }, ledger) : { builds: [], reviews: [], analyses: [] },
      };
    }),
  };
}

// ---------------------------------------------------------------- the commands

/** What the commands need from the rest of the extension. */
export interface LimitsDeps {
  projects(): LimitsProject[];
  project(root: string): LimitsProject | undefined;
  /** Runs acc in a folder. */
  acc(args: string[], cwd: string): Promise<RunResult>;
  /** What acc said when it refused, in its own words. */
  says(r: RunResult): string;
  /** Read again what a change changed, so the page shows it. */
  changed(): Promise<void>;
  /** Heavy-check slots and where they're set, as the part shows them. */
  slots(): { slots: number; fromEnv: boolean };
  machineTotal(): number | null;
  home: string;
}

type Vscode = Pick<typeof vscode, 'window'>;
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const now = (on: boolean): string | undefined => (on ? 'now' : undefined);

/**
 * The part's commands, by id. Each runs acc once, with --json, says what changed or what acc refused, and
 * reads what changed again. A value from − or + is set at once; without one, a quick pick asks.
 */
export function limitCommands(vs: Vscode, d: LimitsDeps): Record<string, (arg?: unknown) => Promise<void>> {
  const pickProject = async (root?: string): Promise<LimitsProject | undefined> => {
    if (root) return d.project(root);
    const all = d.projects();
    if (all.length <= 1) return all[0];
    return (await vs.window.showQuickPick(all.map((p) => ({ label: p.name, description: p.root, p })), { title: 'Which project?' }))?.p;
  };
  const cwd = (): string => d.projects()[0]?.root ?? d.home;
  /** Runs acc; true when it did it. A refusal is said in acc's own words. */
  const run = async (args: string[], where: string, done: string): Promise<boolean> => {
    const r = await d.acc([...args, '--json'], where);
    if (r.code !== 0) {
      void vs.window.showWarningMessage(d.says(r));
      return false;
    }
    await d.changed();
    void vs.window.showInformationMessage(done);
    return true;
  };
  const whole = (v: unknown, max: number): number | null => (typeof v === 'string' && /^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= max ? Number(v) : null);

  return {
    /** A project's builder cap (agents.max), in its .acc/config.json. */
    async agentsMax(arg) {
      const [root, given] = typeof arg === 'string' ? arg.split('|') : [];
      const p = await pickProject(root);
      if (!p) return;
      const was = p.config.agents.max;
      const { slots } = d.slots();
      let n = given !== undefined ? whole(given, MAX_AGENTS) : null;
      if (given !== undefined && n === null) return;
      if (n === null) {
        const pick = await vs.window.showQuickPick(range(1, MAX_AGENTS).map((k) => ({
          label: String(k), description: now(k === was), value: k,
          detail: k > slots ? `Past this machine's ${slots} heavy-check slot${slots === 1 ? '' : 's'}, ${k - slots} wait${k - slots === 1 ? 's' : ''} in line for checks.` : 'Each runs its checks without waiting for another builder\'s.',
        })), { title: `${p.name}: how many builders at once?`, placeHolder: `Now ${was}. Set in .acc/config.json, for everyone on the repo once it's committed.` });
        if (!pick) return;
        n = pick.value;
      }
      if (n === was) return;
      await run(['agents', 'max', String(n)], p.root, `${p.name} now runs at most ${n} builder${n === 1 ? '' : 's'} at once. Changed in .acc/config.json: commit it to share it.`);
    },

    /** This machine's total across every repo, in ~/.acc/machine.json, or none. */
    async machineAgents(arg) {
      const was = d.machineTotal();
      let n: number | null | undefined = arg === 'none' ? null : arg !== undefined ? whole(arg, MAX_MACHINE_AGENTS) ?? undefined : undefined;
      if (arg !== undefined && n === undefined) return;
      if (n === undefined) {
        const pick = await vs.window.showQuickPick([
          { label: 'No total', description: now(was === null), detail: 'Each project\'s cap is the only limit.', value: null as number | null | 'more' },
          ...range(1, 16).map((k) => ({ label: String(k), description: now(k === was), detail: `At most ${k} builder${k === 1 ? '' : 's'} at once, across every repo on this machine.`, value: k as number | null | 'more' })),
          { label: 'Another number…', description: was !== null && was > 16 ? `now ${was}` : undefined, detail: `Up to ${MAX_MACHINE_AGENTS}.`, value: 'more' as const },
        ], { title: 'This machine: how many builders at once, across every repo?', placeHolder: 'Usage limits belong to your Claude account, not a project. Kept in ~/.acc/machine.json.' });
        if (!pick) return;
        if (pick.value === 'more') {
          const typed = await vs.window.showInputBox({ title: 'This machine\'s total', prompt: `How many builders at once, across every repo: 1 to ${MAX_MACHINE_AGENTS}`, value: was !== null ? String(was) : '', validateInput: (v) => (whole(v.trim(), MAX_MACHINE_AGENTS) === null ? `A whole number from 1 to ${MAX_MACHINE_AGENTS}` : undefined) });
          if (typed === undefined) return;
          n = whole(typed.trim(), MAX_MACHINE_AGENTS);
          if (n === null) return;
        } else n = pick.value;
      }
      if (n === was) return;
      await run(['machine', 'agents', ...(n === null ? ['--none'] : [String(n)])], cwd(), n === null
        ? 'This machine has no total now: each project\'s cap is the only limit.'
        : `This machine now runs at most ${n} builder${n === 1 ? '' : 's'} at once, across every repo on it.`);
    },

    /** This machine's heavy-check slots (D-080), in ~/.acc/machine.json. */
    async heavySlots(arg) {
      const { slots: was, fromEnv } = d.slots();
      if (fromEnv) {
        void vs.window.showInformationMessage('ACC_HEAVY_SLOTS sets this machine\'s heavy-check slots for this VSCode, and wins over its own setting. Take it out of the environment VSCode starts in to set them here.');
        return;
      }
      let n = arg !== undefined ? whole(arg, MAX_HEAVY_SLOTS) : null;
      if (arg !== undefined && n === null) return;
      if (n === null) {
        const pick = await vs.window.showQuickPick(range(1, MAX_HEAVY_SLOTS).map((k) => ({
          label: String(k), description: now(k === was), value: k,
          detail: k === 1 ? 'One build or test run at a time: the machine stays calm, and builders wait in line.' : `${k} builds or test runs at once, from every repo on this machine. If it stutters, set fewer.`,
        })), { title: 'This machine: how many heavy checks at once?', placeHolder: 'Builds, tests and validations, for every repo on this machine. Kept in ~/.acc/machine.json.' });
        if (!pick) return;
        n = pick.value;
      }
      if (n === was) return;
      await run(['machine', 'heavy-slots', String(n)], cwd(), `This machine now runs ${n} heavy check${n === 1 ? '' : 's'} at once, for every repo on it.`);
    },

    /** The checks every task in a project must pass (gates.required). */
    async requiredGates(arg) {
      const p = await pickProject(typeof arg === 'string' ? arg : undefined);
      if (!p) return;
      const gates = gatesFor(p.config);
      if (!gates.length) {
        void vs.window.showInformationMessage(`${p.name} has no checks to choose from yet: add commands under "gates.commands" in its .acc/config.json.`);
        return;
      }
      const was = p.config.gates.required;
      const queue = queueOf(p.config);
      const picked = await vs.window.showQuickPick(gates.map((g) => ({ label: g.name, description: g.about, picked: was.includes(g.name), value: g.name })), {
        title: `${p.name}: which checks must every task pass?`, canPickMany: true,
        placeHolder: queue.length ? `Where the merge queue runs (${queue.join(', ')}), they run once in it, before each merge.` : 'acc done, review and land take them.',
      });
      if (!picked) return;
      const names = picked.map((x) => x.value);
      if (!names.length) {
        void vs.window.showWarningMessage('Pick at least one check: with none, acc done would take any commit.');
        return;
      }
      if (names.join('\n') === was.join('\n')) return;
      await run(['gate', 'required', ...names], p.root, `${p.name}'s required checks are now ${names.join(', ')}. Changed in .acc/config.json: commit it to share it.`);
    },

    /** Builders' lighter checks where the merge queue runs the required ones (gates.builder, D-096), or none. */
    async builderGates(arg) {
      const p = await pickProject(typeof arg === 'string' ? arg : undefined);
      if (!p) return;
      const gates = gatesFor(p.config);
      if (!gates.length) {
        void vs.window.showInformationMessage(`${p.name} has no checks to choose from yet: add commands under "gates.commands" in its .acc/config.json.`);
        return;
      }
      const was = p.config.gates.builder?.length ? p.config.gates.builder : [];
      const queue = queueOf(p.config);
      const picked = await vs.window.showQuickPick(gates.map((g) => ({ label: g.name, description: g.about, picked: was.includes(g.name), value: g.name })), {
        title: `${p.name}: which lighter checks do builders run?`, canPickMany: true,
        placeHolder: `${queue.length ? `Where the merge queue runs (${queue.join(', ')}), the required checks run once in it.` : 'No merge queue runs here yet, so builders run the required checks.'} Pick none for builders to run the required checks.`,
      });
      if (!picked) return;
      const names = picked.map((x) => x.value);
      if (names.join('\n') === was.join('\n')) return;
      await run(['gate', 'builder', ...(names.length ? names : ['--none'])], p.root, names.length
        ? `${p.name}'s builders now run ${names.join(', ')}${queue.length ? '' : ' once a merge queue runs there'}. Changed in .acc/config.json: commit it to share it.`
        : `${p.name}'s builders now run the required checks. Changed in .acc/config.json: commit it to share it.`);
    },
  };
}

export const area: ExtensionArea = {
  register({ vscode: vs, reg, hub, sidebar, accSays }) {
    const c = limitCommands(vs, {
      projects: () => hub.projects,
      project: (root) => hub.project(root),
      acc: (args, cwd) => sidebar.acc(args, cwd),
      says: accSays,
      changed: async () => {
        hub.forgetLimits();
        await hub.loadProjects();
      },
      slots: () => ({ slots: heavySlots(), fromEnv: Math.floor(Number(process.env.ACC_HEAVY_SLOTS)) >= 1 }),
      machineTotal: () => machineAgents(),
      home: homedir(),
    });
    reg('acc.settings.agentsMax', (a?: unknown) => c.agentsMax!(a));
    reg('acc.settings.machineAgents', (a?: unknown) => c.machineAgents!(a));
    reg('acc.settings.heavySlots', (a?: unknown) => c.heavySlots!(a));
    reg('acc.settings.requiredGates', (a?: unknown) => c.requiredGates!(a));
    reg('acc.settings.builderGates', (a?: unknown) => c.builderGates!(a));
  },
};
