// Tracker boards: who a board is signed in as.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type BoardInput, trackerBoard } from '../src/model/boards.ts';

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
