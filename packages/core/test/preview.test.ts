// Choosing a board by seeing it (T-106): each description's preview, the place a card's count reads, and that a
// preview reads the board and never writes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AZURE, boardKind, type Ctx, DESCRIPTIONS, GITHUB, JIRA, MONDAY, SLACK, SLACK_NO_BOARD } from '../src/trackers/connect.ts';
import { CARD_TITLES, countValues, placeKey, PREVIEW_CARDS, previewLine, readPlace } from '../src/trackers/preview.ts';
import type { Board, TrackerClient } from '../src/trackers/types.ts';

const BOARD: Board = { source: 'jira-board', title: 'ACME board', url: null, notice: null, place: 'Jira · ACME', columns: [], cards: [] };
const ctx = (values: Ctx['values'], signIn: Partial<Ctx['signIn']> = {}): Ctx => ({
  host: 'acme.atlassian.net', values, exec: async () => ({ code: 1, stdout: '', stderr: '' }),
  signIn: { method: 'token', fields: { email: 'jordan.kim@example.com', token: 'secret-token-0123456789' }, header: null, gh: null, ...signIn },
});

test('every tracker has a preview: a client for the place once its choices make one, and none before', () => {
  let checked = 0;
  for (const d of DESCRIPTIONS) {
    assert.equal(typeof d.preview, 'function', d.kind);
    checked++;
  }
  assert.equal(checked, 5);
  // Edge: before the choices make a place, there's nothing to read.
  assert.equal(JIRA.preview(ctx({ project: null, epic: null, board: null, sprint: null })), null, 'Jira needs a project');
  assert.equal(AZURE.preview(ctx({ project: null, team: null, board: null, areaPath: null })), null, 'Azure DevOps needs a project');
  assert.equal(MONDAY.preview(ctx({ board: null, group: null, statusColumn: null })), null, 'monday.com needs a board');
  assert.equal(SLACK.preview(ctx({ channel: null, reaction: null, doneReaction: null })), null, 'Slack needs a channel');
  assert.equal(GITHUB.preview(ctx({ labels: null })), null, 'GitHub needs its gh sign-in');
  const jira = JIRA.preview(ctx({ project: 'ACME', epic: 'ACME-31', board: '7', sprint: 'active' })) as TrackerClient;
  assert.equal(jira.place, 'Jira · ACME · epic ACME-31 · the active sprint', 'the epic and sprint chosen are its place');
  assert.match((AZURE.preview({ ...ctx({ project: 'CRM', team: 'CRM Team', board: 'Stories', areaPath: 'CRM\\Billing' }), host: 'acme' }) as TrackerClient).place, /CRM · CRM Team · area CRM\\Billing/);
  assert.match((GITHUB.preview({ ...ctx({ labels: ['billing'] }, { gh: { account: 'jordan-kim', token: 'gh' } }), host: 'acme/service' }) as TrackerClient).place, /label billing/);
  assert.match((MONDAY.preview({ ...ctx({ board: '111', group: 'topics', statusColumn: null }), host: 'acme' }) as TrackerClient).place, /group topics/);
});

test('a Slack channel with no reaction has no board: the preview says so in words, and one with a reaction reads its board', () => {
  assert.equal(SLACK.preview({ ...ctx({ channel: 'C0SUPPORT1', reaction: null, doneReaction: null }), host: 'acme' }), SLACK_NO_BOARD);
  const c = SLACK.preview({ ...ctx({ channel: 'C0SUPPORT1', reaction: 'ticket', doneReaction: 'white_check_mark' }, { fields: { token: 'xoxb-0123456789abcdef' } }), host: 'acme' });
  assert.equal(typeof c, 'object');
  assert.match((c as TrackerClient).place, /channel C0SUPPORT1/);
});

test('a preview reads the board and never calls a write, even on a client that has every write', async () => {
  const called: string[] = [];
  const writes = ['transition', 'moveToColumn', 'comment', 'setText', 'assign', 'setLabels'];
  const client = new Proxy({} as TrackerClient, {
    get: (_t, k: string) => (k === 'then' ? undefined : async () => { called.push(k); return k === 'board' ? BOARD : undefined; }),
  });
  const r = await readPlace(client);
  assert.deepEqual([r.board, r.none], [BOARD, null]);
  assert.deepEqual(called, ['board'], 'only board()');
  for (const w of writes) assert.ok(!called.includes(w), `${w} is never called`);
  // Edge: a place with no board reads nothing, and says why.
  assert.deepEqual(await readPlace(SLACK_NO_BOARD), { board: null, none: SLACK_NO_BOARD });
});

test('a Jira preview only reads: each request its board makes is a GET', async () => {
  const methods: string[] = [];
  const fetch = (async (url: string, init: { method?: string }) => {
    methods.push(`${init.method ?? 'GET'} ${new URL(url).pathname}`);
    const path = new URL(url).pathname;
    if (path.endsWith('/configuration')) return Response.json({ name: 'ACME board', columnConfig: { columns: [{ name: 'To Do', statuses: [{ id: '1' }] }] } });
    if (path.includes('/statuses')) return Response.json([{ statuses: [{ id: '1', name: 'To Do', statusCategory: { key: 'new' } }] }]);
    if (path.includes('/sprint')) return Response.json({ values: [] });
    return Response.json({ issues: [], values: [] });
  }) as unknown as typeof globalThis.fetch;
  const client = JIRA.preview({ ...ctx({ project: 'ACME', epic: null, board: '7', sprint: null }), fetch }) as TrackerClient;
  const r = await readPlace(client);
  assert.ok(r.board, 'it read a board');
  assert.ok(methods.length > 0, 'it asked Jira something');
  for (const m of methods) assert.match(m, /^GET /, `${m} only reads`);
});

test('a card\'s count reads its place: that choice made, and every list that depends on it cleared', () => {
  const values = { project: 'ACME', epic: 'ACME-31', board: '7', sprint: 'active' };
  assert.deepEqual(countValues(JIRA.pickers, values, 'epic', 'ACME-30'), { project: 'ACME', epic: 'ACME-30', board: '7', sprint: 'active' }, 'an epic leaves the board and sprint');
  assert.deepEqual(countValues(JIRA.pickers, values, 'board', '9'), { project: 'ACME', epic: 'ACME-31', board: '9', sprint: null }, 'another board clears its sprint');
  // Edge: '' is the whole project, which chooses nothing.
  assert.deepEqual(countValues(JIRA.pickers, values, 'epic', ''), { ...values, epic: null });
  // Ticks count one label each.
  assert.deepEqual(countValues(GITHUB.pickers, { labels: ['billing', 'bug'] }, 'labels', 'invoices'), { labels: ['invoices'] });
  // Azure DevOps: another team clears its board and area path, which are the team's.
  assert.deepEqual(countValues(AZURE.pickers, { project: 'CRM', team: 'CRM Team', board: 'Stories', areaPath: 'CRM\\Billing' }, 'team', 'Billing'), { project: 'CRM', team: 'Billing', board: null, areaPath: null });
  // The same choices are the same place, and a card's count is the preview's board once it's chosen.
  assert.equal(placeKey(countValues(JIRA.pickers, values, 'epic', 'ACME-31')), placeKey(values));
  assert.notEqual(placeKey(countValues(JIRA.pickers, values, 'epic', 'ACME-30')), placeKey(values));
});

test('the preview\'s line counts its tickets and columns, with one of each said once', () => {
  assert.equal(previewLine(47, 5), '47 tickets would be on your board, in 5 columns.');
  assert.equal(previewLine(1, 1), '1 ticket would be on your board, in 1 column.');
  // Edge: an empty place.
  assert.equal(previewLine(0, 4), '0 tickets would be on your board, in 4 columns.');
  assert.deepEqual([PREVIEW_CARDS, CARD_TITLES], [3, 2]);
});

test('a Jira board\'s card says its kind in words: Scrum, Kanban, or Jira\'s own word for one it doesn\'t know', () => {
  assert.deepEqual(['scrum', 'kanban', 'simple', 'other'].map(boardKind), ['Scrum', 'Kanban', 'Team-managed', 'other']);
});
