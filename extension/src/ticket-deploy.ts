// A ticket's deploy from its Changes tab (T-138): Deploy to <environment> opens the sheet and asks acc for the
// plan, whose check changes nothing; only the sheet's own Deploy, after a check that passed, deploys. The
// command acc.task.deploy (D-219's spec) opens the ticket's Changes tab and starts that check. Deploy with an
// agent (T-154) opens a Claude Code chat as the deploy guide instead, where the person types the yes.
import * as vscode from 'vscode';
import { TASK_DEPLOY_GUIDE_COMMAND } from '../../packages/core/src/deploy-guide.ts';
import { jobsUnderWay } from '../../packages/core/src/jobs.ts';
import { terminalShell } from '../../packages/core/src/shell.ts';
import type { Task } from '../../packages/core/src/ledger.ts';
import { TASK_DEPLOY_COMMAND, ticketPlace } from '../../packages/core/src/task-deploy.ts';
import { readWhere, type TicketWhere } from '../../packages/core/src/where-kept.ts';
import type { ExtensionArea } from './area.ts';
import { guideLaunch, guideLine } from './logic/deploy-guide.ts';
import { stateOf } from './logic/shared.ts';
import { TicketDeploys } from './logic/ticket-deploy.ts';
import { WhereReads } from './logic/where.ts';
import type { DeployRun, Message } from './model/ticket-deploy.ts';
import { accRunner } from './run.ts';

/** What a task page asks of its deploy: what's under way for a task, and the sheet's buttons. */
export interface DeployActions {
  run(root: string, id: string): DeployRun | null;
  /** A deploy of the task under way, from this window or another (D-092). */
  running(root: string, id: string): boolean;
  /** The sheet's buttons: the page draws how they went from the next model, which this window refreshes. */
  act(m: Message): Promise<void>;
  /** Where its work was last read to be (T-155), kept beside the ledger; a due reading is read again behind the page. */
  where(root: string, task: Task): TicketWhere | null;
  /** The kept readings alone, for a check that mustn't start a read. */
  kept(root: string, id: string): TicketWhere | null;
  /** The person's Refresh: read where its work is again, whatever the readings' age. */
  reread(root: string, id: string): void;
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
    // Where its work is (T-155): read behind the page with acc where, which the page draws once it's back.
    const reads = new WhereReads({ acc: (args, cwd) => acc(args, cwd), done: (root) => tickets.refresh(root), now: () => new Date() });
    tickets.deploys = {
      run: (root, id) => d.run(root, id),
      where: (root, task) => {
        const p = hub.project(root);
        return p ? reads.kept(root, stateOf(p).stateDir, p.config, task) : null;
      },
      kept: (root, id) => {
        const p = hub.project(root);
        return p ? readWhere(stateOf(p), id.toUpperCase()) : null;
      },
      reread: (root, id) => void reads.read(root, id),
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
        // After a deploy, where its work is gets read again (T-155).
        if (m.type === 'deploy-go') void reads.read(m.project, m.task);
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
      const next = to ?? ticketPlace(p.config, task, readWhere(stateOf(p), task.id))?.next[0]?.branch;
      if (next) await tickets.deploys?.act({ type: 'deploy-check', project: p.root, task: task.id, to: next });
    });
    // Deploy a ticket with an agent (T-154): the guide's chat opens, and it checks before anything deploys.
    // TASK_DEPLOY_GUIDE_COMMAND.id, named here as areas.test reads registrations.
    reg('acc.task.deployGuide', async (root?: string, id?: string, to?: string) => {
      const p = root ? hub.project(root) : hub.projects[0];
      const task = id ? hub.ledger(p?.root ?? '')?.tasks.find((t) => t.id === id.toUpperCase()) : undefined;
      if (!p || !task) return void vscode.window.showWarningMessage('Say which task to deploy, from its page\'s Changes tab.');
      const can = TASK_DEPLOY_GUIDE_COMMAND.enabled({ config: p.config, task });
      if (!can.ok) return void vscode.window.showWarningMessage(can.why);
      await guide(p.root, task.id, to);
    });
  },
};
