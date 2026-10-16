// T-43: the Connect page says why a button is off, warns about a field only once it's touched, and names
// step 3 from the tracker's description.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DESCRIPTIONS, JIRA, MONDAY, SLACK } from '../../packages/core/src/trackers/connect.ts';
import { blankConnect, connectModel, LISTS_TITLE } from '../src/model/connect.ts';
import { behaviourData, CASES, MUTANTS } from '../scripts/behaviour.ts';
import { sampleConnect } from '../scripts/fixtures/connect.ts';
import { sampleModel } from '../scripts/screenshot.ts';
import { root } from './support.ts';

const base = { root: '/Users/me/code/acme-service', projectName: 'Acme Service', ownRepo: 'acme/service', ghAccount: 'jordan-kim', from: 'tasks' as const, gitEmail: 'jordan.kim@example.com' };

test('a disabled Connect button says why: sign in, then each choice, in the order a person does them', () => {
  const m = connectModel(blankConnect(JIRA, { id: 'c1', ...base }));
  assert.equal(m.save.can, false);
  assert.equal(m.save.why?.label, 'Sign in and choose a project first.');
  assert.deepEqual([m.save.why?.icon, m.save.why?.tone], ['lock', 'neutral'], 'an icon and a word, never colour alone');
  const s = blankConnect(JIRA, { id: 'c2', ...base });
  s.signIn = { state: 'ok', who: 'Jordan Kim', error: null, again: false };
  const signed = connectModel(s);
  assert.match(signed.save.why?.label ?? '', /^Choose a project/, 'signed in: only the choices are left');
  s.pickers.project = { options: [{ value: 'ACME', label: 'ACME' }], selected: ['ACME'], state: 'ready', error: null };
  s.pickers.epic = { options: [], selected: [], state: 'ready', error: null };
  s.pickers.board = { options: [], selected: [], state: 'ready', error: null };
  const done = connectModel(s);
  assert.equal(done.save.can, done.save.why === null, 'a button that is on has no reason');
});

test('a Connect page with no project, and a test in flight, give the right reason (edge cases)', () => {
  const none = connectModel(blankConnect(JIRA, { id: 'c3', ...base, root: null }));
  assert.equal(none.signIn.canTest, false);
  assert.equal(none.signIn.why?.label, 'Choose a project first.', 'Test connection is off with no project');
  assert.match(none.save.why?.label ?? '', /^Sign in and choose a project/);
  const ready = connectModel(blankConnect(JIRA, { id: 'c4', ...base }));
  assert.equal(ready.signIn.canTest, true);
  assert.equal(ready.signIn.why, null, 'Test connection is on: nothing to explain');
  const s = blankConnect(JIRA, { id: 'c5', ...base });
  s.signIn = { state: 'testing', who: null, error: null, again: false };
  assert.equal(connectModel(s).signIn.why?.label, 'Testing the connection now.');
  s.signIn = { state: 'ok', who: 'Jordan Kim', error: null, again: false };
  s.saving = true;
  assert.equal(connectModel(s).save.why?.label, 'Saving now.');
});

test('the page draws the reason in the button\'s title and in a status line: a browser case reads the drawn page, and mutants that drop either fail it', () => {
  const c = CASES.find((x) => x.name.startsWith('connect: a button that is off'));
  assert.ok(c, 'a behaviour case opens the Connect page');
  assert.equal(MUTANTS.filter((x) => x.kills.includes(c.name)).length, 2, 'one mutant draws no status line, another no title');
  const n = CASES.find((x) => x.name.startsWith('connect: with no project chosen'));
  assert.ok(n, 'a behaviour case reads Test connection\'s drawn reason with no project (edge case)');
  assert.equal(MUTANTS.filter((x) => x.kills.includes(n.name)).length, 2, 'one mutant draws no status line beside Test connection, another no title');
  const d = behaviourData({ tasks: sampleModel('tasks', 0, 'dark'), overview: sampleModel('overview-landing', 0, 'dark'), since: sampleModel('overview-since', 0, 'dark'), ticket: sampleModel('ticket-questions', 0, 'dark'), review: sampleModel('ticket-review', 0, 'dark'), settings: sampleModel('settings-agents', 0, 'dark'), connect: sampleModel('connect-start', 0, 'dark'), agent: sampleModel('agent', 0, 'dark'), dock: sampleModel('output-changes', 0, 'dark'), pages: sampleModel('overview-pages', 0, 'dark') }, 0);
  assert.deepEqual([d.connect.save, d.connect.why, d.connect.none.testWhy], ['Connect Jira', 'Sign in and choose a project first.', 'Choose a project first.']);
});

test('Save names a required list that is hidden with no choice, and says to wait only while a list loads (T-45)', () => {
  const signed = (): ReturnType<typeof blankConnect> => {
    const s = blankConnect(MONDAY, { id: 'c-hidden', ...base });
    s.signIn = { state: 'ok', who: 'Jordan Kim', error: null, again: false };
    s.pickers.board = { options: [{ value: '1', label: 'Client work' }], selected: ['1'], state: 'ready', error: null };
    s.pickers.group = { options: [], selected: [], state: 'ready', error: null };
    return s;
  };
  const hidden = signed();
  hidden.pickers.statusColumn = { options: [{ value: 'status', label: 'Status' }], selected: [], state: 'ready', error: null };
  const m = connectModel(hidden);
  const column = m.pickers.find((p) => p.key === 'statusColumn')!;
  assert.deepEqual([column.hidden, column.required, column.selected.length], [true, true, 0], 'the list is hidden, required, and has no choice');
  assert.equal(m.save.can, false);
  assert.equal(m.save.why?.label, 'Choose a status column first.', 'it names the list, though nothing loads');
  const loading = signed();
  loading.pickers.statusColumn = { options: [], selected: [], state: 'loading', error: null };
  assert.equal(connectModel(loading).save.why?.label, 'Wait for its lists to load first.', 'a list that loads: wait');
});

test('an untouched empty field shows no warning, on every tracker; a warning shows after the person tries to go on', () => {
  for (const d of DESCRIPTIONS) {
    const m = connectModel(blankConnect(d, { id: `c-${d.kind}`, ...base }));
    assert.deepEqual(m.fields.map((f) => f.error), m.fields.map(() => null), `${d.kind}: no field warns before it is touched`);
    assert.equal(m.host.error, null, `${d.kind}: the empty site doesn't warn`);
  }
  const slack = sampleConnect('slack');
  assert.equal(slack.fields.find((f) => f.key === 'token')!.error, null, 'the Slack page as drawn: its empty token field is quiet');
  const s = blankConnect(SLACK, { id: 'c-slack', ...base });
  s.fieldErrors = { token: 'Bot token is needed.' };
  assert.equal(connectModel(s).fields.find((f) => f.key === 'token')!.error, 'Bot token is needed.', 'after Test connection, the warning shows');
});

test('step 3 is named from the description: Slack says its channel, the others keep their heading', () => {
  assert.equal(connectModel(blankConnect(SLACK, { id: 'c6', ...base })).listsTitle, 'Its channel');
  for (const d of DESCRIPTIONS.filter((x) => x.kind !== 'slack')) assert.equal(connectModel(blankConnect(d, { id: `c-${d.kind}`, ...base })).listsTitle, LISTS_TITLE, d.kind);
  assert.equal(LISTS_TITLE, 'Its tickets and board');
  const page = readFileSync(join(root, 'webview', 'connect.ts'), 'utf8');
  assert.match(page, /step\(3, m\.listsTitle,/, 'the heading comes from the model, not from the page');
});
