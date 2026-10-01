/**
 * Sample data for looking at the tabs (`npm run screenshot`). Generic names only, since this repo carries
 * no client data. It's shaped like the hub, and the real model functions turn it into what each tab
 * receives, so it can't drift from the types.
 */
import type { Environment } from '../../packages/core/src/config.ts';
import { STEPS } from '../../packages/core/src/onboarding/steps.ts';
import type { AgentSession, DoctorItem, TaskRow } from '../src/logic.ts';
import type { HubLike, ProjectLike } from '../src/model.ts';

const MIN = 60_000;

export function sampleHub(now = Date.now()): HubLike {
  const root = '/Users/me/code/acme-service';
  const wt = (id: string) => `${root}/.claude/worktrees/${id}`;
  const environments: Environment[] = [
    { name: 'Production', branch: 'production', type: 'production', org: 'Acme Production', default: false, protected: true, promotesTo: [] },
    { name: 'QA', branch: 'qa', type: 'partial', org: 'Acme QA', default: false, protected: false, promotesTo: ['production'] },
    { name: 'Dev', branch: 'dev', type: 'developer', org: 'Acme Dev', default: true, protected: false, promotesTo: ['qa', 'production'] },
  ];
  const project: ProjectLike = {
    name: 'Acme Service', root, branch: 'dev',
    config: { github: { repo: 'acme/service', account: 'me' }, environments, profile: 'salesforce' },
    worktrees: [
      { path: root, head: 'a1b2c3d', branch: 'dev', main: true, changed: 0, locked: false, prunable: false },
      { path: wt('T-12'), head: 'b2c3d4e', branch: 'task/T-12-case-escalation-rules', main: false, changed: 4, locked: false, prunable: false },
      { path: wt('T-15'), head: 'c3d4e5f', branch: 'task/T-15-a-very-long-branch-name-that-has-to-truncate-cleanly', main: false, changed: 0, locked: true, prunable: false },
      { path: wt('T-9'), head: 'd4e5f6a', branch: 'task/T-9-retired', main: false, changed: 0, locked: false, prunable: true },
    ],
  };
  const source = (n: number) => ({ kind: 'github', url: `https://github.com/acme/service/issues/${n}` });
  const task = (id: string, title: string, state: string, display: TaskRow['display'], extra: Partial<TaskRow> = {}): TaskRow =>
    ({ id, title, state, display, environment: 'dev', deps: [], source: source(Number(id.slice(2))), ...extra });
  const tasks: TaskRow[] = [
    task('T-14', 'Route web-to-case submissions by product line', 'running', 'needs-you', { run: { bgId: 'bg14', worktree: wt('T-14') }, agent: { label: 'Needs you: permission prompt', icon: 'bell-dot', tone: 'orange' } }),
    task('T-16', 'Add a field history report for Opportunity stage', 'todo', 'ready'),
    task('T-12', 'Case escalation rules for the premium tier', 'running', 'running', { run: { bgId: 'bg12', worktree: wt('T-12') }, agent: { label: 'Working', icon: 'sync~spin', tone: 'blue' } }),
    task('T-15', 'Rename the Region picklist values', 'review', 'review', { run: { worktree: wt('T-15') } }),
    task('T-19', 'Fix the flow that double-sends welcome emails', 'rework', 'rework', { run: { worktree: wt('T-19') } }),
    task('T-18', 'Migrate the legacy territory triggers', 'blocked', 'blocked'),
    task('T-17', 'Dashboards for the escalation rules', 'todo', 'todo', { deps: ['T-12'] }),
    task('T-10', 'Add a CHANGELOG', 'done', 'done', { run: { worktree: wt('T-10') } }),
  ];
  const agents: AgentSession[] = [
    { cwd: wt('T-14'), kind: 'background', startedAt: now - 27 * MIN, id: 'bg14', name: 'T-14', state: 'blocked', waitingFor: 'permission prompt' },
    { cwd: wt('T-12'), kind: 'background', startedAt: now - 12 * MIN, id: 'bg12', name: 'T-12', state: 'working' },
    { cwd: root, kind: 'interactive', startedAt: now - 120 * MIN, sessionId: '0e02-main', name: 'acme-dev', status: 'busy', pid: 4100 },
    { cwd: '/Users/me/code/side-project', kind: 'interactive', startedAt: now - 30 * 60 * MIN, sessionId: '7c1d-side', name: 'side-project', status: 'idle', pid: 4200 },
    { cwd: '/Users/me/Documents/a folder with a long name/docs-site', kind: 'background', startedAt: now - 7 * 24 * 60 * MIN, id: 'bg3', name: 'docs-site', state: 'done' },
  ];
  return {
    projects: [project], agents, agentsError: null,
    taskRows: () => tasks,
    projectFor: (p: string) => (p === root || p.startsWith(`${root}/`) ? project : undefined),
  };
}

/** Every real setup step, mostly passing, with one of each other status so every style shows. */
export function sampleSetup(): { items: DoctorItem[]; confirmed: Set<string> } {
  const odd: Record<string, Partial<DoctorItem>> = {
    'B2.identity': { status: 'fail', detail: 'Commits here would go out as someone@else.example.', fix: 'git config user.email you@example.com' },
    'B8.tracking': { status: 'unknown', detail: 'Turn on source tracking in Setup, then check again.' },
    'B10.readme': { status: 'skip', detail: 'Only one environment, so there is no map to show.' },
  };
  const items = STEPS.filter((s) => !s.planned).map((s): DoctorItem => ({ id: s.id, part: s.part, title: s.title, status: 'pass', detail: 'Looks right.', ...odd[s.id] }));
  return { items, confirmed: new Set() };
}
