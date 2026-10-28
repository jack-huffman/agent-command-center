// A task page's tabs (T-134, webview/tab-rules.ts and task-tabs.ts): which show for a ticket, their counts, a tab that needs the person saying so,
// the tab a page opens on, the tab remembered per ticket, the keys, and links that name a part. Drawn in
// page-dom.ts's small document; the keys in a browser and the narrow tab row are the behaviour and
// screenshot runs'.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TicketModel } from '../src/model/task-page.ts';
import { TASK_PART } from '../src/model/task-tabs.ts';
import type { TaskTab } from '../webview/tab-rules.ts';
import { cardActions } from '../src/model/cards.ts';
import { area as modalArea } from '../src/model/task-modal.ts';
import { noticeBurst, noticePart } from '../src/logic/notices.ts';
import { pageDom, type PageElement } from './page-dom.ts';
import { sampleTicket } from '../scripts/fixtures/task-page.ts';
import { samplePlanNeedsYouTicket, sampleTabsTicket } from '../scripts/fixtures/task-tabs.ts';
import { sampleHub } from '../scripts/fixtures/hub.ts';
import { ROOT } from '../scripts/fixtures/shared.ts';

const page = pageDom();
let saved: Record<string, unknown> | undefined;
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {}, getState: () => saved, setState: (s: Record<string, unknown>) => { saved = s; } });
const { renderTicket } = await import('../webview/task-page.ts');
const { askedComment, chooseTab, forgetDrawn, renderTabs, afterTabs } = await import('../webview/task-tabs.ts');
const { NEEDS_FIRST, NEEDS_YOU, openingTab, partTab, TAB_LOOK, TAB_ORDER, tabName, taskTabs } = await import('../webview/tab-rules.ts');

const NOW = Date.now();
const ids = (m: TicketModel): string[] => taskTabs(m).map((t) => t.id);
const quiet = (m: TicketModel): TicketModel => ({ ...m, updates: [], analysis: m.analysis ? { ...m.analysis, look: { ...m.analysis.look, tone: 'blue' }, planState: m.analysis.planState ? { ...m.analysis.planState, look: { ...m.analysis.planState.look, tone: 'blue' } } : null } : null });

/** The page's tab row and panels, as drawn. */
function drawn(m: TicketModel): { tabs: PageElement[]; panels: PageElement[]; list: PageElement } {
  const grid = (renderTicket(m) as unknown as PageElement[]).find((n) => n.classList.contains('ticket-grid'))!;
  const list = grid.all('task-tabs')[0]!;
  return { list, tabs: grid.all('task-tab'), panels: grid.all('task-panel') };
}
const selected = (d: { tabs: PageElement[] }): string | undefined => d.tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.tab;
const shown = (d: { panels: PageElement[] }): string[] => d.panels.filter((p) => !p.hidden).map((p) => p.dataset.tab!);
const press = (tab: PageElement, key: string): boolean => {
  let stopped = false;
  for (const f of tab.listeners.get('keydown') ?? []) f({ key, preventDefault: () => { stopped = true; } });
  return stopped;
};
function fresh(memory?: Record<string, unknown>): void {
  saved = memory;
  forgetDrawn();
}

// ---------------------------------------------------------------- which tabs show

test('a ticket with every part shows Ticket, Plan, Changes and Verify, in that order, each with its icon and name', () => {
  const tabs = taskTabs(sampleTabsTicket(NOW));
  assert.deepEqual(tabs.map((t) => t.id), [...TAB_ORDER]);
  for (const t of tabs) assert.deepEqual([t.name, t.icon], [TAB_LOOK[t.id].name, TAB_LOOK[t.id].icon]);
  assert.deepEqual(tabs.map((t) => t.name), ['Ticket', 'Plan', 'Changes', 'Verify']);
});

test('edge case: a tab with nothing in it is hidden, never drawn empty; Ticket always shows', () => {
  const all = sampleTabsTicket(NOW);
  // Without each part, its tab goes; Plan stays while anything of it stays.
  assert.deepEqual(ids({ ...all, verify: null }), ['ticket', 'plan', 'changes']);
  assert.deepEqual(ids({ ...all, changes: null }), ['ticket', 'plan', 'verify']);
  assert.deepEqual(ids({ ...all, analysis: null }), ['ticket', 'plan', 'changes', 'verify'], 'the criteria keep Plan');
  assert.deepEqual(ids({ ...all, analysis: null, criteria: null, talk: null, acc: { ...all.acc!, notes: null, note: null, noteMissing: null } }), ['ticket', 'changes', 'verify']);
  // Each Changes part alone keeps Changes.
  const bare: TicketModel = { ...all, changes: null, team: null, field: null, records: null, manifest: null };
  assert.ok(!ids(bare).includes('changes'));
  let checked = 0;
  for (const part of ['changes', 'team', 'field', 'records', 'manifest'] as const) {
    const with1 = { ...bare, [part]: { look: { label: 'x', icon: 'pass', tone: 'blue' }, changed: [], counts: null } } as unknown as TicketModel;
    assert.ok(ids(with1).includes('changes'), part);
    checked++;
  }
  assert.equal(checked, 5);
  // ACME-31, not in the person's work: only Ticket, and the page draws one tab and one panel.
  const lone = sampleTicket(NOW, 'ACME-31');
  assert.deepEqual(ids(lone), ['ticket']);
  fresh();
  const d = drawn(lone);
  assert.deepEqual([d.tabs.length, d.panels.length], [1, 1]);
});

test('a tab says how many things it holds where that helps: Ticket its comments, Changes its files', () => {
  const m = sampleTabsTicket(NOW);
  const tab = (id: string, x = m): TaskTab => taskTabs(x).find((t) => t.id === id)!;
  assert.equal(tab('ticket').count, `${m.comments.length} comments`);
  assert.equal(tab('changes').count, String(m.changes!.counts?.changed));
  assert.equal(tab('plan').count, null);
  // Edge: one comment is "1 comment"; none says nothing.
  assert.equal(tab('ticket', { ...m, comments: m.comments.slice(0, 1) }).count, '1 comment');
  assert.equal(tab('ticket', { ...m, comments: [] }).count, null);
  // Before there's work, Changes counts its planned files.
  const planned = { ...m.changes!, counts: null, changed: [{ id: 'g', title: 'g', sets: [{ head: 'a', items: [{}, {}] }, { head: 'b', items: [{}] }] }] } as unknown as TicketModel['changes'];
  assert.equal(tab('changes', { ...m, changes: planned }).count, '3');
  assert.equal(tabName(tab('ticket')), `Ticket, ${m.comments.length} comments: needs you`);
});

test('a tab that needs the person says so in words, with the state that needs them; one that doesn\'t says nothing', () => {
  // ACME-21's plan has a choice to make and approval again: Plan needs you, with the plan's own words.
  const plan = taskTabs(samplePlanNeedsYouTicket(NOW)).find((t) => t.id === 'plan')!;
  assert.equal(plan.needs, samplePlanNeedsYouTicket(NOW).analysis!.look.label);
  assert.equal(tabName(plan), `Plan: ${NEEDS_YOU}`);
  // Verify choosing a pull request, an update to post on Ticket.
  const m = sampleTabsTicket(NOW);
  const verify = taskTabs({ ...m, verify: { ...m.verify!, look: { label: 'Choose its pull request', icon: 'git-pull-request', tone: 'orange' } } }).find((t) => t.id === 'verify')!;
  assert.equal(verify.needs, 'Choose its pull request');
  assert.equal(taskTabs(m).find((t) => t.id === 'ticket')!.needs, `${m.updates.length} update${m.updates.length === 1 ? '' : 's'} to post`);
  // Edge: a quiet ticket, nothing orange and no update: no tab needs the person.
  assert.ok(taskTabs(quiet(m)).every((t) => t.needs === null && !tabName(t).includes(NEEDS_YOU)));
});

test('drawn, a tab that needs the person shows an orange icon and the words, never the colour alone', () => {
  fresh();
  const d = drawn(samplePlanNeedsYouTicket(NOW));
  const plan = d.tabs.find((t) => t.dataset.tab === 'plan')!;
  const needs = plan.all('task-tab-needs')[0]!;
  assert.equal(needs.textContent, NEEDS_YOU);
  assert.equal(needs.all('codicon-bell').length, 1);
  assert.ok(needs.all('tone-orange').length + needs.all('codicon-bell').filter((i) => i.className.includes('orange')).length >= 1, needs.all('codicon-bell')[0]!.className);
  // Its name is its visible words, so a screen reader says what's shown: Plan, then needs you.
  assert.equal(plan.getAttribute('aria-label'), null);
  assert.ok(plan.textContent.startsWith('Plan') && plan.textContent.endsWith(NEEDS_YOU), plan.textContent);
  assert.ok(plan.title.startsWith('Plan: needs you. '));
  // A quiet tab has no marker.
  fresh();
  assert.ok(drawn(quiet(sampleTabsTicket(NOW))).tabs.every((t) => t.all('task-tab-needs').length === 0));
});

// ---------------------------------------------------------------- the tab a page opens on

test('the opening tab: a link\'s part, then what needs the person, then the tab last on show, then Ticket', () => {
  const tabs = taskTabs(sampleTabsTicket(NOW)).map((t) => ({ ...t, needs: null }));
  const needing = tabs.map((t) => (t.id === 'verify' ? { ...t, needs: 'x' } : t));
  assert.equal(openingTab(needing, 'changes', 'plan'), 'changes', 'a link wins');
  assert.equal(openingTab(needing, null, 'plan'), 'verify', 'what needs you before what was last on show');
  assert.equal(openingTab(tabs, null, 'plan'), 'plan', 'the tab last on show');
  assert.equal(openingTab(tabs, null, undefined), 'ticket');
  // Edge: a link to a tab that isn't shown, or a remembered tab gone since, falls through.
  const noVerify = tabs.filter((t) => t.id !== 'verify');
  assert.equal(openingTab(noVerify, 'verify', 'verify'), 'ticket');
  // Several need you: the plan first, as NEEDS_FIRST says, whatever the tab order.
  const both = tabs.map((t) => (t.id === 'ticket' || t.id === 'plan' ? { ...t, needs: 'x' } : t));
  assert.equal(openingTab(both, null, null), 'plan');
  assert.deepEqual([...NEEDS_FIRST].sort(), [...TAB_ORDER].sort());
});

test('a page whose plan needs approval opens on Plan, though Ticket has an update to post too', () => {
  fresh();
  const m = samplePlanNeedsYouTicket(NOW);
  assert.ok(m.updates.length > 0, 'the fixture has an update to post');
  const d = drawn(m);
  assert.equal(selected(d), 'plan');
  assert.deepEqual(shown(d), ['plan']);
});

test('with nothing needing the person, a page opens on the tab last on show for that ticket, remembered per ticket', () => {
  const m = quiet(sampleTabsTicket(NOW));
  fresh();
  assert.equal(selected(drawn(m)), 'ticket', 'nothing remembered: Ticket');
  const d = drawn(m);
  d.tabs.find((t) => t.dataset.tab === 'changes')!.click();
  assert.deepEqual(shown(d), ['changes']);
  assert.equal((saved!.tabs as Record<string, string>)[`${m.project}#${m.key}`], 'changes');
  // Opened again later (the page loaded afresh): Changes.
  forgetDrawn();
  assert.equal(selected(drawn(m)), 'changes');
  // Edge: another ticket isn't moved by it.
  const other = quiet(sampleTicket(NOW, 'ACME-19'));
  assert.equal(selected(drawn(other)), 'ticket');
  // Edge: a redraw of the same ticket keeps the tab on show, even when something comes to need the person.
  forgetDrawn();
  drawn(m).tabs.find((t) => t.dataset.tab === 'verify')!.click();
  assert.equal(selected(drawn({ ...m, updates: sampleTabsTicket(NOW).updates })), 'verify', 'a redraw keeps the tab on show');
});

test('edge case: a redraw after the tab on show went away opens afresh, and the memory starts empty', () => {
  fresh();
  const m = quiet(sampleTabsTicket(NOW));
  drawn(m).tabs.find((t) => t.dataset.tab === 'verify')!.click();
  assert.equal(selected(drawn({ ...m, verify: null })), 'ticket');
  fresh(undefined);
  assert.equal(chooseTab(m, taskTabs(m)), 'ticket');
});

// ---------------------------------------------------------------- keys and ARIA

test('the tab row is an ARIA tablist: each tab aria-selected, controlling its panel, which its tab names', () => {
  fresh();
  const m = quiet(sampleTabsTicket(NOW));
  const d = drawn(m);
  assert.equal(d.list.getAttribute('role'), 'tablist');
  assert.equal(d.list.getAttribute('aria-label'), `${m.key}'s page`);
  assert.equal(d.tabs.length, 4);
  for (const [i, t] of d.tabs.entries()) {
    const p = d.panels[i]!;
    assert.equal(t.tagName, 'BUTTON');
    assert.equal(t.getAttribute('role'), 'tab');
    assert.equal(t.getAttribute('aria-controls'), p.getAttribute('id'));
    assert.equal(p.getAttribute('role'), 'tabpanel');
    assert.equal(p.getAttribute('aria-labelledby'), t.getAttribute('id'));
    const on = t.getAttribute('aria-selected') === 'true';
    assert.equal(t.tabIndex, on ? 0 : -1);
    assert.equal(p.hidden, !on);
  }
  assert.equal(d.tabs.filter((t) => t.getAttribute('aria-selected') === 'true').length, 1);
});

test('the arrow keys move between tabs, wrapping at the ends; Home and End go to the ends; another key does nothing', () => {
  fresh();
  const d = drawn(quiet(sampleTabsTicket(NOW)));
  const tab = (id: string): PageElement => d.tabs.find((t) => t.dataset.tab === id)!;
  assert.equal(press(tab('ticket'), 'ArrowRight'), true);
  assert.equal(selected(d), 'plan');
  assert.equal(page.document.activeElement, tab('plan'), 'focus moves with it');
  press(tab('plan'), 'ArrowLeft');
  assert.equal(selected(d), 'ticket');
  press(tab('ticket'), 'ArrowLeft');
  assert.equal(selected(d), 'verify', 'left from the first wraps to the last');
  press(tab('verify'), 'ArrowRight');
  assert.equal(selected(d), 'ticket', 'right from the last wraps to the first');
  press(tab('ticket'), 'End');
  assert.deepEqual([selected(d), shown(d)], ['verify', ['verify']]);
  press(tab('verify'), 'Home');
  assert.equal(selected(d), 'ticket');
  assert.equal(press(tab('ticket'), 'Tab'), false);
  assert.equal(press(tab('ticket'), 'Enter'), false);
  assert.equal(selected(d), 'ticket');
});

test('sections still collapse inside a tab, and Details and the Agent panel stay beside the tabs', () => {
  fresh();
  const grid = (renderTicket(quiet(sampleTabsTicket(NOW))) as unknown as PageElement[]).find((n) => n.classList.contains('ticket-grid'))!;
  const plan = grid.all('task-panel').find((p) => p.dataset.tab === 'plan')!;
  const sec = plan.all('cc-section')[0]!;
  sec.all('sec-toggle')[0]!.click();
  assert.equal(sec.classList.contains('collapsed'), true);
  const side = grid.all('ticket-side')[0]!;
  assert.equal(side.all('task-tabs').length, 0);
  assert.equal(side.all('side-details').length + side.all('side-agent').length, 2);
});

// ---------------------------------------------------------------- links that name a part

test('a link that names a part opens its tab once; the person moving on isn\'t pulled back by a redraw', () => {
  fresh();
  const m = quiet(sampleTabsTicket(NOW));
  const asked: TicketModel = { ...m, open: { part: 'verify', at: 1 } };
  assert.equal(selected(drawn(asked)), 'verify');
  drawn(asked).tabs.find((t) => t.dataset.tab === 'changes')!.click();
  assert.equal(selected(drawn(asked)), 'changes', 'the same link, drawn again, is followed once');
  // Edge: the page loaded afresh with the same link still on the model doesn't follow it again.
  forgetDrawn();
  assert.equal(selected(drawn(asked)), 'changes');
  // A new link (a later stamp) goes there again, and a link wins over what needs the person.
  assert.equal(selected(drawn({ ...samplePlanNeedsYouTicket(NOW), key: m.key, open: { part: 'changes', at: 2 } })), 'plan', 'Changes isn\'t shown on that ticket: what needs you instead');
  assert.equal(selected(drawn({ ...m, open: { part: 'plan', at: 3 } })), 'plan');
});

test('a link to a comment opens Ticket, shows the whole feed, and scrolls to that comment', () => {
  fresh();
  const m = quiet(sampleTabsTicket(NOW));
  const last = m.comments.at(-1)!;
  // Seven more entries above it, so the comment would be folded under Show all.
  const many = [...Array.from({ length: 7 }, (_, i) => ({ ...last, id: `c-new-${i}`, created: new Date(NOW - i * 1000).toISOString() })), ...m.comments];
  drawn(m).tabs.find((t) => t.dataset.tab === 'plan')!.click();
  const grid = (renderTicket({ ...m, comments: many, open: { part: `comment:${last.id}`, at: 9 } }) as unknown as PageElement[]).find((n) => n.classList.contains('ticket-grid'))!;
  assert.equal(grid.all('task-tab').find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.tab, 'ticket');
  const card = grid.all('act-card').find((c) => c.dataset.comment === last.id);
  assert.ok(card, 'the comment is drawn, not folded away');
  assert.equal(card.tabIndex, -1, 'it can take focus');
  assert.equal(askedComment(), last.id);
  // Edge: afterTabs looks for it in the document; with none there, it lets the ask go.
  (globalThis as Record<string, unknown>).CSS ??= { escape: (s: string) => s };
  (page.document as unknown as { querySelector: (s: string) => null }).querySelector = () => null;
  afterTabs();
  assert.equal(askedComment(), null);
  // A link to a part no tab holds opens as if there were none.
  assert.equal(partTab('comment:c1'), 'ticket');
  assert.equal(partTab('plan'), 'plan');
  assert.equal(partTab('somewhere'), null);
  assert.equal(partTab(null), null);
});

test('renderTabs draws what it\'s given into each tab\'s panel', () => {
  fresh();
  const m = quiet(sampleTicket(NOW, 'ACME-31'));
  const tabs = taskTabs(m);
  const out = renderTabs(m, tabs, 'ticket', { ticket: [], plan: [], changes: [], verify: [] }) as unknown as PageElement;
  assert.deepEqual(out.all('task-panel').map((p) => p.dataset.tab), ['ticket']);
});

test('Needs you, a card and a notification name the plan: each opens the page on Plan', () => {
  // A card's Answer, See the split and See the plan carry the part.
  const hub = sampleHub(NOW);
  let checked = 0;
  for (const row of hub.taskRows(ROOT)) {
    for (const a of cardActions(row, { project: ROOT, task: row.id })) {
      if (a.command !== 'acc.task.show' || !['Answer', 'See the split', 'See the plan'].includes(a.label) || a.question) continue;
      assert.equal(a.ref.part, 'plan', `${row.id}: ${a.label}`);
      checked++;
    }
  }
  assert.ok(checked > 0, 'a card asks for the plan');
  // A plan's notice opens on Plan; another kind names no part.
  assert.deepEqual(noticePart({ kind: 'analysis-questions' }), { part: 'plan' });
  assert.deepEqual(noticePart({ kind: 'stopped' }), {});
  const said = noticeBurst([{ root: ROOT, notice: { kind: 'analysis-questions', task: 'ACME-21', text: 'x', urgent: true } as never }]);
  assert.equal(said[0]!.task?.part, 'plan');
  // The modal's open takes a part only in the form a link names one.
  const ok = modalArea.messages!['task-modal-open']!;
  assert.equal(ok({ project: ROOT, key: 'ACME-21', part: 'plan' }), true);
  assert.equal(ok({ project: ROOT, key: 'ACME-21', part: 'comment:10042' }), true);
  assert.equal(ok({ project: ROOT, key: 'ACME-21' }), true);
  assert.equal(ok({ project: ROOT, key: 'ACME-21', part: 'elsewhere' }), false);
  assert.equal(ok({ project: ROOT, key: 'ACME-21', part: 3 }), false);
  assert.ok(TASK_PART.test('verify') && !TASK_PART.test('comment:'));
});

test('edge case: a ticket with no description still has Ticket, its description drawn by renderDoc as "No description."', () => {
  fresh();
  const m = quiet(sampleTabsTicket(NOW));
  const d = drawn({ ...m, body: { ...m.body, blocks: [] } });
  const ticket = d.panels.find((p) => p.dataset.tab === 'ticket')!;
  assert.ok(ticket.textContent.includes('No description.'), ticket.textContent.slice(0, 80));
  assert.equal(d.tabs[0]!.dataset.tab, 'ticket');
});
