// A ticket type's icon takes its tracker's own colour for the type (T-95), on the ticket page's head, on a card
// and on a related row, as a label's dot does; without one it keeps the theme's. The type's word is never tinted.
// The page's drawing runs in page-dom.ts's small document, from the screenshot run's fixtures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type BoardInput, trackerBoard } from '../src/model/boards.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { sampleGithubBoards } from '../scripts/fixtures/boards.ts';
import { AZURE_TYPE_COLOURS, sampleAzureBoards, sampleTrackerTicket } from '../scripts/fixtures/tracker-tickets.ts';
import { GITHUB_TYPE_COLOUR } from '../../packages/core/src/trackers/github.ts';
import { ownColour } from '../webview/tints.ts';
import { pageDom, type PageElement } from './page-dom.ts';

async function page() {
  pageDom();
  return { ...await import('../webview/dom.ts'), ...await import('../webview/task-page.ts'), ...await import('../webview/tasks.ts') };
}

const colour = (e: PageElement): string => e.style.getPropertyValue('--type-colour');
/** An icon's tint: its colour and whether it takes it, or '' for the theme's. */
const tintOf = (e: PageElement): string => (e.classList.contains('type-tinted') ? colour(e) : '');

/** The type fact on a ticket page's head. */
async function typeFact(m: TicketModel): Promise<PageElement | undefined> {
  const { renderTicket } = await page();
  return (renderTicket(m) as unknown as PageElement[]).flatMap((n) => [n, ...n.all('ticket-fact')]).find((e) => e.classList.contains('ticket-fact') && e.title.startsWith('Type: '));
}

/** A board's card drawn from its fixture, by key. */
async function card(input: BoardInput, key: string): Promise<PageElement> {
  const { trackerCard } = await page();
  const b = trackerBoard(input, [], '/r');
  return trackerCard('/r', b, b.columns.flatMap((c) => c.cards).find((c) => c.key === key)!) as unknown as PageElement;
}

test('ownColour keeps six hex digits in either case, and nothing else (edge cases)', () => {
  assert.deepEqual(['d1242f', 'CC293D'].map(ownColour), ['d1242f', 'CC293D']);
  assert.deepEqual(['', 'red', 'fff', '#d1242f', 'd1242f00', 'zzzzzz', null, undefined].map(ownColour), [null, null, null, null, null, null, null, null]);
});

test('the ticket page\'s type icon takes the tracker\'s colour for the type, and the type\'s word stays in the page\'s text colour', async () => {
  const fact = (await typeFact(sampleTrackerTicket(Date.now(), 'github')))!;
  assert.equal(fact.textContent, 'Bug');
  const icons = fact.all('codicon');
  assert.equal(icons.length, 1);
  assert.equal(tintOf(icons[0]!), `#${GITHUB_TYPE_COLOUR.RED}`, 'GitHub\'s red Bug');
  assert.equal(fact.style.getPropertyValue('--type-colour'), '', 'the word\'s element takes no tint');
  const azure = (await typeFact(sampleTrackerTicket(Date.now(), 'azure')))!;
  assert.equal(tintOf(azure.all('codicon')[0]!), `#${AZURE_TYPE_COLOURS['Product Backlog Item']}`, 'Azure\'s Product Backlog Item');
});

test('edge case: a ticket whose tracker gives no type colour, or one that isn\'t six hex digits, keeps the theme\'s colour on its type icon', async () => {
  for (const typeColor of [null, 'red', '#cc293d']) {
    const fact = (await typeFact({ ...sampleTrackerTicket(Date.now(), 'azure'), typeColor }))!;
    const i = fact.all('codicon')[0]!;
    assert.deepEqual([i.classList.contains('type-tinted'), colour(i)], [false, ''], String(typeColor));
  }
  assert.equal(await typeFact(sampleTrackerTicket(Date.now(), 'monday')), undefined, 'monday.com has no type: no fact, no icon');
});

test('a card\'s type icon takes its type\'s colour on Azure DevOps and GitHub boards, and one with none keeps the theme\'s', async () => {
  const bug = await card(sampleAzureBoards()[0]!, 'AB-1213');
  assert.equal(tintOf(bug.all('tcard-type')[0]!.all('codicon')[0]!), `#${AZURE_TYPE_COLOURS.Bug}`);
  const pbi = await card(sampleAzureBoards()[0]!, 'AB-1211');
  assert.equal(tintOf(pbi.all('tcard-type')[0]!.all('codicon')[0]!), `#${AZURE_TYPE_COLOURS['Product Backlog Item']}`);
  const gh = await card(sampleGithubBoards()[0]!, 'GH-42');
  assert.equal(tintOf(gh.all('tcard-type')[0]!.all('codicon')[0]!), `#${GITHUB_TYPE_COLOUR.RED}`);
  // Edge case: an issue with no type has no colour: its icon is the theme's.
  const plain = await card(sampleGithubBoards()[0]!, 'GH-43');
  assert.equal(tintOf(plain.all('tcard-type')[0]!.all('codicon')[0]!), '');
});

test('the board model carries a card\'s type colour, and null where the tracker gives none or the card leaves it out (edge case)', () => {
  const input = sampleAzureBoards()[0]!;
  const cards = trackerBoard(input, [], '/r').columns.flatMap((c) => c.cards);
  assert.equal(cards.find((c) => c.key === 'AB-1209')!.typeColor, AZURE_TYPE_COLOURS['Test Case']);
  const bare = sampleAzureBoards()[0]!;
  delete (bare.board!.cards[0] as { typeColor?: string | null }).typeColor;
  assert.equal(trackerBoard(bare, [], '/r').columns.flatMap((c) => c.cards).find((c) => c.key === bare.board!.cards[0]!.key)!.typeColor, null);
});

test('a related row\'s type icon takes its type\'s colour, and a row with no kind draws no icon and keeps no colour (edge case)', async () => {
  const { renderTicket } = await page();
  const m = sampleTrackerTicket(Date.now(), 'azure');
  const rows = (renderTicket(m) as unknown as PageElement[]).flatMap((n) => n.all('related-row'));
  assert.deepEqual(rows.map((r) => tintOf(r.all('codicon')[0]!)), [`#${AZURE_TYPE_COLOURS.Feature}`, `#${AZURE_TYPE_COLOURS.Task}`, `#${AZURE_TYPE_COLOURS.Task}`]);
  const gh = (renderTicket(sampleTrackerTicket(Date.now(), 'github')) as unknown as PageElement[]).flatMap((n) => n.all('related-row'));
  assert.ok(gh.length > 0 && gh.every((r) => tintOf(r.all('codicon')[0]!) === ''), 'GitHub gives its related items no type colour: the theme\'s');
  assert.ok(m.related.every((r) => r.typeColor !== undefined));
});
