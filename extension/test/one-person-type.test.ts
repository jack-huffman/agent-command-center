// One person type (T-87): a board's person is `Who` ({ key, name }, extension/src/model/boards.ts). The page
// draws what the model holds, so a copy declared in extension/webview/ or elsewhere in extension/src/ is a
// second type that can drift from it. This walks every source file and fails on a copy.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import { root } from './support.ts';

/** The one file that declares a person with a key and a name. */
export const WHO_FILE = join('src', 'model', 'boards.ts');

/** An object type of just a key and a name, as an interface, a type alias or written in place, in either order, with ; , or lines between. */
const PERSON_SHAPE = /\{\s*(?:key\??\s*:\s*string\s*[;,]?\s*name\??\s*:\s*string|name\??\s*:\s*string\s*[;,]?\s*key\??\s*:\s*string)\s*[;,]?\s*\}/g;

/** Where each person-shaped object type is in a source text, as a line number. */
export function personTypes(text: string): number[] {
  return [...text.matchAll(PERSON_SHAPE)].map((m) => text.slice(0, m.index).split('\n').length);
}

function sources(): string[] {
  return ['src', 'webview'].flatMap((d) => readdirSync(join(root, d), { recursive: true }).map(String).filter((f) => f.endsWith('.ts')).map((f) => join(d, f)));
}

test('no person-shaped type is declared outside boards.ts: the page uses Who', () => {
  const files = sources();
  assert.ok(files.some((f) => f.startsWith('webview')) && files.some((f) => f.startsWith('src')), 'the scan found no source to check');
  const copies = files.filter((f) => f !== WHO_FILE).flatMap((f) => personTypes(readFileSync(join(root, f), 'utf8')).map((line) => `${relative('.', f)}:${line}`));
  assert.deepEqual(copies, [], `these declare { key, name } again: use Who from model/boards.ts (scanned ${files.length} files)`);
  assert.deepEqual(personTypes(readFileSync(join(root, WHO_FILE), 'utf8')).length, 1, 'boards.ts declares Who once');
});

test('the scan sees a copy however it is written, and not a type that holds more or less (edge case)', () => {
  assert.equal(personTypes('interface P {\n  key: string;\n  name: string;\n}').length, 1, 'an interface');
  assert.equal(personTypes('type P = { name: string; key: string };').length, 1, 'a type, in the other order');
  assert.equal(personTypes('const f = (p: { key: string, name: string }) => p;').length, 1, 'written in place');
  assert.equal(personTypes('interface P { key?: string; name: string }').length, 1, 'an optional key');
  assert.equal(personTypes('interface P { key: string; name: string; color: string }').length, 0, 'more than a person is another thing');
  assert.equal(personTypes('interface P { name: string }').length, 0, 'a name alone');
  assert.deepEqual(personTypes(''), [], 'no text');
});
