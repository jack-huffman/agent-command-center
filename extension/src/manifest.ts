// Manifest for this ticket (T-101): a Salesforce task page's Build, Check against the org, Use the org's copy,
// Add to this ticket and Add to the ticket's branch ask acc; View, Copy, Save as a file and See the difference
// act on what acc kept, in the editor. Nothing here deploys, and the branch changes only by the person's own click.
import * as vscode from 'vscode';
import { PACKAGE_FILE } from '../../packages/core/src/manifest.ts';
import type { ExtensionArea } from './area.ts';
import { Manifests, type ManifestState, type ManifestUi } from './logic/manifest.ts';
import { MANIFEST_DONE, type Message } from './model/manifest.ts';
import { accRunner } from './run.ts';

type Say = (msg: Record<string, unknown>) => void;

/** What a task page asks of its manifest: the section's state, and a button of it. */
export interface ManifestActions {
  state(root: string, id: string): ManifestState;
  act(m: Message, say: Say): Promise<void>;
}

/** The editor, as View, Copy, Save as a file and See the difference use it. */
const editorUi = (root: string): ManifestUi => ({
  async show(content, language) {
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ content, language }), { preview: true, viewColumn: vscode.ViewColumn.Beside });
  },
  copy: async (text) => { await vscode.env.clipboard.writeText(text); },
  async saveTo(task) {
    const to = await vscode.window.showSaveDialog({ title: `Save ${task}'s manifest`, defaultUri: vscode.Uri.joinPath(vscode.Uri.file(root), PACKAGE_FILE), filters: { XML: ['xml'] } });
    return to?.fsPath ?? null;
  },
  info: (text) => { void vscode.window.showInformationMessage(text); },
});

export const area: ExtensionArea = {
  register({ hub, tickets, sidebar, accScript }) {
    const acc = accRunner(accScript);
    const v = new Manifests({
      project: (root) => {
        const p = hub.project(root);
        return p ? { root: p.root, ledgerPath: p.ledgerPath, profile: p.config.profile } : undefined;
      },
      task: (root, id) => hub.ledger(root)?.tasks.find((t) => t.id === id),
      // A build or a check runs in the output panel, where its steps show (T-65); a commit is quick.
      acc: (args, cwd, label) => (label && sidebar.helpers.runAccShown ? sidebar.helpers.runAccShown(args, cwd, label) : acc(args, cwd)),
    }, (root) => tickets.refresh(root));
    tickets.manifest = {
      state: (root, id) => v.state(root, id),
      async act(m, say) {
        const ui = editorUi(m.project);
        const r = m.type === 'manifest-build' ? await v.build(m.project, m.task, m.check === true)
          : m.type === 'manifest-retrieve' ? await v.retrieve(m.project, m.task, m.component)
            : m.type === 'manifest-commit' ? await v.commit(m.project, m.task)
              : m.type === 'manifest-file' ? await v.file(m.project, m.task, m.how, ui)
                : await v.diff(m.project, m.task, m.component, ui);
        say({ type: MANIFEST_DONE, action: m.type, project: m.project, task: m.task, ...r });
        if (!r.ok) void vscode.window.showWarningMessage(r.error);
        tickets.refresh(m.project);
      },
    };
  },
};
