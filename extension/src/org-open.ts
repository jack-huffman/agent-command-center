// Try it in the org (T-161): a ticket whose builder's deploy to its development org passed opens that org, and each
// component it deployed at its own page there, with sf in the person's browser. Whether this machine is logged in
// to the org is the last Setup check's word; where it isn't, or the settings name no org, Open is off with why.
import * as vscode from 'vscode';
import type { ExtensionArea } from './area.ts';
import { openPlan, orgNotHere, runOpen } from './logic/org-open.ts';
import { runFile } from './run.ts';

/** What a task page asks of its org: whether this machine is known not to be logged in to it, and an open. */
export interface OrgActions {
  /** Whether the last Setup check said this machine isn't logged in to the org of the environment whose branch is `env`. */
  notHere(root: string, env: string): boolean;
  /** Open <environment>, or one component at its page there. */
  open(root: string, id: string, path: string | undefined): Promise<void>;
}

export const area: ExtensionArea = {
  register({ hub, tickets, setup }) {
    const sf = (cwd: string) => (args: string[]) => runFile('sf', args, cwd, { ...process.env, SF_NO_UPDATE_NOTIFIER: 'true' });
    const notHere = (root: string, branch: string): boolean => {
      const e = hub.project(root)?.config.environments.find((x) => x.branch === branch);
      return !!e && orgNotHere(setup.results(), setup.root(), (path) => hub.projectFor(path))(root, e);
    };
    tickets.orgs = {
      notHere,
      async open(root, id, path) {
        const p = hub.project(root);
        const task = p ? hub.ledger(root)?.tasks.find((t) => t.id === id.toUpperCase()) : undefined;
        if (!p || !task) return;
        const plan = openPlan(p.config, task, path, (branch) => notHere(root, branch));
        if (!plan.ok) return void vscode.window.showWarningMessage(plan.why);
        const failed = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: plan.title }, () => runOpen(sf(root), plan));
        if (failed) void vscode.window.showWarningMessage(failed);
      },
    };
  },
};
