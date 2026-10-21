// T-90: the Command Center reads each tracker's fields in their normal form: a card's and a page's icons
// from the kind and the level, closed as not planned's own look, and who an Azure DevOps sign-in is.
import assert from 'node:assert/strict';
import test from 'node:test';
import type { Person, Ticket } from '../../packages/core/src/trackers/types.ts';
import { credWho, NAMED_SIGN_INS, signedInWho, signInName } from '../src/logic/sign-in-name.ts';
import { type BoardInput, NOT_PLANNED_LOOK, statusLook, trackerBoard } from '../src/model/boards.ts';
import { ticketModel } from '../src/model/task-page.ts';

/** A client whose me() answers, or fails, and counts how often it's asked. */
const client = (me: () => Promise<Person>) => {
  const c = { asked: 0, me: () => { c.asked++; return me(); } };
  return c;
};

test('Commenting as names the Azure DevOps person from me(), asked once per sign-in', async () => {
  assert.deepEqual(NAMED_SIGN_INS, ['slack', 'azure']);
  const c = client(async () => ({ id: 'jordan@acme.example', name: 'Jordan Kim', email: 'jordan@acme.example' }));
  const made = Promise.resolve(c);
  assert.equal(await signInName('azure', () => made), 'Jordan Kim');
  assert.equal(await signInName('azure', () => made), 'Jordan Kim');
  assert.equal(c.asked, 1, 'the same client, so the same sign-in: asked once');
  const again = client(async () => ({ id: 'pat@acme.example', name: 'Pat Lee' }));
  assert.equal(await signInName('azure', async () => again), 'Pat Lee', 'a new sign-in makes a new client, which is asked');
});

test('Commenting as keeps the token\'s words when me() fails, and asks again next time (edge case)', async () => {
  let fail = true;
  const c = client(async () => {
    if (fail) throw new Error('Azure DevOps didn\'t accept this repo\'s sign-in.');
    return { id: 'jordan@acme.example', name: 'Jordan Kim' };
  });
  const made = Promise.resolve(c);
  assert.equal(await signInName('azure', () => made), null, 'null: the caller says "a personal access token"');
  fail = false;
  assert.equal(await signInName('azure', () => made), 'Jordan Kim', 'a failure isn\'t kept');
  assert.equal(await signInName('azure', () => Promise.reject(new Error('no sign-in'))), null, 'a client that can\'t start');
  assert.equal(await signInName('azure', async () => client(async () => ({ id: '', name: '' }))), null, 'a person with no name');
});

test('edge case: when Azure DevOps\'s me() fails, Commenting as says "a personal access token" for a token, and the account for a Microsoft sign-in (T-94)', async () => {
  const failing = async () => client(async () => { throw new Error('Azure DevOps didn\'t accept this repo\'s sign-in.'); });
  assert.equal(await signedInWho('azure', { kind: 'azure', method: 'pat' }, failing), 'a personal access token');
  assert.equal(await signedInWho('azure', { kind: 'azure', method: 'microsoft', account: { label: 'jordan@acme.example' } }, failing), 'jordan@acme.example');
  assert.equal(await signedInWho('azure', { kind: 'azure', method: 'pat' }, () => Promise.reject(new Error('no sign-in'))), 'a personal access token', 'a client that can\'t start');
  assert.equal(await signedInWho('azure', { kind: 'azure', method: 'pat' }, async () => client(async () => ({ id: 'x', name: 'Jordan Kim' }))), 'Jordan Kim', 'a me() that answers names the person');
  // Every other sign-in's own words.
  assert.equal(credWho({ kind: 'jira', email: 'jordan@acme.example' }), 'jordan@acme.example');
  assert.equal(credWho({ kind: 'monday' }), 'a personal API token');
  assert.equal(credWho({ kind: 'slack' }), 'a Slack app\'s bot token');
  assert.equal(await signedInWho('jira', { kind: 'jira', email: 'jordan@acme.example' }, failing), 'jordan@acme.example', 'Jira never asks its client');
});

test('Commenting as asks no client for a tracker whose sign-in words say who it is (edge case)', async () => {
  for (const kind of ['jira', 'monday', 'github'] as const) {
    let made = 0;
    assert.equal(await signInName(kind, async () => { made++; return client(async () => ({ id: 'x', name: 'X' })); }), null, kind);
    assert.equal(made, 0, `${kind}: its client isn't made`);
  }
});

test('the ticket page\'s status: closed as not planned has its own look, beside the category\'s (edge case)', () => {
  assert.deepEqual(NOT_PLANNED_LOOK, { icon: 'circle-slash', tone: 'neutral' });
  assert.deepEqual(statusLook({ category: 'done', reason: 'not-planned' }), NOT_PLANNED_LOOK);
  assert.deepEqual(statusLook({ category: 'done', reason: 'completed' }), { icon: 'check', tone: 'neutral', quiet: true });
  assert.deepEqual(statusLook({ category: 'done' }), { icon: 'check', tone: 'neutral', quiet: true }, 'no reason: the category\'s');
  const ticket: Ticket = {
    key: 'GH-9', kind: 'github', url: 'u', title: 'T', type: 'Bug', typeKind: 'bug', status: { id: 'CLOSED', name: 'Closed as not planned', category: 'done', reason: 'not-planned' },
    assignees: [], reporter: null, labels: [], priority: 'Medium', priorityLevel: 3, created: '', updated: '', body: { blocks: [] }, markdown: '', comments: [], related: [],
  };
  const m = ticketModel({ project: '/r', tracker: 0, trackerTitle: 'GitHub · o/r', trackerKind: 'github', key: 'GH-9', loading: false, error: null, connect: null, checks: [], row: null, task: null, ticket, trackerEdits: false });
  assert.deepEqual(m.status, { name: 'Closed as not planned', icon: 'circle-slash', tone: 'neutral' }, 'GitHub\'s words, its own look');
  assert.deepEqual([m.typeIcon, m.priorityIcon], ['bug', 'dash'], 'the kind and the level, not the words');
});

test('a board\'s card draws its kind\'s and level\'s icons, and a card from a tracker with neither gets the plain ones (edge case)', () => {
  const card = (key: string, extra: object) => ({ key, title: key, url: 'u', status: { id: '1', name: 'To Do' }, type: 'Debug tooling', assignees: [], labels: [], priority: 'P0', ...extra });
  const input: BoardInput = {
    index: 0, kind: 'azure', title: 'Azure DevOps · CRM', error: null, connect: null, loading: false,
    board: { source: 'azure-board', title: 'B', url: null, notice: null, columns: [{ id: '1', name: 'To Do', category: 'todo', statusIds: ['1'] }], cards: [card('AB-1', { typeKind: 'task', priorityLevel: 1 }), card('AB-2', {})] },
  };
  const cards = trackerBoard(input, [], '/r').columns[0]!.cards;
  assert.deepEqual(cards.map((c) => [c.key, c.typeIcon, c.priorityIcon]), [['AB-1', 'tasklist', 'arrow-circle-up'], ['AB-2', 'issues', null]], '"Debug tooling" isn\'t read as a bug');
});
