// acc names this machine by its platform (T-150, D-209): "This Mac" on a Mac, "This PC" on Windows, from
// thisMachine and its kin in packages/core/src/this-machine.ts. This fails on a message, a label or an
// agent's prompt that says "this Mac" in its own words: on Windows it would say Mac about a PC. Words about a
// Mac only, such as its keychain, are the exceptions below. It counts the files and lines it read, and fails
// on none.
import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');

/**
 * What acc ships and says: its code, the Command Center's pages and commands, and the agents' prompts.
 * plugin/bin/acc.mjs is left out: it's the bundle the release builds from these sources.
 */
const SOURCES = ['packages/*/src/**/*.ts', 'extension/src/**/*.ts', 'extension/webview/**/*.ts', 'extension/commands/*.json', 'extension/package.json', 'plugin/agents/*.md', 'plugin/skills/**/*.md'];

/** The helper's own file, which says what the rule is. */
const HELPER = 'packages/core/src/this-machine.ts';

export interface Hit { file: string; line: number; text: string }

/** Each exception: a file, how many of its lines say "this Mac" (pinned), and why that's a Mac's alone. */
export const EXCEPTIONS: readonly { file: string; lines: number; why: string }[] = [
  { file: 'packages/core/src/cloud.ts', lines: 1, why: 'The token need in a Mac\'s keychain: Windows keeps the token in the Command Center, with its own words (T-145).' },
  { file: 'packages/cli/src/commands/cloud.ts', lines: 2, why: 'acc cloud token keeps the token in a Mac\'s keychain, and its help says so beside what Windows does.' },
  { file: 'extension/src/cloud.ts', lines: 1, why: 'Where the token went: VS Code on Windows, else a Mac\'s keychain.' },
  { file: 'extension/src/cloud-setup.ts', lines: 1, why: 'The token step\'s check on a Mac, which reads its keychain.' },
  { file: 'extension/src/model/cloud-setup.ts', lines: 1, why: 'systemWords\' words for a Mac\'s keychain, beside Windows\' own.' },
];

/** The lines of one file that say "this Mac", outside a comment. */
export function hitsIn(file: string, text: string): Hit[] {
  const code = file.endsWith('.ts');
  const out: Hit[] = [];
  text.split('\n').forEach((line, i) => {
    // A comment explains the code to its reader, on a Mac; only what acc says or an agent reads counts.
    if (code && /^\s*(\/\/|\*|\/\*)/.test(line)) return;
    const said = code ? line.replace(/\/\*.*?\*\//g, '').replace(/\s\/\/\s.*$/, '') : line;
    if (/\bthis Mac\b/i.test(said)) out.push({ file, line: i + 1, text: line.trim() });
  });
  return out;
}

/** Every file the check reads, from the repo's root. */
const sources = (root = ROOT): string[] => [...new Set(SOURCES.flatMap((g) => globSync(g, { cwd: root })))].map((f) => f.replaceAll('\\', '/')).sort();

test('no message, label or prompt says "this Mac" in its own words: each names this machine through thisMachine, but for the Mac-only exceptions', () => {
  const files = sources().filter((f) => f !== HELPER);
  let lines = 0;
  const hits: Hit[] = [];
  for (const f of files) {
    const text = readFileSync(join(ROOT, f), 'utf8');
    lines += text.split('\n').length;
    hits.push(...hitsIn(f, text));
  }
  assert.ok(files.length > 100 && lines > 10_000, `read ${files.length} files, ${lines} lines: too few to have checked acc`);
  console.log(`this-machine: read ${files.length} files, ${lines} lines; ${hits.length} lines are named exceptions`);
  const excused = new Set(EXCEPTIONS.map((e) => e.file));
  assert.deepEqual(hits.filter((h) => !excused.has(h.file)).map((h) => `${h.file}:${h.line} ${h.text.slice(0, 160)}`), [], 'say it with thisMachine() or thisMachineLabel() from packages/core/src/this-machine.ts');
  // Each exception reaches exactly as far as it says: more is a new line it doesn't cover, fewer means it can shrink.
  for (const e of EXCEPTIONS) {
    const mine = hits.filter((h) => h.file === e.file);
    assert.equal(mine.length, e.lines, `${e.file}: ${e.why}`);
    assert.ok(mine.every((h) => /this Mac\\?'s keychain/i.test(h.text)), `${e.file}: an exception covers a Mac's keychain only`);
  }
});

test('edge case: each form of "this Mac" is caught, in a string, a label, a prompt and a command\'s title; a comment and the helper\'s words are not', () => {
  const hits = (text: string, file = 'packages/core/src/x.ts') => hitsIn(file, text).length;
  assert.equal(hits("throw new AccError('refused', 'It runs on this Mac.');"), 1);
  assert.equal(hits('const label = `Review on this Mac`;'), 1);
  assert.equal(hits("{ label: 'This Mac', icon: 'device-desktop' }"), 1, 'a label, capitalised');
  assert.equal(hits('Review it on this Mac.', 'plugin/agents/reviewer.md'), 1, 'an agent\'s prompt');
  assert.equal(hits('"title": "Review on this Mac",', 'extension/commands/tasks.json'), 1, 'a command\'s title');
  assert.equal(hits("const s = 'on this Mac'; // said on a Mac"), 1, 'a string before a comment');
  assert.equal(hits('// A review on this Mac clears it.'), 0, 'a comment');
  assert.equal(hits(' * the builder on this Mac'), 0, 'a doc comment\'s line');
  assert.equal(hits('else { /* a review on this Mac leads */ }'), 0, 'an inline comment');
  assert.equal(hits('const s = `review it on ${thisMachine()}`;'), 0, 'through the helper');
  assert.equal(hits("const s = 'this Machine';"), 0, 'another word');
  assert.equal(hits("const s = 'this MacBook';"), 0, 'a longer word');
});
