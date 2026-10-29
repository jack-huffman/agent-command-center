// An agent's note as a person reads it (T-146): in a person's words with its API names as code, its headline
// alone in a notice, and drawn as a headline and its bullets on the task page, its History, the Agent panel's
// glance and Needs you. Drawn in page-dom.ts's small document; at each width and theme, it's the screenshot run's.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskRow } from '../src/logic/shared.ts';
import type { LandingRow } from '../src/model/landing.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { noteInWords } from '../src/logic/relayed.ts';
import { taskNotices } from '../src/logic/notices.ts';
import { type SlackProject, taskEvent } from '../src/slack.ts';
import { BLOCKED_NOTE, BLOCKED_WALL } from '../scripts/fixtures/shared.ts';
import { sampleAgentPanelTicket } from '../scripts/fixtures/agent-panel.ts';
import { sampleHub } from '../scripts/fixtures/hub.ts';
import { sampleBoards } from '../scripts/fixtures/boards.ts';
import { sampleIdentity } from '../scripts/fixtures/environments.ts';
import { sampleSetup } from '../scripts/fixtures/setup.ts';
import { homeModel } from '../src/model/home.ts';
import { pageDom, type PageElement } from './page-dom.ts';

pageDom();
(globalThis as Record<string, unknown>).acquireVsCodeApi = () => ({ postMessage: () => {}, getState: () => undefined, setState: () => {} });
const { renderTicket } = await import('../webview/task-page.ts');
const { landingRow } = await import('../webview/landing.ts');
const { drawNote, ITEM_FOLD, noteHeadline, noteItems } = await import('../webview/note.ts');
const { rememberedFold } = await import('../webview/dom.ts');

const NOW = Date.parse('2026-10-29T12:00:00Z');
const ROOT = '/Users/me/code/acme-service';

/** The page's nodes, drawn, as one element to search. */
const page = (m: TicketModel): PageElement => {
  const box = document.createElement('div') as unknown as PageElement;
  box.append(...(renderTicket(m) as unknown as PageElement[]));
  return box;
};
const codes = (e: PageElement): string[] => e.all().filter((x) => x.tagName === 'CODE').map((x) => x.textContent);

test('noteInWords puts a note in a person\'s words with its API names as code, and none stays none', () => {
  assert.equal(noteInWords(null), null);
  assert.equal(noteInWords(undefined), null);
  assert.equal(noteInWords('  '), null, 'an empty note is none');
  const plain = noteInWords('acc gate run errors on validate: Region__c is missing.')!;
  assert.equal(plain.text, '"Run the checks" errors on validate: `Region__c` is missing.');
  assert.equal(plain.headline, plain.text, 'one sentence is its own headline');
  assert.equal(plain.shape, null, 'a note with no markers has no shape');
  const wall = noteInWords(BLOCKED_WALL)!;
  assert.equal(wall.headline, 'Plan v2 contradicts itself, so nothing can land without a person\'s choice.');
  assert.equal(wall.shape!.items.length, 3);
  assert.ok(wall.text.includes('`Deal_Territory__c`'), 'an old note\'s API names are code as it\'s read');
  assert.equal(noteInWords(BLOCKED_NOTE)!.shape!.items.length, 3);
});

test('a notice, in VS Code and in Slack, carries the headline alone; without a note it says the title, as before', () => {
  const row = (state: string, more: Partial<TaskRow> = {}): TaskRow => ({ id: 'ACME-18', title: 'Migrate the legacy territory triggers', state, display: state as TaskRow['display'], environment: 'dev', deps: [], source: { kind: 'jira', url: null }, ...more });
  const blocked = row('blocked', { blocker: noteInWords(BLOCKED_NOTE) });
  const [n] = taskNotices([row('running')], [blocked]);
  assert.equal(n!.text, 'ACME-18 is blocked: The plan and the ticket disagree, so nothing can land without your choice.');
  assert.ok(!n!.text.includes('\n') && !n!.text.includes('Territory__c'), 'no bullet reaches the notice');
  assert.equal(taskNotices([row('running')], [row('blocked')])[0]!.text, 'ACME-18 is blocked: Migrate the legacy territory triggers', 'no note: its title');
  const p: SlackProject = { name: 'Acme', ledgerPath: `${ROOT}/.git/acc/ledger.json`, rows: [blocked], tasks: [{ id: 'ACME-18', title: blocked.title, history: [{ at: '2026-10-29T11:00:00.000Z', actor: 'builder', by: 'builder:ACME-18', from: 'running', to: 'blocked', reason: BLOCKED_NOTE }], run: null, source: { kind: 'jira', key: 'ACME-18', url: null } }] as never };
  assert.equal(taskEvent(p, n!, NOW)!.what, 'It\'s blocked: The plan and the ticket disagree, so nothing can land without your choice.');
  assert.equal(taskEvent({ ...p, rows: [row('blocked')] }, n!, NOW)!.what, 'It\'s blocked.', 'no note: as before');
});

test('the task page\'s notice and its History draw a new note as a headline, a bullet per thing, options on their own lines, and code', () => {
  const m = sampleAgentPanelTicket(NOW, 'note');
  const p = page(m);
  const notice = p.all('why-note')[0]!;
  assert.ok(notice.textContent.startsWith('Why it\'s blocked: The plan and the ticket disagree'));
  assert.equal(notice.all('note-item').length, 3);
  assert.deepEqual(notice.all('note-option').map((o) => o.all('note-letter')[0]!.textContent), ['a)', 'b)', 'a)', 'b)']);
  assert.equal(notice.all('is-recommended').length, 1);
  assert.match(notice.all('is-recommended')[0]!.textContent, /Territory__c on Account\s*Recommended$/, 'its mark says Recommended, and "(recommended)" isn\'t said twice');
  assert.ok(codes(notice).includes('Territory_Record_Page') && codes(notice).includes('Deal_Territory__c'));
  // The move to blocked in History draws the same list.
  const moved = p.all('act-reason').find((r) => r.all('note-items').length);
  assert.ok(moved, 'History draws the move\'s note as a list');
  assert.equal(moved!.all('note-item').length, 3);
});

test('an old note recorded as a paragraph is drawn as a list where its shape allows, and one with no shape keeps its paragraph under the fold', () => {
  const wall = page(sampleAgentPanelTicket(NOW, 'wall')).all('why-note')[0]!;
  assert.equal(wall.all('note-item').length, 3, 'its (1) (2) (3) are bullets');
  assert.equal(wall.all('note-option').length, 6, 'its a) b) are options on their own lines');
  assert.equal(wall.all('is-recommended').length, 2, 'the one marked (recommended), and the one "I recommend b" names');
  assert.ok(codes(wall).includes('Territory_Record_Page.flexipage-meta.xml'), 'its API names are code, though recorded bare');
  const plain = page(sampleAgentPanelTicket(NOW, 'blocked'));
  assert.equal(plain.all('note-items').length, 0, 'no shape: no list');
  assert.equal(plain.all('why-note').length, 0);
  const why = plain.all('why-text')[0]!;
  assert.ok(why.textContent.startsWith('Why it\'s blocked: The checks error on validate'));
  assert.ok(why.classList.contains('clamped'), 'its paragraph is under the fold, as before');
});

test('the Agent panel\'s glance carries the headline alone; its bullets are the notice\'s, each fact once', () => {
  const side = page(sampleAgentPanelTicket(NOW, 'note')).all('side-agent')[0]!;
  const why = side.all('agent-why')[0]!;
  assert.equal(why.textContent, 'The plan and the ticket disagree, so nothing can land without your choice.');
  assert.equal(why.all('note-headline')[0]!.title, why.textContent, 'cut short, it\'s whole on hover');
  assert.equal(side.all('note-items').length, 0);
  assert.equal(page(sampleAgentPanelTicket(NOW, 'queued')).all('agent-why').length, 0, 'not blocked: no line');
});

test('Needs you carries a blocked task\'s note: the line stays one line, its note under it, folded under a count when calm', () => {
  const m = homeModel({ hub: sampleHub(NOW), section: 'overview', boards: () => sampleBoards(), identity: () => sampleIdentity(), setup: sampleSetup(), runs: [], now: NOW });
  const line = m.overview.landing.find((g) => g.key === 'needs-you')!.all.find((r) => r.id === 'ACME-18') as LandingRow;
  assert.equal(line.note!.headline, 'The plan and the ticket disagree, so nothing can land without your choice.');
  assert.ok(line.tip!.endsWith(line.note!.headline), 'hovered, the line says the headline');
  const full = landingRow(line) as unknown as PageElement;
  assert.deepEqual([full.tagName, full.className], ['LI', 'lp-item']);
  const [row, note] = full.children as PageElement[];
  assert.ok(row!.classList.contains('lp-row') && row!.dataset.overviewRow === '', 'the line is the measured row, one line');
  assert.equal(note!.all('note-item').length, 3, 'in full, its bullets');
  const calm = landingRow(line, true) as unknown as PageElement;
  const fold = calm.all('note-fold')[0]!;
  assert.equal(fold.all()[0]!.textContent, '3 points');
  assert.equal((fold as unknown as { open: boolean }).open, false, 'closed at first');
  assert.equal(fold.all('note-item').length, 3);
  const other = m.overview.landing.find((g) => g.key === 'needs-you')!.all.find((r) => !r.note)!;
  assert.equal((landingRow(other) as unknown as PageElement).className.split(' ')[0], 'lp-row', 'a line with no note is the line alone');
});

test('a long thing folds on its own, not the whole note; a short one doesn\'t', () => {
  const long = 'x '.repeat(ITEM_FOLD);
  const n = noteInWords(`Two things.\n- ${long}\n- short`)!;
  const drawn = drawNote(n, 'k') as unknown as PageElement;
  const items = drawn.all('note-item');
  assert.equal(items[0]!.all('foldable').length, 1, 'the long one folds');
  assert.equal(items[1]!.all('foldable').length, 0, 'the short one doesn\'t');
  assert.equal(drawn.all('note-head')[0]!.all('foldable').length, 0, 'the headline never folds');
});

test('noteItems has none for a note with no shape or no bullets; noteHeadline holds backticks out of its hover; rememberedFold starts closed', () => {
  assert.equal(noteItems(noteInWords('acc gate run errors on validate')!, 'k'), null, 'no shape');
  assert.equal((noteItems(noteInWords('Pick one. a) this b) that')!, 'k') as unknown as PageElement).all('note-item').length, 1, 'options and no numbered things: one bullet');
  assert.equal((noteHeadline(noteInWords('Set Region__c first.')!) as unknown as PageElement).title, 'Set Region__c first.');
  const fold = rememberedFold('note-fold', 'never-opened', ['2 points']) as unknown as PageElement & { open: boolean };
  assert.equal(fold.open, false, 'nothing remembered: closed');
});
