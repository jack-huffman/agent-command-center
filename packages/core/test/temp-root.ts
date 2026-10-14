// One temp folder per test process, removed when the process exits (GH-174). Every test's temp folder
// goes inside it, so a run leaves nothing behind in the system temp directory, even after a failed test.
// TMPDIR points at it too, so what the code under test and the programs it starts make there lands
// inside it as well.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** This process's root, under the system temp directory as it was when the process started. */
export const RUN_ROOT = mkdtempSync(join(tmpdir(), `acc-run-${process.pid}-`));
process.env.TMPDIR = RUN_ROOT;

const removeRoot = () => rmSync(RUN_ROOT, { recursive: true, force: true, maxRetries: 3 });
process.on('exit', removeRoot);
// A signal ends the process without 'exit'; remove the root, then end as that signal would. Where the code
// under test listens for the signal too, that listener decides what it does: sent again, the signal would
// reach it a second time instead of ending the process.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.once(signal, () => {
    removeRoot();
    if (process.listenerCount(signal) === 0) process.kill(process.pid, signal);
  });
}

/** A fresh folder inside this process's root. */
export function tempDir(prefix = 'acc-test-'): string {
  return mkdtempSync(join(RUN_ROOT, prefix));
}
