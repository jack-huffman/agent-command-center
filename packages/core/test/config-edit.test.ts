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

/** Writes in core that may use writeFileSync in a function that names the config: one file and the path text it writes, with why. Each reaches only the writes it names (T-83). May only shrink (T-82). */
const NOT_THE_SETTINGS: { file: string; path: RegExp; why: string }[] = [
  { file: 'dispatch.ts', path: /'\.sf'/, why: "writes the Salesforce CLI's own .sf/config.json into a new worktree, not the project's settings" },
];

/** Whether a write is one the list excuses. */
const excused = (w: Pick<Write, 'file' | 'arg'>): boolean => NOT_THE_SETTINGS.some((e) => e.file === w.file && e.path.test(w.arg));

type Write = { file: string; line: number; unit: string; arg: string };

/** A write is the settings when its path names the config, or is a parameter of a function that deals in the config: whatever the variable is called. */
function writesSettings(w: Pick<Write, 'unit' | 'arg'>): boolean {
  return /config|\.acc\b/i.test(w.arg) || (/^\w+$/.test(w.arg) && new RegExp(`\\b${w.arg}\\b`).test(w.unit.split('{\n')[0] ?? '') && /config/i.test(w.unit));
}

/** The first argument of each writeFileSync( call in a source text, read to its top-level comma, so a path built in place (join(root, '.acc', 'config.json')) or split over lines comes out whole. */
function writeArgs(text: string): { line: number; arg: string }[] {
  const out: { line: number; arg: string }[] = [];
  for (const m of text.matchAll(/\bwriteFileSync\(/g)) {
    let depth = 0;
    let i = m.index + m[0].length;
    const start = i;
    let quote: string | null = null;
    for (; i < text.length; i++) {
      const c = text[i];
      // Quoted text, a template literal too, holds no brackets or commas that count.
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') quote = c;
      else if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) break;
        depth--;
      } else if (c === ',' && depth === 0) break;
    }
    const line = text.slice(0, m.index).split('\n').length;
    const arg = text.slice(start, i).trim();
    // A call the reader can't take apart fails the scan; it never passes it unseen.
    if (!arg) throw new Error(`the scan couldn't read the path of the writeFileSync on line ${line}`);
    out.push({ line, arg });
  }
  return out;
}

/** Every writeFileSync in a source text, with the top-level function or constant it sits in. */
function writesIn(file: string, text: string): Write[] {
  const lines = text.split('\n');
  return writeArgs(text).map(({ line, arg }) => {
    let s = line - 1;
    while (s > 0 && !/^(export )?(async )?(function|const) /.test(lines[s] ?? '')) s--;
    return { file, line, unit: lines.slice(s, line).join('\n'), arg };
  });
}

/** Every writeFileSync in core's source. */
function writes(): Write[] {
  return readdirSync(new URL('../src/', import.meta.url), { recursive: true })
    .map(String)
    .filter((p) => p.endsWith('.ts'))
    .flatMap((f) => writesIn(f, readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8')));
}

test('no file in core writes the project settings with writeFileSync, whatever the variable is called (T-82)', () => {
  const all = writes();
  const files = new Set(all.map((w) => w.file));
  assert.ok(all.length > 0 && files.size > 0, 'the scan found no writeFileSync to check');
  const hits = all.filter(writesSettings);
  const stray = hits.filter((w) => !excused(w));
  assert.deepEqual(stray.map((w) => `${w.file}:${w.line}`), [], `these write the settings in place: use writeJsonKey or writeAtomic (scanned ${all.length} writes in ${files.size} files)`);
  // The list names only files that still write; an entry nothing needs is deleted.
  for (const e of NOT_THE_SETTINGS) assert.ok(hits.some((w) => e.file === w.file && e.path.test(w.arg)), `${e.file} ${e.path} is on the list but no longer needs to be`);
});

test('each exception reaches only the writes it names: another settings write in the same file is stray (T-83)', () => {
  assert.ok(NOT_THE_SETTINGS.length > 0, 'the list has entries to pin');
  for (const e of NOT_THE_SETTINGS) {
    const own = writes().filter((w) => w.file === e.file && writesSettings(w));
    assert.ok(own.length > 0 && own.every((w) => e.path.test(w.arg)), `${e.file}: every write that looks like the settings is one the entry names`);
    // A settings write added to the same file, by any path text the entry doesn't name, is not excused.
    for (const arg of ['configFile', "join(root, '.acc', 'config.json')", 'file']) {
      if (e.path.test(arg)) continue;
      assert.equal(excused({ file: e.file, arg }), false, `${e.file}: ${arg} is not excused`);
    }
    assert.equal(excused({ file: `other-${e.file}`, arg: own[0]!.arg }), false, 'the same path in another file is not excused');
  }
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
  // Real source through the extractor: a path built in place, a path split onto the next line, a plain local, and a call it can't read.
  const real = (src: string): boolean => writesIn('x.ts', `export function save(root: string, configFile: string): void {\n  ${src}\n}`).some(writesSettings);
  assert.ok(real("writeFileSync(join(root, '.acc', 'config.json'), text);"));
  assert.ok(real("writeFileSync(\n    join(root, '.acc', 'config.json'),\n    text,\n  );"));
  assert.ok(real('writeFileSync(\n    configFile,\n    text,\n  );'));
  assert.ok(!real("writeFileSync(join(root, 'notes.md'), text);"));
  assert.throws(() => writesIn('x.ts', 'writeFileSync(\n'), /couldn't read the path/);
  // Quoted text doesn't count: a comma or a bracket inside a path's quotes neither splits it nor ends it (T-83).
  assert.ok(real("writeFileSync(join(root, 'a,b)', '.acc', 'config.json'), text);"), 'a comma and a bracket in a quoted path');
  assert.equal(writeArgs("writeFileSync(join(root, '[x', \"y,\", `z)${a}`), text);")[0]!.arg, "join(root, '[x', \"y,\", `z)${a}`)", 'each kind of quote');
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

test('setup.ts has no exception, and a new writeFileSync(file, …) added there is stray (T-87)', () => {
  assert.ok(!NOT_THE_SETTINGS.some((e) => e.file === 'setup.ts'), 'each of its writes names what it writes, so none looks like the settings');
  const src = readFileSync(new URL('../src/setup.ts', import.meta.url), 'utf8');
  const real = writesIn('setup.ts', src);
  assert.deepEqual(real.map((w) => w.arg).sort(), ['list', 'manifest', 'readme', 'readme', 'readme'], 'the five writes, each with a path named for what it writes');
  assert.deepEqual(real.filter(writesSettings), [], 'none looks like the settings as it is');
  // One more, as a variable called file, in a function that takes the config.
  const added = src.replace("  return { file: readme, created: false, replaced: false };\n}", "  writeFileSync(file, 'x');\n  return { file: readme, created: false, replaced: false };\n}");
  assert.notEqual(added, src, 'the added write went in');
  const stray = writesIn('setup.ts', added).filter((w) => writesSettings(w) && !excused(w));
  assert.deepEqual(stray.map((w) => w.arg), ['file']);
});
