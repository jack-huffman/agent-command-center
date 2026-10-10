// docs/ROADMAP.md is a dated, honest status (GH-171): each status line has a status, the date it was checked
// and its evidence, every decision and release it names exists, and no date is in the future. The check
// counts the lines it read and fails on none. The fixtures show it fails for each fault, so it isn't a
// check that passes whatever it's given.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkRoadmap, statusLines } from '../roadmap.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const TODAY = '2026-10-10';
const DECISIONS = '## D-001 One (2026-10-01)\n\n## D-012 Two (2026-10-01)\n';
const CHANGELOG = '# Changelog\n\n## 0.39.0\n\n- a\n\n## 0.38.0\n\n- b\n';
const run = (roadmap: string, today = TODAY) => checkRoadmap(roadmap, DECISIONS, CHANGELOG, today);
const GOOD = '- **M1 Core**: done. Checked 2026-10-09. Evidence: D-012, GH-5, 0.39.0.\n';

test('ROADMAP.md: every status line has a status, a date and evidence, and names only decisions and releases that exist', () => {
  const today = new Date().toISOString().slice(0, 10);
  const got = checkRoadmap(read('docs/ROADMAP.md'), read('docs/DECISIONS.md'), read('CHANGELOG.md'), today);
  assert.ok(got.checked >= 10, `only ${got.checked} status lines were read: the check should see the roadmap's milestones and later items`);
  assert.deepEqual(got.problems, []);
});

test('ROADMAP.md says what is left and who it waits on: the pilot, the first run and the cloud run each wait on a person', () => {
  const lines = statusLines(read('docs/ROADMAP.md'));
  const waiting = lines.filter((l) => /^\*\*.+?\*\*: waiting on a person\./.test(l)).join('\n');
  for (const want of ['M8 Pilots', 'GH-88', 'GH-69']) assert.ok(waiting.includes(want), `${want} should be a status line that waits on a person`);
});

test('the README links to the roadmap where it says what is next', () => {
  const readme = read('README.md');
  const at = readme.indexOf('- **Next:**');
  assert.ok(at >= 0, 'the README should say what is next');
  // The bullet runs to the next blank line.
  const bullet = readme.slice(at).split('\n\n')[0] ?? '';
  assert.match(bullet, /\(docs\/ROADMAP\.md\)/);
});

test('a roadmap with no status lines counts zero, which the real check above refuses, so a check that read nothing never passes', () => {
  const got = run('# Roadmap\n\nProse only, and a bullet:\n\n- not a status line\n');
  assert.equal(got.checked, 0);
  assert.deepEqual(got.problems, []);
  assert.equal(run('').checked, 0);
  assert.equal(run(GOOD).checked, 1);
});

test('a good line passes, and one wrapped over indented lines is read whole', () => {
  assert.deepEqual(run(GOOD).problems, []);
  const wrapped = '- **M1 Core**: done. Checked 2026-10-09.\n  Evidence: D-012,\n  0.38.0.\n- **Later**: not started. Checked 2026-10-09. Evidence: D-001.\n';
  const got = run(wrapped);
  assert.equal(got.checked, 2);
  assert.deepEqual(got.problems, []);
});

test('a status line with no date fails', () => {
  const got = run('- **M1 Core**: done. Evidence: D-012.\n');
  assert.equal(got.problems.length, 1);
  assert.match(got.problems[0] ?? '', /"M1 Core" has no "Checked yyyy-mm-dd" date/);
});

test('a status line with no evidence, or evidence that names nothing, fails', () => {
  assert.match(run('- **M1 Core**: done. Checked 2026-10-09.\n').problems.join('\n'), /no D-, GH- or release reference/);
  assert.match(run('- **M1 Core**: done. Checked 2026-10-09. Evidence: it works.\n').problems.join('\n'), /no D-, GH- or release reference/);
  // A reference before "Evidence:" is a claim in prose, not the evidence.
  assert.match(run('- **M1 Core**: done, see D-012. Checked 2026-10-09. Evidence: none.\n').problems.join('\n'), /no D-, GH- or release reference/);
});

test('a status line with no status, or one that is not of the four, fails', () => {
  assert.match(run('- **M1 Core**: Checked 2026-10-09. Evidence: D-012.\n').problems.join('\n'), /has no status/);
  assert.match(run('- **M1 Core**: in review. Checked 2026-10-09. Evidence: D-012.\n').problems.join('\n'), /has no status/);
  for (const status of ['done', 'under way', 'waiting on a person', 'not started']) {
    assert.deepEqual(run(`- **X**: ${status}. Checked 2026-10-09. Evidence: D-012.\n`).problems, [], status);
  }
});

test('a decision that DECISIONS.md does not have fails, and so does a release the CHANGELOG does not have', () => {
  assert.match(run('- **M1 Core**: done. Checked 2026-10-09. Evidence: D-012, D-999.\n').problems.join('\n'), /names D-999, which DECISIONS\.md doesn't have/);
  assert.match(run('- **M1 Core**: done. Checked 2026-10-09. Evidence: D-012, 9.9.9.\n').problems.join('\n'), /names release 9\.9\.9, which the CHANGELOG doesn't have/);
  // A decision named in the line's prose is checked too, not only the evidence.
  assert.match(run('- **M1 Core**: done. Checked 2026-10-09. Evidence: D-012. D-998 came first.\n').problems.join('\n'), /D-998/);
});

test('a date in the future fails, and a date that is not a day fails', () => {
  assert.match(run('- **M1 Core**: done. Checked 2026-10-11. Evidence: D-012.\n').problems.join('\n'), /date in the future: 2026-10-11/);
  assert.deepEqual(run('- **M1 Core**: done. Checked 2026-10-10. Evidence: D-012.\n').problems, []);
  assert.match(run('- **M1 Core**: done. Checked 2026-02-30. Evidence: D-012.\n').problems.join('\n'), /isn't a day: 2026-02-30/);
  // A later date elsewhere in the line counts as well as the Checked one.
  assert.match(run('- **M1 Core**: done. Checked 2026-10-09. Evidence: D-012, due 2027-01-01.\n').problems.join('\n'), /future: 2027-01-01/);
});

test('a bullet without a bold name, and prose after a bullet, are not joined onto a status line', () => {
  const md = `${GOOD}\nA paragraph with D-999 in it.\n\n- a plain bullet\n  with an indented second line naming 7.7.7\n`;
  const got = run(md);
  assert.equal(got.checked, 1);
  assert.deepEqual(got.problems, []);
});
