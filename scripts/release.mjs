// npm run release (D-???): a GitHub Release of main, with the .vsix and its CHANGELOG entry, as the repo's
// account. Only a person runs it: it asks for the version to be typed in a terminal.
import { createInterface } from 'node:readline/promises';
import { run } from '../packages/core/src/exec.ts';
import { defaultTermDeps, personalTerms, release, ROOT } from './packaging.ts';

const ask = async (question) => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(question); } finally { rl.close(); }
};

const r = await release({
  root: ROOT,
  run,
  env: process.env,
  isTTY: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  ask,
  terms: () => personalTerms(defaultTermDeps(ROOT)),
  log: (line) => console.log(line),
});
if (!r.ok) {
  console.error(r.reason);
  process.exit(1);
}
console.log(`Released: ${r.url}`);
