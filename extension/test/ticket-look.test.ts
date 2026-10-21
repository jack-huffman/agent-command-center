// Tickets look considered on every tracker (T-91): a label's tint is the tracker's colour or its name's, an
// avatar's comes from the person's id, and a ticket's page draws no placeholder for a field its tracker lacks.
// The page's drawing runs in page-dom.ts's small document, from the screenshot run's fixtures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type BoardInput, chip, trackerBoard } from '../src/model/boards.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import { sampleTicket } from '../scripts/fixtures/task-page.ts';
import { sampleAzureBoards, sampleTrackerTicket } from '../scripts/fixtures/tracker-tickets.ts';
import { labelTint, labelTints, TINTS, tintOf } from '../webview/tints.ts';
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
  const names = ['bug', 'sla', 'service', 'sales', 'reporting', 'premium', 'audit', 'history', 'contacts', 'testing', 'enhancement', 'documentation', 'docs', 'jordan-kim', 'pat-lee', 'Sam Rivera', '', '日本'];
  const tints = names.map(tintOf);
  for (const t of tints) assert.ok(Number.isInteger(t) && t >= 1 && t <= TINTS, `tint ${t}`);
  assert.deepEqual(names.map(tintOf), tints, 'the same keys give the same tints again');
  assert.equal(new Set(tints).size, TINTS, `${names.length} names use every one of the ${TINTS} tints`);
});

/** Labels with no colour of their own, by name. */
const named = (...names: string[]) => names.map((name) => ({ name, color: null }));

/** Each palette tint that two different names here hold, with the names. */
function shared(labels: { name: string; color: string | null }[]): string[] {
  const tints = labelTints(labels);
  const by = new Map<number, Set<string>>();
  labels.forEach((l, i) => { const t = tints[i]!; if ('tint' in t) by.set(t.tint, (by.get(t.tint) ?? new Set()).add(l.name.toLowerCase())); });
  return [...by].filter(([, n]) => n.size > 1).map(([t, n]) => `${t}: ${[...n].join(', ')}`);
}

const TEN = ['bug', 'sla', 'service', 'sales', 'reporting', 'premium', 'audit', 'history', 'contacts', 'docs'];

test('two different labels on one card or ticket never share a tint while one is free (T-94)', (t) => {
  // "frontend", "bug" and "data" all pick one tint by name: the first keeps it, the others take the next free.
  const clash = named('frontend', 'bug', 'data');
  assert.equal(new Set(clash.map((l) => tintOf(l.name))).size, 1, 'the three names pick one tint by name');
  assert.deepEqual(labelTints(clash)[0], { tint: tintOf('frontend') }, 'the first keeps its own');
  assert.deepEqual(shared(clash), []);
  let checked = 0;
  for (let n = 1; n <= TINTS; n++) {
    assert.deepEqual(shared(named(...TEN.slice(0, n))), [], `${n} labels`);
    checked++;
  }
  t.diagnostic(`checked ${checked} sets of labels`);
  assert.equal(checked, TINTS);
});

test('edge case: the same name twice keeps one tint, a tracker colour holds none, no labels give no tints, and past eight names a tint is shared', () => {
  assert.deepEqual(labelTints([]), []);
  assert.deepEqual(labelTints(named('bug', 'BUG')), [{ tint: tintOf('bug') }, { tint: tintOf('bug') }]);
  assert.deepEqual(labelTints([{ name: 'bug', color: 'd73a4a' }, { name: 'frontend', color: null }]), [{ colour: 'd73a4a' }, { tint: tintOf('frontend') }]);
  const nine = labelTints(named(...TEN.slice(0, 9)));
  assert.equal(new Set(nine.map((x) => ('tint' in x ? x.tint : 0))).size, TINTS, 'nine names use all eight tints');
  assert.deepEqual(nine[8], { tint: tintOf(TEN[8]!) }, 'the ninth keeps its own, which another holds');
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

/** A tracker card drawn from the Azure DevOps board's fixture, by key, after `change` alters its input. */
async function azureCard(key: string, change: (c: NonNullable<BoardInput['board']>['cards'][number]) => void = () => undefined): Promise<PageElement> {
  pageDom();
  const { trackerCard } = await import('../webview/tasks.ts');
  const input = sampleAzureBoards()[0]!;
  const found = input.board!.cards.find((c) => c.key === key)!;
  change(found);
  const b = trackerBoard(input, [], '/r');
  const c = b.columns.flatMap((col) => col.cards).find((x) => x.key === key)!;
  return trackerCard('/r', b, c) as unknown as PageElement;
}

/** A card's label chips that show, not the +N, and not one folded into it. */
const shownLabels = (card: PageElement): PageElement[] => card.all('label').filter((l) => !l.classList.contains('label-more') && !l.hidden);

test('a card with nothing to measure it shows three labels and a +N chip naming the rest, on the labels\' own row', async () => {
  const card = await azureCard('AB-1213');
  const foot = card.all('tcard-foot');
  assert.equal(foot.length, 1);
  assert.deepEqual(shownLabels(foot[0]!).map((l) => l.textContent), ['service', 'history', 'premium']);
  assert.deepEqual(shownLabels(foot[0]!).map((l) => l.title), ['service', 'history', 'premium'], 'each whole in its title');
  const more = card.all('label-more');
  assert.deepEqual(more.map((m) => [m.textContent, m.title]), [['+2', 'audit, reporting']]);
  assert.equal(foot[0]!.all('tcard-people').length, 0, 'no avatars on the labels\' row, so +2 has the room it needs');
  assert.equal(card.all('tcard-top')[0]!.all('tcard-people').length, 1, 'the person sits in the top row');
});

test('edge case: a card with exactly three labels shows no +N chip', async () => {
  const card = await azureCard('AB-1204');
  assert.equal(shownLabels(card).length, 3);
  assert.deepEqual(card.all('label-more').map((m) => [m.hidden, m.textContent, m.title]), [[true, '', '']]);
});

test('a card\'s and a ticket\'s label chips each take a different tint, where their names pick one (T-94)', async () => {
  const five = await azureCard('AB-1213', (c) => { c.labels = named('frontend', 'bug', 'data', 'api', 'backend'); });
  const tints = five.all('label').filter((l) => !l.classList.contains('label-more')).map(tint);
  assert.equal(new Set(tints).size, 5, `a card's five labels: ${tints.join(' ')}`);
  const { renderTicket } = await page();
  const ticket = (renderTicket({ ...sampleTrackerTicket(Date.now(), 'azure'), labels: named('frontend', 'bug', 'data') }) as unknown as PageElement[]).flatMap((n) => n.all('label')).map(tint);
  assert.equal(new Set(ticket).size, 3, `a ticket's three labels: ${ticket.join(' ')}`);
  // The Jira sample's service and sla, which shared a tint among five (T-91), differ on their card.
  const jira = (sampleTicket(Date.now(), 'ACME-31').labels).filter((l) => ['service', 'sla'].includes(l.name));
  assert.equal(new Set(labelTints(jira).map((x) => JSON.stringify(x))).size, jira.length);
});

test('edge case: a card shows at most three avatars, beside its priority in the top row', async () => {
  const four = await azureCard('AB-1206', (c) => { c.assignees = [...c.assignees, { id: 'acme-4', name: 'Lee Park' }]; });
  const people = four.all('tcard-people');
  assert.equal(people.length, 1);
  assert.deepEqual(people[0]!.all('avatar').map((a) => a.title), ['Jordan Kim', 'Pat Lee', 'Sam Rivera']);
  const top = four.all('tcard-top')[0]!;
  assert.deepEqual(top.children.filter((x): x is PageElement => typeof x !== 'string').map((x) => x.className), ['tcard-type', 'tcard-key', 'spacer', 'tcard-people', 'tcard-prio']);
});

test('edge case: a card with no labels and no people has no foot row and no people, and its title falls back to the title', async () => {
  const bare = await azureCard('AB-1211', (c) => { c.labels = []; c.assignees = []; c.fullTitle = undefined; });
  assert.equal(bare.all('tcard-foot').length, 0);
  assert.equal(bare.all('tcard-people').length, 0);
  const title = bare.all('tcard-title')[0]!;
  assert.equal(title.title, 'Let agents merge duplicate contacts from the account page');
  // People but no labels still leaves the foot row out: the people are in the top row.
  const someone = await azureCard('AB-1208');
  assert.deepEqual([someone.all('tcard-foot').length, someone.all('avatar').length], [0, 1]);
});
