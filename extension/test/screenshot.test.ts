import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { tempDir } from '../../packages/core/test/support.ts';
import { HOME_SECTIONS } from '../src/model/shared.ts';
import type { HomeModel } from '../src/model/home.ts';
import type { TicketModel } from '../src/model/task-page.ts';
import type { DispatchSheet } from '../src/model/dispatch-sheet.ts';
import type { TaskSheet } from '../src/model/task-sheet.ts';
import { afterModel, APP_WARNING, COLOUR_PAGES, COLOUR_PROPERTIES, colourDiffs, type Colours, dumpedColours, findChrome, FONTS, NO_BROWSER, noBrowser, OUTPUT_REVIEWS, OUTPUT_RUNS, OUTPUT_STEPS, OVERVIEW_LISTS, pageFor, PAGES, sampleModel, shotState, startState } from '../scripts/screenshot.ts';
import { ROOT } from '../scripts/fixtures/shared.ts';
import { PIN } from '../scripts/browser.ts';
import { cssRules, pageStyles, palettes, readsVars, styleFile, styleFiles, vscodeDefaults } from '../scripts/styles.ts';

test('every section of the page, and a ticket, has sample data built by the real model functions', () => {
  for (const kind of PAGES) {
    const m = sampleModel(kind);
    if (kind.startsWith('ticket') || kind === 'agent') assert.equal(m.kind, kind.startsWith('ticket') ? 'ticket' : kind);
    // The Connect page opens over the section it came from (GH-51): a project started from an epic, over Setup (GH-81).
    else if (kind.startsWith('connect-')) assert.deepEqual([m.kind, (m as HomeModel).section, !!(m as HomeModel).connect, (m as HomeModel).connect?.back.label], ['home', kind.startsWith('connect-epic') ? 'setup' : 'tasks', true, kind.startsWith('connect-epic') ? 'Back to Setup' : 'Back to Tasks']);
    // The Slack card at each of its states, in Settings (GH-58, GH-113).
    else if (kind.startsWith('slack-')) assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).settings.slack?.state], ['home', 'settings', kind.slice('slack-'.length)]);
    // Settings at GitHub accounts and at the Command Center's own preferences (GH-113).
    else if (kind === 'settings-github') assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).settings.github.projects.map((p) => p.look.tone)], ['home', 'settings', ['blue', 'orange']]);
    else if (kind === 'settings-page') assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).settings.page.preferences.map((p) => p.choices.find((c) => c.on)?.key)], ['home', 'settings', ['tasks', 'path', 'relaxed']]);
    // The Tasks tab with a monday.com board (GH-70).
    else if (kind === 'tasks-monday') assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).tasks.projects[0]!.boards[0]!.kind], ['home', 'tasks', 'monday']);
    // The Tasks tab with an Azure DevOps board (T-91): every tracker's board is drawn.
    // An Azure DevOps board on its way (2026-10-21): with nothing kept, its skeleton; from the repo's cache, refreshing.
    else if (kind === 'tasks-azure-loading' || kind === 'tasks-azure-refreshing') {
      const b = (m as HomeModel).tasks.projects[0]!.boards[0]!;
      assert.deepEqual([(m as HomeModel).section, b.kind, b.loading, b.columns.length > 0], ['tasks', 'azure', true, kind === 'tasks-azure-refreshing']);
    } else if (kind === 'tasks-azure') assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).tasks.projects[0]!.boards[0]!.kind], ['home', 'tasks', 'azure']);
    // A repo's issues with no Project: GitHub board on the switch, the repo once, and no place line (the Tasks header's cleanup).
    // The Tasks board with a task opened over it in the modal (GH-158): the board's model, then the task's page's.
    else if (kind === 'tasks-modal') {
      const [after] = afterModel(kind);
      assert.deepEqual([m.kind, (m as HomeModel).section, after?.type, (after?.model as TicketModel).kind, (after?.tab as { type: string }).type], ['home', 'tasks', 'task-modal', 'ticket', 'ticket']);
    } else if (kind === 'palette' || kind === 'palette-empty') {
      // The command palette over the Tasks board (T-52): opened as acc.palette opens it, with "acme" typed or with
      // nothing typed and what was run last remembered.
      const [after] = afterModel(kind);
      const ran = (startState(kind) as { palette?: string[] } | undefined)?.palette ?? [];
      const ids = new Set((m as HomeModel).palette.map((i) => i.id));
      assert.deepEqual([m.kind, (m as HomeModel).section, after], ['home', 'tasks', kind === 'palette' ? { type: 'palette', query: 'an' } : { type: 'palette' }]);
      assert.ok(kind === 'palette' || (ran.length === 4 && ran.every((id) => ids.has(id))), `each item it remembers as run is on the page: ${ran.join(', ')}`);
    } else if (kind === 'tasks-moving') {
      // A card held up by Space on the Jira board (T-54): the page starts holding ACME-16, a card in its first column, with the next column chosen.
      const cols = (m as HomeModel).tasks.projects[0]!.boards[0]!.columns;
      assert.deepEqual([m.kind, (m as HomeModel).section, startState(kind)], ['home', 'tasks', { holding: { card: cols[0]!.cards[0]!.key, at: cols[1]!.id } }]);
    } else if (kind.startsWith('tasks-person')) {
      // The person filter (T-79): its menu open on the Jira board, the Jira board filtered to one person, and the agent board filtered to Mine.
      const tasks = (m as HomeModel).tasks.projects[0]!;
      const state = startState(kind) as { openFilter?: string; filters?: Record<string, string>; modes?: Record<string, string> };
      const board = `tracker:${ROOT}#0`;
      assert.deepEqual([m.kind, (m as HomeModel).section, tasks.boards[0]!.me, tasks.me], ['home', 'tasks', 'jordan', 'human:jordan']);
      if (kind === 'tasks-person-menu') assert.equal(state.openFilter, board);
      else if (kind === 'tasks-person') assert.deepEqual(state.filters, { [board]: 'person:pat' });
      else if (kind === 'tasks-person-none') assert.ok(!tasks.boards[0]!.columns.some((c) => c.cards.some((card) => card.people.some((p) => p.key === 'nobody'))) && state.filters?.[board] === 'person:nobody', 'nobody has a card on the board');
      else assert.deepEqual([state.filters, state.modes?.[ROOT]], [{ [`agents:${ROOT}`]: 'mine' }, 'agents']);
    } else if (kind === 'tasks-agents') {
      // The agent board, with two builders in the cloud (GH-69): the page starts on it, and the cards say where each runs.
      const cards = (m as HomeModel).tasks.projects[0]!.columns.flatMap((c) => c.cards);
      assert.deepEqual([m.kind, (m as HomeModel).section, (startState(kind) as { modes: Record<string, string> }).modes[ROOT], cards.filter((c) => c.place?.label === 'Cloud').map((c) => c.id)], ['home', 'tasks', 'agents', ['ACME-43', 'ACME-44', 'ACME-47']]);
    } else if (kind.startsWith('dispatch-sheet') || kind === 'tasks-card-menu') {
      // Dispatch's sheet over the Tasks board, for an analysed task, and a card's ⋯ menu open on the agent board (D-168).
      const [after] = afterModel(kind);
      const sheet = after?.sheet as DispatchSheet | undefined;
      if (kind === 'dispatch-sheet') assert.deepEqual([m.kind, (m as HomeModel).section, after?.type, sheet?.title, !!sheet?.size, sheet?.places.find((p) => p.value === 'cloud')?.disabled], ['home', 'tasks', 'dispatch-sheet', 'Build ACME-16', true, undefined]);
      else if (kind === 'dispatch-sheet-anyway') assert.deepEqual([m.kind, (m as HomeModel).section, sheet?.go, sheet?.shares?.lines.map((l) => l.task)], ['home', 'tasks', 'Build it anyway', ['ACME-12', 'ACME-13']]);
      else assert.deepEqual([m.kind, (m as HomeModel).section, startState(kind)], ['home', 'tasks', { modes: { [ROOT]: 'agents' }, openMenu: `card:${ROOT}#ACME-16` }]);
    } else if (kind.startsWith('task-sheet') || kind.startsWith('ticket-edit')) {
      // The task sheet (T-74): a new task and a manual task's edit over the Tasks board, and a Jira task's edit over its tab, read-only where its ticket owns it;
      // with edits on (T-80), its ticket's text to write, its status, assignee and labels, the ticket's text changed meanwhile, and a description it can't write back.
      const [after] = afterModel(kind);
      const sheet = after?.sheet as TaskSheet | undefined;
      const wants: Record<string, unknown[]> = { 'task-sheet-new': [null, 'Add task', false, false], 'task-sheet-manual': ['T-4', 'Save', false, true], 'ticket-edit': ['ACME-19', 'Save', true, true], 'ticket-edit-on': ['ACME-19', 'Save', true, true], 'ticket-edit-changed': ['ACME-19', 'Save', true, true], 'ticket-edit-unkept': ['ACME-19', 'Save', true, true] };
      const want = wants[kind];
      assert.deepEqual([after?.type, sheet?.task, sheet?.go, !!sheet?.locked, sheet?.notes], ['task-sheet', ...want!], kind);
      assert.equal(m.kind === 'home' ? (m as HomeModel).section : m.kind, kind.startsWith('ticket-edit') ? 'ticket' : 'tasks');
      const on = kind === 'ticket-edit-on' || kind === 'ticket-edit-changed' || kind === 'ticket-edit-unkept';
      assert.deepEqual([!!sheet?.ticketEdits?.base, sheet?.ticketEdits?.rows.map((r) => r.field) ?? [], afterModel(kind)[1]?.type ?? null], [on, on ? ['status', 'assign', 'labels'] : [], kind === 'ticket-edit-changed' ? 'task-sheet-done' : null], kind);
      assert.equal(!!sheet?.ticketEdits?.unkept, kind === 'ticket-edit-unkept', `${kind}: the warning on a description that holds what can't be written back`);
    } else if (kind.startsWith('ticket-criteria')) {
      // Drafted acceptance criteria (T-81): ACME-19's tab with the draft, and the sheet over it with the draft below its description; or the draft opened as an update.
      const t = m as TicketModel;
      const sheet = afterModel(kind)[0]?.sheet as TaskSheet | undefined;
      assert.deepEqual([t.kind, t.key, t.criteria?.look.label, !!t.criteria?.body], ['ticket', 'ACME-19', 'Drafted', true], kind);
      if (kind === 'ticket-criteria-sheet') {
        assert.match(sheet?.fields.brief ?? '', /^New contacts get the welcome email twice[^\n]*\n\n## Drafted acceptance criteria\n\n### Acceptance criteria/);
        assert.deepEqual([sheet?.drafted, !!sheet?.ticketEdits?.base], [true, true]);
      } else assert.deepEqual([sheet, t.updates.map((u) => [u.id, u.about])], [undefined, [['ACME-19.1', 'Drafted acceptance criteria, test steps and edge cases']]]);
    } else if (kind.startsWith('ticket-verify')) {
      // A developer's pull request verified (T-84): ACME-21 passed, needing changes, or two pull requests to choose from.
      const v = (m as TicketModel).verify;
      const want = kind === 'ticket-verify-pass' ? 'Passed' : kind === 'ticket-verify-changes' ? 'Changes asked' : 'Choose its pull request';
      assert.deepEqual([(m as TicketModel).key, v?.look.label, v?.choice?.length ?? 0, !!v?.comment && !v.comment.disabled], ['ACME-21', want, kind === 'ticket-verify-choice' ? 2 : 0, kind !== 'ticket-verify-choice'], kind);
    } else if (kind.startsWith('tasks-slack')) {
      // A Slack channel (T-31, T-85): its board off beside a box for a thread's link, empty or with a link Track
      // refused; its board Open and Done; an empty board; and the scope the app lacks.
      const b = (m as HomeModel).tasks.projects[0]!.boards[0]!;
      const wants: Record<string, unknown[]> = {
        'tasks-slack': [true, null, 0, 0, false], 'tasks-slack-refused': [true, null, 0, 0, true], 'tasks-slack-board': [false, null, 2, 5, false],
        'tasks-slack-empty': [false, null, 2, 0, false], 'tasks-slack-scope': [false, 'channels:history', 0, 0, false],
      };
      assert.deepEqual([m.kind, (m as HomeModel).section, b.kind, !!b.off, b.error?.match(/channels:history/)?.[0] ?? null, b.columns.length, b.columns.reduce((n, c) => n + c.cards.length, 0), !!b.paste?.error], ['home', 'tasks', 'slack', ...wants[kind]!], kind);
    } else if (kind === 'tasks-github') assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).tasks.projects[0]!.boards[0]!.tab, (m as HomeModel).tasks.projects[0]!.boards[0]!.place], ['home', 'tasks', 'GitHub board', null]);
    // A Jira board following the active sprint (T-78): its place names the sprint and its dates.
    else if (kind === 'tasks-sprint') assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).tasks.projects[0]!.boards[0]!.place], ['home', 'tasks', 'Jira · ACME · active sprint ACME Sprint 13 (20 Oct to 2 Nov)']);
    // The Agents tab with agents that would bill per token (D-089), and Settings at How agents run (GH-110).
    else if (kind === 'agents-billing') assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).agents.billing?.tone], ['home', 'agents', 'orange']);
    else if (kind === 'settings-agents') assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).settings.agents.projects.length], ['home', 'settings', 2]);
    // Settings at Trackers and sign-ins, with each project's trackers (GH-112).
    else if (kind === 'settings-trackers') assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).settings.trackers.projects.map((p) => p.trackers.length)], ['home', 'settings', [2, 3]]);
    // Agents with its Where column showing full paths (GH-83).
    else if (kind === 'agents-path') assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).agents.whereView], ['home', 'agents', 'path']);
    // Agents with each repo's finished sessions to open (GH-119).
    else if (kind === 'agents-finished') assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).agents.repos.filter((r) => r.finished.length).length], ['home', 'agents', 2]);
    // The Overview with In progress busy, and with nothing running (D-092).
    // The Overview with a suggested rule and check, neutral and after everything orange (GH-102).
    else if (kind.startsWith('rules')) assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).overview.attention.filter((a) => a.rule).map((a) => [a.rule!.kind, a.look.tone])], ['home', 'overview', [['rule', 'neutral'], ['check', 'neutral']]]);
    // The busy Overview as a landing page, and with a detail opened over it (GH-160): ten suggested rules, six
    // tasks building, each with a check, three questions, two update drafts and twelve things in History. The
    // same with Needs you's Show all, or a card's list, open in full (T-36).
    else if (['overview-landing', 'overview-answer', 'overview-drafts', 'overview-history', 'overview-needs', 'overview-progress', 'overview-ready', 'overview-moment'].includes(kind)) {
      const o = (m as HomeModel).overview;
      const list = OVERVIEW_LISTS[kind];
      if (list) assert.deepEqual(startState(kind), { detail: { kind: 'list', group: list } });
      if (list) assert.ok(o.landing.find((g) => g.key === list)!.total > 3, `${kind}: more than Needs you would show`);
      assert.deepEqual([m.kind, (m as HomeModel).section, o.attention.filter((a) => a.rule).length, o.inProgress.groups.length, o.questions.length, o.attention.filter((a) => a.update).length, o.history.counts.all], ['home', 'overview', 10, 9, 3, 2, 13]);
      // A review in the cloud runs no check on this Mac (T-86), nor does a builder acc can't see (T-92): every other group is a build with its checks.
      assert.ok(o.inProgress.groups.filter((g) => !g.jobs.some((j) => j.kind === 'review' || j.look.label === 'Not answering')).every((g) => g.jobs.some((j) => j.kind === 'check')), 'each building task has its checks');
    }
    // History with more than two pages (D-170): the first 40 of 100 entries, three days of them, opened over the Overview.
    else if (kind === 'overview-pages') {
      const h = (m as HomeModel).overview.history;
      assert.deepEqual([h.items.length, h.more, h.counts, startState(kind)], [40, true, { all: 100, answer: 0, move: 75, run: 25 }, { detail: { kind: 'history' } }]);
      assert.ok(Date.now() - Date.parse(h.items.at(-1)!.at) > 48 * 3_600_000, 'its first page reaches back over two days, so it holds three days whatever the hour');
    }
    // The busy Overview with nothing that needs you (T-36): its calm line, and the cards but When you have a moment, which emptied with it.
    else if (kind === 'overview-clear') assert.deepEqual([(m as HomeModel).overview.landing[0]!.rows.length, (m as HomeModel).overview.landing[0]!.empty, (m as HomeModel).overview.cards.length], [0, 'No agent is waiting, nothing is blocked, and setup is done.', 3]);
    // The busy Overview with news held while away (D-164): Since you last looked, a line for each.
    else if (kind === 'overview-since') assert.deepEqual([(m as HomeModel).overview.since?.rows.map((r) => r.look.label), (m as HomeModel).overview.since?.part], [['Review passed', 'Merged', 'Ready for review', 'Analysis ready', 'Analysis back', 'Sprint changed'], 'overview:since']);
    // The loading screen (T-16) holds back the Overview's model, which the run never sends.
    else if (kind === 'loading') assert.deepEqual([m.kind, (m as HomeModel).section], ['home', 'overview']);
    else if (kind.startsWith('overview-')) assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).overview.inProgress.empty === null], ['home', 'overview', kind === 'overview-busy']);
    // The Overview of a project with a merge queue, autopilot on and off, and its head held (GH-73).
    else if (kind.startsWith('queue')) assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).overview.queue[0]?.rows.length, (m as HomeModel).overview.queue[0]?.off, !!(m as HomeModel).overview.queue[0]?.rows[0]?.tip], ['home', 'overview', 3, kind === 'queue-off', kind === 'queue-held']);
    // Settings' Limits and checks in their other states: two projects' caps beside a machine with no total (GH-111).
    // Settings' About behind, and with a look that failed (GH-114): the newer release's state, orange or neutral.
    else if (kind.startsWith('settings-about')) assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).settings.about?.release.look.tone], ['home', 'settings', kind === 'settings-about' ? 'orange' : 'neutral']);
    // Setup as first shown in a folder that isn't set up (GH-138): the question, and the machine's steps left.
    else if (kind.startsWith('setup-first')) assert.deepEqual([m.kind, (m as HomeModel).section, !!(m as HomeModel).setup.start, (m as HomeModel).setup.parts.map((p) => [p.part, p.todo])], ['home', 'setup', true, [['machine', kind === 'setup-first' ? 0 : 2], ['project', 0]]]);
    // The output panel over the Tasks board on a review (T-63): passed, changes asked, still running, and with no verdict to show.
    else if (OUTPUT_REVIEWS[kind]) assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).runs[0]?.review?.phase, (m as HomeModel).runs[0]?.look.label], ['home', 'tasks', kind === 'output-reviewing' ? 'running' : kind === 'output-unread' ? 'unread' : 'done', kind === 'output-passed' ? 'Passed' : kind === 'output-reviewing' ? 'Running' : kind === 'output-unread' ? 'Failed' : 'Changes asked']);
    // The output panel over the Tasks board on a run as rows (T-64): a deploy running, done with more rows than it shows, and an install that failed.
    else if (OUTPUT_RUNS[kind]) {
      const r = (m as HomeModel).runs[0]!;
      assert.deepEqual([m.kind, (m as HomeModel).section, r.look.label, r.hidden > 0, r.result?.look.label ?? null], ['home', 'tasks', ...({ running: ['Running', false, null], done: ['Done', true, 'Done'], failed: ['Failed', false, 'Failed'] } as const)[OUTPUT_RUNS[kind]!]]);
    }
    // A run of acc as a list of steps (T-65): a deploy in progress, a promotion that failed at its check, a dispatch done.
    else if (OUTPUT_STEPS[kind]) {
      const r = (m as HomeModel).runs[0]!;
      assert.deepEqual([m.kind, (m as HomeModel).section, r.look.label, r.steps?.map((s) => s.look.label).at(-1), r.result?.look.label ?? null], ['home', 'tasks', ...({ 'steps-running': ['Running', 'Running', null], 'steps-failed': ['Failed', 'Failed', 'Failed'], 'steps-done': ['Done', 'Done', 'Done'] } as const)[OUTPUT_STEPS[kind]!]]);
    }
    // Someone new (T-96): the Tasks tab with its first steps, which every other shot starts dismissed.
    else if (kind === 'tasks-first') assert.deepEqual([m.kind, (m as HomeModel).section, shotState(kind), shotState('tasks'), shotState('tasks-agents')], ['home', 'tasks', {}, { firstStepsSeen: true }, { modes: { [ROOT]: 'agents' }, firstStepsSeen: true }]);
    else if (kind === 'settings-limits') assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).settings.limits?.caps.map((c) => c.value)], ['home', 'settings', ['1', '16', 'None']]);
    else assert.deepEqual([m.kind, (m as HomeModel).section, (m as HomeModel).connect], ['home', kind === 'output' ? 'setup' : kind, null]);
  }
  assert.equal((sampleModel('agents') as HomeModel).agents.whereView, 'folder');
  assert.deepEqual(PAGES.filter((p) => !(HOME_SECTIONS as readonly string[]).includes(p)), ['agents-path', 'ticket', 'ticket-questions', 'ticket-split', 'ticket-stopped', 'ticket-track', 'ticket-checks', 'ticket-waits', 'ticket-note', 'ticket-review', 'agent', 'output', 'connect-start', 'connect-shared', 'connect-jira', 'connect-azure', 'connect-github', 'connect-existing', 'connect-sprint', 'connect-monday', 'connect-slack', 'connect-slack-channel', 'connect-slack-refused', 'connect-epic', 'connect-epic-used', 'connect-epic-azure', 'connect-epic-github', 'slack-none', 'slack-off', 'slack-paused', 'tasks-monday', 'tasks-github', 'tasks-sprint', 'tasks-slack', 'tasks-slack-refused', 'tasks-slack-board', 'tasks-slack-empty', 'tasks-slack-scope', 'agents-billing', 'overview-busy', 'overview-idle', 'queue', 'queue-off', 'queue-held', 'settings-agents', 'settings-trackers', 'settings-limits', 'agents-finished', 'rules', 'rules-accept', 'settings-about', 'settings-about-failed', 'settings-github', 'settings-page', 'setup-first', 'setup-first-machine', 'tasks-modal', 'overview-landing', 'overview-answer', 'overview-drafts', 'overview-history', 'overview-pages', 'overview-needs', 'overview-progress', 'overview-ready', 'overview-moment', 'overview-clear', 'overview-since', 'tasks-agents', 'ticket-cloud', 'ticket-nofields', 'loading', 'palette', 'palette-empty', 'tasks-moving', 'output-passed', 'output-changes', 'output-reviewing', 'output-review-open', 'output-unread', 'dispatch-sheet', 'ticket-dispatch', 'tasks-card-menu', 'dispatch-sheet-anyway', 'output-running', 'output-done', 'output-failed', 'output-details', 'output-steps-running', 'output-steps-failed', 'output-steps-done', 'task-sheet-new', 'task-sheet-manual', 'ticket-edit', 'ticket-edit-on', 'ticket-edit-changed', 'ticket-edit-unkept', 'ticket-criteria-sheet', 'ticket-criteria-update', 'ticket-verify-pass', 'ticket-verify-changes', 'ticket-verify-choice', 'ticket-manifest', 'tasks-person-menu', 'tasks-person', 'tasks-person-agents', 'tasks-person-none', 'ticket-github', 'ticket-azure', 'ticket-monday', 'tasks-azure', 'ticket-missing', 'tasks-azure-loading', 'tasks-azure-refreshing', 'tasks-first']);
  assert.equal((sampleModel('settings') as HomeModel).settings.slack?.state, 'on');
  // monday.com's Connect page: its token page, its board picked by name, and two status columns to choose from.
  const monday = (sampleModel('connect-monday') as HomeModel).connect!;
  assert.deepEqual([monday.kind, monday.fields[0]?.help?.url, monday.pickers.map((p) => [p.key, p.hidden])], ['monday', 'https://acme.monday.com/apps/manage/tokens', [['board', false], ['group', false], ['statusColumn', false]]]);
  // The tick for every project on the site, named for it (GH-79), and the sign-in it keeps said on the board.
  const shared = (sampleModel('connect-shared') as HomeModel).connect!;
  assert.deepEqual([shared.share.shown, shared.share.on, shared.share.label], [true, true, 'Use this sign-in for every project on acme.atlassian.net']);
  assert.equal((sampleModel('tasks') as HomeModel).tasks.projects[0]!.boards[0]!.signIn?.label, 'Signed in as jordan@acme.example, for every project on acme.atlassian.net');
  // Busy: several tasks with two or three jobs each, both slots held and one check waiting, and a done line (D-092).
  const busy = (sampleModel('overview-busy') as HomeModel).overview.inProgress;
  assert.ok(busy.groups.filter((g) => g.jobs.length >= 2).length >= 3, 'several tasks with two or three jobs');
  assert.ok(busy.groups.some((g) => g.done.length), 'a done line');
  assert.equal(busy.machine[0]!.look.label, 'Heavy checks: 2 of 2 in use, none free, 1 waiting');
  assert.equal((sampleModel('overview-idle') as HomeModel).overview.inProgress.empty, 'Nothing is running.');
  // A task in review with its builder's note, two lines still open (D-106).
  const noted = (sampleModel('ticket-note') as TicketModel).acc!.note!;
  assert.deepEqual([noted.landed.length, noted.moved.length, noted.open.length, noted.fromLast], [2, 2, 2, false]);
  // A ticket acc doesn't keep yet, being tracked from its card (D-074).
  assert.deepEqual([(sampleModel('ticket-track') as TicketModel).trackable, (sampleModel('ticket-track') as TicketModel).tracking], [true, true]);
  // A ticket's checks say what their tests ran, and one needs a person (GH-100).
  assert.deepEqual((sampleModel('ticket') as TicketModel).acc!.checks.filter((c) => c.counts).map((c) => [c.gate, c.look.label, c.counts]), [['validate', 'fail', '21 run, 4 failed, 0 skipped'], ['flow-tests', 'needs a person', '38 run, 2 skipped']]);
  assert.deepEqual((sampleModel('ticket') as TicketModel).acc!.checks.slice(-3, -1).map((c) => [c.gate, c.summary]), [['flow-tests', '2 skipped, up from 0 on 4f2a9c1: OrderFlowTest.discount, OrderFlowTest.tax newly skipped.'], ['lwc-tests', 'Not run on this commit']], 'the hold sits beside a check not run on this commit, with stray-files after them (GH-103)');
  // A ticket being built, one whose analysis has questions, and one too big for one task (D-052).
  assert.deepEqual(['ticket', 'ticket-questions', 'ticket-split'].map((k) => (sampleModel(k as never) as TicketModel).analysis?.look.label), ['Planned before the build', '2 questions for you', 'Too big for one task']);
});

test('the sample data shows every style: each board column, each kind of session, each kind of worktree', () => {
  const home = sampleModel('tasks') as HomeModel;
  const tasks = home.tasks;
  for (const c of tasks.projects[0]!.columns) assert.ok(c.cards.length, `the ${c.group} column has a card`);
  // Track on the tracker's board (D-074): ready, on its way and refused, and none on a done ticket acc doesn't keep.
  const tcards = tasks.projects[0]!.boards[0]!.columns.flatMap((c) => c.cards.map((x) => ({ ...x, done: c.done })));
  const track = (key: string) => tcards.find((x) => x.key === key)!.track;
  assert.deepEqual([track('ACME-30'), track('ACME-31')?.busy, !!track('ACME-32')?.error], [{ busy: false, error: null }, true, true]);
  assert.ok(tcards.some((x) => x.done && !x.acc && !x.track), 'a done ticket acc doesn\'t keep has no Track');
  const repos = home.agents.repos;
  const agents = repos.flatMap((r) => [...r.tasks.flatMap((t) => t.agents), ...r.finished]);
  assert.ok(agents.some((a) => a.needsYou) && agents.some((a) => a.background && !a.needsYou) && agents.some((a) => !a.background));
  // Every kind of repo heading (GH-119): this window's project, a repo in another window, repos elsewhere by
  // name, two of one name telling themselves apart (GH-83), and Other folders.
  assert.deepEqual(repos.map((r) => [r.label, r.window]), [['Acme Service', 'this'], ['clients/Acme Service', 'other'], ['personal/Acme Service', null], ['side-project', null], ['Other folders', null]]);
  // Where shows only off a task's own worktree: the main checkout, a folder in a repo, home (GH-119).
  const wheres = agents.map((a) => a.where);
  for (const w of ['main checkout', 'force-app/main', '~']) assert.ok(wheres.includes(w), `where: ${w}`);
  assert.ok(wheres.includes(null), 'and nothing in a task\'s own worktree');
  // A task with a builder and a review under way, in the repo in another window.
  assert.deepEqual(repos[1]!.tasks.find((t) => t.key === 'ACME-42')?.agents.map((a) => a.label), ['review', 'builder']);
  // Finished sessions (D-095): in the project, a done task's builder, an earlier run's and a recorded review's;
  // in another repo, two of its done tasks'. Each names its task, since no task line heads it.
  const finished = (r: number) => repos[r]!.finished.map((a) => `${a.task?.key} ${a.label}`);
  assert.deepEqual(finished(0), ['ACME-20 review', 'ACME-12 builder', 'ACME-10 builder']);
  assert.deepEqual(finished(1), ['ACME-38 builder', 'ACME-37 builder']);
  assert.ok(agents.filter((a) => a.finished).every((a) => a.look.label === 'Finished'));
  // An untied one that still needs you, by its own name; each repo's Stop all, but for the reviewer's.
  assert.equal(agents.find((a) => a.name === 'ACME-11')?.look.label, 'Needs you: permission prompt', 'acc can\'t tie it');
  // ACME-37's process is gone, so there's nothing of it to stop (D-119).
  assert.deepEqual(repos.map((r) => r.stopFinished), [2, 1, 0, 0, 0]);
  assert.equal(home.agents.stopFinished, 3);
  const worktrees = home.worktrees.projects[0]!.worktrees;
  assert.deepEqual([...new Set(worktrees.map((w) => w.state.label.replace(/^\d+/, 'N')))].sort(), ['Clean', 'Missing on disk', 'N changed']);
});

test('Light and Dark each set exactly the colours the pages and VSCode\'s webview stylesheet read, both ways (GH-109)', () => {
  const read = new Set([...readsVars(pageStyles()), ...readsVars(vscodeDefaults())]);
  // The only variables read that aren't colours: fonts, which stay VSCode's in Light and Dark.
  assert.deepEqual(Object.keys(FONTS).sort(), ['editor-font-family', 'font-family', 'font-size', 'font-weight']);
  const colours = [...read].filter((v) => !(v in FONTS)).sort();
  assert.ok(colours.length >= 40, `${colours.length} colours compared`);
  assert.ok(colours.includes('scrollbarSlider-background') && colours.includes('charts-orange'), 'from VSCode\'s stylesheet and the page\'s');
  const all = palettes();
  assert.deepEqual(Object.keys(all).sort(), ['dark', 'light']);
  for (const [theme, palette] of Object.entries(all)) {
    const set = Object.keys(palette).sort();
    assert.deepEqual(set.filter((v) => !colours.includes(v)), [], `${theme} sets no colour nothing reads`);
    assert.deepEqual(colours.filter((v) => !set.includes(v)), [], `${theme} sets every colour read`);
    for (const f of Object.keys(FONTS)) assert.ok(!(f in palette), `${theme} leaves ${f} to VSCode`);
  }
});

test('the palettes are theme.css\'s alone: !important on <html>, each with its color-scheme, and nothing else keys on VSCode\'s theme (GH-109)', () => {
  const rules = cssRules(styleFile('theme.css'));
  assert.deepEqual(rules.map((r) => r.selector), ['html[data-theme="dark"]', 'html[data-theme="light"]']);
  for (const r of rules) {
    const theme = /"(\w+)"/.exec(r.selector)![1];
    assert.deepEqual(r.declarations.filter((d) => d.name === 'color-scheme').map((d) => d.value), [theme], `${theme} sets its color-scheme`);
    const colours = r.declarations.filter((d) => d.name !== 'color-scheme');
    assert.ok(colours.length >= 40, `${theme}: ${colours.length} colours`);
    for (const d of colours) assert.ok(d.name.startsWith('--vscode-') && d.important, `${theme}: ${d.name} is a --vscode-* colour, !important`);
  }
  // Outside theme.css, VSCode's body classes count only while the page matches VSCode, and no rule sets a --vscode-* colour.
  let keyed = 0;
  for (const f of styleFiles().filter((x) => x !== 'theme.css')) {
    for (const r of cssRules(styleFile(f))) {
      for (const sel of r.selector.split(',').map((s) => s.trim())) {
        if (!/\.vscode-(light|dark|high-contrast)/.test(sel)) continue;
        keyed++;
        assert.ok(sel.includes('[data-theme="vscode"]'), `${f}: ${sel} keys on VSCode's theme only under [data-theme="vscode"]`);
      }
      for (const d of r.declarations) assert.ok(!d.name.startsWith('--vscode-'), `${f}: ${r.selector} sets ${d.name}`);
    }
  }
  assert.ok(keyed >= 4, `${keyed} selectors key on VSCode's theme: the mark's`);
});

test('a shot forces its theme under VSCode\'s other one, with VSCode\'s own stylesheet first (GH-109)', () => {
  const page = pageFor('settings', 'light', sampleModel('settings', Date.now(), 'light'));
  assert.match(page, /<html lang="en" data-theme="light" style="[^"]*--vscode-editor-background: #1f1f1f;/, 'Dark\'s colours injected, as VSCode would');
  assert.match(page, /--vscode-font-family: -apple-system/);
  assert.match(page, /<body class="vscode-dark" data-view="home"/);
  assert.ok(page.indexOf('@layer vscode-default') < page.indexOf('webview/styles.css'), 'VSCode\'s stylesheet comes first');
  assert.ok(!page.includes('collectColours'), 'a shot gathers no colours');
  const matched = pageFor('overview', 'vscode', sampleModel('overview'), 'light', true);
  assert.match(matched, /<html lang="en" data-theme="vscode" style="[^"]*--vscode-editor-background: #ffffff;/);
  assert.ok(matched.includes('setTimeout(collectColours, 500)') && matched.includes('window.requestAnimationFrame = '), 'gathered once the page\'s frame callbacks have run');
  const settings = sampleModel('settings', Date.now(), 'dark') as HomeModel;
  assert.deepEqual([settings.section, settings.settings.theme], ['settings', 'dark']);
});

test('the colour check reads what a page gathered, and finds where two drawings differ (GH-109)', () => {
  const rows: Colours = [['div.a', COLOUR_PROPERTIES.map(() => 'rgb(0, 0, 0)')], ['span::before', COLOUR_PROPERTIES.map(() => 'rgb(1, 1, 1)')]];
  assert.deepEqual(dumpedColours(`<html><body><main></main><script type="application/json" id="acc-colours">${JSON.stringify(rows)}</script></body></html>`), rows);
  assert.equal(dumpedColours('<html><body></body></html>'), null);
  assert.deepEqual(colourDiffs(rows, rows), []);
  const other = structuredClone(rows);
  other[1]![1][1] = 'rgb(9, 9, 9)';
  assert.deepEqual(colourDiffs(rows, other), [{ what: 'span::before', property: 'background-color', a: 'rgb(1, 1, 1)', b: 'rgb(9, 9, 9)' }]);
  assert.deepEqual(colourDiffs(rows, rows.slice(1)), [{ what: 'the page, from element 0', property: 'its elements', a: '2 elements, div.a there', b: '1 elements, span::before there' }], 'different elements differ as a whole');
  assert.deepEqual(colourDiffs(rows, rows.slice(0, 1)).map((d) => d.what), ['the page, from element 1'], 'and so does one with fewer');
  assert.deepEqual(COLOUR_PAGES, ['overview', 'tasks', 'settings', 'settings-agents', 'settings-trackers', 'settings-limits', 'settings-about', 'slack-paused', 'settings-github', 'settings-page', 'ticket', 'agent', 'tasks-modal', 'overview-landing', 'overview-drafts', 'tasks-agents', 'ticket-cloud', 'loading', 'palette']);
});

test('the page\'s styles: what every area shares first, then each area\'s own by file name, each named for a module of the page (GH-95)', () => {
  const files = styleFiles();
  assert.ok(files.length >= 10, `${files.length} stylesheets`);
  assert.deepEqual([files[0], files.slice(1)], ['styles.css', [...files.slice(1)].sort()]);
  assert.ok(pageStyles().startsWith('/* Theme-native'), 'styles.css comes first');
  const dir = tempDir('acc-styles-');
  for (const f of ['styles.css', 'tasks.css', 'tasks.ts', 'agents.css', 'agents.ts']) writeFileSync(join(dir, f), `/* ${f} */\n`);
  assert.deepEqual(styleFiles(dir), ['styles.css', 'agents.css', 'tasks.css']);
  assert.equal(pageStyles(dir), '/* styles.css */\n\n/* agents.css */\n\n/* tasks.css */\n');
  writeFileSync(join(dir, 'cards.css'), '');
  assert.throws(() => styleFiles(dir), /No module of the page is named for cards\.css/);
});

test('the page hands the model to the real webview, and no string in it can close the script', () => {
  const model = sampleModel('agents') as HomeModel;
  model.agents.repos[0]!.tasks[0]!.agents[0]!.name = '</script><img src=x onerror=alert(1)>';
  const page = pageFor('agents', 'dark', model);
  assert.ok(!page.includes('</script><img'));
  assert.ok(page.includes('src="webview/main.js"') && page.includes('data-view="home"'));
  assert.ok(page.includes('data-theme="dark"') && page.includes('--vscode-editor-background: #ffffff'), 'Dark, under VSCode\'s light theme');
});

test('Chrome is found from $CHROME first, and a wrong $CHROME is reported, not guessed past', () => {
  const said: string[] = [];
  const say = (l: string) => said.push(l);
  assert.equal(findChrome({ CHROME: '/opt/chrome' }, (p) => p === '/opt/chrome', say, () => '/cache/shell'), '/opt/chrome');
  assert.deepEqual(said.splice(0), ['Drawing with CHROME: /opt/chrome.'], '$CHROME wins over the shell in the cache');
  assert.equal(findChrome({ CHROME: '/nowhere' }, () => false, say, () => '/cache/shell'), null);
  assert.deepEqual(said.splice(0), [], 'a wrong $CHROME says nothing, and the run fails naming it');
  assert.equal(noBrowser({ CHROME: '/nowhere' }), 'CHROME is set to /nowhere, but there is no browser there. Fix the path, or unset CHROME to draw with the pinned headless shell.', 'its own message, naming the path');
  assert.equal(noBrowser({}), NO_BROWSER, 'with no CHROME, the run says there is no browser at all');
});

test('the pinned shell in the cache comes before the Chrome app, and says so in one line (T-68)', () => {
  const said: string[] = [];
  const app = (p: string) => p.includes('Google Chrome.app');
  assert.equal(findChrome({}, app, (l) => said.push(l), () => '/cache/155/chrome-headless-shell', () => undefined), '/cache/155/chrome-headless-shell');
  assert.deepEqual(said, [`Drawing with the pinned headless shell, chrome-headless-shell ${PIN.version}.`]);
});

test('with no shell in the cache, only the Chrome app draws, and its one line says it may take the app over and names npm run browser (T-68)', () => {
  const said: string[] = [];
  assert.equal(findChrome({}, (p) => p.includes('Chromium.app'), (l) => said.push(l), () => null, () => undefined), '/Applications/Chromium.app/Contents/MacOS/Chromium');
  assert.deepEqual(said, [APP_WARNING]);
  assert.match(APP_WARNING, /may take it over/);
  assert.match(APP_WARNING, /npm run browser/);
  // One on the PATH is the app too.
  said.length = 0;
  assert.equal(findChrome({}, () => false, (l) => said.push(l), () => null, () => '/usr/bin/chromium'), '/usr/bin/chromium');
  assert.deepEqual(said, [APP_WARNING]);
});

test('with nothing to draw with, findChrome finds none and says nothing, and the run\'s message names npm run browser (T-68)', () => {
  const said: string[] = [];
  assert.equal(findChrome({}, () => false, (l) => said.push(l), () => null, () => undefined), null);
  assert.deepEqual(said, []);
  assert.match(NO_BROWSER, /npm run browser/);
});
