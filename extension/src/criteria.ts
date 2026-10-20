// Drafted acceptance criteria (T-81): a task page's Draft acceptance criteria, Open as an update and Add to
// the description, and the task sheet's own Draft. acc drafts and keeps the draft; nothing reaches the
// tracker until the person saves the sheet or posts the update.
import * as vscode from 'vscode';
import type { ExtensionArea } from './area.ts';
import { CriteriaDrafts, type CriteriaReply } from './logic/criteria.ts';
import { CRITERIA_DONE, type Message, TASK_SHEET_DRAFT } from './model/criteria.ts';
import { openTaskSheet, type TaskSheet } from './model/task-sheet.ts';
import { accRunner } from './run.ts';

type Say = (msg: Record<string, unknown>) => void;

/** The window's drafts, once the area is registered: the task sheet's Edit asks it what to add. */
let drafts: CriteriaDrafts | null = null;

/** What the task sheet adds for its drafting (T-81), or nothing before the area is registered. */
export const sheetDress = (root: string, id: string | null): ((s: TaskSheet) => TaskSheet) | undefined => (drafts && id ? drafts.dress(root, id) : undefined);

/** What a task page asks of the drafts: its section's state, a button of it, and the sheet's own Draft. */
export interface CriteriaActions {
  state(root: string, id: string): { draft: ReturnType<CriteriaDrafts['stored']>; drafting: boolean };
  act(m: Extract<Message, { type: 'criteria-draft' | 'criteria-update' | 'criteria-sheet' }>, say: Say): Promise<void>;
  sheet(m: Extract<Message, { type: 'task-sheet-criteria' }>, say: Say): Promise<void>;
}

export const area: ExtensionArea = {
  register({ hub, trackers, tickets, ticketEdits, panels, receive, sidebar, accScript }) {
    const acc = accRunner(accScript);
    const d = new CriteriaDrafts({
      project: (root) => hub.project(root),
      task: (root, id) => hub.ledger(root)?.tasks.find((t) => t.id === id),
      ticket: async (root, key) => {
        const p = hub.project(root);
        const index = p ? trackers.trackerFor(p, key) : null;
        if (!p || index === null) throw new Error(`${key} isn't one of the project's tickets.`);
        return trackers.ticket(p, index, key);
      },
      // A draft runs in the output panel, where its steps show (T-65); the update is quick.
      acc: (args, cwd, label) => (label && sidebar.helpers.runAccShown ? sidebar.helpers.runAccShown(args, cwd, label) : acc(args, cwd)),
    }, (root) => tickets.refresh(root));
    drafts = d;
    const done = (say: Say, m: { type: string; project: string; task: string }, r: CriteriaReply) => say({ type: CRITERIA_DONE, action: m.type, project: m.project, task: m.task, ...r });
    const actions: CriteriaActions = {
      state: (root, id) => ({ draft: d.stored(root, id), drafting: d.drafting(root, id) }),
      async act(m, say) {
        if (m.type === 'criteria-sheet') {
          // The sheet opens over the page that asked, with the draft below the description's text.
          const opened = openTaskSheet(hub, (msg) => void panels.tell(msg), m.project, m.task, say, (root, key) => ticketEdits.sheetTicket(root, key), d.dress(m.project, m.task, true));
          return done(say, m, opened ? { ok: true } : { ok: false, error: `${m.task} can't be edited now.` });
        }
        const r = m.type === 'criteria-draft' ? await d.draft(m.project, m.task) : await d.toUpdate(m.project, m.task);
        done(say, m, r);
        if (!r.ok) void vscode.window.showWarningMessage(r.error);
        else if (m.type === 'criteria-update') void vscode.window.showInformationMessage(`${m.task.toUpperCase()}'s draft is an update now. Edit it and post it from its Activity: nothing is on its ticket yet.`);
        tickets.refresh(m.project);
      },
      async sheet(m, say) {
        say({ type: TASK_SHEET_DRAFT, project: m.project, task: m.task, drafting: true });
        say({ type: TASK_SHEET_DRAFT, project: m.project, task: m.task, ...(await d.draft(m.project, m.task)) });
      },
    };
    tickets.criteria = actions;
    // The task sheet over the Command Center, or its modal, drafts too.
    receive('task-sheet-criteria', (m) => void actions.sheet(m, (msg) => panels.reply(msg)));
  },
};
