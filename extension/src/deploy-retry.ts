// Retry with an agent from a ticket's page (T-174): its development row and its banner run acc resume <id> --deploy,
// which carries the ticket's builder on in its own session and worktree, told which deploy to the development org
// failed and why. The page waits while acc starts it, then draws again: the builder at work turns the action off.
// The command acc.task.retryDeploy does the same, for a task named.
import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import { builderRuns, DEPLOY_RETRY_COMMAND } from '../../packages/core/src/deploy-retry.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import { resuming } from '../../packages/core/src/resume.ts';
import type { ExtensionArea } from './area.ts';
import { stateOf } from './logic/shared.ts';
import { deployRetry, type DeployRetry, retryArgs } from './model/deploy-retry.ts';
import { accRunner } from './run.ts';

/** What a task page asks of Retry with an agent: the action as it draws it, and its click. */
export interface RetryActions {
  model(root: string, task: Task): DeployRetry | null;
  act(root: string, id: string): Promise<void>;
}

export const area: ExtensionArea = {
  register({ hub, tickets, sidebar, accScript, reg, accSays }) {
    const acc = accRunner(accScript);
    // A retry on its way, and why the last one didn't start, by project and task, for this window.
    const on = new Set<string>();
    const failed = new Map<string, string>();
    const key = (root: string, id: string) => `${root}#${id.toUpperCase()}`;
    const facts = (root: string, task: Task) => {
      const p = hub.project(root);
      let resumingNow = false;
      try {
        resumingNow = !!(p && resuming(stateOf(p), task.id));
      } catch {
        resumingNow = false;
      }
      return { runs: builderRuns(task, hub.agents, resumingNow), worktree: !!task.run?.worktree && existsSync(task.run.worktree) };
    };
    const retry = async (root: string, id: string): Promise<void> => {
      const p = hub.project(root);
      const task = hub.ledger(root)?.tasks.find((t) => t.id === id.toUpperCase());
      if (!p || !task) return void vscode.window.showWarningMessage('That task isn\'t in its project\'s tasks any more.');
      const can = DEPLOY_RETRY_COMMAND.enabled({ config: p.config, task, ...facts(root, task) });
      if (!can.ok) return void vscode.window.showWarningMessage(can.why);
      const k = key(root, task.id);
      if (on.has(k)) return;
      on.add(k);
      failed.delete(k);
      tickets.refresh(root);
      try {
        const args = retryArgs(task.id);
        const r = sidebar.helpers.runAccShown ? await sidebar.helpers.runAccShown(args, root, `Retry ${task.id}'s deploy with an agent`) : await acc(args, root);
        if (r.code !== 0) failed.set(k, accSays(r));
      } catch (e) {
        failed.set(k, (e as Error).message);
      } finally {
        on.delete(k);
      }
      await hub.loadAgents();
      await hub.loadTasks(true);
      tickets.refresh(root);
    };
    tickets.retry = {
      model(root, task) {
        const p = hub.project(root);
        if (!p) return null;
        const k = key(root, task.id);
        return deployRetry({ config: p.config, task, ...facts(root, task), retrying: on.has(k), error: failed.get(k) ?? null });
      },
      act: retry,
    };
    // DEPLOY_RETRY_COMMAND.id, named here as areas.test reads registrations.
    reg('acc.task.retryDeploy', async (root?: string, id?: string) => {
      const p = root ? hub.project(root) : hub.projects[0];
      if (!p || !id) return void vscode.window.showWarningMessage('Say which task to retry, from its page\'s Changes tab.');
      await retry(p.root, id);
    });
  },
};
