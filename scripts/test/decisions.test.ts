// The repo's decisions, one file each (T-102): docs/DECISIONS.md is the index docs/decisions/ makes, never
// stale, and the commit that split the old single file kept every decision's text exactly.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { decisionHeading, decisionsIndexFor, DECISIONS_DIR, DECISIONS_INDEX, parseDecisionName, readDecisions } from '../../packages/core/src/decisions.ts';
import { run } from '../../packages/core/src/exec.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const git = (...args: string[]) => {
  const r = run('git', args, { cwd: ROOT });
  assert.equal(r.code, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};

test('docs/DECISIONS.md is never stale: the index docs/decisions/ makes, a row for every numbered decision', () => {
  const entries = readDecisions(ROOT);
  assert.ok(entries.length >= 195, `it read ${entries.length} decisions`);
  assert.equal(readFileSync(join(ROOT, DECISIONS_INDEX), 'utf8'), decisionsIndexFor(ROOT), 'stale: run acc decisions index');
  const files = readdirSync(join(ROOT, DECISIONS_DIR));
  assert.deepEqual(files.filter((f) => !parseDecisionName(f)), [], 'every file in the folder is a decision');
  for (const f of files.filter((n) => n.startsWith('new-'))) {
    const name = parseDecisionName(f)!;
    assert.equal(decisionHeading(readFileSync(join(ROOT, DECISIONS_DIR, f), 'utf8'))?.id, `D-${name.task}`, `${f} is headed with its task's id until it is numbered`);
  }
});

test('the split kept every decision\'s text exactly: each section of the old file is its own file at the commit that split it', () => {
  const split = git('log', '--diff-filter=A', '--format=%H', '--', `${DECISIONS_DIR}/D-001-*.md`).trim().split('\n').at(-1);
  assert.ok(split, 'the commit that split docs/DECISIONS.md is in the history: an edge case a shallow clone would hide');
  const old = git('show', `${split}^:${DECISIONS_INDEX}`);
  const sections = old.slice(old.search(/^## D-/m)).split(/^(?=## D-\d)/m);
  assert.equal(sections.length, 195, 'the old file held 195 decisions');
  const at = new Map(git('ls-tree', '--name-only', `${split}:${DECISIONS_DIR}`).split('\n').filter(Boolean).map((f) => [f.slice(0, 5), f]));
  assert.equal(at.size, 195);
  let joined = '';
  for (const s of sections) {
    const id = decisionHeading(s)!.id;
    const file = at.get(id);
    assert.ok(file, `${id} has a file`);
    const text = git('show', `${split}:${DECISIONS_DIR}/${file}`);
    assert.equal(text, `${s.replace(/\n+$/, '')}\n`, `${id}'s text is the old section's, but the blank lines after it`);
    joined += text;
  }
  // Joined in the old order, the files are the old file with its preamble and the blank lines between sections taken out.
  assert.equal(joined, sections.map((s) => `${s.replace(/\n+$/, '')}\n`).join(''));
  assert.equal(old.length - old.search(/^## D-/m) - joined.length, sections.filter((s) => s.endsWith('\n\n')).length, 'only the blank line between two sections is gone, where there was one');
});
