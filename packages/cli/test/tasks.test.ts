// acc add, edit, list, ready, set, show, status, import and intake: tasks through their life (tasks.ts).
// acc runs from its source, in throwaway repos (support.ts).
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DISPLAY } from '../../core/src/index.ts';
import { GENERIC_CONFIG } from '../../core/test/support.ts';
import { cli, repoWithConfig, UNCHECKED } from './support.ts';

const acc = cli(fileURLToPath(new URL('../src/main.ts', import.meta.url)));

test('add, list, ready, set and show: a task through its life', () => {
  const dir = repoWithConfig(UNCHECKED);
  assert.equal(acc(dir, ['add', 'First thing']).code, 0);
  assert.equal(acc(dir, ['add', 'Second thing', '--dep', 'T-1', '--brief', 'Needs the first']).code, 0);
  const ready = acc(dir, ['ready', '--json']).json() as { id: string }[];
  assert.deepEqual(ready.map((t) => t.id), ['T-1']);
  assert.match(acc(dir, ['list']).out, /T-2\s+○ To do\s+main\s+Second thing\s+T-1/);

  const refused = acc(dir, ['set', 'T-2', 'running']);
  assert.equal(refused.code, 1);
  assert.match(refused.err, /waiting on T-1, which is todo/);

  assert.equal(acc(dir, ['set', 'T-1', 'running']).code, 0);
  assert.equal(acc(dir, ['set', 't-1', 'review']).code, 0, 'ids are case-insensitive');
  assert.equal(acc(dir, ['set', 'T-1', 'done', '--as', 'builder']).code, 1, 'a builder cannot mark work done');
  assert.equal(acc(dir, ['set', 'T-1', 'done']).code, 0);
  assert.deepEqual((acc(dir, ['ready', '--json']).json() as { id: string }[]).map((t) => t.id), ['T-2']);

  const show = acc(dir, ['show', 'T-1']).out;
  assert.match(show, /todo → running {2}by human:/);
  assert.match(show, /review → done/);
});

test('status: one line of counts by display state, nothing in play, and every state in --json', () => {
  const dir = repoWithConfig();
  // A claude that leaves a mark, to prove status never starts one.
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  const mark = join(dir, 'claude-ran');
  writeFileSync(join(bin, 'claude'), `#!/bin/sh\ntouch "${mark}"\n`);
  chmodSync(join(bin, 'claude'), 0o755);
  const status = (...args: string[]) => acc(dir, ['status', ...args], undefined, { PATH: `${bin}:${process.env.PATH}` });

  assert.equal(status().out.trim(), 'Nothing in play.');
  const zero = Object.fromEntries(Object.keys(DISPLAY).map((s) => [s, 0]));
  assert.deepEqual(status('--json').json(), { counts: zero });

  const ledgerPath = join(dir, '.git', 'acc', 'ledger.json');
  const put = (tasks: { title: string; deps?: string[] }[], states: Record<string, Record<string, unknown>>) => {
    acc(dir, ['import'], JSON.stringify(tasks.map((t) => ({ source: { kind: 'manual' }, ...t }))));
    const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
    for (const t of ledger.tasks) Object.assign(t, states[t.id]);
    writeFileSync(ledgerPath, JSON.stringify(ledger));
  };
  put([{ title: 'Merged' }], { 'T-1': { state: 'done' } });
  assert.equal(status().out.trim(), 'Nothing in play.', 'done is left out');

  put([{ title: 'Fails CI' }, { title: 'In review' }, { title: 'Building' }, { title: 'Next up' }, { title: 'Also next' }, { title: 'Stuck' }, { title: 'Later', deps: ['T-5'] }], {
    'T-2': { state: 'review', pr: { number: 2, url: 'https://github.com/o/r/pull/2', state: 'open', ci: 'failing' } },
    'T-3': { state: 'review' },
    'T-4': { state: 'running' },
    'T-7': { state: 'blocked', blocker: 'needs a sandbox' },
  });

  const line = status();
  assert.equal(line.code, 0, line.err);
  assert.equal(line.out, '1 running · 1 needs you · 1 in review · 1 blocked · 2 ready · 1 to do\n');
  assert.deepEqual(status('--json').json(), { counts: { ...zero, running: 1, 'needs-you': 1, review: 1, blocked: 1, ready: 2, todo: 1, done: 1 } });
  assert.ok(!existsSync(mark), 'status never starts claude');
  assert.match(acc(dir, ['help']).out, /Tasks\n(?:.+\n)*? {2}acc status /);
});

test('builders are identified from ACC_ROLE and ACC_TASK', () => {
  const dir = repoWithConfig();
  acc(dir, ['add', 'Work']);
  acc(dir, ['set', 'T-1', 'running']);
  const r = acc(dir, ['set', 'T-1', 'blocked', '--reason', 'org is down', '--json'], undefined, { ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(r.code, 0, r.err);
  assert.equal(r.json().entry.by, 'builder:T-1');
  assert.equal(r.json().task.blocker, 'org is down');
});

test('forced moves need a person and a reason, and are marked as overrides', () => {
  const dir = repoWithConfig();
  acc(dir, ['add', 'Work']);
  assert.match(acc(dir, ['set', 'T-1', 'done']).err, /A human can't move a task from todo to done/);
  assert.match(acc(dir, ['set', 'T-1', 'done', '--force']).err, /needs --reason/);
  const r = acc(dir, ['set', 'T-1', 'done', '--force', '--reason', 'finished by hand', '--json']);
  assert.equal(r.code, 0);
  assert.equal(r.json().entry.override, true);
});

test('import adds and refreshes tasks from tracker JSON', () => {
  const dir = repoWithConfig();
  const items = [
    { source: { kind: 'github', key: '#3', url: 'https://github.com/o/r/issues/3' }, title: 'Login page', deps: ['#2'] },
    { source: { kind: 'github', key: '#2' }, title: 'Auth service' },
  ];
  const first = acc(dir, ['import', '--json'], JSON.stringify(items)).json();
  assert.deepEqual(first.added, ['GH-3', 'GH-2']);
  items[0]!.title = 'Login page v2';
  const file = join(dir, 'tasks.json');
  writeFileSync(file, JSON.stringify(items));
  const again = acc(dir, ['import', '--file', file, '--json']).json();
  assert.deepEqual(again.updated, ['GH-3']);
  assert.deepEqual(again.unchanged, ['GH-2']);
  assert.equal(acc(dir, ['import'], '{"not":"a list"}').code, 2);
});

test('intake github reads open issues as the repo\'s account and upserts them', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, github: { repo: 'o/r', account: 'me' } });
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  const issues = JSON.stringify([{ number: 4, title: 'Fix login', body: 'Depends on #3', url: 'https://github.com/o/r/issues/4', labels: [] }]);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
case "$1 $2" in
  "auth token") [ "$4" = "me" ] && echo tok-me || exit 1 ;;
  "issue list") [ "$GH_TOKEN" = "tok-me" ] || { echo "wrong account" >&2; exit 1; }; echo '${issues}' ;;
  *) exit 1 ;;
esac
`);
  chmodSync(join(bin, 'gh'), 0o755);
  const r = acc(dir, ['intake', 'github', '--json'], undefined, { PATH: `${bin}:${process.env.PATH}` });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(r.json().added, ['GH-4']);
  assert.equal(acc(dir, ['intake', 'jira']).code, 2, 'Jira intake needs the Command Center\'s report');
});

test('acc intake jira --file follows tickets that left the place: removes a task never started, names one that did, in the same shape as github (D-072)', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', epic: 'ACME-3' }] });
  const items = ['ACME-7', 'ACME-8', 'ACME-9'].map((key) => ({ source: { kind: 'jira', key }, title: key }));
  assert.equal(acc(dir, ['import'], JSON.stringify(items)).code, 0);
  assert.equal(acc(dir, ['set', 'ACME-8', 'running']).code, 0);
  const file = join(dir, 'outside.json');
  writeFileSync(file, JSON.stringify({ outside: [{ key: 'ACME-7', why: 'it isn\'t in epic ACME-3' }, { key: 'ACME-8', why: 'it\'s in project OPS' }] }));
  const text = acc(dir, ['intake', 'jira', '--file', file]);
  assert.equal(text.code, 0, text.err);
  assert.deepEqual(text.out.trim().split('\n'), [
    'Removed ACME-7: their tickets left this repo\'s place before work started',
    '! ACME-8 left this repo\'s place: it\'s in project OPS; ACME-8 is still running',
  ]);
  const json = acc(dir, ['intake', 'jira', '--file', file, '--json']).json();
  assert.deepEqual(Object.keys(json).sort(), ['added', 'closed', 'errors', 'left', 'leftAlone', 'removed', 'unchanged', 'updated'], 'the shape acc intake github gives');
  assert.deepEqual([json.removed, json.leftAlone.map((l: { task: string }) => l.task)], [[], ['ACME-8']], 'removed once; the started one is named again');
  assert.deepEqual((acc(dir, ['list', '--json']).json() as { id: string }[]).map((t) => t.id), ['ACME-8', 'ACME-9']);

  writeFileSync(file, '{"outside": [{"key": 7}]}');
  assert.equal(acc(dir, ['intake', 'azure', '--file', file]).code, 2, 'a report in the wrong shape');
  assert.match(acc(dir, ['help']).out, /acc intake jira\|azure\|monday\|slack --file <report\.json>/);
});

test('acc intake monday --file follows items that left the board or its group: removes a task never started, names one that did (D-072)', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, trackers: [{ kind: 'monday', account: 'acme', board: 1234567890, group: 'topics' }] });
  const items = ['MON-101', 'MON-102', 'MON-1234567890123'].map((key) => ({ source: { kind: 'monday', key, url: `https://acme.monday.com/boards/1234567890/pulses/${key.slice(4)}` }, title: key }));
  const added = acc(dir, ['import', '--json'], JSON.stringify(items));
  assert.equal(added.code, 0, added.err);
  assert.deepEqual(added.json().added, ['MON-101', 'MON-102', 'MON-1234567890123'], 'an item id too big for 32 bits is a task id like any other');
  assert.equal(acc(dir, ['set', 'MON-102', 'running']).code, 0);
  const file = join(dir, 'outside.json');
  writeFileSync(file, JSON.stringify({ outside: [{ key: 'MON-101', why: 'it\'s in group Backlog' }, { key: 'MON-102', why: 'it\'s on board Other client' }] }));
  const text = acc(dir, ['intake', 'monday', '--file', file]);
  assert.equal(text.code, 0, text.err);
  assert.deepEqual(text.out.trim().split('\n'), [
    'Removed MON-101: their tickets left this repo\'s place before work started',
    '! MON-102 left this repo\'s place: it\'s on board Other client; MON-102 is still running',
  ]);
  assert.deepEqual((acc(dir, ['list', '--json']).json() as { id: string }[]).map((t) => t.id), ['MON-102', 'MON-1234567890123']);
  const events = readFileSync(join(dir, '.git', 'acc', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { type: string; task?: string; id?: string });
  assert.deepEqual(events.filter((e) => e.type === 'task.removed').map((e) => e.task ?? e.id), ['MON-101'], 'the events log says it left');
});

test('acc import refuses a Jira or Azure DevOps ticket no tracker owns, so another project\'s never becomes a task here (D-072)', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME' }, { kind: 'azure', organization: 'acme', project: 'CRM', prefix: 'AV' }] });
  const items = [
    { source: { kind: 'jira', key: 'ACME-12' }, title: 'Ours' }, { source: { kind: 'jira', key: 'OPS-1' }, title: 'Another client\'s' },
    { source: { kind: 'azure', key: 'AV-3' }, title: 'Ours too' }, { source: { kind: 'jira', key: 'AV-4' }, title: 'An Azure key sent as Jira' },
    { source: { kind: 'github', key: '#5' }, title: 'A GitHub issue' }, { source: { kind: 'manual' }, title: 'Kept by acc' },
  ];
  const r = acc(dir, ['import', '--json'], JSON.stringify(items));
  assert.equal(r.code, 1);
  assert.deepEqual(r.json().added, ['ACME-12', 'AV-3', 'GH-5', 'T-1']);
  assert.deepEqual(r.json().errors, [
    'OPS-1: no Jira tracker in .acc/config.json owns it, so it isn\'t one of this repo\'s tickets.',
    'AV-4: no Jira tracker in .acc/config.json owns it, so it isn\'t one of this repo\'s tickets.',
  ]);
  // A repo that names no trackers has no place to hold to.
  assert.equal(acc(repoWithConfig(), ['import'], JSON.stringify([{ source: { kind: 'jira', key: 'OPS-1' }, title: 'x' }])).code, 0);
});

test('acc import refuses a monday.com item no monday.com tracker owns (D-072)', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME' }, { kind: 'monday', account: 'acme', board: 111, prefix: 'CW' }] });
  const items = [
    { source: { kind: 'monday', key: 'CW-101' }, title: 'Ours' }, { source: { kind: 'monday', key: 'MON-5' }, title: 'Another board\'s, keyed MON' },
    { source: { kind: 'monday', key: 'ACME-3' }, title: 'A Jira key sent as monday.com' }, { source: { kind: 'jira', key: 'CW-7' }, title: 'A monday.com key sent as Jira' },
  ];
  const r = acc(dir, ['import', '--json'], JSON.stringify(items));
  assert.equal(r.code, 1);
  assert.deepEqual(r.json().added, ['CW-101']);
  assert.deepEqual(r.json().errors, [
    'MON-5: no monday.com tracker in .acc/config.json owns it, so it isn\'t one of this repo\'s tickets.',
    'ACME-3: no monday.com tracker in .acc/config.json owns it, so it isn\'t one of this repo\'s tickets.',
    'CW-7: no Jira tracker in .acc/config.json owns it, so it isn\'t one of this repo\'s tickets.',
  ]);
  const jiraOnly = repoWithConfig({ ...GENERIC_CONFIG, trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME' }] });
  assert.match(acc(jiraOnly, ['import', '--json'], JSON.stringify([{ source: { kind: 'monday', key: 'MON-1' }, title: 'x' }])).json().errors[0], /^MON-1: no monday\.com tracker/);
});

test('intake github moves closed issues\' tasks to done, removes skipped ones, and names those that started', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, github: { repo: 'o/r', account: 'me' }, trackers: [{ kind: 'github', skipLabels: ['milestone'] }] });
  const items = [3, 5, 6].map((n) => ({ source: { kind: 'github', key: `#${n}` }, title: `Issue ${n}` }));
  assert.equal(acc(dir, ['import'], JSON.stringify(items)).code, 0);
  assert.equal(acc(dir, ['set', 'GH-6', 'running']).code, 0);
  const bin = join(dir, '.fakebin');
  mkdirSync(bin);
  const issues = JSON.stringify([{ number: 3, title: 'M3', body: '', url: 'u3', labels: [{ name: 'milestone' }] }, { number: 4, title: 'Issue 4', body: '', url: 'u4', labels: [] }]);
  writeFileSync(join(bin, 'gh'), `#!/bin/sh
case "$1 $2" in
  "auth token") echo tok ;;
  "issue list") echo '${issues}' ;;
  "issue view") echo "{\\"number\\": $3, \\"state\\": \\"CLOSED\\", \\"labels\\": []}" ;;
  *) exit 1 ;;
esac
`);
  chmodSync(join(bin, 'gh'), 0o755);
  const env = { PATH: `${bin}:${process.env.PATH}` };
  const text = acc(dir, ['intake', 'github'], undefined, env);
  assert.equal(text.code, 0, text.err);
  assert.deepEqual(text.out.trim().split('\n'), [
    'Added GH-4',
    'Done GH-5: closed on GitHub before work started',
    'Removed GH-3: their issues have a label in skipLabels',
    '! #6 was closed on GitHub; GH-6 is still running',
  ]);
  const json = acc(dir, ['intake', 'github', '--json'], undefined, env).json();
  assert.deepEqual([json.closed, json.removed, json.unchanged], [[], [], ['GH-4']]);
  assert.deepEqual(json.leftAlone, [{ task: 'GH-6', issue: '#6', state: 'running', note: '#6 was closed on GitHub; GH-6 is still running' }]);
  assert.deepEqual((acc(dir, ['list', '--json']).json() as { id: string; state: string }[]).map((t) => `${t.id} ${t.state}`), ['GH-5 done', 'GH-6 running', 'GH-4 todo']);
});

test('edit: changes a task\'s fields, records who edited them, and says what changed in --json', () => {
  const dir = repoWithConfig(UNCHECKED);
  assert.equal(acc(dir, ['add', 'First thing', '--label', 'ui']).code, 0);
  assert.equal(acc(dir, ['add', 'Second thing']).code, 0);
  const r = acc(dir, ['edit', 't-2', '--title', 'Second, clearer', '--brief', '## Goal\n\nDo it.', '--dep', 'T-1', '--label', 'a,b', '--notes', 'Mind the cache.', '--json', '--by', 'pat']);
  assert.equal(r.code, 0, r.err);
  const out = r.json() as { changed: string[]; task: { title: string; brief: string; deps: string[]; labels: string[]; notes: string; edits: { by: string; fields: string[] }[] } };
  assert.deepEqual(out.changed, ['title', 'brief', 'deps', 'labels', 'notes']);
  assert.equal(out.task.brief, '## Goal\n\nDo it.');
  assert.deepEqual(out.task.deps, ['T-1']);
  assert.deepEqual(out.task.labels, ['a', 'b']);
  assert.deepEqual(out.task.edits.map((e) => e.by), ['pat']);
  assert.match(acc(dir, ['edit', 'T-2', '--notes', 'Mind the cache.']).out, /T-2: nothing to change/);
  assert.match(acc(dir, ['edit', 'T-2', '--dep', '']).out, /T-2: changed its dependencies\./, 'edge: an empty --dep clears the list');
  const show = acc(dir, ['show', 'T-2']).out;
  assert.match(show, /Notes for the builder:\nMind the cache\./);
  assert.match(show, /edited its title, description, dependencies, labels, notes for the builder {2}by pat/);
  assert.deepEqual((acc(dir, ['show', 'T-1', '--json']).json() as { labels: string[] }).labels, ['ui'], 'acc add takes --label');
  const events = readFileSync(join(dir, '.git', 'acc', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { type: string; data: Record<string, unknown> });
  assert.deepEqual(Object.keys(events.filter((e) => e.type === 'task.updated')[0]!.data), ['title', 'brief', 'deps', 'labels', 'notes']);
  assert.match(acc(dir, ['help']).out, /acc edit <id> \[--title <text>\]/);
});

test('edit: refused while a builder runs, once done, with no field, and for a bad environment (edge: refusals)', () => {
  const dir = repoWithConfig(UNCHECKED);
  assert.equal(acc(dir, ['add', 'A thing']).code, 0);
  const none = acc(dir, ['edit', 'T-1']);
  assert.notEqual(none.code, 0);
  assert.match(none.err, /needs a field to change/);
  const env = acc(dir, ['edit', 'T-1', '--env', 'nowhere']);
  assert.notEqual(env.code, 0);
  assert.match(env.err, /isn't in the config/);
  assert.equal(acc(dir, ['set', 'T-1', 'running']).code, 0);
  const running = acc(dir, ['edit', 'T-1', '--title', 'New', '--json']);
  assert.equal(running.code, 1);
  assert.match(running.err + running.out, /builder is working from the brief it was given/);
  assert.equal(acc(dir, ['set', 'T-1', 'review']).code, 0);
  assert.equal(acc(dir, ['edit', 'T-1', '--title', 'New']).code, 0, 'review allows it');
  const builder = acc(dir, ['edit', 'T-1', '--title', 'Mine'], undefined, { ACC_ROLE: 'builder', ACC_TASK: 'T-1' });
  assert.equal(builder.code, 1);
  assert.match(builder.err, /Only a person edits T-1/);
  assert.equal(acc(dir, ['set', 'T-1', 'done']).code, 0);
  assert.match(acc(dir, ['edit', 'T-1', '--title', 'Later']).err, /It is done/);
  assert.equal((acc(dir, ['show', 'T-1', '--json']).json() as { title: string }).title, 'New');
});

test('edit: a tracker task\'s title is refused, and its environment and notes are a person\'s', () => {
  const dir = repoWithConfig(UNCHECKED);
  assert.equal(acc(dir, ['import'], JSON.stringify([{ source: { kind: 'jira', key: 'ACME-4', url: 'https://acme.example/browse/ACME-4' }, title: 'From Jira' }])).code, 0);
  const title = acc(dir, ['edit', 'ACME-4', '--title', 'Mine']);
  assert.equal(title.code, 1);
  assert.match(title.err, /Jira ticket owns its title/);
  assert.equal(acc(dir, ['edit', 'ACME-4', '--notes', 'Ask first.']).code, 0);
  assert.equal(acc(dir, ['import'], JSON.stringify([{ source: { kind: 'jira', key: 'ACME-4', url: 'https://acme.example/browse/ACME-4' }, title: 'Renamed in Jira' }])).code, 0);
  const t = acc(dir, ['show', 'ACME-4', '--json']).json() as { title: string; notes: string };
  assert.equal(t.title, 'Renamed in Jira');
  assert.equal(t.notes, 'Ask first.', 'intake keeps the notes');
});

test('acc intake jira --file keeps the sprint a board shows as its tracker\'s last, and refuses a sprint in the wrong shape or for another tracker (T-78)', () => {
  const dir = repoWithConfig({ ...GENERIC_CONFIG, trackers: [{ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', sprint: 'active' }] });
  const file = join(dir, 'outside.json');
  const seen = { sprints: [{ id: 13, name: 'Sprint 13' }], open: ['ACME-1'], at: '2026-10-20T09:00:00.000Z' };
  writeFileSync(file, JSON.stringify({ outside: [], sprint: { tracker: 'jira acme.atlassian.net ACME first', seen } }));
  const r = acc(dir, ['intake', 'jira', '--file', file]);
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out.trim(), 'Nothing to do.', 'nothing outside, and the sprint kept quietly');
  const kept = JSON.parse(readFileSync(join(dir, '.git', 'acc', 'sprints.json'), 'utf8'));
  assert.deepEqual(kept, { 'jira acme.atlassian.net ACME first': seen }, 'beside the ledger, not in the repo');

  for (const sprint of [{ tracker: 'x' }, { tracker: 7, seen }, { tracker: 'x', seen: { ...seen, open: [3] } }]) {
    writeFileSync(file, JSON.stringify({ outside: [], sprint }));
    const bad = acc(dir, ['intake', 'jira', '--file', file]);
    assert.equal(bad.code, 2, JSON.stringify(sprint));
    assert.match(bad.err, /"sprint" must be \{ "tracker"/);
  }
  writeFileSync(file, JSON.stringify({ outside: [], sprint: { tracker: 'x', seen } }));
  assert.equal(acc(dir, ['intake', 'azure', '--file', file]).code, 2, 'only a Jira board has sprints');
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, '.git', 'acc', 'sprints.json'), 'utf8'))), ['jira acme.atlassian.net ACME first'], 'a refused one keeps nothing');
});
