import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { delimiter } from 'node:path';
import * as vscode from 'vscode';
import { sfEnv } from '../../packages/core/src/exec.ts';
import { appendOutput, promptOf, type RunPrompt } from './logic.ts';
import type { RunInput } from './model.ts';

interface Run extends RunInput {
  cwd: string;
  child: ChildProcess | null;
  quiet: NodeJS.Timeout | undefined;
  onExit?: (code: number | null) => void;
  judge?: (code: number | null) => boolean;
}

export interface StartOptions {
  cwd: string;
  label?: string;
  /** The setup step it does, so the step can show it's under way and check itself after. */
  step?: string;
  /**
   * A run that lasts as long as the window, such as autopilot (D-???): it stays out of the status bar's
   * running item and isn't the output panel's first pick, so other commands still show there.
   */
  background?: boolean;
  /** More environment for it, on top of VSCode's own. */
  env?: Record<string, string>;
  onExit?: (code: number | null) => void;
  /**
   * Whether it did its job, for a command whose exit code says more than that: acc analyze exits 1 for an
   * analysis with questions, and that's an analysis made, not a failure (D-052). Without it, exit 0 is done.
   */
  ok?: (code: number | null) => boolean;
}

/** A command that has gone this long without output may be waiting for an answer. */
const QUIET_MS = 700;
const KEEP_RUNS = 20;
const KEPT_KEY = 'acc.runs.finished';
const KEPT_LINES = 300;

/**
 * Commands acc runs for you (D-030): setup's fixes, opening an org, comparing branches. Each runs as a
 * child process whose output goes to the page as it comes, instead of into a terminal you have to
 * find. When one goes quiet on a question ("Continue? [y/N]", "Password:"), the page asks it for you.
 * Commands that need a real terminal never come here (see needsTerminal).
 */
export class Runs implements vscode.Disposable {
  private readonly list: Run[] = [];
  private readonly emitter = new vscode.EventEmitter<{ structural: boolean }>();
  /** Fires on output (structural false) and when a run starts, stops or asks (structural true). */
  readonly onDidChange = this.emitter.event;
  private readonly events = new vscode.EventEmitter<{ kind: 'start' | 'ask' | 'end'; run: RunInput }>();
  /** A run started, began waiting for an answer, or ended. */
  readonly onDidEvent = this.events.event;
  private readonly status = vscode.window.createStatusBarItem('acc.runs', vscode.StatusBarAlignment.Left, -1);
  private readonly log: vscode.LogOutputChannel;
  private readonly toTerminal: (command: string, cwd: string) => void;
  private readonly accBin: string;
  private readonly store: vscode.Memento | null;
  private pending: NodeJS.Timeout | undefined;

  /**
   * accBin: the folder with the bundled acc, put first on each run's PATH as in VSCode's terminals.
   * store: where finished runs are kept, so their output is still there after a reload (D-037).
   */
  constructor(log: vscode.LogOutputChannel, toTerminal: (command: string, cwd: string) => void, accBin: string, store: vscode.Memento | null = null) {
    this.log = log;
    this.toTerminal = toTerminal;
    this.accBin = accBin;
    this.store = store;
    for (const r of store?.get<(RunInput & { cwd: string })[]>(KEPT_KEY) ?? []) {
      if (r && typeof r.id === 'string' && r.endedAt !== null) this.list.push({ ...r, prompt: null, child: null, quiet: undefined });
    }
    this.status.name = 'Agent Command Center: running command';
    this.status.command = 'acc.runs.show';
  }

  dispose(): void {
    clearTimeout(this.pending);
    for (const r of this.list) this.kill(r);
    this.status.dispose();
    this.emitter.dispose();
    this.events.dispose();
  }

  views(): RunInput[] {
    return this.list.map((r) => this.view(r));
  }

  private view({ id, label, command, startedAt, endedAt, code, ok, stopped, lines, prompt, step, background }: Run): RunInput {
    return { id, label, command, startedAt, endedAt, code, ...(ok === undefined ? {} : { ok }), stopped, lines, prompt, step, ...(background ? { background } : {}) };
  }

  running(step?: string): boolean {
    return this.list.some((r) => r.endedAt === null && (!step || r.step === step));
  }

  start(command: string, opts: StartOptions): string {
    const id = randomBytes(6).toString('hex');
    const run: Run = {
      id, label: opts.label ?? command, command, cwd: opts.cwd, startedAt: Date.now(), endedAt: null, code: null, stopped: false,
      lines: [''], prompt: null, step: opts.step ?? null, child: null, quiet: undefined, onExit: opts.onExit, judge: opts.ok,
      ...(opts.background ? { background: true } : {}),
    };
    this.list.unshift(run);
    // Finished runs beyond the last few are dropped; running ones never are.
    while (this.list.length > KEEP_RUNS) {
      const i = this.list.map((r) => r.endedAt !== null).lastIndexOf(true);
      if (i < 0) break;
      this.list.splice(i, 1);
    }
    this.log.info(`Running: ${command} (in ${opts.cwd})`);
    let child: ChildProcess;
    try {
      // A shell, since setup's fixes are command lines. Its own process group, so Stop ends all of it.
      child = spawn(command, { cwd: opts.cwd, shell: true, env: sfEnv({ ...process.env, ...opts.env, PATH: `${this.accBin}${delimiter}${process.env.PATH ?? ''}`, FORCE_COLOR: '0', NO_COLOR: '1' }), detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      this.output(run, `${(e as Error).message}\n`);
      this.finish(run, 127);
      return id;
    }
    run.child = child;
    child.stdout?.on('data', (b: Buffer) => this.output(run, b.toString('utf8')));
    child.stderr?.on('data', (b: Buffer) => this.output(run, b.toString('utf8')));
    child.stdin?.on('error', () => undefined); // writing to a command that has just ended
    child.on('error', (e) => this.output(run, `${e.message}\n`));
    child.on('close', (code) => this.finish(run, code));
    this.changed(true);
    this.events.fire({ kind: 'start', run: this.view(run) });
    return id;
  }

  /** Types a line into a run, as if at its prompt. Never logged: it may be a password. */
  input(id: string, text: string): boolean {
    const r = this.list.find((x) => x.id === id);
    if (!r?.child?.stdin || r.endedAt !== null) return false;
    r.child.stdin.write(`${text}\n`);
    const shown = r.prompt?.kind === 'secret' ? '••••••' : text;
    r.lines = appendOutput(r.lines, `${shown}\n`);
    r.prompt = null;
    this.changed(true);
    return true;
  }

  control(id: string, action: 'stop' | 'terminal' | 'dismiss'): void {
    const r = this.list.find((x) => x.id === id);
    if (!r) return;
    if (action === 'stop') {
      r.stopped = true;
      this.kill(r);
    } else if (action === 'terminal') {
      // A process can't move into a terminal, so the terminal starts it again.
      if (r.endedAt === null) { r.stopped = true; this.kill(r); }
      this.toTerminal(r.command, r.cwd);
    } else if (action === 'dismiss') {
      if (r.endedAt === null) { r.stopped = true; this.kill(r); }
      this.list.splice(this.list.indexOf(r), 1);
      this.changed(true);
      this.keep();
    }
  }

  /** Saves the finished runs, each with the end of its output. */
  private keep(): void {
    const done = this.list.filter((r) => r.endedAt !== null).map((r) => ({ ...this.view(r), cwd: r.cwd, lines: r.lines.slice(-KEPT_LINES) }));
    void this.store?.update(KEPT_KEY, done);
  }

  private kill(r: Run): void {
    const pid = r.child?.pid;
    if (!pid || r.endedAt !== null) return;
    try {
      if (process.platform === 'win32') r.child?.kill();
      else process.kill(-pid, 'SIGTERM');
    } catch {
      r.child?.kill();
    }
  }

  private output(r: Run, chunk: string): void {
    r.lines = appendOutput(r.lines, chunk);
    const asked = r.prompt !== null;
    r.prompt = null;
    clearTimeout(r.quiet);
    r.quiet = setTimeout(() => this.checkPrompt(r), QUIET_MS);
    this.changed(asked);
  }

  private checkPrompt(r: Run): void {
    if (r.endedAt !== null) return;
    const p: RunPrompt | null = promptOf(r.lines[r.lines.length - 1] ?? '');
    if (!p) return;
    r.prompt = p;
    this.changed(true);
    this.events.fire({ kind: 'ask', run: this.view(r) });
  }

  private finish(r: Run, code: number | null): void {
    if (r.endedAt !== null) return;
    clearTimeout(r.quiet);
    r.endedAt = Date.now();
    r.code = code;
    try {
      r.ok = !r.stopped && (r.judge ? r.judge(code) : code === 0);
    } catch {
      r.ok = code === 0;
    }
    r.prompt = null;
    r.child = null;
    if (r.lines.length > 1 && r.lines[r.lines.length - 1] === '') r.lines.pop();
    this.log.info(`${r.stopped ? 'Stopped' : r.ok ? 'Finished' : `Failed (exit ${code})`}: ${r.command}`);
    this.changed(true);
    this.events.fire({ kind: 'end', run: this.view(r) });
    this.keep();
    try {
      r.onExit?.(code);
    } catch (e) {
      this.log.warn(`After ${r.command}: ${(e as Error).message}`);
    }
  }

  /** Output comes in bursts, so the page hears about it at most every 120 ms. */
  private changed(structural: boolean): void {
    this.renderStatus();
    if (structural) {
      clearTimeout(this.pending);
      this.pending = undefined;
      this.emitter.fire({ structural: true });
      return;
    }
    if (this.pending) return;
    this.pending = setTimeout(() => {
      this.pending = undefined;
      this.emitter.fire({ structural: false });
    }, 120);
  }

  private renderStatus(): void {
    // A background run lasts as long as the window: it has its own item, or it would spin here all day.
    const live = this.list.filter((r) => r.endedAt === null && (!r.background || r.prompt));
    if (!live.length) { this.status.hide(); return; }
    const asking = live.find((r) => r.prompt);
    const first = asking ?? live[0]!;
    const name = first.label.length > 40 ? `${first.label.slice(0, 40)}…` : first.label;
    this.status.text = asking ? `$(bell) ${name}: waiting for you` : `$(sync~spin) ${name}${live.length > 1 ? ` +${live.length - 1}` : ''}`;
    this.status.tooltip = asking ? `${asking.command}\n\nIt's asking: ${asking.prompt!.text}\nClick to answer.` : live.map((r) => r.command).join('\n');
    this.status.show();
  }
}
