// T-162 on the page: a modal opens the moment it's asked for, with what the page knows and a loading state, and
// fills when what it waits for arrives. The shared part (webview/loading.ts) is tested here, then each modal that
// opens after a wait, driven by the message its click sends: the task modal, the dispatch sheet, and the
// tracker and cloud-setup modals. A dialog here is a stand-in that opens and closes; the behaviour run
// (scripts/behaviour.ts) drives the real ones in a browser.
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { SHEET_COMMANDS } from '../src/model/dispatch-sheet.ts';
import { CLOUD_SETUP } from '../../packages/core/src/onboarding/cloud-steps.ts';
import { sampleTicket } from '../scripts/fixtures/task-page.ts';
import { sampleSheet } from '../scripts/fixtures/dispatch-sheet.ts';
import { type PageElement, pageDom } from './page-dom.ts';

const page = pageDom();
const g = globalThis as Record<string, unknown>;
g.CSS ??= { escape: (s: string) => s };
// A dialog that opens and closes, as the page's modals ask of one; the browser's own keys are the behaviour run's.
type Dialog = PageElement & { open: boolean; showModal(): void; close(): void; offsetLeft: number; offsetTop: number; getBoundingClientRect(): DOMRect; contains(e: unknown): boolean };
const proto = (await import('./page-dom.ts')).PageElement.prototype as unknown as Dialog;
proto.showModal = function (this: Dialog) { this.open = true; };
proto.close = function (this: Dialog) { this.open = false; };
proto.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }) as DOMRect;
// The sheet asks what part focus is in as it draws: here, none.
(proto as unknown as { closest(): null }).closest = () => null;
proto.contains = function (this: Dialog, e: unknown) { return e === this || this.all().includes(e as PageElement); };

const { FILLING, LOAD_LIMIT_MS, NO_ANSWER, Opening, failedState, loadingLine, loadingState } = await import('../webview/loading.ts');
const { api, onSent } = await import('../webview/state.ts');
const { onRan, heard } = await import('../webview/working.ts');
const taskModal = await import('../webview/task-modal.ts');
const dispatch = await import('../webview/dispatch-sheet.ts');
const connect = await import('../webview/connect.ts');
const cloud = await import('../webview/cloud-setup.ts');

const ROOT = '/Users/me/code/acme-service';
const dialogs = (cls: string): Dialog[] => page.document.body.children.filter((c): c is Dialog => typeof c !== 'string' && c.classList.contains(cls)) as Dialog[];
const dialogOf = (cls: string): Dialog => {
  const d = dialogs(cls)[0];
  assert.ok(d, `a ${cls} dialog is on the page`);
  return d;
};
/** The task modal's dialog: the one with no other modal's class. */
const taskDialog = (): Dialog => page.document.body.children.find((c): c is Dialog => typeof c !== 'string' && c.className === 'task-modal') as Dialog;
const bodyOf = (d: Dialog): PageElement => d.all('task-modal-body')[0]!;
/** Escape on a modal, as the browser sends it: the cancel event its makeModal handles. */
const escape = (d: Dialog): void => { for (const f of d.listeners.get('cancel') ?? []) f({ preventDefault() {} }); };
const loading = (d: Dialog): { busy: string | null; words: string; status: string | null } => {
  const s = bodyOf(d).all('loading-state')[0];
  return { busy: bodyOf(d).getAttribute('aria-busy'), words: s?.textContent ?? '', status: s?.getAttribute('role') ?? null };
};
const failure = (d: Dialog): { text: string; retry: PageElement | undefined } => {
  const f = bodyOf(d).all('loading-failed')[0];
  return { text: f?.textContent ?? '', retry: f?.all('loading-retry')[0] };
};
const sentOf = (type: string, from: number): Record<string, unknown>[] => (page.sent.slice(from) as Record<string, unknown>[]).filter((m) => m.type === type);
const home = (more: Record<string, unknown> = {}) => ({ kind: 'home', palette: [], ...more }) as never;

test('the loading state has a spinner and words, read out once as a status, and its line says what is still filling', () => {
  const s = loadingState('Opening GH-69…') as unknown as PageElement;
  assert.equal(s.getAttribute('role'), 'status');
  assert.equal(s.textContent, 'Opening GH-69…');
  assert.equal(s.all('loading-ring')[0]?.getAttribute('aria-hidden'), 'true', 'the ring is drawn, not read');
  const line = loadingLine(FILLING) as unknown as PageElement;
  assert.deepEqual([line.getAttribute('role'), line.textContent], ['status', FILLING]);
});

test('a load that failed says what and why, as an alert, and Try again runs again', () => {
  let again = 0;
  const f = failedState('GH-69', 'The tracker refused it.', () => { again++; }) as unknown as PageElement;
  assert.equal(f.getAttribute('role'), 'alert');
  assert.match(f.textContent, /GH-69 didn't open\. The tracker refused it\./);
  f.all('loading-retry')[0]!.click();
  assert.equal(again, 1);
});

test('a wait nothing answers fails after the limit, with why and Try again, and never leaves the spinner', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const body = page.document.createElement('div');
    const o = new Opening();
    let retried = 0;
    o.start('k', body as never, 'Opening T-1…', 'T-1', ['lead'], () => { retried++; });
    assert.deepEqual([o.busy, o.waits('k'), o.waits('other'), body.getAttribute('aria-busy')], [true, true, false, 'true']);
    assert.equal(body.children[0], 'lead', 'what the page knows comes first');
    mock.timers.tick(LOAD_LIMIT_MS - 1);
    assert.equal(o.busy, true, 'still waiting just before the limit');
    mock.timers.tick(1);
    assert.deepEqual([o.busy, o.waits('k'), body.getAttribute('aria-busy'), body.all('loading-state').length], [false, true, null, 0], 'the spinner is gone');
    assert.match(body.textContent, new RegExp(NO_ANSWER.replace(/[.?]/g, '\\$&')));
    body.all('loading-retry')[0]!.click();
    assert.equal(retried, 1);
    o.end();
    assert.deepEqual([o.key, o.waits('k')], [null, false]);
    o.fail('late');
    assert.equal(body.textContent.includes('late'), false, 'a wait that ended says nothing more');
  } finally {
    mock.timers.reset();
  }
});

test('onSent hears every message the page sends, and onRan every answer the extension gives, none missed', () => {
  const heardSent: unknown[] = [];
  onSent((m) => heardSent.push(m));
  api.postMessage({ type: 'refresh' });
  assert.deepEqual(heardSent, [{ type: 'refresh' }]);
  const ran: unknown[] = [];
  onRan((m) => ran.push(m));
  const msg = { type: 'ran', command: 'acc.task.block', ref: { project: ROOT, task: 'T-9' }, phase: 'done', ok: true } as const;
  heard(msg);
  assert.deepEqual(ran, [msg]);
});

test('a task\'s modal opens at the click, before any model, with its key, its title and a loading state', () => {
  const from = page.sent.length;
  api.postMessage({ type: 'task-modal-open', project: ROOT, key: 'acme-12', title: 'Fix the export' });
  const d = taskDialog();
  assert.ok(d?.open, 'open before the extension answered');
  assert.equal(d.getAttribute('aria-label'), 'ACME-12: Fix the export');
  assert.deepEqual(loading(d), { busy: 'true', words: 'Opening ACME-12…', status: 'status' });
  assert.equal(bodyOf(d).all('tcard-key')[0]?.textContent, 'ACME-12');
  assert.equal(bodyOf(d).all('loading-title')[0]?.textContent, 'Fix the export');
  const tab = d.all('task-modal-tab')[0]!;
  assert.equal(tab.disabled, true, 'Open as tab waits for the model, which says what it sends');
  assert.equal(sentOf('task-modal-open', from).length, 1, 'it asked once');
  // The model fills it, and the wait is over.
  taskModal.area.receive!['task-modal']!({ model: sampleTicket(Date.now()), tab: { type: 'ticket', project: ROOT, tracker: 0, key: 'ACME-12' } } as never);
  assert.deepEqual([d.open, bodyOf(d).getAttribute('aria-busy'), bodyOf(d).all('loading-state').length, tab.disabled], [true, null, 0, false]);
  escape(d);
  assert.equal(d.open, false);
});

test('Escape closes the modal while it loads, and a model that comes after it closed doesn\'t open it again', () => {
  const from = page.sent.length;
  api.postMessage({ type: 'task-modal-open', project: ROOT, key: 'ACME-12', title: 'Fix the export' });
  const d = taskDialog();
  assert.equal(d.open, true);
  escape(d);
  assert.equal(d.open, false, 'closed while it loaded');
  assert.deepEqual(sentOf('task-modal-close', from), [{ type: 'task-modal-close', project: ROOT, key: 'ACME-12' }], 'the extension hears it closed');
  taskModal.area.receive!['task-modal']!({ model: sampleTicket(Date.now()), tab: {} } as never);
  assert.equal(d.open, false, 'the late model opens nothing');
});

test('a model for another task than the one loading is late, and doesn\'t replace it', () => {
  api.postMessage({ type: 'task-modal-open', project: ROOT, key: 'ACME-19', title: 'Second' });
  const d = taskDialog();
  taskModal.area.receive!['task-modal']!({ model: sampleTicket(Date.now()), tab: {} } as never);
  assert.deepEqual([d.open, loading(d).words, d.getAttribute('aria-label')], [true, 'Opening ACME-19…', 'ACME-19: Second']);
  escape(d);
});

test('a load that failed shows why in the modal, with Try again, which asks again', () => {
  api.postMessage({ type: 'task-modal-open', project: ROOT, key: 'ACME-12', title: 'Fix the export' });
  const d = taskDialog();
  taskModal.area.receive!['task-modal-failed']!({ project: ROOT, key: 'ACME-12', why: 'Its project isn\'t open.' } as never);
  const f = failure(d);
  assert.match(f.text, /ACME-12 didn't open\. Its project isn't open\./);
  assert.equal(bodyOf(d).getAttribute('aria-busy'), null, 'no longer busy');
  // A failure for another task changes nothing.
  taskModal.area.receive!['task-modal-failed']!({ project: ROOT, key: 'ACME-99', why: 'x' } as never);
  const from = page.sent.length;
  f.retry!.click();
  assert.deepEqual(sentOf('task-modal-open', from), [{ type: 'task-modal-open', project: ROOT, key: 'ACME-12', title: 'Fix the export' }]);
  assert.equal(loading(d).words, 'Opening ACME-12…', 'loading again');
  escape(d);
});

test('Build it opens its sheet loading at the click; a refusal says why in it; a sheet after it closed opens nothing', () => {
  assert.deepEqual(dispatch.OPENS_SHEET, SHEET_COMMANDS, 'a copy of the extension\'s list');
  const sheet = sampleSheet(Date.now(), 'analysed');
  api.postMessage({ type: 'run', command: 'acc.task.dispatch', ref: { project: sheet.project, task: sheet.task } });
  const d = dialogOf('dispatch-sheet');
  assert.equal(d.open, true);
  assert.equal(loading(d).words, `Opening the choices for ${sheet.task}…`);
  assert.equal(d.all('ds-go')[0]!.disabled, true, 'Build it waits for the choices');
  heard({ type: 'ran', command: 'acc.task.dispatch', ref: { project: sheet.project, task: sheet.task }, phase: 'done', ok: false, error: 'It has no plan yet.' });
  assert.match(failure(d).text, /It has no plan yet\./);
  escape(d);
  assert.equal(d.open, false);
  dispatch.area.receive!['dispatch-sheet']!({ sheet } as never);
  assert.equal(d.open, false, 'the sheet that came after the close opens nothing');
  // Asked again, the sheet fills it.
  api.postMessage({ type: 'run', command: 'acc.task.dispatch', ref: { project: sheet.project, task: sheet.task } });
  dispatch.area.receive!['dispatch-sheet']!({ sheet } as never);
  assert.deepEqual([d.open, bodyOf(d).all('loading-state').length, bodyOf(d).getAttribute('aria-busy')], [true, 0, null]);
  escape(d);
});

test('Build it done with no sheet yet waits the grace, then closes rather than spin', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    api.postMessage({ type: 'run', command: 'acc.task.dispatchAnyway', ref: { project: ROOT, task: 'ACME-35' } });
    const d = dialogOf('dispatch-sheet');
    heard({ type: 'ran', command: 'acc.task.dispatchAnyway', ref: { project: ROOT, task: 'ACME-35' }, phase: 'done', ok: true });
    mock.timers.tick(dispatch.SHEET_GRACE_MS - 1);
    assert.equal(d.open, true);
    mock.timers.tick(1);
    assert.equal(d.open, false);
  } finally {
    mock.timers.reset();
  }
});

test('Connect a tracker and Set up cloud builders open loading at the click; closed before their page comes, it is cancelled, not shown', () => {
  for (const [send, cls, words, model, cancel] of [
    [{ type: 'toolbar', command: 'acc.trackers.add', arg: null }, 'connect-modal', 'Opening Connect a tracker…', (m: unknown) => home({ connect: m }), 'connect-cancel'],
    [{ type: 'toolbar', command: CLOUD_SETUP.command, project: ROOT }, 'cloud-modal', 'Opening Set up cloud builders…', (m: unknown) => home({ cloudSetup: m }), 'cloud-setup-cancel'],
  ] as const) {
    const area = cls === 'connect-modal' ? connect.area : cloud.area;
    api.postMessage(send);
    const d = dialogs(cls).at(-1)!;
    assert.deepEqual([d.open, loading(d).words], [true, words], cls);
    area.after!(home());
    assert.equal(d.open, true, `${cls}: a model with none yet leaves it loading`);
    escape(d);
    assert.equal(d.open, false);
    const from = page.sent.length;
    area.after!(model({ id: 's-1', step: 'start', title: 'x', steps: [] }));
    assert.deepEqual([d.open, sentOf(cancel, from)], [false, [{ type: cancel, session: 's-1' }]], `${cls}: the page that came after the close is cancelled`);
  }
  assert.equal(cloud.CLOUD_SETUP_COMMAND, CLOUD_SETUP.command, 'a copy of core\'s command');
});
