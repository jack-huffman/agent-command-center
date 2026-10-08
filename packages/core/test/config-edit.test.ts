// Changing one key of a JSON file a person keeps, and nothing else in it (GH-111).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { editJsonKey, sameJson, writeJsonKey } from '../src/config-edit.ts';
import { tempDir } from './support.ts';

/** As this repo keeps .acc/config.json: two spaces, a key a line, arrays a value a line. */
const TWO = `{
  "schema": 1,
  "project": "Tool",
  "agents": {
    "max": 5,
    "builder": {
      "model": "claude-opus-5-5"
    }
  },
  "gates": {
    "required": [
      "check"
    ],
    "builder": [
      "typecheck",
      "near-tests"
    ],
    "commands": {
      "check": "npm run check"
    }
  }
}
`;

/** As a person might keep it: four spaces, arrays on one line, keys in their own order. */
const FOUR = '{\n    "project": "Tool",\n    "gates": { "commands": { "test": "npm test" }, "required": [ "test" ] },\n    "schema": 1\n}\n';

test('a value is replaced where it stands, its later lines indented as the key is, and nothing else moves', () => {
  assert.equal(editJsonKey(TWO, ['agents', 'max'], 6), TWO.replace('"max": 5', '"max": 6'));
  assert.equal(editJsonKey(TWO, ['gates', 'required'], ['check', 'lint']), TWO.replace('"required": [\n      "check"\n    ]', '"required": [\n      "check",\n      "lint"\n    ]'));
  assert.equal(editJsonKey(TWO, ['gates', 'builder'], []), TWO.replace(/"builder": \[\n {6}"typecheck",\n {6}"near-tests"\n {4}\]/, '"builder": []'));
  // The same value: the very same text.
  assert.equal(editJsonKey(TWO, ['agents', 'max'], 5), TWO);
  // A list on one line stays on one line.
  assert.equal(editJsonKey(FOUR, ['gates', 'required'], ['test', 'lint']), FOUR.replace('"required": [ "test" ]', '"required": [ "test", "lint" ]'));
  assert.equal(editJsonKey('{"a": ["x"], "b": 1}', ['a'], ['line\nbreak', 'y']), '{"a": [ "line\\nbreak", "y" ], "b": 1}');
});

test('a key that isn\'t there goes after its object\'s last, with the objects on the way to it', () => {
  const noMax = TWO.replace('    "max": 5,\n', '');
  assert.equal(editJsonKey(noMax, ['agents', 'max'], 4), noMax.replace('      "model": "claude-opus-5-5"\n    }\n  },', '      "model": "claude-opus-5-5"\n    },\n    "max": 4\n  },'));
  const noAgents = '{\n  "schema": 1,\n  "project": "Tool"\n}\n';
  assert.equal(editJsonKey(noAgents, ['agents', 'max'], 2), '{\n  "schema": 1,\n  "project": "Tool",\n  "agents": {\n    "max": 2\n  }\n}\n');
  // On one line, it stays on that line.
  assert.equal(editJsonKey(FOUR, ['gates', 'builder'], ['lint']), FOUR.replace('"required": [ "test" ] }', '"required": [ "test" ], "builder": [ "lint" ] }'));
  assert.equal(editJsonKey('{"gates":{}}', ['gates', 'builder'], ['a']), '{"gates":{\n  "builder": [\n    "a"\n  ]\n}}');
});

test('a key is taken out with its comma, and an object left with nothing is empty', () => {
  assert.equal(editJsonKey(TWO, ['gates', 'builder'], undefined), TWO.replace('    "builder": [\n      "typecheck",\n      "near-tests"\n    ],\n', ''));
  assert.equal(editJsonKey(TWO, ['gates', 'commands'], undefined), TWO.replace(',\n    "commands": {\n      "check": "npm run check"\n    }', ''));
  assert.equal(editJsonKey('{ "gates": { "builder": ["a"] } }', ['gates', 'builder'], undefined), '{ "gates": {} }');
  assert.equal(editJsonKey(TWO, ['gates', 'nothing'], undefined), TWO, 'nothing there: nothing changes');
  assert.equal(editJsonKey(TWO, ['nowhere', 'nothing'], undefined), TWO);
});

test('every edit reads back as exactly the change, whatever the file looks like, or the file is written whole', () => {
  const texts = [TWO, FOUR, '{}', '{"a":1}', '{\n\t"a": {\n\t\t"b": [1, 2]\n\t}\n}\n', '{ "agents": "not an object" }', '{"s": "a \\" } { quote", "agents": {"max": 3}}'];
  const changes: [string[], unknown][] = [[['agents', 'max'], 7], [['gates', 'builder'], ['x', 'y']], [['gates', 'builder'], undefined], [['a'], { deep: [1, { two: null }] }], [['schema'], undefined]];
  let n = 0;
  for (const text of texts) {
    for (const [path, value] of changes) {
      const out = editJsonKey(text, path, value);
      const before = JSON.parse(text) as Record<string, unknown>;
      const after = JSON.parse(out) as Record<string, unknown>;
      // The oracle: the file's own values with the one change, as JSON reads them.
      const wanted = structuredClone(before) as Record<string, any>;
      if (value === undefined) {
        let o: any = wanted;
        for (const k of path.slice(0, -1)) o = o && typeof o === 'object' ? o[k] : undefined;
        if (o && typeof o === 'object') delete o[path.at(-1)!];
      } else {
        let o: any = wanted;
        for (const k of path.slice(0, -1)) {
          if (!o[k] || typeof o[k] !== 'object' || Array.isArray(o[k])) o[k] = {};
          o = o[k];
        }
        o[path.at(-1)!] = value;
      }
      assert.ok(sameJson(after, wanted), `${JSON.stringify(text)} ${path.join('.')}: ${out}`);
      n++;
    }
  }
  assert.equal(n, texts.length * changes.length, 'every case ran');
  // A value that isn't an object on the way is rewritten whole, in the file's indentation.
  assert.equal(editJsonKey('{ "agents": "x" }', ['agents', 'max'], 2), '{\n  "agents": {\n    "max": 2\n  }\n}\n');
});

test('writeJsonKey changes the file only when the value does, and refuses a file that isn\'t JSON', () => {
  const file = join(tempDir('edit-'), 'config.json');
  writeFileSync(file, TWO);
  writeJsonKey(file, ['agents', 'max'], 8);
  assert.equal(readFileSync(file, 'utf8'), TWO.replace('"max": 5', '"max": 8'));
  writeFileSync(file, '{ "a": 1, }');
  assert.throws(() => writeJsonKey(file, ['a'], 2), /Couldn't read .*config\.json/);
  assert.equal(readFileSync(file, 'utf8'), '{ "a": 1, }', 'left alone');
});
