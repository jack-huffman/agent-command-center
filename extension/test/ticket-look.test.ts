// Tickets look considered on every tracker (T-91): a label's tint is the tracker's colour or its name's, an
// avatar's comes from the person's id, and a ticket's page draws no placeholder for a field its tracker lacks.
// The page's drawing runs in page-dom.ts's small document, from the screenshot run's fixtures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chip } from '../src/model/boards.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { sampleTicket } from '../scripts/fixtures/task-page.ts';
import { sampleTrackerTicket } from '../scripts/fixtures/tracker-tickets.ts';
import { labelTint, TINTS, tintOf } from '../webview/tints.ts';
import { pageDom, type PageElement } from './page-dom.ts';

/** The page's drawing modules, imported once the small document is up, as state.ts reads it as it loads. */
async function page() {
  pageDom();
  return { ...await import('../webview/dom.ts'), ...await import('../webview/task-page.ts') };
}

const tint = (e: PageElement): string => e.style.getPropertyValue('--tint-colour');

test('a tracker\'s own label colour wins over the palette; otherwise the same name gets the same tint, whatever its case', () => {
  assert.deepEqual(labelTint({ name: 'bug', color: 'd73a4a' }), { colour: 'd73a4a' });
  assert.deepEqual(labelTint({ name: 'bug', color: 'D73A4A' }), { colour: 'D73A4A' }, 'either case of hex');
  assert.deepEqual(labelTint({ name: 'service', color: null }), labelTint({ name: 'service', color: null }));
  assert.deepEqual(labelTint({ name: 'Service', color: null }), labelTint({ name: 'service', color: null }), 'the same name in another case');
  assert.deepEqual(labelTint({ name: 'service', color: null }), { tint: tintOf('service') });
});

test('edge case: a tracker colour that isn\'t six hex digits, or an empty one, gives way to the name\'s tint', () => {
  for (const color of ['', 'red', 'fff', '#d73a4a', 'd73a4a00', 'zzzzzz']) {
    assert.deepEqual(labelTint({ name: 'sla', color }), { tint: tintOf('sla') }, `color ${JSON.stringify(color)}`);
  }
});

test('every tint is one the palette holds, a key keeps its tint, and names spread over the palette', () => {
  const names = ['bug', 'sla', 'service', 'sales', 'reporting', 'premium', 'audit', 'history', 'contacts', 'testing', 'enhancement', 'documentation', 'jordan-kim', 'pat-lee', 'Sam Rivera', '', '日本'];
  const tints = names.map(tintOf);
  for (const t of tints) assert.ok(Number.isInteger(t) && t >= 1 && t <= TINTS, `tint ${t}`);
  assert.deepEqual(names.map(tintOf), tints, 'the same keys give the same tints again');
  assert.equal(new Set(tints).size, TINTS, `${names.length} names use every one of the ${TINTS} tints`);
});

test('a label chip draws its tint: the tracker\'s colour, or its name\'s tint from the palette', async () => {
  const { labelChip } = await page();
  const own = labelChip({ name: 'bug', color: 'd73a4a' }) as unknown as PageElement;
  assert.equal(tint(own), '#d73a4a');
  assert.equal(own.textContent, 'bug', 'its name always shows');
  const named = labelChip({ name: 'sla', color: null }) as unknown as PageElement;
  assert.equal(tint(named), `var(--tint-${tintOf('sla')})`);
  assert.equal(tint(labelChip({ name: 'SLA', color: null }) as unknown as PageElement), tint(named), 'the same name, the same tint');
});

test('the same person id gets the same avatar tint on every page, whatever name the tracker shows them by', async () => {
  const { avatar, person } = await page();
  const a = avatar(chip({ id: 'b1f0c2d4-0001', name: 'Jordan Kim' })) as unknown as PageElement;
  const b = avatar(chip({ id: 'b1f0c2d4-0001', name: 'jordan.kim' })) as unknown as PageElement;
  assert.equal(tint(a), `var(--tint-${tintOf('b1f0c2d4-0001')})`);
  assert.equal(tint(b), tint(a), 'one id, one tint');
  // Edge case: a tracker that gives no id, as monday.com's board does, keys the tint by the name.
  assert.equal(tint(avatar(chip({ name: 'Pat Lee' })) as unknown as PageElement), `var(--tint-${tintOf('Pat Lee')})`);
  assert.equal(tint(avatar(chip({ id: '', name: 'Pat Lee' })) as unknown as PageElement), `var(--tint-${tintOf('Pat Lee')})`, 'an empty id is no id');
  // The name beside it carries the email in its title, where the tracker gives one, and initials drop the domain.
  const p = person(chip({ id: 'x', name: 'Jordan Kim', email: 'jordan.kim@acme.example' })) as unknown as PageElement;
  assert.equal(p.all('person-label')[0]!.title, 'jordan.kim@acme.example');
  assert.equal((person(chip({ id: 'y', name: 'Pat Lee' })) as unknown as PageElement).all('person-label')[0]!.title, '', 'no email, no title');
  assert.equal(chip({ name: 'jordan@acme.example' }).initials, 'J');
});

test('on a ticket\'s page one person keeps one tint, as assignee, reporter and comment author alike', async () => {
  const { renderTicket } = await page();
  const nodes = renderTicket(sampleTrackerTicket(Date.now(), 'azure')) as unknown as PageElement[];
  const avatars = nodes.flatMap((n) => n.all('avatar'));
  const byName = new Map<string, Set<string>>();
  for (const a of avatars) byName.set(a.title, (byName.get(a.title) ?? new Set()).add(tint(a)));
  assert.ok(avatars.length >= 4, `${avatars.length} avatars`);
  assert.deepEqual([...byName].filter(([, t]) => t.size !== 1).map(([n]) => n), [], 'no person with two tints');
  assert.ok((byName.get('Jordan Kim')?.size ?? 0) === 1 && (byName.get('Pat Lee')?.size ?? 0) === 1);
});

/** Words a page draws in place of a field its tracker lacks, or one with nothing in it. */
const PLACEHOLDER = /\b(?:None|Unassigned|Nobody|No labels|No priority|No type)\b|—|\bhas no\b/;

/** The placeholders in a ticket page's head and Details: the parts that show its tracker's fields. */
function placeholders(nodes: PageElement[]): string[] {
  const parts = nodes.flatMap((n) => [n, ...n.all()]).filter((e) => e.classList.contains('ticket-head') || e.classList.contains('side-details'));
  return parts.flatMap((p) => (PLACEHOLDER.test(p.textContent) ? [`${p.className}: ${p.textContent}`] : []));
}

/** Every tracker's ticket page with a field it lacks or leaves empty: Slack's thread, an untracked Jira ticket, GitHub, Azure DevOps and monday.com. */
const SAMPLES: [string, (now: number) => TicketModel][] = [
  ['Slack', (now) => sampleTicket(now, 'ACME-50')],
  ['Jira', (now) => sampleTicket(now, 'ACME-31')],
  ['GitHub', (now) => sampleTrackerTicket(now, 'github')],
  ['Azure DevOps', (now) => sampleTrackerTicket(now, 'azure')],
  ['monday.com', (now) => sampleTrackerTicket(now, 'monday')],
];

test('no tracker\'s ticket page draws a placeholder such as "None" for a field it lacks or leaves empty', async (t) => {
  const { renderTicket } = await page();
  let checked = 0;
  for (const [name, sample] of SAMPLES) {
    const nodes = renderTicket(sample(Date.now())) as unknown as PageElement[];
    assert.ok(nodes.some((n) => n.classList.contains('ticket-head')), `${name} drew its head`);
    assert.deepEqual(placeholders(nodes), [], `${name}'s page`);
    checked++;
  }
  t.diagnostic(`checked ${checked} trackers' pages`);
  assert.equal(checked, SAMPLES.length);
  assert.ok(checked >= 5);
});

test('edge case: a field a tracker lacks leaves its row and its fact out, not an empty place', async () => {
  const { renderTicket } = await page();
  const monday = renderTicket(sampleTrackerTicket(Date.now(), 'monday')) as unknown as PageElement[];
  const all = monday.flatMap((n) => [n, ...n.all()]);
  const rows = all.filter((e) => e.tagName === 'DT').map((e) => e.textContent);
  assert.deepEqual(rows, ['Assignees', 'Created', 'Updated'], 'no Reporter or Labels row: monday.com gives neither here');
  assert.deepEqual(all.filter((e) => e.classList.contains('ticket-fact')).length, 0, 'no type or priority');
  assert.equal(all.filter((e) => e.classList.contains('state-chip')).length, 1, 'its state still shows');
  // Slack has no status, people or labels at all: no state chip, and Details only for when.
  const slack = (renderTicket(sampleTicket(Date.now(), 'ACME-50')) as unknown as PageElement[]).flatMap((n) => [n, ...n.all()]);
  assert.equal(slack.filter((e) => e.classList.contains('state-chip')).length, 0);
  assert.deepEqual(slack.filter((e) => e.tagName === 'DT').map((e) => e.textContent), ['Reporter', 'Created', 'Updated']);
});

test('the placeholder check finds a "None", a dash or an "Unassigned" in a ticket\'s head or Details, and nothing elsewhere', async () => {
  const { el } = await page();
  const head = el('header', 'ticket-head', el('span', '', 'Status: —')) as unknown as PageElement;
  const details = el('section', 'side-details', el('dd', '', 'None')) as unknown as PageElement;
  const nobody = el('section', 'side-details', el('dd', '', 'Unassigned')) as unknown as PageElement;
  const note = el('section', 'block note', el('p', '', 'None')) as unknown as PageElement;
  assert.deepEqual(placeholders([head, details, nobody, note]), ['ticket-head: Status: —', 'side-details: None', 'side-details: Unassigned']);
  assert.deepEqual(placeholders([]), [], 'nothing drawn, nothing found');
});

test('a related row draws its kind, key, title and state chip, quiet when done, and its tracker key opens in place', async () => {
  const { renderTicket } = await page();
  const all = (renderTicket(sampleTrackerTicket(Date.now(), 'azure')) as unknown as PageElement[]).flatMap((n) => [n, ...n.all()]);
  const rows = all.filter((e) => e.classList.contains('related-row'));
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.all('state-chip')[0]?.textContent), ['Committed', 'Done', 'In Progress']);
  assert.deepEqual(rows.map((r) => r.all('state-chip')[0]!.classList.contains('quiet')), [false, true, false], 'done is quiet');
  assert.ok(rows.every((r) => r.all('openable').length === 1), 'each key opens its page in place');
  assert.deepEqual(all.filter((e) => e.classList.contains('related-group')).map((e) => e.textContent), ['Parent', 'Child']);
  // Edge case: a related item whose tracker says nothing of its kind or state keeps its row, with neither drawn.
  const bare = { ...sampleTrackerTicket(Date.now(), 'azure'), related: [{ key: 'AB-1', title: 'Bare', relation: 'related', url: null, typeIcon: null, status: null }] };
  const row = (renderTicket(bare) as unknown as PageElement[]).flatMap((n) => [n, ...n.all()]).find((e) => e.classList.contains('related-row'))!;
  assert.deepEqual([row.all('state-chip').length, row.all('codicon').length, row.textContent], [0, 0, 'AB-1Bare']);
});
