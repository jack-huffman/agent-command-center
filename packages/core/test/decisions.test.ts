// Decisions one file each (T-102): names read, the index made from the folder, and a branch's new decisions
// numbered at its merge, with the number written over D-<task> in the branch's own lines and nowhere else.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  decisionHeading, decisionId, decisionsIndex, decisionsIndexFor, DECISIONS_HEADER, decisionSlug, decisionsToNumber, numberDecisions, numberedWords, parseDecisionName,
  readDecisions, writeDecisionsIndex, DECISIONS_DIR, DECISIONS_INDEX,
} from '../src/decisions.ts';
import { run } from '../src/exec.ts';
import { gitIn, makeRepo } from './support.ts';

const D1 = '## D-001 Sums (2026-10-01)\n\nsum adds.\n';
const commitIn = (dir: string) => (...args: string[]) => run('git', args, { cwd: dir });
const write = (dir: string, files: Record<string, string>) => {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  }
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'change');
};
const repo = () => {
  const dir = makeRepo({ [`${DECISIONS_DIR}/D-001-sums.md`]: D1, 'docs/notes.md': 'An old line about D-T-5, which the branch never touched.\n' });
  writeDecisionsIndex(dir);
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'index');
  return dir;
};

test('a decision file\'s name says its number, or the task that added it; anything else isn\'t a decision', () => {
  assert.deepEqual(parseDecisionName('D-045-plain-words.md'), { file: 'D-045-plain-words.md', number: 45, task: null, slug: 'plain-words' });
  assert.deepEqual(parseDecisionName('new-T-97-plans.md'), { file: 'new-T-97-plans.md', number: null, task: 'T-97', slug: 'plans' });
  assert.deepEqual(parseDecisionName('new-ACME-16-x.md')?.task, 'ACME-16');
  for (const other of ['README.md', 'D-45-x.md', 'new-t-97-x.md', 'D-045.md', 'new-T-97-.md']) assert.equal(parseDecisionName(other), null, other);
  assert.deepEqual([decisionId(7), decisionId(196), decisionId(1000)], ['D-007', 'D-196', 'D-1000']);
});

test('a slug is the title\'s words in lower case, cut at a word under 60 characters, and never empty', () => {
  assert.equal(decisionSlug('GitHub Issues and Jira first; monday.com later'), 'github-issues-and-jira-first-monday-com-later');
  assert.ok(decisionSlug('word '.repeat(40)).length <= 60);
  assert.equal(decisionSlug('!!!'), 'decision', 'an edge case: a title with no letters');
});

test('a heading gives the id, the title and the date; a heading with no date still reads', () => {
  assert.deepEqual(decisionHeading(D1), { id: 'D-001', title: 'Sums', date: '2026-10-01' });
  assert.deepEqual(decisionHeading('## D-T-102 Merges (2026-10-22)\n'), { id: 'D-T-102', title: 'Merges', date: '2026-10-22' });
  assert.deepEqual(decisionHeading('## D-002 Undated\n'), { id: 'D-002', title: 'Undated', date: null });
  assert.equal(decisionHeading('# Not one\n'), null);
});

test('the index lists each numbered decision by number, links its file, and leaves new ones out until they are numbered', () => {
  const dir = repo();
  write(dir, { [`${DECISIONS_DIR}/D-010-ten.md`]: '## D-010 Ten | pipes (2026-10-02)\n', [`${DECISIONS_DIR}/new-T-5-later.md`]: '## D-T-5 Later (2026-10-03)\n' });
  const entries = readDecisions(dir);
  assert.deepEqual(entries.map((e) => e.number), [1, 10]);
  const text = decisionsIndex(entries);
  assert.ok(text.startsWith(DECISIONS_HEADER));
  assert.match(text, /\| \[D-010\]\(decisions\/D-010-ten\.md\) \| Ten \\\| pipes \| 2026-10-02 \|\n$/);
  assert.ok(!text.includes('D-T-5'), 'a new decision has no row yet');
  assert.equal(decisionsIndexFor(dir), text);
  assert.equal(writeDecisionsIndex(dir), true);
  assert.equal(writeDecisionsIndex(dir), false, 'the same index isn\'t written again');
  assert.equal(decisionsIndexFor(makeRepo()), null, 'an edge case: a repo with no decisions folder has no index');
});

test('a file whose heading names another number, or two files with one number, are errors, not a wrong index', () => {
  const dir = repo();
  write(dir, { [`${DECISIONS_DIR}/D-002-two.md`]: '## D-003 Two (2026-10-02)\n' });
  assert.throws(() => readDecisions(dir), /D-002-two\.md doesn't start with "## D-002/);
  write(dir, { [`${DECISIONS_DIR}/D-002-two.md`]: '## D-002 Two (2026-10-02)\n', [`${DECISIONS_DIR}/D-002-also.md`]: '## D-002 Also (2026-10-02)\n' });
  assert.throws(() => readDecisions(dir), /Two decisions share a number in docs\/decisions: D-002/);
});

test('a branch\'s new decision gets the next free number at merge, and its id is replaced only in the lines the branch added or changed', () => {
  const dir = repo();
  write(dir, { [`${DECISIONS_DIR}/D-002-products.md`]: '## D-002 Products (2026-10-02)\n' });
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-5', 'HEAD~1');
  write(dir, {
    [`${DECISIONS_DIR}/new-T-5-merges.md`]: '## D-T-5 Merges on their own (2026-10-22)\n\nSee D-T-5, not D-T-50.\n',
    'CLAUDE.md': 'The rule is D-T-5.\n',
    'docs/notes.md': 'An old line about D-T-5, which the branch never touched.\nA new line naming D-T-5.\n',
  });
  assert.deepEqual(decisionsToNumber(run, dir, 'main'), [{ from: 'new-T-5-merges.md', to: 'D-003-merges.md', was: 'D-T-5', id: 'D-003' }]);
  const r = numberDecisions(run, dir, 'main', commitIn(dir));
  assert.deepEqual(r?.numbered.map((n) => n.id), ['D-003']);
  assert.equal(gitIn(dir, 'rev-parse', 'HEAD'), r!.sha);
  assert.ok(!existsSync(join(dir, DECISIONS_DIR, 'new-T-5-merges.md')));
  assert.equal(readFileSync(join(dir, DECISIONS_DIR, 'D-003-merges.md'), 'utf8'), '## D-003 Merges on their own (2026-10-22)\n\nSee D-003, not D-T-50.\n', 'a longer id is left alone');
  assert.equal(readFileSync(join(dir, 'CLAUDE.md'), 'utf8'), 'The rule is D-003.\n');
  assert.equal(readFileSync(join(dir, 'docs/notes.md'), 'utf8'), 'An old line about D-T-5, which the branch never touched.\nA new line naming D-003.\n', 'a line the branch didn\'t touch keeps D-T-5');
  assert.match(readFileSync(join(dir, DECISIONS_INDEX), 'utf8'), /\[D-003\]\(decisions\/D-003-merges\.md\) \| Merges on their own/);
  assert.equal(gitIn(dir, 'status', '--porcelain'), '', 'all of it in the one commit');
  assert.equal(gitIn(dir, 'log', '-1', '--format=%s'), `Number the decisions this branch adds: ${numberedWords(r!.numbered)}`);
  // Merged into main: main's D-002 and the branch's D-003 sit side by side.
  gitIn(dir, 'checkout', '-q', 'main');
  gitIn(dir, 'merge', '-q', '--no-ff', '-m', 'Merge T-5', 'task/T-5');
  assert.deepEqual(readDecisions(dir).map((e) => e.number), [1, 2, 3]);
});

test('two new decisions on a branch are numbered in file-name order, and one the base took since is numbered again', () => {
  const dir = repo();
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-6');
  write(dir, { [`${DECISIONS_DIR}/new-T-6-b.md`]: '## D-T-6 B (2026-10-22)\n', [`${DECISIONS_DIR}/new-T-7-a.md`]: '## D-T-7 A (2026-10-22)\n', [`${DECISIONS_DIR}/D-002-mine.md`]: '## D-002 Mine (2026-10-22)\n' });
  gitIn(dir, 'checkout', '-q', 'main');
  write(dir, { [`${DECISIONS_DIR}/D-002-theirs.md`]: '## D-002 Theirs (2026-10-22)\n' });
  gitIn(dir, 'checkout', '-q', 'task/T-6');
  assert.deepEqual(decisionsToNumber(run, dir, 'main').map((n) => `${n.was} ${n.from} → ${n.to}`), ['D-002 D-002-mine.md → D-003-mine.md', 'D-T-6 new-T-6-b.md → D-004-b.md', 'D-T-7 new-T-7-a.md → D-005-a.md']);
});

test('nothing to number is null and commits nothing; a checkout with uncommitted changes is refused and left as it was', () => {
  const dir = repo();
  const head = gitIn(dir, 'rev-parse', 'HEAD');
  assert.equal(numberDecisions(run, dir, 'main', commitIn(dir)), null, 'an edge case: a branch that adds no decision');
  assert.equal(gitIn(dir, 'rev-parse', 'HEAD'), head);
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-8');
  write(dir, { [`${DECISIONS_DIR}/new-T-8-x.md`]: '## D-T-8 X (2026-10-22)\n' });
  writeFileSync(join(dir, 'docs/notes.md'), 'edited\n');
  assert.throws(() => numberDecisions(run, dir, 'main', commitIn(dir)), /has changes nobody committed/);
  assert.ok(readdirSync(join(dir, DECISIONS_DIR)).includes('new-T-8-x.md'));
});

test('a numbering whose commit is refused leaves the branch as it was', () => {
  const dir = repo();
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-9');
  write(dir, { [`${DECISIONS_DIR}/new-T-9-x.md`]: '## D-T-9 X (2026-10-22)\n', 'a.md': 'D-T-9\n' });
  const head = gitIn(dir, 'rev-parse', 'HEAD');
  assert.throws(() => numberDecisions(run, dir, 'main', () => ({ code: 1, stdout: '', stderr: 'a hook said no' })), /The numbering commit was refused: a hook said no/);
  assert.deepEqual([gitIn(dir, 'rev-parse', 'HEAD'), gitIn(dir, 'status', '--porcelain'), readFileSync(join(dir, 'a.md'), 'utf8')], [head, '', 'D-T-9\n']);
});
