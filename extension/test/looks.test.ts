// Every state has an icon and a label, and no table shows one state red and another green (GH-105). The
// author is colourblind: CLAUDE.md asks for an icon and a label on every state, and orange against blue.
// These tests walk every table and function that maps a state to how it shows, through every value it
// takes, and read the colours its tones resolve to in Light's and Dark's palettes.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import test from 'node:test';
import type { AutopilotRecord } from '../../packages/core/src/autopilot-log.ts';
import { AUTOPILOT_STEPS, DISPLAY, QUEUE_PHASES, type SessionTie } from '../../packages/core/src/ledger.ts';
import { GATE_STATUSES } from '../../packages/core/src/receipts.ts';
import { escapeRegExp } from '../../packages/core/src/text.ts';
import { agentLook } from '../src/logic/agents.ts';
import { ACTIVITIES } from '../src/logic/doing.ts';
import { type AgentSession, TASK_GROUPS, type TaskRow, type Tone } from '../src/logic/shared.ts';
import { type AboutAction, type AboutFacts, aboutModel } from '../src/model/about.ts';
import { billingLook } from '../src/model/agents.ts';
import { accLook, CATEGORY_LOOK, columnLook, PRIORITY_ICON, priorityIcon, statusLook, trackerBoard, TYPE_ICON } from '../src/model/boards.ts';
import { analysisLook, autopilotLook, closedPrLook, cloudReviewLook, filesLook, placeLook, stoppedLook, unseenLook } from '../src/model/cards.ts';
import { builderPlaceLook } from '../../packages/core/src/cloud.ts';
import { cloudSetting, protectionLook } from '../src/model/settings.ts';
import { moveLook as branchMoveLook } from '../src/model/branches.ts';
import { autopilotStepLook, OUTCOME_LOOK, outcomeLook } from '../src/model/history.ts';
import { LANDING_LOOK, moveLook, updatesLook } from '../src/model/landing.ts';
import { capLook } from '../src/model/limits.ts';
import { PIPELINE_MERGE_LOOK, PIPELINE_ROLE_LOOK } from '../src/model/pipeline.ts';
import type { UpdateCard } from '../src/model/updates.ts';
import { queueLook } from '../src/model/overview.ts';
import { RULE_LOOK } from '../src/model/rules.ts';
import { SINCE_LOOK } from '../src/model/since.ts';
import { STATUS } from '../src/model/setup.ts';
import { chapterLook } from '../src/model/setup-walk.ts';
import { displayLook } from '../src/model/shared.ts';
import { CHECK_LOOK, checkLook, REVIEW_LOOK, ticketReview, wordingLook } from '../src/model/task-page.ts';
import { CRITERION_LOOK, dockReview, REVIEW_RUN_LOOK } from '../src/model/dock-review.ts';
import { VERIFY_LOOK } from '../src/model/verify.ts';
import { CHANGE_LOOK, DEPLOY_LOOK } from '../src/model/changes.ts';
import { TEAM_LOOK } from '../src/model/team.ts';
import { GROUP_LOOK } from '../src/model/group-check.ts';
import { RECORD_LOOK } from '../src/model/record-changes.ts';
import { FIELD_LOOK } from '../src/model/changes-field.ts';
import { MANIFEST_LOOK, MANIFEST_ROW_LOOK } from '../src/model/manifest.ts';
import { BUSY_LOOK, MERGE_LOOK, NEXT_LOOK, WHERE_LOOK } from '../src/model/ticket-deploy.ts';
import { TALK_LOOK } from '../src/model/talk.ts';
import { PROGRESS_LOOK } from '../src/model/plan-progress.ts';
import { RESULT_LOOK, ROW_LOOK } from '../src/model/run-view.ts';
import { STEP_LOOK } from '../src/model/run-steps.ts';
import { worktreeLook } from '../src/model/worktrees.ts';
import { loadWord, taskLook } from '../src/progress.ts';
import { SLACK_KIND_WORDS, SLACK_KINDS, slackCard } from '../src/slack.ts';
import { PANEL, panelLook } from '../webview/looks.ts';
import { TINTS } from '../webview/tints.ts';
import { MOVE_LOOK } from '../webview/board-keys.ts';
import { sampleAbout } from '../scripts/fixtures/about.ts';
import { sampleBoards, sampleGithubBoards, sampleMondayBoards, sampleSlackBoards, sampleSprintBoards } from '../scripts/fixtures/boards.ts';
import { sampleHub } from '../scripts/fixtures/hub.ts';
import { ROOT } from '../scripts/fixtures/shared.ts';
import { sampleCloudSetup } from '../scripts/fixtures/cloud-setup.ts';
import { CLOUD_SETUP_ORDER } from '../src/model/cloud-setup.ts';
import { sampleTicket } from '../scripts/fixtures/task-page.ts';
import { sampleAzureBoards, sampleTrackerTicket } from '../scripts/fixtures/tracker-tickets.ts';
import { cssRules, PALETTE_THEMES, type PaletteTheme, pageStyles, palettes } from '../scripts/styles.ts';
import { root, row } from './support.ts';

const repo = join(root, '..');

/** Every icon the codicon font the page ships draws: the build copies this file into the page. */
export const ICONS = new Set([...readFileSync(join(repo, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css'), 'utf8').matchAll(/\.codicon-([\w-]+):before/g)].map((m) => m[1]!));
/** An icon name as the page draws it: ~spin is a modifier, not part of the name. */
const iconName = (icon: string): string => icon.replace(/~spin$/, '');

/** How a state shows: its words and its icon, and its tone where it has one. */
interface Shown { label?: string; icon: string; tone?: string }
interface Table {
  name: string;
  /** Where its source declares it, as file#name, so a table no test walks is found. */
  sources: string[];
  /** A table of task states, which must show each as core's DISPLAY does. */
  task?: true;
  /** Each state it takes, by name, and how it shows. */
  states: () => [string, Shown][];
}

const session = (o: Partial<AgentSession>): AgentSession => ({ cwd: '/r', kind: 'background', startedAt: 1, ...o });
const finished: SessionTie = { task: 'T-1', role: 'builder', finished: true, why: 'done' };
const record = (o: Partial<AutopilotRecord>): AutopilotRecord => ({ seq: 1, at: '2026-10-07T00:00:00Z', task: 'T-1', step: 'land', outcome: 'done', ...o });
const files = (o: Partial<NonNullable<TaskRow['files']>>): NonNullable<TaskRow['files']> => ({ known: true, shares: [], first: [], held: null, ...o });
const share = { task: 'T-2', files: ['a.ts'] };
const held = { at: '2026-10-07T00:00:00Z', failed: null, byAutopilot: false };
const product = <A, B>(as: readonly A[], bs: readonly B[]): [A, B][] => as.flatMap((a) => bs.map((b): [A, B] => [a, b]));

/**
 * What the state chip shows in each place it's drawn (T-91): the ticket page's state on every tracker, each
 * related row's, every board's column headings, and acc's state on a tracker's cards. The agent board's
 * headings are core's DISPLAY, which its own table walks.
 */
function chipStates(): [string, Shown][] {
  const now = Date.now();
  const pages = [...(['ACME-12', 'ACME-31', 'ACME-50'] as const).map((k) => sampleTicket(now, k)), ...(['github', 'azure', 'monday'] as const).map((k) => sampleTrackerTicket(now, k))];
  const rows = sampleHub(now).taskRows(ROOT);
  const boards = [sampleBoards(), sampleGithubBoards(), sampleMondayBoards(), sampleAzureBoards(), sampleSprintBoards(), sampleSlackBoards('board')].flat().map((b) => trackerBoard(b, rows, ROOT));
  const state = (s: { name: string; icon: string; tone: string; quiet?: boolean }): Shown => ({ label: s.name, icon: s.icon, tone: s.tone });
  return [
    ...pages.flatMap((m): [string, Shown][] => (m.status ? [[`${m.key}'s page`, state(m.status)]] : [])),
    ...pages.flatMap((m) => m.related.flatMap((r): [string, Shown][] => (r.status ? [[`${m.key}'s related ${r.key}`, state(r.status)]] : []))),
    ...boards.flatMap((b) => b.columns.map((c): [string, Shown] => [`${b.name}'s column ${c.name}`, { label: c.name, icon: c.icon, tone: c.tone }])),
    ...boards.flatMap((b) => b.columns.flatMap((c) => c.cards.flatMap((x): [string, Shown][] => (x.acc ? [[`${b.name}'s card ${x.key}`, x.acc.look]] : [])))),
  ];
}

/** Every table and function that maps a state to how it shows, with every value it takes. */
export const TABLES: Table[] = [
  { name: 'a tracker column, by its name', sources: ['extension/src/model/boards.ts#columnLook'], states: () => ([['Blocked', 'doing'], ['On hold', 'doing'], ['Stuck', 'doing'], ['In Progress', 'doing'], ['Todo', 'todo'], ['Done', 'done']] as const).map(([n, c]): [string, Shown] => [n, { label: n, ...columnLook(n, c) }]) },
  { name: 'a cap on builders, a project\'s or this machine\'s', sources: ['extension/src/model/limits.ts#capLook'], states: () => [['no total, some running', capLook(2, null, 'here')], ['no total, none running', capLook(0, null, 'here')], ['full', capLook(3, 3, 'here')], ['none running', capLook(0, 3, 'here')], ['room for more', capLook(1, 3, 'here')]] },
  {
    // Set up cloud builders (T-145): each step's check in the step bar, on a Mac and on Windows, done and not done, and while it's read.
    name: 'a step of Set up cloud builders', sources: ['extension/src/model/cloud-setup.ts#stepLook', 'extension/src/model/cloud-setup.ts#checkLook'],
    states: () => CLOUD_SETUP_ORDER.flatMap((step) => ['mac', 'win'].flatMap((sys) => ['todo', 'done'].map((how): [string, Shown] => [`${step}, ${sys}, ${how}`, sampleCloudSetup(`cloud-setup-${step}-${sys}-${how}`)!.steps.find((s) => s.id === step)!.look])))
      .concat([['checking', { label: 'Checking…', icon: 'loading~spin', tone: 'neutral' }]]),
  },
  { name: 'a suggested rule or check', sources: ['extension/src/model/rules.ts#RULE_LOOK'], states: () => Object.entries(RULE_LOOK) },
  { name: 'a notice on Since you last looked', sources: ['extension/src/model/since.ts#SINCE_LOOK'], states: () => Object.entries(SINCE_LOOK) },
  {
    name: 'a line on the Overview of its own', sources: ['extension/src/model/landing.ts#LANDING_LOOK', 'extension/src/model/landing.ts#updatesLook', 'extension/src/model/landing.ts#moveLook'],
    states: () => {
      const update = (state: 'draft' | 'posting', stale = false) => ({ update: { state, stale } as UpdateCard });
      return [
        ...Object.entries(LANDING_LOOK),
        ['update drafts', updatesLook([update('draft'), update('posting')])], ['one may have posted', updatesLook([update('draft'), update('posting', true)])], ['all posting', updatesLook([update('posting')])],
        ...[...TASK_GROUPS, 'abandoned'].map((to): [string, Shown] => [`moved to ${to}`, moveLook(to)]),
      ];
    },
  },
  { name: 'core\'s DISPLAY', sources: ['packages/core/src/ledger.ts#DISPLAY'], task: true, states: () => TASK_GROUPS.map((d) => [d, DISPLAY[d]]) },
  { name: 'a task\'s state, as the feed and the model show it', sources: ['extension/src/model/shared.ts#displayLook'], task: true, states: () => TASK_GROUPS.map((d) => [d, displayLook(d)]) },
  { name: 'In progress\'s task heading', sources: ['extension/src/progress.ts#taskLook'], task: true, states: () => TASK_GROUPS.map((d) => [d, taskLook({ display: d })]) },
  { name: 'a task\'s card and page, with nothing else to say', sources: ['extension/src/model/boards.ts#accLook'], task: true, states: () => TASK_GROUPS.map((d) => [d, accLook(row('T-1', d === 'needs-you' || d === 'ready' ? 'todo' : d, d))]) },
  {
    name: 'a task\'s card and page, saying more', sources: [],
    states: () => [
      ['autopilot needs you', accLook({ ...row('T-1', 'review', 'needs-you'), autopilot: { step: 'land', reason: 'no' } })],
      ['its agent needs you', accLook({ ...row('T-1', 'running', 'needs-you'), agent: agentLook(session({ state: 'blocked' })) })],
      ['its start failed', accLook({ ...row('T-1', 'todo', 'ready'), files: files({ held: { ...held, failed: 'no slot' } }) })],
      ['waits for files', accLook({ ...row('T-1', 'todo', 'ready'), files: files({ held, shares: [share], first: ['T-3'] }) })],
    ],
  },
  { name: 'a tracker\'s status, by its category', sources: ['extension/src/model/boards.ts#CATEGORY_LOOK'], states: () => Object.entries(CATEGORY_LOOK).map(([k, v]) => [k, { label: k, ...v }]) },
  // The ticket page's status (T-90): each category with each reason, so closed as not planned shows its own look.
  {
    name: 'a ticket\'s status on its page, with why it closed', sources: ['extension/src/model/boards.ts#NOT_PLANNED_LOOK', 'extension/src/model/boards.ts#statusLook'],
    states: () => product(Object.keys(CATEGORY_LOOK) as (keyof typeof CATEGORY_LOOK)[], ['completed', 'not-planned', null] as const).map(([category, reason]): [string, Shown] => [`${category}, ${reason ?? 'no reason'}`, { label: category, ...statusLook({ category, reason }) }]),
  },
  // A ticket's priority and kind (T-90): each beside the tracker's own word for it, in the font the page ships.
  {
    name: 'a ticket\'s priority and kind', sources: ['extension/src/model/boards.ts#PRIORITY_ICON', 'extension/src/model/boards.ts#TYPE_ICON'],
    states: () => [
      ...Object.keys(PRIORITY_ICON).map((l): [string, Shown] => [`priority ${l}`, { label: `priority ${l}`, icon: priorityIcon(Number(l) as keyof typeof PRIORITY_ICON)! }]),
      ...Object.entries(TYPE_ICON).map(([k, icon]): [string, Shown] => [k, { label: k, icon }]),
    ],
  },
  {
    name: 'a check\'s result', sources: ['extension/src/model/task-page.ts#CHECK_LOOK', 'extension/src/model/task-page.ts#checkLook'],
    states: () => [
      ...Object.entries(CHECK_LOOK),
      ...product(GATE_STATUSES, [false, true]).flatMap(([status, waived]): [string, Shown][] => [[`${status}${waived ? ', waived' : ''}`, checkLook({ status, waived, summary: 'ok' })], [`${status}, not run`, checkLook({ status, waived, summary: 'Not run on this commit' })]]),
    ],
  },
  // Settings' Pipeline (T-157): an environment's place in the pipeline, and whether reviewed work merges on its own.
  { name: 'an environment\'s place in the pipeline', sources: ['extension/src/model/pipeline.ts#PIPELINE_ROLE_LOOK'], states: () => Object.entries(PIPELINE_ROLE_LOOK) },
  { name: 'whether reviewed work merges on its own', sources: ['extension/src/model/pipeline.ts#PIPELINE_MERGE_LOOK'], states: () => Object.entries(PIPELINE_MERGE_LOOK) },
  { name: 'a setup step', sources: ['extension/src/model/setup.ts#STATUS'], states: () => Object.entries(STATUS) },
  { name: 'a chapter of Setup\'s walkthrough', sources: ['extension/src/model/setup-walk.ts#chapterLook'], states: () => [['done', chapterLook(0)], ['to do', chapterLook(3)]] },
  // The state chip (T-91), in every place it's drawn, from the screenshot run's fixtures: each tracker's ticket
  // page, its related rows, every board's columns, and acc's state on a tracker's cards.
  { name: 'the state chip, wherever it\'s drawn', sources: [], states: () => chipStates() },
  // The task page's Review block (T-53): its verdict and each finding's state, as the block shows them.
  {
    name: 'a review and its findings', sources: ['extension/src/model/task-page.ts#REVIEW_LOOK', 'extension/src/model/task-page.ts#ticketReview'],
    states: () => {
      const f = (must: boolean) => ({ message: 'm', must, file: 'a.ts', line: 1 });
      const block = (verdict: 'pass' | 'changes') => ticketReview('/r', 'review', { verdict: { task: 'T-1', sha: 'abc1234', verdict, summary: 's', findings: [f(true), f(false)], sessionId: '', at: 't' }, current: true, checkout: true, excerpts: [] })!;
      return [...Object.entries(REVIEW_LOOK), ...(['pass', 'changes'] as const).flatMap((v): [string, Shown][] => [[`a review that says ${v}`, block(v).look], ...block(v).findings.map((x): [string, Shown] => [`a finding: ${x.look.label}`, x.look])])];
    },
  },
  // A review in the output panel (T-63): before its verdict, each criterion, the met criteria's fold, and what a run's card wears.
  {
    name: 'a review in the output panel', sources: ['extension/src/model/dock-review.ts#CRITERION_LOOK', 'extension/src/model/dock-review.ts#REVIEW_RUN_LOOK'],
    states: () => {
      const v = (verdict: 'pass' | 'changes') => ({ v: 1 as const, task: 'T-1', sha: 'abc1234', env: 'e', verdict, summary: 's', criteria: [{ text: 'a', met: true, evidence: '' }, { text: 'b', met: false, evidence: '' }], findings: [{ message: 'm', must: true }], sessionId: '', at: 't', durationMs: 1, costUsd: null });
      const shown = (verdict: 'pass' | 'changes'): [string, Shown][] => {
        const r = dockReview({ startedAt: 0, endedAt: 1, stopped: false, review: { project: '/r', task: 'T-1', sha: null, read: { ok: true, verdict: v(verdict), checkout: true, excerpts: [] } } });
        if (r.phase !== 'done') return [];
        return [[`a review that says ${verdict}`, r.look], ...r.rows.map((x): [string, Shown] => [`a row: ${x.look.label}`, x.look]), ['the met criteria', r.met!.look]];
      };
      return [...Object.entries(CRITERION_LOOK), ...Object.entries(REVIEW_RUN_LOOK), ...shown('pass'), ...shown('changes')];
    },
  },
  // Verify the developer's work (T-84): the section's state, before, during, choosing, off, and its verdict.
  { name: 'a developer\'s pull request, verified', sources: ['extension/src/model/verify.ts#VERIFY_LOOK'], states: () => Object.entries(VERIFY_LOOK) },
  { name: 'a change against the plan, on a task\'s page (T-99)', sources: ['extension/src/model/changes.ts#CHANGE_LOOK'], states: () => Object.entries(CHANGE_LOOK) },
  // The builder's own deploy to its org, under Changes (D-206): one state, blue, with the org's name after it.
  { name: 'a task\'s deploy to its org, under Changes (T-115)', sources: ['extension/src/model/changes.ts#DEPLOY_LOOK'], states: () => Object.entries(DEPLOY_LOOK) },
  { name: 'a task\'s team, on its page: up to date or behind, and sharing files (T-103)', sources: ['extension/src/model/team.ts#TEAM_LOOK'], states: () => Object.entries(TEAM_LOOK) },
  // A group check's step on its task (T-165): checking, passed, merged, and what needs a builder or a person.
  { name: 'a task\'s step in a group check', sources: ['extension/src/model/group-check.ts#GROUP_LOOK'], states: () => Object.entries(GROUP_LOOK) },
  // Record changes (T-100): each change made, planned or not, refused, and a promotion's step to do, done or skipped.
  { name: 'a ticket\'s record change and a promotion\'s step', sources: ['extension/src/model/record-changes.ts#RECORD_LOOK'], states: () => Object.entries(RECORD_LOOK) },
  // A tracker's changes field on a ticket's page (T-105): reading it, failed, empty, the same as found, differing, and the draft.
  { name: 'a ticket\'s changes field, beside what the Command Center found', sources: ['extension/src/model/changes-field.ts#FIELD_LOOK'], states: () => Object.entries(FIELD_LOOK) },
  // Manifest for this ticket (T-101): the section's state, and each row's: new, not in the org, an unknown type, unchecked, an org copy that differs, an org change, a deletion.
  { name: 'a ticket\'s conversation with its planning agent', sources: ['extension/src/model/talk.ts#TALK_LOOK'], states: () => Object.entries(TALK_LOOK) },
  // The planning agent's progress (T-131): working, and not moving for five minutes.
  { name: 'the planning agent\'s progress while a plan is made or a reply comes', sources: ['extension/src/model/plan-progress.ts#PROGRESS_LOOK'], states: () => Object.entries(PROGRESS_LOOK) },
  { name: 'a ticket\'s environment rows (T-158)', sources: ['extension/src/model/ticket-deploy.ts#WHERE_LOOK', 'extension/src/model/ticket-deploy.ts#MERGE_LOOK', 'extension/src/model/ticket-deploy.ts#NEXT_LOOK', 'extension/src/model/ticket-deploy.ts#BUSY_LOOK'], states: () => [...Object.entries(WHERE_LOOK), ...Object.entries(MERGE_LOOK), ['next', NEXT_LOOK], ['busy', BUSY_LOOK]] },
  { name: 'a ticket\'s manifest and its rows', sources: ['extension/src/model/manifest.ts#MANIFEST_LOOK', 'extension/src/model/manifest.ts#MANIFEST_ROW_LOOK'], states: () => [...Object.entries(MANIFEST_LOOK), ...Object.entries(MANIFEST_ROW_LOOK)] },
  // A run in the output panel as rows (T-64): each kind of row, and how an ended run shows in its header line and result card.
  { name: 'a run of acc\'s steps in the output panel (T-65)', sources: ['extension/src/model/run-steps.ts#STEP_LOOK'], states: () => Object.entries(STEP_LOOK) },
  { name: 'a run\'s rows and its result in the output panel', sources: ['extension/src/model/run-view.ts#ROW_LOOK', 'extension/src/model/run-view.ts#RESULT_LOOK'], states: () => [...Object.entries(ROW_LOOK), ...Object.entries(RESULT_LOOK)] },
  {
    name: 'a question\'s outcome', sources: ['extension/src/model/history.ts#OUTCOME_LOOK', 'extension/src/model/history.ts#outcomeLook'],
    states: () => [...Object.entries(OUTCOME_LOOK), ...product(Object.keys(OUTCOME_LOOK), [false, true]).map(([o, ask]): [string, Shown] => [`${o}${ask ? ', asked' : ''}`, outcomeLook(o, ask)]), ['one a newer acc wrote', outcomeLook('reconsidered', false)]],
  },
  {
    name: 'a task in the merge queue', sources: ['extension/src/model/overview.ts#queueLook'],
    states: () => [...QUEUE_PHASES.flatMap((phase) => [false, true].map((off): [string, Shown] => [`${phase}${off ? ', autopilot off' : ''}`, queueLook({ place: 1, of: 2, ahead: null, phase, why: 'GitHub is busy' }, 'main', off)])), ['behind another', queueLook({ place: 2, of: 2, ahead: 'T-2', phase: 'waiting' }, 'main')]],
  },
  {
    name: 'a step autopilot took', sources: ['extension/src/model/history.ts#autopilotStepLook'],
    states: () => product(AUTOPILOT_STEPS, ['done', 'failed'] as const).flatMap(([step, outcome]) => [
      {}, { verdict: 'changes' as const }, { pr: { number: 7, url: 'https://x/7', opened: true } }, { pr: { number: 7, url: 'https://x/7', opened: false } },
      { cause: 'checks' as const }, { cause: 'queue' as const }, { checks: ['ci'] }, { conflicts: ['a.ts'] }, { shares: [share] }, { waitedFor: ['T-2'] }, { base: 'main' }, { base: 'main', queue: true as const }, { base: null },
    ].map((o): [string, Shown] => [`${step} ${outcome} ${JSON.stringify(o)}`, autopilotStepLook(record({ step, outcome, reason: 'why', ...o })).look])),
  },
  {
    name: 'an agent session', sources: ['extension/src/logic/agents.ts#agentLook'],
    states: () => product(product(['working', 'blocked', 'done', 'failed', 'stopped', undefined], ['busy', 'waiting', 'idle', undefined]), product([null, 'has a question'], [null, finished]))
      .flatMap(([[state, status], [asking, tie]]) => [undefined, 4].map((pid): [string, Shown] => [`${state}/${status}${asking ? ', asking' : ''}${tie ? ', finished' : ''}${pid ? ', with a process' : ''}`, agentLook(session({ state, status, pid }), asking, tie)])),
  },
  // What an agent at work is doing (T-164): each activity as its look shows it.
  { name: 'what an agent is doing', sources: ['extension/src/logic/doing.ts#ACTIVITIES'], states: () => Object.entries(ACTIVITIES).map(([k, a]): [string, Shown] => [k, agentLook(session({ state: 'working' }), null, null, { key: k as keyof typeof ACTIVITIES, ...a, detail: null })]) },
  { name: 'the wording findings of a task\'s analysis, on its page (T-12)', sources: ['extension/src/model/task-page.ts#wordingLook'], states: () => [1, 2].map((n) => [`${n} findings`, wordingLook(n)!]) },
  {
    name: 'a task\'s analysis, on its card', sources: ['extension/src/model/cards.ts#analysisLook'],
    states: () => {
      const a = (verdict: 'ready' | 'questions' | 'split', open = 0) => ({ verdict, at: '', open: Array.from({ length: open }, (_, i) => ({ id: `q${i}`, question: 'Which?', why: '', suggested: '' })), split: [] });
      return [['analyzing', { analyzing: { sessionId: 's' } }], ['split', { analysis: a('split') }], ['questions', { analysis: a('questions', 2) }], ['ready', { analysis: a('ready') }]]
        .map(([k, o]) => [k as string, analysisLook({ state: 'todo', analysis: null, analyzing: null, ...(o as object) })!]);
    },
  },
  { name: 'autopilot needs you', sources: ['extension/src/model/cards.ts#autopilotLook'], states: () => AUTOPILOT_STEPS.flatMap((step) => [true, false].map((why): [string, Shown] => [`${step}${why ? ', why' : ''}`, autopilotLook({ autopilot: { step, reason: 'no' } }, why)!])) },
  { name: 'a closed pull request', sources: ['extension/src/model/cards.ts#closedPrLook'], states: () => [['closed', closedPrLook({ state: 'review', pr: { number: 7, url: 'https://x/7', state: 'closed' } })!]] },
  {
    name: 'a builder that didn\'t start, or one acc can\'t see (T-92)', sources: ['extension/src/model/cards.ts#unseenLook'],
    states: () => [
      ['didn\'t start, to do', unseenLook({ state: 'todo', notStarted: { reason: 'Its builder didn\'t start', at: '2026-10-21T00:00:00Z' } })!],
      ['didn\'t start, in rework', unseenLook({ state: 'rework', notStarted: { reason: 'Its builder didn\'t start', at: '2026-10-21T00:00:00Z' } })!],
      ['claude agents doesn\'t answer', unseenLook({ state: 'running', unseen: 'unanswered' })!],
      ['quiet too', unseenLook({ state: 'running', unseen: 'quiet' })!],
    ],
  },
  { name: 'a stopped builder', sources: ['extension/src/model/cards.ts#stoppedLook'], states: () => [['said nothing', stoppedLook({ stopped: { said: null } })!], ['said something', stoppedLook({ stopped: { said: 'API Error' } })!]] },
  // Where a builder runs (GH-69): on the card, the page and acc show alike.
  { name: 'where a builder runs, on each system (T-150)', sources: ['packages/core/src/cloud.ts#builderPlaceLook'], states: () => ['darwin', 'win32', 'linux'].flatMap((os) => Object.entries(builderPlaceLook(os)).map(([k, v]): [string, Shown] => [`${k} on ${os}`, { ...v, tone: 'neutral' }])) },
  { name: 'where a task\'s builder runs, on its card', sources: ['extension/src/model/cards.ts#placeLook'], states: () => [['local', placeLook({ state: 'running', run: { where: 'local' } })!], ['cloud', placeLook({ state: 'running', run: { where: 'cloud' } })!], ['older run', placeLook({ state: 'review', run: {} })!]] },
  {
    name: 'a task\'s review in the cloud, on its card and on In progress (T-86)', sources: ['extension/src/model/cards.ts#cloudReviewLook'],
    states: () => {
      const c = (wait: string | null, failed: boolean) => ({ cloudReview: { url: 'https://claude.ai/code/s', firedAt: '2026-10-09T12:00:00Z', wait, failed } });
      return [['reviewing', cloudReviewLook(c(null, false))!], ['quiet', cloudReviewLook(c('no verdict from its cloud reviewer for 150 minutes: review it on this Mac', false))!], ['failed', cloudReviewLook(c('its cloud reviewer\'s review.json isn\'t a verdict acc can read (not JSON): review it on this Mac', true))!]];
    },
  },
  {
    name: 'cloud builders, in Settings', sources: ['extension/src/model/settings.ts#cloudSetting'],
    states: () => {
      const p = (github: boolean, cloud: { routine: string | null; default: 'local' | 'cloud'; quietMinutes: number; max: number; review: 'local' | 'cloud' } | null) => ({ name: 'P', root: '/p', branch: null, worktrees: [], config: { github: github ? { repo: 'o/r', account: 'a' } : null, environments: [], profile: 'generic', agents: { cloud } } });
      const cloud = { routine: 'trig_0123456789', default: 'local' as const, quietMinutes: 120, max: 3, review: 'local' as const };
      return [['no github', cloudSetting(p(false, null))!.look], ['off', cloudSetting(p(true, null))!.look], ['on, no routine', cloudSetting(p(true, { ...cloud, routine: null }))!.look], ['on', cloudSetting(p(true, cloud))!.look], ['default cloud', cloudSetting(p(true, { ...cloud, default: 'cloud' }))!.defaultPlace!], ['reviews local', cloudSetting(p(true, cloud))!.reviewPlace!], ['reviews cloud', cloudSetting(p(true, { ...cloud, review: 'cloud' }))!.reviewPlace!]];
    },
  },
  // GitHub's rules behind the cloud guard, per branch (GH-69): enforced in blue, anything else in orange.
  { name: 'what GitHub enforces on a branch, in Settings', sources: ['extension/src/model/settings.ts#protectionLook'], states: () => (['enforced', 'none', 'unavailable', 'unknown'] as const).map((state) => [state, protectionLook({ branch: 'main', state })]) },
  // An environment branch moved by anything but acc's merge (GH-69): orange, on the Overview, until a person has seen it.
  { name: 'a moved environment branch', sources: ['extension/src/model/branches.ts#moveLook'], states: () => [0, 1, 2].map((n) => [`${n} commits`, branchMoveLook({ branch: 'main', from: 'a', to: 'b', at: '', commits: Array.from({ length: n }, (_, i) => `sha${i} x`) })]) },
  {
    name: 'a task\'s files', sources: ['extension/src/model/cards.ts#filesLook'],
    states: () => ([
      ['its start failed', 'todo', 'ready', files({ held: { ...held, failed: 'no slot' } })], ['autopilot couldn\'t start it', 'todo', 'ready', files({ held: { ...held, failed: 'no slot', byAutopilot: true } })],
      ['waits for files', 'todo', 'ready', files({ held, shares: [share], first: ['T-3'] })], ['capped by the project', 'todo', 'ready', files({ held, capped: 'project' })], ['capped by the machine', 'todo', 'ready', files({ held, capped: 'machine' })],
      ['starting, sharing', 'todo', 'ready', files({ held, shares: [share] })], ['starting', 'todo', 'ready', files({ held })],
      ['shares files', 'running', 'running', files({ shares: [share] })], ['files unknown', 'todo', 'ready', files({ known: false })],
    ] as const).map(([k, state, display, f]): [string, Shown] => [k, filesLook({ state, display, files: f, analyzing: null })!]),
  },
  { name: 'a worktree', sources: ['extension/src/model/worktrees.ts#worktreeLook'], states: () => [[false, 0], [false, -1], [false, 3], [true, 0]].map(([prunable, changed]): [string, Shown] => [`${prunable ? 'missing' : changed}`, worktreeLook({ prunable: prunable as boolean, changed: changed as number })]) },
  // A card moved by keys (T-54): held, dropped, put down, or one that can't move, on the card and the board's live line.
  { name: 'a card moved by keys', sources: ['extension/webview/board-keys.ts#MOVE_LOOK'], states: () => Object.entries(MOVE_LOOK) },
  { name: 'a Jira panel', sources: ['extension/webview/looks.ts#PANEL', 'extension/webview/looks.ts#panelLook'], states: () => [...Object.keys(PANEL), 'Custom'].map((k) => [k, { label: k, ...panelLook(k) }]) },
  { name: 'a kind of Slack message', sources: ['extension/src/slack.ts#SLACK_KIND_WORDS'], states: () => SLACK_KINDS.map((k) => [k, SLACK_KIND_WORDS[k]]) },
  {
    name: 'the Slack card', sources: ['extension/src/slack.ts#slackCard'],
    states: () => {
      const s = { on: true, since: 0, kinds: [...SLACK_KINDS], paused: null, last: null, tail: 'abcd' };
      const cards = { none: slackCard({ ...s, tail: null }), off: slackCard({ ...s, on: false }), on: slackCard(s), paused: slackCard({ ...s, paused: 'invalid_token' }), sent: slackCard({ ...s, last: { at: 1, ok: true, text: '' } }), refused: slackCard({ ...s, last: { at: 1, ok: false, text: 'no' } }) };
      return Object.entries(cards).flatMap(([k, c]): [string, Shown][] => [[k, c.look], ...(c.last ? [[`${k}: last`, c.last.look] as [string, Shown]] : [])]);
    },
  },
  { name: 'the machine\'s load', sources: ['extension/src/progress.ts#loadWord'], states: () => [0.1, 1, 3].map((load): [string, Shown] => [`${load}`, loadWord({ load, cpus: 1 })!]) },
  {
    name: 'how agents are billed', sources: ['extension/src/model/agents.ts#billingLook'],
    states: () => (['pass', 'fail', 'unknown'] as const).map((status): [string, Shown] => [status, billingLook([{ id: 'A1.claude-billing', part: 'machine', title: 'Billing', status, detail: 'API key set' }])!]),
  },
  {
    // Its rows and release line aren't looks by type, so the scan doesn't find a new one: LOOKS_WALKED_BY's
    // test matches every LOOK its source writes to a state walked here (GH-147).
    name: 'Settings\' About', sources: ['extension/src/model/about.ts#pluginRow', 'extension/src/model/about.ts#aboutModel'],
    states: () => {
      const now = 1_800_000_000_000;
      const base = sampleAbout(now);
      const release = (version: string) => ({ ok: true as const, value: { version, tag: `v${version}`, name: `v${version}`, url: 'https://github.com/x/y' } });
      const facts: Record<string, Partial<AboutFacts>> = {
        'all current': {}, 'reading': { acc: null, plugin: null, reading: true }, 'checking': { checking: true }, 'never looked': { release: null, checkedAt: null },
        'acc behind': { acc: { ok: true, value: '0.36.0' } }, 'acc won\'t run': { acc: { ok: false, error: 'boom' } }, 'no extension version': { extension: '' },
        'no Claude Code': { plugin: { ok: false, error: 'claude isn\'t installed.', missing: true } }, 'plugins unread': { plugin: { ok: false, error: 'claude plugin list printed something other than a list.' } },
        'no plugin': { plugin: { ok: true, value: null } }, 'plugin off': { plugin: { ok: true, value: { version: '0.37.0', enabled: false } } },
        'plugin behind': { plugin: { ok: true, value: { version: '0.36.0', enabled: true } } }, 'plugin ahead': { plugin: { ok: true, value: { version: '0.38.0', enabled: true } } },
        'plugin with no version': { plugin: { ok: true, value: { version: null, enabled: true } } },
        'look failed': { release: { ok: false, error: 'offline' } }, 'no release yet': { release: { ok: true, value: null } }, 'newer release': { release: release('0.38.0') }, 'older release': { release: release('0.36.0') },
      };
      return Object.entries(facts).flatMap(([k, o]) => {
        const m = aboutModel({ ...base, ...o }, now);
        const action = (a: AboutAction | null): [string, Shown][] => (a ? [[`${k}: ${a.label}`, { label: a.label, icon: a.icon }]] : []);
        return [...m.rows.flatMap((r): [string, Shown][] => [[`${k}: ${r.key}`, r.look], ...action(r.action)]), [`${k}: release`, m.release.look], ...action(m.release.check)];
      });
    },
  },
];

/**
 * What declares a look and isn't a table of states, each with why. A new one goes in TABLES, or here with
 * a reason: the test fails on one in neither, and on one here that's gone.
 */
export const NOT_TABLES: Record<string, string> = {
  'extension/src/model/run-view.ts#lookOf': 'picks a row\'s look from ROW_LOOK, which is walked: an ended count of progress takes its success or its note',
  'extension/src/model/group-check.ts#groupLook': 'a step\'s icon and tone from GROUP_LOOK, which is walked, with its own words for the label (T-165)',
  'extension/src/model/group-check.ts#lastGroupLook': 'the latest step through groupLook, so through GROUP_LOOK, which is walked (T-165)',
  'extension/src/model/shared.ts#LOOK': 'builds a look from its three parts; the tables that call it are walked',
  'extension/src/progress.ts#doneLine': 'a finished job\'s line, Done with its kind\'s icon: each icon is a literal the icon scan checks',
  'extension/src/logic/shared.ts#TONE_COLOR': 'a tone\'s colour in the sidebar, which draws with VSCode\'s own theme colours, not a state',
  'extension/webview/agent-glance.ts#checkSummary': 'sums up the checks, each of which is walked through CHECK_LOOK: an orange icon and words for a failed or waiting one, a neutral one for a check that never ran, its words checked in agent-panel.test.ts (T-142)',
  'extension/webview/task-page.ts#moveFeed': 'a move\'s icon in the feed, each a literal the icon scan checks; the state it reached is the model\'s DISPLAY look',
  'extension/src/model/connect.ts#whyOff': 'the reason a Connect button is off, always the lock icon and neutral tone, its words checked in connect-why.test.ts (T-43)',
  'extension/webview/connect.ts#errorLook': 'an error\'s own words, with the warning icon',
};

/** What's wrong with how one state shows: no words, or an icon the font doesn't draw, or a tone that isn't one. */
export function problems(table: string, states: [string, Shown][]): string[] {
  const out: string[] = [];
  for (const [state, s] of states) {
    if (!s.label?.trim()) out.push(`${table}: ${state} has no label`);
    if (!s.icon || !ICONS.has(iconName(s.icon))) out.push(`${table}: ${state} has ${s.icon ? `icon ${s.icon}, which the codicon font doesn't draw` : 'no icon'}`);
    if (s.tone !== undefined && !['orange', 'blue', 'neutral'].includes(s.tone)) out.push(`${table}: ${state} has tone ${s.tone}, not orange, blue or neutral`);
  }
  return out;
}

test('every state has an icon the codicon font draws and a label, in every table that shows one (GH-105)', (t) => {
  assert.ok(ICONS.size > 500, `the codicon font draws ${ICONS.size} icons`);
  let walked = 0;
  const found: string[] = [];
  for (const table of TABLES) {
    const states = table.states();
    assert.ok(states.length, `${table.name} walked no states`);
    walked += states.length;
    found.push(...problems(table.name, states));
  }
  assert.deepEqual(found, []);
  t.diagnostic(`walked ${walked} states in ${TABLES.length} tables`);
  assert.ok(walked >= 600, `walked ${walked} states in ${TABLES.length} tables`);
});

test('the check finds a state with no label, or an icon the font doesn\'t draw, and names it (GH-105)', () => {
  assert.deepEqual(problems('planted', [['ok', { label: 'Fine', icon: 'sync~spin', tone: 'blue' }], ['blank', { label: ' ', icon: 'pass' }], ['typo', { label: 'Done', icon: 'chek' }], ['red', { label: 'Bad', icon: 'error', tone: 'red' }]]), [
    'planted: blank has no label', 'planted: typo has icon chek, which the codicon font doesn\'t draw', 'planted: red has tone red, not orange, blue or neutral',
  ]);
});

test('every table of task states shows each as core\'s DISPLAY does, and DESIGN.md\'s table (GH-105)', () => {
  const design = readFileSync(join(repo, 'docs', 'DESIGN.md'), 'utf8');
  for (const d of TASK_GROUPS) assert.ok(design.includes(DISPLAY[d].label) && design.includes(`\`${DISPLAY[d].icon}\``), `DESIGN.md shows ${d} as ${DISPLAY[d].label}, ${DISPLAY[d].icon}`);
  const tables = TABLES.filter((t) => t.task);
  assert.ok(tables.length >= 4);
  for (const t of tables) {
    const states = t.states();
    assert.deepEqual(states.map(([k]) => k).sort(), [...TASK_GROUPS].sort(), `${t.name} covers every display state`);
    for (const [d, s] of states) assert.deepEqual({ label: s.label, icon: s.icon, tone: s.tone }, displayLook(d as (typeof TASK_GROUPS)[number]), `${t.name}: ${d}`);
  }
});

// ---------------------------------------------------------------- colours

type Hue = 'red' | 'green' | 'other' | 'grey';

/** A colour's hue, from a hex or rgb() value: red about 345–20°, green about 75–165°. Faint or greyish colours have none. */
export function hueOf(colour: string): Hue | null {
  const hex = /^#([0-9a-f]{3,8})$/i.exec(colour.trim())?.[1];
  let rgba: number[] | null = null;
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map((c) => c + c).join('') : hex;
    rgba = [0, 2, 4, 6].map((i) => (i < full.length ? parseInt(full.slice(i, i + 2), 16) : 255));
  } else {
    const m = /^rgba?\(([^)]+)\)$/.exec(colour.trim());
    if (m) rgba = m[1]!.split(/[\s,/]+/).filter(Boolean).map((v, i) => (i === 3 ? Number(v) * 255 : Number(v)));
  }
  if (!rgba || rgba.some((v) => Number.isNaN(v))) return null;
  const [r, g, b] = rgba.slice(0, 3).map((v) => v / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  if ((rgba[3] ?? 255) < 51 || sat < 0.25) return 'grey';
  const h = max === r ? (60 * ((g - b) / (max - min)) + 360) % 360 : max === g ? 60 * ((b - r) / (max - min)) + 120 : 60 * ((r - g) / (max - min)) + 240;
  return h >= 345 || h <= 20 ? 'red' : h >= 75 && h <= 165 ? 'green' : 'other';
}

const rules = cssRules(pageStyles());
const rootVars = Object.fromEntries(rules.filter((r) => r.selector === ':root').flatMap((r) => r.declarations.map((d) => [d.name, d.value])));

/** A value with its var()s put in, through the page's :root and a palette's --vscode-* colours. */
export function resolve(value: string, theme: PaletteTheme, depth = 0): string {
  if (depth > 8) return value;
  const palette = palettes()[theme];
  return value.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (_, name: string, fallback?: string) => {
    const set = name.startsWith('--vscode-') ? palette[name.slice('--vscode-'.length)] : rootVars[name];
    return resolve(set ?? fallback ?? '', theme, depth + 1);
  });
}

const COLOUR_PROPERTY = /(^|-)(color|background|border|outline|shadow|fill|stroke)(-|$)/;

/** The colours a tone draws with: every rule for .tone-<tone>, -edge- or -row-, resolved in a palette. */
export function toneColours(tone: Tone, theme: PaletteTheme): string[] {
  const keyed = new RegExp(`\\.tone-(?:edge-|row-)?${tone}(?![\\w-])`);
  return rules.filter((r) => keyed.test(r.selector)).flatMap((r) => r.declarations.filter((d) => COLOUR_PROPERTY.test(d.name)).flatMap((d) => colourTokens(resolve(d.value, theme))));
}

/** The colours written in a value: hex and rgb(). The palettes write no other kind. */
const colourTokens = (value: string): string[] => value.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? [];

/** The pairs of a table's states that show one red and the other green, in a palette. */
export function redGreen(states: [string, Shown][], colours: (tone: Tone) => string[]): string[] {
  const hues = states.filter(([, s]) => s.tone).map(([k, s]) => [k, new Set(colours(s.tone as Tone).map(hueOf))] as const);
  const red = hues.filter(([, h]) => h.has('red')).map(([k]) => k);
  const green = hues.filter(([, h]) => h.has('green')).map(([k]) => k);
  return red.flatMap((r) => green.map((g) => `${r} is red and ${g} is green`));
}

test('each tone draws with a colour in both palettes, and no table shows one state red and another green (GH-105)', () => {
  for (const theme of PALETTE_THEMES) {
    for (const tone of ['orange', 'blue', 'neutral'] as const) {
      const colours = toneColours(tone, theme);
      assert.ok(colours.length, `${tone} has a rule`);
      for (const c of colours) assert.ok(hueOf(c), `${tone} in ${theme} draws with ${c}, a colour`);
    }
    const found = TABLES.flatMap((t) => redGreen(t.states(), (tone) => toneColours(tone, theme)).map((p) => `${t.name} in ${theme}: ${p}`));
    assert.deepEqual(found, []);
  }
});

test('the red and green check finds such a pair, and names the states (GH-105)', () => {
  assert.equal(hueOf('#e51400'), 'red');
  assert.equal(hueOf('#3fb950'), 'green');
  assert.equal(hueOf('#d18616'), 'other', 'orange');
  assert.equal(hueOf('#3794ff'), 'other', 'blue');
  assert.equal(hueOf('rgba(0, 0, 0, 0.36)'), 'grey');
  assert.equal(hueOf('#9d9d9d'), 'grey');
  const planted = { orange: ['#e51400'], blue: ['#3fb950'], neutral: ['#9d9d9d'] };
  assert.deepEqual(redGreen([['failed', { icon: 'error', tone: 'orange' }], ['passed', { icon: 'pass', tone: 'blue' }], ['skipped', { icon: 'circle-slash', tone: 'neutral' }]], (t) => planted[t]), ['failed is red and passed is green']);
});

test('no colour the page\'s styles read is red or green in Light or Dark (GH-105)', (t) => {
  let read = 0;
  const found: string[] = [];
  for (const theme of PALETTE_THEMES) {
    for (const r of rules) {
      if (r.selector.startsWith('html[data-theme')) continue;
      for (const d of r.declarations.filter((x) => COLOUR_PROPERTY.test(x.name) && x.value.includes('var('))) {
        read++;
        const value = resolve(d.value, theme);
        for (const c of colourTokens(value)) {
          const hue = hueOf(c);
          if (hue === 'red' || hue === 'green') found.push(`${r.selector} { ${d.name}: ${d.value} } is ${hue} in ${theme}: ${c}`);
        }
      }
    }
  }
  assert.deepEqual(found, []);
  t.diagnostic(`read ${read} colours`);
  assert.ok(read >= 750, `read ${read} colours`);
});

test('the label and avatar tints are each a colour in both palettes, and none is red or green (T-91)', (t) => {
  const tints = Object.keys(rootVars).filter((v) => /^--tint-\d+$/.test(v));
  assert.equal(tints.length, TINTS, `styles.css defines ${tints.length} tints, and tints.ts picks from ${TINTS}`);
  let read = 0;
  for (const theme of PALETTE_THEMES) {
    for (const v of tints) {
      const colours = colourTokens(resolve(`var(${v})`, theme));
      assert.equal(colours.length, 1, `${v} is one colour in ${theme}`);
      const hue = hueOf(colours[0]!);
      assert.ok(hue === 'other', `${v} in ${theme} is ${colours[0]}, ${hue}: a tint is a colour, neither red nor green, nor grey`);
      read++;
    }
  }
  t.diagnostic(`read ${read} tints`);
  assert.equal(read, TINTS * PALETTE_THEMES.length);
});

/** A hex colour as its red, green and blue, 0 to 255. */
const rgbOf = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** WCAG's contrast ratio of two colours given as red, green and blue. */
function contrast(a: number[], b: number[]): number {
  const lum = (c: number[]) => {
    const [r, g, bl] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

test('edge case: the contrast ratio is 21 for black on white, 1 for a colour on itself, and the same either way round', () => {
  assert.equal(contrast([0, 0, 0], [255, 255, 255]), 21);
  assert.equal(contrast(rgbOf('#1f1f1f'), rgbOf('#1f1f1f')), 1);
  assert.equal(contrast(rgbOf('#cccccc'), rgbOf('#1f1f1f')), contrast(rgbOf('#1f1f1f'), rgbOf('#cccccc')));
});

/** How far apart two colours look: CIE76's ΔE, the distance between them in CIELAB. Under 10 or so reads as one colour. */
function deltaE(a: number[], b: number[]): number {
  const lab = (c: number[]) => {
    const [r, g, bl] = c.map((v) => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
    const f = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
    const [x, y, z] = [(r * 0.4124 + g * 0.3576 + bl * 0.1805) / 0.95047, r * 0.2126 + g * 0.7152 + bl * 0.0722, (r * 0.0193 + g * 0.1192 + bl * 0.9505) / 1.08883];
    return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
  };
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!);
}

test('edge case: ΔE is 0 for a colour and itself, and far apart for black and white', () => {
  assert.equal(deltaE(rgbOf('#0451a5'), rgbOf('#0451a5')), 0);
  assert.ok(deltaE([0, 0, 0], [255, 255, 255]) > 99);
  assert.ok(deltaE(rgbOf('#0451a5'), rgbOf('#1258a7')) < 10, 'the two blues T-94 found reading as one');
});

test('no two tints read as one colour in either palette: each pair is at least 15 ΔE apart (T-94)', (t) => {
  const colour = (v: string, theme: PaletteTheme) => rgbOf(colourTokens(resolve(`var(${v})`, theme))[0]!);
  const close: string[] = [];
  let pairs = 0;
  for (const theme of PALETTE_THEMES) {
    for (let a = 1; a <= TINTS; a++) {
      for (let b = a + 1; b <= TINTS; b++) {
        const d = deltaE(colour(`--tint-${a}`, theme), colour(`--tint-${b}`, theme));
        pairs++;
        if (d < 15) close.push(`--tint-${a} and --tint-${b} in ${theme}: ${d.toFixed(1)}`);
      }
    }
  }
  assert.deepEqual(close, []);
  t.diagnostic(`compared ${pairs} pairs`);
  assert.equal(pairs, (TINTS * (TINTS - 1)) / 2 * PALETTE_THEMES.length);
});

test('every tint keeps the text on a label chip and an avatar at AA contrast, on each surface in both palettes (T-94)', (t) => {
  // A chip mixes 14% of its tint into the surface under it, an avatar 32%; both draw the theme's text on top.
  const mix = (tint: number[], under: number[], part: number) => tint.map((v, i) => v * part + under[i]! * (1 - part));
  const colour = (v: string, theme: PaletteTheme) => rgbOf(colourTokens(resolve(`var(${v})`, theme))[0]!);
  const low: string[] = [];
  let read = 0;
  for (const theme of PALETTE_THEMES) {
    const text = colour('--vscode-foreground', theme);
    for (let n = 1; n <= TINTS; n++) {
      const tint = colour(`--tint-${n}`, theme);
      for (const surface of ['--vscode-editor-background', '--vscode-sideBar-background', '--vscode-editorWidget-background']) {
        for (const part of [0.14, 0.32]) {
          const ratio = contrast(text, mix(tint, colour(surface, theme), part));
          read++;
          if (ratio < 4.5) low.push(`--tint-${n} at ${part * 100}% on ${surface} in ${theme}: ${ratio.toFixed(2)}:1`);
        }
      }
    }
  }
  assert.deepEqual(low, []);
  t.diagnostic(`checked ${read} fills`);
  assert.equal(read, TINTS * PALETTE_THEMES.length * 6);
});

test('the page draws each state with the one state chip: a ticket\'s page, its related rows, every board\'s columns and a card\'s state (T-91)', () => {
  const page = readFileSync(join(repo, 'extension', 'webview', 'task-page.ts'), 'utf8');
  const tasks = readFileSync(join(repo, 'extension', 'webview', 'tasks.ts'), 'utf8');
  assert.ok(page.includes('stateChip({ label: m.status.name'), 'the ticket\'s state');
  assert.ok(page.includes('stateChip({ label: r.status.name'), 'a related row\'s');
  assert.ok(tasks.includes("el('h2', 'column-head', stateChip({ label: c.name"), 'a tracker board\'s columns');
  assert.ok(tasks.includes("el('h2', 'column-head', stateChip(c)"), 'the agent board\'s columns');
  assert.ok(tasks.includes('stateChip(c.acc.look)'), 'acc\'s state on a tracker\'s card');
  // T-94: the Agent panel's State and Session, and the agent board's cards' agent and analysis.
  const panel = readFileSync(join(repo, 'extension', 'webview', 'agent-panel.ts'), 'utf8');
  assert.ok(panel.includes('stateChip(a.look)') && panel.includes('stateChip(g.session)'), 'the Agent panel\'s states');
  assert.ok(tasks.includes('stateChip(card.agent)') && tasks.includes('stateChip(card.analysis)'), 'an agent board card\'s states');
  assert.ok(!/status\((?:a\.look|a\.agent|card\.agent|card\.analysis)\)/.test(page + tasks + panel), 'no plain status for those states');
  assert.ok(!page.includes("'pill tone-"), 'no other chip for a state');
  // Doing's icon isn't sync: nothing is syncing.
  assert.notEqual(CATEGORY_LOOK.doing.icon, 'sync');
  assert.deepEqual([CATEGORY_LOOK.done.quiet, CATEGORY_LOOK.doing.quiet, CATEGORY_LOOK.todo.quiet], [true, undefined, undefined], 'done is quiet, the rest aren\'t');
});

// ---------------------------------------------------------------- nothing is skipped

const SOURCE_DIRS = ['extension/src', 'extension/webview'];
const sources = (): { file: string; text: string }[] => SOURCE_DIRS.flatMap((d) => readdirSync(join(repo, d), { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.ts')).map((f) => ({ file: relative(repo, join(repo, d, f)).replaceAll('\\', '/'), text: readFileSync(join(repo, d, f), 'utf8') })));

/** The text from an open bracket to its match. */
function balanced(text: string, at: number): number {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    if ('(<{['.includes(text[i]!)) depth++;
    else if (')>}]'.includes(text[i]!) && text[i - 1] !== '=') depth--;
    if (!depth) return i;
  }
  return text.length;
}

/**
 * The top-level tables and functions a file declares that show a state: a Record<…> of looks or tones, or a
 * function or arrow whose return type is a look or a tone.
 */
export function declaredLooks(file: string, text: string): string[] {
  const shows = /\b(Look|AgentLook|Tone)\b/;
  const out: string[] = [];
  for (const m of text.matchAll(/^(?:export )?const (\w+)\s*:\s*(Record<)/gm)) {
    const end = balanced(text, m.index! + m[0].length - 1);
    if (shows.test(text.slice(m.index!, end))) out.push(`${file}#${m[1]}`);
  }
  for (const m of text.matchAll(/^(?:export )?(?:async )?(?:function (\w+)\s*(?:<[^>]*>)?\(|const (\w+) = (?:<[^>]*>)?\()/gm)) {
    const close = balanced(text, m.index! + m[0].length - 1);
    if (shows.test(returnType(text, close + 1))) out.push(`${file}#${m[1] ?? m[2]}`);
  }
  return out;
}

/** The return type written after a parameter list, if any: up to the body's { or the arrow, object types whole. */
function returnType(text: string, at: number): string {
  const colon = /^\s*:\s*/.exec(text.slice(at));
  if (!colon) return '';
  let i = at + colon[0].length;
  const start = i;
  while (i < text.length) {
    if (text.startsWith('=>', i)) break;
    if (text[i] === '{') {
      // A { where a type is due opens an object type; anywhere else it opens the body.
      if (!/(^|[:|&<,(]\s*)$/.test(text.slice(start, i)) && i !== start) break;
      i = balanced(text, i) + 1;
      continue;
    }
    i++;
  }
  return text.slice(start, i);
}

/** Whether a file declares a table or function by that name, so one listed here and since gone is found. */
const declares = (text: string, name: string): boolean => new RegExp(`^(?:export )?(?:const ${name}\\b|(?:async )?function ${name}\\b)`, 'm').test(text);

test('every table or function that shows a state is walked, or listed with why it isn\'t (GH-105)', (t) => {
  const declared = sources().flatMap((s) => declaredLooks(s.file, s.text));
  const listed = new Set([...TABLES.flatMap((t) => t.sources), ...Object.keys(NOT_TABLES)]);
  assert.deepEqual(declared.filter((d) => !listed.has(d)), [], 'shows a state, and no test walks it: add it to TABLES, or to NOT_TABLES with why');
  assert.deepEqual([...listed].filter((l) => { const [file, name] = l.split('#') as [string, string]; return !declares(readFileSync(join(repo, file), 'utf8'), name); }), [], 'listed, and no longer declared');
  t.diagnostic(`found ${declared.length} declarations`);
  assert.ok(declared.length >= 28, `found ${declared.length} declarations`);
  assert.deepEqual(declaredLooks('x.ts', 'export const T: Record<string, Look> = {};\nfunction f(a: (b: string) => void): Look | null {\n}\nconst g = (x: string): { look: Look } => ({});\nconst h = (): string => \'\';\nfunction k(): { a: string } | null { return { look: 1 as unknown as Look }; }\nexport function m(r: R): { look: Look; detail: string } {\n}\n'), ['x.ts#T', 'x.ts#f', 'x.ts#g', 'x.ts#m'], 'and the scan finds a table, a function and an arrow, and reads a type, not a body');
});

/**
 * Files whose states aren't looks by type, so the scan above can't find a new one, each with the table in
 * TABLES that walks it. Every LOOK such a file writes must be a state that table's walk reaches (GH-147).
 */
export const LOOKS_WALKED_BY: Record<string, string> = {
  'extension/src/model/about.ts': 'Settings\' About',
};

/** The arguments of a call, from just inside its ( to its ), split at its own commas: strings and brackets are skipped whole. */
function callArgs(text: string, at: number): { args: string[]; end: number } {
  const args: string[] = [];
  let depth = 0;
  let start = at;
  for (let i = at; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\'' || c === '"') {
      while (++i < text.length && text[i] !== c) if (text[i] === '\\') i++;
    } else if (c === '`') {
      while (++i < text.length && text[i] !== '`') {
        if (text[i] === '\\') i++;
        else if (text.startsWith('${', i)) i = callArgs(text, i + 2).end;
      }
    } else if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (!depth) return { args: [...args, text.slice(start, i).trim()], end: i };
      depth--;
    } else if (c === ',' && !depth) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  return { args, end: text.length };
}


/**
 * Each LOOK(label, icon, tone) a source writes, by its line: its label as a pattern (a template's ${…}, or a
 * label that's an expression, matches any words), and its icon and tone, null where they aren't written out.
 */
export function writtenLooks(text: string): { line: number; label: RegExp; icon: string | null; tone: string | null }[] {
  const word = (a: string | undefined): string | null => (a && /^'(?:[^'\\]|\\.)*'$/.test(a) ? a.slice(1, -1).replace(/\\(.)/g, '$1') : null);
  return [...text.matchAll(/\bLOOK\(/g)].map((m) => {
    const [label = '', icon, tone] = callArgs(text, m.index! + m[0].length).args;
    const literal = word(label);
    const pattern = literal !== null ? escapeRegExp(literal)
      : label.startsWith('`') ? label.slice(1, -1).split(/\$\{(?:[^{}]|\{[^{}]*\})*\}/).map((p) => escapeRegExp(p.replace(/\\(.)/g, '$1'))).join('.+')
        : '.+';
    return { line: text.slice(0, m.index).split('\n').length, label: new RegExp(`^${pattern}$`), icon: word(icon), tone: word(tone) };
  });
}

/** What a file writes that no walked state shows: a LOOK no walk reaches, or one whose icon or tone isn't written out. */
export function unwalked(file: string, text: string, table: string, states: Shown[]): string[] {
  return writtenLooks(text).flatMap((w) => !w.icon || !w.tone ? [`${file}:${w.line}: a LOOK whose icon or tone is an expression: write each state as its own LOOK`]
    : states.some((s) => s.icon === w.icon && s.tone === w.tone && w.label.test(s.label ?? '')) ? []
      : [`${file}:${w.line}: ${w.label.source} (${w.icon}, ${w.tone}) is a state ${table} doesn't walk`]);
}

test('every LOOK a file of looks by another name writes is a state its table walks (GH-147)', (t) => {
  let written = 0;
  const found: string[] = [];
  for (const [file, name] of Object.entries(LOOKS_WALKED_BY)) {
    const table = TABLES.find((x) => x.name === name);
    assert.ok(table, `${name} is in TABLES`);
    assert.ok(table.sources.some((s) => s.startsWith(`${file}#`)), `${name} names ${file} among its sources`);
    const text = readFileSync(join(repo, file), 'utf8');
    const looks = writtenLooks(text).length;
    assert.ok(looks, `${file} writes no LOOK`);
    written += looks;
    found.push(...unwalked(file, text, name, table.states().map(([, s]) => s)));
  }
  assert.deepEqual(found, []);
  t.diagnostic(`matched ${written} LOOKs in ${Object.keys(LOOKS_WALKED_BY).length} files`);
  assert.ok(written >= 18, `matched ${written} LOOKs`);
});

test('the match finds a LOOK no walk reaches, and one whose tone is an expression (GH-147)', () => {
  const text = 'const a = LOOK(\'Reading it\', \'sync~spin\', \'blue\');\nconst b = LOOK(`${v}, turned off (${f(x, y)})`, \'warning\', \'orange\');\nconst c = LOOK(f.value, \'pass\', \'blue\');\nconst d = LOOK(\'New\', \'pass\', \'blue\');\nconst e = LOOK(\'Odd\', \'pass\', ok ? \'blue\' : \'orange\');\n';
  assert.deepEqual(writtenLooks(text).map((w) => [w.line, w.label.source, w.icon, w.tone]), [
    [1, '^Reading it$', 'sync~spin', 'blue'], [2, '^.+, turned off \\(.+\\)$', 'warning', 'orange'], [3, '^.+$', 'pass', 'blue'], [4, '^New$', 'pass', 'blue'], [5, '^Odd$', 'pass', null],
  ]);
  const states: Shown[] = [{ label: 'Reading it', icon: 'sync~spin', tone: 'blue' }, { label: '0.3.0, turned off (now)', icon: 'warning', tone: 'orange' }, { label: '0.3.0', icon: 'pass', tone: 'blue' }];
  assert.deepEqual(unwalked('x.ts', text, 'X', states), ['x.ts:4: ^New$ (pass, blue) is a state X doesn\'t walk', 'x.ts:5: a LOOK whose icon or tone is an expression: write each state as its own LOOK']);
});

test('every icon a look, an action or the page names is one the codicon font draws, and no label is empty (GH-105)', (t) => {
  // The page's icon() and button() draw a codicon; the extension's own icon() names a tab's image file.
  const named = /\bicon:\s*'([^']*)'|\bLOOK\((?:'(?:[^'\\]|\\.)*'|`[^`]*`|[^,]+),\s*'([^']*)'/g;
  const drawn = /\b(?:icon|iconed)\(\s*'([^']*)'|\bbutton\((?:'(?:[^'\\]|\\.)*'|`[^`]*`|[\w.]+),\s*'([^']*)'/g;
  let icons = 0;
  const found: string[] = [];
  const line = (text: string, at: number) => text.slice(0, at).split('\n').length;
  for (const { file, text } of sources()) {
    for (const m of [...text.matchAll(named), ...(file.startsWith('extension/webview/') ? text.matchAll(drawn) : [])]) {
      const name = m[1] ?? m[2] ?? '';
      icons++;
      if (!ICONS.has(iconName(name))) found.push(`${file}:${line(text, m.index!)}: ${name || 'an empty icon'}`);
    }
    for (const m of text.matchAll(/\blabel:\s*'',\s*icon:/g)) found.push(`${file}:${line(text, m.index!)}: an empty label`);
  }
  assert.deepEqual(found, []);
  t.diagnostic(`checked ${icons} icons`);
  assert.ok(icons >= 420, `checked ${icons} icons`);
});
