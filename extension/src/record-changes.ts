// Record changes on a task's page (T-100): "Add a change made by hand" and a promotion's Mark done and Skip.
// acc keeps each with the task, as the person's; nothing here writes a record in any org.
import * as vscode from 'vscode';
import type { ExtensionArea } from './area.ts';
import { actOn } from './logic/record-changes.ts';
import { type Message, RECORDS_DONE } from './model/record-changes.ts';
import { accRunner } from './run.ts';

type Say = (msg: Record<string, unknown>) => void;

/** What a task page asks of its record changes: one of its buttons. */
export interface RecordActions {
  act(m: Message, say: Say): Promise<void>;
}

export const area: ExtensionArea = {
  register({ tickets, accScript }) {
    const acc = accRunner(accScript);
    tickets.records = {
      async act(m, say) {
        const r = await actOn(m, acc);
        say({ type: RECORDS_DONE, action: m.type, project: m.project, task: m.task, ...r });
        if (!r.ok) void vscode.window.showWarningMessage(r.error);
        tickets.refresh(m.project);
      },
    };
  },
};
