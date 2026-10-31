/**
 * Where a ticket's work is (T-155), read behind the page: a draw takes the readings acc kept beside the ledger
 * and never waits on an org. A reading that's due (none yet, too old, or older than a deploy since) starts
 * acc's read of it in the background, and the page draws again when it's back. The person's Refresh reads it
 * again whatever its age. A draw starts a ticket's read at most once in WHERE_MAX_AGE_MS, or again after a
 * deploy or promotion since, so a read that keeps no readings never sets the page reading in a loop. Like the rest of
 * logic/, no `vscode` import, so it's tested with node:test.
 */
import type { Task } from '../../../packages/core/src/ledger.ts';
import { WHERE_COMMAND } from '../../../packages/core/src/where.ts';
import { readWhere, ticketEnvironments, type TicketWhere, WHERE_MAX_AGE_MS, whereDue } from '../../../packages/core/src/where-kept.ts';
import type { Config } from '../../../packages/core/src/config.ts';
import { ticketKey } from './shared.ts';

type Result = { code: number; stdout: string; stderr: string };

/** What the reads need from the extension, passed in so they're tested without VS Code or acc. */
export interface WhereHost {
  /** Runs acc with these arguments in the project. */
  acc(args: string[], cwd: string): Promise<Result>;
  /** A read came back: the ticket's page draws again. */
  done(root: string, id: string): void;
  now(): Date;
}

export class WhereReads {
  private readonly host: WhereHost;
  /** The reads under way, by project and task. */
  private readonly busy = new Set<string>();
  /** When a draw last started a read, by project and task. */
  private readonly tried = new Map<string, number>();

  constructor(host: WhereHost) {
    this.host = host;
  }

  /** The ticket's kept readings for the page; a due one is read again behind it. Null before the first, or for a ticket that can't be read. */
  kept(root: string, stateDir: string, config: Pick<Config, 'profile' | 'environments'>, task: Task): TicketWhere | null {
    if (!WHERE_COMMAND.enabled({ config, task }).ok) return null;
    const w = readWhere({ stateDir }, task.id);
    const envs = ticketEnvironments(config, task.environment).map((e) => e.branch);
    const key = ticketKey(root, task.id);
    const last = this.tried.get(key);
    const since = last === undefined ? '' : new Date(last).toISOString();
    const deployedSince = [...(task.deploys ?? []).map((d) => d.at), ...(task.promotions ?? []).map((p) => p.mergedAt ?? p.at)].some((at) => at > since);
    const waited = last === undefined || this.host.now().getTime() - last > WHERE_MAX_AGE_MS || deployedSince;
    if (waited && whereDue(w, task, envs, this.host.now()).length) {
      this.tried.set(key, this.host.now().getTime());
      this.read(root, task.id);
    }
    return w;
  }

  /**
   * Reads where the ticket's work is now: in every environment it can be in (the person's Refresh, or a due
   * reading), or with `env`, in that one alone (a row's Check again, T-158). One read at a time of each; a read of
   * every environment under way covers a row's.
   */
  read(root: string, id: string, env?: string): Promise<void> {
    const all = ticketKey(root, id);
    const key = env ? `${all}>${env}` : all;
    if (this.busy.has(all) || this.busy.has(key)) return Promise.resolve();
    this.busy.add(key);
    return this.host.acc(['where', id, ...(env ? ['--env', env] : []), '--json'], root).then(() => undefined, () => undefined).finally(() => {
      this.busy.delete(key);
      this.host.done(root, id);
    });
  }

  /** Whether a read of the ticket is under way: of every environment, or with `env`, of every one or that one. */
  reading(root: string, id: string, env?: string): boolean {
    const all = ticketKey(root, id);
    return this.busy.has(all) || (env !== undefined && this.busy.has(`${all}>${env}`));
  }
}
