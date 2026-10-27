// Talk it through (T-98): a task page's conversation with its planning agent, Use this on what it proposes, and
// Open in Claude Code, which opens the plan in a terminal in the project's main checkout, in plan mode. Each
// asks acc; the page shows what acc kept.
import type * as vscode from 'vscode';
import { terminalShell } from '../../packages/core/src/shell.ts';
import type { ExtensionArea } from './area.ts';
import { shq } from './logic/shared.ts';
import { Talks, type TalkState } from './logic/talk.ts';
import { type Message, TALK_DONE } from './model/talk.ts';
import { accRunner } from './run.ts';
import { analysesOf } from './task-rows.ts';

type Say = (msg: Record<string, unknown>) => void;

/** What a task page asks of its conversation: its state, and a button of it. */
export interface TalkActions {
  state(root: string, id: string): TalkState;
  act(m: Message, say: Say): Promise<void>;
}

export const area: ExtensionArea = {
  register({ vscode: code, hub, tickets, sidebar, accScript, subscribe }) {
    const acc = accRunner(accScript);
    const terminals = new Map<vscode.Terminal, () => void>();
    subscribe(code.window.onDidCloseTerminal((t) => {
      const ended = terminals.get(t);
      if (!ended) return;
      terminals.delete(t);
      ended();
    }));
    const talks = new Talks({
      paths: (root) => {
        const p = hub.project(root);
        return p ? analysesOf(p) : undefined;
      },
      // A message runs in the output panel, where the planning agent's steps show (D-171); the rest are quick.
      acc: (args, cwd, label) => (label && sidebar.helpers.runAccShown ? sidebar.helpers.runAccShown(args, cwd, label) : acc(args, cwd)),
      launch(task, l, ended) {
        const t = code.window.createTerminal({ name: `Plan ${task} in Claude Code`, cwd: l.cwd, env: l.env, iconPath: new code.ThemeIcon('comment-discussion'), ...terminalShell() });
        terminals.set(t, ended);
        t.show();
        t.sendText(['claude', ...l.args].map(shq).join(' '), true);
      },
      // The whole ticket for the first message before a plan (T-111), read as Make a plan reads it.
      ticket: (root, id) => tickets.planTicketFile?.(root, id) ?? Promise.resolve({ file: null, remove: () => {} }),
    }, (root) => tickets.refresh(root));
    tickets.talk = {
      state: (root, id) => talks.state(root, id),
      async act(m, say) {
        const r = m.type === 'talk-send' ? await talks.send(m.project, m.task, m.text, m.about)
          : m.type === 'talk-answers' ? await talks.answers(m.project, m.task, m.turn, m.answers)
          : m.type === 'talk-use' ? await talks.use(m.project, m.task, m.turn, m.proposal, m.yes === true)
            : await talks.claude(m.project, m.task);
        say({ type: TALK_DONE, action: m.type, project: m.project, task: m.task, ...(m.type === 'talk-use' ? { turn: m.turn, proposal: m.proposal } : {}), ...r });
        if (!r.ok) void code.window.showWarningMessage(r.error);
        await hub.loadTasks(true);
        tickets.refresh(m.project);
      },
    };
  },
};
