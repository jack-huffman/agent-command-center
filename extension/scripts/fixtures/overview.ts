/** The Overview's merge queue (GH-73): a project where auto-merge is on. */
import type { AutopilotRecord } from '../../../packages/core/src/autopilot-log.ts';
import type { Environment } from '../../../packages/core/src/config.ts';
import { rowInWords, stepInWords } from '../../src/logic/relayed.ts';
import type { TaskRow } from '../../src/logic/shared.ts';
import type { HubLike, ProjectLike } from '../../src/model/shared.ts';
import { sampleHub } from './hub.ts';
import { MIN } from './shared.ts';

/**
 * A project where auto-merge is on, with three pull requests in its merge queue (GH-73): the head in
 * `phase`, or held saying `why`, two behind it, one waiting for review, and one the queue sent back to its
 * builder. A tools repo, since a Salesforce project never auto-merges.
 */
export function sampleQueueHub(now = Date.now(), phase: NonNullable<TaskRow['queue']>['phase'] = 'checking', why: string | null = null): HubLike {
  const base = sampleHub(now);
  const root = '/Users/me/code/acme-tools';
  const wt = (id: string) => `${root}/.claude/worktrees/${id}`;
  const environments: Environment[] = [{ name: 'main', branch: 'main', type: 'none', org: null, default: true, protected: false, promotesTo: [] }];
  const project: ProjectLike = {
    name: 'Acme Tools', root, branch: 'main',
    config: { github: { repo: 'acme/tools', account: 'jordan-kim' }, environments, profile: 'generic', autonomy: 'review', autopilot: { autoMerge: true }, trackers: [{ kind: 'github', project: null, prefix: null }] },
    worktrees: [{ path: root, head: 'e1f2a3b', branch: 'main', main: true, changed: 0, locked: false, prunable: false }],
  };
  const source = (n: number) => ({ kind: 'github', url: `https://github.com/acme/tools/issues/${n}` });
  const pr = (n: number) => ({ number: n, url: `https://github.com/acme/tools/pull/${n}`, state: 'open', ci: 'passing', changesRequested: false, conflicts: [] });
  const task = (id: string, title: string, state: string, display: TaskRow['display'], extra: Partial<TaskRow> = {}): TaskRow =>
    ({ id, title, state, display, environment: 'main', deps: [], source: source(Number(id.split('-')[1])), run: { worktree: wt(id), branch: `task/${id}` }, ...extra });
  const passed = { verdict: 'pass' as const, summary: 'Reviewed.', current: true };
  const tasks: TaskRow[] = [
    task('GH-41', 'Retry webhook deliveries with backoff', 'review', 'review', { review: passed, pr: pr(141), queue: { place: 1, of: 3, ahead: null, phase, why } }),
    task('GH-44', 'Show the export\'s progress in the status bar, with the rows left and a time estimate', 'review', 'review', { review: passed, pr: { ...pr(144), conflicts: ['docs/DECISIONS.md'] }, queue: { place: 2, of: 3, ahead: 'GH-41', phase: 'waiting' } }),
    task('GH-47', 'Rename the sync command', 'review', 'review', { review: passed, pr: pr(147), queue: { place: 3, of: 3, ahead: 'GH-44', phase: 'waiting' } }),
    task('GH-48', 'Cache the account lookups', 'review', 'review', { review: null }),
    task('GH-39', 'Split the settings page', 'rework', 'rework', { review: passed, pr: pr(139) }),
    task('GH-50', 'Add a dark theme to the report', 'todo', 'ready'),
  ];
  const at = (ago: number) => new Date(now - ago * MIN).toISOString();
  return {
    ...base, projects: [project], questions: [], answers: [], agents: [],
    taskRows: () => tasks.map(rowInWords),
    projectFor: (p: string) => (p === root || p.startsWith(`${root}/`) ? project : undefined),
    updates: () => [],
    autopilotLog: () => ([
      { seq: 301, at: at(30), task: 'GH-38', step: 'merge', outcome: 'done', pr: { number: 138, url: 'https://github.com/acme/tools/pull/138', opened: false } },
      { seq: 302, at: at(22), task: 'GH-39', step: 'queue', outcome: 'done', checks: ['check'], reason: 'The merge queue sent it back: the full check failed with main merged in: check.' },
      { seq: 303, at: at(21), task: 'GH-39', step: 'dispatch', outcome: 'done', cause: 'queue' },
      { seq: 304, at: at(12), task: 'GH-40', step: 'refresh', outcome: 'done', base: 'main', queue: true },
      { seq: 305, at: at(9), task: 'GH-40', step: 'merge', outcome: 'done', pr: { number: 140, url: 'https://github.com/acme/tools/pull/140', opened: false } },
    ] satisfies AutopilotRecord[]).map(stepInWords),
    history: () => [],
    edits: () => [],
  };
}
