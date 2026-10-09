// acc trackers set: connecting a tracker or changing one (trackers.ts).
// acc runs from its source, in throwaway repos (support.ts).
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { GENERIC_CONFIG, tempDir } from '../../core/test/support.ts';
import { cli, repoWithConfig } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

test('trackers set connects a tracker or changes one in .acc/config.json for a person, as the Connect page asks it to, and a builder can\'t (GH-112)', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, github: { repo: 'acme/tool', account: 'jordan' }, trackers: [{ kind: 'github' }] });
  const file = join(tempDir('tracker-'), 'jira.json');
  const config = () => JSON.parse(readFileSync(join(dir, '.acc', 'config.json'), 'utf8'));
  writeFileSync(file, JSON.stringify({ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', board: 7, epic: 'ACME-3' }));
  const builder = acc(dir, ['trackers', 'set', '--file', file], undefined, { ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(builder.code, 1);
  assert.match(builder.err, /A builder can't connect or change a tracker\. A person does that\./);
  assert.equal(config().trackers.length, 1, 'nothing written');

  const added = acc(dir, ['trackers', 'set', '--file', file, '--json']);
  assert.equal(added.code, 0, added.err);
  assert.deepEqual([added.json().index, added.json().added, added.json().place, added.json().tracker.board], [1, true, 'Jira · ACME · epic ACME-3', 7]);
  assert.deepEqual(config().trackers[1], { kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', board: 7, epic: 'ACME-3' });
  // Changed at its place, in words: the whole project again, and the GitHub tracker's repo is the project's own.
  writeFileSync(file, JSON.stringify({ kind: 'jira', epic: null }));
  const changed = acc(dir, ['trackers', 'set', '--file', file, '--index', '1']);
  assert.equal(changed.code, 0, changed.err);
  assert.equal(changed.out, 'Changed Jira in .acc/config.json: its tickets come from Jira · ACME. Commit it to share it.\n');
  assert.equal(config().trackers[1].epic, undefined);
  writeFileSync(file, JSON.stringify({ kind: 'github', labels: ['billing'] }));
  assert.match(acc(dir, ['trackers', 'set', '--file', file]).out, /its tickets come from GitHub · acme\/tool · label billing\./);
  // Refused with acc's reason, and nothing written: another kind at that place, a bad index, no file.
  const before = readFileSync(join(dir, '.acc', 'config.json'), 'utf8');
  const wrong = acc(dir, ['trackers', 'set', '--file', file, '--index', '1', '--json']);
  assert.deepEqual([wrong.code, wrong.json().error], [1, 'config-changed']);
  assert.equal(acc(dir, ['trackers', 'set', '--file', file, '--index', 'one']).code, 2);
  assert.equal(acc(dir, ['trackers', 'set']).code, 2);
  assert.equal(acc(dir, ['trackers']).code, 2);
  assert.equal(readFileSync(join(dir, '.acc', 'config.json'), 'utf8'), before);
  assert.match(acc(dir, ['help']).out, /acc trackers set --file <tracker\.json> \[--index <n>\]/);
});
