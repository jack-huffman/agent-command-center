// The wording check on a task's acceptance criteria at the command line (T-148): acc add and acc edit refuse a
// brief whose criteria fail the Simplified Technical English check, write nothing, and give each finding with its
// line, rule and fix. Advice goes on with the task. A tracker's ticket is never refused. acc runs from its source,
// in throwaway repos (support.ts). The briefs and names are made up.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cli, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

const brief = (...criteria: string[]) => ['## Goal', '', 'Regions show on each deal.', '', '## Acceptance criteria', '', ...criteria.map((c) => `- [ ] ${c}`)].join('\n');
const ledgerFile = (dir: string) => join(dir, '.git', 'acc', 'ledger.json');
const tasks = (dir: string): { id: string; brief: string; edits?: unknown[] }[] => (existsSync(ledgerFile(dir)) ? JSON.parse(readFileSync(ledgerFile(dir), 'utf8')).tasks : []);

test('acc add with criteria that pass adds the task, with no advice', () => {
  const dir = repoWithConfig();
  const r = acc(dir, ['add', 'Regions on deals', '--brief', brief('The page shows the region of each deal.')]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Added T-1$/m);
  assert.doesNotMatch(r.out, /Advice/);
  assert.equal(tasks(dir).length, 1);
});

test('acc add refuses criteria with a hard finding, lists each line, rule and fix, and writes nothing', () => {
  const dir = repoWithConfig();
  const r = acc(dir, ['add', 'Regions on deals', '--brief', brief('The page shows the region; it loads.', 'Kick off the import.')]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.err, /The acceptance criteria don't pass the Simplified Technical English check \(2 findings\), so acc wrote nothing\./);
  assert.ok(r.err.includes('- Line 7 (criterion 1), semicolon: STE bans the semicolon (Rule 8.1). Split into separate sentences. [;]'), r.err);
  assert.ok(r.err.includes('- Line 8 (criterion 2), phrasal-verb: Soft phrasal verb. Use the single plain verb (start, contact, read, begin). [Kick off]'), r.err);
  assert.deepEqual(tasks(dir), [], 'no task, and no ledger change');
  // Written again with the fixes, it's added.
  assert.equal(acc(dir, ['add', 'Regions on deals', '--brief', brief('The page shows the region. It loads.', 'Start the import.')]).code, 0);
  assert.equal(tasks(dir).length, 1);
});

test('advice only: acc add and acc edit go on, and show the advice', () => {
  const dir = repoWithConfig();
  const r = acc(dir, ['add', 'Regions on deals', '--brief', brief('The region is shown on the page.')]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Advice on the wording of the acceptance criteria\. It doesn't stop the command:\n- Line 7 \(criterion 1\), passive-voice: .* \[is shown\]/);
  const e = acc(dir, ['edit', 'T-1', '--brief', brief('The team has used the old page.'), '--json']);
  assert.equal(e.code, 0, e.err);
  assert.deepEqual(e.json().advice.map((f: { rule: string }) => f.rule), ['present-perfect']);
  assert.deepEqual(e.json().changed, ['brief']);
});

test('acc edit refuses a brief whose criteria fail, and keeps the task as it was', () => {
  const dir = repoWithConfig();
  assert.equal(acc(dir, ['add', 'Regions on deals', '--brief', 'Old brief']).code, 0);
  const before = readFileSync(ledgerFile(dir), 'utf8');
  const r = acc(dir, ['edit', 'T-1', '--brief', brief('The page is seamless.'), '--notes', 'Use the sandbox.']);
  assert.equal(r.code, 1, r.out);
  assert.match(r.err, /T-1's acceptance criteria don't pass .*\(1 finding\), so acc wrote nothing\./);
  assert.ok(r.err.includes('- Line 7 (criterion 1), marketing-adjective: Marketing adjective.'), r.err);
  assert.equal(readFileSync(ledgerFile(dir), 'utf8'), before, 'the notes were not written either');
});

test('edge case: code in backticks is left alone, and a brief with no criteria is not checked', () => {
  const dir = repoWithConfig();
  assert.equal(acc(dir, ['add', 'One', '--brief', brief('`acc add; acc edit` refuses the brief.')]).code, 0);
  assert.equal(acc(dir, ['add', 'Two', '--brief', 'Kick off the import; then stop.']).code, 0, 'no criteria heading');
  assert.equal(acc(dir, ['add', 'Three']).code, 0, 'no brief');
});

test('edge case: a ticket from a tracker is never refused for its criteria\'s wording', () => {
  const dir = repoWithConfig();
  const file = join(dir, 'tickets.json');
  writeFileSync(file, JSON.stringify([{ source: { kind: 'jira', key: 'ACME-7', url: 'https://acme.example/browse/ACME-7' }, title: 'From Jira', brief: brief('Reach out to the team; then stop.') }]));
  const r = acc(dir, ['import', '--file', file]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Added ACME-7/);
  // An edit to what acc keeps for it goes on, though its client's words fail the check.
  assert.equal(acc(dir, ['edit', 'ACME-7', '--notes', 'Ask Jordan.']).code, 0);
});
