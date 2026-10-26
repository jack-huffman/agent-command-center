// What a section of a task's page asks the extension for (T-81, T-84, T-100, T-101): one ask at a time a task,
// shown as on its way until the reply, and a refusal that stays, saying why, until it is tried again.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pageDom } from './page-dom.ts';

const page = pageDom();
const { TicketAsks } = await import('../webview/ticket-asks.ts');
const { peekKey } = await import('../webview/dom.ts');

const key = peekKey('/repo', 'acme-1');
const reply = (over: Record<string, unknown> = {}) => ({ project: '/repo', task: 'ACME-1', ok: true, ...over });

test('an ask is on its way until the reply, and nothing is sent while another is', () => {
  const asks = new TicketAsks<'draft' | 'clear'>();
  page.sent.length = 0;
  asks.ask(key, 'draft', { type: 'criteria-draft', project: '/repo', task: 'ACME-1' });
  asks.ask(key, 'clear', { type: 'verify-clear', project: '/repo', task: 'ACME-1' });
  assert.deepEqual(page.sent, [{ type: 'criteria-draft', project: '/repo', task: 'ACME-1' }], 'the second isn\'t sent');
  assert.equal(asks.busy(key), 'draft');
  asks.done(reply());
  assert.equal(asks.busy(key), undefined);
  assert.equal(asks.error(key), undefined);
});

test('a refusal keeps why until the next ask, and a success runs what the caller hands it', () => {
  const asks = new TicketAsks();
  const ok: string[] = [];
  asks.ask(key, 'go', { type: 'x' });
  asks.done(reply({ ok: false, error: ' acc said no ' }), (k) => ok.push(k));
  assert.deepEqual([asks.busy(key), asks.error(key), ok], [undefined, 'acc said no', []]);
  asks.ask(key, 'go', { type: 'x' });
  assert.equal(asks.error(key), undefined, 'asking again drops the old reason');
  asks.done(reply(), (k) => ok.push(k));
  assert.deepEqual(ok, [key]);
});

test('edge: a reply to what wasn\'t asked does nothing, and a refusal with no reason says so in plain words', () => {
  const asks = new TicketAsks();
  let ran = false;
  asks.done(reply(), () => { ran = true; });
  assert.deepEqual([ran, asks.error(key)], [false, undefined]);
  asks.ask(key, 'go', { type: 'x' });
  asks.done(reply({ ok: false, error: '  ' }));
  assert.equal(asks.error(key), 'It didn\'t go, and the Command Center didn\'t say why.');
});

test('the page can show a reason of its own without asking anything', () => {
  const asks = new TicketAsks();
  page.sent.length = 0;
  asks.fail(key, 'The QA comment\'s draft isn\'t on this page.');
  assert.equal(asks.error(key), 'The QA comment\'s draft isn\'t on this page.');
  assert.deepEqual([asks.busy(key), page.sent], [undefined, []]);
});
