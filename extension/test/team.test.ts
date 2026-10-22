// A task's team on its page (T-103): while it's in flight, "Up to date with dev" or "2 merges behind dev",
// each with its icon and label, the merges it hasn't taken in, and the tasks it shares files with now.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Team } from '../../packages/core/src/team.ts';
import { ticketModel } from '../src/model/task-page.ts';
import { sharesLine, TEAM_LOOK, ticketTeam } from '../src/model/team.ts';
import { pageDom, type PageElement } from './page-dom.ts';

const mate = (id: string, shares: string[], state: Team['mates'][number]['state'] = 'running'): Team['mates'][number] =>
  ({ id, title: `Task ${id}`, state, environment: 'dev', planned: null, changed: [], shares });
const landed = (sha: string, task: string | null, subject = `Merge ${task}: x`): Team['landed'][number] =>
  ({ sha, subject, task, title: task ? `Task ${task}` : null, files: ['a.ts'], shares: [] });
const team = (more: Partial<Team> = {}): Team => ({ task: 'T-1', env: 'dev', own: [], mates: [], landed: [], ...more });

test('a task up to date with its branch, sharing files with no one: blue, with its label, and the others in flight counted', () => {
  const t = ticketTeam({ state: 'running' }, team({ mates: [mate('T-2', []), mate('T-3', [], 'review')] }))!;
  assert.deepEqual(t.behind, { ...TEAM_LOOK.current, label: 'Up to date with dev' });
  assert.equal(t.behind.tone, 'blue');
  assert.deepEqual(t.merges, []);
  assert.deepEqual(t.shares, []);
  assert.deepEqual(t.sharing, { label: 'Shares no files with the 2 other tasks in flight', look: null });
  assert.equal(sharesLine({ shares: [], others: 1 }), 'Shares no files with the other task in flight');
  assert.equal(sharesLine({ shares: [], others: 0 }), 'No other task is in flight', 'an empty team');
});

test('a task two merges behind, sharing files with two others: orange, each with its icon, files and state', () => {
  const t = ticketTeam({ state: 'rework' }, team({ mates: [mate('T-2', ['a.ts', 'b.ts']), mate('T-3', ['c.ts'], 'blocked'), mate('T-4', [])], landed: [landed('abcdef1234', 'T-6'), landed('0123456789', null, 'Tidy the README')] }))!;
  assert.deepEqual(t.behind, { label: '2 merges behind dev', icon: 'git-merge', tone: 'orange' });
  assert.deepEqual(t.merges, [{ name: 'T-6: Task T-6', sha: 'abcdef1' }, { name: 'Tidy the README', sha: '0123456' }], 'a change acc can\'t match to a task by its subject');
  assert.deepEqual(t.shares.map((s) => [s.id, s.state, s.files]), [['T-2', 'being built', ['a.ts', 'b.ts']], ['T-3', 'blocked', ['c.ts']]]);
  assert.deepEqual(t.sharing, { label: 'Shares files with T-2 and T-3', look: { ...TEAM_LOOK.shares, label: 'Shares files with T-2 and T-3' } });
  assert.equal(ticketTeam({ state: 'running' }, team({ landed: [landed('a', 'T-6')] }))!.behind.label, '1 merge behind dev');
});

test('no team section for a task not in flight, or one whose team git couldn\'t read', () => {
  assert.equal(ticketTeam({ state: 'todo' }, team()), null);
  assert.equal(ticketTeam({ state: 'done' }, team()), null);
  assert.equal(ticketTeam({ state: 'running' }, null), null);
  const model = ticketModel({ project: '/r', tracker: null, trackerTitle: null, key: 'T-1', ticket: null, loading: false, error: null, row: null, task: null, team: ticketTeam({ state: 'running' }, team()) } as never);
  assert.equal(model.team, null, 'a page with no task shows no team');
});

test('the page draws the team under the changes: its line with icon and label, the merges, and who shares which files', async () => {
  pageDom();
  const { renderTeam } = await import('../webview/team.ts');
  const shared = renderTeam(ticketTeam({ state: 'running' }, team({ mates: [mate('T-2', ['a.ts', 'b.ts']), mate('T-3', ['c.ts'])], landed: [landed('abcdef1234', 'T-6')] }))!) as unknown as PageElement;
  assert.equal(shared.getAttribute('aria-label'), 'Team');
  assert.match(shared.textContent, /^Team1 merge behind devabcdef1T-6: Task T-6Shares files with T-2 and T-3T-2being builtTask T-2a\.ts, b\.tsT-3being builtTask T-3c\.ts$/);
  const marks = shared.all('status');
  assert.deepEqual(marks.map((s) => [s.className, s.all('codicon')[0]?.className]), [['status tone-orange', 'codicon codicon-git-merge tone-orange'], ['status tone-orange', 'codicon codicon-files tone-orange']]);
  assert.deepEqual(shared.all('team-files').map((f) => f.dataset.work), ['files', 'files'], 'the files are work data');
  const alone = renderTeam(ticketTeam({ state: 'running' }, team())!) as unknown as PageElement;
  assert.match(alone.textContent, /^TeamUp to date with devNo other task is in flight\.$/);
  assert.equal(alone.all('status')[0]!.className, 'status tone-blue');
  const page = readFileSync(new URL('../webview/task-page.ts', import.meta.url), 'utf8');
  const at = page.indexOf('if (m.team) main.append(renderTeam(m.team));');
  assert.ok(at > page.indexOf('renderChanges(m, m.changes)'), 'under the changes');
});

test('the screenshot run draws ACME-12 sharing files with two others and behind dev, and up to date sharing none (T-103)', async () => {
  const { sampleModel } = await import('../scripts/screenshot.ts');
  const shared = (sampleModel('ticket-team') as ReturnType<typeof ticketModel>).team!;
  assert.deepEqual([shared.behind.label, shared.shares.map((s) => s.id), shared.merges.length], ['2 merges behind dev', ['ACME-14', 'ACME-19'], 2]);
  const alone = (sampleModel('ticket-team-alone') as ReturnType<typeof ticketModel>).team!;
  assert.deepEqual([alone.behind.label, alone.shares, alone.sharing.label], ['Up to date with dev', [], 'Shares no files with the other task in flight']);
});
