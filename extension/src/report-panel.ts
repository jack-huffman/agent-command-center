// Report a problem's tab (T-118): "Report a problem", a Command Center tab of its own, opened by the command from
// the Command Palette, Settings' About or a failed Setup step. It reads what the draft attaches from the parts
// the extension already has (About's versions, Setup's results, the projects' settings, the output panel's runs)
// and hands report.ts's Reports VSCode's clipboard, gh and the tab. The tab's own buttons are its only way to post.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { homedir, release, type as osType, userInfo } from 'node:os';
import * as vscode from 'vscode';
import { activeAccountEnv } from './about.ts';
import type { ExtensionArea } from './area.ts';
import { scrubContext } from './logic/scrub.ts';
import { isFromWebview } from './model/messages.ts';
import { REPORT_COMMAND, REPORT_TITLE, type ReportFacts, type ReportModel } from './model/report.ts';
import { THEME_SETTING, themeChoice } from './model/settings.ts';
import { htmlFor, isWebLink, TabTheme } from './panels.ts';
import { Reports } from './report.ts';
import { exec } from './trackers.ts';

/** This machine's system and its version: "macOS 15.1" from sw_vers on a Mac, else the system's own name and release. */
const osVersion = (): Promise<string | null> => (process.platform !== 'darwin' ? Promise.resolve(`${osType()} ${release()}`) : new Promise((resolve) => {
  execFile('sw_vers', ['-productVersion'], { timeout: 10_000 }, (err, stdout) => resolve(err ? `macOS (Darwin ${release()})` : `macOS ${String(stdout).trim()}`));
}));

/** The machine's username, for the scrub; null where the system won't say. */
const userName = (): string | null => {
  try {
    return userInfo().username;
  } catch {
    return null;
  }
};

export const area: ExtensionArea = {
  register({ reg, subscribe, about, setup, hub, runs, tickets }) {
    let panel: vscode.WebviewPanel | null = null;
    let theme: TabTheme | null = null;
    let last: ReportModel | null = null;
    const post = (m: ReportModel) => {
      last = m;
      if (panel?.visible) void panel.webview.postMessage({ type: 'state', model: m });
    };
    const reports: Reports = new Reports({
      async facts(step): Promise<ReportFacts> {
        await about.arrive();
        const f = about.facts();
        const root = setup.folder()?.uri.fsPath;
        const project = (root && hub.projectFor(root)) || hub.projects[0];
        const item = step ? setup.results().find((i) => i.id === step) : undefined;
        return {
          extension: f.extension, acc: f.acc, plugin: f.plugin, os: await osVersion(), vscode: vscode.version, profile: project?.config.profile ?? null,
          setup: setup.results().map((i) => ({ id: i.id, status: i.status })),
          step: item ? { id: item.id, title: item.title, status: item.status, detail: item.detail } : null,
          lastError: reports.lastError,
        };
      },
      scrubContext: () => scrubContext(homedir(), userName(), hub.projects),
      gh: (args, input) => exec('gh', args, { input, env: activeAccountEnv(process.env) }),
      copy: (text) => Promise.resolve(vscode.env.clipboard.writeText(text)),
      show(m) {
        if (!panel) {
          const base = vscode.Uri.joinPath(tickets.extensionUri, 'dist', 'webview');
          const p = vscode.window.createWebviewPanel('acc.report', REPORT_TITLE, vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [base], retainContextWhenHidden: true });
          const icon = (t: 'light' | 'dark') => vscode.Uri.joinPath(tickets.extensionUri, 'dist', 'media', `acc-${t}.svg`);
          p.iconPath = { light: icon('light'), dark: icon('dark') };
          theme = new TabTheme(p, (t) => htmlFor(p.webview, base, 'report', randomBytes(16).toString('base64'), REPORT_TITLE, t));
          p.onDidDispose(() => { panel = null; theme = null; });
          p.onDidChangeViewState((e) => { if (e.webviewPanel.visible && last) post(last); });
          p.webview.onDidReceiveMessage((msg: unknown) => {
            if (!isFromWebview(msg)) return;
            if (msg.type === 'ready') { theme?.ready(); if (last) post(last); }
            // Post: the only way a report leaves the machine, and only as the page showed it.
            else if (msg.type === 'report-post') void reports.post(msg.title, msg.body);
            else if (msg.type === 'report-copy') void reports.copy(msg.text);
            // The posted issue's link.
            else if (msg.type === 'open' && isWebLink(msg.url)) void vscode.env.openExternal(vscode.Uri.parse(msg.url));
          });
          panel = p;
        } else panel.reveal(panel.viewColumn);
        post(m);
      },
      redraw: post,
      say: (text) => void vscode.window.showInformationMessage(text),
    });
    subscribe(runs.onDidEvent((e) => { if (e.kind === 'end') reports.heard(e.run); }));
    subscribe({ dispose: () => panel?.dispose() });
    // The tab follows the Command Center's theme, as every other tab does (GH-109).
    subscribe(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`${THEME_SETTING.section}.${THEME_SETTING.key}`)) theme?.set(themeChoice(vscode.workspace.getConfiguration(THEME_SETTING.section).get(THEME_SETTING.key)));
    }));
    about.reporting = () => reports.posting;
    // REPORT_COMMAND.id, written out: the areas test reads each registered id from the source.
    reg('acc.report', (arg?: unknown) => reports.open(arg));
  },
};
