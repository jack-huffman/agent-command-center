// A ticket's changes field, drafted as an update (T-105, D-066): acc drafts the field's new text when the
// ticket's changes change, one open draft per ticket, and only writes a draft: nothing reaches a tracker. The
// same changes again draft nothing, before the save and after it; a tracker with no field, a Slack task and a
// task with no changes get none. acc change record drafts it from the command line.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { KEPT_HEADING, keptLines, withKept } from '../src/changes-field.ts';
import { type Config, parseConfig } from '../src/config.ts';
import { run } from '../src/exec.ts';
import { changesFieldOf, draftChangesField, writtenFor } from '../src/field-drafts.ts';
import { mutate, readLedger, upsertTasks } from '../src/ledger.ts';
import { recordOutside } from '../src/outside-changes.ts';
import { repoPaths } from '../src/paths.ts';
import { RECORD_KIND, type RecordChange } from '../src/records.ts';
import { claimUpdate, listUpdates, markPosted } from '../src/updates.ts';
import { gitIn, makeRepo, SF_CONFIG } from './support.ts';

const MAIN = fileURLToPath(new URL('../../cli/src/main.ts', import.meta.url));
const NOTES = { id: 'customfield_10042', name: 'Deployment Notes', format: 'adf' as const };
const JIRA = { kind: 'jira', site: 'acme.atlassian.net', project: 'ACME', changesField: NOTES };
const RENAME: RecordChange = { object: 'Account', action: 'update', match: [{ field: 'Name', value: 'Acme Corp' }], fields: [{ field: 'Name', from: null, to: 'Acme Corporation' }] };
const REGION: RecordChange = { object: 'Region__c', action: 'create', match: [{ field: 'Code__c', value: 'EMEA' }], fields: [{ field: 'Name', from: null, to: 'Europe' }] };
const person = { actor: 'human' as const, by: 'human:jordan' };
const CLS = 'force-app/main/default/classes/CaseRouting.cls';

/** A clock that moves a second each time it's read. */
function clock() {
  let t = Date.parse('2026-10-22T10:00:00Z');
  return () => new Date((t += 1000));
}

/**
 * A Salesforce repo whose tracker is `tracker`, with ACME-12 from it running on a branch that adds a class,
 * and T-9 that acc alone keeps.
 */
function repo(tracker: Record<string, unknown> = JIRA) {
  const raw = { ...SF_CONFIG, trackers: [tracker] };
  const root = realpathSync(makeRepo({ '.acc/config.json': JSON.stringify(raw) }));
  const config = parseConfig(raw).config as Config;
  const env = config.environments.find((e) => e.default)!.branch;
  gitIn(root, 'branch', env);
  gitIn(root, 'checkout', '-q', '-b', 'task/ACME-12-route', env);
  gitIn(root, 'commit', '-q', '--allow-empty', '-m', 'start');
  run('mkdir', ['-p', join(root, 'force-app/main/default/classes')]);
  run('sh', ['-c', `printf 'class' > ${CLS}`], { cwd: root });
  gitIn(root, 'add', '-A');
  gitIn(root, 'commit', '-q', '-m', 'route');
  gitIn(root, 'checkout', '-q', 'main');
  const paths = repoPaths(root, run);
  const now = clock();
  const key = tracker.kind === 'slack' ? 'SL-1' : 'ACME-12';
  mutate(paths, now, (l, emit) => {
    upsertTasks(l, config, [{ source: { kind: tracker.kind as 'jira', key, url: null }, title: 'Route premium cases' }, { source: { kind: 'manual', key: 'T-9' }, title: 'Mine' }], 'human', 'human:test', emit, now);
    const t = l.tasks.find((x) => x.id === key)!;
    t.state = 'running';
    t.environment = env;
    t.run = { worktree: '', branch: 'task/ACME-12-route', sessionId: 's' };
  });
  return { root, paths, config, now, key };
}

test('a ticket\'s changes change: acc drafts the field\'s new text as an update, the branch\'s metadata and its record changes, and writes nothing else', () => {
  const r = repo();
  recordOutside(r.paths, r.now, 'ACME-12', RECORD_KIND, RENAME, 'The brand changed', person, { profile: 'salesforce', keys: [] });
  const u = draftChangesField(r.paths, run, r.config, 'ACME-12', 'acc change', r.now)!;
  assert.equal(u.event, 'changes');
  assert.deepEqual(u.field, NOTES);
  assert.deepEqual([u.state, u.tracker, u.key, u.by], ['draft', 'jira', 'ACME-12', 'acc change']);
  assert.match(u.text, /^\*\*Apex Class\*\*\n\n- CaseRouting\n\n\*\*Record changes\*\*\n\n- Account 'Acme Corp': Name → 'Acme Corporation'\n\nAs of 22 Oct 2026\.$/);
  assert.deepEqual(listUpdates(r.paths).map((x) => x.id), [u.id], 'one draft, and nothing posted');
  assert.deepEqual(writtenFor(listUpdates(r.paths), 'ACME-12'), [u.text]);
});

test('edge: the same changes again draft nothing; a new change replaces the open draft; once saved, the same changes draft nothing until they change', () => {
  const r = repo();
  const first = draftChangesField(r.paths, run, r.config, 'ACME-12', 'acc land', r.now)!;
  assert.equal(draftChangesField(r.paths, run, r.config, 'ACME-12', 'acc land', r.now), null, 'nothing new: no second draft');
  recordOutside(r.paths, r.now, 'ACME-12', RECORD_KIND, REGION, 'EMEA opens', person, { profile: 'salesforce', keys: [] });
  const second = draftChangesField(r.paths, run, r.config, 'ACME-12', 'acc change', r.now)!;
  assert.deepEqual(second.replaces, [first.id]);
  assert.deepEqual(listUpdates(r.paths).map((x) => [x.id, x.state]), [[second.id, 'draft']], 'one open draft per ticket');
  claimUpdate(r.paths, second.id, 'human:jordan', r.now);
  markPosted(r.paths, second.id, { by: 'human:jordan', text: second.text }, r.now);
  assert.equal(draftChangesField(r.paths, run, r.config, 'ACME-12', 'acc sync', r.now), null, 'saved, and the same: nothing to draft');
  recordOutside(r.paths, r.now, 'ACME-12', RECORD_KIND, { ...REGION, match: [{ field: 'Code__c', value: 'APAC' }] }, 'APAC too', person, { profile: 'salesforce', keys: [] });
  assert.ok(draftChangesField(r.paths, run, r.config, 'ACME-12', 'acc change', r.now), 'changed again: a new draft');
});

test('edge: no field named, a Slack task, a task acc alone keeps, an unknown task, and a ticket with no changes get no draft', () => {
  const none = repo({ kind: 'jira', site: 'acme.atlassian.net', project: 'ACME' });
  assert.equal(draftChangesField(none.paths, run, none.config, 'ACME-12', 'acc land', none.now), null);
  const r = repo();
  assert.equal(draftChangesField(r.paths, run, r.config, 'T-9', 'acc land', r.now), null);
  assert.equal(draftChangesField(r.paths, run, r.config, 'NOPE-1', 'acc land', r.now), null);
  assert.equal(changesFieldOf(r.config, { id: 'SL-1', source: { kind: 'slack', key: 'SL-1', url: null } }), null, 'Slack has no fields');
  assert.deepEqual(changesFieldOf(r.config, { id: 'ACME-12', source: { kind: 'jira', key: 'ACME-12', url: null } }), NOTES);
  mutate(r.paths, r.now, (l, emit) => {
    const t = l.tasks.find((x) => x.id === 'ACME-12')!;
    t.run = null;
    t.state = 'todo';
    emit({ type: 'task.updated', task: t.id, actor: 'human', by: 'human:test', data: {} });
  });
  assert.equal(draftChangesField(r.paths, run, r.config, 'ACME-12', 'acc land', r.now), null, 'before there\'s work');
  assert.equal(listUpdates(r.paths).length, 0);
});

test('acc change record drafts the field\'s new text from the command line, and acc update post won\'t post it as a comment', () => {
  const r = repo();
  const acc = (args: string[]) => spawnSync(process.execPath, ['--no-warnings', MAIN, ...args], { cwd: r.root, encoding: 'utf8', env: { ...process.env, ACC_ROLE: '', ACC_TASK: '' } });
  const rec = acc(['change', 'record', 'ACME-12', '--object', 'Account', '--match', 'Name=Acme Corp', '--set', 'Name=Acme Corporation', '--why', 'The brand changed']);
  assert.equal(rec.status, 0, rec.stderr);
  const [u] = listUpdates(r.paths);
  assert.equal(u?.event, 'changes');
  assert.match(u!.text, /Record changes/);
  const post = acc(['update', 'post', u!.id]);
  assert.notEqual(post.status, 0);
  assert.match(post.stderr + post.stdout, /not a comment\. Save it from the Command Center/);
  assert.equal(readLedger(r.paths.ledger).tasks.find((t) => t.id === 'ACME-12')!.state, 'running');
});

// ---------------------------------------------------------------- what a person wrote in the field

const HAND = 'Escalation Rules: Case\n\nAfter the deploy, turn on the Premium escalation rule in Setup.';
const OURS = '**Apex Class**\n\n- CaseRouting\n\n**Escalation Rules**\n\n- Case\n\nAs of 22 Oct 2026.';

test('a person\'s lines are kept: each line of the field the Command Center didn\'t write, marked as kept from the ticket, before the date', () => {
  assert.deepEqual(keptLines(HAND, [OURS]), ['Escalation Rules: Case', 'After the deploy, turn on the Premium escalation rule in Setup.']);
  const offered = withKept(OURS, keptLines(HAND, [OURS]));
  assert.equal(offered, [
    '**Apex Class**', '', '- CaseRouting', '', '**Escalation Rules**', '', '- Case', '',
    `**${KEPT_HEADING}**`, '', 'Escalation Rules: Case', '', 'After the deploy, turn on the Premium escalation rule in Setup.', '', 'As of 22 Oct 2026.',
  ].join('\n'));
  // Saved as offered, then read back: the next draft keeps them again, and adds no second heading.
  assert.deepEqual(keptLines(offered, [OURS]), keptLines(HAND, [OURS]));
  assert.equal(withKept(offered, keptLines(offered, [OURS])), offered, 'nothing missing: as it is');
});

test('edge: the Command Center\'s own old lines and date aren\'t kept; an empty field keeps nothing; a draft edited to say a line already, or with the heading, isn\'t given it twice', () => {
  const old = '**Apex Class**\n\n- CaseRouting\n- OldClass\n\nAs of 1 Oct 2026.';
  assert.deepEqual(keptLines(old, [old]), [], 'a component taken out since isn\'t a person\'s line');
  assert.deepEqual(keptLines('', [OURS]), []);
  assert.deepEqual(keptLines('* Case\n\nAs of 3 Oct 2026.', [OURS]), [], 'another list mark, and a date, are the Command Center\'s');
  assert.equal(withKept(OURS, []), OURS);
  const edited = `${OURS.replace('As of 22 Oct 2026.', '')}After the deploy, turn on the Premium escalation rule in Setup.\n\nAs of 22 Oct 2026.`;
  assert.ok(!withKept(edited, ['After the deploy, turn on the Premium escalation rule in Setup.']).includes(KEPT_HEADING), 'said already');
  const headed = withKept(OURS, ['one']);
  assert.equal(withKept(headed, ['one', 'two']).split(KEPT_HEADING).length, 2, 'one heading');
  assert.match(withKept('- A', ['by hand']), /^- A\n\n\*\*Kept from the ticket\*\*\n\nby hand$/, 'a draft without a date line');
});
