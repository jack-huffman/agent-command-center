/**
 * What one area of the extension adds (D-099), declared in its own module as `export const area`: its VS
 * Code commands, and the Command Center page's messages it takes. areas.ts, which npm run build writes,
 * gathers every area, so a new command edits only its area. The acc.* commands the page may ask for are
 * the model areas', gathered in model/messages.ts, which node:test can load.
 */
import type * as vscode from 'vscode';
import type { Answer } from '../../packages/core/src/questions.ts';
import type { AgentPages } from './activity.ts';
import type { AutopilotHost } from './autopilot.ts';
import type { ConnectSession } from './connect.ts';
import type { Hub } from './hub.ts';
import type { RepoIdentity } from './identity.ts';
import type { FromWebview } from './model/messages.ts';
import type { Ref } from './model/shared.ts';
import type { Panels } from './panels.ts';
import type { Runs } from './runs.ts';
import type { Setup } from './setup.ts';
import type { Sidebar } from './sidebar.ts';
import type { Slack } from './slack.ts';
import type { TicketPanels, UpdateActions } from './ticket.ts';
import type { Trackers } from './trackers.ts';

/** A command's handler, as VS Code calls it. */
type Handler = (...args: any[]) => unknown;

/** Every part of the extension activate() made, for the areas to register with. */
export interface Parts {
  /** VS Code's API, for an area's module that node:test loads without it. */
  vscode: typeof vscode;
  hub: Hub;
  setup: Setup;
  runs: Runs;
  panels: Panels;
  tickets: TicketPanels;
  /** Each agent's own page (D-030). */
  pages: AgentPages;
  trackers: Trackers;
  identity: RepoIdentity;
  connect: ConnectSession;
  slack: Slack;
  autopilot: AutopilotHost;
  /** What the sidebar's commands share: the hub, acc, terminals and the helpers. */
  sidebar: Sidebar;
  /** acc's bundle, which the extension runs itself. */
  accScript: string;
  /** Registers a command. regNode turns a row's menu context into its node first. */
  reg: (id: string, fn: Handler) => void;
  /** Ends something with the extension, such as a listener. */
  subscribe: (d: vscode.Disposable) => void;
  regNode: (id: string, fn: Handler) => void;
  /** Runs a command for what a tab's Ref names, as the sidebar's node. */
  resolve: (command: string, ref: Ref) => unknown;
  /** What acc said when it refused, in its own words. */
  accSays: (r: { code: number; stdout: string; stderr: string }) => string;
  /** An answer to an agent's question. */
  answer: (id: string, a: Answer) => void;
  /** A person's answer to a task's analysis's question, through acc (D-052). */
  answerAnalysis: (root: string, task: string, question: string, text: string) => Promise<{ ok: boolean; error?: string }>;
  /** Posting, discarding and drafting a ticket's updates, through acc (D-066). */
  updates: UpdateActions;
  /** Shows the page's output panel, at a run when given. */
  showRun: (id?: string) => void;
  /** Takes the Command Center page's messages of one type. */
  receive<T extends FromWebview['type']>(type: T, fn: (m: Extract<FromWebview, { type: T }>) => void): void;
}

export interface ExtensionArea {
  /** Its VS Code commands and the page's messages it takes, once every part exists. */
  register?(x: Parts): void;
}
