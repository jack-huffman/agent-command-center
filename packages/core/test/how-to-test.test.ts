// How to test it (T-161): a builder's note can end with how a person tests the change in its org. acc done takes
// it with --test, keeps it with the run, checks its limits and its wording as the other parts, and a Salesforce
// builder's packet says to give it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseConfig } from '../src/config.ts';
import { applyMove, checkMove, emptyLedger, type Ledger, noGateHooks, NOTE_ALL, NOTE_LABELS, noteGiven, noteInput, noteMarkdown, noteProblems, upsertTasks } from '../src/ledger.ts';
import { doneLines, noteWording } from '../src/note-wording.ts';
import { renderPacket, SF_TEST_NOTE, TEST_STEPS } from '../src/packet.ts';
import { rulesText } from '../src/rules.ts';
import { GENERIC_CONFIG, makeRepo, SF_CONFIG } from './support.ts';

const config = parseConfig(JSON.parse(JSON.stringify(SF_CONFIG))).config!;
const clock = () => new Date('2026-10-30T12:00:00Z');

function running(): Ledger {
  const l = emptyLedger();
  upsertTasks(l, config, [{ source: { kind: 'jira', key: 'ACME-1' }, title: 'One' }], 'human', 'human:test', () => {}, clock);
  l.tasks[0]!.state = 'running';
  l.tasks[0]!.run = { branch: 'task/ACME-1', startedAt: '2026-10-30T11:00:00Z' };
  return l;
}

test('a note\'s How to test it lines are taken as the other parts are: one each, whitespace collapsed, none for nothing (T-161)', () => {
  assert.deepEqual(NOTE_ALL, ['landed', 'moved', 'open', 'test']);
  assert.equal(NOTE_LABELS.test, 'How to test it');
  assert.deepEqual(noteInput({ landed: ['A'], test: ['  Open an  Account. ', ''] }), { landed: ['A'], test: ['Open an Account.'] });
  assert.deepEqual(noteInput({ test: ['none'] }), { test: [] });
  assert.equal(noteGiven({ test: ['Open an Account.'] }), true, 'a note with only How to test it is a note');
});

test('edge case: How to test it is never required, and keeps to the limits of every part (T-161)', () => {
  assert.deepEqual(noteProblems({ landed: ['A'], moved: [], open: [] }, true), [], 'a note without it is still whole');
  assert.match(noteProblems({ landed: ['A'], moved: [], open: [], test: Array.from({ length: 11 }, (_, i) => `Step ${i}.`) }, true).join(), /--test has 11 lines\. It takes at most 10/);
  assert.match(noteProblems({ landed: ['A'], moved: [], open: [], test: ['x'.repeat(301)] }, true).join(), /A line in the note's --test is over 300 characters/);
});

test('acc done keeps How to test it with the run that ended; a note without it keeps none (T-161)', () => {
  const l = running();
  const t = l.tasks[0]!;
  assert.deepEqual(checkMove(l, config, t, { to: 'review', actor: 'builder', by: 'builder:ACME-1', note: { landed: ['A'], moved: [], open: [], test: ['Open an Account.'] } }, noGateHooks), []);
  applyMove(t, { to: 'review', actor: 'builder', by: 'builder:ACME-1', note: { landed: ['A'], moved: [], open: [], test: ['Open an Account.', 'The page shows the discount.'] } }, () => {}, clock);
  assert.deepEqual(t.run!.note!.test, ['Open an Account.', 'The page shows the discount.']);
  const other = running().tasks[0]!;
  applyMove(other, { to: 'review', actor: 'builder', by: 'builder:ACME-1', note: { landed: ['A'], moved: [], open: [], test: [] } }, () => {}, clock);
  assert.equal('test' in other.run!.note!, false, 'edge case: none given, none kept');
});

test('the note\'s markdown shows How to test it after Still open, only where it was given (T-161)', () => {
  const given = noteMarkdown({ landed: ['A'], moved: [], open: [], test: ['Open an Account.'] });
  assert.deepEqual(given.slice(-3), ['**How to test it**', '', '- Open an Account.']);
  assert.ok(!noteMarkdown({ landed: ['A'], moved: [], open: [] }).includes('**How to test it**'), 'edge case: without it, no empty part');
});

test('the wording check reads each How to test it line as it reads the other parts (D-230, T-161)', () => {
  const lines = doneLines({ landed: ['It adds the field.'], test: ['Open an Account.', 'Kick off the import.'] });
  assert.deepEqual(lines.map((l) => l.where), ['What landed 1', 'How to test it 1', 'How to test it 2']);
  assert.deepEqual(noteWording(lines).map((f) => f.where), ['How to test it 2'], 'a phrasal verb in a test line fails as it would anywhere');
});

test('a Salesforce builder\'s packet says to end the note with How to test it; a generic builder\'s doesn\'t (T-161)', () => {
  const packet = (raw: unknown): string => {
    const c = parseConfig(raw).config!;
    const repo = makeRepo({ '.acc/config.json': JSON.stringify(raw), '.acc/rules.md': '' });
    const l = emptyLedger();
    upsertTasks(l, c, [{ source: { kind: 'manual', key: 'T-1' }, title: 'Add a thing', brief: 'b' }], 'human', 'human:test', () => {}, clock);
    return renderPacket({ task: l.tasks[0]!, config: c, env: c.environments.find((e) => e.default)!, worktree: '/w', branch: 'b', rules: rulesText(repo, c.profile), environmentSpecific: [] });
  };
  const sf = packet(SF_CONFIG);
  assert.ok(sf.includes(SF_TEST_NOTE));
  assert.ok(sf.indexOf(SF_TEST_NOTE) > sf.indexOf('## The finish line'), 'in the finish line, beside the note');
  assert.match(SF_TEST_NOTE, /--test "<step>"/);
  // The steps the Testing tab draws: 3 to 7, numbered, each naming at most one component so the tab can link it.
  assert.deepEqual(TEST_STEPS, { min: 3, max: 7 });
  assert.ok(SF_TEST_NOTE.includes('3 to 7 numbered steps'), SF_TEST_NOTE);
  assert.ok(SF_TEST_NOTE.includes('Each step names at most one component, by its API name'));
  assert.ok(/where to go, what to do there, and what they see when it works/.test(SF_TEST_NOTE));
  assert.ok(!packet(GENERIC_CONFIG).includes('How to test it'), 'edge case: no org, no list');
});
