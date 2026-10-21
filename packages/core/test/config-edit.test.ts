// Changing one key of a JSON file a person keeps, and nothing else in it (GH-111).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { setAutoMerge, setAutonomy, setProfile } from '../src/agents.ts';
import { parseConfig, saveTracker, writeConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { editJsonKey, sameJson, writeJsonKey } from '../src/config-edit.ts';
import { GENERIC_CONFIG, tempDir } from './support.ts';

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

test('writeJsonKey writes through writeAtomic, and leaves no temp file', () => {
  const src = readFileSync(new URL('../src/config-edit.ts', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('export function writeJsonKey'));
  assert.match(body, /writeAtomic\(file, edited\)/);
  assert.doesNotMatch(body, /writeFileSync/);
  const dir = tempDir('atomic-');
  const file = join(dir, 'config.json');
  writeFileSync(file, '{\n  "a": 1\n}\n');
  writeJsonKey(file, ['a'], 2);
  assert.equal(readFileSync(file, 'utf8'), '{\n  "a": 2\n}\n');
  assert.deepEqual(readdirSync(dir), ['config.json'], 'no temp file is left');
});

/** Files in core that may write something with writeFileSync in a function that names the config, with why. May only shrink (T-82). */
const NOT_THE_SETTINGS: Record<string, string> = {
  'setup.ts': 'writes the README and other files the project is set up with, in functions that take the config only to read from it',
};

type Write = { file: string; line: number; unit: string; arg: string };

/** A write is the settings when its path names the config, or is a parameter of a function that deals in the config: whatever the variable is called. */
function writesSettings(w: Pick<Write, 'unit' | 'arg'>): boolean {
  return /config|\.acc\b/i.test(w.arg) || (/^\w+$/.test(w.arg) && new RegExp(`\\b${w.arg}\\b`).test(w.unit.split('{\n')[0] ?? '') && /config/i.test(w.unit));
}

/** Every writeFileSync in core's source, with the top-level function or constant it sits in. */
function writes(): Write[] {
  const out: Write[] = [];
  for (const f of readdirSync(new URL('../src/', import.meta.url), { recursive: true }).map(String).filter((p) => p.endsWith('.ts'))) {
    const lines = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (!/\bwriteFileSync\(/.test(l)) return;
      let s = i;
      while (s > 0 && !/^(export )?(async )?(function|const) /.test(lines[s] ?? '')) s--;
      out.push({ file: f, line: i + 1, unit: lines.slice(s, i + 1).join('\n'), arg: /writeFileSync\(\s*([^,]+?)\s*,/.exec(l)?.[1] ?? '' });
    });
  }
  return out;
}

test('no file in core writes the project settings with writeFileSync, whatever the variable is called (T-82)', () => {
  const all = writes();
  const files = new Set(all.map((w) => w.file));
  assert.ok(all.length > 0 && files.size > 0, 'the scan found no writeFileSync to check');
  const hits = all.filter(writesSettings);
  const stray = hits.filter((w) => !(w.file in NOT_THE_SETTINGS));
  assert.deepEqual(stray.map((w) => `${w.file}:${w.line}`), [], `these write the settings in place: use writeJsonKey or writeAtomic (scanned ${all.length} writes in ${files.size} files)`);
  // The list names only files that still write; an entry nothing needs is deleted.
  for (const f of Object.keys(NOT_THE_SETTINGS)) assert.ok(hits.some((w) => w.file === f), `${f} is on the list but no longer needs to be`);
});

test('the scan takes a write of the settings for one whatever the path is called, and not a write of something else (T-82)', () => {
  const unit = (sig: string, write: string): string => `export function save(${sig}): void {\n  const raw = JSON.parse('{}');\n  ${write}`;
  // The old writers: a parameter called configFile, a parameter called file in a function that checks the config, a path built in place.
  assert.ok(writesSettings({ arg: 'configFile', unit: unit('configFile: string', 'writeFileSync(configFile, text);') }));
  assert.ok(writesSettings({ arg: 'f', unit: unit('f: string, cfg: Config', 'writeFileSync(f, text);') }));
  assert.ok(writesSettings({ arg: 'join(dir, \'.acc\', \'x.json\')', unit: unit('dir: string', 'writeFileSync(...)') }));
  // A local path in a function that never takes it in, and a function with nothing to do with the config.
  assert.ok(!writesSettings({ arg: 'marker', unit: unit('dir: string', 'const marker = join(dir, \'m\');\n  writeFileSync(marker, text);') }));
  assert.ok(!writesSettings({ arg: 'f', unit: unit('f: string', 'writeFileSync(f, text);') }));
});

test('each writer moved to writeAtomic changes the file and leaves no temp file beside it (T-82)', () => {
  const dir = tempDir('moved-');
  const file = join(dir, 'config.json');
  const fresh = (): void => writeFileSync(file, JSON.stringify(GENERIC_CONFIG, null, 2) + '\n');
  const settled = (what: string): void => assert.deepEqual(readdirSync(dir), ['config.json'], `${what} left a temp file`);
  fresh();
  setProfile(run, dir, file, 'builder', { model: 'opus' }, 'project');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).agents.builder.model, 'opus');
  settled('setProfile');
  setAutonomy(file, 'review');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).autonomy, 'review');
  settled('setAutonomy');
  setAutoMerge(file, true);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).autopilot.autoMerge, true);
  settled('setAutoMerge');
  fresh();
  writeConfig(file, parseConfig(GENERIC_CONFIG).config!);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).project, 'Tool');
  settled('writeConfig');
  saveTracker(file, null, { kind: 'github' });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).trackers.length, 1);
  settled('saveTracker');
});
