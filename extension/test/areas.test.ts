// Each area of the extension registers itself in its own module (D-???): the page's messages and the
// commands it may ask for come from the area that draws them, none twice; each area adds its part of the
// Command Center page in its own turn; and every command the extension declares is registered by
// extension.ts or by an area module that areas.ts lists, so splitting a module can't drop one.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { COMMANDS } from '../src/logic/setup.ts';
import { AREAS as MODEL_AREAS } from '../src/model/areas.ts';
import { isFromWebview, MESSAGE_TYPES, PAGE_COMMANDS } from '../src/model/messages.ts';
import { VIEW_KINDS } from '../src/model/shared.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { contributes: { commands: { command: string }[] } };

/** The commands extension.ts and the area modules areas.ts lists register, as their source names them. */
function registered(): Set<string> {
  const index = readFileSync(join(root, 'src', 'areas.ts'), 'utf8');
  const files = ['extension.ts', ...[...index.matchAll(/from '\.\/([\w-]+\.ts)'/g)].map((m) => m[1]!)];
  const text = files.map((f) => readFileSync(join(root, 'src', f), 'utf8')).join('\n');
  const ids = new Set([...text.matchAll(/\breg(?:Node)?\('([\w.]+)'/g)].map((m) => m[1]!));
  for (const [key, id] of Object.entries(COMMANDS)) if (new RegExp(`\\breg(?:Node)?\\(COMMANDS\\.${key}\\b`).test(text)) ids.add(id);
  if (text.includes('for (const kind of VIEW_KINDS) reg(`acc.open.${kind}`')) for (const k of VIEW_KINDS) ids.add(`acc.open.${k}`);
  return ids;
}

test('the page\'s messages: each from the area that sends it, none taken by two, and nothing else let in', () => {
  const declared = MODEL_AREAS.flatMap((a) => Object.keys(a.messages ?? {}));
  assert.equal(new Set(declared).size, declared.length, 'no message in two areas');
  assert.deepEqual([...MESSAGE_TYPES].sort(), [...declared].sort());
  for (const type of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'nope']) assert.equal(isFromWebview({ type }), false, type);
  assert.equal(isFromWebview({ type: 'ready' }), true);
});

test('the commands the page may ask for: each from the area that draws it, none claimed twice, each one the extension registers', () => {
  assert.ok(PAGE_COMMANDS.length >= 50, `${PAGE_COMMANDS.length} commands`);
  assert.equal(new Set(PAGE_COMMANDS).size, PAGE_COMMANDS.length, 'no command in two areas');
  const ids = registered();
  for (const c of PAGE_COMMANDS) assert.ok(ids.has(c), `${c} is registered`);
});

test('every command the extension declares is registered by extension.ts or an area module areas.ts lists', () => {
  const ids = registered();
  const declared = manifest.contributes.commands.map((c) => c.command);
  assert.ok(declared.length >= 80, `${declared.length} commands`);
  assert.deepEqual(declared.filter((c) => !ids.has(c)), [], 'declared but not registered');
});

test('the Command Center page: each area adds its part in a turn of its own', () => {
  const orders = MODEL_AREAS.flatMap((a) => (a.home ? [a.home.order] : []));
  assert.equal(new Set(orders).size, orders.length, 'no two areas share a turn');
  assert.ok(orders.length >= 8);
});
