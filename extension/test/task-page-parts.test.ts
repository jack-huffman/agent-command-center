// The parts of a ticket's page that T-91's rework left untested (T-94): the composer's hint, the head's facts,
// an empty Assignee or Labels row, a comment's author and time, and the Agent panel's state chip. The page's
// drawing runs in page-dom.ts's small document, from the screenshot run's fixtures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TicketModel } from '../src/model/task-page.ts';
import { sampleTicket } from '../scripts/fixtures/task-page.ts';
import { sampleTrackerTicket } from '../scripts/fixtures/tracker-tickets.ts';
import { pageDom, type PageElement } from './page-dom.ts';

/** Every element a ticket's page draws for a model. */
async function drawn(m: TicketModel): Promise<PageElement[]> {
  pageDom();
  const { renderTicket } = await import('../webview/task-page.ts');
  return (renderTicket(m) as unknown as PageElement[]).flatMap((n) => [n, ...n.all()]);
}

const children = (e: PageElement): PageElement[] => e.children.filter((c): c is PageElement => typeof c !== 'string');

/** Details' rows, as [name, value's words, value's buttons]. */
function details(all: PageElement[]): [string, string, string[]][] {
  const list = all.find((e) => e.classList.contains('details-list'))!;
  const kids = children(list);
  const rows: [string, string, string[]][] = [];
  for (let i = 0; i < kids.length; i += 2) rows.push([kids[i]!.textContent, kids[i + 1]!.textContent, kids[i + 1]!.all().filter((e) => e.tagName === 'BUTTON').map((b) => b.textContent)]);
  return rows;
}

test('the composer\'s hint is two parts, who comments and how to post, with no dot between them', async () => {
  const all = await drawn({ ...sampleTrackerTicket(Date.now(), 'azure'), signedInAs: 'Jordan Kim' });
  const hint = all.find((e) => e.classList.contains('composer-hint'))!;
  const parts = children(hint);
  assert.equal(parts.length, 2);
  assert.equal(parts[0]!.textContent, 'Commenting as Jordan Kim');
  assert.match(parts[1]!.textContent, /^(⌘ Enter|Ctrl\+Enter) to post$/);
  assert.ok(!hint.textContent.includes('·'), `no stray dot: ${hint.textContent}`);
});

test('edge case: with no one signed in, the hint is only how to post', async () => {
  const all = await drawn({ ...sampleTrackerTicket(Date.now(), 'azure'), signedInAs: null });
  const hint = all.find((e) => e.classList.contains('composer-hint'))!;
  assert.equal(children(hint).length, 1);
  assert.ok(!hint.textContent.includes('Commenting as') && !hint.textContent.includes('·'), hint.textContent);
});

test('the head\'s type and priority are each titled with what they are, "Type: …" and "Priority: …"', async () => {
  const m = sampleTrackerTicket(Date.now(), 'azure');
  assert.ok(m.type && m.priority, 'the sample has both');
  const facts = (await drawn(m)).filter((e) => e.classList.contains('ticket-fact'));
  assert.deepEqual(facts.map((f) => [f.title, f.textContent]), [[`Type: ${m.type}`, m.type], [`Priority: ${m.priority}`, m.priority]]);
});

test('edge case: an empty Assignee or Labels row stays only where it holds Assign or Add', async () => {
  const base = sampleTrackerTicket(Date.now(), 'azure');
  const empty = { ...base, assignees: [], labels: [] };
  const can = await drawn({ ...empty, can: { ...base.can, assign: true, labels: true } });
  const rows = details(can);
  assert.deepEqual(rows.find(([n]) => n === 'Assignee'), ['Assignee', 'Assign', ['Assign']], 'an empty Assignee holds Assign');
  assert.deepEqual(rows.find(([n]) => n === 'Labels'), ['Labels', 'Add', ['Add']], 'an empty Labels holds Add');
  const cannot = details(await drawn({ ...empty, can: { ...base.can, assign: false, labels: false } }));
  assert.deepEqual(cannot.filter(([n]) => /^(Assignees?|Labels)$/.test(n)), [], 'with nothing to hold, the rows go');
  // With people and labels, the rows show them and their Change and Edit.
  const full = details(await drawn({ ...base, can: { ...base.can, assign: true, labels: true } }));
  assert.ok(full.some(([n, , b]) => /^Assignees?$/.test(n) && b.includes('Change')), 'Change beside the people');
  assert.ok(full.some(([n, , b]) => n === 'Labels' && b.includes('Edit')), 'Edit beside the labels');
});

test('a comment draws its author\'s avatar, their name with their email in its title, and when', async () => {
  const m = sampleTrackerTicket(Date.now(), 'azure');
  const c = m.comments.find((x) => x.author.email);
  assert.ok(c, 'the sample has a comment by someone with an email');
  const items = (await drawn(m)).filter((e) => e.classList.contains('act-item') && e.all('act-avatar').length);
  assert.equal(items.length, m.comments.length, 'each comment is a feed item with an avatar');
  const item = items.find((i) => i.all('act-name')[0]!.textContent === c.author.name)!;
  assert.equal(item.all('avatar')[0]!.textContent, c.author.initials, 'the avatar shows their initials');
  assert.equal(item.all('act-name')[0]!.title, c.author.email);
  assert.ok(item.all().some((e) => e.tagName === 'TIME' && e.textContent), 'a time');
  // Edge case: an author with no email has no title on their name.
  const bare = (await drawn({ ...m, comments: [{ ...c, author: { ...c.author, email: null } }] })).find((e) => e.classList.contains('act-name'))!;
  assert.equal(bare.title, '');
});

test('edge case: the sampled page where Claude Code isn\'t found says so, and offers no Dispatch again (T-94)', async () => {
  const { UNSEEN_WORDS, DISPATCH_AGAIN } = await import('../../packages/core/src/started.ts');
  const m = sampleTicket(Date.now(), 'ACME-48');
  const text = (await drawn(m)).filter((e) => e.classList.contains('side-agent'))[0]!.textContent;
  assert.ok(text.includes(UNSEEN_WORDS.missing.line), text);
  assert.ok(!m.acc!.actions.some((a) => a.label === DISPATCH_AGAIN && !a.disabled), 'no Dispatch again to click');
});

test('the Agent panel draws its State as the one state chip, with the state\'s icon and label (T-94)', async () => {
  const m = sampleTicket(Date.now(), 'ACME-12');
  assert.ok(m.acc, 'ACME-12 is kept by acc');
  const panel = (await drawn(m)).find((e) => e.classList.contains('side-agent'))!;
  const rows = children(children(panel).find((e) => e.tagName === 'DL')!);
  const state = rows[rows.findIndex((r) => r.textContent === 'State') + 1]!;
  const chip = state.all('state-chip')[0];
  assert.ok(chip, 'a state chip');
  assert.equal(chip.textContent, m.acc.look.label);
  assert.ok(chip.classList.contains(`tone-${m.acc.look.tone}`));
  assert.ok(chip.all('codicon').some((i) => i.classList.contains(`codicon-${m.acc!.look.icon.replace(/~spin$/, '')}`)), 'its icon');
  assert.equal(state.all('status').length, 0, 'no plain status');
});
