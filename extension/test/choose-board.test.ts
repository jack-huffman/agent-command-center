// Choosing a board by seeing it (T-106): each tracker's cards with their details and counts, a count that
// fails, the search, ticks, the preview's model, an empty place, and that Use this board waits for the preview.
// The session runs with stand-ins for VSCode and the tracker; a stand-in board reader counts what it's asked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { AZURE, type Ctx, GITHUB, JIRA, MONDAY, SLACK, SLACK_NO_BOARD, type TrackerDescription } from '../../packages/core/src/trackers/connect.ts';
import { countValues, placeKey } from '../../packages/core/src/trackers/preview.ts';
import type { Board, TrackerClient } from '../../packages/core/src/trackers/types.ts';
import { type ConnectDeps, ConnectSession, READS_AT_ONCE } from '../src/connect.ts';
import { blankConnect, cardCount, COUNT_MOST, type ConnectMessage, connectModel, type ConnectModel, connectPreview, type ConnectState, connectValues, LISTS_TITLE, SEARCH_FROM, USE_BOARD } from '../src/model/connect.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { sampleBoard, sampleConnect } from '../scripts/fixtures/connect.ts';

const ROOT = '/Users/me/code/acme-service';
const EMAIL = 'jordan.kim@example.com';
const TOKEN = 'secret-token-0123456789';
const b64 = (s: string) => Buffer.from(s).toString('base64');
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
const base = { id: 'c', root: ROOT, projectName: 'Acme Service', ownRepo: 'acme/service', ghAccount: 'jordan-kim', from: 'tasks' as const };
const ready = (options: ConnectState['pickers'][string]['options'], selected: string[] = []): ConnectState['pickers'][string] => ({ options, selected, state: 'ready', error: null });
const picker = (m: ConnectModel, key: string) => m.pickers.find((p) => p.key === key)!;
const board = (n: number[]) => sampleBoard('jira', 'ACME board', [['To Do', 'todo', n[0]!], ['In Progress', 'doing', n[1]!], ['Done', 'done', n[2]!]]);
const signedIn = (d: TrackerDescription, host: string): ConnectState => {
  const s = blankConnect(d, base);
  s.host = host;
  s.signIn = { state: 'ok', who: 'Jordan Kim', error: null, again: false, shared: true };
  return s;
};

/** Jira, answering only this email and token: two projects, two epics and two boards. */
const jira = (async (url: string, init: { headers: Record<string, string> }) => {
  if (init.headers.Authorization !== `Basic ${b64(`${EMAIL}:${TOKEN}`)}`) return new Response('', { status: 401 });
  const u = new URL(url);
  if (u.pathname === '/rest/api/3/myself') return Response.json({ accountId: 'a1', displayName: 'Jordan Kim' });
  if (u.pathname === '/rest/api/3/project/search') return Response.json({ values: [{ key: 'ACME', name: 'Acme Service Desk' }] });
  if (u.pathname === '/rest/api/3/search/jql') return Response.json({ issues: [{ key: 'ACME-31', fields: { summary: 'Renewals' } }, { key: 'ACME-30', fields: { summary: 'Partner portal' } }] });
  if (u.pathname === '/rest/agile/1.0/board') return Response.json({ values: [{ id: 9, name: 'Support', type: 'kanban' }] });
  return new Response('', { status: 404 });
}) as unknown as typeof fetch;

/**
 * The Connect page with stand-ins, its board reader counting each place it's asked for. `boards` gives a place's
 * board by its values, or throws to fail it; `held` keeps a read waiting until released.
 */
function harness(o: { boards?: (values: Ctx['values']) => Board; held?: boolean } = {}) {
  const h = {
    asked: [] as string[], writes: 0, saved: [] as string[], logs: [] as string[], release: [] as (() => void)[],
    /** Every method the preview's client was called with: only board() may be. */
    calls: [] as string[],
    session: null as unknown as ConnectSession,
    model: () => h.session.model() as ConnectModel,
    send: (m: Record<string, unknown>) => {
      const msg = { ...m, session: h.model().id };
      assert.ok(isFromWebview(msg), `the page may send ${JSON.stringify(m)}`);
      h.session.receive(msg as ConnectMessage);
    },
  };
  const client = (values: Ctx['values']): TrackerClient => new Proxy({} as TrackerClient, {
    get: (_t, k: string) => (k === 'then' ? undefined : async () => {
      h.calls.push(k);
      if (k !== 'board') throw new Error(`a preview called ${k}`);
      if (o.held) await new Promise<void>((r) => h.release.push(r));
      return (o.boards ?? (() => board([2, 1, 1])))(values);
    }),
  });
  const deps: ConnectDeps = {
    projects: () => [{ name: 'Acme Service', root: ROOT, config: { github: { repo: 'acme/service', account: 'jordan-kim' } }, ledgerPath: `${ROOT}/.git/acc/ledger.json` }],
    trackers: () => [],
    title: (t) => `${t.kind} · ${t.project}`,
    storedSignIn: async () => ({ signIn: { method: 'token', fields: { email: EMAIL, token: TOKEN }, header: null, gh: null }, shared: true }),
    ownSignIn: async () => false,
    storeSignIn: async () => {},
    gitEmail: async () => EMAIL,
    ghToken: async () => 'gh-token',
    microsoft: async () => ({ header: '', cred: {} }),
    write: async () => { h.writes++; },
    signedIn: async () => {},
    saved: async (_r, name) => { h.saved.push(name); },
    start: async () => {},
    confirm: async () => true,
    repos: () => [],
    changed: () => {},
    log: (line) => h.logs.push(line),
    exec: async () => ({ code: 1, stdout: '', stderr: '' }),
    fetch: jira,
    preview: (_d, ctx: Ctx) => {
      h.asked.push(placeKey(ctx.values));
      return client(ctx.values);
    },
  };
  h.session = new ConnectSession(deps);
  return h;
}

/** Opens Jira signed in with the site's sign-in, its project chosen and its lists loaded. */
async function openJira(h: ReturnType<typeof harness>): Promise<void> {
  await h.session.open({ root: ROOT, kind: 'jira', from: 'settings' });
  h.send({ type: 'connect-set', field: 'site', value: 'acme.atlassian.net' });
  await settle();
}

test('each tracker\'s cards show their details and counts: a Jira board its kind, an epic its tickets\' titles, a sprint its dates and state', () => {
  const jiraPage = sampleConnect('jira-board');
  const boards = picker(jiraPage, 'board');
  assert.deepEqual(boards.options.map((o) => [o.label, o.detail, o.count?.label]), [['ACME Service board', 'Scrum', '11 tickets'], ['Support kanban', 'Kanban', 'Couldn\'t count its tickets: Jira answered HTTP 503.']]);
  assert.deepEqual(boards.options.map((o) => o.count?.titles), [[], []], 'a board\'s card has no titles: they are the place\'s');
  const epics = picker(jiraPage, 'epic');
  const first = epics.options.find((o) => o.value === 'ACME-31')!;
  assert.deepEqual([first.label, first.detail, first.count?.label, first.count?.titles], ['ACME-31', 'Renewals', '11 tickets', ['Renewal reminder emails go out 30 days before the end date', 'Renewal quote shows the new price list']]);
  assert.deepEqual([epics.whole, epics.wholeCount?.label], ['The whole ACME project', '47 tickets'], 'the whole project is a card too, counted');
  // Edge: a count still being read, and one not asked for yet, are both drawn as a skeleton that says Counting.
  assert.deepEqual(['ACME-27', 'ACME-22'].map((v) => epics.options.find((o) => o.value === v)!.count?.state), ['loading', 'waiting']);
  assert.equal(epics.options.find((o) => o.value === 'ACME-24')!.count?.label, '0 tickets');
  const sprints = picker(jiraPage, 'sprint');
  assert.deepEqual(sprints.options.map((o) => [o.label, o.detail, o.count]), [['The active sprint', 'now ACME Sprint 13', null], ['ACME Sprint 13', 'open, 20 Oct to 2 Nov', null], ['ACME Sprint 14', 'future', null]], 'a sprint shows its name, dates and state, with no count');

  const azurePage = sampleConnect('azure-board');
  assert.deepEqual(['team', 'board', 'areaPath'].map((k) => picker(azurePage, k).options.map((o) => [o.label, o.detail, o.count?.label])), [
    [['CRM Team', 'default team', '32 tickets'], ['Billing', null, '14 tickets']],
    [['Epics', 'Backlog level', '4 tickets'], ['Stories', 'Backlog level', '18 tickets']],
    [['CRM\\Billing', null, '18 tickets'], ['CRM\\Billing\\Renewals', null, '7 tickets'], ['CRM\\Sales', null, '14 tickets']],
  ]);

  const github = sampleConnect('github');
  const labels = picker(github, 'labels');
  assert.deepEqual([labels.wholeCount?.label, labels.options.find((o) => o.value === 'bug')!.count?.label], ['12 tickets', '4 tickets'], 'a label counts its open issues');

  // monday.com: a board's card counts its items, a group's too; the status column isn't a place, so it isn't counted.
  const s = signedIn(MONDAY, 'acme');
  s.pickers.board = ready([{ value: '111', label: 'Client work', detail: 'Acme' }], ['111']);
  s.pickers.group = ready([{ value: 'topics', label: 'This sprint' }]);
  s.pickers.statusColumn = ready([{ value: 'status', label: 'Status', default: true }], ['status']);
  s.boards[placeKey(countValues(MONDAY.pickers, connectValues(s, MONDAY), 'group', 'topics'))] = { state: 'ready', board: board([3, 0, 2]), none: null, error: null };
  const m = connectModel(s);
  assert.deepEqual([picker(m, 'board').options[0]!.count?.state, picker(m, 'group').options[0]!.count?.label, picker(m, 'statusColumn').options[0]!.count], ['waiting', '5 tickets', null]);

  // Slack: a channel is chosen by its card, private or public; its count would need a reaction, so it has none.
  const slack = sampleConnect('slack-channel');
  assert.deepEqual(picker(slack, 'channel').options.map((o) => [o.label, o.detail, o.count]), [['#billing', 'private', null], ['#premium-support-escalations-and-renewals', 'public', null], ['#premium-support', 'public', null]]);
});

test('a count that fails says so on its card and never holds the choice; one not read yet is waiting, before the first result', () => {
  assert.deepEqual(cardCount(undefined), { state: 'waiting', label: 'Counting', titles: [] });
  assert.deepEqual(cardCount({ state: 'loading', board: null, none: null, error: null }), { state: 'loading', label: 'Counting', titles: [] });
  assert.deepEqual(cardCount({ state: 'failed', board: null, none: null, error: 'Jira answered HTTP 503.' }), { state: 'failed', label: 'Couldn\'t count its tickets: Jira answered HTTP 503.', titles: [] });
  assert.deepEqual(cardCount({ state: 'ready', board: null, none: SLACK_NO_BOARD, error: null }).label, SLACK_NO_BOARD);
  assert.deepEqual(cardCount({ state: 'ready', board: board([1, 0, 0]), none: null, error: null }, true), { state: 'ready', label: '1 ticket', titles: ['Renewal reminder emails go out 30 days before the end date'] });
  const page = sampleConnect('jira-board');
  const kanban = picker(page, 'board').options.find((o) => o.value === '9')!;
  assert.equal(kanban.count?.state, 'failed');
  assert.equal(picker(page, 'board').disabled, false, 'its card can still be chosen');
});

test('a long list gets a search box, a short one doesn\'t; ticks and a chosen card are what\'s selected', () => {
  assert.equal(picker(sampleConnect('jira-board'), 'epic').search, true, `ten epics: more than ${SEARCH_FROM}`);
  assert.equal(picker(sampleConnect('jira-board'), 'board').search, false);
  // Edge: exactly SEARCH_FROM cards needs no search.
  assert.equal(picker(sampleConnect('github'), 'labels').search, false, `${SEARCH_FROM} labels`);
  const labels = picker(sampleConnect('github'), 'labels');
  assert.deepEqual([labels.multi, labels.selected], [true, ['billing', 'invoices']], 'ticks: several');
  const areas = picker(sampleConnect('azure-board'), 'areaPath');
  assert.deepEqual([areas.multi, areas.selected], [false, ['CRM\\Billing']], 'one area path, ticked');
});

test('the preview\'s model draws the board the choices make: its columns, their first cards, the totals, and its line', () => {
  const m = sampleConnect('jira-board');
  const p = m.preview;
  assert.equal(p.state, 'ready');
  assert.equal(p.look.label, '11 tickets would be on your board, in 4 columns.');
  assert.deepEqual(p.board?.columns.map((c) => c.name), ['To Do', 'In Progress', 'In Review', 'Done']);
  assert.deepEqual(p.totals, [3, 2, 1, 5]);
  assert.deepEqual(p.board?.columns.map((c) => c.cards.length), [3, 2, 1, 3], 'each column shows its first three cards');
  assert.deepEqual(p.board?.columns[0]!.cards.map((c) => c.key), ['ACME-40', 'ACME-41', 'ACME-42']);
  assert.ok(p.board?.columns.every((c) => c.cards.every((x) => x.track === null && x.acc === null)), 'nothing to add to your work in a preview');
  assert.equal(p.board?.moves, false, 'nothing moves in a preview');
  assert.deepEqual([m.save.can, m.save.label, m.save.why], [true, USE_BOARD, null]);
  assert.equal(m.listsTitle, LISTS_TITLE);
  assert.equal(m.countMost, COUNT_MOST);
});

test('an empty place says so, with what to change; a Slack channel with no reaction has no board, and can still be used', () => {
  const m = sampleConnect('github');
  assert.equal(m.preview.look.label, '0 tickets would be on your board, in 2 columns.');
  assert.equal(m.preview.empty, 'No tickets would be on your board. Choose another labels, or every issue in acme/service.');
  assert.equal(m.save.can, true, 'an empty place can be kept: a new epic has no tickets yet');
  const s = signedIn(SLACK, 'acme');
  s.pickers.channel = ready([{ value: 'C0SUPPORT1', label: '#premium-support' }], ['C0SUPPORT1']);
  s.pickers.reaction = ready([]);
  s.pickers.doneReaction = ready([]);
  s.boards[placeKey(connectValues(s, SLACK))] = { state: 'ready', board: null, none: SLACK_NO_BOARD, error: null };
  const slack = connectModel(s);
  assert.deepEqual([slack.preview.state, slack.preview.none, slack.preview.look.label, slack.save.can], ['ready', SLACK_NO_BOARD, SLACK_NO_BOARD, true]);
});

test('before the choices make a place the preview waits and says what\'s left; reading, and failed, Use this board is off with why', () => {
  const start = sampleConnect('start');
  assert.deepEqual([start.preview.state, start.preview.look.label, start.save.can], ['waiting', 'Sign in and choose a project, and the board shows here.', false]);
  const existing = sampleConnect('existing');
  assert.deepEqual([existing.preview.state, existing.save.can, existing.save.why?.label], ['loading', false, 'Wait for the board to show first.'], 'the state before the first result arrives');
  const sprint = sampleConnect('sprint');
  assert.deepEqual([sprint.preview.state, sprint.preview.retry, sprint.save.can], ['failed', true, false]);
  assert.match(sprint.preview.look.label, /^Couldn't read the board: Jira answered HTTP 503/);
  assert.equal(sprint.save.why?.label, 'The board couldn\'t be read: change a choice, or read it again.');
  // The model on its own: no place yet waits, whatever boards are kept.
  const s = signedIn(JIRA, 'acme.atlassian.net');
  assert.equal(connectPreview(s, connectValues(s, JIRA), false, 'Choose a project, and the board shows here.', '').state, 'waiting');
});

test('choosing a board shows its preview, changing an epic changes it, going back is instant, and Use this board saves the place', async () => {
  const h = harness({ boards: (v) => board(v.epic === 'ACME-30' ? [1, 0, 0] : [2, 1, 1]) });
  await openJira(h);
  let m = h.model();
  assert.deepEqual([picker(m, 'project').selected, picker(m, 'board').selected], [['ACME'], ['9']], 'one project and one board: chosen');
  assert.equal(m.preview.look.label, '4 tickets would be on your board, in 3 columns.');
  const whole = placeKey(connectValues(h.session.state()!, JIRA));
  assert.ok(h.asked.includes(whole), 'the preview read the place chosen');

  h.send({ type: 'connect-pick', key: 'epic', value: 'ACME-30' });
  m = h.model();
  assert.deepEqual([m.preview.state, m.save.can], ['loading', false], 'a new choice reads its board before it can be used');
  await settle();
  m = h.model();
  assert.equal(m.preview.look.label, '1 ticket would be on your board, in 3 columns.', 'the epic changed the preview');

  const asked = h.asked.length;
  h.send({ type: 'connect-pick', key: 'epic', value: null });
  m = h.model();
  assert.deepEqual([m.preview.state, h.asked.length], ['ready', asked], 'going back to the whole project is instant: nothing read again');

  h.send({ type: 'connect-pick', key: 'epic', value: 'ACME-30' });
  h.send({ type: 'connect-save' });
  await settle();
  assert.deepEqual([h.writes, h.saved], [1, ['Jira']], 'Use this board kept it');
  assert.ok(h.calls.every((c) => c === 'board'), `a preview only reads the board: ${h.calls.join(', ')}`);
});

test('Use this board does nothing until the preview has drawn the board: a save sent while it reads is refused', async () => {
  const h = harness({ held: true });
  await openJira(h);
  const m = h.model();
  assert.deepEqual([m.preview.state, m.save.can], ['loading', false]);
  h.send({ type: 'connect-save' });
  await settle();
  assert.equal(h.writes, 0, 'nothing kept without a preview');
  for (const r of h.release.splice(0)) r();
  await settle();
  assert.equal(h.model().save.can, true, 'once it\'s drawn, it can be used');
});

test('a preview that fails says why, holds Use this board, and reads again when asked; a failed count only marks its card', async () => {
  let fail = true;
  const h = harness({ boards: (v) => { if (fail && v.epic === null) throw new Error('Jira answered HTTP 503.'); return board([1, 1, 0]); } });
  await openJira(h);
  let m = h.model();
  assert.deepEqual([m.preview.state, m.save.can], ['failed', false]);
  assert.ok(h.logs.some((l) => /couldn't read the board: Jira answered HTTP 503/.test(l)), 'and the log says so');
  fail = false;
  h.send({ type: 'connect-preview' });
  await settle();
  m = h.model();
  assert.deepEqual([m.preview.state, m.save.can], ['ready', true]);
  // Edge: Read it again on a preview that hasn't failed reads nothing.
  const asked = h.asked.length;
  h.send({ type: 'connect-preview' });
  assert.equal(h.asked.length, asked);
});

test('a card\'s count is read when the page asks: only values its list holds, at most COUNT_MOST, each once, a few at a time', async () => {
  const h = harness({ held: true });
  await openJira(h);
  for (const r of h.release.splice(0)) r();
  await settle();
  const before = h.asked.length;
  h.send({ type: 'connect-count', key: 'epic', values: ['ACME-31', 'ACME-30', 'NOT-1', ''] });
  const m = h.model();
  assert.deepEqual(['ACME-31', 'ACME-30'].map((v) => picker(m, 'epic').options.find((o) => o.value === v)!.count?.state), ['loading', 'loading']);
  assert.equal(picker(m, 'epic').wholeCount?.state, 'ready', 'the whole project is the preview\'s place: read already');
  assert.equal(h.asked.length - before, 2, 'a value the list doesn\'t hold is passed over');
  assert.ok(h.release.length <= READS_AT_ONCE, `at most ${READS_AT_ONCE} at once`);
  h.send({ type: 'connect-count', key: 'epic', values: ['ACME-31'] });
  assert.equal(h.asked.length - before, 2, 'each once');
  // Edge: a list that doesn't count, and one too many values, are refused before they reach the session.
  h.send({ type: 'connect-count', key: 'project', values: ['ACME'] });
  assert.equal(h.asked.length - before, 2, 'the project list doesn\'t count');
  assert.equal(isFromWebview({ type: 'connect-count', session: m.id, key: 'epic', values: Array.from({ length: COUNT_MOST + 1 }, (_, i) => `E-${i}`) }), false);
  while (h.release.length) {
    for (const r of h.release.splice(0)) r();
    await settle();
  }
  assert.deepEqual(['ACME-31', 'ACME-30'].map((v) => picker(h.model(), 'epic').options.find((o) => o.value === v)!.count?.label), ['4 tickets', '4 tickets']);
});

test('a new site forgets the boards read for the last one, and a page closed while a read runs drops its answer', async () => {
  const h = harness({ held: true });
  await openJira(h);
  assert.ok(Object.keys(h.session.state()!.boards).length > 0);
  h.send({ type: 'connect-set', field: 'site', value: 'other.atlassian.net' });
  assert.deepEqual(h.session.state()!.boards, {}, 'another site is another tracker');
  h.send({ type: 'connect-cancel' });
  for (const r of h.release.splice(0)) r();
  await settle();
  assert.equal(h.session.model(), null);
});

test('the page draws every list that isn\'t fixed with pickerCards, and Use this board only inside previewPanel; a fixed one stays a locked line', () => {
  const page = readFileSync(join(import.meta.dirname, '..', 'webview', 'connect.ts'), 'utf8');
  const cards = readFileSync(join(import.meta.dirname, '..', 'webview', 'choose-board.ts'), 'utf8');
  assert.equal(page.match(/pickerCards\(m, p\)/g)?.length, 1, 'one way to draw a list');
  assert.ok(!page.includes("document.createElement('select')"), 'no list is a select any more');
  assert.match(page, /previewPanel\(m, foot\)/, 'the foot with Use this board is drawn inside the preview');
  assert.match(cards, /export function previewPanel\(m: ConnectModel, foot: HTMLElement\)/);
  // Edge: an existing tracker's project is fixed, drawn as a locked line before any card.
  assert.ok(page.indexOf('if (p.fixed)') < page.indexOf('pickerCards(m, p)'));
});

test('every tracker gets the preview from its own description, and the same cards: no tracker is drawn apart', () => {
  for (const d of [JIRA, GITHUB, AZURE, MONDAY, SLACK]) {
    const m = connectModel(blankConnect(d, base));
    assert.equal(m.preview.state, 'waiting', d.kind);
    assert.ok(m.pickers.every((p) => Array.isArray(p.options) && typeof p.search === 'boolean'), d.kind);
  }
});
