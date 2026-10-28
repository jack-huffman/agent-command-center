/**
 * A ticket's deploy from its Changes tab (T-138): Deploy to <environment> asks acc for the plan, whose check
 * changes nothing, in the output panel, where its steps show; the sheet says the step it's on. Only the sheet's
 * own Deploy, after a check that passed, sends the person's yes with that check's id, and with the org's name
 * typed for production or a protected org. acc refuses a yes it didn't check too (D-219). Like the rest of
 * logic/, no `vscode` import, so it's tested with node:test.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Runner } from '../../../packages/core/src/exec.ts';
import type { TaskDeployPlan, TaskDeployResult } from '../../../packages/core/src/task-deploy.ts';
import type { DeployRun } from '../model/ticket-deploy.ts';
import { accRefusal } from './connect.ts';
import { inProcessWords } from './processes.ts';
import type { RunSteps } from './run-steps.ts';
import { ticketKey } from './shared.ts';

type Result = { code: number; stdout: string; stderr: string };

/**
 * Of a branch's changed paths, those it deletes (T-138): gone from its worktree where it has one, else from
 * the branch's own tree. None when the branch can't be read, so nothing is called deleted by mistake.
 */
export function deletedPaths(run: Runner, root: string, branch: string, worktree: string | null | undefined, paths: string[]): string[] {
  if (!paths.length) return [];
  if (worktree && existsSync(worktree)) return paths.filter((p) => !existsSync(join(worktree, p)));
  const r = run('git', ['ls-tree', '-r', '--name-only', '-z', `refs/heads/${branch}`, '--', ...paths], { cwd: root });
  if (r.code !== 0) return [];
  const there = new Set(r.stdout.split('\0').filter(Boolean));
  return paths.filter((p) => !there.has(p));
}

/** What the deploy needs from the extension, passed in so it's tested without VS Code, sf or acc. */
export interface DeployHost {
  /** An environment's name, by its branch, in the project's settings; undefined for a project that closed. */
  envName(root: string, branch: string): string | undefined;
  /** Runs acc with --json in the output panel, telling `onSteps` its steps as they change. */
  acc(args: string[], cwd: string, label: string, onSteps: (s: RunSteps) => void): Promise<Result>;
}

export type DeployReply = { ok: true } | { ok: false; error: string };

/** What a step acc is on says, in its own process words: the last one started and not ended. Null before the first. */
export const stepOn = (s: RunSteps): string | null => [...s.steps].reverse().find((x) => x.state === 'started')?.label ?? null;

const parse = <T>(stdout: string, has: string): T | null => {
  try {
    const v = JSON.parse(stdout) as Record<string, unknown>;
    return v && typeof v === 'object' && has in v ? v as T : null;
  } catch {
    return null;
  }
};

/**
 * Why the sheet's Deploy can't send this yes, or null: there must be a check that passed for this environment,
 * with this id, and the org's name typed where it's asked for.
 */
export function yesRefusal(run: DeployRun | null, to: string, checkId: string, typed: string | undefined): string | null {
  const plan = run?.plan;
  if (!run || run.phase !== 'passed' || !plan?.check?.passed || !plan.check.id) return 'There\'s no check that passed to say yes to. Check it first.';
  if (run.to !== to || plan.check.id !== checkId) return 'That yes is for another check. Check it again.';
  if (plan.confirm && ![plan.confirmName, plan.org].includes((typed ?? '').trim())) return `Type ${plan.confirmName} to deploy to it.`;
  return null;
}

export class TicketDeploys {
  private readonly host: DeployHost;
  private readonly changed: (root: string, id: string) => void;
  /** Each ticket's deploy while its sheet is open, by project and task. */
  private readonly runs = new Map<string, DeployRun>();

  constructor(host: DeployHost, changed: (root: string, id: string) => void = () => {}) {
    this.host = host;
    this.changed = changed;
  }

  /** The ticket's deploy while its sheet is open, else null. */
  run(root: string, id: string): DeployRun | null {
    return this.runs.get(ticketKey(root, id)) ?? null;
  }

  private set(root: string, id: string, run: DeployRun): void {
    this.runs.set(ticketKey(root, id), run);
    this.changed(root, id.toUpperCase());
  }

  /** The step acc is on, while the run is still checking or deploying. */
  private onSteps(root: string, id: string): (s: RunSteps) => void {
    return (s) => {
      const run = this.run(root, id);
      const words = stepOn(s);
      if (!run || !words || (run.phase !== 'checking' && run.phase !== 'deploying')) return;
      this.set(root, id, { ...run, progress: inProcessWords(words) });
    };
  }

  /** Deploy to <environment>: the sheet opens checking, and acc makes the plan, whose check changes nothing. */
  async check(root: string, raw: string, to: string): Promise<DeployReply> {
    const id = raw.toUpperCase();
    const toName = this.host.envName(root, to);
    if (!toName) return { ok: false, error: `${to} isn't an environment in the project's settings.` };
    const now = this.run(root, id);
    if (now?.phase === 'checking' || now?.phase === 'deploying') return { ok: false, error: 'It\'s under way now. Wait for it to finish.' };
    const started: DeployRun = { to, toName, phase: 'checking', progress: null, plan: null, result: null, error: null };
    this.set(root, id, started);
    // A check the person cancelled while it ran: its answer, when it comes, is let go.
    const cancelled = (): boolean => this.run(root, id)?.phase !== 'checking' || this.run(root, id)?.to !== to;
    let r: Result;
    try {
      r = await this.host.acc(['deploy', to, '--task', id, '--plan', '--json'], root, `Check ${id} against ${toName}`, this.onSteps(root, id));
    } catch (e) {
      r = { code: 1, stdout: '', stderr: (e as Error).message };
    }
    if (cancelled()) return { ok: true };
    const plan = parse<TaskDeployPlan>(r.stdout, 'check');
    if (!plan) {
      const error = accRefusal(r) ?? 'The check gave no plan.';
      this.set(root, id, { to, toName, phase: 'error', progress: null, plan: null, result: null, error });
      return { ok: false, error };
    }
    this.set(root, id, { to, toName, phase: plan.check?.passed ? 'passed' : 'failed', progress: null, plan, result: null, error: null });
    return { ok: true };
  }

  /** The sheet's Deploy: refused here first unless it's the yes to a check that passed; then acc deploys what it checked. */
  async deploy(root: string, raw: string, to: string, checkId: string, typed?: string): Promise<DeployReply> {
    const id = raw.toUpperCase();
    const run = this.run(root, id);
    const why = yesRefusal(run, to, checkId, typed);
    if (why) return { ok: false, error: why };
    const plan = run!.plan!;
    this.set(root, id, { ...run!, phase: 'deploying', progress: null });
    let r: Result;
    try {
      r = await this.host.acc(['deploy', to, '--task', id, '--yes', checkId, ...(plan.confirm ? ['--confirm-production', (typed ?? '').trim()] : []), '--json'], root, `Deploy ${id} to ${run!.toName}`, this.onSteps(root, id));
    } catch (e) {
      r = { code: 1, stdout: '', stderr: (e as Error).message };
    }
    const result = parse<TaskDeployResult>(r.stdout, 'deployed');
    const went = !!result && (result.deployed || (!result.plan.files.length && !!result.pr));
    const error = went ? null : result ? inProcessWords(result.summary) : accRefusal(r) ?? 'The deploy gave no result.';
    this.set(root, id, { ...(this.run(root, id) ?? run!), phase: went ? 'deployed' : 'error', progress: null, result, error });
    return error ? { ok: false, error } : { ok: true };
  }

  /**
   * Cancel or Close, which always works: what the sheet kept goes, and a check under way is let go, its plan
   * never shown. A deploy under way can't be taken back here: the sheet closes, and the tab says how it goes.
   */
  close(root: string, raw: string): void {
    const id = raw.toUpperCase();
    const run = this.run(root, id);
    if (!run) return;
    if (run.phase === 'deploying') this.set(root, id, { ...run, hidden: true });
    else {
      this.runs.delete(ticketKey(root, id));
      this.changed(root, id);
    }
  }
}
