// Tracker boards: who a board is signed in as.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type BoardInput, columnLook, placeAdds, trackerBoard } from '../src/model/boards.ts';
import { sampleBoards, sampleGithubBoards, sampleMondayBoards } from '../scripts/fixtures/boards.ts';

test('a board says who it\'s signed in as, and whether every project on the site shares that sign-in (GH-79)', () => {
  const board = (b: Partial<BoardInput>): BoardInput => ({ index: 0, kind: 'jira', title: 'Jira · ACME', board: null, error: null, connect: null, loading: false, ...b });
  const shared = trackerBoard(board({ signedInAs: 'jordan@acme.example', signInScope: { shared: true, host: 'acme.atlassian.net' } }), [], '/r');
  assert.deepEqual(shared.signIn, { label: 'Signed in as jordan@acme.example, for every project on acme.atlassian.net', icon: 'globe', tone: 'blue' });
  const own = trackerBoard(board({ signedInAs: 'jordan@acme.example', signInScope: { shared: false, host: 'acme.atlassian.net' } }), [], '/r');
  assert.deepEqual(own.signIn, { label: 'Signed in as jordan@acme.example, for this project only', icon: 'repo', tone: 'blue' });
  assert.equal(trackerBoard(board({ signedInAs: null, signInScope: null }), [], '/r').signIn, null, 'not signed in: its error says so');
  const gh = trackerBoard(board({ kind: 'github', title: 'GitHub · acme/service', signedInAs: 'jordan-kim', signInScope: null }), [], '/r');
  assert.deepEqual([gh.signIn, gh.signedInAs], [null, 'jordan-kim'], 'GitHub signs in through gh as the repo\'s account (D-007), as before');
});

test('a board says each thing once: a repo\'s issues are "Issues" on the switch, and a place shows only when it narrows the board', () => {
  // The whole repo, which "Issues · acme/tool" already names: no place line, and the switch says Issues.
  const gh = trackerBoard(sampleGithubBoards()[0]!, [], '/r');
  assert.deepEqual([gh.title, gh.tab, gh.place, gh.signedInAs], ['Issues · acme/tool', 'GitHub board', null, 'jordan-kim']);
  // Narrowed to labels, or another board's name: the place stays, and the switch says the board's name.
  assert.equal(placeAdds('GitHub · acme/tool · labels billing or invoices', 'Issues · acme/tool'), true);
  assert.equal(placeAdds('GitHub · acme/tool', 'Issues · acme/tool'), false);
  // A GitHub Project over the whole repo, named for the app: the repo alone narrows nothing.
  assert.equal(placeAdds('GitHub · acme/tool', 'Agent Command Center'), false);
  assert.equal(placeAdds('Jira · ACME', 'ACME board'), false, 'a whole Jira project, too');
  assert.equal(placeAdds('GitHub', 'Issues · acme/tool'), true, 'a place with nothing after the tracker says it');
  const jira = trackerBoard(sampleBoards()[0]!, [], '/r');
  assert.equal(jira.tab, 'Jira board', 'named by its kind on the switch, beside the Agent board, never by its title');
  assert.ok(jira.place, 'a Jira epic narrows its board');
  assert.ok(trackerBoard(sampleMondayBoards()[0]!, [], '/r').place, 'and so does a monday.com group');
});

test('a tracker column whose name says its work waits is orange and blocked, not under way', () => {
  for (const name of ['Blocked', 'On hold', 'Stuck', 'Waiting on client', 'Impeded']) assert.deepEqual(columnLook(name, 'doing'), { icon: 'circle-slash', tone: 'orange' }, name);
  assert.deepEqual(columnLook('In Progress', 'doing'), { icon: 'sync', tone: 'blue' });
  assert.deepEqual(columnLook('Testing', 'doing'), { icon: 'sync', tone: 'blue' });
  assert.deepEqual(columnLook('Unblocked', 'doing'), { icon: 'sync', tone: 'blue' }, 'a word, not part of one');
  assert.deepEqual(columnLook('Done', 'done'), { icon: 'check', tone: 'neutral' });
});
