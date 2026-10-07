import { spawn } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { agentArgs, withCloneAgents } from './agents.ts';
import { type AwakeDeps, keepAwakeFor, releaseAwake } from './awake.ts';
import type { Config } from './config.ts';
import { builderModel, builderSettings } from './dispatch.ts';
import { AccError, parseJsonOutput, type Runner } from './exec.ts';
import { remindedPath } from './hooks.ts';
import { type Actor, type ClaudeSession, mutate, readLedger, sessionActive, sessionsOf, type Task } from './ledger.ts';
import { alive } from './lock.ts';
import type { RepoPaths } from './paths.ts';
import { claudeProjectsDir, lastSaid, savedFolder } from './transcript.ts';

/**
 * Resume (D-067): a running task whose builder stopped before acc done or acc block, as GH-41's did when
 * the Mac slept, is carried on in its own session, in the folder its conversation is saved under (D-046),
 * with the rules it was dispatched with: D-060's reply, with a ready message. The resumed claude runs
 * detached, so the button and autopilot return at once, and a marker beside the ledger says it runs.
 */

export interface Resuming {
  sessionId: string;
  pid: number;
  startedAt: string;
  by: string;
  log: string;
}

export const resumingPath = (paths: Pick<RepoPaths, 'stateDir'>, id: string): string => join(paths.stateDir, 'resumes', `${id}.json`);

/** A resume of the task under way, by its process, as reviewing() reads a review. Null once it has gone. */
export function resuming(paths: Pick<RepoPaths, 'stateDir'>, id: string): Resuming | null {
  try {
    const r = JSON.parse(readFileSync(resumingPath(paths, id), 'utf8')) as Resuming;
    return Number.isInteger(r.pid) && r.pid > 0 && alive(r.pid) ? r : null;
  } catch {
    return null;
  }
}

/** Ends a resume under way, as Abandon does, so the conversation never runs on behind a task set aside. */
export function endResume(paths: Pick<RepoPaths, 'stateDir'>, id: string): boolean {
  const r = resuming(paths, id);
  rmSync(resumingPath(paths, id), { force: true });
  releaseAwake(paths, id);
  if (!r) return false;
  try {
    // It was started detached, so it leads its own group, with the commands it runs.
    process.kill(-r.pid, 'SIGTERM');
  } catch {
    try {
      process.kill(r.pid, 'SIGTERM');
    } catch {
      return false;
    }
  }
  return true;
}

/** Claude Code's sessions, or null when `claude agents` didn't answer: then nobody can tell what stopped. */
export function listSessions(run: Runner, cwd: string): ClaudeSession[] | null {
  const r = run('claude', ['agents', '--json'], { cwd, timeoutMs: 20_000 });
  if (r.code !== 0) return null;
  try {
    const list = parseJsonOutput<unknown>(r.stdout);
    return Array.isArray(list) ? (list as ClaudeSession[]) : null;
  } catch {
    return null;
  }
}

/** The last thing an agent said, short enough for a card, a notice or an event. */
export const clipSaid = (said: string, max = 300): string => {
  const one = said.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};

/**
 * What a resumed builder is told. It may have been cut off, as by an API error, or ended its turn some
 * other way, such as asking in its own words: either way it finishes, or blocks.
 */
export function resumeMessage(task: Pick<Task, 'id' | 'title'>, said: string | null, head: string | null): string {
  const quote = said ? clipSaid(said, 1500) : null;
  return [
    `You are the builder for ${task.id}: ${task.title}. Your last turn ended before you ran acc done or acc block, so ${task.id} is still running.${quote ? ' The last thing you said was:' : ''}`,
    ...(quote ? ['', `> ${quote}`] : []),
    '',
    'If you were cut off, carry on from where you left off. If you stopped to ask something, decide it yourself where the task allows, or block and ask.',
    '',
    `Start with \`git status\` and \`git log --oneline -3\`${head ? ` (your branch's latest commit is ${head})` : ''}, then finish the task and its finish line: commit everything, run exactly \`acc gate run\`, then run exactly \`acc done\`. If you're stuck, run exactly \`acc block "<what you need>"\` and stop.`,
  ].join('\n');
}

export interface ResumeCommandInput {
  sessionId: string;
  message: string;
  /** The folder holding acc, put on the builder's PATH, and the PATH it goes in front of. */
  accBinDir: string;
  basePath: string;
  /** How a shell runs acc, for the builder's hooks. */
  accCommand?: string;
}

/**
 * The resumed builder's claude: its session carried on with a message, and the rules it was dispatched
 * with: the builder's settings (its allow and deny lists, and its hooks), its role and task, the
 * project's permission mode, and the builder's model and effort, with the model picked for the task if
 * one was (D-086). Pass the config with this clone's choices in it (withCloneAgents, D-036). D-060's
 * reply runs the same. It keeps the name its run recorded (D-087): resumed without one, Claude Code
 * lists the session under a name of its own.
 */
export function resumeCommand(task: Task, config: Config, i: ResumeCommandInput): { args: string[]; env: Record<string, string>; model: string } {
  const settings = JSON.stringify(builderSettings(task, config, i.accBinDir, i.basePath, i.accCommand));
  const { model } = builderModel(task, config);
  const name = task.run?.name ? ['--name', task.run.name] : [];
  return {
    args: ['-p', i.message, '--resume', i.sessionId, ...name, '--permission-mode', config.agents.permissionMode, ...agentArgs({ ...config.agents.builder, model }), '--settings', settings],
    env: { ACC_ROLE: 'builder', ACC_TASK: task.id },
    model,
  };
}

/** Starts a process detached, its output appended to a log, and gives its pid, or null if it didn't start. */
export type Launcher = (cmd: string, args: string[], o: { cwd: string; env: NodeJS.ProcessEnv; log: string }) => number | null;

const launchDetached: Launcher = (cmd, args, o) => {
  const fd = openSync(o.log, 'a');
  try {
    const child = spawn(cmd, args, { cwd: o.cwd, env: o.env, detached: true, stdio: ['ignore', fd, fd] });
    child.on('error', () => undefined);
    child.unref();
    return child.pid ?? null;
  } finally {
    closeSync(fd);
  }
};

export interface ResumeDeps {
  run: Runner;
  now: () => Date;
  env: NodeJS.ProcessEnv;
  accBinDir: string;
  accCommand?: string;
  /** For tests: how the resumed claude is started, and where Claude Code's projects are. */
  launch?: Launcher;
  projectsDir?: string;
  awake?: AwakeDeps;
}

export interface ResumeOptions {
  actor: Actor;
  by: string;
  /** What to tell it instead of the ready message. */
  message?: string;
}

export interface ResumeResult {
  task: Task;
  sessionId: string;
  pid: number;
  /** The folder it carries on in, where its conversation is saved. */
  folder: string;
  log: string;
  message: string;
  /** The last thing it said before it stopped. */
  said: string | null;
  /** The idle background session stopped first, so the conversation runs in one place. */
  stopped: string | null;
}

/** Why a session can't be resumed now, in words. */
function activeWhy(id: string, s: ClaudeSession): string {
  if (s.kind !== 'background') return `${id}'s conversation is open in a terminal or a Claude Code tab, or a message to it is running: carry on there.`;
  if (s.state === 'blocked' || s.status === 'waiting') return `${id}'s agent is waiting for you in its own prompt: answer it there, with Open in Claude Code or claude attach ${s.id ?? ''}.`.replace(/ \.$/, '.');
  return `${id}'s agent is still working.`;
}

/**
 * Carries a stopped builder on (D-067). Refuses unless the task is running with a session and its
 * worktree, no resume of it runs, and no session of it is at work or waiting in its own prompt. An idle
 * background session is stopped first. The resumed claude runs detached, logged to
 * `logs/<id>.resume.log`, with the Mac kept awake while it lives; the resume is recorded on the run.
 */
export function resume(paths: RepoPaths, config: Config, id: string, deps: ResumeDeps, opts: ResumeOptions): ResumeResult {
  const { now } = deps;
  const task = readLedger(paths.ledger).tasks.find((t) => t.id === id);
  if (!task) throw new AccError('no-task', `No task ${id}.`);
  if (task.state !== 'running') throw new AccError('refused', `${id} is ${task.state}. Only a running task's builder is resumed.`);
  const sessionId = task.run?.sessionId;
  if (!sessionId) throw new AccError('refused', `${id} has no session to carry on. Abandon it and dispatch it again.`);
  const worktree = task.run?.worktree;
  if (!worktree || !existsSync(worktree)) throw new AccError('refused', `${id}'s worktree isn't on disk any more, so there's nowhere to carry on.`);
  // Claimed before anything is looked at, so two Resumes (a person's and autopilot's) can't both launch:
  // the claim holds this process's pid until the resumed claude's replaces it.
  const marker = resumingPath(paths, id);
  const log = join(paths.logs, `${id}.resume.log`);
  claimResume(paths, id, { sessionId, pid: process.pid, startedAt: now().toISOString(), by: opts.by, log });
  try {
    return resumeClaimed(paths, config, id, deps, opts, { task, sessionId, worktree, marker, log });
  } catch (e) {
    // Ours until the launch rewrites it: a refusal leaves nothing behind.
    if (readMarker(marker)?.pid === process.pid) rmSync(marker, { force: true });
    throw e;
  }
}

function readMarker(file: string): Resuming | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Resuming;
  } catch {
    return null;
  }
}

/** Takes the task's resume marker, or refuses while a live one holds it. A marker whose process has gone is taken over. */
function claimResume(paths: Pick<RepoPaths, 'stateDir'>, id: string, claim: Resuming): void {
  const file = resumingPath(paths, id);
  mkdirSync(dirname(file), { recursive: true });
  for (let tries = 0; tries < 2; tries++) {
    try {
      writeFileSync(file, JSON.stringify(claim), { flag: 'wx' });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const already = resuming(paths, id);
      if (already) throw new AccError('refused', `${id} is already being resumed (pid ${already.pid}).`);
      rmSync(file, { force: true });
    }
  }
  throw new AccError('refused', `${id} is already being resumed.`);
}

/** resume(), once its marker is claimed. */
function resumeClaimed(paths: RepoPaths, config: Config, id: string, deps: ResumeDeps, opts: ResumeOptions, c: { task: Task; sessionId: string; worktree: string; marker: string; log: string }): ResumeResult {
  const { run, now } = deps;
  const { task, sessionId, worktree, log } = c;
  const sessions = listSessions(run, paths.root);
  if (!sessions) throw new AccError('refused', `claude agents didn't answer, so acc can't tell whether ${id}'s agent is still at work. Try again in a moment.`);
  const mine = sessionsOf(task, sessions);
  const active = mine.find(sessionActive);
  if (active) throw new AccError('agent-active', activeWhy(id, active));

  const projectsDir = deps.projectsDir ?? claudeProjectsDir(deps.env);
  const folder = savedFolder(projectsDir, sessionId, [worktree, ...mine.map((s) => s.cwd), paths.root]);
  if (!folder) throw new AccError('refused', `${id}'s conversation (${sessionId}) isn't saved anywhere this machine can find.`);
  const said = lastSaid(projectsDir, sessionId, [folder]);
  const head = run('git', ['log', '-1', '--format=%h'], { cwd: worktree }).stdout.trim() || null;
  const message = opts.message?.trim() || resumeMessage(task, said, head);

  // One place at a time (D-060): an idle background session still holds the conversation.
  let stopped: string | null = null;
  for (const s of mine) {
    if (s.kind !== 'background' || !s.id || !s.pid) continue;
    const r = run('claude', ['stop', s.id], { cwd: paths.root, timeoutMs: 30_000 });
    if (r.code !== 0) throw new AccError('refused', `${id}'s background session ${s.id} wouldn't stop: ${(r.stderr || r.stdout).trim().split('\n')[0]}`);
    stopped = s.id;
  }

  const cmd = resumeCommand(task, withCloneAgents(config, paths.root, run), { sessionId, message, accBinDir: deps.accBinDir, basePath: deps.env.PATH ?? '', accCommand: deps.accCommand });
  mkdirSync(dirname(log), { recursive: true });
  const at = now().toISOString();
  appendFileSync(log, `\n--- ${at}: ${id} resumed by ${opts.by}, in ${folder} ---\n`);
  const pid = (deps.launch ?? launchDetached)('claude', cmd.args, { cwd: folder, env: { ...deps.env, ...cmd.env }, log });
  if (!pid) throw new AccError('resume', `Claude Code didn't start. Its output is in ${log}.`);

  keepAwakeFor(paths, id, pid, deps.awake);
  writeFileSync(c.marker, JSON.stringify({ sessionId, pid, startedAt: at, by: opts.by, log } satisfies Resuming));
  // The Stop hook reminds a session of the finish line once: this turn is reminded too.
  rmSync(remindedPath(paths.stateDir, sessionId), { force: true });

  try {
    const recorded = mutate(paths, now, (l, emit) => {
      const t = l.tasks.find((x) => x.id === id);
      if (!t?.run || t.state !== 'running') throw new AccError('refused', `${id} left running meanwhile, so its resume was stopped.`);
      t.run.resumes = [...(t.run.resumes ?? []), { at, actor: opts.actor, by: opts.by }];
      t.run.model = cmd.model;
      // Done by hand or by autopilot, it clears what autopilot couldn't do (D-055).
      if (t.autopilot?.failed) t.autopilot.failed = null;
      t.updatedAt = at;
      emit({ type: 'task.updated', task: id, actor: opts.actor, by: opts.by, data: { resumed: { said: said ? clipSaid(said) : null } } });
      return t;
    });
    return { task: recorded, sessionId, pid, folder, log, message, said, stopped };
  } catch (e) {
    endResume(paths, id);
    throw e;
  }
}
