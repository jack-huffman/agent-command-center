/**
 * Verifying a developer's pull request from the Command Center (T-84): a task page's Verify asks acc to
 * verify, in the output panel where its steps show, and Clear asks acc to remove the verification's worktree
 * and what it kept. acc keeps the verdict, the pull requests to choose from and the QA comment's draft; this
 * reads them back for the page. Nothing here posts or pushes. Like the rest of logic/, no `vscode` import,
 * so it can be tested with node:test.
 */
import type { Task } from '../../../packages/core/src/ledger.ts';
import { latestVerification, type PrChoice, readPrChoice, type Verification, verifying, verifyRefusal } from '../../../packages/core/src/verify.ts';
import { accRefusal } from './connect.ts';
import { inProcessWords } from './processes.ts';
import { stateOf } from './shared.ts';

type Result = { code: number; stdout: string; stderr: string };

/** What verifying needs from the extension, passed in so it's tested without VS Code, GitHub or acc. */
export interface VerifyHost {
  project(root: string): { root: string; ledgerPath: string; github: string | null } | undefined;
  task(root: string, id: string): Pick<Task, 'id' | 'source' | 'run'> | undefined;
  /** Runs acc; with a label, in the output panel, where its steps show. */
  acc(args: string[], cwd: string, label?: string): Promise<Result>;
}

/** How a Verify or a Clear went: done, or why not. */
export type VerifyReply = { ok: true } | { ok: false; error: string };

/** What the page shows of a task's verification: the latest, the pull requests to choose from, and whether one runs. */
export interface VerifyState {
  verification: Verification | null;
  choice: PrChoice | null;
  verifying: boolean;
}


export class Verifications {
  private readonly host: VerifyHost;
  private readonly changed: (root: string, id: string) => void;
  /** The verifications this window started, by project and task, while acc runs them. */
  private readonly busy = new Set<string>();

  constructor(host: VerifyHost, changed: (root: string, id: string) => void = () => {}) {
    this.host = host;
    this.changed = changed;
  }

  /** Whether one is under way: started here, or by acc anywhere while its process lives. */
  running(root: string, id: string): boolean {
    const p = this.host.project(root);
    return this.busy.has(`${root}#${id.toUpperCase()}`) || (!!p && !!verifying(stateOf(p), id.toUpperCase()));
  }

  /** The task's latest verification, the choice acc kept, and whether one runs. A choice older than the latest verification is spent. */
  state(root: string, raw: string): VerifyState {
    const id = raw.toUpperCase();
    const p = this.host.project(root);
    if (!p) return { verification: null, choice: null, verifying: false };
    const verification = latestVerification(stateOf(p), id);
    const kept = readPrChoice(stateOf(p), id);
    const choice = kept && (!verification || kept.at > verification.at) ? kept : null;
    return { verification, choice, verifying: this.running(root, id) };
  }

  /**
   * Verifies the task's pull request: the one a person chose, or the one acc finds. None or several found
   * isn't an error here: acc keeps what it found, and the page shows the choice. One at a time a task.
   */
  async verify(root: string, raw: string, pr?: number): Promise<VerifyReply> {
    const id = raw.toUpperCase();
    const key = `${root}#${id}`;
    const p = this.host.project(root);
    if (!p) return { ok: false, error: 'That project isn\'t open any more.' };
    const why = verifyRefusal(this.host.task(root, id), id, { github: p.github });
    if (why) return { ok: false, error: inProcessWords(why) };
    if (this.running(root, id)) return { ok: false, error: `${id}'s pull request is being verified now.` };
    this.busy.add(key);
    this.changed(root, id);
    const started = new Date().toISOString();
    try {
      const r = await this.host.acc(['verify', id, ...(pr ? ['--pr', String(pr)] : []), '--json'], root, `Verify ${id}'s pull request`);
      const no = accRefusal(r);
      if (no === null) return { ok: true };
      const choice = readPrChoice(stateOf(p), id);
      return choice && choice.at >= started ? { ok: true } : { ok: false, error: no };
    } catch (e) {
      return { ok: false, error: inProcessWords((e as Error).message) };
    } finally {
      this.busy.delete(key);
      this.changed(root, id);
    }
  }

  /** Clears the verification: acc removes its worktree and what it kept. Its QA comment's draft stays. */
  async clear(root: string, raw: string): Promise<VerifyReply> {
    const id = raw.toUpperCase();
    if (!this.host.project(root)) return { ok: false, error: 'That project isn\'t open any more.' };
    if (this.running(root, id)) return { ok: false, error: `${id}'s pull request is being verified now. Clear it once that finishes.` };
    const no = accRefusal(await this.host.acc(['verify', 'clear', id, '--json'], root));
    this.changed(root, id);
    return no === null ? { ok: true } : { ok: false, error: no };
  }
}
