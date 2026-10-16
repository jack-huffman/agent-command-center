// acc tidy: the tidy-up pass a person adds or skips (tidy.ts).
// acc runs from its source, in throwaway repos (support.ts).
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { builderSettings, mutate, parseConfig, readLedger, repoPaths, run, upsertTasks } from '../../core/src/index.ts';
import { GENERIC_CONFIG, gitIn } from '../../core/test/support.ts';
import { cli, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

test('acc tidy shows the count and the draft and changes nothing; only a person adds or skips it (GH-104)', () => {
  const dir = repoWithConfig();
  gitIn(dir, 'checkout', '-q', '-b', 'task/T-1');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'T-1: a');
  gitIn(dir, 'checkout', '-q', 'main');
  gitIn(dir, 'merge', '-q', '--no-ff', '-m', 'Merge T-1', 'task/T-1');
  const mergeSha = gitIn(dir, 'rev-parse', 'HEAD');
  const config = parseConfig(GENERIC_CONFIG).config!;
  const paths = repoPaths(dir, run);
  mutate(paths, () => new Date(), (l, emit) => {
    upsertTasks(l, config, Array.from({ length: 8 }, (_, i) => ({ source: { kind: 'manual' as const }, title: `Task ${i + 1}` })), 'human', 'human:test', emit, () => new Date());
    l.tasks.forEach((t, i) => {
      t.state = 'done';
      t.pr = { number: i + 1, url: `https://github.com/acme/tool/pull/${i + 1}`, state: 'merged', mergeSha };
      t.history.push({ at: new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString(), actor: 'sync', by: 'acc sync', from: 'review', to: 'done', reason: 'merged' });
    });
  });
  const shown = acc(dir, ['tidy', '--json']);
  assert.equal(shown.code, 0, shown.err);
  const s = shown.json();
  assert.deepEqual([s.every, s.count, s.due, s.open, s.draft.title, s.draft.files, s.draft.covered.length], [8, 8, true, null, 'Tidy up after 8 merges', ['src/a.ts'], 8]);
  assert.match(acc(dir, ['tidy']).out, /8 tasks merged since the last tidy-up; one is offered every 8\. A tidy-up is due\.[\s\S]*src\/a\.ts[\s\S]*acc tidy add adds it as a task/);
  assert.equal(readLedger(paths.ledger).tasks.length, 8, 'showing it adds nothing');

  // Each role refused adding; skipping goes through the same check, shown once. The hook's guard has its own test.
  for (const [role, sub] of [['builder', 'add'], ['reviewer', 'add'], ['analyst', 'add'], ['analyst', 'skip']] as const) {
    const r = acc(dir, ['tidy', sub], undefined, { ACC_ROLE: role, ACC_TASK: 'T-1' });
    assert.notEqual(r.code, 0, `${role} ${sub}`);
    assert.match(r.err, new RegExp(`An? ${role} can't ${sub} a tidy-up\\. A person does that\\.`), `${role} ${sub}`);
  }
  assert.equal(readLedger(paths.ledger).tasks.length, 8, 'refused: nothing added');
  const deny = (builderSettings({ id: 'T-1' } as never, config, '/acc/bin', '/usr/bin') as { permissions: { deny: string[] } }).permissions.deny;
  assert.ok(deny.includes('Bash(acc tidy add*)') && deny.includes('Bash(acc tidy skip*)'));
  assert.ok(!deny.some((d) => d === 'Bash(acc tidy*)'), 'acc tidy alone only reads');

  const added = acc(dir, ['tidy', 'add', '--json']);
  assert.equal(added.code, 0, added.err);
  assert.equal(added.json().task, 'T-9');
  const t = readLedger(paths.ledger).tasks.find((x) => x.id === 'T-9')!;
  assert.deepEqual([t.state, t.labels, t.title], ['todo', ['tidy-up'], 'Tidy up after 8 merges']);
  // The brief it added passes acc ste check, as every requirement a builder reads must (T-71).
  const checked = acc(dir, ['ste', 'check', '--json'], t.brief);
  assert.ok(t.brief.split('\n').length > 10, 'checked the whole brief');
  assert.deepEqual(checked.json().findings, [], 'acc ste check finds nothing in the brief');
  assert.equal(checked.code, 0);
  const after = acc(dir, ['tidy', '--json']).json();
  assert.deepEqual([after.count, after.open], [0, 'T-9']);
  assert.match(acc(dir, ['tidy', 'skip']).err, /Nothing has merged since the last tidy-up/);
  assert.equal(acc(dir, ['tidy', 'now']).code, 2, 'a usage error');
});
