// A run's output as rows (T-64): the pure row function, its parts, an exit code in words, and the run's card,
// which carries the rows, how long it took and its result card, for the output panel.
import assert from 'node:assert/strict';
import test from 'node:test';
import { exitWords, FOLD_AT, foldRows, inFolder, MAX_ROWS, partsOf, ROW_KINDS, runRows } from '../src/logic/run-rows.ts';
import { CONTROL } from '../src/logic/runs.ts';
import { RESULT_LOOK, ROW_LOOK, runResult, shownRows, tookWords } from '../src/model/run-view.ts';
import { area, RUN_CONTROLS, runCard, type RunInput } from '../src/model/runs.ts';

const ROOT = '/Users/me/code/acme';
const kinds = (lines: string[]) => runRows(lines, ROOT).rows.map((r) => [r.kind, r.text]);

test('each kind of line: a success, a warning, an error, a count of progress, and a note', () => {
  assert.deepEqual(kinds(['✓ Preparing the deploy', 'Deploy succeeded.', 'All 12 tests passed', 'npm WARN deprecated glob@7.2.3', 'Warning: no test covers it.', 'npm ERR! code ERESOLVE', 'Error: the org refused it', 'fatal: not a git repository', 'Deploying components 14/40', '45% done', 'Opening the browser to log in…']), [
    ['success', 'Preparing the deploy'],
    ['success', 'Deploy succeeded.'],
    ['success', 'All 12 tests passed'],
    ['warning', 'deprecated glob@7.2.3'],
    ['warning', 'no test covers it.'],
    ['error', 'code ERESOLVE'],
    ['error', 'the org refused it'],
    ['error', 'not a git repository'],
    ['progress', 'Deploying components 14/40'],
    ['progress', '45% done'],
    ['note', 'Opening the browser to log in…'],
  ]);
  assert.deepEqual(ROW_KINDS, ['success', 'warning', 'error', 'progress', 'note']);
});

test('edge cases of a kind: a count of nothing gone wrong is no failure, a count at its end that worked is a success, and one that counts past its end is a note', () => {
  assert.deepEqual(kinds(['Tests: 12 passed, 0 failed', 'Finished with no errors', 'Ran 3/3 tests, all passed', 'Step 5/3', '120% of last time']), [
    ['success', 'Tests: 12 passed, 0 failed'],
    ['success', 'Finished with no errors'],
    ['success', 'Ran 3/3 tests, all passed'],
    ['note', 'Step 5/3'],
    ['note', '120% of last time'],
  ]);
  const p = runRows(['Deploying 3/10', '45% done'], ROOT).rows.map((r) => r.progress);
  assert.deepEqual(p, [{ done: 0.3, label: '3/10' }, { done: 0.45, label: '45%' }]);
  assert.equal(runRows(['Done'], ROOT).rows[0]!.progress, null, 'a row that counts nothing has no progress');
  // A line that's only the level word keeps it, so no row is empty.
  assert.deepEqual(kinds(['Error:']), [['error', 'Error:']]);
});

test('a URL is a link: its closing full stop or bracket stays words', () => {
  assert.deepEqual(partsOf('See https://acme.example/deploy/42. Then (https://acme.example/b) too', ROOT), [
    { text: 'See ' }, { url: 'https://acme.example/deploy/42' }, { text: '. Then (' }, { url: 'https://acme.example/b' }, { text: ') too' },
  ]);
});

test('a path in the run\'s folder opens, relative to it, with its line; one outside it, in a home folder, or with no folder, doesn\'t', () => {
  assert.deepEqual(partsOf('Wrote force-app/classes/A.cls:12 and /Users/me/code/acme/src/b.ts and /tmp/c.log.', ROOT), [
    { text: 'Wrote ' }, { path: 'force-app/classes/A.cls', line: 12, opens: 'force-app/classes/A.cls' },
    { text: ' and ' }, { path: '/Users/me/code/acme/src/b.ts', line: null, opens: 'src/b.ts' },
    { text: ' and ' }, { path: '/tmp/c.log', line: null, opens: null }, { text: '.' },
  ]);
  assert.equal(inFolder('../other/x.ts', ROOT), null, 'climbing out of the folder');
  assert.equal(inFolder('src/../../x.ts', ROOT), null, 'climbing out part way along');
  assert.equal(inFolder('~/notes/x.md', ROOT), null, 'a home folder');
  assert.equal(inFolder('/Users/me/code/acme-other/x.ts', ROOT), null, 'a folder whose name starts the same');
  assert.equal(inFolder('src/x.ts', null), null, 'no folder to read it against');
  assert.equal(inFolder('./src/x.ts', `${ROOT}/`), 'src/x.ts');
  // What isn't a path: a package and its version, a fraction, and a word with a slash.
  assert.deepEqual(partsOf('peer eslint@"^8" from @salesforce/eslint-config-lwc@3.6.0, 1/2.5 and/or', ROOT), [{ text: 'peer eslint@"^8" from @salesforce/eslint-config-lwc@3.6.0, 1/2.5 and/or' }]);
});

test('repeated lines: a spinner\'s line is one row with a count, a count of progress is one row at its latest, and a line that comes back later is a new row', () => {
  const { rows } = runRows(['⠋ Waiting for the org', '⠙ Waiting for the org', '⠹ Waiting for the org', 'Deploying 3/10', 'Deploying 4/10', 'Deploying 5/10', 'Done', 'Done', '⠋ Waiting for the org'], ROOT);
  assert.deepEqual(rows.map((r) => [r.kind, r.text, r.count]), [
    ['note', 'Waiting for the org', 3], ['progress', 'Deploying 5/10', 1], ['success', 'Done', 2], ['note', 'Waiting for the org', 1],
  ]);
  assert.deepEqual(rows[1]!.progress, { done: 0.5, label: '5/10' });
});

test('edge case: escape codes for colour are dropped, from the words and before the kind is read', () => {
  const { rows } = runRows(['\x1b[32m✓\x1b[39m \x1b[1mDeployed\x1b[22m', '\x1b[31mnpm ERR!\x1b[0m code E404', '\x1b]8;;https://x.example\x07link\x1b]8;;\x07'], ROOT);
  assert.deepEqual(rows.map((r) => [r.kind, r.text]), [['success', 'Deployed'], ['error', 'code E404'], ['note', 'link']]);
  assert.ok(rows.every((r) => !CONTROL.test(r.text) && !r.text.includes('\x1b')));
});

test('edge case: an empty output, and one of only blank lines, are no rows', () => {
  assert.deepEqual(runRows([], ROOT), { rows: [], hidden: 0 });
  assert.deepEqual(runRows(['', '   ', '\t', '\x1b[0m'], ROOT), { rows: [], hidden: 0 });
});

test('edge case: more than 200 rows keeps the last 200, and counts the rest', () => {
  const lines = Array.from({ length: 250 }, (_, i) => `Deployed class ${i + 1}`);
  const { rows, hidden } = runRows(lines, ROOT);
  assert.equal(MAX_ROWS, 200);
  assert.equal(rows.length, 200);
  assert.equal(hidden, 50);
  assert.deepEqual([rows[0]!.text, rows.at(-1)!.text], ['Deployed class 51', 'Deployed class 250'], 'the newest last');
  // Counted as rows, not lines: repeats and blanks don't count.
  assert.equal(runRows([...lines, ...lines.map(() => '')], ROOT, 300).hidden, 0);
  assert.deepEqual(runRows(['a', 'b', 'c'], ROOT, 2), { rows: runRows(['b', 'c'], ROOT).rows, hidden: 1 });
});

test('an exit code in words: the common ones say what they mean, any other its number, and none says something stopped it', () => {
  assert.equal(exitWords(1), 'It reported an error (exit code 1).');
  assert.equal(exitWords(127), 'Its command wasn\'t found (exit code 127).');
  assert.equal(exitWords(137), 'It was killed, which often means it ran out of memory (exit code 137).');
  assert.equal(exitWords(42), 'It ended with an error (exit code 42).');
  assert.equal(exitWords(null), 'It ended without an exit code, so something stopped it from outside.');
});

test('how long it took, in words, from under a second to hours', () => {
  assert.deepEqual([0, 900, 4000, 59_999, 60_000, 125_000, 3_600_000 + 5 * 60_000].map(tookWords), ['under a second', 'under a second', '4 s', '59 s', '1 min', '2 min 5 s', '1 h 5 min']);
  assert.equal(tookWords(-5), 'under a second', 'edge case: a clock that went back');
});

const run = (o: Partial<RunInput> = {}): RunInput => ({ id: 'r1', label: 'Deploy to Dev', command: 'sf project deploy start', startedAt: 0, endedAt: 41_000, code: 0, stopped: false, lines: [], prompt: null, step: null, cwd: ROOT, ...o });
const rowsOf = (lines: string[]) => shownRows(runRows(lines, ROOT).rows);

test('the result card: done with its time and warnings, failed with its last error and exit code in words, and stopped', () => {
  const done = runResult(run(), rowsOf(['npm WARN a', 'npm WARN a', 'Warning: b', 'Done']))!;
  assert.deepEqual([done.look, done.sentence, done.error, done.exit], [RESULT_LOOK.done, 'It finished in 41 s, with 3 warnings.', null, null]);
  assert.equal(runResult(run(), rowsOf(['Done']))!.sentence, 'It finished in 41 s.');
  const failed = runResult(run({ code: 1 }), rowsOf(['Error: first', 'Error: last', 'Cleaning up']))!;
  assert.deepEqual([failed.look, failed.sentence, failed.error?.text, failed.error?.look, failed.exit], [RESULT_LOOK.failed, 'It failed after 41 s.', 'last', ROW_LOOK.error, 'It reported an error (exit code 1).']);
  const stopped = runResult(run({ stopped: true, code: null }), [])!;
  assert.deepEqual([stopped.look, stopped.sentence, stopped.exit], [RESULT_LOOK.stopped, 'It was stopped after 41 s.', null]);
  // A run's own judge says done, as an analysis with questions does (D-052).
  assert.equal(runResult(run({ code: 1, ok: true }), [])!.look, RESULT_LOOK.done);
});

test('edge cases of the result card: none while it runs, a failure that printed no error, and the next step for a step, a run, and autopilot', () => {
  assert.equal(runResult(run({ endedAt: null, code: null }), []), null);
  assert.equal(runResult(run({ code: 2 }), rowsOf(['nothing wrong said']))!.error, null);
  assert.deepEqual(runResult(run(), [])!.next, { kind: 'rerun', label: 'Run again', icon: 'debug-restart' });
  assert.deepEqual(runResult(run({ step: 'B13.gate-tools', code: 1 }), [])!.next, { kind: 'step', label: 'Open the step', icon: 'list-selection', step: 'B13.gate-tools' });
  assert.equal(runResult(run({ background: true }), [])!.next, null, 'autopilot is started by its own switch');
});

test('a run\'s card carries its rows with their looks, the count not shown, how long it took, its result and its folder', () => {
  const lines = ['\x1b[32m✓\x1b[39m Preparing', ...Array.from({ length: 205 }, (_, i) => `Deployed ${i}`), 'Error: the org refused it'];
  const card = runCard(run({ code: 1, lines }));
  assert.equal(card.rows.length, 200);
  assert.equal(card.hidden, 7);
  assert.deepEqual(card.rows.at(-1)!.look, ROW_LOOK.error);
  assert.deepEqual([card.look, card.took, card.cwd, card.result?.error?.text], [RESULT_LOOK.failed, '41 s', ROOT, 'the org refused it']);
  assert.equal(card.lines.length, lines.length, 'History still gets its lines');
});

test('edge cases of the card: while it runs it has no time or result, the question it waits on isn\'t its last row too, and a review has no result card', () => {
  const asking = runCard(run({ endedAt: null, code: null, lines: ['Opening', 'Replace it? (y/n) '], prompt: { kind: 'yesno', text: 'Replace it? (y/n)' } }));
  assert.deepEqual([asking.took, asking.result, asking.rows.map((r) => r.text)], [null, null, ['Opening']]);
  assert.equal(asking.look.label, 'Waiting for you');
  // Once answered, the line is a row again.
  assert.deepEqual(runCard(run({ endedAt: null, code: null, lines: ['Opening', 'Replace it? (y/n) y'] })).rows.map((r) => r.text), ['Opening', 'Replace it? (y/n) y']);
  const review = runCard(run({ review: { project: ROOT, task: 'T-1', sha: null } }));
  assert.equal(review.result, null, 'a review says how it went');
  assert.deepEqual(runCard(run({ cwd: undefined, lines: ['Wrote src/a.ts'] })).rows[0]!.parts[1], { path: 'src/a.ts', line: null, opens: null }, 'a run with no folder opens no path');
});

test('the page may ask to copy a run\'s log, run it again, or open a path in its folder, and nothing outside it', () => {
  assert.deepEqual(RUN_CONTROLS, ['stop', 'terminal', 'dismiss', 'copy', 'rerun']);
  const control = area.messages!['run-control']!;
  assert.ok(control({ run: 'r1', action: 'copy' }) && control({ run: 'r1', action: 'rerun' }));
  assert.ok(!control({ run: 'r1', action: 'delete' }));
  const file = area.messages!['run-file']!;
  assert.ok(file({ run: 'r1', file: 'src/a.ts' }));
  assert.ok(file({ run: 'r1', file: 'src/a.ts', line: 12 }));
  for (const bad of [{ file: '/etc/passwd' }, { file: '../x.ts' }, { file: 'src/../../x.ts' }, { file: '' }, { file: 'a.ts', line: 0 }, { file: 'a.ts', line: 1.5 }, { file: 'a.ts', line: '3' }]) {
    assert.ok(!file({ run: 'r1', ...bad }), JSON.stringify(bad));
  }
});

test('like rows in a row fold into one that lists them: four "Deployed <file>" are "Deployed 4 files"; three, or mixed words, stay (T-64 merge)', () => {
  const root = '/r';
  const deployed = (n: number) => Array.from({ length: n }, (_, i) => `✓ Deployed force-app/main/default/classes/S${i}.cls`);
  assert.equal(FOLD_AT, 4);
  const four = runRows(['Deploying…', ...deployed(4), 'Deploy succeeded.'], root).rows;
  assert.deepEqual(four.map((r) => r.text), ['Deploying…', 'Deployed 4 files', 'Deploy succeeded.']);
  assert.equal(four[1]!.kind, 'success');
  assert.deepEqual(four[1]!.group!.map((r) => r.parts.find((p) => 'path' in p)), deployed(4).map((_, i) => ({ path: `force-app/main/default/classes/S${i}.cls`, line: null, opens: `force-app/main/default/classes/S${i}.cls` })));
  assert.equal(runRows(deployed(3), root).rows.length, 3, 'three stay three');
  const mixed = runRows([...deployed(2), '✓ Retrieved force-app/a.cls', ...deployed(2)], root).rows;
  assert.equal(mixed.length, 5, 'other words break the run');
  assert.deepEqual(foldRows([]), [], 'edge case: none');
  // The hidden count is of the rows shown, folded ones counted once.
  assert.equal(runRows([...deployed(300)], root, 200).hidden, 0, 'three hundred like rows are one row');
});

test('once a run has ended, a count of progress spins no more: at its end it is done, short of it a note (T-64 merge)', () => {
  const [row] = runRows(['Deploying components 236/236'], '/r').rows;
  const [half] = runRows(['Deploying components 118/236'], '/r').rows;
  assert.equal(shownRows([row!], true)[0]!.look, ROW_LOOK.progress, 'running: it spins');
  assert.equal(shownRows([row!], false)[0]!.look, ROW_LOOK.success, 'ended at 236/236: done');
  assert.equal(shownRows([half!], false)[0]!.look, ROW_LOOK.note, 'ended at half: a note, not a spinner');
});

test('a run that runs once, such as a dispatch with its Watch to follow, offers no Run again; another does (T-65 review)', () => {
  const ended = { endedAt: 2000, startedAt: 0, code: 0, stopped: false, step: null };
  assert.equal(runResult(ended, [])!.next?.kind, 'rerun');
  assert.equal(runResult({ ...ended, once: true }, [])!.next, null);
});
