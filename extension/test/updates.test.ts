// Updates acc drafted for tickets, in Needs you, and an edit made on a task's page.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TaskRow } from '../src/logic/shared.ts';
import type { Update } from '../../packages/core/src/updates.ts';
import type { BoardInput } from '../src/model/boards.ts';
import { homeModel } from '../src/model/home.ts';
import { needsYouCount } from '../src/model/overview.ts';
import { root, row, hub, asks } from './support.ts';

test('each update acc drafted waits in Needs you, orange with its icon, counted, to post, edit or discard; a question sent to the client says so (D-066)', () => {
  const draft = (id: string, extra: Partial<Update> = {}): Update => ({ v: 1, id, task: id.split('.')[0]!, tracker: 'jira', key: id.split('.')[0]!, url: null, event: 'pr-opened', text: 'The change is ready for review: https://github.com/o/r/pull/3\nLeads now keep their region.', state: 'draft', pr: { number: 3, url: 'https://github.com/o/r/pull/3' }, createdAt: '2026-10-05T12:00:00.000Z', by: 'acc land', ...extra });
  const updates = [draft('AV-1.1'), draft('AV-5.1', { event: 'question', question: 'q1', text: 'Before we start, a question for you:\nWhich?' }), draft('AV-3.1', { state: 'discarded' }), draft('AV-4.1', { state: 'posted' })];
  const rows: TaskRow[] = [row('AV-1', 'review', 'review'), { ...row('AV-5', 'todo', 'needs-you'), analysisRequired: true, analysis: asks }];
  const boards = (): BoardInput[] => [{ index: 0, kind: 'jira', title: 'Jira · AV', board: null, error: null, connect: null, loading: false, signedInAs: 'me@acme.example' }];
  // The project's Jira trackers, by project key: which one owns a ticket's key is who its update posts as.
  const withJira = (...projects: string[]) => {
    const base = hub();
    return { ...base, projects: [{ ...base.projects[0]!, config: { ...base.projects[0]!.config, trackers: projects.map((project) => ({ kind: 'jira' as const, project, prefix: null })) } }] };
  };
  const m = homeModel({ hub: { ...withJira('AV'), agents: [], taskRows: () => rows, updates: () => updates }, section: 'overview', boards, identity: () => null, setup: { items: [], confirmed: new Set() } });
  const items = m.overview.attention.filter((a) => a.update);
  assert.deepEqual(items.map((a) => [a.title, a.look.label, a.look.icon, a.look.tone, a.detail]), [
    ['Update ready for AV-1', 'Draft update', 'comment-draft', 'orange', 'Acme · Pull request #3 is ready for review'],
    ['Update ready for AV-5', 'Draft update', 'comment-draft', 'orange', 'Acme · A question from its analysis'],
  ], 'only drafts: not the discarded or the posted');
  assert.deepEqual([items[0]!.update!.text, items[0]!.update!.postAs], [updates[0]!.text, 'me@acme.example'], 'its text, and who Post sends it as');
  assert.deepEqual(items[0]!.actions.map((a) => [a.label, a.command, a.ref.task]), [['Edit', 'acc.task.show', 'AV-1']], 'Edit opens its task\'s page; Post and Discard are the page\'s own');
  assert.equal(needsYouCount(m.overview), 3, 'two updates and AV-5\'s questions, each counted');
  assert.deepEqual([m.nav[0]!.count, m.nav[0]!.attention], [3, true], 'and the rail and badge with them');
  const asked = m.overview.attention.find((a) => a.analysis)!.analysis!;
  assert.deepEqual(asked.questions.map((q) => [q.id, q.client]), [['q1', 'drafted'], ['q2', undefined]], 'q1 is drafted for the client; q2 can still be sent');

  // Not signed in: Post waits for the sign-in, which the row offers.
  const out = homeModel({ hub: { ...withJira('AV'), agents: [], taskRows: () => rows, updates: () => updates }, section: 'overview', boards: () => [{ ...boards()[0]!, signedInAs: null }], identity: () => null, setup: { items: [], confirmed: new Set() } });
  const first = out.overview.attention.find((a) => a.update)!;
  assert.deepEqual([first.update!.blocked, first.extra?.label], ['Sign in to Jira first.', 'Sign in to Jira']);

  // Two Jira sites: each ticket's update posts as the sign-in of the site that owns its key, not the first.
  const sites = (): BoardInput[] => [{ ...boards()[0]!, title: 'Jira · OPS', signedInAs: 'ops@other.example' }, { ...boards()[0]!, index: 1, signedInAs: 'me@acme.example' }];
  const both = homeModel({ hub: { ...withJira('OPS', 'AV'), agents: [], taskRows: () => rows, updates: () => updates }, section: 'overview', boards: sites, identity: () => null, setup: { items: [], confirmed: new Set() } });
  assert.deepEqual(both.overview.attention.filter((a) => a.update).map((a) => a.update!.postAs), ['me@acme.example', 'me@acme.example'], 'AV-1 and AV-5 post through the AV site');
});

test('an update edited on its task\'s page shows that edit in Needs you, with Edit first and no Post of acc\'s text (GH-46)', () => {
  const draft = (id: string, extra: Partial<Update> = {}): Update => ({ v: 1, id, task: id.split('.')[0]!, tracker: 'github', key: '#9', url: null, event: 'merged', env: 'Dev', text: 'The change was approved and merged into Dev.', state: 'draft', createdAt: '2026-10-05T12:00:00.000Z', by: 'acc sync', ...extra });
  // AV-1's draft replaced two others; AV-2's is acc's own; AV-3's is being posted.
  const updates = [draft('AV-1.3', { replaces: ['AV-1.2', 'AV-1.1'] }), draft('AV-2.1'), draft('AV-3.1', { state: 'posting', posting: { at: new Date().toISOString(), by: 'human:me' } })];
  const held: Record<string, string> = { 'AV-1.1': 'Merged into Dev. Have a look in the sandbox.', 'AV-2.1': '  The change was approved and merged into Dev.  ', 'AV-3.1': 'Posting this one.' };
  const asked: [string, string, string[]][] = [];
  const edited = (root: string, id: string, replaces: string[]) => {
    asked.push([root, id, replaces]);
    for (const x of [id, ...replaces]) if (held[x] !== undefined) return held[x]!;
    return null;
  };
  const input = { hub: { ...hub(), agents: [], taskRows: () => [], updates: () => updates }, section: 'overview' as const, boards: () => [], identity: () => null, setup: { items: [], confirmed: new Set<string>() } };
  const rows = homeModel({ ...input, edited }).overview.attention.filter((a) => a.update);
  assert.deepEqual(rows.map((a) => [a.update!.id, a.look.label, a.look.icon, a.look.tone, a.update!.edited, a.actions.map((x) => [x.label, !!x.primary])]), [
    ['AV-1.3', 'Edited on the task page', 'edit', 'orange', 'Merged into Dev. Have a look in the sandbox.', [['Edit', true]]],
    ['AV-2.1', 'Draft update', 'comment-draft', 'orange', null, [['Edit', false]]],
    ['AV-3.1', 'Posting', 'sync~spin', 'blue', null, [['Edit', false]]],
  ], 'the edit typed for a draft AV-1.3 replaced is its edit; text typed back to acc\'s isn\'t one; one being posted is past editing');
  assert.equal(rows[0]!.update!.text, updates[0]!.text, 'acc\'s own text stays on the card');
  assert.deepEqual(rows[0]!.update!.replaces, ['AV-1.2', 'AV-1.1']);
  assert.deepEqual(asked.map(([, id, replaces]) => [id, replaces]), [['AV-1.3', ['AV-1.2', 'AV-1.1']], ['AV-2.1', []]], 'it asks for drafts only, through the drafts each replaced');
  assert.equal(needsYouCount(homeModel({ ...input, edited }).overview), needsYouCount(homeModel(input).overview), 'an edited update needs you just the same');

  // A claim to post that may have gone out still warns so, though its page holds an edit.
  const stale = draft('AV-3.1', { state: 'posting', posting: { at: '2026-10-05T12:00:00.000Z', by: 'human:me' } });
  const warned = homeModel({ ...input, hub: { ...input.hub, updates: () => [stale] }, edited }).overview.attention.find((a) => a.update)!;
  assert.deepEqual([warned.look.label, warned.look.icon, warned.update!.edited, warned.actions[0]!.primary], ['May have posted', 'warning', 'Posting this one.', true]);

  // Without the task page, or once its edit is gone, the row is as acc drafted it.
  const plain = homeModel(input).overview.attention.filter((a) => a.update);
  assert.deepEqual(plain.map((a) => [a.look.label, a.update!.edited, a.actions[0]!.primary]), [['Draft update', null, undefined], ['Draft update', null, undefined], ['Posting', null, undefined]]);
});
