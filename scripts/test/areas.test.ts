// Each area of the Command Center registers itself in its own module (D-???): the indexes that gather them
// are written by npm run build, and are never stale; no two areas claim the same command, option, message,
// section or page command.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FOLDERS, HEADER, indexText, writeAreas } from '../areas.ts';
import { AREAS as COMMAND_AREAS } from '../../packages/cli/src/commands/index.ts';
import { commandsOf, helpOf, optionsOf } from '../../packages/cli/src/main.ts';

test('every area index is as npm run build writes it, and says it\'s generated', () => {
  assert.deepEqual(writeAreas(true), [], 'run npm run build');
  for (const f of FOLDERS) assert.ok(readFileSync(join(import.meta.dirname, '..', '..', f.dir, f.index), 'utf8').startsWith(HEADER), `${f.dir}/${f.index}`);
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
