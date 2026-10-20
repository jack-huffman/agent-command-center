// A ticket's text written from the task sheet (T-80): what Save writes, when it stops because someone
// changed the ticket after the sheet opened, how it says a failure, and the ticket's status, assignee and
// labels as the sheet shows them.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TicketText } from '../../packages/core/src/trackers/types.ts';
import { saveTicketText, SHEET_TICKET_FIELDS, sheetRows, textChanges, textConflict, type TextSaveSteps, type TicketTextBase } from '../src/model/ticket-text.ts';

const opened: TicketTextBase = { title: 'Send the welcome email once', markdown: 'It goes twice.' };

/** Save's steps, each recording that it ran: the ticket as `now` says, a write that fails with `fail`, and a refresh. */
function steps(now: TicketTextBase | Error, fail: Error | null = null, refreshFails = false) {
  const ran: string[] = [];
  const wrote: TicketText[] = [];
  const s: TextSaveSteps = {
    read: async () => { ran.push('read'); if (now instanceof Error) throw now; return now; },
    write: async (t) => { ran.push('write'); if (fail) throw fail; wrote.push(t); },
    refresh: async () => { ran.push('refresh'); if (refreshFails) throw new Error('acc refused'); },
  };
  return { s, ran, wrote };
}

test('textChanges: only the title or description a person changed, trimmed, and space at either end is no change', () => {
  assert.deepEqual(textChanges(opened, { title: ' Send the welcome email once ', markdown: 'It goes twice.\n' }), {});
  assert.deepEqual(textChanges(opened, { title: 'Send it once', markdown: 'It goes twice.' }), { title: 'Send it once' });
  assert.deepEqual(textChanges(opened, { title: opened.title, markdown: ' Twice.  ' }), { markdown: 'Twice.' });
  assert.deepEqual(textChanges(opened, { title: opened.title, markdown: '' }), { markdown: '' }, 'edge: a description cleared is a change');
});

test('textConflict: the ticket\'s text now when someone changed it, null when it is as it opened', () => {
  assert.equal(textConflict(opened, { ...opened, markdown: 'It goes twice.  ' }), null);
  assert.deepEqual(textConflict(opened, { ...opened, title: 'Theirs' }), { title: 'Theirs', markdown: opened.markdown });
  assert.deepEqual(textConflict(opened, { ...opened, markdown: '' }), { title: opened.title, markdown: '' }, 'edge: a description someone cleared');
});

test('Save reads the ticket again, writes only what changed, then refreshes the task from it', async () => {
  const { s, ran, wrote } = steps(opened);
  assert.deepEqual(await saveTicketText(s, opened, { title: 'Send it once', markdown: opened.markdown }), { ok: true, wrote: true });
  assert.deepEqual(ran, ['read', 'write', 'refresh']);
  assert.deepEqual(wrote, [{ title: 'Send it once' }]);
});

test('Save stops when the ticket changed after the sheet opened: nothing is written, and the ticket\'s text comes back to pick from', async () => {
  const theirs = { title: 'Send it once per contact', markdown: 'Log the second run.' };
  const { s, ran, wrote } = steps(theirs);
  const mine = { title: 'Send it once', markdown: 'It goes twice, and it should not.' };
  const r = await saveTicketText(s, opened, mine);
  assert.deepEqual(r, { ok: false, conflict: theirs });
  assert.deepEqual(ran, ['read'], 'no write and no refresh');
  assert.equal(wrote.length, 0);
  assert.deepEqual(mine, { title: 'Send it once', markdown: 'It goes twice, and it should not.' }, 'the person\'s text is theirs to keep: Save never changes it');
  // Keep mine: the same text saved again, checked against the ticket's text as it was just read, writes.
  const again = steps(theirs);
  assert.deepEqual(await saveTicketText(again.s, theirs, mine), { ok: true, wrote: true });
  assert.deepEqual(again.wrote, [{ title: mine.title, markdown: mine.markdown }]);
});

test('Save edge cases: nothing changed reads nothing, a ticket that already says it needs no write, and failures say why', async () => {
  const none = steps(opened);
  assert.deepEqual(await saveTicketText(none.s, opened, { ...opened }), { ok: true, wrote: false });
  assert.deepEqual(none.ran, [], 'nothing changed: the ticket isn\'t even read');
  const mine = { title: 'Send it once', markdown: opened.markdown };
  const same = steps(mine);
  assert.deepEqual(await saveTicketText(same.s, opened, mine), { ok: true, wrote: false }, 'someone made the same change: nothing to pick');
  assert.deepEqual(same.ran, ['read']);
  const unread = steps(new Error('GitHub refused me\'s login.'));
  const r1 = await saveTicketText(unread.s, opened, mine);
  assert.ok(!r1.ok && 'error' in r1 && /couldn't be read again, so nothing was written\. GitHub refused/.test(r1.error), JSON.stringify(r1));
  assert.deepEqual(unread.ran, ['read']);
  const refused = steps(opened, new Error('HTTP 422: Validation Failed'));
  const r2 = await saveTicketText(refused.s, opened, mine);
  assert.deepEqual(r2, { ok: false, error: 'Its ticket wasn\'t changed. HTTP 422: Validation Failed' });
  assert.deepEqual(refused.ran, ['read', 'write'], 'a failed write refreshes nothing');
  const stale = steps(opened, null, true);
  assert.deepEqual(await saveTicketText(stale.s, opened, mine), { ok: true, wrote: true }, 'written, so a refresh that fails leaves it to the next intake');
});

test('sheetRows: status, assignee and labels in words, each only where its tracker has the field', () => {
  const t = { status: { id: '3', name: 'In Progress', category: 'doing' as const }, assignees: [{ id: 'a', name: 'Jordan Kim' }, { id: 'b', name: 'Pat Lee' }], labels: [{ name: 'email', color: null }, { name: 'ui', color: null }] };
  assert.deepEqual(sheetRows(t).map((r) => [r.field, r.label, r.value, r.change]), [
    ['status', 'Status', 'In Progress', 'Change status'], ['assign', 'Assignees', 'Jordan Kim, Pat Lee', 'Change assignee'], ['labels', 'Labels', 'email, ui', 'Change labels'],
  ]);
  assert.deepEqual(sheetRows({ ...t, assignees: [], labels: [] }).map((r) => [r.label, r.value]), [['Status', 'In Progress'], ['Assignee', 'Nobody'], ['Labels', 'None']], 'edge: nobody and no labels');
  assert.deepEqual(sheetRows(t, []), [], 'edge: a tracker with none of them, as Slack, shows none');
  assert.deepEqual(sheetRows(t, ['status']).map((r) => r.field), ['status']);
  assert.deepEqual(SHEET_TICKET_FIELDS.map((f) => f), ['status', 'assign', 'labels'], 'the same names as the ticket page\'s actions');
});
