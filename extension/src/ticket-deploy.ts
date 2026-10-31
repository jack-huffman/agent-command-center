// A ticket's deploy from its Changes tab (T-158): every deploy past the development org is the deploy guide's
// agent's (T-156). Deploy…'s pick opens a Claude Code chat as the deploy guide (T-154), for the environment
// picked, in the output panel as it opens. The person's pick of where is the yes for a sandbox; for Production
// or a protected org the yes is the environment's name they type in the chat. Nothing here deploys by itself.
// The command acc.task.deploy opens the ticket's Changes tab, and with an environment named starts the guide there.
import * as vscode from 'vscode';
import { TASK_DEPLOY_GUIDE_COMMAND } from '../../packages/core/src/deploy-guide.ts';
import { jobsUnderWay } from '../../packages/core/src/jobs.ts';
import { terminalShell } from '../../packages/core/src/shell.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import { TASK_DEPLOY_COMMAND } from '../../packages/core/src/task-deploy.ts';
import { readWhere, type TicketWhere } from '../../packages/core/src/where-kept.ts';
import type { ExtensionArea } from './area.ts';
import { guideArgs, guideLaunch, guideLine } from './logic/deploy-guide.ts';
import { stateOf } from './logic/shared.ts';
import { WhereReads } from './logic/where.ts';
import type { Message } from './model/ticket-deploy.ts';
import { accRunner } from './run.ts';

/** What a task page asks of its deploy: where a deploy of it is under way, its readings, and Deploy…'s pick. */
export interface DeployActions {
  /** The environment's branch a deploy of the task is under way to, from this window or another (D-092); null when there's none. */
  deploying(root: string, id: string): string | null;
  /** Deploy…'s pick and Check again: the page draws how they went from the next model, which this window refreshes. */
  act(m: Message): Promise<void>;
  /** Where its work was last read to be (T-155), kept beside the ledger; a due reading is read again behind the page. */
  where(root: string, task: Task): TicketWhere | null;
  /** The kept readings alone, for a check that mustn't start a read. */
  kept(root: string, id: string): TicketWhere | null;
  /** The person's Refresh: read where its work is again, in every environment, whatever the readings' age. */
  reread(root: string, id: string): void;
  /** Whether a read of where its work is is under way: of every environment, or of the one whose branch is `env`. */
  reading(root: string, id: string, env: string): boolean;
}

export const area: ExtensionArea = {
  register({ hub, tickets, sidebar, accScript, reg }) {
    const acc = accRunner(accScript);
    // The deploy guide's chat, in a terminal in the project's main checkout, as acc says to open it; acc's opening
    // of it shows in the output panel.
    const guide = async (root: string, id: string, to: string | undefined): Promise<void> => {
      const name = to ? hub.project(root)?.config.environments.find((e) => e.branch === to)?.name ?? to : 'its next environment';
      const args = guideArgs(id, to);
      const r = sidebar.helpers.runAccShown ? await sidebar.helpers.runAccShown(args, root, `Deploy ${id} to ${name} with an agent`) : await acc(args, root);
      const g = guideLaunch(r.code, r.stdout, r.stderr);
      if (!g.ok) return void vscode.window.showWarningMessage(`Couldn't open the deploy guide for ${id}: ${g.error}`);
      const t = vscode.window.createTerminal({ name: `Deploy ${id} with an agent`, cwd: g.launch.cwd, env: g.launch.env, iconPath: new vscode.ThemeIcon('hubot'), ...terminalShell() });
      t.show();
      t.sendText(guideLine(g.launch), true);
    };
    // Where its work is (T-155): read behind the page with acc where, which the page draws once it's back.
    const reads = new WhereReads({ acc: (args, cwd) => acc(args, cwd), done: (root) => tickets.refresh(root), now: () => new Date() });
    tickets.deploys = {
      where: (root, task) => {
        const p = hub.project(root);
        return p ? reads.kept(root, stateOf(p).stateDir, p.config, task) : null;
      },
      kept: (root, id) => {
        const p = hub.project(root);
        return p ? readWhere(stateOf(p), id.toUpperCase()) : null;
      },
      reread: (root, id) => void reads.read(root, id),
      reading: (root, id, env) => reads.reading(root, id, env),
      deploying: (root, id) => {
        const p = hub.project(root);
        try {
          const job = p ? jobsUnderWay(stateOf(p)).find((j) => j.kind === 'deploy' && j.task === id.toUpperCase()) : undefined;
          return job ? job.env ?? '' : null;
        } catch {
          return null;
        }
      },
      async act(m) {
        if (m.type === 'where-check') {
          // A row's Check again reads its own environment alone (T-158).
          void reads.read(m.project, m.task, m.env);
          tickets.refresh(m.project);
          return;
        }
        await guide(m.project, m.task, m.to);
        tickets.refresh(m.project);
      },
    };
    // Deploy a ticket (D-219's spec): its page's Changes tab opens, where Deploy… asks where. With an environment
    // named, the deploy guide's agent starts there, as Deploy…'s pick does (T-158); nothing deploys without it.
    reg('acc.task.deploy', async (root?: string, id?: string, to?: string) => {
      const p = root ? hub.project(root) : hub.projects[0];
      const task = id ? hub.ledger(p?.root ?? '')?.tasks.find((t) => t.id === id.toUpperCase()) : undefined;
      if (!p || !task) return void vscode.window.showWarningMessage('Say which task to deploy, from its page\'s Changes tab.');
      const can = to ? TASK_DEPLOY_GUIDE_COMMAND.enabled({ config: p.config, task, to }) : TASK_DEPLOY_COMMAND.enabled({ config: p.config, task });
      if (!can.ok) return void vscode.window.showWarningMessage(can.why);
      tickets.show(p.root, undefined, task.id, 'changes');
      if (to) await guide(p.root, task.id, to);
    });
    // Deploy a ticket with an agent (T-154): the guide's chat opens for the environment picked, any on the
    // ticket's path after where it is (T-156), and it checks before anything deploys. Off with why for a pick
    // that isn't. TASK_DEPLOY_GUIDE_COMMAND.id, named here as areas.test reads registrations.
    reg('acc.task.deployGuide', async (root?: string, id?: string, to?: string) => {
      const p = root ? hub.project(root) : hub.projects[0];
      const task = id ? hub.ledger(p?.root ?? '')?.tasks.find((t) => t.id === id.toUpperCase()) : undefined;
      if (!p || !task) return void vscode.window.showWarningMessage('Say which task to deploy, from its page\'s Changes tab.');
      const can = TASK_DEPLOY_GUIDE_COMMAND.enabled({ config: p.config, task, to });
      if (!can.ok) return void vscode.window.showWarningMessage(can.why);
      await guide(p.root, task.id, to);
    });
  },
};
