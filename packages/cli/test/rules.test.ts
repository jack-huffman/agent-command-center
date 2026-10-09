// acc rules: importing a team's rules, and the suggestions acc makes from findings (rules.ts).
// acc runs from its source, in throwaway repos (support.ts).
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { readLedger, repoPaths, run } from '../../core/src/index.ts';
import { tempDir } from '../../core/test/support.ts';
import { cli, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

test('rules import copies a team\'s rules in for a person to commit, list and diff say when its source changed, and a builder can\'t import (GH-108)', () => {
  const team = tempDir('team-');
  const file = join(team, 'acme.md');
  writeFileSync(file, '# ACME rules\n\n- Every change has a test.\n');
  const dir = repoWithConfig();

  const dry = acc(dir, ['rules', 'import', file, '--dry-run', '--json']);
  assert.equal(dry.code, 0, dry.err);
  assert.deepEqual([dry.json().written, dry.json().file, dry.json().exists, dry.json().lines, dry.json().preview[0]], [false, '.acc/rules/acme.md', false, 3, '# ACME rules']);
  assert.ok(!existsSync(join(dir, '.acc', 'rules')), 'a dry run writes nothing');
  const builder = acc(dir, ['rules', 'import', file], undefined, { ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(builder.code, 1);
  assert.match(builder.err, /A builder can't copy rules into the repo/);

  const r = acc(dir, ['rules', 'import', file]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Copied .*acme\.md into \.acc\/rules\/acme\.md, on \d{4}-\d{2}-\d{2}\.\nReview it, then commit it\./);
  assert.match(readFileSync(join(dir, '.acc', 'rules', 'acme.md'), 'utf8'), /^<!-- acc-rules v1: [\s\S]*-->\n# ACME rules\n/);
  assert.equal(acc(dir, ['rules', 'import', file]).code, 1, 'refuses to replace it without --force');
  assert.deepEqual((acc(dir, ['rules', 'list', '--json']).json() as { name: string; state: string }[]).map((c) => [c.name, c.state]), [['acme', 'unchanged']]);

  writeFileSync(file, '# ACME rules\n\n- Every change has a test.\n- And a changelog line.\n');
  const before = readFileSync(join(dir, '.acc', 'rules', 'acme.md'), 'utf8');
  assert.match(acc(dir, ['rules', 'list']).out, /\.acc\/rules\/acme\.md .*↻ changed at its source[\s\S]*See what changed: acc rules diff acme/);
  const diff = acc(dir, ['rules', 'diff', 'acme']);
  assert.equal(diff.code, 0, diff.err);
  assert.match(diff.out, /\n\+- And a changelog line\.\n/);
  assert.match(diff.out, /To copy it in again, replacing this copy: acc rules import '.*acme\.md' --name acme --force/);
  const doctor = acc(dir, ['doctor', '--step', 'B0.rules', '--json']).json() as { status: string; fix: string | null }[];
  assert.deepEqual(doctor.map((d) => [d.status, d.fix]), [['unknown', 'acc rules diff acme']]);
  assert.equal(readFileSync(join(dir, '.acc', 'rules', 'acme.md'), 'utf8'), before, 'list, diff and Setup never write the copy');
  assert.equal(acc(dir, ['rules', 'import', file, '--force']).code, 0, 'a person copies it in again');
  assert.deepEqual((acc(dir, ['rules', 'list', '--json']).json() as { state: string }[]).map((c) => c.state), ['unchanged']);
});

test('rules suggested lists a finding that keeps coming back; only a person accepts it, adding one To do task, or dismisses it (GH-102)', () => {
  const dir = repoWithConfig();
  const reviews = repoPaths(dir, run).reviews;
  mkdirSync(reviews, { recursive: true });
  // Three reviews of two tasks cite the same rule, two ways.
  const cites: [string, string, string, string][] = [
    ['T-1', 'a'.repeat(40), 'src/a.css', 'Never hard-code a colour'], ['T-1', 'b'.repeat(40), 'src/b.css', 'Never hard-code a colour (team rules)'], ['T-2', 'c'.repeat(40), 'src/c.css', 'Rule: never hard-code a colour'],
  ];
  cites.forEach(([task, sha, file, rule], i) => writeFileSync(join(reviews, `${task}-${sha}.json`), JSON.stringify({
    v: 1, task, sha, env: 'main', verdict: 'pass', summary: 's', criteria: [], findings: [{ message: `A colour literal in ${file}.`, must: i === 0, file, line: 3, rule }],
    sessionId: `sess-${i}`, name: `Review ${task}`, at: `2026-10-0${i + 1}T10:00:00.000Z`, durationMs: 1, costUsd: null,
  })));
  const list = acc(dir, ['rules', 'suggested', '--json']);
  assert.equal(list.code, 0, list.err);
  const [s] = list.json() as { id: string; kind: string; findings: number; tasks: number; must: number; sources: { sessionId: string }[] }[];
  assert.deepEqual([s!.kind, s!.findings, s!.tasks, s!.must, s!.sources.map((x) => x.sessionId)], ['rule', 3, 2, 1, ['sess-0', 'sess-1', 'sess-2']]);
  assert.match(acc(dir, ['rules', 'suggested']).out, new RegExp(`^${s!.id}  Rule suggested  3 findings across 2 tasks \\(1 must\\)\\n    Never hard-code a colour\\.`));

  // Never an agent: refused by role and by actor, and nothing is added or recorded.
  for (const [role, args] of [['builder', []], ['reviewer', []], ['analyst', []], ['', ['--as', 'orchestrator']]] as const) {
    for (const verb of ['accept', 'dismiss']) {
      const r = acc(dir, ['rules', verb, s!.id, ...args], undefined, { ACC_ROLE: role });
      assert.equal(r.code, 1, `${verb} as ${role || args.join(' ')}`);
      assert.match(r.err, /can't (accept|dismiss) a suggested rule|Only a person can/);
    }
  }
  assert.equal(existsSync(join(dir, '.git', 'acc', 'rules')), false, 'no record');
  assert.equal(existsSync(join(dir, '.git', 'acc', 'ledger.json')), false, 'no task');

  assert.equal(acc(dir, ['rules', 'accept', s!.id, '--check', 'fuzz']).code, 2);
  const ok = acc(dir, ['rules', 'accept', s!.id, '--check', 'lint', '--line', 'Colours come from theme tokens', '--json']);
  assert.equal(ok.code, 0, ok.err);
  const tasks = readLedger(repoPaths(dir, run).ledger).tasks;
  assert.deepEqual(tasks.map((t) => [t.id, t.state, t.title]), [[ok.json().task, 'todo', 'Add the rule: Colours come from theme tokens']]);
  assert.match(tasks[0]!.brief, /^> Colours come from theme tokens\.$/m);
  assert.match(tasks[0]!.brief, /A lint checks the rule/);
  assert.match(tasks[0]!.brief, /T-2, review of ccccccc on 2026-10-03, src\/c\.css:3/);
  assert.deepEqual(acc(dir, ['rules', 'suggested', '--json']).json(), [], 'accepted, it\'s gone');
  assert.equal(existsSync(join(dir, '.acc', 'rules.md')), false, 'acc never writes .acc/rules.md');
  assert.equal(acc(dir, ['rules', 'dismiss', s!.id]).code, 1, 'nothing to dismiss now');
  assert.match(acc(dir, ['rules', 'suggested', '--all']).out, /accepted by .*: back after 3 more/);
});

test('rules dismiss sets a suggestion aside, and it\'s listed only with --all (GH-102)', () => {
  const dir = repoWithConfig();
  const reviews = repoPaths(dir, run).reviews;
  mkdirSync(reviews, { recursive: true });
  ['T-1', 'T-2', 'T-3'].forEach((task, i) => writeFileSync(join(reviews, `${task}-${String(i).repeat(40)}.json`), JSON.stringify({
    v: 1, task, sha: String(i).repeat(40), env: 'main', verdict: 'pass', summary: 's', criteria: [], findings: [{ message: 'm', must: false, file: 'x.ts', rule: 'Every command has a help line' }],
    sessionId: `s${i}`, at: `2026-10-0${i + 1}T10:00:00.000Z`, durationMs: 1, costUsd: null,
  })));
  const [s] = acc(dir, ['rules', 'suggested', '--json']).json() as { id: string }[];
  const r = acc(dir, ['rules', 'dismiss', s!.id]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /Dismissed .*until its finding comes back 3 more times/);
  assert.deepEqual(acc(dir, ['rules', 'suggested', '--json']).json(), []);
  assert.equal((acc(dir, ['rules', 'suggested', '--all', '--json']).json() as { hidden: { outcome: string } }[])[0]!.hidden.outcome, 'dismissed');
});
