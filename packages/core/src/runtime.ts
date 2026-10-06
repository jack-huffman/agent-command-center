import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * The runtime acc's launcher falls back to when node 20 or later isn't on PATH (D-???): VSCode's own,
 * which the extension records here each time it starts. One line, the program's path.
 */
export const runtimeFile = (env: NodeJS.ProcessEnv = process.env): string => env.ACC_RUNTIME_FILE || join(homedir(), '.acc', 'runtime');

/**
 * Records the runtime for the launcher, whole or not at all, so a launcher starting at the same moment
 * never reads half a path. Writes only when the path changed, and says whether it wrote.
 */
export function recordRuntime(execPath: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const file = runtimeFile(env);
  const text = `${execPath}\n`;
  try {
    if (readFileSync(file, 'utf8') === text) return false;
  } catch {
    // not recorded yet
  }
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  try {
    writeFileSync(tmp, text, { mode: 0o600 });
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return true;
}
