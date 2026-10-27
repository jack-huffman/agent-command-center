// The repo's no-client-names rule (.acc/rules.md, T-120): no client's name is committed, because the repo may be
// shared beyond the author. This walks every tracked text file, splits it into words, and fails when a word's
// SHA-256 (lower-cased) is in BANNED. BANNED holds hashes only, so this file names no client. A person adds a
// name with `node scripts/name-hash.mjs <name>`. The check counts the files it read and fails on none.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '..', '..');

/** SHA-256 of each banned name, lower-cased, with the kind of name it stands for. Only ever add one. */
export const BANNED = [
  '292629891a423ebb54e81406137f0de2be3fc52b0d3a9ecae1d5c9535ba8fbef', // the pilot client
  '757a8170ff11860eabec9cef30f939ab6bedf541f1b2486d403fc2247bfbd998', // the author's firm, and its GitHub org
  '91997bc71cebc54d3472ad53c3dcfca028e85b67af43eefb9fee1ae83906475c', // the author's work GitHub account
  '0e52e4f8b025f97500e5242d5393b3a052aa51137beaebb5e73a48b5045f025a', // the pilot client's Azure DevOps org
  'ea941f2092577b99dead68368af67c3aabbc668307917b31bc70ff603c5da412', // the work account's user name alone
];

export const hashOf = (word: string): string => createHash('sha256').update(word.toLowerCase()).digest('hex');

/** The words of a text: each run of letters, digits, `-`, `_` and `.` whole, and again split at each `-`, `_` and `.`. */
export function wordsOf(text: string): string[] {
  const words: string[] = [];
  for (const run of text.match(/[A-Za-z0-9][A-Za-z0-9._-]*/g) ?? []) {
    words.push(run);
    const parts = run.split(/[._-]+/).filter(Boolean);
    if (parts.length > 1) words.push(...parts);
  }
  return words;
}

/** The words of a text whose hash is in the banned list. */
export function bannedIn(text: string, banned: readonly string[]): string[] {
  const set = new Set(banned);
  return [...new Set(wordsOf(text).filter((w) => set.has(hashOf(w))))];
}

/** The tracked files and the text of each that is text: a file with a NUL byte, or gone from the working tree, is skipped. */
function trackedText(): { file: string; text: string }[] {
  const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\0').filter(Boolean);
  const out: { file: string; text: string }[] = [];
  for (const file of files) {
    if (!existsSync(join(ROOT, file))) continue;
    const buf = readFileSync(join(ROOT, file));
    if (buf.includes(0)) continue;
    out.push({ file, text: buf.toString('utf8') });
  }
  return out;
}

test('.acc/rules.md holds the no-client-names rule, and no tracked text file holds a banned name', () => {
  const rules = readFileSync(join(ROOT, '.acc', 'rules.md'), 'utf8');
  assert.match(rules, /scripts\/test\/no-client-names\.test\.ts/);
  assert.match(rules, /scripts\/name-hash\.mjs/);
  const read = trackedText();
  assert.ok(read.length > 100, `${read.length} tracked text files read`);
  assert.ok(BANNED.length >= 5, `${BANNED.length} banned hashes`);
  const found = read.map(({ file, text }) => ({ file, hits: bannedIn(text, BANNED).map(hashOf) })).filter((f) => f.hits.length > 0);
  // The hashes are named, never the words: a person finds the word with git grep for the name they added.
  assert.deepEqual(found, [], 'these files hold a banned name (a hash in BANNED matches a word in them)');
});

test('a banned word is caught in a name with a dash or a path, and a word that only holds it is not, with a fictional name', () => {
  const banned = [hashOf('zorbex'), hashOf('zorbex-co')];
  assert.deepEqual(bannedIn('see Zorbex/Other#1', banned), ['Zorbex']);
  assert.deepEqual(bannedIn('org: zorbex-co', banned), ['zorbex-co', 'zorbex']);
  assert.deepEqual(bannedIn('https://dev.azure.com/ZORBEX-CO/x', banned), ['ZORBEX-CO', 'ZORBEX']);
  assert.deepEqual(bannedIn('zorbexes and azorbex', banned), []);
  assert.deepEqual(bannedIn('', banned), []);
  assert.deepEqual(bannedIn('zorbex', []), []);
});

test('the seeded hashes are the hashes of the lower-cased name, so name-hash.mjs and the check agree', () => {
  assert.equal(hashOf('Zorbex'), hashOf('zorbex'));
  assert.equal(execFileSync('node', [join(ROOT, 'scripts', 'name-hash.mjs'), 'Zorbex'], { encoding: 'utf8' }), `${hashOf('zorbex')}  Zorbex\n`);
  assert.equal(new Set(BANNED).size, BANNED.length);
  for (const h of BANNED) assert.match(h, /^[0-9a-f]{64}$/);
});

test('name-hash.mjs fails and prints usage when it is given no name', () => {
  assert.throws(() => execFileSync('node', [join(ROOT, 'scripts', 'name-hash.mjs')], { stdio: 'pipe' }), /Usage/);
});
