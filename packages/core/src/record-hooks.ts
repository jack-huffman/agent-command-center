/**
 * A builder can't forget a record change (T-100): in a builder's session on a Salesforce project, acc's
 * PreToolUse hook notes each command it lets through that can write records. acc done then refuses until a
 * change is recorded after it, or the builder says none was made (outside-changes.ts). It notes from the hook
 * the plugin already runs, so a plugin whose acc is older than this notes nothing and says nothing. Like the
 * other hooks, it never blocks by failing: on anything unexpected it notes nothing.
 */
import { join } from 'node:path';
import { loadConfig } from './config.ts';
import type { Builder, HookContext } from './hooks.ts';
import { commandsOf } from './command-words.ts';
import { noteCommand } from './outside-changes.ts';
import { repoPaths } from './paths.ts';

/**
 * The commands that can write records, by their first words: sf data's writes, anonymous Apex, and an SFDMU
 * run. `sf apex run test` only runs tests, and `sf data query` only reads.
 */
export const RECORD_WRITERS: readonly (readonly string[])[] = [
  ['sf', 'data', 'create'], ['sf', 'data', 'update'], ['sf', 'data', 'delete'], ['sf', 'data', 'upsert'], ['sf', 'data', 'import'],
  ['sf', 'apex', 'run'], ['sf', 'sfdmu', 'run'], ['sfdx', 'sfdmu:run'],
];

/** The commands in a command line that can write records, each as its words joined, in order. */
export function recordWriters(line: string): string[] {
  return commandsOf(line).filter((w) => RECORD_WRITERS.some((p) => p.every((word, i) => w[i] === word)) && !(w[1] === 'apex' && w[3] === 'test')).map((w) => w.join(' '));
}

/** Notes on the builder's task each command in `line` that can write records, on a Salesforce project. Returns what it noted. */
export function noteRecordWrites(b: Builder, line: string, ctx: HookContext): string[] {
  const writers = recordWriters(line);
  if (!writers.length) return [];
  try {
    if (loadConfig(join(b.root, '.acc', 'config.json')).config.profile !== 'salesforce') return [];
    const paths = repoPaths(b.root, ctx.run);
    for (const w of writers) noteCommand(paths, ctx.now, b.task.id, w, 'record');
    return writers;
  } catch {
    return [];
  }
}
