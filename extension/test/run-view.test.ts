// The output panel's actions on a run (T-64), as the extension does them: Copy log copies all the output it
// kept, Run again starts it once more in the panel, and a path the output names opens when it's in the run's
// folder. Real commands run, through a shell, as the panel's do. And the page draws each run with the rows.
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { tempDir } from '../../packages/core/test/support.ts';
import { runCard } from '../src/model/runs.ts';
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

/**
 * A stand-in acc on the panel's PATH (T-65): it writes its steps to the file ACC_STEPS names, a line at a
 * time with pauses, prints a line in each step, notes where the file was, and fails at its second step.
 */
function fakeAcc(): { bin: string; where: string } {
  const bin = tempDir('acc-bin-');
  const where = join(tempDir('acc-where-'), 'where');
  const line = (e: object) => `printf '%s\\n' '${JSON.stringify({ ...e, at: 't' })}' >> "$ACC_STEPS"`;
  const step = (id: string, label: string, state: string, note?: string) => line({ kind: 'step', id, label, state, ...(note ? { note } : {}) });
  writeFileSync(join(bin, 'acc'), [
    '#!/bin/sh',
    `echo "$ACC_STEPS" > '${where}'`,
    step('branch', 'Check the branch', 'started'),
    'echo "Fetching dev"',
    'sleep 0.8',
    step('branch', 'Check the branch', 'done'),
    step('deploy', 'Deploy to Dev', 'started'),
    'echo "force-app/main/default/classes/B.cls: Invalid type: Foo"',
    'sleep 0.8',
    step('deploy', 'Deploy to Dev', 'failed', 'B: Invalid type: Foo. Run acc gate run first.'),
    line({ kind: 'result', ok: false, sentence: 'The deploy to Dev failed.' }),
    'exit 1',
  ].join('\n') + '\n');
  chmodSync(join(bin, 'acc'), 0o755);
  return { bin, where };
}

test('a run of acc gets a steps file of its own: its steps reach the card as the file grows, a failed one with its rows, and the folder is gone once it ends (T-65)', async () => {
  const fake = fakeAcc();
  const runs = new Runs(log, () => {}, fake.bin);
  const card = (id: string) => runCard(runs.views().find((r) => r.id === id)!);
  try {
    const id = runs.start('acc deploy dev', { cwd: folder(), label: 'Deploy Dev' });
    assert.equal(card(id).steps, null, 'no list yet, before the first step arrives');
    await until(() => card(id).steps?.length === 1, 20_000, 'the first step');
    assert.deepEqual(card(id).steps!.map((s) => [s.label, s.look.label]), [['Check the branch', 'Running']]);
    await until(() => card(id).steps?.length === 2, 20_000, 'the second step');
    assert.deepEqual(card(id).steps!.map((s) => s.look.label), ['Done', 'Running']);
    assert.equal(card(id).result, null, 'no result card while it runs');
    await ended(runs, id);
    const c = card(id);
    assert.deepEqual(c.steps!.map((s) => [s.label, s.look.label]), [['Check the branch', 'Done'], ['Deploy to Dev', 'Failed']]);
    // acc's words reach the person as processes (D-132), and the failed step opens to its own rows only.
    assert.equal(c.steps![1]!.note, 'B: Invalid type: Foo. Run the checks first.');
    assert.deepEqual(c.steps![1]!.rows.map((r) => r.text), ['force-app/main/default/classes/B.cls: Invalid type: Foo']);
    assert.deepEqual(c.steps![0]!.rows, []);
    assert.equal(c.lineCount, 2);
    assert.equal(c.result?.look.label, 'Failed');
    assert.match(c.result!.sentence, /^The deploy to Dev failed\. It took (\d+ s|under a second)\.$/);
    const file = readFileSync(fake.where, 'utf8').trim();
    assert.match(file, /acc-steps-[^/]+\/steps\.jsonl$/);
    assert.equal(existsSync(dirname(file)), false, 'its folder is gone once it ended');
  } finally {
    runs.dispose();
  }
});

test('a command that isn\'t acc gets no steps file: no ACC_STEPS, and no list of steps on its card (T-65)', async () => {
  const runs = new Runs(log, () => {}, '/nowhere');
  try {
    const id = runs.start('echo "steps:[$ACC_STEPS]"', { cwd: folder(), label: 'Echo' });
    await ended(runs, id);
    const c = runCard(runs.views().find((r) => r.id === id)!);
    assert.equal(c.steps, null);
    assert.deepEqual(c.rows.map((r) => r.text), ['steps:[]']);
  } finally {
    runs.dispose();
  }
});

test('a run with an answer, as a dispatch from the Command Center is: its stdout is handed over once it ends, never shown as rows; its stderr still is (T-65)', async () => {
  const runs = new Runs(log, () => {}, '/nowhere');
  try {
    const got: { stdout: string; code: number | null }[] = [];
    const order: string[] = [];
    const id = runs.start('echo \'{"held":false}\'; echo "a warning" >&2; exit 0', {
      cwd: folder(), label: 'Dispatch T-1',
      answer: (stdout, code) => { got.push({ stdout, code }); order.push('answer'); },
      onExit: () => order.push('exit'),
    });
    await ended(runs, id);
    assert.deepEqual(got, [{ stdout: '{"held":false}\n', code: 0 }]);
    assert.deepEqual(order, ['answer', 'exit'], 'the answer comes before onExit');
    assert.deepEqual(runCard(runs.views().find((r) => r.id === id)!).rows.map((r) => r.text), ['a warning']);
  } finally {
    runs.dispose();
  }
});
