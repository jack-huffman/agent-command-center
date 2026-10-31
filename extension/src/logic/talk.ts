/**
 * Talk it through from the Command Center (T-98): a message asks acc in the output panel, where the planning
 * agent's steps show (D-171); Use this asks acc to record a proposal as the person's; Open in Claude Code asks
 * acc for the launch and opens it. acc keeps the conversation; this reads it back for the page. Like the rest of
 * logic/, no `vscode` import, so it can be tested with node:test.
 */
import type { RepoPaths } from '../../../packages/core/src/paths.ts';
import { readAnalysis } from '../../../packages/core/src/analyze.ts';
import { readLedger } from '../../../packages/core/src/ledger.ts';
import { openingSession } from '../../../packages/core/src/plan-opening.ts';
import { type ClaudeLaunch, type PlanTalk, readTalk, talking } from '../../../packages/core/src/plan-talk.ts';
import { answersText, type TalkAnswer, turnQuestions } from '../../../packages/core/src/talk-questions.ts';
import { startArgs } from './conversation.ts';
import { accRefusal } from './connect.ts';
import { inProcessWords } from './processes.ts';

type Result = { code: number; stdout: string; stderr: string };

/** What the conversation needs from the extension, passed in so it's tested without VS Code, claude or acc. */
export interface TalkHost {
  /** The project's state folder, as a plan's paths, or undefined for a project that isn't open. */
  paths(root: string): RepoPaths | undefined;
  /** Runs acc; with a label, in the output panel, where its steps show. */
  acc(args: string[], cwd: string, label?: string): Promise<Result>;
  /** Opens Claude Code as acc said, and calls `ended` once that session's terminal closes. */
  launch(task: string, l: ClaudeLaunch, ended: () => void): void;
  /**
   * The whole ticket's file for the first message before a plan (T-110, T-111), and `remove` once acc ends. A file
   * that can't be written is null, and the host tells the person why; acc reads the description. Absent: the description only.
   */
  ticket?(root: string, id: string): Promise<{ file: string | null; remove: () => void }>;
}

/** How a button went: done, or why not. */
export type TalkReply = { ok: true } | { ok: false; error: string };

/** What the page shows of a task's conversation: what acc kept, whether a reply is on its way, and the Claude Code sessions open now. */
export interface TalkState {
  talk: PlanTalk;
  running: boolean;
  open: string[];
}

/** Whether a task waits to be built (T-169), so a message with no plan starts one; past the build it discusses the ticket. */
export const waitsToBuild = (paths: RepoPaths, id: string): boolean => readLedger(paths.ledger).tasks.find((t) => t.id === id)?.state === 'todo';

/** acc's arguments for a person's message (D-012): the words with =, so words that start with - stay words. */
export const talkArgs = (task: string, text: string, about?: string): string[] => ['plan', 'talk', task, `--message=${text}`, ...(about ? [`--about=${about}`] : []), '--json'];

/** acc's arguments for Use this, with `--yes` when the person said yes to changing an approved plan. */
export const useArgs = (task: string, turn: string, proposal: string, yes = false): string[] => ['plan', 'use', task, turn, proposal, ...(yes ? ['--yes'] : []), '--json'];

/** acc's arguments for Open in Claude Code: the launch, as JSON. */
export const claudeArgs = (task: string): string[] => ['plan', 'claude', task, '--json'];

export class Talks {
  private readonly host: TalkHost;
  private readonly changed: (root: string, id: string) => void;
  /** Messages this window sent, by project and task, while the agent replies. */
  private readonly busy = new Set<string>();
  /** Claude Code sessions opened from this window whose terminal is still open, by project and task. */
  private readonly opened = new Map<string, Set<string>>();

  constructor(host: TalkHost, changed: (root: string, id: string) => void = () => {}) {
    this.host = host;
    this.changed = changed;
  }

  /** The task's conversation, whether a reply is on its way (from this window, or any acc), and the sessions open. */
  state(root: string, raw: string): TalkState {
    const id = raw.toUpperCase();
    const paths = this.host.paths(root);
    const key = `${root}#${id}`;
    return {
      talk: paths ? readTalk(paths, id) : { v: 1, task: id, turns: [] },
      running: this.busy.has(key) || (!!paths && !!talking(paths, id)),
      open: [...(this.opened.get(key) ?? [])],
    };
  }

  /** acc, with what it refused in words; a project that closed is refused before it runs. */
  private async ask(root: string, args: string[], label?: string): Promise<{ reply: TalkReply; out: Result | null }> {
    if (!this.host.paths(root)) return { reply: { ok: false, error: 'That project isn\'t open any more.' }, out: null };
    try {
      const out = await this.host.acc(args, root, label);
      const no = accRefusal(out);
      return { reply: no === null ? { ok: true } : { ok: false, error: no }, out };
    } catch (e) {
      return { reply: { ok: false, error: inProcessWords((e as Error).message) }, out: null };
    }
  }

  /**
   * A person's message: one at a time for a task, in the output panel; the page redraws as it starts and ends.
   * Before there is a plan it starts one (T-111): the first such message hands acc the whole ticket, read while
   * the conversation shows the agent working; a later one resumes the session, which holds it already.
   */
  async send(root: string, raw: string, text: string, about?: string): Promise<TalkReply> {
    const id = raw.toUpperCase();
    const key = `${root}#${id}`;
    if (this.busy.has(key)) return { ok: false, error: 'Wait for the planning agent\'s reply.' };
    this.busy.add(key);
    this.changed(root, id);
    let remove = () => {};
    try {
      const paths = this.host.paths(root);
      // With a plan, or past the build (T-169), the ticket's conversation; before the build with none, the plan's start.
      if (!paths || readAnalysis(paths, id) || !waitsToBuild(paths, id)) return (await this.ask(root, talkArgs(id, text, about), `Discuss ${id}`)).reply;
      const first = !openingSession(readTalk(paths, id));
      const read = first && this.host.ticket ? await this.host.ticket(root, id) : null;
      if (read) remove = read.remove;
      return (await this.ask(root, startArgs(id, text, read?.file ?? null), `Start ${id}'s plan with a conversation`)).reply;
    } finally {
      remove();
      this.busy.delete(key);
      this.changed(root, id);
    }
  }

  /**
   * The person's answers to a reply's questions (T-113), as one message: numbered with the questions acc kept,
   * and sent as their next turn. Refused once the reply isn't the last turn, or when the count doesn't match.
   */
  async answers(root: string, raw: string, turn: string, answers: TalkAnswer[]): Promise<TalkReply> {
    const id = raw.toUpperCase();
    const paths = this.host.paths(root);
    if (!paths) return { ok: false, error: 'That project isn\'t open any more.' };
    const t = readTalk(paths, id).turns;
    const asked = t.at(-1)?.id === turn && t.at(-1)?.who === 'agent' ? turnQuestions(t.at(-1)!) : [];
    if (!asked.length) return { ok: false, error: 'Those questions aren\'t waiting any more: something was said since.' };
    if (asked.length !== answers.length) return { ok: false, error: `The planning agent asked ${asked.length} question${asked.length === 1 ? '' : 's'}, and ${answers.length} answer${answers.length === 1 ? '' : 's'} came.` };
    return this.send(root, id, answersText(asked, answers));
  }

  /** Use this: the proposal recorded as the person's, with their yes when it changes an approved plan. */
  async use(root: string, raw: string, turn: string, proposal: string, yes = false): Promise<TalkReply> {
    const id = raw.toUpperCase();
    const r = (await this.ask(root, useArgs(id, turn, proposal, yes))).reply;
    this.changed(root, id);
    return r;
  }

  /** Open in Claude Code: acc writes the brief and says how; the session's terminal opens, and the page redraws when it ends. */
  async claude(root: string, raw: string): Promise<TalkReply> {
    const id = raw.toUpperCase();
    const key = `${root}#${id}`;
    const { reply, out } = await this.ask(root, claudeArgs(id));
    if (!reply.ok || !out) return reply;
    let launch: ClaudeLaunch;
    try {
      launch = JSON.parse(out.stdout) as ClaudeLaunch;
      if (!Array.isArray(launch.args) || typeof launch.sessionId !== 'string') throw new Error('no launch');
    } catch {
      return { ok: false, error: 'The Command Center couldn\'t read how to open Claude Code.' };
    }
    const open = this.opened.get(key) ?? new Set<string>();
    open.add(launch.sessionId);
    this.opened.set(key, open);
    this.host.launch(id, launch, () => {
      open.delete(launch.sessionId);
      this.changed(root, id);
    });
    this.changed(root, id);
    return { ok: true };
  }
}
