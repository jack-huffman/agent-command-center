// The screenshots gate (T-5): a branch that changes what the pages draw from passes only with every
// usual shot taken of this commit's code, with no geometry findings, still on disk as taken, and with
// every class it adds drawn on screen in one of them.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tempDir } from '../../packages/core/test/support.ts';
import { addedClasses, cssClasses, judgeShots, UI_PATHS, uiChanges, UNDRAWN } from '../scripts/looked.ts';
import { expectedShots, fingerprint, noteShots, PAGES, readShots, SHOTS_FILE, type ShotNote, type ShotsRecord, webviewSource, WIDTHS } from '../scripts/screenshot.ts';
import { PALETTE_THEMES } from '../scripts/styles.ts';
import { COLLECT_GEOMETRY } from '../scripts/geometry.ts';

const PRINT = 'f'.repeat(64);
const EXPECTED = ['overview-dark-1000.png', 'overview-light-1000.png'];
const note = (over: Partial<ShotNote> = {}): ShotNote => ({ fingerprint: PRINT, sha256: 'a1', takenAt: '2026-10-10T00:00:00.000Z', findings: 0, drawn: ['row', 'aq-error'], ...over });
const record = (shots: Record<string, ShotNote>): ShotsRecord => ({ schema: 1, shots });
const all = (over: Partial<ShotNote> = {}): ShotsRecord => record(Object.fromEntries(EXPECTED.map((f) => [f, note(over)])));
const judge = (over: Partial<Parameters<typeof judgeShots>[0]> = {}) => judgeShots({ changed: ['extension/webview/main.ts'], record: all(), print: PRINT, expected: EXPECTED, hash: () => 'a1', added: [], undrawn: [], ...over });

test('a branch whose pages were shot as they are now passes, counting the shots and classes it checked', () => {
  const r = judge({ added: ['aq-error'] });
  assert.equal(r.passed, true, r.lines.join('\n'));
  assert.match(r.lines[0]!, /^Checked 2 shots of this commit's pages, each with no geometry findings, and 1 class new on this branch, each drawn\. 1 changed file/);
});

test('a branch that changed no files fails: it checked nothing', () => {
  const r = judge({ changed: [] });
  assert.deepEqual([r.passed, r.lines], [false, ['The branch changed no files, so there was nothing to check.']]);
});

test('a branch that changed nothing the pages draw from passes without screenshots, saying how many files it checked', () => {
  const r = judge({ changed: ['packages/core/src/gates.ts', 'docs/DESIGN.md'], record: record({}) });
  assert.equal(r.passed, true);
  assert.match(r.lines[0]!, /^Checked 2 changed files: none is one the pages draw from/);
  assert.deepEqual(uiChanges(['extension/src/sidebar.ts', 'extension/scripts/fixtures/tasks.ts', 'extension/webview/styles.css', 'extension/test/page.test.ts', 'extension/package.json']), ['extension/src/sidebar.ts', 'extension/scripts/fixtures/tasks.ts', 'extension/webview/styles.css']);
  assert.deepEqual([...UI_PATHS], ['extension/webview/', 'extension/src/', 'extension/scripts/']);
});

test('no screenshots taken yet fails, naming a file the pages draw from and how to take them', () => {
  const r = judge({ record: record({}), changed: ['extension/scripts/fixtures/setup.ts'] });
  assert.equal(r.passed, false);
  assert.match(r.lines[0]!, /^No screenshots of this branch's pages were taken here, and it changed 1 file they draw from, such as extension\/scripts\/fixtures\/setup\.ts\. Run npm run build, then npm run screenshot/);
});

test('shots taken of other code than this commit\'s are stale and fail (GH-41, GH-83)', () => {
  const r = judge({ record: record({ [EXPECTED[0]!]: note(), [EXPECTED[1]!]: note({ fingerprint: 'old' }) }) });
  assert.equal(r.passed, false);
  assert.deepEqual(r.lines.map((l) => l.split(':')[0]), ['1 shot was taken of other code than this commit\'s']);
  assert.match(r.lines[0]!, /overview-light-1000\.png/);
});

test('a usual shot that wasn\'t taken fails, as when only some pages or one theme were shot (GH-95)', () => {
  const r = judge({ record: record({ [EXPECTED[0]!]: note() }) });
  assert.equal(r.passed, false);
  assert.match(r.lines[0]!, /^1 of the 2 usual shots weren't taken: overview-light-1000\.png\./);
});

test('a shot with geometry findings fails, with how many', () => {
  const r = judge({ record: all({ findings: 3 }) });
  assert.equal(r.passed, false);
  assert.match(r.lines[0]!, /^2 shots had geometry findings: overview-dark-1000\.png \(3\), overview-light-1000\.png \(3\)\./);
});

test('a PNG that is gone or changed since the run took it fails', () => {
  const r = judge({ hash: (f) => (f === EXPECTED[0] ? null : 'b2') });
  assert.equal(r.passed, false);
  assert.match(r.lines[0]!, /^2 PNGs are gone or changed since the screenshot run took them/);
});

test('a class the branch adds that no shot draws on screen fails, and UNDRAWN can excuse it by name (GH-32, GH-52, GH-76)', () => {
  const r = judge({ added: ['aq-error', 'pg-model'] });
  assert.equal(r.passed, false);
  assert.match(r.lines[0]!, /^1 class new on this branch isn't drawn on screen in any shot: \.pg-model\./);
  // Drawn only in a stale shot doesn't count.
  const stale = judge({ added: ['pg-model'], record: record({ [EXPECTED[0]!]: note(), [EXPECTED[1]!]: note({ fingerprint: 'old', drawn: ['pg-model'] }) }) });
  assert.ok(stale.lines.some((l) => /isn't drawn on screen in any shot: \.pg-model/.test(l)), stale.lines.join('\n'));
  const excused = judge({ added: ['pg-model'], undrawn: [{ name: 'pg-model' }] });
  assert.equal(excused.passed, true);
  assert.match(excused.lines[0]!, /each drawn or named in UNDRAWN\./);
});

test('no usual shots to expect fails rather than pass having checked none', () => {
  const r = judge({ expected: [] });
  assert.equal(r.passed, false);
});

test('UNDRAWN names only classes the stylesheets hold, each with why', () => {
  const held = new Set(webviewSource().filter(([f]) => f.endsWith('.css')).flatMap(([, b]) => [...cssClasses(b.toString())]));
  assert.ok(held.size > 100, `read ${held.size} classes from the stylesheets`);
  for (const u of UNDRAWN) {
    assert.ok(held.has(u.name), `.${u.name} is in UNDRAWN but no stylesheet has it: take it off`);
    assert.ok(u.reason.trim(), `.${u.name} needs a reason`);
  }
});

test('cssClasses reads selectors only: not declarations, comments, strings or numbers', () => {
  const css = '/* .gone */ .a, :is(.b, .md) code { background: url(x.svg); } @media (max-width: 600.5px) { .c:not(.d)::before { content: ".e"; } } .f { color: red; &.g { x: 1; } }';
  assert.deepEqual([...cssClasses(css)].sort(), ['a', 'b', 'c', 'd', 'f', 'g', 'md']);
  assert.deepEqual([...cssClasses('')], [], 'an empty stylesheet has none');
  assert.deepEqual(addedClasses(['.a {} .b {}', '.c {}'], ['.a {}', '.c {} .gone {}']), ['b'], 'a class only moved between stylesheets, or removed, isn\'t new');
});

test('the usual shots are every page in each theme at each width', () => {
  const shots = expectedShots();
  assert.equal(shots.length, PAGES.length * PALETTE_THEMES.length * WIDTHS.length);
  assert.ok(shots.includes('overview-dark-500.png') && shots.includes(`${PAGES.at(-1)}-light-1000.png`));
});

test('the fingerprint is the same for the same code, and changes when one byte of the page\'s source does', () => {
  const source = webviewSource();
  const a = fingerprint(source);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(fingerprint(source), a, 'two looks at the same code agree, whatever the clock says');
  const [name, body] = source[0]!;
  assert.notEqual(fingerprint([[name, Buffer.concat([body, Buffer.from(' ')])], ...source.slice(1)]), a);
  assert.notEqual(fingerprint(source.slice(1)), a, 'a file taken away changes it too');
});

test('the page measures the classes drawn inside the window, which the shot holds', () => {
  assert.match(COLLECT_GEOMETRY, /r\.top >= vh/);
  assert.match(COLLECT_GEOMETRY, /drawn: \[\.\.\.drawn\]/);
});

test('noteShots keeps earlier notes of other files, replaces a file\'s own, and an unreadable record starts empty', () => {
  const dir = tempDir();
  assert.deepEqual(readShots(dir), { schema: 1, shots: {} }, 'none yet');
  noteShots(dir, { 'b.png': note(), 'a.png': note() });
  noteShots(dir, { 'b.png': note({ sha256: 'c3' }) });
  noteShots(dir, {});
  const r = readShots(dir);
  assert.deepEqual(Object.keys(r.shots), ['a.png', 'b.png']);
  assert.equal(r.shots['b.png']!.sha256, 'c3');
  assert.ok(!readFileSync(join(dir, SHOTS_FILE), 'utf8').includes('.tmp'));
  writeFileSync(join(dir, SHOTS_FILE), '{ broken');
  assert.deepEqual(readShots(dir), { schema: 1, shots: {} }, 'unreadable');
});

test('run by hand without ACC_CHANGED, the gate fails rather than pass having checked nothing', () => {
  const { ACC_CHANGED: _gone, ...env } = process.env;
  const r = spawnSync(process.execPath, ['--no-warnings', join(import.meta.dirname, '..', 'scripts', 'looked.ts')], { encoding: 'utf8', env });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ACC_CHANGED isn't set/);
});
