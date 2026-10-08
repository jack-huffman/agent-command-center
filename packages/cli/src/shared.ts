// What every group of acc's commands uses: the version, how a command prints, the project it runs in,
// who is asking, and how acc starts itself again.

import { readFileSync, realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ParseArgsOptionsConfig } from 'node:util';
import { AccError, type Actor, ACTORS, type AutopilotStepName, loadConfig, repoPaths, run, withCloneAccount, withCloneAgents } from '../../core/src/index.ts';
import pkg from '../../../package.json' with { type: 'json' };

// One version for acc, the extension, the plugin and the marketplace: the root package.json's (D-079).
export const VERSION = pkg.version;
export const now = () => new Date();

export interface Opts {
  json: boolean;
  [k: string]: unknown;
}

/** A command: its options, and the words after its name. */
export type Command = (o: Opts, rest: string[]) => number | Promise<number>;

/**
 * One group of acc's commands, in its own module under commands/ (D-099): its lines in acc help, the
 * options its commands read, and the commands. main.ts gathers every group from commands/index.ts, which
 * npm run build writes, so a new command edits only its own group.
 */
export interface CommandArea {
  /**
   * Its lines in acc help, under its section's title. Sections go in the order of their first group, and
   * groups within a section by order. Two groups may share a section, as hooks and environments do.
   */
  help: { section: string; order: number; lines: string };
  /** The options its commands read. Two groups may both declare one, the same way. */
  options?: ParseArgsOptionsConfig;
  commands: Record<string, Command>;
  /**
   * For a command that takes a word before its arguments (acc gate run, acc update post), each word it
   * takes. The junk test (GH-106) calls every one, and fails on a word a command compares to that isn't here.
   */
  subcommands?: Record<string, readonly string[]>;
  /** For a command whose arguments need changing before they're parsed, how. */
  argv?: Record<string, (argv: string[]) => string[]>;
}

const READ_ERRORS: Record<string, string> = {
  ENOENT: 'there\'s no such file',
  EISDIR: 'it\'s a folder',
  EACCES: 'it isn\'t readable',
  ENAMETOOLONG: 'the name is too long',
  ENOTDIR: 'part of the path isn\'t a folder',
};

/** A file a person named, as text. One that can't be read is a usage error in words, never a raw ENOENT (GH-106). */
export function readFileArg(file: string | 0): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? '';
    const why = READ_ERRORS[code] ?? (e as Error).message;
    // A long name is shortened, so the reason survives main.ts cutting the message short.
    const name = file === 0 ? 'stdin' : file.length > 120 ? `${file.slice(0, 119)}…` : file;
    throw new AccError('usage', `Can't read ${name}: ${why}.`);
  }
}

export function out(o: Opts, human: () => string, data: unknown): void {
  if (o.json) process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  else process.stdout.write(human() + '\n');
}

export function project(cwd: string) {
  const paths = repoPaths(cwd, run);
  const { config: loaded, warnings } = loadConfig(paths.config);
  for (const w of warnings) process.stderr.write(`warning: ${w}\n`);
  // This clone's own choice of GitHub account, when it made one (D-028).
  // This clone's own choices of agent model and effort (D-036).
  return { paths, config: withCloneAgents(withCloneAccount(loaded, paths.root, run), paths.root, run) };
}

/** Builders are identified by ACC_ROLE, set when they're dispatched. Everyone else is a person. */
export function actorFrom(o: Opts): { actor: Actor; by: string } {
  const role = (o.as as string | undefined) || process.env.ACC_ROLE || 'human';
  if (!(ACTORS as readonly string[]).includes(role)) throw new AccError('usage', `--as must be one of ${ACTORS.join(', ')}.`);
  const by = (o.by as string | undefined) ?? (role === 'builder' && process.env.ACC_TASK ? `builder:${process.env.ACC_TASK}` : `${role}:${process.env.USER ?? 'unknown'}`);
  return { actor: role as Actor, by };
}

/** The task a command is about: the argument, or the builder session's own task. */
export function taskIdFrom(arg: string | undefined): string {
  const id = arg ?? process.env.ACC_TASK;
  if (!id) throw new AccError('usage', 'Name the task, for example: acc done GH-12. Builders get it from ACC_TASK.');
  return id;
}

/** acc's own folder, so builders can run it with no install (D-012). */
export const accBinDir = (): string => {
  try {
    return dirname(realpathSync(process.argv[1]!));
  } catch {
    return dirname(process.argv[1] ?? '.');
  }
};

const shellQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/** How a shell runs this same acc: by this runtime, so it works where node isn't on PATH (VSCode's own). */
export const accCommand = (): string => {
  let script = process.argv[1] ?? '';
  try {
    script = realpathSync(script);
  } catch {
    // keep the path as given
  }
  return `${process.versions.electron ? 'ELECTRON_RUN_AS_NODE=1 ' : ''}${shellQuote(process.execPath)} ${shellQuote(script)}`;
};

const STEP_WORD: Record<AutopilotStepName, string> = { review: 'review', land: 'land', dispatch: 're-dispatch', refresh: 'update', resume: 'resume', checks: 'send back', merge: 'merge', start: 'start', queue: 'take' };

/** A step autopilot couldn't take, in words: "land abc1234", "update abc1234 from its base", "send abc1234 back for its failing checks". */
export const stepWords = (step: AutopilotStepName, sha: string): string => {
  if (step === 'checks') return `send ${sha.slice(0, 7) || 'it'} back for its failing checks`;
  if (step === 'queue') return `take ${sha.slice(0, 7) || 'it'} through the merge queue`;
  if (step === 'start') return 'start it';
  const what = [STEP_WORD[step], sha.slice(0, 7)].filter(Boolean).join(' ');
  return step === 'refresh' ? `${what} from its base` : what;
};

/** Promotion and deploys are a person's: an agent never moves work between environments (D-011, D-034). */
export function personOnly(o: Opts, what: string): string {
  const role = process.env.ACC_ROLE;
  if (role === 'builder' || role === 'reviewer') throw new AccError('refused', `A ${role} can't ${what}. A person does that.`);
  const { actor, by } = actorFrom(o);
  if (actor !== 'human') throw new AccError('refused', `Only a person can ${what}.`);
  return by;
}
