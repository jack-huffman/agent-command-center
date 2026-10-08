/**
 * The per-area files tests read through a script rather than by import (GH-117), and the script that reads
 * them. acc's nearTests follows imports, so it can't see that screenshot.test.ts checks every theme defines
 * the colours a stylesheet uses: it reads them through extension/scripts/styles.ts. A changed file of a kind
 * below is near the tests near its reader, as nearTests finds them, and scripts/near-tests.mjs runs those
 * too. A new kind of per-area file that tests read through a script adds a row here (DESIGN.md §2).
 */
import { nearTests } from '../packages/core/src/gates.ts';

export interface Reads {
  /** The files, by their path from the repo's root. */
  files: RegExp;
  /** The module that reads them for the tests. */
  reader: string;
}

export const READS: Reads[] = [
  // Each area's stylesheet, and styles.css, which they share: styles.ts joins them for the build and the tests.
  { files: /^extension\/webview\/[^/]+\.css$/, reader: 'extension/scripts/styles.ts' },
  // Each area's commands, and the package.json the build writes from them: generate.ts reads both.
  { files: /^extension\/commands\/[^/]+\.json$/, reader: 'extension/scripts/generate.ts' },
  { files: /^extension\/package\.json$/, reader: 'extension/scripts/generate.ts' },
];

/** The tests near what reads the changed files. `tracked` lists the checkout's files, asked only if a reader is. */
export function nearReaders(changed: string[], tracked: () => string[], read: (path: string) => string | null): string[] {
  const readers = [...new Set(changed.flatMap((f) => READS.filter((r) => r.files.test(f)).map((r) => r.reader)))];
  return readers.length ? nearTests(readers, tracked(), read) : [];
}
