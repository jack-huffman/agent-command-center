import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import * as vscode from 'vscode';
import { sfEnv } from '../../packages/core/src/exec.ts';
import { readStepEvents, STEPS_VAR } from '../../packages/core/src/steps.ts';
import { fileInCheckout } from './logic/review-excerpts.ts';
import { appendOutput, promptOf, type RunPrompt } from './logic/runs.ts';
import { applySteps, NO_RUN_STEPS, runsAcc } from './logic/run-steps.ts';
import type { RunControl, RunInput } from './model/runs.ts';
import { keptReview, type ReviewRun, type VerdictRead } from './model/dock-review.ts';
import type { ExtensionArea } from './area.ts';

interface Run extends RunInput {
  cwd: string;
  child: ChildProcess | null;
  quiet: NodeJS.Timeout | undefined;
  onExit?: (code: number | null) => void;
  judge?: (code: number | null) => boolean;
  readReview?: (startedAt: number) => Promise<VerdictRead>;
  /** How it was started, for Run again (T-64). A run kept over a reload has only what was kept: no env, no onExit. */
  again: StartOptions;
  /** A command run with --json: its stdout so far, which is its answer, not its output (T-65). */
  stdout?: string;
  /** A run of acc's: the folder its steps file is in, while it runs (T-65), and the timer that reads it. */
  stepsDir?: string;
  stepsTimer?: NodeJS.Timeout;
}

export interface StartOptions {
  cwd: string;
  label?: string;
  /** The setup step it does, so the step can show it's under way and check itself after. */
  step?: string;
  /**
   * A run that lasts as long as the window, such as autopilot (D-064): it stays out of the status bar's
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
  /**
   * A review of a task (T-63): the panel shows it as a review, and once it ends, `read` reads the verdict it
   * wrote, which the run's card then carries. A stopped review reads none.
   */
  review?: { run: ReviewRun; read: (startedAt: number) => Promise<VerdictRead> };
  /**
   * A command run with --json, such as acc dispatch from the Command Center (T-65): what it prints to stdout
   * is its answer, kept apart from the lines the panel shows, and handed here once it ends, before onExit.
   */
  answer?: (stdout: string, code: number | null) => void;
}

/** A command that has gone this long without output may be waiting for an answer. */
const QUIET_MS = 700;
const KEEP_RUNS = 20;
const KEPT_KEY = 'acc.runs.finished';
const KEPT_LINES = 300;
/** How often a run of acc's steps file is read while it prints nothing (T-65). */
const STEPS_MS = 250;
/** The steps file's name in its folder. */
const STEPS_FILE = 'steps.jsonl';

/**
 * Opens a file in an editor, its cursor at the start of `line` (counted from 0). An editor that can't open
 * it says why, naming the file as `shown`. A run's output (T-64) and a review's excerpts (T-63) open files this way.
 */
export async function showFileAt(path: string, shown: string, line: number): Promise<void> {
  try {
    const at = new vscode.Position(line, 0);
    await vscode.window.showTextDocument(vscode.Uri.file(path), { selection: new vscode.Range(at, at), preview: true });
  } catch (e) {
    void vscode.window.showWarningMessage(`Couldn't open ${shown}: ${(e as Error).message}`);
  }
}

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
  /** Puts text on the clipboard, for Copy log. */
  copy: (text: string) => Thenable<void> = (text) => vscode.env.clipboard.writeText(text);
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
      if (!r || typeof r.id !== 'string' || r.endedAt === null) continue;
      this.list.push({ ...r, ...(r.review ? { review: keptReview(r.review, r.stopped) } : {}), prompt: null, child: null, quiet: undefined, again: { cwd: r.cwd, label: r.label, ...(r.step ? { step: r.step } : {}), ...(r.background ? { background: true } : {}) } });
    }
    this.status.name = 'Agent Command Center: running command';
    this.status.command = 'acc.runs.show';
  }

  dispose(): void {
    clearTimeout(this.pending);
    for (const r of this.list) {
      this.kill(r);
      clearInterval(r.stepsTimer);
      if (r.stepsDir) rmSync(r.stepsDir, { recursive: true, force: true });
    }
    this.status.dispose();
    this.emitter.dispose();
    this.events.dispose();
  }

  views(): RunInput[] {
    return this.list.map((r) => this.view(r));
  }

  private view({ id, label, command, cwd, startedAt, endedAt, code, ok, stopped, lines, prompt, step, background, review, steps, base, again }: Run): RunInput {
    return { id, label, command, cwd, startedAt, endedAt, code, ...(ok === undefined ? {} : { ok }), stopped, lines, prompt, step, ...(background ? { background } : {}), ...(again?.answer ? { once: true } : {}), ...(review ? { review } : {}), ...(steps ? { steps, base: base ?? 0 } : {}) };
  }

  running(step?: string): boolean {
    return this.list.some((r) => r.endedAt === null && (!step || r.step === step));
  }

  start(command: string, opts: StartOptions): string {
    const id = randomBytes(6).toString('hex');
    const run: Run = {
      id, label: opts.label ?? command, command, cwd: opts.cwd, startedAt: Date.now(), endedAt: null, code: null, stopped: false,
      lines: [''], prompt: null, step: opts.step ?? null, child: null, quiet: undefined, onExit: opts.onExit, judge: opts.ok,
      ...(opts.background ? { background: true } : {}), ...(opts.review ? { review: { ...opts.review.run }, readReview: opts.review.read } : {}), again: opts,
    };
    this.list.unshift(run);
    // Finished runs beyond the last few are dropped; running ones never are.
    while (this.list.length > KEEP_RUNS) {
      const i = this.list.map((r) => r.endedAt !== null).lastIndexOf(true);
      if (i < 0) break;
      this.list.splice(i, 1);
    }
    this.log.info(`Running: ${command} (in ${opts.cwd})`);
    // A run of acc reports its steps (T-65): to a file in a folder of its own, read as it grows, gone once it ends.
    const stepsEnv: Record<string, string> = {};
    if (runsAcc(command)) {
      try {
        run.stepsDir = mkdtempSync(join(tmpdir(), 'acc-steps-'));
        stepsEnv[STEPS_VAR] = join(run.stepsDir, STEPS_FILE);
        run.steps = NO_RUN_STEPS;
        run.base = 0;
        run.stepsTimer = setInterval(() => { if (this.readStepFile(run)) this.changed(false); }, STEPS_MS);
      } catch (e) {
        this.log.warn(`${command}: its steps can't be shown: ${(e as Error).message}`);
      }
    }
    let child: ChildProcess;
    try {
      // A shell, since setup's fixes are command lines. Its own process group, so Stop ends all of it.
      child = spawn(command, { cwd: opts.cwd, shell: true, env: sfEnv({ ...process.env, ...opts.env, ...stepsEnv, PATH: `${this.accBin}${delimiter}${process.env.PATH ?? ''}`, FORCE_COLOR: '0', NO_COLOR: '1' }), detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      this.output(run, `${(e as Error).message}\n`);
      this.finish(run, 127);
      return id;
    }
    run.child = child;
    if (opts.answer) run.stdout = '';
    child.stdout?.on('data', (b: Buffer) => { if (run.stdout !== undefined) run.stdout += b.toString('utf8'); else this.output(run, b.toString('utf8')); });
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

  control(id: string, action: RunControl): void {
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
    } else if (action === 'copy') {
      // All it kept, not only the rows the panel shows.
      void this.copy(r.lines.join('\n')).then(() => vscode.window.setStatusBarMessage(`Copied the output of ${r.label}`, 3000));
    } else if (action === 'rerun') {
      // A run still going isn't started twice; an ended one gives its place to the new one.
      if (r.endedAt === null) return;
      this.list.splice(this.list.indexOf(r), 1);
      this.start(r.command, r.again);
      this.keep();
    }
  }

  /**
   * Opens a file a run's output names (T-64), at its line, when it's inside the folder the run ran in; one
   * outside it, or gone, says so. The page sends only paths it found in that folder.
   */
  async openFile(id: string, file: string, line?: number): Promise<void> {
    const r = this.list.find((x) => x.id === id);
    if (!r) return;
    const path = fileInCheckout(r.cwd, file);
    if (!path || !existsSync(path)) {
      void vscode.window.showWarningMessage(`${file} isn't in the folder ${r.label} ran in, so it doesn't open.`);
      return;
    }
    await showFileAt(path, file, Math.max(0, (line ?? 1) - 1));
  }

  /** Saves the finished runs, each with the end of its output. */
  private keep(): void {
    const done = this.list.filter((r) => r.endedAt !== null).map((r) => {
      const lines = r.lines.slice(-KEPT_LINES);
      // The lines let go move where the kept ones begin, so a step still finds its own.
      return { ...this.view(r), cwd: r.cwd, lines, ...(r.steps ? { base: (r.base ?? 0) + r.lines.length - lines.length } : {}) };
    });
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

  /**
   * Reads a run of acc's steps file, and applies what's new at the line the output has reached (T-65). It's
   * read before each chunk of output is added, so a step's lines are those printed after it began. Says
   * whether anything changed. A file not there yet, or half read, is tried again next time.
   */
  private readStepFile(r: Run): boolean {
    if (!r.stepsDir || !r.steps) return false;
    let text: string;
    try {
      text = readFileSync(join(r.stepsDir, STEPS_FILE), 'utf8');
    } catch {
      return false;
    }
    const next = applySteps(r.steps, readStepEvents(text), (r.base ?? 0) + r.lines.length - 1);
    if (next === r.steps) return false;
    r.steps = next;
    return true;
  }

  private output(r: Run, chunk: string): void {
    this.readStepFile(r);
    // Where lines[0] is in the whole output, as the oldest lines are let go.
    const before = (r.base ?? 0) + r.lines.length;
    r.lines = appendOutput(r.lines, chunk);
    const added = (chunk.replace(/\r\n/g, '\n').match(/\n/g) ?? []).length;
    if (r.base !== undefined) r.base = before + added - r.lines.length;
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
    // Its steps are read a last time, and their folder goes.
    clearInterval(r.stepsTimer);
    this.readStepFile(r);
    if (r.stepsDir) rmSync(r.stepsDir, { recursive: true, force: true });
    r.stepsDir = undefined;
    r.endedAt = Date.now();
    r.code = code;
    try {
      // acc's own result says whether it did its job, when it wrote one (T-65); else its exit code does.
      r.ok = !r.stopped && (r.steps?.result ? r.steps.result.ok : r.judge ? r.judge(code) : code === 0);
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
    if (r.review && r.readReview && !r.stopped) void this.readVerdict(r, r.review, r.readReview);
    try {
      r.again.answer?.(r.stdout ?? '', code);
    } catch (e) {
      this.log.warn(`After ${r.command}: ${(e as Error).message}`);
    }
    try {
      r.onExit?.(code);
    } catch (e) {
      this.log.warn(`After ${r.command}: ${(e as Error).message}`);
    }
  }

  /** A review run's verdict, once it ended (T-63): its card carries it, kept with the run. A read that fails says why. */
  private async readVerdict(r: Run, review: ReviewRun, read: (startedAt: number) => Promise<VerdictRead>): Promise<void> {
    let got: VerdictRead;
    try {
      got = await read(r.startedAt);
    } catch (e) {
      got = { ok: false, why: `Its verdict couldn't be read: ${(e as Error).message}` };
    }
    // Dismissed meanwhile: nothing to put it on.
    if (!this.list.includes(r)) return;
    r.review = { ...review, read: got };
    this.changed(true);
    this.keep();
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

  /** What's running for you, for the one status bar item (D-065). A background run, such as autopilot, isn't one. */
  live(): { label: string; asking: boolean }[] {
    return this.list.filter((r) => r.endedAt === null && (!r.background || r.prompt))
      .map((r) => ({ label: r.label.length > 40 ? `${r.label.slice(0, 40)}…` : r.label, asking: !!r.prompt }));
  }

  private renderStatus(): void {
    // Runs speak through the one status bar item now (D-065); this one stays hidden.
    this.status.hide();
  }
}

export const area: ExtensionArea = {
  register({ runs, receive }) {
    receive('run-input', (m) => void runs.input(m.run, m.text));
    receive('run-control', (m) => runs.control(m.run, m.action));
    receive('run-file', (m) => void runs.openFile(m.run, m.file, m.line));
  },
};
