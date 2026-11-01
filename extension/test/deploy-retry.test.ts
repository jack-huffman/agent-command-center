// Retry with an agent on a ticket's page (T-174, src/model/deploy-retry.ts, webview/deploy-retry.ts): on the Changes
// tab's development row and in a banner above the tabs, where the ticket's deploy to the development org failed or
// never ran. On, a click asks the extension to retry; off, the button says why beside it and in its title: while the
// builder runs, with its worktree gone. A generic project, a deploy that passed and a builder still at its work before
// it deployed show nothing. Drawn in page-dom.ts's small document; at each width and theme, the screenshot run's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Task } from '../../packages/core/src/ledger.ts';
import { isFromWebview } from '../src/model/messages.ts';
import { area as retryArea, deployRetry, type DeployRetry, RETRY_LOOK, retryArgs } from '../src/model/deploy-retry.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { CONFIG, sampleDeployTicket } from '../scripts/fixtures/ticket-deploy.ts';
import { ROOT } from '../scripts/fixtures/shared.ts';
import { pageDom, type PageElement } from './page-dom.ts';

const dom = pageDom();
let saved: Record<string, unknown> | undefined;
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { dom.sent.push(m); }, getState: () => saved, setState: (s: Record<string, unknown>) => { saved = s; } });
const { retryControl } = await import('../webview/deploy-retry.ts');
const { renderBanners, retryBanner } = await import('../webview/banners.ts');
const { renderDeploy } = await import('../webview/changes.ts');

const NOW = Date.parse('2026-11-01T12:00:00Z');
const AT = '2026-11-01T11:00:00.000Z';
const LOCK = 'The deploy to acme-dev failed (job 0Af4), 1 problem: unable to obtain exclusive access to this record\nat line 2';
const task = (more: Partial<Task> = {}): Task => ({
  id: 'ACME-12', title: 'Premium escalation', state: 'blocked', environment: 'dev', pr: { number: 58, url: 'u', state: 'open' }, promotions: [], deploys: [],
  deployFailures: [{ env: 'dev', org: 'acme-dev', at: AT, reason: LOCK }], run: { branch: 'task/ACME-12', worktree: '/wt/ACME-12', sessionId: 's1' }, ...more,
} as unknown as Task);
const retry = (more: Partial<Parameters<typeof deployRetry>[0]> = {}): DeployRetry | null => deployRetry({ config: CONFIG, task: task(), runs: false, worktree: true, ...more });
const buttonOf = (e: PageElement): PageElement => [e, ...e.all()].find((x) => x.tagName === 'BUTTON' && x.classList.contains('dp-retry'))!;
function fresh(): void {
  saved = undefined;
  dom.sent.length = 0;
}

test('a failed deploy to the development org shows Retry with an agent, on, with why it failed on one line in its words', () => {
  const r = retry()!;
  assert.deepEqual({ ...r }, {
    task: 'ACME-12', label: 'Retry with an agent', env: 'Dev', branch: 'dev', look: RETRY_LOOK.failed,
    failure: 'The deploy to acme-dev failed (job 0Af4), 1 problem: unable to obtain exclusive access to this record', disabled: null, retrying: false, error: null,
  });
  assert.deepEqual(RETRY_LOOK.failed, { label: 'Deploy failed', icon: 'warning', tone: 'orange' }, 'orange, never red');
  assert.deepEqual(RETRY_LOOK.never, { label: 'Not deployed', icon: 'circle-large-outline', tone: 'neutral' });
});

test('a builder that never deployed shows the same action, saying it never deployed', () => {
  const r = retry({ task: task({ deployFailures: [] }) })!;
  assert.equal(r.label, 'Retry with an agent');
  assert.equal(r.disabled, null);
  assert.deepEqual(r.look, RETRY_LOOK.never);
  assert.equal(r.failure, 'It never deployed to Dev: its builder stopped first.');
});

test('the action is off with why while its builder runs and with its worktree gone; a click on its way waits; a failed click says why', () => {
  assert.equal(retry({ runs: true })!.disabled, 'ACME-12\'s builder is still working on it. Wait for it to finish or block.');
  assert.equal(retry({ worktree: false })!.disabled, 'ACME-12\'s worktree isn\'t on disk any more, so its builder has nowhere to carry on. Build it again.');
  const waiting = retry({ retrying: true })!;
  assert.deepEqual([waiting.retrying, waiting.disabled], [true, 'Its builder is starting again.']);
  assert.equal(retry({ error: 'ACME-12 can\'t go back to running: 2 builders are running in this project, and its cap is 2 (agents.max).' })!.error, 'ACME-12 can\'t go back to running: 2 builders are running in this project, and its cap is 2.', 'acc\'s words, in the process words: no settings name');
});

test('edge cases that show nothing: a generic project, a deploy that passed after the failure, and a builder still at its work before it deployed', () => {
  assert.equal(retry({ config: { ...CONFIG, profile: 'generic' } }), null);
  assert.equal(retry({ task: task({ deploys: [{ env: 'dev', org: 'acme-dev', sha: 'a', at: '2026-11-01T11:30:00.000Z', jobId: '0Af', paths: [], components: [], verified: 0, tests: null }] }) }), null);
  assert.equal(retry({ task: task({ state: 'running', deployFailures: [] }), runs: true }), null);
  // A failed deploy while its builder runs still shows, off.
  assert.ok(retry({ task: task({ state: 'running' }), runs: true })?.disabled);
});

test('the development row draws the action, and its click asks the extension to retry this ticket; the other rows have none', () => {
  fresh();
  const m = sampleDeployTicket(NOW, 'retry');
  assert.ok(m.retry && !m.retry.disabled, 'the sample is on');
  const drawn = renderDeploy(m, m.deploy!) as unknown as PageElement;
  const rows = drawn.all('dp-row');
  const dev = rows.find((r) => r.dataset.env === 'dev')!;
  const b = buttonOf(dev);
  assert.match(b.textContent, /Retry with an agent/);
  assert.equal(b.disabled, false);
  assert.match(b.title, /^Retry with an agent: its builder deploys to Dev again/);
  assert.equal(rows.filter((r) => r.all('dp-retry').length).length, 1, 'on the development row alone');
  b.click();
  assert.deepEqual(dom.sent, [{ type: 'deploy-retry', project: ROOT, task: 'ACME-12' }]);
});

test('off, the button says why beside it and in its title, and a click sends nothing; a failed click says why under it', () => {
  fresh();
  const m = sampleDeployTicket(NOW, 'retry-off');
  const box = retryControl(m, m.retry!) as unknown as PageElement;
  const b = buttonOf(box);
  assert.equal(b.disabled, true);
  assert.equal(b.title, 'Retry with an agent: ACME-12\'s builder is still working on it. Wait for it to finish or block.');
  assert.equal(b.getAttribute('aria-description'), 'ACME-12\'s builder is still working on it. Wait for it to finish or block.');
  assert.match(box.all('dp-retry-why')[0]!.textContent, /still working on it/);
  b.listeners.get('click')?.forEach((f) => f({ stopPropagation: () => undefined }));
  assert.deepEqual(dom.sent, [], 'a click on an off button sends nothing');
  const failed = retryControl(m, { ...m.retry!, disabled: null, error: 'claude agents didn\'t answer' }) as unknown as PageElement;
  assert.match(failed.all('dp-retry-error')[0]!.textContent, /It didn't start: claude agents didn't answer/);
  const waiting = retryControl(m, { ...m.retry!, retrying: true, disabled: 'Its builder is starting again.' }) as unknown as PageElement;
  assert.match(buttonOf(waiting).textContent, /Retrying…/);
  assert.equal(waiting.all('dp-retry-why').length, 0, 'the button itself says it waits');
});

test('the banner says the deploy failed, after a blocked banner, and opened shows why and the action', () => {
  fresh();
  const m = sampleDeployTicket(NOW, 'retry');
  const b = retryBanner(m, m.retry!) as unknown as PageElement & { open: boolean };
  assert.equal(b.dataset.banner, 'deploy');
  assert.match(b.all('banner-line')[0]!.textContent, /^Deploy failed to Dev$/);
  assert.match(b.all('banner-body')[0]!.textContent, /unable to obtain exclusive access/);
  assert.ok(b.all('dp-retry').length, 'the action, in the banner');
  const ids = (mm: TicketModel) => (renderBanners(mm) as unknown as PageElement[]).map((x) => x.dataset.banner);
  assert.equal(ids(m)[0], 'deploy', 'first, with no blocked banner');
  const blocked = { ...m, acc: { ...m.acc!, blocker: { headline: 'The org is locked', text: 'The org is locked', shape: null } } } as unknown as TicketModel;
  assert.deepEqual(ids(blocked).slice(0, 2), ['blocked', 'deploy'], 'after why it\'s blocked');
  assert.ok(!ids({ ...m, retry: null }).includes('deploy'), 'edge: no banner without the action');
});

test('the page\'s message is checked: a task key and a project; anything else is refused; acc\'s words are acc resume --deploy', () => {
  assert.ok(isFromWebview({ type: 'deploy-retry', project: '/r', task: 'ACME-12' }));
  assert.ok(!isFromWebview({ type: 'deploy-retry', project: '/r', task: 'not a key' }));
  assert.ok(!isFromWebview({ type: 'deploy-retry', project: '/r' }));
  assert.ok(retryArea.messages?.['deploy-retry']);
  assert.deepEqual(retryArgs('ACME-12'), ['resume', 'ACME-12', '--deploy']);
});
