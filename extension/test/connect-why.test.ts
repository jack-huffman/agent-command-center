// T-43: the Connect page says why a button is off, warns about a field only once it's touched, and names
// step 3 from the tracker's description.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DESCRIPTIONS, JIRA, SLACK } from '../../packages/core/src/trackers/connect.ts';
import { blankConnect, connectModel, LISTS_TITLE } from '../src/model/connect.ts';
import { sampleConnect } from '../scripts/fixtures/connect.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
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

test('the page puts the reason in the button\'s title and in a status line beside it', () => {
  const page = readFileSync(join(root, 'webview', 'connect.ts'), 'utf8');
  assert.match(page, /testButton\.title = m\.signIn\.why\.label/);
  assert.match(page, /m\.signIn\.why \? status\(m\.signIn\.why\)/);
  assert.match(page, /save\.title = m\.save\.why\.label/);
  assert.match(page, /m\.save\.look \?\? m\.save\.why/);
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
