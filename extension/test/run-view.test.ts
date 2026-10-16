// The output panel's actions on a run (T-64), as the extension does them: Copy log copies all the output it
// kept, Run again starts it once more in the panel, and a path the output names opens when it's in the run's
// folder. Real commands run, through a shell, as the panel's do. And the page draws each run with the rows.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { tempDir } from '../../packages/core/test/support.ts';
import { pageSource } from './support.ts';
import { until } from './vscode.ts';

/** runs.ts imports vscode, which only VSCode has: this stand-in records what Copy log, a status message and opening a file do. */
const did = { copied: [] as string[], status: [] as string[], warn: [] as string[], opened: [] as { path: string; line: number }[] };
class Emitter { private ls: ((e: unknown) => void)[] = []; event = (l: (e: unknown) => void) => { this.ls.push(l); return { dispose() {} }; }; fire(e?: unknown) { for (const l of this.ls) l(e); } dispose() {} }
(globalThis as { accRunsVscode?: unknown }).accRunsVscode = {
  EventEmitter: Emitter,
  StatusBarAlignment: { Left: 1 },
  Position: class { line: number; constructor(line: number) { this.line = line; } },
  Range: class { start: { line: number }; constructor(start: { line: number }) { this.start = start; } },
  Uri: { file: (p: string) => ({ fsPath: p }) },
  env: { clipboard: { writeText: async (t: string) => { did.copied.push(t); } } },
  window: {
    createStatusBarItem: () => ({ name: '', command: '', show() {}, hide() {}, dispose() {} }),
    setStatusBarMessage: (m: string) => { did.status.push(m); return { dispose() {} }; },
    showWarningMessage: async (m: string) => { did.warn.push(m); },
    showTextDocument: async (u: { fsPath: string }, o: { selection: { start: { line: number } } }) => { did.opened.push({ path: u.fsPath, line: o.selection.start.line }); },
  },
};
const STUB = `data:text/javascript,${encodeURIComponent('const v = globalThis.accRunsVscode; export const { EventEmitter, StatusBarAlignment, Position, Range, Uri, env, window } = v; export default v;')}`;
registerHooks({ resolve: (spec, ctx, next) => (spec === 'vscode' ? { url: STUB, format: 'module', shortCircuit: true } : next(spec, ctx)) });
const { Runs } = await import('../src/runs.ts');

test('the panel draws every run as rows with renderRunRows, a review\'s Show output too, and its header line\'s clock is the review\'s own', () => {
  const dock = pageSource('dock.ts');
  assert.match(dock, /import \{ renderRunRows \} from '\.\/run-view\.ts';/);
  // One call, for a run that isn't a review and for a review showing its rows: never a block of raw lines.
  assert.equal([...dock.matchAll(/renderRunRows\(/g)].length, 1);
  assert.match(dock, /if \(open && \(!body \|\| body\.lines\)\) dock\.append\(renderRunRows\(run\)\);/);
  assert.match(dock, /clock\(Date\.now\(\) - run\.startedAt\)/, 'the review\'s clock, not a second copy');
  assert.doesNotMatch(pageSource('run-view.ts'), /function clock\(/);
  // The header's menu holds Details, Copy log and the run in a terminal.
  assert.match(dock, /moreMenu\(`dock:\$\{run\.id\}`/);
  for (const c of ['details', 'copy', 'terminal']) assert.match(dock, new RegExp(`command: '${c}'`), c);
});

const log = { info() {}, warn() {} } as unknown as ConstructorParameters<typeof Runs>[0];
const folder = (): string => {
  const dir = tempDir('acc-run-view-');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'export {};\n');
  return dir;
};
const ended = (runs: InstanceType<typeof Runs>, id: string) => until(() => runs.views().find((r) => r.id === id)?.endedAt !== null);

test('Copy log copies every line the run kept, not only the rows the panel shows, and says so', async () => {
  const runs = new Runs(log, () => {}, '/nowhere');
  try {
    const id = runs.start('for i in $(seq 1 250); do echo "line $i"; done', { cwd: folder(), label: 'Count' });
    await ended(runs, id);
    runs.control(id, 'copy');
    await until(() => did.status.length > 0);
    const copied = did.copied.at(-1)!.split('\n');
    assert.equal(copied.length, 250);
    assert.deepEqual([copied[0], copied.at(-1)], ['line 1', 'line 250']);
    assert.equal(did.status.at(-1), 'Copied the output of Count');
  } finally {
    runs.dispose();
  }
});

test('Run again starts the command once more with its label and step, in place of the ended run; edge case: a run still going isn\'t started twice', async () => {
  const runs = new Runs(log, () => {}, '/nowhere');
  try {
    const dir = folder();
    const exits: (number | null)[] = [];
    const id = runs.start('echo first; exit 3', { cwd: dir, label: 'Check it', step: 'B13.gate-tools', onExit: (c) => exits.push(c) });
    await ended(runs, id);
    runs.control(id, 'rerun');
    const views = runs.views();
    assert.equal(views.length, 1, 'the new run takes the ended one\'s place');
    const again = views[0]!;
    assert.notEqual(again.id, id);
    assert.deepEqual([again.label, again.command, again.step, again.cwd], ['Check it', 'echo first; exit 3', 'B13.gate-tools', dir]);
    await ended(runs, again.id);
    assert.deepEqual(exits, [3, 3], 'and what it does after, such as checking its step, runs again too');
    const long = runs.start('sleep 5', { cwd: dir, label: 'Wait' });
    runs.control(long, 'rerun');
    assert.equal(runs.views().filter((r) => r.label === 'Wait').length, 1);
  } finally {
    runs.dispose();
  }
});

test('a path in the output opens at its line when it\'s in the run\'s folder; edge cases: one gone, one climbing out, and a run dismissed', async () => {
  const runs = new Runs(log, () => {}, '/nowhere');
  try {
    const dir = folder();
    const id = runs.start('echo src/a.ts', { cwd: dir, label: 'List' });
    await ended(runs, id);
    await runs.openFile(id, 'src/a.ts', 12);
    assert.deepEqual(did.opened.at(-1), { path: join(dir, 'src', 'a.ts'), line: 11 });
    await runs.openFile(id, 'src/a.ts');
    assert.equal(did.opened.at(-1)!.line, 0, 'with no line, at its top');
    const opened = did.opened.length;
    await runs.openFile(id, 'src/gone.ts');
    await runs.openFile(id, '../outside.ts');
    assert.equal(did.opened.length, opened, 'neither opens');
    assert.deepEqual(did.warn.slice(-2), ['src/gone.ts isn\'t in the folder List ran in, so it doesn\'t open.', '../outside.ts isn\'t in the folder List ran in, so it doesn\'t open.']);
    runs.control(id, 'dismiss');
    await runs.openFile(id, 'src/a.ts');
    assert.equal(did.opened.length, opened, 'a run no longer in the panel opens nothing');
  } finally {
    runs.dispose();
  }
});
