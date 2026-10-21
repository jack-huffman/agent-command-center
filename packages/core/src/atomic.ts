import { renameSync, writeFileSync } from 'node:fs';

/** Writes a file whole: a temp file beside it, then a rename, so a reader never sees it half-written. */
export function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}
