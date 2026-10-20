import assert from 'node:assert/strict';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { type Config, parseConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { intakeOutside } from '../src/intake.ts';
import { mutate, readLedger, upsertTasks } from '../src/ledger.ts';
import { repoPaths } from '../src/paths.ts';
import { isSprintSeen, readSprints, rememberSprint, sprintChange, sprintGone, sprintMoved, sprintNotice, sprintsFile, type SprintSeen, sprintTracker } from '../src/sprints.ts';
import { sprintDates, sprintPlace } from '../src/trackers/types.ts';
import { GENERIC_CONFIG, makeRepo, tempDir } from './support.ts';

const now = () => new Date('2026-10-20T09:00:00Z');
const S12 = { id: 12, name: 'Sprint 12' };
const S13 = { id: 13, name: 'Sprint 13' };
const seen = (sprints: SprintSeen['sprints'], open: string[]): SprintSeen => ({ sprints, open, at: '2026-10-19T17:00:00.000Z' });

test('acc keeps the last sprint per tracker, written whole; a missing or broken file is none (T-78)', () => {
  const paths = { stateDir: join(tempDir(), 'acc') };
  assert.deepEqual(readSprints(paths), {}, 'no file yet: a first look');
  const a = sprintTracker({ site: 'acme.atlassian.net', project: 'ACME', board: 7 });
  const b = sprintTracker({ site: 'acme.atlassian.net', project: 'ACME', board: null });
  assert.notEqual(a, b, 'another board is another tracker, so it starts again');
  rememberSprint(paths, a, seen([S12], ['ACME-1']));
  rememberSprint(paths, b, seen([S13], []));
  rememberSprint(paths, a, seen([S13], ['ACME-1', 'ACME-2']));
  assert.deepEqual(readSprints(paths), { [a]: seen([S13], ['ACME-1', 'ACME-2']), [b]: seen([S13], []) }, 'each tracker\'s own, the newest kept');
  assert.deepEqual(readdirSync(paths.stateDir), ['sprints.json'], 'no temp file left beside it');
  writeFileSync(sprintsFile(paths), '{ "broken": ');
  assert.deepEqual(readSprints(paths), {}, 'a broken file is none');
  writeFileSync(sprintsFile(paths), JSON.stringify({ [a]: { sprints: 'x' }, [b]: seen([S12], []) }));
  assert.deepEqual(readSprints(paths), { [b]: seen([S12], []) }, 'an entry that isn\'t one is dropped');
  assert.equal(isSprintSeen({ sprints: [{ id: '12', name: 'x' }], open: [], at: 'now' }), false, 'a sprint id must be a number');
});

test('a sprint change counts the tickets carried and the ones gone back to the backlog; the same sprint, or a first look, is none (T-78)', () => {
  const prev = seen([S12], ['ACME-1', 'ACME-2', 'ACME-3', 'ACME-4']);
  const now13 = { sprints: [S13], keys: ['ACME-1', 'ACME-2', 'ACME-9'] };
  assert.deepEqual(sprintGone(prev, now13), ['ACME-3', 'ACME-4'], 'the old sprint\'s open tickets no longer on the board');
  // ACME-4 was done before the sprint closed: it went neither way.
  const change = sprintChange(prev, now13, ['ACME-3']);
  assert.deepEqual(change, { from: ['Sprint 12'], to: ['Sprint 13'], carried: ['ACME-1', 'ACME-2'], backlog: ['ACME-3'] });
  assert.equal(sprintNotice(change!, []), 'Sprint 13 started after Sprint 12: 2 tickets carried into it, 1 went back to the backlog.');
  assert.equal(sprintNotice(change!, ['ACME-3']), 'Sprint 13 started after Sprint 12: 2 tickets carried into it, 1 went back to the backlog. ACME-3 left the sprint after work started, so it stays on the agent board.');
  assert.match(sprintNotice({ ...change!, backlog: ['ACME-3', 'ACME-4'] }, ['ACME-3', 'ACME-4']), /ACME-3 and ACME-4 left the sprint after work started, so they stay/);

  assert.equal(sprintChange(undefined, now13, []), null, 'a first look says nothing');
  assert.deepEqual(sprintGone(undefined, now13), []);
  assert.equal(sprintChange(prev, { sprints: [S12], keys: [] }, []), null, 'the same sprint with other tickets is no change');
  assert.deepEqual(sprintGone(prev, { sprints: [S12], keys: [] }), [], 'and asks the tracker nothing');
  const ended = sprintChange(prev, { sprints: [], keys: [] }, ['ACME-1', 'ACME-2']);
  assert.equal(sprintNotice(ended!, []), 'Sprint 12 ended, and no sprint is active now: 0 tickets carried into a new sprint, 2 went back to the backlog.', 'no sprint open now');
  assert.equal(sprintNotice(sprintChange(seen([], []), { sprints: [S13], keys: ['ACME-1'] }, [])!, []), 'Sprint 13 started.', 'none was open before: nothing to count');

  assert.equal(sprintMoved(undefined, seen([S12], [])), true, 'a first look is kept');
  assert.equal(sprintMoved(prev, seen([S12], ['ACME-4', 'ACME-3', 'ACME-2', 'ACME-1'])), false, 'the same sprint and tickets, in another order, isn\'t written again');
  assert.equal(sprintMoved(prev, seen([S12], ['ACME-1'])), true, 'other tickets are');
});

test('when the sprint changes, a ticket that went back to the backlog leaves the board if never started, and a started task stays and is named (T-78)', () => {
  const raw = { ...GENERIC_CONFIG, trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', board: 7, sprint: 'active' }] };
  const dir = makeRepo({ '.acc/config.json': JSON.stringify(raw) });
  const paths = repoPaths(dir, run);
  const config = parseConfig(raw).config as Config;
  mutate(paths, now, (l, emit) => upsertTasks(l, config, ['ACME-1', 'ACME-3', 'ACME-5'].map((key) => ({ source: { kind: 'jira' as const, key }, title: key })), 'human', 'h', emit, now));
  mutate(paths, now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === 'ACME-5')!;
    t.state = 'running';
    t.run = { branch: 'task/ACME-5', worktree: '/tmp/ACME-5' };
    emit({ type: 'task.updated', task: t.id, actor: 'human', by: 'test', data: {} });
  });
  const tracker = sprintTracker(config.trackers[0]!);
  rememberSprint(paths, tracker, seen([S12], ['ACME-1', 'ACME-3', 'ACME-5']));

  // Sprint 13 opened with ACME-1 carried; ACME-3 and ACME-5 went back to the backlog.
  const board = { sprints: [S13], keys: ['ACME-1', 'ACME-7'] };
  const prev = readSprints(paths)[tracker];
  const change = sprintChange(prev, board, sprintGone(prev, board));
  const res = intakeOutside(paths, 'jira', [{ key: 'ACME-3', why: 'it isn\'t in the active sprint' }, { key: 'ACME-5', why: 'it isn\'t in the active sprint' }], now);
  rememberSprint(paths, tracker, seen([S13], board.keys));
  assert.deepEqual([res.removed, res.leftAlone.map((l) => l.task)], [['ACME-3'], ['ACME-5']], 'the one never started leaves; the started one stays');
  assert.deepEqual(readLedger(paths.ledger).tasks.map((t) => `${t.id} ${t.state}`), ['ACME-1 todo', 'ACME-5 running'], 'on the agent board');
  assert.equal(sprintNotice(change!, res.leftAlone.map((l) => l.task)), 'Sprint 13 started after Sprint 12: 1 ticket carried into it, 2 went back to the backlog. ACME-5 left the sprint after work started, so it stays on the agent board.');
  assert.equal(sprintChange(readSprints(paths)[tracker], board, []), null, 'said once: the next look finds the same sprint');
  assert.ok(JSON.parse(readFileSync(sprintsFile(paths), 'utf8'))[tracker], 'kept beside the ledger');
});

test('a place names its sprint and dates once known; with none open, it says no active sprint (T-78)', () => {
  assert.equal(sprintDates({ start: '2026-10-06T09:00:00.000Z', end: '2026-10-19T17:00:00.000Z' }), '6 Oct to 19 Oct');
  assert.equal(sprintDates({ start: null, end: null }), null, 'a future sprint with no dates yet');
  assert.equal(sprintDates({ start: '2026-10-06T09:00:00.000Z', end: 'soon' }), 'from 6 Oct', 'a date that isn\'t one is left out');
  assert.equal(sprintPlace('active', null), 'the active sprint', 'before the board loads');
  assert.equal(sprintPlace(42, null), 'sprint 42');
  assert.equal(sprintPlace('active', []), 'no active sprint');
  assert.equal(sprintPlace('active', [{ id: 1, name: 'A', state: 'active', start: null, end: null }, { id: 2, name: 'B', state: 'active', start: null, end: '2026-10-19T17:00:00.000Z' }]), 'active sprints A and B (to 19 Oct)', 'two open at once');
  assert.equal(sprintPlace(42, [{ id: 42, name: 'C', state: 'future', start: null, end: null }]), 'sprint C', 'a named one, not yet started');
});
