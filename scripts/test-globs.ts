// The globs npm test runs, read from package.json, in one place: the tests ratchet (count-tests.mjs) and the
// Windows job (windows-tests.ts) both read them here.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The globs npm test passes to node --test: the quoted arguments of package.json's test script. */
export function testGlobs(root: string): string[] {
  const script = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts?: { test?: string } }).scripts?.test ?? '';
  return [...script.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}
