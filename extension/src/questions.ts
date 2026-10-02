import { existsSync, type FSWatcher, mkdirSync, statSync, watch } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import {
  type Answer, answerQuestion, listen, LISTENER_EVERY_MS, pendingQuestions, permissionHook, type Question, questionHistory, questionsDir, stopListening,
} from '../../packages/core/src/questions.ts';
import type { Hub } from './hub.ts';
import { isUnder, shq } from './logic.ts';
import { type QuestionCard, questionCards } from './model.ts';

/** How a shell runs the bundled acc: by VSCode's own runtime, so node needn't be on PATH. */
export const accShellCommand = (accScript: string): string => `ELECTRON_RUN_AS_NODE=1 ${shq(process.execPath)} ${shq(accScript)}`;

/** Settings for a background session this window starts, so its questions come here too. */
export const sessionSettings = (accScript: string): string => JSON.stringify({ hooks: permissionHook(accShellCommand(accScript)) });

/** A toast offers Allow only when the whole command fits in it, so what's allowed is what was read. */
const TOAST_CODE_MAX = 120;

/**
 * Agents' questions, from the folder `acc hook permission` writes to (D-030). While this window is
 * open it tells the hook it's listening for its folders, so their agents ask here instead of in a
 * terminal nobody is watching. A new question also raises a notification, unless it's already on screen.
 */
export class Questions implements vscode.Disposable {
  private readonly hub: Hub;
  private readonly log: vscode.LogOutputChannel;
  private readonly dir: string;
  private readonly show: (q: QuestionCard) => void;
  private readonly onScreen: (q: QuestionCard) => boolean;
  private readonly timers: NodeJS.Timeout[] = [];
  private watcher: FSWatcher | null = null;
  private soon: NodeJS.Timeout | undefined;
  private readonly told = new Set<string>();
  /** For each question, the agent snapshots since it was asked that showed its session working again. */
  private readonly movedOn = new Map<string, number>();
  private lastLook = 0;
  private historyMtime = -1;

  constructor(hub: Hub, log: vscode.LogOutputChannel, show: (q: QuestionCard) => void, onScreen: (q: QuestionCard) => boolean, dir = questionsDir()) {
    this.hub = hub;
    this.log = log;
    this.show = show;
    this.onScreen = onScreen;
    this.dir = dir;
  }

  dispose(): void {
    for (const t of this.timers) clearInterval(t);
    clearTimeout(this.soon);
    this.watcher?.close();
    stopListening(this.dir);
  }

  /** The folders this window answers for: each workspace folder, and every worktree of its projects. */
  roots(): string[] {
    const folders = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
    return [...new Set([...folders, ...this.hub.projects.flatMap((p) => p.worktrees.map((w) => w.path))])];
  }

  start(): void {
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    } catch (e) {
      this.log.warn(`Questions: can't create ${this.dir}: ${(e as Error).message}`);
      return;
    }
    const beat = () => {
      try {
        listen(this.dir, this.roots());
      } catch (e) {
        this.log.warn(`Questions: can't write the listener file: ${(e as Error).message}`);
      }
    };
    beat();
    this.timers.push(setInterval(beat, LISTENER_EVERY_MS));
    // fs.watch is quick but can miss events on some file systems, so a slow poll backs it up.
    try {
      if (existsSync(this.dir)) this.watcher = watch(this.dir, () => this.scanSoon());
    } catch {
      this.watcher = null;
    }
    this.timers.push(setInterval(() => this.scan(), 4_000));
    for (const t of this.timers) t.unref?.();
    this.scan();
  }

  /** The folders changed (a project or worktree came or went): tell the hook at once. */
  rootsChanged(): void {
    try {
      listen(this.dir, this.roots());
    } catch {
      // the next beat tries again
    }
  }

  private scanSoon(): void {
    clearTimeout(this.soon);
    this.soon = setTimeout(() => this.scan(), 120);
  }

  /**
   * Claude Code shows its own prompt while the hook waits, so a question may be answered by attaching
   * instead. Then the session works again while its question is still here: two fresh looks at it
   * working, and the hook is told to stop, which withdraws the question.
   */
  private answeredElsewhere(qs: Question[]): Question[] {
    const fresh = this.hub.agentsAt !== this.lastLook;
    this.lastLook = this.hub.agentsAt;
    return qs.filter((q) => {
      const s = this.hub.agents.find((a) => a.sessionId === q.sessionId);
      if (!fresh || !s || s.kind !== 'background' || this.hub.agentsAt < q.at + 3_000) return false;
      const n = s.state === 'working' ? (this.movedOn.get(q.id) ?? 0) + 1 : 0;
      this.movedOn.set(q.id, n);
      if (n < 2) return false;
      this.log.info(`Question ${q.id} was answered in ${s.name ?? q.sessionId}'s own prompt; withdrawing it here.`);
      try {
        process.kill(q.pid, 'SIGTERM');
      } catch {
        // already gone
      }
      return true;
    });
  }

  scan(): void {
    const roots = this.roots();
    const all = pendingQuestions(this.dir).filter((q) => roots.some((r) => isUnder(q.cwd, r)));
    const gone = new Set(this.answeredElsewhere(all).map((q) => q.id));
    const mine = all.filter((q) => !gone.has(q.id));
    for (const id of this.movedOn.keys()) if (!mine.some((q) => q.id === id)) this.movedOn.delete(id);
    // How earlier questions ended (D-037): read again only when the file has changed.
    let mtime = 0;
    try {
      mtime = statSync(join(this.dir, 'history.jsonl')).mtimeMs;
    } catch {
      mtime = 0;
    }
    if (mtime !== this.historyMtime) {
      this.historyMtime = mtime;
      this.hub.setAnswers(questionHistory(this.dir).filter((h) => roots.some((r) => isUnder(h.cwd, r))));
    }
    const before = this.hub.questions.map((q) => q.id).join(',');
    if (mine.map((q) => q.id).join(',') !== before) this.hub.setQuestions(mine);
    for (const q of mine) {
      if (this.told.has(q.id)) continue;
      this.told.add(q.id);
      void this.notify(q);
    }
  }

  answer(id: string, answer: Answer): boolean {
    const ok = answerQuestion(this.dir, id, answer);
    if (!ok) void vscode.window.showInformationMessage('That question was already answered, or its agent stopped waiting.');
    else this.log.info(`Answered question ${id}: ${answer.decision}${'always' in answer && answer.always ? ' for the session' : ''}`);
    this.scanSoon();
    return ok;
  }

  private async notify(q: Question): Promise<void> {
    const card = questionCards(this.hub).find((c) => c.id === q.id);
    if (!card || this.onScreen(card)) return;
    if (card.kind === 'question') {
      const first = card.questions[0];
      // One plain choice can be answered from the notification itself.
      const quick = card.questions.length === 1 && first && !first.multiSelect && first.options.length <= 3 ? first.options.map((o) => o.label) : [];
      const pick = await vscode.window.showInformationMessage(`${card.who} asks: ${first?.question ?? 'a question'}`, ...quick, 'Answer…');
      if (pick && pick !== 'Answer…' && first) this.answer(q.id, { decision: 'allow', answers: { [first.question]: pick } });
      else if (pick) this.show(card);
      return;
    }
    const code = card.code ?? '';
    const fits = !!code && code.length <= TOAST_CODE_MAX && !code.includes('\n');
    const message = `${card.who} ${card.title}${fits ? `: ${code}` : '.'}`;
    // Allow, when the whole command is in view; every other answer is one click away (D-038).
    const pick = await vscode.window.showWarningMessage(message, ...(fits ? ['Allow'] : []), 'All choices…', 'Show');
    if (pick === 'Allow') this.answer(q.id, { decision: 'allow' });
    else if (pick === 'All choices…') await this.choose(card);
    else if (pick === 'Show') this.show(card);
  }

  /** Every answer the card offers, in VSCode's own picker, with the words a choice needs asked for after. */
  async choose(card: QuestionCard): Promise<void> {
    const pick = await vscode.window.showQuickPick(card.choices.map((c, i) => ({ label: `${i + 1}. $(${c.icon}) ${c.label}`, detail: c.hint ?? undefined, c })), {
      title: `${card.who} ${card.title}`, placeHolder: card.code ?? card.detail ?? undefined, ignoreFocusOut: true,
    });
    if (!pick) return;
    const c = pick.c;
    if (c.needs === 'command') {
      const command = await vscode.window.showInputBox({ title: 'The command as it should run', value: card.code ?? '', ignoreFocusOut: true, validateInput: (v) => (v.trim() ? undefined : 'A command') });
      if (!command?.trim()) return;
      this.answer(card.id, { ...c.answer, decision: 'allow', command: command.trim() });
    } else if (c.needs) {
      const words = await vscode.window.showInputBox({ title: c.needs === 'feedback' ? 'What should change in the plan?' : 'Tell it why, or what to do instead (optional)', ignoreFocusOut: true });
      if (words === undefined) return;
      this.answer(card.id, { decision: 'deny', ...(words.trim() ? { message: words.trim() } : {}) });
    } else if (c.answer.decision === 'allow') {
      this.answer(card.id, { decision: 'allow', ...(c.answer.always ? { always: true, scope: c.answer.scope ?? 'session' } : {}), ...(c.answer.mode ? { mode: c.answer.mode } : {}) });
    } else {
      this.answer(card.id, { decision: 'deny', ...(c.answer.stop ? { stop: true } : {}) });
    }
  }
}
