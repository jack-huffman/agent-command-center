// acc's entry: it gathers every group of commands from commands/ (D-099), parses the options they declare,
// and runs the one asked for. Each group is its own module there, with its help lines and options, so a new
// command edits only its group; npm run build writes commands/index.ts, which lists them.
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, parseArgs, type ParseArgsOptionsConfig } from 'node:util';
import { AccError } from '../../core/src/index.ts';
import { AREAS } from './commands/index.ts';
import { tone } from './format.ts';
import { type Command, type CommandArea, type Opts, VERSION } from './shared.ts';

/** Options every command takes, and who's asking (actorFrom), which any command may record. */
const GLOBAL: ParseArgsOptionsConfig = {
  json: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', default: false },
  as: { type: 'string' },
  by: { type: 'string' },
};

/** Every group's options in one set. Two groups that declare an option must declare it the same way. */
export function optionsOf(areas: readonly CommandArea[]): ParseArgsOptionsConfig {
  const all: ParseArgsOptionsConfig = { ...GLOBAL };
  for (const a of areas) {
    for (const [name, o] of Object.entries(a.options ?? {})) {
      if (Object.hasOwn(all, name) && !isDeepStrictEqual(all[name], o)) throw new Error(`--${name} is declared two different ways.`);
      all[name] = o;
    }
  }
  return all;
}

/** Every group's commands by name. Two groups can't both have one. */
export function commandsOf(areas: readonly CommandArea[]): Map<string, { run: Command; argv?: (argv: string[]) => string[] }> {
  const all = new Map<string, { run: Command; argv?: (argv: string[]) => string[] }>();
  for (const a of areas) {
    for (const [name, run] of Object.entries(a.commands)) {
      if (all.has(name)) throw new Error(`acc ${name} is in two groups.`);
      all.set(name, { run, ...(a.argv && Object.hasOwn(a.argv, name) ? { argv: a.argv[name] } : {}) });
    }
  }
  return all;
}

/**
 * Every way into acc, as the words that start it: each command, and each command with each word it takes
 * before its arguments (acc gate run). The junk test (GH-106) calls every one of them.
 */
export function entryPointsOf(areas: readonly CommandArea[]): string[][] {
  const all: string[][] = [];
  for (const a of areas) {
    for (const [name, subs] of Object.entries(a.subcommands ?? {})) {
      if (!Object.hasOwn(a.commands, name)) throw new Error(`acc ${name} has subcommands but isn't a command of its group.`);
      if (new Set(subs).size !== subs.length) throw new Error(`acc ${name} lists a subcommand twice.`);
    }
    for (const name of Object.keys(a.commands)) all.push([name], ...(a.subcommands?.[name] ?? []).map((s) => [name, s]));
  }
  return all;
}

/** acc help: each section's title and its groups' lines, sections in the order of their first group. */
export function helpOf(areas: readonly CommandArea[]): string {
  const sections = new Map<string, CommandArea['help'][]>();
  for (const a of [...areas].sort((x, y) => x.help.order - y.help.order)) sections.set(a.help.section, [...(sections.get(a.help.section) ?? []), a.help]);
  return [
    `acc ${VERSION}: Agent Command Center`,
    ...[...sections].map(([title, parts]) => [title, ...parts.map((p) => p.lines)].join('\n')),
    'Every command takes --json. Docs: docs/ONBOARDING.md, docs/DESIGN.md.',
  ].join('\n\n');
}

/** The longest message a failure prints. One that echoes junk back, such as a 100 KB id, stops here (GH-106). */
export const MESSAGE_MAX = 300;

/** A failure's message, cut to MESSAGE_MAX characters with an ellipsis. */
export function failureLine(message: string): string {
  const m = message.trim();
  return m.length > MESSAGE_MAX ? `${m.slice(0, MESSAGE_MAX - 1)}…` : m;
}

const OPTIONS = optionsOf(AREAS);
const COMMANDS = commandsOf(AREAS);

export async function main(argv: string[]): Promise<number> {
  const args = (argv[0] !== undefined ? COMMANDS.get(argv[0])?.argv?.(argv) : undefined) ?? argv;
  const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: OPTIONS });
  const o = values as Opts;
  const [cmd, ...rest] = positionals;
  if (values.version) { process.stdout.write(`${VERSION}\n`); return 0; }
  if (!cmd || values.help || cmd === 'help') { process.stdout.write(helpOf(AREAS) + '\n'); return cmd ? 0 : (values.help ? 0 : 2); }
  const command = COMMANDS.get(cmd);
  if (!command) throw new AccError('usage', `Unknown command "${cmd}". Run acc help.`);
  return command.run(o, rest);
}

const isEntry = (() => {
  try {
    return !!process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch {
    return false;
  }
})();
/**
 * Exits once what acc printed has reached the reader. A pipe takes writes in turn, so process.exit right after
 * a long --json answer cut it short at 8 KB (GH-106): this waits for both streams to drain first.
 */
function exitAfterOutput(code: number): void {
  let open = 2;
  const drained = () => { if (--open === 0) process.exit(code); };
  process.stdout.write('', drained);
  process.stderr.write('', drained);
}

if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => exitAfterOutput(code),
    (e: unknown) => {
      const err = e as Error & { code?: string };
      const message = failureLine(String(err?.message ?? e));
      const json = process.argv.includes('--json');
      if (json) process.stdout.write(JSON.stringify({ error: err?.code ?? 'error', message }) + '\n');
      else process.stderr.write(tone(`✗ ${message}`, 'orange') + '\n');
      const usage = err?.code === 'usage' || String(err?.code ?? '').startsWith('ERR_PARSE_ARGS');
      exitAfterOutput(usage ? 2 : err instanceof AccError ? 1 : 3);
    },
  );
}
