// The Agent panel on a task's page (T-142): at a glance its state, its checks in one line, what holds it up and
// its few actions; the rest under More actions and Details, closed at first and remembered per ticket. Drawn in
// page-dom.ts's small document; the panel on a real page, at each width and theme, is the screenshot run's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Action, Look } from '../src/model/shared.ts';
import type { CheckRow, TicketAcc, TicketModel } from '../src/model/task-page.ts';
import { checkLook } from '../src/model/task-page.ts';
import { pageDom, type PageElement } from './page-dom.ts';
import { sampleAgentPanelTicket } from '../scripts/fixtures/agent-panel.ts';
import { sampleTicket } from '../scripts/fixtures/task-page.ts';
import { detailsKey } from '../webview/agent-glance.ts';

// A tab that keeps its memory, as VS Code's does: the folds read what was opened on the next draw.
pageDom();
let saved: unknown;
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {}, getState: () => saved, setState: (s: unknown) => { saved = s; } });
const { renderTicket } = await import('../webview/task-page.ts');
const { checkSummary, splitActions, stateGlance } = await import('../webview/agent-glance.ts');

const NOW = Date.now();
const ROOT = '/Users/me/code/acme-service';

/** The ticket's side column and its Agent panel, drawn. */
function panel(m: TicketModel): PageElement | null {
  const grid = (renderTicket(m) as unknown as PageElement[]).find((n) => n.classList.contains('ticket-grid'))!;
  return grid.all('side-agent')[0] ?? null;
}
const check = (gate: string, status: CheckRow['status'], summary = '', extra: Partial<CheckRow> = {}): CheckRow => {
  const c = { gate, status, summary, waived: false, ...extra };
  return { ...c, look: checkLook(c), waivable: false };
};
const labelsIn = (p: PageElement): string[] => p.all('ta-btn').map((b) => b.all('ta-label')[0]!.textContent);
const foldOf = (p: PageElement, cls: string): PageElement => p.all(cls)[0]!;
const text = (e: PageElement | undefined): string => e?.textContent ?? '';

test('the check summary is one line that names each check that failed, waits for a person or didn\'t run', () => {
  const sum = (checks: CheckRow[]): Look | null => checkSummary(checks);
  assert.equal(sum([check('format', 'pass'), check('validate', 'fail'), check('static', 'pass'), check('a', 'pass'), check('b', 'pass')])!.label, '4 passed, 1 failed: validate');
  assert.deepEqual(sum([check('format', 'pass'), check('validate', 'fail')]), { label: '1 passed, 1 failed: validate', icon: 'error', tone: 'orange' });
  assert.equal(sum([check('validate', 'fail'), check('static', 'error')])!.label, '2 failed: validate and static');
  assert.deepEqual(sum([check('format', 'pass'), check('flow-tests', 'hold')]), { label: '1 passed, 1 needs a person: flow-tests', icon: 'person', tone: 'orange' });
  assert.equal(sum([check('a', 'fail'), check('b', 'fail'), check('c', 'fail'), check('d', 'hold'), check('e', 'hold')])!.label, '3 failed: a, b and c, 2 need a person: d and e');
  assert.equal(sum([check('format', 'pass'), check('lwc', 'skip', 'Not run on this commit')])!.label, '1 passed, 1 not run: lwc');
  assert.equal(sum([check('format', 'pass'), check('static', 'skip', 'Waived', { waived: true })])!.label, '1 passed, 1 waived');
  // Every check passed: one phrase, in blue, with its icon.
  assert.deepEqual(sum([check('format', 'pass'), check('validate', 'pass')]), { label: '2 checks passed', icon: 'pass', tone: 'blue' });
  // Edge: none of them ran on this commit.
  assert.deepEqual(sum(Array.from({ length: 5 }, (_, i) => check(`c${i}`, 'skip', 'Not run on this commit'))), { label: '5 checks, not run on this commit', icon: 'circle-slash', tone: 'neutral' });
  assert.equal(sum([check('format', 'skip', 'Not run on this commit')])!.label, '1 check, not run on this commit');
  // Edge: no checks, no line.
  assert.equal(sum([]), null);
});

test('a task being built shows its state, one line for its checks naming what failed, and no depth', () => {
  saved = undefined;
  const m = sampleTicket(NOW);
  const p = panel(m)!;
  const glance = foldOf(p, 'agent-glance');
  assert.equal(text(foldOf(glance, 'agent-state')).startsWith(m.acc!.look.label), true, text(glance));
  const line = text(foldOf(glance, 'agent-checks'));
  // ACME-12's checks: 1 passed, 2 more failed or hit a ratchet, one needs a person, one waived, one not run.
  assert.match(line, /3 failed: validate, violations and stray-files/);
  assert.match(line, /1 needs a person: flow-tests/);
  assert.match(line, /1 not run: lwc-tests/);
  // The depth is in Details: not in the glance.
  for (const word of ['Environment', 'Branch', 'Worktree', 'Builder session']) assert.ok(!text(glance).includes(word), `${word} isn't at a glance`);
});

test('the glance for each state: blocked says why, in review and sent back say their state, and no task says it isn\'t in the work', () => {
  saved = undefined;
  const blocked = panel(sampleAgentPanelTicket(NOW, 'blocked'))!;
  assert.match(text(foldOf(blocked, 'agent-state')), /^Blocked/);
  assert.match(text(foldOf(blocked, 'agent-hold')), /^Why: The checks error on validate/);
  // Blocked with its builder gone: nothing contradicts it.
  assert.equal(blocked.all('agent-disagree').length, 0);
  assert.equal(blocked.all('state-chip').length, 1, 'one chip: the state');
  const review = sampleTicket(NOW, 'ACME-20');
  assert.equal(text(foldOf(panel(review)!, 'agent-state')).startsWith(review.acc!.look.label), true);
  const back = sampleTicket(NOW, 'ACME-33');
  assert.equal(text(foldOf(panel(back)!, 'agent-state')).startsWith(back.acc!.look.label), true);
  assert.match(text(foldOf(panel(back)!, 'agent-checks')), /2 checks passed/);
  // Edge: a ticket not in the person's work has no glance, only Add to my work.
  const none = panel(sampleTicket(NOW, 'ACME-31'))!;
  assert.equal(none.all('agent-glance').length, 0);
  assert.match(none.textContent, /isn't in your work yet/);
});

test('a task blocked while its builder still shows Working says so in one line, not two chips that contradict', () => {
  saved = undefined;
  const m = sampleAgentPanelTicket(NOW, 'disagree');
  assert.equal(m.acc!.state, 'blocked');
  assert.equal(m.acc!.agent!.label, 'Working', 'the case is real: a blocked task keeps the session it was tied to');
  const p = panel(m)!;
  assert.equal(text(foldOf(p, 'agent-disagree')), 'Blocked: its builder is still working');
  assert.equal(p.all('state-chip').length, 0, 'no chip beside the line');
  // The words stand on their own and carry an icon: orange alone never says it.
  assert.ok(foldOf(p, 'agent-disagree').all('codicon-warning').length === 1);
  // Edge: each state that isn't running says it the same way; a running task and its Working session are one chip.
  const sees = (state: string, label: string, session: string) => stateGlance({ look: { label, icon: 'x', tone: 'blue' }, state, agent: { label: session, icon: 'y', tone: 'blue' } });
  assert.equal(sees('review', 'In review', 'Working').disagree, 'In review: its builder is still working');
  assert.equal(sees('rework', 'Sent back', 'Working in the cloud').disagree, 'Sent back: its builder is still working');
  assert.deepEqual(sees('running', 'Running', 'Working'), { disagree: null, session: null });
  assert.deepEqual(sees('blocked', 'Blocked', 'Needs you'), { disagree: null, session: { label: 'Needs you', icon: 'y', tone: 'blue' } }, 'a session that needs a person agrees with a blocked task, and keeps its chip');
  assert.deepEqual(stateGlance({ look: { label: 'Blocked', icon: 'x', tone: 'orange' }, state: 'blocked', agent: null }), { disagree: null, session: null }, 'no session, nothing to say');
  assert.deepEqual(sees('review', 'In review', 'In review'), { disagree: null, session: null }, 'the same words once');
});

test('one next step and at most two more are in view; every other action is under More actions, none lost', () => {
  saved = undefined;
  const models = [sampleTicket(NOW), sampleAgentPanelTicket(NOW, 'blocked'), sampleTicket(NOW, 'ACME-20'), sampleTicket(NOW, 'ACME-33'), sampleTicket(NOW, 'ACME-29'), sampleTicket(NOW, 'ACME-35'), sampleTicket(NOW, 'ACME-19')];
  let checked = 0;
  for (const m of models) {
    const a = m.acc!;
    const { shown, more } = splitActions(a.actions, a.state);
    assert.ok(shown.length >= 1 && shown.length <= 3, `${m.key}: ${shown.length} in view`);
    assert.deepEqual([...shown, ...more].map((x: Action) => x.command).sort(), a.actions.map((x) => x.command).sort(), `${m.key}: every command still offered`);
    const p = panel(m)!;
    const inView = p.all('task-actions').filter((s) => !s.all('agent-more').length && !foldOf(p, 'agent-more')?.all('task-actions').includes(s));
    assert.deepEqual(inView.flatMap((s) => s.all('ta-btn')).map((b) => b.all('ta-label')[0]!.textContent), shown.map((x) => x.label), m.key);
    // Everything is drawn, in view or in the menu, by label, as the panel drew it before.
    assert.deepEqual(labelsIn(p).sort(), a.actions.map((x) => x.label).sort(), m.key);
    checked++;
  }
  assert.equal(checked, models.length);
  // A blocked task: Move, then Unblock and Watch.
  const blocked = sampleAgentPanelTicket(NOW, 'blocked').acc!;
  assert.deepEqual(splitActions(blocked.actions, 'blocked').shown.map((x) => x.command), ['acc.task.move', 'acc.task.unblock', 'acc.task.watch']);
  // Edge: no actions, nothing in view and no menu.
  assert.deepEqual(splitActions([], 'done'), { shown: [], more: [] });
});

test('an action that can\'t run now stays in More actions, off, with its reason', () => {
  saved = undefined;
  const m = sampleAgentPanelTicket(NOW, 'blocked');
  const off: Action = { command: 'acc.task.cleanup', label: 'Clean up', icon: 'trash', ref: { project: ROOT, task: 'ACME-12' }, disabled: 'Its pull request is still open.' };
  const withOff: TicketModel = { ...m, acc: { ...m.acc!, actions: [...m.acc!.actions.filter((a) => a.command !== off.command), off] } };
  const more = foldOf(panel(withOff)!, 'agent-more');
  const tile = more.all('ta-btn').find((b) => b.all('ta-label')[0]!.textContent === 'Clean up')!;
  assert.equal(tile.disabled, true);
  assert.equal(tile.title, 'Clean up: Its pull request is still open.');
  assert.equal(tile.getAttribute('aria-description'), 'Its pull request is still open.');
});

test('Details is closed at first, holds each field and each check with Accept anyway, and stays open once opened, per ticket', () => {
  saved = undefined;
  const m = sampleTicket(NOW);
  const a = m.acc as TicketAcc;
  let p = panel(m)!;
  const details = foldOf(p, 'agent-details') as PageElement & { open: boolean };
  assert.ok(!details.open, 'closed by default');
  const names = details.all('fields')[0]!.all().filter((e) => e.tagName === 'DT').map((e) => e.textContent);
  for (const n of ['Environment', 'Branch', 'Worktree']) assert.ok(names.includes(n), n);
  if (a.agent && a.model) assert.ok(names.includes('Model and effort'));
  if (a.agentName) assert.ok(names.includes('Builder session'));
  if (a.place) assert.ok(names.includes('Runs on'));
  assert.equal(details.all('check').length, a.checks.length, 'each check on its own lines');
  assert.equal(details.all('check-waive').length, a.checks.filter((c) => c.waivable).length, 'Accept anyway where it applies');
  assert.ok(details.all('check-waive').length > 0);
  // Opened, it stays so on the next draw, for this ticket and not another.
  details.open = true;
  for (const f of details.listeners.get('toggle') ?? []) f({});
  assert.deepEqual((saved as { opened: string[] }).opened, [detailsKey(ROOT, 'ACME-12')]);
  p = panel(m)!;
  assert.equal((foldOf(p, 'agent-details') as PageElement & { open: boolean }).open, true);
  assert.equal((foldOf(panel(sampleTicket(NOW, 'ACME-20'))!, 'agent-details') as PageElement & { open: boolean }).open, false, 'another ticket\'s stays closed');
  // Closed again, the tab forgets it.
  const again = foldOf(p, 'agent-details') as PageElement & { open: boolean };
  again.open = false;
  for (const f of again.listeners.get('toggle') ?? []) f({});
  assert.deepEqual((saved as { opened: string[] }).opened, []);
});

test('the glance never has more than the state, its checks and its reason: no fact from Details, nothing twice', () => {
  saved = undefined;
  for (const m of [sampleTicket(NOW), sampleAgentPanelTicket(NOW, 'blocked'), sampleAgentPanelTicket(NOW, 'disagree'), sampleTicket(NOW, 'ACME-35')]) {
    const glance = foldOf(panel(m)!, 'agent-glance');
    assert.ok(glance.childElementCount <= 3, `${m.key}: ${glance.childElementCount} lines`);
    assert.equal(glance.all('check').length, 0, 'no check of its own at a glance');
  }
  // A task waiting on another says so in its reason line, where it was a row of Details before.
  const waits = sampleTicket(NOW, 'ACME-35');
  assert.match(text(foldOf(panel({ ...waits, acc: { ...waits.acc!, waitingOn: ['ACME-12', 'ACME-19'] } })!, 'agent-hold')), /^Waiting on ACME-12, ACME-19$/);
});
