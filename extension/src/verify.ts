// Verify the developer's work (T-84): a task page's Verify, Verify this one and Clear. acc verifies in the
// output panel, where its steps show, and keeps the verdict and the QA comment's draft; nothing reaches the
// tracker or GitHub until the person posts the comment.
import * as vscode from 'vscode';
import type { ExtensionArea } from './area.ts';
import { Verifications, type VerifyReply, type VerifyState } from './logic/verify.ts';
import { type Message, VERIFY_DONE } from './model/verify.ts';
import { accRunner } from './run.ts';

type Say = (msg: Record<string, unknown>) => void;

/** What a task page asks of its verification: the section's state, and a button of it. */
export interface VerifyActions {
  state(root: string, id: string): VerifyState;
  act(m: Message, say: Say): Promise<void>;
}

export const area: ExtensionArea = {
  register({ hub, tickets, sidebar, accScript }) {
    const acc = accRunner(accScript);
    const v = new Verifications({
      project: (root) => {
        const p = hub.project(root);
        return p ? { root: p.root, ledgerPath: p.ledgerPath, github: p.config.github?.repo ?? null } : undefined;
      },
      task: (root, id) => hub.ledger(root)?.tasks.find((t) => t.id === id),
      // A verification runs in the output panel, where its steps show (T-65); a clear is quick.
      acc: (args, cwd, label) => (label && sidebar.helpers.runAccShown ? sidebar.helpers.runAccShown(args, cwd, label) : acc(args, cwd)),
    }, (root) => tickets.refresh(root));
    const done = (say: Say, m: Message, r: VerifyReply) => say({ type: VERIFY_DONE, action: m.type, project: m.project, task: m.task, ...r });
    tickets.verify = {
      state: (root, id) => v.state(root, id),
      async act(m, say) {
        const r = m.type === 'verify-run' ? await v.verify(m.project, m.task, m.pr) : await v.clear(m.project, m.task);
        done(say, m, r);
        if (!r.ok) void vscode.window.showWarningMessage(r.error);
        tickets.refresh(m.project);
      },
    };
  },
};
