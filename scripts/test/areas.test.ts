// Each area of the Command Center registers itself in its own module (D-099): the indexes that gather them
// are written by npm run build, and are never stale; no two areas claim the same command, option, message,
// section or page command.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { CORE_HEADER, CORE_INDEX, coreIndexText, FOLDERS, HEADER, indexText, writeAreas } from '../areas.ts';
import { AREAS as COMMAND_AREAS } from '../../packages/cli/src/commands/index.ts';
import { commandsOf, helpOf, optionsOf } from '../../packages/cli/src/main.ts';

test('every area index is as npm run build writes it, and says it\'s generated', () => {
  assert.deepEqual(writeAreas(true), [], 'run npm run build');
  for (const f of FOLDERS) assert.ok(readFileSync(join(import.meta.dirname, '..', '..', f.dir, f.index), 'utf8').startsWith(HEADER), `${f.dir}/${f.index}`);
});

test('core\'s index exports each module here whole, by file name, but for the exceptions it names, each pinned (GH-95)', () => {
  const core = join(import.meta.dirname, '..', '..', CORE_INDEX.dir);
  assert.ok(readFileSync(join(core, CORE_INDEX.index), 'utf8').startsWith(CORE_HEADER));
  // How far the exceptions reach: these four modules give only some names, and only onboarding's subfolder is in.
  assert.deepEqual(Object.keys(CORE_INDEX.some).sort(), ['autopilot-rules.ts', 'holding.ts', 'onboarding/helpers.ts', 'onboarding/steps.ts']);
  assert.deepEqual(CORE_INDEX.below, ['onboarding/types.ts', 'onboarding/helpers.ts', 'onboarding/steps.ts'], 'not the trackers\'');
  for (const [file, { names }] of Object.entries(CORE_INDEX.some)) {
    const text = readFileSync(join(core, file), 'utf8');
    for (const name of names.map((n) => n.replace(/^type /, ''))) assert.match(text, new RegExp(`^export (const|function|type|interface|class) ${name}\\b`, 'm'), `${file} has ${name}`);
  }
  // A new module edits no list: it's exported whole, in its turn by name.
  const root = mkdtempSync(join(tmpdir(), 'acc-core-'));
  try {
    mkdirSync(join(root, CORE_INDEX.dir), { recursive: true });
    for (const f of ['b.ts', 'a.ts', 'holding.ts', 'index.ts']) writeFileSync(join(root, CORE_INDEX.dir, f), '');
    const text = coreIndexText(root);
    assert.match(text, /\nexport \* from '\.\/a\.ts';\nexport \* from '\.\/b\.ts';\n\/\/ holding\.ts's claims [^\n]+\nexport \{ STARTING_STALE_MS \} from '\.\/holding\.ts';\nexport \* from '\.\/onboarding\/types\.ts';\n/);
    assert.doesNotMatch(text, /index\.ts/, 'not itself');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an index lists the modules that declare an area, by file name, and gathers the types they share', () => {
  const root = mkdtempSync(join(tmpdir(), 'acc-areas-'));
  try {
    const dir = join(root, 'x');
    mkdirSync(dir);
    writeFileSync(join(dir, 'task-page.ts'), 'export type Message = { type: \'a\' };\nexport const area = {};\n');
    writeFileSync(join(dir, 'boards.ts'), 'export const area = {};\n');
    writeFileSync(join(dir, 'shared.ts'), 'export const areas = 1;\n');
    const text = indexText({ dir: 'x', index: 'areas.ts', unions: ['Message'] }, root);
    assert.ok(text.startsWith(HEADER));
    assert.match(text, /import \{ area as boards \} from '\.\/boards\.ts';\nimport \{ area as taskPage \} from '\.\/task-page\.ts';\n/);
    assert.match(text, /export const AREAS = \[boards, taskPage\];/);
    assert.match(text, /export type Message =\n {2}\| import\('\.\/task-page\.ts'\)\.Message;/);
    assert.doesNotMatch(text, /shared/, 'a module with no area isn\'t one');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('acc\'s command groups: no command in two, no option declared two ways, and every group\'s help under a section', () => {
  assert.ok(COMMAND_AREAS.length >= 9);
  assert.doesNotThrow(() => commandsOf(COMMAND_AREAS));
  assert.doesNotThrow(() => optionsOf(COMMAND_AREAS));
  const [a, b] = COMMAND_AREAS;
  assert.throws(() => commandsOf([a!, { ...b!, commands: { ...b!.commands, ...a!.commands } }]), /in two groups/);
  assert.throws(() => optionsOf([a!, { ...b!, options: { json: { type: 'string' } } }]), /declared two different ways/);
  const help = helpOf(COMMAND_AREAS);
  for (const g of COMMAND_AREAS) {
    assert.ok(help.includes(`${g.help.lines}`), g.help.section);
    for (const name of Object.keys(g.commands)) assert.match(g.help.lines, new RegExp(`acc ${name}\\b`), `acc ${name} is in its group's help`);
  }
});
