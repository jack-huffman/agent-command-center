// What adds and removes a project's boards (T-127): acc's commands as the extension runs them, Remove's question,
// Add another board's offer, and the page's message that says which board is on show.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accRemoveTracker, accSetTracker, ADD_ANOTHER, addAnother, removeAsk } from '../src/logic/connect.ts';
import { area } from '../src/model/boards.ts';
import { pageSource } from './support.ts';

type Call = { args: string[]; cwd: string };
const acc = (answer: { code: number; stdout: string; stderr: string }) => {
  const calls: Call[] = [];
  return { calls, run: async (args: string[], cwd: string) => { calls.push({ args, cwd }); return answer; } };
};

test('Add a board asks acc for another board with --new; a change names its place, and a plain connect neither', async () => {
  const a = acc({ code: 0, stdout: '{}', stderr: '' });
  await accSetTracker(a.run, '/r', null, { kind: 'jira' }, true);
  await accSetTracker(a.run, '/r', 2, { kind: 'jira' }, true);
  await accSetTracker(a.run, '/r', null, { kind: 'jira' });
  assert.deepEqual(a.calls.map((c) => c.args.filter((x) => x.startsWith('--') && x !== '--file' && x !== '--json')), [['--new'], ['--index'], []], 'edge case: a change is never --new, whatever it was opened as');
});

test('Remove asks acc to take the board out by its place and kind, and throws acc\'s reason when it refuses', async () => {
  const ok = acc({ code: 0, stdout: '{}', stderr: '' });
  await accRemoveTracker(ok.run, '/r', 3, 'jira');
  assert.deepEqual(ok.calls, [{ args: ['trackers', 'remove', '--index', '3', '--kind', 'jira', '--json'], cwd: '/r' }]);
  const no = acc({ code: 1, stdout: JSON.stringify({ error: 'config-changed', message: 'The trackers in .acc/config.json changed since this page opened.' }), stderr: '' });
  await assert.rejects(accRemoveTracker(no.run, '/r', 3, 'jira'), /changed since this page opened/);
});

test('Remove\'s question names the board and its project, says its tasks stay on My work, and has a button of its own', () => {
  const ask = removeAsk('Renewals', 'Acme Service');
  assert.equal(ask.message, 'Remove Renewals from Acme Service?');
  assert.match(ask.detail, /The tasks you added from it stay on My work\./);
  assert.match(ask.detail, /Nothing changes in the tracker/);
  assert.equal(ask.go, 'Remove board');
  assert.match(ask.done, /^Renewals is removed from Acme Service's settings\. Its tasks stay on My work\./);
  for (const words of Object.values(ask)) assert.ok(!/acc |\.acc\/|npm run/.test(words), `plain words (D-132): ${words}`);
});

test('a saved board\'s message offers Add another board, which opens the Connect page to add one to the same project', () => {
  assert.equal(ADD_ANOTHER, 'Add another board');
  assert.deepEqual(JSON.parse(addAnother('/r')), { root: '/r', add: true });
  const ext = pageSource('../src/extension.ts');
  assert.ok(ext.includes("executeCommand('acc.trackers.add', addAnother(root))"), 'its button runs Add a board for the project saved');
});

test('the page may say which board is on show, by its id, or none; anything else is refused', () => {
  const ok = area.messages!['board-shown']!;
  assert.ok(ok({ project: '/r', board: '0123456789ab' }));
  assert.ok(ok({ project: '/r', board: null }), 'My work or All boards');
  assert.ok(!ok({ project: '/r', board: '../x' }), 'edge case: not an id');
  assert.ok(!ok({ project: '/r', board: 'x'.repeat(65) }));
  assert.ok(!ok({ project: 7, board: null }));
  assert.ok(area.commands!.includes('acc.trackers.remove'), 'Remove is a command the page may ask for');
});
