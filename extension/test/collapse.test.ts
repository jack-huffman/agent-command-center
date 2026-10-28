// A task page's order and its collapsible sections (T-132): the ticket's description first, what needs the
// person above it, the Command Center's sections under a quiet label, each folding to its header line and
// remembered per ticket, then the ticket's related tickets and activity. Drawn in page-dom.ts's small document;
// the keys and the narrow page in a browser are the behaviour run's and the screenshot run's.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { TicketModel } from '../src/model/task-page.ts';
import { pageDom, type PageElement } from './page-dom.ts';
import { sampleTicket } from '../scripts/fixtures/task-page.ts';
import { SECTIONS_COLLAPSED, sampleSectionsTicket } from '../scripts/fixtures/sections.ts';
import { sampleTeamTicket } from '../scripts/fixtures/team.ts';
import { sampleRecordsTicket } from '../scripts/fixtures/record-changes.ts';
import { sampleChangesTicket } from '../scripts/fixtures/changes.ts';
import { sampleFieldTicket } from '../scripts/fixtures/changes-field.ts';
import { sampleConversationTicket } from '../scripts/fixtures/conversation.ts';

// A tab that keeps its memory, as VS Code's does: the sections read what was collapsed on the next draw.
pageDom();
let saved: unknown;
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {}, getState: () => saved, setState: (s: unknown) => { saved = s; } });
const { renderTicket } = await import('../webview/task-page.ts');
const { collapsible, criteriaSummary, oneLine, sectionKey } = await import('../webview/collapse.ts');
const { el } = await import('../webview/dom.ts');

const NOW = Date.now();
/** The Command Center's sections, in the order the page draws them. */
const ORDER = ['plan', 'criteria', 'verify', 'changes', 'team', 'field', 'records', 'manifest', 'notes', 'note'];

const elements = (e: PageElement): PageElement[] => e.children.filter((c): c is PageElement => typeof c !== 'string');
function drawn(m: TicketModel): { top: PageElement | null; main: PageElement; all: PageElement[] } {
  const grid = (renderTicket(m) as unknown as PageElement[]).find((n) => n.classList.contains('ticket-grid'))!;
  return { top: elements(grid).find((e) => e.classList.contains('ticket-top')) ?? null, main: elements(grid).find((e) => e.classList.contains('ticket-main'))!, all: grid.all() };
}
/** The main column as names: desc, label, each section's id, related and activity. */
const names = (main: PageElement): string[] => elements(main).map((e) => (e.classList.contains('cc-divider') ? 'label' : e.dataset.section ?? (e.classList.contains('activity') ? 'activity' : e.classList.contains('related-block') ? 'related' : e.textContent.startsWith('Description') ? 'desc' : e.className)));
const toggleOf = (sec: PageElement): PageElement => sec.all('sec-toggle')[0]!;
const sectionOf = (main: PageElement, id: string): PageElement => elements(main).find((e) => e.dataset.section === id)!;

test('the description comes first, then the label, the plan, the criteria and Verify, then the activity', () => {
  saved = undefined;
  const { top, main } = drawn(sampleSectionsTicket(NOW));
  assert.deepEqual(names(main), ['desc', 'label', 'plan', 'criteria', 'verify', 'activity']);
  assert.equal(elements(main)[1]!.textContent, 'From the Command Center');
  // Edge: no notice needs the person on this ticket, so nothing sits above the description.
  assert.equal(top, null);
});

test('every fixture with Command Center sections draws them in the one order, under the description and the label', () => {
  saved = undefined;
  const models = [sampleSectionsTicket(NOW), sampleTeamTicket(NOW, 'shared'), sampleRecordsTicket(NOW, 'kept'), sampleChangesTicket(NOW, 'changes'), sampleFieldTicket(NOW), sampleTicket(NOW, 'ACME-19'), sampleTicket(NOW, 'ACME-20'), sampleTicket(NOW, 'ACME-23')];
  let checked = 0;
  for (const m of models) {
    const list = names(drawn(m).main);
    const ids = list.filter((n) => ORDER.includes(n));
    assert.ok(ids.length, `${m.key} has a section`);
    assert.deepEqual(list.slice(0, 2), ['desc', 'label'], m.key);
    assert.deepEqual(ids, [...ids].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)), m.key);
    // The ticket's related tickets and activity come after every one of them.
    const last = list.lastIndexOf(ids.at(-1)!);
    assert.ok(list.slice(last + 1).every((n) => n === 'related' || n === 'activity'), `${m.key}: ${list.join(', ')}`);
    checked += ids.length;
  }
  assert.ok(checked >= 10, `sections checked: ${checked}`);
});

test('a notice that needs the person stays on top, above the description; the plan is no longer there', () => {
  saved = undefined;
  // ACME-21, with a plan, stopped with why.
  const base = sampleSectionsTicket(NOW);
  const m: TicketModel = { ...base, acc: { ...base.acc!, blocker: 'Waiting on the client\'s answer about the renewal date.' } };
  assert.ok(m.acc?.blocker && m.analysis, 'the fixture has a notice and a plan');
  const { top, main } = drawn(m);
  assert.ok(top && top.all('notice').length >= 1, 'the notice is in the top band');
  assert.equal(top.all('cc-section').length + top.all('analysis').length, 0, 'no plan in the top band');
  assert.equal(names(main)[0], 'desc');
  assert.ok(names(main).includes('plan'));
});

test('the conversation\'s line before a plan sits in the Plan section under the description, collapsible too', () => {
  saved = undefined;
  // The line takes the plan's place only before there is a plan at all.
  const m: TicketModel = { ...sampleConversationTicket(NOW), analysis: null };
  assert.ok(!m.analysis && m.talk, 'the fixture has a conversation and no plan');
  const { top, main } = drawn(m);
  assert.equal(top?.all('analysis').length ?? 0, 0);
  const plan = sectionOf(main, 'plan');
  assert.equal(toggleOf(plan).textContent, 'Plan');
  assert.equal(names(main).indexOf('plan'), 2);
});

test('edge case: a ticket with no Command Center section draws no label', () => {
  saved = undefined;
  // ACME-31 isn't in the person's work yet: no plan, no criteria, no Verify.
  const { main } = drawn(sampleTicket(NOW, 'ACME-31'));
  assert.equal(main.all('cc-divider').length, 0);
  assert.equal(main.all('cc-section').length, 0);
  assert.equal(names(main)[0], 'desc');
});

test('each section\'s heading is a button with its name, a chevron and aria-expanded, and every one starts open', () => {
  saved = undefined;
  const { main } = drawn(sampleSectionsTicket(NOW));
  const want: Record<string, string> = { plan: 'Plan', criteria: 'Acceptance criteria draft', verify: 'Verify the developer\'s work' };
  for (const [id, name] of Object.entries(want)) {
    const sec = sectionOf(main, id);
    const b = toggleOf(sec);
    assert.equal(b.tagName, 'BUTTON');
    assert.equal(b.type, 'button');
    assert.equal(b.textContent, name);
    assert.equal(b.all('codicon-chevron-right').length, 1);
    assert.equal(b.getAttribute('aria-expanded'), 'true');
    assert.equal(sec.classList.contains('collapsed'), false);
  }
});

test('a click collapses a section and a second click expands it, each remembered for that ticket and section only', () => {
  saved = undefined;
  const first = drawn(sampleSectionsTicket(NOW)).main;
  toggleOf(sectionOf(first, 'criteria')).click();
  assert.equal(sectionOf(first, 'criteria').classList.contains('collapsed'), true);
  assert.equal(toggleOf(sectionOf(first, 'criteria')).getAttribute('aria-expanded'), 'false');
  assert.deepEqual((saved as { folded: string[] }).folded, [sectionKey('criteria', sampleSectionsTicket(NOW).project, 'ACME-21')]);
  // Drawn again, it stays collapsed; its neighbours stay open.
  const again = drawn(sampleSectionsTicket(NOW)).main;
  assert.equal(sectionOf(again, 'criteria').classList.contains('collapsed'), true);
  assert.equal(sectionOf(again, 'plan').classList.contains('collapsed'), false);
  // Edge: another ticket's criteria aren't collapsed by it.
  const other = drawn(sampleTicket(NOW, 'ACME-19', true, 'drafted')).main;
  assert.equal(sectionOf(other, 'criteria').classList.contains('collapsed'), false);
  toggleOf(sectionOf(again, 'criteria')).click();
  assert.equal(sectionOf(again, 'criteria').classList.contains('collapsed'), false);
  assert.deepEqual((saved as { folded: string[] }).folded, []);
  assert.equal(sectionOf(drawn(sampleSectionsTicket(NOW)).main, 'criteria').classList.contains('collapsed'), false);
});

test('Enter and Space on the button flip it and stop the button\'s own click; another key does nothing', () => {
  saved = undefined;
  const sec = sectionOf(drawn(sampleSectionsTicket(NOW)).main, 'verify');
  const key = (k: string): boolean => {
    let stopped = false;
    for (const f of toggleOf(sec).listeners.get('keydown') ?? []) f({ key: k, preventDefault: () => { stopped = true; } });
    return stopped;
  };
  assert.equal(key('Enter'), true);
  assert.equal(sec.classList.contains('collapsed'), true);
  assert.equal(key(' '), true);
  assert.equal(sec.classList.contains('collapsed'), false);
  assert.equal(key('Tab'), false);
  assert.equal(sec.classList.contains('collapsed'), false);
});

test('collapsed, a section keeps its header line: the name, its state chip, and a one-line summary', () => {
  saved = { folded: SECTIONS_COLLAPSED };
  const m = sampleSectionsTicket(NOW);
  const { main } = drawn(m);
  const line = (id: string): { chip: string; sum: string } => {
    const head = sectionOf(main, id).all('sec-head')[0]!;
    return { chip: head.all('status')[0]?.textContent ?? '', sum: head.all('sec-sum')[0]?.textContent ?? '' };
  };
  for (const id of ['plan', 'criteria', 'verify']) assert.equal(sectionOf(main, id).classList.contains('collapsed'), true, id);
  assert.deepEqual(line('criteria'), { chip: m.criteria!.look.label, sum: '3 criteria' });
  assert.deepEqual(line('verify'), { chip: m.verify!.look.label, sum: oneLine(m.verify!.summary) });
  assert.equal(line('plan').chip, m.analysis!.look.label);
  assert.ok(line('plan').sum.length > 0);
  // The summary's full words are in its title, as an ellipsis needs.
  const sum = sectionOf(main, 'verify').all('sec-sum')[0]!;
  assert.equal(sum.title, sum.textContent);
});

test('edge case: a section with nothing to sum up keeps its name and state, with no summary', () => {
  saved = undefined;
  const { main } = drawn(sampleTeamTicket(NOW, 'shared'));
  const team = sectionOf(main, 'team');
  assert.equal(toggleOf(team).textContent, 'Team');
  assert.equal(team.all('sec-sum').length, 0);
});

test('the summaries: a count of criteria, the first line of some words, and none for nothing', () => {
  assert.equal(criteriaSummary(3), '3 criteria');
  assert.equal(criteriaSummary(1), '1 criterion');
  assert.equal(criteriaSummary(0), null);
  assert.equal(criteriaSummary(null), null);
  assert.equal(oneLine('\n**Pass.** It `works`.\nMore'), 'Pass. It works.');
  assert.equal(oneLine('  \n '), null);
  assert.equal(oneLine(null), null);
  assert.equal(sectionKey('plan', '/p', 'A-1'), 'section:plan:/p#A-1');
});

test('edge case: a section with no heading is left as it is', () => {
  saved = undefined;
  const sec = el('section', 'block', el('p', '', 'words')) as unknown as PageElement;
  collapsible(sec as unknown as HTMLElement, 'x', { project: '/p', key: 'A-1' }, 'sum');
  assert.equal(sec.classList.contains('cc-section'), false);
  assert.equal(sec.all('sec-toggle').length, 0);
});

test('on a narrow page the notices come first, and the description and the Command Center\'s sections keep their place', () => {
  const css = readFileSync(join(import.meta.dirname, '../webview/task-page.css'), 'utf8');
  const narrow = css.slice(css.indexOf('@media (max-width: 760px)'));
  assert.match(narrow, /\.ticket-top \{ order: -1; \}/);
  assert.match(narrow, /\.side-details, \.side-panel \{ order: 1; \}/);
  assert.match(narrow, /\.related-block, \.activity \{ order: 2; \}/);
  // Nothing moves the description, the label or a section out of the main column's order.
  const ours = readFileSync(join(import.meta.dirname, '../webview/collapse.css'), 'utf8');
  assert.doesNotMatch(ours, /(^|[\s;{])order:/);
  assert.doesNotMatch(narrow, /cc-section|cc-divider/);
});
