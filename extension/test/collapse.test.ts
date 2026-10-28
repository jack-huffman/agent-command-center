// A task page's collapsible sections (T-132), in its tabs (T-134): what needs the person above the tabs, the
// ticket's description, related tickets and activity in Ticket, and the Command Center's sections each in its
// tab, each folding to its header line and remembered per ticket. Drawn in page-dom.ts's small document; the
// keys and the narrow page in a browser are the behaviour run's and the screenshot run's.
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
/** The Command Center's sections, by the tab that holds them, in the order each tab draws them. */
const IN_TAB: Record<string, string[]> = { plan: ['plan', 'criteria', 'notes', 'note'], changes: ['changes', 'field', 'records', 'manifest', 'team'], verify: ['verify'] };

const elements = (e: PageElement): PageElement[] => e.children.filter((c): c is PageElement => typeof c !== 'string');
function drawn(m: TicketModel): { top: PageElement | null; main: PageElement; side: PageElement; all: PageElement[] } {
  const grid = (renderTicket(m) as unknown as PageElement[]).find((n) => n.classList.contains('ticket-grid'))!;
  const part = (cls: string): PageElement | undefined => elements(grid).find((e) => e.classList.contains(cls));
  return { top: part('ticket-top') ?? null, main: part('ticket-main')!, side: part('ticket-side')!, all: grid.all() };
}
/** A tab's panel, drawn whether or not it's on show. */
const panelOf = (main: PageElement, tab: string): PageElement | undefined => main.all('task-panel').find((p) => p.dataset.tab === tab);
/** A panel's parts as names: desc, each section's id, related and activity. */
const names = (panel: PageElement): string[] => elements(panel).map((e) => e.dataset.section ?? (e.classList.contains('activity') ? 'activity' : e.classList.contains('related-block') ? 'related' : e.textContent.startsWith('Description') ? 'desc' : e.className));
const toggleOf = (sec: PageElement): PageElement => sec.all('sec-toggle')[0]!;
const sectionOf = (main: PageElement, id: string): PageElement => main.all('cc-section').find((e) => e.dataset.section === id)!;

test('Ticket holds the description, then the activity; Plan the plan and the criteria; Verify its own section; no label between them', () => {
  saved = undefined;
  const { top, main } = drawn(sampleSectionsTicket(NOW));
  assert.deepEqual(names(panelOf(main, 'ticket')!), ['desc', 'activity']);
  assert.deepEqual(names(panelOf(main, 'plan')!), ['plan', 'criteria']);
  assert.deepEqual(names(panelOf(main, 'verify')!), ['verify']);
  // The "From the Command Center" label is gone: the tabs say which is which.
  assert.ok(!main.textContent.includes('From the Command Center'));
  // Edge: no notice needs the person on this ticket, so nothing sits above the tabs.
  assert.equal(top, null);
});

test('every fixture with Command Center sections draws each in its own tab, in that tab\'s order', () => {
  saved = undefined;
  const models = [sampleSectionsTicket(NOW), sampleTeamTicket(NOW, 'shared'), sampleRecordsTicket(NOW, 'kept'), sampleChangesTicket(NOW, 'changes'), sampleFieldTicket(NOW), sampleTicket(NOW, 'ACME-19'), sampleTicket(NOW, 'ACME-20'), sampleTicket(NOW, 'ACME-23')];
  let checked = 0;
  for (const m of models) {
    const { main } = drawn(m);
    assert.equal(names(panelOf(main, 'ticket')!)[0], 'desc', m.key);
    for (const [tab, order] of Object.entries(IN_TAB)) {
      const p = panelOf(main, tab);
      if (!p) continue;
      const ids = names(p);
      assert.ok(ids.length, `${m.key}'s ${tab} tab isn't empty`);
      assert.ok(ids.every((i) => order.includes(i)), `${m.key} ${tab}: ${ids.join(', ')}`);
      assert.deepEqual(ids, [...ids].sort((a, b) => order.indexOf(a) - order.indexOf(b)), m.key);
      checked += ids.length;
    }
    // Ticket's related tickets and activity come after its description, in Ticket alone.
    assert.ok(names(panelOf(main, 'ticket')!).slice(1).every((n) => n === 'related' || n === 'activity'), m.key);
  }
  assert.ok(checked >= 10, `sections checked: ${checked}`);
});

test('a notice that needs the person stays on top, above the tabs; no section is there', () => {
  saved = undefined;
  // ACME-21, with a plan, stopped with why.
  const base = sampleSectionsTicket(NOW);
  const m: TicketModel = { ...base, acc: { ...base.acc!, blocker: 'Waiting on the client\'s answer about the renewal date.' } };
  assert.ok(m.acc?.blocker && m.analysis, 'the fixture has a notice and a plan');
  const { top, main } = drawn(m);
  assert.ok(top && top.all('notice').length >= 1, 'the notice is in the top band');
  assert.equal(top.all('cc-section').length + top.all('analysis').length + top.all('task-tabs').length, 0, 'no plan and no tabs in the top band');
  assert.ok(names(panelOf(main, 'plan')!).includes('plan'));
});

test('the conversation\'s line before a plan sits in the Plan tab\'s Plan section, collapsible too', () => {
  saved = undefined;
  // The line takes the plan's place only before there is a plan at all.
  const m: TicketModel = { ...sampleConversationTicket(NOW), analysis: null };
  assert.ok(!m.analysis && m.talk, 'the fixture has a conversation and no plan');
  const { top, main } = drawn(m);
  assert.equal(top?.all('analysis').length ?? 0, 0);
  const plan = sectionOf(main, 'plan');
  assert.equal(toggleOf(plan).textContent, 'Plan');
  assert.equal(names(panelOf(main, 'plan')!)[0], 'plan');
});

test('edge case: a ticket with no Command Center section has only its Ticket tab', () => {
  saved = undefined;
  // ACME-31 isn't in the person's work yet: no plan, no criteria, no Verify.
  const { main } = drawn(sampleTicket(NOW, 'ACME-31'));
  assert.equal(main.all('cc-section').length, 0);
  assert.deepEqual(main.all('task-panel').map((p) => p.dataset.tab), ['ticket']);
  assert.equal(names(panelOf(main, 'ticket')!)[0], 'desc');
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

test('on a narrow page the notices come first, and the sections keep their place in their tab', () => {
  const css = readFileSync(join(import.meta.dirname, '../webview/task-page.css'), 'utf8');
  const narrow = css.slice(css.indexOf('@media (max-width: 760px)'), css.indexOf('.ticket-main h2'));
  assert.match(narrow, /\.ticket-top \{ order: -1; \}/);
  assert.match(narrow, /\.side-details, \.side-panel \{ order: 1; \}/);
  // Edge: related tickets and activity stay in Ticket's panel; nothing moves them out of it any more (T-134).
  assert.doesNotMatch(narrow, /\.related-block|\.activity/);
  // Nothing moves a section out of its tab's order.
  const ours = readFileSync(join(import.meta.dirname, '../webview/collapse.css'), 'utf8');
  assert.doesNotMatch(ours, /(^|[\s;{])order:/);
  assert.doesNotMatch(narrow, /cc-section|cc-divider/);
});

test('the side column\'s Details and Agent panels collapse and expand like the sections, remembered per ticket, starting open', () => {
  saved = undefined;
  const { side } = drawn(sampleSectionsTicket(NOW));
  const details = sectionOf(side, 'details');
  const agent = sectionOf(side, 'agent');
  assert.ok(details.classList.contains('side-details') && agent.classList.contains('side-agent'));
  assert.equal(toggleOf(details).textContent, 'Details');
  // The Agent heading keeps its robot icon, inside the button after the chevron.
  assert.equal(toggleOf(agent).textContent, 'Agent');
  assert.equal(toggleOf(agent).all('codicon-hubot').length, 1);
  for (const p of [details, agent]) assert.equal(toggleOf(p).getAttribute('aria-expanded'), 'true');
  toggleOf(details).click();
  assert.equal(details.classList.contains('collapsed'), true);
  const again = drawn(sampleSectionsTicket(NOW)).side;
  assert.equal(sectionOf(again, 'details').classList.contains('collapsed'), true);
  assert.equal(sectionOf(again, 'agent').classList.contains('collapsed'), false);
  // Edge: another ticket's Details stay open.
  assert.equal(sectionOf(drawn(sampleTicket(NOW, 'ACME-19')).side, 'details').classList.contains('collapsed'), false);
});

test('collapsed, the Agent panel keeps its state as its summary; a ticket not in the work says so', () => {
  saved = { folded: SECTIONS_COLLAPSED };
  const m = sampleSectionsTicket(NOW);
  const agent = sectionOf(drawn(m).side, 'agent');
  assert.equal(agent.classList.contains('collapsed'), true);
  assert.equal(agent.all('sec-sum')[0]?.textContent, m.acc!.look.label);
  // Edge: ACME-31 isn't in the person's work, so its Agent panel holds Add to my work, and sums itself up so.
  saved = { folded: [sectionKey('agent', sampleTicket(NOW, 'ACME-31').project, 'ACME-31')] };
  const track = sectionOf(drawn(sampleTicket(NOW, 'ACME-31')).side, 'agent');
  assert.equal(track.classList.contains('collapsed'), true);
  assert.equal(track.all('sec-sum')[0]?.textContent, 'Not in your work yet');
});
