// A task's plan (T-97): a person's choices and their approval, from its page, its tab or the modal over
// the Tasks board, through acc. The page never writes the plan itself; what acc refuses, it says why.
import * as vscode from 'vscode';
import type { ExtensionArea } from './area.ts';
import { planApproveArgs, planChooseArgs, planSplitArgs } from './logic/plan.ts';
import type { Message } from './model/plan.ts';
import { accRunner } from './run.ts';

type Say = (msg: Record<string, unknown>) => void;

/** The reply a page waits for, once acc has recorded the choice or the approval, or refused it: webview/plan.ts takes it. */
const PLAN_DONE = 'plan-done';

/** What a task page asks of its plan: a choice, or an approval. */
export interface PlanActions {
  act(m: Message, say: Say): Promise<void>;
}

export const area: ExtensionArea = {
  register({ hub, tickets, panels, receive, accScript, accSays }) {
    const acc = accRunner(accScript);
    const actions: PlanActions = {
      async act(m, say) {
        const which = m.type === 'plan-choose' ? { decision: m.decision } : {};
        const done = (r: { ok: boolean; error?: string }) => say({ type: PLAN_DONE, action: m.type, project: m.project, task: m.task, ...which, ...r });
        const p = hub.project(m.project);
        if (!p) return done({ ok: false, error: 'That project isn\'t open here.' });
        const args = m.type === 'plan-choose' ? planChooseArgs(m.task, m.decision, m.text !== undefined ? { text: m.text } : { option: m.option }, m.yes === true) : m.type === 'plan-split' ? planSplitArgs(m.task) : planApproveArgs(m.task);
        const r = await acc(args, p.root).catch((e: unknown) => ({ code: 1, stdout: '', stderr: (e as Error).message }));
        await hub.loadTasks(true);
        if (r.code === 0) {
          done({ ok: true });
        } else {
          const error = accSays(r);
          void vscode.window.showWarningMessage(`Couldn't ${m.type === 'plan-choose' ? 'record the choice' : m.type === 'plan-split' ? 'split the task' : 'approve the plan'} for ${m.task}: ${error}`);
          done({ ok: false, error });
        }
        tickets.refresh(m.project);
      },
    };
    tickets.plan = actions;
    // The modal over the Tasks board sends them to the Command Center's page.
    receive('plan-choose', (m) => void actions.act(m, (msg) => panels.reply(msg)));
    receive('plan-approve', (m) => void actions.act(m, (msg) => panels.reply(msg)));
    receive('plan-split', (m) => void actions.act(m, (msg) => panels.reply(msg)));
  },
};
