/**
 * Join a team project (T-176): the repo's address, the account that can read it (asked only when more than one
 * can, at most three and the person's own words, D-205), where the clone goes, then acc join clones it and pins
 * the account and commit identity in that clone only, and VS Code opens the folder. Share how to join copies the
 * address and three steps for a teammate.
 */

import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { addressProblem, JOIN_COMMAND, JOIN_TITLE, joinText } from '../../packages/core/src/join.ts';
import type { ExtensionArea } from './area.ts';
import { accountChoices, joinAnswer, joinArgs, type JoinCheck } from './logic/join.ts';
import { SHARE_JOIN_COMMAND } from './model/join.ts';
import { runFile } from './run.ts';
import { exec } from './trackers.ts';
import { activeGhAccount } from './logic/setup.ts';
import { inProcessWords } from './logic/processes.ts';

/** A join under way in this window: Join a team project waits until it's done. */
let joining = false;

/** The bundled CLI, run by VS Code's own runtime, from the home folder: there's no project yet. */
const accIn = (accScript: string, args: string[]) =>
  runFile(process.execPath, [accScript, ...args], homedir(), { ...process.env, ELECTRON_RUN_AS_NODE: '1', NO_COLOR: '1' }, undefined, 600_000);

/** Which account clones the repo: the one that can read it, or the person's pick of up to three and their own words. */
async function pickAccount(readers: string[]): Promise<string | undefined> {
  if (readers.length === 1) return readers[0];
  const status = await exec('gh', ['auth', 'status', '--hostname', 'github.com']);
  const pick = await vscode.window.showQuickPick(accountChoices(readers, activeGhAccount(status.stdout + status.stderr)), { title: 'More than one of your GitHub accounts can read it. Which one clones it?', ignoreFocusOut: true });
  if (!pick) return undefined;
  if (pick.account) return pick.account;
  return (await vscode.window.showInputBox({ title: 'The GitHub account to clone it as', prompt: `One gh is signed in to that can read the repo: ${readers.join(', ')}.`, ignoreFocusOut: true, validateInput: (v) => (readers.some((r) => r.toLowerCase() === v.trim().toLowerCase()) ? null : `One of ${readers.join(', ')}`) }))?.trim();
}

async function join(accScript: string, given?: unknown): Promise<void> {
  const gh = await exec('gh', ['--version']);
  const can = JOIN_COMMAND.enabled({ gh: gh.code !== 127, joining });
  if (!can.ok) {
    void vscode.window.showWarningMessage(can.why);
    return;
  }
  const address = (typeof given === 'string' && !addressProblem(given) ? given : await vscode.window.showInputBox({
    title: JOIN_TITLE, prompt: 'The repo\'s address, as your team shared it.', placeHolder: 'https://github.com/acme/acme-salesforce', ignoreFocusOut: true, validateInput: addressProblem,
  }))?.trim();
  if (!address) return;
  joining = true;
  try {
    const first = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Finding the GitHub account that can read it…' }, () => accIn(accScript, joinArgs(address, { dryRun: true })));
    const check = joinAnswer<Extract<JoinCheck, { ok: true }>>(first.stdout);
    if (!check.ok) {
      void vscode.window.showErrorMessage(`✗ It can't be joined. Nothing was made.`, { modal: true, detail: inProcessWords(check.message) });
      return;
    }
    const account = check.account ?? await pickAccount(check.readers);
    if (!account) return;
    const dir = (await vscode.window.showInputBox({ title: 'Where should the clone go?', prompt: 'A new or empty folder. It holds the repo, and nothing else is put in it.', value: check.dir, ignoreFocusOut: true, validateInput: (v) => (v.trim() ? null : 'A folder on this machine') }))?.trim();
    if (!dir) return;
    const done = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Cloning ${check.repo} as ${account}…` }, () => accIn(accScript, joinArgs(address, { dir, account })));
    const joined = joinAnswer<{ dir: string; project: string | null }>(done.stdout);
    if (!joined.ok) {
      void vscode.window.showErrorMessage(`✗ ${check.repo} wasn't cloned.`, { modal: true, detail: inProcessWords(joined.message) });
      return;
    }
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(joined.dir), { forceNewWindow: !!vscode.workspace.workspaceFolders?.length });
  } finally {
    joining = false;
  }
}

export const area: ExtensionArea = {
  register({ reg, hub, accScript }) {
    // Named as written, as the areas test reads them: JOIN_COMMAND.id and SHARE_JOIN_COMMAND.id.
    reg('acc.join', (given?: unknown) => join(accScript, given));
    reg('acc.join.share', async (arg?: unknown) => {
      const p = (typeof arg === 'string' ? hub.project(arg) : undefined) ?? hub.projects[0];
      const text = p ? joinText(p.config) : null;
      const can = SHARE_JOIN_COMMAND.enabled({ repo: text ? p!.config.github!.repo : null });
      if (!can.ok || !text) {
        void vscode.window.showWarningMessage(can.ok ? 'Open a project first.' : can.why);
        return;
      }
      await vscode.env.clipboard.writeText(text);
      void vscode.window.showInformationMessage(`Copied how to join ${p!.name}: the repo's address and three steps. It names no person and holds no secret.`);
    });
  },
};
