// A ticket's deploy from its Changes tab (T-138): Deploy to <environment> opens the sheet and asks acc for the
// plan, whose check changes nothing; only the sheet's own Deploy, after a check that passed, deploys. The
// command acc.task.deploy (D-219's spec) opens the ticket's Changes tab and starts that check. Deploy with an
// agent (T-154) opens a Claude Code chat as the deploy guide instead. The person's pick of where is the yes for a
// sandbox (T-156); for Production or a protected org the yes is the environment's name they type in the chat.
import * as vscode from 'vscode';
import { TASK_DEPLOY_GUIDE_COMMAND } from '../../packages/core/src/deploy-guide.ts';
import { jobsUnderWay } from '../../packages/core/src/jobs.ts';
import { terminalShell } from '../../packages/core/src/shell.ts';
import { TASK_DEPLOY_COMMAND, ticketPlace } from '../../packages/core/src/task-deploy.ts';
import type { ExtensionArea } from './area.ts';
import { guideLaunch, guideLine } from './logic/deploy-guide.ts';
import { stateOf } from './logic/shared.ts';
import { TicketDeploys } from './logic/ticket-deploy.ts';
import type { DeployRun, Message } from './model/ticket-deploy.ts';
import { accRunner } from './run.ts';

/** What a task page asks of its deploy: what's under way for a task, and the sheet's buttons. */
export interface DeployActions {
  run(root: string, id: string): DeployRun | null;
  /** A deploy of the task under way, from this window or another (D-092). */
  running(root: string, id: string): boolean;
  /** The sheet's buttons: the page draws how they went from the next model, which this window refreshes. */
  act(m: Message): Promise<void>;
}

export const area: ExtensionArea = {
  register({ hub, tickets, sidebar, accScript, reg }) {
    const acc = accRunner(accScript);
    const d = new TicketDeploys({
      envName: (root, branch) => hub.project(root)?.config.environments.find((e) => e.branch === branch)?.name,
      // The same reasons the tab's Deploy is off for, from what the page is drawn from.
      off: (root, id, to) => tickets.deployOff(root, id, to),
      // In the output panel, where its steps show (T-65), and the sheet says the step it's on.
      acc: (args, cwd, label, onSteps) => (sidebar.helpers.runAccShown ? sidebar.helpers.runAccShown(args, cwd, label, onSteps) : acc(args, cwd)),
    }, (root) => tickets.refresh(root));
    // The deploy guide's chat, in a terminal in the project's main checkout, as acc says to open it.
    const guide = async (root: string, id: string, to: string | undefined): Promise<void> => {
      const r = await acc(['deploy', ...(to ? [to] : []), '--task', id, '--guide', '--json'], root);
      const g = guideLaunch(r.code, r.stdout, r.stderr);
      if (!g.ok) return void vscode.window.showWarningMessage(`Couldn't open the deploy guide for ${id}: ${g.error}`);
      const t = vscode.window.createTerminal({ name: `Deploy ${id} with an agent`, cwd: g.launch.cwd, env: g.launch.env, iconPath: new vscode.ThemeIcon('hubot'), ...terminalShell() });
      t.show();
      t.sendText(guideLine(g.launch), true);
    };
    tickets.deploys = {
      run: (root, id) => d.run(root, id),
      running: (root, id) => {
        const p = hub.project(root);
        try {
          return !!p && jobsUnderWay(stateOf(p)).some((j) => j.kind === 'deploy' && j.task === id.toUpperCase());
        } catch {
          return false;
        }
      },
      async act(m) {
        if (m.type === 'deploy-close') { d.close(m.project, m.task); return; }
        if (m.type === 'deploy-guide') { await guide(m.project, m.task, m.to); return; }
        const r = m.type === 'deploy-check' ? await d.check(m.project, m.task, m.to) : await d.deploy(m.project, m.task, m.to, m.checkId, m.typed);
        if (!r.ok) void vscode.window.showWarningMessage(r.error);
        tickets.refresh(m.project);
      },
    };
    // Deploy a ticket to its next environment: its page's Changes tab opens, and the sheet checks first (D-219).
    reg('acc.task.deploy', async (root?: string, id?: string, to?: string) => {
      const p = root ? hub.project(root) : hub.projects[0];
      const task = id ? hub.ledger(p?.root ?? '')?.tasks.find((t) => t.id === id.toUpperCase()) : undefined;
      if (!p || !task) return void vscode.window.showWarningMessage('Say which task to deploy, from its page\'s Changes tab.');
      const can = TASK_DEPLOY_COMMAND.enabled({ config: p.config, task });
      if (!can.ok) return void vscode.window.showWarningMessage(can.why);
      tickets.show(p.root, undefined, task.id, 'changes');
      const next = to ?? ticketPlace(p.config, task)?.next[0]?.branch;
      if (next) await tickets.deploys?.act({ type: 'deploy-check', project: p.root, task: task.id, to: next });
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
