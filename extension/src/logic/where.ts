/**
 * Check this org (T-167): a row's one quiet action reads where a ticket's work is in that one environment, with
 * `acc where <id> --env <branch>`, for work deployed outside acc. Only a click starts a read: a draw takes the
 * readings acc kept beside the ledger (`kept`) and never starts one, and neither does a refresh or a time. A
 * reading is a note beside its row; the row's state is acc's record. Like the rest of logic/, no `vscode`
 * import, so it's tested with node:test.
 */
import { readWhere, type TicketWhere } from '../../../packages/core/src/where-kept.ts';
import { ticketKey } from './shared.ts';

type Result = { code: number; stdout: string; stderr: string };

/** What the reads need from the extension, passed in so they're tested without VS Code or acc. */
export interface WhereHost {
  /** Runs acc with these arguments in the project. */
  acc(args: string[], cwd: string): Promise<Result>;
  /** A read came back: the ticket's page draws again. */
  done(root: string, id: string): void;
}

export class WhereReads {
  private readonly host: WhereHost;
  /** The reads under way, by project, task and environment. */
  private readonly busy = new Set<string>();

  constructor(host: WhereHost) {
    this.host = host;
  }

  /** The ticket's kept readings, for the notes beside its rows. It only reads the file: a draw never starts a read. Null before the first. */
  kept(stateDir: string, id: string): TicketWhere | null {
    return readWhere({ stateDir }, id.toUpperCase());
  }

  /** A row's Check this org: reads where the ticket's work is in the environment whose branch is `env`, alone. One read of each at a time. */
  read(root: string, id: string, env: string): Promise<void> {
    const key = `${ticketKey(root, id)}>${env}`;
    if (this.busy.has(key)) return Promise.resolve();
    this.busy.add(key);
    return this.host.acc(['where', id, '--env', env, '--json'], root).then(() => undefined, () => undefined).finally(() => {
      this.busy.delete(key);
      this.host.done(root, id);
    });
  }

  /** Whether a check of the environment whose branch is `env` is under way. */
  reading(root: string, id: string, env: string): boolean {
    return this.busy.has(`${ticketKey(root, id)}>${env}`);
  }
}
