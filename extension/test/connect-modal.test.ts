// Adding or changing a board in a stepped modal (T-140): each step, and Back and Next keeping every choice;
// the board under the dropdowns redrawn with the tracker's answer; its read debounced, the last choice winning;
// nothing written before Save; and a change's before and after. The session runs with stand-ins for VSCode
// and the tracker, as choose-board.test.ts does; a stand-in board reader counts each place it's asked for.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Tracker } from '../../packages/core/src/config.ts';
import type { Ctx } from '../../packages/core/src/trackers/connect.ts';
import { placeKey } from '../../packages/core/src/trackers/preview.ts';
import type { Board, TrackerClient } from '../../packages/core/src/trackers/types.ts';
import { type ConnectDeps, ConnectSession, PREVIEW_WAIT } from '../src/connect.ts';
import { blankConnect, CONNECT_STEPS, type ConnectMessage, type ConnectModel, connectSteps, connectValues } from '../src/model/connect.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { JIRA } from '../../packages/core/src/trackers/connect.ts';
import { sampleBoard, sampleConnect } from '../scripts/fixtures/connect.ts';
import { jiraFor } from './support.ts';

const ROOT = '/Users/me/code/acme-service';
const SITE = 'acme.atlassian.net';
const EMAIL = 'jordan.kim@example.com';
const TOKEN = 'secret-token-0123456789';
const settle = async () => { for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r)); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const picker = (m: ConnectModel, key: string) => m.pickers.find((p) => p.key === key)!;
/** A board of this many tickets, one column each of To Do, In Progress and Done. */
const board = (n: [number, number, number]) => sampleBoard('jira', 'Board', [['To Do', 'todo', n[0]], ['In Progress', 'doing', n[1]], ['Done', 'done', n[2]]]);

/** Jira with one project, two epics and two kanban boards, so a board is a choice to make. */
const jira = jiraFor({ email: EMAIL, token: TOKEN }, {
  projects: [{ key: 'ACME', name: 'Acme Service Desk' }], epics: [['ACME-31', 'Renewals'], ['ACME-30', 'Partner portal']],
  boards: [{ id: 9, name: 'Support', type: 'kanban' }, { id: 11, name: 'Escalations', type: 'kanban' }],
});

/**
 * The modal's session with stand-ins. `boards` gives a place's board by its values, or throws to fail it;
 * `held` keeps each read waiting until released; `wait` is the preview's wait after a choice; `writing`, when
 * given, holds Save's write until it settles.
 */
function harness(o: { boards?: (values: Ctx['values']) => Board; held?: boolean; wait?: number; trackers?: Tracker[]; writing?: Promise<void> } = {}) {
  const h = {
    asked: [] as string[], writes: [] as Record<string, unknown>[], saved: 0, release: [] as (() => void)[],
    session: null as unknown as ConnectSession,
    model: () => h.session.model() as ConnectModel,
    send: (m: Record<string, unknown>) => {
      const msg = { ...m, session: h.model().id };
      assert.ok(isFromWebview(msg), `the page may send ${JSON.stringify(m)}`);
      h.session.receive(msg as ConnectMessage);
    },
  };
  const client = (values: Ctx['values']): Pick<TrackerClient, 'board'> => ({
    board: async () => {
      if (o.held) await new Promise<void>((r) => h.release.push(r));
      return (o.boards ?? (() => board([2, 1, 1])))(values);
    },
  });
  const deps: ConnectDeps = {
    projects: () => [{ name: 'Acme Service', root: ROOT, config: { github: { repo: 'acme/service', account: 'jordan-kim' } }, ledgerPath: `${ROOT}/.git/acc/ledger.json` }],
    trackers: () => o.trackers ?? [],
    title: () => 'Jira · ACME',
    storedSignIn: async () => ({ signIn: { method: 'token', fields: { email: EMAIL, token: TOKEN }, header: null, gh: null }, shared: true }),
    ownSignIn: async () => false,
    storeSignIn: async () => {},
    gitEmail: async () => EMAIL,
    ghToken: async () => 'gh-token',
    microsoft: async () => ({ header: '', cred: {} }),
    write: async (_root, _index, record) => { await o.writing; h.writes.push(record); },
    signedIn: async () => {},
    saved: async () => { h.saved++; },
    start: async () => {},
    confirm: async () => true,
    repos: () => [],
    changed: () => {},
    log: () => {},
    exec: async () => ({ code: 1, stdout: '', stderr: '' }),
    fetch: jira,
    wait: o.wait ?? 0,
    preview: (_d, ctx: Ctx) => {
      h.asked.push(placeKey(ctx.values));
      return client(ctx.values);
    },
  };
  h.session = new ConnectSession(deps);
  return h;
}

/** A new Jira board, signed in with the site's sign-in on the Sign in step: its project picked, its boards listed. */
async function signedIn(h: ReturnType<typeof harness>): Promise<void> {
  await h.session.open({ root: ROOT, kind: 'jira', from: 'tasks' });
  h.send({ type: 'connect-set', field: 'site', value: SITE });
  await settle();
}

test('the steps, in order: tracker, sign in, board, then Save, and an existing board opens on its board', () => {
  assert.deepEqual([...CONNECT_STEPS], ['tracker', 'site', 'board', 'save']);
  const start = sampleConnect('start');
  assert.deepEqual([start.step, start.steps.map((s) => s.title)], ['tracker', ['Tracker', 'Sign in', 'Choose a board', 'Save']]);
  assert.deepEqual(start.steps.map((s) => s.can), [true, true, false, false], 'not signed in: the board and Save can\'t be gone to yet');
  assert.equal(sampleConnect('existing').step, 'save');
  const existing = blankConnect(JIRA, { id: 'c', root: ROOT, projectName: 'Acme Service', ownRepo: null, ghAccount: null, from: 'settings', existing: { index: 0, title: 'Jira · ACME', host: SITE, values: { project: 'ACME', epics: null, board: '9' } } });
  assert.equal(existing.step, 'board');
  assert.deepEqual(existing.was, { project: 'ACME', epics: null, board: '9', sprint: null, queues: null }, 'the values it opened with, to say what changes');
});

test('edge case: a step that can\'t be on show is moved back: no project to the tracker, a sign-in that needs the person to Sign in, Save before the board is read to the board', () => {
  const s = blankConnect(JIRA, { id: 'c', root: null, projectName: '', ownRepo: null, ghAccount: null, from: 'tasks' });
  s.step = 'save';
  const at = (reach: { site: boolean; board: boolean; save: boolean }) => connectSteps(s, reach, 'Choose a board').find((x) => x.state === 'current')!.id;
  assert.equal(at({ site: false, board: false, save: false }), 'tracker', 'no project yet');
  s.root = ROOT;
  s.signIn = { state: 'failed', who: null, error: 'refused', again: false };
  assert.equal(at({ site: true, board: false, save: false }), 'site', 'the sign-in failed');
  s.signIn = { state: 'ok', who: 'Jordan Kim', error: null, again: false };
  assert.equal(at({ site: true, board: true, save: false }), 'board', 'the board isn\'t read yet');
  assert.equal(at({ site: true, board: true, save: true }), 'save');
});

test('Next goes on only when the next step can be gone to, says why when it can\'t, and Back and Next keep every choice', async () => {
  const h = harness();
  await h.session.open({ root: ROOT, kind: 'jira', from: 'tasks' });
  let m = h.model();
  assert.equal(m.step, 'tracker');
  h.send({ type: 'connect-step', step: 'site' });
  m = h.model();
  assert.deepEqual([m.step, m.next?.can, m.next?.why?.label], ['site', false, 'Sign in first.'], 'not signed in: Next is off, with why');
  h.send({ type: 'connect-step', step: 'board' });
  assert.equal(h.model().step, 'site', 'a Next sent anyway is refused');
  h.send({ type: 'connect-set', field: 'site', value: SITE });
  await settle();
  assert.equal(h.model().next?.can, true, 'signed in: Next is on');
  h.send({ type: 'connect-step', step: 'board' });
  h.send({ type: 'connect-pick', key: 'board', value: '11' });
  h.send({ type: 'connect-pick', key: 'epics', value: ['ACME-30'] });
  await settle();
  m = h.model();
  assert.deepEqual([m.step, m.next?.can], ['board', true]);
  h.send({ type: 'connect-step', step: 'save' });
  assert.equal(h.model().step, 'save');
  for (const step of ['board', 'site', 'tracker', 'site', 'board'] as const) h.send({ type: 'connect-step', step });
  m = h.model();
  assert.deepEqual([m.step, picker(m, 'board').selected, picker(m, 'epics').selected, m.host.value], ['board', ['11'], ['ACME-30'], SITE], 'Back and Next keep the choices and the site');
  assert.equal(h.writes.length, 0, 'moving between steps writes nothing');
});

test('nothing is written while picking: Cancel on any step keeps nothing, and only Save writes the board, once', async () => {
  const h = harness();
  await signedIn(h);
  h.send({ type: 'connect-step', step: 'board' });
  h.send({ type: 'connect-pick', key: 'board', value: '9' });
  h.send({ type: 'connect-pick', key: 'epics', value: ['ACME-31'] });
  await settle();
  h.send({ type: 'connect-set', field: 'boardName', value: 'Renewals' });
  h.send({ type: 'connect-step', step: 'save' });
  assert.deepEqual([h.writes.length, h.saved], [0, 0], 'picking, naming and going to Save write nothing');
  h.send({ type: 'connect-cancel' });
  await settle();
  assert.deepEqual([h.session.model(), h.writes.length], [null, 0], 'Cancel closes and keeps nothing');

  await signedIn(h);
  h.send({ type: 'connect-step', step: 'board' });
  h.send({ type: 'connect-pick', key: 'board', value: '9' });
  await settle();
  h.send({ type: 'connect-step', step: 'save' });
  h.send({ type: 'connect-save' });
  await settle();
  assert.deepEqual([h.writes.length, h.writes[0]?.board, h.saved], [1, 9, 1], 'Save writes the board the person saw');
});

test('the board under the dropdowns is redrawn with the tracker\'s answer for each choice, with its count', async () => {
  const h = harness({ boards: (v) => (v.board === '11' ? board([4, 0, 1]) : board([1, 1, 0])) });
  await signedIn(h);
  h.send({ type: 'connect-pick', key: 'board', value: '9' });
  await settle();
  assert.equal(h.model().preview.look.label, '2 tickets would be on your board, in 3 columns.');
  h.send({ type: 'connect-pick', key: 'board', value: '11' });
  await settle();
  const m = h.model();
  assert.equal(m.preview.look.label, '5 tickets would be on your board, in 3 columns.', 'the other board\'s answer');
  assert.deepEqual(m.preview.totals, [4, 0, 1]);
});

test('reads are debounced: choices made quickly read only the last choices\' board, after PREVIEW_WAIT', async () => {
  assert.ok(PREVIEW_WAIT >= 200 && PREVIEW_WAIT <= 600, 'long enough to gather quick changes, short enough to feel live');
  const h = harness({ wait: 300 });
  await signedIn(h);
  h.send({ type: 'connect-pick', key: 'board', value: '9' });
  h.send({ type: 'connect-pick', key: 'epics', value: ['ACME-31'] });
  h.send({ type: 'connect-pick', key: 'epics', value: ['ACME-31', 'ACME-30'] });
  await settle();
  assert.deepEqual([h.asked.length, h.model().preview.state], [0, 'loading'], 'edge case: before the wait ends nothing is read, and the board shows it\'s reading');
  await sleep(450);
  await settle();
  assert.deepEqual(h.asked, [placeKey(connectValues(h.session.state()!, JIRA))], 'one read, of the last choices');
  assert.deepEqual(JSON.parse(h.asked[0]!).epics, ['ACME-31', 'ACME-30']);
  assert.equal(h.model().preview.state, 'ready');
});

test('the last choice wins: a read under way when a choice changes is cancelled, and its late answer dropped', async () => {
  const h = harness({ held: true, boards: (v) => (v.board === '11' ? board([7, 0, 0]) : board([1, 0, 0])) });
  await signedIn(h);
  h.send({ type: 'connect-pick', key: 'board', value: '9' });
  await settle();
  assert.equal(h.release.length, 1, 'board 9 is being read');
  const nine = h.asked[0]!;
  assert.equal(JSON.parse(nine).board, '9');
  h.send({ type: 'connect-pick', key: 'board', value: '11' });
  await settle();
  assert.equal(h.release.length, 2, 'board 11 is being read');
  assert.equal(h.session.state()!.boards[nine], undefined, 'board 9\'s read is cancelled');
  // Board 11 answers first, then board 9's late answer arrives: it is dropped.
  h.release[1]!();
  await settle();
  h.release[0]!();
  await settle();
  assert.equal(h.model().preview.look.label, '7 tickets would be on your board, in 3 columns.');
  assert.equal(h.session.state()!.boards[nine], undefined, 'the cancelled answer isn\'t kept');
});

test('edge case: a cancelled read gives back its place, so a slow site\'s stale reads never hold up the latest board', async () => {
  const h = harness({ held: true });
  await signedIn(h);
  // Four choices in turn, each cancelling the read before it: more than READS_AT_ONCE (3) reads were started.
  h.send({ type: 'connect-pick', key: 'board', value: '9' });
  await settle();
  h.send({ type: 'connect-pick', key: 'board', value: '11' });
  await settle();
  h.send({ type: 'connect-pick', key: 'epics', value: ['ACME-31'] });
  await settle();
  h.send({ type: 'connect-pick', key: 'epics', value: ['ACME-30'] });
  await settle();
  assert.equal(h.release.length, 4, 'the last choice\'s board is read at once, though the three cancelled reads haven\'t answered');
  h.release[3]!();
  await settle();
  assert.equal(h.model().preview.state, 'ready');
});

test('edge case: Cancel is off while Save runs, says why, and a Cancel sent then is ignored: the save finishes', async () => {
  let done = () => {};
  const h = harness({ writing: new Promise<void>((r) => { done = r; }) });
  await signedIn(h);
  h.send({ type: 'connect-step', step: 'board' });
  h.send({ type: 'connect-pick', key: 'board', value: '9' });
  await settle();
  assert.deepEqual(h.model().cancel, { can: true, why: null }, 'Cancel works while picking');
  h.send({ type: 'connect-step', step: 'save' });
  h.send({ type: 'connect-save' });
  await settle();
  const m = h.model();
  assert.equal(m.cancel.can, false);
  assert.match(m.cancel.why ?? '', /^Saving now/);
  h.send({ type: 'connect-cancel' });
  await settle();
  assert.ok(h.session.model(), 'the modal stays open while the board is written');
  done();
  await settle();
  assert.deepEqual([h.writes.length, h.saved, h.session.model()], [1, 1, null], 'the save finished, then the modal closed');
});

test('edge case: a board that can\'t be read says why beside the dropdown changed last, and only there', async () => {
  const h = harness({ boards: (v) => { if (v.board === '11') throw new Error('Jira answered HTTP 403: no access to this board.'); return board([1, 0, 0]); } });
  await signedIn(h);
  h.send({ type: 'connect-step', step: 'board' });
  h.send({ type: 'connect-pick', key: 'board', value: '11' });
  await settle();
  const m = h.model();
  assert.equal(m.preview.state, 'failed');
  assert.equal(picker(m, 'board').error?.label, 'Couldn\'t read the board with this choice: Jira answered HTTP 403: no access to this board.');
  assert.deepEqual([picker(m, 'board').error?.icon, picker(m, 'board').error?.tone], ['warning', 'orange']);
  assert.equal(picker(m, 'epics').error, null);
  assert.deepEqual([m.next?.can, m.next?.why?.label], [false, 'The board couldn\'t be read: change a choice, or read it again.']);
});

test('changing an existing board shows its tickets before and after, and marks each choice that changes', async () => {
  const h = harness({ trackers: [{ kind: 'jira', site: SITE, project: 'ACME', board: 9, epics: [], queue: null, sprint: null } as unknown as Tracker], boards: (v) => (v.epics ? board([1, 1, 1]) : board([4, 3, 2])) });
  await h.session.open({ root: ROOT, index: 0, from: 'settings' });
  await settle();
  let m = h.model();
  assert.deepEqual([m.step, m.change], ['board', { before: '9 tickets', after: '9 tickets' }], 'opened on its board, nothing changed yet');
  h.send({ type: 'connect-pick', key: 'epics', value: ['ACME-31'] });
  await settle();
  h.send({ type: 'connect-step', step: 'save' });
  m = h.model();
  assert.deepEqual([m.step, m.change], ['save', { before: '9 tickets', after: '3 tickets' }]);
  assert.deepEqual(m.kept.map((k) => [k.label, k.value, k.changed]), [
    ['Site', SITE, false], ['Project', 'ACME', false], ['Queues', 'None', false], ['Epics', 'ACME-31', true], ['Board', 'Support', false], ['Sprint', 'The whole board', false],
  ], 'the queues\' list couldn\'t be read here, so it shows, with none chosen');
  assert.equal(h.writes.length, 0);
  // Edge: a new board has nothing before it.
  assert.equal(sampleConnect('jira-save').change, null);
});
