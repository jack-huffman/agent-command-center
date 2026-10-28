import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { addBoard, parseConfig, removeTracker, replaceTracker, sameSource, TRACKER_NAME_MAX, trackerForKey } from '../src/config.ts';
import { GENERIC_CONFIG, tempDir } from './support.ts';

// A project's several boards (T-127): each board's own name, two boards of one project, adding one, and taking one out.

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const config = (trackers: Record<string, unknown>[]) => parseConfig({ ...clone(GENERIC_CONFIG), trackers });
const ACME = { kind: 'jira', site: 'acme.atlassian.net', project: 'ACME' };

test('a tracker\'s name is read trimmed, unset is null, and one too long or not words is refused', () => {
  assert.equal(config([{ ...ACME, name: '  Premium support  ' }]).config!.trackers[0]!.name, 'Premium support');
  assert.equal(config([ACME]).config!.trackers[0]!.name, null);
  assert.equal(config([{ ...ACME, name: '' }]).config!.trackers[0]!.name, null, 'edge case: an empty name is the tracker\'s own');
  assert.deepEqual(config([{ ...ACME, name: 'x'.repeat(TRACKER_NAME_MAX + 1) }]).errors, [`trackers[0]: "name" must be the board's name, in up to ${TRACKER_NAME_MAX} characters.`]);
  assert.equal(config([{ ...ACME, name: 7 }]).config, null);
  assert.deepEqual(config([{ ...ACME, name: 'Board' }]).warnings, [], 'name is a known key, so no warning');
});

test('two boards of one Jira project on one site are one source with no warning; on two sites, their keys clash and it says so', () => {
  const two = config([{ ...ACME, epics: ['ACME-3'] }, { ...ACME, epics: ['ACME-7'] }]);
  assert.deepEqual(two.warnings, []);
  const [a, b] = two.config!.trackers;
  assert.ok(sameSource(a!, b!));
  assert.equal(trackerForKey(two.config!.trackers, 'ACME-12'), 0, 'a ticket both could show is the first one\'s: one task, posted through one project');
  const sites = config([ACME, { ...ACME, site: 'beta.atlassian.net' }]);
  assert.equal(sites.warnings.length, 1);
  assert.ok(!sameSource(sites.config!.trackers[0]!, sites.config!.trackers[1]!), 'edge case: the same key on another site is another source');
  const gh = config([{ kind: 'github', repo: 'acme/tool', labels: ['a'] }, { kind: 'github', repo: 'acme/tool', labels: ['b'] }, { kind: 'github', repo: 'acme/web' }]).config!.trackers;
  assert.ok(sameSource(gh[0]!, gh[1]!));
  assert.ok(!sameSource(gh[0]!, gh[2]!));
  assert.ok(!sameSource(config([ACME]).config!.trackers[0]!, gh[0]!), 'another kind');
});

test('addBoard always adds, gives a second Slack channel its own prefix, and refuses the very same board, renamed or not', () => {
  const was = [{ ...ACME, epics: ['ACME-3'] }];
  assert.deepEqual(addBoard(was, { ...ACME, epics: ['ACME-7'], prefix: null }), [...was, { ...ACME, epics: ['ACME-7'] }], 'a key named null is left out');
  assert.throws(() => addBoard(was, { ...ACME, epics: ['ACME-3'], name: 'Other' }), /That board is in the project already/);
  assert.throws(() => addBoard([{ epics: ['ACME-3'], ...ACME }], { ...ACME, epics: ['ACME-3'] }), /already/, 'edge case: the same keys in another order are the same board');
  const slack = { kind: 'slack', workspace: 'acme', channel: 'C1' };
  assert.equal(addBoard([slack], { ...slack, channel: 'C2' })[1]!.prefix, 'SL2');
  assert.deepEqual(addBoard([], ACME), [ACME], 'edge case: the first board');
});

test('edge case: two trackers in the very same place are one board twice: parseConfig warns, and a Change that makes them so is refused, naming the other', () => {
  const twice = config([{ ...ACME, epics: ['ACME-3'], name: 'Premium' }, { epics: ['ACME-3'], ...ACME, name: 'Support' }]);
  assert.deepEqual(twice.warnings, ['trackers[0] and trackers[1] are the same board: the same place, differing only by name. Give one other epics, labels or another place, or take it out.']);
  const was = [{ ...ACME, epics: ['ACME-3'], name: 'Premium' }, { ...ACME, epics: ['ACME-7'] }];
  assert.throws(() => replaceTracker(was, 1, { ...ACME, epics: ['ACME-3'] }), /That's the same place as the board “Premium”/);
  assert.throws(() => replaceTracker([ACME, { ...ACME, epics: ['ACME-7'] }], 1, { ...ACME, epics: null }), /same place as board 1 in the project's list/, 'an unnamed board by its place');
  assert.deepEqual(replaceTracker(was, 1, { ...ACME, epics: ['ACME-9'], name: 'Renewals' })[1], { ...ACME, epics: ['ACME-9'], name: 'Renewals' }, 'another place is fine');
  assert.deepEqual(replaceTracker(was, 0, { ...ACME, name: 'Gold' })[0], { ...ACME, epics: ['ACME-3'], name: 'Gold' }, 'renaming a board in its own place is fine');
});

test('removeTracker takes out the one at its place, keeps the rest of the file, and refuses another kind or no tracker there', () => {
  const file = join(tempDir('boards-'), 'config.json');
  const raw = { ...clone(GENERIC_CONFIG), trackers: [ACME, { kind: 'github' }], extra: 'kept' };
  writeFileSync(file, JSON.stringify(raw));
  assert.throws(() => removeTracker(file, 1, 'jira'), /changed since this page opened/);
  assert.throws(() => removeTracker(file, 2, 'jira'), /changed since/);
  assert.throws(() => removeTracker(file, -1, 'jira'), /place in the list/);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).trackers.length, 2, 'nothing written on a refusal');
  assert.deepEqual(removeTracker(file, 0, 'jira').removed, ACME);
  const after = JSON.parse(readFileSync(file, 'utf8'));
  assert.deepEqual([after.trackers, after.extra], [[{ kind: 'github' }], 'kept']);
  removeTracker(file, 0, 'github');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).trackers, [], 'edge case: the last board leaves an empty list');
});
